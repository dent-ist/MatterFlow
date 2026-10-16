import { ParamMap } from '@angular/router';
import { formatDateOnly, parseDateOnly } from '../../core/time/time';

/**
 * The declarative model behind every column filter (docs/ux/column-filters-review.md section 4.1): a screen declares one `FilterDef[]`
 * and the filter row, the sheet, the chips, the active count, the print line, the URL read/write and the API arguments are all derived
 * from it by `ListFilters` (list-filters.ts). This file holds the types and the pure helpers (no Angular state), so they are easy to test.
 */

export type FilterType =
  'text' | 'select' | 'multiSelect' | 'user' | 'dateRange' | 'numberRange' | 'triState';

export interface FilterOption {
  readonly value: string;
  readonly label: string;
  /** Muted text after the label, for example "(inactive)". */
  readonly hint?: string;
  /** How many rows carry this option (shown when the API can tell). */
  readonly count?: number;
}

/** A from/to pair: ISO dates (`yyyy-MM-dd`) for `dateRange`, whole numbers as text for `numberRange`. Either side may be empty. */
export interface RangeValue {
  readonly from: string;
  readonly to: string;
}

/**
 * The value of one filter. text, select and triState hold a string (`''` = no filter, tri-state `'true'` / `'false'`), multiSelect and
 * user hold the chosen option values, the range types hold a `RangeValue`.
 */
export type FilterValue = string | readonly string[] | RangeValue;

/** An option of a multi-select / user filter that travels as its own boolean URL flag (`unassigned=true`, `noPod=true`). */
export interface FlagOption {
  /** The URL parameter that carries it. */
  readonly param: string;
  readonly label: string;
}

/** A set of option values that has a name of its own ("Open" for New, In Progress and On Hold). */
export interface ValueGroup {
  readonly label: string;
  readonly values: readonly string[];
}

export interface FilterDef {
  /** Stable key: the name in `ListFilters.value(key)`, `data-filter` for tests and the chip id. */
  readonly key: string;
  /** Column name in words: "Filter by <label>", the chip prefix ("Priority: Critical"). */
  readonly label: string;
  /** Key of the grid column whose filter-row cell holds the control. Absent: a filter without a column (shown in "More filters"). */
  readonly column?: string;
  readonly type: FilterType;
  /** URL parameter (all types except the ranges); defaults to `key`. */
  readonly param?: string;
  /** URL parameters of a range; default `<key>From` / `<key>To`. */
  readonly fromParam?: string;
  readonly toParam?: string;
  /** Options of select, multiSelect, user (and the wording of a triState: any, yes, no). A function is read on every render. */
  readonly options?: readonly FilterOption[] | (() => readonly FilterOption[]);
  /** select: the label of the leading "no filter" option (`''`), for example "All types". */
  readonly allLabel?: string;
  /** multiSelect / user: options that travel as their own boolean parameter, keyed by option value. */
  readonly flagOptions?: Readonly<Record<string, FlagOption>>;
  /** The value shown when the URL says nothing. A default is visible in its cell and is not counted as an active filter. */
  readonly default?: string | readonly string[];
  /** True when the default value counts as an active filter anyway (rare). */
  readonly defaultCounts?: boolean;
  /**
   * The default applies to a plain link only (Task Queue: a bare `/tasks` starts on the open statuses). A link that carries any other
   * filter and no value for this filter means "no limit", exactly as such links always did; writes then keep the value in the address.
   */
  readonly defaultOnlyBare?: boolean;
  /** Returns why the control is unavailable ("Set by the Due soon tab"), or null/undefined when it is usable. */
  readonly disabledReason?: () => string | null | undefined;
  /** Number of columns the cell spans ("Filter by Title or Ref"). */
  readonly span?: number;
  /** No control anywhere (a link-only filter such as `?matterId=`): it only shows as a removable chip. */
  readonly noControl?: boolean;
  /** Replaces the value part of the chip / print text (a record name instead of its id). */
  readonly valueLabel?: (value: string) => string;
  /** dateRange: the preset keys to offer (default: today, this week, last 7 days, last 30 days, this month). */
  readonly presets?: readonly string[];
  /** Placeholder / empty wording of a trigger button ("Any date", "All"). */
  readonly emptyLabel?: string;
  /** Longest text for a text filter. */
  readonly maxLength?: number;
  /** multiSelect: named sets of values; a choice equal to one reads "Open" in the button, one chip and the print line. */
  readonly valueGroups?: readonly ValueGroup[];
  /** Cleans one value read from the URL (upper-case a status code, accept only ids); null drops it. */
  readonly normalize?: (value: string) => string | null;
}

export type FilterValues = Readonly<Record<string, FilterValue>>;
export type QueryParams = Record<string, string | string[] | null>;

// ---- def helpers

export function paramOf(def: FilterDef): string {
  return def.param ?? def.key;
}

export function fromParamOf(def: FilterDef): string {
  return def.fromParam ?? `${def.key}From`;
}

export function toParamOf(def: FilterDef): string {
  return def.toParam ?? `${def.key}To`;
}

export function isRangeType(type: FilterType): boolean {
  return type === 'dateRange' || type === 'numberRange';
}

export function isListType(type: FilterType): boolean {
  return type === 'multiSelect' || type === 'user';
}

export function optionsOf(def: FilterDef): readonly FilterOption[] {
  const o = def.options;
  return typeof o === 'function' ? o() : (o ?? []);
}

/** The options of a select including its leading "no filter" choice (when `allLabel` is set). */
export function selectOptions(def: FilterDef): readonly FilterOption[] {
  const options = optionsOf(def);
  return def.allLabel !== undefined && !options.some((o) => o.value === '')
    ? [{ value: '', label: def.allLabel }, ...options]
    : options;
}

/** Every URL parameter a def reads and writes. */
export function paramsOf(def: FilterDef): string[] {
  const out: string[] = isRangeType(def.type) ? [fromParamOf(def), toParamOf(def)] : [paramOf(def)];
  for (const flag of Object.values(def.flagOptions ?? {})) out.push(flag.param);
  return out;
}

export const EMPTY_RANGE: RangeValue = { from: '', to: '' };

export function emptyValue(def: FilterDef): FilterValue {
  return isRangeType(def.type) ? EMPTY_RANGE : isListType(def.type) ? [] : '';
}

export function defaultValue(def: FilterDef): FilterValue {
  const d = def.default;
  if (d === undefined) return emptyValue(def);
  if (isListType(def.type)) return Array.isArray(d) ? d : d === '' ? [] : [d as string];
  return Array.isArray(d) ? ((d as readonly string[])[0] ?? '') : d;
}

export function isRange(v: FilterValue): v is RangeValue {
  return typeof v === 'object' && !Array.isArray(v);
}

export function isEmpty(v: FilterValue): boolean {
  if (typeof v === 'string') return v === '';
  if (isRange(v)) return v.from === '' && v.to === '';
  return v.length === 0;
}

export function sameValue(a: FilterValue, b: FilterValue): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (isRange(a) && isRange(b)) return a.from === b.from && a.to === b.to;
  if (!isRange(a) && !isRange(b)) {
    return a.length === b.length && a.every((x) => b.includes(x));
  }
  return false;
}

// ---- URL parsing and writing

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WHOLE_NUMBER = /^-?\d{1,9}$/;

function splitAll(params: ParamMap, name: string): string[] {
  const out: string[] = [];
  for (const raw of params.getAll(name)) {
    for (const part of raw.split(',')) {
      const v = part.trim();
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

function clean(def: FilterDef, value: string): string | null {
  return def.normalize ? def.normalize(value) : value;
}

/** Reads one filter from the query string. A parameter that is present but empty means "explicitly nothing" (it beats the default). */
export function parseValue(def: FilterDef, params: ParamMap): FilterValue {
  switch (def.type) {
    case 'text': {
      const raw = params.get(paramOf(def));
      return raw === null
        ? (defaultValue(def) as string)
        : (clean(def, raw.trim().slice(0, def.maxLength ?? 200)) ?? '');
    }
    case 'select': {
      const raw = params.get(paramOf(def));
      return raw === null ? (defaultValue(def) as string) : (clean(def, raw.trim()) ?? '');
    }
    case 'triState': {
      const raw = params.get(paramOf(def))?.toLowerCase();
      if (raw === undefined) return defaultValue(def) as string;
      return raw === 'true' || raw === 'false' ? raw : '';
    }
    case 'multiSelect':
    case 'user': {
      const name = paramOf(def);
      const values = splitAll(params, name)
        .map((v) => clean(def, v))
        .filter((v): v is string => !!v)
        .filter((v, i, all) => all.indexOf(v) === i);
      for (const [optionValue, flag] of Object.entries(def.flagOptions ?? {})) {
        if (params.get(flag.param)?.toLowerCase() === 'true' && !values.includes(optionValue)) {
          values.push(optionValue);
        }
      }
      if (values.length > 0) return values;
      const present =
        params.has(name) || Object.values(def.flagOptions ?? {}).some((f) => params.has(f.param));
      return present ? [] : (defaultValue(def) as readonly string[]);
    }
    case 'dateRange': {
      const from = params.get(fromParamOf(def));
      const to = params.get(toParamOf(def));
      return {
        from: from && ISO_DATE.test(from) && parseDateOnly(from) ? from : '',
        to: to && ISO_DATE.test(to) && parseDateOnly(to) ? to : '',
      };
    }
    case 'numberRange': {
      const from = params.get(fromParamOf(def))?.trim() ?? '';
      const to = params.get(toParamOf(def))?.trim() ?? '';
      return {
        from: WHOLE_NUMBER.test(from) ? from : '',
        to: WHOLE_NUMBER.test(to) ? to : '',
      };
    }
  }
}

/** The query parameters that make `value` for `def`: the default is not written (`null` removes the parameter). */
export function serializeValue(def: FilterDef, value: FilterValue): QueryParams {
  const out: QueryParams = {};
  for (const p of paramsOf(def)) out[p] = null;
  const dflt = defaultValue(def);
  switch (def.type) {
    case 'text':
    case 'select':
    case 'triState': {
      const v = value as string;
      if (!sameValue(v, dflt)) out[paramOf(def)] = v; // '' keeps "explicitly nothing" against a default
      return out;
    }
    case 'multiSelect':
    case 'user': {
      const list = [...(value as readonly string[])];
      if (sameValue(list, dflt)) return out;
      const plain: string[] = [];
      for (const v of list) {
        const flag = def.flagOptions?.[v];
        if (flag) out[flag.param] = 'true';
        else plain.push(v);
      }
      if (plain.length > 0) out[paramOf(def)] = plain;
      else if (Object.values(out).every((x) => x === null)) out[paramOf(def)] = '';
      return out;
    }
    case 'dateRange':
    case 'numberRange': {
      const r = value as RangeValue;
      out[fromParamOf(def)] = r.from || null;
      out[toParamOf(def)] = r.to || null;
      return out;
    }
  }
}

export function parseFilters(defs: readonly FilterDef[], params: ParamMap): FilterValues {
  const out: Record<string, FilterValue> = {};
  const bare = !hasFilterParams(defs, params);
  for (const def of defs) {
    const value = parseValue(def, params);
    // A default that only a plain link gets: a link with other filters and none for this one asks for no limit.
    out[def.key] =
      def.defaultOnlyBare && !bare && !paramsOf(def).some((p) => params.has(p))
        ? emptyValue(def)
        : value;
  }
  return out;
}

/** The parameters that write `value` even when it is the default (for filters whose default applies to a plain link only). */
export function serializeExplicit(def: FilterDef, value: FilterValue): QueryParams {
  const out: QueryParams = {};
  for (const p of paramsOf(def)) out[p] = null;
  if (typeof value === 'string') {
    out[paramOf(def)] = value;
  } else if (!isRange(value)) {
    const plain: string[] = [];
    for (const v of value) {
      const flag = def.flagOptions?.[v];
      if (flag) out[flag.param] = 'true';
      else plain.push(v);
    }
    if (plain.length > 0) out[paramOf(def)] = plain;
    else if (Object.values(out).every((x) => x === null)) out[paramOf(def)] = '';
  }
  return out;
}

export function serializeFilters(defs: readonly FilterDef[], values: FilterValues): QueryParams {
  const out: QueryParams = {};
  for (const def of defs) {
    Object.assign(out, serializeValue(def, values[def.key] ?? defaultValue(def)));
  }
  return out;
}

/** True when the query string carries any parameter of these filters (a deep link, as opposed to a plain link). */
export function hasFilterParams(defs: readonly FilterDef[], params: ParamMap): boolean {
  return defs.some((d) => paramsOf(d).some((p) => params.has(p)));
}

// ---- active state, chips, print line

/** True when the filter limits the result beyond what the screen does by default: a default value is not counted. */
export function isActive(def: FilterDef, value: FilterValue): boolean {
  if (def.defaultCounts) return !isEmpty(value);
  return !sameValue(value, defaultValue(def));
}

/** The named group a list value equals exactly (order does not matter), or undefined. */
export function groupOf(def: FilterDef, value: readonly string[]): ValueGroup | undefined {
  return def.valueGroups?.find(
    (g) => g.values.length === value.length && g.values.every((v) => value.includes(v)),
  );
}

export function optionLabel(def: FilterDef, value: string): string {
  const flag = def.flagOptions?.[value];
  if (flag) return flag.label;
  const hit = [...selectOptions(def), ...optionsOf(def)].find((o) => o.value === value);
  if (hit) return hit.label;
  return def.valueLabel ? def.valueLabel(value) : value;
}

/** "Oct 1, 2026 to Oct 16, 2026" / "from Oct 1, 2026" / "until Oct 16, 2026"; numbers are shown as they are. */
export function rangeText(def: FilterDef, r: RangeValue): string {
  const f = (v: string) => (def.type === 'dateRange' ? formatDateOnly(v) : v);
  if (r.from && r.to) return r.from === r.to ? f(r.from) : `${f(r.from)} to ${f(r.to)}`;
  if (r.from) return def.type === 'dateRange' ? `from ${f(r.from)}` : `${f(r.from)} or more`;
  return def.type === 'dateRange' ? `until ${f(r.to)}` : `${f(r.to)} or less`;
}

/** The value part of the text for one value ("Critical", "Oct 1, 2026 to Oct 16, 2026"); lists join with commas. */
export function valueText(def: FilterDef, value: FilterValue): string {
  if (typeof value === 'string') {
    if (def.type === 'text') return def.valueLabel ? def.valueLabel(value) : value;
    if (def.type === 'triState') return triLabel(def, value);
    return value === '' ? (selectOptions(def)[0]?.label ?? '') : optionLabel(def, value);
  }
  if (isRange(value)) return rangeText(def, value);
  return groupOf(def, value)?.label ?? value.map((v) => optionLabel(def, v)).join(', ');
}

/** Wording of the tri-state choices: options[1] is the "yes" text, options[2] the "no" text. */
export function triLabel(def: FilterDef, value: string): string {
  const o = optionsOf(def);
  if (value === 'true') return o[1]?.label ?? 'Yes';
  if (value === 'false') return o[2]?.label ?? 'No';
  return o[0]?.label ?? 'Any';
}

export interface FilterChip {
  /** Unique: `<defKey>` or `<defKey>:<value>`. */
  readonly id: string;
  readonly defKey: string;
  /** "Priority: Critical". */
  readonly label: string;
  /** The column is not on screen, so only this chip shows the filter. */
  readonly hiddenColumn: boolean;
  readonly column: string | undefined;
  /** The value that remains once this chip is removed. */
  readonly remaining: FilterValue;
}

/** One chip per active value (a multi-select makes one per chosen value). */
export function buildChips(
  def: FilterDef,
  value: FilterValue,
  hiddenColumn: boolean,
): FilterChip[] {
  if (!isActive(def, value)) {
    return [];
  }
  const base = { defKey: def.key, hiddenColumn, column: def.column };
  if (isEmpty(value)) {
    // A default was cleared (Status "All"): say what is shown now.
    const text = typeof value === 'string' ? valueText(def, value) : '';
    return [
      {
        ...base,
        id: def.key,
        label: `${def.label}: ${text || 'All'}`,
        remaining: defaultValue(def),
      },
    ];
  }
  if (typeof value !== 'string' && !isRange(value)) {
    const group = groupOf(def, value);
    if (group) {
      return [{ ...base, id: def.key, label: `${def.label}: ${group.label}`, remaining: [] }];
    }
    return value.map((v) => ({
      ...base,
      id: `${def.key}:${v}`,
      label: `${def.label}: ${optionLabel(def, v)}`,
      remaining: value.filter((x) => x !== v),
    }));
  }
  return [
    {
      ...base,
      id: def.key,
      label: `${def.label}: ${valueText(def, value)}`,
      remaining: defaultValue(def),
    },
  ];
}

/** "Status Active, Priority Critical or High": the line printed above a filtered grid. */
export function printText(def: FilterDef, value: FilterValue): string {
  if (typeof value !== 'string' && !isRange(value)) {
    const group = groupOf(def, value);
    if (group) return `${def.label} ${group.label}`;
    return `${def.label} ${value.map((v) => optionLabel(def, v)).join(' or ')}`;
  }
  return `${def.label} ${valueText(def, value)}`;
}
