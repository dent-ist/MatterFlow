import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ProjectResponse, ProjectsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { ARCHIVE_STATUS_OPTIONS, statusDef } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFiltersButton } from '../../../shared/filters/list-filters-button';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge } from '../../../shared/ui/badge';
import { SortHeader } from '../../../shared/ui/data-table';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { CopyPart } from '../../../shared/ui/copy-parts';
import { GridBody } from '../../../shared/ui/grid-body';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';
import { RecordSort } from '../../../shared/ui/record-sort';
import { SortOption } from '../../../shared/work-queue/phone-sort';
import { PageHeader } from '../../../shared/ui/page-header';
import { Pager } from '../../../shared/ui/pager';
import { TaskCount } from '../../../shared/ui/task-count';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { MatterCell } from '../../../shared/work-queue/matter-cell';

/** Below this width the Client column (the least informative one) leaves the table (#267). */
const CLIENT_COLUMN_MIN_PX = 1100;

/** Bone widths of a skeleton row, per column key. */
const BONES: Record<string, string> = {
  name: '16rem',
  matter: '9rem',
  client: '12rem',
  openTasks: '3rem',
  overdue: '3rem',
  status: '5rem',
};

/**
 * Global Projects list (UX S07): Name (the one link), Matter (the shared two-line Matter cell of the Task Queue), Client (from 1100 px), Open tasks
 * and Overdue (counts that open the Task Queue; left out without Task.View), Status. Inline column filters (Name, Matter reference or name, Status with Active by default); a link from a
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
    MatterCell,
    TaskCount,
    SortHeader,
    GridBody,
    FiltersBar,
    ListFiltersButton,
    ColumnFilterRow,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    RowLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
      <mf-page-header heading="Projects">
        <mf-list-filters-button
          mfActions
          [filters]="filters"
          controls="project-filter-row"
          [clearAlso]="['q']"
        />
        <p-button
          mfActions
          *mfHasPermission="'Project.Create'"
          label="New project"
          icon="pi pi-plus"
          (onClick)="go(newProjectUrl())"
        />
      </mf-page-header>

      <mf-filters-bar [bare]="true" [filters]="filters" [clearAlso]="['q']">
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="name"
          (sorted)="pickSort($event)"
        />
      </mf-filters-bar>

      <div class="mf-fill">
        @if (phone()) {
          <mf-record-card-list
            noun="projects"
            label="Projects"
            [state]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            [emptyParts]="emptyParts()"
            (retry)="load()"
            (clear)="clear()"
          >
            <ng-template [mfRecordCard]="rows()" let-p>
              <mf-record-card
                [name]="p.name"
                [link]="['/projects', p.projectId]"
                list="projects"
                [rowKey]="p.projectId"
              >
                @if (!p.isActive) {
                  <mf-active-badge mfCardBadges [active]="false" inactiveLabel="Archived" />
                }
                <p mfCardMeta class="rc-line" data-card-matter>
                  <span class="rc-ref">{{ p.matterRef }}</span>
                  <span class="rc-sep" aria-hidden="true">-</span><span class="mf-sr-only">, </span>
                  @if (auth.canLink('matter')) {
                    <a class="rc-text" [routerLink]="['/matters', p.matterId]">{{
                      p.matterName
                    }}</a>
                  } @else {
                    <span class="rc-text">{{ p.matterName }}</span>
                  }
                </p>
                <p mfCardMeta class="rc-line" data-card-client>
                  <span class="rc-text">{{ p.clientName }}</span>
                </p>
                @if (counts()) {
                  <mf-task-count
                    mfCardCounts
                    kind="open"
                    scope="project"
                    [word]="true"
                    [recordId]="p.projectId"
                    [name]="p.name"
                    [count]="p.openTaskCount ?? 0"
                  />
                }
                @if (counts() && (p.overdueTaskCount ?? 0) > 0) {
                  <mf-task-count
                    mfCardCounts
                    kind="overdue"
                    scope="project"
                    [word]="true"
                    [recordId]="p.projectId"
                    [name]="p.name"
                    [count]="p.overdueTaskCount ?? 0"
                  />
                }
              </mf-record-card>
            </ng-template>
          </mf-record-card-list>
        } @else {
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
                    @if (showClient()) {
                      <th scope="col">Client</th>
                    }
                    @if (counts()) {
                      <th
                        class="pg-num"
                        mfSort="openTasks"
                        [firstDesc]="true"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        (sorted)="setSort($event)"
                      >
                        Open tasks
                      </th>
                      <th
                        class="pg-num"
                        mfSort="overdue"
                        [firstDesc]="true"
                        [sort]="sort()"
                        [defaultSort]="defaultSort"
                        (sorted)="setSort($event)"
                      >
                        Overdue
                      </th>
                    }
                    <th scope="col">Status</th>
                  </tr>
                  @if (filters.rowVisible()) {
                    <tr
                      mfColumnFilterRow
                      id="project-filter-row"
                      [filters]="filters"
                      [columns]="columns()"
                    ></tr>
                  }
                </thead>
                <tbody
                  mfGridBody
                  noun="projects"
                  [state]="state()"
                  [empty]="rows().length === 0"
                  [filtered]="filters.activeCount() > 0"
                  [columns]="columns().length"
                  [emptyParts]="emptyParts()"
                  [skeleton]="skeleton()"
                  (retry)="load()"
                  (clear)="clear()"
                >
                  @for (p of rows(); track p.projectId) {
                    <tr>
                      <td>
                        <a
                          class="pg-link pg-name"
                          [routerLink]="['/projects', p.projectId]"
                          mfRowLink="projects"
                          [rowKey]="p.projectId"
                          [title]="p.name"
                          >{{ p.name }}</a
                        >
                      </td>
                      <td class="pg-fix">
                        <mf-matter-cell [row]="p" [link]="auth.canLink('matter')" />
                      </td>
                      @if (showClient()) {
                        <td class="pg-fix pg-fix--client">
                          <span class="pg-clip" [title]="p.clientNumber + ' ' + p.clientName">{{
                            p.clientName
                          }}</span>
                        </td>
                      }
                      @if (counts()) {
                        <td class="pg-num">
                          <mf-task-count
                            kind="open"
                            scope="project"
                            [recordId]="p.projectId"
                            [name]="p.name"
                            [count]="p.openTaskCount ?? 0"
                          />
                        </td>
                        <td class="pg-num">
                          <mf-task-count
                            kind="overdue"
                            scope="project"
                            [recordId]="p.projectId"
                            [name]="p.name"
                            [count]="p.overdueTaskCount ?? 0"
                          />
                        </td>
                      }
                      <td>
                        <mf-active-badge [active]="p.isActive" inactiveLabel="Archived" />
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
            [page]="pageNumber()"
            [pageSize]="pageSize()"
            [pageSizes]="pageSizes"
            [total]="total()"
            [hidden]="hiddenCount()"
            hiddenLabel="archived"
            (showAll)="showAll()"
            (pageChange)="goToPage($event)"
            (pageSizeChange)="setPageSize($event)"
          />
        }
      </div>
    </mf-fixed-page>
  `,
})
export class ProjectsListPage extends ServerListPage<ProjectResponse> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(ProjectsClient);
  protected readonly auth = inject(AuthStore);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  private readonly wide = viewportAtLeast(CLIENT_COLUMN_MIN_PX);

  /** Below 640 px the list is cards, not a table (WP12). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, counts only with Task.View (the headers' keys). */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'name', label: 'Name' },
    { value: 'matterRef', label: 'Matter' },
    ...(this.counts()
      ? [
          { value: 'openTasks', label: 'Open tasks', descFirst: true },
          { value: 'overdue', label: 'Overdue', descFirst: true },
        ]
      : []),
  ]);

  protected readonly defaultSort = 'name';
  /** Counts are null without Task.View: the two columns are not rendered then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  protected readonly showClient = computed(() => this.wide());
  /** The columns of the grid, in order; the keys the filter definitions point at. */
  protected readonly columns = computed(() => [
    'name',
    'matter',
    ...(this.showClient() ? ['client'] : []),
    ...(this.counts() ? ['openTasks', 'overdue'] : []),
    'status',
  ]);
  protected readonly skeleton = computed(() => this.columns().map((key) => BONES[key]));

  protected readonly matterChip = computed(() => {
    const first = this.rows()[0];
    const id = this.filters.text('matterId');
    return first && String(first.matterId) === id
      ? `${first.matterRef} ${first.matterName}`
      : `Matter ${id}`;
  });

  /** First-run text (L11): a project is made inside a matter, so it points there; the link needs `Matter.View`. */
  protected readonly emptyParts = computed((): readonly CopyPart[] =>
    this.auth.has('Matter.View')
      ? [
          'No projects yet. ',
          { label: 'Open a matter', to: '/matters' },
          ' and choose New project.',
        ]
      : ['No projects yet. Open a matter and choose New project.'],
  );

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
    openByDefault: true,
    sheetBelow: 640,
  });

  constructor() {
    super();
    registerTableSkip();
    restoreRowFocus('projects', () => this.state() === 'ready');
    // The controls move into the sheet while the grid scrolls sideways (the grid is not there while the phone shows cards).
    effect(() => {
      const area = this.scroll()?.nativeElement;
      if (area) untracked(() => this.filters.watchOverflow(area));
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  protected override fetch() {
    return this.list(
      isActiveParam(parseStatus(this.filters.text('status'))),
      this.pageNumber(),
      this.pageSize(),
    );
  }

  /** The archived projects the default Active hides, under the same other filters (#271). */
  protected override fetchHidden() {
    return parseStatus(this.filters.text('status')) === 'active' ? this.list(false, 1, 1) : null;
  }

  private list(isActive: boolean | undefined, page: number, size: number) {
    const matterId = Number(this.filters.text('matterId'));
    return firstValueFrom(
      this.api.listProjects(
        undefined,
        Number.isInteger(matterId) && matterId > 0 ? matterId : undefined,
        isActive,
        this.filters.text('name') || undefined,
        this.filters.text('matter') || undefined,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }
}
