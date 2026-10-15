import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  AssetListItem,
  AssetTypeResponse,
  AssetTypesClient,
  AssetsClient,
} from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ListState, SortHeader, StatusFilter } from '../../../shared/ui/data-table';
import { isActiveParam } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';
import { SearchBox } from '../../../shared/ui/search-box';

/**
 * Global Assets list (UX S08): server-side search by name, type or external reference, filters for status, type and Matter
 * (a Matter can hold 200 to 300 assets, so nothing is filtered in the browser). The URL keeps the filters.
 */
@Component({
  selector: 'mf-assets-list-page',
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    ActiveBadge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    MatterRef,
    SearchBox,
    StatusFilter,
    SortHeader,
    ListState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Assets">
        <p-button
          mfActions
          *mfHasPermission="'Asset.Create'"
          label="New asset"
          icon="pi pi-plus"
          (onClick)="go('/assets/new' + (matterId() ? '?matterId=' + matterId() : ''))"
        />
      </mf-page-header>

      <div class="pg-filters" role="search">
        <mf-search-box
          inputId="asset-search"
          placeholder="Name, type or external reference"
          [value]="q() ?? ''"
          (searchChange)="search($event)"
        />
        <div class="pg-filter">
          <label for="asset-type-filter">Type</label>
          <select
            id="asset-type-filter"
            class="mf-control pg-input"
            [value]="typeId() ?? ''"
            (change)="setType($any($event.target).value)"
          >
            <option value="">All types</option>
            @for (t of types(); track t.assetTypeId) {
              <option [value]="t.assetTypeId">{{ t.name }}</option>
            }
          </select>
        </div>
        <mf-status-filter
          inputId="asset-status"
          [value]="statusFilter()"
          (valueChange)="setStatus($event)"
        />
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
      </div>

      <mf-list-state
        noun="assets"
        [state]="state()"
        [empty]="rows().length === 0"
        [filtered]="hasFilter()"
        [columns]="5"
        (retry)="load()"
        (clear)="clear()"
      >
        <div class="mf-table-wrap" mfScrollArea="Assets list">
          <div class="mf-scroll">
            <table class="pg-table">
              <caption class="pg-sr">
                Assets
              </caption>
              <thead>
                <tr>
                  <th
                    mfSort="displayName"
                    [sort]="sort()"
                    [defaultSort]="defaultSort"
                    (sorted)="setSort($event)"
                  >
                    Name
                  </th>
                  <th
                    mfSort="assetType"
                    [sort]="sort()"
                    [defaultSort]="defaultSort"
                    (sorted)="setSort($event)"
                  >
                    Type
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
                      <a class="pg-link" [routerLink]="['/assets', a.assetId]">{{
                        a.displayName
                      }}</a>
                    </td>
                    <td>{{ a.assetTypeName }}</td>
                    <td>
                      <mf-matter-ref [value]="a.matterRef" [link]="['/matters', a.matterId]" />
                    </td>
                    <td class="pg-mono">{{ a.externalReference }}</td>
                    <td>
                      <mf-active-badge [active]="a.isActive" />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        <mf-pager
          [page]="pageNumber()"
          [pageSize]="pageSize()"
          [pageSizes]="pageSizes"
          [total]="total()"
          (pageChange)="goToPage($event)"
          (pageSizeChange)="setPageSize($event)"
        />
      </mf-list-state>
    </mf-fixed-page>
  `,
})
export class AssetsListPage extends ServerListPage<AssetListItem> {
  /** Query parameters `matterId` and `typeId` (bound by the router). */
  readonly matterId = input<string>();
  readonly typeId = input<string>();

  private readonly api = inject(AssetsClient);
  private readonly typesApi = inject(AssetTypesClient);

  protected readonly defaultSort = 'displayName';
  protected readonly types = signal<AssetTypeResponse[]>([]);

  protected readonly matterChip = computed(() => {
    const first = this.rows()[0];
    return first && String(first.matterId) === this.matterId()
      ? `${first.matterRef} ${first.matterName}`
      : `Matter ${this.matterId()}`;
  });

  constructor() {
    super();
    void this.loadTypes();
  }

  protected override extraFilters() {
    return { matterId: this.matterId(), typeId: this.typeId() };
  }

  protected override watch(): void {
    this.matterId();
    this.typeId();
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

  protected override fetch() {
    const matterId = Number(this.matterId());
    const typeId = Number(this.typeId());
    return firstValueFrom(
      this.api.listAssets(
        Number.isInteger(matterId) && matterId > 0 ? matterId : undefined,
        Number.isInteger(typeId) && typeId > 0 ? typeId : undefined,
        isActiveParam(this.statusFilter()),
        this.q()?.trim() || undefined,
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }

  protected setType(typeId: string): void {
    this.navigate({ typeId: typeId || null, page: null });
  }

  protected clearMatter(): void {
    this.navigate({ matterId: null, page: null });
  }
}
