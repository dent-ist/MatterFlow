import { ParamMap, Params } from '@angular/router';

/**
 * The filters of My Matters (README 6.8), kept in the address (`?clientId=&matterId=&role=&show=&scope=all&managerId=`) so Back restores them.
 * Defaults are left out of the address. "My matters" is a default view and not access control: the filters select, they never grant.
 */
export type MmScope = 'mine' | 'all';
export type MmRole = 'both' | 'primary' | 'secondary';

export interface MmFilters {
  scope: MmScope;
  role: MmRole;
  clientId: number | null;
  /** The Matter filter (`?matterId=`, issue #941): one matter limits the grid, the Calendar, the Breakdown and the Data tab. */
  matterId: number | null;
  /** All matters scope only: a named project manager. */
  managerId: number | null;
  /** The Overview grid's pre-filter (`?show=`, issue #942); All open is the default and is left out of the address. */
}

export const DEFAULT_FILTERS: MmFilters = {
  scope: 'mine',
  role: 'both',
  clientId: null,
  matterId: null,
  managerId: null,
};

export const ROLE_LABELS: Record<MmRole, string> = {
  both: 'Primary or secondary',
  primary: 'Primary',
  secondary: 'Secondary',
};

const positive = (v: string | null): number | null => {
  const n = v !== null && /^[1-9]\d*$/.test(v) ? Number(v) : null;
  return n !== null && Number.isSafeInteger(n) ? n : null;
};

/** The filters an address holds. `canAll`: the person holds Matter.AssignManagers (without it `scope=all` and `managerId` are ignored). */
export function parseFilters(q: ParamMap, canAll: boolean): MmFilters {
  const scope: MmScope = canAll && q.get('scope') === 'all' ? 'all' : 'mine';
  const role = q.get('role');
  return {
    scope,
    role: role === 'primary' || role === 'secondary' ? role : 'both',
    clientId: positive(q.get('clientId')),
    matterId: positive(q.get('matterId')),
    managerId: scope === 'all' ? positive(q.get('managerId')) : null,
  };
}

/** The query parameters for a set of filters; a default value is `null` so `queryParamsHandling: 'merge'` removes it. */
export function filtersToParams(f: MmFilters): Params {
  return {
    scope: f.scope === 'all' ? 'all' : null,
    role: f.role === 'both' ? null : f.role,
    clientId: f.clientId,
    matterId: f.matterId,
    managerId: f.scope === 'all' ? f.managerId : null,
  };
}

/** The role matters when the matters are chosen by a person: in the All scope only once a project manager is named. */
export function roleApplies(f: MmFilters): boolean {
  return f.scope === 'mine' || f.managerId !== null;
}

/** How many filters differ from the default (the phone's "Filters (2)" button). The scope is a mode of the page, not a filter. */
export function activeFilterCount(f: MmFilters): number {
  let n = 0;
  if (f.managerId !== null) n++;
  if (f.clientId !== null) n++;
  if (f.matterId !== null) n++;
  if (f.role !== 'both' && roleApplies(f)) n++;
  return n;
}

/**
 * The arguments every `/my-matters/*` call shares: `scope, role, clientId, from, to, managerId` in the order of the generated client, then `fresh` (never sent) and `matterId`.
 * The calendar is asked for one month at a time (its own parameter), so no call carries a date range.
 */
export interface MmCommonArgs {
  scope: string | undefined;
  role: string | undefined;
  clientId: number | undefined;
  managerId: number | undefined;
  matterId: number | undefined;
}

export function commonArgs(f: MmFilters): MmCommonArgs {
  return {
    scope: f.scope === 'all' ? 'all' : undefined,
    role: f.role !== 'both' && roleApplies(f) ? f.role : undefined,
    clientId: f.clientId ?? undefined,
    managerId: f.scope === 'all' ? (f.managerId ?? undefined) : undefined,
    matterId: f.matterId ?? undefined,
  };
}

/** The query string of an API `query` field (`managedByMe=true&status=NEW&status=...`) as router query parameters; repeated keys become arrays. */
export function queryToParams(query: string): Params {
  const out: Record<string, string | string[]> = {};
  const search = new URLSearchParams(query.replace(/^\?/, ''));
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    out[key] = all.length === 1 ? all[0] : all;
  }
  return out;
}
