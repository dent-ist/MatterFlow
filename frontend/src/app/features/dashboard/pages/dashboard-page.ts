import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  DashboardBreakdownItem,
  DashboardClient,
  DashboardSummary,
  TaskQueueClient,
  TaskQueueRow,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { mfDate } from '../../../core/time/time';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PageHeader } from '../../../shared/ui/page-header';
import { priorityColors } from '../../../shared/ui/priority-badge';
import { queueArgsFor } from '../dashboard-links';
import { PERIOD_PRESETS, PeriodKey, isPeriodKey, periodDays, presetOf } from '../dashboard-period';
import { DashboardPrefs } from '../dashboard-prefs';
import { BarItem, BarList } from '../ui/bar-list';
import { DashSection } from '../ui/dash-section';
import { RecentTaskList } from '../ui/recent-task-list';
import { Segment, StackedBar } from '../ui/stacked-bar';
import { StatTile } from '../ui/stat-tile';
import { DashTaskList, PanelState } from '../ui/task-list-panel';
import { TrendChart } from '../ui/trend-chart';

type LoadState = 'loading' | 'ready' | 'error';
type ListKind = 'unassigned' | 'overdue' | 'dueSoon';
type SectionName = 'department' | 'lists' | 'mine' | 'trend' | 'breakdowns' | 'recent';

interface ListData {
  state: PanelState;
  rows: TaskQueueRow[];
  total: number;
}

/** How often the page refreshes itself while the tab is visible. */
export const AUTO_REFRESH_MS = 5 * 60_000;
/** Pause after an inline edit before the counts are read again (several quick edits make one read). */
const COUNT_REFRESH_DELAY_MS = 700;

const LIST_SIZE: Record<ListKind, number> = { unassigned: 8, overdue: 6, dueSoon: 6 };
const EMPTY_LIST: ListData = { state: 'loading', rows: [], total: 0 };

/** Glossary: sentence case ("No pod", "Other pods"); the API still sends some Title Case labels. */
function sentence(label: string): string {
  if (label === 'No Pod') return 'No pod';
  if (label === 'Other Pods') return 'Other pods';
  if (label === 'Other Task Types') return 'Other task types';
  return label;
}

function toBars(items: readonly DashboardBreakdownItem[]): BarItem[] {
  return items.map((i) => ({
    label: sentence(i.label),
    count: i.count,
    query: i.query ?? null,
    tone: i.code ?? null,
    muted: i.isOther,
  }));
}

/**
 * Dashboard (UX S01, baseline 12.2): action first. "Needs attention" counts, the oldest unassigned tasks with inline assignment, the
 * overdue and due-soon lists, then the overview, trend and breakdowns. Everything that counts tasks is a link to `/tasks` carrying the
 * query the API computed for that number. Department figures need `Dashboard.ViewDepartment`; "Your work" is for everyone. The order
 * follows the role (technicians start with their own work), sections can be collapsed (remembered per user), and the page refreshes
 * itself every five minutes while visible without moving the page. Operational counts only: no billing, hours or per-person scores.
 */
@Component({
  selector: 'mf-dashboard-page',
  imports: [
    PageHeader,
    ErrorReference,
    BarList,
    StackedBar,
    TrendChart,
    DashSection,
    DashTaskList,
    HasPermissionDirective,
    RecentTaskList,
    RouterLink,
    StatTile,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-page-header heading="Dashboard">
      <div mfActions class="controls">
        <label class="period">
          <span>Created and completed</span>
          <select
            class="mf-control"
            data-period
            [value]="period()"
            (change)="setPeriod($any($event.target).value)"
          >
            @for (p of periods; track p.key) {
              <option [value]="p.key" [selected]="p.key === period()">{{ p.label }}</option>
            }
          </select>
        </label>
        <button
          type="button"
          class="mf-btn refresh"
          data-refresh
          (click)="refresh()"
          [disabled]="refreshing()"
        >
          <i
            class="pi"
            [class]="refreshing() ? 'pi-spin pi-spinner' : 'pi-refresh'"
            aria-hidden="true"
          ></i>
          Refresh
        </button>
        @if (updated(); as u) {
          <span class="updated" data-updated>
            Updated {{ u }}<span class="auto"> · refreshes every 5 minutes</span>
          </span>
        }
      </div>
    </mf-page-header>

    @if (refreshFailed()) {
      <p class="stale" role="status" data-stale>
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        The dashboard could not be refreshed. Showing the figures from {{ updated() }}.
      </p>
    }

    @switch (state()) {
      @case ('loading') {
        <div class="skeletons" role="status" aria-busy="true" aria-label="Loading the dashboard">
          @for (n of skeletonTiles; track n) {
            <div class="skeleton"></div>
          }
        </div>
      }
      @case ('error') {
        <div class="alert" role="alert" data-error>
          <span>The dashboard could not be loaded.</span>
          <mf-error-reference />
          <button type="button" class="mf-btn" (click)="load()">Retry</button>
        </div>
      }
      @default {
        @if (data(); as d) {
          @if (isEmpty()) {
            <div class="empty" data-empty>
              <p>No tasks yet.</p>
              <a *mfHasPermission="'Task.Create'" class="cta" routerLink="/tasks/new">
                Create the first task
              </a>
            </div>
          } @else {
            @for (name of order(); track name) {
              @switch (name) {
                @case ('department') {
                  <mf-dash-section heading="Department" name="department">
                    <div role="group" aria-labelledby="attn-h" class="group" data-group="attention">
                      <h3 id="attn-h">Needs attention</h3>
                      <div class="tiles">
                        <mf-stat-tile
                          label="Overdue"
                          icon="pi-exclamation-circle"
                          tone="danger"
                          emphasis="attention"
                          linkText="View overdue tasks"
                          [value]="d.overdue.count"
                          [query]="d.overdue.query"
                          caption="Excludes ASAP tasks"
                        />
                        <mf-stat-tile
                          label="Unassigned"
                          icon="pi-user-minus"
                          tone="warning"
                          emphasis="attention"
                          linkText="View unassigned tasks"
                          [value]="d.unassigned.count"
                          [query]="d.unassigned.query"
                          caption="No person assigned"
                        />
                        <mf-stat-tile
                          label="On hold"
                          icon="pi-pause-circle"
                          tone="info"
                          emphasis="attention"
                          linkText="View tasks on hold"
                          [value]="d.onHold.count"
                          [query]="d.onHold.query"
                          caption="Waiting on something"
                        />
                        <mf-stat-tile
                          label="ASAP open"
                          icon="pi-bolt"
                          tone="warning"
                          emphasis="attention"
                          linkText="View ASAP tasks"
                          [value]="d.asapOpen.count"
                          [query]="d.asapOpen.query"
                          caption="No due date, handle promptly"
                        />
                      </div>
                    </div>
                    <div role="group" aria-labelledby="ov-h" class="group" data-group="overview">
                      <h3 id="ov-h">Overview</h3>
                      <div class="tiles">
                        <mf-stat-tile
                          label="Open"
                          emphasis="quiet"
                          linkText="View open tasks"
                          [value]="d.open.count"
                          [query]="d.open.query"
                          caption="New, in progress and on hold"
                        />
                        <mf-stat-tile
                          label="Due soon"
                          emphasis="quiet"
                          linkText="View tasks due soon"
                          [value]="d.dueSoon.count"
                          [query]="d.dueSoon.query"
                          caption="Next 2 days, excludes ASAP"
                        />
                        <mf-stat-tile
                          label="Completed"
                          emphasis="quiet"
                          linkText="View completed tasks"
                          [value]="d.completed.count"
                          [query]="d.completed.query"
                          [caption]="periodCaption()"
                        />
                        <mf-stat-tile
                          label="Created"
                          emphasis="quiet"
                          linkText="View created tasks"
                          [value]="d.created.count"
                          [query]="d.created.query"
                          [caption]="periodCaption()"
                        />
                      </div>
                    </div>
                  </mf-dash-section>
                }
                @case ('lists') {
                  <mf-dash-section heading="Tasks to act on" name="lists" key="lists">
                    <div class="grid grid--lists" data-lists>
                      <mf-dash-task-list
                        kind="unassigned"
                        heading="Unassigned queue"
                        emptyText="No unassigned tasks."
                        viewAllText="View all unassigned tasks"
                        [rows]="unassignedList().rows"
                        [total]="unassignedList().total"
                        [state]="unassignedList().state"
                        [query]="d.unassigned.query"
                        (rowChange)="onRowChange('unassigned', $event)"
                        (retry)="reloadList('unassigned')"
                      />
                      <mf-dash-task-list
                        kind="overdue"
                        heading="Overdue"
                        emptyText="Nothing is overdue."
                        viewAllText="View all overdue tasks"
                        [rows]="overdueList().rows"
                        [total]="overdueList().total"
                        [state]="overdueList().state"
                        [query]="d.overdue.query"
                        (retry)="reloadList('overdue')"
                      />
                      <mf-dash-task-list
                        kind="dueSoon"
                        heading="Due soon"
                        emptyText="Nothing is due in the next 2 days."
                        viewAllText="View all tasks due soon"
                        [rows]="dueSoonList().rows"
                        [total]="dueSoonList().total"
                        [state]="dueSoonList().state"
                        [query]="d.dueSoon.query"
                        (retry)="reloadList('dueSoon')"
                      />
                    </div>
                  </mf-dash-section>
                }
                @case ('mine') {
                  <mf-dash-section heading="Your work" name="mine" key="mine">
                    <a mfSectionActions routerLink="/my-work" class="head-link">Go to My Work</a>
                    @if (d.mine.open.count === 0) {
                      <div class="nothing" data-nothing-assigned>
                        <p><strong>Nothing assigned to you.</strong></p>
                        <p>
                          @if (canPodWork()) {
                            <a routerLink="/pods/work">Browse Pod Work</a> to pick up work.
                          } @else {
                            <a routerLink="/tasks">Browse the Task Queue</a> to pick up work.
                          }
                        </p>
                      </div>
                      @if (d.mine.createdByMe.count > 0) {
                        <div class="tiles tiles--one">
                          <mf-stat-tile
                            label="Created by me"
                            emphasis="quiet"
                            [value]="d.mine.createdByMe.count"
                            [query]="d.mine.createdByMe.query"
                            [caption]="periodCaption()"
                          />
                        </div>
                      }
                    } @else {
                      <div class="tiles">
                        <mf-stat-tile
                          label="My open tasks"
                          [value]="d.mine.open.count"
                          [query]="d.mine.open.query"
                          linkText="View my open tasks"
                        />
                        <mf-stat-tile
                          label="My overdue"
                          icon="pi-exclamation-circle"
                          tone="danger"
                          [value]="d.mine.overdue.count"
                          [query]="d.mine.overdue.query"
                          caption="Excludes ASAP tasks"
                          linkText="View my overdue tasks"
                        />
                        <mf-stat-tile
                          label="My due soon"
                          [value]="d.mine.dueSoon.count"
                          [query]="d.mine.dueSoon.query"
                          caption="Due in the next 2 days"
                          linkText="View my tasks due soon"
                        />
                        <mf-stat-tile
                          label="Created by me"
                          [value]="d.mine.createdByMe.count"
                          [query]="d.mine.createdByMe.query"
                          [caption]="periodCaption()"
                        />
                      </div>
                    }
                  </mf-dash-section>
                }
                @case ('trend') {
                  <mf-dash-section heading="Created and completed" name="trend" key="trend">
                    <mf-trend-chart
                      heading="Tasks created and completed per day"
                      [caption]="
                        periodCaption() + '. The period control at the top applies to this chart.'
                      "
                      [points]="d.trend"
                      [createdQuery]="d.created.query"
                      [completedQuery]="d.completed.query"
                    />
                  </mf-dash-section>
                }
                @case ('breakdowns') {
                  <mf-dash-section heading="Open tasks by" name="breakdowns" key="breakdowns">
                    <div class="grid" data-grid="breakdowns">
                      <mf-bar-list
                        heading="Open by pod"
                        rowHeading="Pod"
                        [items]="pods()"
                        emptyText="No open tasks."
                      />
                      <mf-bar-list
                        heading="Open by priority"
                        rowHeading="Priority"
                        [items]="priorities()"
                        emptyText="No open tasks."
                      />
                      <mf-bar-list
                        heading="Open by task type"
                        rowHeading="Task type"
                        [items]="types()"
                        emptyText="No open tasks."
                      />
                      <mf-bar-list
                        heading="Open by status"
                        rowHeading="Status"
                        [items]="statuses()"
                        emptyText="No open tasks."
                      />
                      <div class="wide">
                        <mf-stacked-bar
                          heading="Age of open tasks"
                          rowHeading="Age"
                          [segments]="aging()"
                          emptyText="No open tasks."
                          note="Days since the task was created. Informational, not a service-level target."
                        />
                      </div>
                    </div>
                  </mf-dash-section>
                }
                @case ('recent') {
                  <mf-dash-section heading="Recent activity" name="recent" key="recent">
                    <div class="grid" data-grid="recent">
                      <mf-recent-task-list
                        heading="Recently created"
                        [tasks]="d.recentlyCreated"
                        emptyText="No tasks created yet."
                      />
                      <mf-recent-task-list
                        heading="Recently completed"
                        [tasks]="d.recentlyCompleted"
                        emptyText="No tasks completed yet."
                      />
                    </div>
                  </mf-dash-section>
                }
              }
            }
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    h3 {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
      color: var(--mf-text-muted);
    }
    .group + .group {
      margin-top: var(--mf-s4);
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
    }
    .period {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .updated {
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .stale {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s4);
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border: 1px solid var(--mf-warning);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
    }
    .head-link {
      font-size: var(--mf-fs-sm);
      color: var(--mf-link);
    }
    .tiles,
    .skeletons {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mf-s3);
    }
    .tiles--one {
      margin-top: var(--mf-s3);
    }
    .nothing {
      padding: var(--mf-s4);
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
    }
    .nothing p {
      margin: 0 0 var(--mf-s1);
    }
    .nothing strong {
      color: var(--mf-text);
    }
    .nothing a {
      color: var(--mf-link);
    }
    /* Tablet: two columns. Phone: one. */
    @media (max-width: 900px) {
      .tiles,
      .skeletons {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 560px) {
      .tiles,
      .skeletons {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s4);
    }
    .grid--lists {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr));
    }
    .wide {
      grid-column: 1 / -1;
    }
    @media (max-width: 900px) {
      .grid:not(.grid--lists) {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .skeleton {
      height: 7rem;
      background: var(--mf-surface-alt);
      border-radius: var(--mf-radius-lg);
    }
    .alert {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      color: var(--mf-danger);
      background: var(--mf-danger-bg);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
    }
    .empty {
      padding: var(--mf-s6) var(--mf-s4);
      text-align: center;
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
    }
    .cta {
      display: inline-block;
      padding: var(--mf-s2) var(--mf-s4);
      color: #fff;
      background: var(--mf-primary);
      border-radius: var(--mf-radius);
      text-decoration: none;
    }
    .cta:hover {
      background: var(--mf-primary-hover);
    }
    @media (max-width: 560px) {
      .auto {
        display: none;
      }
    }
  `,
})
export class DashboardPage implements OnInit {
  private readonly api = inject(DashboardClient);
  private readonly queue = inject(TaskQueueClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly prefs = inject(DashboardPrefs);
  private requestId = 0;
  private readonly listIds: Record<ListKind, number> = { unassigned: 0, overdue: 0, dueSoon: 0 };
  private countTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLoadedAt = 0;

  protected readonly periods = PERIOD_PRESETS;
  protected readonly skeletonTiles = [1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly period = this.prefs.period;
  protected readonly state = signal<LoadState>('loading');
  protected readonly data = signal<DashboardSummary | null>(null);
  protected readonly refreshing = signal(false);
  protected readonly refreshFailed = signal(false);

  private readonly lists = {
    unassigned: signal<ListData>(EMPTY_LIST),
    overdue: signal<ListData>(EMPTY_LIST),
    dueSoon: signal<ListData>(EMPTY_LIST),
  };
  protected readonly unassignedList = this.lists.unassigned.asReadonly();
  protected readonly overdueList = this.lists.overdue.asReadonly();
  protected readonly dueSoonList = this.lists.dueSoon.asReadonly();

  protected readonly department = computed(() => this.auth.has('Dashboard.ViewDepartment'));
  protected readonly canPodWork = computed(() => this.auth.has('Pod.View'));
  /** Technicians start with their own work; people with the department view start with the department. */
  protected readonly order = computed<SectionName[]>(() =>
    this.department() ? ['department', 'lists', 'mine', 'trend', 'breakdowns', 'recent'] : ['mine'],
  );

  protected readonly periodCaption = computed(() => presetOf(this.period()).caption);
  protected readonly updated = computed(() => {
    const d = this.data();
    return d ? mfDate(d.generatedAtUtc, this.zone, 'datetime') : null;
  });
  /**
   * No tasks at all: nothing created yet and nothing open (the recent list is not limited to the period). Only meaningful for people who
   * may see department figures: for everyone else the server returns zeros for the department, which must not read as "no tasks yet".
   */
  protected readonly isEmpty = computed(() => {
    const d = this.data();
    return this.department() && !!d && d.recentlyCreated.length === 0 && d.open.count === 0;
  });
  protected readonly pods = computed(() => toBars(this.data()?.byPod ?? []));
  protected readonly types = computed(() => toBars(this.data()?.byTaskType ?? []));
  protected readonly statuses = computed(() => toBars(this.data()?.byStatus ?? []));
  /** In priority order (most urgent first, as the API sends them), coloured like the priority badges. */
  protected readonly priorities = computed<BarItem[]>(() => {
    const store = this.lookups.priorities();
    return (this.data()?.byPriority ?? []).map((i) => {
      const found = store.find((p) => p.id === i.id);
      const colors = priorityColors(found?.color);
      return {
        label: i.label,
        count: i.count,
        query: i.query ?? null,
        fill: colors.bg,
        outline: colors.fg,
      };
    });
  });
  protected readonly aging = computed<Segment[]>(() =>
    (this.data()?.aging ?? []).map((b) => ({ label: b.label, count: b.count, query: b.query })),
  );

  constructor() {
    void this.lookups.ensureLoaded();
    this.destroyRef.onDestroy(() => {
      if (this.countTimer) clearTimeout(this.countTimer);
    });
  }

  ngOnInit(): void {
    this.prefs.ensureLoaded();
    this.load();
    this.startAutoRefresh();
  }

  protected setPeriod(value: string): void {
    if (!isPeriodKey(value) || value === this.period()) return;
    this.prefs.setPeriod(value as PeriodKey);
    this.refreshNumbers();
  }

  /** The Refresh button: reads everything again now, bypassing the short server cache, and keeps the page where it is. */
  protected refresh(): void {
    this.load({ silent: true, fresh: true });
  }

  /** Counts only (after a period change or an inline edit): the lists keep what they show. */
  private refreshNumbers(): void {
    this.load({ silent: true, fresh: true, lists: false });
  }

  protected load(options: { silent?: boolean; fresh?: boolean; lists?: boolean } = {}): void {
    const { silent = false, fresh = false, lists = true } = options;
    const id = ++this.requestId;
    if (silent && this.data()) this.refreshing.set(true);
    else {
      this.state.set('loading');
      this.refreshFailed.set(false);
    }
    const days = periodDays(this.period(), this.clock.now(), this.zone);
    this.api
      .getDashboard(days, fresh ? true : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          if (id !== this.requestId) return;
          this.data.set(summary);
          this.state.set('ready');
          this.refreshing.set(false);
          this.refreshFailed.set(false);
          this.lastLoadedAt = this.clock.now().getTime();
          if (lists && this.department()) this.loadLists(summary, silent);
        },
        error: () => {
          if (id !== this.requestId) return;
          this.refreshing.set(false);
          // A failed background refresh keeps the figures on screen; only a first load shows the error state.
          if (this.data()) this.refreshFailed.set(true);
          else this.state.set('error');
        },
      });
  }

  // ---- lists

  private loadLists(summary: DashboardSummary, silent: boolean): void {
    this.fetchList('unassigned', summary.unassigned.query, 'created', 'asc', silent);
    this.fetchList('overdue', summary.overdue.query, 'due', 'asc', silent);
    this.fetchList('dueSoon', summary.dueSoon.query, 'due', 'asc', silent);
  }

  protected reloadList(kind: ListKind): void {
    const d = this.data();
    if (!d) return;
    const spec = {
      unassigned: [d.unassigned.query, 'created'],
      overdue: [d.overdue.query, 'due'],
      dueSoon: [d.dueSoon.query, 'due'],
    } as const;
    this.fetchList(kind, spec[kind][0], spec[kind][1], 'asc', false);
  }

  private fetchList(
    kind: ListKind,
    query: string,
    sort: string,
    dir: 'asc' | 'desc',
    silent: boolean,
  ): void {
    const list = this.lists[kind];
    const id = ++this.listIds[kind];
    // A background refresh keeps the rows on screen; only a first load (or a retry) shows the skeleton.
    if (!silent || list().state !== 'ready') list.update((v) => ({ ...v, state: 'loading' }));
    this.queue
      .getTaskQueue(...queueArgsFor(query, sort, dir, LIST_SIZE[kind]))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          if (id === this.listIds[kind]) {
            list.set({ state: 'ready', rows: page.items, total: page.total });
          }
        },
        error: () => {
          if (id === this.listIds[kind]) {
            list.update((v) => (silent && v.rows.length > 0 ? v : { ...v, state: 'error' }));
          }
        },
      });
  }

  /** An inline edit changed a row: show it at once and read the counts again shortly (the row stays until the next list refresh). */
  protected onRowChange(kind: ListKind, row: TaskQueueRow): void {
    this.lists[kind].update((v) => ({
      ...v,
      rows: v.rows.map((r) => (r.taskId === row.taskId ? row : r)),
    }));
    if (this.countTimer) clearTimeout(this.countTimer);
    this.countTimer = setTimeout(() => {
      this.countTimer = null;
      this.refreshNumbers();
    }, COUNT_REFRESH_DELAY_MS);
  }

  // ---- automatic refresh

  private startAutoRefresh(): void {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // Do not swap rows under an open menu.
      if (typeof document !== 'undefined' && document.querySelector('mf-dash-task-list .im-pop')) {
        return;
      }
      if (this.state() === 'ready') this.load({ silent: true });
    };
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    // Back on the tab after a long absence: catch up at once instead of waiting for the next tick.
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        this.clock.now().getTime() - this.lastLoadedAt >= AUTO_REFRESH_MS
      ) {
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }
}
