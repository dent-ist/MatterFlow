import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { AuthStore } from '../../../core/auth/auth.store';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import { Crumb } from '../../../shared/ui/page-header';
import { MfTab } from '../../../shared/ui/tabs';
import { firstAllowedTab } from '../denial';
import { StepsListPage } from '../steps/steps-list-page';
import { WorkflowsListPage } from '../workflows/workflows-list-page';
import { TaskTypesPage } from './task-types-page';
import { adminTabItems } from '../admin-tabs';
import { AdminCounts, TASK_TYPES_TABS } from './admin-counts';
import { AdminShellFilters } from './shell-filters';

export type TaskTypesTab = 'task-types' | 'workflows' | 'steps';

/** One line per tab, 90 characters at most (#363): it must fit the header's single line at 1366 without an ellipsis. */
export const TAB_TEXT: Record<TaskTypesTab, string> = {
  'task-types': 'What people can request: a request form and its eligible workflows.',
  workflows: 'Ordered steps a request follows, with versions you publish.',
  steps: 'The reusable steps and inputs that workflows are built from.',
};

/**
 * Administration: Task Types. One menu item, one page, three tabs that follow the model Task Type -> eligible Workflows (one default)
 * -> Steps (a shared library): Task Types (`TaskType.Manage`), Workflows and Workflow Steps (`Workflow.Manage`). `/admin/task-types`,
 * `/admin/workflows` and `/admin/steps` open the matching tab (route-based, like Users and Roles); the create/edit pages keep their
 * own URLs. A tab the person may not use is not offered, and a link to it lands on the first one they may use. The list state
 * (search, tag filter, status, sort, paging) is kept in the address and handed to the open tab, which cannot read the route inputs
 * itself; the cross-link filters (`taskType`, `workflow`, `step`) are read from the address by the tab that owns them.
 */
@Component({
  selector: 'mf-task-types-admin-page',
  imports: [AdminListShell, Button, TaskTypesPage, WorkflowsListPage, StepsListPage],
  providers: [AdminShellFilters, AdminCounts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Task Types"
      [crumbs]="crumbs()"
      [description]="description()"
      [tabs]="tabs()"
      [tab]="current()"
      tabsLabel="Task types, workflows and workflow steps"
      idPrefix="task-types-admin"
      [filters]="shell.current()?.filters ?? null"
      [controls]="shell.current()?.controls ?? ''"
      [clearAlso]="['q']"
      (tabChange)="select($event)"
    >
      @switch (current()) {
        @case ('task-types') {
          <p-button
            mfPrimary
            label="New task type"
            icon="pi pi-plus"
            data-new
            (onClick)="go('/admin/task-types/new')"
          />
        }
        @case ('workflows') {
          <p-button
            mfPrimary
            label="New workflow"
            icon="pi pi-plus"
            (onClick)="go('/admin/workflows/new')"
          />
        }
        @case ('steps') {
          <p-button
            mfPrimary
            label="New step"
            icon="pi pi-plus"
            (onClick)="go('/admin/steps/new')"
          />
        }
      }
      @switch (current()) {
        @case ('task-types') {
          <mf-task-types-page [status]="status()" [page]="page()" [size]="size()" [sort]="sort()" />
        }
        @case ('workflows') {
          <mf-workflows-list-page
            [status]="status()"
            [page]="page()"
            [size]="size()"
            [sort]="sort()"
          />
        }
        @case ('steps') {
          <mf-steps-list-page [status]="status()" [page]="page()" [size]="size()" [sort]="sort()" />
        }
      }
    </mf-admin-list-shell>
  `,
})
export class TaskTypesAdminPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly shell = inject(AdminShellFilters);
  private readonly counts = inject(AdminCounts);

  /** The `:tab` path segment (`task-types`, `workflows` or `steps`). */
  readonly tab = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();

  /** Only the tabs the person may use, in the order of the model: `Task Types (61)` (the active records, `--` while the count is on its way). */
  protected readonly tabs = computed<MfTab[]>(() =>
    adminTabItems(TASK_TYPES_TABS, (p) => this.auth.has(p), this.counts.snapshot()),
  );

  protected readonly current = computed<TaskTypesTab>(() => {
    const keys = this.tabs().map((t) => t.key as TaskTypesTab);
    return firstAllowedTab<TaskTypesTab>(this.tab(), keys, 'task-types');
  });

  protected readonly description = computed(() => TAB_TEXT[this.current()]);

  /** `Administration > Task Types`, then the tab name for the second and third tab. */
  protected readonly crumbs = computed<Crumb[]>(() => {
    const root = { label: 'Administration' };
    switch (this.current()) {
      case 'workflows':
        return [root, { label: 'Task Types', link: '/admin/task-types' }, { label: 'Workflows' }];
      case 'steps':
        return [
          root,
          { label: 'Task Types', link: '/admin/task-types' },
          { label: 'Workflow Steps' },
        ];
      default:
        return [root, { label: 'Task Types' }];
    }
  });

  constructor() {
    void this.counts.load();
    // A link to a tab the person may not use is replaced by the first one they may (Workflow.Manage only: the Workflows tab).
    effect(() => {
      const current = this.current();
      const raw = this.tab();
      if (raw && raw !== current) {
        void this.router.navigate(['/admin', current], { replaceUrl: true });
      }
    });
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  protected select(key: string): void {
    void this.router.navigate(['/admin', key]);
  }
}
