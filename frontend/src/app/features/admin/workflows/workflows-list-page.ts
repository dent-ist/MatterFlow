import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { WorkflowSummary, WorkflowsClient } from '../../../api/generated/api-client';
import { ActiveBadge, Badge } from '../../../shared/ui/badge';
import { ListState, SortHeader, StatusFilter } from '../../../shared/ui/data-table';
import { isActiveParam } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';
import { SearchBox } from '../../../shared/ui/search-box';

/**
 * Admin: Workflows list (UX S16). Search by name, status filter (Active by default), sortable by name, server paged; state lives in the
 * URL. Each row shows the latest published version and any draft in progress. Needs `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-workflows-list-page',
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    Badge,
    ActiveBadge,
    RouterLink,
    Button,
    Pager,
    SearchBox,
    StatusFilter,
    SortHeader,
    ListState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', './workflows.scss'],
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="Workflows"
        description="A workflow is an ordered or unordered list of steps. Tasks run on a published version; edit by creating a new draft."
      >
        <p-button
          mfActions
          label="New workflow"
          icon="pi pi-plus"
          (onClick)="go('/admin/workflows/new')"
        />
      </mf-page-header>

      <div class="pg-filters" role="search">
        <mf-search-box
          inputId="wf-search"
          placeholder="Workflow name"
          [value]="q() ?? ''"
          (searchChange)="search($event)"
        />
        <mf-status-filter
          inputId="wf-status"
          [value]="statusFilter()"
          (valueChange)="setStatus($event)"
        />
      </div>

      <mf-list-state
        noun="workflows"
        emptyText="No workflows yet. Create the first workflow."
        [state]="state()"
        [empty]="rows().length === 0"
        [filtered]="hasFilter()"
        [columns]="4"
        (retry)="load()"
        (clear)="clear()"
      >
        <p-button mfEmptyAction label="New workflow" (onClick)="go('/admin/workflows/new')" />
        <div class="mf-table-wrap" mfScrollArea="Workflows list">
          <div class="mf-scroll">
            <table class="pg-table" data-workflows>
              <caption class="pg-sr">
                Workflows
              </caption>
              <thead>
                <tr>
                  <th
                    mfSort="name"
                    [sort]="sort()"
                    [defaultSort]="defaultSort"
                    (sorted)="setSort($event)"
                  >
                    Name
                  </th>
                  <th scope="col">Latest published</th>
                  <th scope="col">Draft</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (w of rows(); track w.workflowDefinitionId) {
                  <tr [attr.data-row]="w.name">
                    <td>
                      <a
                        class="pg-link"
                        [routerLink]="['/admin/workflows', w.workflowDefinitionId]"
                        >{{ w.name }}</a
                      >
                      @if (w.description) {
                        <div class="pg-muted">{{ w.description }}</div>
                      }
                    </td>
                    <td>
                      @if (w.publishedVersionNo) {
                        <mf-badge tone="success" icon="pi-check-circle">Published</mf-badge>
                        v{{ w.publishedVersionNo }} ({{ stepsLabel(w.publishedStepCount) }})
                      } @else {
                        <span class="pg-muted">Not published</span>
                      }
                    </td>
                    <td>
                      @if (w.draftVersionNo) {
                        <mf-badge tone="warning" icon="pi-pencil">Draft</mf-badge>
                        v{{ w.draftVersionNo }}
                      } @else {
                        <span class="pg-muted">None</span>
                      }
                    </td>
                    <td>
                      <mf-active-badge [active]="w.isActive" />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        <mf-pager
          [page]="pageNumber()"
          [pageSize]="pageSize()"
          [pageSizes]="pageSizes"
          [total]="total()"
          (pageChange)="goToPage($event)"
          (pageSizeChange)="setPageSize($event)"
        />
      </mf-list-state>
    </mf-fixed-page>
  `,
})
export class WorkflowsListPage extends ServerListPage<WorkflowSummary> {
  private readonly api = inject(WorkflowsClient);

  protected readonly defaultSort = 'name';

  protected stepsLabel(count: number | undefined): string {
    return count === 1 ? '1 step' : `${count ?? 0} steps`;
  }

  protected override fetch() {
    return firstValueFrom(
      this.api.listWorkflows(
        this.sort() || undefined,
        this.q()?.trim() || undefined,
        isActiveParam(this.statusFilter()),
        this.pageNumber(),
        this.pageSize(),
      ),
    );
  }
}
