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
