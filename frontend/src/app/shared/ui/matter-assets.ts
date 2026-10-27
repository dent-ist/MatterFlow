import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
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
import { FiltersBar } from '../filters/filters-bar';
import { ListFilters } from '../filters/list-filters';
import { Badge } from './badge';
import { dispositionOf } from '../../features/assets/disposition/asset-disposition';
import { formatSize } from '../../features/assets/disposition/asset-size';
import { SortHeader } from './data-table';
import { registerTableSkip } from './row-nav';
import { ScrollArea } from './fixed-page';
import { GridBody } from './grid-body';
import { ServerListPage } from './list-query';
import { Pager } from './pager';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['name', 'type', 'size', 'externalReference', 'status'] as const;

/**
 * The Assets tab of a Matter (UX S08, S06): the same inline column filters as the Assets screen (Name, Type, External reference, Status
 * with Active by default; `name`, `typeId`, `extref`, `status` in the URL; the Disposition and the Size of each asset are columns, PM v2 #883), all server-side, with sorting and paging, for the 200 to 300
 * assets a Matter can hold. Creating an asset starts from here with the Matter prefilled and locked.
 */
@Component({
  selector: 'mf-matter-assets',
  imports: [
    Badge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    ScrollArea,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: './page.scss',
  template: `
    <mf-filters-bar [filters]="filters" controls="matter-asset-filter-row" />

    <div class="mf-table-wrap" mfScrollArea="Assets list" #scroll>
      <div class="mf-scroll">
        <table class="pg-table">
          <caption class="pg-sr">
            Assets of this matter
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
              <th scope="col">External reference</th>
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
              label="New asset"
              icon="pi pi-plus"
              severity="secondary"
              data-empty-new-asset
              (onClick)="newAsset()"
            />
            @for (a of rows(); track a.assetId) {
              <tr>
                <td>
                  <a
                    class="pg-link pg-name"
                    [routerLink]="['/assets', a.assetId]"
                    [title]="a.displayName"
                    >{{ a.displayName }}</a
                  >
                </td>
                <td>{{ a.assetTypeName }}</td>
                <td class="pg-num ma-size" data-size>
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
                  @if (a.dispositionCode === 'ACTIVE') {
                    <mf-badge tone="success" icon="pi-check-circle" data-disposition-badge
                      >Active</mf-badge
                    >
                  } @else {
                    <mf-badge
                      [tone]="dispositionOf(a.dispositionCode).tone"
                      [icon]="dispositionOf(a.dispositionCode).icon"
                      data-disposition-badge
                      >{{ dispositionOf(a.dispositionCode).label }}</mf-badge
                    >
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
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
  `,
})
export class MatterAssets extends ServerListPage<AssetListItem> {
  readonly matterId = input.required<number>();

  private readonly api = inject(AssetsClient);
  private readonly typesApi = inject(AssetTypesClient);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly defaultSort = 'displayName';
  protected readonly columns = COLUMNS;
  protected readonly types = signal<AssetTypeResponse[]>([]);

  protected readonly typeOptions = computed<FilterOption[]>(() =>
    this.types().map((t) => ({ value: String(t.assetTypeId), label: t.name })),
  );

  /** One definition per filter: the Assets screen's, without the Matter (it is fixed here). */
  private readonly defs = computed((): FilterDef[] => [
    { key: 'name', label: 'Name', column: 'name', type: 'text' },
    {
      key: 'typeId',
      label: 'Type',
      column: 'type',
      type: 'multiSelect',
      emptyLabel: 'All types',
      options: this.typeOptions(),
    },
    { key: 'extref', label: 'External reference', column: 'externalReference', type: 'text' },
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
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(() => this.filters.watchOverflow(this.scroll()?.nativeElement), {
      injector: this.injector,
    });
  }

  protected override readonly emptyOffersClear = true;

  protected override listFilters() {
    return this.filters;
  }

  protected override watch(): void {
    this.matterId();
    super.watch();
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

  protected dispositionOf = dispositionOf;

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
