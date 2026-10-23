import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ReportDefinitionsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import { MfTab } from '../../../shared/ui/tabs';
import { AdminTabCounts, adminTabItems, resolveAdminTab } from '../admin-tabs';
import { AdminListLeave } from '../list-return';
import { AdminShellFilters } from '../task-types/shell-filters';
import { ReportCategoriesTab } from './report-categories-tab';
import { ReportMatrixTab } from './report-matrix-tab';
import { ReportRunsTab } from './report-runs-tab';
import { REPORT_TABS, REPORT_TAB_TEXT, ReportAdminTab } from './report-tabs';
import { ReportsHealthTab } from './reports-health-tab';
import { ReportsListTab } from './reports-list-tab';

/**
 * Administration: Reports (issue #712), reached from the "Reports" item of the Administration menu. One page on the admin list shell with the
 * tabs Reports (n), Categories (n), Run log, Assignments (with Report.Assign) and Settings, kept in the address as `?tab=`. The header holds the
 * crumb, the one-line description, Filters (the Reports tab's) and the primary action, New report (or New category on the Categories tab).
 * Needs `Report.Manage`; every tab is a lazy part of this one chunk, and nothing of it is in the first page load.
 */
@Component({
  selector: 'mf-reports-admin-page',
  imports: [
    AdminListShell,
    Button,
    ReportCategoriesTab,
    ReportMatrixTab,
    ReportRunsTab,
    ReportsHealthTab,
    ReportsListTab,
  ],
  providers: [AdminShellFilters, AdminTabCounts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Reports"
      icon="pi pi-chart-bar"
      [description]="description()"
      [tabs]="tabs()"
      [tab]="current()"
      tabsLabel="Reports sections"
      idPrefix="reports-admin"
      [filters]="current() === 'reports' ? (shell.current()?.filters ?? null) : null"
      [controls]="shell.current()?.controls ?? ''"
      [clearAlso]="['q']"
      [tableId]="tableId()"
      (tabChange)="select($event)"
    >
      @if (current() === 'reports') {
        <p-button mfPrimary label="New report" icon="pi pi-plus" data-new (onClick)="newReport()" />
      }
      @if (current() === 'categories') {
        <p-button
          mfPrimary
          label="New category"
          icon="pi pi-plus"
          data-new-category
          (onClick)="newCategory()"
        />
      }
      @switch (current()) {
        @case ('reports') {
          <mf-reports-list-tab
            [status]="status()"
            [page]="page()"
            [size]="size()"
            [sort]="sort()"
          />
        }
        @case ('categories') {
          <mf-report-categories-tab #categories />
        }
        @case ('runs') {
          <mf-report-runs-tab />
        }
        @case ('assignments') {
          <mf-report-matrix-tab />
        }
        @default {
          <mf-reports-health-tab />
        }
      }
    </mf-admin-list-shell>
  `,
})
export class ReportsAdminPage implements HasUnsavedChanges {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly listLeave = inject(AdminListLeave);
  private readonly counts = inject(AdminTabCounts);
  private readonly api = inject(ReportDefinitionsClient);
  protected readonly shell = inject(AdminShellFilters);
  private readonly categories = viewChild<ReportCategoriesTab>('categories');

  /** The `tab` query parameter, and the list state the Reports tab keeps in the address. */
  readonly tab = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();

  private readonly can = (permission: string) => this.auth.has(permission);

  protected readonly tabs = computed<MfTab[]>(() =>
    adminTabItems(REPORT_TABS, this.can, this.counts.snapshot()),
  );
  protected readonly current = computed<ReportAdminTab>(
    () => (resolveAdminTab(REPORT_TABS, this.tab(), this.can)?.id as ReportAdminTab) ?? 'reports',
  );
  protected readonly description = computed(() => REPORT_TAB_TEXT[this.current()]);
  protected readonly tableId = computed(() =>
    this.current() === 'reports'
      ? 'reports-table'
      : this.current() === 'categories'
        ? 'categories-table'
        : this.current() === 'runs'
          ? 'runs-table'
          : '',
  );

  constructor() {
    void this.counts.start(
      REPORT_TABS,
      {
        reports: () =>
          firstValueFrom(this.api.listAdminReports()).then(
            (r) => r.items.filter((i) => i.isActive).length,
          ),
        categories: () =>
          firstValueFrom(this.api.listReportCategories()).then(
            (c) => c.filter((x) => x.isActive).length,
          ),
      },
      this.can,
    );
  }

  hasUnsavedChanges(): boolean {
    return this.categories()?.hasUnsavedChanges() ?? false;
  }

  protected newReport(): void {
    void this.router.navigate(['/admin/reports/new'], { state: this.listLeave.state() });
  }

  protected newCategory(): void {
    this.categories()?.startNew();
  }

  protected async select(key: string): Promise<void> {
    await this.router.navigate([], {
      queryParams: {
        tab: key === 'reports' ? null : key,
        status: null,
        page: null,
        size: null,
        sort: null,
        name: null,
        category: null,
      },
      queryParamsHandling: 'merge',
    });
  }
}
