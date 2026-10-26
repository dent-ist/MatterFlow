import { SizedSlice } from './pie-geometry';

/** Where a slice, a bar or a table row leads: router commands and query parameters (never a URL string, so the router encodes it). */
export interface ChartLink {
  commands: unknown[];
  queryParams?: Record<string, unknown>;
}

/** One slice of a pie: what the legend row says and how the slice is drawn. `count` is the value (a count, or a sum or average of a measure). */
export interface ChartSlice extends SizedSlice {
  label: string;
  count: number;
  /** The part of `count` drawn as a hatched outer ring segment and named in the legend (for example overdue tasks); undefined: no split. */
  overdue?: number;
  /** Where the slice and its legend row lead (null: not linkable). */
  link: ChartLink | null;
  /** Where the secondary part ("N overdue") leads. */
  overdueLink?: ChartLink | null;
  /** CSS colours of the slice and of its outline. */
  fill: string;
  outline: string | null;
  /** Dashed outline. */
  dashed?: boolean;
}

/** One row of a bar chart or a chart table. */
export interface ChartRow {
  label: string;
  value: number;
  link?: ChartLink | null;
}

/** The three ways the report builder shows a result. */
export type ChartKind = 'table' | 'pie' | 'bar';

/** Formats a value for display ("412.0", "1,200"); the default is the plain number. */
export type ChartFormat = (value: number) => string;

export const plainFormat: ChartFormat = (value) =>
  Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
