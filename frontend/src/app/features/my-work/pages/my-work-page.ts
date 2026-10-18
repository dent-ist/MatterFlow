import { ColumnsNotice } from '../../../shared/work-queue/columns-notice';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ParamMap, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import {
  MyWorkClient,
  MyWorkPage as MyWorkData,
  PodsClient,
  TaskQueueRow,
} from '../../../api/generated/api-client';
import { PageTitle } from '../../../core/title/page-title';
import { FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import {
  QUEUE_FILTER_PARAMS,
  queueFilterDefs,
  withoutFilters,
} from '../../../shared/filters/queue-defs';
import { CopyParts } from '../../../shared/ui/copy-parts';
import { emptyCopy, nearEmptyCopy } from '../../../shared/work-queue/empty-copy';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { loadGroup, saveGroup } from '../../../shared/work-queue/group-pref';
import { isBareState } from '../../../shared/work-queue/last-view';
import { touchVisit, trackVisitActivity } from '../../../shared/work-queue/last-visit';
import { PodOption, loadPodChoices } from '../../../shared/work-queue/pod-options';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  QueueFilters,
  QueueState,
  dateDaysAgo,
  emptyState,
  queueArgs,
  sameSet,
} from '../../../shared/work-queue/queue-filters';
import { openInQueueParams } from '../../../shared/work-queue/queue-link';
import { WorkList } from '../../../shared/work-queue/work-list';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';
import { WorkTab, WorkTabs } from '../../../shared/work-queue/work-tabs';
import { WorkViewControls } from '../../../shared/work-queue/work-view-controls';
import {
  CLOSED_LABEL,
  DUE_SOON_AND_OVERDUE_LABEL,
  DUE_SOON_FILTER_TEXT,
  TAB_HELP,
  TAB_TOOLTIPS,
} from '../../../shared/work-queue/work-vocabulary';

export type TabKey = 'active' | 'dueSoon' | 'completed' | 'createdByMe';

/**
 * The tab names (M5, BUG-13): Active, Due soon and overdue, Closed (completed or cancelled), Created by me. The URL values (`view=dueSoon`,
 * `view=completed`) are unchanged so old links and the Dashboard keep working.
 */
export const TAB_LABELS: Readonly<Record<TabKey, string>> = {
  active: 'Active',
  dueSoon: DUE_SOON_AND_OVERDUE_LABEL,
  completed: CLOSED_LABEL,
  createdByMe: 'Created by me',
};

/**
 * The tab a plain visit opens: Active, unless it is empty (count 0) and another tab is not; then Created by me, then Closed. Due soon
 * and overdue is part of Active, so it never leads.
 */
export function firstNonEmptyTab(counts: Readonly<Record<TabKey, number>>): TabKey {
  if (counts.active > 0) return 'active';
  return (['createdByMe', 'completed'] as const).find((key) => counts[key] > 0) ?? 'active';
}

/**
 * Filters a tab decides itself (shown disabled with the reason): the tabs for my own tasks always mean "assigned to me", Created by me
 * always means "created by me", and Due soon and overdue is a window on the due date.
 */
const OWNED: Readonly<Record<TabKey, readonly string[]>> = {
  active: ['assignee'],
  dueSoon: ['assignee', 'due', 'asap', 'overdue'],
  completed: ['assignee'],
  createdByMe: ['creator'],
};

const OWNED_REASON: Readonly<Record<TabKey, string>> = {
  active: 'This tab lists the tasks assigned to you.',
  dueSoon:
    'Set by the Due soon and overdue tab: tasks assigned to you that are overdue or due within 2 days.',
  completed: 'This tab lists the closed tasks assigned to you.',
  createdByMe: 'This tab lists the tasks you created.',
};

const ASSIGNED_STATUSES = OPEN_STATUSES.filter((code) => code !== 'NEW');

/** What a disabled tab-owned filter reads in its cell (BUG-10): the fixed meaning instead of an empty box. */
export const FIXED_VALUES: Readonly<Record<TabKey, Readonly<Record<string, string>>>> = {
  active: { assignee: 'Me' },
  dueSoon: { assignee: 'Me', due: DUE_SOON_FILTER_TEXT },
  completed: { assignee: 'Me' },
  createdByMe: { creator: 'Me' },
};

/** The statuses that mean something on a tab; the Status filter offers these and a tab change drops the others. */
const STATUSES: Readonly<Record<TabKey, readonly string[]>> = {
  // Assigning a task starts it, so an assigned task is never New (BUG-11).
  active: ASSIGNED_STATUSES,
  dueSoon: ASSIGNED_STATUSES,
  completed: CLOSED_STATUSES,
  createdByMe: [...OPEN_STATUSES, ...CLOSED_STATUSES],
};

/** The needs-attention items in their order; the counts come from the response (`attention`), Overdue is the only red one. */
const STRIP: readonly Omit<WorkStripItem, 'count'>[] = [
  { key: 'overdue', label: 'Overdue', alert: true },
  { key: 'dueToday', label: 'Due today' },
  { key: 'asap', label: 'ASAP' },
  { key: 'onHold', label: 'On hold' },
  { key: 'new', label: 'New', hint: 'Assigned to you since your last visit' },
];

/**
 * My Work (UX S02, ticket 50): everything assigned to me from all my Pods, in the tabs Active, Due soon and overdue, Closed and Created by
 * me, most urgent first, with the shared inline column filters. Tab counts follow the filters. The tab and filters live in the URL. A filter
 * the current tab decides itself (Assignee on my own tabs, Creator on Created by me, Due on Due soon and overdue) shows disabled with the reason and
 * is not sent; changing tab drops the filters the new tab owns, so every count is worked out under the same filters.
 */
@Component({
  selector: 'mf-my-work-page',
  imports: [
    ColumnsNotice,
    FixedPage,
    PageHeader,
    RouterLink,
    CopyParts,
    FiltersBar,
    WorkList,
    WorkStrip,
    WorkTabs,
    WorkViewControls,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/work-queue/work-page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="My Work"> </mf-page-header>

      @if (columnsNotice()) {
        <mf-columns-notice
          [offerMatter]="offerMatter()"
          (addMatter)="addMatterColumn()"
          (dismiss)="dismissNotice()"
        />
      }

      <mf-work-strip
        label="Needs attention"
        hint="All your open tasks, not affected by the filters below"
        [items]="stripItems()"
        [interactive]="true"
        [active]="activeStrip()"
        (pick)="pickStrip($event)"
      />

      <div class="wp-tabrow" data-tab-row>
        <mf-work-tabs
          label="My Work views"
          idPrefix="mw"
          [tabs]="tabs()"
          [selected]="tab()"
          (selectedChange)="selectTab($event)"
        />
      </div>

      <div class="mf-fill" role="tabpanel" id="mw-panel" [attr.aria-labelledby]="'mw-tab-' + tab()">
        <mf-filters-bar
          [filters]="filters"
          controls="work-filter-row"
          [stacked]="true"
          (showColumn)="showColumn($event)"
        >
          <mf-work-view-controls
            [sort]="state().sort"
            [dir]="state().dir"
            [defaultOrder]="defaultOrder()"
            [defaultLabel]="defaultLabel()"
            [tabHelp]="tabHelp()"
            [groupable]="tab() === 'active'"
            [grouped]="grouped()"
            (groupChange)="setGroup($event)"
            [columns]="prefs().columns"
            [density]="prefs().density"
            (resetSort)="resetSort()"
            (columnsChange)="setColumns($event)"
            [defaultColumns]="columnDefaults()"
            [widthScope]="columnScope()"
            [widthUser]="userId()"
            (densityChange)="setDensity($event)"
          >
            @if (!filters.sheetMode()) {
              <a
                tab-actions
                class="mf-btn mw-queue"
                data-open-in-queue
                [routerLink]="['/tasks']"
                [queryParams]="queueParams()"
                title="Same tasks, in the shared queue with all columns"
                aria-label="Open in Task Queue"
                ><i class="pi pi-list-check" aria-hidden="true"></i>
                <span class="mw-qtext">Open in Task Queue</span></a
              >
            }
            @if (windowed()) {
              <button tab-actions type="button" class="mf-btn mf-btn--text" (click)="showOlder()">
                Show older
              </button>
            }
          </mf-work-view-controls>
          <a
            mfSheetFooter
            class="mf-btn mw-queue mw-queue--sheet"
            data-open-in-queue
            [routerLink]="['/tasks']"
            [queryParams]="queueParams()"
            title="Same tasks, in the shared queue with all columns"
            aria-label="Open in Task Queue"
            ><i class="pi pi-list-check" aria-hidden="true"></i>
            <span class="mw-qtext">Open in Task Queue</span></a
          >
        </mf-filters-bar>
        <mf-work-list
          from="my-work"
          [rows]="rows()"
          [total]="total()"
          [page]="state().page"
          [pageSize]="state().pageSize"
          [state]="loadState()"
          [columns]="prefs().columns"
          [density]="prefs().density"
          [colWidths]="colWidths()"
          [sort]="tableSort()"
          [dir]="tableDir()"
          [filtered]="filtered()"
          [filters]="filters"
          [caption]="'My Work: ' + tabLabel()"
          [scope]="tabLabel()"
          [newSince]="tab() === 'active' || tab() === 'dueSoon' ? lastVisit : null"
          [emptyParts]="emptyCopy().parts"
          [nearEmpty]="tab() === 'active'"
          [leaving]="leaving.ids()"
          [groupBuckets]="grouped() ? (data()?.bucketCounts ?? null) : null"
          [groupOffset]="groupOffset()"
          (sortChange)="sortBy($event)"
          (pageChange)="goToPage($event)"
          (pageSizeChange)="setPageSize($event)"
          (retry)="load()"
          (clearFilters)="clearFilters()"
          (rowChange)="replaceRow($event)"
          (columnsShown)="shownColumns.set($event)"
          (columnResized)="onColumnResized($event)"
          (columnAction)="onColumnAction($event)"
        >
          @if (noOpenCreated()) {
            <button
              empty-action
              type="button"
              class="mf-btn mf-btn--text"
              data-show-closed
              (click)="showClosedTasks()"
            >
              Show closed tasks
            </button>
          }
          @if (emptyCopy().createTask) {
            <a empty-action class="mf-btn mf-btn--primary" routerLink="/tasks/new">Create task</a>
          }
          @if (windowed()) {
            <button empty-action type="button" class="mf-btn mf-btn--text" (click)="showOlder()">
              Show older
            </button>
          }
          <p near-empty data-everything>
            <mf-copy-parts [parts]="nearEmptyParts" />
          </p>
        </mf-work-list>
      </div>
    </mf-fixed-page>
  `,
})
export class MyWorkPage extends QueuePageBase<MyWorkData> {
  private readonly api = inject(MyWorkClient);
  private readonly podsApi = inject(PodsClient);
  private readonly pageTitle = inject(PageTitle);

  protected readonly pods = signal<PodOption[]>([]);
  /** The Pods the user belongs to (null until known). */
  protected readonly podCount = signal<number | null>(null);

  /** The tab from the address alone (the page's default status depends on it, so it cannot read `state()`). */
  protected readonly tab = computed<TabKey>(() => {
    const view = this.params().get('view');
    return view && view in TAB_LABELS ? (view as TabKey) : 'active';
  });

  private readonly defs = computed(() => {
    const owned = OWNED[this.tab()];
    const reason = () => OWNED_REASON[this.tab()];
    const disabled: Record<string, () => string | null> = Object.fromEntries(
      [...new Set(owned)].map((key) => [key === 'asap' || key === 'overdue' ? 'due' : key, reason]),
    );
    // "Closed: all time" only means something on the Closed tab, and a closed-date range replaces it.
    const range = this.state().filters;
    disabled['newSince'] = () =>
      this.tab() === 'active' || this.tab() === 'dueSoon'
        ? null
        : 'Applies to Active and Due soon and overdue.';
    disabled['closedWindow'] = () =>
      this.tab() !== 'completed' || range.completedFrom || range.completedTo
        ? 'Applies to the Closed tab.'
        : null;
    const allowed = STATUSES[this.tab()];
    const lookups = this.queueLookups();
    return queueFilterDefs(lookups, {
      closedWindow: true,
      ...(this.tab() === 'createdByMe' ? { defaultStatus: OPEN_STATUSES } : {}),
      newSince: true,
      disabled,
      fixed: Object.fromEntries(
        Object.entries(FIXED_VALUES[this.tab()]).map(([key, text]) => [key, () => text]),
      ),
      statuses: () => (lookups.statuses ?? []).filter((o) => allowed.includes(o.value)),
      names: {
        client: (id) => this.recordName('client', id),
        matter: (id) => this.recordName('matter', id),
        project: (id) => this.recordName('project', id),
      },
    });
  });

  protected readonly filters = new ListFilters({
    screen: 'my-work',
    noun: 'tasks',
    // The work list announces the results (view, count and range) in one message.
    announceResults: false,
    openByDefault: true,
    defs: this.defs,
    visibleColumns: this.shownColumns,
  });

  /** "Open in Task Queue": the same tasks as this tab, with its filters mapped to the queue's (M10). */
  protected readonly queueParams = computed(() => {
    const userId = this.userId();
    return userId === null
      ? {}
      : openInQueueParams(this.tab(), this.state(), {
          userId,
          now: this.clock.now(),
          zone: this.zone,
        });
  });

  protected readonly tabLabel = computed(() => TAB_LABELS[this.tab()]);

  /** Group by: Due is on (Active tab; `group=due` in the address). */
  protected readonly grouped = computed(() => this.state().group === 'due');
  /** The group choice of this user (remembered); the Active tab starts grouped when it is set. */
  private readonly groupPref = signal<'due' | null>(null);
  /** Index of the response's first row in the whole result: where the group headers go. */
  protected readonly groupOffset = computed(() => {
    const d = this.data();
    return d ? (d.page - 1) * d.pageSize : 0;
  });

  protected override allowsGroup(): boolean {
    return this.tab() === 'active';
  }

  /** The Group by control: None or Due, remembered per user. Page 1, as any change of the order. */
  protected setGroup(group: 'due' | null): void {
    this.groupPref.set(group);
    saveGroup(this.userId(), group);
    const s = this.state();
    this.navigate({ ...s, group, sort: null, dir: null, page: 1 });
  }

  /** A header sort turns grouping off for good: the choice is forgotten too (the chip is gone, the sort shows). */
  protected override sortBy(field: string): void {
    if (this.grouped()) {
      this.groupPref.set(null);
      saveGroup(this.userId(), null);
    }
    super.sortBy(field);
  }

  protected override resetView(): void {
    this.groupPref.set(null);
    saveGroup(this.userId(), null);
    super.resetView();
  }

  /** A grouped list reads its counts again once a row has left, so the headers stay where the buckets are. */
  protected override rowRemoved(): void {
    if (this.grouped()) void this.load();
  }

  protected override columnTab(): string {
    return this.tab();
  }

  /** Created by me starts on its open tasks, as a plain Task Queue link does (B2); the other tabs have no status default. */
  protected override defaultStatus(): readonly string[] {
    return this.tab() === 'createdByMe' ? OPEN_STATUSES : [];
  }

  /**
   * What the API gets. Created by me counts its open tasks for a request with no filter at all, and every status for one with any other
   * filter, so a view that only names the open statuses is sent bare, and "All" (no status, but a plain filter-less address that wrote
   * `status=`) is sent as every status written out. Everything else is sent as it is.
   */
  protected override apiState(state: QueueState): QueueState {
    const sent = super.apiState(state);
    const f = sent.filters;
    const others = !isBareState({ ...emptyState(), filters: { ...f, status: [] } });
    if (others) return sent;
    if (f.status.length === 0) {
      const explicit = QUEUE_FILTER_PARAMS.some((p) => this.params().has(p));
      return explicit
        ? { ...sent, filters: { ...f, status: [...OPEN_STATUSES, ...CLOSED_STATUSES] } }
        : sent;
    }
    return this.tab() === 'createdByMe' && sameSet(f.status, OPEN_STATUSES)
      ? { ...sent, filters: { ...f, status: [] } }
      : sent;
  }

  /** The Closed tab is ordered by the closing date, newest first: its Closed header carries the arrow (C1). */
  protected override defaultSort(): { field: string; dir: 'asc' | 'desc' } | null {
    return this.tab() === 'completed' ? { field: 'closed', dir: 'desc' } : null;
  }

  protected readonly defaultOrder = computed(() =>
    this.tab() === 'completed'
      ? 'Default order: Newest closed first'
      : this.tab() === 'dueSoon'
        ? 'Default order: Overdue first, then due date, then priority'
        : 'Default order: Priority, then ASAP first, then due date, then oldest',
  );

  protected readonly defaultLabel = computed(() =>
    this.tab() === 'completed'
      ? 'Closed date'
      : this.tab() === 'dueSoon'
        ? 'Overdue first, then due date'
        : 'Priority',
  );

  /** The help of Due soon and overdue and Closed, behind the "About this tab" button. */
  protected readonly tabHelp = computed(() => {
    switch (this.tab()) {
      case 'dueSoon':
        return TAB_HELP.dueSoon;
      case 'completed': {
        if (this.windowed()) return TAB_HELP.completed;
        return this.state().closedAll
          ? TAB_HELP.completedAllTime
          : 'Completed or cancelled tasks in the closed-date range you chose.';
      }
      default:
        return null;
    }
  });

  protected readonly tabs = computed<WorkTab[]>(() => {
    const counts = this.data()?.counts;
    return (Object.keys(TAB_LABELS) as TabKey[]).map((key) => ({
      key,
      label: TAB_LABELS[key],
      count: counts ? counts[key] : null,
      emphasize: key === 'active' || key === 'dueSoon',
      hint: TAB_TOOLTIPS[key],
    }));
  });

  /**
   * The needs-attention strip (M1): counts over the whole open assigned set, never narrowed by the grid's filters. "New" (A5) counts the
   * tasks assigned since the start of this visit and is left out on the first visit, when nothing is marked.
   */
  protected readonly stripItems = computed<WorkStripItem[]>(() => {
    const a = this.data()?.attention;
    return STRIP.filter((item) => item.key !== 'new' || this.lastVisit !== null).map((item) => ({
      ...item,
      count: a ? (a[item.key as keyof typeof a] ?? null) : null,
    }));
  });

  /** The strip item whose filter is on (Active tab only), so a second click can switch it off. */
  protected readonly activeStrip = computed<string | null>(() => {
    if (this.tab() !== 'active') return null;
    const f = this.state().filters;
    const dueless = !f.dueFrom && !f.dueTo;
    if (this.state().newOnly) {
      return f.overdue === null && f.asap === null && dueless && f.status.length === 0
        ? 'new'
        : null;
    }
    if (
      f.status.length === 1 &&
      f.status[0] === 'ON_HOLD' &&
      f.overdue === null &&
      f.asap === null &&
      dueless
    )
      return 'onHold';
    if (f.overdue === true && f.asap === null && dueless) return 'overdue';
    if (f.asap === true && f.overdue === null && dueless) return 'asap';
    const today = dateDaysAgo(this.clock.now(), 0, this.zone);
    if (f.dueFrom === today && f.dueTo === today && f.overdue === false && f.asap === null)
      return 'dueToday';
    return null;
  });

  /** True while the Closed tab applies its default 90-day window (no closed-date range, not "all time"). */
  protected readonly windowed = computed(() => {
    const s = this.state();
    return (
      this.tab() === 'completed' &&
      !s.closedAll &&
      !s.filters.completedFrom &&
      !s.filters.completedTo
    );
  });

  /** The empty text: one function over the tab and what the user may open (BUG-8, B4). */
  protected readonly emptyCopy = computed(() =>
    emptyCopy(
      {
        tab: this.tab(),
        windowed: this.windowed(),
        podCount: this.podCount(),
        openOnly: this.noOpenCreated(),
      },
      (code) => this.auth.has(code),
    ),
  );
  protected readonly nearEmptyParts = nearEmptyCopy((code) => this.auth.has(code));

  /**
   * Where the current visit began (ms; a visit ends after more than 30 minutes without activity), read once on arrival: tasks assigned
   * after it show "New". Opening a task and pressing Back does not change it. Null on the first use.
   */
  protected readonly lastVisit: number | null;

  /** The remembered view is applied once, before anything loads. */
  private pendingRestore = false;
  /** A plain visit (no query string, nothing restored) opens the first tab that has something in it, once. */
  private landing = false;
  /** The tab the landing rule chose: it is not stored as the last view. */
  private skipRemember = false;

  constructor() {
    super('my-work');
    const now = () => this.clock.now().getTime();
    this.lastVisit = touchVisit(this.userId(), now());
    trackVisitActivity(this.userId(), now);
    const keys = this.route.snapshot?.queryParamMap?.keys ?? [];
    this.groupPref.set(loadGroup(this.userId()));
    const pref = this.groupPref();
    const last = keys.length === 0 ? this.lastView() : null;
    // The remembered view brings the user's group choice, not the one it was stored with (the choice also survives a visit to Closed).
    const remembered = last
      ? { ...last, group: pref && (last.view === null || last.view === 'active') ? pref : null }
      : null;
    this.landing = keys.length === 0 && !remembered;
    if (remembered) {
      // Open on the tab and filters the user last used, and say so.
      this.pendingRestore = true;
      this.restore(remembered);
    } else if (keys.length === 0 && pref) {
      // A plain visit of someone who groups by due starts grouped, without a notice (nothing was restored).
      this.pendingRestore = true;
      this.navigate({ ...emptyState(), group: pref }, true);
    }
    void loadPodChoices(this.podsApi, this.auth.has('Pod.View')).then((c) => {
      this.pods.set(c.options);
      this.podCount.set(c.memberOf);
    });
    // The browser title names the tab ("My Work: Closed - MatterFlow") and follows tab changes without a reload (M8).
    effect(() => this.pageTitle.pin(`My Work: ${this.tabLabel()}`));
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
    // A closed-date range replaces "all time": the stale flag does not come back when the range is cleared.
    effect(() => {
      const s = this.state();
      if (s.closedAll && (s.filters.completedFrom || s.filters.completedTo)) {
        untracked(() => this.navigate({ ...s, closedAll: false }, true));
      }
    });
  }

  /** Only Active and Due soon are restored as the landing view: Closed and Created by me are reference tabs reached on purpose. */
  protected override lastView(): QueueState | null {
    const view = super.lastView();
    return view && (view.view === null || view.view === 'active' || view.view === 'dueSoon')
      ? view
      : null;
  }

  protected override restoredLabel(view: QueueState): string | null {
    return TAB_LABELS[view.view && view.view in TAB_LABELS ? (view.view as TabKey) : 'active'];
  }

  protected override rememberView(): boolean {
    const remember = !this.skipRemember;
    this.skipRemember = false;
    return remember;
  }

  /** Active and Due soon and overdue list open tasks, Closed lists closed ones; Created by me keeps every row. */
  protected override leavesView(row: TaskQueueRow): boolean {
    switch (this.tab()) {
      case 'active':
      case 'dueSoon':
        return !OPEN_STATUSES.includes(row.status);
      case 'completed':
        return OPEN_STATUSES.includes(row.status);
      default: {
        // Created by me on its Open default (or any status choice): a task whose new status is not chosen leaves.
        const chosen = this.state().filters.status;
        return chosen.length > 0 && !chosen.includes(row.status);
      }
    }
  }

  /** "Show closed tasks": every status, written out as an explicit "All" (B4, B2). */
  protected showClosedTasks(): void {
    const s = this.state();
    this.navigate({ ...s, page: 1, filters: { ...s.filters, status: [] } });
  }

  protected readonly noOpenCreated = computed(
    () =>
      this.tab() === 'createdByMe' &&
      !this.filtered() &&
      this.state().filters.status.length > 0 &&
      sameSet(this.state().filters.status, OPEN_STATUSES),
  );

  protected override leftText(row: TaskQueueRow): string {
    return `${row.statusLabel.toLowerCase()}. Removed from ${this.tabLabel()}.`;
  }

  protected override mergeCounts(current: MyWorkData, fresh: MyWorkData): MyWorkData {
    // A grouped list keeps its bucket sizes until the leaving row is taken off (then it reloads): the headers follow the rows on screen.
    return {
      ...current,
      counts: fresh.counts,
      attention: fresh.attention,
    };
  }

  protected override loaded(data: MyWorkData): void {
    touchVisit(this.userId(), this.clock.now().getTime());
    if (!this.landing) return;
    this.landing = false;
    const next = firstNonEmptyTab(data.counts);
    if (next === 'active') return;
    this.skipRemember = true;
    this.filters.showNotice(`Nothing is assigned to you, so this opens ${TAB_LABELS[next]}.`);
    this.navigate(
      { ...this.state(), view: next, page: 1, sort: null, dir: null, group: null },
      true,
    );
  }

  protected override shouldLoad(params: ParamMap): boolean {
    if (this.pendingRestore) {
      if (params.keys.length === 0) return false;
      this.pendingRestore = false;
    }
    return true;
  }

  protected override podName(id: number): string | null {
    return this.pods().find((p) => p.id === id)?.name ?? null;
  }

  protected override podFilterOptions(): FilterOption[] {
    return this.pods().map((p) => ({ value: String(p.id), label: p.name }));
  }

  protected override fetch(state: QueueState): Observable<MyWorkData> {
    // The Closed tab's 90-day window is the API's default; "Show older" asks for all time. A closed-date range wins over both.
    const closedWindow = this.tab() === 'completed' && state.closedAll ? 'all' : undefined;
    // The visit start travels as an instant; the address only says `new=1`. With no visit on record nothing is new, so a shared `new=1` link
    // lists nothing instead of everything.
    const since = this.lastVisit === null ? null : new Date(this.lastVisit).toISOString();
    const assignedFrom = state.newOnly ? (since ?? this.clock.now().toISOString()) : undefined;
    return this.api.getMyWork(
      this.tab(),
      closedWindow,
      assignedFrom,
      state.group ?? undefined,
      since ?? undefined,
      ...queueArgs(state),
    );
  }

  protected selectTab(key: string): void {
    if (key === this.tab()) return;
    this.navigate(
      this.tabState(
        (key in TAB_LABELS ? key : 'active') as TabKey,
        this.carried(this.state().filters),
      ),
    );
  }

  /** The filters a tab change carries over: the status a plain link starts on (Created by me: Open) is that tab's own default, not a choice. */
  private carried(filters: QueueFilters): QueueFilters {
    const plain =
      this.defaultStatus().length > 0 && !QUEUE_FILTER_PARAMS.some((p) => this.params().has(p));
    return plain ? { ...filters, status: [] } : filters;
  }

  /** The state of a tab: what it cannot use is dropped (columns it owns, statuses it does not offer), so the counts of all tabs agree. */
  private tabState(next: TabKey, filters: QueueFilters): QueueState {
    if (this.filters.noticeMessage()) this.filters.dismissRestored();
    const kept = withoutFilters(filters, OWNED[next]);
    const status = kept.status.filter((code) => STATUSES[next].includes(code));
    return {
      ...this.state(),
      newOnly: this.state().newOnly && (next === 'active' || next === 'dueSoon'),
      view: next === 'active' ? null : next,
      page: 1,
      sort: null,
      dir: null,
      group: next === 'active' ? this.groupPref() : null,
      closedAll: false,
      filters: { ...kept, status },
    };
  }

  /** A strip item applies its filter on Active (switching to it), replacing any other strip item; the pressed one switches off. */
  protected pickStrip(key: string): void {
    const f = this.carried(this.state().filters);
    const base: QueueFilters = {
      ...f,
      overdue: null,
      asap: null,
      dueFrom: null,
      dueTo: null,
      status: f.status.length === 1 && f.status[0] === 'ON_HOLD' ? [] : f.status,
    };
    const patch: Partial<QueueFilters> = key === this.activeStrip() ? {} : this.stripPatch(key);
    const next = this.tabState('active', { ...base, ...patch });
    // "New" is a flag of the address (`new=1`), not a column filter: only its own item sets it.
    this.navigate({ ...next, newOnly: key === 'new' && key !== this.activeStrip() });
  }

  private stripPatch(key: string): Partial<QueueFilters> {
    const today = dateDaysAgo(this.clock.now(), 0, this.zone);
    switch (key) {
      case 'overdue':
        return { overdue: true };
      case 'dueToday':
        return { dueFrom: today, dueTo: today, overdue: false };
      case 'asap':
        return { asap: true };
      case 'onHold':
        return { status: ['ON_HOLD'] };
      default:
        return {};
    }
  }

  /** "Show older": an explicit all-time state (`closed=all`, chip "Closed: all time"), not a date in the year 2000. */
  protected showOlder(): void {
    const s = this.state();
    this.navigate({
      ...s,
      closedAll: true,
      filters: { ...s.filters, completedFrom: null, completedTo: null },
      page: 1,
    });
  }
}
