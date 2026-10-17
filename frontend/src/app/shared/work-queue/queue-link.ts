import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  QueueState,
  dateDaysAgo,
  toQueryParams,
} from './queue-filters';

export type MyWorkTabKey = 'active' | 'dueSoon' | 'completed' | 'createdByMe';

/** The Closed tab shows the last 90 days unless "Show older" or a closed-date range says otherwise (the API's default window). */
export const CLOSED_WINDOW_DAYS = 90;
/** Due soon means an explicit due date today or within this many days (the API's window). */
export const DUE_SOON_DAYS = 2;

export interface QueueLinkContext {
  userId: number;
  now: Date;
  zone: string;
}

/**
 * The Task Queue address that lists the same tasks as a My Work tab (M10). The tab's own filters are mapped, not copied: Assignee is me
 * (or Creator is me), Status is the tab's statuses, Due soon and overdue is "has a date, due by today + 2" (so overdue is in and ASAP is
 * out, as in the tab), Closed carries the closed-date window. The column filters the person set (Priority, Matter text, ...) are carried
 * over; the sort too, the page is not. Created by me carries its status choice (the Open default, or every status for "All"), so the total equals the tab's. Empty values are left out.
 */
export function openInQueueParams(
  tab: MyWorkTabKey,
  state: QueueState,
  ctx: QueueLinkContext,
): Record<string, string | string[]> {
  const f = { ...state.filters };
  const kept = (own: readonly string[], fallback: readonly string[]): string[] => {
    const wanted = f.status.filter((code) => own.includes(code));
    return wanted.length > 0 ? wanted : [...fallback];
  };
  switch (tab) {
    case 'active':
      f.assignee = [ctx.userId];
      f.unassigned = false;
      f.status = kept(OPEN_STATUSES, OPEN_STATUSES);
      break;
    case 'dueSoon':
      f.assignee = [ctx.userId];
      f.unassigned = false;
      f.status = kept(OPEN_STATUSES, OPEN_STATUSES);
      f.asap = false;
      f.overdue = null;
      f.dueFrom = null;
      f.dueTo = dateDaysAgo(ctx.now, -DUE_SOON_DAYS, ctx.zone);
      break;
    case 'completed':
      f.assignee = [ctx.userId];
      f.unassigned = false;
      f.status = kept(CLOSED_STATUSES, CLOSED_STATUSES);
      if (!f.completedFrom && !f.completedTo && !state.closedAll) {
        f.completedFrom = dateDaysAgo(ctx.now, CLOSED_WINDOW_DAYS, ctx.zone);
      }
      break;
    case 'createdByMe':
      f.creator = [ctx.userId];
      break;
  }
  const query = toQueryParams(
    { ...state, filters: f, page: 1, view: null, closedAll: false, podId: null },
    { explicitStatus: true },
  );
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(query)) {
    // `status=` (every status) is meaningful; every other empty value is not.
    if (value === null || (value === '' && key !== 'status')) continue;
    out[key] = value;
  }
  return out;
}
