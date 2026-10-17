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
import { queueFilterDefs, withoutFilters } from '../../../shared/filters/queue-defs';
import { CopyParts } from '../../../shared/ui/copy-parts';
import { emptyCopy, nearEmptyCopy } from '../../../shared/work-queue/empty-copy';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { touchVisit, trackVisitActivity } from '../../../shared/work-queue/last-visit';
import { PodOption, loadPodChoices } from '../../../shared/work-queue/pod-options';
import { QueuePageBase } from '../../../shared/work-queue/queue-page';
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  QueueState,
  queueArgs,
} from '../../../shared/work-queue/queue-filters';
import { WorkList } from '../../../shared/work-queue/work-list';
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

/**
 * My Work (UX S02, ticket 50): everything assigned to me from all my Pods, in the tabs Active, Due soon and overdue, Closed and Created by
 * me, most urgent first, with the shared inline column filters. Tab counts follow the filters. The tab and filters live in the URL. A filter
 * the current tab decides itself (Assignee on my own tabs, Creator on Created by me, Due on Due soon and overdue) shows disabled with the reason and
 * is not sent; changing tab drops the filters the new tab owns, so every count is worked out under the same filters.
 */
@Component({
  selector: 'mf-my-work-page',
  imports: [
    FixedPage,
    PageHeader,
    RouterLink,
    CopyParts,
    FiltersBar,
    WorkList,
    WorkTabs,
    WorkViewControls,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/work-queue/work-page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="My Work"> </mf-page-header>

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
          (showColumn)="showColumn($event)"
        >
          <mf-work-view-controls
            [sort]="state().sort"
            [dir]="state().dir"
            [defaultOrder]="defaultOrder()"
            [defaultLabel]="defaultLabel()"
            [tabHelp]="tabHelp()"
            [columns]="prefs().columns"
            [density]="prefs().density"
            (resetSort)="resetSort()"
            (columnsChange)="setColumns($event)"
            [defaultColumns]="columnDefaults()"
            (densityChange)="setDensity($event)"
          >
            @if (windowed()) {
              <button tab-actions type="button" class="mf-btn mf-btn--text" (click)="showOlder()">
                Show older
              </button>
            }
          </mf-work-view-controls>
        </mf-filters-bar>
        <mf-work-list
          [rows]="rows()"
          [total]="total()"
          [page]="state().page"
          [pageSize]="state().pageSize"
          [state]="loadState()"
          [columns]="prefs().columns"
          [density]="prefs().density"
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
          (sortChange)="sortBy($event)"
          (pageChange)="goToPage($event)"
          (pageSizeChange)="setPageSize($event)"
          (retry)="load()"
          (clearFilters)="clearFilters()"
          (rowChange)="replaceRow($event)"
          (columnsShown)="shownColumns.set($event)"
        >
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

  protected readonly tab = computed<TabKey>(() => {
    const view = this.state().view;
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
    disabled['closedWindow'] = () =>
      this.tab() !== 'completed' || range.completedFrom || range.completedTo
        ? 'Applies to the Closed tab.'
        : null;
    const allowed = STATUSES[this.tab()];
    const lookups = this.queueLookups();
    return queueFilterDefs(lookups, {
      closedWindow: true,
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
    openByDefault: true,
    defs: this.defs,
    visibleColumns: this.shownColumns,
  });

  protected readonly tabLabel = computed(() => TAB_LABELS[this.tab()]);

  protected override columnTab(): string {
    return this.tab();
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
        : 'Default order: Priority, ASAP first, Due date, Oldest',
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
    emptyCopy({ tab: this.tab(), windowed: this.windowed(), podCount: this.podCount() }, (code) =>
      this.auth.has(code),
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
    const remembered = keys.length === 0 ? this.lastView() : null;
    this.landing = keys.length === 0 && !remembered;
    if (remembered) {
      // Open on the tab and filters the user last used, and say so.
      this.pendingRestore = true;
      this.restore(remembered);
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
      default:
        return false;
    }
  }

  protected override leftText(row: TaskQueueRow): string {
    return `${row.statusLabel.toLowerCase()}. Removed from ${this.tabLabel()}.`;
  }

  protected override mergeCounts(current: MyWorkData, fresh: MyWorkData): MyWorkData {
    return { ...current, counts: fresh.counts };
  }

  protected override loaded(data: MyWorkData): void {
    touchVisit(this.userId(), this.clock.now().getTime());
    if (!this.landing) return;
    this.landing = false;
    const next = firstNonEmptyTab(data.counts);
    if (next === 'active') return;
    this.skipRemember = true;
    this.filters.showNotice(`Nothing is assigned to you, so this opens ${TAB_LABELS[next]}.`);
    this.navigate({ ...this.state(), view: next, page: 1, sort: null, dir: null }, true);
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
    return this.api.getMyWork(this.tab(), closedWindow, ...queueArgs(state));
  }

  protected selectTab(key: string): void {
    if (key === this.tab()) return;
    if (this.filters.noticeMessage()) this.filters.dismissRestored();
    const next = (key in TAB_LABELS ? key : 'active') as TabKey;
    const s = this.state();
    // The new tab owns some columns and offers some statuses: what it cannot use is dropped, so the counts of all tabs agree.
    const kept = withoutFilters(s.filters, OWNED[next]);
    const status = kept.status.filter((code) => STATUSES[next].includes(code));
    this.navigate({
      ...s,
      view: next === 'active' ? null : next,
      page: 1,
      sort: null,
      dir: null,
      closedAll: false,
      filters: { ...kept, status },
    });
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
