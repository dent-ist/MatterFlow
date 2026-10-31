import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersClient, MyMattersTaskItem } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { formatDateOnly } from '../../../core/time/time';
import { EVENT_TYPES, EventIcon } from '../../../shared/ui/event-type';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { monthOf, monthTitle, shiftMonth, todayText } from '../calendar-month';
import { panelLoader } from '../panel-loader';
import { MmEventDialog } from './event-dialog';
import { MmApi } from './mm-api';
import { MatterEvent, MatterTree } from './mm-models';
import { CAL_SHOWS, CalShow } from './mm-scope';

const SHOW_LABELS: Record<CalShow, string> = {
  events: 'Calendar events',
  critical: 'Critical tasks',
  high: 'High priority tasks',
  all: 'All task due dates',
  overdue: 'Overdue tasks',
};

interface Cell {
  date: string;
  day: number;
  inMonth: boolean;
  today: boolean;
  weekend: boolean;
  events: MatterEvent[];
  tasks: MyMattersTaskItem[];
}

/** The days of the month grid (Sunday first): whole weeks that cover the month. */
export function gridDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const start = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
  const n = Math.ceil((first.getUTCDay() + last.getUTCDate()) / 7) * 7;
  return Array.from({ length: n }, (_, i) =>
    new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Does a task show for the chosen kinds? An On Hold task never shows (it is not due anywhere); Overdue means New or In Progress and due before today. */
export function taskShown(t: MyMattersTaskItem, shows: readonly CalShow[], today: string): boolean {
  if (t.statusCode === 'ON_HOLD') return false;
  if (shows.includes('all')) return true;
  const over = !!t.dueDate && t.dueDate < today;
  return (
    (shows.includes('critical') && t.priorityName.toLowerCase() === 'critical') ||
    (shows.includes('high') && t.priorityName.toLowerCase() === 'high') ||
    (shows.includes('overdue') && over)
  );
}

/**
 * The Calendar tab (`mf-mm-calendar-tab`, epic #953 UI-15): the month with Previous, Next and Today, "+ Add Event", a "Shows" multi-select (Calendar events, Critical tasks, High
 * priority tasks, All task due dates, Overdue tasks) and the legend of the eight event types, each with its fixed icon and its word. Each day is ONE interactive cell (arrow keys
 * move between days, Enter or a click opens the day's list), so a month is one tab stop; the chips inside a cell are a summary. An overdue task carries a warning icon. Events come
 * from the matter-events API (people who can see the matter see them; the Primary and Secondary PM and holders of Matter.Edit may add, edit and delete); the task due dates come
 * from the existing calendar API. The calendar follows the client and matter chosen at the top and is a lazy chunk.
 */
@Component({
  selector: 'mf-mm-calendar-tab',
  imports: [EventIcon, MmEventDialog, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mf-fill',
    '(document:mousedown)': 'outside($event)',
    '(keydown)': 'onKey($event)',
  },
  template: `
    <section class="cal" aria-label="Calendar">
      <div class="bar">
        <div class="nav" role="group" aria-label="Month">
          <button
            type="button"
            class="b"
            data-prev
            [attr.aria-label]="'Previous month, ' + titleOf(previous())"
            (click)="monthChange.emit(previous())"
          >
            <i class="pi pi-angle-left" aria-hidden="true"></i><span class="t">Previous</span>
          </button>
          <button
            type="button"
            class="b"
            data-today
            [disabled]="isCurrent()"
            (click)="monthChange.emit(null)"
          >
            Today
          </button>
          <button
            type="button"
            class="b"
            data-next
            [attr.aria-label]="'Next month, ' + titleOf(next())"
            (click)="monthChange.emit(next())"
          >
            <span class="t">Next</span><i class="pi pi-angle-right" aria-hidden="true"></i>
          </button>
        </div>
        <h2 class="mt" aria-live="polite" data-month-title>{{ titleOf(shown()) }}</h2>
        <div class="acts">
          <div class="shows">
            <button
              type="button"
              class="b"
              data-shows
              aria-haspopup="true"
              [attr.aria-expanded]="showsOpen()"
              (click)="showsOpen.set(!showsOpen())"
              (keydown.escape)="showsOpen.set(false)"
            >
              <i class="pi pi-filter" aria-hidden="true"></i> Shows: {{ showsLabel() }}
              <i class="pi pi-angle-down" aria-hidden="true"></i>
            </button>
            @if (showsOpen()) {
              <div
                class="pop"
                role="group"
                aria-label="Show on the calendar"
                (keydown.escape)="showsOpen.set(false)"
              >
                @for (k of showKeys; track k) {
                  <label class="chk"
                    ><input
                      type="checkbox"
                      [checked]="shows().includes(k)"
                      [attr.data-show]="k"
                      (change)="toggleShow(k)"
                    />
                    {{ showLabels[k] }}</label
                  >
                }
              </div>
            }
          </div>
          <button
            type="button"
            class="b primary"
            data-add-event
            [attr.aria-disabled]="canManage() ? null : true"
            [attr.title]="
              canManage() ? null : 'Only the project managers of a matter can add calendar items.'
            "
            (click)="canManage() && add()"
          >
            <i class="pi pi-plus" aria-hidden="true"></i> Add Event
          </button>
        </div>
      </div>

      <ul class="legend" aria-label="Event types">
        @for (t of types; track t.code) {
          <li><mf-event-icon [type]="t.code" [chip]="true" /></li>
        }
        <li class="lg-o">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i> Overdue task
        </li>
      </ul>

      <div class="grid-wrap">
        @if (events.state() === 'error' || tasks.state() === 'error') {
          <p class="msg" role="alert">
            Couldn't load the calendar.
            <button type="button" class="lnk" (click)="events.load(); tasks.load()">Retry</button>
          </p>
        }
        <div class="dow" aria-hidden="true">
          @for (d of dows; track d) {
            <span>{{ d }}</span>
          }
        </div>
        <div
          class="cgrid"
          role="grid"
          [attr.aria-label]="titleOf(shown())"
          [attr.aria-busy]="events.busy() || tasks.busy()"
        >
          @for (week of weeks(); track $index) {
            <div role="row" class="wk">
              @for (c of week; track c.date) {
                <div
                  role="gridcell"
                  class="cell"
                  [class.out]="!c.inMonth"
                  [class.today]="c.today"
                  [class.wknd]="c.weekend"
                >
                  <button
                    type="button"
                    class="day"
                    [attr.data-day]="c.date"
                    [attr.tabindex]="c.date === tabStop() ? 0 : -1"
                    [attr.aria-label]="dayLabel(c)"
                    [attr.aria-haspopup]="'dialog'"
                    (click)="openDay(c.date, $event)"
                    (focus)="active.set(c.date)"
                  >
                    <span class="num">{{ c.day }}</span>
                    @if (c.today) {
                      <span class="tdy">Today</span>
                    }
                    <span class="chips" aria-hidden="true">
                      @for (e of c.events.slice(0, 3); track e.eventId) {
                        <span class="chip ev"
                          ><mf-event-icon [type]="e.typeCode" />{{ e.time ?? '' }}
                          {{ e.title }}</span
                        >
                      }
                      @for (
                        t of c.tasks.slice(0, 3 - Math.min(3, c.events.length));
                        track t.taskId
                      ) {
                        <span class="chip tk" [class.od]="isOver(t)">
                          @if (isOver(t)) {
                            <i class="pi pi-exclamation-circle"></i>
                          } @else {
                            <i class="pi pi-check-square"></i>
                          }
                          {{ t.title }}
                        </span>
                      }
                      @if (c.events.length + c.tasks.length > 3) {
                        <span class="more">+{{ c.events.length + c.tasks.length - 3 }} more</span>
                      }
                    </span>
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </div>

      @if (dayOpen(); as d) {
        <div
          class="dp"
          role="dialog"
          aria-modal="false"
          [attr.aria-label]="longDate(d.date)"
          (keydown.escape)="closeDay(true)"
        >
          <div class="dph">
            <h3>{{ longDate(d.date) }}</h3>
            <button
              type="button"
              class="x"
              data-close-day
              aria-label="Close the day"
              (click)="closeDay(true)"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>
          @if (d.events.length === 0 && d.tasks.length === 0) {
            <p class="msg">Nothing on this day.</p>
          }
          @if (d.events.length > 0) {
            <h4>Events</h4>
            <ul class="dl">
              @for (e of d.events; track e.eventId) {
                <li>
                  <mf-event-icon [type]="e.typeCode" [chip]="true" />
                  <span class="dt"
                    ><b>{{ e.title }}</b>
                    <span class="m">{{ e.time ?? 'All day' }} · {{ e.matterName }}</span></span
                  >
                  @if (e.canEdit) {
                    <button
                      type="button"
                      class="lnk"
                      [attr.data-edit]="e.eventId"
                      (click)="edit(e)"
                    >
                      Edit
                    </button>
                  }
                </li>
              }
            </ul>
          }
          @if (d.tasks.length > 0) {
            <h4>Tasks due</h4>
            <ul class="dl">
              @for (t of d.tasks; track t.taskId) {
                <li>
                  @if (isOver(t)) {
                    <i class="pi pi-exclamation-circle od" aria-label="Overdue" role="img"></i>
                  }
                  <span class="dt">
                    <a class="lnk" [routerLink]="['/tasks', t.taskId]"
                      >{{ t.taskNumber }} {{ t.title }}</a
                    >
                    <span class="m">{{ t.priorityName }} · {{ t.matterName }}</span>
                  </span>
                </li>
              }
            </ul>
          }
        </div>
      }
    </section>

    @if (dialog()) {
      <mf-mm-event-dialog
        [(visible)]="dialog"
        [tree]="tree()"
        [matterId]="filters().matterId"
        [clientId]="filters().clientId"
        [event]="editing()"
        (saved)="changed.emit()"
        (deleted)="changed.emit()"
      />
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
    }
    .cal {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: var(--mf-cal-min, 360px);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
      overflow: hidden;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s4);
      padding: var(--mf-s3) var(--mf-s4);
      flex: none;
    }
    .nav,
    .acts {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .acts {
      margin-left: auto;
    }
    .mt {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    .b {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 36px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .b:disabled,
    .b[aria-disabled='true'] {
      color: var(--mf-text-muted);
      cursor: not-allowed;
    }
    .b.primary {
      background: var(--mf-primary);
      border-color: var(--mf-primary);
      color: var(--mf-primary-contrast);
    }
    .b.primary[aria-disabled='true'] {
      background: var(--mf-surface-alt);
      border-color: var(--mf-border-strong);
      color: var(--mf-text-muted);
    }
    .shows {
      position: relative;
    }
    .pop {
      position: absolute;
      right: 0;
      top: calc(100% + 4px);
      z-index: 20;
      display: grid;
      gap: var(--mf-s1);
      min-width: 220px;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-pop);
    }
    .chk {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
      min-height: 32px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s3);
      margin: 0;
      padding: var(--mf-s2) var(--mf-s4);
      list-style: none;
      border-top: 1px solid var(--mf-border);
      font-size: var(--mf-fs-xs);
      flex: none;
    }
    .lg-o {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      color: var(--mf-sem-overdue-fg);
      font-weight: 700;
    }
    .grid-wrap {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
      border-top: 1px solid var(--mf-border);
    }
    .dow {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      flex: none;
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      text-transform: uppercase;
    }
    .dow span {
      padding: var(--mf-s2) var(--mf-s3);
    }
    .cgrid {
      display: grid;
      grid-auto-rows: minmax(84px, 1fr);
      flex: 1 1 0;
      min-height: 0;
      overflow: auto;
    }
    .wk {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      min-height: 84px;
    }
    .cell {
      min-width: 0;
      border-right: 1px solid var(--mf-border);
      border-bottom: 1px solid var(--mf-border);
    }
    .cell.out {
      background: var(--mf-surface-alt);
    }
    .day {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      padding: var(--mf-s1) var(--mf-s2);
      border: 0;
      background: none;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      overflow: hidden;
    }
    .day:hover {
      background: var(--mf-selected-bg);
    }
    .day:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .cell.out .num {
      color: var(--mf-text-muted);
    }
    .num {
      font-weight: 700;
      font-size: var(--mf-fs-sm);
    }
    .today .num {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--mf-primary);
      color: var(--mf-surface);
    }
    .tdy {
      font-size: var(--mf-fs-xs);
      color: var(--mf-primary);
      font-weight: 700;
    }
    .chips {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .chip {
      display: flex;
      align-items: center;
      gap: 3px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--mf-fs-xs);
    }
    .chip.tk {
      color: var(--mf-text-muted);
    }
    .chip.od {
      color: var(--mf-sem-overdue-fg);
      font-weight: 700;
    }
    .more {
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
      font-weight: 600;
    }
    .dp {
      position: absolute;
      right: var(--mf-s4);
      top: 64px;
      z-index: 30;
      width: min(380px, calc(100% - 32px));
      max-height: calc(100% - 80px);
      overflow: auto;
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-pop);
    }
    .dph {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .dph h3,
    h4 {
      margin: 0;
      font-size: var(--mf-fs-md);
    }
    h4 {
      margin-top: var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      text-transform: uppercase;
    }
    .x {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 50%;
      background: none;
      cursor: pointer;
      color: var(--mf-text);
    }
    .dl {
      list-style: none;
      margin: var(--mf-s2) 0 0;
      padding: 0;
      display: grid;
      gap: var(--mf-s2);
    }
    .dl li {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
    }
    .dt {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .m {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 400;
    }
    .od {
      color: var(--mf-sem-overdue-fg);
    }
    .lnk {
      color: var(--mf-link);
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      cursor: pointer;
      text-decoration: none;
    }
    .lnk:hover {
      text-decoration: underline;
    }
    .msg {
      margin: var(--mf-s3) var(--mf-s4);
      color: var(--mf-text-muted);
    }
    @media (max-width: 767.98px) {
      .cal {
        height: auto;
      }
      .cgrid {
        overflow: visible;
      }
      .t {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
      .b {
        min-height: 44px;
      }
      .day {
        min-height: 64px;
      }
      .acts {
        width: 100%;
        margin-left: 0;
        flex-wrap: wrap;
      }
      .acts .b {
        flex: 1;
        justify-content: center;
      }
    }
  `,
})
export class MmCalendarTab {
  protected readonly Math = Math;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly api = inject(MmApi);
  private readonly my = inject(MyMattersClient);
  private readonly auth = inject(AuthStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  readonly filters = input.required<MmFilters>();
  readonly month = input<string | null>(null);
  readonly shows = input<readonly CalShow[]>(['events', 'critical']);
  readonly tree = input<MatterTree | null>(null);
  /** Bumped by the page after an event was created elsewhere (the New menu). */
  readonly refreshKey = input(0);
  readonly monthChange = output<string | null>();
  readonly showsChange = output<CalShow[]>();
  readonly changed = output<void>();

  protected readonly showKeys = CAL_SHOWS;
  protected readonly showLabels = SHOW_LABELS;
  protected readonly types = EVENT_TYPES;
  protected readonly dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  protected readonly titleOf = monthTitle;
  protected readonly showsOpen = signal(false);
  protected readonly dayOpen = signal<{
    date: string;
    events: MatterEvent[];
    tasks: MyMattersTaskItem[];
  } | null>(null);
  protected readonly dialog = signal(false);
  protected readonly editing = signal<MatterEvent | null>(null);
  protected readonly active = signal<string | null>(null);
  private lastDayButton: HTMLElement | null = null;

  protected readonly today = computed(() => todayText(this.clock, this.zone));
  protected readonly shown = computed(() => this.month() ?? monthOf(this.today()));
  protected readonly isCurrent = computed(() => this.shown() === monthOf(this.today()));
  protected readonly previous = computed(() => shiftMonth(this.shown(), -1));
  protected readonly next = computed(() => shiftMonth(this.shown(), 1));
  protected readonly canManage = computed(
    () => this.auth.has('Matter.Edit') || this.auth.has('Matter.BeManager'),
  );
  protected readonly showsLabel = computed(() => {
    const s = this.shows();
    if (s.length === 0) return 'Nothing';
    return SHOW_LABELS[s[0]] + (s.length > 1 ? ` +${s.length - 1}` : '');
  });

  private readonly days = computed(() => gridDays(this.shown()));

  protected readonly events = panelLoader(
    () => [this.filters(), this.days(), this.refreshKey()],
    () => {
      const d = this.days();
      return this.api.events(this.filters(), d[0], d[d.length - 1]);
    },
  );
  protected readonly tasks = panelLoader(
    () => [this.filters(), this.shown()],
    () => {
      const a = commonArgs(this.filters());
      return this.my.getMyMattersCalendar(
        this.shown(),
        undefined,
        undefined,
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

  protected readonly weeks = computed<Cell[][]>(() => {
    const showEvents = this.shows().includes('events');
    const evByDay = new Map<string, MatterEvent[]>();
    if (showEvents)
      for (const e of this.events.data()?.items ?? []) {
        const l = evByDay.get(e.date) ?? [];
        l.push(e);
        evByDay.set(e.date, l);
      }
    const taskByDay = new Map<string, MyMattersTaskItem[]>();
    for (const d of this.tasks.data()?.days ?? [])
      taskByDay.set(
        d.date,
        d.items.filter((t) => taskShown(t, this.shows(), this.today())),
      );
    const out: Cell[] = this.days().map((date) => ({
      date,
      day: Number(date.slice(8)),
      inMonth: date.startsWith(this.shown()),
      today: date === this.today(),
      weekend: [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
      events: evByDay.get(date) ?? [],
      tasks: taskByDay.get(date) ?? [],
    }));
    const weeks: Cell[][] = [];
    for (let i = 0; i < out.length; i += 7) weeks.push(out.slice(i, i + 7));
    return weeks;
  });
  protected readonly tabStop = computed(() => {
    const a = this.active();
    const dates = this.days();
    if (a && dates.includes(a)) return a;
    return dates.includes(this.today())
      ? this.today()
      : (dates.find((d) => d.startsWith(this.shown())) ?? dates[0]);
  });

  protected isOver(t: MyMattersTaskItem): boolean {
    return !!t.dueDate && t.dueDate < this.today() && t.statusCode !== 'ON_HOLD';
  }

  protected longDate(date: string): string {
    return formatDateOnly(date);
  }

  protected dayLabel(c: Cell): string {
    const parts = [formatDateOnly(c.date)];
    if (c.today) parts.push('today');
    parts.push(`${c.events.length} ${c.events.length === 1 ? 'event' : 'events'}`);
    parts.push(`${c.tasks.length} ${c.tasks.length === 1 ? 'task' : 'tasks'} due`);
    const od = c.tasks.filter((t) => this.isOver(t)).length;
    if (od) parts.push(`${od} overdue`);
    return parts.join(', ');
  }

  protected toggleShow(k: CalShow): void {
    const cur = this.shows();
    this.showsChange.emit(CAL_SHOWS.filter((x) => (x === k ? !cur.includes(x) : cur.includes(x))));
  }

  protected outside(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (this.showsOpen() && !t.closest('.shows')) this.showsOpen.set(false);
    if (this.dayOpen() && !t.closest('.dp') && !t.closest('.day')) this.dayOpen.set(null);
  }

  protected openDay(date: string, ev: Event): void {
    this.lastDayButton = ev.currentTarget as HTMLElement;
    const cell = this.weeks()
      .flat()
      .find((c) => c.date === date);
    this.dayOpen.set({ date, events: cell?.events ?? [], tasks: cell?.tasks ?? [] });
    queueMicrotask(() => this.host.querySelector<HTMLElement>('[data-close-day]')?.focus());
  }

  protected closeDay(restore: boolean): void {
    this.dayOpen.set(null);
    if (restore) queueMicrotask(() => this.lastDayButton?.focus());
  }

  protected add(): void {
    this.editing.set(null);
    this.dialog.set(true);
  }

  protected edit(e: MatterEvent): void {
    this.dayOpen.set(null);
    this.editing.set(e);
    this.dialog.set(true);
  }

  /** Arrow keys move between days (a week up and down, a day left and right, Home and End within the week). */
  protected onKey(e: KeyboardEvent): void {
    const cur = (document.activeElement as HTMLElement | null)?.dataset?.['day'];
    if (!cur) return;
    const dates = this.days();
    const i = dates.indexOf(cur);
    let to = i;
    switch (e.key) {
      case 'ArrowLeft':
        to = i - 1;
        break;
      case 'ArrowRight':
        to = i + 1;
        break;
      case 'ArrowUp':
        to = i - 7;
        break;
      case 'ArrowDown':
        to = i + 7;
        break;
      case 'Home':
        to = i - (i % 7);
        break;
      case 'End':
        to = i - (i % 7) + 6;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (to < 0 || to >= dates.length) return;
    this.active.set(dates[to]);
    queueMicrotask(() =>
      this.host.querySelector<HTMLElement>(`[data-day="${dates[to]}"]`)?.focus(),
    );
  }
}
