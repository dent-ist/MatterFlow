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
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { SearchClient, SearchGroup } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import {
  SEARCH_ERROR_MESSAGE,
  SearchTypeInfo,
  isSearchable,
  noResultsMessage,
  searchableTypes,
} from '../../shared/search/search-meta';
import { HitTable } from './hit-table';
import { ErrorReference } from '../../shared/ui/error-reference';
import { PageHeader } from '../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

/** First page of each section, and how much one "Show more" adds (the API caps a group at 50). */
export const RESULTS_FIRST = 10;
export const RESULTS_STEP = 15;
export const RESULTS_MAX = 50;

interface Section {
  info: SearchTypeInfo;
  group: SearchGroup;
  /** The size currently requested for this group. */
  limit: number;
  busy: boolean;
}

/**
 * Search results (UX S11, `/search?q=`): one section per object type the user may view, best matches first, each with "Show more". Number input is
 * echoed in its normalized form ("Showing results for 00343-00012"). The query lives in the URL so a result list can be shared and reloaded.
 */
@Component({
  selector: 'mf-search-results-page',
  imports: [PageHeader, ErrorReference, RouterLink, Button, HitTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  template: `
    <mf-page-header heading="Search results">
      <a
        mfActions
        class="mf-btn"
        routerLink="/search/advanced"
        [queryParams]="{ q: trimmed() || null }"
        >Advanced search</a
      >
    </mf-page-header>

    @if (!searchable()) {
      <div class="pg-state" data-state="short">
        <p>
          Type at least 2 characters (or a number) in the search box to search clients, matters,
          tasks and assets.
        </p>
      </div>
    } @else {
      <p class="pg-muted" data-echo>
        @if (normalized(); as n) {
          Showing results for <strong class="pg-mono">{{ n }}</strong> (you typed "{{ trimmed() }}")
        } @else {
          Showing results for "{{ trimmed() }}"
        }
      </p>

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
          @if (moreError()) {
            <div class="pg-alert" role="alert" data-state="more-error">{{ errorMessage }}</div>
          }
          @if (sections().length === 0) {
            <div class="pg-state" data-state="empty">
              <p>{{ emptyMessage() }}</p>
              <a class="pg-link" routerLink="/search/advanced" [queryParams]="{ q: trimmed() }"
                >Try advanced search</a
              >
            </div>
          } @else {
            @for (section of sections(); track section.info.type) {
              <section
                class="res-section"
                [attr.data-section]="section.info.type"
                [attr.aria-labelledby]="'res-h-' + section.info.type"
              >
                <h2 class="res-heading" [id]="'res-h-' + section.info.type">
                  {{ section.info.label }}
                  <span class="pg-muted"
                    >({{ section.group.items.length }}{{ section.group.hasMore ? '+' : '' }})</span
                  >
                </h2>
                @if (section.group.items.length === 0) {
                  <p class="pg-muted">No {{ section.info.label.toLowerCase() }} match.</p>
                } @else {
                  <mf-search-hit-table
                    [hits]="section.group.items"
                    [query]="trimmed()"
                    [caption]="section.info.label"
                  />
                  @if (section.group.hasMore) {
                    <div class="res-more">
                      @if (section.limit < max) {
                        <p-button
                          label="Show more"
                          severity="secondary"
                          [loading]="section.busy"
                          [attr.data-show-more]="section.info.type"
                          (onClick)="showMore(section.info.type)"
                        />
                      } @else {
                        <p class="pg-muted" data-capped>
                          Showing the first {{ max }}.
                          <a
                            class="pg-link"
                            routerLink="/search/advanced"
                            [queryParams]="{ type: section.info.type, q: trimmed() }"
                            >Refine in advanced search</a
                          >
                        </p>
                      }
                    </div>
                  }
                }
              </section>
            }
          }
        }
      }
    }

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
    .res-more {
      padding: var(--mf-s2) 0;
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

  private readonly api = inject(SearchClient);
  private readonly auth = inject(AuthStore);

  protected readonly errorMessage = SEARCH_ERROR_MESSAGE;
  protected readonly max = RESULTS_MAX;
  protected readonly state = signal<LoadState>('loading');
  protected readonly sections = signal<Section[]>([]);
  protected readonly normalized = signal<string | null>(null);
  protected readonly moreError = signal(false);

  protected readonly trimmed = computed(() => (this.q() ?? '').trim());
  protected readonly searchable = computed(() => isSearchable(this.q()));
  protected readonly emptyMessage = computed(() => noResultsMessage(this.trimmed()));
  protected readonly announcement = computed(() => {
    if (!this.searchable()) return '';
    switch (this.state()) {
      case 'loading':
        return 'Searching';
      case 'error':
        return SEARCH_ERROR_MESSAGE;
      default: {
        const count = this.sections().reduce((n, s) => n + s.group.items.length, 0);
        return count === 0
          ? noResultsMessage(this.trimmed())
          : `${count} ${count === 1 ? 'result' : 'results'} for ${this.trimmed()}`;
      }
    }
  });

  private requestId = 0;

  constructor() {
    effect(() => {
      this.q();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    if (!this.searchable()) return;
    const id = ++this.requestId;
    this.state.set('loading');
    this.moreError.set(false);
    const types = searchableTypes((c) => this.auth.has(c));
    try {
      const result = await firstValueFrom(
        this.api.search(
          this.trimmed(),
          types.map((t) => t.type),
          RESULTS_FIRST,
        ),
      );
      if (id !== this.requestId) return;
      this.normalized.set(result.normalized ?? null);
      this.sections.set(
        types.flatMap((info) => {
          const group = result.groups.find((g) => g.type === info.type);
          return group && group.items.length > 0
            ? [{ info, group, limit: RESULTS_FIRST, busy: false }]
            : [];
        }),
      );
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }

  /** Re-asks for one type with a larger cap (the results of the other types stay as they are). */
  protected async showMore(type: string): Promise<void> {
    const section = this.sections().find((s) => s.info.type === type);
    if (!section || section.busy) return;
    const query = this.trimmed();
    const limit = Math.min(section.limit + RESULTS_STEP, RESULTS_MAX);
    this.patch(type, { busy: true });
    this.moreError.set(false);
    try {
      const result = await firstValueFrom(this.api.search(query, [type], limit));
      if (query !== this.trimmed()) return;
      const group = result.groups.find((g) => g.type === type);
      if (group) this.patch(type, { group, limit, busy: false });
      else this.patch(type, { busy: false });
    } catch {
      this.patch(type, { busy: false });
      this.moreError.set(true); // the results already on screen stay
    }
  }

  private patch(type: string, change: Partial<Section>): void {
    this.sections.update((all) => all.map((s) => (s.info.type === type ? { ...s, ...change } : s)));
  }
}
