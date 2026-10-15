import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Crumb, PageHeader } from '../../../shared/ui/page-header';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { StepsListPage } from '../steps/steps-list-page';
import { WorkflowsListPage } from './workflows-list-page';

type WorkflowsTab = 'workflows' | 'steps';

const WORKFLOWS_TEXT =
  'A workflow is an ordered or unordered list of steps. Tasks run on a published version; edit by creating a new draft.';
const STEPS_TEXT =
  'Reusable steps. Workflows copy a step when they are published, so editing a step here never changes a published workflow.';

/**
 * Administration: Workflows. One menu item, one page, two tabs: Workflows (the workflow list) and Workflow Steps (the step library with
 * its tags). `/admin/workflows` and `/admin/steps` open the matching tab (route-based, like Users and Roles); the step and workflow
 * create/edit pages keep their own URLs. Both tabs need `Workflow.Manage` (route guard). The list state (search, tag filter, status,
 * sort, paging) is kept in the address and handed to the open tab, which cannot read the route inputs itself.
 */
@Component({
  selector: 'mf-workflows-admin-page',
  imports: [FixedPage, PageHeader, Tabs, Button, WorkflowsListPage, StepsListPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="Workflows"
        [crumbs]="crumbs()"
        [description]="current() === 'steps' ? stepsText : workflowsText"
      >
        @if (current() === 'steps') {
          <p-button
            mfActions
            label="New step"
            icon="pi pi-plus"
            (onClick)="go('/admin/steps/new')"
          />
        } @else {
          <p-button
            mfActions
            label="New workflow"
            icon="pi pi-plus"
            (onClick)="go('/admin/workflows/new')"
          />
        }
      </mf-page-header>
      <mf-tabs
        label="Workflows and workflow steps"
        idPrefix="workflows-admin"
        [tabs]="tabs"
        [selected]="current()"
        (tabChange)="select($event)"
      />
      <div
        class="mf-fill"
        role="tabpanel"
        id="workflows-admin-panel"
        [attr.aria-labelledby]="'workflows-admin-tab-' + current()"
      >
        @if (current() === 'steps') {
          <mf-steps-list-page
            [q]="q()"
            [status]="status()"
            [page]="page()"
            [size]="size()"
            [sort]="sort()"
            [tags]="tags()"
            [tagMatch]="tagMatch()"
          />
        } @else {
          <mf-workflows-list-page
            [q]="q()"
            [status]="status()"
            [page]="page()"
            [size]="size()"
            [sort]="sort()"
          />
        }
      </div>
    </mf-fixed-page>
  `,
})
export class WorkflowsAdminPage {
  private readonly router = inject(Router);

  /** The `:tab` path segment (`workflows` or `steps`). */
  readonly tab = input<string>();
  readonly q = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();
  readonly tags = input<string | readonly string[] | null>();
  readonly tagMatch = input<string>();

  protected readonly workflowsText = WORKFLOWS_TEXT;
  protected readonly stepsText = STEPS_TEXT;
  protected readonly tabs: MfTab[] = [
    { key: 'workflows', label: 'Workflows' },
    { key: 'steps', label: 'Workflow Steps' },
  ];
  protected readonly current = computed<WorkflowsTab>(() =>
    this.tab() === 'steps' ? 'steps' : 'workflows',
  );
  /** `Administration > Workflows` and, on the steps tab, `Administration > Workflows > Workflow Steps`. */
  protected readonly crumbs = computed<Crumb[]>(() =>
    this.current() === 'steps'
      ? [
          { label: 'Administration' },
          { label: 'Workflows', link: '/admin/workflows' },
          { label: 'Workflow Steps' },
        ]
      : [{ label: 'Administration' }, { label: 'Workflows' }],
  );

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  protected select(key: string): void {
    void this.router.navigate(['/admin', key]);
  }
}
