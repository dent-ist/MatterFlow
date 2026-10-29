import { TaskQueueRow } from '../../api/generated/api-client';

/** The columns of an exported row of the Open tasks grid: the facts the grid shows, as plain values with ISO dates. */
export const QUEUE_ROW_HEADER: readonly string[] = [
  'Task',
  'Title',
  'Matter',
  'Matter name',
  'Client',
  'Task type',
  'Priority',
  'Status',
  'Assignee',
  'Due',
  'At risk',
  'On hold reason',
];

export function queueRowExport(t: TaskQueueRow): (string | number)[] {
  return [
    t.taskNumber,
    t.title,
    t.matterRef,
    t.matterName,
    t.clientName,
    t.taskTypeName,
    t.priority.label,
    t.status,
    t.assignedUser?.displayName ?? '',
    t.dueDate ?? t.dueAtUtc ?? '',
    t.atRisk ? 'yes' : 'no',
    t.onHoldReasonName ?? '',
  ];
}
