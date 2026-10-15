import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, mfDate, parseDateOnly } from '../../../core/time/time';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { queueParams } from '../dashboard-links';
import { TrendSample } from './trend-sample';
import { ChartLine, dayQuery, isHollow, linkNote, markerPath } from './trend-model';

const W = 360;
const H = 190;
const LEFT = 32;
const RIGHT = 10;
const TOP = 12;
const BOTTOM = 30;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Up to this many days every day has a point marker; beyond it only about eight evenly spaced ones are drawn. */
const MARKER_LIMIT = 31;
const SPARSE_MARKERS = 8;

let nextId = 0;

/** The next "round" number at or above `value` (1, 2, 5, 10, 20, 50 ...), so the axis ends on a readable tick. */
export function niceMax(value: number): number {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

function shortDay(date: string): string {
  const d = parseDateOnly(date);
  return d ? `${MONTHS[d.month - 1]} ${d.day}` : date;
}

/**
 * The daily lines of the Trends tab (UX `mf-trend-chart`): a small SVG line chart with no chart library. Every line differs by colour, dash
 * pattern and marker shape (the legend next to it is the control and shows the same samples), the tooltip and the live read-out list the
 * values of every visible line for the hovered or focused day, and "View as table" gives one column per visible line with a link from each
 * day's count to the Task Queue. Operational counts only.
 */
@Component({
  selector: 'mf-trend-chart',
  imports: [RouterLink, TrendSample, TaskTypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lines().length === 0) {
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
            <tr>
              <th scope="col">Day</th>
              @for (l of lines(); track l.key) {
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
                @for (l of lines(); track l.key) {
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
        (pointermove)="onPointer($event)"
        (pointerleave)="clearActive()"
        (focus)="onFocus()"
        (blur)="clearActive()"
        (keydown)="onKey($event)"
      >
        <svg class="chart" [attr.viewBox]="'0 0 ' + w + ' ' + h" aria-hidden="true">
          @for (b of weekendBands(); track b.date) {
            <rect
              class="weekend"
              [attr.x]="b.x"
              [attr.y]="top0"
              [attr.width]="b.width"
              [attr.height]="plotHeight"
            />
          }
          @for (t of ticks(); track t.value) {
            <line
              [attr.x1]="left"
              [attr.x2]="w - right"
              [attr.y1]="t.y"
              [attr.y2]="t.y"
              class="grid"
            />
            <text [attr.x]="left - 6" [attr.y]="t.y + 4" text-anchor="end" class="tick">
              {{ t.value }}
            </text>
          }
          @for (x of xLabels(); track x.date) {
            <text [attr.x]="x.x" [attr.y]="h - 10" [attr.text-anchor]="x.anchor" class="tick">
              {{ x.text }}
            </text>
          }
          @for (l of drawn(); track l.line.key) {
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
              [attr.y1]="top0"
              [attr.y2]="top0 + plotHeight"
            />
            @for (m of a.marks; track m.key) {
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
          <div
            class="tip"
            data-tip
            [class.tip--left]="a.x > w * 0.6"
            [style.left.%]="(a.x / w) * 100"
          >
            <strong>{{ a.heading }}</strong>
            @if (measureNote(); as note) {
              <span class="tip-note">{{ note }}</span>
            }
            @for (r of a.rows; track r.key) {
              <span class="tip-row">
                <mf-trend-sample [style]="r.style" />
                <span>{{ r.text }}</span>
              </span>
            }
            @if (a.partial) {
              <span class="tip-note">Today so far</span>
            }
          </div>
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
    /* The plot box is exactly as wide as the drawing (same aspect ratio as the viewBox), so the pointer position, the cursor line and the
       tooltip (all in percent of this box) line up with the day under the mouse. A wider box letterboxed the SVG and shifted them. */
    .plot {
      position: relative;
      width: 100%;
      max-width: calc(22rem * 360 / 190);
      margin-inline: auto;
      border-radius: var(--mf-radius);
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
      height: auto;
      max-height: 22rem;
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

  readonly heading = input.required<string>();
  /** The local days, oldest first (`yyyy-MM-dd`). */
  readonly dates = input.required<readonly string[]>();
  readonly lines = input.required<readonly ChartLine[]>();
  readonly asTable = input(false);
  /** Said under the day in the tooltip when every line shows the same measure ("Created"). */
  readonly measureNote = input<string | null>(null);
  readonly emptyText = input('Select a line in the legend to draw it.');

  protected readonly id = `mf-trend-${nextId++}`;
  protected readonly w = W;
  protected readonly h = H;
  protected readonly left = LEFT;
  protected readonly right = RIGHT;
  protected readonly top0 = TOP;
  protected readonly plotHeight = H - TOP - BOTTOM;
  /** Index of the day shown in the tooltip (hover or arrow keys). */
  protected readonly active = signal<number | null>(null);
  /** What the polite live region says; only keyboard moves set it. */
  protected readonly readout = signal('');

  private readonly top = computed(() =>
    niceMax(Math.max(1, ...this.lines().flatMap((l) => l.values))),
  );

  private y(value: number): number {
    return TOP + (H - TOP - BOTTOM) * (1 - value / this.top());
  }

  private x(index: number, count: number): number {
    const plot = W - LEFT - RIGHT;
    return count <= 1 ? LEFT + plot / 2 : LEFT + (plot * index) / (count - 1);
  }

  protected readonly ticks = computed(() => {
    const top = this.top();
    const values = top >= 2 && top % 2 === 0 ? [0, top / 2, top] : [0, top];
    return values.map((value) => ({ value, y: this.y(value) }));
  });

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

  protected readonly drawn = computed(() => {
    const n = this.dates().length;
    const partial = this.partialToday();
    const idx = this.markerIndexes();
    return this.lines().map((line) => {
      const pts = line.values.map((v, i) => `${round(this.x(i, n))},${round(this.y(v))}`);
      const hollow = isHollow(line.style.marker);
      return {
        line,
        hollow,
        solid: (partial ? pts.slice(0, -1) : pts).join(' '),
        partial: partial ? pts.slice(-2).join(' ') : null,
        markers: idx.map((i) => ({
          i,
          d: markerPath(line.style.marker, this.x(i, n), this.y(line.values[i]), 3),
        })),
      };
    });
  });

  protected readonly summary = computed(() => {
    const pts = this.dates();
    const range = pts.length > 0 ? `${shortDay(pts[0])} to ${shortDay(pts[pts.length - 1])}` : '';
    const parts = this.lines().map((l) => {
      const label = l.tipName ?? l.name;
      if (l.measure === 'overdue') {
        return `${label} ${l.values[l.values.length - 1] ?? 0} overdue now`;
      }
      return `${label} ${l.values.reduce((a, b) => a + b, 0)}${l.valueWord ? ' ' + l.valueWord : ''}`;
    });
    return `${this.heading()}, ${range}: ${parts.join(', ')}. Use View as table for each day.`;
  });

  /** Short remarks for the foot: what a day link lists and how Overdue is counted. */
  protected readonly notes = computed(() => {
    const out: string[] = [];
    const measures = new Set(this.lines().map((l) => l.measure));
    if (measures.has('overdue')) {
      out.push("Overdue is counted at the end of each day, using each task's current due date.");
    }
    for (const m of ['overdue', 'onTime'] as const) {
      const note = measures.has(m) || (m === 'onTime' && measures.has('late')) ? linkNote(m) : null;
      if (note && !out.includes(note)) out.push(note);
    }
    return out;
  });

  private readonly isWeekendDay = (date: string) => isWeekend(date);
  protected readonly weekendBands = computed(() => {
    const pts = this.dates();
    const n = pts.length;
    const step = n <= 1 ? W - LEFT - RIGHT : (W - LEFT - RIGHT) / (n - 1);
    return pts
      .map((date, i) => ({ date, cx: this.x(i, n) }))
      .filter((p) => this.isWeekendDay(p.date))
      .map((p) => {
        const x = Math.max(LEFT, p.cx - step / 2);
        const right = Math.min(W - RIGHT, p.cx + step / 2);
        return { date: p.date, x: round(x), width: round(right - x) };
      });
  });
  protected readonly hasWeekend = computed(() => this.weekendBands().length > 0);

  protected readonly activePoint = computed(() => {
    const i = this.active();
    const pts = this.dates();
    if (i === null || !pts[i]) return null;
    const n = pts.length;
    return {
      x: this.x(i, n),
      heading: dayHeading(pts[i]),
      partial: this.partialToday() && i === n - 1,
      rows: this.rowsAt(i),
      marks: this.lines().map((l) => ({
        key: l.key,
        d: markerPath(l.style.marker, this.x(i, n), this.y(l.values[i]), 5),
        color: l.style.color,
        hollow: isHollow(l.style.marker),
      })),
    };
  });

  private rowsAt(i: number) {
    return this.lines().map((l) => ({
      key: l.key,
      style: l.style,
      text: `${l.tipName ? l.tipName + ' ' : ''}${l.values[i]}${l.valueWord ? ' ' + l.valueWord : ''}`,
    }));
  }

  protected onPointer(event: PointerEvent): void {
    const n = this.dates().length;
    if (n === 0) return;
    // Measure the drawing itself (not the surrounding box) so the day under the pointer is the one that is picked.
    const host = event.currentTarget as HTMLElement;
    const drawn = host.querySelector('svg')?.getBoundingClientRect();
    const box = drawn && drawn.width > 0 ? drawn : host.getBoundingClientRect();
    if (box.width <= 0) return;
    const x = ((event.clientX - box.left) / box.width) * W;
    const index = Math.round(((x - LEFT) / (W - LEFT - RIGHT)) * (n - 1));
    this.active.set(Math.max(0, Math.min(n - 1, index)));
  }

  protected clearActive(): void {
    this.active.set(null);
    this.readout.set('');
  }

  protected onFocus(): void {
    if (this.active() === null) this.moveTo(this.dates().length - 1);
  }

  protected onKey(event: KeyboardEvent): void {
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
    const note = this.measureNote();
    const values = this.rowsAt(index)
      .map((r) => r.text)
      .join(', ');
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
