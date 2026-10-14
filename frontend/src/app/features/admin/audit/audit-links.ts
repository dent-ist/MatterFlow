import { AuditSearchItem } from '../../../api/generated/api-client';
import { objectTypeLabel } from '../../../shared/ui/audit-format';

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

/** The text shown for the object: its label when the API could resolve one, otherwise `Type id`. */
export function auditObjectText(item: AuditSearchItem): string {
  const { type, id, label } = item.object;
  const name = objectTypeLabel(type);
  return label ? `${name}: ${label}` : /^\d+$/.test(id) ? `${name} #${id}` : `${name} ${id}`;
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
