import { ParamMap, Params } from '@angular/router';
import { DashboardTab, isDashboardTab } from './dashboard-prefs';
import { USERS_AVAILABILITY_PARAM, USERS_VIEW_PARAM } from './dashboard-links';
import { DEFAULT_VIEW } from './swimlane/swimlane-model';
import { DEFAULT_CHOICE } from './ui/trend-model';

/**
 * The one place that knows what the Dashboard address may carry (UX review 2, P9).
 *
 * The address holds only what differs from the default: a value equal to its default is removed (`group=none` is the same board as no
 * `group`), and a parameter that no tab knows is dropped the first time the page normalises the address. Every tab writes its
 * parameters through `withoutDefaults`, and the page rewrites a pasted link through `canonicalParams`, always with `replaceUrl` (no extra
 * history entry); only a user's tab change is a history entry.
 */

/** The query parameters each tab owns (a tab's parameters are removed from the address when another tab is chosen). */
export const DASH_TAB_PARAMS: Record<DashboardTab, readonly string[]> = {
  summary: [],
  breakdowns: ['bmetric'],
  trends: ['types', 'metric', 'all', 'due'],
  swimlane: [
    'group',
    'sort',
    'days',
    'q',
    'pod',
    'assignee',
    'type',
    'priority',
    'overdue',
    'mine',
    'lane',
  ],
  users: [
    'upod',
    USERS_AVAILABILITY_PARAM,
    'uq',
    'uload',
    'uprio',
    USERS_VIEW_PARAM,
    'cp',
    'cfrom',
    'cto',
    'cov',
    'unopod',
    'sprio',
    'stype',
  ],
};

/** Page-wide parameters (scope and period of P1 and P3); they have no default of their own yet and follow the person across tabs. */
export const DASH_SHARED_PARAMS: readonly string[] = ['pod', 'period'];

/** The default of each parameter, per tab: the value that is NOT written to the address. */
export const DASH_DEFAULTS: Record<DashboardTab, Readonly<Record<string, string>>> = {
  summary: {},
  breakdowns: {},
  trends: { all: '1', metric: DEFAULT_CHOICE.metric },
  swimlane: {
    group: DEFAULT_VIEW.groupBy,
    sort: DEFAULT_VIEW.sort,
    days: String(DEFAULT_VIEW.days),
  },
  users: { [USERS_VIEW_PARAM]: 'workload', [USERS_AVAILABILITY_PARAM]: 'all', cp: '30' },
};

const KNOWN: ReadonlySet<string> = new Set([
  'tab',
  ...DASH_SHARED_PARAMS,
  ...Object.values(DASH_TAB_PARAMS).flat(),
]);

/** Router parameters that remove every parameter owned by the tabs other than `tab` (what a tab change leaves behind). */
export function clearedTabParams(tab: DashboardTab): Record<string, null> {
  const keep = new Set(DASH_TAB_PARAMS[tab]);
  const out: Record<string, null> = {};
  for (const [owner, keys] of Object.entries(DASH_TAB_PARAMS)) {
    if (owner === tab) continue;
    for (const key of keys) if (!keep.has(key)) out[key] = null;
  }
  return out;
}

/** `params` with every value that equals the tab's default replaced by `null` (the router's "remove"). */
export function withoutDefaults<T extends Record<string, string | null>>(
  tab: DashboardTab,
  params: T,
): Record<string, string | null> {
  const defaults = DASH_DEFAULTS[tab];
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = value !== null && defaults[key] === value ? null : value;
  }
  return out;
}

/**
 * What the address should say for the tab on screen: the `tab` parameter is kept when it names the tab shown (a missing one stays missing,
 * so a plain link is never rewritten) and set to the tab shown when it named a tab the person cannot open or none that exists; defaults
 * and unknown parameters are removed. Order is kept, repeated keys stay repeated.
 */
export function canonicalParams(raw: ParamMap, shown: DashboardTab): Params {
  const out: Params = {};
  for (const key of raw.keys) {
    if (!KNOWN.has(key)) continue;
    const values = raw.getAll(key);
    if (key === 'tab') {
      out[key] = shown;
      continue;
    }
    const kept = values.filter((v) => DASH_DEFAULTS[shown][key] !== v);
    if (kept.length > 0) out[key] = kept.length === 1 ? kept[0] : kept;
  }
  return out;
}

/** True when `raw` already says exactly `canonical` (no rewrite is needed). */
export function sameParams(raw: ParamMap, canonical: Params): boolean {
  const keys = raw.keys;
  if (keys.length !== Object.keys(canonical).length) return false;
  return keys.every((key) => {
    const want = canonical[key];
    if (want === undefined) return false;
    const have = raw.getAll(key);
    const wanted = (Array.isArray(want) ? want : [want]) as string[];
    return have.length === wanted.length && have.every((v, i) => v === wanted[i]);
  });
}

/** Why a requested `?tab=` is not the tab shown (R1): the person may not open it, or no such tab exists. */
export type TabFallback = { kind: 'forbidden'; tab: DashboardTab } | { kind: 'unknown' };

export function tabFallback(
  requested: string | null,
  allowed: readonly DashboardTab[],
): TabFallback | null {
  if (requested === null || requested === '') return null;
  if (!isDashboardTab(requested)) return { kind: 'unknown' };
  return allowed.includes(requested) ? null : { kind: 'forbidden', tab: requested };
}
