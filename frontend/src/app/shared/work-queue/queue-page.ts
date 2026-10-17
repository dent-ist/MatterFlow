import { DOCUMENT } from '@angular/common';
import { Signal, computed, effect, inject, signal, untracked } from '@angular/core';
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
import {
  Density,
  TablePrefs,
  WorkPage,
  loadPrefs,
  normalizeColumns,
  savePrefs,
} from './column-prefs';
import { forgetLastView, loadLastView, saveLastView } from './last-view';
import {
  QueueState,
  ViewContext,
  dateDaysAgo,
  parseQueueState,
  toQueryParams,
} from './queue-filters';
import { QueueChoices, mergeOptions } from './queue-choices';
import { WorkListState } from './work-list';

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
    const state = parseQueueState(params);
    const wanted = this.defaultStatus();
    // The same rule as `defaultOnlyBare` in the filter definition: a plain link starts on the default, any other link means what it says.
    if (wanted.length > 0 && !QUEUE_FILTER_PARAMS.some((p) => params.has(p))) {
      return { ...state, filters: { ...state.filters, status: [...wanted] } };
    }
    return state;
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
  protected readonly prefs = signal<TablePrefs>({ columns: [], density: 'comfortable' });
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
    recentFrom: dateDaysAgo(this.clock.now(), 30, this.zone),
  }));

  private requestId = 0;

  protected constructor(protected readonly pageKey: WorkPage) {
    this.prefs.set(loadPrefs(pageKey, this.auth.profile()?.userId ?? null));
    void this.lookups.ensureLoaded();
    effect(() => {
      const state = this.state();
      const params = this.params();
      untracked(() => {
        if (this.shouldLoad(params)) void this.load(state);
      });
    });
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
    this.navigate(view, true);
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

  /** Swaps one row in place (an inline edit); the list is not reloaded. */
  protected replaceRow(row: TaskQueueRow): void {
    this.data.update((d) =>
      d ? { ...d, items: d.items.map((r) => (r.taskId === row.taskId ? row : r)) } : d,
    );
  }

  // ---- URL

  protected navigate(next: QueueState, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams(next, { explicitStatus: this.defaultStatus().length > 0 }),
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
    const defaultDesc = field === 'created' || field === 'completed';
    const currentDir = s.dir ?? (defaultDesc ? 'desc' : 'asc');
    if (s.sort === field) {
      this.navigate({ ...s, dir: currentDir === 'asc' ? 'desc' : 'asc', page: 1 });
    } else {
      this.navigate({ ...s, sort: field, dir: defaultDesc ? 'desc' : 'asc', page: 1 });
    }
  }

  protected resetSort(): void {
    this.navigate({ ...this.state(), sort: null, dir: null, page: 1 });
  }

  protected goToPage(page: number): void {
    this.navigate({ ...this.state(), page });
  }

  protected setPageSize(size: number): void {
    this.navigate({ ...this.state(), pageSize: size, page: 1 });
  }

  // ---- table preferences

  protected setColumns(columns: string[]): void {
    this.updatePrefs({ ...this.prefs(), columns: normalizeColumns(columns) });
  }

  protected setDensity(density: Density): void {
    this.updatePrefs({ ...this.prefs(), density });
  }

  /** A chip on a hidden column asks for its column. */
  protected showColumn(column: string): void {
    this.setColumns([...this.prefs().columns, column]);
  }

  private updatePrefs(prefs: TablePrefs): void {
    this.prefs.set(prefs);
    savePrefs(this.pageKey, this.userId(), prefs);
  }
}
