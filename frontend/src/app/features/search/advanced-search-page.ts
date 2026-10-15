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
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  AdvancedSearchPage as AdvancedSearchResult,
  AssetTypeResponse,
  AssetTypesClient,
  ClientsClient,
  MattersClient,
  SearchClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { DEFAULT_STATUS_LABELS, StatusCode } from '../../core/lookups/lookup-store';
import {
  SEARCH_ERROR_MESSAGE,
  SearchType,
  SearchTypeInfo,
  searchTypeInfo,
  searchableTypes,
} from '../../shared/search/search-meta';
import { EntityPicker, PickerOption } from '../../shared/ui/entity-picker';
import { parsePage } from '../../shared/ui/list-helpers';
import { Pager } from '../../shared/ui/pager';
import { HitTable } from './hit-table';
import { ErrorReference } from '../../shared/ui/error-reference';
import { PageHeader } from '../../shared/ui/page-header';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type Tri = 'any' | 'true' | 'false';

const PAGE_SIZE = 25;
const STATUS_CODES = Object.keys(DEFAULT_STATUS_LABELS) as StatusCode[];

/** Which filters each object type offers (the API rejects a filter that does not fit the type). */
export const TYPE_FILTERS: Readonly<Record<SearchType, readonly string[]>> = {
  matter: ['client', 'active', 'sensitive'],
  client: ['active'],
  task: ['status', 'client', 'matter', 'requestor'],
  project: ['matter', 'active'],
  asset: ['matter', 'assetType', 'active'],
};

const tri = (value: string | undefined): Tri =>
  value === 'true' || value === 'false' ? value : 'any';
const triParam = (value: Tri): boolean | undefined =>
  value === 'any' ? undefined : value === 'true';
const toId = (value: string | undefined): number | null => {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : null;
};
const asList = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((v) => v.split(','))
    .filter((v) => v);

/**
 * Advanced Search (UX S11, `/search/advanced`): choose an object type (only those the user may view), fill that type's filters and read paged
 * results. The filters are the list filters of the type; Task filters mirror the Task Queue's (status, client, matter, requestor). Custom fields are
 * not searchable yet (no field is flagged filterable in this release). The whole search lives in the URL, so it can be bookmarked and shared.
 */
@Component({
  selector: 'mf-advanced-search-page',
  imports: [PageHeader, ErrorReference, Button, EntityPicker, HitTable, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  template: `
    <mf-page-header heading="Advanced search" />

    <form
      class="adv-form"
      role="search"
      aria-label="Advanced search"
      (submit)="$event.preventDefault(); submit()"
    >
      <fieldset class="adv-types">
        <legend class="pg-label">Search for</legend>
        @for (info of types(); track info.type) {
          <label class="pg-radio">
            <input
              type="radio"
              name="adv-type"
              [value]="info.type"
              [checked]="formType() === info.type"
              (change)="chooseType(info.type)"
            />
            {{ info.singular }}
          </label>
        }
      </fieldset>

      @if (formType(); as type) {
        <div class="adv-filters" data-filters>
          <div class="pg-filter">
            <label for="adv-q">Text</label>
            <input
              id="adv-q"
              class="mf-control pg-input"
              type="search"
              [placeholder]="textHint()"
              [value]="formQ()"
              (input)="formQ.set($any($event.target).value)"
            />
          </div>

          @if (offers('client')) {
            <mf-entity-picker
              label="Client"
              inputId="adv-client"
              placeholder="Number or name"
              [search]="searchClients"
              [(selected)]="clientPick"
            />
          }
          @if (offers('matter')) {
            <mf-entity-picker
              label="Matter"
              inputId="adv-matter"
              placeholder="Reference or name"
              [search]="searchMatters"
              [(selected)]="matterPick"
            />
          }
          @if (offers('assetType')) {
            <div class="pg-filter">
              <label for="adv-asset-type">Asset type</label>
              <select
                id="adv-asset-type"
                class="mf-control pg-input"
                [value]="formAssetType()"
                (change)="formAssetType.set($any($event.target).value)"
              >
                <option value="">Any type</option>
                @for (t of assetTypes(); track t.assetTypeId) {
                  <option [value]="t.assetTypeId">{{ t.name }}</option>
                }
              </select>
            </div>
          }
          @if (offers('active')) {
            <div class="pg-filter">
              <label for="adv-active">Status</label>
              <select
                id="adv-active"
                class="mf-control pg-input"
                [value]="formActive()"
                (change)="formActive.set($any($event.target).value)"
              >
                <option value="any">Any</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          }
          @if (offers('sensitive')) {
            <div class="pg-filter">
              <label for="adv-sensitive">Sensitive matter</label>
              <select
                id="adv-sensitive"
                class="mf-control pg-input"
                [value]="formSensitive()"
                (change)="formSensitive.set($any($event.target).value)"
              >
                <option value="any">Any</option>
                <option value="true">Sensitive only</option>
                <option value="false">Not sensitive</option>
              </select>
            </div>
          }
          @if (offers('status')) {
            <fieldset class="adv-statuses">
              <legend class="pg-label">Task status</legend>
              @for (code of statusCodes; track code) {
                <label class="pg-radio">
                  <input
                    type="checkbox"
                    [value]="code"
                    [checked]="formStatuses().includes(code)"
                    (change)="toggleStatus(code, $any($event.target).checked)"
                  />
                  {{ statusLabels[code] }}
                </label>
              }
            </fieldset>
          }
          @if (offers('requestor')) {
            <div class="pg-filter">
              <label for="adv-requestor">Requestor</label>
              <input
                id="adv-requestor"
                class="mf-control pg-input"
                type="text"
                placeholder="Name or email"
                [value]="formRequestor()"
                (input)="formRequestor.set($any($event.target).value)"
              />
            </div>
          }
        </div>

        <div class="pg-actions">
          <p-button type="submit" label="Search" icon="pi pi-search" />
          <p-button type="button" label="Reset" severity="secondary" (onClick)="reset()" />
        </div>
      } @else {
        <p class="pg-muted" data-state="no-types">
          You do not have access to any searchable records.
        </p>
      }
    </form>

    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true" data-state="loading">Searching...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert" data-state="error">
          {{ errorMessage }}
          <mf-error-reference />
          <p-button label="Try again" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (result(); as r) {
          @if (r.items.length === 0) {
            <div class="pg-state" data-state="empty">
              <p>No results match these filters.</p>
              <p-button label="Reset" severity="secondary" (onClick)="reset()" />
            </div>
          } @else {
            <h2 class="adv-count" data-count>
              {{ r.total }} {{ r.total === 1 ? 'result' : 'results' }}
            </h2>
            <mf-search-hit-table [hits]="r.items" [query]="q() ?? ''" [caption]="resultCaption()" />
            <mf-pager
              [page]="pageNumber()"
              [pageSize]="pageSize"
              [total]="r.total"
              (pageChange)="goToPage($event)"
            />
          }
        }
      }
    }

    <div class="adv-live" role="status" aria-live="polite" data-live>{{ announcement() }}</div>
  `,
  styles: `
    .adv-form {
      display: grid;
      gap: var(--mf-s4);
      margin-bottom: var(--mf-s5);
      padding: var(--mf-s4);
      background: var(--mf-surface);
      border-radius: var(--mf-radius-lg);
      box-shadow: var(--mf-shadow-1);
    }
    fieldset {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      margin: 0;
      padding: 0;
      border: 0;
    }
    legend {
      padding: 0;
      margin-bottom: var(--mf-s2);
    }
    .adv-filters {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--mf-s4);
    }
    .adv-filters > * {
      min-width: 240px;
    }
    .adv-count {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-h3);
    }
    .adv-live {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class AdvancedSearchPage {
  /** Query parameters (bound by the router). */
  readonly type = input<string>();
  readonly q = input<string>();
  readonly client = input<string>();
  readonly matter = input<string>();
  readonly assetType = input<string>();
  readonly active = input<string>();
  readonly sensitive = input<string>();
  readonly status = input<string | string[]>();
  readonly requestor = input<string>();
  readonly page = input<string>();

  private readonly api = inject(SearchClient);
  private readonly clients = inject(ClientsClient);
  private readonly matters = inject(MattersClient);
  private readonly assetTypesApi = inject(AssetTypesClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly statusCodes = STATUS_CODES;
  protected readonly statusLabels = DEFAULT_STATUS_LABELS;
  protected readonly errorMessage = SEARCH_ERROR_MESSAGE;

  protected readonly types = computed<SearchTypeInfo[]>(() =>
    searchableTypes((c) => this.auth.has(c)),
  );

  // The form (a draft until Search is pressed).
  protected readonly formType = signal<SearchType | null>(null);
  protected readonly formQ = signal('');
  protected readonly clientPick = signal<PickerOption | null>(null);
  protected readonly matterPick = signal<PickerOption | null>(null);
  protected readonly formAssetType = signal('');
  protected readonly formActive = signal<Tri>('any');
  protected readonly formSensitive = signal<Tri>('any');
  protected readonly formStatuses = signal<string[]>([]);
  protected readonly formRequestor = signal('');
  protected readonly assetTypes = signal<AssetTypeResponse[]>([]);

  // The results of the search in the URL.
  protected readonly state = signal<LoadState>('idle');
  protected readonly result = signal<AdvancedSearchResult | null>(null);
  protected readonly pageNumber = computed(() => parsePage(this.page()));
  protected readonly resultCaption = computed(
    () => `${searchTypeInfo(this.type() ?? '')?.label ?? 'Search'} results`,
  );
  protected readonly announcement = computed(() => {
    switch (this.state()) {
      case 'loading':
        return 'Searching';
      case 'error':
        return SEARCH_ERROR_MESSAGE;
      case 'ready': {
        const total = this.result()?.total ?? 0;
        return total === 0 ? 'No results' : `${total} ${total === 1 ? 'result' : 'results'}`;
      }
      default:
        return '';
    }
  });

  protected readonly textHint = computed(() => {
    switch (this.formType()) {
      case 'client':
        return '343 or a name';
      case 'matter':
        return '343-12 or a name';
      case 'task':
        return 'TSK-1042 or a title';
      case 'asset':
        return 'Name, reference or type';
      default:
        return 'A name';
    }
  });

  private requestId = 0;

  readonly searchClients = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(this.clients.listClients(query, undefined, 1, 8, undefined));
    return page.items.map((c) => ({
      id: c.clientId,
      label: `${c.clientNumber} ${c.name}`,
      inactive: !c.isActive,
    }));
  };

  readonly searchMatters = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.matters.listMatters(query, undefined, undefined, undefined, 1, 8, undefined),
    );
    return page.items.map((m) => ({
      id: m.matterId,
      label: `${m.matterRef} ${m.name}`,
      inactive: !m.isActive,
    }));
  };

  constructor() {
    // Follow the URL: fill the form from it and, when it names a search, run it.
    effect(() => {
      this.type();
      this.q();
      this.client();
      this.matter();
      this.assetType();
      this.active();
      this.sensitive();
      this.status();
      this.requestor();
      this.page();
      this.types();
      untracked(() => {
        this.syncForm();
        void this.load();
      });
    });
    void this.loadAssetTypes();
  }

  protected offers(filter: string): boolean {
    const type = this.formType();
    return type !== null && TYPE_FILTERS[type].includes(filter);
  }

  protected chooseType(type: SearchType): void {
    if (this.formType() === type) return;
    this.formType.set(type);
    // Filters of the previous type do not carry over.
    this.clientPick.set(null);
    this.matterPick.set(null);
    this.formAssetType.set('');
    this.formActive.set('any');
    this.formSensitive.set('any');
    this.formStatuses.set([]);
    this.formRequestor.set('');
  }

  protected toggleStatus(code: string, on: boolean): void {
    this.formStatuses.update((all) =>
      on ? [...all.filter((c) => c !== code), code] : all.filter((c) => c !== code),
    );
  }

  protected submit(): void {
    const type = this.formType();
    if (!type) return;
    this.go({
      type,
      q: this.formQ().trim() || null,
      client: this.offers('client') ? (this.clientPick()?.id ?? null) : null,
      matter: this.offers('matter') ? (this.matterPick()?.id ?? null) : null,
      assetType: this.offers('assetType') ? this.formAssetType() || null : null,
      active: this.offers('active') && this.formActive() !== 'any' ? this.formActive() : null,
      sensitive:
        this.offers('sensitive') && this.formSensitive() !== 'any' ? this.formSensitive() : null,
      status: this.offers('status') && this.formStatuses().length > 0 ? this.formStatuses() : null,
      requestor: this.offers('requestor') ? this.formRequestor().trim() || null : null,
      page: null,
    });
  }

  protected reset(): void {
    this.state.set('idle');
    this.result.set(null);
    this.formQ.set('');
    const first = this.formType() ?? this.types()[0]?.type ?? null;
    this.formType.set(null);
    if (first) this.chooseType(first);
    void this.router.navigate([], { queryParams: {} });
  }

  protected goToPage(page: number): void {
    void this.router.navigate([], {
      queryParams: { page: page === 1 ? null : page },
      queryParamsHandling: 'merge',
    });
  }

  async load(): Promise<void> {
    const type = this.searchTypeInUrl();
    if (!type) {
      this.state.set('idle');
      this.result.set(null);
      return;
    }
    const id = ++this.requestId;
    this.state.set('loading');
    try {
      const filters = TYPE_FILTERS[type];
      const result = await firstValueFrom(
        this.api.advancedSearch(
          type,
          this.q()?.trim() || undefined,
          filters.includes('client') ? (toId(this.client()) ?? undefined) : undefined,
          filters.includes('matter') ? (toId(this.matter()) ?? undefined) : undefined,
          undefined,
          filters.includes('assetType') ? (toId(this.assetType()) ?? undefined) : undefined,
          filters.includes('active') ? triParam(tri(this.active())) : undefined,
          filters.includes('sensitive') ? triParam(tri(this.sensitive())) : undefined,
          filters.includes('status') ? this.statusesInUrl() : undefined,
          filters.includes('requestor') ? this.requestor()?.trim() || undefined : undefined,
          this.pageNumber(),
          PAGE_SIZE,
        ),
      );
      if (id !== this.requestId) return;
      this.result.set(result);
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }

  /** The type of the search in the URL, when it is a type the user may search. */
  private searchTypeInUrl(): SearchType | null {
    const info = searchTypeInfo(this.type() ?? '');
    return info && this.auth.has(info.permission) ? info.type : null;
  }

  private statusesInUrl(): string[] | undefined {
    const codes = asList(this.status()).filter((c) => (STATUS_CODES as string[]).includes(c));
    return codes.length > 0 ? codes : undefined;
  }

  /** Copies the URL into the form (pickers get their labels from the API). */
  private syncForm(): void {
    const type = this.searchTypeInUrl() ?? this.formType() ?? this.types()[0]?.type ?? null;
    this.formType.set(type);
    this.formQ.set(this.q() ?? '');
    this.formAssetType.set(this.assetType() ?? '');
    this.formActive.set(tri(this.active()));
    this.formSensitive.set(tri(this.sensitive()));
    this.formStatuses.set(this.statusesInUrl() ?? []);
    this.formRequestor.set(this.requestor() ?? '');

    const clientId = toId(this.client());
    if (clientId === null) this.clientPick.set(null);
    else if (this.clientPick()?.id !== clientId) void this.fillClient(clientId);
    const matterId = toId(this.matter());
    if (matterId === null) this.matterPick.set(null);
    else if (this.matterPick()?.id !== matterId) void this.fillMatter(matterId);
  }

  private async fillClient(id: number): Promise<void> {
    try {
      const c = await firstValueFrom(this.clients.getClient(id));
      this.clientPick.set({
        id: c.clientId,
        label: `${c.clientNumber} ${c.name}`,
        inactive: !c.isActive,
      });
    } catch {
      this.clientPick.set({ id, label: `Client ${id}` });
    }
  }

  private async fillMatter(id: number): Promise<void> {
    try {
      const m = await firstValueFrom(this.matters.getMatter(id));
      this.matterPick.set({
        id: m.matterId,
        label: `${m.matterRef} ${m.name}`,
        inactive: !m.isActive,
      });
    } catch {
      this.matterPick.set({ id, label: `Matter ${id}` });
    }
  }

  private async loadAssetTypes(): Promise<void> {
    try {
      this.assetTypes.set(
        (
          await firstValueFrom(
            this.assetTypesApi.listAssetTypes(undefined, undefined, 1, 100, undefined),
          )
        ).items,
      );
    } catch {
      this.assetTypes.set([]); // the filter then offers only "Any type"
    }
  }

  /** Puts the search in the URL; when the URL already says exactly this, the results are simply fetched again. */
  private go(params: Record<string, string | number | string[] | null>): void {
    const wanted = Object.entries(params)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => `${k}=${[v].flat().join(',')}`)
      .sort()
      .join('&');
    const current = Object.entries({
      type: this.type(),
      q: this.q(),
      client: this.client(),
      matter: this.matter(),
      assetType: this.assetType(),
      active: this.active(),
      sensitive: this.sensitive(),
      status: asList(this.status()).join(',') || undefined,
      requestor: this.requestor(),
    })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('&');
    if (wanted === current && this.pageNumber() === 1) void this.load();
    else void this.router.navigate([], { queryParams: params });
  }
}
