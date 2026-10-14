import { validateDefinition } from '../rules/evaluator';
import {
  DefinitionErrorCode,
  FormControl,
  FormDefinition,
  FormField,
  FormOption,
  RuleNode,
  Scalar,
} from '../rules/types';

/**
 * Pure helpers behind `<mf-form-designer>` and `<mf-rule-builder>`: control catalog, operator
 * tables (form-rules.md section 2), field/option editing, rule editing, plain-language summaries
 * and definition diagnostics. No Angular dependency; unit tested directly.
 */

/** A field as edited in the designer. `defaultValue` is designer metadata, not part of the rules contract. */
export interface DesignerField extends FormField {
  defaultValue?: string | number | boolean | string[];
}

export interface DesignerDefinition {
  fields: DesignerField[];
}

export type LeafNode = Extract<RuleNode, { field: string }>;
export type GroupNode = Extract<RuleNode, { op: 'and' | 'or' }>;
export type RuleOp = LeafNode['op'];
export type RuleSlot = 'showWhen' | 'requiredWhen' | `option:${string}`;

// ------------------------------------------------------------------ control catalog

export interface ControlInfo {
  control: FormControl;
  label: string;
}

/** Palette order (UX S14). There is deliberately no file-upload control. */
export const CONTROL_CATALOG: readonly ControlInfo[] = [
  { control: 'SECTION_HEADING', label: 'Section heading' },
  { control: 'HELP_TEXT', label: 'Help text' },
  { control: 'TEXT', label: 'Text' },
  { control: 'TEXTAREA', label: 'Multi-line text' },
  { control: 'NUMBER', label: 'Number' },
  { control: 'CHECKBOX', label: 'Checkbox' },
  { control: 'SELECT', label: 'Dropdown' },
  { control: 'RADIO', label: 'Radio group' },
  { control: 'MULTISELECT', label: 'Multi-select' },
  { control: 'DATE', label: 'Date' },
  { control: 'DATETIME', label: 'Date and time' },
  { control: 'URL', label: 'URL' },
  { control: 'ASSET_REF', label: 'Asset reference' },
  { control: 'USER_REF', label: 'User reference' },
];

export function controlLabel(control: FormControl): string {
  return CONTROL_CATALOG.find((c) => c.control === control)?.label ?? control;
}

const NON_INPUT = new Set<FormControl>(['SECTION_HEADING', 'HELP_TEXT']);
const OPTION_CONTROLS = new Set<FormControl>(['SELECT', 'RADIO', 'MULTISELECT']);
const TEXT_FAMILY = new Set<FormControl>(['TEXT', 'TEXTAREA', 'URL']);
const REF_CONTROLS = new Set<FormControl>(['ASSET_REF', 'USER_REF']);

export const isInputControl = (c: FormControl): boolean => !NON_INPUT.has(c);
export const hasOptions = (c: FormControl): boolean => OPTION_CONTROLS.has(c);
export const isTextFamily = (c: FormControl): boolean => TEXT_FAMILY.has(c);
export const isRefControl = (c: FormControl): boolean => REF_CONTROLS.has(c);

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const OPTION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

// ------------------------------------------------------------------ operators

export type OperandKind = 'none' | 'scalar' | 'list';

export interface OperatorInfo {
  op: RuleOp;
  label: string;
  kind: OperandKind;
}

const KIND: Record<RuleOp, OperandKind> = {
  eq: 'scalar',
  neq: 'scalar',
  gt: 'scalar',
  gte: 'scalar',
  lt: 'scalar',
  lte: 'scalar',
  contains: 'scalar',
  in: 'list',
  notIn: 'list',
  isEmpty: 'none',
  isNotEmpty: 'none',
  isTrue: 'none',
  isFalse: 'none',
};

/** Allowed operators per control (form-rules.md section 2 table). Order is display order. */
function opsFor(control: FormControl): RuleOp[] {
  switch (control) {
    case 'TEXT':
    case 'TEXTAREA':
    case 'URL':
    case 'SELECT':
    case 'RADIO':
    case 'ASSET_REF':
    case 'USER_REF':
      return ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'];
    case 'NUMBER':
    case 'DATE':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'isEmpty', 'isNotEmpty'];
    case 'DATETIME':
      return ['isEmpty', 'isNotEmpty'];
    case 'CHECKBOX':
      return ['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty'];
    case 'MULTISELECT':
      return ['contains', 'isEmpty', 'isNotEmpty'];
    default:
      return [];
  }
}

export function operatorLabel(op: RuleOp, control: FormControl): string {
  if (control === 'DATE') {
    const d: Partial<Record<RuleOp, string>> = {
      gt: 'is after',
      gte: 'is on or after',
      lt: 'is before',
      lte: 'is on or before',
    };
    const label = d[op];
    if (label) return label;
  }
  const labels: Record<RuleOp, string> = {
    eq: 'equals',
    neq: 'does not equal',
    gt: 'is greater than',
    gte: 'is at least',
    lt: 'is less than',
    lte: 'is at most',
    contains: 'includes',
    in: 'is one of',
    notIn: 'is not one of',
    isEmpty: 'is empty',
    isNotEmpty: 'is not empty',
    isTrue: 'is checked',
    isFalse: 'is unchecked',
  };
  return labels[op];
}

/** Only the operators the contract allows for this control; the builder offers nothing else. */
export function operatorsFor(control: FormControl): OperatorInfo[] {
  return opsFor(control).map((op) => ({ op, label: operatorLabel(op, control), kind: KIND[op] }));
}

export const operandKind = (op: RuleOp): OperandKind => KIND[op];

// ------------------------------------------------------------------ rule editing

export const isGroup = (n: RuleNode): n is GroupNode => n.op === 'and' || n.op === 'or';
export const isLeaf = (n: RuleNode): n is LeafNode =>
  n.op !== 'and' && n.op !== 'or' && n.op !== 'not';

/** The builder edits and/or groups of conditions with one nesting level; `not` is not offered. */
export function isBuilderSupported(rule: RuleNode): boolean {
  if (isLeaf(rule)) return true;
  if (rule.op === 'not') return false;
  return rule.args.every((a) => isLeaf(a) || (isGroup(a) && a.args.every((b) => isLeaf(b))));
}

function initialScalar(target: FormField): Scalar {
  if (hasOptions(target.control)) return target.options?.[0]?.key ?? '';
  if (target.control === 'NUMBER') return 0;
  if (isRefControl(target.control)) return 1;
  return '';
}

/** A leaf for `target`, keeping the previous operator/value when they still fit. */
export function makeLeaf(target: FormField, prev?: LeafNode, op?: RuleOp): LeafNode {
  const ops = opsFor(target.control);
  const wanted = op ?? prev?.op;
  const chosen: RuleOp = wanted && ops.includes(wanted) ? wanted : ops[0];
  const field = target.key;
  const sameField = prev?.field === field;
  switch (KIND[chosen]) {
    case 'none':
      return { op: chosen, field } as LeafNode;
    case 'list': {
      const old = prev && 'value' in prev && Array.isArray(prev.value) ? prev.value : null;
      const first = initialScalar(target);
      const fallback = hasOptions(target.control) && first !== '' ? [first] : [];
      return { op: chosen, field, value: (sameField && old) || fallback } as LeafNode;
    }
    default: {
      const old = prev && 'value' in prev && !Array.isArray(prev.value) ? prev.value : undefined;
      return {
        op: chosen,
        field,
        value: sameField && old !== undefined ? old : initialScalar(target),
      } as LeafNode;
    }
  }
}

/** Collapse single-child groups so stored rules stay minimal. */
export function normalizeRule(rule: RuleNode): RuleNode {
  if (isGroup(rule)) {
    const args = rule.args.map(normalizeRule);
    return args.length === 1 ? args[0] : { op: rule.op, args };
  }
  return rule;
}

export function leavesOf(rule: RuleNode): LeafNode[] {
  if (isLeaf(rule)) return [rule];
  if (rule.op === 'not') return leavesOf(rule.arg);
  return rule.args.flatMap(leavesOf);
}

function ruleSlotsOf(f: FormField): { slot: RuleSlot; rule: RuleNode }[] {
  const out: { slot: RuleSlot; rule: RuleNode }[] = [];
  if (f.showWhen) out.push({ slot: 'showWhen', rule: f.showWhen });
  if (f.requiredWhen) out.push({ slot: 'requiredWhen', rule: f.requiredWhen });
  for (const o of f.options ?? []) {
    if (o.availableWhen) out.push({ slot: `option:${o.key}`, rule: o.availableWhen });
  }
  return out;
}

// ------------------------------------------------------------------ summaries

export const fieldName = (f: FormField): string => f.label?.trim() || f.key;

function valueText(target: FormField | undefined, v: unknown): string {
  if (target && hasOptions(target.control)) {
    const o = target.options?.find((x) => x.key === v);
    return o ? `"${o.label?.trim() || o.key}"` : `"${String(v)}"`;
  }
  return typeof v === 'string' ? `"${v}"` : String(v);
}

function summarizeLeaf(n: LeafNode, byKey: Map<string, FormField>): string {
  const target = byKey.get(n.field);
  const name = target ? fieldName(target) : n.field;
  const op = target ? operatorLabel(n.op, target.control) : n.op;
  if (!('value' in n)) return `${name} ${op}`;
  const vals = Array.isArray(n.value)
    ? n.value.map((x) => valueText(target, x)).join(', ')
    : valueText(target, n.value);
  return `${name} ${op} ${vals}`;
}

/** Plain-language rendering of a rule, e.g. `Requires OCR? is checked and Region equals "EU"`. */
export function summarizeRule(rule: RuleNode, fields: readonly FormField[]): string {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const go = (n: RuleNode, nested: boolean): string => {
    if (isLeaf(n)) return summarizeLeaf(n, byKey);
    if (n.op === 'not') return `not (${go(n.arg, false)})`;
    const text = n.args.map((a) => go(a, true)).join(n.op === 'and' ? ' and ' : ' or ');
    return nested && n.args.length > 1 ? `(${text})` : text;
  };
  return go(rule, false);
}

// ------------------------------------------------------------------ field and option editing

export function slugify(text: string, pattern: RegExp, fallback: string): string {
  const ascii = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const candidate =
    pattern === FIELD_KEY_PATTERN && ascii && !/^[a-z]/.test(ascii) ? `f_${ascii}` : ascii;
  return candidate && pattern.test(candidate) ? candidate : fallback;
}

export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export function slugFieldKey(
  label: string,
  fields: readonly FormField[],
  selfKey?: string,
): string {
  const taken = new Set(fields.filter((f) => f.key !== selfKey).map((f) => f.key));
  return uniqueKey(slugify(label, FIELD_KEY_PATTERN, 'field'), taken);
}

export function slugOptionKey(
  label: string,
  options: readonly FormOption[],
  selfKey?: string,
): string {
  const taken = new Set(options.filter((o) => o.key !== selfKey).map((o) => o.key));
  return uniqueKey(slugify(label, OPTION_KEY_PATTERN, 'option'), taken);
}

export function newField(control: FormControl, existing: readonly FormField[]): DesignerField {
  const info = CONTROL_CATALOG.find((c) => c.control === control)!;
  const key = slugFieldKey(info.label, existing);
  const field: DesignerField = { key, control, label: info.label };
  if (control === 'HELP_TEXT') {
    delete field.label;
    field.helpText = 'Help text';
  }
  if (hasOptions(control)) {
    field.options = [
      { key: 'option_1', label: 'Option 1' },
      { key: 'option_2', label: 'Option 2' },
    ];
  }
  return field;
}

export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
  const copy = [...items];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

export interface Dependent {
  fieldKey: string;
  /** Where the reference lives. */
  where: 'showWhen' | 'requiredWhen' | 'option' | 'section';
}

/** Everything that would break if `key` were deleted or renamed. */
export function dependentsOf(fields: readonly FormField[], key: string): Dependent[] {
  const out: Dependent[] = [];
  const uses = (rule: RuleNode | undefined): boolean =>
    !!rule && leavesOf(rule).some((l) => l.field === key);
  for (const f of fields) {
    if (f.key === key) continue;
    if (f.section === key) out.push({ fieldKey: f.key, where: 'section' });
    if (uses(f.showWhen)) out.push({ fieldKey: f.key, where: 'showWhen' });
    if (uses(f.requiredWhen)) out.push({ fieldKey: f.key, where: 'requiredWhen' });
    if (f.options?.some((o) => uses(o.availableWhen))) {
      out.push({ fieldKey: f.key, where: 'option' });
    }
  }
  return out;
}

/** Strip designer-only metadata to get the contract shape used by the evaluator and renderer. */
export function toRuntimeDefinition(fields: readonly DesignerField[]): FormDefinition {
  return {
    fields: fields.map((f) => {
      const rest: FormField = { ...f };
      delete (rest as DesignerField).defaultValue;
      return rest;
    }),
  };
}

/** Initial values for the preview: field defaults. */
export function defaultValues(fields: readonly DesignerField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.defaultValue !== undefined && isInputControl(f.control)) out[f.key] = f.defaultValue;
  }
  return out;
}

// ------------------------------------------------------------------ diff (publish dialog)

export interface DefinitionDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffDefinitions(
  before: readonly DesignerField[],
  after: readonly DesignerField[],
): DefinitionDiff {
  const prev = new Map(before.map((f) => [f.key, JSON.stringify(f)]));
  const next = new Map(after.map((f) => [f.key, JSON.stringify(f)]));
  const diff: DefinitionDiff = { added: [], removed: [], changed: [] };
  for (const [k, v] of next) {
    if (!prev.has(k)) diff.added.push(k);
    else if (prev.get(k) !== v) diff.changed.push(k);
  }
  for (const k of prev.keys()) if (!next.has(k)) diff.removed.push(k);
  const prevOrder = before.filter((f) => next.has(f.key)).map((f) => f.key);
  const nextOrder = after.filter((f) => prev.has(f.key)).map((f) => f.key);
  if (prevOrder.join() !== nextOrder.join()) {
    for (const k of nextOrder) if (!diff.changed.includes(k)) diff.changed.push(k);
  }
  return diff;
}

// ------------------------------------------------------------------ diagnostics

export type DesignerIssueCode =
  | DefinitionErrorCode
  | 'INVALID_KEY'
  | 'INVALID_OPTION_KEY'
  | 'EMPTY_OPTIONS'
  | 'INVALID_PATTERN'
  | 'INVALID_RANGE'
  | 'INVALID_DEFAULT'
  | 'MISSING_LABEL'
  | 'NO_FIELDS';

/** Which part of a field an issue belongs to; the designer shows it next to that control. */
export type IssueSlot =
  'form' | 'key' | 'label' | 'options' | 'validation' | 'default' | 'section' | RuleSlot;

export interface DesignerIssue {
  id: string;
  code: DesignerIssueCode;
  severity: 'error' | 'warning';
  /** Absent for form-level issues. */
  fieldKey?: string;
  slot: IssueSlot;
  message: string;
}

function definitionMessage(
  code: DefinitionErrorCode,
  f: FormField | undefined,
  path: string,
): string {
  const name = f ? `"${fieldName(f)}"` : 'this field';
  switch (code) {
    case 'DUPLICATE_FIELD_KEY':
      return `Another field already uses the key "${f?.key ?? ''}". Keys must be unique.`;
    case 'DUPLICATE_OPTION_KEY':
      return 'Two options share a key. Option keys must be unique.';
    case 'SCHEMA_VIOLATION':
      return 'This rule is incomplete. Give every condition a field and a value.';
    case 'RULE_TOO_DEEP':
      return 'This rule is nested too deeply. Use at most one group of conditions.';
    case 'UNKNOWN_FIELD_REFERENCE':
      return 'This rule uses a field that does not exist. Pick another field or remove the condition.';
    case 'INVALID_REFERENCE_TARGET':
      return 'This rule uses a heading or help text. Rules can only use fields that hold an answer.';
    case 'SELF_REFERENCE':
      return `A rule on ${name} cannot use ${name} itself. Pick another field.`;
    case 'CIRCULAR_DEPENDENCY':
      return `These fields depend on each other: ${path}. Remove one rule.`;
    case 'OPERATOR_TYPE_MISMATCH':
      return 'A condition uses a comparison that does not fit its field type. Choose the comparison again.';
    case 'LITERAL_TYPE_MISMATCH':
      return 'A condition has a missing or wrong kind of value. Enter a value that fits the field.';
    case 'UNKNOWN_OPTION_REFERENCE':
      return 'A condition uses an option that is not in the field’s list. Choose one of the current options.';
    case 'INVALID_SECTION':
      return `The section for ${name} must be a different section heading in this form.`;
  }
}

/** Fields on a dependency cycle (first one repeated at the end), or null. Mirrors contract section 4. */
export function findCycle(fields: readonly FormField[]): FormField[] | null {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const edges = (f: FormField): string[] => {
    const out = new Set<string>();
    if (f.section) out.add(f.section);
    for (const { rule } of ruleSlotsOf(f)) for (const l of leavesOf(rule)) out.add(l.field);
    out.delete(f.key);
    return [...out].filter((k) => byKey.has(k));
  };
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const dfs = (k: string): string[] | null => {
    state.set(k, 1);
    stack.push(k);
    for (const n of edges(byKey.get(k)!)) {
      if (state.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
      if (!state.has(n)) {
        const found = dfs(n);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(k, 2);
    return null;
  };
  for (const f of fields) {
    if (!state.has(f.key)) {
      const path = dfs(f.key);
      if (path) return path.map((k) => byKey.get(k)!);
    }
  }
  return null;
}

function without(
  fields: readonly FormField[],
  index: number,
  slot: RuleSlot | 'section',
): FormField[] {
  const copy = [...fields];
  const f = { ...copy[index] };
  if (slot === 'showWhen') delete f.showWhen;
  else if (slot === 'requiredWhen') delete f.requiredWhen;
  else if (slot === 'section') delete f.section;
  else {
    const key = slot.slice('option:'.length);
    f.options = f.options?.map((o) => {
      if (o.key !== key) return o;
      const copyOpt = { ...o };
      delete copyOpt.availableWhen;
      return copyOpt;
    });
  }
  copy[index] = f;
  return copy;
}

function isDate(s: unknown): boolean {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/**
 * All problems with a definition. Contract errors come from the library's `validateDefinition`
 * (a set of codes) and are attributed to the field and rule that cause them by removing one rule
 * at a time and re-validating. Designer checks add key format, empty option lists, bad regexes,
 * ranges and defaults (architecture 7.5, UX S14 "Validate").
 */
export function diagnoseDefinition(fields: readonly DesignerField[]): DesignerIssue[] {
  const issues: DesignerIssue[] = [];
  const push = (
    code: DesignerIssueCode,
    severity: 'error' | 'warning',
    slot: IssueSlot,
    message: string,
    fieldKey?: string,
  ): void => {
    const id = `${fieldKey ?? 'form'}:${slot}:${code}`;
    if (!issues.some((i) => i.id === id)) {
      issues.push({ id, code, severity, fieldKey, slot, message });
    }
  };

  if (fields.length === 0) {
    push('NO_FIELDS', 'warning', 'form', 'No fields yet. Add your first field from the palette.');
  }

  const runtime = toRuntimeDefinition(fields).fields;

  // Duplicate keys (the library reports these alone).
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const f of runtime) (seen.has(f.key) ? dup : seen).add(f.key);
  for (const k of dup) {
    const f = runtime.find((x) => x.key === k)!;
    push('DUPLICATE_FIELD_KEY', 'error', 'key', definitionMessage('DUPLICATE_FIELD_KEY', f, ''), k);
  }

  // Field-local checks.
  for (const f of fields) {
    if (!FIELD_KEY_PATTERN.test(f.key)) {
      push(
        'INVALID_KEY',
        'error',
        'key',
        'Use a key that starts with a lowercase letter and has only lowercase letters, digits and underscores (up to 64 characters).',
        f.key,
      );
    }
    if (isInputControl(f.control) && !f.label?.trim()) {
      push('MISSING_LABEL', 'warning', 'label', 'Add a label so people know what to enter.', f.key);
    }
    if (f.control === 'SECTION_HEADING' && !f.label?.trim()) {
      push('MISSING_LABEL', 'warning', 'label', 'Add a heading text.', f.key);
    }
    if (hasOptions(f.control)) {
      if (!f.options?.length) {
        push('EMPTY_OPTIONS', 'error', 'options', 'Add at least one option.', f.key);
      }
      const keys = new Set<string>();
      for (const o of f.options ?? []) {
        if (!OPTION_KEY_PATTERN.test(o.key)) {
          push(
            'INVALID_OPTION_KEY',
            'error',
            'options',
            `The option key "${o.key}" is not valid. Use letters, digits, underscore, dot or hyphen, starting with a letter or digit.`,
            f.key,
          );
        }
        if (keys.has(o.key)) {
          push(
            'DUPLICATE_OPTION_KEY',
            'error',
            'options',
            definitionMessage('DUPLICATE_OPTION_KEY', f, ''),
            f.key,
          );
        }
        keys.add(o.key);
      }
    }
    const v = f.validation;
    if (v?.pattern !== undefined && isTextFamily(f.control)) {
      try {
        new RegExp(v.pattern);
      } catch {
        push(
          'INVALID_PATTERN',
          'error',
          'validation',
          'This pattern is not a valid regular expression.',
          f.key,
        );
      }
    }
    if (v && (f.control === 'NUMBER' || f.control === 'DATE')) {
      if (f.control === 'DATE') {
        for (const bound of [v.min, v.max]) {
          if (bound !== undefined && !isDate(bound)) {
            push('INVALID_RANGE', 'error', 'validation', 'Enter dates as yyyy-mm-dd.', f.key);
          }
        }
      }
      if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
        push(
          'INVALID_RANGE',
          'error',
          'validation',
          'The minimum is greater than the maximum.',
          f.key,
        );
      }
    }
    if (f.defaultValue !== undefined && hasOptions(f.control)) {
      const picked = Array.isArray(f.defaultValue) ? f.defaultValue : [f.defaultValue];
      const keys = new Set((f.options ?? []).map((o) => o.key));
      if (!picked.every((p) => typeof p === 'string' && keys.has(p))) {
        push(
          'INVALID_DEFAULT',
          'error',
          'default',
          'The default is not one of the options.',
          f.key,
        );
      }
    }
    if (f.control === 'NUMBER' && typeof f.defaultValue === 'number') {
      const { min, max } = f.validation ?? {};
      if (
        (typeof min === 'number' && f.defaultValue < min) ||
        (typeof max === 'number' && f.defaultValue > max)
      ) {
        push(
          'INVALID_DEFAULT',
          'error',
          'default',
          'The default is outside the allowed range.',
          f.key,
        );
      }
    }
  }

  if (dup.size) return issues;

  // Contract validation, attributed to the offending field and rule.
  const codes = validateDefinition(runtime);
  const cycle = codes.includes('CIRCULAR_DEPENDENCY') ? findCycle(runtime) : null;
  const path = cycle ? cycle.map(fieldName).join(' -> ') : '';
  const cycleKeys = new Set(cycle?.map((f) => f.key));
  for (const code of codes) {
    if (code === 'DUPLICATE_OPTION_KEY') continue; // reported above, with its field
    let attributed = false;
    runtime.forEach((f, i) => {
      if (code === 'CIRCULAR_DEPENDENCY' && !cycleKeys.has(f.key)) return;
      const slots: (RuleSlot | 'section')[] = [
        ...ruleSlotsOf(f).map((s) => s.slot),
        ...(f.section !== undefined ? (['section'] as const) : []),
      ];
      for (const slot of slots) {
        if (!validateDefinition(without(runtime, i, slot)).includes(code)) {
          push(code, 'error', slot, definitionMessage(code, f, path), f.key);
          attributed = true;
        }
      }
    });
    if (!attributed) push(code, 'error', 'form', definitionMessage(code, undefined, path));
  }
  return issues;
}

export const hasErrors = (issues: readonly DesignerIssue[]): boolean =>
  issues.some((i) => i.severity === 'error');
