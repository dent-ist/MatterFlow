/**
 * What the work lists tell the title, the table caption and the screen reader (BUG-TQ9, TQ36): the page name carries the view
 * ("Task Queue: Overdue"), and one live-region message per change carries the view, the count and the range together.
 */

/** "Task Queue: Overdue", or "Task Queue" when no view names the list. */
export function pageName(base: string, view: string | null | undefined): string {
  return view ? `${base}: ${view}` : base;
}

/**
 * "Overdue: 101 tasks, showing 1 to 50", "101 tasks, showing 1 to 50", "1 task", "No tasks" (the view first when there is one).
 * @param scope the view or tab the list shows, or null.
 */
export function resultsAnnouncement(
  scope: string | null | undefined,
  total: number,
  page: number,
  pageSize: number,
): string {
  const lead = scope ? `${scope}: ` : '';
  if (total === 0) return `${lead}No tasks`;
  if (total === 1) return `${lead}1 task`;
  const from = (page - 1) * pageSize + 1;
  return `${lead}${total} tasks, showing ${from} to ${Math.min(total, page * pageSize)}`;
}
