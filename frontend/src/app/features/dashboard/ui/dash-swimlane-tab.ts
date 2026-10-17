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
  SwimlaneBoard,
  SwimlaneCard,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { UndoService } from '../../../core/notify/undo.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { mfDate } from '../../../core/time/time';
import { FIXED_MODE_QUERY } from '../../../shared/ui/fixed-page';
import { withoutDefaults } from '../dash-url-state';
import { DashState, focusAfterRetry } from './dash-state';
import { DashScope } from '../dash-scope';
import { SwimlaneDrawer } from '../swimlane/swimlane-drawer';
import { LaneMove, SwimlaneLane } from '../swimlane/swimlane-lane';
import {
  DEFAULT_VIEW,
  Density,
  GroupBy,
  DEFAULT_LANE,
  LANE_CODES,
  LANE_PARAM,
  LANE_SWITCHER_QUERY,
  LaneCode,
  LaneModel,
  SwimlaneView,
  allGroupKeys,
  buildLane,
  filterCount,
  hasViewParams,
  isGroupBy,
  laneFromParam,
  laneOf,
  laneParam,
  laneQueueParams,
  rememberedLane,
  rememberLane,
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
  imports: [SwimlaneToolbar, SwimlaneLane, SwimlaneDrawer, DashState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <mf-swimlane-toolbar
      [view]="view()"
      [density]="density()"
      [people]="peopleOptions()"
      [types]="typeOptions()"
      [priorities]="priorityOptions()"
      [compact]="switcher()"
      (viewChange)="patchView($event)"
      (densityChange)="setDensity($event)"
      (expandAll)="expandAll()"
      (collapseAll)="collapseAll()"
    />

    <p class="sr-only" role="status" aria-live="polite" data-swimlane-live>{{ live() }}</p>

    @if (refreshFailed()) {
      <mf-dash-state variant="stale" [updated]="updated()" (retry)="retry()" />
    }

    @if (state() === 'error') {
      <mf-dash-state
        variant="error"
        message="The swimlane board could not be loaded."
        (retry)="retry()"
      />
    } @else {
      @if (switcher()) {
        <div class="switcher" role="tablist" aria-label="Swimlane lanes" data-lane-switcher>
          @for (lane of lanes(); track lane.code) {
            <button
              type="button"
              role="tab"
              class="stab"
              [id]="laneTabId(lane.code)"
              [attr.data-lane-tab]="lane.code"
              [attr.aria-selected]="lane.code === activeLane()"
              [attr.aria-controls]="lane.code === activeLane() ? lanePanelId : null"
              [attr.tabindex]="lane.code === activeLane() ? 0 : -1"
              (click)="chooseLane(lane.code)"
              (keydown)="onSwitcherKey($event)"
            >
              {{ lane.label }}
              <span class="stab-n" data-lane-tab-count>{{ lane.count }}</span>
            </button>
          }
        </div>
      }
      <div
        class="board"
        [class.board--single]="switcher()"
        [class.board--natural]="natural()"
        data-board
        [attr.role]="switcher() ? 'tabpanel' : 'region'"
        [attr.id]="switcher() ? lanePanelId : null"
        [attr.aria-labelledby]="switcher() ? laneTabId(activeLane()) : null"
        [attr.tabindex]="switcher() ? null : 0"
        [attr.aria-label]="switcher() ? null : 'Swimlane board'"
        [attr.aria-busy]="state() === 'loading' ? 'true' : null"
        [attr.data-density]="density()"
      >
        @for (lane of shownLanes(); track lane.code) {
          <mf-swimlane-lane
            [model]="lane"
            [groupBy]="shownGroupBy()"
            [density]="density()"
            [loading]="state() === 'loading'"
            [filtered]="filtersOn()"
            [single]="switcher()"
            [natural]="natural()"
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
    .board:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    /* Very wide screens (#126): a lane stops at 480 px and the board stays left aligned; the rest is blank space, not stretched cards. */
    @media (min-width: 2200px) {
      .board {
        grid-template-columns: repeat(4, minmax(17rem, 480px));
      }
    }
    /* Fixed-height Dashboard (#137): the toolbar is pinned and the board takes what is left of the window; each lane scrolls itself. */
    @media (min-width: 768px) and (min-height: 561px) {
      .board {
        flex: 1 1 0;
        min-height: 0;
        height: auto;
        grid-template-rows: minmax(0, 1fr);
      }
    }
    /* Under 900 px (W4) the four lanes are replaced by the lane switcher and ONE lane at a time. In the fixed-height page (768 px and up,
       561 px high) that lane fills what is left and scrolls; below that the page scrolls and the lane has its natural height. */
    .board--single {
      display: flex;
      flex-direction: column;
      height: auto;
      overflow: visible;
      padding-bottom: 0;
    }
    .board--single > * {
      flex: 1 1 auto;
    }
    .board--natural > * {
      flex: none;
    }
    @media (min-width: 768px) and (min-height: 561px) {
      .board--single {
        flex: 1 1 0;
        min-height: 0;
      }
    }
    .switcher {
      display: flex;
      gap: 0;
      margin-bottom: var(--mf-s2);
      padding: 0;
      background: var(--mf-bg, var(--mf-surface));
      border-bottom: 1px solid var(--mf-border);
    }
    /* Sticky under the Dashboard tab row (sticky from 600 px, 44 px high) while the page scrolls; not on a window so short (400 px) that the two
       rows would take a quarter of it: then it scrolls away with the page. */
    .switcher {
      position: sticky;
      top: 0;
      z-index: 8;
    }
    @media (min-width: 600px) {
      .switcher {
        top: 2.75rem;
      }
    }
    @media (max-height: 400px) {
      .switcher {
        position: static;
      }
    }
    /* Four equal tabs that always fit (271 px at 375 with the app rail): the lane name over its count; a long name wraps instead of being cut. */
    .stab {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
      min-height: 2.75rem;
      padding: var(--mf-s1) 2px;
      color: var(--mf-text-muted);
      background: none;
      border: 0;
      border-bottom: 3px solid transparent;
      font: inherit;
      font-size: var(--mf-fs-xs);
      font-weight: 500;
      line-height: 1.2;
      text-align: center;
      cursor: pointer;
    }
    .stab[aria-selected='true'] {
      color: var(--mf-text);
      font-weight: 600;
      border-bottom-color: var(--mf-primary);
    }
    .stab:hover {
      color: var(--mf-text);
      background: var(--mf-surface-alt);
    }
    .stab:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .stab-n {
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--mf-text);
    }
  `,
})
export class DashSwimlaneTab implements OnInit {
  private readonly api = inject(DashboardBoardClient);
  private readonly scope = inject(DashScope);
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
  /** A Retry the person pressed is in flight: when it ends, focus follows the P7 rule. */
  private retrying = false;
  /** When the board on screen was last read successfully (epoch ms); the page shows "Updated N min ago" from it once it is old (P6). */
  readonly lastOkAt = signal<number | null>(null);
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private undoSeen = 0;

  protected readonly view = signal<SwimlaneView>(DEFAULT_VIEW);
  protected readonly density = this.prefs.density;
  protected readonly state = signal<LoadState>('loading');
  protected readonly board = signal<SwimlaneBoard | null>(null);
  /** True while a refresh is running (the Dashboard's tab row shows it on its refresh icon). */
  readonly refreshing = signal(false);
  readonly refreshFailed = signal(false);
  protected readonly live = signal('');
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());
  private readonly selectedId = signal<number | null>(null);

  private readonly seenPeople = signal<ReadonlyMap<number, string>>(new Map());
  private readonly seenTypes = signal<ReadonlyMap<number, string>>(new Map());

  private readonly params = toSignal(this.route.queryParamMap.pipe(map((p) => p)), {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly filtersOn = computed(() => {
    const v = this.view();
    return filterCount(v) > 0 || !!v.q || v.mine;
  });

  readonly updated = computed(() => {
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

  // ---- the lane switcher (W4)

  protected readonly lanePanelId = 'mf-sl-lane-panel';
  protected readonly laneTabId = (code: string) => `mf-sl-lane-tab-${code}`;
  /** Below 900 px: the lane switcher and one lane (a media query, so a rotated phone or a resized window follows). */
  protected readonly switcher = signal(false);
  /** The fixed-height page (768 x 561 px and up) gives the one lane a scroll box of its own; below it the page scrolls. */
  private readonly fixedMode = signal(false);
  protected readonly natural = computed(() => this.switcher() && !this.fixedMode());
  /** The lane the switcher shows (also kept while the board is wide, so rotating a phone keeps it). */
  protected readonly activeLane = signal<LaneCode>(DEFAULT_LANE);
  protected readonly shownLanes = computed<LaneModel[]>(() =>
    this.switcher() ? this.lanes().filter((l) => l.code === this.activeLane()) : this.lanes(),
  );

  protected readonly selectedCard = computed<SwimlaneCard | null>(() => {
    const id = this.selectedId();
    if (id === null) return null;
    for (const lane of this.board()?.lanes ?? []) {
      const found = lane.cards.find((c) => c.taskId === id);
      if (found) return found;
    }
    return null;
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
    // The page-wide scope changed (the control, a pasted link, Back): the board is read again for it.
    let lastScope: string | undefined;
    effect(() => {
      const scope = this.scope.scope();
      untracked(() => {
        if (lastScope !== undefined && scope !== lastScope) this.load();
        lastScope = scope;
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
    // The lane named by the address (a pasted link, Back).
    effect(() => {
      const lane = laneFromParam(this.params().get(LANE_PARAM));
      untracked(() => {
        if (lane && lane !== this.activeLane()) this.activeLane.set(lane);
      });
    });
    this.watchMedia(LANE_SWITCHER_QUERY, this.switcher);
    this.watchMedia(FIXED_MODE_QUERY, this.fixedMode);
    this.destroyRef.onDestroy(() => {
      if (this.editTimer) clearTimeout(this.editTimer);
    });
  }

  private watchMedia(query: string, target: { set(value: boolean): void }): void {
    if (typeof matchMedia !== 'function') return;
    const list = matchMedia(query);
    target.set(list.matches);
    const onChange = (e: MediaQueryListEvent) => target.set(e.matches);
    list.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => list.removeEventListener('change', onChange));
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.view.set(viewFromParams(params, this.prefs.remembered()));
    // The lane of the address, else the one chosen earlier in this session, else In progress.
    this.activeLane.set(laneFromParam(params.get(LANE_PARAM)) ?? rememberedLane() ?? DEFAULT_LANE);
    // A link that names a display choice (even the default one) is what the person wants: remember it, so the address can leave defaults out.
    if (params.has('group') || params.has('sort') || params.has('days')) {
      const v = this.view();
      this.prefs.remember({ groupBy: v.groupBy, sort: v.sort, days: v.days });
    }
    // Write only what differs from the default into the address (replacing the entry); a plain link is not rewritten. A link that names
    // another tab is being redirected by the page: leave the address to it.
    if ([null, 'swimlane'].includes(params.get('tab'))) void this.writeUrl(true);
    this.load();
    this.startAutoRefresh();
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
      queryParams: withoutDefaults('swimlane', {
        ...viewToParams(this.view()),
        [LANE_PARAM]: laneParam(this.activeLane()),
      }),
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  protected chooseLane(code: LaneCode): void {
    if (code === this.activeLane()) return;
    this.activeLane.set(code);
    rememberLane(code);
    void this.writeUrl(true);
  }

  /** WAI-ARIA tabs, automatic activation: arrows move (and wrap), Home and End jump; the focus stays on the tab. */
  protected onSwitcherKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const at = LANE_CODES.indexOf(this.activeLane());
    let to: number;
    switch (event.key) {
      case 'ArrowRight':
        to = (at + 1) % LANE_CODES.length;
        break;
      case 'ArrowLeft':
        to = (at - 1 + LANE_CODES.length) % LANE_CODES.length;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = LANE_CODES.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.chooseLane(LANE_CODES[to]);
    // The tab elements stay in place when the lane changes, so the focus can move now and stays on the tab.
    this.host.nativeElement
      .querySelector<HTMLElement>(`[data-lane-tab="${LANE_CODES[to]}"]`)
      ?.focus();
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
      this.scope.queueParam(),
    );
  }

  // ---- loading

  /** Reads the board again now; the Dashboard's refresh icon (in the tab row) and the failed-refresh Retry call this. */
  refresh(): void {
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
          undefined,
          v.assignee ?? undefined,
          v.type ?? undefined,
          v.priority ?? undefined,
          v.q || undefined,
          v.overdue ? true : undefined,
          v.mine ? true : undefined,
          this.scope.scope(),
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
            this.lastOkAt.set(this.lastLoadedAt);
            this.finishRetry('ready');
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

  /** The people and task types seen so far feed the filter menus (a filter then does not remove its own alternatives). */
  private remember(board: SwimlaneBoard): void {
    const people = new Map(this.seenPeople());
    const types = new Map(this.seenTypes());
    for (const lane of board.lanes) {
      for (const c of lane.cards) {
        if (c.assignee) people.set(c.assignee.userId, c.assignee.displayName);
        types.set(c.taskTypeId, c.taskTypeName);
      }
    }
    if (people.size !== this.seenPeople().size) this.seenPeople.set(people);
    if (types.size !== this.seenTypes().size) this.seenTypes.set(types);
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
    // One lane on screen (the phone layout): the lane switcher moves between lanes.
    if (this.switcher()) return;
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
