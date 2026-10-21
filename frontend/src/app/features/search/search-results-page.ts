import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { AdvancedSearchPage, SearchClient, SearchGroup } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import {
  SEARCH_ERROR_MESSAGE,
  SearchTypeInfo,
  isSearchable,
  noResultsMessage,
  searchableTypes,
} from '../../shared/search/search-meta';
import { AdminListShell } from '../../shared/ui/admin-list-shell';
import { ErrorReference } from '../../shared/ui/error-reference';
import { ScrollArea } from '../../shared/ui/fixed-page';
import { Pager } from '../../shared/ui/pager';
import { PAGE_SIZES } from '../../shared/ui/list-query';
import { restoreRowFocus } from '../../shared/ui/row-nav';
import { HitTable } from './hit-table';
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
  imports: [AdminListShell, ErrorReference, RouterLink, Button, HitTable, ScrollArea, Pager],
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
      <a
        mfPrimary
        class="mf-btn"
        routerLink="/search/advanced"
        [queryParams]="{ q: trimmed() || null }"
        >Advanced search</a
      >

      @if (!searchable()) {
        <div class="pg-state" data-state="short">
          <p>
            Type at least 2 characters (or a number) in the search box to search clients, matters,
            tasks and assets.
          </p>
        </div>
      } @else if (tab() === 'all') {
        @switch (state()) {
          @case ('loading') {
            <div class="pg-state" role="status" aria-busy="true" data-state="loading">
              Searching...
            </div>
          }
          @case ('error') {
            <div class="pg-alert" role="alert" data-state="error">
              {{ errorMessage }}
              <mf-error-reference />
              <p-button label="Try again" severity="secondary" (onClick)="load()" />
            </div>
          }
          @case ('ready') {
            @if (sections().length === 0) {
              <div class="pg-state" data-state="empty">
                <p>{{ emptyMessage() }}</p>
                <a class="pg-link" routerLink="/search/advanced" [queryParams]="{ q: trimmed() }"
                  >Try advanced search</a
                >
              </div>
            } @else {
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
                    <mf-search-hit-table
                      [hits]="section.group.items"
                      [query]="trimmed()"
                      [caption]="section.info.label"
                    />
                  </section>
                }
              </div>
            }
          }
        }
      } @else {
        @switch (typeState()) {
          @case ('loading') {
            <div class="pg-state" role="status" aria-busy="true" data-state="loading">
              Searching...
            </div>
          }
          @case ('error') {
            <div class="pg-alert" role="alert" data-state="error">
              {{ errorMessage }}
              <mf-error-reference />
              <p-button label="Try again" severity="secondary" (onClick)="loadType()" />
            </div>
          }
          @case ('ready') {
            @if (typePage(); as result) {
              @if (result.items.length === 0) {
                <div class="pg-state" data-state="empty">
                  <p>{{ emptyMessage() }}</p>
                  <a
                    class="pg-link"
                    routerLink="/search/advanced"
                    [queryParams]="{ type: tab(), q: trimmed() }"
                    >Try advanced search</a
                  >
                </div>
              } @else {
                <div class="mf-table-wrap" [mfScrollArea]="tabLabel() + ' results'">
                  <mf-search-hit-table
                    [hits]="result.items"
                    [query]="trimmed()"
                    [caption]="tabLabel()"
                  />
                </div>
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

  private readonly api = inject(SearchClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly errorMessage = SEARCH_ERROR_MESSAGE;
  protected readonly pageSizes = PAGE_SIZES;
  /** The overview and the counts (one answer for the query). */
  protected readonly state = signal<LoadState>('loading');
  protected readonly groups = signal<SearchGroup[] | null>(null);
  protected readonly normalized = signal<string | null>(null);
  /** The open type tab's page of hits. */
  protected readonly typeState = signal<LoadState>('loading');
  protected readonly typePage = signal<AdvancedSearchPage | null>(null);

  protected readonly trimmed = computed(() => (this.q() ?? '').trim());
  protected readonly searchable = computed(() => isSearchable(this.q()));
  protected readonly emptyMessage = computed(() => noResultsMessage(this.trimmed()));
  protected readonly types = computed(() => searchableTypes((c) => this.auth.has(c)));
  protected readonly tab = computed<SearchTabKey>(() => resolveTab(this.type(), this.types()));
  protected readonly tabLabel = computed(
    () => this.types().find((t) => t.type === this.tab())?.label ?? 'Search',
  );
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

  constructor() {
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
    this.typeState.set('loading');
    try {
      const result = await firstValueFrom(
        this.api.advancedSearch(
          type,
          this.trimmed(),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
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

  protected select(key: string): void {
    void this.navigate({ type: key === ALL_TAB ? null : key, page: null });
  }

  protected goToPage(page: number): void {
    void this.navigate({ page: page <= 1 ? null : page });
  }

  protected setPageSize(size: number): void {
    void this.navigate({ pageSize: size === PAGE_SIZES[0] ? null : size, page: null });
  }

  private navigate(
    params: Record<string, string | number | null>,
    replace = false,
  ): Promise<boolean> {
    return this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }
}
