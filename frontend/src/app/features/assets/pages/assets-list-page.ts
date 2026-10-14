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
import {
  AssetListItem,
  AssetTypeResponse,
  AssetTypesClient,
  AssetsClient,
} from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import {
  StatusFilter,
  ariaSort,
  isActiveParam,
  nextSort,
  parsePage,
  parseStatus,
  debounced,
} from '../../../shared/ui/list-helpers';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { Pager } from '../../../shared/ui/pager';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Global Assets list (UX S08): server-side search by name, type or external reference, filters for status, type and Matter
 * (a Matter can hold 200 to 300 assets, so nothing is filtered in the browser). The URL keeps the filters.
 */
@Component({
  selector: 'mf-assets-list-page',
  imports: [RouterLink, Button, HasPermissionDirective, Pager, MatterRef],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <header class="pg-head">
      <h1 class="pg-title">Assets</h1>
      <div class="pg-actions">
        <p-button
          *mfHasPermission="'Asset.Create'"
          label="New Asset"
          icon="pi pi-plus"
          (onClick)="go('/assets/new' + (matterId() ? '?matterId=' + matterId() : ''))"
        />
      </div>
    </header>

    <form
      class="pg-filters"
      role="search"
      (submit)="$event.preventDefault(); search(searchBox.value)"
    >
      <div class="pg-filter">
        <label for="asset-search">Search</label>
        <input
          #searchBox
          id="asset-search"
          class="pg-input"
          type="search"
          placeholder="Name, type or external reference"
          [value]="q() ?? ''"
          (keydown.enter)="search(searchBox.value)"
          (input)="searchLater(searchBox.value)"
          (blur)="search(searchBox.value)"
        />
      </div>
      <div class="pg-filter">
        <label for="asset-type-filter">Type</label>
        <select
          id="asset-type-filter"
          class="pg-input"
          [value]="typeId() ?? ''"
          (change)="setType($any($event.target).value)"
        >
          <option value="">All types</option>
          @for (t of types(); track t.assetTypeId) {
            <option [value]="t.assetTypeId">{{ t.name }}</option>
          }
        </select>
      </div>
      <div class="pg-filter">
        <label for="asset-status">Status</label>
        <select
          id="asset-status"
          class="pg-input"
          [value]="statusFilter()"
          (change)="setStatus($any($event.target).value)"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>
      @if (matterId()) {
        <div class="pg-filter">
          <span class="pg-label">Matter</span>
          <span data-matter-chip>
            {{ matterChip() }}
            <button type="button" (click)="clearMatter()" aria-label="Remove matter filter">
              Remove
            </button>
          </span>
        </div>
      }
    </form>

    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading assets...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          Something went wrong. Try again.
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (rows().length === 0) {
          @if (hasFilter()) {
            <div class="pg-state" data-empty="filtered">
              <p>No results match these filters.</p>
              <p-button label="Clear filters" severity="secondary" (onClick)="clear()" />
            </div>
          } @else {
            <div class="pg-state" data-empty="none">
              <p>No assets yet.</p>
            </div>
          }
        } @else {
          <table class="pg-table">
            <caption class="pg-sr">
              Assets
            </caption>
            <thead>
              <tr>
                <th scope="col" [attr.aria-sort]="aria('displayName')">
                  <button type="button" (click)="sortBy('displayName')">Name</button>
                </th>
                <th scope="col" [attr.aria-sort]="aria('assetType')">
                  <button type="button" (click)="sortBy('assetType')">Type</button>
                </th>
                <th scope="col">Matter</th>
                <th scope="col">External reference</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (a of rows(); track a.assetId) {
                <tr>
                  <td>
                    <a class="pg-link" [routerLink]="['/assets', a.assetId]">{{ a.displayName }}</a>
                  </td>
                  <td>{{ a.assetTypeName }}</td>
                  <td>
                    <mf-matter-ref [value]="a.matterRef" [link]="['/matters', a.matterId]" />
                  </td>
                  <td class="pg-mono">{{ a.externalReference }}</td>
                  <td>
                    <span class="pg-chip" [class.pg-chip--inactive]="!a.isActive">{{
                      a.isActive ? 'Active' : 'Inactive'
                    }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <mf-pager
            [page]="pageNumber()"
            [pageSize]="pageSize"
            [total]="total()"
            (pageChange)="goToPage($event)"
          />
        }
      }
    }
  `,
})
export class AssetsListPage {
  /** Query parameters (bound by the router). */
  readonly q = input<string>();
  readonly status = input<string>();
  readonly matterId = input<string>();
  readonly typeId = input<string>();
  readonly page = input<string>();
  readonly sort = input<string>();

  private readonly api = inject(AssetsClient);
  private readonly typesApi = inject(AssetTypesClient);
  private readonly router = inject(Router);

  protected readonly pageSize = 25;
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<AssetListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly types = signal<AssetTypeResponse[]>([]);

  protected readonly statusFilter = computed<StatusFilter>(() => parseStatus(this.status()));
  protected readonly pageNumber = computed(() => parsePage(this.page()));
  protected readonly hasFilter = computed(
    () => !!this.q() || !!this.matterId() || !!this.typeId() || this.statusFilter() !== 'active',
  );
  protected readonly matterChip = computed(() => {
    const first = this.rows()[0];
    return first && String(first.matterId) === this.matterId()
      ? `${first.matterRef} ${first.matterName}`
      : `Matter ${this.matterId()}`;
  });

  private requestId = 0;

  constructor() {
    void this.loadTypes();
    effect(() => {
      this.q();
      this.statusFilter();
      this.matterId();
      this.typeId();
      this.pageNumber();
      this.sort();
      untracked(() => void this.load());
    });
  }

  protected aria(field: string) {
    return ariaSort(this.sort(), field, 'displayName');
  }

  private async loadTypes(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.typesApi.listAssetTypes(undefined, undefined, 1, 100, undefined),
      );
      this.types.set(page.items);
    } catch {
      this.types.set([]); // the filter just offers no types; the list still works
    }
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    if (this.state() === 'error') this.state.set('loading');
    const matterId = Number(this.matterId());
    const typeId = Number(this.typeId());
    try {
      const result = await firstValueFrom(
        this.api.listAssets(
          Number.isInteger(matterId) && matterId > 0 ? matterId : undefined,
          Number.isInteger(typeId) && typeId > 0 ? typeId : undefined,
          isActiveParam(this.statusFilter()),
          this.q()?.trim() || undefined,
          this.pageNumber(),
          this.pageSize,
          this.sort() || undefined,
        ),
      );
      if (id !== this.requestId) return;
      this.rows.set(result.items);
      this.total.set(result.total);
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }

  protected readonly searchLater = debounced((text: string) => this.search(text));

  protected search(text: string): void {
    const q = text.trim() || null;
    if (q === (this.q() ?? null)) return;
    this.navigate({ q, page: null });
  }

  protected setStatus(status: string): void {
    this.navigate({ status: status === 'active' ? null : status, page: null });
  }

  protected setType(typeId: string): void {
    this.navigate({ typeId: typeId || null, page: null });
  }

  protected sortBy(field: string): void {
    this.navigate({ sort: nextSort(this.sort() || 'displayName', field), page: null });
  }

  protected goToPage(page: number): void {
    this.navigate({ page: page === 1 ? null : page });
  }

  protected clearMatter(): void {
    this.navigate({ matterId: null, page: null });
  }

  protected clear(): void {
    this.navigate({ q: null, status: null, matterId: null, typeId: null, page: null });
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  private navigate(params: Record<string, string | number | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge' });
  }
}
