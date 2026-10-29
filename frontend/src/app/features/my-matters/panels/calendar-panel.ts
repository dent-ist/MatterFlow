import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import {
  MyMattersClient,
  MyMattersDeadlineDay,
  MyMattersTaskItem,
} from '../../../api/generated/api-client';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { parseDateOnly } from '../../../core/time/time';
import { restoreRowFocus } from '../../../shared/ui/row-nav';
import { ScrollRegion } from '../../../shared/ui/scroll-region';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { dayHeading } from '../facts';
import { MyMattersFocus } from '../focus';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { CalendarToggle } from '../calendar-toggle';
import { monthOf, monthTitle, shiftMonth, todayText } from '../calendar-month';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

/** One cell of the month: a day, or a blank before the first day / after the last. */
export interface CalendarCell {
  date: string | null;
  /** "26". */
  label: string;
  /** "Mon Oct 26" for the accessible names. */
  full: string;
  weekend: boolean;
  today: boolean;
  count: number;
  /** How many of the day's tasks are overdue (of the ones listed). */
  overdue: number;
  items: MyMattersTaskItem[];
  params: Params;
}

const SHOWN_PER_DAY = 3;
/** Below this width the month is a list by day (README 6.2). */
const CALENDAR_MIN_PX = 480;
const OVERDUE_FACT = 'OVERDUE';

const BLANK: CalendarCell = {
  date: null,
  label: '',
  full: '',
  weekend: false,
  today: false,
  count: 0,
  overdue: 0,
  items: [],
  params: {},
};

export const isOverdueItem = (t: Pick<MyMattersTaskItem, 'factCode'>): boolean =>
  t.factCode === OVERDUE_FACT;

/** The days of a month as week rows, Monday to Sunday: blanks pad the first and the last week. Pure, so it can be tested without a page. */
export function monthWeeks(days: readonly MyMattersDeadlineDay[]): CalendarCell[][] {
  if (days.length === 0) return [];
  const cells: CalendarCell[] = [];
  const first = new Date(`${days[0].date}T00:00:00Z`);
  for (let i = 0; i < (first.getUTCDay() + 6) % 7; i++) cells.push(BLANK);
  for (const d of days) {
    const parsed = parseDateOnly(d.date);
    cells.push({
      date: d.date,
      label: String(new Date(`${d.date}T00:00:00Z`).getUTCDate()),
      full: parsed ? dayHeading(parsed) : d.date,
      weekend: d.isWeekend,
      today: d.isToday,
      count: d.count,
      overdue: d.items.filter(isOverdueItem).length,
      items: d.items,
      params: queryToParams(d.query),
    });
  }
  while (cells.length % 7 !== 0) cells.push(BLANK);
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * The Calendar of My Matters (epic #893 issue #944): ONE MONTH like a normal calendar, with the month's name, Previous and Next buttons and a Today button back to the
 * current month; the month is in the address (`?month=yyyy-mm`) and loaded from the server one month at a time. It shows the open tasks due each day, with the page's Client,
 * Matter and Role, the pre-filter and the Focus applied. A task that is overdue carries a warning icon and the word "Overdue" (for screen readers and as its tooltip; the
 * icon is never the only signal) on its own due date, in past months too. A busy day shows its first three tasks and "+N more", which opens the day's tasks in the Task
 * Queue. The month is an ARIA grid with ONE tab stop: arrows move between days, Home and End go to the ends of the week, Page Up and Page Down to the other months, Enter on a
 * day moves into its tasks (Up and Down between them, Enter opens one, Escape back to the day). These are the keys of the control only, no shortcut of the page (#420).
 * Below 480 px it is the same month as a list by day. The component is its own lazy chunk; "Show list" (the button in its heading) goes back to the grid of tasks.
 */
@Component({
  selector: 'mf-mm-calendar',
  imports: [CalendarToggle, PanelBox, RouterLink, ScrollRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styles: [
    PANEL_LIST_STYLES,
    `
      .cal__nav {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--mf-s2);
      }
      .cal__nav .mf-btn {
        min-width: max(32px, var(--mf-options-h, 32px));
        min-height: max(32px, var(--mf-options-h, 32px));
        padding-inline: var(--mf-s2);
      }
      .cal__month {
        min-width: 8.5rem;
        font-size: var(--mf-fs-md);
        font-weight: 700;
        text-align: center;
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
      .dc td[data-day]:focus-visible {
        outline: 2px solid var(--mf-focus);
        outline-offset: -2px;
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
      .dc__items {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .dc__items a,
      .dt__more {
        display: flex;
        align-items: center;
        gap: var(--mf-s1);
        min-height: 24px;
        overflow: hidden;
        color: var(--mf-link);
        font-size: var(--mf-fs-sm);
        line-height: 24px;
        white-space: nowrap;
      }
      .dc__title {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dc__items a:focus-visible,
      .dt__more:focus-visible {
        outline: 2px solid var(--mf-focus);
        outline-offset: -2px;
      }
      /* The overdue mark: a warning icon in the danger colour and the word (hidden visually in the grid cell, spoken by screen readers, the tooltip of the entry). */
      .cal__late {
        flex: none;
        color: var(--mf-danger);
      }
      .cal__late-word {
        color: var(--mf-danger);
        font-weight: 600;
      }
      .cal__day {
        margin: var(--mf-s3) 0 var(--mf-s1);
        font-size: var(--mf-fs-md);
        font-weight: 700;
      }
      .cal__list {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cal__list li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--mf-s1) var(--mf-s2);
        min-height: 44px;
        border-top: 1px solid var(--mf-border);
      }
      .cal__list a {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        color: var(--mf-link);
      }
      .cal__matter {
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      @media (max-width: 639.98px) {
        .cal__nav .mf-btn {
          min-width: 44px;
          min-height: 44px;
        }
        .dt__more {
          min-height: 44px;
        }
      }
    `,
  ],
  template: `
    <mf-mm-panel
      name="calendar"
      title="Calendar"
      [fill]="true"
      [flat]="true"
      [startAlways]="true"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      <!-- The month's buttons stay while the month is on its way or failed: the person can still move on. -->
      <span mfPanelStart class="cal__nav" role="group" aria-label="Month">
        <button
          type="button"
          class="mf-btn"
          data-cal-prev
          [attr.aria-label]="'Previous month, ' + title(previous())"
          (click)="monthChange.emit(previous())"
        >
          <i class="pi pi-chevron-left" aria-hidden="true"></i>
        </button>
        <span class="cal__month" data-cal-month role="status">{{ title(shown()) }}</span>
        <button
          type="button"
          class="mf-btn"
          data-cal-next
          [attr.aria-label]="'Next month, ' + title(next())"
          (click)="monthChange.emit(next())"
        >
          <i class="pi pi-chevron-right" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="mf-btn"
          data-cal-today
          [disabled]="isCurrent()"
          (click)="monthChange.emit(null)"
        >
          Today
        </button>
      </span>
      <span mfPanelActions class="dt__actions">
        <mf-mm-calendar-toggle [calendar]="true" (flip)="closed.emit()" />
      </span>
      @if (calendar()) {
        <p class="mf-sr-only" role="status" data-calendar-summary>{{ summary() }}</p>
        <div class="cal__frame" mfScrollRegion="Calendar month">
          <table class="dc" data-calendar role="grid" [attr.aria-label]="title(shown())">
            <thead>
              <tr>
                @for (w of weekdays; track w.short) {
                  <th scope="col" [attr.abbr]="w.long">{{ w.short }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (week of weeks(); track $index) {
                <tr>
                  @for (c of week; track $index) {
                    @if (c.date === null) {
                      <td class="dc__blank" role="gridcell" aria-hidden="true"></td>
                    } @else {
                      <td
                        role="gridcell"
                        [class.dc__weekend]="c.weekend"
                        [class.dc__today]="c.today"
                        [attr.data-day]="c.date"
                        [attr.tabindex]="c.date === active() ? 0 : -1"
                        [attr.aria-label]="cellName(c)"
                        (keydown)="cellKey($event, c)"
                        (focus)="active.set(c.date)"
                      >
                        <div class="dc__head">
                          <span class="dc__date">{{ c.label }}</span>
                          @if (c.today) {
                            <span class="dc__today-word">Today</span>
                          }
                        </div>
                        @if (c.items.length > 0) {
                          <ul class="dc__items">
                            @for (t of shownOf(c); track t.taskId) {
                              <li>
                                <a
                                  data-deadline-row
                                  tabindex="-1"
                                  [routerLink]="['/tasks', t.taskId]"
                                  [queryParams]="origin.params('my-matters')"
                                  [state]="origin.state()"
                                  [attr.title]="entryTitle(t)"
                                  (keydown)="entryKey($event, c)"
                                >
                                  @if (isOverdue(t)) {
                                    <i
                                      class="pi pi-exclamation-triangle cal__late"
                                      data-overdue-icon
                                      aria-hidden="true"
                                    ></i>
                                    <span class="mf-sr-only">Overdue: </span>
                                  }
                                  <span class="dc__title">{{ t.title }}</span>
                                </a>
                              </li>
                            }
                          </ul>
                          @if (c.count > shownPerDay) {
                            <a
                              class="dt__more"
                              data-day-more
                              tabindex="-1"
                              routerLink="/tasks"
                              [queryParams]="c.params"
                              [attr.aria-label]="
                                c.count -
                                shownPerDay +
                                ' more tasks due ' +
                                c.full +
                                ', open in the Task Queue'
                              "
                              (keydown)="entryKey($event, c)"
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
        </div>
      } @else if (listDays().length === 0) {
        <p class="pl__empty" data-empty>No tasks due in {{ title(shown()) }}.</p>
      } @else {
        @for (d of listDays(); track d.date) {
          <h3 class="cal__day" data-list-day>{{ d.full }}</h3>
          <ul class="cal__list">
            @for (t of d.items; track t.taskId) {
              <li>
                <a
                  data-deadline-row
                  [routerLink]="['/tasks', t.taskId]"
                  [queryParams]="origin.params('my-matters')"
                  [state]="origin.state()"
                  >{{ t.taskNumber }} {{ t.title }}</a
                >
                @if (isOverdue(t)) {
                  <span class="cal__late-word" data-overdue-icon>
                    <i class="pi pi-exclamation-triangle cal__late" aria-hidden="true"></i>
                    Overdue
                  </span>
                }
                <span class="cal__matter">{{ t.matterRef }}</span>
              </li>
            }
          </ul>
          @if (d.count > d.items.length) {
            <a class="dt__more" data-day-more routerLink="/tasks" [queryParams]="d.params"
              >+{{ d.count - d.items.length }} more</a
            >
          }
        }
      }
      @if (calendar() && total() === 0 && loader.state() === 'ready') {
        <p class="pl__empty" data-empty>No tasks due in {{ title(shown()) }}.</p>
      }
    </mf-mm-panel>
  `,
})
export class CalendarPanel {
  readonly filters = input.required<MmFilters>();
  /** The month in the address (`yyyy-mm`), or null for the month of today. */
  readonly month = input<string | null>(null);
  /** A month was chosen: Previous, Next, or null for Today. */
  readonly monthChange = output<string | null>();
  /** "Show list" was pressed: the page goes back to the grid. */
  readonly closed = output<void>();

  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MyMattersClient);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly injector = inject(Injector);
  protected readonly wide = viewportAtLeast(CALENDAR_MIN_PX);

  protected readonly weekdays = [
    { short: 'Mon', long: 'Monday' },
    { short: 'Tue', long: 'Tuesday' },
    { short: 'Wed', long: 'Wednesday' },
    { short: 'Thu', long: 'Thursday' },
    { short: 'Fri', long: 'Friday' },
    { short: 'Sat', long: 'Saturday' },
    { short: 'Sun', long: 'Sunday' },
  ];
  protected readonly shownPerDay = SHOWN_PER_DAY;
  /** The grid when the window is wide enough; a phone gets the same tasks as a list by day. */
  protected readonly calendar = computed(() => this.wide());

  protected readonly focus = inject(MyMattersFocus);

  private readonly currentMonth = computed(() => monthOf(todayText(this.clock, this.zone)));
  protected readonly shown = computed(() => this.month() ?? this.currentMonth());
  protected readonly isCurrent = computed(() => this.shown() === this.currentMonth());
  protected readonly previous = computed(() => shiftMonth(this.shown(), -1));
  protected readonly next = computed(() => shiftMonth(this.shown(), 1));
  protected readonly title = monthTitle;

  protected readonly loader = panelLoader(
    () => [this.filters(), this.shown(), this.focus.types()],
    () => {
      const a = commonArgs(this.filters());
      const types = this.focus.types();
      return this.api.getMyMattersCalendar(
        this.shown(),
        this.filters().show === 'open' ? undefined : this.filters().show,
        types.length > 0 ? types : undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
        undefined,
        a.matterId,
      );
    },
  );

  /** The day that holds the grid's one tab stop: the one last on, else today when it is in the month, else the first. */
  protected readonly active = signal<string | null>(null);
  /** A day to put the focus on once the month it is in has loaded (an arrow past the edge of the month). */
  private pending: string | null = null;

  protected readonly weeks = computed(() => monthWeeks(this.loader.data()?.days ?? []));
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);
  protected readonly summary = computed(() => {
    const d = this.loader.data();
    if (!d) return '';
    return `${this.title(d.month)}: ${d.total} ${d.total === 1 ? 'task' : 'tasks'} due${d.overdue > 0 ? `, ${d.overdue} overdue` : ''}.`;
  });
  /** The days with tasks, for the phone list. */
  protected readonly listDays = computed(() =>
    this.weeks()
      .flat()
      .filter((c) => c.count > 0),
  );

  constructor() {
    this.focus.ensure();
    restoreRowFocus('my-matters-calendar', () => this.loader.state() === 'ready');
    // The tab stop: keep the day the person was on, else today, else the first day of the month.
    effect(() => {
      const days = this.loader.data()?.days ?? [];
      if (days.length === 0) return;
      untracked(() => {
        const dates = days.map((d) => d.date);
        const wanted = this.pending ?? this.active();
        if (wanted && dates.includes(wanted)) {
          this.active.set(wanted);
          if (this.pending) this.focusDay(this.pending);
          this.pending = null;
          return;
        }
        this.active.set(days.find((d) => d.isToday)?.date ?? dates[0]);
      });
    });
  }

  protected shownOf(c: CalendarCell): MyMattersTaskItem[] {
    return c.items.slice(0, SHOWN_PER_DAY);
  }

  protected isOverdue = isOverdueItem;

  protected entryTitle(t: MyMattersTaskItem): string {
    return `${isOverdueItem(t) ? 'Overdue: ' : ''}${t.taskNumber} ${t.title}`;
  }

  protected cellName(c: CalendarCell): string {
    const tasks =
      c.count === 0 ? 'no tasks due' : `${c.count} ${c.count === 1 ? 'task' : 'tasks'} due`;
    const late = c.overdue > 0 ? `, ${c.overdue} overdue` : '';
    return `${c.full}${c.today ? ', today' : ''}: ${tasks}${late}`;
  }

  private cellOf(date: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`mf-mm-calendar td[data-day="${date}"]`);
  }

  private focusDay(date: string): void {
    afterNextRender(() => this.cellOf(date)?.focus({ preventScroll: false }), {
      injector: this.injector,
    });
  }

  private addDays(date: string, by: number): string {
    const at = new Date(`${date}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + by);
    return at.toISOString().slice(0, 10);
  }

  /** Moves to a day: in this month the focus goes there at once, in another month that month is asked for and the focus follows. */
  private moveTo(date: string): void {
    if (monthOf(date) === this.shown()) {
      this.active.set(date);
      this.cellOf(date)?.focus();
    } else {
      this.pending = date;
      this.monthChange.emit(monthOf(date));
    }
  }

  /** The keys of an ARIA date grid, inside the control only. */
  protected cellKey(event: KeyboardEvent, c: CalendarCell): void {
    if (event.target !== event.currentTarget || c.date === null) return;
    const date = c.date;
    let to: string | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        to = this.addDays(date, -1);
        break;
      case 'ArrowRight':
        to = this.addDays(date, 1);
        break;
      case 'ArrowUp':
        to = this.addDays(date, -7);
        break;
      case 'ArrowDown':
        to = this.addDays(date, 7);
        break;
      case 'Home':
        to = this.addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
        break;
      case 'End':
        to = this.addDays(date, 6 - ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
        break;
      case 'PageUp':
        to = this.sameDayIn(date, shiftMonth(monthOf(date), -1));
        break;
      case 'PageDown':
        to = this.sameDayIn(date, shiftMonth(monthOf(date), 1));
        break;
      case 'Enter':
      case ' ': {
        const first = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('a');
        if (first) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    if (to) this.moveTo(to);
  }

  /** The same day number in another month, held to that month's last day. */
  private sameDayIn(date: string, month: string): string {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${month}-${String(Math.min(Number(date.slice(8)), last)).padStart(2, '0')}`;
  }

  /** Inside a day: Up and Down between its tasks, Escape back to the day (Enter follows the link). */
  protected entryKey(event: KeyboardEvent, c: CalendarCell): void {
    const link = event.currentTarget as HTMLElement;
    const cell = link.closest<HTMLElement>('td');
    if (!cell || c.date === null) return;
    const links = Array.from(cell.querySelectorAll<HTMLElement>('a'));
    const at = links.indexOf(link);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      links[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cell.focus();
    }
  }
}
