import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import { ProjectResponse } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { ActiveBadge } from '../../../shared/ui/badge';
import { naturalCompare } from '../../../shared/ui/list-helpers';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
  RecordGroup,
} from '../../../shared/ui/record-grid';
import { RowActionSpec, rowActions } from '../../../shared/ui/row-actions';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { SortedLine, sortLabelsOf } from '../../../shared/ui/sorted-line';
import { TaskCount } from '../../../shared/ui/task-count';
import { groupProjects } from './matter-project-groups';

const ARCHIVED: RecordGroup = { key: 'archived', label: 'Archived' };
/** The Archived group starts closed while the matter has active projects; a stable array, so a typed search does not reset what the person toggled. */
const START_CLOSED: readonly string[] = ['archived'];
const START_OPEN: readonly string[] = [];

/** The projects of one group in the order of `sort` ("name", "-openTasks"); an empty sort keeps the natural order `groupProjects` gave. */
function sortProjects(rows: readonly ProjectResponse[], sort: string): ProjectResponse[] {
  if (!sort) return [...rows];
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const value = (p: ProjectResponse): number =>
    field === 'openTasks' ? (p.openTaskCount ?? 0) : (p.overdueTaskCount ?? 0);
  const compare =
    field === 'name'
      ? (a: ProjectResponse, b: ProjectResponse) => naturalCompare(a.name, b.name)
      : (a: ProjectResponse, b: ProjectResponse) => value(a) - value(b);
  return [...rows].sort((a, b) => (desc ? -compare(a, b) : compare(a, b)));
}

/**
 * The Projects tab of a Matter (MD3, #273; shared record grid since #1269, grid id `matter-projects`): Name (the one link; the description is its tooltip), Open Tasks and
 * Overdue (counts that open the Task Queue; left out without Task.View) and Status, with the row menu (New Task, Open Task List) for people who can see tasks. The control
 * row is Search, the Sorted line, Columns and New Project. Active projects come first in natural order; Archived projects are one collapsed group row, "Archived (7)", below
 * them (the grid's group header: a 36 px text button, `aria-expanded`, Enter and Space toggle it; the choice is kept for this visit only, and the group starts open when
 * every project is archived). All of a matter's projects arrive with the matter, so Search and the sort work on them in the browser. The empty tab keeps its New Project action.
 */
@Component({
  selector: 'mf-matter-projects',
  imports: [
    Button,
    HasPermissionDirective,
    ActiveBadge,
    TaskCount,
    RowLink,
    ListToolbar,
    SortedLine,
    RecordGrid,
    RecordCell,
    RecordColumns,
    ActionMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    /* Name is the spring of the table: one line with an ellipsis (D-45); the floor is on the heading (the column definition). */
    td.mp-name {
      width: 100%;
      max-width: 0;
    }
  `,
  template: `
    <!-- A tab has no H1: its primary action ends the row above the grid (LC-07, #1045), as "New Task" does on the Tasks tab. The header's New menu keeps its Project entry. -->
    <mf-list-toolbar [filters]="filters" searchLabel="Search projects">
      <mf-record-columns mfColumns [grid]="grid" />
      <mf-sorted-line
        mfBarEnd
        [sort]="sort()"
        [defaultSort]="defaultSort"
        [labels]="sortLabels"
        (resetSort)="sort.set('')"
      />
      <p-button
        mfPrimary
        *mfHasPermission="'Project.Create'"
        label="New Project"
        icon="pi pi-plus"
        data-new-project
        (onClick)="newProject.emit()"
      />
    </mf-list-toolbar>
    <mf-record-grid
      label="Projects list"
      [caption]="'Projects of ' + matterRef()"
      noun="projects"
      [grid]="grid"
      [rows]="rows()"
      [rowKey]="projectKey"
      loadState="ready"
      [empty]="rows().length === 0"
      [filtered]="filters.activeCount() > 0"
      [filters]="filters"
      [groupBy]="groupOf"
      [collapsedGroups]="closedGroups()"
      [actions]="hasActions()"
      [sort]="sort()"
      [defaultSort]="defaultSort"
      (sorted)="sort.set($event)"
      (clear)="filters.clear()"
    >
      <p-button
        mfEmptyAction
        *mfHasPermission="'Project.Create'"
        label="New Project"
        icon="pi pi-plus"
        data-empty-new-project
        (onClick)="newProject.emit()"
      />
      <ng-template mfCell="name" let-p>
        <td class="mp-name">
          <a
            class="mf-link pg-clip"
            data-project-name
            [attr.href]="'/projects/' + p.projectId"
            (click)="open($event, p)"
            mfRowLink="matter-projects"
            [rowKey]="p.projectId"
            [title]="p.description ? p.name + ': ' + p.description : p.name"
            >{{ p.name }}</a
          >
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
        <td><mf-active-badge [active]="p.isActive" inactiveLabel="Archived" /></td>
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
    </mf-record-grid>
    @if (shown() < total()) {
      <p class="pg-reason" data-projects-truncated>Showing the first {{ shown() }} projects.</p>
    }
  `,
})
export class MatterProjects {
  readonly matterId = input.required<number>();
  readonly matterRef = input('');
  /** The matter's projects as loaded (one request at the API's page maximum). */
  readonly projects = input.required<readonly ProjectResponse[]>();
  /** How many projects the matter has, so a list cut at the page maximum says so instead of looking complete. */
  readonly total = input(0);
  /** The empty tab's New project button: the page opens the side panel. */
  readonly newProject = output<void>();
  /** A project row was chosen: the page opens the side panel with the project's linked tasks (a modified click still opens the project page). */
  readonly openProject = output<ProjectResponse>();

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  constructor() {
    registerTableSkip();
    // The projects arrive with the matter, so the rows are there as soon as the tab is.
    // A project left from the collapsed Archived group: focus goes to the group's toggle (the group stays collapsed, as on every visit).
    restoreRowFocus(
      'matter-projects',
      () => true,
      (key) =>
        this.groups().archived.some((p) => String(p.projectId) === key)
          ? document.querySelector<HTMLElement>('tr.rg-group[data-group="archived"] button')
          : null,
    );
  }

  /** Counts come back empty without Task.View: the two columns are not drawn then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  /** The row menu (New Task, Open Task List) exists for people who can see tasks, as on the Projects list. */
  protected readonly hasActions = computed(() => this.auth.has('Task.View'));
  protected readonly shown = computed(() => this.projects().length);

  protected readonly defaultSort = 'name';
  /** The order the person chose ("name", "-openTasks"); empty is the natural order by name. Projects arrive whole, so the tab sorts them itself. */
  protected readonly sort = signal('');
  protected readonly sortLabels = sortLabelsOf([
    { value: 'name', label: 'Name' },
    { value: 'openTasks', label: 'Open Tasks' },
    { value: 'overdue', label: 'Overdue' },
  ]);

  /** The columns this person may have, in the default order (Name cannot be hidden; the counts need Task.View). */
  protected readonly gridDefs = computed((): RecordGridColumn[] => [
    // The spring: no width, so it takes the free room in every state.
    { key: 'name', label: 'Name', locked: true, sort: 'name', minWidth: '200px' },
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
  /** The grid state (shared record grid, #1241): order, visibility and stored widths per person under the id "matter-projects". */
  protected readonly grid = new RecordGridState('matter-projects', this.gridDefs);
  protected readonly projectKey = (p: ProjectResponse): number => p.projectId;
  protected readonly groupOf = (p: ProjectResponse): RecordGroup | null =>
    p.isActive ? null : ARCHIVED;

  /** Search finds a project by name among the ones the tab loaded (all of a matter's projects, a few dozen at most). */
  protected readonly filters = new ListFilters({
    screen: 'matter-projects',
    noun: 'projects',
    defs: [{ key: 'pname', label: 'Name', type: 'text', search: true }],
  });
  private readonly visible = computed(() => {
    const q = this.filters.text('pname').trim().toLowerCase();
    return q ? this.projects().filter((p) => p.name.toLowerCase().includes(q)) : this.projects();
  });
  protected readonly groups = computed(() => {
    const g = groupProjects(this.visible(), this.total() <= this.projects().length);
    return {
      active: sortProjects(g.active, this.sort()),
      archived: sortProjects(g.archived, this.sort()),
    };
  });
  /** Active projects first, then the archived ones (the grid draws the Archived group row before them). */
  protected readonly rows = computed(() => [...this.groups().active, ...this.groups().archived]);
  /** Until the person chooses, the Archived group is open only when there is nothing else to show. */
  protected readonly closedGroups = computed(() =>
    this.projects().some((p) => p.isActive) ? START_CLOSED : START_OPEN,
  );

  /** The quick actions of a row, built once per list of rows. */
  protected readonly menus = computed(
    () => new Map(this.rows().map((p) => [p.projectId, this.buildMenu(p)] as const)),
  );

  private buildMenu(p: ProjectResponse) {
    const specs: RowActionSpec[] = [];
    if (this.auth.has('Task.Create') && p.isActive) {
      specs.push({
        id: 'new-task',
        label: 'New Task',
        icon: 'pi-plus',
        run: () =>
          void this.router.navigate(['/tasks/new'], {
            queryParams: { matterId: this.matterId(), projectId: p.projectId },
          }),
      });
    }
    specs.push({
      id: 'open-tasks',
      label: 'Open Task List',
      icon: 'pi-list',
      run: () => void this.router.navigate(['/projects', p.projectId]),
    });
    const menu = rowActions(p.name, specs, { can: (perm) => this.auth.has(perm) });
    return { ...menu, label: `More actions for ${p.name}` };
  }

  protected open(event: MouseEvent, p: ProjectResponse): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    this.openProject.emit(p);
  }
}
