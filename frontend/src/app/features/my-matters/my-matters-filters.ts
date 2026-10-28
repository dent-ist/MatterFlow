import { ParamMap, Params } from '@angular/router';

/**
 * The filters of My Matters (README 6.8), kept in the address (`?clientId=&role=&range=&from=&to=&scope=all&managerId=`) so Back restores them.
 * Defaults are left out of the address. "My matters" is a default view and not access control: the filters select, they never grant.
 */
export type MmScope = 'mine' | 'all';
export type MmRole = 'both' | 'primary' | 'secondary';
/** The date range of the Deadlines tab: the next 2 or 4 weeks (the API's two windows), today only, or a custom due-date range. */
export type MmRange = '2w' | '4w' | 'today' | 'custom';

export interface MmFilters {
  scope: MmScope;
  role: MmRole;
  clientId: number | null;
  range: MmRange;
  /** `yyyy-mm-dd`; only with `range=custom`. */
  from: string | null;
  to: string | null;
  /** All matters scope only: a named project manager. */
  managerId: number | null;
}

export const DEFAULT_FILTERS: MmFilters = {
  scope: 'mine',
  role: 'both',
  clientId: null,
  range: '4w',
  from: null,
  to: null,
  managerId: null,
};

export const ROLE_LABELS: Record<MmRole, string> = {
  both: 'Both',
  primary: 'Primary',
  secondary: 'Secondary',
};

export const RANGE_LABELS: Record<MmRange, string> = {
  today: 'Today',
  '2w': 'Next 2 weeks',
  '4w': 'Next 4 weeks',
  custom: 'Custom',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const positive = (v: string | null): number | null => {
  const n = v !== null && /^[1-9]\d*$/.test(v) ? Number(v) : null;
  return n !== null && Number.isSafeInteger(n) ? n : null;
};

/** The filters an address holds. `canAll`: the person holds Matter.AssignManagers (without it `scope=all` and `managerId` are ignored). */
export function parseFilters(q: ParamMap, canAll: boolean): MmFilters {
  const scope: MmScope = canAll && q.get('scope') === 'all' ? 'all' : 'mine';
  const role = q.get('role');
  const range = q.get('range');
  const from = q.get('from');
  const to = q.get('to');
  const r: MmRange =
    range === '2w' || range === 'today' || range === 'custom' || range === '4w' ? range : '4w';
  return {
    scope,
    role: role === 'primary' || role === 'secondary' ? role : 'both',
    clientId: positive(q.get('clientId')),
    range: r,
    from: r === 'custom' && from && DATE.test(from) ? from : null,
    to: r === 'custom' && to && DATE.test(to) ? to : null,
    managerId: scope === 'all' ? positive(q.get('managerId')) : null,
  };
}

/** The query parameters for a set of filters; a default value is `null` so `queryParamsHandling: 'merge'` removes it. */
export function filtersToParams(f: MmFilters): Params {
  return {
    scope: f.scope === 'all' ? 'all' : null,
    role: f.role === 'both' ? null : f.role,
    clientId: f.clientId,
    range: f.range === '4w' ? null : f.range,
    from: f.range === 'custom' ? f.from : null,
    to: f.range === 'custom' ? f.to : null,
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
  if (f.role !== 'both' && roleApplies(f)) n++;
  if (f.range !== '4w') n++;
  return n;
}

/**
 * The arguments every `/my-matters/*` call shares, in the order of the generated client: `scope, role, clientId, from, to, managerId`.
 * The date range is a due-date range of tasks: it is sent to Upcoming deadlines only (`range` below), never to the strip, the attention
 * list, the health table, the workload or the activity, which are about all open work (a range would drop overdue and undated tasks).
 */
export interface MmCommonArgs {
  scope: string | undefined;
  role: string | undefined;
  clientId: number | undefined;
  managerId: number | undefined;
}

export function commonArgs(f: MmFilters): MmCommonArgs {
  return {
    scope: f.scope === 'all' ? 'all' : undefined,
    role: f.role !== 'both' && roleApplies(f) ? f.role : undefined,
    clientId: f.clientId ?? undefined,
    managerId: f.scope === 'all' ? (f.managerId ?? undefined) : undefined,
  };
}

/** The window and due-date range of the Deadlines tab for the range filter. `today` is `yyyy-mm-dd` in the viewer's zone. */
export function deadlineArgs(
  f: MmFilters,
  today: string,
): { days: number; from: string | undefined; to: string | undefined } {
  switch (f.range) {
    case '2w':
      return { days: 14, from: undefined, to: undefined };
    case 'today':
      return { days: 14, from: today, to: today };
    case 'custom':
      return { days: 28, from: f.from ?? undefined, to: f.to ?? undefined };
    default:
      return { days: 28, from: undefined, to: undefined };
  }
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

/** The words that name the active filters for the strip's accessible name ("Client 12, Primary only"). */
export function filterSummary(
  f: MmFilters,
  clientName: string | null,
  managerName: string | null,
): string {
  const parts: string[] = [];
  if (f.scope === 'all') parts.push('all matters');
  if (f.managerId !== null) parts.push(`project manager ${managerName ?? f.managerId}`);
  if (f.clientId !== null) parts.push(`client ${clientName ?? f.clientId}`);
  if (f.role !== 'both' && roleApplies(f)) parts.push(`${f.role} manager only`);
  return parts.length > 0 ? parts.join(', ') : 'all your matters, as primary or secondary manager';
}

/**
 * The Matters list address for the "Matters I manage" cell: the page's own filter keys (`mine`, `primaryManager`, `secondaryManager`,
 * `managerId`, `clientId`), so the list shows exactly the matters counted. The list's default Status (Active) is the strip's "active matters".
 */
export function mattersListParams(f: MmFilters, me: number): Params {
  const out: Params = {};
  if (f.clientId !== null) out['clientId'] = String(f.clientId);
  const who = f.scope === 'all' ? f.managerId : me;
  if (who === null) return out;
  if (f.role === 'primary') out['primaryManager'] = String(who);
  else if (f.role === 'secondary') out['secondaryManager'] = String(who);
  else if (f.scope === 'all') out['managerId'] = String(who);
  else out['mine'] = 'true';
  return out;
}
