import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { AuthStore } from '../../../core/auth/auth.store';
import { Crumb, PageHeader } from '../../../shared/ui/page-header';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { StepsListPage } from '../steps/steps-list-page';
import { WorkflowsListPage } from '../workflows/workflows-list-page';
import { TaskTypesPage } from './task-types-page';

type TaskTypesTab = 'task-types' | 'workflows' | 'steps';

const TEXT: Record<TaskTypesTab, string> = {
  'task-types':
    'What people can request. Each type has a request form and the workflows it may use, one of them the default. Types are deactivated, never deleted.',
  workflows:
    'A workflow is an ordered or unordered list of steps. Tasks run on a published version; edit by creating a new draft.',
  steps:
    'Reusable steps. Workflows copy a step when they are published, so editing a step here never changes a published workflow.',
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
  imports: [FixedPage, PageHeader, Tabs, Button, TaskTypesPage, WorkflowsListPage, StepsListPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Task Types" [crumbs]="crumbs()" [description]="description()">
        @switch (current()) {
          @case ('task-types') {
            <p-button
              mfActions
              label="New task type"
              icon="pi pi-plus"
              data-new
              (onClick)="go('/admin/task-types/new')"
            />
          }
          @case ('workflows') {
            <p-button
              mfActions
              label="New workflow"
              icon="pi pi-plus"
              (onClick)="go('/admin/workflows/new')"
            />
          }
          @case ('steps') {
            <p-button
              mfActions
              label="New step"
              icon="pi pi-plus"
              (onClick)="go('/admin/steps/new')"
            />
          }
        }
      </mf-page-header>
      <mf-tabs
        label="Task types, workflows and workflow steps"
        idPrefix="task-types-admin"
        [tabs]="tabs()"
        [selected]="current()"
        (tabChange)="select($event)"
      />
      <div
        class="mf-fill"
        role="tabpanel"
        id="task-types-admin-panel"
        [attr.aria-labelledby]="'task-types-admin-tab-' + current()"
      >
        @switch (current()) {
          @case ('task-types') {
            <mf-task-types-page
              [status]="status()"
              [page]="page()"
              [size]="size()"
              [sort]="sort()"
            />
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
            <mf-steps-list-page
              [status]="status()"
              [page]="page()"
              [size]="size()"
              [sort]="sort()"
            />
          }
        }
      </div>
    </mf-fixed-page>
  `,
})
export class TaskTypesAdminPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  /** The `:tab` path segment (`task-types`, `workflows` or `steps`). */
  readonly tab = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();

  /** Only the tabs the person may use, in the order of the model. */
  protected readonly tabs = computed<MfTab[]>(() => {
    const tabs: MfTab[] = [];
    if (this.auth.has('TaskType.Manage')) tabs.push({ key: 'task-types', label: 'Task Types' });
    if (this.auth.has('Workflow.Manage')) {
      tabs.push(
        { key: 'workflows', label: 'Workflows' },
        { key: 'steps', label: 'Workflow Steps' },
      );
    }
    return tabs;
  });

  protected readonly current = computed<TaskTypesTab>(() => {
    const raw = this.tab();
    const wanted: TaskTypesTab = raw === 'workflows' || raw === 'steps' ? raw : 'task-types';
    const keys = this.tabs().map((t) => t.key);
    return (keys.includes(wanted) ? wanted : (keys[0] ?? wanted)) as TaskTypesTab;
  });

  protected readonly description = computed(() => TEXT[this.current()]);

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
