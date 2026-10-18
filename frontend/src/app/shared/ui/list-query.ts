import { Directive, computed, inject, input, signal, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError } from '../../core/http/api-error';
import { LoadState } from './data-table';
import { StatusFilter, parsePage, parseStatus } from './list-helpers';

/**
 * What a list needs from the shared column filters (`ListFilters`, shared/filters/list-filters.ts) without importing them: this file is
 * reachable from many lazy chunks, and the filters bring their own.
 */
export interface ListFiltersLike {
  activeCount(): number;
  /** Read by the list's reload effect, so a change of any filter reloads. */
  values(): unknown;
  /** The filters as URL parameters: a stable text key of what the list depends on (see `ServerListPage.watch`). */
  queryParams(): unknown;
  clear(also?: readonly string[]): void;
  reportResults(total: number): void;
  /** Set by the list while its empty state offers its own Clear filters (the bar then shows none). Optional for simple fakes. */
  readonly emptyClear?: { set(value: boolean): void };
  /** Sets one filter in the URL (used by "Show all"). */
  set?(key: string, value: string): void;
}

export const PAGE_SIZES = [25, 50, 100] as const;

/** A page size from the URL, limited to the offered sizes. */
export function parsePageSize(value: string | number | null | undefined): number {
  const n = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : PAGE_SIZES[0];
}

/**
 * URL state shared by every list (UXR-12, UXR-11): `q`, `status` (default Active), `page`, `size` and `sort` are router-bound inputs, and
 * the helpers write changes back to the query string (replacing nothing else). Lists extend this and add their own filters.
 */
@Directive()
export abstract class ListQueryPage {
  readonly q = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();

  protected readonly router = inject(Router);

  /** The sort field when the URL has none; used for `aria-sort`. */
  protected abstract readonly defaultSort: string;

  protected readonly statusFilter = computed<StatusFilter>(() => parseStatus(this.status()));
  protected readonly pageNumber = computed(() => parsePage(this.page()));
  protected readonly pageSize = computed(() => parsePageSize(this.size()));
  protected readonly pageSizes = PAGE_SIZES;

  /** Filters this list adds (a Matter or Client chip, a type); they count as "filtered" and Clear filters resets them. */
  protected extraFilters(): Record<string, unknown> {
    return {};
  }

  /** Pages on the shared column filters return their `ListFilters`: it then drives `hasFilter`, `clear()` and the reload. */
  protected listFilters(): ListFiltersLike | null {
    return null;
  }

  protected readonly hasFilter = computed(
    () =>
      !!this.q() ||
      this.statusFilter() !== 'active' ||
      Object.values(this.extraFilters()).some((v) => !!v) ||
      (this.listFilters()?.activeCount() ?? 0) > 0,
  );

  protected search(text: string): void {
    const q = text.trim() || null;
    if (q === (this.q() ?? null)) return;
    this.navigate({ q, page: null });
  }

  protected setStatus(status: string): void {
    this.navigate({ status: status === 'active' ? null : status, page: null });
  }

  protected setSort(sort: string): void {
    this.navigate({ sort, page: null });
  }

  /** The phone's Sort by select (WP12): the new `sort` of the address, null for the list's default order. */
  protected pickSort(sort: string | null): void {
    this.navigate({ sort, page: null });
  }

  protected goToPage(page: number): void {
    this.navigate({ page: page === 1 ? null : page });
  }

  protected setPageSize(size: number): void {
    this.navigate({ size: size === PAGE_SIZES[0] ? null : size, page: null });
  }

  protected clear(): void {
    const shared = this.listFilters();
    if (shared) {
      shared.clear(['q']);
      return;
    }
    const extras = Object.fromEntries(Object.keys(this.extraFilters()).map((k) => [k, null]));
    this.navigate({ q: null, status: null, page: null, ...extras });
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  protected navigate(params: Record<string, string | number | readonly string[] | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }
}

/**
 * A list whose rows come from the server page by page. Re-fetches whenever the URL state (or anything `watch()` reads) changes, ignores
 * answers to superseded requests, and keeps the rows on screen while a reload runs. `load()` is the Retry action.
 */
@Directive()
export abstract class ServerListPage<T> extends ListQueryPage {
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<T[]>([]);
  protected readonly total = signal(0);
  /** Records the default Status hides ("3 inactive hidden"); 0 when none, when the default is not applied or when the count failed. */
  protected readonly hiddenCount = signal(0);

  /** True for a list whose body is `mfGridBody`: its filtered-empty state has a Clear filters button, so the filters bar shows none then. */
  protected readonly emptyOffersClear: boolean = false;

  private requestId = 0;

  /** Fetch the current page; read the URL signals (`q()`, `statusFilter()`, `pageNumber()`, `pageSize()`, `sort()`). */
  protected abstract fetch(): Promise<{ items: T[]; total: number }>;

  /**
   * The filters as text: a computed, so a change of the definitions alone (options that arrive later, a count in a label) does not look
   * like a change of the filters and does not reload the list.
   */
  private readonly filtersKey = computed(() => {
    const filters = this.listFilters();
    return filters ? JSON.stringify(filters.queryParams()) : '';
  });

  /**
   * The same list on the other side of the default Status, one row (`isActive=false`, `pageSize=1`; no API change, #271). A list that has
   * the default returns null unless it is applied now. A failure is ignored: the list just shows no hint.
   */
  protected fetchHidden(): Promise<{ total: number }> | null {
    return null;
  }

  /** "Show all" in the pager hint: Status = All, in the address. */
  protected showAll(): void {
    this.listFilters()?.set?.('status', 'all');
  }

  /** Read any extra signals the request depends on, so a change reloads the list. */
  protected watch(): void {
    this.filtersKey();
  }

  constructor() {
    super();
    effect(() => {
      this.q();
      this.statusFilter();
      this.pageNumber();
      this.pageSize();
      this.sort();
      this.watch();
      untracked(() => void this.load());
    });
    // The empty state of a filtered list has its own Clear filters; the bar then shows none.
    effect(() => {
      const empty = this.emptyOffersClear && this.state() === 'ready' && this.rows().length === 0;
      this.listFilters()?.emptyClear?.set(empty && (this.listFilters()?.activeCount() ?? 0) > 0);
    });
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    if (this.state() === 'error' || this.state() === 'forbidden') this.state.set('loading');
    try {
      const [result, hidden] = await Promise.all([this.fetch(), this.hiddenTotal()]);
      if (id !== this.requestId) return;
      this.rows.set(result.items);
      this.total.set(result.total);
      this.hiddenCount.set(hidden);
      this.state.set('ready');
      this.listFilters()?.reportResults(result.total);
    } catch (error) {
      if (id === this.requestId)
        this.state.set(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error');
    }
  }

  private async hiddenTotal(): Promise<number> {
    try {
      return (await this.fetchHidden())?.total ?? 0;
    } catch {
      return 0;
    }
  }
}

/**
 * A list for small admin tables whose whole content is loaded once (Task Types): search, the Active filter, sort and paging all run in
 * the browser over the same URL state as the server lists. The page loads `all` and sets `state`; this class derives `rows` and `total`.
 */
@Directive()
export abstract class LocalListPage<T> extends ListQueryPage {
  protected readonly state = signal<LoadState>('loading');
  protected readonly all = signal<T[]>([]);

  /** Text the search box matches against (case-insensitive substring). */
  protected abstract searchText(row: T): string;
  protected abstract isActiveRow(row: T): boolean;
  /** Value to sort by for a sort field; strings sort with locale rules, numbers numerically. */
  protected abstract sortValue(row: T, field: string): string | number;

  /** Pages on the shared column filters check their other filters here (read from `ListFilters`, so a change recomputes the rows). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the default accepts every row; pages override it
  protected matchesFilters(_row: T): boolean {
    return true;
  }

  private readonly matching = computed(() => {
    const status = this.statusFilter();
    const needle = (this.q() ?? '').trim().toLowerCase();
    this.listFilters()?.values();
    const rows = this.all().filter(
      (r) =>
        (status === 'all' || this.isActiveRow(r) === (status === 'active')) &&
        (!needle || this.searchText(r).toLowerCase().includes(needle)) &&
        this.matchesFilters(r),
    );
    const expression = (this.sort() || this.defaultSort).split(',')[0];
    const desc = expression.startsWith('-');
    const field = desc ? expression.slice(1) : expression;
    const direction = desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = this.sortValue(a, field);
      const y = this.sortValue(b, field);
      const order =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true });
      return order * direction;
    });
  });

  protected readonly total = computed(() => this.matching().length);

  /** The current page number, pulled back to the last page when filtering leaves fewer pages. */
  protected readonly shownPage = computed(() =>
    Math.min(this.pageNumber(), Math.max(1, Math.ceil(this.total() / this.pageSize()))),
  );

  protected readonly rows = computed(() => {
    const start = (this.shownPage() - 1) * this.pageSize();
    return this.matching().slice(start, start + this.pageSize());
  });
}
