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
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { AdminCardList, AdminCardSpec, activeCardBadge } from '../../../shared/ui/admin-card-spec';
import { AdminColumn, adminListState } from '../../../shared/ui/admin-list-state';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { LocalListPage } from '../../../shared/ui/list-query';
import { Pager } from '../../../shared/ui/pager';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { rowActions } from '../../../shared/ui/row-actions';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { AdminTabCounts } from '../admin-tabs';
import { ADMIN_LIST, AdminListLeave } from '../list-return';
import { AdminShellFilters } from '../task-types/shell-filters';

type Column = 'name' | 'category' | 'roles' | 'lastRun' | 'status' | 'actions';

const COLUMN_SPEC: Record<Column, AdminColumn> = {
  name: { cls: 'mf-cell-name', bone: '14rem' },
  category: { cls: 'mf-cell-badge', bone: '8rem' },
  roles: { cls: 'mf-cell-num', bone: '1.5rem' },
  lastRun: { cls: 'mf-cell-badge', bone: '6rem' },
  status: { cls: 'mf-cell-badge', bone: '4rem' },
  actions: { cls: 'mf-cell-actions', bone: '1.5rem' },
};

/** The Roles and Last run columns leave below this window width (the kit's column-drop rule); the name, category and status stay. */
const ROOM = 1000;

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
    ActionMenu,
    ActiveBadge,
    AdminCardList,
    ColumnFilterRow,
    ConfirmDialog,
    FiltersBar,
    GridBody,
    MfDatePipe,
    Pager,
    RouterLink,
    RowLink,
    ScrollArea,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  template: `
    <div class="mf-sr-only" role="status" aria-live="polite" data-announce>
      {{ announcement() }}
    </div>

    @if (failure()) {
      <p class="rl-failure" role="alert" data-failure>
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
        emptyText="No reports yet. Use New report above to add the first one."
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
      <div class="mf-table-wrap" mfScrollArea="Reports list" #scroll>
        <div class="mf-scroll">
          <table class="mf-grid" id="reports-table" data-reports>
            <caption class="mf-sr-only">
              Reports, in category and report order
            </caption>
            <thead>
              <tr>
                <th class="mf-cell-name" scope="col">Name</th>
                <th class="mf-cell-badge" scope="col">Category</th>
                @if (roomy()) {
                  <th class="mf-cell-num" scope="col">Roles</th>
                  <th class="mf-cell-badge" scope="col">Last run</th>
                }
                <th class="mf-cell-badge" scope="col">Status</th>
                <th class="mf-cell-actions" scope="col"><span class="mf-sr-only">Actions</span></th>
              </tr>
              @if (filters.rowVisible()) {
                <tr
                  mfColumnFilterRow
                  id="report-filter-row"
                  [filters]="filters"
                  [columns]="columns()"
                ></tr>
              }
            </thead>
            <tbody
              mfGridBody
              noun="reports"
              [columnSpec]="columnSpec()"
              [filters]="filters"
              emptyText="No reports yet. Use New report above to add the first one."
              [state]="ls.state()"
              [empty]="ls.empty()"
              [filtered]="ls.filtered()"
              [hidden]="ls.hidden()"
              hiddenLabel="inactive"
              (retry)="load()"
              (clear)="clear()"
              (showAll)="showAll()"
            >
              @for (r of rows(); track r.reportId) {
                <tr [attr.data-row]="r.name" [class.inactive]="!r.isActive">
                  <td class="mf-cell-name">
                    <a
                      class="mf-name"
                      [routerLink]="['/admin/reports', r.reportId]"
                      [mfRowLink]="listId"
                      [rowKey]="r.reportId"
                      [state]="leave.state()"
                      [attr.title]="r.name"
                      data-open
                      >{{ r.name }}</a
                    >
                  </td>
                  <td class="mf-cell-badge" data-category>{{ r.categoryName }}</td>
                  @if (roomy()) {
                    <td class="mf-cell-num" data-roles>{{ r.roleCount }}</td>
                    <td class="mf-cell-badge" data-last-run>
                      @if (r.lastRunAtUtc) {
                        {{ r.lastRunAtUtc | mfDate: 'date' }}
                      } @else {
                        <span class="mf-sr-only">Never</span><span aria-hidden="true">-</span>
                      }
                    </td>
                  }
                  <td class="mf-cell-badge"><mf-active-badge [active]="r.isActive" /></td>
                  <td class="mf-cell-actions" [attr.data-actions-of]="r.reportId">
                    @if (menus().get(r.reportId); as menu) {
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
      title="Deactivate this report?"
      confirmLabel="Deactivate"
      cancelLabel="Cancel"
      [danger]="true"
      [busy]="busy()"
      [visible]="deactivating() !== null"
      (visibleChange)="!$event && deactivating.set(null)"
      (confirmed)="confirmDeactivate()"
    >
      <p data-deactivate-body>
        People can no longer see or run {{ deactivating()?.name }}. Its versions, history and role
        assignments stay, and you can activate it again after a preview.
      </p>
    </mf-confirm-dialog>
  `,
  styles: `
    .rl-failure {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
      margin: var(--mf-s2) 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
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
  protected readonly roomy = viewportAtLeast(ROOM);
  protected readonly defaultSort = 'category';

  protected readonly categories = signal<ReportCategoryResponse[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly deactivating = signal<ReportListItemResponse | null>(null);

  protected readonly columns = computed<readonly Column[]>(() => [
    'name',
    'category',
    ...(this.roomy() ? (['roles', 'lastRun'] as const) : []),
    'status',
    'actions',
  ]);
  protected readonly columnSpec = computed<readonly AdminColumn[]>(() =>
    this.columns().map((c) => COLUMN_SPEC[c]),
  );

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
        allLabel: 'All categories',
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
