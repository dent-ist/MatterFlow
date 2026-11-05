import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { mfDateLong } from '../../core/time/time';
import { CopyParts, CopyPart } from '../ui/copy-parts';
import { numericInstant } from '../ui/numeric-date';
import { retryWhenBackOnline } from '../../core/http/connectivity';
import { ErrorReference } from '../ui/error-reference';
import { StateBlock } from '../ui/state-block';
import { LoadState } from '../ui/data-table';
import { MatterRef } from '../ui/matter-ref';
import { loudPriority, loudStatus } from './quiet-badges';
import { PriorityFlag } from '../ui/priority-flag';
import { PriorityPill } from '../ui/priority-pill';
import { StatusBadge } from '../ui/status-badge';
import { TaskTypeBadge } from '../task-type/task-type-badge';
import { DueCell } from './due-cell';
import { RowGroup } from './due-groups';
import { HoldNote } from './hold-note';
import { InlineField, canEditField } from './inline-edit';
import { CLOSED_STATUSES } from './queue-filters';
import { RowEdit } from './row-edit';
import { personInitials } from '../ui/person-initials';
import { IntPipe } from '../ui/number-format';

/** Below this width (the same 640 px as the navigation rail and the pager) a work list is cards instead of a table (#192). */
export const PHONE_CARDS_QUERY = '(max-width: 639.98px)';

/** Initials for the assignee's avatar: the first letters of the first and last word of the name. */
export function initialsOf(name: string): string {
  return personInitials(name);
}

/**
 * The cards of the work lists below 640 px (#192, #238): one `<article>` with a heading link per task, in a list, instead of the table.
 * Line 1 the task type icon and the title (two lines at most); line 2 `Client . matter reference`; line 3 the chips: Priority, Due (the two-line
 * Due cell) and Status, the inline editors where the person may change them (44 px targets); then the hold reason (its own chip
 * line) and line 4: the Assignee (avatar initials and name, or "Unassigned" with "Assign to me" on Pod Work) and the task number with the New
 * dot. Which chips show follows the columns of the tab (the Closed tab has Closed instead of Priority and Due). The cards keep the hooks of the
 * rows (`data-task`, `a.wt-title`, `[data-col=status] [data-inline-trigger]`), so the keyboard model of the table (J, K, S, P, arrows)
 * and "focus the row you came back from" work unchanged. Loading, error and empty are states of the list, group headers come from the Due sort.
 * It belongs to `mf-task-table`, which decides when it is used.
 */
@Component({
  selector: 'mf-task-card-list',
  imports: [
    IntPipe,
    NgTemplateOutlet,
    RouterLink,
    CopyParts,
    DueCell,
    ErrorReference,
    StateBlock,
    HoldNote,
    MatterRef,
    PriorityFlag,
    PriorityPill,
    RowEdit,
    StatusBadge,
    TaskTypeBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './task-card-list.scss',
  template: `
    @switch (state()) {
      @case ('error') {
        <div class="tc-state" data-error>
          <mf-state-block kind="error">
            Couldn't load tasks.
            <mf-error-reference mfStateReason />
            <button mfStateAction type="button" class="mf-btn" (click)="retry.emit()">Retry</button>
          </mf-state-block>
        </div>
      }
      @default {
        @if (skeleton()) {
          <p class="mf-sr-only" role="status" aria-busy="true" data-loading>Loading tasks</p>
          <ul class="tc-list" aria-hidden="true">
            @for (n of skeletonCards; track n) {
              <li class="tc tc--sk" data-skeleton>
                <span class="tc-sk tc-sk--title"></span>
                <span class="tc-sk tc-sk--sub"></span>
                <span class="tc-sk tc-sk--chips"></span>
              </li>
            }
          </ul>
        } @else if (empty()) {
          <div class="tc-state" [attr.data-empty]="filtered() ? 'filtered' : 'none'">
            @if (filtered()) {
              <mf-state-block>
                No tasks match these filters.
                <button mfStateAction type="button" class="mf-btn" (click)="clear.emit()">
                  Clear Filters
                </button>
              </mf-state-block>
            } @else {
              <mf-state-block>
                @if (emptyParts(); as parts) {
                  <mf-copy-parts [parts]="parts" />
                } @else {
                  {{ emptyText() || 'No tasks yet.' }}
                }
                @if (emptyAction(); as tpl) {
                  <span mfStateAction><ng-container [ngTemplateOutlet]="tpl" /></span>
                }
              </mf-state-block>
            }
          </div>
        } @else {
          <ul class="tc-list" [attr.aria-busy]="loading() ? 'true' : null">
            @for (row of rows(); track row.taskId; let i = $index) {
              @if (groupAt().get(i); as group) {
                <li class="tc-group" [attr.data-group]="group.key">
                  <button
                    type="button"
                    class="tc-group__btn"
                    [attr.aria-expanded]="collapsed().has(group.key) ? 'false' : 'true'"
                    (click)="toggled.emit(group.key)"
                  >
                    <i
                      class="pi"
                      [class.pi-chevron-down]="!collapsed().has(group.key)"
                      [class.pi-chevron-right]="collapsed().has(group.key)"
                      aria-hidden="true"
                    ></i>
                    <span class="tc-group__text"
                      ><span class="tc-group__name">{{ group.label }}</span
                      >{{ ' '
                      }}<span class="tc-group__count"
                        >({{ group.count | mfInt
                        }}<span class="mf-sr-only"> {{ group.count === 1 ? 'task' : 'tasks' }}</span
                        >)</span
                      >
                      @if (group.continued) {
                        <span class="tc-group__count">, continued</span>
                      }
                    </span>
                  </button>
                </li>
              }
              <li
                class="tc"
                [hidden]="hiddenAt()[i]"
                [class.tc--overdue]="row.isOverdue && !closed(row)"
                [class.tc--leaving]="leaving().has(row.taskId)"
                [attr.data-leaving]="leaving().has(row.taskId) ? 'true' : null"
                [attr.data-task]="row.taskNumber"
              >
                <article [attr.aria-label]="row.taskNumber + ', ' + row.title">
                  <h2 class="tc-h">
                    <mf-task-type-badge
                      #tt
                      class="wt-typeicon"
                      [iconKey]="row.taskTypeIconKey"
                      [colourKey]="row.taskTypeColourKey"
                      [name]="row.taskTypeName"
                      data-type-icon
                    />
                    <a
                      class="wt-title tc-title"
                      [routerLink]="['/tasks', row.taskId]"
                      [queryParams]="linkParams()"
                      [state]="linkState()"
                      [attr.data-task-id]="row.taskId"
                      [attr.title]="row.title"
                      [attr.aria-describedby]="tt.descriptionId"
                      (click)="drilled.emit({ event: $event, row })"
                      >{{ row.title }}</a
                    >
                  </h2>
                  @if (!hideContext()) {
                    <p
                      class="tc-sub"
                      data-card-matter
                      [attr.title]="row.clientName + ' · ' + row.matterName"
                    >
                      <span class="tc-client">{{ row.clientName }}</span>
                      <span aria-hidden="true"> · </span><span class="mf-sr-only">, </span>
                      <mf-matter-ref
                        [value]="row.matterRef"
                        [link]="
                          matterLink() && row.matterCanOpen !== false
                            ? ['/matters', row.matterId]
                            : null
                        "
                        [copy]="false"
                      />
                      @if (row.matterIsSensitive) {
                        <i
                          class="pi pi-exclamation-triangle tc-sensitive"
                          role="img"
                          aria-label="Sensitive matter"
                        ></i>
                      }
                      @if (!assigneeShown()) {
                        <ng-container
                          [ngTemplateOutlet]="num"
                          [ngTemplateOutletContext]="{ $implicit: row }"
                        />
                      }
                    </p>
                  }
                  @if (shows('steps') && row.workflow.stepsTotal > 0) {
                    <p class="tc-prog" data-col="steps" data-card-progress>
                      <span class="tc-prog__bar" aria-hidden="true"
                        ><span
                          class="tc-prog__fill"
                          [style.width.%]="
                            (100 * row.workflow.stepsResolved) / row.workflow.stepsTotal
                          "
                        ></span
                      ></span>
                      <span class="tc-prog__text"
                        >Progress: {{ row.workflow.stepsResolved }} of
                        {{ row.workflow.stepsTotal | mfInt }} steps</span
                      >
                    </p>
                  }
                  <div class="tc-chips" data-card-chips>
                    @if (shows('priority')) {
                      <span class="tc-chip" data-col="priority">
                        @if (editable('priority', row)) {
                          <mf-row-edit
                            field="priority"
                            [row]="row"
                            (rowChange)="rowChange.emit($event)"
                          />
                        } @else if (quiet() && !loudPriority(row.priority)) {
                          <span class="tc-plain" data-plain-priority>{{ row.priority.label }}</span>
                        } @else {
                          <mf-priority-flag
                            [label]="row.priority.label"
                            [color]="row.priority.color"
                            [muted]="closed(row)"
                          />
                        }
                      </span>
                    }
                    @if (shows('due') && !closed(row)) {
                      <span class="tc-due" data-col="due">
                        <mf-due-cell [due]="row" [status]="row.status" [atRisk]="row.atRisk" />
                      </span>
                    }
                    @if (shows('closed') && closedOn(row); as day) {
                      <span class="tc-due tc-closed" data-col="closed" [attr.title]="closedTip(row)"
                        >Closed {{ day }}</span
                      >
                    }
                    <span class="tc-chip tc-chip--status" data-col="status">
                      @if (editable('status', row)) {
                        <mf-row-edit
                          field="status"
                          [row]="row"
                          (rowChange)="rowChange.emit($event)"
                        />
                      } @else if (quiet() && loudStatus(row) === null) {
                        <span class="tc-plain" data-plain-status>{{ row.statusLabel }}</span>
                      } @else if (quiet() && loudStatus(row) === 'risk') {
                        <mf-priority-pill kind="risk" data-at-risk-pill />
                      } @else {
                        <mf-status-badge [code]="row.status" [label]="row.statusLabel" />
                      }
                    </span>
                  </div>
                  @if (row.status === 'ON_HOLD' && (row.holdReason || row.onHoldReasonName)) {
                    <mf-hold-note
                      kind="chip"
                      [holdReason]="row.holdReason"
                      [truncated]="row.holdReasonTruncated"
                      [reasonName]="row.onHoldReasonName"
                      [since]="row.statusChangedAtUtc"
                    />
                  }
                  @if (assigneeShown()) {
                    <div class="tc-meta" data-card-meta>
                      <span class="tc-who" data-col="assignee">
                        @if (row.assignedUser; as person) {
                          <span class="tc-avatar" aria-hidden="true" data-avatar>{{
                            initials(person.displayName)
                          }}</span>
                        }
                        @if (editable('assignee', row)) {
                          <mf-row-edit
                            field="assignee"
                            [row]="row"
                            [selfAssign]="true"
                            [assignLink]="assignLink()"
                            (rowChange)="rowChange.emit($event)"
                          />
                        } @else if (row.assignedUser; as user) {
                          <span class="tc-name">
                            {{ user.displayName }}
                            @if (!user.isActive) {
                              <span class="tc-muted">(inactive)</span>
                            }
                          </span>
                        } @else {
                          <span class="tc-muted tc-unassigned">Unassigned</span>
                        }
                        @if (shows('pod') && row.assignedPod; as pod) {
                          <span class="tc-muted tc-pod" [attr.title]="pod.name">{{
                            pod.name
                          }}</span>
                        }
                      </span>
                      <ng-container
                        [ngTemplateOutlet]="num"
                        [ngTemplateOutletContext]="{ $implicit: row }"
                      />
                    </div>
                  }
                </article>
              </li>
            }
          </ul>
        }
      }
    }
    <ng-template #num let-row>
      <span class="tc-num">
        @if (isNew(row)) {
          <span
            class="wt-newdot"
            role="img"
            aria-label="New"
            title="Assigned since your last visit"
            data-new-dot
          ></span>
        }
        {{ row.taskNumber }}
      </span>
    </ng-template>
  `,
})
export class TaskCardList {
  private readonly auth = inject(AuthStore);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);

  readonly rows = input.required<readonly TaskQueueRow[]>();
  /** Keys of the columns of the tab: they decide which chips show (Priority, Due, Closed, Assignee, Pod). */
  readonly columns = input.required<readonly string[]>();
  readonly state = input<LoadState>('ready');
  /** First load: placeholder cards. */
  readonly skeleton = input(false);
  /** Rows kept while a refresh runs. */
  readonly loading = input(false);
  readonly empty = input(false);
  readonly filtered = input(false);
  readonly emptyText = input('');
  readonly emptyParts = input<readonly CopyPart[] | null>(null);
  /** The projected `[empty-action]` content of the table, as a template. */
  readonly emptyAction = input<TemplateRef<unknown> | null>(null);
  readonly assignLink = input(false);
  /** A Matter's or Project's own list: the Client and Matter line is left out (it is the page you are on); Progress shows where the tab has it. */
  readonly hideContext = input(false);
  /** No inline editors (the table's `readOnly`). */
  readonly readOnly = input(false);
  /** Quiet badges (see the table). */
  readonly quiet = input(false);
  protected readonly loudPriority = loudPriority;
  protected readonly loudStatus = loudStatus;
  readonly newSince = input<number | null>(null);
  readonly leaving = input<ReadonlySet<number>>(new Set());
  readonly linkParams = input<Record<string, unknown> | null>(null);
  readonly linkState = input<{ returnTo: string } | undefined>(undefined);
  /** Group headers by row index, which rows are folded away, and which groups are collapsed (all from the table). */
  readonly groups = input<readonly RowGroup[]>([]);
  readonly hiddenAt = input<readonly boolean[]>([]);
  readonly collapsed = input<ReadonlySet<string>>(new Set());

  readonly rowChange = output<TaskQueueRow>();
  readonly toggled = output<string>();
  /** A click on a title (the table remembers the row for Back). */
  readonly drilled = output<{ event: MouseEvent; row: TaskQueueRow }>();
  readonly retry = output<void>();
  readonly clear = output<void>();

  /** The connection came back while the list shows "couldn't load": read it again once (S13, #611). */
  protected readonly autoRetry = retryWhenBackOnline(
    () => this.state() === 'error',
    () => this.retry.emit(),
  );

  protected readonly skeletonCards = [1, 2, 3, 4, 5, 6];
  protected readonly groupAt = computed(() => new Map(this.groups().map((g) => [g.start, g])));
  protected readonly matterLink = computed(() => this.auth.canLink('matter'));
  private readonly keys = computed(() => new Set(this.columns()));
  /** The Assignee line shows where the tab has the column, and always on Pod Work (Assign to me). */
  protected readonly assigneeShown = computed(
    () => this.keys().has('assignee') || this.assignLink(),
  );
  protected readonly initials = initialsOf;

  protected shows(key: string): boolean {
    return this.keys().has(key);
  }

  protected editable(field: InlineField, row: TaskQueueRow): boolean {
    return !this.readOnly() && canEditField(field, row, (p) => this.auth.has(p));
  }

  protected closed(row: TaskQueueRow): boolean {
    return CLOSED_STATUSES.includes(row.status);
  }

  protected isNew(row: TaskQueueRow): boolean {
    const since = this.newSince();
    return since !== null && new Date(row.assignedAtUtc ?? row.createdAtUtc).getTime() > since;
  }

  /** "10/16" (the year only outside the current year, D-60). */
  protected closedOn(row: TaskQueueRow): string | null {
    if (!row.closedAtUtc) return null;
    return numericInstant(row.closedAtUtc, this.clock.now(), this.zone, false);
  }

  protected closedTip(row: TaskQueueRow): string | null {
    return row.closedAtUtc ? mfDateLong(row.closedAtUtc, this.zone, 'datetime') : null;
  }
}
