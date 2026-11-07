import type { ResultColumnResponse } from '../../api/generated/api-client';
import { formatCalendarDayLong, parseDateOnly } from '../../core/time/time';
import { numericDay, numericTime } from '../../shared/ui/numeric-date';
import type { RecordGridColumn } from '../../shared/ui/record-grid';

/** The column types the rows endpoint reports (`ResultColumnResponse.type`); anything else is read as text. */
export type ColumnKind = 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'dateTime';

export function kindOf(type: string | undefined): ColumnKind {
  switch (type) {
    case 'integer':
    case 'decimal':
    case 'boolean':
    case 'date':
    case 'dateTime':
      return type;
    default:
      return 'text';
  }
}

/** One column of the run's result: its name (the grid key and the header), its position in a row and its type. */
export interface ResultColumn {
  readonly name: string;
  /** The grid key (storage, `data-col`): the name, made unique when a report returns two columns of one name. */
  readonly key: string;
  readonly kind: ColumnKind;
  readonly index: number;
  /**
   * The sort and filter id of the column (`c3`). The report author picks any name (a leading minus, a comma, a colon), so the address of a sort and the
   * keys of the filters never carry the name itself; the id is turned into the name when the request is built.
   */
  readonly id: string;
}

export function resultColumns(columns: readonly ResultColumnResponse[]): ResultColumn[] {
  const seen = new Set<string>();
  return columns.map((c, index) => {
    let key = c.name;
    for (let n = 2; seen.has(key); n++) key = `${c.name} (${n})`;
    seen.add(key);
    return { name: c.name, key, kind: kindOf(c.type), index, id: `c${index}` };
  });
}

/** Default and minimum width of a column by type, in px (spec section 4.5). */
export const COLUMN_WIDTHS: Readonly<Record<ColumnKind, { width: number; min: number }>> = {
  boolean: { width: 96, min: 80 },
  integer: { width: 112, min: 80 },
  decimal: { width: 128, min: 80 },
  date: { width: 128, min: 100 },
  dateTime: { width: 176, min: 140 },
  text: { width: 200, min: 100 },
};

/** A text column widens to this when a value of the first rows is longer than {@link LONG_TEXT} characters. */
export const WIDE_TEXT_PX = 280;
export const LONG_TEXT = 40;
/** Rows of the first page that decide the width of a text column. */
export const SAMPLE_ROWS = 50;
/** What the sort and filter icons of a header need next to its words, and the widest a header can make a column. */
const HEADER_ICONS_PX = 56;
const HEADER_MAX_PX = 320;
/** The average width of one character of a header (12 px, bold, upper case, letter spacing). */
const HEADER_CHAR_PX = 8.5;

/** How many decimals the values of a decimal column carry, at most 4 (the scale of the column, from the rows of the first page). */
export function decimalScale(rows: readonly (readonly unknown[])[], index: number): number {
  let scale = 0;
  for (const row of rows.slice(0, SAMPLE_ROWS)) scale = Math.max(scale, ownDecimals(row[index]));
  return Math.min(scale, 4);
}

function ownDecimals(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const text = String(value);
  if (text.includes('e')) return 0;
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/**
 * The record grid's column definitions for a result whose columns are only known after the run (spec 4.5): the header and the sort id, right aligned
 * numbers, the width and minimum width of the type, a header that is never cut (width at least the words and 56 px of icons, at most 320 px), a text
 * column of 280 px when a value of `sample` (the first rows) is longer than 40 characters, and no width at all for the last text column: it takes
 * the room that is left. A width the person dragged is stored per report and wins over all of this (`mf.col-widths.v1.report-result-<id>`).
 */
export function gridColumnDefs(
  columns: readonly ResultColumn[],
  sample: readonly (readonly unknown[])[] = [],
): RecordGridColumn[] {
  const rows = sample.slice(0, SAMPLE_ROWS);
  const spring = columns.reduce((last, c) => (c.kind === 'text' ? c.index : last), -1);
  return columns.map((c) => {
    const base = COLUMN_WIDTHS[c.kind];
    let width = base.width;
    if (c.kind === 'text' && rows.some((r) => String(r[c.index] ?? '').length > LONG_TEXT)) {
      width = WIDE_TEXT_PX;
    }
    const header = Math.min(
      HEADER_MAX_PX,
      Math.ceil(c.name.length * HEADER_CHAR_PX) + HEADER_ICONS_PX,
    );
    width = Math.max(width, header);
    const isSpring = c.index === spring;
    return {
      key: c.key,
      label: c.name,
      sort: c.id,
      num: c.kind === 'integer' || c.kind === 'decimal',
      // The spring takes what the other columns leave, but never less than its own default; the others keep the minimum of their type.
      width: isSpring ? undefined : `${width}px`,
      minWidth: `${width}px`,
    };
  });
}

// ---- cell text

const WHITESPACE = /\s+/g;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** The number of a cell as `1,234` or `1,234.56` (the scale of its column, at least the digits of the value itself, at most 4 decimals). */
export function formatNumber(value: number, scale: number): string {
  const own = Math.min(ownDecimals(value), 4);
  const min = Math.max(scale, own);
  return value.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: 4 });
}

/** `MM/DD/YYYY` (always the year: a result mixes years, owner decision 11) from `yyyy-MM-dd`; the text itself when it is not a date. */
export function formatDate(value: string): string {
  const d = parseDateOnly(value.slice(0, 10));
  return d ? numericDay(d, 0) : value;
}

/** `MM/DD/YYYY hh:mm AM/PM` from `yyyy-MM-ddTHH:mm:ss`; the server sends no zone, so the clock is shown as it came. */
export function formatDateTime(value: string): string {
  const m = DATE_TIME.exec(value);
  const d = m ? parseDateOnly(m[1]) : null;
  if (!m || !d) return value;
  return `${numericDay(d, 0)} ${numericTime(Number(m[2]), Number(m[3]))}`;
}

/** "March 31, 2026 2:05 PM", the long form of a date-time for the tooltip (D-60). */
export function longDateTime(value: string): string {
  const m = DATE_TIME.exec(value);
  const d = m ? parseDateOnly(m[1]) : null;
  if (!m || !d) return value;
  const hour = Number(m[2]);
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${m[3]} ${hour < 12 ? 'AM' : 'PM'}`;
  return `${formatCalendarDayLong(d)} ${clock}`;
}

/** What a cell says: nothing for a null, "Yes" or "No", numbers with commas, dates as `MM/DD/YYYY`, text as it is with its white space collapsed. */
export function cellText(value: unknown, kind: ColumnKind, scale = 0): string {
  if (value === null || value === undefined) return '';
  switch (kind) {
    case 'integer':
    case 'decimal': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? formatNumber(n, kind === 'decimal' ? scale : 0) : String(value);
    }
    case 'boolean':
      return value === true || value === 'true'
        ? 'Yes'
        : value === false || value === 'false'
          ? 'No'
          : '';
    case 'date':
      return formatDate(String(value));
    case 'dateTime':
      return formatDateTime(String(value));
    default:
      return String(value).replace(WHITESPACE, ' ').trim();
  }
}

/** The tooltip of a date-time cell (the long form); nothing for the other types, whose text is the cell itself. */
export function cellTitle(value: unknown, kind: ColumnKind): string | null {
  return kind === 'dateTime' && typeof value === 'string' ? longDateTime(value) : null;
}
