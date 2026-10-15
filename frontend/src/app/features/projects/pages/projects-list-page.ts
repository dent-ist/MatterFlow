import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ProjectResponse, ProjectsClient } from '../../../api/generated/api-client';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { ARCHIVE_STATUS_OPTIONS, statusDef } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['name', 'matter', 'status'] as const;

/**
 * Global Projects list (UX S07): inline column filters (Name, Matter reference or name, Status with Active by default); a link from a
 * Matter keeps `?matterId=` as a removable chip. State lives in the URL.
 */
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
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
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
          (onClick)="go(newProjectUrl())"
        />
      </mf-page-header>

      <mf-filters-bar [filters]="filters" controls="project-filter-row" [clearAlso]="['q']" />

      <div class="mf-fill">
        <div class="mf-table-wrap" mfScrollArea="Projects list" #scroll>
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
                @if (filters.rowVisible()) {
                  <tr
                    mfColumnFilterRow
                    id="project-filter-row"
                    [filters]="filters"
                    [columns]="columns"
                  ></tr>
                }
              </thead>
              <tbody
                mfGridBody
                noun="projects"
                [state]="state()"
                [empty]="rows().length === 0"
                [filtered]="filters.activeCount() > 0"
                [columns]="3"
                (retry)="load()"
                (clear)="clear()"
              >
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
    </mf-fixed-page>
  `,
})
export class ProjectsListPage extends ServerListPage<ProjectResponse> {
  private readonly api = inject(ProjectsClient);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly defaultSort = 'name';
  protected readonly columns = COLUMNS;

  protected readonly matterChip = computed(() => {
    const first = this.rows()[0];
    const id = this.filters.text('matterId');
    return first && String(first.matterId) === id
      ? `${first.matterRef} ${first.matterName}`
      : `Matter ${id}`;
  });

  /** Creating from a matter's list keeps the matter. */
  protected newProjectUrl(): string {
    const matterId = this.filters.text('matterId');
    return '/projects/new' + (matterId ? '?matterId=' + matterId : '');
  }

  /** One definition per filter: the row, the sheet, the chips, the count, the URL and the API arguments all come from it. */
  private readonly defs = computed((): FilterDef[] => [
    { key: 'name', label: 'Name', column: 'name', type: 'text' },
    { key: 'matter', label: 'Matter', column: 'matter', type: 'text' },
    statusDef(ARCHIVE_STATUS_OPTIONS),
    // `?matterId=` (a link from a matter): no control, a removable chip.
    {
      key: 'matterId',
      label: 'Matter',
      type: 'text',
      noControl: true,
      valueLabel: (): string => this.matterChip(),
    },
  ]);

  protected readonly filters: ListFilters = new ListFilters({
    screen: 'projects',
    noun: 'projects',
    defs: this.defs,
  });

  constructor() {
    super();
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(() => this.filters.watchOverflow(this.scroll()?.nativeElement), {
      injector: this.injector,
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override fetch() {
    const matterId = Number(this.filters.text('matterId'));
    return firstValueFrom(
      this.api.listProjects(
        undefined,
        Number.isInteger(matterId) && matterId > 0 ? matterId : undefined,
        isActiveParam(parseStatus(this.filters.text('status'))),
        this.filters.text('name') || undefined,
        this.filters.text('matter') || undefined,
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }
}
