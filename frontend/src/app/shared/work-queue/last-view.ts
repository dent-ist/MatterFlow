import { convertToParamMap } from '@angular/router';
import { WorkPage } from './column-prefs';
import { QueueState, parseQueueState, toQueryParams } from './queue-filters';

/** Pages whose last view is remembered. Pod Work remembers its Pod instead (`loadLastPod`). */
export type RememberedPage = Exclude<WorkPage, 'pod-work'>;

const key = (page: RememberedPage, userId: number | null) =>
  `mf.work-view.v1.${page}.${userId ?? 'anon'}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** True when the state has no query parameter at all (the page's own default view). */
export function isBareState(state: QueueState): boolean {
  return Object.values(toQueryParams(state)).every((v) => v === null);
}

/**
 * Remembers what the user last looked at on the Task Queue or My Work: filters (not the search text), sort, page size and the tab.
 * The page number is not kept. Stored as the same query parameters the URL uses, so it reads back through the one parser.
 * Never throws: storage can be blocked, full or hold something old.
 */
export function saveLastView(page: RememberedPage, userId: number | null, state: QueueState): void {
  try {
    const params = toQueryParams({
      ...state,
      filters: { ...state.filters, q: '' },
      page: 1,
      podId: null,
    });
    const kept = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null));
    storage()?.setItem(key(page, userId), JSON.stringify(kept));
  } catch {
    // Not remembered.
  }
}

/** The remembered view, or null when there is none or it is the page's default view. */
export function loadLastView(page: RememberedPage, userId: number | null): QueueState | null {
  try {
    const raw = storage()?.getItem(key(page, userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))) {
        record[k] = v;
      }
    }
    const state = parseQueueState(convertToParamMap(record));
    return isBareState(state) ? null : state;
  } catch {
    return null;
  }
}
