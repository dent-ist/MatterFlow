import { TASK_READ_ONLY_TEXT } from '../../core/http/interceptors';

/** The code of a transition the person may not use because the task's type has a Can Edit list without them (Task Type access rule, epic #1397). */
export const TASK_TYPE_READ_ONLY = 'TASK_TYPE_READ_ONLY';

/** The one sentence for a task the person may see but not change: the View only line of the task page, the toast of a refused change and the disabled row menu. */
export const READ_ONLY_TEXT = TASK_READ_ONLY_TEXT;

/**
 * True for a status action a menu leaves out altogether: the person lacks the permission, or the task's type is read-only for them. A transition blocked for another reason (an inactive
 * matter) stays in the menu as a disabled entry that says why.
 */
export function isHiddenTransition(o: {
  permitted: boolean;
  blockedReason?: string | null;
}): boolean {
  return (
    !o.permitted &&
    (o.blockedReason === 'PERMISSION_DENIED' || o.blockedReason === TASK_TYPE_READ_ONLY)
  );
}
