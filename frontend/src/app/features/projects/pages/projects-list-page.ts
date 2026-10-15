import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ProjectResponse, ProjectsClient } from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ListState, SortHeader, StatusFilter } from '../../../shared/ui/data-table';
import { isActiveParam } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';
import { SearchBox } from '../../../shared/ui/search-box';

/** Global Projects list (UX S07): search by name or matter reference, status filter (Active by default), optional matter filter. */
@Component({
  selector: 'mf-projects-list-page',
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    ActiveBadge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    MatterRef,
    SearchBox,
    StatusFilter,
    SortHeader,
    ListState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Projects">
        <p-button
          mfActions
          *mfHasPermission="'Project.Create'"
          label="New project"
          icon="pi pi-plus"
          (onClick)="go('/projects/new' + (matterId() ? '?matterId=' + matterId() : ''))"
        />
      </mf-page-header>

      <div class="pg-filters" role="search">
        <mf-search-box
          inputId="project-search"
          placeholder="Project name or 343-12"
          [value]="q() ?? ''"
          (searchChange)="search($event)"
        />
        <mf-status-filter
          inputId="project-status"
          inactiveLabel="Archived"
          [value]="statusFilter()"
          (valueChange)="setStatus($event)"
        />
        @if (matterId()) {
          <div class="pg-filter">
            <span class="pg-label">Matter</span>
            <span data-matter-chip>
              {{ matterChip() }}
              <button type="button" (click)="clearMatter()" aria-label="Remove matter filter">
                Remove
              </button>
            </span>
          </div>
        }
      </div>

      <mf-list-state
        noun="projects"
        [state]="state()"
        [empty]="rows().length === 0"
        [filtered]="hasFilter()"
        [columns]="3"
        (retry)="load()"
        (clear)="clear()"
      >
        <div class="mf-table-wrap" mfScrollArea="Projects list">
          <div class="mf-scroll">
            <table class="pg-table">
              <caption class="pg-sr">
                Projects
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
                  <th
                    mfSort="matterRef"
                    [sort]="sort()"
                    [defaultSort]="defaultSort"
                    (sorted)="setSort($event)"
                  >
                    Matter
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (p of rows(); track p.projectId) {
                  <tr>
                    <td>
                      <a class="pg-link" [routerLink]="['/projects', p.projectId]">{{ p.name }}</a>
                    </td>
                    <td>
                      <mf-matter-ref [value]="p.matterRef" [link]="['/matters', p.matterId]" />
                    </td>
                    <td>
                      <mf-active-badge [active]="p.isActive" inactiveLabel="Archived" />
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
export class ProjectsListPage extends ServerListPage<ProjectResponse> {
  /** Query parameter `matterId` (bound by the router). */
  readonly matterId = input<string>();

  private readonly api = inject(ProjectsClient);

  protected readonly defaultSort = 'name';

  protected readonly matterChip = computed(() => {
    const first = this.rows()[0];
    return first && String(first.matterId) === this.matterId()
      ? `${first.matterRef} ${first.matterName}`
      : `Matter ${this.matterId()}`;
  });

  protected override extraFilters() {
    return { matterId: this.matterId() };
  }

  protected override watch(): void {
    this.matterId();
  }

  protected override fetch() {
    const matterId = Number(this.matterId());
    return firstValueFrom(
      this.api.listProjects(
        this.q()?.trim() || undefined,
        Number.isInteger(matterId) && matterId > 0 ? matterId : undefined,
        isActiveParam(this.statusFilter()),
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }

  protected clearMatter(): void {
    this.navigate({ matterId: null, page: null });
  }
}
