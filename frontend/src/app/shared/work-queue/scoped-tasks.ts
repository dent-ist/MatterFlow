import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { TaskQueueClient, TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { LookupStore } from '../../core/lookups/lookup-store';
import { HasPermissionDirective } from '../directives/has-permission.directive';
import { FilterDef, FilterOption } from '../filters/filter-def';
import { FiltersBar } from '../filters/filters-bar';
import { ListFilters } from '../filters/list-filters';
import { LoadState } from '../ui/data-table';
import { PageFooter } from '../ui/page-footer';
import { Pager } from '../ui/pager';
import { QueueChoices, mergeOptions } from './queue-choices';
import { OPEN_STATUSES, parseQueueState, queueArgs } from './queue-filters';
import { ColumnAction } from './column-menu-items';
import { ColumnWidthMap } from './column-widths';
import { TaskTable } from './task-table';
import { WorkWidths } from './work-widths';

const PAGE_SIZE = 25;
const MATTER_COLUMNS = ['ref', 'title', 'project', 'priority', 'assignee', 'due', 'status'];
const PROJECT_COLUMNS = ['ref', 'title', 'priority', 'assignee', 'due', 'status'];

/** The query parameters of this grid's filters; the Matter page drops them when another tab is chosen. */
export const SCOPED_TASK_PARAMS: readonly string[] = [
  'q',
  'status',
  'project',
  'priority',
  'assignee',
  'unassigned',
  'dueFrom',
  'dueTo',
];

const asId = (v: string): string | null => (/^[1-9]\d*$/.test(v) ? v : null);

/**
 * The Tasks tab of a Matter (UX S06) and the task list of a Project: the shared work-queue table over the Task Queue endpoint filtered by
 * `matter` (and `project`), with the same inline column filters as the work lists (Title or Ref, Project on a Matter, Priority, Assignee,
 * Due and Status, which starts on the open statuses), chips, the Filters sheet on a narrow screen, paging, and a Create Task button that
 * prefills the Matter (and Project). The filters live in the address (`q`, `status`, `project`, `priority`, `assignee`, `dueFrom`,
 * `dueTo`); paging and sorting stay in the page. Rendered only while its tab is open, so nothing loads before then. Needs `Task.View`;
 * without it a short notice replaces the table.
 */
@Component({
  selector: 'mf-scoped-tasks',
  imports: [Button, HasPermissionDirective, PageFooter, Pager, TaskTable, FiltersBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styles: `
    .st-state {
      padding: var(--mf-s5) var(--mf-s4);
      text-align: center;
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius);
    }
  `,
  template: `
    @if (!canView()) {
      <div class="st-state" data-no-access="tasks">You don't have permission to view tasks.</div>
    } @else {
      <mf-filters-bar [filters]="filters" [controls]="filterRowId">
        @if (showCreate()) {
          <p-button
            mfBarStart
            *mfHasPermission="'Task.Create'"
            label="Create task"
            icon="pi pi-plus"
            severity="secondary"
            data-create-task
            [disabled]="!canCreate()"
            (onClick)="create()"
          />
        }
      </mf-filters-bar>

      <mf-task-table
        [rows]="rows()"
        [columns]="columns()"
        [caption]="caption()"
        [hideContext]="true"
        [state]="state()"
        [filters]="filters"
        [filterRowId]="filterRowId"
        [filtered]="filters.activeCount() > 0"
        [emptyText]="emptyText()"
        [sort]="sort()"
        [dir]="dir()"
        [colWidths]="colWidths()"
        [canHideColumns]="false"
        (columnResized)="onColumnResized($event)"
        (columnAction)="onColumnAction($event)"
        [resetKey]="filterKey() + '|' + sort() + '|' + dir() + '|' + page()"
        (sortChange)="sortBy($event)"
        (retry)="load()"
        (clearFilters)="filters.clear()"
      />
      @if (rows().length > 0) {
        <div mfPageFooter>
          <mf-pager
            [page]="page()"
            [pageSize]="pageSize"
            [total]="total()"
            (pageChange)="goTo($event)"
          />
        </div>
      }
    }
  `,
})
export class ScopedTasks {
  readonly matterId = input.required<number>();
  /** Show only the Tasks of this Project. */
  readonly projectId = input<number | null>(null);
  /** The Matter's projects, for the Project filter on a Matter's Tasks tab. */
  readonly projectOptions = input<readonly FilterOption[]>([]);
  /** False disables Create Task (an inactive Matter takes no new Tasks). */
  readonly canCreate = input(true);
  /** False where the page header already offers the one Create Task button (Matter detail, UXR-40). */
  readonly showCreate = input(true);
  /** Each time a load succeeds: how many tasks match, and whether the person (not just the default open-status view) narrowed the list. */
  readonly loaded = output<{ total: number; filtered: boolean }>();

  private static nextId = 0;
  protected readonly filterRowId = `scoped-task-filter-${ScopedTasks.nextId++}`;

  private readonly api = inject(TaskQueueClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly choices = inject(QueueChoices);
  private readonly widthStore = inject(WorkWidths);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly canView = computed(() => this.auth.has('Task.View'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly page = signal(1);
  protected readonly sort = signal<string | null>(null);
  protected readonly dir = signal<'asc' | 'desc' | null>(null);
  protected readonly rows = signal<TaskQueueRow[]>([]);
  protected readonly total = signal(0);
  protected readonly columns = computed(() =>
    this.projectId() === null ? MATTER_COLUMNS : PROJECT_COLUMNS,
  );
  /** Where the widths of this grid are remembered (#203): one scope for every Matter's Tasks tab, one for every Project's list. */
  private readonly widthScope = computed(() =>
    this.projectId() === null ? 'matterTasks' : 'projectTasks',
  );
  protected readonly colWidths = computed<ColumnWidthMap>(() =>
    this.widthStore.widths(this.widthScope(), this.auth.profile()?.userId ?? null),
  );
  protected readonly caption = computed(() =>
    this.projectId() === null ? 'Tasks of this matter' : 'Tasks of this project',
  );

  private readonly people = computed<FilterOption[]>(() => {
    const seen = new Map<string, FilterOption>();
    for (const r of this.rows()) {
      const u = r.assignedUser;
      if (u && !seen.has(String(u.userId))) {
        seen.set(String(u.userId), {
          value: String(u.userId),
          label: u.displayName,
          ...(u.isActive ? {} : { hint: '(inactive)' }),
        });
      }
    }
    return [...seen.values()];
  });

  private readonly defs = computed((): FilterDef[] => {
    const lookups = this.lookups;
    const defs: FilterDef[] = [
      { key: 'q', label: 'Title or Ref', column: 'ref', type: 'text', span: 2 },
      ...(this.projectId() === null
        ? ([
            {
              key: 'project',
              label: 'Project',
              column: 'project',
              type: 'select',
              allLabel: 'All projects',
              options: this.projectOptions(),
              normalize: asId,
            },
          ] satisfies FilterDef[])
        : []),
      {
        key: 'priority',
        label: 'Priority',
        column: 'priority',
        type: 'multiSelect',
        options: lookups.priorities().map((p) => ({ value: String(p.id), label: p.label })),
        normalize: asId,
      },
      {
        key: 'assignee',
        label: 'Assignee',
        column: 'assignee',
        type: 'user',
        options: mergeOptions(this.choices.people(), this.people()),
        flagOptions: { unassigned: { param: 'unassigned', label: 'Unassigned' } },
        normalize: asId,
      },
      {
        key: 'due',
        label: 'Due',
        column: 'due',
        type: 'dateRange',
        fromParam: 'dueFrom',
        toParam: 'dueTo',
      },
      {
        key: 'status',
        label: 'Status',
        column: 'status',
        type: 'multiSelect',
        default: OPEN_STATUSES,
        valueGroups: [{ label: 'Open', values: OPEN_STATUSES }],
        options: ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((code) => ({
          value: code,
          label: lookups.statusLabel(code),
        })),
        normalize: (v) =>
          ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].includes(v.toUpperCase())
            ? v.toUpperCase()
            : null,
      },
    ];
    return defs;
  });

  protected readonly filters = new ListFilters({
    screen: 'scoped-tasks',
    noun: 'tasks',
    defs: this.defs,
    visibleColumns: signal(null),
  });

  /** The filters as text: a change reloads (options arriving later never do). */
  protected readonly filterKey = computed(() => JSON.stringify(this.filters.queryParams()));

  protected readonly emptyText = computed(() => {
    const status = this.filters.list('status');
    return status.length === OPEN_STATUSES.length && status.every((s) => OPEN_STATUSES.includes(s))
      ? 'No open tasks.'
      : 'No tasks yet.';
  });

  private requestId = 0;

  constructor() {
    void this.lookups.ensureLoaded();
    effect(() => {
      this.matterId();
      this.projectId();
      this.filterKey();
      untracked(() => {
        // A new filter starts again on the first page.
        this.page.set(1);
        if (this.canView()) void this.load();
      });
    });
  }

  protected goTo(page: number): void {
    this.page.set(page);
    void this.load();
  }

  protected onColumnResized(e: { key: string; rem: number; defaultRem?: number }): void {
    this.widthStore.set(
      this.widthScope(),
      this.auth.profile()?.userId ?? null,
      e.key,
      e.rem,
      e.defaultRem,
    );
  }

  /** The column menu: forget a width, or sort one way (the column set is fixed here, so "Hide column" is not offered). */
  protected onColumnAction(a: ColumnAction): void {
    if (a.kind === 'reset') {
      this.widthStore.reset(this.widthScope(), this.auth.profile()?.userId ?? null, a.key);
    } else if (a.kind === 'sort') {
      this.sort.set(a.field);
      this.dir.set(a.dir);
      this.page.set(1);
      void this.load();
    }
  }

  protected sortBy(field: string): void {
    const defaultDesc = field === 'created';
    if (this.sort() === field) {
      this.dir.set(this.dir() === 'desc' ? 'asc' : 'desc');
    } else {
      this.sort.set(field);
      this.dir.set(defaultDesc ? 'desc' : 'asc');
    }
    this.page.set(1);
    void this.load();
  }

  protected create(): void {
    const project = this.projectId();
    const query = `matterId=${this.matterId()}${project === null ? '' : `&projectId=${project}`}`;
    void this.router.navigateByUrl(`/tasks/new?${query}`);
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    this.state.set('loading');
    try {
      // The address holds this grid's filters; the Matter (and the fixed Project) come from the page, paging and sorting from here.
      const parsed = parseQueueState(this.filters.params());
      const status = this.filters.list('status');
      const request = queueArgs({
        ...parsed,
        filters: {
          ...parsed.filters,
          status: [...status],
          matter: this.matterId(),
          project: this.projectId() ?? parsed.filters.project,
        },
        sort: this.sort(),
        dir: this.dir(),
        page: this.page(),
        pageSize: PAGE_SIZE,
      });
      const page = await firstValueFrom(this.api.getTaskQueue(undefined, ...request));
      if (id !== this.requestId) return;
      this.rows.set(page.items);
      this.total.set(page.total);
      this.state.set('ready');
      this.filters.reportResults(page.total);
      this.loaded.emit({ total: page.total, filtered: this.filters.activeCount() > 0 });
      this.choices.ensure();
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }
}
