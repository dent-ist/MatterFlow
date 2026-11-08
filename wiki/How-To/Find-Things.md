# Find Things

[[_TOC_]]

**What this page is for.** Search recipes and naming conventions that help you locate code fast. The repository is large (about 3,000 source files outside `node_modules`), so a few exact searches beat browsing. Use `grep -rn` or your editor's search; exclude `node_modules`, `obj`, `bin`, `dist` and `api/generated` unless you want them.

## Conventions that make search work

| Thing | Convention | Example |
|---|---|---|
| Permission code | `Group.Action`, same string everywhere | `Task.Create` in `contracts/permissions.json`, `Permissions.Task.Create` (C#), `'Task.Create'` (TypeScript) |
| Policy name | `Perm:<code>` | `"Perm:" + Permissions.Task.Create` |
| API route | `api/v1/<plural-kebab>` | `Route("api/v1/task-types")` |
| Controller action name | `Name = "OperationName"` on the HTTP attribute; becomes the TypeScript method | `ListTasks`, `GetDashboard` |
| Error code | UPPER_SNAKE, constant in `ErrorCodes.cs` | `CONCURRENCY_CONFLICT` |
| Audit event type | UPPER_SNAKE constant in a module `*AuditEvents` class | `MATTER_CREATED` |
| SQL object | Prefix `PK_ FK_ UQ_ CK_ IX_ DF_ TR_`; procedures `usp_`; functions `fn` | `IX_Task_Unassigned` |
| Table | Singular PascalCase; the entity class normally has the same name | `Client`; exception: table `Task` is the entity `WorkTask` |
| Angular selector | `mf-` prefix | `mf-page-header` |
| Page file | `*-page.ts` | `matter-detail-page.ts` |
| Route file | `<area>.routes.ts` exporting `<AREA>_ROUTES` | `CLIENTS_ROUTES` |
| Spec | `x.spec.ts` beside `x.ts` | |
| E2E spec | `<package-prefix>-<topic>.spec.ts` in `frontend/e2e/tests` | `task-lifecycle.spec.ts` |
| UI text | Title Case for names and buttons, sentence case for reading text | "Task Queue" |
| Issue and epic references | `#1234` in comments and commit messages; script headers name the epic | "epic #788" |

Note: the entity of table `dbo.Task` is the C# class `WorkTask` (`backend/src/Modules/MatterFlow.WorkManagement/Domain/TaskEntities.cs`), presumably to avoid a clash with `System.Threading.Tasks.Task` (reason unverified). Search for `WorkTask` in code and for `Task` in SQL.

## Recipes

Run from the repository root.

| I want to find ... | Search |
|---|---|
| Where a screen's text is defined | `grep -rn "Task Queue" frontend/src --include=*.ts` (exact visible text, also in `shared/layout/nav-items.ts` and route `title`) |
| The component of a URL | Open [Routing and Navigation](../Frontend/Routing-and-Navigation.md) or `grep -rn "path: 'matters'" frontend/src/app` |
| Everything that uses a permission | `grep -rn "Task.Assign" backend/src frontend/src contracts db/scripts --exclude-dir=archive` |
| The controller of an endpoint | `grep -rn 'Route("api/v1/dashboard' backend/src` and `grep -rn 'Name = "GetDashboard"' backend/src` |
| Callers of an API method in the frontend | `grep -rn "GetDashboard" frontend/src/app --include=*.ts` (skip `api/generated`) |
| The service behind a controller | The controller's constructor parameters name it; `grep -rn "class TaskService" backend/src` |
| A table's entity and mapping | `grep -rn 'ToTable("Task")' backend/src` and the entity in the same module's `Domain/` |
| Which script created or changed a column | `grep -n "AssignedAt" db/scripts/00-baseline.sql`; the old chain is in `db/scripts/archive/` (or see [Table Reference](../Database/Table-Reference.md) "Scripts") |
| Who writes an audit event | `grep -rn "MATTER_SENSITIVITY_CHANGED" backend/src frontend/src` |
| An error code's origin | `grep -rn "SENSITIVE_NEEDS_MANAGER" backend/src frontend/src` |
| A setting key | `grep -rn "Dashboard.Gauge" backend/src frontend/src` (application setting) or `grep -rn "SensitiveMatterAccess" backend/src deploy docs` (configuration) |
| A configuration option class | `grep -rn "GetSection(\"" backend/src` |
| The test for a feature | Feature name under `backend/tests/MatterFlow.IntegrationTests/<Area>`, `frontend/e2e/tests` (list the folder and look for the word), or `*.spec.ts` beside the file |
| The decision behind a behaviour | `grep -n "keyword" docs/requirements/decisions-addendum.md docs/architecture.md`; see [Decision Index](../Reference/Decision-Index.md) |
| A design rule (D-xx) | `grep -n "D-43" docs/ux/design-guidelines.md` |
| A UI component | [Shared Components Catalogue](../Frontend/Shared-Components-Catalogue.md) or `grep -rn "selector: 'mf-" frontend/src/app/shared` |
| A DOM element in e2e or specs | Selectors are mostly roles and labels (`getByRole`); data attributes include `data-col`, `data-action`, `data-strip-item`, `data-step-id`, `data-testid` |
| Which docs mention X | `grep -rln "X" docs` and [Documentation Map](../Reference/Documentation-Map.md) |

## Git history

- `git log --oneline -S"text" -- path` finds when a string was added or removed.
- Commit messages carry issue ids (`#1234`) and the page or tab that changed ([Branching and Workflow](../Getting-Started/Branching-and-Workflow.md)): `git log --oneline --grep="Dashboard > Users"`.
- `git blame` a line in a script to find the issue; the script header names the epic and the design document.

## Related pages

- [Fix a Bug](Fix-a-Bug.md)
- [Repository Map](../Getting-Started/Repository-Map.md)
- [Glossary](../Reference/Glossary.md)

Last verified against commit 5336251.
