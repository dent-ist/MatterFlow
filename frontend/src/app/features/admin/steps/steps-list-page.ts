import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { StepDefinitionSummary, StepDefinitionsClient } from '../../../api/generated/api-client';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ListState, SortHeader, StatusFilter } from '../../../shared/ui/data-table';
import { isActiveParam } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';
import { SearchBox } from '../../../shared/ui/search-box';

/**
 * Admin: Step Library list (UX S15). Search by title or description, status filter (Active by default), sortable, server paged; state
 * lives in the URL. Each row opens the step editor. Needs `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-steps-list-page',
  imports: [
    PageHeader,
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
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header
      heading="Step library"
      description="Reusable steps. Workflows copy a step when they are published, so editing a step here never changes a published workflow."
    >
      <p-button mfActions label="New step" icon="pi pi-plus" (onClick)="go('/admin/steps/new')" />
    </mf-page-header>

    <div class="pg-filters" role="search">
      <mf-search-box
        inputId="step-search"
        placeholder="Title or description"
        [value]="q() ?? ''"
        (searchChange)="search($event)"
      />
      <mf-status-filter
        inputId="step-status"
        [value]="statusFilter()"
        (valueChange)="setStatus($event)"
      />
    </div>

    <mf-list-state
      noun="steps"
      emptyText="No steps yet. Add the first reusable step."
      [state]="state()"
      [empty]="rows().length === 0"
      [filtered]="hasFilter()"
      [columns]="4"
      (retry)="load()"
      (clear)="clear()"
    >
      <p-button mfEmptyAction label="New step" (onClick)="go('/admin/steps/new')" />
      <div class="mf-table-wrap">
        <table class="pg-table" data-steps>
          <caption class="pg-sr">
            Step library
          </caption>
          <thead>
            <tr>
              <th
                mfSort="title"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Title
              </th>
              <th scope="col">Description</th>
              <th
                mfSort="usedInVersions"
                [sort]="sort()"
                [defaultSort]="defaultSort"
                (sorted)="setSort($event)"
              >
                Used in workflows
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (s of rows(); track s.stepDefinitionId) {
              <tr [attr.data-row]="s.title">
                <td>
                  <a class="pg-link" [routerLink]="['/admin/steps', s.stepDefinitionId]">{{
                    s.title
                  }}</a>
                </td>
                <td>{{ s.description }}</td>
                <td>{{ usage(s) }}</td>
                <td>
                  <mf-active-badge [active]="s.isActive" />
                </td>
              </tr>
            }
          </tbody>
        </table>
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
  `,
})
export class StepsListPage extends ServerListPage<StepDefinitionSummary> {
  private readonly api = inject(StepDefinitionsClient);

  protected readonly defaultSort = 'title';

  protected usage(step: StepDefinitionSummary): string {
    if (step.usedInVersions === 0) return 'Not used';
    return step.usedInVersions === 1 ? '1 version' : `${step.usedInVersions} versions`;
  }

  protected override fetch() {
    return firstValueFrom(
      this.api.listStepDefinitions(
        this.sort() || undefined,
        this.q()?.trim() || undefined,
        isActiveParam(this.statusFilter()),
        this.pageNumber(),
        this.pageSize(),
      ),
    );
  }
}
