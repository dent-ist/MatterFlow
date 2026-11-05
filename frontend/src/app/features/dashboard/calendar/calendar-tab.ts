import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, mfDate } from '../../../core/time/time';
import { AbsenceDialog, AbsencePerson } from '../../../shared/availability/absences/absence-dialog';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { Segmented } from '../../../shared/ui/segmented';
import { DashScope } from '../dash-scope';
import { DashState } from '../ui/dash-state';
import { DASH_FIXED_QUERY, mediaMatch } from '../ui/dash-media';
import { CALENDAR_API } from './calendar-api';
import { CalDay, CalDays, CalQuery, CalSummary } from './calendar-contract';
import { CalInsights } from './calendar-insights';
import { CalMonthGrid } from './calendar-month-grid';
import {
  CalView,
  LEGEND_LEVELS,
  LEVELS,
  addDays,
  longDay,
  monthOf,
  monthTitle,
  parseCalAddress,
  shiftMonth,
  viewRange,
  weekGrid,
  weekTitle,
} from './calendar-model';
import { CalPanel } from './calendar-panel';
import { cellClass } from './calendar-month-grid';
import { CalWeekGrid } from './calendar-week-grid';

type LoadState = 'loading' | 'ready' | 'error';

const DOCKED_QUERY = '(min-width: 1024px)';
const SHEET_QUERY = '(max-width: 767.98px)';
const ALL_ROLES = '';

/**
 * The Calendar tab of the Dashboard (epic #1074, CAL-07 and CAL-08): who can work on each day and where coverage is thin. Month (default) and Week, Previous / Today / Next like
 * My Matters, a Role filter (the Pod filter is the page-wide Scope in the header), the 30-day risk banner and the 4-week forecast, a coverage legend, and the read-only day panel
 * (docked from 1024 px, slide-over from 768, bottom sheet on a phone). The state (`cal`, `month`, `week`, `day`, `role`, with the page's `pod`) lives in the address. Everything is read
 * through `CalendarApi`; the figures are the server's. Needs Dashboard.ViewCalendar (the tab is only offered with it).
 */
@Component({
  selector: 'mf-dash-calendar-tab',
  imports: [
    AbsenceDialog,
    CalInsights,
    CalMonthGrid,
    CalPanel,
    CalWeekGrid,
    DashState,
    Dropdown,
    Segmented,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './calendar-coverage.scss',
  host: { class: 'mf-fill' },
  template: `
    <section class="cal" aria-label="Calendar" data-cal [attr.data-view]="view()">
      <p class="sr-only" role="status" aria-live="polite" data-cal-live>{{ live() }}</p>
      <div class="tb">
        @if (roleItems().length > 1) {
          <mf-dropdown
            buttonId="cal-role"
            label="Filter by role"
            prefix="Role:"
            icon="pi-filter"
            [items]="roleItems()"
            [value]="roleValue()"
            (valueChange)="setRole($event)"
            [panelWidth]="260"
          />
        }
        <div mfSegmented role="group" aria-label="Calendar view">
          <button
            type="button"
            class="mf-btn"
            data-view-month
            [attr.aria-pressed]="view() === 'month'"
            (click)="setView('month')"
          >
            <i class="pi pi-calendar" aria-hidden="true"></i> Month
          </button>
          <button
            type="button"
            class="mf-btn"
            data-view-week
            [attr.aria-pressed]="view() === 'week'"
            (click)="setView('week')"
          >
            <i class="pi pi-table" aria-hidden="true"></i> Week
          </button>
        </div>
        @if (canManage()) {
          <button
            type="button"
            class="mf-btn mf-btn--primary tb__add"
            data-add-absence
            (click)="openAdd()"
          >
            <i class="pi pi-plus" aria-hidden="true"></i> Add Out of Office
          </button>
        }
      </div>

      <mf-cal-insights
        [summary]="summary()"
        [error]="summaryFailed()"
        (showRisk)="showRisk($event)"
        (retry)="loadSummary()"
      />

      <div class="main" [class.main--docked]="!!shownDay() && docked()">
        <div class="gc">
          <div class="nav">
            <div
              class="nav__g"
              role="group"
              [attr.aria-label]="view() === 'month' ? 'Month' : 'Week'"
            >
              <button
                type="button"
                class="mf-btn"
                data-prev
                [attr.aria-label]="prevLabel()"
                (click)="step(-1)"
              >
                <i class="pi pi-angle-left" aria-hidden="true"></i><span class="t">Previous</span>
              </button>
              <button
                type="button"
                class="mf-btn"
                data-today
                [disabled]="isCurrent()"
                (click)="goToday()"
              >
                Today
              </button>
              <button
                type="button"
                class="mf-btn"
                data-next
                [attr.aria-label]="nextLabel()"
                (click)="step(1)"
              >
                <span class="t">Next</span><i class="pi pi-angle-right" aria-hidden="true"></i>
              </button>
            </div>
            <h2 class="nav__t" aria-live="polite" data-cal-title>{{ title() }}</h2>
            <p class="nav__h">
              Each day: people available of those expected. Good = {{ minPercent() }}% or more of
              them.
            </p>
          </div>

          @if (refreshFailed()) {
            <div class="gc__state">
              <mf-dash-state variant="stale" [updated]="updated()" (retry)="reload()" />
            </div>
          }
          @switch (state()) {
            @case ('loading') {
              <div class="skel" role="status" aria-busy="true" data-cal-loading>
                <span class="sr-only">Loading the calendar</span>
                @for (n of skeleton; track n) {
                  <span class="skel__b" aria-hidden="true"></span>
                }
              </div>
            }
            @case ('error') {
              <div class="gc__state">
                <mf-dash-state
                  variant="error"
                  message="Couldn't load the calendar."
                  (retry)="reload()"
                />
              </div>
            }
            @default {
              @if (emptyKind() === 'none') {
                <div class="gc__state">
                  <mf-dash-state
                    variant="empty"
                    message="No people to plan yet. People who can work tasks and belong to a pod appear here."
                  />
                </div>
              } @else if (emptyKind() === 'filtered') {
                <div class="gc__state">
                  <mf-dash-state
                    variant="empty-filtered"
                    filteredText="Nobody matches this role in these pods."
                    (clear)="setRole('')"
                  />
                </div>
              } @else if (view() === 'month') {
                <mf-cal-month
                  [dates]="range().dates"
                  [month]="month()"
                  [days]="dayMap()"
                  [today]="today()"
                  [selected]="shownDay()"
                  [busy]="refreshing()"
                  [label]="title()"
                  (pick)="pickDay($event)"
                />
              } @else {
                <mf-cal-week
                  [dates]="range().dates"
                  [days]="dayMap()"
                  [today]="today()"
                  [selected]="shownDay()"
                  [busy]="refreshing()"
                  (pick)="pickDay($event)"
                />
              }
            }
          }

          <ul class="legend" aria-label="Legend" data-cal-legend>
            <li class="legend__h">Coverage</li>
            @for (l of legend; track l) {
              <li [class]="'lg ' + cls(l)" [attr.title]="LEVELS[l].hint">
                <i class="pi" [class]="LEVELS[l].icon" aria-hidden="true"></i>{{ LEVELS[l].word }}
              </li>
            }
            <li class="legend__h">Holidays</li>
            <li class="lg">
              <span class="hchip"
                ><i class="pi pi-flag" aria-hidden="true"></i
                ><span>Chip colour = category</span></span
              >
            </li>
          </ul>
        </div>

        @if (shownDay(); as day) {
          <div
            class="pc"
            [class.pc--docked]="docked()"
            [class.pc--sheet]="sheet()"
            data-cal-panel-host
          >
            @if (sheet() || !docked()) {
              <button
                type="button"
                class="pc__scrim"
                tabindex="-1"
                aria-hidden="true"
                (click)="closePanel()"
              ></button>
            }
            <mf-cal-panel
              [date]="day"
              [query]="query()"
              [today]="today()"
              [refreshKey]="refreshKey()"
              [canManage]="canManage()"
              (closed)="closePanel()"
              (addFor)="openAddFor($event)"
            />
          </div>
        }
      </div>
    </section>

    @if (dialog()) {
      <mf-absence-dialog
        [(visible)]="dialog"
        [userId]="dialogUser()"
        [displayName]="dialogName()"
        [people]="dialogPeople()"
        [canBackdate]="true"
        [initialStart]="shownDay()"
        (saved)="afterSave()"
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
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
      height: 100%;
      min-height: 0;
      position: relative;
    }
    .tb {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      flex: none;
    }
    .tb__add {
      margin-left: auto;
    }
    .main {
      display: flex;
      gap: var(--mf-s3);
      flex: 1 1 0;
      min-height: 0;
      position: relative;
    }
    .gc {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-width: 0;
      min-height: 0;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
      overflow: hidden;
    }
    .nav {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
      flex: none;
      padding: var(--mf-s2) var(--mf-s3);
    }
    .nav__g {
      display: flex;
      gap: var(--mf-s2);
    }
    .nav__t {
      margin: 0;
      font-size: var(--mf-fs-lg);
      font-weight: 700;
    }
    .nav__h {
      flex: 1 1 14rem;
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      text-align: right;
    }
    .gc__state {
      padding: var(--mf-s3);
    }
    .skel {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 1px;
      flex: 1 1 0;
      min-height: 0;
      padding: 0 var(--mf-s3) var(--mf-s3);
    }
    .skel__b {
      min-height: 56px;
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
      flex: none;
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border-top: 1px solid var(--mf-border);
      list-style: none;
      font-size: var(--mf-fs-xs);
    }
    .legend__h {
      font-weight: 700;
    }
    .lg {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--mf-s1);
    }
    /* The legend never clips its sample chip (CAL-11): the words stay whole, the row wraps instead. */
    .legend .hchip {
      height: auto;
      min-height: 18px;
      max-width: none;
      overflow: visible;
    }
    .legend .hchip > span {
      overflow: visible;
      text-overflow: clip;
    }
    .lg.cv-quiet {
      padding: 1px var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-pill);
      color: var(--mf-text);
      font-weight: 600;
    }
    .lg.cv-good,
    .lg.cv-watch,
    .lg.cv-low,
    .lg.cv-crit,
    .lg.cv-none {
      padding: 1px var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--cb);
      color: var(--cf);
      font-weight: 600;
    }
    .pc {
      flex: none;
      width: 340px;
      min-height: 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .t {
      white-space: nowrap;
    }
    /* From 1024 px the panel is docked beside the grid; at 1100 px and below it is a little narrower. */
    @media (min-width: 1024px) and (max-width: 1099.98px) {
      .pc {
        width: 300px;
      }
    }
    /* 768 to 1023 px: a slide-over on top of the grid, closed by its Close button, Escape or a click outside. */
    @media (min-width: 768px) and (max-width: 1023.98px) {
      .pc {
        position: absolute;
        inset: 0 0 0 auto;
        z-index: 20;
        width: min(340px, 92%);
        box-shadow: var(--mf-shadow-pop);
        border-radius: var(--mf-radius-xl);
      }
      .pc__scrim {
        position: fixed;
        inset: 0;
        z-index: -1;
        border: 0;
        background: transparent;
      }
    }
    /* A phone: the panel is a bottom sheet over the page; the grid behind keeps its place. */
    @media (max-width: 767.98px) {
      :host {
        overflow: visible;
      }
      .cal {
        height: auto;
      }
      .main {
        flex: none;
        flex-direction: column;
      }
      .gc {
        overflow: visible;
      }
      .nav__h {
        text-align: left;
      }
      .nav__g {
        width: 100%;
      }
      .nav__g .mf-btn {
        flex: 1;
        justify-content: center;
      }
      .tb {
        flex-direction: column;
        align-items: stretch;
      }
      .tb .mf-seg {
        width: 100%;
      }
      .tb__add {
        margin-left: 0;
        justify-content: center;
      }
      .pc {
        position: fixed;
        inset: auto 0 0 0;
        z-index: 60;
        width: auto;
        height: min(78dvh, 640px);
        box-shadow: var(--mf-shadow-pop);
        border-radius: var(--mf-radius-xl);
      }
      .pc__scrim {
        position: fixed;
        inset: 0;
        z-index: -1;
        border: 0;
        background: var(--mf-scrim);
      }
    }
  `,
})
export class DashCalendarTab {
  private readonly api = inject(CALENDAR_API);
  private readonly scope = inject(DashScope);
  private readonly auth = inject(AuthStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly panelRef = viewChild(CalPanel);

  protected readonly legend = LEGEND_LEVELS;
  protected readonly LEVELS = LEVELS;
  protected readonly skeleton = Array.from({ length: 35 }, (_, i) => i);
  protected readonly cls = cellClass;
  protected readonly fixed = mediaMatch(DASH_FIXED_QUERY);
  protected readonly docked = mediaMatch(DOCKED_QUERY);
  protected readonly sheet = mediaMatch(SHEET_QUERY);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly address = computed(() => parseCalAddress((k) => this.params().get(k)));
  protected readonly view = computed<CalView>(() => this.address().view);

  protected readonly state = signal<LoadState>('loading');
  protected readonly data = signal<CalDays | null>(null);
  protected readonly summary = signal<CalSummary | null>(null);
  protected readonly summaryFailed = signal(false);
  readonly refreshing = signal(false);
  protected readonly live = signal('');
  protected readonly refreshKey = signal(0);
  private readonly closed = signal(false);
  private readonly lastOk = signal<number | null>(null);
  private seq = 0;
  private summarySeq = 0;
  private dataFor = '';

  /** For the page header: the Refresh button, its tooltip and the stale age text (the same members as the Users tab). */
  readonly refreshFailed = signal(false);
  readonly lastOkAt = computed(() => this.lastOk());
  readonly failed = computed(() => this.refreshFailed());
  readonly updated = computed(() => {
    const at = this.lastOk();
    return at ? mfDate(new Date(at).toISOString(), this.zone, 'datetime') : null;
  });

  protected readonly today = computed(() => {
    const t = this.data()?.today;
    if (t) return t;
    const d = calendarDayInZone(this.clock.now(), this.zone);
    return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  });
  protected readonly month = computed(
    () => this.address().month ?? monthOf(this.address().week ?? this.today()),
  );
  /** The date a week view is anchored on. */
  private readonly anchor = computed(
    () =>
      this.address().week ?? (this.address().month ? `${this.address().month}-01` : this.today()),
  );
  protected readonly range = computed(() =>
    this.view() === 'month'
      ? viewRange('month', `${this.month()}-01`)
      : viewRange('week', this.anchor()),
  );
  protected readonly query = computed<CalQuery>(() => ({
    podScope: this.scope.scope(),
    role: this.address().role,
  }));
  protected readonly dayMap = computed<ReadonlyMap<string, CalDay>>(
    () => new Map((this.data()?.days ?? []).map((d) => [d.date, d])),
  );
  protected readonly minPercent = computed(
    () => this.summary()?.thresholds.minCoveragePercent ?? 75,
  );

  protected readonly canManage = computed(() => this.auth.has('User.ManageAvailability'));
  protected readonly roleItems = computed<DropdownItem[]>(() => [
    { value: ALL_ROLES, label: 'All roles' },
    ...(this.data()?.roles ?? []).map((r) => ({ value: String(r.roleId), label: r.name })),
  ]);
  protected readonly roleValue = computed(() =>
    this.address().role === null ? ALL_ROLES : String(this.address().role),
  );

  /** The day whose panel shows: the address, else (desktop) today; none once the person closed it. */
  protected readonly shownDay = computed<string | null>(() => {
    if (this.closed()) return null;
    const named = this.address().day;
    if (named) return named;
    // Open by default on a desktop (Month and Week) when today is in the view.
    return this.docked() && this.fixed() && this.range().dates.includes(this.today())
      ? this.today()
      : null;
  });

  protected readonly emptyKind = computed<'none' | 'filtered' | null>(() => {
    const d = this.data();
    if (!d || d.days.length === 0) return null;
    if (d.days.some((x) => x.total > 0)) return null;
    return this.address().role !== null ? 'filtered' : 'none';
  });

  protected readonly title = computed(() =>
    this.view() === 'month'
      ? monthTitle(this.month())
      : `Week of ${weekTitle(this.range().dates, Number(this.today().slice(0, 4)))}`,
  );
  protected readonly isCurrent = computed(() =>
    this.view() === 'month'
      ? this.month() === monthOf(this.today())
      : this.range().dates.includes(this.today()),
  );
  protected readonly prevLabel = computed(() => `Previous ${this.view()}, ${this.label(-1)}`);
  protected readonly nextLabel = computed(() => `Next ${this.view()}, ${this.label(1)}`);

  private label(by: number): string {
    return this.view() === 'month'
      ? monthTitle(shiftMonth(this.month(), by))
      : weekTitle(
          weekGrid(addDays(this.range().dates[0], 7 * by)),
          Number(this.today().slice(0, 4)),
        );
  }

  constructor() {
    // The days of the view: the first read (and a new scope or role) shows the skeleton, a move to another month or week keeps the grid and says it is busy.
    effect(() => {
      const range = this.range();
      const q = this.query();
      const ready = this.scope.ready();
      this.refreshKey();
      untracked(() => {
        if (ready) void this.loadDays(range.from, range.to, q);
      });
    });
    effect(() => {
      const q = this.query();
      const ready = this.scope.ready();
      this.refreshKey();
      untracked(() => {
        if (ready) void this.loadSummary(q);
      });
    });
    // A panel that opens as a slide-over or sheet takes the keyboard to its Close button; the docked one does not steal the focus.
    effect(() => {
      const day = this.shownDay();
      untracked(() => {
        if (day && this.address().day && (this.sheet() || !this.docked())) {
          afterNextRender(() => this.panelRef()?.focusClose(), { injector: this.injector });
        }
      });
    });
    this.destroyRef.onDestroy(() => this.seq++);
  }

  // ---- reads

  private async loadDays(from: string, to: string, q: CalQuery): Promise<void> {
    const id = ++this.seq;
    const key = `${q.podScope}|${q.role}`;
    const first = !this.data() || this.dataFor !== key;
    if (first) this.state.set('loading');
    else this.refreshing.set(true);
    try {
      const days = await this.api.days(from, to, q);
      if (id !== this.seq) return;
      this.data.set(days);
      this.dataFor = key;
      this.state.set('ready');
      this.refreshFailed.set(false);
      this.lastOk.set(this.clock.now().getTime());
    } catch {
      if (id !== this.seq) return;
      if (this.data() && !first) this.refreshFailed.set(true);
      else this.state.set('error');
    } finally {
      if (id === this.seq) this.refreshing.set(false);
    }
  }

  protected async loadSummary(q: CalQuery = this.query()): Promise<void> {
    const id = ++this.summarySeq;
    this.summaryFailed.set(false);
    try {
      const s = await this.api.summary(q);
      if (id === this.summarySeq) this.summary.set(s);
    } catch {
      if (id === this.summarySeq) {
        this.summary.set(null);
        this.summaryFailed.set(true);
      }
    }
  }

  protected reload(): void {
    this.refreshKey.update((n) => n + 1);
  }

  /** The page's Refresh button. */
  refresh(): void {
    this.refreshKey.update((n) => n + 1);
    this.live.set('Calendar refreshed.');
  }

  // ---- address

  private go(params: Record<string, string | null>, replace = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  protected setView(view: CalView): void {
    if (view === this.view()) return;
    const keep = this.shownDay() ?? this.today();
    this.go(
      view === 'month'
        ? {
            cal: null,
            week: null,
            month: monthOf(keep) === monthOf(this.today()) ? null : monthOf(keep),
          }
        : { cal: 'week', month: null, week: keep === this.today() ? null : keep },
    );
    this.live.set(`${view === 'month' ? 'Month' : 'Week'} view.`);
  }

  protected step(by: number): void {
    if (this.view() === 'month') {
      const m = shiftMonth(this.month(), by);
      this.go({ month: m === monthOf(this.today()) ? null : m, day: null });
    } else {
      const d = addDays(this.range().dates[0], 7 * by);
      this.go({ week: weekGrid(d).includes(this.today()) ? null : d, day: null });
    }
    this.closed.set(false);
  }

  protected goToday(): void {
    this.go({ month: null, week: null, day: null });
    this.closed.set(false);
  }

  protected setRole(value: string): void {
    this.go({ role: value === ALL_ROLES ? null : value });
  }

  protected pickDay(date: string): void {
    this.closed.set(false);
    const outside = this.view() === 'month' && monthOf(date) !== this.month();
    this.go({
      day: date,
      ...(outside ? { month: monthOf(date) === monthOf(this.today()) ? null : monthOf(date) } : {}),
    });
    this.live.set(`${longDay(date)} opened.`);
  }

  protected closePanel(): void {
    // The focus goes back to the day that was open.
    const day = this.shownDay();
    this.closed.set(true);
    this.go({ day: null }, true);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-day="${day ?? this.today()}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }

  /** "Show risk days": the month (or week) of the first risk day, with that day open. */
  protected showRisk(date: string): void {
    this.closed.set(false);
    this.go(
      this.view() === 'month'
        ? { month: monthOf(date) === monthOf(this.today()) ? null : monthOf(date), day: date }
        : { week: weekGrid(date).includes(this.today()) ? null : date, day: date },
    );
    this.live.set(`Showing ${longDay(date)}.`);
  }

  // ---- out of office on behalf of someone

  protected readonly dialog = signal(false);
  protected readonly dialogUser = signal(0);
  protected readonly dialogName = signal('');
  protected readonly dialogPeople = signal<AbsencePerson[]>([]);

  protected async openAdd(): Promise<void> {
    const people = await this.peopleInView();
    if (people.length === 0) return;
    this.dialogPeople.set(people);
    this.dialogUser.set(people[0].userId);
    this.dialogName.set(people[0].name);
    this.dialog.set(true);
  }

  protected async openAddFor(who: { userId: number; name: string }): Promise<void> {
    this.dialogPeople.set(await this.peopleInView());
    this.dialogUser.set(who.userId);
    this.dialogName.set(who.name);
    this.dialog.set(true);
  }

  /** The people of the current scope and role (from one read of the day), for the Person field. */
  private async peopleInView(): Promise<AbsencePerson[]> {
    try {
      const day = await this.api.day(this.shownDay() ?? this.today(), this.query());
      const all = [...day.available, ...day.unavailable].flatMap((g) => g.people);
      return all
        .map((p) => ({ userId: p.userId, name: p.displayName }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  protected afterSave(): void {
    this.reload();
  }
}
