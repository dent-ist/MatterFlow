import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  AssetListItem,
  AssetTypeResponse,
  AssetTypesClient,
  AssetsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { AssetTypeCell } from '../../../shared/ui/asset-type-chip';
import { StatusChip } from '../../../shared/ui/status-chip';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { FilterDef, FilterOption } from '../../../shared/filters/filter-def';
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import { SortedLine, sortLabelsOf } from '../../../shared/ui/sorted-line';
import { ListFilters } from '../../../shared/filters/list-filters';
import { AdminCardList, AdminCardSpec } from '../../../shared/ui/admin-card-spec';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { RowActionSpec, rowActions } from '../../../shared/ui/row-actions';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import {
  ASSET_NUMBER_COLUMN_WIDTH,
  AssetNumberCell,
  hasNumberedType,
} from '../../../shared/ui/asset-number-cell';
import { CopyButton } from '../../../shared/ui/copy-button';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { RecordSort } from '../../../shared/ui/record-sort';
import { SortOption } from '../../../shared/work-queue/phone-sort';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { matterLinkOf } from '../../../shared/ui/matter-link';
import { PageHeader } from '../../../shared/ui/page-header';
import { PageScope } from '../../../shared/scope/page-scope';
import { scopeLine } from '../../../shared/scope/scope-line';
import { ScopeSwitch } from '../../../shared/scope/scope-switch';
import { Pager } from '../../../shared/ui/pager';
import {
  AssetDispositionDialog,
  DispositionOutcome,
  DispositionTarget,
} from '../disposition/asset-disposition-dialog';
import { DispositionCode, dispositionOf } from '../disposition/asset-disposition';
import { formatSize } from '../disposition/asset-size';
import {
  ASSET_STATUS_OPTIONS as STATUS_OPTIONS,
  AssetStatusKey as StatusKey,
  assetStatusQuery as statusQuery,
  parseAssetStatusKey as parseStatusKey,
} from '../../../shared/filters/asset-status-filter';

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  type: '7rem',
  name: '14rem',
  assetNumber: '9rem',
  matter: '6rem',
  size: '4rem',
  linkedTasks: '2rem',
  externalReference: '9rem',
  status: '6rem',
};

/**
 * Global Assets list (UX S08): 44 px rows on the admin grid, one inline filter per filterable column (a second header row, open from 640 px;
 * a sheet below), all server-side (a Matter can hold 200 to 300 assets, so nothing is filtered in the browser), phone cards below 640 px.
 * The name is the one link and opens the record page `/assets/:id`; Back returns here with the row focused. The URL keeps every filter, the
 * sort and the page. (The master-detail panel under the grid and its `?selected=` address were retired with #510; an old `?selected=` link is
 * sent to the record page by the route.)
 */
@Component({
  selector: 'mf-assets-list-page',
  imports: [
    FixedPage,
    NgTemplateOutlet,
    PageHeader,
    ScopeSwitch,
    StatusChip,
    AssetTypeCell,
    Button,
    CopyButton,
    AssetNumberCell,
    RouterLink,
    RowLink,
    HasPermissionDirective,
    Pager,
    MatterRef,
    RecordGrid,
    RecordCell,
    RecordColumns,
    ActionMenu,
    ListToolbar,
    SortedLine,
    ColumnFilterRow,
    AdminCardList,
    RecordSort,
    AssetDispositionDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    /* Name is the spring of the table: one line with an ellipsis (D-45); the floor is on the heading (the column definition). */
    td.as-number {
      max-width: 0;
    }
    td.as-name {
      width: 100%;
      max-width: 0;
    }
    .as-matter {
      white-space: nowrap;
    }
    /* The reference is ONE line: the text is cut with an ellipsis (the full value is the tooltip), the copy button keeps its place. */
    .as-ref {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      min-width: 0;
    }
    .as-ref__text {
      min-width: 0;
      overflow: hidden;
      font-family: var(--mf-font-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .as-ref__none {
      color: var(--mf-text-muted);
    }
    td.as-refcell {
      max-width: 10rem;
    }
    .as-zero {
      color: var(--mf-text-muted);
    }
    .as-hint {
      color: var(--mf-text-muted);
    }
    .as-check {
      padding-inline: var(--mf-s1);
      text-align: center;
    }
    .as-check input {
      margin: 0;
    }
    .as-size {
      white-space: nowrap;
    }
    /* The warning is the icon beside the chip (its words are the tooltip and the accessible text), so a row stays 44 px (D-42, #1152). */
    .as-warn {
      display: inline-flex;
      align-items: center;
      margin-left: var(--mf-s1);
      color: var(--mf-sem-risk-fg);
      vertical-align: middle;
    }
    .as-warn__text {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .as-bulk {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-selected-bg);
      border-radius: var(--mf-radius);
    }
    .as-bulk__count {
      font-weight: 600;
    }
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="Assets"
        [count]="state() === 'ready' ? total() : null"
        [countPending]="state() !== 'ready'"
      >
        <mf-scope-switch
          mfActions
          [scope]="scope.value()"
          [canAll]="scope.canAll()"
          announceMine="Showing assets of matters you manage"
          announceAll="Showing all assets"
          (scopeChange)="scope.set($event)"
        />
        @if (scopeText()) {
          <span mfDescription class="sl-line" data-scope-line>{{ scopeText() }}</span>
        }
        <a
          mfActions
          class="mf-btn"
          routerLink="/assets/reports"
          data-build-report
          *mfHasPermission="'Asset.View'"
          >Build a Report</a
        >
        <p-button
          mfActions
          *mfHasPermission="'Asset.Create'"
          label="New Asset"
          icon="pi pi-plus"
          (onClick)="go(newAssetUrl())"
        />
      </mf-page-header>

      <mf-list-toolbar
        [filters]="filters"
        controls="asset-filter-row"
        searchLabel="Search assets"
        [clearAlso]="['q']"
        [bulkActive]="canChange() && selected().size > 0"
      >
        @if (!phone()) {
          <mf-record-columns mfColumns [grid]="grid" />
        }
        <mf-sorted-line
          mfBarEnd
          [sort]="sort()"
          [defaultSort]="defaultSort"
          [labels]="sortLabels()"
          (resetSort)="pickSort(null)"
        />
        <div mfBulk class="as-bulk" role="region" aria-label="Selected assets" data-bulk-bar>
          <span class="as-bulk__count" role="status" data-bulk-count
            >{{ selected().size }} {{ selected().size === 1 ? 'asset' : 'assets' }} selected</span
          >
          <button
            type="button"
            class="mf-btn"
            data-bulk-disposition
            (click)="dispositionOpen.set(true)"
          >
            Change Disposition
          </button>
          <button
            type="button"
            class="mf-btn mf-btn--text"
            data-bulk-clear
            (click)="clearSelection()"
          >
            Clear Selection
          </button>
        </div>
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="displayName"
          (sorted)="pickSort($event)"
        />
      </mf-list-toolbar>

      <mf-asset-disposition-dialog
        [targets]="targets()"
        [canEdit]="auth.has('Asset.Edit')"
        [canDispose]="auth.has('Asset.Dispose')"
        [(visible)]="dispositionOpen"
        (finished)="dispositionDone($event)"
      />

      <div class="mf-fill as-grid">
        @if (phone()) {
          <!-- Below 640 px the list is cards (#502): the name is the one link, the whole card is its target. -->
          <mf-admin-card-list
            noun="assets"
            label="Assets"
            listId="assets"
            [items]="rows()"
            [spec]="cardOf"
            [filters]="filters"
            [state]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            [hidden]="hiddenCount()"
            hiddenLabel="inactive"
            [emptyText]="emptyText()"
            (retry)="load()"
            (clear)="clear()"
            (showAll)="showAll()"
          >
            @if (scope.mine() && scope.canAll()) {
              <button
                mfEmptyAction
                type="button"
                class="mf-btn"
                data-show-all-matters
                (click)="scope.set('all')"
              >
                Show All Matters
              </button>
            }
          </mf-admin-card-list>
        } @else {
          <mf-record-grid
            #scroll
            label="Assets list"
            caption="Assets"
            noun="assets"
            [grid]="grid"
            [rows]="rows()"
            [rowKey]="assetKey"
            [loadState]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            [emptyText]="emptyText()"
            [filters]="filters"
            [hidden]="hiddenCount()"
            hiddenLabel="inactive"
            [bones]="bones"
            [selecting]="canChange()"
            [allSelected]="allSelected()"
            [someSelected]="selected().size > 0"
            selectAllLabel="Select all assets on this page"
            (selectAll)="toggleAll($event)"
            [rowClass]="rowClass"
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
                id="asset-filter-row"
                [filters]="filters"
                [columns]="columns()"
              ></tr>
            }
            @if (scope.mine() && scope.canAll()) {
              <button
                mfEmptyAction
                type="button"
                class="mf-btn"
                data-show-all-matters
                (click)="scope.set('all')"
              >
                Show All Matters
              </button>
            }
            <ng-template mfCell="select" let-a>
              <td class="as-check">
                <input
                  type="checkbox"
                  data-select-row
                  [attr.aria-label]="'Select ' + a.displayName"
                  [checked]="selected().has(a.assetId)"
                  (change)="toggle(a.assetId, $any($event.target).checked)"
                />
              </td>
            </ng-template>
            <ng-template mfCell="type" let-a>
              <td>
                <mf-asset-type-cell
                  [iconKey]="a.assetTypeIconKey"
                  [colourKey]="a.assetTypeColourKey"
                  [typeId]="a.assetTypeId"
                  [name]="a.assetTypeName"
                />
              </td>
            </ng-template>
            <ng-template mfCell="name" let-a>
              <td class="as-name">
                <a
                  class="mf-link pg-clip"
                  [routerLink]="['/assets', a.assetId]"
                  mfRowLink="assets"
                  [rowKey]="a.assetId"
                  [attr.title]="a.displayName"
                  [attr.data-asset-name]="a.assetId"
                  >{{ a.displayName }}</a
                >
              </td>
            </ng-template>
            <ng-template mfCell="assetNumber" let-a>
              <td class="as-number" data-asset-number>
                <mf-asset-number-cell
                  [number]="a.assetNumber"
                  [numbered]="a.assetTypeNumberingEnabled"
                />
              </td>
            </ng-template>
            <ng-template mfCell="matter" let-a>
              <td class="as-matter" [attr.title]="a.matterName" data-matter>
                <mf-matter-ref
                  [value]="a.matterRef"
                  [link]="matterLink(a.matterId)"
                  [copy]="false"
                />
              </td>
            </ng-template>
            <ng-template mfCell="size" let-a>
              <td class="pg-num as-size" data-size>
                @if (sizeText(a); as size) {
                  {{ size }}
                } @else {
                  <span class="as-ref__none" aria-hidden="true">&ndash;</span>
                  <span class="mf-sr-only">No size</span>
                }
              </td>
            </ng-template>
            <ng-template mfCell="linkedTasks" let-a>
              <td class="pg-num" data-linked>
                <!-- "2 / 5": open of all linked (PM v2, #883); the words are for a screen reader, the tooltip says it in full. -->
                <span
                  [attr.title]="
                    (a.openLinkedTaskCount ?? 0) +
                    ' open of ' +
                    (a.linkedTaskCount ?? 0) +
                    ' linked tasks'
                  "
                  [class.as-zero]="!a.linkedTaskCount"
                  aria-hidden="true"
                  >{{ a.openLinkedTaskCount ?? 0 }} / {{ a.linkedTaskCount ?? 0 }}</span
                >
                <span class="mf-sr-only"
                  >{{ a.openLinkedTaskCount ?? 0 }} open of {{ a.linkedTaskCount ?? 0 }} linked
                  tasks</span
                >
              </td>
            </ng-template>
            <ng-template mfCell="externalReference" let-a>
              <td class="as-refcell" data-reference>
                @if (a.externalReference) {
                  <div class="as-ref">
                    <span class="as-ref__text" [attr.title]="a.externalReference">{{
                      a.externalReference
                    }}</span>
                    <mf-copy-button
                      [text]="a.externalReference"
                      label="external reference"
                      [rowStop]="true"
                    />
                  </div>
                } @else {
                  <span class="as-ref__none" aria-hidden="true">&ndash;</span>
                  <span class="mf-sr-only">No external reference</span>
                }
              </td>
            </ng-template>
            <ng-template mfCell="status" let-a>
              <td class="pg-chipcell" data-status>
                <mf-status-chip
                  kind="disposition"
                  [code]="a.dispositionCode"
                  data-disposition-badge
                />
                @if (a.inactiveLinked) {
                  <span class="as-warn" data-inactive-linked title="Still linked to open tasks">
                    <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                    <span class="as-warn__text">Still linked to open tasks</span>
                  </span>
                }
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
              <ng-container *ngTemplateOutlet="pager" />
            </div>
          </mf-record-grid>
        }
        @if (phone()) {
          <ng-container *ngTemplateOutlet="pager" />
        }
        <ng-template #pager>
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
        </ng-template>
      </div>
    </mf-fixed-page>
  `,
})
export class AssetsListPage extends ServerListPage<AssetListItem> {
  private readonly api = inject(AssetsClient);
  protected readonly auth = inject(AuthStore);
  private readonly typesApi = inject(AssetTypesClient);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild('scroll', { read: ElementRef });

  protected readonly defaultSort = 'displayName';
  protected readonly sortLabels = computed(() => sortLabelsOf(this.sortOptions()));

  /** "My matters / All" (epic #758): people who can be a project manager open the list on the matters they manage, with a remembered switch. */
  protected readonly scope = new PageScope('assets', () => !this.filters.isDeepLink());
  /** "Assets of matters you manage (63 of 1,204)" / "1,204 assets". */
  protected readonly scopeText = computed(() =>
    scopeLine({
      scope: this.scope.value(),
      noun: 'assets',
      phrase: 'Assets of matters you manage',
      shown: this.state() === 'ready' ? this.total() : null,
      all: this.unscopedTotal(),
    }),
  );
  protected readonly emptyText = computed(() =>
    this.scope.mine() ? 'You do not manage any matter yet.' : 'No assets yet.',
  );
  protected readonly dispositionOf = dispositionOf;
  /** The Linked tasks column is for people who may see tasks: the API sends no counts without `Task.View` (#498). */
  protected readonly tasksShown = computed(() => this.auth.has('Task.View'));
  /** People who may change an asset's disposition get a checkbox column, the bulk bar and the row menu. */
  protected readonly canChange = computed(
    () => this.auth.has('Asset.Edit') || this.auth.has('Asset.Dispose'),
  );
  /** The columns this person may have, in the default order (Name cannot be hidden; Linked Tasks needs Task.View). The grid frame scrolls sideways when they do not fit. */
  protected readonly gridDefs = computed((): RecordGridColumn[] => [
    {
      key: 'type',
      label: 'Type',
      sort: 'assetType',
      // The chip and the type name (D-43a): 128 px, so the default columns fit the 1366 frame (#1249).
      width: 'var(--mf-col-type-w)',
      minWidth: 'var(--mf-col-type-w)',
    },
    // The spring: no width, so it takes the free room in every state.
    { key: 'name', label: 'Name', locked: true, sort: 'displayName', minWidth: '200px' },
    ...(this.numbered()
      ? [
          {
            key: 'assetNumber',
            label: 'Asset Number',
            sort: 'assetNumber',
            width: ASSET_NUMBER_COLUMN_WIDTH,
            minWidth: ASSET_NUMBER_COLUMN_WIDTH,
          },
        ]
      : []),
    { key: 'matter', label: 'CM Number', sort: 'matter', width: '8.8rem', minWidth: '8.8rem' },
    {
      key: 'size',
      label: 'Size',
      sort: 'size',
      firstDesc: true,
      num: true,
      width: '7.5rem',
      minWidth: '7.5rem',
    },
    ...(this.tasksShown()
      ? [
          {
            key: 'linkedTasks',
            label: 'Linked Tasks',
            sort: 'linkedTaskCount',
            firstDesc: true,
            num: true,
            width: '9.75rem',
            minWidth: '9.75rem',
          },
        ]
      : []),
    // 168 px: the heading "External Reference" is 143 px of text plus 24 px of padding, so it stays on one line (#1249; the 150 px of the issue wrapped).
    // With an active numbered type the Asset Number column takes its room and this one is off by default (still one click away in Columns; #1297).
    {
      key: 'externalReference',
      label: 'External Reference',
      width: '168px',
      minWidth: '168px',
      defaultHidden: this.numbered(),
    },
    // The chip is shown whole: "Pending Disposition" is 154 px, so the column is wider than the 140 px Status of the other lists (D-43 deviation, to be ruled).
    {
      key: 'status',
      label: 'Disposition',
      sort: 'disposition',
      width: '11.6rem',
      minWidth: '11.6rem',
    },
  ]);
  /** The grid state (shared record grid, #1241): order, visibility and stored widths per person under the id "assets". */
  protected readonly grid = new RecordGridState('assets', this.gridDefs);
  protected readonly bones = BONES;
  protected readonly assetKey = (a: AssetListItem): number => a.assetId;
  /** Every column of the table, in order, the checkbox and action ones included: the keys the filter definitions point at. */
  protected readonly columns = computed(() => [
    ...(this.canChange() ? ['select'] : []),
    ...this.grid.shown(),
    ...(this.canChange() ? ['actions'] : []),
  ]);
  protected readonly rowClass = (a: AssetListItem): string | null =>
    this.selected().has(a.assetId) ? 'is-selected' : null;
  /** The asset a row menu works on (Change Disposition for this one asset), instead of the ticked rows. */
  private readonly single = signal<AssetListItem | null>(null);
  /** The quick actions of a row, built once per page of rows. */
  protected readonly menus = computed(
    () => new Map(this.rows().map((a) => [a.assetId, this.buildMenu(a)] as const)),
  );
  /** Below 640 px the list is cards, not a table (#502). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, the same `sort` values as the headers. */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'displayName', label: 'Name' },
    { value: 'assetType', label: 'Type' },
    { value: 'matter', label: 'CM Number' },
    { value: 'size', label: 'Size', descFirst: true },
    { value: 'disposition', label: 'Disposition' },
    ...(this.tasksShown()
      ? [{ value: 'linkedTaskCount', label: 'Linked Tasks', descFirst: true }]
      : []),
  ]);
  /**
   * The card of one asset: the name (the one link), the type, the matter number (plain text; the card is the link) and, with Task.View, the
   * open linked tasks; the Inactive badge only for an inactive asset, as in the table.
   */
  protected readonly cardOf = (a: AssetListItem): AdminCardSpec => {
    const open = a.openLinkedTaskCount;
    return {
      title: a.displayName,
      link: ['/assets', a.assetId],
      rowKey: a.assetId,
      badges:
        a.dispositionCode === 'ACTIVE'
          ? []
          : [
              {
                text: dispositionOf(a.dispositionCode).label,
                tone: dispositionOf(a.dispositionCode).tone,
                icon: dispositionOf(a.dispositionCode).icon,
              },
            ],
      subtitle: a.assetTypeName,
      meta: [
        `Matter ${a.matterRef}`,
        ...(this.sizeText(a) ? [this.sizeText(a)] : []),
        ...(a.inactiveLinked ? ['Not active, still linked to open tasks'] : []),
        ...(this.tasksShown() && open !== undefined && open !== null
          ? [`${open} open ${open === 1 ? 'task' : 'tasks'}`]
          : []),
      ],
    };
  };
  /** The rows ticked for a bulk disposition change (this page only; cleared when the list changes). */
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  protected readonly dispositionOpen = signal(false);
  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.rows().every((r) => this.selected().has(r.assetId)),
  );
  protected readonly targets = computed<DispositionTarget[]>(() =>
    (this.single()
      ? [this.single()!]
      : this.rows().filter((r) => this.selected().has(r.assetId))
    ).map((r) => ({
      assetId: r.assetId,
      name: r.displayName,
      code: r.dispositionCode as DispositionCode,
      openLinkedTaskCount: this.tasksShown() ? (r.openLinkedTaskCount ?? null) : null,
      rowVersion: r.rowVersion,
    })),
  );
  protected readonly types = signal<AssetTypeResponse[]>([]);
  /** An active asset type numbers its assets: the Asset Number column exists (#1297). */
  protected readonly numbered = computed(() => hasNumberedType(this.types()));

  protected readonly typeOptions = computed<FilterOption[]>(() =>
    this.types().map((t) => ({ value: String(t.assetTypeId), label: t.name })),
  );

  protected readonly matterChip = computed((): string => {
    const first = this.rows()[0];
    const id = this.filters.text('matterId');
    return first && String(first.matterId) === id
      ? `${first.matterRef} ${first.matterName}`
      : `Matter ${id}`;
  });

  /** The matter reference is a link only for a person who may open matters (decision V); otherwise plain text. */
  protected matterLink(matterId: number): unknown[] | null {
    return matterLinkOf(this.auth, matterId);
  }

  /** Creating from a matter's list keeps the matter. */
  protected newAssetUrl(): string {
    const matterId = this.filters.text('matterId');
    return '/assets/new' + (matterId ? '?matterId=' + matterId : '');
  }

  /** One definition per filter: the row, the sheet, the chips, the count, the URL and the API arguments all come from it. */
  private readonly defs = computed((): FilterDef[] => [
    { key: 'name', label: 'Name', column: 'name', type: 'text', search: true },
    {
      key: 'typeId',
      label: 'Type',
      column: 'type',
      type: 'multiSelect',
      emptyLabel: 'All Types',
      options: this.typeOptions(),
    },
    // The input says the short heading word (D-44d): the column is CM Number.
    { key: 'matter', label: 'Matter', column: 'matter', type: 'text', placeholder: 'Number' },
    ...(this.numbered()
      ? [
          {
            key: 'assetNumber',
            label: 'Asset Number',
            column: 'assetNumber',
            type: 'text' as const,
            placeholder: 'Number',
          },
        ]
      : []),
    {
      key: 'extref',
      label: 'External Reference',
      column: 'externalReference',
      type: 'text',
      placeholder: 'Reference',
    },
    {
      key: 'status',
      label: 'Disposition',
      column: 'status',
      type: 'select',
      options: STATUS_OPTIONS,
      default: 'active',
    },
    // `?matterId=` (a link from a matter): no control, a removable chip.
    {
      key: 'matterId',
      label: 'Matter',
      type: 'text',
      noControl: true,
      valueLabel: (): string => this.matterChip(),
    },
    // `?inactiveLinked=true` and `?role=` (links from the Data tab of My Matters, #870): no control, a removable chip, so the count there and the list agree.
    {
      key: 'inactiveLinked',
      label: 'Not Active',
      type: 'text',
      noControl: true,
      valueLabel: (): string => 'still linked to open tasks',
    },
    {
      key: 'role',
      label: 'My Role',
      type: 'text',
      noControl: true,
      valueLabel: (v: string): string => (v === 'secondary' ? 'Secondary PM' : 'Primary PM'),
    },
  ]);

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'assets',
    noun: 'assets',
    defs: this.defs,
    visibleColumns: computed(() => (this.phone() ? null : this.columns())),
    // Open from 640 px (a sheet below), like Clients, Matters and Projects (#499).
    openByDefault: true,
    sheetBelow: 640,
  });

  constructor() {
    super();
    // Back from a record page: focus goes to the name link of the row the person left (#494).
    restoreRowFocus('assets', () => this.state() === 'ready');
    // "Skip to table" is the first Tab stop of the page (#503); it lands on the first row's name, or on the first card on a phone.
    registerTableSkip();
    void this.loadTypes();
    // The row menu's single asset is forgotten when the dialog closes, so the bulk bar works on the ticked rows again.
    effect(() => {
      if (!this.dispositionOpen()) untracked(() => this.single.set(null));
    });

    // The controls move into the sheet while the grid scrolls sideways.
    effect(() => {
      this.state();
      const area = this.scroll()?.nativeElement.querySelector(
        '.mf-scroll-area',
      ) as HTMLElement | null;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
  }

  protected override readonly emptyOffersClear = true;

  protected override listFilters() {
    return this.filters;
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
      parseStatusKey(this.filters.text('status')),
      this.pageNumber(),
      this.pageSize(),
      this.sort() || undefined,
    );
  }

  /** The inactive assets the default Active hides, under the same other filters ("of 55 active - 5 inactive hidden  Show all"). */
  protected override fetchHidden() {
    return parseStatusKey(this.filters.text('status')) === 'active'
      ? this.list('notactive', 1, 1, undefined)
      : null;
  }

  protected override watch(): void {
    super.watch();
    this.scope.value();
  }

  /** The same list without the scope: the "of 1,204". */
  protected override fetchUnscoped() {
    return this.scope.mine()
      ? this.list(parseStatusKey(this.filters.text('status')), 1, 1, undefined, false)
      : null;
  }

  private list(
    status: StatusKey,
    page: number,
    size: number,
    sort: string | undefined,
    scoped = true,
  ) {
    const matterId = Number(this.filters.text('matterId'));
    const typeIds = this.filters
      .list('typeId')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    const { isActive, disposition } = statusQuery(status);
    const roleText = this.filters.text('role');
    const role = roleText === 'primary' || roleText === 'secondary' ? roleText : undefined;
    return firstValueFrom(
      this.api.listAssets(
        Number.isInteger(matterId) && matterId > 0 ? matterId : undefined,
        typeIds.length > 0 ? typeIds : undefined,
        isActive,
        undefined,
        this.filters.text('name') || undefined,
        this.filters.text('extref') || undefined,
        this.filters.text('assetNumber') || undefined,
        this.filters.text('matter') || undefined,
        scoped && this.scope.mine() ? true : undefined,
        scoped && this.scope.mine() && role ? role : undefined,
        disposition,
        this.filters.text('inactiveLinked') === 'true' ? true : undefined,
        page,
        size,
        sort,
      ),
    );
  }

  /** "412 GB", "26,400 Items" or an empty string when the asset has no size. */
  protected sizeText(a: AssetListItem): string {
    return formatSize(a.sizeValue, a.sizeUnit);
  }

  protected toggle(id: number, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected toggleAll(on: boolean): void {
    this.selected.set(on ? new Set(this.rows().map((r) => r.assetId)) : new Set());
  }

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

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  /** After the dialog: the list reloads; the assets that could not be changed stay selected so the person sees which. */
  protected dispositionDone(outcome: DispositionOutcome): void {
    const failed = outcome.bulk?.results.filter((r) => !r.ok).map((r) => r.assetId) ?? [];
    // A change through a row menu leaves the ticked rows as they are.
    if (!this.single()) this.selected.set(new Set(failed));
    this.load();
  }
}
