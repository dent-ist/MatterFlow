import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  TaskQueueRow,
  TaskResponse,
  TaskTransitionOption,
} from '../../../api/generated/api-client';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { RowEdit } from '../../../shared/work-queue/row-edit';
import { DueLabelPipe } from '../../../shared/pipes/due-label.pipe';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TaskDetailStore } from './task-detail.store';
import { Crumb, PageHeader } from '../../../shared/ui/page-header';

/** The fields of a queue row that the inline editors read, taken from the Task. */
function rowOfTask(t: TaskResponse): TaskQueueRow {
  return {
    taskId: t.taskId,
    taskNumber: t.taskNumber,
    title: t.title,
    matterId: t.matter.matterId,
    matterIsActive: t.matter.isActive,
    priority: t.priority,
    status: t.status,
    statusLabel: t.statusLabel,
    assignedPod: t.assignedPod,
    assignedUser: t.assignedUser,
    isAsap: t.isAsap,
    isOverdue: t.isOverdue,
    updatedAtUtc: t.modifiedAtUtc,
    completedAtUtc: t.completedAtUtc,
    statusChangedAtUtc: t.statusChangedAtUtc,
    rowVersion: t.rowVersion,
  } as TaskQueueRow;
}

/**
 * Task header (UX S10): number, title, the task type icon slot, status, priority, due or ASAP, Pod and assignee, Matter reference with copy button
 * and workflow. Status, Priority and Assignee are the same inline menus as in the work tables (`mf-row-edit`) for users who
 * may change them; the status menu lists only the transitions in `allowedActions` (ones the caller lacks permission for are
 * left out, ones blocked by the Matter are disabled with the reason). One Edit button opens the Details form (a dialog) for the other
 * fields; the Activity button opens the Activity drawer. A user who can change nothing sees a "View only" line.
 */
@Component({
  selector: 'mf-task-header',
  imports: [TaskTypeIcon, PageHeader, RowEdit, MatterRef, PriorityBadge, StatusBadge, DueLabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @if (store.task(); as t) {
      <div class="th" data-task-header>
        <mf-page-header [crumbs]="crumbs()">
          <span mfTitle class="th__title">
            <!-- TODO: show mf-task-type-icon ([iconKey]="t.taskType.iconKey") here, before the number, once the shared task type icon component is on dev. -->
            <span class="pg-mono" data-task-number>{{ t.taskNumber }}</span>
            <span data-task-title>{{ t.title }}</span>
          </span>
          @if (t.allowedActions.canEdit) {
            <button mfActions type="button" class="mf-btn" data-edit (click)="edit()">Edit</button>
          }
          <button
            mfActions
            type="button"
            class="mf-btn th__activity"
            data-activity-button
            (click)="store.activityOpen.set(true)"
          >
            <i class="pi pi-history" aria-hidden="true"></i> Activity
          </button>

          <div class="th__meta">
            <span data-status>
              @if (statusEditable()) {
                <mf-row-edit
                  field="status"
                  [row]="row()"
                  [transitions]="items()"
                  [statusDelegated]="true"
                  (statusAction)="store.requestAction($event)"
                />
              } @else {
                <mf-status-badge [code]="t.status" [label]="t.statusLabel" />
              }
            </span>
            <span data-priority>
              @if (priorityEditable()) {
                <mf-row-edit
                  field="priority"
                  [row]="row()"
                  (rowChange)="override.set({ basis: t, row: $event })"
                  (taskChange)="saved($event)"
                />
              } @else {
                <mf-priority-badge
                  [priorityId]="t.priority.priorityId"
                  [label]="t.priority.label"
                  [color]="t.priority.color"
                />
              }
            </span>
            <span class="th__type" data-task-type
              ><mf-task-type-icon [iconKey]="t.taskType.iconKey" />
              <span class="pg-label">Type:</span> {{ t.taskType.name }}</span
            >
            <span data-due
              ><span class="pg-label">Due:</span>
              {{ { dueDate: t.dueDate, dueAtUtc: t.dueAtUtc } | dueLabel: t.status }}</span
            >
            <span data-pod
              ><span class="pg-label">Pod:</span> {{ t.assignedPod?.name ?? 'No pod' }}</span
            >
            <span data-assignee
              ><span class="pg-label">Assignee:</span>
              @if (assigneeEditable()) {
                <mf-row-edit
                  field="assignee"
                  [row]="row()"
                  (rowChange)="override.set({ basis: t, row: $event })"
                  (taskChange)="saved($event)"
                />
              } @else {
                {{ t.assignedUser?.displayName ?? 'Unassigned' }}
              }
            </span>
            <span class="th__matter" data-matter
              ><span class="pg-label">Matter:</span>
              <mf-matter-ref
                [value]="t.matter.matterRef"
                [link]="['/matters', t.matter.matterId]"
              />
              {{ t.matter.name }}
            </span>
            <span data-workflow
              ><span class="pg-label">Workflow:</span> {{ t.workflow.workflowName }} v{{
                t.workflow.versionNo
              }}
              ({{ t.workflow.isOrdered ? 'ordered' : 'unordered' }}) &middot;
              <span data-progress
                >{{ t.workflow.progress.resolved }} of
                {{ t.workflow.progress.total }} resolved</span
              ></span
            >
          </div>
          @if (store.viewOnly()) {
            <p class="th__view-only" data-view-only>
              <i class="pi pi-eye" aria-hidden="true"></i>
              View only: you don't have permission to edit tasks.
            </p>
          }
        </mf-page-header>
      </div>
    }
  `,
  styles: `
    .th {
      margin-bottom: var(--mf-s3);
    }
    .th__title {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    mf-page-header {
      margin-bottom: 0;
    }
    .th__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s4);
      margin-top: var(--mf-s2);
    }
    .th__type {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .th__matter {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .th__view-only {
      margin: var(--mf-s2) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class TaskHeader {
  protected readonly store = inject(TaskDetailStore);

  /** A change made from a chip, shown at once; it only counts while the Task it was made on is still the one on screen. */
  protected readonly override = signal<{ basis: TaskResponse; row: TaskQueueRow } | null>(null);

  protected readonly row = computed<TaskQueueRow>(() => {
    const t = this.store.task()!;
    const o = this.override();
    return o && o.basis === t ? o.row : rowOfTask(t);
  });

  // While the Details form is open the chips are plain: a change from here would make the form's version stale.
  protected readonly statusEditable = computed(
    () => !this.store.editing() && this.items().length > 0,
  );
  protected readonly priorityEditable = computed(
    () => !this.store.editing() && !!this.store.task()?.allowedActions.canSetPriority,
  );
  protected readonly assigneeEditable = computed(
    () => !this.store.editing() && !!this.store.task()?.allowedActions.canAssign,
  );

  /** `Tasks > 00343-00012 Merger Review > TSK-1`: every segment before the current task is a link. */
  protected readonly crumbs = computed<Crumb[]>(() => {
    const t = this.store.task();
    if (!t) return [];
    return [
      { label: 'Tasks', link: '/tasks' },
      { label: `${t.matter.matterRef} ${t.matter.name}`, link: ['/matters', t.matter.matterId] },
      { label: t.taskNumber },
    ];
  });

  /** Transitions shown in the menu: not the ones the caller lacks permission for. */
  protected readonly items = computed<TaskTransitionOption[]>(() =>
    (this.store.task()?.allowedActions.transitions ?? []).filter(
      (o) => o.permitted || o.blockedReason !== 'PERMISSION_DENIED',
    ),
  );

  /** The server's answer to a Priority or Assignee change (or the refreshed Task after a conflict). */
  protected saved(task: TaskResponse): void {
    this.store.task.set(task);
    this.store.warnings.set(task.warnings ?? []);
    this.store.conflict.set(false);
  }

  protected edit(): void {
    this.store.editOrigin.set('header');
    this.store.editing.set(true);
  }
}
