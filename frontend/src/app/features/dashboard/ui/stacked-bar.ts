import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { queueParams } from '../dashboard-links';
import { OVERDUE_CSS, overdueParams, overdueShare, overdueText } from './breakdown-overdue';
import { BreakdownPie } from './breakdown-pie';
import { PieSlice, sharePercent } from './breakdown-slices';
import {
  BreakdownMode,
  BreakdownPrefs,
  DEFAULT_MODE,
  NEXT_MODE,
  nextModeLabel,
} from './breakdown-view';

/** One segment of the bar (an age band). */
export interface Segment {
  label: string;
  count: number;
  query: string;
  /** How many of `count` are overdue (Breakdowns B1); undefined: no split. */
  overdue?: number;
}

let nextId = 0;

/**
 * The age bands are an ordered scale, so they use one hue (the brand blue) from light to dark: older is darker, and nothing says "good"
 * or "bad" (no traffic light; the note under the bar says it is not a service-level target). Every fill carries its own text colour at
 * 4.5:1 or more, and a 1px brand-blue edge keeps the pale fills visible against the white card (checked in chart-contrast.spec.ts).
 */
export const AGE_RAMP: readonly { bg: string; fg: string }[] = [
  { bg: '#DCE8F8', fg: '#102A54' },
  { bg: '#B5CDF0', fg: '#102A54' },
  { bg: '#84A8E0', fg: '#102A54' },
  { bg: '#3B6AB4', fg: '#FFFFFF' },
  { bg: '#25498A', fg: '#FFFFFF' },
  { bg: '#16356B', fg: '#FFFFFF' },
];

/**
 * One segmented (100% stacked) bar plus a legend (UX `mf-stacked-bar`): the length of a segment is its share of the total. Every segment
 * and every legend row is a link to the Task Queue, the legend states label, count and percent, and "View as table" shows the same numbers.
 */
@Component({
  selector: 'mf-stacked-bar',
  imports: [RouterLink, BreakdownPie],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-labelledby]="id + '-h'">
      <header>
        <h3 [id]="id + '-h'">{{ heading() }}</h3>
        @if (total() > 0) {
          <button type="button" class="toggle" data-view-toggle (click)="toggle()">
            {{ nextLabel() }}<span class="sr-only"> for {{ heading() }}</span>
          </button>
        }
      </header>
      @if (note(); as n) {
        <p class="note">{{ n }}</p>
      }
      @if (total() === 0) {
        <p class="note">{{ emptyText() }}</p>
      } @else if (mode() === 'pie') {
        @defer (when mode() === 'pie') {
          <mf-breakdown-pie [heading]="heading()" [slices]="slices()" [emptyText]="emptyText()" />
        }
      } @else if (mode() === 'table') {
        <div class="mf-scroll">
          <table>
            <caption class="sr-only">
              {{
                heading()
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ rowHeading() }}</th>
                <th scope="col" class="num">Tasks</th>
                @if (hasOverdue()) {
                  <th scope="col" class="num">Overdue</th>
                }
                <th scope="col" class="num">Share</th>
              </tr>
            </thead>
            <tbody>
              @for (s of segments(); track $index) {
                <tr>
                  <th scope="row">
                    <a routerLink="/tasks" [queryParams]="params(s.query)">{{ s.label }}</a>
                  </th>
                  <td class="num">{{ s.count }}</td>
                  @if (hasOverdue()) {
                    <td class="num">
                      @if ((s.overdue ?? 0) > 0) {
                        <a routerLink="/tasks" [queryParams]="od(s)">{{ s.overdue }}</a>
                      } @else {
                        {{ s.overdue ?? 0 }}
                      }
                    </td>
                  }
                  <td class="num">{{ share(s.count) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div
          class="stack"
          role="list"
          [attr.aria-label]="heading() + ', share of ' + total() + ' tasks'"
        >
          @for (s of segments(); track $index) {
            @if (s.count > 0) {
              <div
                role="listitem"
                class="seg"
                [style.flex-grow]="s.count"
                [style.background]="ramp($index).bg"
                [style.color]="ramp($index).fg"
                [attr.aria-label]="s.label + ': ' + s.count + ' tasks, ' + share(s.count)"
              >
                <a
                  class="seglink"
                  tabindex="-1"
                  aria-hidden="true"
                  routerLink="/tasks"
                  [queryParams]="params(s.query)"
                  [attr.title]="s.label + ': ' + s.count + ' (' + share(s.count) + ')'"
                  ><span>{{ s.count }}</span></a
                >
                @if ((s.overdue ?? 0) > 0) {
                  <a
                    class="od"
                    tabindex="-1"
                    aria-hidden="true"
                    routerLink="/tasks"
                    [queryParams]="od(s)"
                    [style.width.%]="overdueWidth(s)"
                  ></a>
                }
              </div>
            }
          }
        </div>
        <ul class="legend">
          @for (s of segments(); track $index) {
            <li class="r">
              <div class="row">
                <span class="swatch" aria-hidden="true" [style.background]="ramp($index).bg"></span>
                <a
                  class="name rowlink"
                  routerLink="/tasks"
                  [queryParams]="params(s.query)"
                  [attr.aria-label]="s.label + ': ' + s.count + ' tasks, ' + share(s.count)"
                  >{{ s.label }}</a
                >
                <span class="count">{{ s.count }}</span>
                <span class="pct">{{ share(s.count) }}</span>
                @if ((s.overdue ?? 0) > 0) {
                  <a class="od-text" routerLink="/tasks" [queryParams]="od(s)"
                    >{{ odText(s) }}<span class="sr-only"> in {{ s.label }}</span></a
                  >
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    OVERDUE_CSS,
    `
      :host {
        display: block;
      }
      .card {
        height: 100%;
        box-sizing: border-box;
        padding: var(--mf-s4);
        background: var(--mf-surface);
        border: 1px solid var(--mf-border);
        border-radius: var(--mf-radius-lg);
        container-type: inline-size;
      }
      header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--mf-s3);
        margin-bottom: var(--mf-s3);
      }
      h3 {
        margin: 0;
        font-size: var(--mf-fs-lg);
      }
      .toggle {
        background: none;
        border: 0;
        padding: 0;
        color: var(--mf-link);
        font: inherit;
        font-size: var(--mf-fs-sm);
        cursor: pointer;
        text-decoration: underline;
      }
      .note {
        margin: 0 0 var(--mf-s3);
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .stack {
        display: flex;
        gap: 2px;
        height: 2.5rem;
        margin-bottom: var(--mf-s3);
      }
      .seg {
        position: relative;
        min-width: 1.75rem;
        flex-basis: 0;
        overflow: hidden;
        box-shadow: inset 0 0 0 1px var(--mf-primary);
        font-size: var(--mf-fs-sm);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        border-radius: var(--mf-radius);
      }
      .seg:hover {
        box-shadow: inset 0 0 0 2px var(--mf-text);
      }
      .seglink {
        position: absolute;
        inset: 0 0 0.5rem 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: inherit;
        text-decoration: none;
      }
      /* The overdue share of the band: a hatched strip along the bottom, from the right edge, proportional to the band. */
      .seg .od {
        position: absolute;
        right: 0;
        bottom: 0;
        height: 0.5rem;
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
      .r:hover {
        background: var(--mf-selected-bg);
      }
      .row {
        display: grid;
        grid-template-columns: 0.875rem minmax(4rem, 1fr) 2.25rem 2.75rem 5.5rem;
        align-items: center;
        gap: var(--mf-s2);
        padding: var(--mf-s1) var(--mf-s2);
        color: var(--mf-text);
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
      .seglink:focus-visible {
        outline: 2px solid var(--mf-focus);
        outline-offset: -2px;
      }
      .od-text {
        position: relative;
        z-index: 1;
        justify-self: start;
        min-height: 24px;
        display: inline-flex;
        align-items: center;
      }
      @media (forced-colors: active) {
        .seg {
          forced-color-adjust: none;
          background: Canvas !important;
          color: CanvasText !important;
          border: 1px solid CanvasText;
        }
        .swatch {
          forced-color-adjust: none;
          background: Highlight !important;
          border: 1px solid CanvasText;
        }
      }
      @container (max-width: 30rem) {
        .row {
          grid-template-columns: 0.875rem minmax(4rem, 1fr) 2rem 2.5rem;
        }
        .od-text {
          grid-column: 2 / -1;
        }
      }
      .swatch {
        width: 0.875rem;
        height: 0.875rem;
        border-radius: 2px;
        box-shadow: inset 0 0 0 1px var(--mf-primary);
      }
      .count {
        text-align: right;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .pct {
        text-align: right;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
        font-variant-numeric: tabular-nums;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: var(--mf-s1) var(--mf-s2);
        text-align: left;
        font-weight: 400;
        border-bottom: 1px solid var(--mf-border);
      }
      thead th {
        font-weight: 600;
        font-size: var(--mf-fs-sm);
        background: var(--mf-surface-alt);
      }
      .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
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
export class StackedBar implements OnInit {
  readonly heading = input.required<string>();
  readonly segments = input.required<readonly Segment[]>();
  readonly rowHeading = input('Band');
  readonly note = input<string | null>(null);
  readonly emptyText = input('Nothing to show.');

  protected readonly id = `mf-stack-${nextId++}`;
  /** Key of the card in the remembered choices ("age"); without one the choice is not remembered. */
  readonly cardKey = input<string | null>(null);

  private readonly prefs = inject(BreakdownPrefs);
  protected readonly mode = signal<BreakdownMode>(DEFAULT_MODE);
  protected readonly total = computed(() => this.segments().reduce((sum, s) => sum + s.count, 0));

  protected readonly hasOverdue = computed(() =>
    this.segments().some((s) => s.overdue !== undefined),
  );

  ngOnInit(): void {
    const key = this.cardKey();
    if (key) this.mode.set(this.prefs.load(key));
  }

  protected nextLabel(): string {
    return nextModeLabel(this.mode());
  }

  protected toggle(): void {
    const next = NEXT_MODE[this.mode()];
    this.mode.set(next);
    const key = this.cardKey();
    if (key) this.prefs.save(key, next);
  }

  /** The bands as pie slices, in the colours of the segments (light to dark with age). */
  protected readonly slices = computed<PieSlice[]>(() =>
    this.segments().map((s, i) => ({
      label: s.label,
      count: s.count,
      overdue: s.overdue,
      query: s.query,
      fill: this.ramp(i).bg,
      outline: 'var(--mf-primary)',
    })),
  );

  protected params(query: string) {
    return queueParams(query);
  }

  protected od(s: Segment) {
    return overdueParams(s.query) ?? {};
  }

  protected odText(s: Segment): string {
    return overdueText(s.overdue ?? 0);
  }

  protected overdueWidth(s: Segment): number {
    return overdueShare(s.overdue ?? 0, s.count);
  }

  protected share(count: number): string {
    return sharePercent(count, this.total());
  }

  protected ramp(index: number): { bg: string; fg: string } {
    return AGE_RAMP[Math.min(index, AGE_RAMP.length - 1)];
  }
}
