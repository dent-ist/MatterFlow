import { toSignal } from '@angular/core/rxjs-interop';
import { Injectable, computed, inject } from '@angular/core';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { MmFilters, filtersToParams, parseFilters } from '../my-matters-filters';
import { STATUS_FILTERS, SHOW_FILTERS, ShowFilter, StatusFilter } from './mm-models';

export const MM_TABS = ['overview', 'calendar', 'assets', 'metrics', 'activity'] as const;
export type MmTab = (typeof MM_TABS)[number];
export const TAB_LABELS: Record<MmTab, string> = {
  overview: 'Overview',
  calendar: 'Calendar',
  assets: 'Assets',
  metrics: 'Metrics',
  activity: 'Activity',
};
export type MetricsView = 'breakdown' | 'data';
/** The kinds of the Calendar's "Shows" multi-select. */
export const CAL_SHOWS = ['events', 'critical', 'high', 'all', 'overdue'] as const;
export type CalShow = (typeof CAL_SHOWS)[number];
export const DEFAULT_CAL_SHOWS: readonly CalShow[] = ['events', 'critical'];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * What the My Matters page shows, kept in the address (`?clientId=&matterId=&tab=&status=&show=&month=&mview=&shows=`) so a link and Back restore it. One place for the
 * Client and Matter dropdowns, the tree and the tabs: picking a matter sets its client, picking a client that does not own the chosen matter clears the matter. The Status and
 * Show filters belong to the Overview grid and reset when the client or the matter changes.
 */
@Injectable()
export class MmScopeStore {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly canAll = computed(() => this.auth.has('Matter.AssignManagers'));
  readonly filters = computed<MmFilters>(() => parseFilters(this.params(), this.canAll()), {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  readonly clientId = computed(() => this.filters().clientId);
  readonly matterId = computed(() => this.filters().matterId);

  readonly tab = computed<MmTab>(() => {
    const t = this.params().get('tab') as MmTab | null;
    return t && MM_TABS.includes(t) ? t : 'overview';
  });
  readonly status = computed<StatusFilter>(() => {
    const s = this.params().get('status');
    return STATUS_FILTERS.find((x) => x.key === s)?.key ?? 'open';
  });
  readonly show = computed<ShowFilter>(() => {
    const s = this.params().get('show');
    return SHOW_FILTERS.find((x) => x.key === s)?.key ?? 'everything';
  });
  /** The month of the Calendar (yyyy-MM); null = this month. */
  readonly month = computed(() => {
    const m = this.params().get('month');
    return m && MONTH.test(m) ? m : null;
  });
  readonly metricsView = computed<MetricsView>(() =>
    this.params().get('mview') === 'data' ? 'data' : 'breakdown',
  );
  readonly calShows = computed<readonly CalShow[]>(() => {
    const raw = this.params().get('shows');
    if (raw === null) return DEFAULT_CAL_SHOWS;
    return raw.split(',').filter((x): x is CalShow => (CAL_SHOWS as readonly string[]).includes(x));
  });
  /** The asset opened in the Assets tab's side panel (`?asset=`), e.g. from an asset activity item. */
  readonly assetId = computed(() => {
    const v = this.params().get('asset');
    const n = v && /^[1-9]\d*$/.test(v) ? Number(v) : null;
    return n;
  });
  readonly page = computed(() => {
    const v = this.params().get('page');
    const n = v && /^[1-9]\d*$/.test(v) ? Number(v) : 1;
    return n;
  });
  /** The activity kind carried to the Activity tab (`?kind=`). */
  readonly kind = computed(() => this.params().get('kind'));

  go(queryParams: Params, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  private reset(): Params {
    return { status: null, show: null, page: null, asset: null, kind: null };
  }

  /** A client was picked: a matter of another client is dropped. `matterClient` is the client of the current matter, when known. */
  setClient(clientId: number | null, matterClient: number | null): void {
    const keepMatter = clientId !== null && matterClient === clientId;
    this.go({
      ...filtersToParams({
        ...this.filters(),
        clientId,
        matterId: keepMatter ? this.filters().matterId : null,
      }),
      ...this.reset(),
    });
  }

  /** A matter was picked: its client is set with it. */
  setMatter(matterId: number | null, clientId: number | null): void {
    this.go({
      ...filtersToParams({
        ...this.filters(),
        matterId,
        clientId: matterId === null ? this.filters().clientId : clientId,
      }),
      ...this.reset(),
    });
  }

  clear(): void {
    this.go({
      ...filtersToParams({ ...this.filters(), clientId: null, matterId: null }),
      ...this.reset(),
    });
  }

  setTab(tab: MmTab): void {
    this.go({ tab: tab === 'overview' ? null : tab, page: null, asset: null, kind: null });
  }
}
