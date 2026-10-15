import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardTrendPoint } from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, mfDate, parseDateOnly } from '../../../core/time/time';
import { queueParams } from '../dashboard-links';

const W = 360;
const H = 190;
const LEFT = 32;
const RIGHT = 10;
const TOP = 12;
const BOTTOM = 30;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Above this many days the lines are drawn without point markers. */
const MARKER_LIMIT = 31;

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
 * Daily Created and Completed for the period (UX `mf-trend-chart`): a small SVG line chart with no chart library. The two series differ
 * by line style and marker shape as well as colour, the legend names them with their totals (links to the Task Queue), and "View as
 * table" lists every day with the same numbers, each count a link to that day's tasks. Operational counts only.
 */
@Component({
  selector: 'mf-trend-chart',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-labelledby]="id + '-h'">
      <header>
        <h3 [id]="id + '-h'">{{ heading() }}</h3>
        @if (hasData()) {
          <button type="button" class="toggle" [attr.aria-pressed]="asTable()" (click)="toggle()">
            {{ asTable() ? 'View as chart' : 'View as table'
            }}<span class="sr-only"> for {{ heading() }}</span>
          </button>
        }
      </header>
      @if (caption(); as c) {
        <p class="note">{{ c }}</p>
      }
      @if (!hasData()) {
        <p class="note" data-empty>No tasks were created or completed in this period.</p>
      } @else {
        <ul class="legend">
          <li>
            <a routerLink="/tasks" [queryParams]="createdParams()" data-legend="created">
              <svg width="28" height="10" aria-hidden="true">
                <line x1="1" y1="5" x2="27" y2="5" class="s-created" />
                <circle cx="14" cy="5" r="3.5" class="m-created" />
              </svg>
              Created <strong>{{ totalCreated() }}</strong>
            </a>
          </li>
          <li>
            <a routerLink="/tasks" [queryParams]="completedParams()" data-legend="completed">
              <svg width="28" height="10" aria-hidden="true">
                <line x1="1" y1="5" x2="27" y2="5" class="s-completed" />
                <rect x="10.5" y="1.5" width="7" height="7" class="m-completed" />
              </svg>
              Completed <strong>{{ totalCompleted() }}</strong>
            </a>
          </li>
        </ul>
        @if (asTable()) {
          <div class="mf-scroll table-wrap">
            <table>
              <caption class="sr-only">
                {{
                  heading()
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" class="num">Created</th>
                  <th scope="col" class="num">Completed</th>
                </tr>
              </thead>
              <tbody>
                @for (p of points(); track p.date) {
                  <tr>
                    <th scope="row">{{ day(p.date) }}</th>
                    <td class="num">
                      @if (p.created > 0) {
                        <a routerLink="/tasks" [queryParams]="createdDay(p.date)">{{
                          p.created
                        }}</a>
                      } @else {
                        0
                      }
                    </td>
                    <td class="num">
                      @if (p.completed > 0) {
                        <a routerLink="/tasks" [queryParams]="completedDay(p.date)">{{
                          p.completed
                        }}</a>
                      } @else {
                        0
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
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
              <polyline class="s-created" [attr.points]="line('created')" />
              <polyline class="s-completed" [attr.points]="line('completed')" />
              @if (partialToday()) {
                <polyline class="s-created partial" [attr.points]="partialLine('created')" />
                <polyline class="s-completed partial" [attr.points]="partialLine('completed')" />
              }
              @if (markers()) {
                @for (p of coords(); track p.date) {
                  <circle [attr.cx]="p.x" [attr.cy]="p.yCreated" r="3" class="m-created" />
                  <rect
                    [attr.x]="p.x - 3"
                    [attr.y]="p.yCompleted - 3"
                    width="6"
                    height="6"
                    class="m-completed"
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
                <circle [attr.cx]="a.x" [attr.cy]="a.yCreated" r="5" class="m-created" />
                <rect
                  [attr.x]="a.x - 5"
                  [attr.y]="a.yCompleted - 5"
                  width="10"
                  height="10"
                  class="m-completed"
                />
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
                <span>{{ a.created }} created</span>
                <span>{{ a.completed }} completed</span>
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
          </p>
        }
      }
    </section>
  `,
  styles: `
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
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
    }
    .legend a {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      color: var(--mf-text);
      text-decoration: none;
    }
    .legend a:hover {
      text-decoration: underline;
    }
    .plot {
      position: relative;
      border-radius: var(--mf-radius);
    }
    .tip {
      position: absolute;
      top: 0;
      z-index: 1;
      display: grid;
      gap: 1px;
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
      max-height: 18rem;
    }
    .grid {
      stroke: var(--mf-border);
      stroke-width: 1;
    }
    .tick {
      fill: var(--mf-text-muted);
      font-size: 11px;
    }
    .s-created,
    .s-completed {
      fill: none;
      stroke-width: 2.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .s-created {
      stroke: var(--mf-primary);
    }
    .s-completed {
      stroke: var(--mf-st-progress-fg);
      stroke-dasharray: 7 4;
    }
    .m-created {
      fill: var(--mf-primary);
      stroke: var(--mf-surface);
      stroke-width: 1;
    }
    .m-completed {
      fill: var(--mf-surface);
      stroke: var(--mf-st-progress-fg);
      stroke-width: 2;
    }
    .table-wrap {
      max-height: 18rem;
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
})
export class TrendChart {
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);

  readonly heading = input.required<string>();
  readonly points = input.required<readonly DashboardTrendPoint[]>();
  /** Task Queue query of all Created / Completed in the period (the totals in the legend link here). */
  readonly createdQuery = input.required<string>();
  readonly completedQuery = input.required<string>();
  readonly caption = input<string | null>(null);

  protected readonly id = `mf-trend-${nextId++}`;
  protected readonly asTable = signal(false);
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

  protected readonly totalCreated = computed(() =>
    this.points().reduce((sum, p) => sum + p.created, 0),
  );
  protected readonly totalCompleted = computed(() =>
    this.points().reduce((sum, p) => sum + p.completed, 0),
  );
  protected readonly hasData = computed(() => this.totalCreated() + this.totalCompleted() > 0);
  protected readonly createdParams = computed(() => queueParams(this.createdQuery()));
  protected readonly completedParams = computed(() => queueParams(this.completedQuery()));
  protected readonly markers = computed(() => this.points().length <= MARKER_LIMIT);

  private readonly top = computed(() =>
    niceMax(Math.max(1, ...this.points().flatMap((p) => [p.created, p.completed]))),
  );

  private y(value: number): number {
    return TOP + (H - TOP - BOTTOM) * (1 - value / this.top());
  }

  private x(index: number, count: number): number {
    const plot = W - LEFT - RIGHT;
    return count <= 1 ? LEFT + plot / 2 : LEFT + (plot * index) / (count - 1);
  }

  protected readonly coords = computed(() => {
    const pts = this.points();
    return pts.map((p, i) => ({
      date: p.date,
      x: this.x(i, pts.length),
      yCreated: this.y(p.created),
      yCompleted: this.y(p.completed),
    }));
  });

  protected readonly ticks = computed(() => {
    const top = this.top();
    const values = top >= 2 ? [0, top / 2, top] : [0, top];
    return values.map((value) => ({ value, y: this.y(value) }));
  });

  protected readonly xLabels = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return [];
    const picks =
      pts.length === 1
        ? [0]
        : pts.length < 5
          ? [0, pts.length - 1]
          : [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
    return picks.map((i, n) => ({
      date: pts[i].date,
      text: shortDay(pts[i].date),
      x: this.x(i, pts.length),
      anchor:
        n === 0 && picks.length > 1
          ? 'start'
          : n === picks.length - 1 && picks.length > 1
            ? 'end'
            : 'middle',
    }));
  });

  protected readonly summary = computed(() => {
    const pts = this.points();
    const range =
      pts.length > 0 ? `${shortDay(pts[0].date)} to ${shortDay(pts[pts.length - 1].date)}` : '';
    return `Tasks created and completed per day, ${range}: ${this.totalCreated()} created, ${this.totalCompleted()} completed. Use View as table for each day.`;
  });

  /** True when the last day of the series is today in the viewer's zone: a partial day, drawn dotted. */
  protected readonly partialToday = computed(() => {
    const pts = this.points();
    if (pts.length < 2) return false;
    const t = calendarDayInZone(this.clock.now(), this.zone);
    const today = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    return pts[pts.length - 1].date === today;
  });

  private readonly step = computed(() => {
    const n = this.points().length;
    return n <= 1 ? W - LEFT - RIGHT : (W - LEFT - RIGHT) / (n - 1);
  });

  protected readonly weekendBands = computed(() => {
    const step = this.step();
    return this.coords()
      .filter((p) => isWeekend(p.date))
      .map((p) => {
        const x = Math.max(LEFT, p.x - step / 2);
        const right = Math.min(W - RIGHT, p.x + step / 2);
        return { date: p.date, x: round(x), width: round(right - x) };
      });
  });
  protected readonly hasWeekend = computed(() => this.weekendBands().length > 0);

  protected readonly activePoint = computed(() => {
    const i = this.active();
    const pts = this.points();
    const c = this.coords();
    if (i === null || !pts[i]) return null;
    return {
      ...c[i],
      created: pts[i].created,
      completed: pts[i].completed,
      heading: dayHeading(pts[i].date),
      partial: this.partialToday() && i === pts.length - 1,
    };
  });

  protected onPointer(event: PointerEvent): void {
    const n = this.points().length;
    if (n === 0) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
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
    if (this.active() === null) this.moveTo(this.points().length - 1, true);
  }

  protected onKey(event: KeyboardEvent): void {
    const n = this.points().length;
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
    this.moveTo(Math.max(0, Math.min(n - 1, target)), true);
  }

  private moveTo(index: number, announce: boolean): void {
    if (index < 0) return;
    this.active.set(index);
    const p = this.points()[index];
    if (announce && p) {
      const partial = this.partialToday() && index === this.points().length - 1;
      this.readout.set(
        `${dayHeading(p.date)}: ${p.created} created, ${p.completed} completed${partial ? ' (today so far)' : ''}.`,
      );
    }
  }

  protected partialLine(series: 'created' | 'completed'): string {
    return this.coords()
      .slice(-2)
      .map((p) => `${round(p.x)},${round(series === 'created' ? p.yCreated : p.yCompleted)}`)
      .join(' ');
  }

  protected line(series: 'created' | 'completed'): string {
    const all = this.coords();
    return (this.partialToday() ? all.slice(0, -1) : all)
      .map((p) => `${round(p.x)},${round(series === 'created' ? p.yCreated : p.yCompleted)}`)
      .join(' ');
  }

  protected day(date: string): string {
    return mfDate(date, this.zone, 'date');
  }

  protected createdDay(date: string) {
    return queueParams(`createdFrom=${date}&createdTo=${date}`);
  }

  protected completedDay(date: string) {
    return queueParams(`status=COMPLETED&completedFrom=${date}&completedTo=${date}`);
  }

  protected toggle(): void {
    this.asTable.update((v) => !v);
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
