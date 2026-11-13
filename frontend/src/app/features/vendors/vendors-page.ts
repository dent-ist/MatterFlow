import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  untracked,
  effect,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  VendorAreasClient,
  VendorOptionView,
  VendorResponse,
  VendorServicesClient,
  VendorsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationService } from '../../core/notify/notification.service';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../shared/filters/column-filter-row';
import { FilterDef, FilterOption } from '../../shared/filters/filter-def';
import { ListFilters } from '../../shared/filters/list-filters';
import { ListToolbar } from '../../shared/filters/list-toolbar';
import { ActionMenu } from '../../shared/ui/action-menu';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { FixedPage } from '../../shared/ui/fixed-page';
import { IntPipe } from '../../shared/ui/number-format';
import { NumericDatePipe } from '../../shared/ui/numeric-date';
import { ServerListPage } from '../../shared/ui/list-query';
import { PageHeader } from '../../shared/ui/page-header';
import { Pager } from '../../shared/ui/pager';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../shared/ui/record-grid';
import { rowActions } from '../../shared/ui/row-actions';
import { SortedLine, sortLabelsOf } from '../../shared/ui/sorted-line';
import { Tip } from '../../shared/ui/tip';
import { VendorCategory, VENDOR_CATEGORIES } from './vendor-badges';
import { VendorDialog } from './vendor-dialog';
import { deleteFailure, namesOf } from './vendor-text';

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  name: '14rem',
  website: '10rem',
  category: '6rem',
  services: '10rem',
  areas: '7rem',
  contacts: '2rem',
  matters: '2rem',
  updated: '4rem',
};

/** The sort fields the API accepts (`GET /api/v1/vendors?sort=`, a leading minus is descending). */
const SORT_OPTIONS = [
  { value: 'name', label: 'Vendor' },
  { value: 'category', label: 'Category' },
  { value: 'updated', label: 'Updated' },
];

/**
 * Vendors (epic #1373, issue #1378; mockup `docs/design/mockups/vendor-management`, screen `vendors`): the firms the team hires for eDiscovery work. A grid of Vendor (the name button
 * that opens the pop-up), Category (Preferred or Blacklisted), Services, Areas, Contacts (with a flag icon when a contact is marked Do Not Hire), Matters and Updated (Website is an optional
 * column), with Search (name, website or service), the Category, Service and Area filters, sorting and paging on the server. `Vendor.View` reads (the pop-up is read only);
 * `Vendor.Manage` adds New Vendor and the row menu (Edit Vendor, Delete Vendor). State lives in the address (`q`, `category`, `serviceId`, `areaId`, `page`, `size`, `sort`).
 */
@Component({
  selector: 'mf-vendors-page',
  imports: [
    FixedPage,
    PageHeader,
    Button,
    HasPermissionDirective,
    ListToolbar,
    SortedLine,
    ColumnFilterRow,
    RecordGrid,
    RecordCell,
    RecordColumns,
    Pager,
    VendorCategory,
    VendorDialog,
    ActionMenu,
    ConfirmDialog,
    IntPipe,
    NumericDatePipe,
    Tip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  styles: `
    /* Vendor is the spring: one clipped line (D-45, D-44m); the other text columns keep their widths whatever the text, cut with an ellipsis. */
    td.vn-name {
      width: 100%;
      max-width: 0;
    }
    td.vn-name .mf-btn--name {
      -webkit-line-clamp: 1;
      line-clamp: 1;
      font-weight: 700;
    }
    td.vn-clip {
      max-width: 0;
    }
    .vn-none {
      color: var(--mf-text-muted);
    }
    .vn-flag {
      color: var(--mf-danger);
      margin-right: var(--mf-s1);
    }
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="Vendors"
        description="Firms the team hires for eDiscovery work. Search by name, website or service. Blacklisted vendors stay in the list and carry a warning wherever they appear."
        [count]="state() === 'ready' ? total() : null"
        [countPending]="state() !== 'ready'"
      >
        <p-button
          mfActions
          *mfHasPermission="'Vendor.Manage'"
          label="New Vendor"
          icon="pi pi-plus"
          data-new-vendor
          (onClick)="openNew()"
        />
      </mf-page-header>

      <mf-list-toolbar
        [filters]="filters"
        controls="vendors-filter-row"
        searchLabel="Search vendors"
        [clearAlso]="['q']"
      >
        <mf-record-columns mfColumns [grid]="grid" />
        <mf-sorted-line
          mfBarEnd
          [sort]="sort()"
          [defaultSort]="defaultSort"
          [labels]="sortLabels"
          (resetSort)="pickSort(null)"
        />
      </mf-list-toolbar>

      <div class="mf-fill">
        <mf-record-grid
          label="Vendors list"
          caption="Vendors"
          noun="vendors"
          [grid]="grid"
          [rows]="rows()"
          [rowKey]="vendorKey"
          [loadState]="state()"
          [empty]="rows().length === 0"
          [filtered]="filters.activeCount() > 0"
          [bones]="bones"
          [sort]="sort()"
          [defaultSort]="defaultSort"
          [actions]="canManage()"
          [rowClickable]="true"
          (rowClick)="open($event)"
          (sorted)="setSort($event)"
          (retry)="load()"
          (clear)="clear()"
        >
          @if (filters.rowVisible()) {
            <tr
              mfGridFilterRow
              mfColumnFilterRow
              id="vendors-filter-row"
              [filters]="filters"
              [columns]="columns()"
            ></tr>
          }
          <p-button
            mfEmptyAction
            *mfHasPermission="'Vendor.Manage'"
            label="New Vendor"
            icon="pi pi-plus"
            data-empty-new-vendor
            (onClick)="openNew()"
          />
          <ng-template mfCell="name" let-v>
            <td class="vn-name">
              <button
                type="button"
                class="mf-btn mf-btn--text mf-btn--name"
                data-vendor-name
                [mfTip]="v.name"
                (click)="open(v)"
              >
                {{ v.name }}
              </button>
            </td>
          </ng-template>
          <ng-template mfCell="website" let-v>
            <td class="vn-clip">
              @if (v.website) {
                <span class="pg-clip" data-vendor-website [mfTip]="v.website">{{ v.website }}</span>
              } @else {
                <span class="vn-none" data-vendor-website>None</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="category" let-v>
            <td data-vendor-category-cell><mf-vendor-category [category]="v.category" /></td>
          </ng-template>
          <ng-template mfCell="services" let-v>
            <td class="vn-clip">
              @if (v.services.length) {
                <span class="pg-clip" data-vendor-services [mfTip]="names(v.services)">{{
                  names(v.services)
                }}</span>
              } @else {
                <span class="vn-none" data-vendor-services>None</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="areas" let-v>
            <td class="vn-clip">
              @if (v.areas.length) {
                <span class="pg-clip" data-vendor-areas [mfTip]="names(v.areas)">{{
                  names(v.areas)
                }}</span>
              } @else {
                <span class="vn-none" data-vendor-areas>None</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="contacts" let-v>
            <td class="pg-num" data-vendor-contacts>
              @if (v.doNotHireCount > 0) {
                <i
                  class="pi pi-flag vn-flag"
                  data-do-not-hire
                  role="img"
                  [attr.aria-label]="
                    v.doNotHireCount === 1
                      ? '1 contact is marked Do Not Hire'
                      : v.doNotHireCount + ' contacts are marked Do Not Hire'
                  "
                  [mfTip]="
                    v.doNotHireCount === 1
                      ? '1 contact is marked Do Not Hire'
                      : v.doNotHireCount + ' contacts are marked Do Not Hire'
                  "
                ></i>
              }
              {{ v.contactCount | mfInt }}
            </td>
          </ng-template>
          <ng-template mfCell="matters" let-v>
            <td class="pg-num" data-vendor-matters>{{ v.matterCount | mfInt }}</td>
          </ng-template>
          <ng-template mfCell="updated" let-v>
            <td data-vendor-updated>{{ v.modifiedAt | mfNum: 'date' }}</td>
          </ng-template>
          <ng-template mfCell="actions" let-v>
            <td class="mf-col-actions" data-row-actions>
              @let menu = menuFor(v);
              <mf-action-menu [floating]="true" [label]="menu.label" [items]="menu.items" />
            </td>
          </ng-template>
          <div mfGridFoot>
            @if (state() === 'ready' && total() > 0) {
              <mf-pager
                [page]="pageNumber()"
                [pageSize]="pageSize()"
                [pageSizes]="pageSizes"
                [total]="total()"
                (pageChange)="goToPage($event)"
                (pageSizeChange)="setPageSize($event)"
              />
            }
          </div>
        </mf-record-grid>
      </div>
    </mf-fixed-page>

    @if (dialogUsed()) {
      <mf-vendor-dialog
        [vendor]="editing()"
        [startInEdit]="startInEdit()"
        [(visible)]="dialogOpen"
        (saved)="load()"
        (deleted)="load()"
        (changedList)="load()"
      />
    }

    <mf-confirm-dialog
      title="Delete Vendor"
      confirmLabel="Delete Vendor"
      [danger]="true"
      [busy]="deleting()"
      [error]="deleteError()"
      [(visible)]="confirmOpen"
      (confirmed)="confirmDelete()"
    >
      <p data-delete-text>
        Delete <strong>{{ target()?.name }}</strong> and its
        {{
          target()?.contactCount === 1 ? '1 contact' : (target()?.contactCount ?? 0) + ' contacts'
        }}? The people stay in People. This cannot be undone.
      </p>
    </mf-confirm-dialog>
  `,
})
export class VendorsPage extends ServerListPage<VendorResponse> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(VendorsClient);
  private readonly servicesApi = inject(VendorServicesClient);
  private readonly areasApi = inject(VendorAreasClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);

  protected readonly defaultSort = 'name';
  protected readonly sortLabels = sortLabelsOf(SORT_OPTIONS);
  protected readonly canManage = computed(() => this.auth.has('Vendor.Manage'));
  protected readonly bones = BONES;
  protected readonly vendorKey = (v: VendorResponse): number => v.vendorId;
  protected readonly names = namesOf;

  /**
   * Default columns at 1366 (D-43a): Vendor (the spring, at least 200), Category 140, Services 232, Areas 160, Contacts 96, Matters 96, Updated 104 and the 48 px actions column with
   * `Vendor.Manage` = 1076 of the 1098 px; Website is one click away in Columns.
   */
  protected readonly gridDefs = computed((): RecordGridColumn[] => [
    { key: 'name', label: 'Vendor', locked: true, sort: 'name', minWidth: '200px' },
    {
      key: 'website',
      label: 'Website',
      defaultHidden: true,
      extra: true,
      width: 'var(--mf-col-client-w)',
      minWidth: 'var(--mf-col-client-w)',
    },
    {
      key: 'category',
      label: 'Category',
      sort: 'category',
      width: 'var(--mf-col-status-w)',
      minWidth: 'var(--mf-col-status-w)',
    },
    { key: 'services', label: 'Services', width: '232px', minWidth: '232px' },
    { key: 'areas', label: 'Areas', width: '160px', minWidth: '160px' },
    {
      key: 'contacts',
      label: 'Contacts',
      num: true,
      width: 'var(--mf-col-count-w)',
      minWidth: 'var(--mf-col-count-w)',
    },
    {
      key: 'matters',
      label: 'Matters',
      num: true,
      width: 'var(--mf-col-count-w)',
      minWidth: 'var(--mf-col-count-w)',
    },
    {
      key: 'updated',
      label: 'Updated',
      sort: 'updated',
      firstDesc: true,
      width: '104px',
      minWidth: '104px',
    },
  ]);
  /** The grid state (shared record grid, #1241): order, visibility and stored widths per person under the id "vendors". */
  protected readonly grid = new RecordGridState('vendors', this.gridDefs);
  protected readonly columns = computed(() => [
    ...this.grid.shown(),
    ...(this.canManage() ? ['actions'] : []),
  ]);

  /** The active services and areas, for the two filters (the lists of Administration > Lists). */
  private readonly serviceList = signal<readonly VendorOptionView[]>([]);
  private readonly areaList = signal<readonly VendorOptionView[]>([]);
  private optionsOf(list: readonly VendorOptionView[]): FilterOption[] {
    return list.filter((o) => o.isActive).map((o) => ({ value: String(o.id), label: o.name }));
  }

  private readonly defs = computed((): FilterDef[] => [
    { key: 'q', label: 'Vendor', column: 'name', type: 'text', search: true },
    {
      key: 'category',
      label: 'Category',
      column: 'category',
      type: 'select',
      options: VENDOR_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
      allLabel: 'All Categories',
    },
    {
      key: 'serviceId',
      label: 'Service',
      column: 'services',
      type: 'select',
      options: () => this.optionsOf(this.serviceList()),
      allLabel: 'All Services',
    },
    {
      key: 'areaId',
      label: 'Area',
      column: 'areas',
      type: 'select',
      options: () => this.optionsOf(this.areaList()),
      allLabel: 'All Areas',
    },
  ]);

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'vendors',
    noun: 'vendors',
    defs: this.defs,
    openByDefault: true,
    visibleColumns: this.columns,
  });

  protected readonly dialogOpen = signal(false);
  protected readonly dialogUsed = signal(false);
  protected readonly editing = signal<VendorResponse | null>(null);
  protected readonly startInEdit = signal(false);

  protected readonly confirmOpen = signal(false);
  protected readonly target = signal<VendorResponse | null>(null);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal('');

  constructor() {
    super();
    // The two lists feed the filters; a person who cannot read them simply gets filters without choices.
    effect(() => {
      untracked(() => {
        void firstValueFrom(this.servicesApi.listVendorServices())
          .then((l) => this.serviceList.set(l))
          .catch(() => undefined);
        void firstValueFrom(this.areasApi.listVendorAreas())
          .then((l) => this.areaList.set(l))
          .catch(() => undefined);
      });
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override fetch() {
    const numberOf = (key: string): number | undefined => {
      const n = Number(this.filters.text(key));
      return this.filters.text(key) && Number.isFinite(n) ? n : undefined;
    };
    return firstValueFrom(
      this.api.listVendors(
        this.filters.text('q') || undefined,
        this.filters.text('category') || undefined,
        numberOf('serviceId'),
        numberOf('areaId'),
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }

  protected openNew(): void {
    this.editing.set(null);
    this.startInEdit.set(false);
    this.dialogUsed.set(true);
    this.dialogOpen.set(true);
  }

  protected open(vendor: VendorResponse, edit = false): void {
    this.editing.set(vendor);
    this.startInEdit.set(edit && this.canManage());
    this.dialogUsed.set(true);
    this.dialogOpen.set(true);
  }

  protected askDelete(vendor: VendorResponse): void {
    this.target.set(vendor);
    this.deleteError.set('');
    this.confirmOpen.set(true);
  }

  protected async confirmDelete(): Promise<void> {
    const v = this.target();
    if (!v || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set('');
    try {
      await firstValueFrom(this.api.deleteVendor(v.vendorId));
      this.confirmOpen.set(false);
      this.notify.success('Vendor deleted', `${v.name} is deleted. Its contacts stay in People.`);
      await this.load();
    } catch (err) {
      this.deleteError.set(deleteFailure(err).text);
    } finally {
      this.deleting.set(false);
    }
  }

  /** The "..." menu holds the two secondary actions, Edit Vendor and Delete Vendor (D-36); a linked vendor shows why it cannot be deleted. */
  protected menuFor(v: VendorResponse) {
    return rowActions(
      v.name,
      [
        {
          id: 'edit',
          label: 'Edit Vendor',
          icon: 'pi-pencil',
          permission: 'Vendor.Manage',
          run: () => this.open(v, true),
        },
        {
          id: 'delete',
          label: 'Delete Vendor',
          icon: 'pi-trash',
          danger: true,
          permission: 'Vendor.Manage',
          reason:
            v.matterCount > 0
              ? `Linked to ${v.matterCount === 1 ? '1 matter' : v.matterCount + ' matters'}. Unlink it first.`
              : undefined,
          run: () => this.askDelete(v),
        },
      ],
      { can: (p) => this.auth.has(p) },
    );
  }
}
