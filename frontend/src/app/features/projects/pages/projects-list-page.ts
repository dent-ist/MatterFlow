import { NgTemplateOutlet } from '@angular/common';
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
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import { SortedLine, sortLabelsOf } from '../../../shared/ui/sorted-line';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ActiveBadge } from '../../../shared/ui/badge';
import { FixedPage } from '../../../shared/ui/fixed-page';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../shared/ui/record-grid';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { RowActionSpec, rowActions } from '../../../shared/ui/row-actions';
import { CopyPart } from '../../../shared/ui/copy-parts';
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
import { PageScope } from '../../../shared/scope/page-scope';
import { scopeLine } from '../../../shared/scope/scope-line';
import { ScopeSwitch } from '../../../shared/scope/scope-switch';
import { Pager } from '../../../shared/ui/pager';
import { TaskCount } from '../../../shared/ui/task-count';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { MatterCell } from '../../../shared/work-queue/matter-cell';

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
 * Global Projects list (UX S07): Project Name (the one link), Matter (the shared two-line Matter cell of the Task Queue), Client (from 1100 px), Open tasks
 * and Overdue (counts that open the Task Queue; left out without Task.View), Status. Inline column filters (Name, Matter reference or name, Status with Active by default); a link from a
 * Matter keeps `?matterId=` as a removable chip. State lives in the URL.
 */
@Component({
  selector: 'mf-projects-list-page',
  imports: [
    FixedPage,
    NgTemplateOutlet,
    PageHeader,
    ScopeSwitch,
    ActiveBadge,
    RouterLink,
    Button,
    HasPermissionDirective,
    Pager,
    MatterCell,
    TaskCount,
    RecordGrid,
    RecordCell,
    RecordColumns,
    ActionMenu,
    ListToolbar,
    SortedLine,
    ColumnFilterRow,
    RecordCardList,
    RecordCardDef,
    RecordCard,
    RecordSort,
    RowLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    /* Project Name is the spring of the table: one line with an ellipsis (D-45); the floor is on the heading (the column definition). */
    td.pj-name {
      width: 100%;
      max-width: 0;
    }
  `,
  template: `
    <mf-fixed-page>
      <mf-page-header
        heading="Projects"
        [count]="state() === 'ready' ? total() : null"
        [countPending]="state() !== 'ready'"
      >
        <mf-scope-switch
          mfActions
          [scope]="scope.value()"
          [canAll]="scope.canAll()"
          announceMine="Showing projects of matters you manage"
          announceAll="Showing all projects"
          (scopeChange)="scope.set($event)"
        />
        @if (scopeText()) {
          <span mfDescription class="sl-line" data-scope-line>{{ scopeText() }}</span>
        }
        <p-button
          mfActions
          *mfHasPermission="'Project.Create'"
          label="New Project"
          icon="pi pi-plus"
          (onClick)="go(newProjectUrl())"
        />
      </mf-page-header>

      <mf-list-toolbar
        [filters]="filters"
        controls="project-filter-row"
        searchLabel="Search projects"
        [clearAlso]="['q']"
      >
        @if (!phone()) {
          <mf-record-columns mfColumns [grid]="grid" />
        }
        <mf-sorted-line
          mfBarEnd
          [sort]="sort()"
          [defaultSort]="defaultSort"
          [labels]="sortLabels()"
          (resetSort)="pickSort(null)"
        />
        <mf-record-sort
          mfSheetSort
          [options]="sortOptions()"
          [sort]="sort()"
          defaultSort="name"
          (sorted)="pickSort($event)"
        />
      </mf-list-toolbar>

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
            [hidden]="hiddenCount()"
            hiddenLabel="archived"
            [emptyText]="emptyText()"
            (showAll)="showAll()"
          >
            @if (scope.mine() && scope.canAll()) {
              <button
                mfEmptyAction
                type="button"
                class="mf-btn"
                data-show-all-matters
                (click)="scope.set('all')"
              >
                Show All Matters
              </button>
            }
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
          <mf-record-grid
            #scroll
            label="Projects list"
            caption="Projects"
            noun="projects"
            [grid]="grid"
            [rows]="rows()"
            [rowKey]="projectKey"
            [loadState]="state()"
            [empty]="rows().length === 0"
            [filtered]="filters.activeCount() > 0"
            [emptyText]="emptyText()"
            [emptyParts]="emptyParts()"
            [hidden]="hiddenCount()"
            hiddenLabel="archived"
            [bones]="bones"
            [actions]="hasActions()"
            [sort]="sort()"
            [defaultSort]="defaultSort"
            (sorted)="setSort($event)"
            (retry)="load()"
            (clear)="clear()"
            (showAll)="showAll()"
          >
            @if (filters.rowVisible()) {
              <tr
                mfGridFilterRow
                mfColumnFilterRow
                id="project-filter-row"
                [filters]="filters"
                [columns]="columns()"
              ></tr>
            }
            @if (scope.mine() && scope.canAll()) {
              <button
                mfEmptyAction
                type="button"
                class="mf-btn"
                data-show-all-matters
                (click)="scope.set('all')"
              >
                Show All Matters
              </button>
            }
            <ng-template mfCell="name" let-p>
              <td class="pj-name">
                <a
                  class="mf-link pg-clip"
                  [routerLink]="['/projects', p.projectId]"
                  mfRowLink="projects"
                  [rowKey]="p.projectId"
                  [title]="p.name"
                  >{{ p.name }}</a
                >
              </td>
            </ng-template>
            <ng-template mfCell="matter" let-p>
              <td class="pg-fix">
                <mf-matter-cell [row]="p" [link]="auth.canLink('matter')" />
              </td>
            </ng-template>
            <ng-template mfCell="client" let-p>
              <td class="pg-fix pg-fix--client">
                <span class="pg-clip" [title]="p.clientNumber + ' ' + p.clientName">{{
                  p.clientName
                }}</span>
              </td>
            </ng-template>
            <ng-template mfCell="openTasks" let-p>
              <td class="pg-num">
                <mf-task-count
                  kind="open"
                  scope="project"
                  [recordId]="p.projectId"
                  [name]="p.name"
                  [count]="p.openTaskCount ?? 0"
                />
              </td>
            </ng-template>
            <ng-template mfCell="overdue" let-p>
              <td class="pg-num">
                <mf-task-count
                  kind="overdue"
                  scope="project"
                  [recordId]="p.projectId"
                  [name]="p.name"
                  [count]="p.overdueTaskCount ?? 0"
                />
              </td>
            </ng-template>
            <ng-template mfCell="status" let-p>
              <td>
                <mf-active-badge [active]="p.isActive" inactiveLabel="Archived" />
              </td>
            </ng-template>
            <ng-template mfCell="actions" let-p>
              <td class="mf-col-actions" data-row-actions>
                <mf-action-menu
                  [floating]="true"
                  [label]="menus().get(p.projectId)!.label"
                  [items]="menus().get(p.projectId)!.items"
                />
              </td>
            </ng-template>
            <div mfGridFoot>
              <ng-container *ngTemplateOutlet="pager" />
            </div>
          </mf-record-grid>
        }
        @if (phone()) {
          <ng-container *ngTemplateOutlet="pager" />
        }
        <ng-template #pager>
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
        </ng-template>
      </div>
    </mf-fixed-page>
  `,
})
export class ProjectsListPage extends ServerListPage<ProjectResponse> {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(ProjectsClient);
  protected readonly auth = inject(AuthStore);
  private readonly scroll = viewChild('scroll', { read: ElementRef });

  /** Below 640 px the list is cards, not a table (WP12). */
  protected readonly phone = phoneCards();
  /** The phone's Sort by select: the sortable columns, counts only with Task.View (the headers' keys). */
  protected readonly sortOptions = computed((): SortOption[] => [
    { value: 'name', label: 'Name' },
    { value: 'matterRef', label: 'Matter' },
    ...(this.counts()
      ? [
          { value: 'openTasks', label: 'Open Tasks', descFirst: true },
          { value: 'overdue', label: 'Overdue', descFirst: true },
        ]
      : []),
  ]);

  /** "My matters / All" (epic #758): people who can be a project manager open the list on the matters they manage, with a remembered switch. */
  protected readonly scope = new PageScope('projects', () => !this.filters.isDeepLink());
  /** "Projects of matters you manage (63 of 1,204)" / "1,204 projects". */
  protected readonly scopeText = computed(() =>
    scopeLine({
      scope: this.scope.value(),
      noun: 'projects',
      phrase: 'Projects of matters you manage',
      shown: this.state() === 'ready' ? this.total() : null,
      all: this.unscopedTotal(),
    }),
  );
  protected readonly emptyText = computed(() =>
    this.scope.mine() ? 'You do not manage any matter yet.' : '',
  );

  protected readonly defaultSort = 'name';
  protected readonly sortLabels = computed(() => sortLabelsOf(this.sortOptions()));
  /** Counts are null without Task.View: the two columns are not rendered then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  /** The row menu (New Task, Open Task List) exists for people who can see tasks. */
  protected readonly hasActions = computed(() => this.auth.has('Task.View'));
  /** The columns this person may have, in the default order (Project Name cannot be hidden; the counts need Task.View). */
  protected readonly gridDefs = computed((): RecordGridColumn[] => [
    // The spring: no width, so it takes the free room in every state.
    { key: 'name', label: 'Project Name', locked: true, sort: 'name', minWidth: '200px' },
    { key: 'matter', label: 'Matter', sort: 'matterRef', width: '15rem', minWidth: '15rem' },
    { key: 'client', label: 'Client', width: '12rem', minWidth: '12rem' },
    ...(this.counts()
      ? [
          {
            key: 'openTasks',
            label: 'Open Tasks',
            sort: 'openTasks',
            firstDesc: true,
            num: true,
            width: 'var(--mf-col-count-w)',
            minWidth: 'var(--mf-col-count-w)',
          },
          {
            key: 'overdue',
            label: 'Overdue',
            sort: 'overdue',
            firstDesc: true,
            num: true,
            width: 'var(--mf-col-count-w)',
            minWidth: 'var(--mf-col-count-w)',
          },
        ]
      : []),
    {
      key: 'status',
      label: 'Status',
      width: 'var(--mf-col-status-w)',
      minWidth: 'var(--mf-col-status-w)',
    },
  ]);
  /** The grid state (shared record grid, #1241): order, visibility and stored widths per person under the id "projects". */
  protected readonly grid = new RecordGridState('projects', this.gridDefs);
  protected readonly bones = BONES;
  protected readonly projectKey = (p: ProjectResponse): number => p.projectId;
  /** Every column of the table, in order, the Actions one included (its filter cell is empty but grey, so the band covers the whole row); the keys the filter definitions point at. */
  protected readonly columns = computed(() => [
    ...this.grid.shown(),
    ...(this.hasActions() ? ['actions'] : []),
  ]);
  /** The quick actions of a row, built once per page of rows. */
  protected readonly menus = computed(
    () => new Map(this.rows().map((p) => [p.projectId, this.buildMenu(p)] as const)),
  );

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
          ' and choose New Project.',
        ]
      : ['No projects yet. Open a matter and choose New Project.'],
  );

  private buildMenu(p: ProjectResponse) {
    const specs: RowActionSpec[] = [];
    if (this.auth.has('Task.Create') && p.isActive) {
      specs.push({
        id: 'new-task',
        label: 'New Task',
        icon: 'pi-plus',
        run: () => this.go(`/tasks/new?matterId=${p.matterId}&projectId=${p.projectId}`),
      });
    }
    specs.push({
      id: 'open-tasks',
      label: 'Open Task List',
      icon: 'pi-list',
      run: () => this.go(`/projects/${p.projectId}`),
    });
    const menu = rowActions(p.name, specs, { can: (perm) => this.auth.has(perm) });
    return { ...menu, label: `More actions for ${p.name}` };
  }

  /** Creating from a matter's list keeps the matter. */
  protected newProjectUrl(): string {
    const matterId = this.filters.text('matterId');
    return '/projects/new' + (matterId ? '?matterId=' + matterId : '');
  }

  /** One definition per filter: the row, the sheet, the chips, the count, the URL and the API arguments all come from it. */
  private readonly defs = computed((): FilterDef[] => [
    { key: 'name', label: 'Name', column: 'name', type: 'text', search: true },
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
      this.state();
      const area = this.scroll()?.nativeElement.querySelector(
        '.mf-scroll-area',
      ) as HTMLElement | null;
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

  protected override watch(): void {
    super.watch();
    this.scope.value();
  }

  /** The same list without the scope: the "of 1,204". */
  protected override fetchUnscoped() {
    return this.scope.mine()
      ? this.list(isActiveParam(parseStatus(this.filters.text('status'))), 1, 1, false)
      : null;
  }

  private list(isActive: boolean | undefined, page: number, size: number, scoped = true) {
    const matterId = Number(this.filters.text('matterId'));
    return firstValueFrom(
      this.api.listProjects(
        undefined,
        Number.isInteger(matterId) && matterId > 0 ? matterId : undefined,
        isActive,
        this.filters.text('name') || undefined,
        this.filters.text('matter') || undefined,
        scoped && this.scope.mine() ? true : undefined,
        undefined,
        page,
        size,
        this.sort() || undefined,
      ),
    );
  }
}
