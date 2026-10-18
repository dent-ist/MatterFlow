import { DOCUMENT } from '@angular/common';
import { DestroyRef, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { LookupStore } from '../../core/lookups/lookup-store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { FilterOption } from '../filters/filter-def';
import { ListFilters } from '../filters/list-filters';
import { QUEUE_FILTER_PARAMS, QueueLookups, withoutFilters } from '../filters/queue-defs';
import { PlainLink } from '../filters/filter-def';
import {
  ColumnScope,
  Density,
  TablePrefs,
  WorkPage,
  columnScope,
  defaultColumns,
  loadColumns,
  loadDensity,
  loadPageSize,
  normalizeColumns,
  columnsNoticePending,
  dismissColumnsNotice,
  resetColumns,
  saveColumns,
  saveDensity,
  savePageSize,
} from './column-prefs';
import { forgetLastView, loadLastView, saveLastView } from './last-view';
import {
  DEFAULT_PAGE_SIZE,
  QueueState,
  ViewContext,
  dateDaysAgo,
  parseQueueState,
  SortDirection,
  toQueryParams,
} from './queue-filters';
import { QueueChoices, mergeOptions } from './queue-choices';
import { RowLeaving } from './row-leaving';
import { WorkListState } from './work-list';
import { DUE_SOON_DAYS, RECENT_WINDOW_DAYS } from './work-vocabulary';

/** Sorts whose first click goes newest first. */
const DESC_FIRST: ReadonlySet<string> = new Set(['created', 'completed', 'closed', 'updated']);

/** What every queue response has in common. */
export interface QueuePageData {
  items: TaskQueueRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Shared behavior of the Task Queue, My Work and Pod Work pages: the URL query string is the only state (column filters, sort, page,
 * tab), every change navigates, every navigation loads once, and a stale response never overwrites a newer one. The filters themselves
 * are a `ListFilters` (the shared column-filter row, chips and sheet); the page reads the same address into a `QueueState` for the API.
 * Table preferences are remembered per user. Subclasses only say how to fetch.
 */
export abstract class QueuePageBase<TData extends QueuePageData> {
  protected readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);
  protected readonly lookups = inject(LookupStore);
  protected readonly clock = inject(Clock);
  protected readonly zone = inject(USER_TIME_ZONE);
  protected readonly choices = inject(QueueChoices);
  private readonly document = inject(DOCUMENT);

  /** The column filters (created by the page, from its definitions). */
  protected abstract readonly filters: ListFilters;

  /** The query string; re-emits on every navigation that changes it. */
  protected readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot?.queryParamMap ?? convertToParamMap({}),
  });

  /** The address as the page reads it, with the page's default status for a plain link. Depends on the address only, never on data. */
  protected readonly state: Signal<QueueState> = computed(() => {
    const params = this.params();
    const state = parseQueueState(params, this.rememberedSize());
    const wanted = this.defaultStatus();
    // Grouping is My Work's alone (Active tab); elsewhere the parameter means nothing, and a grouped list has no sort of its own.
    if (state.group && !this.allowsGroup()) state.group = null;
    if (state.group) {
      state.sort = null;
      state.dir = null;
    }
    // The same rule as `defaultOnlyBare` in the filter definition: a plain link starts on the default, any other link means what it says.
    const plain = this.plainLink();
    if (wanted.length > 0 && (!QUEUE_FILTER_PARAMS.some((p) => params.has(p)) || plain?.(params))) {
      return { ...state, filters: { ...state.filters, status: [...wanted] } };
    }
    return state;
  });

  /** What the table's headers show: the address's sort, else the tab's own default (the Closed tab: Closed, newest first). */
  protected readonly tableSort = computed(() => {
    const s = this.state();
    if (s.group) return null;
    return s.sort ?? this.defaultSort()?.field ?? null;
  });
  protected readonly tableDir = computed(() => {
    const s = this.state();
    if (s.group) return null;
    return s.sort ? s.dir : (this.defaultSort()?.dir ?? s.dir);
  });

  protected readonly loadState = signal<WorkListState>('loading');
  protected readonly data = signal<TData | null>(null);
  /**
   * True from the moment another tab (quick view, Pod) is requested until its first response: `data` still holds the previous tab (the
   * tab counts and the Pod list come from it) but its rows must not show under the new tab.
   */
  private readonly staleRows = signal(false);
  private shownKey: string | null = null;
  protected readonly rows = computed(() => (this.staleRows() ? [] : (this.data()?.items ?? [])));
  protected readonly total = computed(() => (this.staleRows() ? 0 : (this.data()?.total ?? 0)));

  protected readonly userId = computed(() => this.auth.profile()?.userId ?? null);
  private readonly sizeChosen = signal(0);
  /** The page size this person chose before (footer select), used when the address names none; 50 when never chosen. */
  protected readonly rememberedSize = computed(() => {
    this.sizeChosen();
    return loadPageSize(this.pageKey, this.userId()) ?? DEFAULT_PAGE_SIZE;
  });
  /** Where the column choice lives: this page and the current tab (X1). */
  protected readonly columnScope = computed<ColumnScope>(() =>
    columnScope(this.pageKey, this.columnTab()),
  );
  /** Column choices made or reset in this visit, by scope: they win over storage, so a change shows at once and a reset forgets it. */
  private readonly columnChoices = signal<Readonly<Record<string, readonly string[] | null>>>({});
  private readonly density = signal<Density>('comfortable');
  /** The current tab's default set, for "Reset columns". */
  protected readonly columnDefaults = computed(() => defaultColumns(this.columnScope()));
  /** The current tab's columns and the page's density. */
  protected readonly prefs = computed<TablePrefs>(() => {
    const scope = this.columnScope();
    const chosen = this.columnChoices()[scope];
    const own = chosen
      ? [...chosen]
      : chosen === null
        ? defaultColumns(scope)
        : loadColumns(scope, this.userId());
    return {
      columns: this.overlayColumns(own),
      density: this.density(),
    };
  });
  private readonly noticeDismissed = signal(false);
  /** The one-time notice about the removed client and matter line (#198); it waits until dismissed. */
  protected readonly columnsNotice = computed(
    () => !this.noticeDismissed() && columnsNoticePending(this.pageKey, this.userId()),
  );
  /** Task Queue and Pod Work: a user who took Matter out keeps that choice and is offered the column back. */
  protected readonly offerMatter = computed(
    () => this.pageKey !== 'my-work' && !this.prefs().columns.includes('matter'),
  );
  /** The columns the table really shows (it folds some away on a narrow window); null until it has measured. */
  protected readonly shownColumns = signal<readonly string[] | null>(null);
  /** True while a filter beyond the page's defaults is set: drives "No tasks match these filters". */
  protected readonly filtered = computed(() => this.filters.activeCount() > 0);

  /** People on screen (assignees and creators of the rows), so the Assignee and Creator lists work without the user directory. */
  private readonly rowPeople = computed<FilterOption[]>(() => {
    const seen = new Map<string, FilterOption>();
    for (const r of this.rows()) {
      for (const u of [r.assignedUser, r.createdBy]) {
        if (u && !seen.has(String(u.userId))) {
          seen.set(String(u.userId), {
            value: String(u.userId),
            label: u.displayName,
            ...(u.isActive ? {} : { hint: '(inactive)' }),
          });
        }
      }
    }
    return [...seen.values()];
  });

  /** Task types and workflows on screen, for the same reason. */
  private readonly rowTypes = computed<FilterOption[]>(() => {
    const seen = new Map<string, FilterOption>();
    for (const r of this.rows()) {
      if (!seen.has(String(r.taskTypeId))) {
        seen.set(String(r.taskTypeId), { value: String(r.taskTypeId), label: r.taskTypeName });
      }
    }
    return [...seen.values()];
  });
  private readonly rowWorkflows = computed<FilterOption[]>(() => {
    const seen = new Map<string, FilterOption>();
    for (const r of this.rows()) {
      const id = String(r.workflowDefinitionId);
      if (!seen.has(id)) seen.set(id, { value: id, label: r.workflowName });
    }
    return [...seen.values()];
  });

  /** The choices of the filter definitions, from the lookups and what is on screen. */
  protected readonly queueLookups = computed<QueueLookups>(() => ({
    statuses: ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((code) => ({
      value: code,
      label: this.lookups.statusLabel(code),
    })),
    priorities: this.lookups.priorities().map((p) => ({
      value: String(p.id),
      label: p.label,
      ...(p.isActive ? {} : { hint: '(inactive)' }),
    })),
    pods: this.podFilterOptions(),
    users: mergeOptions(this.choices.people(), this.rowPeople()),
    types: mergeOptions(this.choices.types(), this.rowTypes()),
    workflows: mergeOptions(this.choices.workflows(), this.rowWorkflows()),
  }));

  protected readonly viewContext = computed<ViewContext>(() => ({
    userId: this.userId(),
    primaryPodId: this.primaryPodId(),
    // "Recently completed" is 30 days including today: the Dashboard's Completed tile (`completedFrom` = today minus 29), #224.
    recentFrom: dateDaysAgo(this.clock.now(), RECENT_WINDOW_DAYS - 1, this.zone),
    dueSoonTo: dateDaysAgo(this.clock.now(), -DUE_SOON_DAYS, this.zone),
    canCreate: this.auth.has('Task.Create'),
  }));

  private requestId = 0;

  /**
   * Rows whose task just left this tab (cancelled or completed from the row, reopened on Closed): shown muted for 4 seconds, then removed
   * with the totals and the page kept right (BUG-9).
   */
  protected readonly leaving = new RowLeaving(
    (taskId) => this.removeRow(taskId),
    (taskId) => this.rowInUse(taskId),
  );

  protected constructor(protected readonly pageKey: WorkPage) {
    this.density.set(loadDensity(pageKey, this.auth.profile()?.userId ?? null));
    void this.lookups.ensureLoaded();
    inject(DestroyRef).onDestroy(() => this.leaving.clear());
    effect(() => {
      const state = this.state();
      const params = this.params();
      untracked(() => {
        if (this.shouldLoad(params)) void this.load(state);
      });
    });
  }

  /** The columns shown for the user's own set: a view's overlay applies here, never to the stored set (Task Queue quick views, #219). */
  protected overlayColumns(own: string[]): string[] {
    return own;
  }

  /** The tab whose column set applies (My Work and Pod Work: the tab key; Task Queue: none). */
  protected columnTab(): string | null {
    return null;
  }

  /** The sort a list shows while the address names none (the Closed tab: closed date, newest first), so its header carries the arrow. */
  protected defaultSort(): { field: string; dir: SortDirection } | null {
    return null;
  }

  /** True where `group=due` applies (My Work, Active tab). */
  protected allowsGroup(): boolean {
    return false;
  }

  /**
   * A link that carries filters and still counts as plain for the status default (Task Queue: `?creator=<me>` is "Created by me", which
   * starts on Open like My Work's, #222); null where every filter means what it says.
   */
  protected plainLink(): PlainLink | null {
    return null;
  }

  /** The status a plain link starts on (Task Queue: the open ones); none elsewhere. */
  protected defaultStatus(): readonly string[] {
    return [];
  }

  /** The record names behind the link-only chips (`?matter=12`), learned from the rows on screen. */
  protected recordName(kind: 'client' | 'matter' | 'project', id: string): string {
    const n = Number(id);
    for (const r of this.rows()) {
      if (kind === 'client' && r.clientId === n) return r.clientName;
      if (kind === 'matter' && r.matterId === n) return r.matterRef;
      if (kind === 'project' && r.projectId === n && r.projectName) return r.projectName;
    }
    return `${kind[0].toUpperCase()}${kind.slice(1)} ${id}`;
  }

  /** The Pods of the Pod filter. */
  protected podFilterOptions(): FilterOption[] {
    return [];
  }

  /** False to skip loading for this address (a page that is about to replace it with a remembered view). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected shouldLoad(_params: ParamMap): boolean {
    return true;
  }

  /** The view this user last looked at on this screen (Task Queue, My Work), for a visit with no query string. */
  protected lastView(): QueueState | null {
    return this.pageKey === 'pod-work'
      ? null
      : loadLastView(this.pageKey, this.userId(), this.defaultStatus());
  }

  /** The tab (or quick view, or Pod) the rows belong to: rows are kept, dimmed, only while a reload asks for the same one. */
  protected contentKey(state: QueueState): string {
    return `${state.view ?? ''}|${state.podId ?? ''}`;
  }

  /** The name of the restored view's tab for the notice ("Due soon and overdue"); null when the screen has no tabs. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected restoredLabel(_view: QueueState): string | null {
    return null;
  }

  /** False to leave the stored last view alone after this load (a landing tab chosen by the page, not by the person). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected rememberView(_state: QueueState): boolean {
    return true;
  }

  /** Applies a remembered view to a plain link and says so ("Restored your last view: ..."). */
  protected restore(view: QueueState): void {
    this.filters.resetHandler = () => this.resetView();
    this.filters.markRestored(this.restoredLabel(view));
    this.navigate(view, true, false);
  }

  /** "Reset to default": the plain list URL, the remembered view forgotten (column and density preferences stay), focus on the heading. */
  protected resetView(): void {
    if (this.pageKey !== 'pod-work') forgetLastView(this.pageKey, this.userId());
    const cleared: Record<string, null> = {};
    for (const key of this.params().keys) cleared[key] = null;
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: cleared,
        queryParamsHandling: 'merge',
      })
      .then(() => {
        this.filters.announcement.set('View reset to default');
        const heading = this.document.querySelector<HTMLElement>('[data-page-title]');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus();
      });
  }

  /** Fetches one page for the state. */
  protected abstract fetch(state: QueueState): Observable<TData>;

  /** The state the API gets: filters the current tab owns (shown disabled) are not sent. */
  protected apiState(state: QueueState): QueueState {
    const disabled = this.filters
      .defs()
      .filter((d) => d.disabledReason?.())
      .map((d) => d.key);
    return disabled.length === 0
      ? state
      : { ...state, filters: withoutFilters(state.filters, disabled) };
  }

  /** The Pod name for a Pod id, when the page knows its Pods. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected podName(_id: number): string | null {
    return null;
  }

  protected primaryPodId(): number | null {
    return null;
  }

  /** Called after each successful load (Pod Work reads the Pod list from the response). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected loaded(_data: TData): void {
    // Optional hook.
  }

  async load(state: QueueState = this.state()): Promise<void> {
    const id = ++this.requestId;
    const key = this.contentKey(state);
    this.staleRows.set(this.shownKey !== null && key !== this.shownKey);
    this.loadState.set('loading');
    try {
      const result = await firstValueFrom(this.fetch(this.apiState(state)));
      if (id !== this.requestId) return;
      this.shownKey = key;
      this.staleRows.set(false);
      this.leaving.clear();
      this.data.set(result);
      this.loadState.set('ready');
      if (this.pageKey !== 'pod-work' && this.rememberView(state)) {
        saveLastView(this.pageKey, this.userId(), state, {
          explicitStatus: this.defaultStatus().length > 0,
        });
      }
      this.filters.reportResults(result.total);
      this.loaded(result);
      this.choices.ensure();
    } catch {
      if (id === this.requestId) this.loadState.set('error');
    }
  }

  /** Swaps one row in place (an inline edit); the list is not reloaded. A row that no longer belongs in the tab starts to leave. */
  protected replaceRow(row: TaskQueueRow): void {
    this.data.update((d) =>
      d ? { ...d, items: d.items.map((r) => (r.taskId === row.taskId ? row : r)) } : d,
    );
    if (this.leavesView(row)) {
      this.leaving.start(row.taskId, () => {
        void this.refreshCounts();
      });
    } else {
      this.leaving.cancel(row.taskId);
      if (this.countsFollowEdits()) void this.refreshCounts();
    }
  }

  /** True where an inline edit can change the counts on screen (Task Queue quick views, #218): they are read again, rows stay. */
  protected countsFollowEdits(): boolean {
    return false;
  }

  /** True when the row, in its new state, no longer belongs in the tab on screen (My Work: Cancelled or Completed on Active). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected leavesView(_row: TaskQueueRow): boolean {
    return false;
  }

  /** Puts a fresh response's tab counts into the data on screen (rows and paging stay); null when the page has no counts. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected mergeCounts(_current: TData, _fresh: TData): TData | null {
    return null;
  }

  /** The tab counts read again without a loading state, so they are right while the row is still on screen. */
  private async refreshCounts(): Promise<void> {
    const id = this.requestId;
    try {
      const fresh = await firstValueFrom(this.fetch(this.apiState(this.state())));
      if (id !== this.requestId) return;
      this.data.update((d) => (d ? (this.mergeCounts(d, fresh) ?? d) : d));
    } catch {
      /* the counts catch up with the next load */
    }
  }

  /** True while the person is using the row's inline menu: removal waits until they are done. */
  private rowInUse(taskId: number): boolean {
    const row = this.rows().find((r) => r.taskId === taskId);
    if (!row) return false;
    const tr = this.document.querySelector(`tr[data-task="${row.taskNumber}"]`);
    return !!tr?.querySelector('[data-inline-trigger][aria-expanded="true"]');
  }

  /** Takes a row that left the tab off the list: the total and the pager follow, focus moves on, an empty page goes back one. */
  private removeRow(taskId: number): void {
    const data = this.data();
    const row = data?.items.find((r) => r.taskId === taskId);
    if (!data || !row) return;
    const tr = this.document.querySelector<HTMLElement>(`tr[data-task="${row.taskNumber}"]`);
    const active = this.document.activeElement;
    const hadFocus = !!tr && !!active && tr.contains(active);
    const column = active?.closest('td')?.getAttribute('data-col') ?? null;
    const next = tr?.nextElementSibling as HTMLElement | null;
    const wrap = tr?.closest<HTMLElement>('[role="region"]') ?? null;
    const items = data.items.filter((r) => r.taskId !== taskId);
    this.data.set({ ...data, items, total: Math.max(0, data.total - 1) });
    this.filters.announcement.set(`${row.taskNumber} ${this.leftText(row)}`);
    if (hadFocus) {
      setTimeout(() => {
        const target =
          (next?.isConnected
            ? (next.querySelector<HTMLElement>(
                `td[data-col="${column}"] a, td[data-col="${column}"] button`,
              ) ?? next.querySelector<HTMLElement>('a, button'))
            : null) ?? wrap;
        target?.focus();
      });
    }
    if (items.length === 0 && this.state().page > 1) this.goToPage(this.state().page - 1);
    else this.rowRemoved();
  }

  /** Called after a row left the list and was taken off it (a grouped list reads its headers again). */
  protected rowRemoved(): void {
    // Optional hook.
  }

  /** The announcement after a row left: "TSK-59 cancelled. Removed from Active." */
  protected leftText(row: TaskQueueRow): string {
    return `${row.statusLabel.toLowerCase()}. Removed from this list.`;
  }

  // ---- URL

  /**
   * The restored-view notice goes with the first thing the person does (#217): a sort, page, view, tab or column change. A replacing
   * navigation is the page's own (the landing tab, the restore itself) and leaves it. Notices with their own text stay until dismissed.
   */
  protected userActed(): void {
    if (!this.filters.noticeMessage()) this.filters.dismissRestored();
  }

  protected navigate(next: QueueState, replaceUrl = false, byUser = !replaceUrl): void {
    if (byUser) this.userActed();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams(next, {
        explicitStatus: this.defaultStatus().length > 0,
        defaultSize: this.rememberedSize(),
      }),
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  /** Clear filters: back to the page's defaults (the tab and the Pod stay). */
  protected clearFilters(): void {
    this.filters.clear();
  }

  protected sortBy(field: string): void {
    const s = this.state();
    const defaultDesc = DESC_FIRST.has(field);
    const fallback = this.defaultSort();
    const current = s.sort ?? fallback?.field ?? null;
    if (current === field) {
      const currentDir =
        s.dir ?? (s.sort ? (defaultDesc ? 'desc' : 'asc') : (fallback?.dir ?? 'asc'));
      this.navigate({
        ...s,
        group: null,
        sort: field,
        dir: currentDir === 'asc' ? 'desc' : 'asc',
        page: 1,
      });
    } else {
      this.navigate({ ...s, group: null, sort: field, dir: defaultDesc ? 'desc' : 'asc', page: 1 });
    }
  }

  protected resetSort(): void {
    this.navigate({ ...this.state(), sort: null, dir: null, page: 1 });
  }

  protected goToPage(page: number): void {
    this.navigate({ ...this.state(), page });
  }

  protected setPageSize(size: number): void {
    // A choice in the footer is the preference; an explicit size in a link is not (#237).
    savePageSize(this.pageKey, this.userId(), size);
    this.sizeChosen.update((n) => n + 1);
    this.navigate({ ...this.state(), pageSize: size, page: 1 });
  }

  // ---- table preferences

  protected setColumns(columns: string[]): void {
    this.userActed();
    const scope = this.columnScope();
    const next = normalizeColumns(columns);
    const def = defaultColumns(scope);
    if (next.length === def.length && next.every((k, i) => k === def[i])) {
      // Back on the default (a "Reset columns" or the same boxes ticked): forget the choice, so later changes of the default apply.
      this.columnChoices.update((c) => ({ ...c, [scope]: null }));
      resetColumns(scope, this.userId());
      return;
    }
    this.columnChoices.update((c) => ({ ...c, [scope]: next }));
    saveColumns(scope, this.userId(), next);
  }

  protected dismissNotice(): void {
    dismissColumnsNotice(this.pageKey, this.userId());
    this.noticeDismissed.set(true);
  }

  protected addMatterColumn(): void {
    this.showColumn('matter');
    this.dismissNotice();
  }

  protected setDensity(density: Density): void {
    this.userActed();
    this.density.set(density);
    saveDensity(this.pageKey, this.userId(), density);
  }

  /** A chip on a hidden column asks for its column. */
  protected showColumn(column: string): void {
    this.setColumns([...this.prefs().columns, column]);
  }
}
