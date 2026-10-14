# Form rules contract (v1)

Normative semantics for conditional form rules, shared by the .NET validator (authoritative) and the TypeScript renderer (`projects/form-engine`). Architecture reference: `docs/architecture.md` section 7. Files:

| File | Role |
|---|---|
| `form-rules.schema.json` | JSON Schema (2020-12) for one rule node, plus `$defs` describing the vectors file. Structure only. |
| `form-rules.vectors.json` | Conformance vectors. Both implementations must reproduce `expected` exactly. |
| `validate-contracts.mjs` | Dependency-free checker with a small reference evaluator: `node contracts/validate-contracts.mjs` |

Rules are data, never code. Where used: `ShowWhenJson` (absent = always shown), `RequiredWhenJson` (absent = static `required` only), option `AvailableWhenJson` (absent = always available). When the contract changes, change schema, this file and the vectors together.

## 1. Vocabulary

- **Field**: `{key, control, required?, section?, validation?, showWhen?, requiredWhen?, options?}` in display order (array order). Keys match `^[a-z][a-z0-9_]{0,63}$`; option keys match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`.
- **Input controls**: TEXT, TEXTAREA, NUMBER, CHECKBOX, SELECT, RADIO, MULTISELECT, DATE, DATETIME, URL, ASSET_REF, USER_REF. **Non-input**: SECTION_HEADING, HELP_TEXT (never hold a value, never required, cannot be referenced by rules). There is no file-upload control.
- **Section**: `field.section` names a SECTION_HEADING field of the same form. Members inherit the heading's hidden state.
- **Rule node**: `and`/`or` (`args`, 1..8), `not` (`arg`), comparison (`field`, `value`), unary (`field`). Operators: `eq neq gt gte lt lte contains` (scalar `value`), `in notIn` (non-empty array `value`, max 50), `isEmpty isNotEmpty isTrue isFalse`.
- **Depth**: leaf = 1; `and`/`or`/`not` = 1 + max(child depth). Maximum 3.

## 2. Values, emptiness and type coercion

**There is no implicit coercion.** Values are JSON; a value whose JSON type does not match the control is `INVALID_TYPE`. Clients convert (for example `"12"` to `12`) before submitting.

| Control | Accepted JSON value |
|---|---|
| TEXT, TEXTAREA | string |
| URL | string matching `^https?://[^\s/?#]+[^\s]*$` |
| NUMBER | finite JSON number (compared by exact numeric value; `1` equals `1.0`) |
| CHECKBOX | boolean |
| SELECT, RADIO | string |
| MULTISELECT | array of strings with no duplicates (order preserved) |
| DATE | string `yyyy-MM-dd` that is a real calendar date (year 0001-9999) |
| DATETIME | string `yyyy-MM-ddTHH:mm:ss[.f{1,7}]Z` (UTC, literal `Z`), real calendar date |
| ASSET_REF, USER_REF | positive integer (`3` and `3.0` ok, `1.5` and `"3"` not). Existence checks are server context and outside these vectors. |

**Empty** means: absent, `null`, a string consisting only of ASCII whitespace (U+0009-U+000D, U+0020; the empty string included), or `[]`. This applies to every control, so `""` for a NUMBER is empty, not invalid. `false` and `0` are values, not empty. A required CHECKBOX is satisfied by `false`; it only fails when unanswered.

**Effective value** (what rules see) of a field is `null` when the field is hidden, empty, or type-invalid; otherwise the submitted value. It does not depend on range, pattern, length or option-availability errors.

**Comparison semantics** (only on effective values):

- `null` operand: `eq gt gte lt lte in contains isTrue isFalse` are false; `neq`, `notIn`, `isEmpty` are true; `isNotEmpty` is false. No three-valued logic. `not` is plain boolean negation.
- Text family (TEXT, TEXTAREA, URL): `eq neq in notIn` compare ASCII-case-insensitively (only A-Z fold; all other characters, including `É` vs `é`, compare exactly; no trimming). Ordering operators are **not allowed** on text.
- SELECT/RADIO/MULTISELECT: option keys compare exactly (case-sensitive). `contains` (MULTISELECT only) tests membership of one key.
- NUMBER: numeric. DATE: chronological, equal to ordinal string comparison. ASSET_REF/USER_REF: integer equality.
- `isTrue` is `value === true`; `isFalse` is `value === false` (an unanswered checkbox is neither).

Operator/control compatibility and literal types are checked at publish time (section 4):

| Control family | Allowed operators | Literal type |
|---|---|---|
| TEXT, TEXTAREA, URL | eq neq in notIn isEmpty isNotEmpty | string |
| NUMBER | eq neq gt gte lt lte in notIn isEmpty isNotEmpty | number |
| DATE | same as NUMBER | `yyyy-MM-dd` string |
| DATETIME | isEmpty isNotEmpty | - |
| CHECKBOX | isTrue isFalse isEmpty isNotEmpty | - |
| SELECT, RADIO | eq neq in notIn isEmpty isNotEmpty | declared option key |
| MULTISELECT | contains isEmpty isNotEmpty | declared option key |
| ASSET_REF, USER_REF | eq neq in notIn isEmpty isNotEmpty | positive integer |

## 3. Evaluation

Input: field list, submitted `values` object, `mode` (`submit` default, or `draft`). Precondition: the definition passed section 4.

1. Process fields so that every field comes after everything its rules reference (a topological order; the result does not depend on which valid order is used).
2. For each field:
   - `visible = sectionVisible && (showWhen absent || showWhen true)`, where `sectionVisible` is true when the field has no `section`, else the heading's `visible`. Headings and help text are fields too and may carry `showWhen`.
   - Hidden field: its value is ignored entirely (see hidden handling below).
   - `required = visible && input control && (required flag || requiredWhen true)`.
   - Offered options (SELECT/RADIO/MULTISELECT, reported for every such field whether visible or not): declared options, in declared order, whose `availableWhen` is absent or true. Option rules are evaluated against effective values.
3. **Validation** (only for visible input fields, in this order; the first failure wins and a field yields at most one error):
   1. empty: `REQUIRED` if `required` and `mode` is `submit` (draft skips this check only); otherwise no further checks.
   2. type per section 2: `INVALID_TYPE`.
   3. NUMBER/DATE `validation.min`/`max` (inclusive; numbers or `yyyy-MM-dd` strings): `OUT_OF_RANGE`.
   4. Text family `validation.maxLength` (UTF-16 code units): `TOO_LONG`. Then `validation.pattern` (ECMAScript regex, unanchored search; .NET must use `RegexOptions.ECMAScript` and a match timeout): `PATTERN`.
   5. SELECT/RADIO value, or any MULTISELECT element, not among the offered options (undeclared and unavailable are the same): `OPTION_NOT_ALLOWED`, once per field.
   - Validation properties that do not apply to the control are ignored.
4. Any key in `values` that is not an input field of the form (unknown key, SECTION_HEADING, HELP_TEXT): `UNKNOWN_FIELD` with that key. This applies regardless of visibility.
5. **Hidden-field handling**: hidden fields are not required, are not validated (no `INVALID_TYPE` etc.), a submitted value for them is dropped without error, and they read as `null` in other rules (so hiding cascades). Retention of hidden values is not supported in v1. The renderer may keep draft values client-side while the user toggles fields, but must not submit them.
6. **Normalized (persisted) values**: an object with one entry for every visible input field whose value is non-empty and type-valid, holding the submitted value unchanged (strings untrimmed, arrays in submitted order), even if that field also has a range/length/pattern/option error. Checkbox `false` and number `0` are kept. Callers persist `normalized` only when `errors` is empty.
7. Defaults are applied by the caller before evaluation; the evaluator does not know about them.
8. Draft mode (`mode: "draft"`): identical except `REQUIRED` is not emitted. The `required` map is unchanged.

**Result shape and comparison** (what vectors assert): `visible` and `required` list every field key; `options` lists every option-bearing field; `errors` is compared as a set of `{fieldKey, code}` (sort by fieldKey then code, ordinal); `normalized` is compared as JSON (object key order irrelevant, array order significant). Error messages are not part of the contract. Codes: `REQUIRED, INVALID_TYPE, OUT_OF_RANGE, TOO_LONG, PATTERN, OPTION_NOT_ALLOWED, UNKNOWN_FIELD`. (`REF_INVALID` and `CROSS_MATTER_REFERENCE` need server context and are not vectored.)

## 4. Definition validation (publish time)

A form is **definition-invalid** if any check below fails; evaluation is then undefined. Vectors with `expected.definitionValid=false` list the set of codes (each vector triggers exactly one). Implementations compare the set of codes, not messages or counts.

| Code | Condition |
|---|---|
| `DUPLICATE_FIELD_KEY` | two fields share a key (reported alone; other checks are skipped) |
| `DUPLICATE_OPTION_KEY` | two options of one field share a key |
| `SCHEMA_VIOLATION` | a rule fails `form-rules.schema.json` (other checks on that rule are skipped) |
| `RULE_TOO_DEEP` | rule depth > 3 |
| `UNKNOWN_FIELD_REFERENCE` | a rule references a key that is not a field of the form |
| `INVALID_REFERENCE_TARGET` | a rule references a SECTION_HEADING or HELP_TEXT |
| `SELF_REFERENCE` | a field's `showWhen`, `requiredWhen` or one of its own option rules references that same field |
| `CIRCULAR_DEPENDENCY` | the dependency graph has a cycle of length >= 2 (self loops are `SELF_REFERENCE`, not this) |
| `OPERATOR_TYPE_MISMATCH` | operator not allowed for the referenced control (section 2 table) |
| `LITERAL_TYPE_MISMATCH` | literal(s) not of the type required by the referenced control (boolean literals are never valid) |
| `UNKNOWN_OPTION_REFERENCE` | SELECT/RADIO/MULTISELECT literal is not a declared option key of the referenced field |
| `INVALID_SECTION` | `section` does not name a different SECTION_HEADING field |

**Dependency graph**: an edge goes from a field to every field referenced by its `showWhen`, `requiredWhen` and option `availableWhen` rules, and from a field to its section heading. Cycles through sections therefore count.

Not vectored here (other publish checks in architecture 7.5): control-type changes between versions, defaults, regex compilation, `IsFilterable` limits, minimum option counts.

## 5. Changing the contract

1. Edit schema and this document. 2. Add or change vectors (regenerate `expected` only after deciding the intended behavior; review diffs by hand). 3. Run `node contracts/validate-contracts.mjs`. 4. Update the .NET and TypeScript suites, which load `form-rules.vectors.json` unchanged. The vector file's `contractVersion` is bumped for breaking changes.

## 6. Deliberate refinements of architecture 7.3

- The schema splits `compare` into scalar operators and `in`/`notIn` (array required) so shape errors are caught by the schema alone.
- Ordering operators on text are disallowed (they were ambiguous across ordinal vs culture comparison and have no known use).
- Case-insensitive text equality is ASCII-only, and option keys compare case-sensitively, so .NET and TypeScript cannot diverge on Unicode case mapping.
