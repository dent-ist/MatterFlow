import { ParamMap, Params } from '@angular/router';
import type {
  AssetDataCounts,
  AssetDataResponse,
  AssetDataTypeRow,
  AssetUnitValue,
} from '../../api/generated/api-client';
import type { ChartRow } from '../../shared/charts/chart-types';
import { DataStatus, SIZE_UNITS, assetsParams } from './data-model';

/**
 * What the Data Area looks at (epic #893, issues #931 to #933): the matters, the asset types, the number fields that mean size and the period, plus the way it is
 * shown (grid, bar or pie) and the status a tile filtered the grid to. Everything is kept in the address (`?dm=&dt=&ds=&dp=&dfrom=&dto=&dv=&dstatus=&dmeasure=`) so Back
 * restores it, and the four choices are also remembered per person (the `my-matters.data` view state). Nothing here knows Angular.
 */
export type DataPeriod = 'all' | '30d' | '12m' | 'year' | 'custom';
export type DataView = 'table' | 'bar' | 'pie';

/** A number field chosen to mean size. `unit` is null for the asset type's own default field (its unit is the type's). */
export interface SizeChoice {
  typeId: number;
  key: string;
  unit: string | null;
}

export interface DataSelection {
  /** Empty: all matters. */
  matterIds: number[];
  /** Empty: all asset types. */
  typeIds: number[];
  /** Empty: every type's own default size field. */
  sizeFields: SizeChoice[];
  period: DataPeriod;
  /** `yyyy-mm-dd`; only with `period=custom`. */
  from: string | null;
  to: string | null;
}

export const DEFAULT_SELECTION: DataSelection = {
  matterIds: [],
  typeIds: [],
  sizeFields: [],
  period: 'all',
  from: null,
  to: null,
};

export const PERIOD_LABELS: Record<DataPeriod, string> = {
  all: 'All time',
  '30d': 'Last 30 days',
  '12m': 'Last 12 months',
  year: 'This year',
  custom: 'Custom range',
};

export const MAX_MATTERS = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly DataStatus[] = ['active', 'inactive', 'pending', 'disposed'];

function ids(text: string | null): number[] {
  if (!text) return [];
  const out: number[] = [];
  for (const part of text.split(',')) {
    const n = /^[1-9]\d{0,9}$/.test(part) ? Number(part) : NaN;
    if (Number.isSafeInteger(n) && !out.includes(n)) out.push(n);
  }
  return out.slice(0, MAX_MATTERS);
}

/** `typeId:key` or `typeId:key:unit`. */
export function sizeToken(c: SizeChoice): string {
  return c.unit ? `${c.typeId}:${c.key}:${c.unit}` : `${c.typeId}:${c.key}`;
}

export function parseSizeToken(token: string): SizeChoice | null {
  const parts = token.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const typeId = /^[1-9]\d{0,9}$/.test(parts[0]) ? Number(parts[0]) : NaN;
  if (!Number.isSafeInteger(typeId) || !/^[A-Za-z0-9_.-]{1,64}$/.test(parts[1])) return null;
  const unit = parts[2] ?? null;
  if (unit !== null && !(SIZE_UNITS as readonly string[]).includes(unit)) return null;
  return { typeId, key: parts[1], unit };
}

function sizes(text: string | null): SizeChoice[] {
  if (!text) return [];
  const out: SizeChoice[] = [];
  for (const part of text.split(',')) {
    const c = parseSizeToken(part);
    if (c && !out.some((o) => o.typeId === c.typeId && o.key === c.key)) out.push(c);
  }
  return out.slice(0, 40);
}

const KEYS = ['dm', 'dt', 'ds', 'dp', 'dfrom', 'dto', 'dv', 'dstatus', 'dmeasure'] as const;

/** True when the address says anything about the Data Area (then it wins over what is remembered). */
export function hasExplicitSelection(q: ParamMap): boolean {
  return ['dm', 'dt', 'ds', 'dp', 'dv'].some((k) => q.has(k));
}

export function parseSelection(q: ParamMap): DataSelection {
  const p = q.get('dp');
  const period: DataPeriod =
    p === '30d' || p === '12m' || p === 'year' || p === 'custom' ? p : 'all';
  const from = q.get('dfrom');
  const to = q.get('dto');
  return {
    matterIds: ids(q.get('dm')),
    typeIds: ids(q.get('dt')),
    sizeFields: sizes(q.get('ds')),
    period,
    from: period === 'custom' && from && DATE.test(from) ? from : null,
    to: period === 'custom' && to && DATE.test(to) ? to : null,
  };
}

export function parseView(q: ParamMap): DataView {
  const v = q.get('dv');
  return v === 'bar' || v === 'pie' ? v : 'table';
}

export function parseStatus(q: ParamMap): DataStatus | null {
  const s = q.get('dstatus') as DataStatus | null;
  return s && STATUSES.includes(s) ? s : null;
}

/**
 * The address for a selection. A default is `null` so `queryParamsHandling: 'merge'` removes it, except `dp`, which is always written: it is the sign that the
 * person chose (so "All time" stays chosen even though it is the default, and a remembered choice does not come back over it).
 */
export function selectionToParams(s: DataSelection): Params {
  return {
    dm: s.matterIds.length ? s.matterIds.join(',') : null,
    dt: s.typeIds.length ? s.typeIds.join(',') : null,
    ds: s.sizeFields.length ? s.sizeFields.map(sizeToken).join(',') : null,
    dp: s.period,
    dfrom: s.period === 'custom' ? s.from : null,
    dto: s.period === 'custom' ? s.to : null,
  };
}

/** Every address key of the Data Area set to null: the page's scope or tab changes must not leave them behind. */
export function clearedParams(): Params {
  return Object.fromEntries(KEYS.map((k) => [k, null]));
}

/** The state that is remembered per person (small, plain JSON). */
export function rememberedOf(s: DataSelection, view: DataView): Record<string, unknown> {
  return {
    matterIds: s.matterIds,
    typeIds: s.typeIds,
    sizeFields: s.sizeFields.map(sizeToken),
    period: s.period,
    from: s.from,
    to: s.to,
    view,
  };
}

/** A remembered state back into a selection and a view; anything unreadable gives the default. */
export function fromRemembered(state: Record<string, unknown> | null): {
  selection: DataSelection;
  view: DataView;
} {
  const none = { selection: DEFAULT_SELECTION, view: 'table' as DataView };
  if (!state) return none;
  const list = (v: unknown): number[] =>
    Array.isArray(v)
      ? v.filter((n): n is number => Number.isSafeInteger(n) && n > 0).slice(0, MAX_MATTERS)
      : [];
  const period = state['period'];
  const p: DataPeriod =
    period === '30d' || period === '12m' || period === 'year' || period === 'custom'
      ? period
      : 'all';
  const text = (v: unknown): string | null => (typeof v === 'string' && DATE.test(v) ? v : null);
  const fields = Array.isArray(state['sizeFields'])
    ? (state['sizeFields'] as unknown[])
        .map((t) => (typeof t === 'string' ? parseSizeToken(t) : null))
        .filter((c): c is SizeChoice => c !== null)
    : [];
  const view = state['view'];
  return {
    selection: {
      matterIds: list(state['matterIds']),
      typeIds: list(state['typeIds']),
      sizeFields: fields,
      period: p,
      from: p === 'custom' ? text(state['from']) : null,
      to: p === 'custom' ? text(state['to']) : null,
    },
    view: view === 'bar' || view === 'pie' ? view : 'table',
  };
}

export function sameSelection(a: DataSelection, b: DataSelection): boolean {
  return (
    a.period === b.period &&
    a.from === b.from &&
    a.to === b.to &&
    a.matterIds.join() === b.matterIds.join() &&
    a.typeIds.join() === b.typeIds.join() &&
    a.sizeFields.map(sizeToken).join() === b.sizeFields.map(sizeToken).join()
  );
}

/** Nothing is narrowed: all matters, all types, default sizes, all time. */
export function isEverything(s: DataSelection): boolean {
  return sameSelection(s, DEFAULT_SELECTION);
}

/** How many of the four choices differ from the default. */
export function chosenCount(s: DataSelection): number {
  return (
    (s.matterIds.length ? 1 : 0) +
    (s.typeIds.length ? 1 : 0) +
    (s.sizeFields.length ? 1 : 0) +
    (s.period !== 'all' ? 1 : 0)
  );
}

function addDays(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The first and last day (`yyyy-mm-dd`, the viewer's calendar) of a period; undefined for no limit. */
export function periodRange(
  s: DataSelection,
  today: string,
): { from: string | undefined; to: string | undefined } {
  switch (s.period) {
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '12m': {
      const [y, m, d] = today.split('-').map(Number);
      const at = new Date(Date.UTC(y - 1, m - 1, d));
      at.setUTCDate(at.getUTCDate() + 1); // a year back, the same day not counted twice
      return { from: at.toISOString().slice(0, 10), to: today };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      return { from: s.from ?? undefined, to: s.to ?? undefined };
    default:
      return { from: undefined, to: undefined };
  }
}

/** The arguments of `getMyMattersData` after scope and role (`matterIds, assetTypeIds, sizeFields, from, to`), in the order of the generated client. */
export function selectionArgs(
  s: DataSelection,
  today: string,
): {
  matterIds: number[] | undefined;
  assetTypeIds: number[] | undefined;
  sizeFields: string[] | undefined;
  from: string | undefined;
  to: string | undefined;
} {
  const r = periodRange(s, today);
  return {
    matterIds: s.matterIds.length ? s.matterIds : undefined,
    assetTypeIds: s.typeIds.length ? s.typeIds : undefined,
    sizeFields: s.sizeFields.length ? s.sizeFields.map(sizeToken) : undefined,
    from: r.from,
    to: r.to,
  };
}

/**
 * A count opens the Assets list with exactly those assets only when the list can say what was counted: the list knows one matter and no period. With
 * several matters or a period the numbers are plain text (the info point says so). A figure of the whole selection (not of one asset type row) also needs
 * the types to be all of them or one.
 */
export function listIsExact(s: DataSelection, wholeSelection = false): boolean {
  return (
    s.matterIds.length <= 1 && s.period === 'all' && (!wholeSelection || s.typeIds.length <= 1)
  );
}

/** The Assets list address for a count of the Data Area. */
export function listParams(
  query: string,
  scope: 'mine' | 'all',
  s: DataSelection,
  status: DataStatus | null,
): Params {
  const p = assetsParams(query, scope, status);
  if (s.matterIds.length === 1) p['matterId'] = s.matterIds[0];
  if (s.typeIds.length === 1 && !p['typeId']) p['typeId'] = s.typeIds[0];
  return p;
}

// ---- the numbers of the grid, the tiles and the chart, for one status filter

const CODE_OF_STATUS: Record<DataStatus, string> = {
  active: 'ACTIVE',
  inactive: 'INACTIVE',
  pending: 'PENDING_DISPOSITION',
  disposed: 'DISPOSED',
  all: '',
};

/** The count of one status, or of every asset when the status is null. */
export function countOf(c: AssetDataCounts, status: DataStatus | null): number {
  switch (status) {
    case 'active':
      return c.active;
    case 'inactive':
      return c.inactive;
    case 'pending':
      return c.pendingDisposition;
    case 'disposed':
      return c.disposed;
    default:
      return c.assets;
  }
}

/** The size of a type row for a status (every status when null). The response gives the size of each disposition separately. */
export function sizeOf(row: AssetDataTypeRow, status: DataStatus | null): AssetUnitValue[] {
  if (status === null || status === 'all') return row.counts.size;
  const code = CODE_OF_STATUS[status];
  return row.dispositionSizes.find((d) => d.disposition === code)?.size ?? [];
}

/** The units that appear in a response, in order (GB before Items). */
export function unitsOf(d: AssetDataResponse): string[] {
  const set = new Set<string>();
  for (const u of d.totals.size) if (u.assets > 0) set.add(u.unit);
  return [...set];
}

export function valueIn(size: readonly AssetUnitValue[], unit: string): number {
  return size.find((s) => s.unit === unit)?.value ?? 0;
}

/** The rows of a chart: one per asset type, for the assets (a count) or for one unit of size. */
export function typeChartRows(
  d: AssetDataResponse,
  measure: string,
  status: DataStatus | null,
  link: (row: AssetDataTypeRow) => ChartRow['link'],
): ChartRow[] {
  return d.types.map((t) => ({
    label: t.name,
    value: measure === 'assets' ? countOf(t.counts, status) : valueIn(sizeOf(t, status), measure),
    link: link(t),
  }));
}
