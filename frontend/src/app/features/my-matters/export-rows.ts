import { MyMattersTaskItem } from '../../api/generated/api-client';

/** The columns of an exported My Matters task row (PM v2, #879): the facts the screen shows, as plain values with ISO dates. */
export const TASK_ITEM_HEADER: readonly string[] = [
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
  'Age (days)',
];

export function taskItemRow(t: MyMattersTaskItem): (string | number)[] {
  return [
    t.taskNumber,
    t.title,
    t.matterRef,
    t.matterName,
    t.clientName,
    t.taskTypeName,
    t.priorityName,
    t.statusCode,
    t.assigneeName ?? '',
    t.dueDate ?? t.dueAtUtc ?? '',
    t.atRisk ? 'yes' : 'no',
    t.onHold?.reasonName ?? '',
    t.ageDays,
  ];
}
