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
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import {
  DashboardBoardClient,
  PodsClient,
  SwimlaneBoard,
  SwimlaneCard,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { UndoService } from '../../../core/notify/undo.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { mfDate } from '../../../core/time/time';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { loadPodChoices } from '../../../shared/work-queue/pod-options';
import { SwimlaneDrawer } from '../swimlane/swimlane-drawer';
import { LaneMove, SwimlaneLane } from '../swimlane/swimlane-lane';
import {
  DEFAULT_VIEW,
  Density,
  GroupBy,
  LANE_CODES,
  LaneCode,
  LaneModel,
  SwimlaneView,
  allGroupKeys,
  buildLane,
  filterCount,
  hasViewParams,
  isGroupBy,
  laneOf,
  laneQueueParams,
  sameView,
  viewFromParams,
  viewToParams,
  withCard,
} from '../swimlane/swimlane-model';
import { SwimlanePrefs } from '../swimlane/swimlane-prefs';
import { Option, SwimlaneToolbar } from '../swimlane/swimlane-toolbar';

type LoadState = 'loading' | 'ready' | 'error';

/** How often the board refreshes itself while the tab is visible (as the Summary does). */
export const SWIMLANE_REFRESH_MS = 5 * 60_000;
/** Pause after an inline edit before the board is read again (several quick edits make one read). */
const EDIT_REFRESH_DELAY_MS = 900;

/**
 * Dashboard > Swimlane tab (epic #68): every open task and the tasks completed or cancelled in the last 7, 14 or 30 days as cards in four
 * lanes (New, In progress, On hold, Completed), optionally grouped by priority, assignee or as a client > matter tree. The view (group, sort,
 * window and the data filters) lives in the address so a link shares it; grouping, sort, window and density are also remembered per user.
 * Cards carry the inline Status, Priority and Assignee menus (with Undo) and open a side drawer peek. The board refreshes itself every
 * five minutes without moving focus, and never while a menu or the drawer is open. Operational view only: no per-person statistics.
 */
@Component({
  selector: 'mf-dash-swimlane-tab',
  imports: [SwimlaneToolbar, SwimlaneLane, SwimlaneDrawer, ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-swimlane-toolbar
      [view]="view()"
      [density]="density()"
      [pods]="podOptions()"
      [people]="peopleOptions()"
      [types]="typeOptions()"
      [priorities]="priorityOptions()"
      [updated]="updated()"
      [refreshing]="refreshing()"
      (viewChange)="patchView($event)"
      (densityChange)="setDensity($event)"
      (expandAll)="expandAll()"
      (collapseAll)="collapseAll()"
      (refresh)="refresh()"
    />

    <p class="sr-only" role="status" aria-live="polite" data-swimlane-live>{{ live() }}</p>

    @if (refreshFailed()) {
      <div class="stale" role="status" data-swimlane-stale>
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <span>
          The board could not be refreshed. Showing the tasks from {{ updated() }}.
          <mf-error-reference />
        </span>
        <button type="button" class="mf-btn" data-swimlane-stale-retry (click)="refresh()">
          Retry
        </button>
      </div>
    }

    @if (state() === 'error') {
      <div class="alert" role="alert" data-swimlane-error>
        <span>The swimlane board could not be loaded.</span>
        <mf-error-reference />
        <button type="button" class="mf-btn" data-swimlane-retry (click)="load()">Retry</button>
      </div>
    } @else {
      <div
        class="board"
        data-board
        role="region"
        aria-label="Swimlane board"
        [attr.aria-busy]="state() === 'loading' ? 'true' : null"
        [attr.data-density]="density()"
      >
        @for (lane of lanes(); track lane.code) {
          <mf-swimlane-lane
            [model]="lane"
            [groupBy]="shownGroupBy()"
            [density]="density()"
            [loading]="state() === 'loading'"
            [filtered]="filtersOn()"
            [queueParams]="queueParamsOf(lane.code)"
            (openCard)="openCard($event)"
            (cardChange)="onCardChange($event)"
            (groupToggle)="toggleGroup($event)"
            (laneMove)="moveLane($event)"
            (skipLane)="skipLane($event)"
          />
        }
      </div>
    }

    <mf-swimlane-drawer
      [card]="selectedCard()"
      (closed)="closeDrawer()"
      (cardChange)="onCardChange($event)"
    />
  `,
  styles: `
    :host {
      display: block;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    /* Four lanes side by side; the board is as tall as the screen minus the page above it, and each lane scrolls itself. */
    .board {
      display: grid;
      grid-template-columns: repeat(4, minmax(17rem, 1fr));
      gap: var(--mf-s3);
      align-items: stretch;
      height: max(30rem, calc(100vh - 22rem));
      overflow-x: auto;
      padding-bottom: var(--mf-s1);
    }
    .board > * {
      min-height: 0;
      min-width: 0;
    }
    /* Narrow screens: the lanes stack, each with its own limited height. */
    @media (max-width: 900px) {
      .board {
        display: flex;
        flex-direction: column;
        height: auto;
        overflow-x: visible;
      }
      .board > * {
        height: auto;
        max-height: 34rem;
      }
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
export class DashSwimlaneTab implements OnInit {
  private readonly api = inject(DashboardBoardClient);
  private readonly pods = inject(PodsClient);
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly prefs = inject(SwimlanePrefs);
  private readonly undo = inject(UndoService);
  private readonly quiet = inject(QuietRequests);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly laneRefs = viewChildren(SwimlaneLane);

  private requestId = 0;
  private lastLoadedAt = 0;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private undoSeen = 0;

  protected readonly view = signal<SwimlaneView>(DEFAULT_VIEW);
  protected readonly density = this.prefs.density;
  protected readonly state = signal<LoadState>('loading');
  protected readonly board = signal<SwimlaneBoard | null>(null);
  protected readonly refreshing = signal(false);
  protected readonly refreshFailed = signal(false);
  protected readonly live = signal('');
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());
  private readonly selectedId = signal<number | null>(null);

  private readonly podChoices = signal<Option[]>([]);
  private readonly seenPeople = signal<ReadonlyMap<number, string>>(new Map());
  private readonly seenTypes = signal<ReadonlyMap<number, string>>(new Map());

  private readonly params = toSignal(this.route.queryParamMap.pipe(map((p) => p)), {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly filtersOn = computed(() => {
    const v = this.view();
    return filterCount(v) > 0 || !!v.q || v.mine;
  });

  protected readonly updated = computed(() => {
    const b = this.board();
    return b ? mfDate(b.generatedAtUtc, this.zone, 'datetime') : null;
  });

  /** The grouping of the board on screen: a change of Group by shows its layout when its board arrives, not before. */
  protected readonly shownGroupBy = computed<GroupBy>(() => {
    const shown = this.board()?.groupBy;
    return isGroupBy(shown) ? shown : this.view().groupBy;
  });

  protected readonly lanes = computed<LaneModel[]>(() => {
    const b = this.board();
    const now = this.clock.now();
    const emptyLane = (code: LaneCode) => ({
      status: code,
      label: { NEW: 'New', IN_PROGRESS: 'In Progress', ON_HOLD: 'On Hold', COMPLETED: 'Completed' }[
        code
      ],
      count: 0,
      truncated: false,
      total: 0,
      cards: [],
    });
    return LANE_CODES.map((code) => {
      const lane = b?.lanes.find((l) => l.status === code) ?? emptyLane(code);
      return buildLane(
        lane,
        this.shownGroupBy(),
        b?.groups ?? [],
        this.collapsed(),
        now,
        this.zone,
      );
    });
  });

  protected readonly selectedCard = computed<SwimlaneCard | null>(() => {
    const id = this.selectedId();
    if (id === null) return null;
    for (const lane of this.board()?.lanes ?? []) {
      const found = lane.cards.find((c) => c.taskId === id);
      if (found) return found;
    }
    return null;
  });

  protected readonly podOptions = computed<Option[]>(() => {
    const selected = this.view().pod;
    const list = this.podChoices();
    return selected !== null && !list.some((p) => p.id === selected)
      ? [...list, { id: selected, label: `Pod ${selected}` }]
      : list;
  });
  protected readonly peopleOptions = computed<Option[]>(() => {
    const list = this.optionsOf(this.seenPeople());
    const selected = Number(this.view().assignee);
    return Number.isInteger(selected) && selected > 0 && !list.some((p) => p.id === selected)
      ? [...list, { id: selected, label: `User ${selected}` }]
      : list;
  });
  protected readonly typeOptions = computed<Option[]>(() => {
    const list = this.optionsOf(this.seenTypes());
    const selected = this.view().type;
    return selected !== null && !list.some((p) => p.id === selected)
      ? [...list, { id: selected, label: `Task type ${selected}` }]
      : list;
  });
  protected readonly priorityOptions = computed<Option[]>(() =>
    this.lookups.activePriorities().map((p) => ({ id: p.id, label: p.label })),
  );

  constructor() {
    void this.lookups.ensureLoaded();
    this.undoSeen = this.undo.settled();
    // An Undo of an edit whose row had already left the board (a moved card): read the board again.
    effect(() => {
      const n = this.undo.settled();
      untracked(() => {
        if (n === this.undoSeen) return;
        this.undoSeen = n;
        if (this.state() === 'ready') this.load({ silent: true });
      });
    });
    // The address changed under us (Back, a pasted link): follow it.
    effect(() => {
      const params = this.params();
      untracked(() => {
        if (!hasViewParams(params)) return;
        const next = viewFromParams(params, this.view());
        if (sameView(next, this.view())) return;
        this.view.set(next);
        this.load();
      });
    });
    this.destroyRef.onDestroy(() => {
      if (this.editTimer) clearTimeout(this.editTimer);
    });
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.view.set(viewFromParams(params, this.prefs.remembered()));
    // Write the view into the address (replacing the entry), so a reload or a copied link lands on the same board.
    void this.writeUrl(true);
    this.load();
    this.startAutoRefresh();
    void this.loadPods();
  }

  // ---- the view

  protected patchView(patch: Partial<SwimlaneView>): void {
    const next = { ...this.view(), ...patch };
    if (sameView(next, this.view())) return;
    this.view.set(next);
    if (patch.groupBy || patch.sort || patch.days) {
      this.prefs.remember({ groupBy: next.groupBy, sort: next.sort, days: next.days });
    }
    if (patch.groupBy) this.collapsed.set(new Set());
    void this.writeUrl(true);
    this.load({ silent: !!this.board() });
  }

  protected setDensity(density: Density): void {
    this.prefs.remember({ density });
  }

  private writeUrl(replace: boolean): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: viewToParams(this.view()),
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  protected expandAll(): void {
    this.collapsed.set(new Set());
    this.live.set('All groups expanded.');
  }

  protected collapseAll(): void {
    this.collapsed.set(new Set(allGroupKeys(this.board()?.groups ?? [])));
    this.live.set('All groups collapsed.');
  }

  protected toggleGroup(key: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected queueParamsOf(code: LaneCode) {
    return laneQueueParams(
      this.view(),
      code,
      this.board()?.completedFrom ?? '',
      this.auth.profile()?.userId ?? 0,
    );
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
    const v = this.view();
    const start = () =>
      this.api
        .getDashboardSwimlane(
          v.days,
          v.groupBy,
          v.sort,
          v.pod ?? undefined,
          v.assignee ?? undefined,
          v.type ?? undefined,
          v.priority ?? undefined,
          v.q || undefined,
          v.overdue ? true : undefined,
          v.mine ? true : undefined,
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (board) => {
            if (id !== this.requestId) return;
            this.board.set(board);
            this.state.set('ready');
            this.refreshing.set(false);
            this.refreshFailed.set(false);
            this.lastLoadedAt = this.clock.now().getTime();
            this.remember(board);
            if (announce) {
              const total = board.lanes.reduce((n, l) => n + l.count, 0);
              this.live.set(`Board refreshed. ${total} ${total === 1 ? 'task' : 'tasks'}.`);
            }
          },
          error: () => {
            if (id !== this.requestId) return;
            this.refreshing.set(false);
            // A failed background read keeps the board on screen; only a first load shows the error state.
            if (this.board()) this.refreshFailed.set(true);
            else this.state.set('error');
          },
        });
    if (background) this.quiet.run(start);
    else start();
  }

  /** The people and task types seen so far feed the filter menus (a filter then does not remove its own alternatives). */
  private remember(board: SwimlaneBoard): void {
    const people = new Map(this.seenPeople());
    const types = new Map(this.seenTypes());
    const pods = new Map(this.podChoices().map((p) => [p.id, p.label] as const));
    for (const lane of board.lanes) {
      for (const c of lane.cards) {
        if (c.assignee) people.set(c.assignee.userId, c.assignee.displayName);
        types.set(c.taskTypeId, c.taskTypeName);
        if (c.pod) pods.set(c.pod.podId, c.pod.name);
      }
    }
    if (people.size !== this.seenPeople().size) this.seenPeople.set(people);
    if (types.size !== this.seenTypes().size) this.seenTypes.set(types);
    if (pods.size !== this.podChoices().length) this.podChoices.set(this.optionsOf(pods));
  }

  private async loadPods(): Promise<void> {
    if (!this.auth.has('Pod.View')) return;
    const choices = await loadPodChoices(this.pods, true);
    const merged = new Map(this.podChoices().map((p) => [p.id, p.label] as const));
    for (const o of choices.options) merged.set(o.id, o.name);
    this.podChoices.set(this.optionsOf(merged));
  }

  private optionsOf(map: ReadonlyMap<number, string>): Option[] {
    return [...map]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  // ---- cards

  protected openCard(card: SwimlaneCard): void {
    this.selectedId.set(card.taskId);
  }

  protected closeDrawer(): void {
    const id = this.selectedId();
    this.selectedId.set(null);
    if (id !== null) this.restoreFocus(id);
  }

  /** Focus goes back to the card that opened the drawer (its title button, or the tree item around it). */
  private restoreFocus(id: number): void {
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body && !active.closest('.p-dialog-mask')) return;
        const target =
          this.host.nativeElement.querySelector<HTMLElement>(`[id="sl-item-${id}"]`) ??
          this.host.nativeElement.querySelector<HTMLElement>(`[id="sl-open-${id}"]`);
        target?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /**
   * An inline edit changed a card. While it is only the optimistic or rolled-back copy the card is replaced where it stands. Once the
   * server has accepted a change (a new row version) a card whose status now belongs to another lane moves there, keeping the focus on
   * the same control, and the board is read again shortly (several quick edits make one read).
   */
  protected onCardChange(card: SwimlaneCard): void {
    const b = this.board();
    if (!b) return;
    let existing: SwimlaneCard | undefined;
    let inLane: string | undefined;
    for (const lane of b.lanes) {
      const found = lane.cards.find((c) => c.taskId === card.taskId);
      if (found) {
        existing = found;
        inLane = lane.status;
      }
    }
    if (!existing) return;
    const committed = card.rowVersion !== existing.rowVersion;
    // The lane the card sits in, not its (possibly optimistic) status, decides whether it moves.
    const moves = committed && laneOf(card.status) !== inLane;
    const focusKind = moves ? this.focusedPart(card.taskId) : null;
    this.board.set(withCard(b, card, committed));
    if (moves) {
      this.live.set(`${card.ref} moved to ${card.statusLabel}.`);
      this.refocus(card.taskId, focusKind);
    }
    if (committed) this.scheduleRefresh();
  }

  private focusedPart(id: number): 'status' | 'priority' | 'assignee' | 'card' | null {
    const active = document.activeElement as HTMLElement | null;
    const card =
      active?.closest(`[data-card="${id}"]`) ??
      active?.closest('li')?.querySelector(`[data-card="${id}"]`);
    if (!active || !card) return null;
    const field = active.closest('[data-field]')?.getAttribute('data-field');
    return field === 'status' || field === 'priority' || field === 'assignee' ? field : 'card';
  }

  private refocus(id: number, part: 'status' | 'priority' | 'assignee' | 'card' | null): void {
    if (!part) return;
    afterNextRender(
      () => {
        const root = this.host.nativeElement.querySelector<HTMLElement>(`[data-card="${id}"]`);
        const target =
          part === 'card'
            ? root?.querySelector<HTMLElement>('[data-card-open]')
            : root?.querySelector<HTMLElement>(`[data-field="${part}"] [data-inline-trigger]`);
        target?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  private scheduleRefresh(): void {
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      // Not under a menu or dialog that was opened meanwhile: look again a little later.
      if (this.selectedId() !== null || document.querySelector('.im-pop, .p-dialog-mask')) {
        this.scheduleRefresh();
        return;
      }
      this.load({ silent: true });
    }, EDIT_REFRESH_DELAY_MS);
  }

  // ---- keyboard between lanes

  protected moveLane(move: LaneMove): void {
    const lanes = this.laneRefs();
    const at = LANE_CODES.indexOf(move.from as LaneCode);
    // The nearest lane in that direction that has a card to land on.
    for (let i = at + move.dir; i >= 0 && i < lanes.length; i += move.dir) {
      if (this.lanes()[i].rows.length > 0) {
        lanes[i].focusIndex(move.index);
        return;
      }
    }
  }

  protected skipLane(from: string): void {
    this.moveLane({ from, dir: 1, index: 0 });
  }

  // ---- automatic refresh

  private startAutoRefresh(): void {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // Never swap cards under an open menu, dialog or the drawer.
      if (this.selectedId() !== null || this.refreshing()) return;
      if (document.querySelector('.im-pop, .p-dialog-mask')) return;
      if (this.state() === 'ready') this.load({ silent: true });
    };
    const timer = setInterval(tick, SWIMLANE_REFRESH_MS);
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        this.clock.now().getTime() - this.lastLoadedAt >= SWIMLANE_REFRESH_MS
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
