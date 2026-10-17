import { Params, convertToParamMap } from '@angular/router';
import { parseQueueState, queueArgs } from '../../shared/work-queue/queue-filters';

/**
 * Turns a Task Queue query string from the dashboard API (`status=NEW&status=IN_PROGRESS&unassigned=true`) into router query
 * parameters for `/tasks`. Repeated keys become arrays so the Task Queue reads them back as multi-value filters.
 */
export function queueParams(query: string | null | undefined): Params {
  const params: Params = {};
  if (!query) return params;
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const at = pair.indexOf('=');
    const key = decodeURIComponent(at < 0 ? pair : pair.slice(0, at));
    const value = at < 0 ? '' : decodeURIComponent(pair.slice(at + 1));
    const current = params[key];
    if (current === undefined) params[key] = value;
    else params[key] = Array.isArray(current) ? [...current, value] : [current, value];
  }
  return params;
}

/** The Task Queue link of a dashboard list: its query plus the order the list shows (so "View all" starts with the same rows). */
export function queueParamsSorted(query: string, sort: string, dir: 'asc' | 'desc'): Params {
  return { ...queueParams(query), sort, dir };
}

/**
 * The generated Task Queue client's arguments for a dashboard query string, sorted and limited to `pageSize` rows. The dashboard lists
 * (unassigned, overdue, due soon) ask the Task Queue itself, so a row is the same row the queue shows and the inline editors work on it.
 */
export function queueArgsFor(query: string, sort: string, dir: 'asc' | 'desc', pageSize: number) {
  const state = parseQueueState(convertToParamMap(queueParams(query)));
  return queueArgs({ ...state, sort, dir, page: 1, pageSize });
}

export type ListKind = 'unassigned' | 'overdue' | 'dueSoon';

/**
 * The window of "Due soon": due today and the two days after it (three calendar days, due today counts as soon). One wording for the
 * tile, the list and the "View all" link; plain words, not a date range, so a cached page never shows a stale date.
 */
export const DUE_SOON_WINDOW = 'Today and the next 2 days';
export const DUE_SOON_CAPTION = `${DUE_SOON_WINDOW}, excludes ASAP`;

/** The last day of the Due soon window (`dueTo` of its Task Queue query, `YYYY-MM-DD`), or null. */
export function dueSoonThrough(query: string | null | undefined): string | null {
  const to = queueParams(query)['dueTo'];
  return typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null;
}

/**
 * The order each dashboard list shows, and "View all" starts with: the unassigned queue by priority and then age (oldest first), the
 * overdue list by priority and then longest overdue (the queue's `priority` sort breaks ties by due date, oldest first), the due-soon list by due date (soonest first).
 */
export const LIST_ORDER: Record<
  ListKind,
  { sort: string; dir: 'asc' | 'desc'; note: string | null }
> = {
  unassigned: { sort: 'priorityAge', dir: 'asc', note: 'Highest priority first, then oldest.' },
  overdue: { sort: 'priority', dir: 'asc', note: 'Critical first, then longest overdue.' },
  dueSoon: { sort: 'due', dir: 'asc', note: `${DUE_SOON_WINDOW}, soonest first.` },
};

/** The Task Queue query of every open, unassigned task (what the department sees, and what a person with Task.Assign picks work from). */
export const OPEN_UNASSIGNED_QUERY = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true';

/** Query parameters of the Users tab (`?tab=users&uavail=..&uq=..`); the page clears them when another tab is chosen. `upod` is the old Pod filter, now the page-wide scope `pod`: only cleared here. */
export const USERS_POD_PARAM = 'upod';
export const USERS_AVAILABILITY_PARAM = 'uavail';
export const USERS_Q_PARAM = 'uq';
export const USERS_LOAD_PARAM = 'uload';
export const USERS_PRIORITY_PARAM = 'uprio';
/** `unopod=1` adds the people who cannot take work (no pod and nothing open) to the Workload view (U4). */
export const USERS_NOPOD_PARAM = 'unopod';

/** The Workload or Coverage view of the tab (the Coverage period is the page's shared `period`, `from` and `to`). */
export const USERS_VIEW_PARAM = 'view';

export function clearedUsersParams(): Record<string, null> {
  return {
    [USERS_POD_PARAM]: null,
    [USERS_AVAILABILITY_PARAM]: null,
    [USERS_Q_PARAM]: null,
    [USERS_LOAD_PARAM]: null,
    [USERS_PRIORITY_PARAM]: null,
    [USERS_NOPOD_PARAM]: null,
    [USERS_VIEW_PARAM]: null,
  };
}
