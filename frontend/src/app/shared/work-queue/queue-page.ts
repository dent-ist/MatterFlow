import { Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, firstValueFrom, map } from 'rxjs';
import { TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { LookupStore } from '../../core/lookups/lookup-store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import {
  Density,
  TablePrefs,
  WorkPage,
  loadPrefs,
  normalizeColumns,
  savePrefs,
} from './column-prefs';
import {
  ChipNames,
  QueueFilters,
  QueueState,
  ViewContext,
  dateDaysAgo,
  emptyFilters,
  emptyState,
  filterCount,
  parseQueueState,
  sameSet,
  toQueryParams,
} from './queue-filters';
import { loadLastView, saveLastView } from './last-view';
import { WorkListState } from './work-list';

/** What every queue response has in common. */
export interface QueuePageData {
  items: TaskQueueRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Shared behavior of the Task Queue, My Work and Pod Work pages: the URL query string is the only state (filters, sort, page, tab),
 * every change navigates, every navigation loads once, and a stale response never overwrites a newer one. Table preferences are
 * remembered per user. Subclasses only say how to fetch.
 */
export abstract class QueuePageBase<TData extends QueuePageData> {
  protected readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);
  protected readonly lookups = inject(LookupStore);
  protected readonly clock = inject(Clock);
  protected readonly zone = inject(USER_TIME_ZONE);

  /** The URL as a state; re-emits on every navigation. */
  protected readonly state: Signal<QueueState> = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseQueueState(params))),
    { initialValue: emptyState() },
  );

  protected readonly loadState = signal<WorkListState>('loading');
  protected readonly data = signal<TData | null>(null);
  protected readonly rows = computed(() => this.data()?.items ?? []);
  protected readonly total = computed(() => this.data()?.total ?? 0);

  protected readonly userId = computed(() => this.auth.profile()?.userId ?? null);
  protected readonly prefs = signal<TablePrefs>({ columns: [], density: 'comfortable' });
  /** The status set the page starts on, shown quietly (no chip, no count) while it is unchanged. */
  protected readonly defaultStatus = computed(() => this.defaultFilters().status);
  /** True when the user has set something beyond the page's default view; drives the "No tasks match these filters" empty state. */
  protected readonly filtered = computed(() => {
    const f = this.state().filters;
    const wanted = this.defaultStatus();
    const quiet = wanted.length > 0 && sameSet(f.status, wanted);
    return filterCount(f) - (quiet ? 1 : 0) > 0;
  });

  /** Names of the things the active chips refer to, learned from the rows on screen. */
  protected readonly chipNames = computed<ChipNames>(() => {
    const rows = this.rows();
    const me = this.userId();
    const user = (id: number) => {
      if (id === me) return 'Me';
      for (const r of rows) {
        if (r.assignedUser?.userId === id) return r.assignedUser.displayName;
        if (r.createdBy?.userId === id) return r.createdBy.displayName;
      }
      return `User ${id}`;
    };
    const find = <T>(pick: (r: TaskQueueRow) => T | undefined, fallback: string): T | string =>
      rows.map(pick).find((v) => v !== undefined) ?? fallback;
    return {
      statusLabel: (code) => this.lookups.statusLabel(code),
      priorityLabel: (id) => this.lookups.priority(id)?.label ?? `Priority ${id}`,
      podName: (id) => this.podName(id) ?? `Pod ${id}`,
      userName: user,
      clientName: (id) =>
        String(find((r) => (r.clientId === id ? r.clientName : undefined), `Client ${id}`)),
      matterName: (id) =>
        String(find((r) => (r.matterId === id ? r.matterRef : undefined), `Matter ${id}`)),
      projectName: (id) =>
        String(find((r) => (r.projectId === id ? r.projectName : undefined), `Project ${id}`)),
      typeName: (id) =>
        String(find((r) => (r.taskTypeId === id ? r.taskTypeName : undefined), `Type ${id}`)),
      workflowName: (id) =>
        String(
          find(
            (r) => (r.workflowDefinitionId === id ? r.workflowName : undefined),
            `Workflow ${id}`,
          ),
        ),
    };
  });

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
      untracked(() => {
        if (this.shouldLoad(state)) void this.load(state);
      });
    });
  }

  /** The filters "Clear all filters" returns to: none, except on the Task Queue, which starts on All open. */
  protected defaultFilters(): QueueFilters {
    return emptyFilters();
  }

  /** False to skip loading for this URL state (the Task Queue redirects a bare URL to its default view first). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected shouldLoad(_state: QueueState): boolean {
    return true;
  }

  /** The view this user last looked at on this screen (Task Queue, My Work), for a visit with no query string. */
  protected lastView(): QueueState | null {
    return this.pageKey === 'pod-work' ? null : loadLastView(this.pageKey, this.userId());
  }

  /** Fetches one page for the state. */
  protected abstract fetch(state: QueueState): Observable<TData>;

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
    this.loadState.set('loading');
    try {
      const result = await firstValueFrom(this.fetch(state));
      if (id !== this.requestId) return;
      this.data.set(result);
      this.loadState.set('ready');
      if (this.pageKey !== 'pod-work') saveLastView(this.pageKey, this.userId(), state);
      this.loaded(result);
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
      queryParams: toQueryParams(next),
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  protected setFilters(filters: QueueFilters): void {
    this.navigate({ ...this.state(), filters, page: 1 });
  }

  protected clearFilters(): void {
    this.navigate({
      ...emptyState(),
      filters: this.defaultFilters(),
      view: this.state().view,
      podId: this.state().podId,
    });
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

  private updatePrefs(prefs: TablePrefs): void {
    this.prefs.set(prefs);
    savePrefs(this.pageKey, this.userId(), prefs);
  }
}
