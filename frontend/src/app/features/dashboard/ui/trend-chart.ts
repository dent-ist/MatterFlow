import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, mfDate, parseDateOnly } from '../../../core/time/time';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { queueParams } from '../dashboard-links';
import { TrendSample } from './trend-sample';
import {
  ChartLine,
  PanelKey,
  PanelView,
  dayQuery,
  isHollow,
  linkNote,
  markerPath,
  niceScale,
} from './trend-model';

export { niceMax } from './trend-model';

const DEFAULT_WIDTH = 640;
const RIGHT = 14;
const TOP = 12;
/** Room under the last panel for the day labels; the panels above it only need a little. */
const BOTTOM_LAST = 30;
const BOTTOM_OTHER = 8;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Up to this many days every day has a point marker; beyond it only about eight evenly spaced ones are drawn. */
const MARKER_LIMIT = 31;
const SPARSE_MARKERS = 8;

let nextId = 0;

function shortDay(date: string): string {
  const d = parseDateOnly(date);
  return d ? `${MONTHS[d.month - 1]} ${d.day}` : date;
}

/**
 * The daily lines of the Trends tab (UX `mf-trend-chart`): one or two stacked SVG line panels (flows, backlog) with no chart library. The
 * panels share one x scale and one cursor, each has its own y axis (`niceScale`). The drawing is measured (ResizeObserver) and redrawn at
 * its real pixel size. Every line differs by colour, dash pattern and marker shape (the list next to it is the control and shows the same
 * samples), the tooltip and the live read-out list the values of every visible line of both panels for the hovered or focused day, grouped
 * by panel, and "View as table" gives one column per visible line with a group header per panel and a link from each day's count to the
 * Task Queue. Operational counts only.
 *
 * The tab passes a `controls` template (the measure control of a panel) which is drawn in each panel's header.
 */
@Component({
  selector: 'mf-trend-chart',
  imports: [RouterLink, NgTemplateOutlet, TrendSample, TaskTypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
                <th scope="col" rowspan="2">Day</th>
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
                <th scope="col">Day</th>
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
                      <a routerLink="/tasks" [queryParams]="dayParams(l, date)">{{
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
      @if (notes().length > 0) {
        <p class="foot">
          @for (n of notes(); track n) {
            <span>{{ n }}</span>
          }
        </p>
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
          <section class="panel" [attr.data-panel]="p.key">
            <div class="panel-head">
              <h4 class="panel-title">{{ p.title }}</h4>
              @if (controls(); as tpl) {
                <ng-container *ngTemplateOutlet="tpl; context: { $implicit: p.key }" />
              }
            </div>
            @if (p.lines.length === 0) {
              <p class="note" data-panel-empty>{{ panelEmpty(p.key) }}</p>
            } @else {
              <div
                class="panel-plot"
                (pointermove)="onPointer($event, pi)"
                (pointerleave)="clearActive()"
              >
                <svg
                  class="chart"
                  [attr.viewBox]="'0 0 ' + width() + ' ' + p.height"
                  [style.height.px]="p.height"
                  aria-hidden="true"
                >
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
                      [attr.x2]="width() - right"
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
                      <text
                        [attr.x]="x.x"
                        [attr.y]="p.height - 10"
                        [attr.text-anchor]="x.anchor"
                        class="tick"
                      >
                        {{ x.text }}
                      </text>
                    }
                  }
                  @if (p.allZero) {
                    <text
                      class="zero-note"
                      data-zero
                      [attr.x]="(left() + width() - right) / 2"
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
                      <strong>{{ a.heading }}</strong>
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
                        <span class="tip-note">Today so far</span>
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
      <p class="foot">
        @if (partialToday()) {
          <span>Dotted: today so far.</span>
        }
        @if (hasWeekend()) {
          <span>Shaded: weekends.</span>
        }
        <span>Hover or focus the chart to read a day.</span>
        @for (n of notes(); track n) {
          <span>{{ n }}</span>
        }
      </p>
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
    .panel-plot {
      position: relative;
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
      font-size: 11px;
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

  /** Names the chart for the table and the screen reader. */
  readonly heading = input.required<string>();
  /** The local days, oldest first (`yyyy-MM-dd`). */
  readonly dates = input.required<readonly string[]>();
  /** The panels to draw, top to bottom (the tab leaves the backlog panel out when it is hidden). */
  readonly panels = input.required<readonly PanelView[]>();
  readonly asTable = input(false);
  /** Said when no panel has a line to draw. */
  readonly emptyText = input('Select a line in the list to draw it.');
  /** Said in a panel that has no line while another has. */
  readonly panelEmptyText = input<Partial<Record<PanelKey, string>>>({});
  /** The measure control of a panel, drawn in its header (context: the panel key). */
  readonly controls = input<TemplateRef<{ $implicit: PanelKey }> | null>(null);

  protected readonly id = `mf-trend-${nextId++}`;
  protected readonly right = RIGHT;
  /** Width of the drawing in px (measured). */
  protected readonly width = signal(DEFAULT_WIDTH);
  /** Index of the day shown in the tooltip (hover or arrow keys). */
  protected readonly active = signal<number | null>(null);
  /** The panel the pointer is in; the tooltip is drawn there (the keyboard uses the first). */
  protected readonly tipPanel = signal(0);
  /** What the polite live region says; only keyboard moves set it. */
  protected readonly readout = signal('');

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0]?.contentRect.width ?? 0);
        if (w >= 120 && Math.abs(w - this.width()) >= 1) this.width.set(w);
      });
      ro.observe(host);
      inject(DestroyRef).onDestroy(() => ro.disconnect());
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

  /** The axis labels' room: the widest tick label of any panel. */
  protected readonly left = computed(() => {
    const longest = Math.max(
      1,
      ...this.panels().map((p) => format(niceScale(peakOf(p.lines)).max).length),
    );
    return Math.max(34, 14 + longest * 7);
  });

  private x(index: number, count: number): number {
    const plot = this.width() - this.left() - RIGHT;
    return count <= 1 ? this.left() + plot / 2 : this.left() + (plot * index) / (count - 1);
  }

  protected readonly xLabels = computed(() => {
    const pts = this.dates();
    if (pts.length === 0) return [];
    const picks =
      pts.length === 1
        ? [0]
        : pts.length < 5
          ? [0, pts.length - 1]
          : [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    return picks.map((i, n) => ({
      date: pts[i],
      text: shortDay(pts[i]),
      x: this.x(i, pts.length),
      anchor:
        n === 0 && picks.length > 1
          ? 'start'
          : n === picks.length - 1 && picks.length > 1
            ? 'end'
            : 'middle',
    }));
  });

  /** True when the last day of the series is today in the viewer's zone: a partial day, drawn dotted. */
  protected readonly partialToday = computed(() => {
    const pts = this.dates();
    if (pts.length < 2) return false;
    const t = calendarDayInZone(this.clock.now(), this.zone);
    const today = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    return pts[pts.length - 1] === today;
  });

  private readonly markerIndexes = computed(() => {
    const n = this.dates().length;
    if (n <= MARKER_LIMIT) return Array.from({ length: n }, (_, i) => i);
    const picks = new Set<number>();
    for (let i = 0; i < SPARSE_MARKERS; i++)
      picks.add(Math.round((i * (n - 1)) / (SPARSE_MARKERS - 1)));
    return [...picks];
  });

  /** Everything drawn, per panel: axis, gridlines, weekend bands and the lines in real pixels. */
  protected readonly geo = computed(() => {
    const pts = this.dates();
    const n = pts.length;
    const partial = this.partialToday();
    const idx = this.markerIndexes();
    const left = this.left();
    const w = this.width();
    const step = n <= 1 ? w - left - RIGHT : (w - left - RIGHT) / (n - 1);
    const shown = this.panels();
    const lastDrawn = shown.reduce((acc, p, i) => (p.lines.length > 0 ? i : acc), -1);
    return shown.map((panel, pi) => {
      const isLast = pi === lastDrawn;
      const bottom = isLast ? BOTTOM_LAST : BOTTOM_OTHER;
      const plotHeight = panel.height - TOP - bottom;
      const scale = niceScale(peakOf(panel.lines));
      const y = (value: number) => TOP + plotHeight * (1 - value / scale.max);
      return {
        key: panel.key,
        title: panel.title,
        lines: panel.lines,
        height: panel.height,
        top: TOP,
        plotHeight,
        isLast,
        scale,
        allZero: panel.lines.every((l) => l.values.every((v) => v === 0)),
        ticks: scale.ticks.map((value) => ({ value, label: format(value), y: y(value) })),
        weekendBands: pts
          .map((date, i) => ({ date, cx: this.x(i, n) }))
          .filter((p) => isWeekend(p.date))
          .map((p) => {
            const x = Math.max(left, p.cx - step / 2);
            const right = Math.min(w - RIGHT, p.cx + step / 2);
            return { date: p.date, x: round(x), width: round(right - x) };
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
        y,
      };
    });
  });

  protected readonly summary = computed(() => {
    const pts = this.dates();
    const range = pts.length > 0 ? `${shortDay(pts[0])} to ${shortDay(pts[pts.length - 1])}` : '';
    const parts = this.panels()
      .filter((p) => p.lines.length > 0)
      .map((panel) => {
        const items = panel.lines.map((l) => {
          const label = l.tipName ?? l.name;
          if (l.measure === 'overdue') {
            return `${label} ${l.values[l.values.length - 1] ?? 0} overdue now`;
          }
          return `${label} ${l.values.reduce((a, b) => a + b, 0)}${l.valueWord ? ' ' + l.valueWord : ''}`;
        });
        return this.panels().length > 1 ? `${panel.title}: ${items.join(', ')}` : items.join(', ');
      });
    return `${this.heading()}, ${range}: ${parts.join('. ')}. Use View as table for each day.`;
  });

  /** Short remarks for the foot: what a day link lists and how Overdue is counted. */
  protected readonly notes = computed(() => {
    const out: string[] = [];
    const measures = new Set(this.allLines().map((l) => l.measure));
    if (measures.has('overdue')) {
      out.push("Overdue is counted at the end of each day, using each task's current due date.");
    }
    for (const m of ['overdue', 'onTime'] as const) {
      const note = measures.has(m) || (m === 'onTime' && measures.has('late')) ? linkNote(m) : null;
      if (note && !out.includes(note)) out.push(note);
    }
    return out;
  });

  protected readonly hasWeekend = computed(() => this.dates().some(isWeekend));

  protected readonly activePoint = computed(() => {
    const i = this.active();
    const pts = this.dates();
    if (i === null || !pts[i]) return null;
    const n = pts.length;
    const geo = this.geo();
    return {
      x: this.x(i, n),
      heading: dayHeading(pts[i]),
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
    const index = Math.round(((x - left) / (this.width() - left - RIGHT)) * (n - 1));
    this.tipPanel.set(panelIndex);
    this.active.set(Math.max(0, Math.min(n - 1, index)));
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
      `${dayHeading(pts[index])}${note ? ', ' + note.toLowerCase() : ''}: ${values}${partial ? ' (today so far)' : ''}.`,
    );
  }

  protected day(date: string): string {
    return mfDate(date, this.zone, 'date');
  }

  protected dayParams(line: ChartLine, date: string) {
    const dates = this.dates();
    return queueParams(dayQuery(line.measure, date, line.typeId, date === dates[dates.length - 1]));
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
  const d = parseDateOnly(date);
  if (!d) return false;
  const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** "Tue, Oct 13" */
function dayHeading(date: string): string {
  const d = parseDateOnly(date);
  if (!d) return date;
  const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday]}, ${MONTHS[d.month - 1]} ${d.day}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
