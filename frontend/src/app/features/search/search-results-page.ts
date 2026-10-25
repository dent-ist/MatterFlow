import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdvancedSearchPage, SearchClient, SearchGroup } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { PageTitle, pageTab } from '../../core/title/page-title';
import {
  SEARCH_ERROR_MESSAGE,
  SEARCH_COPY,
  SearchType,
  SearchTypeInfo,
  searchedInLine,
  isSearchable,
  noResultsMessage,
  searchableTypes,
} from '../../shared/search/search-meta';
import { AdminListShell } from '../../shared/ui/admin-list-shell';
import { ScrollArea } from '../../shared/ui/fixed-page';
import { Pager } from '../../shared/ui/pager';
import { PAGE_SIZES } from '../../shared/ui/list-query';
import { restoreRowFocus } from '../../shared/ui/row-nav';
import { SearchFilters } from './search-filters';
import { SearchGrid } from './search-grid';
import {
  CLEARED_PARAMS,
  NO_FILTERS,
  SearchFilterValues,
  activeKinds,
  apiArgs,
  filterParams,
  readFilters,
} from './search-filter-defs';
import {
  ALL_TAB,
  SearchTabKey,
  formatTotal,
  parsePage,
  parsePageSize,
  resolveTab,
  resultTabs,
} from './search-tabs';

type LoadState = 'loading' | 'ready' | 'error';

/** How many hits of each type the All tab shows (the overview; the counts come from the same answer). */
export const OVERVIEW_PER_TYPE = 5;

interface Section {
  info: SearchTypeInfo;
  group: SearchGroup;
}

/**
 * Search results (UX S11, `/search?q=`): a fixed-height page (header, echo line and tabs stay, the hits scroll inside) with the tabs
 * `All | Matters | Clients | Tasks | Projects | Assets` and the true count of each (Search review S2, S5, BUG-4; #466). The counts of all
 * types come from one `GET /search?limit=5`; the tab, the page and the page size are in the address (`type=`, `page=`, `pageSize=`), so Back, Forward
 * and a reload keep them and a result list can be shared. Changing only the tab or the page never asks for the counts again. All lists the
 * best few of each type; a type tab is one type, paged, on the Advanced search endpoint. Number input is echoed in its normalized form
 * ("Showing results for 00343-00012"). Only the types the person may view have a tab; an unknown or not permitted `type` opens All.
 */
@Component({
  selector: 'mf-search-results-page',
  imports: [AdminListShell, RouterLink, SearchFilters, SearchGrid, ScrollArea, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  template: `
    <mf-admin-list-shell
      heading="Search results"
      [crumbs]="[]"
      [description]="echo()"
      [tabs]="tabs()"
      [tab]="tab()"
      tabsLabel="Search results by type"
      idPrefix="search"
      (tabChange)="select($event)"
    >
      @if (tab() !== 'all' && searchable()) {
        <button
          #filtersButton
          mfPrimary
          type="button"
          class="mf-btn"
          data-filters-button
          aria-controls="search-filters-panel"
          [attr.aria-expanded]="panelOpen()"
          (click)="toggleFilters()"
        >
          Filters
          @if (activeFilterCount() > 0) {
            ({{ activeFilterCount() }})
          }
        </button>
      }

      @if (tab() !== 'all' && searchable()) {
        <mf-search-filters
          [type]="typeTab()"
          [values]="filterValues()"
          [open]="panelOpen()"
          (valuesChange)="applyFilters($event)"
          (cleared)="clearFilters()"
        />
      }

      @if (searchedLine(); as line) {
        <p class="res-searched" data-searched-in>{{ line }}</p>
      }
      @if (!searchable()) {
        <div class="pg-state" data-state="short">
          <p>
            Type at least 2 characters (or a number) in the search box to search clients, matters,
            tasks and assets.
          </p>
        </div>
      } @else if (tab() === 'all') {
        @if (state() === 'ready' && sections().length === 0) {
          <div class="pg-state" data-state="empty">
            <p>{{ emptyMessage() }}</p>
          </div>
        } @else if (state() === 'ready') {
          <div class="mf-table-wrap" mfScrollArea="Search results">
            @for (section of sections(); track section.info.type) {
              <section
                class="res-section"
                [attr.data-section]="section.info.type"
                [attr.aria-labelledby]="'res-h-' + section.info.type"
              >
                <h2 class="res-heading" [id]="'res-h-' + section.info.type">
                  {{ section.info.label }}
                  <span class="pg-muted">({{ count(section.group) }})</span>
                </h2>
                <mf-search-grid
                  [type]="section.info.type"
                  [label]="section.info.label"
                  [hits]="section.group.items"
                  [query]="trimmed()"
                />
                @if (
                  section.group.total > section.group.items.length || section.group.totalCapped
                ) {
                  <p class="res-more">
                    <a
                      class="pg-link"
                      data-see-all
                      [routerLink]="[]"
                      [queryParams]="seeAllParams(section.info.type)"
                      queryParamsHandling="merge"
                      (click)="seeAll($event)"
                      >{{ seeAllText(count(section.group)) }}
                      <span class="mf-sr-only">{{ section.info.label.toLowerCase() }}</span></a
                    >
                  </p>
                }
              </section>
            }
          </div>
        } @else {
          <div class="mf-table-wrap" mfScrollArea="Search results">
            <mf-search-grid
              type="mixed"
              label="Search results"
              [state]="state()"
              (retry)="load()"
            />
          </div>
        }
      } @else {
        <div class="mf-table-wrap" [mfScrollArea]="tabLabel() + ' results'">
          <h2 class="pg-sr" id="res-grid-heading" tabindex="-1" data-grid-heading>
            {{ gridHeading() }}
          </h2>
          <mf-search-grid
            [type]="typeTab()"
            [label]="tabLabel()"
            [hits]="typePage()?.items ?? []"
            [state]="typeState()"
            [query]="trimmed()"
            [emptyText]="emptyMessage()"
            [filtered]="activeFilterCount() > 0"
            (retry)="loadType()"
            (clear)="clearFilters()"
          />
        </div>
        @if (typePage(); as result) {
          @if (typeState() === 'ready' && result.items.length > 0) {
            <mf-pager
              [page]="result.page"
              [pageSize]="result.pageSize"
              [pageSizes]="pageSizes"
              [total]="result.total"
              (pageChange)="goToPage($event)"
              (pageSizeChange)="setPageSize($event)"
            />
          }
        }
      }
    </mf-admin-list-shell>

    <div class="res-live" role="status" aria-live="polite" data-live>{{ announcement() }}</div>
  `,
  styles: `
    .res-section {
      margin-bottom: var(--mf-s5);
    }
    .res-heading {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-h3);
    }
    .res-searched {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .res-more {
      margin: var(--mf-s2) 0 0;
    }
    .res-live {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class SearchResultsPage {
  /** The `q` query parameter (bound by the router). */
  readonly q = input<string>();
  /** `type=` (a record type; missing or not permitted is All). */
  readonly type = input<string>();
  /** `page=` of a type tab, from 1. */
  readonly page = input<string>();
  /** `pageSize=` of a type tab (25, 50 or 100). */
  readonly pageSize = input<string>();
  /** The filters of the open type tab, named like the parameters of the Advanced search API (`client`, `matter`, `assetType`, `active`, `sensitive`, `status`, `requestor`). */
  readonly client = input<string>();
  readonly matter = input<string>();
  readonly assetType = input<string>();
  readonly active = input<string>();
  readonly sensitive = input<string>();
  readonly status = input<string | string[]>();
  readonly requestor = input<string>();
  /** `filters=open`: the panel with the controls is open. */
  readonly filters = input<string>();

  private readonly api = inject(SearchClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly pageTitle = inject(PageTitle);

  protected readonly errorMessage = SEARCH_ERROR_MESSAGE;
  protected readonly pageSizes = PAGE_SIZES;
  /** The overview and the counts (one answer for the query). */
  protected readonly state = signal<LoadState>('loading');
  protected readonly groups = signal<SearchGroup[] | null>(null);
  protected readonly normalized = signal<string | null>(null);
  /** The types the server searched (from the same answer as the counts). */
  protected readonly searched = signal<string[] | null>(null);
  /** The open type tab's page of hits. */
  protected readonly typeState = signal<LoadState>('loading');
  protected readonly typePage = signal<AdvancedSearchPage | null>(null);

  protected readonly trimmed = computed(() => (this.q() ?? '').trim());
  protected readonly searchable = computed(() => isSearchable(this.q()));
  protected readonly emptyMessage = computed(() => noResultsMessage(this.trimmed()));
  protected readonly types = computed(() => searchableTypes((c) => this.auth.has(c)));
  protected readonly tab = computed<SearchTabKey>(() => resolveTab(this.type(), this.types()));
  /** The open tab as a record type (only read where the tab is not All). */
  protected readonly typeTab = computed(() => this.tab() as SearchType);
  protected readonly tabLabel = computed(
    () => this.types().find((t) => t.type === this.tab())?.label ?? 'Search',
  );
  /** The filters of the open type tab (none on All). */
  protected readonly filterValues = computed<SearchFilterValues>(() =>
    this.tab() === ALL_TAB
      ? NO_FILTERS
      : readFilters(this.typeTab(), {
          client: this.client(),
          matter: this.matter(),
          assetType: this.assetType(),
          active: this.active(),
          sensitive: this.sensitive(),
          status: this.status(),
          requestor: this.requestor(),
        }),
  );
  protected readonly activeFilterCount = computed(
    () => activeKinds(this.typeTab(), this.filterValues()).length,
  );
  protected readonly panelOpen = computed(
    () => this.filters() === 'open' && this.tab() !== ALL_TAB,
  );
  private readonly filtersButton = viewChild<ElementRef<HTMLElement>>('filtersButton');
  protected readonly gridHeading = computed(() => {
    const total = this.typePage()?.total;
    return total === undefined
      ? this.tabLabel()
      : `${this.tabLabel()}, ${total.toLocaleString('en-US')} ${total === 1 ? 'result' : 'results'}`;
  });
  /** `Searched in: Matters, Clients and Tasks`: what was searched, never what was left out (S8). */
  protected readonly searchedLine = computed(() =>
    this.searchable() && this.state() === 'ready' ? searchedInLine(this.searched(), true) : null,
  );
  protected readonly seeAllText = SEARCH_COPY.seeAll;
  protected readonly pageNumber = computed(() => parsePage(this.page()));
  protected readonly size = computed(() => parsePageSize(this.pageSize()));
  protected readonly tabs = computed(() =>
    this.searchable()
      ? resultTabs(this.types(), this.state() === 'ready' ? this.groups() : null)
      : [],
  );
  protected readonly echo = computed(() => {
    if (!this.searchable()) return '';
    const n = this.normalized();
    return n
      ? `Showing results for ${n} (you typed "${this.trimmed()}")`
      : `Showing results for "${this.trimmed()}"`;
  });

  protected readonly sections = computed<Section[]>(() => {
    const groups = this.groups() ?? [];
    return this.types().flatMap((info) => {
      const group = groups.find((g) => g.type === info.type);
      return group && group.items.length > 0 ? [{ info, group }] : [];
    });
  });

  protected readonly announcement = computed(() => {
    if (!this.searchable()) return '';
    const state = this.tab() === 'all' ? this.state() : this.typeState();
    switch (state) {
      case 'loading':
        return 'Searching';
      case 'error':
        return SEARCH_ERROR_MESSAGE;
      default: {
        const count =
          this.tab() === 'all'
            ? this.sections().reduce((n, s) => n + s.group.items.length, 0)
            : (this.typePage()?.items.length ?? 0);
        return count === 0
          ? noResultsMessage(this.trimmed())
          : `${count} ${count === 1 ? 'result' : 'results'} for ${this.trimmed()}`;
      }
    }
  });

  private requestId = 0;
  private typeRequestId = 0;
  /** A tab change or page change moves focus to the grid heading once the page of hits is there (a See all link, the pager). */
  private focusGridHeading = false;

  constructor() {
    // The document title follows the tab: `Search results: Tasks - MatterFlow` (S21).
    effect(() => {
      this.pageTitle.pin(
        pageTab('Search results', this.tab() === ALL_TAB ? 'All' : this.tabLabel()),
      );
    });
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
    effect(() => {
      if (this.typeState() !== 'ready' || !this.focusGridHeading) return;
      this.focusGridHeading = false;
      afterNextRender(() => document.getElementById('res-grid-heading')?.focus(), {
        injector: this.injector,
      });
    });
    // Back from a task result: focus the link that was left (T9, #324).
    restoreRowFocus('search', () =>
      this.tab() === 'all' ? this.state() === 'ready' : this.typeState() === 'ready',
    );
    // The counts and the overview ask again only when the query changes, never for a change of tab or page.
    effect(() => {
      this.q();
      untracked(() => void this.load());
    });
    // The open type tab asks for its page when the tab, the page, the page size or the query changes.
    effect(() => {
      this.q();
      this.tab();
      this.pageNumber();
      this.size();
      this.filterValues();
      untracked(() => void this.loadType());
    });
  }

  protected count(group: SearchGroup): string {
    return formatTotal(group.total, group.totalCapped);
  }

  async load(): Promise<void> {
    if (!this.searchable()) return;
    const id = ++this.requestId;
    this.state.set('loading');
    this.groups.set(null);
    const types = this.types();
    try {
      const result = await firstValueFrom(
        this.api.search(
          this.trimmed(),
          types.map((t) => t.type),
          OVERVIEW_PER_TYPE,
        ),
      );
      if (id !== this.requestId) return;
      this.normalized.set(result.normalized ?? null);
      this.searched.set(result.searchedTypes ?? null);
      this.groups.set(result.groups);
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }

  async loadType(): Promise<void> {
    const type = this.tab();
    if (!this.searchable() || type === ALL_TAB) return;
    const id = ++this.typeRequestId;
    const filters = apiArgs(this.filterValues());
    this.typeState.set('loading');
    try {
      const result = await firstValueFrom(
        this.api.advancedSearch(
          type,
          this.trimmed(),
          filters.client,
          filters.matter,
          undefined,
          filters.assetType,
          filters.active,
          filters.sensitive,
          filters.status,
          filters.requestor,
          this.pageNumber(),
          this.size(),
        ),
      );
      if (id !== this.typeRequestId) return;
      const last = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (result.items.length === 0 && result.total > 0 && this.pageNumber() > last) {
        // A page past the end (a shared link, a smaller result since): the last page, without adding a history entry.
        void this.navigate({ page: last === 1 ? null : last }, true);
        return;
      }
      this.typePage.set(result);
      this.typeState.set('ready');
    } catch {
      if (id === this.typeRequestId) this.typeState.set('error');
    }
  }

  /** The "See all N" link: the router opens the tab; the grid heading takes focus once its first page is there. */
  protected seeAll(event: MouseEvent): void {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey)
      this.focusGridHeading = true;
  }

  protected select(key: string): void {
    // The filters belong to a type: a tab change drops them.
    void this.navigate({ type: key === ALL_TAB ? null : key, page: null, ...CLEARED_PARAMS });
  }

  protected seeAllParams(type: string): Record<string, string | null> {
    return { type, page: null, ...CLEARED_PARAMS };
  }

  protected toggleFilters(): void {
    void this.navigate({ filters: this.panelOpen() ? null : 'open' }, true);
  }

  /** A filter changed: the address follows at once (a history entry, so Back restores the previous filters) and the list starts at page 1. */
  protected applyFilters(values: SearchFilterValues): void {
    void this.navigate({ ...filterParams(values), page: null });
  }

  /** Clear filters: every filter is dropped and focus returns to the Filters button. */
  protected clearFilters(): void {
    void this.navigate({ ...CLEARED_PARAMS, page: null }).then(() =>
      afterNextRender(() => this.filtersButton()?.nativeElement.focus(), {
        injector: this.injector,
      }),
    );
  }

  protected goToPage(page: number): void {
    this.focusGridHeading = true;
    void this.navigate({ page: page <= 1 ? null : page });
  }

  protected setPageSize(size: number): void {
    this.focusGridHeading = true;
    void this.navigate({ pageSize: size === PAGE_SIZES[0] ? null : size, page: null });
  }

  private navigate(
    params: Record<string, string | string[] | number | null>,
    replace = false,
  ): Promise<boolean> {
    return this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }
}
