import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import {
  MyMattersClient,
  MyMattersDeadlineDay,
  MyMattersTaskItem,
} from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, parseDateOnly } from '../../../core/time/time';
import { restoreRowFocus } from '../../../shared/ui/row-nav';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { dayHeading, dueDay } from '../facts';
import { MyMattersFocus } from '../focus';
import { MmTaskRow } from '../task-row';
import { MmDatesControl } from '../dates-control';
import { MmFilters, commonArgs, deadlineArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { CalendarToggle } from '../calendar-toggle';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

/** `yyyy-mm-dd` of today in the viewer's zone. */
export function todayText(clock: Clock, zone: string): string {
  const d = calendarDayInZone(clock.now(), zone);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** One cell of the calendar: a day of the window, or a blank before the first day of the first week. */
export interface CalendarCell {
  date: string | null;
  /** "26", or "Oct 26" for the first cell and the first of a month. */
  label: string;
  /** "Mon Oct 26" for the accessible names. */
  full: string;
  weekend: boolean;
  today: boolean;
  count: number;
  items: MyMattersTaskItem[];
  params: Params;
}

const SHOWN_PER_DAY = 3;
/** Below this width the calendar is the grouped list (README 6.2). */
const CALENDAR_MIN_PX = 480;

const BLANK: CalendarCell = {
  date: null,
  label: '',
  full: '',
  weekend: false,
  today: false,
  count: 0,
  items: [],
  params: {},
};

/**
 * The days of the window as week rows, Monday to Sunday: blanks pad the first week (the days before today are not in the window) and the last.
 * Pure, so it can be tested without a page.
 */
export function calendarWeeks(days: readonly MyMattersDeadlineDay[]): CalendarCell[][] {
  if (days.length === 0) return [];
  const monthDay = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const cells: CalendarCell[] = [];
  const first = new Date(`${days[0].date}T00:00:00Z`);
  for (let i = 0; i < (first.getUTCDay() + 6) % 7; i++) cells.push(BLANK);
  days.forEach((d, index) => {
    const at = new Date(`${d.date}T00:00:00Z`);
    const parsed = parseDateOnly(d.date);
    cells.push({
      date: d.date,
      label: index === 0 || at.getUTCDate() === 1 ? monthDay.format(at) : String(at.getUTCDate()),
      full: parsed ? dayHeading(parsed) : d.date,
      weekend: d.isWeekend,
      today: d.isToday,
      count: d.count,
      items: d.items,
      params: queryToParams(d.query),
    });
  });
  while (cells.length % 7 !== 0) cells.push(BLANK);
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * The Calendar of My Matters (epic #758 PX-20, and issue #929: the Deadlines tab is gone and the calendar lives on the Overview behind a Calendar button): the open work
 * due in the next two or four weeks, as a calendar of week rows. Every task opens the task; every day's count opens the Task Queue with the filters that count it.
 * Weekends are muted and today says "Today" in words. The calendar is a grid of links in tab order (no arrow-key grid, no shortcut); below 480 px it is the same
 * tasks as a list grouped by matter. The weeks are the page's date range (one state in the address). The component is its own lazy chunk, loaded when the calendar
 * is first shown, and "Show list" (the button in its heading) goes back to the grids.
 */
@Component({
  selector: 'mf-mm-calendar',
  imports: [CalendarToggle, MmDatesControl, MmTaskRow, PanelBox, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    PANEL_LIST_STYLES,
    `
      .dt__matter {
        margin: var(--mf-s3) 0 var(--mf-s1);
        font-size: var(--mf-fs-md);
        font-weight: 700;
      }
      .dt__matter a {
        color: var(--mf-link);
      }
      .dt__client {
        margin-left: var(--mf-s2);
        color: var(--mf-text-muted);
        font-weight: 400;
        font-size: var(--mf-fs-sm);
      }
      .dt__due {
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .dt__more {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        color: var(--mf-link);
      }
      .dt__note {
        margin: var(--mf-s2) 0 0;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .dc {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
      }
      .dc th {
        padding: var(--mf-s1);
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
        font-weight: 600;
        text-align: left;
      }
      .dc td {
        height: 6.5rem;
        padding: var(--mf-s1);
        border: 1px solid var(--mf-border);
        vertical-align: top;
        overflow: hidden;
      }
      .dc td.dc__blank {
        background: transparent;
        border-color: transparent;
      }
      .dc td.dc__weekend {
        background: var(--mf-surface-alt);
      }
      .dc td.dc__today {
        box-shadow: inset 0 0 0 2px var(--mf-primary);
      }
      .dc__head {
        display: flex;
        flex-wrap: wrap;
        gap: 0 var(--mf-s2);
        align-items: baseline;
        margin-bottom: 2px;
        font-size: var(--mf-fs-sm);
      }
      .dc__date {
        font-weight: 700;
      }
      .dc__weekend .dc__date {
        color: var(--mf-text-muted);
      }
      .dc__today-word {
        font-weight: 700;
        color: var(--mf-primary);
      }
      .dc__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        min-height: 24px;
        margin-left: auto;
        padding: 0 var(--mf-s1);
        border: 1px solid var(--mf-border);
        border-radius: var(--mf-radius);
        color: var(--mf-link);
        font-variant-numeric: tabular-nums;
      }
      .dc__items {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .dc__items a {
        display: block;
        overflow: hidden;
        color: var(--mf-link);
        font-size: var(--mf-fs-sm);
        line-height: 24px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 639.98px) {
        .dt__more {
          min-height: 44px;
        }
      }
    `,
  ],
  template: `
    <!-- The range control stays when the calendar is empty: a different range (a custom one) can show something. -->
    <mf-mm-dates [filters]="filters()" (filterChange)="filterChange.emit($event)" />
    <mf-mm-panel
      name="calendar"
      title="Calendar"
      [flat]="true"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      <span mfPanelActions class="dt__actions">
        <mf-mm-calendar-toggle [calendar]="true" (flip)="closed.emit()" />
      </span>
      @if (calendar()) {
        @if (total() === 0) {
          @if (filtered()) {
            <p class="pl__empty" data-empty data-filtered-empty>
              Nothing in your Focus is due in this period.
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-show-all
                (click)="focus.clear()"
              >
                Clear Focus
              </button>
            </p>
          } @else {
            <p class="pl__empty" data-empty>No deadlines in this period.</p>
          }
        } @else {
          <table class="dc" data-calendar>
            <caption class="mf-sr-only">
              Open tasks due each day,
              {{
                range()
              }}
            </caption>
            <thead>
              <tr>
                @for (w of weekdays; track w) {
                  <th scope="col">{{ w }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (week of weeks(); track $index) {
                <tr>
                  @for (c of week; track $index) {
                    @if (c.date === null) {
                      <td class="dc__blank"></td>
                    } @else {
                      <td
                        [class.dc__weekend]="c.weekend"
                        [class.dc__today]="c.today"
                        [attr.data-day]="c.date"
                      >
                        <div class="dc__head">
                          <span class="dc__date">{{ c.label }}</span>
                          @if (c.today) {
                            <span class="dc__today-word">Today</span>
                          }
                          @if (c.count > 0) {
                            <a
                              class="dc__count"
                              data-day-count
                              routerLink="/tasks"
                              [queryParams]="c.params"
                              [attr.aria-label]="
                                c.count + ' due ' + c.full + ', open in the Task Queue'
                              "
                              >{{ c.count }}</a
                            >
                          }
                        </div>
                        @if (c.items.length > 0) {
                          <ul class="dc__items">
                            @for (t of shownOf(c); track t.taskId) {
                              <li>
                                <a
                                  data-deadline-row
                                  [routerLink]="['/tasks', t.taskId]"
                                  [queryParams]="origin.params('my-matters')"
                                  [state]="origin.state()"
                                  [attr.title]="t.taskNumber + ' ' + t.title"
                                  >{{ t.title }}</a
                                >
                              </li>
                            }
                          </ul>
                          @if (c.count > shownPerDay) {
                            <a
                              class="dt__more"
                              data-day-more
                              routerLink="/tasks"
                              [queryParams]="c.params"
                              >+{{ c.count - shownPerDay }} more</a
                            >
                          }
                        }
                      </td>
                    }
                  }
                </tr>
              }
            </tbody>
          </table>
          <p class="dt__note">
            Each day's count opens the Task Queue with the tasks due that day. Weekends are shaded.
          </p>
        }
      } @else {
        @if (matters().length === 0) {
          @if (filtered()) {
            <p class="pl__empty" data-empty data-filtered-empty>
              Nothing in your Focus is due in this period.
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-show-all
                (click)="focus.clear()"
              >
                Clear Focus
              </button>
            </p>
          } @else {
            <p class="pl__empty" data-empty>No deadlines in this period.</p>
          }
        } @else {
          @for (m of matters(); track m.matterId) {
            <h3 class="dt__matter" data-matter-group>
              <a [routerLink]="['/matters', m.matterId]">{{ m.matterRef }} {{ m.matterName }}</a>
              <span class="pl__n">({{ m.total }})</span>
              <span class="dt__client">{{ m.clientName }}</span>
            </h3>
            <ul class="pl__list">
              @for (t of m.items; track t.taskId) {
                <li
                  mfMmTaskRow
                  kind="deadline"
                  rowScope="my-matters-deadlines-tab"
                  [task]="t"
                  [who]="t.assigneeName ?? 'Unassigned'"
                  [when]="due(t)"
                ></li>
              }
            </ul>
            @if (m.total > m.items.length) {
              <a
                class="dt__more"
                data-matter-more
                routerLink="/tasks"
                [queryParams]="paramsOf(m.query)"
                >All {{ m.total }} for this matter</a
              >
            }
          }
          @if (matterTotal() > matters().length) {
            <p class="dt__note" data-capped>
              Showing the {{ matters().length }} matters with the soonest deadlines, of
              {{ matterTotal() }}.
            </p>
          }
        }
      }
    </mf-mm-panel>
  `,
})
export class CalendarPanel {
  readonly filters = input.required<MmFilters>();
  readonly filterChange = output<Partial<MmFilters>>();
  /** "Show list" was pressed: the page goes back to the grids. */
  readonly closed = output<void>();

  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly wide = viewportAtLeast(CALENDAR_MIN_PX);

  protected readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  protected readonly shownPerDay = SHOWN_PER_DAY;
  /** The calendar when the window is wide enough; a phone gets the same tasks as a list grouped by matter. */
  protected readonly calendar = computed(() => this.wide());

  protected readonly focus = inject(MyMattersFocus);
  /** The person's Focus filters the calendar (the one task-type filter of the page, issue #907). */
  protected readonly filtered = computed(() => this.focus.types().length > 0);

  protected readonly loader = panelLoader(
    () => [this.filters(), this.calendar(), this.focus.types()],
    () => {
      const f = this.filters();
      const a = commonArgs(f);
      const types = this.focus.types();
      const d = deadlineArgs(f, todayText(this.clock, this.zone));
      return this.api.getMyMattersDeadlines(
        d.days,
        this.calendar() ? 'day' : 'matter',
        types.length > 0 ? types : undefined,
        undefined,
        undefined,
        a.scope,
        a.role,
        a.clientId,
        d.from,
        d.to,
        a.managerId,
      );
    },
  );

  constructor() {
    this.focus.ensure();
    restoreRowFocus('my-matters-deadlines-tab', () => this.loader.state() === 'ready');
  }

  protected readonly weeks = computed(() => calendarWeeks(this.loader.data()?.byDay ?? []));
  protected readonly matters = computed(() => this.loader.data()?.byMatter ?? []);
  protected readonly matterTotal = computed(() => this.loader.data()?.matterTotal ?? 0);
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);
  protected readonly range = computed(() => {
    const d = this.loader.data();
    return d ? `from ${d.fromDate} to ${d.toDate}` : '';
  });

  protected shownOf(c: CalendarCell): MyMattersTaskItem[] {
    return c.items.slice(0, SHOWN_PER_DAY);
  }

  protected paramsOf(query: string): Params {
    return queryToParams(query);
  }

  /** "Mon Oct 26" for a task's due day (the instant's day in the viewer's zone when it has a time). */
  protected due(t: MyMattersTaskItem): string {
    const day = dueDay(t, this.zone);
    return day ? dayHeading(day) : 'No date';
  }
}
