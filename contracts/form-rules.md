# Form rules contract (v1)

Normative semantics for conditional form rules, shared by the .NET validator (authoritative) and the TypeScript renderer (`projects/form-engine`). Architecture reference: `docs/architecture.md` section 7. Files:

| File | Role |
|---|---|
| `form-rules.schema.json` | JSON Schema (2020-12) for one rule node, plus `$defs` describing the vectors file. Structure only. |
| `form-rules.vectors.json` | Conformance vectors. Both implementations must reproduce `expected` exactly. |
| `form-rules.messages.json` | Message keys and wording for every error code (section 7). Consumed by the renderer and the designer. |
| `validate-contracts.mjs` | Dependency-free checker with a small reference evaluator: `node contracts/validate-contracts.mjs` |

Rules are data, never code. **JSON `null` and an omitted member are the same thing for every optional member** (`showWhen`, `requiredWhen`, `availableWhen`, `section`, `required`, `label`, `options`, `validation` and each `validation` member): `null` means absent. A rule that is neither an object nor `null` (a string, number, array or boolean) is `SCHEMA_VIOLATION`. Where used: `ShowWhenJson` (absent = always shown), `RequiredWhenJson` (absent = static `required` only), option `AvailableWhenJson` (absent = always available). When the contract changes, change schema, this file and the vectors together.

## 1. Vocabulary

- **Field**: `{key, control, required?, section?, validation?, showWhen?, requiredWhen?, options?}` in display order (array order). Keys must match `^[a-z][a-z0-9_]{0,63}$` (`INVALID_FIELD_KEY` otherwise); option keys must match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` (`INVALID_OPTION_KEY`). Control names are exact, case-sensitive catalog names (`UNKNOWN_CONTROL` otherwise).
- **Input controls**: TEXT, TEXTAREA, NUMBER, CHECKBOX, SELECT, RADIO, MULTISELECT, DATE, DATETIME, URL, ASSET_REF, USER_REF. **Non-input**: SECTION_HEADING, HELP_TEXT (never hold a value, never required, cannot be referenced by rules). There is no file-upload control.
- **Options** belong to SELECT, RADIO and MULTISELECT, which must declare at least one (`NO_OPTIONS`). On every other control `options` is ignored entirely: not validated, not offered, not part of the dependency graph.
- **Section**: `field.section` names a SECTION_HEADING field of the same form. Members inherit the heading's hidden state. A heading may itself belong to another heading (nested sections).
- **Rule node**: `and`/`or` (`args`, 1..8), `not` (`arg`), comparison (`field`, `value`), unary (`field`). Operators: `eq neq gt gte lt lte contains` (scalar `value`), `in notIn` (non-empty array `value`, max 50), `isEmpty isNotEmpty isTrue isFalse`.
- **Depth**: leaf = 1; `and`/`or`/`not` = 1 + max(child depth). Maximum 3.

## 2. Values, emptiness and type coercion

**There is no implicit coercion.** Values are JSON; a value whose JSON type does not match the control is `INVALID_TYPE`. Clients convert (for example `"12"` to `12`) before submitting.

| Control | Accepted JSON value |
|---|---|
| TEXT, TEXTAREA | string |
| URL | string matching `^https?://[^\s/?#]+[^\s]*$` |
| NUMBER | finite JSON number; see "Numbers" below |
| CHECKBOX | boolean |
| SELECT, RADIO | string |
| MULTISELECT | array of strings with no duplicates (order preserved) |
| DATE | string `yyyy-MM-dd` that is a real calendar date (year 0001-9999) |
| DATETIME | string `yyyy-MM-ddTHH:mm:ss[.f{1,7}]Z` (UTC, literal `Z`), real calendar date |
| ASSET_REF, USER_REF | integer from 1 to 9007199254740991 (2^53-1) (`3`, `3.0` and `3e0` ok; `1.5`, `"3"` and larger values are `INVALID_TYPE`). Existence checks are server context and outside these vectors. |

**Numbers.** A NUMBER value or literal is an IEEE-754 double: JSON number text is converted to the nearest double and everything (equality, ordering, `min`/`max`) works on those doubles. `1`, `1.0` and `1e0` are the same number; `-0` equals `0`; `9007199254740993` and `9007199254740992` are the same number; `0.1` and `0.10000000000000001` are the same number. Decimal exactness is **not** promised: forms that need exact money values must store text or an integer count of minor units. A JSON number that does not fit a finite double (for example `1e999`) is `INVALID_TYPE` as a value and `SCHEMA_VIOLATION` as a rule literal. Serializers must emit numbers that round-trip as doubles.

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
   3. NUMBER/DATE `validation.min`/`max` (inclusive; NUMBER bounds are JSON numbers, DATE bounds are real `yyyy-MM-dd` dates, `min <= max`; anything else is a definition error, `INVALID_VALIDATION`): `OUT_OF_RANGE`.
   4. Text family `validation.maxLength` (an integer 1..2147483647, counted in UTF-16 code units, so a surrogate pair counts 2): `TOO_LONG`. Then `validation.pattern` (portable subset, section 3.1; unanchored search): `PATTERN`. `validation.patternMessage` (1..200 characters) is display text for the `PATTERN` error and never changes the code.
   5. SELECT/RADIO value, or any MULTISELECT element, not among the offered options (undeclared and unavailable are the same): `OPTION_NOT_ALLOWED`, once per field.
   - Validation properties that do not apply to the control are ignored and unchecked (`min`/`max` on TEXT, `pattern` on NUMBER, and so on).
4. Any key in `values` that is not an input field of the form (unknown key, SECTION_HEADING, HELP_TEXT): `UNKNOWN_FIELD` with that key. This applies regardless of visibility and of the value (a `null` value for an unknown key is still `UNKNOWN_FIELD`). Key matching is exact and case-sensitive (`Custodian` is not `custodian`).
5. **Hidden-field handling**: hidden fields are not required, are not validated (no `INVALID_TYPE` etc.), a submitted value for them is dropped without error, and they read as `null` in other rules (so hiding cascades). Retention of hidden values is not supported in v1. The renderer may keep draft values client-side while the user toggles fields, but must not submit them.
6. **Normalized (persisted) values**: an object with one entry for every visible input field whose value is non-empty and type-valid, holding the submitted value unchanged (strings untrimmed, arrays in submitted order), even if that field also has a range/length/pattern/option error. Checkbox `false` and number `0` are kept. Callers persist `normalized` only when `errors` is empty.
7. Defaults are applied by the caller before evaluation; the evaluator does not know about them.
8. Draft mode (`mode: "draft"`): identical except `REQUIRED` is not emitted. The `required` map is unchanged.

### 3.1 Portable pattern subset

`validation.pattern` is written in a small regular-expression dialect on which JavaScript (no flags) and .NET (`RegexOptions.ECMAScript`) give identical answers. Publish rejects anything else with `INVALID_PATTERN`; at evaluation time every implementation therefore sees only portable patterns. A pattern is 1..200 UTF-16 code units and searches the whole value (unanchored; use `^` and `$`). Grammar:

- **Atoms**: a literal character; `.`; a class; `(...)` capturing group; `(?:...)` non-capturing group; `^`; `$`; `\b`; `\B`. Any other `(?` form (lookahead, lookbehind, named group, inline flags) is rejected.
- **Escapes** outside classes: `\d \D \w \W \b \B \t \n \r \f \v`, and a backslash before one of `^ $ \ . * + ? ( ) [ ] { } | / -`. Everything else is rejected: `\s \S` (the whitespace set differs between engines; write `[ \t]` instead), `\p \P`, `\u \x \c \k`, digit escapes and backreferences, and unknown letters.
- **Classes** `[...]` and `[^...]`: at least one item; items are a literal, an escape from the list above except `\b`/`\B`, `\d \D \w \W`, or a range `a-z` of two single characters with `lo <= hi`. A `-` is a literal only as the first item or just before `]`; elsewhere it must be a range operator between two single characters (so `[a-z-9]`, `[\d-z]` and `[--a]` are rejected). An unescaped `[` inside a class is rejected.
- **Quantifiers** `* + ? {n} {n,} {n,m}` (n, m at most 3 digits, `n <= m`), optionally followed by `?` for lazy. A quantifier needs a quantifiable atom (not `^ $ \b \B`, not at the start of a branch) and cannot follow another quantifier (`a**`, `a+*` and possessive `a++` are rejected). A literal `{`, `}` or `]` must be escaped. An unbounded quantifier (`* + {n,}`) on a group that itself contains an unbounded quantifier, as in `(a+)+`, is rejected as a backtracking hazard.
- **Alternation** `|` and empty branches are allowed.

Semantics both engines must reproduce: `\d` is `[0-9]`; `\w` is `[A-Za-z0-9_]`; `\b` uses that word set; matching is case-sensitive and unicode-unaware (UTF-16 code units, so an astral character is two units); `.` matches any code unit except `\n`, `\r`, U+2028 and U+2029; `^` matches only at the start of the value and `$` only at its very end (never before a trailing `\n`). The .NET implementation validates and translates the pattern (`.` and `$` are rewritten, because `RegexOptions.ECMAScript` differs there) and keeps a match timeout as a backstop; a timeout counts as no match. The TypeScript implementation passes the validated pattern to `RegExp` unchanged.

**Result shape and comparison** (what vectors assert): `visible` and `required` list every field key; `options` lists every option-bearing field; `errors` is compared as a set of `{fieldKey, code}` (sort by fieldKey then code, ordinal); `normalized` is compared as JSON (object key order irrelevant, array order significant). Error messages are not part of the contract. Codes: `REQUIRED, INVALID_TYPE, OUT_OF_RANGE, TOO_LONG, PATTERN, OPTION_NOT_ALLOWED, UNKNOWN_FIELD`. (`REF_INVALID` and `CROSS_MATTER_REFERENCE` need server context and are not vectored.)

## 4. Definition validation (publish time)

A form is **definition-invalid** if any check below fails; evaluation is then undefined. Vectors with `expected.definitionValid=false` list the set of codes. Implementations compare the set of codes, not messages or counts. **Duplicate field keys short-circuit**: if any two fields share a key (compared as exact strings, before any shape check) only `DUPLICATE_FIELD_KEY` is reported. Otherwise **every check runs and every distinct code is reported**; within one rule, a `SCHEMA_VIOLATION` skips the remaining checks of that rule only, and within one rule leaf the checks run in this order and stop at the first failure: unknown field, non-input target, self reference, operator, literal, option. (So a heading that references itself is `INVALID_REFERENCE_TARGET`.)

| Code | Condition |
|---|---|
| `DUPLICATE_FIELD_KEY` | two fields share a key (reported alone; other checks are skipped) |
| `INVALID_FIELD_KEY` | a field key does not match `^[a-z][a-z0-9_]{0,63}$` |
| `UNKNOWN_CONTROL` | `control` is not one of the 14 catalog names (exact, case-sensitive) |
| `DUPLICATE_OPTION_KEY` | two options of one option-bearing field share a key |
| `INVALID_OPTION_KEY` | an option key of an option-bearing field does not match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` |
| `NO_OPTIONS` | a SELECT, RADIO or MULTISELECT declares no options (missing, `null` or `[]`) |
| `INVALID_VALIDATION` | on a NUMBER or DATE: `min`/`max` is not a finite number (NUMBER) or real `yyyy-MM-dd` date (DATE), or `min > max`; on the text family: `maxLength` is not an integer in 1..2147483647, or `patternMessage` is not 1..200 characters |
| `INVALID_PATTERN` | a text-family `pattern` is outside the portable subset (section 3.1) |
| `SCHEMA_VIOLATION` | a rule fails `form-rules.schema.json`, including a rule that is a string, number, boolean or array (other checks on that rule are skipped; JSON `null` is absent, not a violation) |
| `RULE_TOO_DEEP` | rule depth > 3 |
| `UNKNOWN_FIELD_REFERENCE` | a rule references a key that is not a field of the form |
| `INVALID_REFERENCE_TARGET` | a rule references a SECTION_HEADING or HELP_TEXT |
| `SELF_REFERENCE` | a field's `showWhen`, `requiredWhen` or one of its own option rules references that same field |
| `CIRCULAR_DEPENDENCY` | the dependency graph has a cycle of length >= 2 (self loops are `SELF_REFERENCE`, not this) |
| `OPERATOR_TYPE_MISMATCH` | operator not allowed for the referenced control (section 2 table) |
| `LITERAL_TYPE_MISMATCH` | literal(s) not of the type required by the referenced control (boolean literals are never valid; a DATE literal must be a real calendar date; a reference-id literal is 1..2^53-1; every element of `in`/`notIn` is checked) |
| `UNKNOWN_OPTION_REFERENCE` | SELECT/RADIO/MULTISELECT literal is not a declared option key of the referenced field |
| `INVALID_SECTION` | `section` does not name a different SECTION_HEADING field (a heading may name another heading; heading cycles are `CIRCULAR_DEPENDENCY`) |

**Dependency graph**: an edge goes from a field to every field referenced by its `showWhen`, `requiredWhen` and option `availableWhen` rules, and from a field to its section heading. Cycles through sections therefore count.

Not vectored here (other publish checks in architecture 7.5): control-type changes between versions, defaults, `IsFilterable` limits.

## 5. Changing the contract

1. Edit schema and this document. 2. Add or change vectors (regenerate `expected` only after deciding the intended behavior; review diffs by hand). 3. Run `node contracts/validate-contracts.mjs`. 4. Update the .NET and TypeScript suites, which load `form-rules.vectors.json` unchanged. The vector file's `contractVersion` is bumped for breaking changes.

## 6. Deliberate refinements of architecture 7.3 (and v1 decisions)

- The schema splits `compare` into scalar operators and `in`/`notIn` (array required) so shape errors are caught by the schema alone.
- Ordering operators on text are disallowed (they were ambiguous across ordinal vs culture comparison and have no known use).
- Case-insensitive text equality is ASCII-only, and option keys compare case-sensitively, so .NET and TypeScript cannot diverge on Unicode case mapping.
- Patterns are a portable subset checked at publish time instead of "ECMAScript, whatever each engine accepts" (section 3.1).
- NUMBER is a double, not a decimal (section 2); `null` is absence everywhere; a required CHECKBOX keeps its "answered, not necessarily true" meaning, so a renderer must let the user answer it (the caller applies a `false` default, section 3 item 7).

## 7. Messages

`form-rules.messages.json` holds the wording for every code, keyed `CODE` or `CODE.variant`, with `{label}`, `{min}`, `{max}`, `{maxLength}`, `{field}` and `{cycle}` placeholders. Wording follows `docs/ux/ux-spec.md` section 8.3 (that table lists the same keys). Error messages are still not compared by vectors; the file is what clients render. Variant selection for field errors:

| Code | Key used |
|---|---|
| `REQUIRED` | `REQUIRED.select` for CHECKBOX, SELECT, RADIO, MULTISELECT, DATE, DATETIME, ASSET_REF and USER_REF; otherwise `REQUIRED.enter` |
| `INVALID_TYPE` | `INVALID_TYPE.<CONTROL>` when that key exists (URL, NUMBER, DATE, DATETIME); otherwise `INVALID_TYPE.default` |
| `OUT_OF_RANGE` | `.between` when both bounds are set, `.min` or `.max` for one, else `.default` |
| `PATTERN` | the field's `validation.patternMessage` when present, else `PATTERN.default` |
| all other codes | the bare code, or `.default` where only that exists |

`{label}` is the field label, falling back to its key; definition errors fill `{field}` the same way and `{cycle}` with the field labels joined by ` -> `, repeating the first. Every field error code and definition error code must have at least one key (`validate-contracts.mjs` enforces it).
