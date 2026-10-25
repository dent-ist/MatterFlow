# Task Types page: Task Types, Workflows and Workflow Steps in one place (product-owner request)

The separate "Task Types & Forms" and "Workflows" screens are now **one page with three tabs**, in the order of the mental model: **Task Type -> eligible Workflows (one default) -> Steps (the shared library)**. Screenshots are `<screen>-<width>x<height>.png` at 1366x768 and 375x812, taken against a throwaway stack with a few task types, workflows and a shared step (the run is `frontend/e2e/tests/task-types-tabs-screens.spec.ts`, see the end of this note).

## What changed

- **Menu.** One Administration item, **Task Types** (icon `pi-file-edit`). The separate "Workflows" item and the name "Task Types & Forms" are gone. The menu is Users, Pods, Task Types, Labels, Assets, Custom Fields, Audit Logs (Pods is still a menu item on this branch; moving it under Users is another change). The item is shown to a person who holds `TaskType.Manage` or `Workflow.Manage`, and is highlighted on every page of the section (all three tabs, the create/edit pages, the form designer pages).
- **Tabs** (`mf-tabs`, route-based like Users/Roles, one component that stays alive when the tab changes; keyboard Left/Right/Home/End):
  | Tab | Address | Permission | Document title | Breadcrumb |
  |---|---|---|---|---|
  | Task Types | `/admin/task-types` | `TaskType.Manage` | Task Types | Administration > Task Types |
  | Workflows | `/admin/workflows` | `Workflow.Manage` | Task Types: Workflows | Administration > Task Types > Workflows |
  | Workflow Steps | `/admin/steps` | `Workflow.Manage` | Task Types: Workflow Steps | Administration > Task Types > Workflow Steps |
- **Only permitted tabs show.** A person with only `Workflow.Manage` sees Workflows and Workflow Steps and lands on Workflows (also from `/admin/task-types`); a person with only `TaskType.Manage` sees one tab. Without either permission every address is the 403 page (route guard, either permission).
- **Every existing URL is kept, nothing redirects.** `/admin/task-types/new`, `/admin/task-types/:id`, `/admin/task-types/:id/form`, `/admin/workflows/new`, `/admin/workflows/:id[/versions/:v]`, `/admin/steps/new`, `/admin/steps/:id[/form]` keep their pages; their breadcrumbs read `Administration > Task Types > <Workflows | Workflow Steps> > <record>` (task type pages: `Administration > Task Types > <task type> [> Form]`).
- **One icon rule.** The page header icon is the icon of the menu item (`pi-file-edit`) on all three tabs and on every page below them (`section-icons.ts`: the nav item lists `/admin/workflows` and `/admin/steps` as `alsoActive`, so the longest-prefix rule gives them the same icon; `route-icons.spec.ts` covers the tabs and the record pages).

## Cross-links that make the model visible

| Where | What | Screenshot |
|---|---|---|
| Task Types tab, **Workflows** column | The eligible workflows as small chips that open the workflow (`/admin/workflows/:id`). The default workflow is first, with a star and the text "default". Up to three chips, then **+n more**; a **Workflows (n)** link; both open the Workflows tab filtered to the task type (`/admin/workflows?taskType=<id>`). A type without workflows says **No workflow** in warning colour (muted for a deactivated type). The old "Eligible workflows" count and "Default workflow" columns are replaced by this column. | `tab-1-task-types-*` |
| Workflows tab, **Task types** column | The task types a workflow is eligible for, as chips that open the task type (`/admin/task-types/:id`), the ones it is the default of starred and marked "default"; **+n more** opens the Task Types tab filtered to the workflow (`/admin/task-types?workflow=<id>`). "No task type" when none. The Latest published column keeps the steps count ("v1 (2 steps)"). | `tab-2-workflows-*` |
| Workflow Steps tab, **Used in** column | "Used in 3 workflows" (distinct workflows with a version that contains the step, any status) opens the Workflows tab filtered by the step (`/admin/workflows?step=<id>`); "Not used" (muted, no link) at 0. The column sorts. | `tab-3-workflow-steps-*` |
| Filtered Workflows tab | `?taskType=<id>` and `?step=<id>`: the line "Filtered by task type X: 5 workflows" and a removable chip "Task type: X" (remove button "Remove filter Task type: X"), built on the shared column-filter foundation (`ListFilters` with a no-control filter, `mf-filter-chips`), so the address is the state and removing the chip clears the parameter. Clear filters in the empty state clears it too. | `workflows-filtered-by-task-type-*`, `workflows-filtered-by-step-*` |
| Filtered Task Types tab | `?workflow=<id>`: "Filtered by workflow X: 2 task types" and the chip "Workflow: X". | `task-types-filtered-by-workflow-*` |

A person without `Workflow.Manage` (Task Types tab only) sees the workflow chips as plain text, not links, and the workflow names fall back to "Workflow 7" if the workflow list cannot be read; a person without `TaskType.Manage` sees the task type chips on the Workflows tab as plain text.

## Backend

- `GET /api/v1/workflows` rows gain `taskTypes[]` (`taskTypeId`, `name`, `isActive`, `isDefault`) from ONE grouped call per page to the Configuration contract `ITaskTypeCatalog.ListWorkflowLinksAsync` (no N+1; WorkflowEngine still references only `Configuration.Contracts`). New filters `taskTypeId` (the task type's eligible workflows) and `stepId` (workflows with a version, any status, that contains the library step; an EXISTS answered by `IX_WVS_Source`).
- `GET /api/v1/task-types?workflowId=` limits the list to the types for which the workflow is eligible (still `Task.View`; the page itself is for `TaskType.Manage`).
- `GET /api/v1/step-definitions` rows gain `usedInWorkflows` (distinct workflows) next to `usedInVersions`; new sort `usedInWorkflows` / `-usedInWorkflows`.
- Permissions are as before: `Workflow.Manage` for the workflow and step lists, `Task.View` for the task type list. No schema change, no new script.
- OpenAPI (`contracts/openapi/v1.json`) and the TypeScript client are regenerated. Integration tests: `TaskTypeWorkflowAssociationsTests` (associations, default marker, inactive flag, both filters and their combinations with paging, sort and search, distinct counts, sort by usage, permissions).

## Accessibility

axe-core 4.10 (all rules, default tags) reports no violation on any of the twelve screenshot pages (both sizes, including the filtered tabs). Chip links are 24 px tall (WCAG 2.2 target size), the list of chips is labelled ("Workflows of <task type>", "Task types of <workflow>"), "+n more" has the name "Show all n workflows (n more)", the filter line is a polite live region and the remove button is "Remove filter Task type: X".

## Re-running the screenshots

```
E2E_SCREENSHOTS=$PWD/docs/ux/task-types-tabs E2E_AXE=/path/to/axe.min.js \
  frontend/e2e/run-local.sh -g "task types tabs screenshots"
```

Without `E2E_SCREENSHOTS` the spec is skipped; with `E2E_AXE` every screen is also checked with axe and the run fails on a violation.
