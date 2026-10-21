import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AssetTypeResponse, AssetTypesClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { AdminCardList, AdminCardSpec, activeCardBadge } from '../../../shared/ui/admin-card-spec';
import { AdminColumn, adminListState } from '../../../shared/ui/admin-list-state';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { LocalListPage } from '../../../shared/ui/list-query';
import { parseStatus } from '../../../shared/ui/list-helpers';
import { Pager } from '../../../shared/ui/pager';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { rowActions } from '../../../shared/ui/row-actions';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';
import { StripDef, stripActiveKey, stripItems, stripPick } from '../../../shared/ui/strip-items';
import { DrillReturn } from '../../../shared/work-queue/drill';
import { AdminTabCounts } from '../admin-tabs';
import { AdminShellFilters } from '../task-types/shell-filters';
import { ADMIN_LIST, AdminListLeave } from '../list-return';
import { dialogCopy } from '../shared/dialog-copy';
import { FormStatusCell } from '../shared/form-status-cell';

/** Every column of the grid, in order; the keys the filter definitions point at. */
type Column = 'name' | 'fields' | 'assets' | 'status' | 'actions';

/** The loaded cell class and the skeleton bone of each column: one definition for the table and its loading rows (#575). */
const COLUMN_SPEC: Record<Column, AdminColumn> = {
  name: { cls: 'mf-cell-name', bone: '12rem' },
  fields: { cls: 'mf-cell-badge', bone: '14rem' },
  assets: { cls: 'mf-cell-num', bone: '1.5rem' },
  status: { cls: 'mf-cell-badge', bone: '4rem' },
  actions: { cls: 'mf-cell-actions', bone: '1.5rem' },
};

/** The Assets column leaves below this window width (the kit's column-drop rule); the Fields cell is the point of the list and stays. */
const ASSETS_ROOM = 900;

/** The most asset types one request returns; the list is loaded whole (a firm has a handful), page after page when there are more. */
const LOAD_PAGE_SIZE = 100;

/**
 * Admin: the Asset Types tab of the Asset Types page (UX S17, #634). The header (name, crumb, tabs with their counts, Filters, New asset type)
 * belongs to `AssetAdminPage` on the admin list shell; this is the list: a health strip (Active, No published fields, Inactive, counted over
 * the whole list), 44 px rows with the name as the link to the record page, the Fields cell (`mf-form-status-cell`: published and draft
 * version, field count, date), the Assets count (only for a person who may see assets), the status and ONE overflow menu (Edit, Edit fields,
 * History, Move up, Move down, Deactivate or Activate), the hidden-count line and phone cards below 640 px. The list is loaded whole and
 * filtered here. Asset types are never deleted, only deactivated, so existing Assets keep working. Needs `AssetType.Manage`.
 */
@Component({
  selector: 'mf-asset-types-page',
  imports: [
    ActionMenu,
    ActiveBadge,
    ActivityDrawer,
    AdminCardList,
    ColumnFilterRow,
    ConfirmDialog,
    FiltersBar,
    FormStatusCell,
    GridBody,
    Pager,
    RouterLink,
    RowLink,
    ScrollArea,
    WorkStrip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <div class="mf-sr-only" role="status" aria-live="polite" data-announce>
      {{ announcement() }}
    </div>

    @if (failure()) {
      <p class="at-failure" role="alert" data-failure>
        <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ failure() }}
      </p>
    }

    <mf-work-strip
      label="Asset types summary"
      [items]="strip()"
      [interactive]="true"
      [active]="stripActive()"
      (pick)="pickStrip($event)"
    />

    <!-- The Filters button is in the page header; this draws the sheet it opens below 640 px (and the chips of a filtered address). -->
    <mf-filters-bar [bare]="true" [filters]="filters" [clearAlso]="['q']" />

    @if (phone()) {
      <mf-admin-card-list
        noun="asset types"
        label="Asset types"
        [items]="rows()"
        [spec]="cardOf"
        emptyText="No asset types yet. Use New asset type above to add the first one."
        [filters]="filters"
        [listId]="listId"
        [state]="ls.state()"
        [empty]="ls.empty()"
        [filtered]="ls.filtered()"
        [hidden]="ls.hidden()"
        hiddenLabel="inactive"
        (retry)="load()"
        (clear)="clear()"
        (showAll)="showAll()"
      />
    } @else {
      <div class="mf-table-wrap" mfScrollArea="Asset types list" #scroll>
        <div class="mf-scroll">
          <table class="mf-grid" id="asset-types-table" data-types>
            <caption class="mf-sr-only">
              Asset types, in the order they are offered
            </caption>
            <thead>
              <tr>
                <th class="mf-cell-name" scope="col">Name</th>
                <th class="mf-cell-badge" scope="col">Fields</th>
                @if (assetsShown()) {
                  <th class="mf-cell-num" scope="col">Assets</th>
                }
                <th class="mf-cell-badge" scope="col">Status</th>
                <th class="mf-cell-actions" scope="col"><span class="mf-sr-only">Actions</span></th>
              </tr>
              @if (filters.rowVisible()) {
                <tr
                  mfColumnFilterRow
                  id="asset-type-filter-row"
                  [filters]="filters"
                  [columns]="columns()"
                ></tr>
              }
            </thead>
            <tbody
              mfGridBody
              noun="asset types"
              [columnSpec]="columnSpec()"
              [filters]="filters"
              emptyText="No asset types yet. Use New asset type above to add the first one."
              [state]="ls.state()"
              [empty]="ls.empty()"
              [filtered]="ls.filtered()"
              [hidden]="ls.hidden()"
              hiddenLabel="inactive"
              (retry)="load()"
              (clear)="clear()"
              (showAll)="showAll()"
            >
              @for (t of rows(); track t.assetTypeId) {
                <tr [attr.data-row]="t.name" [class.inactive]="!t.isActive">
                  <td class="mf-cell-name">
                    <a
                      class="mf-name"
                      [routerLink]="['/admin/asset-types', t.assetTypeId]"
                      [mfRowLink]="listId"
                      [rowKey]="t.assetTypeId"
                      [state]="leave.state()"
                      [attr.title]="t.name"
                      data-open
                      >{{ t.name }}</a
                    >
                  </td>
                  <td class="mf-cell-badge" data-fields>
                    <mf-form-status-cell
                      [publishedVersion]="t.publishedFormVersionNo ?? null"
                      [fieldCount]="t.fieldCount ?? null"
                      [publishedAtUtc]="t.publishedAtUtc ?? null"
                      [draftVersion]="t.draftVersionNo ?? null"
                    />
                  </td>
                  @if (assetsShown()) {
                    <td class="mf-cell-num" data-assets>
                      @if (t.assetCount !== undefined && t.assetCount !== null) {
                        {{ t.assetCount }}
                      }
                    </td>
                  }
                  <td class="mf-cell-badge"><mf-active-badge [active]="t.isActive" /></td>
                  <td class="mf-cell-actions" [attr.data-actions-of]="t.assetTypeId">
                    @if (menus().get(t.assetTypeId); as menu) {
                      <mf-action-menu [floating]="true" [label]="menu.label" [items]="menu.items" />
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
        [page]="shownPage()"
        [pageSize]="pageSize()"
        [pageSizes]="pageSizes"
        [total]="total()"
        [hidden]="hiddenCount()"
        hiddenLabel="inactive"
        (showAll)="showAll()"
        (pageChange)="goToPage($event)"
        (pageSizeChange)="setPageSize($event)"
      />
    }

    <mf-confirm-dialog
      [title]="deactivateCopy().title"
      [confirmLabel]="deactivateCopy().confirm"
      [cancelLabel]="deactivateCopy().cancel"
      [danger]="deactivateCopy().danger"
      [busy]="busy()"
      [visible]="deactivating() !== null"
      (visibleChange)="!$event && cancelDeactivate()"
      (confirmed)="confirmDeactivate()"
    >
      <p data-deactivate-body>
        {{ deactivating()?.name }} can't be chosen for new assets. {{ deactivateCopy().body }}
      </p>
    </mf-confirm-dialog>

    @if (activity(); as t) {
      <mf-activity-drawer
        objectType="AssetType"
        [objectId]="t.assetTypeId"
        [name]="t.name"
        [visible]="true"
        (visibleChange)="!$event && closeActivity()"
      />
    }
  `,
  styles: `
    .at-failure {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
      margin: var(--mf-s2) 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class AssetTypesPage extends LocalListPage<AssetTypeResponse> {
  private readonly api = inject(AssetTypesClient);
  private readonly auth = inject(AuthStore);
  private readonly injector = inject(Injector);
  private readonly drill = inject(DrillReturn);
  private readonly report = AdminTabCounts.report('types');
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly listId = ADMIN_LIST.assetTypes.id;
  protected readonly leave = inject(AdminListLeave);
  protected readonly phone = phoneCards();
  private readonly assetsRoom = viewportAtLeast(ASSETS_ROOM);
  protected readonly defaultSort = 'sortOrder';

  protected readonly canManage = computed(() => this.auth.has('AssetType.Manage'));
  /** The Assets count is null in the API without `Asset.View`: the column is not there for a person without it. */
  protected readonly assetsShown = computed(() => this.assetsRoom() && this.auth.has('Asset.View'));
  protected readonly columns = computed<readonly Column[]>(() => [
    'name',
    'fields',
    ...(this.assetsShown() ? (['assets'] as const) : []),
    'status',
    'actions',
  ]);
  protected readonly columnSpec = computed<readonly AdminColumn[]>(() =>
    this.columns().map((c) => COLUMN_SPEC[c]),
  );

  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly deactivating = signal<AssetTypeResponse | null>(null);
  protected readonly activity = signal<AssetTypeResponse | null>(null);
  protected readonly deactivateCopy = computed(() =>
    dialogCopy.deactivateAssetType({ assets: this.deactivating()?.assetCount ?? null }),
  );

  /**
   * Inline column filters, all applied here because the list is loaded whole: Name (`name`) and Status (`status`, Active by default). The
   * health strip's "No published fields" has no control; it is a removable chip (`fields=none`).
   */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'asset-types',
    noun: 'asset types',
    sheetBelow: 640,
    visibleColumns: computed(() => (this.phone() ? null : this.columns())),
    defs: computed((): FilterDef[] => [
      { key: 'name', label: 'Name', column: 'name', type: 'text' },
      statusDef(),
      {
        key: 'fields',
        label: 'Fields',
        type: 'text',
        noControl: true,
        normalize: (v) => (v === 'none' ? v : null),
        valueLabel: () => 'No published fields',
      },
    ]),
  });
  protected readonly ls = adminListState({
    state: this.state,
    rows: this.rows,
    filters: this.filters,
    hidden: this.hiddenCount,
  });

  constructor() {
    super();
    // The Filters button of the page header belongs to this tab.
    AdminShellFilters.register({ filters: this.filters, controls: 'asset-type-filter-row' });
    // The tab's count is the number of active types.
    effect(() => {
      if (this.state() === 'ready') this.report(this.all().filter((t) => t.isActive).length);
    });
    // Back from a record puts focus on the name link of the row that was left.
    restoreRowFocus(this.listId, () => this.state() === 'ready');
    effect(() => untracked(() => void this.load()));
    // The controls move into the sheet while the grid scrolls sideways (the grid is not there while the phone shows cards).
    effect(() => {
      const area = this.scroll()?.nativeElement;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override matchesFilters(t: AssetTypeResponse): boolean {
    const name = this.filters.text('name').trim().toLowerCase();
    if (name && !t.name.toLowerCase().includes(name)) return false;
    return this.filters.text('fields') !== 'none' || this.hasNoFields(t);
  }

  protected override searchText(t: AssetTypeResponse): string {
    return t.name;
  }

  protected override isActiveRow(t: AssetTypeResponse): boolean {
    return t.isActive;
  }

  protected override sortValue(t: AssetTypeResponse, field: string): string | number {
    return field === 'name' ? t.name : t.sortOrder;
  }

  /** Nothing is published: the type has no fields people can fill in yet. */
  private hasNoFields(t: AssetTypeResponse): boolean {
    return t.publishedFormVersionNo === undefined || t.publishedFormVersionNo === null;
  }

  // ---- the health strip (#634, the kit's stripItems)

  private readonly stripDefs: readonly StripDef<AssetTypeResponse>[] = [
    { key: 'active', label: 'Active', matches: (t) => t.isActive, params: { status: null } },
    {
      key: 'noFields',
      label: 'No published fields',
      hint: 'Active asset types with no published form, so assets of the type have no fields',
      matches: (t) => t.isActive && this.hasNoFields(t),
      params: { status: null, fields: 'none' },
    },
    {
      key: 'inactive',
      label: 'Inactive',
      matches: (t) => !t.isActive,
      params: { status: 'inactive' },
    },
  ];
  protected readonly strip = computed<WorkStripItem[]>(() =>
    stripItems(this.state() === 'ready' ? this.all() : null, this.stripDefs),
  );
  protected readonly stripActive = computed<string | null>(() =>
    stripActiveKey(this.stripDefs, (p) => {
      if (p !== 'status') return this.filters.text(p) || null;
      const status = parseStatus(this.filters.text('status'));
      return status === 'active' ? null : status;
    }),
  );

  protected pickStrip(key: string): void {
    const to = stripPick(this.stripDefs, key, this.stripActive());
    if (!to) return;
    this.navigate({ ...to.params, page: null });
    const item = this.strip().find((i) => i.key === to.key);
    if (item) this.announcement.set(`${item.label}: ${item.count ?? 0} asset types.`);
  }

  // ---- loading

  async load(): Promise<void> {
    if (this.state() === 'error' || this.state() === 'forbidden') this.state.set('loading');
    try {
      const all: AssetTypeResponse[] = [];
      for (let page = 1; ; page++) {
        const result = await firstValueFrom(
          this.api.listAssetTypes(
            undefined,
            undefined,
            undefined,
            page,
            LOAD_PAGE_SIZE,
            'sortOrder',
          ),
        );
        all.push(...result.items);
        if (all.length >= result.total || result.items.length === 0) break;
      }
      this.all.set(all);
      this.state.set('ready');
      this.filters.reportResults(this.total());
    } catch (error) {
      this.state.set(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error');
    }
  }

  // ---- the row menu and the phone cards

  protected readonly menus = computed(() => {
    const map = new Map<number, ReturnType<typeof rowActions>>();
    const list = this.matching();
    list.forEach((t, i) => {
      map.set(
        t.assetTypeId,
        rowActions(
          t.name,
          [
            {
              id: 'edit',
              label: 'Edit',
              icon: 'pi-pencil',
              permission: 'AssetType.Manage',
              run: () => void this.open(t),
            },
            {
              id: 'fields',
              label: 'Edit fields',
              icon: 'pi-list',
              permission: 'AssetType.Manage',
              run: () => void this.openFields(t),
            },
            {
              id: 'history',
              label: 'History',
              icon: 'pi-history',
              permission: 'Audit.View',
              run: () => this.activity.set(t),
            },
            {
              id: 'up',
              label: 'Move up',
              icon: 'pi-arrow-up',
              permission: 'AssetType.Manage',
              reason: i === 0 ? 'Already first.' : undefined,
              run: () => void this.move(t, -1),
            },
            {
              id: 'down',
              label: 'Move down',
              icon: 'pi-arrow-down',
              permission: 'AssetType.Manage',
              reason: i === list.length - 1 ? 'Already last.' : undefined,
              run: () => void this.move(t, 1),
            },
            t.isActive
              ? {
                  id: 'deactivate',
                  label: 'Deactivate',
                  kind: 'state' as const,
                  permission: 'AssetType.Manage',
                  run: () => this.deactivating.set(t),
                }
              : {
                  id: 'activate',
                  label: 'Activate',
                  kind: 'state' as const,
                  permission: 'AssetType.Manage',
                  run: () => void this.setActive(t, true),
                },
          ],
          { can: (permission) => this.auth.has(permission) },
        ),
      );
    });
    return map;
  });

  /** The phone card of a type (#634): the same data and the same menu as the table row. */
  protected readonly cardOf = (t: AssetTypeResponse): AdminCardSpec => ({
    title: t.name,
    link: ['/admin/asset-types', t.assetTypeId],
    rowKey: t.assetTypeId,
    state: this.leave.state(),
    badges: [activeCardBadge(t.isActive)],
    meta: [
      this.formLine(t),
      ...(this.auth.has('Asset.View') && typeof t.assetCount === 'number'
        ? [t.assetCount === 1 ? '1 asset' : `${t.assetCount} assets`]
        : []),
    ],
    actions: this.menus().get(t.assetTypeId) ?? null,
  });

  private formLine(t: AssetTypeResponse): string {
    const parts: string[] = [];
    if (this.hasNoFields(t)) parts.push('No published fields');
    else {
      parts.push(`Published v${t.publishedFormVersionNo}`);
      if (typeof t.fieldCount === 'number') {
        parts.push(t.fieldCount === 1 ? '1 field' : `${t.fieldCount} fields`);
      }
    }
    if (typeof t.draftVersionNo === 'number') parts.push(`draft v${t.draftVersionNo}`);
    return parts.join(' · ');
  }

  private open(t: AssetTypeResponse): Promise<boolean> {
    this.drill.leaveRow(this.listId, t.assetTypeId);
    return this.router.navigate(['/admin/asset-types', t.assetTypeId], {
      state: this.leave.state(),
    });
  }

  private openFields(t: AssetTypeResponse): Promise<boolean> {
    this.drill.leaveRow(this.listId, t.assetTypeId);
    return this.router.navigate(['/admin/asset-types', t.assetTypeId, 'form'], {
      state: { ...this.leave.state(), keepRow: true },
    });
  }

  protected closeActivity(): void {
    const t = this.activity();
    this.activity.set(null);
    if (t) this.focusMenuOf(t.assetTypeId);
  }

  // ---- activate, deactivate

  protected cancelDeactivate(): void {
    this.deactivating.set(null);
  }

  protected async confirmDeactivate(): Promise<void> {
    const t = this.deactivating();
    if (!t) return;
    this.deactivating.set(null);
    await this.setActive(t, false);
  }

  protected async setActive(t: AssetTypeResponse, active: boolean): Promise<void> {
    const updated = await this.run(() =>
      firstValueFrom(
        this.api.updateAssetType(t.assetTypeId, {
          name: t.name,
          description: t.description,
          sortOrder: t.sortOrder,
          isActive: active,
          rowVersion: t.rowVersion,
        }),
      ),
    );
    if (!updated) return;
    this.replace(updated);
    this.announcement.set(`${updated.name} ${active ? 'activated' : 'deactivated'}.`);
    this.focusMenuOf(t.assetTypeId);
  }

  // ---- order (#637): Move up and Move down swap the position with the neighbour in the list as it is shown

  protected async move(t: AssetTypeResponse, delta: -1 | 1): Promise<void> {
    const list = this.matching();
    const index = list.findIndex((x) => x.assetTypeId === t.assetTypeId);
    const other = list[index + delta];
    if (!other || this.busy()) return;
    // Two rows with the same position are given distinct ones, so the swap always changes the order.
    const mine = t.sortOrder === other.sortOrder ? other.sortOrder + delta : other.sortOrder;
    const first = await this.run(() => this.save(t, mine));
    if (!first) return;
    this.replace(first);
    const second = await this.run(() => this.save(other, t.sortOrder));
    if (!second) {
      await this.load();
      return;
    }
    this.replace(second);
    const position = list.findIndex((x) => x.assetTypeId === t.assetTypeId) + delta + 1;
    this.announcement.set(`${t.name} moved to position ${position} of ${list.length}.`);
    this.focusMenuOf(t.assetTypeId);
  }

  private save(t: AssetTypeResponse, sortOrder: number): Promise<AssetTypeResponse> {
    return firstValueFrom(
      this.api.updateAssetType(t.assetTypeId, {
        name: t.name,
        description: t.description,
        sortOrder,
        isActive: t.isActive,
        rowVersion: t.rowVersion,
      }),
    );
  }

  private replace(updated: AssetTypeResponse): void {
    this.all.update((list) =>
      list
        .map((r) => (r.assetTypeId === updated.assetTypeId ? updated : r))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.assetTypeId - b.assetTypeId),
    );
  }

  private async run<T>(work: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    this.failure.set('');
    try {
      return await work();
    } catch (e) {
      const error = e instanceof ApiError ? e : null;
      if (error?.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed the asset types. The list was reloaded; try again.');
        await this.load();
      } else {
        this.failure.set(error?.message ?? 'Couldn’t save. Try again.');
      }
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  /** The row's menu button gets focus back after a change that re-renders the row (a moved row is a new element). */
  private focusMenuOf(id: number): void {
    afterNextRender(
      () => {
        const host = document.querySelector<HTMLElement>(`[data-actions-of="${id}"]`);
        host?.querySelector<HTMLElement>('button[data-overflow]')?.focus();
      },
      { injector: this.injector },
    );
  }
}
