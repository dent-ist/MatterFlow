import { AuditSearchItem } from '../../../api/generated/api-client';
import {
  fieldLabel,
  friendlyText,
  isTechnicalFieldKey,
  objectTypeLabel,
} from '../../../shared/ui/audit-format';

/** Where an audited object lives in the app, or null when it has no page. Events of a Task's parts (comments, steps, links) open the Task. */
export function auditObjectRoute(item: AuditSearchItem): string[] | null {
  const { type, id } = item.object;
  const numeric = /^\d+$/.test(id);
  switch (type) {
    case 'Task':
      return numeric ? ['/tasks', id] : null;
    case 'Matter':
      return numeric ? ['/matters', id] : null;
    case 'Client':
      return numeric ? ['/clients', id] : null;
    case 'Asset':
      return numeric ? ['/assets', id] : null;
    case 'Project':
      return numeric ? ['/projects', id] : null;
    case 'User':
      return ['/admin/users'];
    default:
      return item.taskId != null ? ['/tasks', String(item.taskId)] : null;
  }
}

/** Parts of a Task: named by what they are and the Task they belong to, never by their own number. */
const TASK_PARTS: ReadonlySet<string> = new Set([
  'StepInstance',
  'TaskStepInstance',
  'TaskComment',
  'TaskAsset',
  'TaskAssetLink',
  'FormValueSet',
]);

/**
 * The text shown for the object: its label when the API could resolve one ("Task: TSK-1042 Process Smith custodians"), a part of a
 * Task as "Workflow step on TSK-1042 Process Smith custodians", otherwise the type with its number ("Client #12").
 */
export function auditObjectText(item: AuditSearchItem): string {
  const { type, id, label } = item.object;
  const name = objectTypeLabel(type);
  if (label) return `${name}: ${label}`;
  if (TASK_PARTS.has(type)) return item.taskLabel ? `${name} on ${item.taskLabel}` : name;
  return /^\d+$/.test(id) ? `${name} #${id}` : `${name} ${id}`;
}

/** Consecutive events of one operation (same correlation id) as one group; single events stay alone. */
export interface AuditGroup {
  key: string;
  items: AuditSearchItem[];
}

export function groupByCorrelation(items: readonly AuditSearchItem[]): AuditGroup[] {
  const groups: AuditGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.items[0].correlationId === item.correlationId) {
      last.items.push(item);
    } else {
      groups.push({ key: `${item.correlationId}:${item.auditEventId}`, items: [item] });
    }
  }
  return groups;
}

/** A change to one field of a record (as opposed to something that happened: a status change, a step completed, a comment added). */
export const isFieldChange = (item: AuditSearchItem): boolean => item.eventType === 'FIELD_CHANGED';

/** The events of an operation that tell what happened, and the field-level changes that went with them (shown on request). */
export function splitGroup(group: AuditGroup): {
  happened: AuditSearchItem[];
  fields: AuditSearchItem[];
} {
  return {
    happened: group.items.filter((i) => !isFieldChange(i)),
    fields: group.items.filter(isFieldChange),
  };
}

/** The event whose object a group row shows: the first thing that happened, else the first change (UXR4-15). */
export function groupObjectItem(group: AuditGroup): AuditSearchItem {
  return splitGroup(group).happened[0] ?? group.items[0];
}

/**
 * One line for a group of events: the first thing that happened ("Step Intake review completed"), "and 2 related changes" for the
 * rest; when the operation only changed fields, the object and the fields ("Matter: 00343-00012 Merger: changed Name, Phone").
 */
export function groupHeadline(group: AuditGroup): string {
  const { happened, fields } = splitGroup(group);
  const rest = group.items.length - 1;
  if (happened.length > 0) {
    const first = friendlyText(happened[0].summary);
    return rest > 0 ? `${first} and ${rest} related ${rest === 1 ? 'change' : 'changes'}` : first;
  }
  const names = [
    ...new Set(
      fields.filter((f) => !isTechnicalFieldKey(f.fieldKey)).map((f) => fieldLabel(f.fieldKey)),
    ),
  ];
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  return names.length > 0
    ? `${auditObjectText(fields[0])}: changed ${shown}${more}`
    : `${auditObjectText(group.items[0])}: ${group.items.length} changes`;
}
