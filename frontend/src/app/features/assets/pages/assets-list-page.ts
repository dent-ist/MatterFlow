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
import { ActiveBadge } from '../../../shared/ui/badge';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { FilterDef, FilterOption } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { SortHeader } from '../../../shared/ui/data-table';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { FIXED_MODE_QUERY, FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { matterLinkOf } from '../../../shared/ui/matter-link';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';
import { AssetDetails } from './asset-details';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['name', 'type', 'matter', 'externalReference', 'status'] as const;

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
    ActiveBadge,
    Button,
    HasPermissionDirective,
    Pager,
    MatterRef,
    SortHeader,
    ErrorReference,
    FiltersBar,
    ColumnFilterRow,
    AssetDetails,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .as-table {
      table-layout: fixed;
      min-width: 820px;
    }
    .as-name {
      display: inline;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-align: left;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
      overflow-wrap: anywhere;
    }
    .as-name:hover {
      text-decoration-thickness: 2px;
    }
    tr[data-selected] td {
      background: var(--mf-selected-bg);
    }
    /* Not colour alone: a bar at the left edge of the row and a bold name. */
    tr[data-selected] td:first-child {
      box-shadow: inset 4px 0 0 var(--mf-primary);
    }
    tr[data-selected] .as-name {
      font-weight: 700;
    }
    .as-sub {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      overflow-wrap: anywhere;
    }
    .as-cell {
      overflow-wrap: anywhere;
    }
    .as-state td {
      height: auto;
      padding: var(--mf-s5);
      text-align: center;
      background: var(--mf-surface);
    }
    .as-state p {
      margin: 0 0 var(--mf-s2);
    }
    .as-hint {
      color: var(--mf-text-muted);
    }
    .as-alert {
      margin-bottom: var(--mf-s2);
      color: var(--mf-danger);
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
  host: { '(keydown.escape)': 'onEscape($event)' },
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Assets">
        <p-button
          mfActions
          *mfHasPermission="'Asset.Create'"
          label="New asset"
          icon="pi pi-plus"
          (onClick)="go(newAssetUrl())"
        />
      </mf-page-header>

      <mf-filters-bar [filters]="filters" controls="asset-filter-row" [clearAlso]="['q']" />

      <div class="mf-fill as-grid">
        <div
          class="mf-table-wrap"
          mfScrollArea="Assets list"
          [keepOn]="['selected']"
          [style.scroll-padding-top]="filters.rowVisible() ? '5.5rem' : null"
          #scroll
        >
          <div class="mf-scroll">
            <table class="pg-table as-table">
              <caption class="pg-sr">
                Assets
              </caption>
              <colgroup>
                <col style="width: 26%" />
                <col style="width: 16%" />
                <col style="width: 22%" />
                <col style="width: 22%" />
                <col style="width: 14%" />
              </colgroup>
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
                @if (filters.rowVisible()) {
                  <tr
                    mfColumnFilterRow
                    id="asset-filter-row"
                    [filters]="filters"
                    [columns]="columns"
                  ></tr>
                }
              </thead>
              <tbody>
                @switch (state()) {
                  @case ('loading') {
                    <tr class="as-state">
                      <td colspan="5" role="status" aria-busy="true" data-loading>
                        Loading assets...
                      </td>
                    </tr>
                  }
                  @case ('error') {
                    <tr class="as-state">
                      <td colspan="5" data-error>
                        <div class="as-alert" role="alert">
                          Couldn't load assets.
                          <mf-error-reference />
                        </div>
                        <p-button label="Retry" severity="secondary" (onClick)="load()" />
                      </td>
                    </tr>
                  }
                  @default {
                    @for (a of rows(); track a.assetId) {
                      <tr
                        [attr.data-asset-id]="a.assetId"
                        [attr.data-selected]="a.assetId === selectedId() ? '' : null"
                        [attr.aria-current]="a.assetId === selectedId() ? 'true' : null"
                      >
                        <td class="as-cell">
                          <button
                            type="button"
                            class="as-name"
                            [attr.data-asset-name]="a.assetId"
                            [attr.aria-controls]="a.assetId === selectedId() ? 'asset-panel' : null"
                            (click)="select(a, $event)"
                          >
                            {{ a.displayName }}
                          </button>
                        </td>
                        <td class="as-cell">{{ a.assetTypeName }}</td>
                        <td class="as-cell">
                          <mf-matter-ref
                            [value]="a.matterRef"
                            [link]="matterLink(a.matterId)"
                            [copy]="false"
                          />
                          <span class="as-sub">{{ a.matterName }}</span>
                        </td>
                        <td class="pg-mono as-cell">{{ a.externalReference }}</td>
                        <td>
                          <mf-active-badge [active]="a.isActive" />
                        </td>
                      </tr>
                    } @empty {
                      <tr class="as-state">
                        <td
                          colspan="5"
                          [attr.data-empty]="filters.activeCount() > 0 ? 'filtered' : 'none'"
                        >
                          @if (filters.activeCount() > 0) {
                            <p>No assets match these filters</p>
                            @if (hiddenCount() > 0) {
                              <p class="as-hint" data-hidden-hint>
                                {{ hiddenCount() }} inactive hidden
                                <button
                                  type="button"
                                  class="mf-btn mf-btn--text"
                                  data-show-all
                                  (click)="showAll()"
                                >
                                  Show all
                                </button>
                              </p>
                            }
                            <p-button
                              label="Clear filters"
                              severity="secondary"
                              (onClick)="clear()"
                            />
                          } @else {
                            <p>No assets yet.</p>
                          }
                        </td>
                      </tr>
                    }
                  }
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
  private readonly details = viewChild(AssetDetails);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly defaultSort = 'displayName';
  protected readonly columns = COLUMNS;
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
  });

  /** The user chose the selection in this list (so a row that later leaves the page is not "revealed" by changing the filters). */
  private ownSelection: number | null = null;
  private revealTried: number | null = null;
  private lastRevealed = '';
  private focusDetails = false;

  constructor() {
    super();
    void this.loadTypes();

    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(() => this.filters.watchOverflow(this.scroll()?.nativeElement), {
      injector: this.injector,
    });

    // Keyboard users who select a row land on the panel heading once the panel is there.
    effect(() => {
      const details = this.details();
      this.selectedId();
      if (details && this.focusDetails) {
        this.focusDetails = false;
        untracked(() => details.requestFocus());
      }
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

  private list(
    isActive: boolean | undefined,
    page: number,
    size: number,
    sort: string | undefined,
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
        page,
        size,
        sort,
      ),
    );
  }

  // ---- selection and details panel

  protected select(asset: AssetListItem, event: MouseEvent): void {
    // `detail` is 0 for a click made with the keyboard (Enter or Space on the button).
    const viaKeyboard = event.detail === 0;
    this.ownSelection = asset.assetId;
    if (this.selectedId() === asset.assetId) {
      if (viaKeyboard) this.details()?.requestFocus();
      return;
    }
    this.focusDetails = viaKeyboard;
    this.navigate({ selected: asset.assetId });
  }

  protected close(): void {
    const id = this.selectedId();
    this.ownSelection = null;
    this.navigate({ selected: null });
    if (id !== null) this.focusRow(id);
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
