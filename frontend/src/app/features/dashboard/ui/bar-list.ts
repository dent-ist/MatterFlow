import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { queueParams } from '../dashboard-links';
import {
  BarStroke,
  NORMAL_STROKE,
  OVERDUE_CSS,
  overdueParams,
  overdueShare,
  overdueText,
  strokeFill,
} from './breakdown-overdue';
import { BreakdownPie } from './breakdown-pie';
import { BreakdownMode, BreakdownPrefs, DEFAULT_MODE } from './breakdown-view';
import { PieSlice, groupSlices, paletteColor, sharePercent, toneColor } from './breakdown-slices';
import { PointerFocus } from './pointer-focus';
import { BD_CARD_CSS } from './breakdown-card';
import { BreakdownSwitch } from './breakdown-switch';
import { TaskTypeChip } from '../../../shared/ui/task-type-chip';

/** One bar: a text label, its number, and the Task Queue query it drills into (null: not linkable). */
export interface BarItem {
  label: string;
  count: number;
  query?: string | null;
  /** Status code or other token that picks the bar color; default is the primary color. */
  tone?: string | null;
  muted?: boolean;
  /** Explicit bar fill and outline (CSS colours), for example the badge colours of a priority. */
  fill?: string | null;
  outline?: string | null;
  /** Task Type icon key (task type breakdown only); drawn before the label, neutral colour. */
  iconKey?: string | null;
  /** The type's own colour key and id (task type breakdown): the same coloured icon tile as the task lists. */
  colourKey?: string | null;
  typeId?: number | null;
  /** A PrimeIcons class on a coloured tile (priority, status): the tile colours are the badge tokens. */
  tile?: { icon: string; bg: string; fg: string } | null;
  /** How many of `count` are overdue (Breakdowns B1): the bar gets an overdue segment and the row a "N overdue" link; undefined: no split. */
  overdue?: number;
  /** Outline style of a coloured bar (Normal solid, Low dotted); default solid. */
  stroke?: BarStroke;
}

export { sharePercent };

let nextId = 0;

/**
 * Accessible horizontal bar list (UX `BarListChart`): every bar has its label, count and share of the total as text, so color is never
 * the only carrier, and "View as table" swaps the bars for a plain table of the same numbers. The longest bar fills the track, the others
 * are in proportion to it, and the percentage next to each is its share of all tasks in the list. Rows with a query are links to the Task Queue.
 */
@Component({
  selector: 'mf-bar-list',
  imports: [RouterLink, TaskTypeChip, TaskTypeIcon, BreakdownPie, PointerFocus, BreakdownSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-labelledby]="id + '-h'">
      <header>
        <h3 [id]="id + '-h'">{{ heading() }}</h3>
        @if (items().length > 0) {
          <mf-bd-switch [mode]="mode()" [heading]="heading()" (pick)="setMode($event)" />
        }
      </header>
      @if (note(); as n) {
        <p class="note">{{ n }}</p>
      }
      <div
        #body
        class="body"
        data-bd-body
        mfPointerFocus
        [attr.data-mode]="mode()"
        [attr.role]="overflowing() ? 'region' : null"
        [attr.tabindex]="overflowing() ? 0 : null"
        [attr.aria-label]="overflowing() ? heading() + ', scrollable' : null"
      >
        @if (items().length === 0) {
          <p class="empty">{{ emptyText() }}</p>
        } @else if (mode() === 'table') {
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
              @for (item of items(); track $index) {
                <tr>
                  <th scope="row">
                    @if (item.fill) {
                      <span class="marker" aria-hidden="true" [style]="markerStyle(item)"></span>
                    }
                    @if (item.query; as q) {
                      @if (item.iconKey) {
                        <mf-task-type-icon [iconKey]="item.iconKey" size="sm" />
                      }
                      <a class="tlink" routerLink="/tasks" [queryParams]="params(q)">{{
                        item.label
                      }}</a>
                    } @else {
                      {{ item.label }}
                    }
                  </th>
                  <td class="num">{{ item.count }}</td>
                  @if (hasOverdue()) {
                    <td class="num">
                      @if ((item.overdue ?? 0) > 0 && overdueLink(item); as od) {
                        <a class="tlink" routerLink="/tasks" [queryParams]="od">{{
                          item.overdue
                        }}</a>
                      } @else {
                        {{ item.overdue ?? 0 }}
                      }
                    </td>
                  }
                  <td class="num">{{ share(item.count) }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else if (mode() === 'pie') {
          @defer (when mode() === 'pie') {
            <mf-breakdown-pie [heading]="heading()" [slices]="slices()" [emptyText]="emptyText()" />
          }
        } @else {
          <ul class="bars">
            @for (item of items(); track $index) {
              <li class="r">
                <div class="row">
                  <span class="namecell">
                    @if (item.tile; as t) {
                      <span
                        class="tile"
                        aria-hidden="true"
                        data-row-tile
                        [style.background]="t.bg"
                        [style.color]="t.fg"
                        ><i class="pi" [class]="t.icon"></i
                      ></span>
                    } @else if (item.iconKey) {
                      <mf-task-type-chip
                        size="sm"
                        data-type-chip
                        [iconKey]="item.iconKey"
                        [colourKey]="item.colourKey"
                        [typeId]="item.typeId"
                        [decorative]="true"
                      />
                    }
                    @if (item.query; as q) {
                      <a
                        class="name rowlink"
                        routerLink="/tasks"
                        [queryParams]="params(q)"
                        [attr.title]="item.label"
                        [attr.aria-label]="rowLabel(item)"
                        >{{ item.label }}</a
                      >
                    } @else {
                      <span class="name" [attr.title]="item.label">{{ item.label }}</span>
                    }
                  </span>
                  <span class="track" aria-hidden="true">
                    @if (item.count > 0) {
                      <span
                        class="bar"
                        [class.muted]="item.muted"
                        [style.width.%]="width(item.count)"
                        [style.background]="barFill(item)"
                        [style.border-color]="item.outline ?? null"
                        [style.border-style]="item.outline ? (item.stroke ?? normal).style : null"
                        [style.border-width.px]="
                          item.outline ? (item.stroke ?? normal).width : null
                        "
                        [class.outlined]="!!item.outline"
                      >
                        @if ((item.overdue ?? 0) > 0) {
                          @if (overdueLink(item); as od) {
                            <a
                              class="od"
                              tabindex="-1"
                              routerLink="/tasks"
                              [queryParams]="od"
                              [style.width.%]="overdueWidth(item)"
                            ></a>
                          } @else {
                            <span class="od" [style.width.%]="overdueWidth(item)"></span>
                          }
                        }
                      </span>
                    }
                  </span>
                  <span class="count">{{ item.count }}</span>
                  <span class="pct">{{ share(item.count) }}</span>
                  @if ((item.overdue ?? 0) > 0) {
                    @if (overdueLink(item); as od) {
                      <a class="od-text chip" routerLink="/tasks" [queryParams]="od"
                        >{{ odText(item) }}<span class="sr-only"> in {{ item.label }}</span></a
                      >
                    } @else {
                      <span class="od-text plain">{{ odText(item) }}</span>
                    }
                  }
                </div>
              </li>
            }
          </ul>
        }
      </div>
    </section>
  `,
  styles: [
    OVERDUE_CSS,
    BD_CARD_CSS,
    `
      .body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
      }
      .body:focus-visible {
        outline: 2px solid var(--mf-focus);
        outline-offset: -2px;
      }
      .bars {
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
        grid-template-columns: minmax(11rem, 1.2fr) minmax(3rem, 1fr) 2.75rem 3rem 6.5rem;
        align-items: center;
        gap: var(--mf-s3);
        min-height: 36px;
        padding: var(--mf-s1) var(--mf-s2);
        color: var(--mf-text);
      }
      /* The whole row is the link to the queue (stretched over the row); the overdue segment and text sit above it. */
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
      .row .od,
      .row .od-text {
        position: relative;
        z-index: 1;
      }
      .od-text.plain {
        text-decoration: none;
      }
      .od-text {
        justify-self: start;
        min-height: 24px;
        display: inline-flex;
        align-items: center;
      }
      /* A narrow card (three across, or a phone): the percentage goes to the table view and the overdue chip stays on the row. */
      @container (max-width: 30rem) {
        .row {
          grid-template-columns: minmax(6.5rem, 1.2fr) minmax(2.5rem, 1fr) 2.5rem 5.25rem;
          gap: var(--mf-s1) var(--mf-s2);
        }
        .pct {
          display: none;
        }
        .od-text {
          grid-column: 4;
        }
      }
      /* A phone: the share is in the table view; the bar gets the room. */
      @container (max-width: 20rem) {
        .row {
          grid-template-columns: minmax(5rem, 1.2fr) minmax(2.5rem, 1fr) 2.25rem;
        }
        .od-text {
          grid-column: 2 / -1;
        }
        .name {
          -webkit-line-clamp: 3;
          line-clamp: 3;
        }
        .pct {
          display: none;
        }
      }
      /* Forced colours drop backgrounds: the plain bar is drawn with the system highlight, the priority bars keep their outline. */
      @media (forced-colors: active) {
        .bar {
          forced-color-adjust: none;
          background: Highlight !important;
          border: 1px solid CanvasText;
        }
        .bar.outlined {
          background: Canvas !important;
          border-color: CanvasText !important;
        }
        .track {
          border: 1px solid GrayText;
        }
        .marker {
          forced-color-adjust: none;
          background: Canvas !important;
          border-color: CanvasText !important;
        }
      }
      /* A long name wraps to two lines (three on a phone) and is cut after that; the full name is the title and the link's label, and the
         table view shows it whole. The numbers never wrap. */
      .name {
        min-width: 0;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        font-size: var(--mf-fs-lg);
        line-height: 1.25;
      }
      .namecell {
        display: flex;
        align-items: center;
        gap: var(--mf-s2);
        min-width: 0;
      }
      .track {
        display: block;
        height: 16px;
        background: var(--mf-surface-alt);
        border-radius: var(--mf-radius);
        overflow: hidden;
      }
      .bar {
        display: flex;
        justify-content: flex-end;
        box-sizing: border-box;
        height: 100%;
        min-width: 2px;
        overflow: hidden;
        background: var(--mf-primary);
        border-radius: var(--mf-radius);
      }
      .bar .od {
        flex: none;
        height: 100%;
      }
      .bar.muted {
        background: var(--mf-border-strong);
      }
      .bar.outlined {
        border: 1px solid;
      }
      .count,
      .pct {
        white-space: nowrap;
      }
      .count {
        text-align: right;
        font-size: var(--mf-fs-lg);
        font-weight: 700;
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
      /* The column titles stay at the top of the body while the rows scroll under them. */
      thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        box-shadow: inset 0 -1px 0 var(--mf-border);
        font-weight: 600;
        font-size: var(--mf-fs-sm);
        background: var(--mf-surface-alt);
      }
      .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      /* The links that open the Task Queue: the shared link style with a focus ring, not the old underlined blue text. */
      .tlink,
      .chip {
        border-radius: var(--mf-radius);
        color: var(--mf-link);
        text-decoration: none;
        font-weight: 600;
      }
      .tlink {
        display: inline-block;
        min-height: 24px;
        line-height: 24px;
      }
      .tlink:hover,
      .chip:hover {
        text-decoration: underline;
      }
      .tlink:focus-visible,
      .chip:focus-visible {
        outline: 2px solid var(--mf-focus);
        outline-offset: 2px;
      }
      .chip {
        padding: 0 var(--mf-s2);
        background: var(--mf-surface-alt);
        border: 1px solid var(--mf-border-soft);
        border-radius: 999px;
        font-size: var(--mf-fs-sm);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .marker {
        display: inline-block;
        width: 0.875rem;
        height: 0.5rem;
        margin-right: var(--mf-s2);
        vertical-align: middle;
        box-sizing: border-box;
        border-radius: 2px;
      }
    `,
  ],
})
export class BarList implements OnInit {
  readonly heading = input.required<string>();
  readonly items = input.required<readonly BarItem[]>();
  /** First column heading of the table view, e.g. "Pod". */
  readonly rowHeading = input('Name');
  readonly note = input<string | null>(null);
  readonly emptyText = input('Nothing to show.');

  protected readonly id = `mf-bars-${nextId++}`;
  protected readonly normal = NORMAL_STROKE;
  /** Key of the card in the remembered choices ("priority"); without one the choice is not remembered. */
  readonly cardKey = input<string | null>(null);

  private readonly prefs = inject(BreakdownPrefs);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly mode = signal<BreakdownMode>(DEFAULT_MODE);
  /** True while the body is taller than its box: it then scrolls and is a named, focusable region. */
  protected readonly overflowing = signal(false);
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  protected readonly total = computed(() => this.items().reduce((sum, i) => sum + i.count, 0));
  private readonly max = computed(() => Math.max(0, ...this.items().map((i) => i.count)));

  /** True when the rows carry an overdue figure (the table gets its column). */
  protected readonly hasOverdue = computed(() => this.items().some((i) => i.overdue !== undefined));

  constructor() {
    afterNextRender(() => {
      const el = this.body()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const measure = () => this.overflowing.set(el.scrollHeight > el.clientHeight + 1);
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      for (const child of Array.from(el.children)) observer.observe(child);
      const mutations = new MutationObserver(() => {
        observer.disconnect();
        observer.observe(el);
        for (const child of Array.from(el.children)) observer.observe(child);
        measure();
      });
      mutations.observe(el, { childList: true });
      this.destroyRef.onDestroy(() => {
        observer.disconnect();
        mutations.disconnect();
      });
      measure();
    });
  }

  ngOnInit(): void {
    const key = this.cardKey();
    if (key) this.mode.set(this.prefs.load(key));
  }

  protected setMode(next: BreakdownMode): void {
    this.mode.set(next);
    const key = this.cardKey();
    if (key) this.prefs.save(key, next);
  }

  /** The rows as pie slices, in the colours of the bars; at most eight, the rest grouped as "Other". */
  protected readonly slices = computed<PieSlice[]>(() =>
    groupSlices(
      this.items().map((item, index) => ({
        label: item.label,
        count: item.count,
        overdue: item.overdue,
        query: item.query ?? null,
        fill: item.muted
          ? 'var(--mf-border-strong)'
          : strokeFill(
              item.fill ?? toneColor(item.tone) ?? paletteColor(index),
              item.stroke ?? NORMAL_STROKE,
            ),
        outline: item.outline ?? (item.muted ? 'var(--mf-text-muted)' : null),
        dashed: item.stroke?.style === 'dashed',
      })),
    ),
  );

  /** The longest bar fills the track; the others are in proportion to it. The share of all tasks is printed as text next to the bar. */
  protected width(count: number): number {
    const max = this.max();
    return max > 0 ? Math.max(1, Math.round((count / max) * 100)) : 0;
  }

  protected share(count: number): string {
    return sharePercent(count, this.total());
  }

  protected params(query: string) {
    return queueParams(query);
  }

  protected overdueLink(item: BarItem) {
    return overdueParams(item.query);
  }

  protected odText(item: BarItem): string {
    return overdueText(item.overdue ?? 0);
  }

  protected overdueWidth(item: BarItem): number {
    return overdueShare(item.overdue ?? 0, item.count);
  }

  protected rowLabel(item: BarItem): string {
    return `${item.label}: ${item.count} tasks, ${this.share(item.count)}`;
  }

  protected barFill(item: BarItem): string | null {
    if (item.muted) return null;
    const fill = item.fill ?? this.color(item.tone);
    return strokeFill(fill, item.stroke ?? NORMAL_STROKE);
  }

  protected markerStyle(item: BarItem): Record<string, string> {
    const stroke = item.stroke ?? NORMAL_STROKE;
    return {
      background: strokeFill(item.fill ?? 'transparent', stroke),
      border: `${stroke.width}px ${stroke.style} ${item.outline ?? 'currentColor'}`,
    };
  }

  protected color(tone: string | null | undefined): string {
    return toneColor(tone) ?? 'var(--mf-primary)';
  }
}
