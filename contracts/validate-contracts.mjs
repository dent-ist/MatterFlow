#!/usr/bin/env node
// Dependency-free checker for the form-rules contract.
//   node contracts/validate-contracts.mjs
// 1. Validates the schema's own sample rules and some negative samples.
// 2. Validates form-rules.vectors.json structurally against $defs/vectorFile.
// 3. Cross-checks every vector with a small REFERENCE evaluator that follows form-rules.md
//    (proves the vectors are internally consistent; .NET and TS must match the same outputs).
// Also exports the reference evaluator for the vector generator / tooling.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'));

// ---------------------------------------------------------------- minimal JSON Schema subset
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', '$defs', 'title', 'description', 'examples']);
const KEYWORDS = new Set(['$ref', 'type', 'enum', 'const', 'pattern', 'minimum', 'required', 'properties',
  'additionalProperties', 'items', 'minItems', 'maxItems', 'oneOf']);

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  return ref.slice(2).split('/').reduce((n, k) => n[k], root);
}
const typeOf = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
const isType = (v, t) => t === 'number' ? typeof v === 'number' : typeOf(v) === t;
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function checkSchemaKeywords(schema, path = '#') {
  const bad = [];
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    for (const [k, v] of Object.entries(schema)) {
      if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k)) bad.push(`${path}: unsupported keyword "${k}"`);
      if (k === 'properties' || k === '$defs') for (const [pk, pv] of Object.entries(v)) bad.push(...checkSchemaKeywords(pv, `${path}/${k}/${pk}`));
      else if (['items', 'additionalProperties'].includes(k) && typeof v === 'object') bad.push(...checkSchemaKeywords(v, `${path}/${k}`));
      else if (k === 'oneOf') v.forEach((s, i) => bad.push(...checkSchemaKeywords(s, `${path}/oneOf/${i}`)));
    }
  }
  return bad;
}

export function validate(schema, data, root, path = '$') {
  if (schema === true || schema === undefined) return [];
  if (schema.$ref) return validate(resolveRef(root, schema.$ref), data, root, path);
  const errs = [];
  const e = (m) => errs.push(`${path}: ${m}`);
  if (schema.type !== undefined) {
    const ts = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!ts.some((t) => isType(data, t))) { e(`expected ${ts.join('|')}, got ${typeOf(data)}`); return errs; }
  }
  if (schema.enum && !schema.enum.some((x) => deepEq(x, data))) e(`not in enum ${JSON.stringify(schema.enum)}`);
  if ('const' in schema && !deepEq(schema.const, data)) e(`expected const ${JSON.stringify(schema.const)}`);
  if (schema.pattern !== undefined && typeof data === 'string' && !new RegExp(schema.pattern).test(data)) e(`does not match ${schema.pattern}`);
  if (schema.minimum !== undefined && typeof data === 'number' && data < schema.minimum) e(`below minimum ${schema.minimum}`);
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) e(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && data.length > schema.maxItems) e(`more than ${schema.maxItems} items`);
    if (schema.items) data.forEach((x, i) => errs.push(...validate(schema.items, x, root, `${path}[${i}]`)));
  }
  if (typeOf(data) === 'object') {
    for (const r of schema.required ?? []) if (!(r in data)) e(`missing required "${r}"`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(data)) {
      if (k in props) errs.push(...validate(props[k], v, root, `${path}.${k}`));
      else if (schema.additionalProperties === false) e(`unexpected property "${k}"`);
      else if (typeof schema.additionalProperties === 'object') errs.push(...validate(schema.additionalProperties, v, root, `${path}.${k}`));
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => validate(s, data, root, path).length === 0).length;
    if (matches !== 1) e(`matches ${matches} of ${schema.oneOf.length} oneOf branches (need exactly 1)`);
  }
  return errs;
}

// ---------------------------------------------------------------- reference evaluator (see form-rules.md)
const INPUT_CONTROLS = new Set(['TEXT', 'TEXTAREA', 'NUMBER', 'CHECKBOX', 'SELECT', 'RADIO', 'MULTISELECT', 'DATE', 'DATETIME', 'URL', 'ASSET_REF', 'USER_REF']);
const OPTION_CONTROLS = new Set(['SELECT', 'RADIO', 'MULTISELECT']);
const MAX_DEPTH = 3;
const FAMILY = { TEXT: 'text', TEXTAREA: 'text', URL: 'text', NUMBER: 'number', DATE: 'date', DATETIME: 'datetime', CHECKBOX: 'checkbox', SELECT: 'single', RADIO: 'single', MULTISELECT: 'multi', ASSET_REF: 'ref', USER_REF: 'ref' };
const EQ_SET = ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'];
const ORDERED = [...EQ_SET, 'gt', 'gte', 'lt', 'lte'];
const OPS_BY_FAMILY = { text: EQ_SET, number: ORDERED, date: ORDERED, datetime: ['isEmpty', 'isNotEmpty'], checkbox: ['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty'], single: EQ_SET, multi: ['contains', 'isEmpty', 'isNotEmpty'], ref: EQ_SET };

const BLANK = /^[\t\n\v\f\r ]*$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,7})?Z$/;
const URL_RE = /^https?:\/\/[^\s/?#]+[^\s]*$/;
function validDate(y, m, d) {
  y = +y; m = +m; d = +d;
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
const isDateStr = (s) => typeof s === 'string' && (m => !!m && validDate(m[1], m[2], m[3]))(DATE_RE.exec(s));
const foldAscii = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** Parse a raw submitted value. Returns {empty:true} | {ok:true,value} | {ok:false}. No coercion. */
function parseValue(control, raw) {
  if (raw === undefined || raw === null) return { empty: true };
  if (typeof raw === 'string' && BLANK.test(raw)) return { empty: true };
  if (Array.isArray(raw) && raw.length === 0) return { empty: true };
  const bad = { ok: false }, good = (value) => ({ ok: true, value });
  switch (FAMILY[control]) {
    case 'text': return typeof raw !== 'string' ? bad : control === 'URL' && !URL_RE.test(raw) ? bad : good(raw);
    case 'number': return typeof raw === 'number' && Number.isFinite(raw) ? good(raw) : bad;
    case 'checkbox': return typeof raw === 'boolean' ? good(raw) : bad;
    case 'single': return typeof raw === 'string' ? good(raw) : bad;
    case 'multi': return Array.isArray(raw) && raw.every((x) => typeof x === 'string') && new Set(raw).size === raw.length ? good(raw) : bad;
    case 'date': return isDateStr(raw) ? good(raw) : bad;
    case 'datetime': { const m = typeof raw === 'string' && DATETIME_RE.exec(raw); return m && validDate(m[1], m[2], m[3]) ? good(raw) : bad; }
    case 'ref': return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? good(raw) : bad;
  }
  return bad;
}

function leafMatches(op, field, lit, v) {
  if (op === 'isEmpty') return v === null;
  if (op === 'isNotEmpty') return v !== null;
  if (op === 'isTrue') return v === true;
  if (op === 'isFalse') return v === false;
  if (v === null) return op === 'neq' || op === 'notIn';
  const fam = FAMILY[field.control];
  const eq = (a, b) => fam === 'text' ? foldAscii(a) === foldAscii(b) : a === b;
  switch (op) {
    case 'eq': return eq(v, lit);
    case 'neq': return !eq(v, lit);
    case 'in': return lit.some((x) => eq(v, x));
    case 'notIn': return !lit.some((x) => eq(v, x));
    case 'gt': return v > lit;
    case 'gte': return v >= lit;
    case 'lt': return v < lit;
    case 'lte': return v <= lit;
    case 'contains': return v.includes(lit);
  }
  throw new Error(`unknown op ${op}`);
}

const depthOf = (n) => n.op === 'and' || n.op === 'or' ? 1 + Math.max(...n.args.map(depthOf)) : n.op === 'not' ? 1 + depthOf(n.arg) : 1;
function* leaves(n) {
  if (n.op === 'and' || n.op === 'or') for (const a of n.args) yield* leaves(a);
  else if (n.op === 'not') yield* leaves(n.arg);
  else yield n;
}
function evalRule(n, eff, byKey) {
  switch (n.op) {
    case 'and': return n.args.every((a) => evalRule(a, eff, byKey));
    case 'or': return n.args.some((a) => evalRule(a, eff, byKey));
    case 'not': return !evalRule(n.arg, eff, byKey);
    default: return leafMatches(n.op, byKey.get(n.field), n.value, eff.get(n.field));
  }
}

function ruleSlots(f) {
  const s = [];
  if (f.showWhen !== undefined) s.push(f.showWhen);
  if (f.requiredWhen !== undefined) s.push(f.requiredWhen);
  for (const o of f.options ?? []) if (o.availableWhen !== undefined) s.push(o.availableWhen);
  return s;
}

/** Publish-time check. Returns sorted unique list of definition error codes ([] = valid). */
export function checkDefinition(fields, ruleSchema) {
  const codes = new Set();
  const byKey = new Map();
  for (const f of fields) { if (byKey.has(f.key)) codes.add('DUPLICATE_FIELD_KEY'); byKey.set(f.key, f); }
  if (codes.size) return [...codes];
  const edges = new Map(fields.map((f) => [f.key, new Set()]));
  for (const f of fields) {
    if (new Set((f.options ?? []).map((o) => o.key)).size !== (f.options ?? []).length) codes.add('DUPLICATE_OPTION_KEY');
    if (f.section !== undefined) {
      const h = byKey.get(f.section);
      if (!h || h.control !== 'SECTION_HEADING' || h === f) codes.add('INVALID_SECTION'); else edges.get(f.key).add(h.key);
    }
    for (const rule of ruleSlots(f)) {
      if (validate(ruleSchema, rule, ruleSchema).length) { codes.add('SCHEMA_VIOLATION'); continue; }
      if (depthOf(rule) > MAX_DEPTH) codes.add('RULE_TOO_DEEP');
      for (const l of leaves(rule)) {
        const t = byKey.get(l.field);
        if (!t) { codes.add('UNKNOWN_FIELD_REFERENCE'); continue; }
        if (!INPUT_CONTROLS.has(t.control)) { codes.add('INVALID_REFERENCE_TARGET'); continue; }
        if (t === f) { codes.add('SELF_REFERENCE'); continue; }
        edges.get(f.key).add(t.key);
        const fam = FAMILY[t.control];
        if (!OPS_BY_FAMILY[fam].includes(l.op)) { codes.add('OPERATOR_TYPE_MISMATCH'); continue; }
        if ('value' in l) {
          const lits = Array.isArray(l.value) ? l.value : [l.value];
          const okLit = (x) => fam === 'number' ? typeof x === 'number'
            : fam === 'ref' ? Number.isInteger(x) && x > 0
            : fam === 'date' ? isDateStr(x) : typeof x === 'string';
          if (!lits.every(okLit)) { codes.add('LITERAL_TYPE_MISMATCH'); continue; }
          if (OPTION_CONTROLS.has(t.control) && !lits.every((x) => (t.options ?? []).some((o) => o.key === x))) codes.add('UNKNOWN_OPTION_REFERENCE');
        }
      }
    }
  }
  // cycle detection (self loops were reported as SELF_REFERENCE and never added)
  const state = new Map();
  const dfs = (k) => {
    state.set(k, 1);
    for (const n of edges.get(k)) {
      if (state.get(n) === 1) return true;
      if (!state.has(n) && dfs(n)) return true;
    }
    state.set(k, 2);
    return false;
  };
  for (const f of fields) if (!state.has(f.key) && dfs(f.key)) { codes.add('CIRCULAR_DEPENDENCY'); break; }
  return [...codes].sort();
}

/** Evaluate + validate. Assumes the definition is valid. */
export function evaluate(fields, values, mode = 'submit') {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const vis = new Map(), eff = new Map(), parsed = new Map(), req = new Map(), opts = new Map();
  const resolve = (key) => {
    if (vis.has(key)) return;
    const f = byKey.get(key);
    const deps = new Set();
    if (f.section !== undefined) deps.add(f.section);
    for (const r of ruleSlots(f)) for (const l of leaves(r)) deps.add(l.field);
    for (const d of deps) resolve(d);
    const sectionVisible = f.section === undefined || vis.get(f.section);
    const visible = sectionVisible && (f.showWhen === undefined || evalRule(f.showWhen, eff, byKey));
    vis.set(key, visible);
    let p = { empty: true };
    if (INPUT_CONTROLS.has(f.control) && visible) p = parseValue(f.control, values[key]);
    parsed.set(key, p);
    eff.set(key, p.ok ? p.value : null);
    req.set(key, INPUT_CONTROLS.has(f.control) && visible && (f.required === true || (f.requiredWhen !== undefined && evalRule(f.requiredWhen, eff, byKey))));
  };
  for (const f of fields) resolve(f.key);
  for (const f of fields) if (OPTION_CONTROLS.has(f.control)) {
    opts.set(f.key, (f.options ?? []).filter((o) => o.availableWhen === undefined || evalRule(o.availableWhen, eff, byKey)).map((o) => o.key));
  }
  const errors = [], normalized = {};
  for (const k of Object.keys(values)) {
    const f = byKey.get(k);
    if (!f || !INPUT_CONTROLS.has(f.control)) errors.push({ fieldKey: k, code: 'UNKNOWN_FIELD' });
  }
  for (const f of fields) {
    if (!INPUT_CONTROLS.has(f.control) || !vis.get(f.key)) continue;
    const p = parsed.get(f.key);
    const fail = (code) => errors.push({ fieldKey: f.key, code });
    if (p.empty) { if (req.get(f.key) && mode !== 'draft') fail('REQUIRED'); continue; }
    if (!p.ok) { fail('INVALID_TYPE'); continue; }
    normalized[f.key] = p.value;
    const v = p.value, val = f.validation ?? {}, fam = FAMILY[f.control];
    if ((fam === 'number' || fam === 'date') && ((val.min !== undefined && v < val.min) || (val.max !== undefined && v > val.max))) { fail('OUT_OF_RANGE'); continue; }
    if (fam === 'text') {
      if (val.maxLength !== undefined && v.length > val.maxLength) { fail('TOO_LONG'); continue; }
      if (val.pattern !== undefined && !new RegExp(val.pattern).test(v)) { fail('PATTERN'); continue; }
    }
    if (fam === 'single' && !opts.get(f.key).includes(v)) fail('OPTION_NOT_ALLOWED');
    if (fam === 'multi' && !v.every((x) => opts.get(f.key).includes(x))) fail('OPTION_NOT_ALLOWED');
  }
  errors.sort((a, b) => (a.fieldKey < b.fieldKey ? -1 : a.fieldKey > b.fieldKey ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    definitionValid: true,
    visible: Object.fromEntries(fields.map((f) => [f.key, vis.get(f.key)])),
    required: Object.fromEntries(fields.map((f) => [f.key, req.get(f.key)])),
    options: Object.fromEntries(fields.filter((f) => OPTION_CONTROLS.has(f.control)).map((f) => [f.key, opts.get(f.key)])),
    errors,
    normalized,
  };
}

export function runVector(vec, ruleSchema) {
  const codes = checkDefinition(vec.schema.fields, ruleSchema);
  if (codes.length) return { definitionValid: false, definitionErrors: codes };
  return evaluate(vec.schema.fields, vec.values, vec.mode ?? 'submit');
}

// ---------------------------------------------------------------- main
function main() {
  const schema = load('form-rules.schema.json');
  const vecFile = load('form-rules.vectors.json');
  const problems = [];
  const fail = (m) => problems.push(m);

  // 1. schema hygiene + sample rules
  for (const m of checkSchemaKeywords(schema)) fail(m);
  schema.examples.forEach((ex, i) => validate(schema, ex, schema).forEach((m) => fail(`schema example ${i}: ${m}`)));
  const negatives = [
    [{ op: 'xor', args: [] }, 'unknown op'],
    [{ op: 'and', args: [] }, 'empty args'],
    [{ op: 'eq', field: 'Bad-Key', value: 1 }, 'bad field key'],
    [{ op: 'eq', field: 'a' }, 'missing value'],
    [{ op: 'in', field: 'a', value: 'x' }, 'in needs array'],
    [{ op: 'eq', field: 'a', value: ['x'] }, 'eq needs scalar'],
    [{ op: 'isTrue', field: 'a', value: true }, 'unary extra prop'],
    [{ op: 'not', args: [{ op: 'isTrue', field: 'a' }] }, 'not uses arg'],
    [{ op: 'and', args: new Array(9).fill({ op: 'isTrue', field: 'a' }) }, 'too many args'],
    [{ op: 'eq', field: 'a', value: null }, 'null literal'],
    [{ op: 'eq', field: 'a', value: { x: 1 } }, 'object literal'],
  ];
  negatives.forEach(([n, why]) => { if (!validate(schema, n, schema).length) fail(`negative sample accepted (${why}): ${JSON.stringify(n)}`); });

  // 2. vector file structure
  const fileErrs = validate(schema.$defs.vectorFile, vecFile, schema);
  fileErrs.forEach(fail);

  if (!fileErrs.length) {
    const names = new Set();
    const seenControls = new Set();
    let validCount = 0, invalidCount = 0;
    for (const vec of vecFile.vectors) {
      if (names.has(vec.name)) fail(`duplicate vector name ${vec.name}`);
      names.add(vec.name);
      for (const f of vec.schema.fields) seenControls.add(f.control);
      const wantsSchemaViolation = vec.expected.definitionValid === false && vec.expected.definitionErrors.includes('SCHEMA_VIOLATION');
      if (!wantsSchemaViolation) {
        for (const f of vec.schema.fields) {
          if (!/^[a-z][a-z0-9_]{0,63}$/.test(f.key)) fail(`${vec.name}: field key "${f.key}" violates fieldKey pattern`);
          for (const r of ruleSlots(f)) validate(schema, r, schema).forEach((m) => fail(`${vec.name}: rule ${m}`));
          for (const o of f.options ?? []) if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(o.key)) fail(`${vec.name}: option key "${o.key}" violates optionKey pattern`);
        }
      }
      // 3. reference evaluator must reproduce expected
      let actual;
      try { actual = runVector(vec, schema); } catch (e) { fail(`${vec.name}: evaluator threw ${e.message}`); continue; }
      if (vec.expected.definitionValid) validCount++; else invalidCount++;
      const norm = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
      if (norm(actual) !== norm(vec.expected)) fail(`${vec.name}: reference result differs\n   expected ${norm(vec.expected)}\n   actual   ${norm(actual)}`);
      if (vec.expected.definitionValid) {
        const keys = vec.schema.fields.map((f) => f.key).sort().join();
        if (Object.keys(vec.expected.visible).sort().join() !== keys || Object.keys(vec.expected.required).sort().join() !== keys) fail(`${vec.name}: visible/required must list every field`);
      }
    }
    // coverage guard
    for (const c of ['TEXT', 'NUMBER', 'CHECKBOX', 'SELECT', 'MULTISELECT', 'DATE']) if (!seenControls.has(c)) fail(`no vector covers control ${c}`);
    const needCodes = ['CIRCULAR_DEPENDENCY', 'UNKNOWN_FIELD_REFERENCE', 'OPTION_NOT_ALLOWED', 'REQUIRED'];
    const allCodes = JSON.stringify(vecFile.vectors.map((v) => v.expected));
    for (const c of needCodes) if (!allCodes.includes(c)) fail(`no vector expects ${c}`);
    console.log(`vectors: ${vecFile.vectors.length} (${validCount} evaluation, ${invalidCount} definition-invalid)`);
  }

  if (problems.length) {
    console.error(`FAILED (${problems.length})`);
    problems.forEach((p) => console.error(' - ' + p));
    process.exit(1);
  }
  console.log(`schema examples: ${schema.examples.length} valid, ${negatives.length} negative samples rejected`);
  console.log('OK: contracts are well-formed and the reference evaluator reproduces every vector');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
