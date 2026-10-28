import { toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { MyMattersClient } from '../../../api/generated/api-client';
import { parseDateOnly } from '../../../core/time/time';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { dayHeading } from '../facts';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { Segmented } from '../../../shared/ui/segmented';
import { PanelBox } from '../panels/panel-box';

export const TREND_WEEKS = [8, 12, 26] as const;
export type TrendWeeks = (typeof TREND_WEEKS)[number];
/** Below this width a chart is too small to read: the table takes its place (README 6.4). */
const CHART_MIN_PX = 480;

const W = 600;
const H = 160;
const LEFT = 36;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 28;

/** A round top for an axis: 4 for 3, 10 for 8, 120 for 101. At least 4, so an almost empty chart still has a scale. */
export function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= n) ?? 10;
  return step * pow;
}

/** The x position of the centre of week `i` of `count`. */
export function weekX(i: number, count: number): number {
  const width = W - LEFT - RIGHT;
  return LEFT + (width * (i + 0.5)) / Math.max(1, count);
}

/** The y position of a value on a 0..max axis. */
export function valueY(v: number, max: number): number {
  return TOP + (H - TOP - BOTTOM) * (1 - v / max);
}

/** The points of a line chart as an SVG `points` string. */
export function linePoints(values: readonly number[], max: number): string {
  return values
    .map((v, i) => `${weekX(i, values.length).toFixed(1)},${valueY(v, max).toFixed(1)}`)
    .join(' ');
}

/** "Aug 31" for a week's Monday. */
export function weekLabel(date: string): string {
  const d = parseDateOnly(date);
  return d ? dayHeading(d).slice(4) : date;
}

const LIMITATIONS: Record<string, string> = {
  CURRENT_DUE_DATES: 'A task that was re-dated is counted by its current due date.',
  CURRENT_STATUS:
    'A task that was re-opened is counted by its current status and last status change.',
  CURRENT_MATTER_SET: 'The matters are those in scope now, with their tasks of all times.',
};

/** The sentence for a limitation code the API sends (an unknown code is shown as it is, so nothing is hidden). */
export function limitationText(code: string): string {
  return LIMITATIONS[code] ?? code;
}

/**
 * Trends tab (epic #758, PX-22; README 6.4): four small pictures of the last 8, 12 or 26 weeks on my matters: overdue at the end of each week (line),
 * created and closed per week (paired bars), the average age of open tasks and the tasks on hold (figures). Every chart has a one-sentence summary
 * and a table of the same numbers ("Show as table"; below 480 px the table replaces the chart). Colour is never the only signal: the line has
 * marks and a value label, the bars differ by fill and by hatching, and a legend names them. The figures are approximate (the schema keeps no history
 * of due dates or statuses): the limitation is on the screen and "How is this counted?" opens the definitions. The chart code is this tab's own chunk.
 */
@Component({
  selector: 'mf-mm-trends-tab',
  imports: [PanelBox, RouterLink, Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .tr__approx-line {
      cursor: pointer;
    }
    .tr__approx {
      margin: 0 0 var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
    }
    .tr__approx ul {
      margin: var(--mf-s1) 0 0;
      padding-left: var(--mf-s4);
    }
    .tr__grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s3);
    }
    .tr__fig {
      margin: 0;
      min-width: 0;
    }
    .tr__title {
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .tr__sum {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .tr__svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .tr__axis {
      stroke: var(--mf-border);
      stroke-width: 1;
    }
    .tr__text {
      fill: var(--mf-text-muted);
      font-size: 11px;
    }
    .tr__value {
      fill: var(--mf-text);
      font-size: 12px;
      font-weight: 700;
    }
    .tr__line {
      fill: none;
      stroke: var(--mf-primary);
      stroke-width: 2.5;
    }
    .tr__dot {
      fill: var(--mf-surface);
      stroke: var(--mf-primary);
      stroke-width: 2;
    }
    .tr__bar-created {
      fill: var(--mf-primary);
    }
    .tr__bar-closed {
      stroke: var(--mf-primary);
      stroke-width: 1.5;
    }
    .tr__legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s4);
      margin: var(--mf-s1) 0 0;
      padding: 0;
      list-style: none;
      font-size: var(--mf-fs-sm);
    }
    .tr__swatch {
      display: inline-block;
      width: 14px;
      height: 14px;
      margin-right: var(--mf-s1);
      vertical-align: -2px;
      border: 1.5px solid var(--mf-primary);
    }
    .tr__swatch--created {
      background: var(--mf-primary);
    }
    .tr__swatch--closed {
      background: repeating-linear-gradient(45deg, var(--mf-primary) 0 2px, transparent 2px 5px);
    }
    .tr__big {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .tr__more {
      min-height: 24px;
      margin: var(--mf-s2) 0 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
    }
    .tr__table {
      width: 100%;
      margin-top: var(--mf-s2);
      border-collapse: collapse;
      font-size: var(--mf-fs-sm);
    }
    .tr__table th,
    .tr__table td {
      padding: 2px var(--mf-s2);
      border-top: 1px solid var(--mf-border);
      text-align: left;
    }
    .tr__table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .tr__link {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      color: var(--mf-link);
    }
    .tr__how {
      margin-top: var(--mf-s4);
      font-size: var(--mf-fs-sm);
    }
    .tr__how summary {
      min-height: 24px;
      cursor: pointer;
      color: var(--mf-link);
    }
    .tr__how dl {
      margin: var(--mf-s2) 0 0;
    }
    .tr__how dt {
      font-weight: 700;
    }
    .tr__how dd {
      margin: 0 0 var(--mf-s2);
    }
    .tr__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }
    @media (max-width: 767.98px) {
      .tr__grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    @media (max-width: 639.98px) {
      .tr__toggle .mf-btn,
      .tr__more,
      .tr__link,
      .tr__how summary {
        min-height: 44px;
      }
    }
  `,
  template: `
    <mf-mm-panel
      name="trends"
      title="Trends"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      <div mfPanelActions mfSegmented role="group" aria-label="Weeks shown">
        @for (w of weekChoices; track w) {
          <button
            type="button"
            class="mf-btn"
            [attr.data-weeks]="w"
            [attr.aria-pressed]="weeks() === w"
            (click)="setWeeks(w)"
          >
            {{ w }} weeks
          </button>
        }
      </div>
      @if (data(); as d) {
        <details class="tr__approx" data-approximate>
          <summary class="tr__approx-line">
            <strong>Approximate.</strong> Worked out from today's data, not recorded week by week.
          </summary>
          <ul data-limitations>
            @for (code of d.limitations; track code) {
              <li>{{ limitation(code) }}</li>
            }
          </ul>
        </details>
        <div class="tr__grid">
          <figure class="tr__fig" data-chart="overdue">
            <h3 class="tr__title">Overdue at week end</h3>
            <p class="tr__sum" data-summary>{{ overdueSummary() }}</p>
            @if (chartOn()) {
              <svg
                class="tr__svg"
                [attr.viewBox]="'0 0 ' + w + ' ' + h"
                role="img"
                [attr.aria-label]="overdueSummary()"
                data-svg
              >
                <line
                  class="tr__axis"
                  [attr.x1]="left"
                  [attr.x2]="w - right"
                  [attr.y1]="baseY"
                  [attr.y2]="baseY"
                />
                @for (tick of overdueTicks(); track tick.value) {
                  <line
                    class="tr__axis"
                    [attr.x1]="left"
                    [attr.x2]="w - right"
                    [attr.y1]="tick.y"
                    [attr.y2]="tick.y"
                  />
                  <text
                    class="tr__text"
                    [attr.x]="left - 6"
                    [attr.y]="tick.y + 4"
                    text-anchor="end"
                  >
                    {{ tick.value }}
                  </text>
                }
                <polyline class="tr__line" [attr.points]="overdueLine()" />
                @for (p of overduePoints(); track p.key) {
                  <circle class="tr__dot" [attr.cx]="p.x" [attr.cy]="p.y" r="3.5" />
                }
                <text
                  class="tr__value"
                  [attr.x]="lastOverdue().x"
                  [attr.y]="lastOverdue().y - 9"
                  text-anchor="end"
                >
                  {{ lastOverdue().value }}
                </text>
                @for (l of xLabels(); track l.key) {
                  <text
                    class="tr__text"
                    [attr.x]="l.x"
                    [attr.y]="h - 8"
                    [attr.text-anchor]="l.anchor"
                  >
                    {{ l.text }}
                  </text>
                }
              </svg>
              <button
                type="button"
                class="tr__more"
                data-show-table
                aria-controls="tr-table-overdue"
                [attr.aria-expanded]="tableOn('overdue')"
                (click)="toggleTable('overdue')"
              >
                {{ tableOn('overdue') ? 'Hide table' : 'Show as table' }}
              </button>
            }
            @if (tableOn('overdue')) {
              <table class="tr__table" id="tr-table-overdue" data-table="overdue">
                <caption class="mf-sr-only">
                  Overdue tasks at the end of each week
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Week of</th>
                    <th scope="col" class="num">Overdue at week end</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of points(); track p.weekStart) {
                    <tr>
                      <th scope="row">
                        {{ label(p.weekStart) }}{{ p.isCurrent ? ' (this week)' : '' }}
                      </th>
                      <td class="num">{{ p.overdueAtWeekEnd }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </figure>

          <figure class="tr__fig" data-chart="flow">
            <h3 class="tr__title">Created and closed per week</h3>
            <p class="tr__sum" data-summary>{{ flowSummary() }}</p>
            @if (chartOn()) {
              <svg
                class="tr__svg"
                [attr.viewBox]="'0 0 ' + w + ' ' + h"
                role="img"
                [attr.aria-label]="flowSummary()"
                data-svg
              >
                <defs>
                  <pattern
                    id="tr-hatch"
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width="6" height="6" style="fill: var(--mf-surface)" />
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="6"
                      style="stroke: var(--mf-primary)"
                      stroke-width="2.5"
                    />
                  </pattern>
                </defs>
                <line
                  class="tr__axis"
                  [attr.x1]="left"
                  [attr.x2]="w - right"
                  [attr.y1]="baseY"
                  [attr.y2]="baseY"
                />
                @for (tick of flowTicks(); track tick.value) {
                  <line
                    class="tr__axis"
                    [attr.x1]="left"
                    [attr.x2]="w - right"
                    [attr.y1]="tick.y"
                    [attr.y2]="tick.y"
                  />
                  <text
                    class="tr__text"
                    [attr.x]="left - 6"
                    [attr.y]="tick.y + 4"
                    text-anchor="end"
                  >
                    {{ tick.value }}
                  </text>
                }
                @for (b of bars(); track b.key) {
                  <rect
                    class="tr__bar-created"
                    [attr.x]="b.x1"
                    [attr.y]="b.y1"
                    [attr.width]="b.width"
                    [attr.height]="b.h1"
                  />
                  <rect
                    class="tr__bar-closed"
                    fill="url(#tr-hatch)"
                    [attr.x]="b.x2"
                    [attr.y]="b.y2"
                    [attr.width]="b.width"
                    [attr.height]="b.h2"
                  />
                }
                @for (l of xLabels(); track l.key) {
                  <text
                    class="tr__text"
                    [attr.x]="l.x"
                    [attr.y]="h - 8"
                    [attr.text-anchor]="l.anchor"
                  >
                    {{ l.text }}
                  </text>
                }
              </svg>
              <ul class="tr__legend" data-legend>
                <li>
                  <span class="tr__swatch tr__swatch--created" aria-hidden="true"></span>Created
                </li>
                <li>
                  <span class="tr__swatch tr__swatch--closed" aria-hidden="true"></span>Closed
                  (hatched)
                </li>
              </ul>
              <button
                type="button"
                class="tr__more"
                data-show-table
                aria-controls="tr-table-flow"
                [attr.aria-expanded]="tableOn('flow')"
                (click)="toggleTable('flow')"
              >
                {{ tableOn('flow') ? 'Hide table' : 'Show as table' }}
              </button>
            }
            @if (tableOn('flow')) {
              <table class="tr__table" id="tr-table-flow" data-table="flow">
                <caption class="mf-sr-only">
                  Tasks created and closed in each week
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Week of</th>
                    <th scope="col" class="num">Created</th>
                    <th scope="col" class="num">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of points(); track p.weekStart) {
                    <tr>
                      <th scope="row">
                        {{ label(p.weekStart) }}{{ p.isCurrent ? ' (this week)' : '' }}
                      </th>
                      <td class="num">
                        <a
                          class="tr__link"
                          routerLink="/tasks"
                          [queryParams]="params(p.createdQuery)"
                          >{{ p.created }}</a
                        >
                      </td>
                      <td class="num">
                        <a
                          class="tr__link"
                          routerLink="/tasks"
                          [queryParams]="params(p.closedQuery)"
                          >{{ p.closed }}</a
                        >
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </figure>

          <figure class="tr__fig" data-chart="age">
            <h3 class="tr__title">Average age of open tasks</h3>
            <p class="tr__big" data-age>{{ ageText() }}</p>
            <p class="tr__sum" data-summary>{{ ageSummary() }}</p>
            <a class="tr__link" routerLink="/tasks" [queryParams]="params(d.now.openQuery)"
              >Open the {{ d.now.open }} open tasks</a
            >
          </figure>

          <figure class="tr__fig" data-chart="hold">
            <h3 class="tr__title">On hold</h3>
            <p class="tr__big" data-hold>{{ d.now.onHold }}</p>
            <p class="tr__sum" data-summary>{{ holdSummary() }}</p>
            <a class="tr__link" routerLink="/tasks" [queryParams]="params(d.now.onHoldQuery)"
              >Open the tasks on hold</a
            >
          </figure>
        </div>
        <details class="tr__how" data-how>
          <summary>How is this counted?</summary>
          <dl>
            <dt>Weeks</dt>
            <dd>Monday to Sunday in your time zone. The last week is this week so far.</dd>
            <dt>Overdue at week end</dt>
            <dd>
              Tasks that were open at the end of the week (now, for this week) with a due date
              before it.
            </dd>
            <dt>Created and closed</dt>
            <dd>Created is the day a task was created. Closed is the day it was completed.</dd>
            <dt>Average age</dt>
            <dd>Today minus the creation day of each open task, averaged.</dd>
            <dt>On hold</dt>
            <dd>Tasks on hold now, and how long the longest-waiting one has been on hold.</dd>
            <dt>What is approximate</dt>
            <dd>
              @for (code of d.limitations; track code) {
                {{ limitation(code) }}
              }
            </dd>
          </dl>
        </details>
      } @else {
        <p class="tr__empty" data-empty>No data for these matters.</p>
      }
    </mf-mm-panel>
  `,
})
export class TrendsTab {
  readonly filters = input.required<MmFilters>();

  private readonly api = inject(MyMattersClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly wide = viewportAtLeast(CHART_MIN_PX);
  protected readonly weekChoices = TREND_WEEKS;
  protected readonly w = W;
  protected readonly h = H;
  protected readonly left = LEFT;
  protected readonly right = RIGHT;
  protected readonly baseY = H - BOTTOM;
  protected readonly label = weekLabel;
  protected readonly limitation = limitationText;
  private readonly tables = signal<ReadonlySet<string>>(new Set());

  /** `?weeks=8|12|26` (12 when absent). */
  protected readonly weeks = computed<TrendWeeks>(() => {
    const n = Number(this.query().get('weeks'));
    return (TREND_WEEKS as readonly number[]).includes(n) ? (n as TrendWeeks) : 12;
  });

  protected readonly loader = panelLoader(
    () => [this.filters(), this.weeks()],
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersTrends(
        this.weeks(),
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  protected readonly data = computed(() => this.loader.data());
  protected readonly points = computed(() => this.data()?.points ?? []);

  protected setWeeks(weeks: TrendWeeks): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { weeks: weeks === 12 ? null : weeks },
      queryParamsHandling: 'merge',
    });
  }

  /** The chart is drawn when the window is wide enough; otherwise only its table is there. */
  protected chartOn(): boolean {
    return this.wide();
  }

  protected tableOn(key: string): boolean {
    return !this.wide() || this.tables().has(key);
  }

  protected toggleTable(key: string): void {
    const next = new Set(this.tables());
    if (!next.delete(key)) next.add(key);
    this.tables.set(next);
  }

  protected params(query: string): Params {
    return queryToParams(query);
  }

  // ---- overdue line

  private readonly overdueValues = computed(() => this.points().map((p) => p.overdueAtWeekEnd));
  private readonly overdueMax = computed(() => niceMax(Math.max(0, ...this.overdueValues())));
  protected readonly overdueLine = computed(() =>
    linePoints(this.overdueValues(), this.overdueMax()),
  );
  protected readonly overduePoints = computed(() =>
    this.points().map((p, i, all) => ({
      key: p.weekStart,
      x: weekX(i, all.length),
      y: valueY(p.overdueAtWeekEnd, this.overdueMax()),
    })),
  );
  protected readonly lastOverdue = computed(() => {
    const all = this.points();
    const last = all[all.length - 1];
    return {
      x: weekX(all.length - 1, all.length),
      y: valueY(last?.overdueAtWeekEnd ?? 0, this.overdueMax()),
      value: last?.overdueAtWeekEnd ?? 0,
    };
  });
  protected readonly overdueTicks = computed(() => ticks(this.overdueMax()));

  // ---- created and closed

  private readonly flowMax = computed(() =>
    niceMax(Math.max(0, ...this.points().flatMap((p) => [p.created, p.closed]))),
  );
  protected readonly flowTicks = computed(() => ticks(this.flowMax()));
  protected readonly bars = computed(() => {
    const all = this.points();
    const slot = (W - LEFT - RIGHT) / Math.max(1, all.length);
    const width = Math.max(2, Math.min(18, slot / 2 - 2));
    const base = H - BOTTOM;
    return all.map((p, i) => {
      const centre = weekX(i, all.length);
      const y1 = valueY(p.created, this.flowMax());
      const y2 = valueY(p.closed, this.flowMax());
      return {
        key: p.weekStart,
        width,
        x1: centre - width - 1,
        x2: centre + 1,
        y1,
        y2,
        h1: base - y1,
        h2: base - y2,
      };
    });
  });

  protected readonly xLabels = computed(() => {
    const all = this.points();
    if (all.length === 0) return [];
    const picks = [0, Math.floor((all.length - 1) / 2), all.length - 1];
    return picks.map((i, n) => ({
      key: all[i].weekStart,
      x: weekX(i, all.length),
      text: weekLabel(all[i].weekStart),
      anchor: n === 0 ? 'start' : n === 2 ? 'end' : 'middle',
    }));
  });

  // ---- the sentences (also the charts' accessible names)

  protected readonly overdueSummary = computed(() => {
    const all = this.points();
    if (all.length === 0) return 'No weeks to show.';
    const first = all[0];
    const last = all[all.length - 1];
    const top = all.reduce((a, b) => (b.overdueAtWeekEnd > a.overdueAtWeekEnd ? b : a), first);
    return `Overdue tasks at the end of the week: ${first.overdueAtWeekEnd} in the week of ${weekLabel(first.weekStart)}, ${last.overdueAtWeekEnd} this week, highest ${top.overdueAtWeekEnd} in the week of ${weekLabel(top.weekStart)}.`;
  });

  protected readonly flowSummary = computed(() => {
    const all = this.points();
    if (all.length === 0) return 'No weeks to show.';
    const created = all.reduce((n, p) => n + p.created, 0);
    const closed = all.reduce((n, p) => n + p.closed, 0);
    const last = all[all.length - 1];
    return `In ${all.length} weeks ${created} tasks were created and ${closed} closed. This week so far: ${last.created} created, ${last.closed} closed.`;
  });

  protected readonly ageText = computed(() => {
    const age = this.data()?.now.averageAgeDays;
    return age === undefined || age === null ? 'No open tasks' : `${age.toFixed(1)} days`;
  });

  protected readonly ageSummary = computed(() => {
    const now = this.data()?.now;
    if (!now) return '';
    return now.averageAgeDays === undefined || now.averageAgeDays === null
      ? 'There are no open tasks on these matters.'
      : `The ${now.open} open tasks were created ${now.averageAgeDays.toFixed(1)} days ago on average (approximate).`;
  });

  protected readonly holdSummary = computed(() => {
    const now = this.data()?.now;
    if (!now) return '';
    return now.onHold === 0
      ? 'Nothing is on hold.'
      : `${now.onHold} on hold now${now.oldestOnHoldDays != null ? `, the longest for ${now.oldestOnHoldDays} days` : ''}.`;
  });
}

function ticks(max: number): { value: number; y: number }[] {
  return [max / 2, max].map((value) => ({ value, y: valueY(value, max) }));
}
