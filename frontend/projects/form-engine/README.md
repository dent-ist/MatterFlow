# form-engine

Form rules evaluator and dynamic form renderer (architecture section 7, `contracts/form-rules.md`).

- `evaluateForm(fields, values, mode?)` and `validateDefinition(fields)`: pure TypeScript, no Angular. Tested against every vector in `contracts/form-rules.vectors.json` (imported, never copied).
- `<mf-dynamic-form>` (`DynamicForm`): inputs `definition`, `values`, `readOnly`, `mode`, `serverErrors`, `assetPicker`, `userPicker`; outputs `valuesChange` (visible values only), `evaluationChange`; method `validate()`.
- `<mf-form-designer>` (`FormDesigner`) and `<mf-rule-builder>` (`RuleBuilder`): admin designer over a draft. Inputs `definition`, `saved` (locks saved keys/types), `readOnly`; outputs `definitionChange`, `issuesChange`. `diagnoseDefinition(fields)` attributes `validateDefinition` codes to the field and rule at fault. Fields may carry a designer-only `defaultValue` (strip with `toRuntimeDefinition`).
- Pickers for ASSET_REF / USER_REF: provide `MF_ASSET_PICKER` / `MF_USER_PICKER` (see `reference-picker.ts` for the component contract). Without one, a numeric id input is shown.

```bash
npx ng test form-engine --watch=false
npx ng build form-engine
```

Contract ambiguities found while implementing are recorded in `docs/contract-issues-ts.md`.
