import type {
  ReportViewLayout,
  ViewColumnLayout,
  ViewFilterLayout,
  ViewSortLayout,
} from '../../api/generated/api-client';
import type { FilterValue, FilterValues } from '../../shared/filters/filter-def';
import type { GridPrefs } from '../../shared/ui/grid-prefs';
import { RESIZE_MAX_PX, RESIZE_MIN_PX } from '../../shared/ui/resizable-columns';
import type { ResultColumn } from './report-column-defs';
import { DEFAULT_RESULT_PAGE_SIZE, RESULT_PAGE_SIZES } from './report-result-query';

/**
 * The layout of a saved view (#722, spec section 6): what the person arranged on the result grid, as the server stores it
 * (`POST /reports/{id}/views`, `layout`). Both directions are pure functions of the grid's own state (`RecordGridState`: order, visibility, widths; the
 * sort id, the filter text and the page size of the result grid), so a view is exactly what the grid shows and nothing else. Parameter values are not
 * part of a view (the address holds them).
 *
 * A view names columns by their NAME (the server checks them against the person's live result and lists the ones it lacks in `ignoredColumns`); two
 * columns of one name are told apart by their order, the n-th "Total" of the view is the n-th "Total" of the result.
 */

/** The widths the server accepts in a layout (80 to 640 px, narrower than the grid's own 72 to 720). */
export const VIEW_WIDTH_MIN = 80;
export const VIEW_WIDTH_MAX = 640;

/** What the grid knows right now. */
export interface GridLayoutState {
  readonly columns: readonly ResultColumn[];
  /** Every column key, in the person's order (`orderedKeys` of the grid definitions and its prefs). */
  readonly order: readonly string[];
  /** The keys of the columns that are drawn (`RecordGridState.shown`). */
  readonly shown: readonly string[];
  /** The widths the person set, by column key (`RecordGridState.widths`). */
  readonly widths: Readonly<Record<string, number>>;
  /** The grid's sort (`c3`, or `-c3` for descending), null for the report's own order. */
  readonly sort: string | null;
  /** The `filter` text of the rows endpoint (`[{column, op, value, value2}]`), undefined when nothing is set. */
  readonly filterJson: string | undefined;
  readonly pageSize: number;
}

const clampWidth = (px: number): number =>
  Math.min(VIEW_WIDTH_MAX, Math.max(VIEW_WIDTH_MIN, Math.round(px)));

/** The layout of the grid as it is: every column of the result in the person's order (hidden ones flagged), its width when one was set, the sort, the filters and the page size. */
export function captureLayout(state: GridLayoutState): ReportViewLayout {
  const byKey = new Map(state.columns.map((c) => [c.key, c] as const));
  const shown = new Set(state.shown);
  const columns: ViewColumnLayout[] = [];
  for (const key of state.order) {
    const c = byKey.get(key);
    if (!c) continue;
    const width = state.widths[key];
    columns.push({
      name: c.name,
      hidden: !shown.has(key),
      width: width === undefined ? undefined : clampWidth(width),
    });
  }
  const desc = state.sort?.startsWith('-') ?? false;
  const sortColumn = state.sort
    ? state.columns.find((c) => c.id === (desc ? state.sort!.slice(1) : state.sort))
    : undefined;
  const sort: ViewSortLayout[] = sortColumn ? [{ column: sortColumn.name, descending: desc }] : [];
  const filters: ViewFilterLayout[] = state.filterJson
    ? (JSON.parse(state.filterJson) as ViewFilterLayout[]).map((f) => ({
        column: f.column,
        op: f.op,
        value: f.value,
        value2: f.value2,
      }))
    : [];
  return { columns, sort, filters, pageSize: state.pageSize };
}

/** The same layout as one comparable text (what "(modified)" and "No changes to save." compare). */
export function layoutKey(layout: ReportViewLayout): string {
  return JSON.stringify([
    (layout.columns ?? []).map((c) => [c.name, c.hidden, c.width ?? null]),
    (layout.sort ?? []).map((s) => [s.column, s.descending]),
    (layout.filters ?? []).map((f) => [f.column, f.op, f.value ?? null, f.value2 ?? null]),
    layout.pageSize ?? DEFAULT_RESULT_PAGE_SIZE,
  ]);
}

/** A layout turned into what the grid is set to. */
export interface ResolvedLayout {
  readonly prefs: GridPrefs;
  /** The widths to store, by column key (empty: the grid lays itself out). */
  readonly widths: Readonly<Record<string, number>>;
  /** The grid's sort id, null for the report's own order. */
  readonly sort: string | null;
  /** The filter values by column id (the keys of `filterDefsOf`). */
  readonly filters: FilterValues;
  readonly pageSize: number;
  /** The view names a column that this result does not have (a column, a sort or a filter): it was left out. */
  readonly skipped: boolean;
}

/** The value of a column filter the view stores, or null when this screen has no control for it (the server takes more operators than the filter row can make). */
function filterValueOf(column: ResultColumn, f: ViewFilterLayout): FilterValue | null {
  switch (column.kind) {
    case 'integer':
    case 'decimal':
    case 'date':
    case 'dateTime':
      if (f.op === 'between') return { from: f.value ?? '', to: f.value2 ?? '' };
      if (f.op === 'gte' || f.op === 'onOrAfter') return { from: f.value ?? '', to: '' };
      if (f.op === 'lte' || f.op === 'onOrBefore') return { from: '', to: f.value ?? '' };
      return null;
    case 'boolean':
      return f.op === 'eq' && (f.value === 'true' || f.value === 'false') ? f.value : null;
    default:
      return f.op === 'contains' && f.value ? f.value : null;
  }
}

/**
 * What applying a view does to this result (spec 6.2): the columns of the view in its order and with its widths and visibility, a column the result has
 * and the view lacks appended visible at the end, a column the result lacks skipped (and so is a sort or filter on it, which sets `skipped`), the first
 * sort key (the grid sorts by one column), the filters the filter row can show, and a page size the pager offers.
 */
export function resolveLayout(
  layout: ReportViewLayout,
  columns: readonly ResultColumn[],
): ResolvedLayout {
  let skipped = false;
  const byName = new Map<string, ResultColumn[]>();
  for (const c of columns) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  const used = new Set<number>();
  const order: string[] = [];
  const visible: string[] = [];
  const widths: Record<string, number> = {};
  for (const lc of layout.columns ?? []) {
    const c = byName.get(lc.name)?.find((x) => !used.has(x.index));
    if (!c) {
      skipped = true;
      continue;
    }
    used.add(c.index);
    order.push(c.key);
    if (!lc.hidden) visible.push(c.key);
    if (lc.width !== undefined && lc.width !== null) {
      widths[c.key] = Math.min(RESIZE_MAX_PX, Math.max(RESIZE_MIN_PX, Math.round(lc.width)));
    }
  }
  for (const c of columns) {
    if (used.has(c.index)) continue;
    order.push(c.key);
    visible.push(c.key);
  }

  // A view with every column hidden would draw an empty table: show them all instead.
  if (visible.length === 0) visible.push(...order);

  let sort: string | null = null;
  const first = (layout.sort ?? [])[0];
  if (first) {
    const c = byName.get(first.column)?.[0];
    if (c) sort = `${first.descending ? '-' : ''}${c.id}`;
    else skipped = true;
  }

  const filters: Record<string, FilterValue> = {};
  for (const f of layout.filters ?? []) {
    const c = byName.get(f.column)?.[0];
    if (!c) {
      skipped = true;
      continue;
    }
    const value = filterValueOf(c, f);
    if (value !== null) filters[c.id] = value;
  }

  const size = layout.pageSize ?? DEFAULT_RESULT_PAGE_SIZE;
  const pageSize = (RESULT_PAGE_SIZES as readonly number[]).includes(size)
    ? size
    : DEFAULT_RESULT_PAGE_SIZE;
  return { prefs: { order, visible }, widths, sort, filters, pageSize, skipped };
}
