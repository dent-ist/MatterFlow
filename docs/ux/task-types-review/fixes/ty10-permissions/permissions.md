# Permission matrix of the Task Types area (WP-TY10, #416 and #417)

Rules (decided by the PM and the owner):

1. **Each administration permission is enough to READ what it manages.** A person with only `TaskType.Manage`, `Workflow.Manage`, `AssetType.Manage` or `CustomField.Manage` uses the screens of that permission without `Task.View`. Write policies are unchanged, except one noted below.
2. **One denial rule** (`features/admin/denial.ts`): a **tab address** (`?tab=...`, and `/admin/workflows`, `/admin/steps` for the three tabs of the Task Types page) falls back to the first allowed tab; a **create / edit / version / form address** shows the 403 page.
3. **A link exists only when its target opens for that person; a control the person cannot use is absent** (or disabled with a reason where the design says so). No toast, no dead link, no refused request on a page the person may use.

## API (policies are `Perm:A|B` alternatives; every endpoint keeps a `Perm:` policy)

| Endpoint | Before | Now |
| --- | --- | --- |
| `GET /task-types`, `GET /task-types/{id}` | `Task.View` | `Task.View` or `TaskType.Manage` (`openTaskCount` is `null` without `Task.View`) |
| `GET /workflows` (list) | `Workflow.Manage` | `Workflow.Manage` or `TaskType.Manage` (names and picks the eligible workflows) |
| `GET /workflows/{id}`, `/versions/{id}` | `Workflow.Manage` / `Task.View` or `Workflow.Manage` (TY-D1) | unchanged |
| step definitions (list, get, tags) | `Workflow.Manage` | unchanged (already enough) |
| `GET /asset-types`, `GET /asset-types/{id}` | `Asset.View` | `Asset.View` or `AssetType.Manage` |
| `GET /asset-link-roles` | `Task.View` | `Task.View` or `AssetType.Manage` |
| `/forms/...` (all, reads and design) | `Task.View` (class level), then the owner kind's `*.Manage` in the service | any of `Task.View`, `TaskType.Manage`, `Workflow.Manage`, `AssetType.Manage`, `CustomField.Manage` at the controller; the service still requires the `*.Manage` of the form's owner kind to read a definition, its versions, a draft or the diff, and to design |

Integration tests: `AdminReadPermissionsApiTests` (manage-only 200; another admin permission, Task.View alone where it does not apply, and no permission: 403 `PERMISSION_DENIED`). No contract change (`contracts/openapi/v1.json` unchanged).

## What each permission opens

| Person has | Opens | Does not open (403 page by address) |
| --- | --- | --- |
| System Admin | everything below | nothing |
| `TaskType.Manage` | Task Types list and filtered view, New task type, Task type page (Overview, Workflows, Request form), request form designer; the workflow names in the Workflows tab and in the Add workflow picker | Workflows and Steps tabs (their addresses fall back to Task Types), Workflow, version and Step pages |
| `Workflow.Manage` | Workflows and Workflow Steps tabs (`/admin/task-types` falls back to Workflows), their filtered views, New / Workflow / version (all tabs) / New step / Step (Details, Inputs, Used by) pages and the step input form designer | Task Types tab, task type pages (the task type names are plain text, never links) |
| `AssetType.Manage` | Asset Types, Asset Link Roles tab, Asset Type designer | the rest |
| `CustomField.Manage` | Custom Fields list and the Client, Matter, Project designers | the rest |
| `Task.View` only, or no admin permission | nothing of the area | every address: 403 page |
| any of the above plus `Task.View` | the same screens, plus the open-task numbers and links to the Task Queue | unchanged |

## Controls

| Control | Present only with |
| --- | --- |
| Task Types tab, New task type, task type links | `TaskType.Manage` |
| Workflows and Workflow Steps tabs, New workflow, New step, workflow and step links | `Workflow.Manage` |
| Workflow-name link in a task type's Workflows tab, the "n workflows" link in the Task Types list | `Workflow.Manage` (otherwise plain text) |
| Task type links in the Workflows list and on the Workflow and version pages | `TaskType.Manage` (otherwise plain text) |
| Workflow name chip on a filtered view | the name is read with `TaskType.Manage` or `Task.View`; otherwise the id stands in and no request is made |
| Open-task numbers and Task Queue links | `Task.View` |
| Activity | `Audit.View` |
| Edit inputs on a Step | `Workflow.Manage` (route); the old "reading forms needs permission to view tasks" sentence is gone, a refused read says "You don't have permission to see the inputs of this step." |

## How it is tested

`frontend/e2e/tests/ty-permissions-matrix.spec.ts`: 12 roles (System Admin; each `*.Manage` alone and with `Task.View`; `TaskType.Manage` with `Workflow.Manage`; `Task.View` only; `Client.View`). For each role it opens every address of the area (3 tab lists, 3 filtered views, tab addresses, create / edit / version / form addresses, Asset Types, Link Roles, Custom Fields and the three designers), opens every link found in the page content, presses the header actions, and fails on a 401/403/404, an alert or toast, a "no access" notice, a link to a page the person may not open, a missing fallback or a missing 403 page. Tab stops to the first row are written to `tab-stops-<role>.json` here (recorded, not gated).

## Decisions to review

- Form **writes** needed `Task.View` only because the controller class had that policy; with the read widening a manage-only person could read the designer but not save. The class policy is the same any-of for writes (the service still requires the owner kind's `*.Manage`), so `Task.View` alone still cannot design (403). To keep the old write rule, split the class policy in `FormsController`.
- `GET /workflows` (list) and `GET /asset-link-roles` were widened beyond the three lists named in the decision, because the Task Types and Asset Types screens read them.

## Tab stops to the first row (1366 x 768, recorded, not gated)

From the top of the page to the first row link of each list: 20 for a person with only Task Types or only Workflows permissions, 36 for a System Admin (the navigation rail has more items). Files: `tab-stops-<role>.json`. Screenshots: `matrix-<role>-<size>.png`. No keyboard shortcut was added or changed.
