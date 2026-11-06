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
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  ReportAdminClient,
  ReportCategoryResponse,
  ReportDefinitionsClient,
  ReportListItemResponse,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { AdminCardList, AdminCardSpec, activeCardBadge } from '../../../shared/ui/admin-card-spec';
import { adminListState } from '../../../shared/ui/admin-list-state';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { LocalListPage } from '../../../shared/ui/list-query';
import { Pager } from '../../../shared/ui/pager';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { rowActions } from '../../../shared/ui/row-actions';
import { COLUMN_ROOM } from '../../../shared/ui/viewport';
import { AdminTabCounts } from '../admin-tabs';
import { ADMIN_LIST, AdminListLeave } from '../list-return';
import { AdminShellFilters } from '../task-types/shell-filters';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';
import { IntPipe } from '../../../shared/ui/number-format';
import { Button } from 'primeng/button';

/** The skeleton bone of each column (the loading rows of the grid). */
const BONES: Record<string, string> = {
  name: '14rem',
  category: '8rem',
  roles: '1.5rem',
  lastRun: '6rem',
  status: '4rem',
};

/**
 * Admin: the Reports tab of the Reports page (issue #712): every report, inactive ones included, in category and report order, on the admin list
 * kit (search by name through the Name filter, a Category filter, Status with Active as the default, the hidden-count line, the pager, phone
 * cards below 640 px). A row shows the name (the link to the editor), the category, how many roles may run it, when a person last ran it and the
 * status as a text chip. ONE overflow menu per row: Edit, Roles (with Report.Assign), History, Activate (only after a successful preview of the
 * current version) or Deactivate. There is no delete: a report is only deactivated. Needs `Report.Manage`.
 */
@Component({
  selector: 'mf-reports-list-tab',
  imports: [
    Button,
    IntPipe,
    NumericDatePipe,
    ActionMenu,
    ActiveBadge,
    AdminCardList,
    ColumnFilterRow,
    ConfirmDialog,
    FiltersBar,
    NgTemplateOutlet,
    Pager,
    RecordCell,
    RecordGrid,
    RouterLink,
    RowLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <div class="mf-sr-only" role="status" aria-live="polite" data-announce>
      {{ announcement() }}
    </div>

    @if (failure()) {
      <p class="pg-banner pg-banner--danger" role="alert" data-failure>
        <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ failure() }}
      </p>
    }

    <mf-filters-bar [bare]="true" [filters]="filters" [clearAlso]="['q']" />

    @if (phone()) {
      <mf-admin-card-list
        noun="reports"
        label="Reports"
        [items]="rows()"
        [spec]="cardOf"
        emptyText="No reports yet."
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
      <div class="mf-fill">
        <mf-record-grid
          #scroll
          data-reports
          tableId="reports-table"
          label="Reports list"
          caption="Reports, in category and report order"
          noun="reports"
          [grid]="grid"
          [rows]="rows()"
          [rowKey]="reportKey"
          [loadState]="ls.state()"
          [empty]="ls.empty()"
          [filtered]="ls.filtered()"
          [filters]="filters"
          emptyText="No reports yet."
          [hidden]="ls.hidden()"
          hiddenLabel="inactive"
          [actions]="true"
          [rowClass]="rowClass"
          [bones]="bones"
          (retry)="load()"
          (clear)="clear()"
          (showAll)="showAll()"
        >
          @if (filters.rowVisible()) {
            <tr
              mfGridFilterRow
              mfColumnFilterRow
              id="report-filter-row"
              [filters]="filters"
              [columns]="columns()"
            ></tr>
          }
          <p-button mfEmptyAction label="New Report" icon="pi pi-plus" (onClick)="newReport()" />
          <ng-template mfCell="name" let-r>
            <td class="rl-namecell" [attr.data-row]="r.name">
              <a
                class="mf-link pg-clip"
                [routerLink]="['/admin/reports', r.reportId]"
                [mfRowLink]="listId"
                [rowKey]="r.reportId"
                [state]="leave.state()"
                [attr.title]="r.name"
                data-open
                >{{ r.name }}</a
              >
            </td>
          </ng-template>
          <ng-template mfCell="category" let-r>
            <td class="pg-clip" data-category [attr.title]="r.categoryName">
              {{ r.categoryName }}
            </td>
          </ng-template>
          <ng-template mfCell="roles" let-r>
            <td class="pg-num" data-roles>{{ r.roleCount | mfInt }}</td>
          </ng-template>
          <ng-template mfCell="lastRun" let-r>
            <td class="pg-nowrap" data-last-run>
              @if (r.lastRunAtUtc) {
                {{ r.lastRunAtUtc | mfNum: 'date' }}
              } @else {
                <span class="mf-sr-only">Never</span><span aria-hidden="true">-</span>
              }
            </td>
          </ng-template>
          <ng-template mfCell="status" let-r>
            <td><mf-active-badge [active]="r.isActive" /></td>
          </ng-template>
          <ng-template mfCell="actions" let-r>
            <td class="mf-col-actions" [attr.data-actions-of]="r.reportId">
              @if (menus().get(r.reportId); as menu) {
                <mf-action-menu [floating]="true" [label]="menu.label" [items]="menu.items" />
              }
            </td>
          </ng-template>
          <div mfGridFoot>
            <ng-container *ngTemplateOutlet="pager" />
          </div>
        </mf-record-grid>
      </div>
    }

    @if (phone()) {
      <ng-container *ngTemplateOutlet="pager" />
    }
    <ng-template #pager>
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
    </ng-template>

    <mf-confirm-dialog
      title="Deactivate Report"
      confirmLabel="Deactivate Report"
      [danger]="true"
      [busy]="busy()"
      [visible]="deactivating() !== null"
      (visibleChange)="!$event && deactivating.set(null)"
      (confirmed)="confirmDeactivate()"
    >
      <p data-deactivate-body>
        People can no longer see or run {{ deactivating()?.name }}; its versions and history stay,
        and you can activate it again after a preview.
      </p>
    </mf-confirm-dialog>
  `,
  styles: `
    .rl-namecell {
      max-width: 0;
    }
  `,
})
export class ReportsListTab extends LocalListPage<ReportListItemResponse> {
  private readonly api = inject(ReportDefinitionsClient);
  private readonly admin = inject(ReportAdminClient);
  private readonly auth = inject(AuthStore);
  private readonly injector = inject(Injector);
  private readonly report = AdminTabCounts.report('reports');
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly listId = ADMIN_LIST.reports.id;
  protected readonly leave = inject(AdminListLeave);
  protected readonly phone = phoneCards();
  protected readonly roomy = COLUMN_ROOM;
  protected readonly defaultSort = 'category';

  protected readonly categories = signal<ReportCategoryResponse[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly deactivating = signal<ReportListItemResponse | null>(null);

  /** The columns of the shared record grid (D-44a): Name is the spring; the others have fixed widths so the headings never move. */
  protected readonly gridDefs = signal<readonly RecordGridColumn[]>([
    { key: 'name', label: 'Name', locked: true, minWidth: '200px' },
    { key: 'category', label: 'Category', width: '180px', minWidth: '180px' },
    {
      key: 'roles',
      label: 'Roles',
      num: true,
      width: 'var(--mf-col-count-w)',
      minWidth: 'var(--mf-col-count-w)',
    },
    { key: 'lastRun', label: 'Last Run', width: '152px', minWidth: '152px' },
    {
      key: 'status',
      label: 'Status',
      width: 'var(--mf-col-status-w)',
      minWidth: 'var(--mf-col-status-w)',
    },
  ]);
  protected readonly grid = new RecordGridState('admin-reports', this.gridDefs, () =>
    this.roomy() ? [] : ['roles', 'lastRun'],
  );
  protected readonly bones = BONES;
  protected readonly reportKey = (r: ReportListItemResponse): number => r.reportId;
  /** An inactive report keeps the `inactive` hook of its row. */
  protected readonly rowClass = (r: ReportListItemResponse): string | null =>
    r.isActive ? null : 'inactive';
  /** The columns of the table in order, the row action last: what the filter row builds its cells from. */
  protected readonly columns = computed<readonly string[]>(() => [...this.grid.shown(), 'actions']);

  /** Inline column filters, applied here because the list is loaded whole: Name, Category and Status (Active by default). */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'reports',
    noun: 'reports',
    sheetBelow: 640,
    visibleColumns: computed(() => (this.phone() ? null : this.columns())),
    defs: computed((): FilterDef[] => [
      { key: 'name', label: 'Name', column: 'name', type: 'text' },
      {
        key: 'category',
        label: 'Category',
        column: 'category',
        type: 'select',
        allLabel: 'All Categories',
        options: () =>
          this.categories().map((c) => ({
            value: String(c.categoryId),
            label: c.name,
            hint: c.isActive ? undefined : '(inactive)',
          })),
      },
      statusDef(),
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
    AdminShellFilters.register({ filters: this.filters, controls: 'report-filter-row' });
    effect(() => {
      if (this.state() === 'ready') this.report(this.all().filter((r) => r.isActive).length);
    });
    restoreRowFocus(this.listId, () => this.state() === 'ready');
    effect(() => untracked(() => void this.load()));
    effect(() => {
      const area = this.scroll()?.nativeElement;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override matchesFilters(r: ReportListItemResponse): boolean {
    const name = this.filters.text('name').trim().toLowerCase();
    if (name && !r.name.toLowerCase().includes(name)) return false;
    const category = this.filters.text('category');
    return !category || String(r.categoryId) === category;
  }

  protected override searchText(r: ReportListItemResponse): string {
    return `${r.name} ${r.description ?? ''} ${r.categoryName}`;
  }

  protected override isActiveRow(r: ReportListItemResponse): boolean {
    return r.isActive;
  }

  protected override sortValue(r: ReportListItemResponse, field: string): string | number {
    if (field === 'name') return r.name;
    const category = this.categories().find((c) => c.categoryId === r.categoryId)?.sortOrder ?? 0;
    return `${String(category).padStart(7, '0')}|${r.categoryName}|${String(r.sortOrder).padStart(7, '0')}|${r.name}`;
  }

  async load(): Promise<void> {
    if (this.state() === 'error' || this.state() === 'forbidden') this.state.set('loading');
    try {
      const [list, categories] = await Promise.all([
        firstValueFrom(this.api.listAdminReports()),
        firstValueFrom(this.api.listReportCategories()),
      ]);
      this.categories.set(categories);
      this.all.set(list.items);
      this.state.set('ready');
      this.filters.reportResults(this.total());
    } catch (error) {
      this.state.set(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error');
    }
  }

  // ---- the row menu and the phone cards

  protected readonly menus = computed(() => {
    const map = new Map<number, ReturnType<typeof rowActions>>();
    for (const r of this.matching()) {
      map.set(
        r.reportId,
        rowActions(
          r.name,
          [
            {
              id: 'edit',
              label: 'Edit',
              icon: 'pi-pencil',
              permission: 'Report.Manage',
              run: () => void this.open(r),
            },
            {
              id: 'roles',
              label: 'Roles',
              icon: 'pi-users',
              permission: 'Report.Assign',
              run: () => void this.open(r, 'roles'),
            },
            {
              id: 'history',
              label: 'History',
              icon: 'pi-history',
              permission: 'Report.Manage',
              run: () => void this.open(r, 'history'),
            },
            r.isActive
              ? {
                  id: 'deactivate',
                  label: 'Deactivate',
                  kind: 'state' as const,
                  permission: 'Report.Manage',
                  run: () => this.deactivating.set(r),
                }
              : {
                  id: 'activate',
                  label: 'Activate',
                  kind: 'state' as const,
                  permission: 'Report.Manage',
                  reason: r.previewed ? undefined : 'Preview the current version first.',
                  run: () => void this.activate(r),
                },
          ],
          { can: (permission) => this.auth.has(permission) },
        ),
      );
    }
    return map;
  });

  protected readonly cardOf = (r: ReportListItemResponse): AdminCardSpec => ({
    title: r.name,
    link: ['/admin/reports', r.reportId],
    rowKey: r.reportId,
    state: this.leave.state(),
    badges: [activeCardBadge(r.isActive)],
    meta: [r.categoryName, r.roleCount === 1 ? '1 role' : `${r.roleCount} roles`],
    actions: this.menus().get(r.reportId) ?? null,
  });

  /** The empty list's own New button (the same action as the page header's, spec 15.3). */
  protected newReport(): void {
    void this.router.navigate(['/admin/reports/new'], { state: this.leave.state() });
  }

  private open(r: ReportListItemResponse, tab?: string): Promise<boolean> {
    return this.router.navigate(['/admin/reports', r.reportId], {
      queryParams: tab ? { tab } : undefined,
      state: this.leave.state(),
    });
  }

  // ---- activate, deactivate

  protected async confirmDeactivate(): Promise<void> {
    const r = this.deactivating();
    if (!r) return;
    this.deactivating.set(null);
    await this.change(r, false);
  }

  private async activate(r: ReportListItemResponse): Promise<void> {
    await this.change(r, true);
  }

  private async change(r: ReportListItemResponse, active: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await firstValueFrom(
        active ? this.admin.activateReport(r.reportId) : this.admin.deactivateReport(r.reportId),
      );
      this.announcement.set(`${r.name} ${active ? 'activated' : 'deactivated'}.`);
      await this.load();
      afterNextRender(
        () =>
          document
            .querySelector<HTMLElement>(`[data-actions-of="${r.reportId}"] button[data-overflow]`)
            ?.focus(),
        { injector: this.injector },
      );
    } catch (e) {
      this.failure.set(
        e instanceof ApiError ? e.message : 'Couldn’t change the report. Try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
