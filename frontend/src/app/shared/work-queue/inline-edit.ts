import { TaskQueueRow, TaskResponse } from '../../api/generated/api-client';

/** The three cells that can be changed from the row. */
export type InlineField = 'status' | 'priority' | 'assignee';

/** Status actions of the lifecycle matrix (architecture 8.3), as in the Task header's Change status menu. */
export type StatusAction = 'START' | 'RESUME' | 'HOLD' | 'COMPLETE' | 'CANCEL' | 'REOPEN';

export interface StatusChoice {
  action: StatusAction;
  /** Status the action leads to. */
  target: string;
  permission: string;
  /** Set when the choice is shown but cannot be used (the Matter is inactive). */
  blockedReason?: string;
}

/** Statuses in which assignment and priority can change (TaskEditability.AssignOrPrioritize). */
const OPEN_STATUSES: readonly string[] = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];

/** The lifecycle matrix from TaskLifecycle.cs: what each status can move to, and the action name for it. */
const MATRIX: Readonly<Record<string, readonly [StatusAction, string, string][]>> = {
  NEW: [
    ['START', 'IN_PROGRESS', 'Task.ChangeStatus'],
    ['HOLD', 'ON_HOLD', 'Task.ChangeStatus'],
    ['COMPLETE', 'COMPLETED', 'Task.Complete'],
    ['CANCEL', 'CANCELLED', 'Task.Cancel'],
  ],
  IN_PROGRESS: [
    ['HOLD', 'ON_HOLD', 'Task.ChangeStatus'],
    ['COMPLETE', 'COMPLETED', 'Task.Complete'],
    ['CANCEL', 'CANCELLED', 'Task.Cancel'],
  ],
  ON_HOLD: [
    ['RESUME', 'IN_PROGRESS', 'Task.ChangeStatus'],
    ['CANCEL', 'CANCELLED', 'Task.Cancel'],
  ],
  COMPLETED: [
    ['REOPEN', 'IN_PROGRESS', 'Task.Reopen'],
    ['CANCEL', 'CANCELLED', 'Task.Cancel'],
  ],
  CANCELLED: [['REOPEN', 'IN_PROGRESS', 'Task.Reopen']],
};

export const MATTER_INACTIVE_TEXT = "Matter is inactive. This task can't be reopened.";

/**
 * Transitions offered for a row: only the cells of the matrix, without the ones the caller lacks the permission for
 * (the same filter as the Task header), and Reopen disabled with the reason while the Matter is inactive.
 */
export function statusChoices(
  row: Pick<TaskQueueRow, 'status' | 'matterIsActive'>,
  has: (permission: string) => boolean,
): StatusChoice[] {
  return (MATRIX[row.status] ?? [])
    .filter(([, , permission]) => has(permission))
    .map(([action, target, permission]) => ({
      action,
      target,
      permission,
      blockedReason: action === 'REOPEN' && !row.matterIsActive ? MATTER_INACTIVE_TEXT : undefined,
    }));
}

/** True when the cell should be an editor for this user and row. */
export function canEditField(
  field: InlineField,
  row: Pick<TaskQueueRow, 'status' | 'matterIsActive'>,
  has: (permission: string) => boolean,
): boolean {
  switch (field) {
    case 'status':
      return statusChoices(row, has).length > 0;
    case 'priority':
      return has('Task.SetPriority') && OPEN_STATUSES.includes(row.status);
    case 'assignee':
      return has('Task.Assign') && OPEN_STATUSES.includes(row.status);
  }
}

/** The part of a Task response a queue row shows, laid over the row it replaces. */
export function rowFromTask(row: TaskQueueRow, task: TaskResponse): TaskQueueRow {
  return {
    ...row,
    status: task.status,
    statusLabel: task.statusLabel,
    priority: {
      priorityId: task.priority.priorityId,
      label: task.priority.label,
      color: task.priority.color,
      sortOrder: task.priority.sortOrder,
    },
    assignedPod: task.assignedPod
      ? {
          podId: task.assignedPod.podId,
          name: task.assignedPod.name,
          isActive: task.assignedPod.isActive,
        }
      : undefined,
    assignedUser: task.assignedUser
      ? {
          userId: task.assignedUser.userId,
          displayName: task.assignedUser.displayName,
          isActive: task.assignedUser.isActive,
        }
      : undefined,
    isAsap: task.isAsap,
    isOverdue: task.isOverdue,
    updatedAtUtc: task.modifiedAtUtc ?? row.updatedAtUtc,
    completedAtUtc: task.completedAtUtc,
    statusChangedAtUtc: task.statusChangedAtUtc,
    rowVersion: task.rowVersion,
  };
}
