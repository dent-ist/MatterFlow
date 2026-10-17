/**
 * One vocabulary for the work lists and the Dashboard (BUG-13, M5). The wording and the numbers behind it live here so a label, a tooltip,
 * a help text and an empty state cannot drift apart:
 *
 * - **Due soon**: an open task with an explicit due date today or within the next {@link DUE_SOON_DAYS} days, not overdue, not ASAP.
 *   It never overlaps Overdue, so the Dashboard tiles add up.
 * - **Overdue**: an open task whose due moment has passed.
 * - **Due soon and overdue**: the My Work tab that holds both. Its count equals Overdue + Due soon.
 * - **Completed**: status Completed only (Dashboard tile, Trends).
 * - **Closed**: Completed or Cancelled (My Work tab).
 *
 * The backend counterpart is `TaskQueueRules.DueSoonDays`; an integration test asserts the equalities.
 */
export const DUE_SOON_DAYS = 2;
/** The days of the closed window the My Work Closed tab shows until "Show older". */
export const CLOSED_WINDOW_DAYS = 90;

export const DUE_SOON_LABEL = 'Due soon';
export const OVERDUE_LABEL = 'Overdue';
export const DUE_SOON_AND_OVERDUE_LABEL = 'Due soon and overdue';
export const COMPLETED_LABEL = 'Completed';
export const CLOSED_LABEL = 'Closed';

/** The Dashboard's Due soon window in plain words (not a date range, so a cached page never shows a stale date). */
export const DUE_SOON_WINDOW = `Today and the next ${DUE_SOON_DAYS} days`;
export const DUE_SOON_CAPTION = `${DUE_SOON_WINDOW}, not overdue, not ASAP`;
export const COMPLETED_HINT = 'Completed (cancelled not counted)';

/** What the Due filter cell reads on Due soon and overdue, where the tab itself is the window (BUG-10). */
export const DUE_SOON_FILTER_TEXT = `Next ${DUE_SOON_DAYS} days and overdue`;

/** Tab tooltips (M5). */
export const TAB_TOOLTIPS = {
  active: 'Open tasks assigned to you',
  dueSoon: `Overdue plus due in the next ${DUE_SOON_DAYS} days. ASAP tasks have no due date and are listed under Active`,
  completed: `Completed or cancelled in the last ${CLOSED_WINDOW_DAYS} days (use Show older for more)`,
  createdByMe: 'Tasks you created, any status or assignee',
} as const;

/** The help of a tab, opened by its "About this tab" info button (D4). */
export const TAB_HELP = {
  dueSoon: `Overdue tasks plus tasks due in the next ${DUE_SOON_DAYS} days. ASAP tasks have no due date, so they are not here; find them under Active.`,
  completed: `Completed or cancelled tasks from the last ${CLOSED_WINDOW_DAYS} days. Use Show older for earlier ones.`,
  completedAllTime: 'Completed or cancelled tasks of all time.',
} as const;

/** The empty states of the tabs that have their own wording (D6). */
export const EMPTY_TEXT = {
  dueSoon: `Nothing is overdue and nothing is due in the next ${DUE_SOON_DAYS} days.`,
  completed: `No tasks were closed in the last ${CLOSED_WINDOW_DAYS} days.`,
} as const;
