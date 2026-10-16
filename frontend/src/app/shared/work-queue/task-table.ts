import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  effect,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LoadState } from '../ui/data-table';
import { ScrollArea } from '../ui/fixed-page';
import { ColumnFilterRow } from '../filters/column-filter-row';
import { ListFilters } from '../filters/list-filters';
import { GridBody } from '../ui/grid-body';
import { TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { mfDate } from '../../core/time/time';
import { TaskTypeIcon } from '../icons/task-type-icon';
import { DueStatePipe } from '../pipes/due-label.pipe';
import { MfDatePipe } from '../pipes/mf-date.pipe';
import { MatterRef } from '../ui/matter-ref';
import { PriorityBadge } from '../ui/priority-badge';
import { StatusBadge } from '../ui/status-badge';
import { WORK_COLUMNS, ColumnDef, Density } from './column-prefs';
import { InlineField, canEditField } from './inline-edit';
import { SortDirection } from './queue-filters';
import { RowEdit } from './row-edit';

/** Box widths (px) under which the lowest-priority columns drop out. */
const PROGRESS_FOLDS_BELOW = 1060;
const MATTER_HIDES_BELOW = 960;
const PROJECT_HIDES_BELOW = 800;

/**
 * The table behind Task Queue, My Work and Pod Work (UX 5.2, S02 to S04): a real `<table>` with sortable header buttons that
 * announce `aria-sort`, a due cell that never relies on color alone (ASAP label with a bolt icon, "Overdue 4d" with an alert icon, "Due today"
 * with a clock icon, "Tomorrow"), a sensitive-matter marker, and five skeleton rows while loading. The title opens the Task. Status, Priority and Assignee are inline editors for users who may change them (`mf-row-edit`).
 */
@Component({
  selector: 'mf-task-table',
  imports: [
    TaskTypeIcon,
    RouterLink,
    MatterRef,
    DueStatePipe,
    MfDatePipe,
    PriorityBadge,
    RowEdit,
    ScrollArea,
    StatusBadge,
    GridBody,
    ColumnFilterRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: './task-table.scss',
  template: `
    <p class="wt-hint" data-scroll-hint [class.wt-hint--show]="overflowing()">
      Scroll sideways to see every column.
    </p>
    <div
      #wrap
      class="wt-wrap"
      [mfScrollArea]="listLabel()"
      [resetKey]="resetKey()"
      [class.wt-dim]="loading() && rows().length > 0"
    >
      <table
        class="wt"
        [class.wt--compact]="density() === 'compact'"
        [attr.aria-busy]="loading() ? 'true' : null"
      >
        <caption class="wt-sr">
          {{
            caption()
          }}
        </caption>
        <thead>
          <tr>
            @for (col of shownColumns(); track col.key) {
              <th scope="col" [attr.aria-sort]="ariaSort(col)" [attr.data-col]="col.key">
                @if (col.sortField) {
                  <button type="button" class="wt-sort" (click)="sortChange.emit(col.sortField)">
                    {{ col.label }}
                    <i class="pi" [class]="sortIcon(col)" aria-hidden="true"></i>
                  </button>
                } @else {
                  {{ col.label }}
                }
              </th>
            }
            @if (showAssign()) {
              <th scope="col" class="wt-actions">Actions</th>
            }
          </tr>
          @if (filters(); as f) {
            @if (f.rowVisible()) {
              <tr
                mfColumnFilterRow
                [id]="filterRowId()"
                [filters]="f"
                [columns]="filterColumns()"
              ></tr>
            }
          }
        </thead>
        <!-- The headers and the filter row stay in every state: loading, error and empty are rows of the body. -->
        <tbody
          mfGridBody
          noun="tasks"
          [state]="gridState()"
          [empty]="rows().length === 0"
          [filtered]="filtered()"
          [emptyText]="emptyText()"
          [columns]="columnCount()"
          (retry)="retry.emit()"
          (clear)="clearFilters.emit()"
        >
          @for (row of rows(); track row.taskId) {
            <tr [class.wt-row--overdue]="row.isOverdue" [attr.data-task]="row.taskNumber">
              @for (col of shownColumns(); track col.key) {
                <td [attr.data-col]="col.key">
                  @switch (col.key) {
                    @case ('ref') {
                      <span class="wt-mono">{{ row.taskNumber }}</span>
                    }
                    @case ('title') {
                      <div class="wt-titlecell">
                        <span class="wt-typeicon" [attr.title]="row.taskTypeName" data-type-icon>
                          <mf-task-type-icon [iconKey]="row.taskTypeIconKey" size="sm" />
                        </span>
                        <div class="wt-titlebody">
                          <a
                            class="wt-title"
                            [routerLink]="['/tasks', row.taskId]"
                            [attr.title]="row.title"
                            >{{ row.title }}</a
                          >
                          @if (isNew(row) || !hideContext() || foldProgress()) {
                            <span class="wt-subline">
                              @if (isNew(row)) {
                                <span
                                  class="wt-new"
                                  data-new-marker
                                  title="Assigned since your last visit"
                                  >New</span
                                >
                              }
                              @if (!hideContext()) {
                                <span
                                  class="wt-sub"
                                  data-title-context
                                  [attr.title]="row.clientName + ' / ' + row.matterName"
                                  >{{ row.clientName }} · {{ row.matterName }}</span
                                >
                              }
                            </span>
                          }
                          @if (foldProgress() && row.workflow.stepsTotal > 0) {
                            <span
                              class="wt-sub wt-stepline"
                              data-title-progress
                              [attr.title]="progressTitle(row)"
                              >{{ row.workflow.stepsResolved }} of {{ row.workflow.stepsTotal }}
                              steps ·
                              {{ row.workflow.currentStepName ?? 'All steps resolved' }}</span
                            >
                          }
                        </div>
                      </div>
                    }
                    @case ('matter') {
                      <mf-matter-ref
                        [value]="row.matterRef"
                        [link]="['/matters', row.matterId]"
                        [copy]="false"
                        [hint]="row.matterName"
                      />
                      @if (row.matterIsSensitive) {
                        <i
                          class="pi pi-exclamation-triangle wt-sensitive"
                          role="img"
                          aria-label="Sensitive matter"
                          title="Sensitive matter"
                        ></i>
                      }
                    }
                    @case ('client') {
                      {{ row.clientName }}
                    }
                    @case ('project') {
                      {{ row.projectName ?? '-' }}
                    }
                    @case ('type') {
                      {{ row.taskTypeName }}
                    }
                    @case ('workflow') {
                      {{ row.workflowName }}
                    }
                    @case ('progress') {
                      @if (row.workflow.stepsTotal === 0) {
                        -
                      } @else {
                        <div class="wt-progress" [attr.title]="progressTitle(row)">
                          <span class="wt-progress-line">
                            <progress
                              [max]="row.workflow.stepsTotal"
                              [value]="row.workflow.stepsResolved"
                              [attr.aria-label]="
                                row.workflow.stepsResolved +
                                ' of ' +
                                row.workflow.stepsTotal +
                                ' steps resolved'
                              "
                            ></progress>
                            <span class="wt-progress-count"
                              >{{ row.workflow.stepsResolved }} of
                              {{ row.workflow.stepsTotal }}</span
                            >
                          </span>
                          <span class="wt-progress-step wt-muted">{{
                            row.workflow.currentStepName ?? 'All steps resolved'
                          }}</span>
                        </div>
                      }
                    }
                    @case ('priority') {
                      @if (editable('priority', row)) {
                        <mf-row-edit
                          field="priority"
                          [row]="row"
                          (rowChange)="rowChange.emit($event)"
                        />
                      } @else {
                        <mf-priority-badge
                          [priorityId]="row.priority.priorityId"
                          [label]="row.priority.label"
                          [color]="row.priority.color"
                        />
                      }
                    }
                    @case ('pod') {
                      @if (row.assignedPod; as pod) {
                        <span class="wt-clip" [attr.title]="pod.name">{{ pod.name }}</span>
                      } @else {
                        <span class="wt-muted">No pod</span>
                      }
                    }
                    @case ('assignee') {
                      @if (editable('assignee', row)) {
                        <mf-row-edit
                          field="assignee"
                          [row]="row"
                          (rowChange)="rowChange.emit($event)"
                        />
                      } @else if (row.assignedUser; as user) {
                        <span class="wt-clip" [attr.title]="user.displayName">
                          {{ user.displayName }}
                          @if (!user.isActive) {
                            <span class="wt-muted">(inactive)</span>
                          }
                        </span>
                      } @else {
                        <span class="wt-unassigned">Unassigned</span>
                      }
                    }
                    @case ('creator') {
                      {{ row.createdBy?.displayName ?? '-' }}
                    }
                    @case ('requestor') {
                      {{ row.requestorName }}
                    }
                    @case ('due') {
                      @let due = row | dueState: row.status;
                      @if (due.kind === 'asap') {
                        <span class="wt-asap" [title]="due.tooltip">
                          <i class="pi pi-bolt" aria-hidden="true"></i>ASAP
                        </span>
                      } @else if (row.isOverdue || due.kind === 'overdue') {
                        <span class="wt-due wt-due--overdue">
                          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                          {{ due.dateText }} · <strong>{{ due.badge ?? 'Overdue' }}</strong>
                        </span>
                      } @else if (due.daysUntil === 0) {
                        <span class="wt-due wt-due--soon">
                          <i class="pi pi-clock" aria-hidden="true"></i>
                          {{ due.dateText }} · <strong>Due today</strong>
                        </span>
                      } @else if (due.daysUntil === 1) {
                        <span class="wt-due">{{ due.dateText }} · <strong>Tomorrow</strong></span>
                      } @else {
                        <span class="wt-due" [class.wt-due--closed]="due.kind === 'closed'">{{
                          due.dateText
                        }}</span>
                      }
                    }
                    @case ('status') {
                      @if (editable('status', row)) {
                        <mf-row-edit
                          field="status"
                          [row]="row"
                          (rowChange)="rowChange.emit($event)"
                        />
                      } @else {
                        <mf-status-badge [code]="row.status" [label]="row.statusLabel" />
                      }
                    }
                    @case ('age') {
                      {{ ageDays(row) }}d
                    }
                    @case ('created') {
                      {{ dayOf(row.createdAtUtc) }}
                    }
                    @case ('updated') {
                      {{ row.updatedAtUtc | mfDate }}
                    }
                  }
                </td>
              }
              @if (showAssign()) {
                <td class="wt-actions">
                  @if (canAssign(row)) {
                    <button
                      type="button"
                      class="wt-action"
                      (click)="assignToMe.emit(row)"
                      [attr.aria-label]="'Assign to me, ' + row.taskNumber"
                    >
                      Assign to me
                    </button>
                  }
                </td>
              }
            </tr>
          }
          <span mfEmptyAction><ng-content select="[empty-action]" /></span>
        </tbody>
      </table>
    </div>
  `,
})
export class TaskTable {
  private readonly clock = inject(Clock);
  private readonly auth = inject(AuthStore);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly wrap = viewChild<ElementRef<HTMLElement>>('wrap');

  /** Width of the table's box in px (0 until measured); narrow boxes drop the lowest-priority columns instead of scrolling. */
  protected readonly boxWidth = signal(0);

  /** True while the table is wider than its box, so the "Scroll sideways" hint only appears when it is needed (UAT2-21). */
  protected readonly overflowing = signal(false);

  readonly rows = input.required<readonly TaskQueueRow[]>();
  /** Keys of the columns to show, in table order. */
  readonly columns = input.required<readonly string[]>();
  readonly caption = input('Tasks');
  /** Anything that changes the rows without a navigation (a local page, sort or filter): the grid goes back to the top. */
  readonly resetKey = input<unknown>(undefined);
  /** The scrolling region's name: "Task Queue list". */
  protected readonly listLabel = computed(() => `${this.caption()} list`);
  /** loading: skeleton text row (dimmed rows while refreshing); error: the error row; ready: the rows or the empty row. */
  readonly state = input<LoadState>('ready');
  /** The column filters; the row shows under the headers while it is open. */
  readonly filters = input<ListFilters | null>(null);
  readonly filterRowId = input('work-filter-row');
  /** True while a filter is active: an empty list then says "No tasks match these filters". */
  readonly filtered = input(false);
  readonly emptyText = input('No tasks yet.');
  readonly density = input<Density>('comfortable');
  /** Current API sort field; null shows no sort indicator (the default order applies). */
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  /** Adds an "Assign to me" action to unassigned open rows. */
  readonly showAssign = input(false);
  /** Instant (ms) of the user's previous visit; tasks created after it get a "New" marker. Null shows no markers (My Work only). */
  readonly newSince = input<number | null>(null);
  /** Leave out the "Client · Matter" line under the title: on a Matter's or Project's own page the header already says it. */
  readonly hideContext = input(false);

  readonly sortChange = output<string>();
  readonly retry = output<void>();
  readonly clearFilters = output<void>();
  /** The keys of the columns that are on screen now (the table folds some away on a narrow window). */
  readonly columnsShown = output<string[]>();
  readonly assignToMe = output<TaskQueueRow>();
  /** A row changed from the table (an inline edit): the optimistic row, then the server's row or the original again. */
  readonly rowChange = output<TaskQueueRow>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const keys = this.shownKeys();
      this.columnsShown.emit(keys === '' ? [] : keys.split(','));
    });
    afterNextRender(() => {
      const el = this.wrap()?.nativeElement;
      if (!el) return;
      const measure = () => {
        this.boxWidth.set(el.clientWidth);
        this.overflowing.set(el.scrollWidth > el.clientWidth + 1);
      };
      measure();
      // Where the grid overflows sideways the filters move into the sheet.
      this.filters()?.watchOverflow(el);
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      const table = el.querySelector('table');
      if (table) observer.observe(table);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected readonly loading = computed(() => this.state() === 'loading');
  /** Rows kept while a refresh runs or fails are shown dimmed; the body states only replace an empty list. */
  protected readonly gridState = computed<LoadState>(() => {
    const state = this.state();
    return this.rows().length > 0 ? 'ready' : state;
  });
  /**
   * Columns in table order. Below the width thresholds the lowest-priority columns drop out so Status and Due never scroll out of view
   * (UXR4-02): Workflow progress moves under the title below 1100 px, the Matter column goes below 960 px (the line under the title
   * still names the client and matter) and Project below 800 px. Unknown width (0, before the first measure or in tests) shows everything.
   */
  protected readonly shownColumns = computed<ColumnDef[]>(() => {
    const wanted = new Set(this.columns());
    const width = this.boxWidth();
    const dropped = new Set<string>();
    if (width > 0 && width < PROGRESS_FOLDS_BELOW) dropped.add('progress');
    if (width > 0 && width < MATTER_HIDES_BELOW && !this.hideContext()) dropped.add('matter');
    if (width > 0 && width < PROJECT_HIDES_BELOW) dropped.add('project');
    return WORK_COLUMNS.filter((c) => c.locked || (wanted.has(c.key) && !dropped.has(c.key)));
  });

  protected readonly columnCount = computed(
    () => this.shownColumns().length + (this.showAssign() ? 1 : 0),
  );
  /** The filter row's cells: the shown columns, and an empty cell for the Actions column. */
  protected readonly filterColumns = computed(() => [
    ...this.shownColumns().map((c) => c.key),
    ...(this.showAssign() ? ['actions'] : []),
  ]);
  private readonly shownKeys = computed(() =>
    this.shownColumns()
      .map((c) => c.key)
      .join(','),
  );

  /** True when the Workflow progress column was asked for but is folded under the title because the table is narrow. */
  protected readonly foldProgress = computed(
    () =>
      this.columns().includes('progress') && !this.shownColumns().some((c) => c.key === 'progress'),
  );

  protected ariaSort(col: ColumnDef): 'ascending' | 'descending' | 'none' | null {
    if (!col.sortField) return null;
    if (this.sort() !== col.sortField) return 'none';
    return this.effectiveDir(col.sortField) === 'desc' ? 'descending' : 'ascending';
  }

  protected sortIcon(col: ColumnDef): string {
    const aria = this.ariaSort(col);
    return aria === 'ascending'
      ? 'pi-sort-amount-up-alt'
      : aria === 'descending'
        ? 'pi-sort-amount-down'
        : 'pi-sort-alt';
  }

  private effectiveDir(field: string): SortDirection {
    return this.dir() ?? (field === 'created' || field === 'completed' ? 'desc' : 'asc');
  }

  protected editable(field: InlineField, row: TaskQueueRow): boolean {
    return canEditField(field, row, (p) => this.auth.has(p));
  }

  protected canAssign(row: TaskQueueRow): boolean {
    return !row.assignedUser && ['NEW', 'IN_PROGRESS', 'ON_HOLD'].includes(row.status);
  }

  protected isNew(row: TaskQueueRow): boolean {
    const since = this.newSince();
    // When the person was handed the Task, not when it was created (a Task created last week and assigned today is new to them).
    return since !== null && new Date(row.assignedAtUtc ?? row.createdAtUtc).getTime() > since;
  }

  protected progressTitle(row: TaskQueueRow): string {
    const w = row.workflow;
    const step = w.currentStepName
      ? `Step ${w.currentStepNumber} of ${w.stepsTotal}: ${w.currentStepName}`
      : 'All steps resolved';
    return `${step} (${w.stepsResolved} of ${w.stepsTotal} resolved)`;
  }

  protected ageDays(row: TaskQueueRow): number {
    return Math.max(
      0,
      Math.floor((this.clock.now().getTime() - new Date(row.createdAtUtc).getTime()) / 86_400_000),
    );
  }

  protected dayOf(instant: string): string {
    return mfDate(instant, this.zone, 'date');
  }
}
