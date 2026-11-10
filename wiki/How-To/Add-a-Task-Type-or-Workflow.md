# Add a Task Type or Workflow

[[_TOC_]]

**What this page is for.** How task types, workflows, steps and request forms are configured. This is mostly **configuration through the app**, not code; a developer needs to know the model, the order of work, and where the starter configuration lives.

## The model

::: mermaid
flowchart LR
  STEP["Step (library: StepDefinition)"] -->|"copied into"| WV["Workflow version (WorkflowVersionStep)"]
  WD["Workflow (WorkflowDefinition)"] --> WV
  TT["Task type (TaskType)"] -->|"eligible workflows, default"| WD
  TT -->|"request form"| FD["Form (FormDefinition and versions)"]
  STEP -->|"input form"| FD
  TASK["Task"] -->|"has a task type, a form version"| TT
  TASK -->|"pins one version"| WI["Workflow instance and step instances"]
  WV --> WI
:::

- A **Step** is a reusable library item (title, instructions, documentation link, tags, optional input form).
- A **Workflow** has versions; a version is DRAFT, PUBLISHED or RETIRED. Publishing validates and freezes it. A task pins the version that was published when it was created.
- A **Task type** has a name, icon, colour key, optional target days, a request form, a default workflow and a list of eligible workflows.
- A **form** has versions too; publishing freezes the fields.
- Tasks keep their original versions even when new versions are published.

## Order of work in the app (Administration)

1. **Steps** (Task Types > Workflow Steps): create the steps; optionally design each step's input form.
2. **Workflows** (Task Types > Workflows): create a workflow, edit the draft version (add steps in order, mark skippable, require a skip comment, ordered or unordered), publish. Publishing shows a diff against the previous version.
3. **Task types** (Task Types): create the type, choose icon and colour, set target days if the At risk rule should apply, design the request form (the form designer page), mark eligible workflows and the default.
4. Create a test task of the new type from Create Task and run its workflow.

Permissions: `TaskType.Manage` for types and request forms, `Workflow.Manage` for steps and workflows. Screens and routes: [Routing and Navigation](../Frontend/Routing-and-Navigation.md) (admin section).

## Starter configuration (first deployment)

- `docs/sme/seed-configuration.md` and `docs/sme/seed-configuration.json` hold the SME's proposal: 15 task types, 10 step definitions, 8 workflows, 7 asset types and 9 roles plus System Admin, with the workflow map.
- The JSON is embedded in the API (`backend/src/LptHub.Api/LptHub.Api.csproj`) and applied by `StarterConfigurationSeeder` (`backend/src/LptHub.Api/Seeding`) when `Seed:StarterConfiguration:Enabled` is true (default on in Development, off elsewhere). It is idempotent and never overwrites admin edits; `DryRun` only logs. To add a new starter task type for fresh installs, edit the JSON (the record types that read it are in `StarterSeedData.cs`) and check the test `IntegrationTests/Tasks/TaskStarterConfigurationTests`.

## Developer notes

- Backend: `TaskTypeService`, `FormAdminService` (Configuration), `WorkflowAdminService`, `StepDefinitionService`, `WorkflowPublishValidator` (WorkflowEngine). Immutability of published versions is enforced by SQL triggers ([Views and Procedures](../Database/Views-and-Procedures.md)).
- New control types or rule operators need the contract change process in [Forms and Form Engine](../Frontend/Forms-and-Form-Engine.md) (schema, vectors, both implementations).
- Task type colours come from the fixed palette of ten (`contracts/task-type-colours.json`); icons from the library (`contracts/task-type-icons.json`, `tools/icons`). Never store a hex value.
- Tests: `IntegrationTests/Workflows`, `IntegrationTests/Forms`, e2e `ty*` and `workflow-*` specs.

## Related pages

- [Forms and Form Engine](../Frontend/Forms-and-Form-Engine.md)
- [Feature Map](../Features/Feature-Map.md)
- [Glossary](../Reference/Glossary.md)

Last verified against commit 5336251.
