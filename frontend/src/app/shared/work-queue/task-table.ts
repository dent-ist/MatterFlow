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
import { NgTemplateOutlet } from '@angular/common';
import { NavigationEnd, Params, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { DrillReturn, DrillSource } from './drill';
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
import { CopyPart } from '../ui/copy-parts';
import { StatusBadge } from '../ui/status-badge';
import { HoldNote, holdTitle } from './hold-note';
import { WORK_COLUMNS, ColumnDef, Density } from './column-prefs';
import { InlineField, canEditField } from './inline-edit';
import { CLOSED_STATUSES, SortDirection } from './queue-filters';
import { hasStepLink, stepLinkLabel, stepQueryParams } from './step-link';
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
    HoldNote,
    GridBody,
    ColumnFilterRow,
    NgTemplateOutlet,
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
        <caption class="mf-sr-only">
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
          [emptyParts]="emptyParts()"
          [columns]="columnCount()"
          (retry)="retry.emit()"
          (clear)="clearFilters.emit()"
        >
          @for (row of rows(); track row.taskId) {
            <tr
              [class.wt-row--overdue]="row.isOverdue"
              [class.wt-row--leaving]="leaving().has(row.taskId)"
              [attr.data-leaving]="leaving().has(row.taskId) ? 'true' : null"
              [attr.data-task]="row.taskNumber"
            >
              @for (col of shownColumns(); track col.key) {
                <td [attr.data-col]="col.key">
                  @switch (col.key) {
                    @case ('ref') {
                      @if (row.status === 'ON_HOLD') {
                        <mf-hold-note
                          kind="mark"
                          [holdReason]="row.holdReason"
                          [truncated]="row.holdReasonTruncated"
                        />
                      }
                      <span class="wt-mono">{{ row.taskNumber }}</span>
                      @if (isNew(row)) {
                        <span
                          class="wt-newdot"
                          role="img"
                          aria-label="New"
                          title="Assigned since your last visit"
                          data-new-dot
                        ></span>
                      }
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
                            [queryParams]="linkParams()"
                            [state]="linkState()"
                            [attr.data-task-id]="row.taskId"
                            [attr.title]="row.title"
                            (click)="drillOut($event, row)"
                            >{{ row.title }}</a
                          >
                          @if (row.status === 'ON_HOLD' && row.holdReason) {
                            <mf-hold-note
                              kind="hint"
                              [holdReason]="row.holdReason"
                              [truncated]="row.holdReasonTruncated"
                            />
                          }
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
                                <span class="wt-sub" data-title-context [attr.title]="context(row)">
                                  @if (refInSub()) {
                                    @if (auth.canLink('matter')) {
                                      <a
                                        class="wt-mono wt-subref"
                                        data-sub-ref
                                        [routerLink]="['/matters', row.matterId]"
                                        >{{ row.matterRef }}</a
                                      >
                                    } @else {
                                      <span class="wt-mono" data-sub-ref>{{ row.matterRef }}</span>
                                    }
                                    ·
                                  }
                                  {{ row.clientName }} · {{ row.matterName }}</span
                                >
                              }
                            </span>
                          }
                          @if (foldProgress() && row.workflow.stepsTotal > 0) {
                            <span
                              class="wt-sub wt-stepline"
                              data-title-progress
                              [attr.title]="progressTitle(row)"
                              ><ng-container
                                [ngTemplateOutlet]="prog"
                                [ngTemplateOutletContext]="{ $implicit: row }"
                            /></span>
                          }
                        </div>
                      </div>
                    }
                    @case ('matter') {
                      <mf-matter-ref
                        [value]="row.matterRef"
                        [link]="auth.canLink('matter') ? ['/matters', row.matterId] : null"
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
                      <span class="wt-progress" [attr.title]="progressTitle(row)"
                        ><ng-container
                          [ngTemplateOutlet]="prog"
                          [ngTemplateOutletContext]="{ $implicit: row }"
                      /></span>
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
                          [muted]="closed(row)"
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
                      @if (closed(row)) {
                        <span class="wt-due wt-due--closed">{{
                          due.kind === 'asap' ? '-' : due.dateText
                        }}</span>
                      } @else if (due.kind === 'asap') {
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
                      <div [attr.title]="holdTitle(row)">
                        @if (editable('status', row)) {
                          <mf-row-edit
                            field="status"
                            [row]="row"
                            (rowChange)="rowChange.emit($event)"
                          />
                        } @else {
                          <mf-status-badge [code]="row.status" [label]="row.statusLabel" />
                        }
                        @if (row.status === 'ON_HOLD' && row.holdReason) {
                          <mf-hold-note
                            [holdReason]="row.holdReason"
                            [truncated]="row.holdReasonTruncated"
                            [quiet]="density() === 'compact'"
                          />
                        }
                      </div>
                    }
                    @case ('closed') {
                      @if (row.closedAtUtc) {
                        <span class="wt-closed" [attr.title]="closedTitle(row.closedAtUtc)">{{
                          dayOf(row.closedAtUtc)
                        }}</span>
                      } @else {
                        <span aria-label="Not closed">-</span>
                      }
                    }
                    @case ('age') {
                      <span class="wt-age" [attr.title]="ageTitle(row)">{{ ageDays(row) }} d</span>
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
      <ng-template #prog let-row>
        @if (row.workflow.stepsTotal === 0) {
          -
        } @else if (!row.workflow.currentStepName) {
          <span class="wt-muted">All steps resolved</span>
        } @else {
          {{ row.workflow.stepsResolved }} of {{ row.workflow.stepsTotal }} done ·
          @if (stepLinked(row)) {
            <a
              class="wt-steplink"
              data-step-link
              [routerLink]="['/tasks', row.taskId]"
              [queryParams]="stepQuery(row)"
              [state]="linkState()"
              (click)="drillOut($event, row)"
              [attr.aria-label]="stepLabel(row)"
              >{{ row.workflow.currentStepName }}</a
            >
          } @else {
            {{ row.workflow.currentStepName }}
          }
        }
      </ng-template>
      @if (nearEmpty()) {
        <div class="wt-near" role="note" aria-live="polite" data-near-empty>
          <ng-content select="[near-empty]" />
        </div>
      }
    </div>
  `,
})
export class TaskTable {
  private readonly clock = inject(Clock);
  protected readonly auth = inject(AuthStore);
  protected readonly holdTitle = holdTitle;
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly router = inject(Router);
  private readonly drill = inject(DrillReturn);
  /** The address of the list as it is now: the exact view the task page offers to return to. */
  private readonly here = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
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
  /** The empty text with links in it (replaces `emptyText`). */
  readonly emptyParts = input<readonly CopyPart[] | null>(null);
  /** Show the projected `[near-empty]` note directly under the last row. */
  readonly nearEmpty = input(false);
  readonly density = input<Density>('comfortable');
  /** Current API sort field; null shows no sort indicator (the default order applies). */
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  /** Adds an "Assign to me" action to unassigned open rows. */
  readonly showAssign = input(false);
  /** Instant (ms) of the user's previous visit; tasks created after it get a "New" marker. Null shows no markers (My Work only). */
  readonly newSince = input<number | null>(null);
  /** The list the table belongs to: its task links carry `?from=` and the view to return to (M7). Null on record pages. */
  readonly from = input<DrillSource | null>(null);

  protected readonly linkParams = computed(() => (this.from() ? { from: this.from() } : null));
  protected readonly linkState = computed(() =>
    this.from() ? { returnTo: this.here() } : undefined,
  );

  /** A plain click on a title remembers the row, so Back can focus it again. */
  protected drillOut(event: MouseEvent, row: TaskQueueRow): void {
    const from = this.from();
    if (!from || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    this.drill.leave(from, row.taskId);
  }
  /** Leave out the "Client · Matter" line under the title: on a Matter's or Project's own page the header already says it. */
  readonly hideContext = input(false);

  readonly sortChange = output<string>();
  readonly retry = output<void>();
  readonly clearFilters = output<void>();
  /** The keys of the columns that are on screen now (the table folds some away on a narrow window). */
  readonly columnsShown = output<string[]>();
  readonly assignToMe = output<TaskQueueRow>();
  /** A row changed from the table (an inline edit): the optimistic row, then the server's row or the original again. */
  /** Tasks that just left the tab: their rows show muted until the page removes them. */
  readonly leaving = input<ReadonlySet<number>>(new Set());
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
  /** Rows kept while a refresh runs are shown dimmed; loading only replaces an empty list, an error always replaces the rows. */
  protected readonly gridState = computed<LoadState>(() => {
    const state = this.state();
    // A failed load never leaves old rows under the message (G6): the error is the body.
    if (state === 'error') return 'error';
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
    return (
      this.dir() ?? (['created', 'completed', 'closed', 'updated'].includes(field) ? 'desc' : 'asc')
    );
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

  /** The current step is a link to the task's Workflow section for an open task that names its step (M12.3). */
  protected stepLinked(row: TaskQueueRow): boolean {
    return hasStepLink(row);
  }

  protected stepQuery(row: TaskQueueRow): Params {
    const from = this.from();
    return from
      ? { ...stepQueryParams(row.workflow.currentStepId as number), from }
      : stepQueryParams(row.workflow.currentStepId as number);
  }

  protected stepLabel(row: TaskQueueRow): string {
    return stepLinkLabel(row);
  }

  protected progressTitle(row: TaskQueueRow): string {
    const w = row.workflow;
    if (w.stepsTotal === 0) return 'No workflow steps';
    return w.currentStepName
      ? `${w.stepsResolved} of ${w.stepsTotal} steps done. Current step: ${w.currentStepName}`
      : 'All steps resolved';
  }

  protected closed(row: TaskQueueRow): boolean {
    return CLOSED_STATUSES.includes(row.status);
  }

  /** The full line under the title: "46044-00001 · Client · Matter" (the reference only where there is no Matter column). */
  protected context(row: TaskQueueRow): string {
    const text = `${row.clientName} · ${row.matterName}`;
    return this.refInSub() ? `${row.matterRef} · ${text}` : text;
  }

  /** The matter reference leads the line under the title unless the Matter column shows it (A2). */
  protected readonly refInSub = computed(
    () => !this.shownColumns().some((c) => c.key === 'matter'),
  );

  protected ageDays(row: TaskQueueRow): number {
    const end = row.closedAtUtc ? new Date(row.closedAtUtc).getTime() : this.clock.now().getTime();
    return Math.max(0, Math.floor((end - new Date(row.createdAtUtc).getTime()) / 86_400_000));
  }

  /** Age tooltip: when it was created (local zone), and for a closed task how long it took. */
  protected ageTitle(row: TaskQueueRow): string {
    const created = `Created ${mfDate(row.createdAtUtc, this.zone, 'datetime')}`;
    return row.closedAtUtc ? `Took ${this.ageDays(row)} d. ${created}` : created;
  }

  /** The tooltip of a closed date: the time and zone ("Oct 16, 2026, 3:00 PM EDT"). */
  protected closedTitle(instant: string): string {
    return mfDate(instant, this.zone, 'datetime');
  }

  protected dayOf(instant: string): string {
    return mfDate(instant, this.zone, 'date');
  }
}
