/**
 * The parameter definitions of a report as the editor handles them (docs/ux/reports-review/README.md section 5): the same shape the API stores in
 * a version's snapshot, plus pure helpers that keep the definitions in step with the `:NAME` placeholders found in the SQL. No Angular, no
 * generated client: this file is reached from the lazy Reports chunk only and is easy to test.
 */

export type ParamType =
  'number' | 'date' | 'text' | 'single' | 'multi' | 'dateRange' | 'yesNo' | 'lookup';

export type LookupKind = 'matter' | 'client' | 'user' | 'pod' | 'role' | 'taskType';
export type OptionsKind = 'fixed' | 'query';
export type ValueType = 'text' | 'int';

export interface ParamOption {
  value: string;
  label: string;
}

export interface ParamDef {
  name: string;
  type: ParamType;
  label: string;
  helpText?: string;
  default?: unknown;
  isRequired?: boolean;
  lookupKind?: LookupKind;
  lookupMulti?: boolean;
  valueType?: ValueType;
  optionsKind?: OptionsKind;
  options?: ParamOption[];
  optionsSql?: string;
  min?: number;
  max?: number;
  integerOnly?: boolean;
  maxLength?: number;
  maxSelected?: number;
}

export const PARAM_TYPES: readonly { value: ParamType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dateRange', label: 'Date range' },
  { value: 'single', label: 'Single choice' },
  { value: 'multi', label: 'Multiple choice' },
  { value: 'yesNo', label: 'Yes / no' },
  { value: 'lookup', label: 'Lookup (matter, client, user...)' },
];

export const LOOKUP_KINDS: readonly { value: LookupKind; label: string }[] = [
  { value: 'matter', label: 'Matter' },
  { value: 'client', label: 'Client' },
  { value: 'user', label: 'User' },
  { value: 'pod', label: 'Pod' },
  { value: 'role', label: 'Role' },
  { value: 'taskType', label: 'Task type' },
];

export const TYPE_LABEL: Readonly<Record<ParamType, string>> = Object.fromEntries(
  PARAM_TYPES.map((t) => [t.value, t.label]),
) as Record<ParamType, string>;

/** The placeholder names a definition answers in the SQL: a date range owns `NAME_FROM` and `NAME_TO`. */
export function placeholderNames(def: Pick<ParamDef, 'name' | 'type'>): string[] {
  return def.type === 'dateRange' ? [`${def.name}_FROM`, `${def.name}_TO`] : [def.name];
}

/** `DUE_DATE` becomes `Due date`. */
export function titleCase(name: string): string {
  const words = name.toLowerCase().split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A placeholder as the analysis reports it (the fields the editor needs). */
export interface DetectedPlaceholder {
  name: string;
  displayName: string;
  line: number;
  column: number;
  occurrences: number;
  isBuiltIn: boolean;
}

export interface Reconciled {
  /** The definitions to show: the ones the author has plus a new one for each placeholder that has none. */
  defs: ParamDef[];
  /** Names of definitions whose placeholders are no longer in the SQL (kept in the form until saved, then dropped). */
  unused: Set<string>;
  /** Names the reconcile added, for the live announcement. */
  added: string[];
}

/**
 * Keeps the definitions in step with the placeholders in the SQL (spec 5.2): a new placeholder gets a definition (type text, label from the
 * name, optional); `X_FROM` with `X_TO` is proposed as one date range `X`; a definition without a placeholder is reported as unused, not
 * deleted (the author may be in the middle of an edit). Built-in names never get a definition.
 */
export function reconcile(
  defs: readonly ParamDef[],
  placeholders: readonly DetectedPlaceholder[],
  candidates: readonly string[] = [],
): Reconciled {
  const used = new Set(placeholders.filter((p) => !p.isBuiltIn).map((p) => p.name));
  let result = [...defs];
  const added: string[] = [];

  // X_FROM with X_TO becomes one date range X, also when the two halves already got an untouched text definition each (they were added one
  // at a time while the author was typing).
  for (const base of candidates) {
    const from = `${base}_FROM`;
    const to = `${base}_TO`;
    if (
      !used.has(from) ||
      !used.has(to) ||
      result.some((d) => d.name === base && d.type === 'dateRange')
    )
      continue;
    const halves = result.filter((d) => d.name === from || d.name === to);
    if (!halves.every((d) => isUntouchedText(d))) continue;
    result = result.filter((d) => !halves.includes(d));
    result.push({ name: base, type: 'dateRange', label: titleCase(base), isRequired: false });
    added.push(base);
  }

  const covered = new Set(result.flatMap(placeholderNames));
  for (const p of placeholders) {
    if (p.isBuiltIn || covered.has(p.name)) continue;
    result.push({ name: p.name, type: 'text', label: titleCase(p.name), isRequired: false });
    added.push(p.name);
    covered.add(p.name);
  }

  const unused = new Set(
    result.filter((d) => !placeholderNames(d).some((n) => used.has(n))).map((d) => d.name),
  );
  return { defs: result, unused, added };
}

/** A text definition exactly as `reconcile` creates it: the author has not changed anything yet. */
function isUntouchedText(d: ParamDef): boolean {
  return (
    d.type === 'text' &&
    d.label === titleCase(d.name) &&
    !d.helpText &&
    (d.default === undefined || d.default === null || d.default === '') &&
    !d.isRequired &&
    !d.maxLength
  );
}

/** What the API gets: the definitions that the SQL still uses, with the fields their type does not use left out. */
export function toRequestParameters(
  defs: readonly ParamDef[],
  unused: ReadonlySet<string>,
): ParamDef[] {
  return defs
    .filter((d) => !unused.has(d.name))
    .map((d) => {
      const out: ParamDef = {
        name: d.name.trim().toUpperCase(),
        type: d.type,
        label: d.label.trim(),
      };
      if (d.helpText?.trim()) out.helpText = d.helpText.trim();
      if (d.default !== undefined && d.default !== null && d.default !== '')
        out.default = d.default;
      if (d.isRequired) out.isRequired = true;
      if (d.type === 'lookup') {
        out.lookupKind = d.lookupKind;
        if (d.lookupMulti) out.lookupMulti = true;
      }
      if (d.type === 'single' || d.type === 'multi') {
        out.valueType = d.valueType ?? 'text';
        out.optionsKind = d.optionsKind;
        if (d.optionsKind === 'fixed')
          out.options = (d.options ?? []).map((o) => ({
            value: o.value.trim(),
            label: o.label.trim(),
          }));
        if (d.optionsKind === 'query') out.optionsSql = d.optionsSql ?? '';
      }
      if (d.type === 'number') {
        if (d.min !== undefined && d.min !== null) out.min = d.min;
        if (d.max !== undefined && d.max !== null) out.max = d.max;
        if (d.integerOnly) out.integerOnly = true;
      }
      if (d.type === 'text' && d.maxLength) out.maxLength = d.maxLength;
      if ((d.type === 'multi' || (d.type === 'lookup' && d.lookupMulti)) && d.maxSelected)
        out.maxSelected = d.maxSelected;
      return out;
    });
}

/** Which parameters the analysis must treat as lists (so `IN :NAME` reads correctly). */
export function listParameters(defs: readonly ParamDef[]): { name: string; valueType: string }[] {
  return defs
    .filter((d) => d.type === 'multi' || (d.type === 'lookup' && d.lookupMulti))
    .map((d) => ({
      name: d.name,
      valueType: d.type === 'lookup' || d.valueType === 'int' ? 'int' : 'text',
    }));
}

/** Problems with the definitions that the editor can see before it asks the server; the server checks again. Keys are `NAME` or `NAME.field`. */
export function definitionProblems(
  defs: readonly ParamDef[],
  unused: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  for (const d of defs) {
    if (unused.has(d.name)) continue;
    const who = `Parameter ${d.name}`;
    if (!d.label.trim()) problems.push(`${who}: enter a label.`);
    if (d.type === 'lookup' && !d.lookupKind)
      problems.push(`${who}: choose what the lookup searches.`);
    if (d.type === 'single' || d.type === 'multi') {
      if (!d.optionsKind) problems.push(`${who}: choose where the choices come from.`);
      else if (d.optionsKind === 'fixed' && !(d.options ?? []).some((o) => o.value.trim()))
        problems.push(`${who}: add at least one choice.`);
      else if (d.optionsKind === 'query' && !(d.optionsSql ?? '').trim())
        problems.push(`${who}: enter the SELECT that returns Value and Label.`);
    }
    if (d.type === 'number' && d.min != null && d.max != null && d.min > d.max)
      problems.push(`${who}: the lowest value is above the highest value.`);
  }
  return problems;
}

/** A definition as the editor creates it when the author changes its type: keeps name, label and help, resets what the new type needs. */
export function withType(def: ParamDef, type: ParamType): ParamDef {
  const next: ParamDef = { name: def.name, type, label: def.label, isRequired: def.isRequired };
  if (def.helpText) next.helpText = def.helpText;
  if (type === 'lookup') next.lookupKind = 'client';
  if (type === 'single' || type === 'multi') {
    next.valueType = 'text';
    next.optionsKind = 'fixed';
    next.options = [{ value: '', label: '' }];
  }
  return next;
}

/** The default of a definition as text for its input (relative dates are keywords such as `today`). */
export function defaultText(def: ParamDef): string {
  const d = def.default;
  if (d === undefined || d === null) return '';
  if (typeof d === 'string' || typeof d === 'number' || typeof d === 'boolean') return String(d);
  return JSON.stringify(d);
}

/** What the author may pick as a default for a type: the keywords the server knows (`ParameterDefaults`). */
export function defaultKeywords(def: ParamDef): readonly { value: string; label: string }[] {
  switch (def.type) {
    case 'date':
      return [
        { value: 'today', label: 'Today' },
        { value: 'startOfMonth', label: 'Start of this month' },
        { value: 'endOfMonth', label: 'End of this month' },
        { value: 'startOfYear', label: 'Start of this year' },
        { value: 'endOfYear', label: 'End of this year' },
        { value: 'today-30', label: '30 days ago' },
      ];
    case 'dateRange':
      return [
        { value: 'thisMonth', label: 'This month' },
        { value: 'lastMonth', label: 'Last month' },
        { value: 'last30Days', label: 'Last 30 days' },
        { value: 'thisYear', label: 'This year' },
      ];
    case 'multi':
      return def.valueType === 'int' ? [{ value: 'myPods', label: 'My pods' }] : [];
    case 'lookup':
      return def.lookupKind === 'pod' && def.lookupMulti
        ? [{ value: 'myPods', label: 'My pods' }]
        : def.lookupKind === 'pod'
          ? [{ value: 'myPod', label: 'My primary pod' }]
          : def.lookupKind === 'user'
            ? [{ value: 'me', label: 'Me' }]
            : [];
    default:
      return [];
  }
}
