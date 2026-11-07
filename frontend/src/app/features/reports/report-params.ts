import type { ParamMap } from '@angular/router';
import type { RunnableParameterResponse } from '../../api/generated/api-client';

/**
 * The values of the parameter form of a report (issue #719) and everything that is pure about them: the starting values (server default or the
 * address), the address for a run, the checks before a run, the JSON of the run request and the one-line summary. No Angular state here, so it is
 * easy to test. The type names are the server's: number, date, text, single, multi, dateRange, yesNo, lookup.
 */
export type ParamDef = RunnableParameterResponse;

/** A looked-up record: its id (what the report takes) and its words (what the person sees; empty until the label has been fetched). */
export interface LookupPick {
  readonly id: number;
  readonly label: string;
}

/** A date range: ISO dates (`yyyy-MM-dd`) or ''. */
export interface DateRangeValue {
  readonly from: string;
  readonly to: string;
}

/**
 * One field's value, by type: number, date, text and single hold text (a date as `yyyy-MM-dd`), yesNo holds 'yes', 'no' or 'any', multi holds the chosen
 * option values, dateRange a pair, lookup the chosen records (at most one unless the parameter takes several).
 */
export type FieldValue = string | readonly string[] | DateRangeValue | readonly LookupPick[];
export type FormValues = Readonly<Record<string, FieldValue>>;

/** The longest text and the longest list the server accepts when the definition says nothing (spec 3.3). */
export const DEFAULT_TEXT_LENGTH = 400;
export const DEFAULT_MAX_SELECTED = 200;

export const isDateRange = (v: FieldValue): v is DateRangeValue =>
  typeof v === 'object' && !Array.isArray(v);
const asText = (v: FieldValue | undefined): string => (typeof v === 'string' ? v : '');
const asList = (v: FieldValue | undefined): readonly string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as readonly string[]) : [];
const asRange = (v: FieldValue | undefined): DateRangeValue =>
  v && isDateRange(v) ? v : { from: '', to: '' };
const asPicks = (v: FieldValue | undefined): readonly LookupPick[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'object') ? (v as readonly LookupPick[]) : [];

/** Whether the parameter takes a list (a multi choice, or a lookup that takes several). */
export const takesList = (d: ParamDef): boolean => d.type === 'multi' || d.multiple;

/** The value of a parameter that has nothing in it. A required yes/no starts with neither answer chosen. */
export function emptyValue(d: ParamDef): FieldValue {
  switch (d.type) {
    case 'dateRange':
      return { from: '', to: '' };
    case 'multi':
      return [];
    case 'lookup':
      return [];
    case 'yesNo':
      return d.required ? '' : 'any';
    default:
      return '';
  }
}

/** The server's default (already resolved for this person and day) as a form value. */
export function defaultValue(d: ParamDef): FieldValue {
  const raw: unknown = d.default;
  if (raw === undefined || raw === null || raw === '') return emptyValue(d);
  switch (d.type) {
    case 'number':
    case 'date':
    case 'text':
    case 'single':
      return String(raw);
    case 'multi':
      return Array.isArray(raw) ? raw.map(String) : [String(raw)];
    case 'dateRange': {
      const r = raw as { from?: unknown; to?: unknown };
      return { from: r.from ? String(r.from) : '', to: r.to ? String(r.to) : '' };
    }
    case 'yesNo':
      return raw === true ? 'yes' : raw === false ? 'no' : emptyValue(d);
    case 'lookup': {
      const ids = (Array.isArray(raw) ? raw : [raw]).map(Number).filter(Number.isFinite);
      return ids.map((id) => ({ id, label: '' }));
    }
    default:
      return emptyValue(d);
  }
}

/** The name of a query parameter for a form parameter, found case-insensitively in the address (the definition's name is upper case). */
function urlKey(map: ParamMap, name: string): string | null {
  const wanted = name.toUpperCase();
  return map.keys.find((k) => k.toUpperCase() === wanted) ?? null;
}

/** The values to start with: the server's default for every parameter, replaced by what the address carries. */
export function initialValues(defs: readonly ParamDef[], map: ParamMap | null): FormValues {
  const out: Record<string, FieldValue> = {};
  for (const d of defs) {
    out[d.name] = defaultValue(d);
    if (!map) continue;
    if (d.type === 'dateRange') {
      const from = urlKey(map, `${d.name}.from`);
      const to = urlKey(map, `${d.name}.to`);
      if (from || to) {
        out[d.name] = {
          from: from ? (map.get(from) ?? '') : '',
          to: to ? (map.get(to) ?? '') : '',
        };
      }
      continue;
    }
    const key = urlKey(map, d.name);
    if (!key) continue;
    const all = map.getAll(key);
    switch (d.type) {
      case 'multi':
        out[d.name] = all.filter((v) => v !== '');
        break;
      case 'lookup': {
        const ids = all.map(Number).filter((n) => Number.isInteger(n) && n > 0);
        out[d.name] = (d.multiple ? ids : ids.slice(0, 1)).map((id) => ({ id, label: '' }));
        break;
      }
      case 'yesNo': {
        const v = all[0];
        out[d.name] = v === 'true' ? 'yes' : v === 'false' ? 'no' : d.required ? '' : 'any';
        break;
      }
      default:
        out[d.name] = all[0] ?? '';
    }
  }
  return out;
}

/** The query parameters of a run, so the address can be bookmarked: empty values are `null` (removed from the address). */
export function urlParams(
  defs: readonly ParamDef[],
  values: FormValues,
): Record<string, string | readonly string[] | null> {
  const out: Record<string, string | readonly string[] | null> = {};
  for (const d of defs) {
    const v = values[d.name];
    switch (d.type) {
      case 'dateRange': {
        const r = asRange(v);
        out[`${d.name}.from`] = r.from || null;
        out[`${d.name}.to`] = r.to || null;
        break;
      }
      case 'multi': {
        const l = asList(v);
        out[d.name] = l.length > 0 ? l : null;
        break;
      }
      case 'lookup': {
        const ids = asPicks(v).map((p) => String(p.id));
        out[d.name] = ids.length > 0 ? ids : null;
        break;
      }
      case 'yesNo': {
        const t = asText(v);
        out[d.name] = t === 'yes' ? 'true' : t === 'no' ? 'false' : null;
        break;
      }
      default: {
        const t = asText(v).trim();
        out[d.name] = t === '' ? null : t;
      }
    }
  }
  return out;
}

// ---- checks

/** `03/31/2026` from `2026-03-31`; the text itself when it is not an ISO date. */
export function displayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/** Whether the text is a real calendar day written as `yyyy-MM-dd`. */
export function isIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The number a text holds (commas and spaces are ignored), or null when it is not a number. */
export function parseNumber(text: string): number | null {
  const clean = text.replace(/[,\s]/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/** A number text with thousands commas (`1234567.5` becomes `1,234,567.5`), or the text unchanged when it is not a number. */
export function groupDigits(text: string): string {
  const clean = text.replace(/[,\s]/g, '');
  if (parseNumber(clean) === null) return text;
  const [whole, fraction] = clean.replace(/^[+]/, '').split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped || '0'}${fraction !== undefined ? `.${fraction}` : ''}`;
}

const plain = (n: number): string => String(n);

/**
 * The message under each field that is not ready to run (spec 3.3), by parameter name. An empty object means the form can run. The wording is
 * fixed: "Enter <label>.", "Select <label>.", "<Label> must be a number.", "<Label> must be between <min> and <max>.", "<Label> must be a date
 * (MM/DD/YYYY).", "From must be on or before To.", "<Label> must be <n> characters or fewer.", "Select <n> or fewer."
 */
export function validate(defs: readonly ParamDef[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const d of defs) {
    const message = problemOf(d, values[d.name]);
    if (message) errors[d.name] = message;
  }
  return errors;
}

function problemOf(d: ParamDef, v: FieldValue | undefined): string | null {
  const label = d.label;
  switch (d.type) {
    case 'number': {
      const t = asText(v).trim();
      if (t === '') return d.required ? `Enter ${label}.` : null;
      const n = parseNumber(t);
      if (n === null) return `${label} must be a number.`;
      if (d.integerOnly && !Number.isInteger(n)) return `${label} must be a whole number.`;
      const low = d.min ?? null;
      const high = d.max ?? null;
      if ((low !== null && n < low) || (high !== null && n > high)) {
        if (low !== null && high !== null)
          return `${label} must be between ${plain(low)} and ${plain(high)}.`;
        return low !== null
          ? `${label} must be at least ${plain(low)}.`
          : `${label} must be at most ${plain(high!)}.`;
      }
      return null;
    }
    case 'date': {
      const t = asText(v).trim();
      if (t === '') return d.required ? `Enter ${label}.` : null;
      return isIsoDate(t) ? null : `${label} must be a date (MM/DD/YYYY).`;
    }
    case 'dateRange': {
      const r = asRange(v);
      if (r.from === '' && r.to === '') return d.required ? `Enter ${label}.` : null;
      if (d.required && (r.from === '' || r.to === '')) return `Enter ${label}.`;
      if ((r.from !== '' && !isIsoDate(r.from)) || (r.to !== '' && !isIsoDate(r.to)))
        return `${label} must be a date (MM/DD/YYYY).`;
      if (r.from !== '' && r.to !== '' && r.from > r.to) return 'From must be on or before To.';
      return null;
    }
    case 'text': {
      const t = asText(v).trim();
      if (t === '') return d.required ? `Enter ${label}.` : null;
      const max = d.maxLength ?? DEFAULT_TEXT_LENGTH;
      return t.length > max ? `${label} must be ${max} characters or fewer.` : null;
    }
    case 'single':
      return asText(v) === '' && d.required ? `Select ${label}.` : null;
    case 'multi': {
      const l = asList(v);
      if (l.length === 0) return d.required ? `Select ${label}.` : null;
      const max = d.maxSelected ?? DEFAULT_MAX_SELECTED;
      return l.length > max ? `Select ${max} or fewer.` : null;
    }
    case 'yesNo':
      return d.required && asText(v) !== 'yes' && asText(v) !== 'no' ? `Select ${label}.` : null;
    case 'lookup': {
      const l = asPicks(v);
      if (l.length === 0) return d.required ? `Select ${label}.` : null;
      const max = d.maxSelected ?? DEFAULT_MAX_SELECTED;
      return l.length > max ? `Select ${max} or fewer.` : null;
    }
    default:
      return null;
  }
}

// ---- the run request

/**
 * The JSON values of the run request, by parameter name: numbers as numbers, dates as `yyyy-MM-dd`, a date range as `{ from, to }`, lists as arrays,
 * a yes/no as a boolean, a lookup as its id (or ids). A parameter with nothing in it is left out, so the server uses its default.
 */
export function buildRequest(
  defs: readonly ParamDef[],
  values: FormValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const v = values[d.name];
    switch (d.type) {
      case 'number': {
        const n = parseNumber(asText(v));
        if (n !== null) out[d.name] = n;
        break;
      }
      case 'date':
      case 'text': {
        const t = asText(v).trim();
        if (t !== '') out[d.name] = t;
        break;
      }
      case 'single': {
        const t = asText(v);
        if (t !== '') out[d.name] = d.valueType === 'int' ? Number(t) : t;
        break;
      }
      case 'multi': {
        const l = asList(v);
        if (l.length > 0) out[d.name] = d.valueType === 'int' ? l.map(Number) : [...l];
        break;
      }
      case 'dateRange': {
        const r = asRange(v);
        if (r.from !== '' || r.to !== '') out[d.name] = { from: r.from, to: r.to };
        break;
      }
      case 'yesNo': {
        const t = asText(v);
        if (t === 'yes') out[d.name] = true;
        else if (t === 'no') out[d.name] = false;
        break;
      }
      case 'lookup': {
        const ids = asPicks(v).map((p) => p.id);
        if (ids.length > 0) out[d.name] = d.multiple ? ids : ids[0];
        break;
      }
    }
  }
  return out;
}

// ---- the summary bar

/** Words for the options of a list: `labels[parameterName][optionValue]` (fixed options and fetched choices). */
export type OptionLabels = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** One parameter as the summary bar says it: "Status Open, Closed". Parameters with no value are left out. */
export function summaryParts(
  defs: readonly ParamDef[],
  values: FormValues,
  labels: OptionLabels = {},
): string[] {
  const parts: string[] = [];
  for (const d of defs) {
    const text = summaryValue(d, values[d.name], labels[d.name] ?? {});
    if (text) parts.push(`${d.label} ${text}`);
  }
  return parts;
}

function summaryValue(
  d: ParamDef,
  v: FieldValue | undefined,
  labels: Readonly<Record<string, string>>,
): string {
  const word = (value: string): string =>
    labels[value] ?? d.options.find((o) => o.value === value)?.label ?? value;
  switch (d.type) {
    case 'date':
      return displayDate(asText(v));
    case 'dateRange': {
      const r = asRange(v);
      if (r.from && r.to) return `${displayDate(r.from)} to ${displayDate(r.to)}`;
      if (r.from) return `from ${displayDate(r.from)}`;
      return r.to ? `to ${displayDate(r.to)}` : '';
    }
    case 'single':
      return asText(v) === '' ? '' : word(asText(v));
    case 'multi': {
      const l = asList(v).map(word);
      return l.length > 3 ? `${l.length} selected` : l.join(', ');
    }
    case 'yesNo':
      return asText(v) === 'yes' ? 'Yes' : asText(v) === 'no' ? 'No' : '';
    case 'lookup': {
      const l = asPicks(v).map((p) => p.label || `#${p.id}`);
      return l.length > 3 ? `${l.length} selected` : l.join(', ');
    }
    default:
      return asText(v).trim();
  }
}

/** The defaults again, for Reset: every parameter back to the server's default. */
export function defaultValues(defs: readonly ParamDef[]): FormValues {
  return initialValues(defs, null);
}

export { asList, asPicks, asRange, asText };
