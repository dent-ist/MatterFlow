import { formatDateOnly } from '../../../core/time/time';

export interface WhenSummaryInput {
  /** The priority's label, or null for "Default priority". */
  priorityLabel: string | null;
  /** Due date as `yyyy-MM-dd`, or empty. */
  dueDate: string;
  /** Due time as `HH:mm`, or empty. */
  dueTime: string;
  /** The assignee's name and the Pod's name; both null (or unassigning not allowed) reads "Unassigned". */
  assigneeLabel: string | null;
  podName: string | null;
}

/**
 * The one line under "Priority, due date and assignment" while it is collapsed, shared by Create task and the Edit dialog (#349, #350):
 * `Normal priority, due Oct 24, 2026 at 5:00 PM, Unassigned`.
 */
export function whenSummaryText(i: WhenSummaryInput): string {
  const parts = [i.priorityLabel ? `${i.priorityLabel} priority` : 'Default priority'];
  if (!i.dueDate) parts.push('no due date (ASAP)');
  else {
    const m = /^(\d{2}):(\d{2})$/.exec(i.dueTime);
    const at = m ? ` at ${+m[1] % 12 || 12}:${m[2]} ${+m[1] < 12 ? 'AM' : 'PM'}` : '';
    parts.push(`due ${formatDateOnly(i.dueDate)}${at}`);
  }
  if (i.assigneeLabel) parts.push(`assigned to ${i.assigneeLabel}`);
  else if (i.podName) parts.push(`${i.podName} (no person)`);
  else parts.push('Unassigned');
  return parts.join(', ');
}
