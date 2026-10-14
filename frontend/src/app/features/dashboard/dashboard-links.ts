import { Params } from '@angular/router';

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
