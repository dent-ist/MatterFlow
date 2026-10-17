import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { queueParams } from '../dashboard-links';
import { PIE, PieArc, PieSlice, layoutPie, sharePercent } from './breakdown-slices';
import { OVERDUE_CSS, overdueParams, overdueText } from './breakdown-overdue';

let nextId = 0;

/**
 * The pie view of a Breakdowns card (hand-written SVG, no chart library; loaded only when someone asks for the pie). A donut with the
 * total in the middle, one slice per row in the colours of the bars, and the overdue part of a slice as a hatched segment of a thin outer
 * ring. Colour is never the only cue: every slice carries its number (as large slices do in the ring and every legend row does), slices
 * are separated by an outline, Low is dashed and the overdue part is hatched. The legend is real text (label, count, share, "N overdue"
 * as a link to the Task Queue, the same links as the bars); focusing or hovering a legend row or a slice shows its text in the middle and
 * under the pie. The SVG itself is one image with a text summary, the legend below it is what screen readers walk.
 */
@Component({
  selector: 'mf-breakdown-pie',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (total() === 0) {
      <p class="empty" data-pie-empty>{{ emptyText() }}</p>
    } @else {
      <div class="pie" data-pie>
        <div class="figure">
          <svg class="svg" viewBox="0 0 200 200" role="img" [attr.aria-label]="summary()">
            <defs>
              <pattern
                [id]="id + '-od'"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect class="od-a" width="6" height="6" />
                <rect class="od-b" width="3" height="6" />
              </pattern>
            </defs>
            @for (arc of arcs(); track arc.index) {
              @if (arc.path) {
                <path
                  class="slice"
                  data-slice
                  [class.on]="active() === arc.index"
                  [class.link]="!!arc.slice.query"
                  [attr.d]="arc.path"
                  fill-rule="evenodd"
                  [style.fill]="arc.slice.fill"
                  [style.stroke]="arc.slice.outline ?? 'var(--mf-surface)'"
                  [attr.stroke-dasharray]="arc.slice.dashed ? '4 3' : null"
                  (mouseenter)="active.set(arc.index)"
                  (mouseleave)="active.set(null)"
                  (click)="open(arc.slice)"
                >
                  <title>{{ tip(arc.slice) }}</title>
                </path>
                @if (arc.label.show) {
                  <text class="num" [attr.x]="arc.label.x" [attr.y]="arc.label.y">
                    {{ arc.index + 1 }}
                  </text>
                }
                @if (arc.overduePath; as p) {
                  <path
                    class="od-ring"
                    data-overdue-ring
                    [attr.d]="p"
                    [attr.fill]="'url(#' + id + '-od)'"
                  >
                    <title>{{ tip(arc.slice) }}</title>
                  </path>
                }
              }
            }
            <text class="centre" [attr.x]="cx" [attr.y]="cy + 2" data-pie-centre>
              {{ centre().big }}
            </text>
            <text class="centre-sub" [attr.x]="cx" [attr.y]="cy + 20">{{ centre().small }}</text>
          </svg>
          <p class="tip" aria-hidden="true" data-pie-tip>{{ activeTip() }}</p>
        </div>
        <ul class="legend" data-pie-legend>
          @for (arc of arcs(); track arc.index) {
            <li
              class="r"
              [class.on]="active() === arc.index"
              (mouseenter)="active.set(arc.index)"
              (mouseleave)="active.set(null)"
              (focusin)="active.set(arc.index)"
              (focusout)="active.set(null)"
            >
              <div class="row">
                <span
                  class="swatch"
                  aria-hidden="true"
                  [class.dashed]="arc.slice.dashed"
                  [style.background]="arc.slice.fill"
                  [style.border-color]="arc.slice.outline ?? 'var(--mf-border-strong)'"
                  ><span class="n">{{ arc.index + 1 }}</span></span
                >
                @if (arc.slice.query; as q) {
                  <a
                    class="name rowlink"
                    routerLink="/tasks"
                    [queryParams]="params(q)"
                    [attr.title]="arc.slice.label"
                    [attr.aria-label]="rowLabel(arc.slice)"
                    >{{ arc.slice.label }}</a
                  >
                } @else {
                  <span class="name" [attr.title]="arc.slice.label">{{ arc.slice.label }}</span>
                }
                <span class="count">{{ arc.slice.count }}</span>
                <span class="pct">{{ share(arc.slice.count) }}</span>
                @if ((arc.slice.overdue ?? 0) > 0) {
                  @if (overdueLink(arc.slice); as od) {
                    <a class="od-text" routerLink="/tasks" [queryParams]="od"
                      >{{ odText(arc.slice)
                      }}<span class="sr-only"> in {{ arc.slice.label }}</span></a
                    >
                  } @else {
                    <span class="od-text plain">{{ odText(arc.slice) }}</span>
                  }
                }
              </div>
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: [
    OVERDUE_CSS,
    `
      :host {
        display: block;
        container-type: inline-size;
      }
      .empty {
        margin: 0;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .pie {
        display: grid;
        gap: var(--mf-s3);
        justify-items: stretch;
      }
      .figure {
        display: grid;
        justify-items: center;
        gap: var(--mf-s1);
      }
      .svg {
        display: block;
        width: clamp(140px, 58cqi, 200px);
        height: auto;
        overflow: visible;
      }
      /* Wide enough for both: the pie on the left and the legend beside it. */
      @container (min-width: 24rem) {
        .pie {
          grid-template-columns: auto minmax(0, 1fr);
          align-items: start;
          gap: var(--mf-s3);
        }
        .svg {
          width: clamp(140px, 36cqi, 200px);
        }
      }
      .slice {
        stroke-width: 1.5;
        paint-order: stroke;
      }
      .slice.link {
        cursor: pointer;
      }
      .slice.on {
        stroke: var(--mf-text) !important;
        stroke-width: 3;
        stroke-dasharray: none;
      }
      .num {
        text-anchor: middle;
        font-size: 13px;
        font-weight: 700;
        fill: var(--mf-text);
        stroke: var(--mf-surface);
        stroke-width: 3px;
        paint-order: stroke;
        pointer-events: none;
        font-variant-numeric: tabular-nums;
      }
      .centre {
        text-anchor: middle;
        font-size: 26px;
        font-weight: 700;
        fill: var(--mf-text);
        font-variant-numeric: tabular-nums;
      }
      .centre-sub {
        text-anchor: middle;
        font-size: 12px;
        fill: var(--mf-text-muted);
      }
      .od-a {
        fill: var(--mf-danger-bg);
      }
      .od-b {
        fill: var(--mf-danger);
      }
      .od-ring {
        stroke: var(--mf-danger);
        stroke-width: 1;
      }
      .tip {
        margin: 0;
        min-height: 1.25em;
        max-width: 100%;
        text-align: center;
        color: var(--mf-text);
        font-size: var(--mf-fs-sm);
        overflow-wrap: anywhere;
      }
      .legend {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: var(--mf-s1);
      }
      .r {
        position: relative;
        border-radius: var(--mf-radius);
      }
      .r:hover,
      .r.on {
        background: var(--mf-selected-bg);
      }
      .row {
        display: grid;
        grid-template-columns: 1.375rem minmax(0, 1fr) auto auto;
        align-items: start;
        gap: var(--mf-s1) var(--mf-s2);
        padding: var(--mf-s1) var(--mf-s2);
        color: var(--mf-text);
      }
      .swatch {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.375rem;
        height: 1.375rem;
        border: 1px solid;
        border-radius: 3px;
        font-size: 0.75rem;
        font-weight: 700;
        line-height: 1;
        color: var(--mf-text);
      }
      .swatch.dashed {
        border-style: dashed;
        border-width: 2px;
      }
      .n {
        text-shadow:
          0 0 2px var(--mf-surface),
          0 0 2px var(--mf-surface),
          0 0 3px var(--mf-surface);
      }
      .name {
        min-width: 0;
        font-size: var(--mf-fs-md);
        line-height: 1.25;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        padding-top: 2px;
      }
      .rowlink {
        color: inherit;
        text-decoration: none;
      }
      .rowlink::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: var(--mf-radius);
      }
      .rowlink:focus-visible {
        outline: none;
      }
      .rowlink:focus-visible::after {
        outline: 2px solid var(--mf-focus);
        outline-offset: -2px;
      }
      .count,
      .pct {
        padding-top: 2px;
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .count {
        font-weight: 600;
      }
      .pct {
        min-width: 2.25rem;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .od-text {
        grid-column: 2 / -1;
        position: relative;
        z-index: 1;
        justify-self: start;
        min-height: 24px;
        display: inline-flex;
        align-items: center;
      }
      .od-text.plain {
        text-decoration: none;
      }
      @media (prefers-reduced-motion: no-preference) {
        .slice {
          transition: stroke-width 0.12s;
        }
      }
      @media (forced-colors: active) {
        .slice {
          forced-color-adjust: none;
          fill: Canvas !important;
          stroke: CanvasText !important;
        }
        .od-a {
          fill: Canvas;
        }
        .od-b {
          fill: CanvasText;
        }
        .od-ring {
          forced-color-adjust: none;
          stroke: CanvasText;
        }
        .num,
        .centre {
          fill: CanvasText;
          stroke: Canvas;
        }
        .centre-sub {
          fill: CanvasText;
        }
        .swatch {
          forced-color-adjust: none;
          background: Canvas !important;
          border-color: CanvasText !important;
          color: CanvasText;
        }
        .n {
          text-shadow: none;
        }
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `,
  ],
})
export class BreakdownPie {
  private readonly router = inject(Router);

  readonly heading = input.required<string>();
  readonly slices = input.required<readonly PieSlice[]>();
  readonly emptyText = input('Nothing to show.');
  readonly unit = input('tasks');

  protected readonly id = `mf-pie-${nextId++}`;
  protected readonly cx = PIE.cx;
  protected readonly cy = PIE.cy;
  /** The slice under the pointer or the keyboard focus (legend row or slice). */
  protected readonly active = signal<number | null>(null);

  protected readonly total = computed(() => this.slices().reduce((n, s) => n + s.count, 0));
  private readonly overdueTotal = computed(() =>
    this.slices().reduce((n, s) => n + (s.overdue ?? 0), 0),
  );
  protected readonly arcs = computed<PieArc[]>(() => layoutPie(this.slices()));

  /** The text alternative of the SVG: every non-empty slice with its count and share, then the total and the overdue part. */
  protected readonly summary = computed(() => {
    const parts = this.slices()
      .filter((s) => s.count > 0)
      .map((s) => `${s.label} ${s.count} (${this.share(s.count)})`);
    const overdue = this.overdueTotal();
    return `${this.heading()}, pie chart: ${parts.join('; ')}. ${this.total()} ${this.unit()}${overdue > 0 ? `, ${overdue} overdue` : ''}.`;
  });

  protected readonly centre = computed(() => {
    const i = this.active();
    const s = i === null ? undefined : this.slices()[i];
    return s
      ? { big: String(s.count), small: this.share(s.count) }
      : { big: String(this.total()), small: this.unit() };
  });

  protected readonly activeTip = computed(() => {
    const i = this.active();
    const s = i === null ? undefined : this.slices()[i];
    return s ? this.tip(s) : '';
  });

  protected share(count: number): string {
    return sharePercent(count, this.total());
  }

  /** The one wording of a slice for tooltips and the native title: "Critical: 6 tasks, 43%, 2 overdue". */
  protected tip(s: PieSlice): string {
    const od = s.overdue ?? 0;
    return `${s.label}: ${s.count} ${this.unit()}, ${this.share(s.count)}${od > 0 ? `, ${od} overdue` : ''}`;
  }

  protected rowLabel(s: PieSlice): string {
    return `${s.label}: ${s.count} ${this.unit()}, ${this.share(s.count)}`;
  }

  protected params(query: string) {
    return queueParams(query);
  }

  protected overdueLink(s: PieSlice) {
    return overdueParams(s.query);
  }

  protected odText(s: PieSlice): string {
    return overdueText(s.overdue ?? 0);
  }

  /** A click on a slice opens the same Task Queue list as its legend link (the legend is the keyboard route). */
  protected open(s: PieSlice): void {
    if (s.query) void this.router.navigate(['/tasks'], { queryParams: queueParams(s.query) });
  }
}
