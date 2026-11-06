import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  BulkTasksResponse,
  MatterBulkTasksClient,
  TaskQueueClient,
  TaskQueueRow,
} from '../../api/generated/api-client';
import { NotificationService } from '../../core/notify/notification.service';
import { Dropdown, DropdownItem } from '../ui/dropdown';
import { AuthStore } from '../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { LookupStore } from '../../core/lookups/lookup-store';
import { SkipTarget } from '../layout/skip-target';
import { restoreRowFocus } from '../ui/row-nav';
import { HasPermissionDirective } from '../directives/has-permission.directive';
import { FilterDef, FilterOption } from '../filters/filter-def';
import { ListToolbar } from '../filters/list-toolbar';
import { SortedLine } from '../ui/sorted-line';
import { SORT_LABELS } from './sort-note';
import { PhoneSort, SortChoice, SortOption } from './phone-sort';
import { ListFilters } from '../filters/list-filters';
import { LoadState } from '../ui/data-table';
import { PageFooter } from '../ui/page-footer';
import { phoneCards } from '../ui/record-card-list';
import { GridColumns } from '../ui/grid-columns';
import {
  DEFAULT_GRID_PREFS,
  GridColumnDef,
  GridPrefs,
  clearGridPrefs,
  gridPrefsKey,
  loadGridPrefs,
  moveBefore,
  saveGridPrefs,
  shownKeys,
} from '../ui/grid-prefs';
import { ColumnMove } from '../ui/reorder-columns';
import { Pager } from '../ui/pager';
import { PrintLine } from './print-line';
import { QueueChoices, mergeOptions } from './queue-choices';
import { OPEN_STATUSES, dateDaysAgo, parseQueueState, queueArgs } from './queue-filters';
import {
  VIEW_EMPTY,
  VIEW_FIXED,
  parseScopedView,
  scopedViewFilters,
  scopedViewOwns,
} from './scoped-view';
import { MoveTarget, MoveTaskDialog } from './move-task-dialog';
import { BULK_MAX, BulkMode, BulkTarget, BulkTasksDialog } from './bulk-tasks-dialog';
import { SummaryStrip } from './summary-strip';
import { TaskSelectList, isBulkEditable } from './task-select-list';
import { ColumnAction } from './column-menu-items';
import { ColumnWidthMap, pxToRem } from './column-widths';
import { TaskTable } from './task-table';
import { WorkWidths } from './work-widths';
import { DUE_SOON_DAYS } from './work-vocabulary';

/** The page size of a list (LC-05, decision AR 10): 50, chosen from 25 / 50 / 100. */
const PAGE_SIZE = 50;
const PAGE_SIZES: readonly number[] = [25, 50, 100];
/** The choice that takes the ticked tasks out of their project. */
const NO_PROJECT = 'none';
/**
 * Default widths of this grid (px): the D-43 widths (Type 112, Project 140, Priority 112, Assignee 136, Due 152, Status 140), so Priority and Status are never cut
 * (#1154). With the Title at its 200 px minimum they fill a 1366 px window (1098 px box) without Progress, which is off by default and one click away in the
 * Columns menu; a width the person changed wins.
 */
const DEFAULT_WIDTHS_PX: Readonly<Record<string, number>> = {
  typeChip: 128,
  project: 140,
  priority: 112,
  assignee: 136,
  due: 152,
  status: 140,
  steps: 120,
};

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
  'view',
];

const SCOPED_VIEW_NAMES = {
  overdue: 'Overdue',
  dueSoon: 'Due soon',
  asap: 'ASAP',
  onHold: 'On Hold',
} as const;

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
  imports: [
    Dropdown,
    BulkTasksDialog,
    MoveTaskDialog,
    Button,
    HasPermissionDirective,
    PageFooter,
    Pager,
    SummaryStrip,
    TaskSelectList,
    TaskTable,
    ListToolbar,
    PhoneSort,
    SortedLine,
    GridColumns,
    PrintLine,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styles: `
    .st-selbar {
      display: flex;
      flex: 1 1 100%;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .st-selnote {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    @media (max-width: 639.98px) {
      .st-selbar .mf-btn {
        min-height: 44px;
      }
    }
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
      <mf-list-toolbar
        [filters]="filters"
        [controls]="filterRowId"
        searchLabel="Search tasks"
        [bulkActive]="selecting()"
      >
        <mf-summary-strip
          mfView
          [kind]="projectId() === null ? 'matter' : 'project'"
          [id]="projectId() ?? matterId()"
          [interactive]="true"
          variant="dropdown"
          [active]="view() ?? 'open'"
          [reload]="stripReload()"
          (pick)="pickView($event)"
          (opened)="opened.emit($event)"
        />
        @if (!phone()) {
          <mf-grid-columns
            mfColumns
            [defs]="gridDefs()"
            [prefs]="prefs()"
            (prefsChange)="setPrefs($event)"
            (resetColumns)="resetPrefs()"
          />
        }
        @if (canBulk()) {
          <button
            mfMore
            type="button"
            class="mf-btn"
            data-select-mode
            [attr.aria-pressed]="selecting()"
            (click)="selecting() ? endSelecting() : selecting.set(true)"
          >
            <i class="pi pi-check-square" aria-hidden="true"></i> Select
          </button>
        }
        @if (showCreate()) {
          <p-button
            mfPrimary
            *mfHasPermission="'Task.Create'"
            label="New Task"
            icon="pi pi-plus"
            data-create-task
            [disabled]="!canCreate()"
            (onClick)="create()"
          />
        }
        <!-- Cards have no column headers: the Sort select is in the Filters sheet on a phone (LC-04, #1041). -->
        <mf-phone-sort
          mfSheetSort
          [sort]="sort()"
          [dir]="dir()"
          [options]="phoneSorts"
          [defaultOrder]="defaultOrderRule"
          (sortPick)="pickSort($event)"
        />
        <mf-sorted-line
          mfBarEnd
          [field]="sort()"
          [dir]="dir()"
          [labels]="sortLabels"
          defaultText="Priority, most urgent first"
          [rule]="defaultOrderRule"
          (resetSort)="resetSort()"
        />
        <div mfBulk class="st-selbar" role="region" aria-label="Selected tasks" data-selection-bar>
          <span data-selection-count>{{ selected().size }} selected</span>
          @if (canAssign()) {
            <button
              type="button"
              class="mf-btn"
              data-bulk="assign"
              [disabled]="selected().size === 0"
              (click)="openBulk('assign')"
            >
              Re-assign...
            </button>
          }
          @if (canPrioritise()) {
            <button
              type="button"
              class="mf-btn"
              data-bulk="priority"
              [disabled]="selected().size === 0"
              (click)="openBulk('priority')"
            >
              Set priority...
            </button>
          }
          @if (canLinkProject()) {
            <mf-dropdown
              buttonId="st-link-project"
              label="Project"
              prefix="Link to:"
              size="sm"
              placeholder="Choose project"
              [items]="linkItems()"
              [value]="linkTarget()"
              (valueChange)="linkTarget.set($event)"
              [neutralValue]="null"
              [panelWidth]="260"
            />
            <button
              type="button"
              class="mf-btn"
              data-bulk="link"
              [attr.aria-disabled]="
                selected().size === 0 || linkTarget() === '' || linking() ? 'true' : null
              "
              (click)="linkSelected()"
            >
              {{ linkTarget() === NO_PROJECT ? 'Unlink' : 'Link to Project' }}
            </button>
          }
          <button
            type="button"
            class="mf-btn"
            data-selection-clear
            [disabled]="selected().size === 0"
            (click)="clearSelection()"
          >
            Clear Selection
          </button>
          <button type="button" class="mf-btn" data-selection-done (click)="endSelecting()">
            Done
          </button>
          <span class="st-selnote" role="status" data-selection-note>{{ selectionNote() }}</span>
        </div>
      </mf-list-toolbar>

      <!-- The line only the printed page shows (the same shared line as the Task Queue: page, sort, place in the list, day and time printed; #1230). -->
      <mf-print-line
        [name]="printName()"
        [sort]="sort()"
        [dir]="dir()"
        [total]="total()"
        [page]="page()"
        [pageSize]="pageSize()"
      />

      @if (selecting()) {
        <mf-task-select-list
          [rows]="rows()"
          [selected]="selected()"
          [phone]="phone()"
          label="Tasks of this matter, select tasks"
          (pick)="toggleRow($event.row, $event.on)"
          (toggleAll)="toggleAll($event)"
        />
      } @else {
        <mf-task-table
          [rows]="rows()"
          [columns]="columns()"
          [reorderable]="true"
          (columnMoved)="onColumnMoved($event)"
          [caption]="caption()"
          [hideContext]="true"
          [canMoveProject]="canLinkProject()"
          (moveProject)="openMove($event)"
          [origin]="projectId() === null ? 'matter' : 'project'"
          [phoneCards]="true"
          [rowList]="rowList()"
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
          (rowChange)="replaceRow($event)"
        />
      }
      @if (rows().length > 0) {
        <div mfPageFooter>
          <mf-pager
            [page]="page()"
            [pageSize]="pageSize()"
            [pageSizes]="pageSizes"
            [total]="total()"
            (pageChange)="goTo($event)"
            (pageSizeChange)="setPageSize($event)"
          />
        </div>
      }
      <mf-move-task-dialog
        [task]="moveTarget()"
        [projects]="rowProjectChoices()"
        [busy]="moving()"
        [error]="moveError()"
        [(visible)]="moveOpen"
        (moved)="moveTask($event)"
      />
      <mf-bulk-tasks-dialog
        [mode]="bulkMode()"
        [matterId]="matterId()"
        [targets]="targets()"
        [(visible)]="bulkOpen"
        (finished)="bulkFinished($event)"
      />
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
  /** False where the page header already offers the one Create Task button (a Project's page, UXR-40); the Matter's Tasks tab shows "New Task" in its toolbar (decision AR 8). */
  readonly showCreate = input(true);
  /** How many projects the matter has: the Project column and filter are offered only when it is above zero (unknown shows them). */
  readonly projectCount = input<number | null>(null);
  /** False while the grid is kept mounted but hidden (the Project's Details tab): it then offers no "Skip to task list". */
  readonly skipLink = input(true);
  /** Counts up each time the page asks for selection mode (the matter's "Bulk re-assign / re-prioritise" while this tab is already open). */
  readonly startSelecting = input(0);
  /** The record's open-task count, each time the summary strip has it (Open, whatever the grid shows). */
  readonly opened = output<number>();
  /** Each time a load succeeds: how many tasks match, and whether the person (not just the default open-status view) narrowed the list. */
  readonly loaded = output<{ total: number; filtered: boolean }>();

  private static nextId = 0;
  protected readonly filterRowId = `scoped-task-filter-${ScopedTasks.nextId++}`;

  private readonly api = inject(TaskQueueClient);
  private readonly bulkApi = inject(MatterBulkTasksClient);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly choices = inject(QueueChoices);
  private readonly widthStore = inject(WorkWidths);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly pageSize = signal(PAGE_SIZE);
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly sortLabels = SORT_LABELS;
  protected readonly defaultOrderRule =
    'Default order: Priority, then ASAP first, then due date, then oldest';
  protected readonly phone = phoneCards();
  /** The sorts the Matter Tasks columns offer (the same values as the header clicks), for the phone's Sort select. */
  protected readonly phoneSorts: readonly SortOption[] = [
    'priority',
    'due',
    'created',
    'number',
    'status',
    'title',
    'assignee',
  ].map((value) => ({
    value,
    label: SORT_LABELS[value] ?? value,
    descFirst: value === 'created',
  }));

  // --- bulk change (epic #667, #699) ---------------------------------------------------------------------------------------------
  /** Selection mode: the grid becomes a list with a checkbox per open task. */
  protected readonly selecting = signal(false);
  protected readonly selected = signal<ReadonlySet<number>>(new Set<number>());
  /** The tasks ticked so far, kept across pages and filters so the result list can name them. */
  private readonly picked = new Map<number, BulkTarget>();
  protected readonly bulkOpen = signal(false);
  private readonly selectList = viewChild(TaskSelectList, { read: ElementRef });
  private bulkWasOpen = false;
  protected readonly bulkMode = signal<BulkMode>('assign');
  protected readonly selectionNote = signal('');
  protected readonly canAssign = computed(() => this.auth.has('Task.Assign'));
  protected readonly canPrioritise = computed(() => this.auth.has('Task.SetPriority'));
  protected readonly canBulk = computed(
    () => this.canView() && (this.canAssign() || this.canPrioritise() || this.canLinkProject()),
  );
  // --- link to a project (MD-05): the ticked tasks move into one project of the matter, or out of their project ---
  protected readonly NO_PROJECT = NO_PROJECT;
  protected readonly linkTarget = signal('');
  protected readonly linking = signal(false);
  /** Linking needs Task.Edit and a Matter's grid that has projects to link to (a Project's own grid has none). */
  protected readonly canLinkProject = computed(
    () =>
      this.canView() &&
      this.auth.has('Task.Edit') &&
      this.projectId() === null &&
      this.projectOptions().length > 0,
  );
  /** The choices of the "Move to Project" dialog (needs Task.Edit and a Matter's grid with projects): "No Project" first, then the matter's projects. */
  protected readonly rowProjectChoices = computed<DropdownItem[]>(() =>
    this.canLinkProject()
      ? [
          { value: '', label: 'No Project' },
          ...this.projectOptions().map((o) => ({ value: o.value, label: o.label })),
        ]
      : [],
  );
  protected readonly linkItems = computed<DropdownItem[]>(() => [
    ...this.projectOptions().map((o) => ({ value: o.value, label: o.label })),
    { value: NO_PROJECT, label: 'No Project (unlink)' },
  ]);
  protected readonly targets = computed<BulkTarget[]>(() =>
    [...this.selected()].map(
      (id) => this.picked.get(id) ?? { taskId: id, taskNumber: `Task ${id}`, title: '' },
    ),
  );
  protected readonly canView = computed(() => this.auth.has('Task.View'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly page = signal(1);
  protected readonly sort = signal<string | null>(null);
  protected readonly dir = signal<'asc' | 'desc' | null>(null);
  protected readonly rows = signal<TaskQueueRow[]>([]);
  protected readonly total = signal(0);
  /** The pressed summary view (`?view=`), or null for the open list; an unknown value is ignored. */
  protected readonly view = computed(() => parseScopedView(this.filters.params().get('view')));
  /** Changes after an inline edit, so the strip asks for its numbers again. */
  protected readonly stripReload = signal(0);
  /** The Project column is for a Matter that has projects; a Project's own grid never has it. */
  private readonly withProject = computed(
    () => this.projectId() === null && (this.projectCount() ?? 1) > 0,
  );
  /**
   * The columns this grid may have (MD-28/MD-29): the default order is Ref, Type, Title, Priority, Assignee, Due, Status (Project and Progress are in the Columns menu, off by default so every cell is whole at 1366, #1154, #1176). Project is
   * shown for a Matter that has projects (a Matter without any has nothing to choose, so the column is left out) and can be hidden in the Columns menu; Ref is pinned first and Title cannot be hidden.
   */
  protected readonly gridDefs = computed((): GridColumnDef[] => [
    { key: 'ref', label: 'Ref', locked: true, pinned: true },
    { key: 'typeChip', label: 'Type' },
    { key: 'title', label: 'Title', locked: true },
    // Off by default so Title, Priority, Assignee, Due and Status are whole at 1366 (1176); one click away in Columns.
    ...(this.withProject() ? [{ key: 'project', label: 'Project', defaultHidden: true }] : []),
    { key: 'priority', label: 'Priority' },
    { key: 'assignee', label: 'Assignee' },
    { key: 'due', label: 'Due' },
    { key: 'status', label: 'Status' },
    { key: 'steps', label: 'Progress', defaultHidden: true },
  ]);
  protected readonly prefs = signal<GridPrefs>(DEFAULT_GRID_PREFS);
  private readonly prefsKey = computed(() =>
    gridPrefsKey(this.widthScope(), this.auth.profile()?.userId),
  );
  protected readonly columns = computed(() => shownKeys(this.gridDefs(), this.prefs()));

  protected setPrefs(next: GridPrefs): void {
    this.prefs.set(next);
    saveGridPrefs(this.prefsKey(), next);
  }

  protected resetPrefs(): void {
    this.prefs.set(DEFAULT_GRID_PREFS);
    clearGridPrefs(this.prefsKey());
  }

  /** A header was dragged: the column lands before the one it was dropped on. */
  protected onColumnMoved(move: ColumnMove): void {
    this.setPrefs({
      order: moveBefore(this.gridDefs(), this.prefs(), move.key, move.beforeKey),
      visible: this.prefs().visible,
    });
  }
  /** Where the widths of this grid are remembered (#203): one scope for every Matter's Tasks tab, one for every Project's list. */
  private readonly widthScope = computed(() =>
    this.projectId() === null ? 'matterTasks' : 'projectTasks',
  );
  protected readonly colWidths = computed<ColumnWidthMap>(() => ({
    ...Object.fromEntries(Object.entries(DEFAULT_WIDTHS_PX).map(([k, px]) => [k, pxToRem(px)])),
    ...this.widthStore.widths(this.widthScope(), this.auth.profile()?.userId ?? null),
  }));
  protected readonly printName = computed(() =>
    this.projectId() === null ? 'Matter Tasks' : 'Project Tasks',
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

  /** A pressed summary view decides Status (and Due for Due soon) itself: the control shows what it set and is not sent (like a tab-owned filter). */
  private ownedBy(key: 'status' | 'due'): Pick<FilterDef, 'disabledReason' | 'fixedValue'> {
    const owns = (): ReturnType<typeof parseScopedView> => {
      const v = this.view();
      return scopedViewOwns(v).includes(key) ? v : null;
    };
    return {
      disabledReason: () => {
        const v = owns();
        return v === null ? null : `Set by the ${SCOPED_VIEW_NAMES[v]} view above.`;
      },
      fixedValue: () => {
        const v = owns();
        return v === null ? null : (VIEW_FIXED[v][key] ?? null);
      },
    };
  }

  private readonly defs = computed((): FilterDef[] => {
    const lookups = this.lookups;
    const defs: FilterDef[] = [
      {
        key: 'q',
        label: 'Title or Ref',
        placeholder: 'Title or ref',
        column: 'ref',
        type: 'text',
        search: true,
      },
      ...(this.withProject()
        ? ([
            {
              key: 'project',
              label: 'Project',
              column: 'project',
              type: 'select',
              allLabel: 'All Projects',
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
        ...this.ownedBy('due'),
      },
      {
        key: 'status',
        label: 'Status',
        column: 'status',
        type: 'multiSelect',
        default: OPEN_STATUSES,
        ...this.ownedBy('status'),
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
  protected readonly filterKey = computed(
    () => JSON.stringify(this.filters.queryParams()) + '|' + (this.view() ?? ''),
  );

  protected readonly emptyText = computed(() => {
    const view = this.view();
    if (view) return VIEW_EMPTY[view];
    const status = this.filters.list('status');
    return status.length === OPEN_STATUSES.length && status.every((s) => OPEN_STATUSES.includes(s))
      ? 'No open tasks.'
      : 'No tasks yet.';
  });

  /** The list id of its rows for Back (`mfRowLink`): the Task page returns here and focuses the title link that was left (T9, #324). */
  protected readonly rowList = computed(() =>
    this.projectId() === null ? 'matter-tasks' : 'project-tasks',
  );

  private requestId = 0;

  constructor() {
    // The person's order and visibility of this grid (per user and grid; read again when the user or the grid changes).
    effect(() => {
      const key = this.prefsKey();
      untracked(() => this.prefs.set(loadGridPrefs(key)));
    });
    // Selection mode on request: from another page's quick action (router state, never the address) and from the page this tab is on.
    if (typeof history !== 'undefined' && history.state?.['selectTasks'] === true) {
      untracked(() => this.selecting.set(this.canBulk()));
    }
    effect(() => {
      if (this.startSelecting() > 0) untracked(() => this.selecting.set(this.canBulk()));
    });
    // When the bulk dialog closes, focus goes to the grid (the list of tasks), not back to a button that may now be disabled.
    effect(() => {
      const open = this.bulkOpen();
      untracked(() => {
        if (this.bulkWasOpen && !open) this.focusGrid();
        this.bulkWasOpen = open;
      });
    });
    // An empty, filtered grid has its own Clear filters button: the bar then shows none (one Clear filters at a time).
    effect(() =>
      this.filters.emptyClear.set(
        this.state() === 'ready' && this.rows().length === 0 && this.filters.activeCount() > 0,
      ),
    );
    restoreRowFocus(
      () => this.rowList(),
      () => this.state() === 'ready',
    );
    // The first Tab stop of the page (#283): "Skip to task list" moves to the first task, as on the work pages (#181).
    const skip = inject(SkipTarget);
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    effect((onCleanup) => {
      if (!this.skipLink() || !this.canView()) return;
      onCleanup(
        skip.register({
          label: 'Skip to Task List',
          element: host.nativeElement,
          focus: () =>
            (
              host.nativeElement.querySelector<HTMLElement>('tbody a.wt-title, [data-task] a') ??
              host.nativeElement.querySelector<HTMLElement>('.wt-wrap')
            )?.focus(),
        }),
      );
    });
    // The priority and status lookups need Task.View; without it the grid is a notice and asks for nothing (no 403 toast).
    if (this.canView()) void this.lookups.ensureLoaded();
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

  /** A strip item: it applies its view to the grid (replacing another), the pressed one and Open switch it off; sort and filters stay. */
  protected pickView(key: string): void {
    const next = key === 'open' || key === this.view() ? null : parseScopedView(key);
    void this.router.navigate([], {
      queryParams: { view: next },
      queryParamsHandling: 'merge',
    });
  }

  private focusGrid(): void {
    const put = (): void => this.selectList()?.nativeElement.focus({ preventScroll: true });
    put();
    // The closing dialog keeps its focus trap until its leave animation ends: once more when the page has it back.
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('.p-dialog-mask')) put();
    }, 350);
  }

  protected toggleRow(row: TaskQueueRow, on: boolean): void {
    const next = new Set(this.selected());
    if (on) {
      if (next.size >= BULK_MAX && !next.has(row.taskId)) {
        this.selectionNote.set(`You can select at most ${BULK_MAX} tasks at once.`);
        this.selected.set(next); // re-emit so the box the person just ticked goes back to unticked
        return;
      }
      next.add(row.taskId);
      this.picked.set(row.taskId, {
        taskId: row.taskId,
        taskNumber: row.taskNumber,
        title: row.title,
      });
    } else {
      next.delete(row.taskId);
    }
    this.selectionNote.set('');
    this.selected.set(next);
  }

  protected toggleAll(on: boolean): void {
    const next = new Set(this.selected());
    let capped = false;
    for (const row of this.rows().filter(isBulkEditable)) {
      if (!on) {
        next.delete(row.taskId);
      } else if (next.size < BULK_MAX || next.has(row.taskId)) {
        next.add(row.taskId);
        this.picked.set(row.taskId, {
          taskId: row.taskId,
          taskNumber: row.taskNumber,
          title: row.title,
        });
      } else {
        capped = true;
      }
    }
    this.selectionNote.set(capped ? `You can select at most ${BULK_MAX} tasks at once.` : '');
    this.selected.set(next);
  }

  protected clearSelection(): void {
    this.selected.set(new Set<number>());
    this.picked.clear();
    this.selectionNote.set('');
  }

  protected endSelecting(): void {
    this.selecting.set(false);
    this.clearSelection();
  }

  // --- "Move to Project" of a row (#1273): a small dialog, the same call as before ---
  protected readonly moveOpen = signal(false);
  protected readonly moveTarget = signal<(MoveTarget & { row: TaskQueueRow }) | null>(null);
  protected readonly moving = signal(false);
  protected readonly moveError = signal('');

  protected openMove(row: TaskQueueRow): void {
    this.moveError.set('');
    this.moveTarget.set({
      taskId: row.taskId,
      taskNumber: row.taskNumber,
      title: row.title,
      projectId: row.projectId ?? null,
      row,
    });
    this.moveOpen.set(true);
  }

  /** The dialog's Move Task: the task moves into the project (or out of its project); the row shows the new project at once. */
  protected async moveTask(projectId: number | null): Promise<void> {
    const target = this.moveTarget();
    if (!target || this.moving() || (target.projectId ?? null) === projectId) return;
    this.moving.set(true);
    this.moveError.set('');
    try {
      const answer = await firstValueFrom(
        this.bulkApi.setMatterTasksProject(this.matterId(), {
          taskIds: [target.taskId],
          projectId: projectId ?? undefined,
        }),
      );
      if (answer.failed > 0) {
        this.moveError.set(answer.results[0]?.message || "Couldn't change the project.");
        return;
      }
      const name = this.projectOptions().find((o) => o.value === String(projectId))?.label;
      this.replaceRow({
        ...target.row,
        projectId: projectId ?? undefined,
        projectName: projectId === null ? undefined : name,
      });
      this.moveOpen.set(false);
      this.notify.success(
        'Task moved',
        name
          ? `${target.taskNumber} is in ${name}.`
          : `${target.taskNumber} is no longer in a project.`,
      );
    } catch {
      // The HTTP layer already told the person; the dialog stays open so the pick can be tried again.
    } finally {
      this.moving.set(false);
    }
  }

  protected async linkSelected(): Promise<void> {
    const target = this.linkTarget();
    if (this.selected().size === 0 || target === '' || this.linking()) return;
    this.linking.set(true);
    try {
      const answer = await firstValueFrom(
        this.bulkApi.setMatterTasksProject(this.matterId(), {
          taskIds: [...this.selected()],
          projectId: target === NO_PROJECT ? undefined : Number(target),
        }),
      );
      this.bulkFinished(answer);
      if (answer.failed > 0) {
        this.notify.warn(
          `${answer.changed} tasks changed`,
          `${answer.failed} could not be changed.`,
        );
      } else {
        this.notify.success(
          target === NO_PROJECT
            ? `${answer.changed} tasks unlinked`
            : `${answer.changed} tasks linked to the project`,
        );
      }
    } finally {
      this.linking.set(false);
    }
  }

  protected openBulk(mode: BulkMode): void {
    if (this.selected().size === 0) return;
    this.bulkMode.set(mode);
    this.bulkOpen.set(true);
  }

  /** The run finished: what was changed leaves the selection, what was not stays ticked, the grid and the strip read again. */
  protected bulkFinished(answer: BulkTasksResponse): void {
    const next = new Set(this.selected());
    for (const r of answer.results) {
      if (r.ok) {
        next.delete(r.taskId);
        this.picked.delete(r.taskId);
      }
    }
    this.selected.set(next);
    this.selectionNote.set('');
    this.stripReload.update((n) => n + 1);
    void this.load();
  }

  /** An inline edit in the grid: the row stays as it is now and the strip asks for its numbers again. */
  protected replaceRow(row: TaskQueueRow): void {
    this.rows.update((rows) => rows.map((r) => (r.taskId === row.taskId ? row : r)));
    this.stripReload.update((n) => n + 1);
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

  /** The phone's Sort select: a field and a direction like a header click, or null for the default order. */
  protected pickSort(choice: SortChoice | null): void {
    if (!choice) {
      this.resetSort();
      return;
    }
    this.sort.set(choice.field);
    this.dir.set(choice.dir);
    this.page.set(1);
    void this.load();
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

  protected resetSort(): void {
    this.sort.set(null);
    this.dir.set(null);
    this.page.set(1);
    void this.load();
  }

  protected setPageSize(size: number): void {
    this.pageSize.set(size);
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
      const view = this.view();
      const request = queueArgs({
        ...parsed,
        filters: {
          ...parsed.filters,
          status: [...status],
          // A pressed summary view is the Task Queue's quick view of the same name, so its total is the strip number.
          ...(view
            ? scopedViewFilters(view, dateDaysAgo(this.clock.now(), -DUE_SOON_DAYS, this.zone))
            : {}),
          matter: this.matterId(),
          project: this.projectId() ?? parsed.filters.project,
        },
        sort: this.sort(),
        dir: this.dir(),
        page: this.page(),
        pageSize: this.pageSize(),
      });
      const page = await firstValueFrom(this.api.getTaskQueue(undefined, ...request));
      if (id !== this.requestId) return;
      this.rows.set(page.items);
      this.total.set(page.total);
      this.state.set('ready');
      this.filters.reportResults(page.total);
      this.loaded.emit({
        total: page.total,
        filtered: this.filters.activeCount() > 0 || view !== null,
      });
      this.choices.ensure();
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }
}
