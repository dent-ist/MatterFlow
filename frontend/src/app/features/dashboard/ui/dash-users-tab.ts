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
} from '@angular/core';
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
import { ErrorReference } from '../../../shared/ui/error-reference';
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
  filtersFromParams,
  filtersToParams,
  hasFilterParams,
  isTabView,
  plural,
  podsOf,
  sameFilters,
  sortUsers,
} from '../users/users-model';
import { UsersPrefs } from '../users/users-prefs';
import { UsersSummary } from '../users/users-summary';
import { UsersTable } from '../users/users-table';
import { PodOption, UsersToolbar } from '../users/users-toolbar';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/** How often the board refreshes itself while the tab is visible (as the Summary and Swimlane do). */
export const USERS_REFRESH_MS = 5 * 60_000;
/** Pause after an edit before the board is read again (several quick edits make one read). */
const EDIT_REFRESH_DELAY_MS = 900;

/**
 * Dashboard > Users tab (epic #68): the team workload. One card per person (or one table row), coloured by the highest priority of their
 * open tasks, with availability (Available, Off hours, Out of office until a date), a count per priority, open, overdue, due soon, on hold,
 * next due and a Free, Light, Normal or Heavy load. A summary strip counts who is free, busy or away and the unassigned tasks. A card opens
 * a drawer with that person's open tasks (inline edits with Undo) and "Assign work" picks from the unassigned tasks. The filters (pod,
 * availability, name) live in the address; sort, density and cards or table are remembered per user. The board refreshes itself every five
 * minutes without moving focus and never while a menu, the drawer or a dialog is open.
 *
 * Keyboard model: the cards are an ordinary list in reading order with the normal tab order. Each card has two tab stops, the person's name
 * (opens the drawer; its click area is the whole card) and "Assign work". There is no arrow-key grid to learn.
 *
 * Operational capacity only: no completion counts, speed, ranking or per-person performance measures.
 */
@Component({
  selector: 'mf-dash-users-tab',
  imports: [
    UsersToolbar,
    UsersSummary,
    UsersCard,
    UsersTable,
    UsersDrawer,
    UsersAssign,
    CoverageView,
    ErrorReference,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canCoverage()) {
      <div class="views" role="group" aria-label="Users view" data-users-views>
        <button
          type="button"
          class="mf-btn toggle"
          data-view="workload"
          [attr.aria-pressed]="view() === 'workload'"
          (click)="setView('workload')"
        >
          <i class="pi pi-users" aria-hidden="true"></i>Workload
        </button>
        <button
          type="button"
          class="mf-btn toggle"
          data-view="coverage"
          [attr.aria-pressed]="view() === 'coverage'"
          (click)="setView('coverage')"
        >
          <i class="pi pi-table" aria-hidden="true"></i>Coverage
        </button>
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
      <p class="frame" data-frame>
        <i class="pi pi-info-circle" aria-hidden="true"></i>
        <span>
          Operational capacity only: who has room and what is open. It does not measure completed
          work, speed or performance, and it does not rank people.
        </span>
      </p>

      <mf-users-summary
        [summary]="board()?.summary ?? null"
        [outOnly]="filters().availability === 'out'"
        (toggleOut)="toggleOut()"
      />

      <mf-users-toolbar
        [filters]="filters()"
        [sort]="sort()"
        [density]="density()"
        [layout]="layout()"
        [pods]="podOptions()"
        [priorities]="board()?.priorities ?? []"
        [thresholds]="board()?.thresholds ?? null"
        [updated]="updated()"
        [refreshing]="refreshing()"
        (filtersChange)="patchFilters($event)"
        (sortChange)="setSort($event)"
        (densityChange)="setDensity($event)"
        (layoutChange)="setLayout($event)"
        (refresh)="refresh()"
      />

      <p class="sr-only" role="status" aria-live="polite" data-users-live>{{ live() }}</p>

      @if (refreshFailed()) {
        <div class="stale" role="status" data-users-stale>
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <span>
            The team workload could not be refreshed. Showing the figures from {{ updated() }}.
            <mf-error-reference />
          </span>
          <button type="button" class="mf-btn" data-users-stale-retry (click)="refresh()">
            Retry
          </button>
        </div>
      }

      @switch (state()) {
        @case ('error') {
          <div class="alert" role="alert" data-users-error>
            <span>The team workload could not be loaded.</span>
            <mf-error-reference />
            <button type="button" class="mf-btn" data-users-retry (click)="load()">Retry</button>
          </div>
        }
        @case ('forbidden') {
          <p class="empty" role="status" data-users-forbidden>
            <i class="pi pi-lock" aria-hidden="true"></i>
            <span>You do not have access to the team workload. Ask a Pod Lead or a Director.</span>
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
                <button type="button" class="mf-btn" data-users-clear (click)="clearFilters()">
                  Clear filters
                </button>
              } @else {
                <span>There are no team members to show yet.</span>
              }
            </div>
          } @else if (layout() === 'table') {
            <mf-users-table
              [users]="users()"
              [legend]="board()?.priorities ?? []"
              [thresholds]="board()?.thresholds ?? null"
              [density]="density()"
              [canAssign]="canAssign()"
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
              @for (u of users(); track u.userId) {
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
        }
      }
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
    .views {
      display: inline-flex;
      gap: var(--mf-s1);
      margin-bottom: var(--mf-s3);
    }
    .toggle[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
      font-weight: 600;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .frame {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(19rem, 100%), 1fr));
      gap: var(--mf-s3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .grid[data-density='compact'] {
      grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
      gap: var(--mf-s2);
    }
    .cell {
      min-width: 0;
    }
    .bone {
      display: block;
      min-height: 14rem;
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
    .stale {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border: 1px solid var(--mf-warning);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
    }
    .stale span {
      flex: 1;
    }
    .alert {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      color: var(--mf-danger);
      background: var(--mf-danger-bg);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
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
  protected readonly refreshing = signal(false);
  protected readonly refreshFailed = signal(false);
  protected readonly live = signal('');
  protected readonly bones = [1, 2, 3, 4, 5, 6];
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
  protected readonly users = computed(() => sortUsers(this.board()?.users ?? [], this.sort()));
  protected readonly updated = computed(() => {
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
    this.initialised = true;
    if (this.view() === 'workload') this.load();
    else void this.writeUrl();
    this.startAutoRefresh();
    void this.loadPods();
  }

  // ---- the view

  protected patchFilters(patch: Partial<UsersFilters>): void {
    const next = { ...this.filters(), ...patch };
    if (sameFilters(next, this.filters())) return;
    this.filters.set(next);
    void this.writeUrl();
    if (this.view() === 'coverage') {
      // The coverage view reads again when the pod changes; the name filter is applied on the page.
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
        ...(view === 'coverage' ? {} : { cp: null, cfrom: null, cto: null }),
      },
      queryParamsHandling: 'merge',
    });
    if (view === 'workload') this.load({ silent: !!this.board() });
  }

  protected toggleOut(): void {
    this.patchFilters({ availability: this.filters().availability === 'out' ? 'all' : 'out' });
  }

  protected clearFilters(): void {
    this.patchFilters({ ...DEFAULT_FILTERS });
  }

  protected setSort(sort: UserSort): void {
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
      queryParams: filtersToParams(this.filters()),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- loading

  protected refresh(): void {
    if (this.refreshing()) return;
    this.load({ silent: true, announce: true });
  }

  protected load(options: { silent?: boolean; announce?: boolean } = {}): void {
    const { silent = false, announce = false } = options;
    const id = ++this.requestId;
    const background = silent && !!this.board();
    if (background) this.refreshing.set(true);
    else {
      this.state.set('loading');
      this.refreshFailed.set(false);
    }
    const f = this.filters();
    const start = () =>
      this.api
        .getDashboardWorkload(f.pod ?? undefined, f.availability, f.q || undefined)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (board) => {
            if (id !== this.requestId) return;
            this.board.set(board);
            this.state.set('ready');
            this.refreshing.set(false);
            this.refreshFailed.set(false);
            this.lastLoadedAt = this.clock.now().getTime();
            if (announce) {
              this.live.set(
                `Team workload refreshed. ${plural(board.users.length, 'person', 'people')}.`,
              );
            }
          },
          error: (error: unknown) => {
            if (id !== this.requestId) return;
            this.refreshing.set(false);
            if (error instanceof ApiError && error.status === 403) {
              this.state.set('forbidden');
              return;
            }
            // A failed background read keeps the cards on screen; only a first load shows the error state.
            if (this.board()) this.refreshFailed.set(true);
            else this.state.set('error');
          },
        });
    if (background) this.quiet.run(start);
    else start();
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
