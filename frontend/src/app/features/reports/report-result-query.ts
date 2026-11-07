import { FilterDef, FilterValue, FilterValues, isRange } from '../../shared/filters/filter-def';
import type { SortKind } from '../../shared/work-queue/sort-sentences';
import type { ResultColumn } from './report-column-defs';

/** The pager's sizes (spec 4.2): the server clamps a page to 250 rows. */
export const RESULT_PAGE_SIZES = [25, 50, 100, 250] as const;
export const DEFAULT_RESULT_PAGE_SIZE = 50;

/**
 * One header filter per column, by type (spec 4.3): text contains, a number range, a date range (the shared presets) and Yes/No/Any. The `key` is the
 * column's id (`c3`), the `column` is the grid key of its cell; the filter row, the chips and the Clear Filters button all come from these definitions.
 * Text matches "contains" only: the shared text filter has no Equals or Starts With, and Blank / Not Blank have no control yet (see the status page).
 */
export function filterDefsOf(columns: readonly ResultColumn[]): FilterDef[] {
  return columns.map((c): FilterDef => {
    const base = { key: c.id, label: c.name, column: c.key } as const;
    switch (c.kind) {
      case 'integer':
        return { ...base, type: 'numberRange', numberShape: 'long' };
      case 'decimal':
        return { ...base, type: 'numberRange', numberShape: 'decimal' };
      case 'date':
      case 'dateTime':
        return { ...base, type: 'dateRange' };
      case 'boolean':
        return {
          ...base,
          type: 'triState',
          options: [
            { value: '', label: 'Any' },
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ],
        };
      default:
        return { ...base, type: 'text', placeholder: 'Contains' };
    }
  });
}

/**
 * How every request names a column: its zero-based POSITION in the result's `columns` array, `#3` (#1291, like the sort since #1288). Never the name:
 * a report may return two columns of one name (`SELECT a.Name, b.Name`), and a name could look like a position (`#3`) or carry a comma. The `#` is
 * URL-encoded to `%23` wherever the reference goes into a query string.
 */
export function columnRef(column: Pick<ResultColumn, 'index'> | number): string {
  return `#${typeof column === 'number' ? column : column.index}`;
}

/** One filter of the `filter` JSON of the rows endpoint. */
export interface ServerFilter {
  readonly column: string;
  readonly op: string;
  readonly value?: string;
  readonly value2?: string;
}

/**
 * The `filter` argument of the rows and export endpoints for the values of the filter row: `[{column, op, value, value2}]` with `column` the position
 * `#<index>` of the column (#1291), or undefined when nothing is set. A range with
 * both ends is `between`, one end `gte` / `lte` (numbers) or `onOrAfter` / `onOrBefore` (dates); Yes and No are `eq`.
 */
export function serverFilter(
  columns: readonly ResultColumn[],
  values: FilterValues,
): string | undefined {
  const out: ServerFilter[] = [];
  for (const c of columns) {
    const v: FilterValue | undefined = values[c.id];
    if (v === undefined) continue;
    const name = columnRef(c);
    switch (c.kind) {
      case 'integer':
      case 'decimal':
      case 'date':
      case 'dateTime': {
        if (!isRange(v)) break;
        const date = c.kind === 'date' || c.kind === 'dateTime';
        if (v.from && v.to) out.push({ column: name, op: 'between', value: v.from, value2: v.to });
        else if (v.from) out.push({ column: name, op: date ? 'onOrAfter' : 'gte', value: v.from });
        else if (v.to) out.push({ column: name, op: date ? 'onOrBefore' : 'lte', value: v.to });
        break;
      }
      case 'boolean':
        if (v === 'true' || v === 'false') out.push({ column: name, op: 'eq', value: v });
        break;
      default:
        if (typeof v === 'string' && v.trim() !== '') {
          out.push({ column: name, op: 'contains', value: v.trim() });
        }
    }
  }
  return out.length > 0 ? JSON.stringify(out) : undefined;
}

/** The most filters the rows endpoint takes in one request (the server answers 400 for more). */
export const MAX_FILTERS = 20;

/** How many filters the server filter text holds (the filters the person set that the server understands). */
export function filterCount(filter: string | undefined): number {
  return filter ? (JSON.parse(filter) as unknown[]).length : 0;
}

/**
 * The `sort` argument of the rows and export endpoints, from the grid's sort (`c3` or `-c3`, the column id with a leading minus for descending): the
 * column's POSITION in the result's `columns` array, `#3:asc` or `#3:desc` (#1288; see {@link columnRef}). The `#` is URL-encoded to `%23` by the generated client. Undefined for the
 * report's own order; an id that is not a column of the result gives undefined. One column only (the one-sort rule of the grid).
 */
export function serverSort(
  columns: readonly ResultColumn[],
  sort: string | null | undefined,
): string | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith('-');
  const column = columns.find((c) => c.id === (desc ? sort.slice(1) : sort));
  return column ? `${columnRef(column)}:${desc ? 'desc' : 'asc'}` : undefined;
}

/** "Sorted by <Column>" words: the column id to its name (the sorted line asks for the label of a sort field). */
export function sortLabels(columns: readonly ResultColumn[]): Record<string, string> {
  return Object.fromEntries(columns.map((c) => [c.id, c.name]));
}

const SORT_KIND: Readonly<Record<ResultColumn['kind'], SortKind>> = {
  integer: 'number',
  decimal: 'number',
  date: 'date',
  dateTime: 'date',
  boolean: 'yesno',
  text: 'text',
};

/** The words of a sort direction by column type (#1289): numbers "lowest first", dates "oldest first", yes/no "no first", text "A to Z". */
export function sortKinds(columns: readonly ResultColumn[]): Record<string, SortKind> {
  return Object.fromEntries(columns.map((c) => [c.id, SORT_KIND[c.kind]]));
}
