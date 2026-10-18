/**
 * What the work lists tell the title, the table caption and the screen reader (BUG-TQ9, TQ36): the page name carries the view
 * ("Task Queue: Overdue"), and one live-region message per change carries the view, the count and the range together.
 */

/** "Task Queue: Overdue", or "Task Queue" when no view names the list. */
export function pageName(base: string, view: string | null | undefined): string {
  return view ? `${base}: ${view}` : base;
}

/**
 * "Overdue: 101 tasks, showing 1 to 50", "Overdue: 101 tasks, page 3 of 3, showing 101 to 101", "1 task", "No tasks" (the view first when
 * there is one). With more than one page the page is named; the message changes once per page change, so the live region says it once (#237).
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
  const pages = Math.ceil(total / pageSize);
  const where = pages > 1 ? `page ${page} of ${pages}, ` : '';
  return `${lead}${total} tasks, ${where}showing ${from} to ${Math.min(total, page * pageSize)}`;
}
