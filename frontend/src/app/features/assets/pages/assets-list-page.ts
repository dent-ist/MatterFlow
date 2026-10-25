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
  AssetResponse,
  AssetTypeResponse,
  AssetTypesClient,
  AssetsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { Badge } from '../../../shared/ui/badge';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { FilterDef, FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFiltersButton } from '../../../shared/filters/list-filters-button';
import { ListFilters } from '../../../shared/filters/list-filters';
import { AdminCardList, AdminCardSpec } from '../../../shared/ui/admin-card-spec';
import { AdminColumn } from '../../../shared/ui/admin-list-state';
import { CopyButton } from '../../../shared/ui/copy-button';
import { GridBody } from '../../../shared/ui/grid-body';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { RecordSort } from '../../../shared/ui/record-sort';
import { SortOption } from '../../../shared/work-queue/phone-sort';
import { SortHeader } from '../../../shared/ui/data-table';
import { FIXED_MODE_QUERY, FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { matterLinkOf } from '../../../shared/ui/matter-link';
import { PageHeader } from '../../../shared/ui/page-header';
import { PageScope } from '../../../shared/scope/page-scope';
import { scopeLine } from '../../../shared/scope/scope-line';
import { ScopeSwitch } from '../../../shared/scope/scope-switch';
import { Pager } from '../../../shared/ui/pager';
import { AssetDetails } from './asset-details';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['name', 'type', 'matter', 'linkedTasks', 'externalReference', 'status'] as const;
type Column = (typeof COLUMNS)[number];

const STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

/** The id in `?selected=`, or null when it is missing or not a positive whole number. */
export function parseSelected(value: string | null | undefined): number | null {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Global Assets list (UX S08) as a master-detail screen. The grid has one inline filter per filterable column (a second header row, shown
 * with the Filters button above the grid), all server-side (a Matter can hold 200 to 300 assets, so nothing is filtered in the browser),
 * and clicking a name shows the asset's details in a panel BELOW the grid (`?selected=<id>`), so the list stays where it was.
 * The URL keeps every filter, the sort, the page and the selection; `/assets/:id` redirects here.
 */
@Component({
  selector: 'mf-assets-list-page',
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    ScopeSwitch,
    Badge,
    Button,
    CopyButton,
    GridBody,
    RouterLink,
    RowLink,
    HasPermissionDirective,
    Pager,
    MatterRef,
    SortHeader,
    FiltersBar,
    ListFiltersButton,
    ColumnFilterRow,
    AdminCardList,
    RecordSort,
    AssetDetails,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    /* The 44 px row of the grid contract (decision U): one clipped line in every cell but the Name, which is the spring and the only link. */
    tr[data-selected] td {
      background: var(--mf-selected-bg);
    }
    /* Not colour alone: a bar at the left edge of the row and a bold name. */
    tr[data-selected] td:first-child {
      box-shadow: inset 4px 0 0 var(--mf-primary);
    }
    tr[data-selected] .mf-name {
      font-weight: 700;
    }
    .as-matter {
      width: 1%;
      white-space: nowrap;
    }
    /* A narrow window gives the Type less room, so the grid does not scroll sideways at 640 to 768 px (#502). */
    @media (max-width: 767.98px) {
      td.as-type {
        max-width: 7rem;
      }
    }
    .as-type {
      max-width: 12rem;
      overflow: hidden;
      text-overflow: ellipsis;
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
      width: 20rem;
      max-width: 20rem;
    }
    .as-zero {
      color: var(--mf-text-muted);
    }
    .as-hint {
      color: var(--mf-text-muted);
    }
    .as-panel {
      margin-top: var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-1);
    }
    /* Fixed-header screens: the grid keeps the upper part, the details panel takes about 40% of the height and scrolls by itself. */
    @media (min-width: 768px) and (min-height: 561px) {
      .as-panel {
        flex: 0 0 40%;
        min-height: 0;
        margin-top: var(--mf-s2);
        overflow-y: auto;
        overscroll-behavior: contain;
        border-radius: 0;
        border-width: 1px 0 0;
        box-shadow: 0 -3px 6px -4px rgb(0 0 0 / 18%);
      }
    }
  `,
  host: { '(keydown.escape)': 'onEscape($event)', '(window:resize)': 'onResize()' },
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Assets">
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
        <mf-list-filters-button
          mfActions
          [filters]="filters"
          controls="asset-filter-row"
          [clearAlso]="['q']"
        />
        <p-button
          mfActions
          *mfHasPermission="'Asset.Create'"
          label="New asset"
          icon="pi pi-plus"
          (onClick)="go(newAssetUrl())"
        />
      </mf-page-header>

      <!-- The Filters button and Clear filters are in the page header; this draws the sheet they open below 640 px and the chips. -->
      <mf-filters-bar [bare]="true" [filters]="filters" [clearAlso]="['q']">
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="displayName"
          (sorted)="pickSort($event)"
        />
      </mf-filters-bar>

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
                Show all matters
              </button>
            }
          </mf-admin-card-list>
        } @else {
          <div
            class="mf-table-wrap"
            mfScrollArea="Assets list"
            [keepOn]="['selected']"
            [style.scroll-padding-top]="filters.rowVisible() ? '5.5rem' : null"
            #scroll
          >
            <div class="mf-scroll">
              <table class="mf-grid" id="assets-table" data-assets>
                <caption class="mf-sr-only">
                  Assets
                </caption>
                <thead>
                  <tr>
                    <th
                      class="mf-cell-name"
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
                      class="as-matter"
                      mfSort="matter"
                      [sort]="sort()"
                      [defaultSort]="defaultSort"
                      (sorted)="setSort($event)"
                    >
                      Matter number
                    </th>
                    @if (tasksShown()) {
                      <th
                        class="mf-cell-num"
                        mfSort="linkedTaskCount"
                        [firstDesc]="true"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        [attr.data-drop]="drop.linkedTasks"
                        (sorted)="setSort($event)"
                      >
                        Linked tasks
                      </th>
                    }
                    <th class="as-refcell" scope="col" [attr.data-drop]="drop.externalReference">
                      External reference
                    </th>
                    <th class="mf-cell-badge" scope="col">Status</th>
                  </tr>
                  @if (filters.rowVisible()) {
                    <tr
                      mfColumnFilterRow
                      id="asset-filter-row"
                      [filters]="filters"
                      [columns]="visibleColumns()"
                    ></tr>
                  }
                </thead>
                <tbody
                  mfGridBody
                  noun="assets"
                  [columnSpec]="columnSpec()"
                  [filters]="filters"
                  [state]="state()"
                  [empty]="rows().length === 0"
                  [filtered]="filters.activeCount() > 0"
                  [hidden]="hiddenCount()"
                  hiddenLabel="inactive"
                  (retry)="load()"
                  (clear)="clear()"
                  [emptyText]="emptyText()"
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
                      Show all matters
                    </button>
                  }
                  @for (a of rows(); track a.assetId) {
                    <tr
                      [attr.data-asset-id]="a.assetId"
                      [attr.data-selected]="a.assetId === selectedId() ? '' : null"
                      [attr.aria-current]="a.assetId === selectedId() ? 'true' : null"
                    >
                      <td class="mf-cell-name">
                        <a
                          class="mf-name"
                          [routerLink]="['/assets', a.assetId]"
                          mfRowLink="assets"
                          [rowKey]="a.assetId"
                          [attr.title]="a.displayName"
                          [attr.data-asset-name]="a.assetId"
                          >{{ a.displayName }}</a
                        >
                      </td>
                      <td class="as-type" [attr.title]="a.assetTypeName">{{ a.assetTypeName }}</td>
                      <td class="as-matter" [attr.title]="a.matterName" data-matter>
                        <mf-matter-ref
                          [value]="a.matterRef"
                          [link]="matterLink(a.matterId)"
                          [copy]="false"
                        />
                      </td>
                      @if (tasksShown()) {
                        <td class="mf-cell-num" [attr.data-drop]="drop.linkedTasks" data-linked>
                          <!-- The open count is the number; the total is the tooltip (the words are for a screen reader). -->
                          <span
                            [attr.title]="(a.linkedTaskCount ?? 0) + ' linked in total'"
                            [class.as-zero]="!a.openLinkedTaskCount"
                            aria-hidden="true"
                            >{{ a.openLinkedTaskCount ?? 0 }}</span
                          >
                          <span class="mf-sr-only"
                            >{{ a.openLinkedTaskCount ?? 0 }} open of
                            {{ a.linkedTaskCount ?? 0 }} linked tasks</span
                          >
                        </td>
                      }
                      <td
                        class="as-refcell"
                        [attr.data-drop]="drop.externalReference"
                        data-reference
                      >
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
                      <td class="mf-cell-badge" data-status>
                        @if (a.isActive) {
                          <!-- Active is the ordinary state: no badge, only the words for a screen reader. -->
                          <span class="mf-sr-only">Active</span>
                        } @else {
                          <mf-badge tone="neutral">Inactive</mf-badge>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
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

      @if (selectedId(); as id) {
        <section
          id="asset-panel"
          class="as-panel"
          aria-label="Asset details"
          data-asset-panel
          #panel
        >
          <mf-asset-details
            [assetId]="'' + id"
            [closable]="true"
            (closed)="close()"
            (loaded)="detailLoaded.set($event)"
            (changed)="rowChanged($event)"
          />
        </section>
      }
    </mf-fixed-page>
  `,
})
export class AssetsListPage extends ServerListPage<AssetListItem> {
  /** Query parameter (bound by the router): the selection. The filters are read from the URL by `ListFilters`. */
  readonly selected = input<string>();

  private readonly api = inject(AssetsClient);
  private readonly auth = inject(AuthStore);
  private readonly typesApi = inject(AssetTypesClient);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly defaultSort = 'displayName';

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
  /** The External reference column leaves below 1280 px and Linked tasks below 900 px (the kit's column-drop rule); the filter row follows. */
  protected readonly drop = { externalReference: 1280, linkedTasks: 900 } as const;
  /** The Linked tasks column is for people who may see tasks: the API sends no counts without `Task.View` (#498). */
  protected readonly tasksShown = computed(() => this.auth.has('Task.View'));
  protected readonly columnSpec = computed<AdminColumn[]>(() => [
    { cls: 'mf-cell-name', bone: '14rem' },
    { cls: 'as-type', bone: '7rem' },
    { cls: 'as-matter', bone: '6rem' },
    ...(this.tasksShown()
      ? [{ cls: 'mf-cell-num', bone: '2rem', drop: this.drop.linkedTasks }]
      : []),
    { cls: 'as-refcell', bone: '12rem', drop: this.drop.externalReference },
    { cls: 'mf-cell-badge', bone: '4rem' },
  ]);
  /** The window width, for the columns that leave (the same rule as the grid stylesheet: the window, not the box). */
  private readonly viewport = signal(typeof window === 'undefined' ? 1920 : window.innerWidth);
  protected readonly visibleColumns = computed<readonly Column[]>(() =>
    COLUMNS.filter(
      (c) =>
        !(c === 'externalReference' && this.viewport() < this.drop.externalReference) &&
        !(c === 'linkedTasks' && (!this.tasksShown() || this.viewport() < this.drop.linkedTasks)),
    ),
  );
  /** Below 640 px the list is cards, not a table (#502). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, the same `sort` values as the headers. */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'displayName', label: 'Name' },
    { value: 'assetType', label: 'Type' },
    { value: 'matter', label: 'Matter number' },
    ...(this.tasksShown()
      ? [{ value: 'linkedTaskCount', label: 'Linked tasks', descFirst: true }]
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
      badges: a.isActive ? [] : [{ text: 'Inactive', tone: 'neutral', icon: 'pi-minus-circle' }],
      subtitle: a.assetTypeName,
      meta: [
        `Matter ${a.matterRef}`,
        ...(this.tasksShown() && open !== undefined && open !== null
          ? [`${open} open ${open === 1 ? 'task' : 'tasks'}`]
          : []),
      ],
    };
  };
  protected readonly types = signal<AssetTypeResponse[]>([]);
  protected readonly selectedId = computed(() => parseSelected(this.selected()));
  /** The asset the panel has loaded (its Matter and state are only known once it is there). */
  protected readonly detailLoaded = signal<AssetResponse | null>(null);

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
    { key: 'name', label: 'Name', column: 'name', type: 'text' },
    {
      key: 'typeId',
      label: 'Type',
      column: 'type',
      type: 'multiSelect',
      emptyLabel: 'All types',
      options: this.typeOptions(),
    },
    { key: 'matter', label: 'Matter', column: 'matter', type: 'text' },
    { key: 'extref', label: 'External reference', column: 'externalReference', type: 'text' },
    {
      key: 'status',
      label: 'Status',
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
  ]);

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'assets',
    noun: 'assets',
    defs: this.defs,
    visibleColumns: computed(() => (this.phone() ? null : this.visibleColumns())),
    // Open from 640 px (a sheet below), like Clients, Matters and Projects (#499).
    openByDefault: true,
    sheetBelow: 640,
  });

  /** The user chose the selection in this list (so a row that later leaves the page is not "revealed" by changing the filters). */
  private ownSelection: number | null = null;
  private revealTried: number | null = null;
  private lastRevealed = '';

  constructor() {
    super();
    // Back from a record page: focus goes to the name link of the row the person left (#494).
    restoreRowFocus('assets', () => this.state() === 'ready');
    // "Skip to table" is the first Tab stop of the page (#503); it lands on the first row's name, or on the first card on a phone.
    registerTableSkip();
    void this.loadTypes();

    // The controls move into the sheet while the grid scrolls sideways.
    effect(() => {
      const area = this.scroll()?.nativeElement;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });

    // The selected row is brought into view (a link from a task, a search result, the matter's Assets tab). Where the page scrolls as a
    // whole (phones, short windows) the panel is below a long grid, so choosing a row brings the panel into view instead.
    effect(() => {
      const id = this.selectedId();
      if (id === null || this.state() !== 'ready') return;
      const present = this.rows().some((r) => r.assetId === id);
      untracked(() => {
        const key = `${id}:${present}`;
        if (key === this.lastRevealed) return;
        this.lastRevealed = key;
        afterNextRender(
          () => {
            const fixed = typeof matchMedia === 'function' && matchMedia(FIXED_MODE_QUERY).matches;
            if (!fixed && this.ownSelection === id) {
              this.panel()?.nativeElement.scrollIntoView?.({ block: 'start' });
              return;
            }
            const row = this.scroll()?.nativeElement.querySelector<HTMLElement>(
              `tr[data-asset-id="${id}"]`,
            );
            row?.scrollIntoView?.({ block: 'nearest' });
          },
          { injector: this.injector },
        );
      });
    });

    // A link to an asset that is not on this page of the list (a deep link, a search result): narrow the list to its Matter, all states.
    effect(() => {
      const id = this.selectedId();
      const asset = this.detailLoaded();
      if (id === null || this.state() !== 'ready' || asset?.assetId !== id) return;
      const present = this.rows().some((r) => r.assetId === id);
      untracked(() => {
        if (present || this.ownSelection === id || this.revealTried === id) return;
        this.revealTried = id;
        void this.router.navigate([], {
          queryParams: {
            matter: asset.matterRef,
            // A link to an asset outside the scope shows it with its matter, whoever opens it (the scope is a default view, not a limit).
            ...(this.scope.canAll() ? { scope: 'all' } : {}),
            matterId: null,
            name: null,
            extref: null,
            typeId: null,
            status: 'all',
            page: null,
          },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
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
      isActiveParam(parseStatus(this.filters.text('status'))),
      this.pageNumber(),
      this.pageSize(),
      this.sort() || undefined,
    );
  }

  /** The inactive assets the default Active hides, under the same other filters ("of 55 active - 5 inactive hidden  Show all"). */
  protected override fetchHidden() {
    return parseStatus(this.filters.text('status')) === 'active'
      ? this.list(false, 1, 1, undefined)
      : null;
  }

  protected override watch(): void {
    super.watch();
    this.scope.value();
  }

  /** The same list without the scope: the "of 1,204". */
  protected override fetchUnscoped() {
    return this.scope.mine()
      ? this.list(isActiveParam(parseStatus(this.filters.text('status'))), 1, 1, undefined, false)
      : null;
  }

  private list(
    isActive: boolean | undefined,
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
    return firstValueFrom(
      this.api.listAssets(
        Number.isInteger(matterId) && matterId > 0 ? matterId : undefined,
        typeIds.length > 0 ? typeIds : undefined,
        isActive,
        undefined,
        this.filters.text('name') || undefined,
        this.filters.text('extref') || undefined,
        this.filters.text('matter') || undefined,
        scoped && this.scope.mine() ? true : undefined,
        undefined,
        page,
        size,
        sort,
      ),
    );
  }

  // ---- selection and details panel

  protected close(): void {
    const id = this.selectedId();
    this.ownSelection = null;
    this.navigate({ selected: null });
    if (id !== null) this.focusRow(id);
  }

  protected onResize(): void {
    this.viewport.set(window.innerWidth);
  }

  protected onEscape(event: Event): void {
    if (event.defaultPrevented || this.selectedId() === null) return;
    // An open dialog or menu (Set inactive) takes its own Escape.
    const target = event.target as HTMLElement | null;
    if (target?.closest('[role="dialog"], [role="listbox"], [role="menu"]')) return;
    this.close();
  }

  /** Puts focus back on the row's name button (or the grid when the row is not on this page). */
  private focusRow(id: number): void {
    afterNextRender(
      () => {
        const area = this.scroll()?.nativeElement;
        const button = area?.querySelector<HTMLElement>(`[data-asset-name="${id}"]`);
        (button ?? area)?.focus();
      },
      { injector: this.injector },
    );
  }

  /** The panel changed the asset (set inactive / active): the row follows without a reload. */
  protected rowChanged(asset: AssetResponse): void {
    this.rows.update((rows) =>
      rows.map((r) =>
        r.assetId === asset.assetId
          ? { ...r, isActive: asset.isActive, rowVersion: asset.rowVersion }
          : r,
      ),
    );
  }
}
