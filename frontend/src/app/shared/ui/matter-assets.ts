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
import { AuthStore } from '../../core/auth/auth.store';
import {
  AssetDispositionDialog,
  DispositionTarget,
} from '../../features/assets/disposition/asset-disposition-dialog';
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
import { SortedLine, sortLabelsOf } from './sorted-line';
import { ListFilters } from '../filters/list-filters';
import { AssetTypeCell } from './asset-type-chip';
import { StatusChip } from './status-chip';
import { DispositionCode } from '../../features/assets/disposition/asset-disposition';
import { formatSize } from '../../features/assets/disposition/asset-size';
import { RowLink, registerTableSkip, restoreRowFocus } from './row-nav';
import { ActionMenu } from './action-menu';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from './record-grid';
import { RowActionSpec, rowActions } from './row-actions';
import { CopyButton } from './copy-button';
import { ServerListPage } from './list-query';
import { Pager } from './pager';

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  type: '7rem',
  name: '14rem',
  size: '4rem',
  externalReference: '9rem',
  status: '6rem',
};

/**
 * The Assets tab of a Matter (UX S08, S06; Type first, then Name, MD-25): the same inline column filters as the Assets screen (Name, Type, External reference, Status
 * with Active by default; `name`, `typeId`, `extref`, `status` in the URL; the Disposition and the Size of each asset are columns, PM v2 #883), all server-side, with sorting and paging, for the 200 to 300
 * assets a Matter can hold. Creating an asset starts from here with the Matter prefilled and locked.
 * Drawn by the shared record grid since #1269 (grid id `matter-assets`: resize handles, stored widths, Columns, the Sorted line); the row menu is Change Disposition.
 */
@Component({
  selector: 'mf-matter-assets',
  imports: [
    StatusChip,
    AssetTypeCell,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    ListToolbar,
    SortedLine,
    ColumnFilterRow,
    RecordGrid,
    RecordCell,
    RecordColumns,
    ActionMenu,
    CopyButton,
    RowLink,
    AssetDispositionDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: './page.scss',
  styles: `
    /* Name is the spring of the table: one line with an ellipsis (D-45); the floor is on the heading (the column definition). */
    td.ma-name {
      width: 100%;
      max-width: 0;
    }
    /* The reference is ONE line: the text is cut with an ellipsis (the full value is the tooltip), the copy button keeps its place. */
    .ma-ref {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      min-width: 0;
    }
    .ma-ref__text {
      min-width: 0;
      overflow: hidden;
      font-family: var(--mf-font-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  template: `
    <mf-list-toolbar
      [filters]="filters"
      controls="matter-asset-filter-row"
      searchLabel="Search assets"
    >
      <mf-record-columns mfColumns [grid]="grid" />
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

    <mf-asset-disposition-dialog
      [targets]="targets()"
      [canEdit]="auth.has('Asset.Edit')"
      [canDispose]="auth.has('Asset.Dispose')"
      [(visible)]="dispositionOpen"
      (finished)="load()"
    />

    <mf-record-grid
      #scroll
      label="Assets list"
      caption="Assets of this matter"
      noun="assets"
      emptyText="No assets in this matter yet."
      [grid]="grid"
      [rows]="rows()"
      [rowKey]="assetKey"
      [loadState]="state()"
      [empty]="rows().length === 0"
      [filtered]="filters.activeCount() > 0"
      [filters]="filters"
      [hidden]="hiddenCount()"
      hiddenLabel="inactive"
      [bones]="bones"
      [actions]="canChange()"
      [sort]="sort()"
      [defaultSort]="defaultSort"
      (sorted)="setSort($event)"
      (retry)="load()"
      (clear)="clear()"
      (showAll)="showAll()"
    >
      @if (filters.rowVisible()) {
        <tr
          mfGridFilterRow
          mfColumnFilterRow
          id="matter-asset-filter-row"
          [filters]="filters"
          [columns]="columns()"
        ></tr>
      }
      <p-button
        mfEmptyAction
        *mfHasPermission="'Asset.Create'"
        label="New Asset"
        icon="pi pi-plus"
        severity="secondary"
        data-empty-new-asset
        (onClick)="newAsset()"
      />
      <ng-template mfCell="type" let-a>
        <td>
          <mf-asset-type-cell
            [iconKey]="typeLook(a.assetTypeId)?.iconKey"
            [colourKey]="typeLook(a.assetTypeId)?.colourKey"
            [typeId]="a.assetTypeId"
            [name]="a.assetTypeName"
          />
        </td>
      </ng-template>
      <ng-template mfCell="name" let-a>
        <td class="ma-name">
          <a
            class="mf-link pg-clip"
            [routerLink]="['/assets', a.assetId]"
            mfRowLink="matter-assets"
            [rowKey]="a.assetId"
            [title]="a.displayName"
            >{{ a.displayName }}</a
          >
        </td>
      </ng-template>
      <ng-template mfCell="size" let-a>
        <td class="pg-num pg-nowrap" data-size>
          @if (sizeText(a); as size) {
            {{ size }}
          } @else {
            <span class="pg-muted" aria-hidden="true">–</span
            ><span class="mf-sr-only">No size</span>
          }
        </td>
      </ng-template>
      <ng-template mfCell="externalReference" let-a>
        <td data-reference>
          @if (a.externalReference) {
            <div class="ma-ref">
              <span class="ma-ref__text" [attr.title]="a.externalReference">{{
                a.externalReference
              }}</span>
              <mf-copy-button
                [text]="a.externalReference"
                label="external reference"
                [rowStop]="true"
              />
            </div>
          } @else {
            <span class="pg-muted" aria-hidden="true" data-none>–</span
            ><span class="mf-sr-only">None</span>
          }
        </td>
      </ng-template>
      <ng-template mfCell="status" let-a>
        <td class="pg-chipcell" data-status>
          <mf-status-chip kind="disposition" [code]="a.dispositionCode" data-disposition-badge />
        </td>
      </ng-template>
      <ng-template mfCell="actions" let-a>
        <td class="mf-col-actions" data-row-actions>
          <mf-action-menu
            [floating]="true"
            [label]="menus().get(a.assetId)!.label"
            [items]="menus().get(a.assetId)!.items"
          />
        </td>
      </ng-template>
      <div mfGridFoot>
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
    </mf-record-grid>
  `,
})
export class MatterAssets extends ServerListPage<AssetListItem> {
  readonly matterId = input.required<number>();

  private readonly api = inject(AssetsClient);
  private readonly typesApi = inject(AssetTypesClient);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild('scroll', { read: ElementRef });

  protected readonly auth = inject(AuthStore);

  protected readonly defaultSort = 'displayName';
  protected readonly sortLabels = sortLabelsOf([
    { value: 'displayName', label: 'Name' },
    { value: 'assetType', label: 'Type' },
    { value: 'size', label: 'Size' },
    { value: 'disposition', label: 'Disposition' },
  ]);
  /** The row menu (Change Disposition) is for people who may change an asset's disposition. */
  protected readonly canChange = computed(
    () => this.auth.has('Asset.Edit') || this.auth.has('Asset.Dispose'),
  );
  /** The columns, in the default order (Name cannot be hidden); the grid frame scrolls sideways when they do not fit. */
  protected readonly gridDefs = computed((): RecordGridColumn[] => [
    {
      key: 'type',
      label: 'Type',
      sort: 'assetType',
      // The chip and the type name (D-43a): 128 px.
      width: 'var(--mf-col-type-w)',
      minWidth: 'var(--mf-col-type-w)',
    },
    // The spring: no width, so it takes the free room in every state.
    { key: 'name', label: 'Name', locked: true, sort: 'displayName', minWidth: '200px' },
    {
      key: 'size',
      label: 'Size',
      sort: 'size',
      firstDesc: true,
      num: true,
      width: '7.5rem',
      minWidth: '7.5rem',
    },
    // 168 px: the heading "External Reference" is 143 px of text plus 24 px of padding, so it stays on one line (#1249).
    { key: 'externalReference', label: 'External Reference', width: '168px', minWidth: '168px' },
    // 162 px: the whole chip ("Pending Disposition" is 154 px) with 4 px each side (D-44k).
    {
      key: 'status',
      label: 'Disposition',
      sort: 'disposition',
      width: '162px',
      minWidth: '162px',
    },
  ]);
  /** The grid state (shared record grid, #1241): order, visibility and stored widths per person under the id "matter-assets". */
  protected readonly grid = new RecordGridState('matter-assets', this.gridDefs);
  protected readonly bones = BONES;
  protected readonly assetKey = (a: AssetListItem): number => a.assetId;
  /** Every column of the table, in order, the action one included (its filter cell is empty but grey): the keys the filter definitions point at. */
  protected readonly columns = computed(() => [
    ...this.grid.shown(),
    ...(this.canChange() ? ['actions'] : []),
  ]);
  /** The asset a row menu works on (Change Disposition for this one asset). */
  private readonly single = signal<AssetListItem | null>(null);
  protected readonly dispositionOpen = signal(false);
  protected readonly targets = computed<DispositionTarget[]>(() =>
    (this.single() ? [this.single()!] : []).map((r) => ({
      assetId: r.assetId,
      name: r.displayName,
      code: r.dispositionCode as DispositionCode,
      openLinkedTaskCount: this.auth.has('Task.View') ? (r.openLinkedTaskCount ?? null) : null,
      rowVersion: r.rowVersion,
    })),
  );
  /** The quick actions of a row, built once per page of rows. */
  protected readonly menus = computed(
    () => new Map(this.rows().map((a) => [a.assetId, this.buildMenu(a)] as const)),
  );

  private buildMenu(a: AssetListItem) {
    const specs: RowActionSpec[] = [
      {
        id: 'change-disposition',
        label: 'Change Disposition',
        icon: 'pi-sliders-h',
        permission: ['Asset.Edit', 'Asset.Dispose'],
        run: () => {
          this.single.set(a);
          this.dispositionOpen.set(true);
        },
      },
    ];
    const menu = rowActions(a.displayName, specs, { can: (perm) => this.auth.has(perm) });
    return { ...menu, label: `More actions for ${a.displayName}` };
  }
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
    restoreRowFocus('matter-assets', () => this.state() === 'ready');
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
