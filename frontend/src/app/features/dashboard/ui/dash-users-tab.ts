import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import {
  DashboardBoardClient,
  PodsClient,
  WorkloadBoard,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { UndoService } from '../../../core/notify/undo.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { mfDate } from '../../../core/time/time';
import { USERS_VIEW_PARAM } from '../dashboard-links';
import { withoutDefaults } from '../dash-url-state';
import { DashState, focusAfterRetry } from './dash-state';
import { loadPodChoices } from '../../../shared/work-queue/pod-options';
import { CoverageView } from '../users/coverage-view';
import { UsersAssign } from '../users/users-assign';
import { UsersCard } from '../users/users-card';
import { UsersDrawer } from '../users/users-drawer';
import {
  DEFAULT_FILTERS,
  Density,
  Layout,
  TabView,
  UserSort,
  UsersFilters,
  filterCount,
  filterUsers,
  LOAD_FILTERS,
  LoadFilter,
  AvailabilityFilter,
  apiAvailability,
  filtersFromParams,
  filtersToParams,
  hasFilterParams,
  isTabView,
  plural,
  podsOf,
  sameFilters,
  sortUsers,
} from '../users/users-model';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { UsersPrefs } from '../users/users-prefs';
import { UsersSummary } from '../users/users-summary';
import { UsersTable } from '../users/users-table';
import { PodOption, UsersToolbar } from '../users/users-toolbar';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/** How often the board refreshes itself while the tab is visible (as the Summary and Swimlane do). */
export const USERS_REFRESH_MS = 5 * 60_000;
/** Pause after an edit before the board is read again (several quick edits make one read). */
const EDIT_REFRESH_DELAY_MS = 900;
/** How many people are drawn at first, and with each Show more. */
export const USERS_PAGE = 200;

/**
 * Dashboard > Users tab (epic #68): the team workload. One small tile per person (or one table row; 100 or more people fit on a screen or two),
 * coloured by the highest priority of their open tasks, with a load bar split by priority, marks for overdue work, a heavy load and off hours,
 * and the whole status in the tooltip and the accessible name. Quick filter chips (Idle, Light, Normal, Heavy, Out of office, Off hours) double
 * as the legend; the toolbar adds name, pod, highest priority, availability and sort. A tile opens a drawer with that person's open tasks
 * (inline edits with Undo) and the Assign icon picks from the unassigned tasks. The filters live in the address; sort, tile size and cards or
 * table are remembered per user. The board refreshes itself every five minutes without moving focus and never while a menu, the drawer or a
 * dialog is open.
 *
 * Keyboard model: the tiles are an ordinary list in reading order with the normal tab order. Each tile has two tab stops, the person's name
 * (opens the drawer; its click area is the whole tile) and the Assign icon (shown on hover or focus). There is no arrow-key grid to learn.
 *
 * Operational capacity only: no completion counts, speed, ranking or per-person performance measures.
 */
@Component({
  selector: 'mf-dash-users-tab',
  imports: [
    NgTemplateOutlet,
    UsersToolbar,
    UsersSummary,
    UsersCard,
    UsersTable,
    UsersDrawer,
    UsersAssign,
    CoverageView,
    DashState,
    ScrollArea,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <ng-template #viewsTpl>
      @if (canCoverage()) {
        <div class="views" role="group" aria-label="Users view" data-users-views>
          <button
            type="button"
            class="mf-btn mf-btn--icon toggle"
            data-view="workload"
            aria-label="Workload"
            title="Workload: who has room and what is open"
            [attr.aria-pressed]="view() === 'workload'"
            (click)="setView('workload')"
          >
            <i class="pi pi-users" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="mf-btn mf-btn--icon toggle"
            data-view="coverage"
            aria-label="Coverage"
            title="Coverage: task types each person has completed"
            [attr.aria-pressed]="view() === 'coverage'"
            (click)="setView('coverage')"
          >
            <i class="pi pi-table" aria-hidden="true"></i>
          </button>
        </div>
      }
    </ng-template>

    @if (view() === 'workload') {
      <mf-users-toolbar
        [filters]="filters()"
        [sort]="sort()"
        [density]="density()"
        [layout]="layout()"
        [pods]="podOptions()"
        [priorities]="board()?.priorities ?? []"
        [thresholds]="board()?.thresholds ?? null"
        (filtersChange)="patchFilters($event)"
        (sortChange)="setSort($event)"
        (densityChange)="setDensity($event)"
        (layoutChange)="setLayout($event)"
      >
        <ng-container *ngTemplateOutlet="viewsTpl" />
      </mf-users-toolbar>
    } @else {
      <div class="views-row">
        <ng-container *ngTemplateOutlet="viewsTpl" />
      </div>
    }

    @if (view() === 'coverage') {
      <mf-coverage-view
        [filters]="filters()"
        [pods]="podOptions()"
        (filtersChange)="patchFilters($event)"
        (podsSeen)="coveragePods.set($event)"
      />
    } @else {
      <h2 class="sr-only" id="wl-h">Team workload</h2>
      <mf-users-summary
        [summary]="board()?.summary ?? null"
        [users]="board()?.users ?? []"
        [filters]="filters()"
        [thresholds]="board()?.thresholds ?? null"
        (loadToggle)="toggleLoad($event)"
        (availabilityToggle)="toggleAvailability($event)"
      />

      <p class="sr-only" role="status" aria-live="polite" data-users-live>{{ live() }}</p>

      @if (refreshFailed()) {
        <mf-dash-state variant="stale" [updated]="updated()" (retry)="retry()" />
      }

      <div class="body" mfScrollArea="Team workload" data-users-scroll>
        @switch (state()) {
          @case ('error') {
            <mf-dash-state
              variant="error"
              message="The team workload could not be loaded."
              (retry)="retry()"
            />
          }
          @case ('forbidden') {
            <p class="empty" role="status" data-users-forbidden>
              <i class="pi pi-lock" aria-hidden="true"></i>
              <span
                >You do not have access to the team workload. Ask a Pod Lead or a Director.</span
              >
            </p>
          }
          @case ('loading') {
            <div
              class="grid"
              role="status"
              aria-busy="true"
              aria-label="Loading the team workload"
              data-users-loading
            >
              @for (n of bones; track n) {
                <span class="bone" aria-hidden="true"></span>
              }
            </div>
          }
          @default {
            @if (users().length === 0) {
              <div class="empty" data-users-empty>
                <i class="pi pi-users" aria-hidden="true"></i>
                @if (filtered()) {
                  <span>No people match these filters.</span>
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon"
                    data-users-clear
                    aria-label="Clear filters"
                    title="Clear filters"
                    (click)="clearFilters()"
                  >
                    <i class="pi pi-filter-slash" aria-hidden="true"></i>
                  </button>
                } @else {
                  <span>There are no team members to show yet.</span>
                }
              </div>
            } @else if (layout() === 'table') {
              <mf-users-table
                [users]="shown()"
                [legend]="board()?.priorities ?? []"
                [thresholds]="board()?.thresholds ?? null"
                [density]="density()"
                [canAssign]="canAssign()"
                [sort]="sort()"
                [reversed]="sortReversed()"
                (sortRequest)="setTableSort($event)"
                (open)="openUser($event)"
                (assign)="assignTo($event)"
              />
            } @else {
              <ul
                class="grid"
                data-users-grid
                aria-labelledby="wl-h"
                [attr.data-density]="density()"
                [attr.aria-busy]="refreshing() ? 'true' : null"
              >
                @for (u of shown(); track u.userId) {
                  <li class="cell">
                    <mf-users-card
                      [user]="u"
                      [legend]="board()?.priorities ?? []"
                      [thresholds]="board()?.thresholds ?? null"
                      [density]="density()"
                      [canAssign]="canAssign()"
                      (open)="openUser($event)"
                      (assign)="assignTo($event)"
                    />
                  </li>
                }
              </ul>
            }
            @if (users().length > shown().length) {
              <p class="more" data-users-more>
                <span>Showing {{ shown().length }} of {{ users().length }} people.</span>
                <button
                  type="button"
                  class="mf-btn mf-btn--icon"
                  data-users-show-more
                  [attr.aria-label]="'Show ' + pageStep + ' more people'"
                  [attr.title]="'Show ' + pageStep + ' more people'"
                  (click)="showMore()"
                >
                  <i class="pi pi-angle-down" aria-hidden="true"></i>
                </button>
                <button
                  type="button"
                  class="mf-btn mf-btn--icon"
                  data-users-show-all
                  aria-label="Show all people"
                  title="Show all people"
                  (click)="showAll()"
                >
                  <i class="pi pi-angle-double-down" aria-hidden="true"></i>
                </button>
              </p>
            }
          }
        }
      </div>
    }

    <mf-users-drawer
      [user]="drawerUser()"
      [thresholds]="board()?.thresholds ?? null"
      [version]="version()"
      (closed)="closeDrawer()"
      (assign)="assignTo($event)"
      (tasksChanged)="scheduleRefresh()"
    />
    <mf-users-assign
      [user]="assignUser()"
      [thresholds]="board()?.thresholds ?? null"
      (closed)="closeAssign()"
      (changed)="onAssigned()"
    />
  `,
  styles: `
    :host {
      display: block;
    }
    /* Fixed-height Dashboard (#137): the toolbar and the summary strip are pinned; the tiles or the table scroll in this region (the table
       header is sticky, see the global fixed-page rules). The table's own sideways scroller gives way to this one so the header can stick. */
    .body {
      padding-bottom: var(--mf-s1);
    }
    .body ::ng-deep .wrap {
      overflow: visible;
    }
    .views {
      display: inline-flex;
      gap: var(--mf-s1);
    }
    .views-row {
      margin-bottom: var(--mf-s3);
    }
    .toggle[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
    }
    .mf-btn:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    /* Tiles of about 9rem x 3.3rem: seven or more to a line on a laptop, two on a phone. */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(9rem, 100%), 1fr));
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .grid[data-density='compact'] {
      grid-template-columns: repeat(auto-fill, minmax(min(8.5rem, 100%), 1fr));
      gap: var(--mf-s1);
    }
    .cell {
      min-width: 0;
    }
    .more {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: var(--mf-s3) 0 0;
      color: var(--mf-text-muted);
    }
    .bone {
      display: block;
      min-height: 3.2rem;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .empty {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      margin: 0;
      padding: var(--mf-s4);
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
    }
  `,
})
export class DashUsersTab implements OnInit {
  private readonly api = inject(DashboardBoardClient);
  private readonly pods = inject(PodsClient);
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly prefs = inject(UsersPrefs);
  private readonly undo = inject(UndoService);
  private readonly quiet = inject(QuietRequests);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private requestId = 0;
  private lastLoadedAt = 0;
  private retrying = false;
  private readonly workloadOkAt = signal<number | null>(null);
  /** When the figures of the view on screen were last read successfully (epoch ms); the page shows "Updated N min ago" from it once it is old (P6). */
  readonly failed = computed(() =>
    this.view() === 'coverage' ? (this.coverage()?.refreshFailed() ?? false) : this.refreshFailed(),
  );
  readonly lastOkAt = computed(() =>
    this.view() === 'coverage' ? (this.coverage()?.lastOkAt() ?? null) : this.workloadOkAt(),
  );
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private undoSeen = 0;

  protected readonly filters = signal<UsersFilters>(DEFAULT_FILTERS);
  protected readonly sort = this.prefs.sort;
  protected readonly density = this.prefs.density;
  protected readonly layout = this.prefs.layout;
  protected readonly view = signal<TabView>('workload');
  protected readonly coveragePods = signal<ReadonlyMap<number, string>>(new Map());
  protected readonly canCoverage = computed(() => this.auth.has('Dashboard.ViewCoverage'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly board = signal<WorkloadBoard | null>(null);
  /** True while a refresh is running (the Dashboard's tab row shows it on its refresh icon). */
  readonly refreshing = computed(() => this.reading() || (this.coverage()?.refreshing() ?? false));
  private readonly reading = signal(false);
  private readonly coverage = viewChild(CoverageView);
  readonly refreshFailed = signal(false);
  protected readonly live = signal('');
  protected readonly bones = Array.from({ length: 24 }, (_, i) => i);
  protected readonly version = signal(0);

  private readonly drawerId = signal<number | null>(null);
  private readonly drawerSnapshot = signal<WorkloadUser | null>(null);
  private readonly assignId = signal<number | null>(null);
  private readonly assignSnapshot = signal<WorkloadUser | null>(null);
  private readonly podChoices = signal<ReadonlyMap<number, string>>(new Map());

  private readonly params = toSignal(this.route.queryParamMap.pipe(map((p) => p)), {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly canAssign = computed(() => this.auth.has('Task.Assign'));
  protected readonly filtered = computed(() => filterCount(this.filters()) > 0);
  /** The table header reverses the order of the chosen sort; the toolbar select resets it. */
  protected readonly sortReversed = signal(false);
  protected readonly users = computed(() => {
    const sorted = sortUsers(filterUsers(this.board()?.users ?? [], this.filters()), this.sort());
    return this.sortReversed() ? sorted.reverse() : sorted;
  });
  /** A large department draws 200 people at a time (the page stays quick); Show more or Show all draws the rest. */
  protected readonly pageStep = USERS_PAGE;
  private readonly limit = signal(USERS_PAGE);
  protected readonly shown = computed(() => this.users().slice(0, this.limit()));
  readonly updated = computed(() => {
    const b = this.board();
    return b ? mfDate(b.generatedAtUtc, this.zone, 'datetime') : null;
  });

  /** The person in the drawer: the board's current copy, else the last copy seen (a refresh with a filter may drop them). */
  protected readonly drawerUser = computed<WorkloadUser | null>(() => {
    const id = this.drawerId();
    if (id === null) return null;
    return this.board()?.users.find((u) => u.userId === id) ?? this.drawerSnapshot();
  });
  protected readonly assignUser = computed<WorkloadUser | null>(() => {
    const id = this.assignId();
    if (id === null) return null;
    return this.board()?.users.find((u) => u.userId === id) ?? this.assignSnapshot();
  });

  protected readonly podOptions = computed<PodOption[]>(() => {
    const merged = new Map(this.podChoices());
    for (const [id, name] of podsOf(this.board())) merged.set(id, name);
    for (const [id, name] of this.coveragePods()) merged.set(id, name);
    const selected = this.filters().pod;
    if (selected !== null && !merged.has(selected)) merged.set(selected, `Pod ${selected}`);
    return [...merged]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  constructor() {
    void this.lookups.ensureLoaded();
    this.undoSeen = this.undo.settled();
    // An Undo changed what the cards count: read the board again.
    effect(() => {
      const n = this.undo.settled();
      untracked(() => {
        if (n === this.undoSeen) return;
        this.undoSeen = n;
        if (this.view() === 'workload' && this.state() === 'ready') this.load({ silent: true });
      });
    });
    // The address changed under us (Back, a pasted link): follow it.
    effect(() => {
      const params = this.params();
      untracked(() => {
        if (!hasFilterParams(params)) {
          if (!sameFilters(this.filters(), DEFAULT_FILTERS) && this.initialised) {
            this.filters.set(DEFAULT_FILTERS);
            if (this.view() === 'workload') this.load();
          }
          return;
        }
        const next = filtersFromParams(params);
        if (sameFilters(next, this.filters())) return;
        this.filters.set(next);
        if (this.view() === 'workload') this.load();
      });
    });
    this.destroyRef.onDestroy(() => {
      if (this.editTimer) clearTimeout(this.editTimer);
    });
  }

  private initialised = false;

  ngOnInit(): void {
    this.prefs.ensureLoaded();
    this.filters.set(filtersFromParams(this.route.snapshot.queryParamMap));
    const asked = this.route.snapshot.queryParamMap.get(USERS_VIEW_PARAM);
    const wanted = isTabView(asked) ? asked : this.prefs.view();
    this.view.set(wanted === 'coverage' && this.canCoverage() ? 'coverage' : 'workload');
    // A link that names the view (even the default one) is what the person wants: remember it, so the address can leave the default out.
    if (isTabView(asked)) this.prefs.remember({ view: this.view() });
    this.initialised = true;
    if (this.view() === 'workload') this.load();
    else if ([null, 'users'].includes(this.route.snapshot.queryParamMap.get('tab')))
      void this.writeUrl();
    this.startAutoRefresh();
    void this.loadPods();
  }

  // ---- the view

  protected patchFilters(patch: Partial<UsersFilters>): void {
    const before = this.filters();
    const next = { ...before, ...patch };
    if (sameFilters(next, before)) return;
    this.limit.set(USERS_PAGE);
    this.filters.set(next);
    void this.writeUrl();
    if (this.view() === 'coverage') {
      // The coverage view reads again when the pod changes; the name filter is applied on the page.
      return;
    }
    // Load, priority and off hours are applied on the page; the rest is a new read.
    if (
      next.pod === before.pod &&
      next.q === before.q &&
      apiAvailability(next) === apiAvailability(before)
    ) {
      this.live.set(`${plural(this.users().length, 'person', 'people')} shown.`);
      return;
    }
    this.load({ silent: !!this.board() });
  }

  /** Workload or Coverage (the address carries `view=coverage`; the choice is remembered). */
  protected setView(view: TabView): void {
    if (view === this.view()) return;
    if (view === 'coverage' && !this.canCoverage()) return;
    this.view.set(view);
    this.prefs.remember({ view });
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [USERS_VIEW_PARAM]: view === 'coverage' ? 'coverage' : null,
      },
      queryParamsHandling: 'merge',
    });
    if (view === 'workload') this.load({ silent: !!this.board() });
  }

  /** A load chip: on or off (the chips combine). */
  protected toggleLoad(level: LoadFilter): void {
    const on = new Set(this.filters().load);
    if (!on.delete(level)) on.add(level);
    this.patchFilters({ load: LOAD_FILTERS.filter((l) => on.has(l)) });
  }

  /** The Out of office and Off hours chips: the availability filter, on or off. */
  protected toggleAvailability(value: AvailabilityFilter): void {
    this.patchFilters({ availability: this.filters().availability === value ? 'all' : value });
  }

  protected clearFilters(): void {
    this.patchFilters({ ...DEFAULT_FILTERS });
  }

  protected showMore(): void {
    this.limit.update((n) => n + USERS_PAGE);
  }

  protected showAll(): void {
    this.limit.set(Number.MAX_SAFE_INTEGER);
  }

  /** A click on a table header: another column sorts by it, the same column reverses the order. */
  protected setTableSort(request: { sort: UserSort; reversed: boolean }): void {
    if (request.sort !== this.sort()) this.setSort(request.sort);
    this.sortReversed.set(request.reversed);
  }

  protected setSort(sort: UserSort): void {
    this.sortReversed.set(false);
    this.limit.set(USERS_PAGE);
    this.prefs.remember({ sort });
    this.live.set(
      `Sorted by ${{ load: 'availability and load', name: 'name', priority: 'highest priority', open: 'open tasks' }[sort]}.`,
    );
  }

  protected setDensity(density: Density): void {
    this.prefs.remember({ density });
  }

  protected setLayout(layout: Layout): void {
    this.prefs.remember({ layout });
  }

  private writeUrl(): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: withoutDefaults('users', {
        ...filtersToParams(this.filters()),
        [USERS_VIEW_PARAM]: this.view() === 'coverage' ? 'coverage' : null,
      }),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- loading

  /** Reads the board (or the coverage matrix) again now; the Dashboard's refresh icon in the tab row calls this. */
  refresh(): void {
    if (this.view() === 'coverage') {
      this.coverage()?.refresh();
      return;
    }
    if (this.refreshing()) return;
    this.load({ silent: true, announce: true });
  }

  protected load(options: { silent?: boolean; announce?: boolean } = {}): void {
    const { silent = false, announce = false } = options;
    const id = ++this.requestId;
    const background = silent && !!this.board();
    if (background) this.reading.set(true);
    else {
      this.state.set('loading');
      this.refreshFailed.set(false);
    }
    const f = this.filters();
    const start = () =>
      this.api
        .getDashboardWorkload(f.pod ?? undefined, apiAvailability(f), f.q || undefined)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (board) => {
            if (id !== this.requestId) return;
            this.board.set(board);
            this.state.set('ready');
            this.reading.set(false);
            this.refreshFailed.set(false);
            this.lastLoadedAt = this.clock.now().getTime();
            this.workloadOkAt.set(this.lastLoadedAt);
            this.finishRetry('ready');
            if (announce) {
              this.live.set(
                `Team workload refreshed. ${plural(board.users.length, 'person', 'people')}.`,
              );
            }
          },
          error: (error: unknown) => {
            if (id !== this.requestId) return;
            this.reading.set(false);
            if (error instanceof ApiError && error.status === 403) {
              this.state.set('forbidden');
              return;
            }
            // A failed background read keeps the cards on screen; only a first load shows the error state.
            if (this.board()) this.refreshFailed.set(true);
            else this.state.set('error');
            this.finishRetry('failed');
          },
        });
    if (background) this.quiet.run(start);
    else this.quiet.runInline(start);
  }

  /** The Retry of the error or stale state: reads again and puts the focus where P7 says when the answer is in. */
  protected retry(): void {
    this.retrying = true;
    if (this.board()) this.refresh();
    else this.load();
  }

  private finishRetry(outcome: 'ready' | 'failed'): void {
    if (!this.retrying) return;
    this.retrying = false;
    focusAfterRetry(this.host.nativeElement, this.injector, outcome);
  }

  private async loadPods(): Promise<void> {
    if (!this.auth.has('Pod.View')) return;
    const choices = await loadPodChoices(this.pods, true);
    this.podChoices.set(new Map(choices.options.map((o) => [o.id, o.name] as const)));
  }

  /** An edit in the drawer or an assignment changed what the cards count: read the board again shortly (several quick edits make one read). */
  protected scheduleRefresh(): void {
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      // Not under an inline menu that was opened meanwhile: look again a little later.
      if (document.querySelector('.im-pop')) {
        this.scheduleRefresh();
        return;
      }
      this.load({ silent: true });
    }, EDIT_REFRESH_DELAY_MS);
  }

  // ---- the drawer and the assign picker

  protected openUser(user: WorkloadUser): void {
    this.drawerSnapshot.set(user);
    this.drawerId.set(user.userId);
  }

  protected closeDrawer(): void {
    const id = this.drawerId();
    this.drawerId.set(null);
    this.drawerSnapshot.set(null);
    if (id !== null) this.restoreFocus(id);
  }

  /** Focus goes back to the card that opened the drawer (its name button). */
  private restoreFocus(id: number): void {
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body && !active.closest('.p-dialog-mask')) return;
        this.host.nativeElement
          .querySelector<HTMLElement>(`[id="wl-open-${id}"]`)
          ?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  protected assignTo(user: WorkloadUser): void {
    this.assignSnapshot.set(user);
    this.assignId.set(user.userId);
  }

  protected closeAssign(): void {
    this.assignId.set(null);
    this.assignSnapshot.set(null);
  }

  /** Work was assigned or an assignment undone: the open drawer lists the tasks again and the board is read again. */
  protected onAssigned(): void {
    this.version.update((n) => n + 1);
    this.scheduleRefresh();
  }

  // ---- automatic refresh

  private startAutoRefresh(): void {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // Never swap cards under an open menu, dialog or the drawer.
      if (this.drawerId() !== null || this.assignId() !== null || this.refreshing()) return;
      if (document.querySelector('.im-pop, .p-dialog-mask')) return;
      if (this.view() === 'workload' && this.state() === 'ready') this.load({ silent: true });
    };
    const timer = setInterval(tick, USERS_REFRESH_MS);
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        this.clock.now().getTime() - this.lastLoadedAt >= USERS_REFRESH_MS
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
