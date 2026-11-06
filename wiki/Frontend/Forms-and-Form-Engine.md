# Forms and Form Engine

[[_TOC_]]

**What this page is for.** Two kinds of forms exist: ordinary hand-built forms (client, matter, project, asset, settings) and **dynamic forms** defined by administrators (task request forms, workflow step forms, asset type fields, custom fields). This page explains both and the `form-engine` library that powers the second kind. Rules of the engine: `contracts/form-rules.md`; design: `docs/architecture.md` section 7.

## Ordinary forms

- Create and edit open in the shared dialog `mf-form-dialog` (sizes small, default, large) or on a page with the shared form anatomy (`styles/_forms.scss`, `shared/ui/text-field.ts`, `form-field.scss`). One field anatomy and one action bar: Cancel on the left, the primary action last (D-30, D-35).
- Client, Matter and Project records also hold custom fields (`CustomFieldsJson`); their form shows the admin-defined fields through the form engine.
- Server validation errors (`errors` map of the problem details) go back to the controls with `shared/forms/api-errors.ts`; `focus-invalid.ts` moves focus to the first invalid control.
- Leaving a form with unsaved input: `canDeactivate: [unsavedChangesGuard]` on the route (`shared/guards`).
- Updates send the `rowVersion` loaded with the record; a 409 reloads.

## The `form-engine` library (`frontend/projects/form-engine`)

| Part | What it does |
|---|---|
| `lib/rules` | Pure TypeScript rule evaluator: `evaluateForm(fields, values, mode)` and `validateDefinition(fields)`. Tested against every vector of `contracts/form-rules.vectors.json` (imported, never copied); the .NET engine runs the same vectors |
| `lib/renderer` | `<mf-dynamic-form>` (`DynamicForm`): inputs `definition`, `values`, `readOnly`, `mode`, `serverErrors`, `assetPicker`, `userPicker`; outputs `valuesChange` (visible values only) and `evaluationChange`. Also `DateInput` and message texts |
| `lib/designer` | `<mf-form-designer>` and `<mf-rule-builder>`: the admin designer with drag and drop and a live preview that uses the same renderer |
| Pickers | `ASSET_REF` and `USER_REF` fields use `MF_ASSET_PICKER` and `MF_USER_PICKER` tokens that the app provides at route level (for example `features/tasks/tasks.routes.ts` provides `AssetPicker` and `UserPicker`); without a provider a numeric id input is shown |

Build and test: `npm run ng -- build form-engine` (the root `npm run setup` does it), `npm run ng -- test form-engine --watch=false`. The app imports the built library as `form-engine` (path mapping to `dist/form-engine`), so rebuild it after changing the library.

## Where dynamic forms appear

| Screen | Owner of the form | Designer route |
|---|---|---|
| Create task, Task detail request form | Task type | `/admin/task-types/:ownerId/form` |
| Workflow step input form | Step (library step) | `/admin/steps/:ownerId/form` |
| Asset form | Asset type | `/admin/asset-types/:ownerId/form` |
| Client, matter and project custom fields | Object (Client, Matter, Project) | `/admin/custom-fields/:ownerId/form` |

All designers use the same page component (`features/admin/task-types/task-type-form-page.ts`) with a different `FormDesignerApi` provider and route `data` (heading, owner label, parent crumbs).

## Versioning (why a form "publishes")

A form has versions: DRAFT, PUBLISHED, RETIRED. Only a draft can be edited; publishing validates the definition and freezes the version (database triggers enforce it). A task, step or asset keeps the version it was created with; saved values live in `FormValueSet`. Backend: `FormAdminService`, `FormValueStore`, `FormIndexService` in the Configuration module. Details: [Table Reference](../Database/Table-Reference.md) (Forms and custom fields) and `contracts/form-rules.md`.

## Changing the rules contract

1. Edit `contracts/form-rules.schema.json` and `contracts/form-rules.md`.
2. Add or change vectors in `contracts/form-rules.vectors.json` (decide the intended behaviour first; review diffs by hand) and message keys in `form-rules.messages.json`.
3. Run `node contracts/validate-contracts.mjs`.
4. Update both implementations: `backend/src/Modules/MatterFlow.Configuration/Domain/Forms/Rules` (the .NET evaluator, `FormEvaluator`) and `frontend/projects/form-engine/src/lib/rules`. Both suites load the same vector file.

## Related pages

- [Frontend Architecture](../Architecture/Frontend-Architecture.md)
- [API Contracts](../Architecture/API-Contracts.md)
- [Add a Task Type or Workflow](../How-To/Add-a-Task-Type-or-Workflow.md)

Last verified against commit 2e446f8.
