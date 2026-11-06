import {
  ChangeDetectionStrategy,
  Component,
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
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  AssetListItem,
  AssetTypeResponse,
  AssetTypesClient,
  AssetsClient,
} from '../../api/generated/api-client';
import { HasPermissionDirective } from '../directives/has-permission.directive';
import { ColumnFilterRow } from '../filters/column-filter-row';
import {
  ASSET_STATUS_OPTIONS,
  assetStatusQuery,
  parseAssetStatusKey,
  type AssetStatusKey,
} from '../filters/asset-status-filter';
import { FilterDef, FilterOption } from '../filters/filter-def';
import { ListToolbar } from '../filters/list-toolbar';
import { SortedLine } from './sorted-line';
import { ListFilters } from '../filters/list-filters';
import { AssetTypeChip } from './asset-type-chip';
import { StatusChip } from './status-chip';
import { formatSize } from '../../features/assets/disposition/asset-size';
import { SortHeader } from './data-table';
import { registerTableSkip } from './row-nav';
import { GridFrame } from './grid-frame';
import { GridBody } from './grid-body';
import { ServerListPage } from './list-query';
import { Pager } from './pager';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['type', 'name', 'size', 'externalReference', 'status'] as const;

/**
 * The Assets tab of a Matter (UX S08, S06; Type first, then Name, MD-25): the same inline column filters as the Assets screen (Name, Type, External reference, Status
 * with Active by default; `name`, `typeId`, `extref`, `status` in the URL; the Disposition and the Size of each asset are columns, PM v2 #883), all server-side, with sorting and paging, for the 200 to 300
 * assets a Matter can hold. Creating an asset starts from here with the Matter prefilled and locked.
 */
@Component({
  selector: 'mf-matter-assets',
  imports: [
    StatusChip,
    AssetTypeChip,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    GridFrame,
    SortHeader,
    GridBody,
    ListToolbar,
    SortedLine,
    ColumnFilterRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: './page.scss',
  template: `
    <mf-list-toolbar
      [filters]="filters"
      controls="matter-asset-filter-row"
      searchLabel="Search assets"
    >
      <p-button
        mfPrimary
        *mfHasPermission="'Asset.Create'"
        label="New Asset"
        icon="pi pi-plus"
        data-new-asset
        (onClick)="newAsset()"
      />
      <mf-sorted-line
        mfBarEnd
        [sort]="sort()"
        [defaultSort]="defaultSort"
        [labels]="sortLabels"
        (resetSort)="pickSort(null)"
      />
    </mf-list-toolbar>

    <mf-grid-frame scrollLabel="Assets list" #scroll>
      <div class="mf-scroll">
        <table class="pg-table tt">
          <caption class="pg-sr">
            Assets of this matter
          </caption>
          <thead>
            <tr>
              <th
                mfSort="assetType"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Type
              </th>
              <th
                mfSort="displayName"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Name
              </th>
              <th
                class="pg-num"
                mfSort="size"
                [firstDesc]="true"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Size
              </th>
              <th scope="col">External Reference</th>
              <th
                mfSort="disposition"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Disposition
              </th>
            </tr>
            @if (filters.rowVisible()) {
              <tr
                mfColumnFilterRow
                id="matter-asset-filter-row"
                [filters]="filters"
                [columns]="columns"
              ></tr>
            }
          </thead>
          <tbody
            mfGridBody
            noun="assets"
            emptyText="No assets in this matter yet."
            [state]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            [columns]="5"
            (retry)="load()"
            (clear)="clear()"
            [hidden]="hiddenCount()"
            hiddenLabel="inactive"
            (showAll)="showAll()"
          >
            <p-button
              mfEmptyAction
              *mfHasPermission="'Asset.Create'"
              label="New Asset"
              icon="pi pi-plus"
              severity="secondary"
              data-empty-new-asset
              (onClick)="newAsset()"
            />
            @for (a of rows(); track a.assetId) {
              <tr>
                <td>
                  <span class="ma-type">
                    <mf-asset-type-chip
                      [iconKey]="typeLook(a.assetTypeId)?.iconKey"
                      [colourKey]="typeLook(a.assetTypeId)?.colourKey"
                      [typeId]="a.assetTypeId"
                      [name]="a.assetTypeName"
                      [decorative]="true"
                      size="sm"
                    />
                    {{ a.assetTypeName }}
                  </span>
                </td>
                <td>
                  <a
                    class="mf-link pg-name"
                    [routerLink]="['/assets', a.assetId]"
                    [title]="a.displayName"
                    >{{ a.displayName }}</a
                  >
                </td>
                <td class="pg-num pg-nowrap ma-size" data-size>
                  @if (sizeText(a); as size) {
                    {{ size }}
                  } @else {
                    <span class="pg-muted" aria-hidden="true">–</span
                    ><span class="mf-sr-only">No size</span>
                  }
                </td>
                <td class="pg-mono">
                  @if (a.externalReference) {
                    {{ a.externalReference }}
                  } @else {
                    <span class="pg-muted" aria-hidden="true" data-none>–</span
                    ><span class="mf-sr-only">None</span>
                  }
                </td>
                <td data-status>
                  <mf-status-chip
                    kind="disposition"
                    [code]="a.dispositionCode"
                    data-disposition-badge
                  />
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div frameFoot>
        @if (state() === 'ready' && total() > 0) {
          <mf-pager
            [page]="pageNumber()"
            [pageSize]="pageSize()"
            [pageSizes]="pageSizes"
            [total]="total()"
            [hidden]="hiddenCount()"
            (showAll)="showAll()"
            (pageChange)="goToPage($event)"
            (pageSizeChange)="setPageSize($event)"
          />
        }
      </div>
    </mf-grid-frame>
  `,
})
export class MatterAssets extends ServerListPage<AssetListItem> {
  readonly matterId = input.required<number>();

  private readonly api = inject(AssetsClient);
  private readonly typesApi = inject(AssetTypesClient);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild('scroll', { read: ElementRef });

  protected readonly defaultSort = 'displayName';
  protected readonly sortLabels = {
    displayName: 'Name',
    assetType: 'Type',
    size: 'Size',
    disposition: 'Disposition',
  };
  protected readonly columns = COLUMNS;
  protected readonly types = signal<AssetTypeResponse[]>([]);

  /** How many assets of each type the matter holds (the Type dropdown shows them); empty until the counts arrive. */
  protected readonly typeCounts = signal<ReadonlyMap<number, number>>(new Map());

  protected readonly typeOptions = computed<FilterOption[]>(() =>
    this.types().map((t) => ({
      value: String(t.assetTypeId),
      label: t.name,
      ...(this.typeCounts().has(t.assetTypeId)
        ? { count: this.typeCounts().get(t.assetTypeId) }
        : {}),
    })),
  );

  protected typeLook(id: number): AssetTypeResponse | undefined {
    return this.types().find((t) => t.assetTypeId === id);
  }

  /** One definition per filter: the Assets screen's, without the Matter (it is fixed here). */
  private readonly defs = computed((): FilterDef[] => [
    {
      key: 'typeId',
      label: 'Type',
      column: 'type',
      type: 'multiSelect',
      emptyLabel: 'All Types',
      options: this.typeOptions(),
    },
    { key: 'name', label: 'Name', column: 'name', type: 'text', search: true },
    { key: 'extref', label: 'External Reference', column: 'externalReference', type: 'text' },
    {
      key: 'status',
      label: 'Disposition',
      column: 'status',
      type: 'select',
      options: ASSET_STATUS_OPTIONS,
      default: 'active',
    },
  ]);

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'matter-assets',
    noun: 'assets',
    defs: this.defs,
  });

  constructor() {
    super();
    registerTableSkip();
    void this.loadTypes();
    effect(() => {
      const id = this.matterId();
      untracked(() => void this.loadCounts(id));
    });
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(
      () =>
        this.filters.watchOverflow(
          this.scroll()?.nativeElement.querySelector('.mf-scroll-area') as
            HTMLElement | null | undefined,
        ),
      {
        injector: this.injector,
      },
    );
  }

  protected override readonly emptyOffersClear = true;

  protected override listFilters() {
    return this.filters;
  }

  protected override watch(): void {
    this.matterId();
    super.watch();
  }

  private async loadCounts(matterId: number): Promise<void> {
    try {
      const counts = await firstValueFrom(this.api.getAssetCountsByType(matterId));
      this.typeCounts.set(new Map(counts.map((c) => [c.assetTypeId, c.count + c.retiredCount])));
    } catch {
      // The Type dropdown simply shows no numbers.
    }
  }

  private async loadTypes(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.typesApi.listAssetTypes(undefined, undefined, undefined, 1, 100, undefined),
      );
      this.types.set(page.items);
    } catch {
      this.types.set([]); // the filter just offers no types; the list still works
    }
  }

  protected override fetch() {
    return this.list(
      parseAssetStatusKey(this.filters.text('status')),
      this.pageNumber(),
      this.pageSize(),
    );
  }

  /** The inactive assets the default Active hides, under the same other filters (so "Assets (6)" and 5 rows tell why). */
  protected override fetchHidden() {
    return parseAssetStatusKey(this.filters.text('status')) === 'active'
      ? this.list('notactive', 1, 1)
      : null;
  }

  /** "412 GB", "26,400 Items" or an empty string when the asset has no size. */
  protected sizeText(a: AssetListItem): string {
    return formatSize(a.sizeValue, a.sizeUnit);
  }

  private list(status: AssetStatusKey, page: number, size: number) {
    const { isActive, disposition } = assetStatusQuery(status);
    const typeIds = this.filters
      .list('typeId')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    return firstValueFrom(
      this.api.listAssets(
        this.matterId(),
        typeIds.length > 0 ? typeIds : undefined,
        isActive,
        undefined,
        this.filters.text('name') || undefined,
        this.filters.text('extref') || undefined,
        undefined,
        undefined,
        undefined,
        disposition,
        undefined,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }

  protected newAsset(): void {
    this.go(`/assets/new?matterId=${this.matterId()}`);
  }
}
