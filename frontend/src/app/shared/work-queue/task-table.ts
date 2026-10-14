import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { formatInstantDate } from '../../core/time/time';
import { DueStatePipe } from '../pipes/due-label.pipe';
import { LocalTimePipe } from '../pipes/local-time.pipe';
import { PriorityBadge } from '../ui/priority-badge';
import { StatusBadge } from '../ui/status-badge';
import { WORK_COLUMNS, ColumnDef, Density } from './column-prefs';
import { InlineField, canEditField } from './inline-edit';
import { SortDirection } from './queue-filters';
import { RowEdit } from './row-edit';

const SKELETON_ROWS = [0, 1, 2, 3, 4];

/**
 * The table behind Task Queue, My Work and Pod Work (UX 5.2, S02 to S04): a real `<table>` with sortable header buttons that
 * announce `aria-sort`, a due cell that never relies on color alone (ASAP pill, "Overdue 4d" text with an alert icon, "Due soon"
 * with a clock icon), a sensitive-matter marker, and five skeleton rows while loading. The title opens the Task. Status, Priority and Assignee are inline editors for users who may change them (`mf-row-edit`).
 */
@Component({
  selector: 'mf-task-table',
  imports: [RouterLink, DueStatePipe, LocalTimePipe, PriorityBadge, RowEdit, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './task-table.scss',
  template: `
    <p class="wt-hint" data-scroll-hint>Scroll sideways to see every column.</p>
    <div
      class="wt-wrap"
      role="region"
      tabindex="0"
      [attr.aria-label]="caption() + ' (scrolls sideways)'"
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
              <th scope="col">Actions</th>
            }
          </tr>
        </thead>
        <tbody>
          @if (loading() && rows().length === 0) {
            @for (n of skeleton; track n) {
              <tr class="wt-skeleton" aria-hidden="true">
                @for (col of shownColumns(); track col.key) {
                  <td><span class="wt-bone"></span></td>
                }
                @if (showAssign()) {
                  <td><span class="wt-bone"></span></td>
                }
              </tr>
            }
          }
          @for (row of rows(); track row.taskId) {
            <tr [class.wt-row--overdue]="row.isOverdue" [attr.data-task]="row.taskNumber">
              @for (col of shownColumns(); track col.key) {
                <td [attr.data-col]="col.key">
                  @switch (col.key) {
                    @case ('ref') {
                      <span class="wt-mono">{{ row.taskNumber }}</span>
                    }
                    @case ('title') {
                      <a class="wt-title" [routerLink]="['/tasks', row.taskId]">{{ row.title }}</a>
                    }
                    @case ('matter') {
                      <a
                        class="wt-mono wt-link"
                        [routerLink]="['/matters', row.matterId]"
                        [title]="row.matterName"
                        >{{ row.matterRef }}</a
                      >
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
                        <div class="wt-progress">
                          @if (row.workflow.currentStepName) {
                            <span
                              >Step {{ row.workflow.currentStepNumber }}/{{
                                row.workflow.stepsTotal
                              }}: {{ row.workflow.currentStepName }}</span
                            >
                          } @else {
                            <span>All steps resolved</span>
                          }
                          <span class="wt-muted"
                            >{{ row.workflow.stepsResolved }} of
                            {{ row.workflow.stepsTotal }} resolved</span
                          >
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
                        {{ pod.name }}
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
                        {{ user.displayName }}
                        @if (!user.isActive) {
                          <span class="wt-muted">(inactive)</span>
                        }
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
                        <span class="wt-asap" [title]="due.tooltip">ASAP</span>
                      } @else if (row.isOverdue || due.kind === 'overdue') {
                        <span class="wt-due wt-due--overdue">
                          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                          {{ due.dateText }}
                          <strong>{{ due.badge ?? 'Overdue' }}</strong>
                        </span>
                      } @else if (due.kind === 'soon') {
                        <span class="wt-due wt-due--soon">
                          <i class="pi pi-clock" aria-hidden="true"></i>
                          {{ due.dateText }}
                          <strong>Due soon</strong>
                        </span>
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
                      {{ row.updatedAtUtc | localTime }}
                    }
                  }
                </td>
              }
              @if (showAssign()) {
                <td>
                  @if (canAssign(row)) {
                    <button
                      type="button"
                      class="wt-action"
                      (click)="assignToMe.emit(row)"
                      [attr.aria-label]="'Assign ' + row.taskNumber + ' to me'"
                    >
                      Assign to me
                    </button>
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class TaskTable {
  private readonly clock = inject(Clock);
  private readonly auth = inject(AuthStore);
  private readonly zone = inject(USER_TIME_ZONE);

  readonly rows = input.required<readonly TaskQueueRow[]>();
  /** Keys of the columns to show, in table order. */
  readonly columns = input.required<readonly string[]>();
  readonly caption = input('Tasks');
  readonly loading = input(false);
  readonly density = input<Density>('comfortable');
  /** Current API sort field; null shows no sort indicator (the default order applies). */
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  /** Adds an "Assign to me" action to unassigned open rows. */
  readonly showAssign = input(false);

  readonly sortChange = output<string>();
  readonly assignToMe = output<TaskQueueRow>();
  /** A row changed from the table (an inline edit): the optimistic row, then the server's row or the original again. */
  readonly rowChange = output<TaskQueueRow>();

  protected readonly skeleton = SKELETON_ROWS;
  protected readonly shownColumns = computed<ColumnDef[]>(() => {
    const wanted = new Set(this.columns());
    return WORK_COLUMNS.filter((c) => c.locked || wanted.has(c.key));
  });

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

  protected ageDays(row: TaskQueueRow): number {
    return Math.max(
      0,
      Math.floor((this.clock.now().getTime() - new Date(row.createdAtUtc).getTime()) / 86_400_000),
    );
  }

  protected dayOf(instant: string): string {
    return formatInstantDate(instant, this.zone);
  }
}
