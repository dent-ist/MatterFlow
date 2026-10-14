import { isPortablePattern } from './portable-pattern';
import {
  DefinitionErrorCode,
  EvaluationMode,
  FormError,
  FormErrorCode,
  FormEvaluation,
  FormField,
  InputControl,
  RuleNode,
} from './types';

const INPUT_CONTROLS: ReadonlySet<string> = new Set<InputControl>([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'CHECKBOX',
  'SELECT',
  'RADIO',
  'MULTISELECT',
  'DATE',
  'DATETIME',
  'URL',
  'ASSET_REF',
  'USER_REF',
]);
const KNOWN_CONTROLS: ReadonlySet<string> = new Set([
  ...INPUT_CONTROLS,
  'SECTION_HEADING',
  'HELP_TEXT',
]);
const OPTION_CONTROLS: ReadonlySet<string> = new Set(['SELECT', 'RADIO', 'MULTISELECT']);
const MAX_SAFE_INTEGER = 9007199254740991;

/** JSON `null` and an omitted member are the same thing (contracts/form-rules.md section 1). */
const present = <T>(x: T | null | undefined): x is T => x !== undefined && x !== null;
const MAX_DEPTH = 3;

type Family = 'text' | 'number' | 'date' | 'datetime' | 'checkbox' | 'single' | 'multi' | 'ref';
const FAMILY: Record<string, Family> = {
  TEXT: 'text',
  TEXTAREA: 'text',
  URL: 'text',
  NUMBER: 'number',
  DATE: 'date',
  DATETIME: 'datetime',
  CHECKBOX: 'checkbox',
  SELECT: 'single',
  RADIO: 'single',
  MULTISELECT: 'multi',
  ASSET_REF: 'ref',
  USER_REF: 'ref',
};

const EQ_SET = ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'];
const ORDERED = [...EQ_SET, 'gt', 'gte', 'lt', 'lte'];
const OPS_BY_FAMILY: Record<Family, string[]> = {
  text: EQ_SET,
  number: ORDERED,
  date: ORDERED,
  datetime: ['isEmpty', 'isNotEmpty'],
  checkbox: ['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty'],
  single: EQ_SET,
  multi: ['contains', 'isEmpty', 'isNotEmpty'],
  ref: EQ_SET,
};

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const OPTION_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const BLANK_RE = /^[\t\n\v\f\r ]*$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,7})?Z$/;
const URL_RE = /^https?:\/\/[^\s/?#]+[^\s]*$/;

/** True when the parts form a real calendar date, year 0001-9999. */
function isRealDate(y: string, m: string, d: string): boolean {
  const yy = +y;
  const mm = +m;
  const dd = +d;
  if (yy < 1 || mm < 1 || mm > 12 || dd < 1) return false;
  const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  return dd <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
}

function isDateString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  return !!m && isRealDate(m[1], m[2], m[3]);
}

/** ASCII-only case fold (A-Z); all other characters compare exactly. */
function foldAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

type Parsed =
  { empty: true } | { empty?: false; ok: true; value: unknown } | { empty?: false; ok: false };

/** Parse a raw submitted value per section 2. No coercion. */
function parseValue(control: string, raw: unknown): Parsed {
  if (raw === undefined || raw === null) return { empty: true };
  if (typeof raw === 'string' && BLANK_RE.test(raw)) return { empty: true };
  if (Array.isArray(raw) && raw.length === 0) return { empty: true };
  const bad: Parsed = { ok: false };
  const good = (value: unknown): Parsed => ({ ok: true, value });
  switch (FAMILY[control]) {
    case 'text':
      return typeof raw !== 'string' || (control === 'URL' && !URL_RE.test(raw)) ? bad : good(raw);
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? good(raw) : bad;
    case 'checkbox':
      return typeof raw === 'boolean' ? good(raw) : bad;
    case 'single':
      return typeof raw === 'string' ? good(raw) : bad;
    case 'multi':
      return Array.isArray(raw) &&
        raw.every((x) => typeof x === 'string') &&
        new Set(raw).size === raw.length
        ? good(raw)
        : bad;
    case 'date':
      return isDateString(raw) ? good(raw) : bad;
    case 'datetime': {
      const m = typeof raw === 'string' ? DATETIME_RE.exec(raw) : null;
      return m && isRealDate(m[1], m[2], m[3]) ? good(raw) : bad;
    }
    case 'ref':
      return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw <= MAX_SAFE_INTEGER
        ? good(raw)
        : bad;
    default:
      return bad;
  }
}

// ------------------------------------------------------------------ rule structure (schema)

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): boolean =>
  typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const hasExactKeys = (o: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o);

/** Structural check equivalent to contracts/form-rules.schema.json (#/$defs/node). */
export function isValidRuleShape(n: unknown): n is RuleNode {
  if (!isObject(n) || typeof n['op'] !== 'string') return false;
  const op = n['op'];
  if (op === 'and' || op === 'or') {
    const args = n['args'];
    return (
      hasExactKeys(n, ['op', 'args']) &&
      Array.isArray(args) &&
      args.length >= 1 &&
      args.length <= 8 &&
      args.every(isValidRuleShape)
    );
  }
  if (op === 'not') return hasExactKeys(n, ['op', 'arg']) && isValidRuleShape(n['arg']);
  const field = n['field'];
  if (typeof field !== 'string' || !FIELD_KEY_RE.test(field)) return false;
  if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(op)) {
    return hasExactKeys(n, ['op', 'field', 'value']) && isScalar(n['value']);
  }
  if (op === 'in' || op === 'notIn') {
    const value = n['value'];
    return (
      hasExactKeys(n, ['op', 'field', 'value']) &&
      Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= 50 &&
      value.every(isScalar)
    );
  }
  if (['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'].includes(op)) {
    return hasExactKeys(n, ['op', 'field']);
  }
  return false;
}

// ------------------------------------------------------------------ rule helpers

const depthOf = (n: RuleNode): number =>
  n.op === 'and' || n.op === 'or'
    ? 1 + Math.max(...n.args.map(depthOf))
    : n.op === 'not'
      ? 1 + depthOf(n.arg)
      : 1;

type Leaf = Exclude<RuleNode, { op: 'and' | 'or' } | { op: 'not' }>;

function* leaves(n: RuleNode): Generator<Leaf> {
  if (n.op === 'and' || n.op === 'or') for (const a of n.args) yield* leaves(a);
  else if (n.op === 'not') yield* leaves(n.arg);
  else yield n as Leaf;
}

function ruleSlots(f: FormField): RuleNode[] {
  const s: RuleNode[] = [];
  if (present(f.showWhen)) s.push(f.showWhen);
  if (present(f.requiredWhen)) s.push(f.requiredWhen);
  // Options of a control without options are ignored entirely.
  if (OPTION_CONTROLS.has(f.control)) {
    for (const o of f.options ?? []) if (present(o.availableWhen)) s.push(o.availableWhen);
  }
  return s;
}

function leafMatches(leaf: Leaf, field: FormField, v: unknown): boolean {
  const op = leaf.op;
  if (op === 'isEmpty') return v === null;
  if (op === 'isNotEmpty') return v !== null;
  if (op === 'isTrue') return v === true;
  if (op === 'isFalse') return v === false;
  if (v === null) return op === 'neq' || op === 'notIn';
  const isText = FAMILY[field.control] === 'text';
  const eq = (a: unknown, b: unknown): boolean =>
    isText && typeof a === 'string' && typeof b === 'string'
      ? foldAscii(a) === foldAscii(b)
      : a === b;
  const lit = (leaf as { value: unknown }).value;
  switch (op) {
    case 'eq':
      return eq(v, lit);
    case 'neq':
      return !eq(v, lit);
    case 'in':
      return (lit as unknown[]).some((x) => eq(v, x));
    case 'notIn':
      return !(lit as unknown[]).some((x) => eq(v, x));
    case 'gt':
      return (v as number | string) > (lit as number | string);
    case 'gte':
      return (v as number | string) >= (lit as number | string);
    case 'lt':
      return (v as number | string) < (lit as number | string);
    case 'lte':
      return (v as number | string) <= (lit as number | string);
    case 'contains':
      return Array.isArray(v) && v.includes(lit);
    default:
      return false;
  }
}

function evalRule(n: RuleNode, eff: Map<string, unknown>, byKey: Map<string, FormField>): boolean {
  switch (n.op) {
    case 'and':
      return n.args.every((a) => evalRule(a, eff, byKey));
    case 'or':
      return n.args.some((a) => evalRule(a, eff, byKey));
    case 'not':
      return !evalRule(n.arg, eff, byKey);
    default: {
      const field = byKey.get(n.field);
      return field ? leafMatches(n, field, eff.get(n.field) ?? null) : false;
    }
  }
}

// ------------------------------------------------------------------ definition validation

function checkValidation(f: FormField, codes: Set<DefinitionErrorCode>): void {
  const v = f.validation;
  if (!present(v)) return;
  const family = FAMILY[f.control];
  const invalid = (): void => {
    codes.add('INVALID_VALIDATION');
  };
  if (family === 'number' || family === 'date') {
    const okBound =
      family === 'number'
        ? (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x)
        : isDateString;
    if (present(v.min) && !okBound(v.min)) invalid();
    if (present(v.max) && !okBound(v.max)) invalid();
    if (present(v.min) && present(v.max) && okBound(v.min) && okBound(v.max) && v.min > v.max) {
      invalid();
    }
  }
  if (family === 'text') {
    if (
      present(v.maxLength) &&
      !(Number.isInteger(v.maxLength) && v.maxLength >= 1 && v.maxLength <= 2147483647)
    ) {
      invalid();
    }
    if (typeof v.pattern === 'string' && !isPortablePattern(v.pattern)) {
      codes.add('INVALID_PATTERN');
    }
    if (
      present(v.patternMessage) &&
      !(
        typeof v.patternMessage === 'string' &&
        v.patternMessage.length >= 1 &&
        v.patternMessage.length <= 200
      )
    ) {
      invalid();
    }
  }
}

/**
 * Publish-time check (form-rules.md section 4). Returns the sorted set of definition error
 * codes; an empty array means the definition is valid and may be evaluated.
 */
export function validateDefinition(fields: readonly FormField[]): DefinitionErrorCode[] {
  const codes = new Set<DefinitionErrorCode>();
  const byKey = new Map<string, FormField>();
  for (const f of fields) {
    if (byKey.has(f.key)) codes.add('DUPLICATE_FIELD_KEY');
    byKey.set(f.key, f);
  }
  if (codes.size) return [...codes];

  const edges = new Map<string, Set<string>>(fields.map((f) => [f.key, new Set<string>()]));
  for (const f of fields) {
    if (typeof f.key !== 'string' || !FIELD_KEY_RE.test(f.key)) codes.add('INVALID_FIELD_KEY');
    if (!KNOWN_CONTROLS.has(f.control)) codes.add('UNKNOWN_CONTROL');
    if (OPTION_CONTROLS.has(f.control)) {
      const options = f.options ?? [];
      if (options.length === 0) codes.add('NO_OPTIONS');
      if (options.some((o) => !OPTION_KEY_RE.test(o.key))) codes.add('INVALID_OPTION_KEY');
      if (new Set(options.map((o) => o.key)).size !== options.length) {
        codes.add('DUPLICATE_OPTION_KEY');
      }
    }
    checkValidation(f, codes);
    if (present(f.section)) {
      const heading = byKey.get(f.section);
      if (!heading || heading.control !== 'SECTION_HEADING' || heading === f) {
        codes.add('INVALID_SECTION');
      } else {
        edges.get(f.key)!.add(heading.key);
      }
    }
    for (const rule of ruleSlots(f)) {
      if (!isValidRuleShape(rule)) {
        codes.add('SCHEMA_VIOLATION');
        continue;
      }
      if (depthOf(rule) > MAX_DEPTH) codes.add('RULE_TOO_DEEP');
      for (const leaf of leaves(rule)) {
        const target = byKey.get(leaf.field);
        if (!target) {
          codes.add('UNKNOWN_FIELD_REFERENCE');
          continue;
        }
        if (!INPUT_CONTROLS.has(target.control)) {
          codes.add('INVALID_REFERENCE_TARGET');
          continue;
        }
        if (target === f) {
          codes.add('SELF_REFERENCE');
          continue;
        }
        edges.get(f.key)!.add(target.key);
        const fam = FAMILY[target.control];
        if (!OPS_BY_FAMILY[fam].includes(leaf.op)) {
          codes.add('OPERATOR_TYPE_MISMATCH');
          continue;
        }
        if ('value' in leaf) {
          const lits: unknown[] = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
          const okLiteral = (x: unknown): boolean =>
            fam === 'number'
              ? typeof x === 'number'
              : fam === 'ref'
                ? typeof x === 'number' && Number.isInteger(x) && x > 0 && x <= MAX_SAFE_INTEGER
                : fam === 'date'
                  ? isDateString(x)
                  : typeof x === 'string';
          if (!lits.every(okLiteral)) {
            codes.add('LITERAL_TYPE_MISMATCH');
            continue;
          }
          if (
            OPTION_CONTROLS.has(target.control) &&
            !lits.every((x) => (target.options ?? []).some((o) => o.key === x))
          ) {
            codes.add('UNKNOWN_OPTION_REFERENCE');
          }
        }
      }
    }
  }

  // Cycle detection; self loops were reported as SELF_REFERENCE and never added as edges.
  const state = new Map<string, 1 | 2>();
  const dfs = (k: string): boolean => {
    state.set(k, 1);
    for (const n of edges.get(k)!) {
      if (state.get(n) === 1) return true;
      if (!state.has(n) && dfs(n)) return true;
    }
    state.set(k, 2);
    return false;
  };
  for (const f of fields) {
    if (!state.has(f.key) && dfs(f.key)) {
      codes.add('CIRCULAR_DEPENDENCY');
      break;
    }
  }
  return [...codes].sort();
}

// ------------------------------------------------------------------ evaluation

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Unanchored search with a pattern from the portable subset (section 3.1), which `RegExp` evaluates exactly
 * like the server. A pattern outside the subset is a definition error and never reaches evaluation.
 */
function safeRegexTest(pattern: string, s: string): boolean {
  try {
    return new RegExp(pattern).test(s);
  } catch {
    return true;
  }
}

/**
 * Evaluate visibility, requiredness, offered options and validation (form-rules.md section 3).
 * Precondition: `validateDefinition(fields)` returned no codes.
 */
export function evaluateForm(
  fields: readonly FormField[],
  values: Readonly<Record<string, unknown>>,
  mode: EvaluationMode = 'submit',
): FormEvaluation {
  const vals: Record<string, unknown> = isObject(values) ? values : {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const vis = new Map<string, boolean>();
  const eff = new Map<string, unknown>();
  const parsed = new Map<string, Parsed>();
  const req = new Map<string, boolean>();
  const opts = new Map<string, string[]>();

  const resolve = (key: string): void => {
    if (vis.has(key)) return;
    const f = byKey.get(key)!;
    const deps = new Set<string>();
    if (present(f.section)) deps.add(f.section);
    for (const r of ruleSlots(f)) for (const l of leaves(r)) deps.add(l.field);
    // Guard against cycles in an (invalid) definition: mark visited before recursing.
    vis.set(key, false);
    for (const d of deps) if (byKey.has(d)) resolve(d);
    const sectionVisible = !present(f.section) || vis.get(f.section) === true;
    const visible = sectionVisible && (!present(f.showWhen) || evalRule(f.showWhen, eff, byKey));
    vis.set(key, visible);
    const isInput = INPUT_CONTROLS.has(f.control);
    const p: Parsed = isInput && visible ? parseValue(f.control, vals[key]) : { empty: true };
    parsed.set(key, p);
    eff.set(key, !p.empty && p.ok ? p.value : null);
    req.set(
      key,
      isInput &&
        visible &&
        (f.required === true || (present(f.requiredWhen) && evalRule(f.requiredWhen, eff, byKey))),
    );
  };
  for (const f of fields) resolve(f.key);

  for (const f of fields) {
    if (!OPTION_CONTROLS.has(f.control)) continue;
    opts.set(
      f.key,
      (f.options ?? [])
        .filter((o) => !present(o.availableWhen) || evalRule(o.availableWhen, eff, byKey))
        .map((o) => o.key),
    );
  }

  const errors: FormError[] = [];
  const normalized: Record<string, unknown> = {};
  for (const k of Object.keys(vals)) {
    const f = byKey.get(k);
    if (!f || !INPUT_CONTROLS.has(f.control)) errors.push({ fieldKey: k, code: 'UNKNOWN_FIELD' });
  }
  for (const f of fields) {
    if (!INPUT_CONTROLS.has(f.control) || !vis.get(f.key)) continue;
    const p = parsed.get(f.key)!;
    const fail = (code: FormErrorCode): void => {
      errors.push({ fieldKey: f.key, code });
    };
    if (p.empty) {
      if (req.get(f.key) && mode !== 'draft') fail('REQUIRED');
      continue;
    }
    if (!p.ok) {
      fail('INVALID_TYPE');
      continue;
    }
    const v = p.value;
    normalized[f.key] = v;
    const val = f.validation ?? {};
    const fam = FAMILY[f.control];
    if (fam === 'number' || fam === 'date') {
      // Bounds have the field's own JSON type: a definition that mixes them is INVALID_VALIDATION.
      const x = v as number | string;
      const below = present(val.min) && x < val.min;
      const above = present(val.max) && x > val.max;
      if (below || above) {
        fail('OUT_OF_RANGE');
        continue;
      }
    }
    if (fam === 'text') {
      const s = v as string;
      if (present(val.maxLength) && s.length > val.maxLength) {
        fail('TOO_LONG');
        continue;
      }
      if (typeof val.pattern === 'string' && !safeRegexTest(val.pattern, s)) {
        fail('PATTERN');
        continue;
      }
    }
    if (fam === 'single' && !opts.get(f.key)!.includes(v as string)) fail('OPTION_NOT_ALLOWED');
    if (fam === 'multi' && !(v as string[]).every((x) => opts.get(f.key)!.includes(x))) {
      fail('OPTION_NOT_ALLOWED');
    }
  }
  errors.sort((a, b) => cmp(a.fieldKey, b.fieldKey) || cmp(a.code, b.code));

  return {
    visible: Object.fromEntries(fields.map((f) => [f.key, vis.get(f.key) === true])),
    required: Object.fromEntries(fields.map((f) => [f.key, req.get(f.key) === true])),
    options: Object.fromEntries(
      fields.filter((f) => opts.has(f.key)).map((f) => [f.key, opts.get(f.key)!]),
    ),
    errors,
    normalized,
  };
}
