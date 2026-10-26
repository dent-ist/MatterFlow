import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  ElementRef,
  TemplateRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, mfDate } from '../../../core/time/time';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { queueParams } from '../dashboard-links';
import { TrendSample } from './trend-sample';
import {
  ChartLine,
  Granularity,
  LABEL_MARGIN,
  LABEL_MAX_LINES,
  LABEL_MIN_GAP,
  PanelKey,
  PanelView,
  addDays,
  bucketRange,
  containsDay,
  endLabelText,
  linkNote,
  markerIndexes,
  niceScale,
  nudgeLabels,
  pointHeading,
  rangeQuery,
  shortDate,
  weekdayOf,
  weekLabel,
  xTicks,
} from './trend-model';
import { isHollow, markerPath } from '../../../shared/charts/chart-palette';

export { niceMax } from './trend-model';

const DEFAULT_WIDTH = 640;
const RIGHT = 14;
const TOP = 12;
/** Room under the last panel for the day labels; the panels above it only need a little. */
const BOTTOM_LAST = 30;
const BOTTOM_OTHER = 8;
/** At or below this width of the chart (a phone) the panels are 16:9 (at least 220 px) instead of 320 and 200 px. */
const COMPACT_WIDTH = 480;
const COMPACT_FLOWS_MIN = 220;
const COMPACT_BACKLOG = 180;
/** Characters of an end label that fit the reserved margin (11 px type). */
const LABEL_CHARS = 14;

let nextId = 0;

/**
 * The daily lines of the Trends tab (UX `mf-trend-chart`): one or two stacked SVG line panels (flows, backlog) with no chart library. The
 * panels share one x scale and one cursor, each has its own y axis (`niceScale`). The drawing is measured (ResizeObserver) and redrawn at
 * its real pixel size. Every line differs by colour, dash pattern and marker shape (the list next to it is the control and shows the same
 * samples), the tooltip and the live read-out list the values of every visible line of both panels for the hovered or focused day, grouped
 * by panel, and "View as table" gives one column per visible line with a group header per panel and a link from each day's count to the
 * Task Queue. A panel with 4 or fewer lines names each line at its last point (aria-hidden duplicates of the read-out), markers are drawn at the
 * ends and on the hovered day when a line has more than 14 points, the x axis has a label on every Monday (week starts when the points are
 * weeks) and a tap on a day shows the tooltip. Operational counts only.
 *
 * The tab passes a `controls` template (the measure control of a panel) which is drawn in each panel's header.
 */
@Component({
  selector: 'mf-trend-chart',
  imports: [RouterLink, NgTemplateOutlet, TrendSample, TaskTypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.fit]': 'fit()',
    '(document:pointerdown)': 'onOutside($event)',
  },
  template: `
    @if (!hasLines()) {
      <p class="note" data-empty>{{ emptyText() }}</p>
    } @else if (asTable()) {
      <div
        class="mf-scroll table-wrap"
        tabindex="0"
        role="region"
        [attr.aria-label]="heading() + ', table'"
      >
        <table>
          <caption class="sr-only">
            {{
              heading()
            }}
          </caption>
          <thead>
            @if (groups().length > 1) {
              <tr>
                <th scope="col" rowspan="2">{{ unit() }}</th>
                @for (g of groups(); track g.key) {
                  <th
                    scope="colgroup"
                    [attr.colspan]="g.count"
                    class="group"
                    [attr.data-group]="g.key"
                  >
                    {{ g.title }}
                  </th>
                }
              </tr>
            }
            <tr>
              @if (groups().length <= 1) {
                <th scope="col">{{ unit() }}</th>
              }
              @for (l of allLines(); track l.key) {
                <th scope="col" class="num" [attr.data-col]="l.key">
                  <span class="colhead">
                    <mf-trend-sample [style]="l.style" />
                    @if (l.iconKey) {
                      <mf-task-type-icon [iconKey]="l.iconKey" size="sm" />
                    }
                    <span>{{ l.name }}</span>
                  </span>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (date of dates(); track date; let i = $index) {
              <tr>
                <th scope="row">{{ day(date) }}</th>
                @for (l of allLines(); track l.key) {
                  <td class="num">
                    @if (l.values[i] > 0) {
                      <a routerLink="/tasks" [queryParams]="dayParams(l, date, i)">{{
                        l.values[i]
                      }}</a>
                    } @else {
                      0
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (notes().shown.length + notes().more.length > 0) {
        <div class="foot">
          @for (n of notes().shown; track n) {
            <span>{{ n }}</span>
          }
          @if (notes().more.length > 0) {
            <details class="more" data-more>
              <summary>How these are counted</summary>
              @for (n of notes().more; track n) {
                <p>{{ n }}</p>
              }
            </details>
          }
        </div>
      }
    } @else {
      <div
        class="plot"
        tabindex="0"
        role="group"
        aria-roledescription="chart"
        data-plot
        [attr.aria-label]="summary() + ' Use the left and right arrow keys to read each day.'"
        (focus)="onFocus()"
        (blur)="clearActive()"
        (keydown)="onKey($event)"
      >
        @for (p of geo(); track p.key; let pi = $index) {
          <section class="panel" [class.panel--flows]="p.key === 'flows'" [attr.data-panel]="p.key">
            <div class="panel-head">
              <div class="ttl">
                <h3 class="panel-title">{{ p.title }}</h3>
                @if (weekly()) {
                  <span class="per" data-per-week>per week</span>
                }
              </div>
              @if (controls(); as tpl) {
                <ng-container *ngTemplateOutlet="tpl; context: { $implicit: p.key }" />
              }
            </div>
            @if (p.lines.length === 0) {
              <p class="note" data-panel-empty>{{ panelEmpty(p.key) }}</p>
            } @else {
              <div
                class="panel-plot"
                #pp
                [attr.data-panel-plot]="p.key"
                (pointermove)="onPointer($event, pi)"
                (pointerdown)="onPointer($event, pi)"
                (pointerleave)="onLeave($event)"
              >
                <svg
                  class="chart"
                  [attr.viewBox]="'0 0 ' + width() + ' ' + p.height"
                  [style.height.px]="fit() ? null : p.height"
                  aria-hidden="true"
                >
                  @if (activePoint(); as a) {
                    <rect
                      class="hover-band"
                      [attr.x]="a.bandX"
                      [attr.y]="p.top"
                      [attr.width]="a.bandWidth"
                      [attr.height]="p.plotHeight"
                    />
                  }
                  @for (b of p.weekendBands; track b.date) {
                    <rect
                      class="weekend"
                      [attr.x]="b.x"
                      [attr.y]="p.top"
                      [attr.width]="b.width"
                      [attr.height]="p.plotHeight"
                    />
                  }
                  @for (t of p.ticks; track t.value) {
                    <line
                      [attr.x1]="left()"
                      [attr.x2]="width() - right()"
                      [attr.y1]="t.y"
                      [attr.y2]="t.y"
                      class="grid"
                    />
                    <text [attr.x]="left() - 6" [attr.y]="t.y + 4" text-anchor="end" class="tick">
                      {{ t.label }}
                    </text>
                  }
                  @if (p.isLast) {
                    @for (x of xLabels(); track x.date) {
                      <line
                        class="xtick"
                        [attr.x1]="x.x"
                        [attr.x2]="x.x"
                        [attr.y1]="p.top + p.plotHeight"
                        [attr.y2]="p.top + p.plotHeight + 4"
                      />
                      <text
                        [attr.x]="x.x"
                        [attr.y]="p.height - 8"
                        [attr.text-anchor]="x.anchor"
                        class="tick"
                        data-xtick
                        [attr.data-date]="x.date"
                      >
                        {{ x.text }}
                      </text>
                    }
                  }
                  @if (p.allZero) {
                    <text
                      class="zero-note"
                      data-zero
                      [attr.x]="(left() + width() - right()) / 2"
                      [attr.y]="p.top + p.plotHeight / 2 - 8"
                      text-anchor="middle"
                    >
                      Nothing to count in this period.
                    </text>
                  }
                  @for (l of p.drawn; track l.line.key) {
                    <polyline
                      class="series"
                      [attr.data-line]="l.line.key"
                      [attr.points]="l.solid"
                      [attr.stroke]="l.line.style.color"
                      [attr.stroke-dasharray]="l.line.style.dash || null"
                    />
                    @if (l.partial) {
                      <polyline
                        class="series partial"
                        [attr.points]="l.partial"
                        [attr.stroke]="l.line.style.color"
                      />
                    }
                    @for (m of l.markers; track m.i) {
                      <path
                        class="marker"
                        [attr.d]="m.d"
                        [attr.stroke]="l.line.style.color"
                        [attr.fill]="l.hollow ? 'var(--mf-surface)' : l.line.style.color"
                      />
                    }
                  }
                  @for (e of p.endLabels; track e.key) {
                    <g class="end-label" aria-hidden="true" [attr.data-end-label]="e.key">
                      <line
                        class="leader"
                        [attr.x1]="e.x"
                        [attr.y1]="e.py"
                        [attr.x2]="e.x + 7"
                        [attr.y2]="e.y"
                        [attr.stroke]="e.color"
                      />
                      <text class="label" [attr.x]="e.x + 9" [attr.y]="e.y + 4">{{ e.text }}</text>
                    </g>
                  }
                  @if (activePoint(); as a) {
                    <line
                      class="rule"
                      [attr.x1]="a.x"
                      [attr.x2]="a.x"
                      [attr.y1]="p.top"
                      [attr.y2]="p.top + p.plotHeight"
                    />
                    @for (m of a.marks[pi]; track m.key) {
                      <path
                        class="marker"
                        [attr.d]="m.d"
                        [attr.stroke]="m.color"
                        [attr.fill]="m.hollow ? 'var(--mf-surface)' : m.color"
                      />
                    }
                  }
                </svg>
                @if (activePoint(); as a) {
                  @if (pi === tipPanel()) {
                    <div
                      class="tip"
                      data-tip
                      [class.tip--left]="a.x > width() * 0.6"
                      [style.left.px]="a.x"
                    >
                      <strong data-tip-heading>{{ a.heading }}</strong>
                      @for (g of a.groups; track g.key) {
                        @if (a.groups.length > 1) {
                          <span class="tip-group">{{ g.title }}</span>
                        }
                        @if (g.note) {
                          <span class="tip-note">{{ g.note }}</span>
                        }
                        @for (r of g.rows; track r.key) {
                          <span class="tip-row">
                            <mf-trend-sample [style]="r.style" />
                            <span>{{ r.text }}</span>
                          </span>
                        }
                      }
                      @if (a.partial) {
                        <span class="tip-note">{{
                          weekly() ? 'This week so far' : 'Today so far'
                        }}</span>
                      }
                    </div>
                  }
                }
              </div>
            }
          </section>
        }
        <p class="sr-only" role="status" aria-live="polite" data-readout>{{ readout() }}</p>
      </div>
      <div class="foot">
        @if (partialToday()) {
          <span>{{ weekly() ? 'Dotted: this week so far.' : 'Dotted: today so far.' }}</span>
        }
        @if (hasWeekend()) {
          <span>Shaded: weekends.</span>
        }
        <span>{{
          weekly()
            ? 'Hover, tap or focus the chart to read a week.'
            : 'Hover, tap or focus the chart to read a day.'
        }}</span>
        @for (n of notes().shown; track n) {
          <span>{{ n }}</span>
        }
        @if (notes().more.length > 0) {
          <details class="more" data-more>
            <summary>How these are counted</summary>
            @for (n of notes().more; track n) {
              <p>{{ n }}</p>
            }
          </details>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .note {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    /* The drawing is measured and redrawn at its real size (1 user unit = 1 px), so the pointer position, the cursor line and the tooltip
       line up with the day under the mouse. */
    .plot {
      display: grid;
      gap: var(--mf-s3);
      border-radius: var(--mf-radius);
    }
    .panel {
      min-width: 0;
    }
    .panel-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s1) var(--mf-s3);
      margin-bottom: var(--mf-s1);
    }
    .panel-title {
      margin: 0;
      font-size: var(--mf-fs-md);
    }
    .ttl {
      display: inline-flex;
      align-items: baseline;
      gap: var(--mf-s2);
    }
    .per {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .panel-plot {
      position: relative;
    }
    /* Fixed-height Dashboard (#137, "fit"): the panels share the height the tab gives the chart (flows 1.6 : backlog 1, the 320 : 200 of
       the contract), each plot at least 160 px; the drawing is measured per panel and redrawn at that height. When the minimums do not fit
       the chart scrolls as a last resort. */
    :host(.fit) {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    :host(.fit) .plot {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
    }
    :host(.fit) .panel {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: auto;
    }
    :host(.fit) .panel--flows {
      flex-grow: 1.6;
    }
    :host(.fit) .panel-head {
      flex: none;
    }
    :host(.fit) .panel-plot {
      flex: 1 1 0;
      min-height: 160px;
    }
    :host(.fit) .chart {
      position: absolute;
      inset: 0;
      height: 100%;
    }
    :host(.fit) .foot {
      flex: none;
    }
    :host(.fit) .table-wrap {
      flex: 1 1 0;
      min-height: 0;
      max-height: none;
    }
    .tip-group {
      margin-top: 2px;
      font-weight: 600;
    }
    .zero-note {
      fill: var(--mf-text-muted);
      font-size: 13px;
    }
    .tip {
      position: absolute;
      top: 0;
      z-index: 1;
      display: grid;
      gap: 2px;
      padding: var(--mf-s1) var(--mf-s2);
      transform: translateX(8px);
      pointer-events: none;
      white-space: nowrap;
      font-size: var(--mf-fs-sm);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-1);
    }
    .tip--left {
      transform: translateX(calc(-100% - 8px));
    }
    .tip-note {
      color: var(--mf-text-muted);
    }
    .tip-row {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .foot p {
      margin: var(--mf-s1) 0 0;
    }
    .more[open] {
      flex-basis: 100%;
    }
    .more summary {
      cursor: pointer;
      color: var(--mf-link);
      text-decoration: underline;
    }
    .foot {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s3);
      margin: var(--mf-s2) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .weekend {
      fill: var(--mf-surface-alt);
      opacity: 0.7;
    }
    .rule {
      stroke: var(--mf-text-muted);
      stroke-width: 1;
    }
    .partial {
      stroke-dasharray: 1 6;
      stroke-width: 3;
    }
    .chart {
      display: block;
      width: 100%;
    }
    .grid {
      stroke: var(--mf-border);
      stroke-width: 1;
    }
    .tick {
      fill: var(--mf-text-muted);
      font-size: 12px;
    }
    .xtick {
      stroke: var(--mf-text-muted);
      stroke-width: 1;
    }
    .hover-band {
      fill: var(--mf-text-muted);
      opacity: 0.1;
    }
    .label {
      fill: var(--mf-text);
      font-size: 11px;
      font-weight: 600;
    }
    .leader {
      stroke-width: 1.5;
    }
    .series {
      fill: none;
      stroke-width: 2.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .marker {
      stroke-width: 1.8;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .table-wrap {
      max-height: 22rem;
      overflow: auto;
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
    thead th.group {
      text-align: center;
      border-bottom: 1px solid var(--mf-border-strong);
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      font-weight: 600;
      font-size: var(--mf-fs-sm);
      background: var(--mf-surface-alt);
    }
    tbody th {
      position: sticky;
      left: 0;
      white-space: nowrap;
      background: var(--mf-surface);
    }
    thead th:first-child {
      left: 0;
      z-index: 2;
    }
    .colhead {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      white-space: nowrap;
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .num .colhead {
      justify-content: flex-end;
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
})
export class TrendChart {
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Names the chart for the table and the screen reader. */
  readonly heading = input.required<string>();
  /** The local days, oldest first (`yyyy-MM-dd`); with `granularity` week the Monday of each week. */
  readonly dates = input.required<readonly string[]>();
  /** What a point is: a day, or a week (Monday to Sunday) for periods over 31 days. */
  readonly granularity = input<Granularity>('day');
  /** First and last day of the period (`yyyy-MM-dd`): the first and last week can be partial. Default: the first and last point. */
  readonly periodFrom = input<string | null>(null);
  readonly periodTo = input<string | null>(null);
  /** The panels to draw, top to bottom (the tab leaves the backlog panel out when it is hidden). */
  readonly panels = input.required<readonly PanelView[]>();
  readonly asTable = input(false);
  /** The panels fill the height of the host (the fixed-height Dashboard) instead of using their own 320 and 200 px. */
  readonly fit = input(false);
  /** Said when no panel has a line to draw. */
  readonly emptyText = input('Select a line in the list to draw it.');
  /** Said in a panel that has no line while another has. */
  readonly panelEmptyText = input<Partial<Record<PanelKey, string>>>({});
  /** The measure control of a panel, drawn in its header (context: the panel key). */
  readonly controls = input<TemplateRef<{ $implicit: PanelKey }> | null>(null);

  protected readonly id = `mf-trend-${nextId++}`;
  protected readonly weekly = computed(() => this.granularity() === 'week');
  protected readonly unit = computed(() => (this.weekly() ? 'Week' : 'Day'));
  /** Width of the drawing in px (measured). */
  protected readonly width = signal(DEFAULT_WIDTH);
  /** Measured height of each panel's plot area in px (only used while `fit`). */
  protected readonly measured = signal<Readonly<Record<string, number>>>({});
  private readonly plotEls = viewChildren<ElementRef<HTMLElement>>('pp');
  /** Index of the day shown in the tooltip (hover or arrow keys). */
  protected readonly active = signal<number | null>(null);
  /** The panel the pointer is in; the tooltip is drawn there (the keyboard uses the first). */
  protected readonly tipPanel = signal(0);
  /** What the polite live region says; only keyboard moves set it. */
  protected readonly readout = signal('');

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    // Measure once before the first paint so a phone never shows one frame drawn at the 640 px default (a layout shift, #121).
    afterNextRender({
      read: () => {
        const w = Math.round(host.getBoundingClientRect().width);
        if (w >= 120 && Math.abs(w - this.width()) >= 1) this.width.set(w);
      },
    });
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0]?.contentRect.width ?? 0);
        if (w >= 120 && Math.abs(w - this.width()) >= 1) this.width.set(w);
      });
      ro.observe(host);
      // The per-panel observer only exists while the chart fills the height of its tab (`fit`).
      let panelRo: ResizeObserver | null = null;
      effect(() => {
        const els = this.plotEls();
        const fit = this.fit();
        untracked(() => {
          panelRo?.disconnect();
          if (!fit) return;
          panelRo ??= new ResizeObserver((entries) => {
            const next = { ...this.measured() };
            let changed = false;
            for (const e of entries) {
              const key = (e.target as HTMLElement | undefined)?.dataset['panelPlot'];
              const h = Math.round(e.contentRect.height);
              if (key && h >= 60 && next[key] !== h) {
                next[key] = h;
                changed = true;
              }
            }
            if (changed) this.measured.set(next);
          });
          for (const el of els) panelRo.observe(el.nativeElement);
        });
      });
      inject(DestroyRef).onDestroy(() => {
        ro.disconnect();
        panelRo?.disconnect();
      });
    }
  }

  protected readonly allLines = computed(() => this.panels().flatMap((p) => p.lines));
  protected readonly hasLines = computed(() => this.allLines().length > 0);
  protected readonly groups = computed(() =>
    this.panels()
      .filter((p) => p.lines.length > 0)
      .map((p) => ({ key: p.key, title: p.title, count: p.lines.length })),
  );

  protected panelEmpty(key: PanelKey): string {
    return this.panelEmptyText()[key] ?? 'Select a line in the list to draw it.';
  }

  /** True when a panel names its lines at their last point: it has 4 or fewer lines. The room for the labels is the same in every panel (one x scale). */
  protected readonly labelsOn = computed(() =>
    this.panels().some((p) => p.lines.length > 0 && p.lines.length <= LABEL_MAX_LINES),
  );
  protected readonly right = computed(() => (this.labelsOn() ? LABEL_MARGIN : RIGHT));
  /** A phone: the panels are drawn 16:9 (and at least 220 px) at the full width. */
  protected readonly compact = computed(() => this.width() <= COMPACT_WIDTH);

  private panelHeight(panel: PanelView): number {
    if (this.fit()) return this.measured()[panel.key] ?? panel.height;
    if (!this.compact()) return panel.height;
    return panel.key === 'flows'
      ? Math.max(COMPACT_FLOWS_MIN, Math.round((this.width() * 9) / 16))
      : COMPACT_BACKLOG;
  }

  /** The axis labels' room: the widest tick label of any panel. */
  protected readonly left = computed(() => {
    const longest = Math.max(
      1,
      ...this.panels().map((p) => format(niceScale(peakOf(p.lines)).max).length),
    );
    return Math.max(34, 14 + longest * 7);
  });

  private x(index: number, count: number): number {
    const plot = this.width() - this.left() - this.right();
    return count <= 1 ? this.left() + plot / 2 : this.left() + (plot * index) / (count - 1);
  }

  /** The labels under the x axis: every Monday (week starts when the points are weeks), the first point and the last (see `xTicks`). */
  protected readonly xLabels = computed(() => {
    const pts = this.dates();
    return xTicks(
      pts,
      this.granularity(),
      (i) => this.x(i, pts.length),
      this.width() >= 600 ? 8 : 4,
    );
  });

  /** True when the last point holds today (in the viewer's zone), so the period ends now. */
  private readonly endsToday = computed(() => {
    const pts = this.dates();
    if (pts.length === 0) return false;
    const t = calendarDayInZone(this.clock.now(), this.zone);
    const today = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    return containsDay(pts[pts.length - 1], this.granularity(), today);
  });

  /** True when the last point is still filling up (today, or the current week): drawn dotted. */
  protected readonly partialToday = computed(() => this.dates().length >= 2 && this.endsToday());

  private readonly markerSet = computed(() => markerIndexes(this.dates().length));

  /** Everything drawn, per panel: axis, gridlines, weekend bands, the lines and their end labels in real pixels. */
  protected readonly geo = computed(() => {
    const pts = this.dates();
    const n = pts.length;
    const partial = this.partialToday();
    const idx = this.markerSet();
    const left = this.left();
    const w = this.width();
    const right = this.right();
    const step = n <= 1 ? w - left - right : (w - left - right) / (n - 1);
    const shown = this.panels();
    const lastDrawn = shown.reduce((acc, p, i) => (p.lines.length > 0 ? i : acc), -1);
    return shown.map((panel, pi) => {
      const isLast = pi === lastDrawn;
      const bottom = isLast ? BOTTOM_LAST : BOTTOM_OTHER;
      const height = this.panelHeight(panel);
      const plotHeight = height - TOP - bottom;
      const scale = niceScale(peakOf(panel.lines));
      const y = (value: number) => TOP + plotHeight * (1 - value / scale.max);
      const labelled = panel.lines.length > 0 && panel.lines.length <= LABEL_MAX_LINES;
      const ends = panel.lines.map((l) => y(l.values[n - 1] ?? 0));
      const spread = labelled ? nudgeLabels(ends, LABEL_MIN_GAP, TOP + 4, TOP + plotHeight) : [];
      return {
        key: panel.key,
        title: panel.title,
        lines: panel.lines,
        height,
        top: TOP,
        plotHeight,
        isLast,
        scale,
        allZero: panel.lines.every((l) => l.values.every((v) => v === 0)),
        ticks: scale.ticks.map((value) => ({ value, label: format(value), y: y(value) })),
        // Weekends are days: weekly points have no weekend to shade.
        weekendBands:
          this.granularity() === 'week'
            ? []
            : pts
                .map((date, i) => ({ date, cx: this.x(i, n) }))
                .filter((p) => isWeekend(p.date))
                .map((p) => {
                  const x = Math.max(left, p.cx - step / 2);
                  const edge = Math.min(w - right, p.cx + step / 2);
                  return { date: p.date, x: round(x), width: round(edge - x) };
                }),
        drawn: panel.lines.map((line) => {
          const points = line.values.map((v, i) => `${round(this.x(i, n))},${round(y(v))}`);
          return {
            line,
            hollow: isHollow(line.style.marker),
            solid: (partial ? points.slice(0, -1) : points).join(' '),
            partial: partial ? points.slice(-2).join(' ') : null,
            markers: idx.map((i) => ({
              i,
              d: markerPath(line.style.marker, this.x(i, n), y(line.values[i]), 3),
            })),
          };
        }),
        endLabels: labelled
          ? panel.lines.map((line, k) => ({
              key: line.key,
              color: line.style.color,
              x: round(this.x(n - 1, n) + 4),
              py: round(ends[k]),
              y: round(spread[k]),
              text: endLabelText(line.tipName ?? line.name, line.values[n - 1] ?? 0, LABEL_CHARS),
            }))
          : [],
        y,
      };
    });
  });

  protected readonly summary = computed(() => {
    const pts = this.dates();
    const weekly = this.weekly();
    const range =
      pts.length > 0
        ? `${weekly ? weekLabel(pts[0]) : shortDate(pts[0])} to ${weekly ? weekLabel(pts[pts.length - 1]) : shortDate(pts[pts.length - 1])}`
        : '';
    const parts = this.panels()
      .filter((p) => p.lines.length > 0)
      .map((panel) => {
        const items = panel.lines.map((l) => {
          const label = l.tipName ?? l.name;
          if (l.measure === 'overdue' || l.measure === 'open') {
            const now = l.values[l.values.length - 1] ?? 0;
            return l.tipName === null
              ? `${label} ${now} now`
              : `${label} ${now} ${l.valueWord || l.measure} now`;
          }
          return `${label} ${l.values.reduce((a, b) => a + b, 0)}${l.valueWord ? ' ' + l.valueWord : ''}`;
        });
        return this.panels().length > 1 ? `${panel.title}: ${items.join(', ')}` : items.join(', ');
      });
    return `${this.heading()}${weekly ? ', per week' : ''}, ${range}: ${parts.join('. ')}. Use View as table for each ${weekly ? 'week' : 'day'}.`;
  });

  /** Short remarks for the foot: what a day link lists and how Overdue and Open are counted. */
  protected readonly notes = computed(() => {
    const shown: string[] = [];
    const more: string[] = [];
    const measures = new Set(this.allLines().map((l) => l.measure));
    const overdueNote =
      "Overdue is counted at the end of each day, using each task's current due date.";
    if (this.weekly()) {
      shown.push(
        'Each point is a week, Monday to Sunday: counts are added up, Open and Overdue are the value at the end of the week.',
      );
    }
    if (measures.has('open')) {
      shown.push("Based on each task's creation and closing time; later changes are not replayed.");
      if (measures.has('overdue')) more.push(overdueNote);
    } else if (measures.has('overdue')) {
      shown.push(overdueNote);
    }
    for (const m of ['overdue', 'open', 'onTime'] as const) {
      const note = measures.has(m) || (m === 'onTime' && measures.has('late')) ? linkNote(m) : null;
      if (note && !more.includes(note)) more.push(note);
    }
    return { shown, more };
  });

  protected readonly hasWeekend = computed(() => !this.weekly() && this.dates().some(isWeekend));

  protected readonly activePoint = computed(() => {
    const i = this.active();
    const pts = this.dates();
    if (i === null || !pts[i]) return null;
    const n = pts.length;
    const geo = this.geo();
    const cx = this.x(i, n);
    const step =
      n <= 1
        ? this.width() - this.left() - this.right()
        : (this.width() - this.left() - this.right()) / (n - 1);
    const bandX = Math.max(this.left(), cx - step / 2);
    return {
      x: cx,
      bandX: round(bandX),
      bandWidth: round(Math.min(this.width() - this.right(), cx + step / 2) - bandX),
      heading: pointHeading(pts[i], this.granularity()),
      partial: this.partialToday() && i === n - 1,
      groups: this.groupsAt(i),
      marks: geo.map((g) =>
        g.lines.map((l) => ({
          key: l.key,
          d: markerPath(l.style.marker, this.x(i, n), g.y(l.values[i]), 5),
          color: l.style.color,
          hollow: isHollow(l.style.marker),
        })),
      ),
    };
  });

  /** The values of one day, grouped by panel (panels without a line are left out). */
  private groupsAt(i: number) {
    return this.panels()
      .filter((p) => p.lines.length > 0)
      .map((p) => ({
        key: p.key,
        title: p.title,
        note: p.measureNote,
        rows: p.lines.map((l) => ({
          key: l.key,
          style: l.style,
          text: `${l.tipName ? l.tipName + ' ' : ''}${l.values[i]}${l.valueWord ? ' ' + l.valueWord : ''}`,
        })),
      }));
  }

  protected onPointer(event: PointerEvent, panelIndex: number): void {
    const n = this.dates().length;
    if (n === 0) return;
    // Measure the drawing itself (not the surrounding box) so the day under the pointer is the one that is picked.
    const host = event.currentTarget as HTMLElement;
    const drawn = host.querySelector('svg')?.getBoundingClientRect();
    const box = drawn && drawn.width > 0 ? drawn : host.getBoundingClientRect();
    if (box.width <= 0) return;
    const x = ((event.clientX - box.left) / box.width) * this.width();
    const left = this.left();
    const index = Math.round(((x - left) / (this.width() - left - this.right())) * (n - 1));
    this.tipPanel.set(panelIndex);
    this.active.set(Math.max(0, Math.min(n - 1, index)));
  }

  /** A mouse leaving the plot hides the tooltip; a finger lifting after a tap does not (the tooltip stays until a tap elsewhere or Escape). */
  protected onLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
    this.clearActive();
  }

  /** A touch outside the chart dismisses a tooltip a tap opened. */
  protected onOutside(event: Event): void {
    if (this.active() === null) return;
    const target = event.target as Node | null;
    if (target && !this.hostEl.contains(target)) this.clearActive();
  }

  protected clearActive(): void {
    this.active.set(null);
    this.readout.set('');
  }

  protected onFocus(): void {
    this.tipPanel.set(0);
    if (this.active() === null) this.moveTo(this.dates().length - 1);
  }

  protected onKey(event: KeyboardEvent): void {
    // Keys typed in a control inside the chart (the measure control) are not ours.
    if (event.target !== event.currentTarget) return;
    const n = this.dates().length;
    const current = this.active() ?? n - 1;
    const target =
      event.key === 'ArrowLeft'
        ? current - 1
        : event.key === 'ArrowRight'
          ? current + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? n - 1
              : null;
    if (event.key === 'Escape') {
      this.clearActive();
      return;
    }
    if (target === null) return;
    event.preventDefault();
    this.moveTo(Math.max(0, Math.min(n - 1, target)));
  }

  private moveTo(index: number): void {
    const pts = this.dates();
    if (index < 0 || !pts[index]) return;
    this.active.set(index);
    const partial = this.partialToday() && index === pts.length - 1;
    const groups = this.groupsAt(index);
    const note = groups[0]?.note ?? null;
    const values = groups
      .map((g, gi) => {
        const text = g.rows.map((r) => r.text).join(', ');
        return gi === 0 ? text : `${g.title}: ${text}`;
      })
      .join('; ');
    this.readout.set(
      `${pointHeading(pts[index], this.granularity())}${note ? ', ' + note.toLowerCase() : ''}: ${values}${partial ? (this.weekly() ? ' (this week so far)' : ' (today so far)') : ''}.`,
    );
  }

  protected day(date: string): string {
    return this.weekly() ? weekLabel(date) : mfDate(date, this.zone, 'date');
  }

  /** The Task Queue query behind the count of a day, or of a week cut to the period (a stock: its value at the end of it). */
  protected dayParams(line: ChartLine, date: string, index: number) {
    const dates = this.dates();
    const range = bucketRange(
      date,
      this.granularity(),
      this.periodFrom() ?? dates[0],
      this.periodTo() ?? addDaysOfLast(dates, this.granularity()),
    );
    return queueParams(
      rangeQuery(line.measure, range, line.typeId, index === dates.length - 1 && this.endsToday()),
    );
  }
}

function peakOf(lines: readonly ChartLine[]): number {
  return Math.max(0, ...lines.flatMap((l) => l.values));
}

/** Axis labels in the viewer's number format (no decimals: the axes count tasks). */
function format(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function isWeekend(date: string): boolean {
  const weekday = weekdayOf(date);
  return weekday === 0 || weekday === 6;
}

/** The last day the points cover when the period is not given: the last day, or the Sunday of the last week. */
function addDaysOfLast(dates: readonly string[], granularity: Granularity): string {
  const last = dates[dates.length - 1] ?? '';
  return granularity === 'week' ? addDays(last, 6) : last;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
