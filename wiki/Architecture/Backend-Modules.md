# Backend Modules

[[_TOC_]]

**What this page is for.** The list of backend modules, the dependency diagram built from the real `ProjectReference` entries of the `.csproj` files, and the rules that the architecture tests enforce. Read it before you add a reference between two projects or create a new module.

## The rule in one sentence

A module (`LPT Hub.<Module>`) may reference only `LptHub.SharedKernel` and the **`.Contracts`** projects of other modules. Only the two query-side modules (`WorkViews`, `Search`), `LptHub.Data` and `LptHub.Api` may reference other modules' internals. `LptHub.ArchitectureTests` (`ModuleDependencyRulesTests.cs`) reads the csproj files and fails the build otherwise.

## Modules

14 module projects and 11 Contracts projects live in `backend/src/Modules/`. Each module is organised as `Domain/`, `Application/`, `Infrastructure/`, `Api/` (Identity adds feature folders such as `Access`, `Authentication`, `Holidays`, `Pods`, `Views`).

| Module | Owns (summary) | Contracts project |
|---|---|---|
| Identity | Users, roles, permissions, pods, availability, holidays, saved views, permission policies, Dev and Windows authentication | yes (`Permissions.cs` and directory interfaces) |
| Audit | `AuditEvent`, audit browser, audit reader and writer | yes |
| Configuration | Priorities, status labels, task types, forms and custom fields, asset link roles, on-hold reasons, application settings | yes |
| Organization | Clients, matters, projects, matter calendar events | yes |
| Assets | Asset types, assets, saved asset reports | yes |
| WorkflowEngine | Step library, workflow definitions and versions, workflow and step instances | yes |
| WorkManagement | Tasks, task assets, comments, lifecycle, assignment, bulk change | yes |
| WorkViews | Task Queue, My Work, Pod Work, Dashboard, My Matters, matter overview, exports | no (leaf, query side) |
| Search | Global and advanced search | no (leaf, query side) |
| Intake | Email parsing for task creation (no storage) | no (leaf) |
| Notifications | In-app notifications, preferences, scheduler | yes |
| Reports | Report definitions, versions, runs, assignment, read-only report login | yes |
| Productions | Production specs, productions, production comments | yes (marker and label interface) |
| Notes | Matter notes, tags, templates | yes (marker and label interface) |

Per-module detail: [Module Guide](../Backend/Module-Guide.md).

## Dependency diagram

Arrows point from the referencing project to the `.Contracts` project it uses. Dotted arrows are the query-side modules, which reference whole modules (internals) and `LptHub.Data`. Every project also references `SharedKernel` (not drawn). Built from the csproj files at the commit below.

::: mermaid
flowchart LR
  ID["Identity"]
  AU["Audit"]
  CF["Configuration"]
  OR["Organization"]
  AS["Assets"]
  WF["WorkflowEngine"]
  WM["WorkManagement"]
  NF["Notifications"]
  PR["Productions"]
  NT["Notes"]
  RP["Reports"]
  IN["Intake"]
  WV["WorkViews query side"]
  SE["Search query side"]

  ID --> AU
  CF --> ID
  CF --> AU
  OR --> CF
  OR --> ID
  OR --> AU
  OR --> NF
  AS --> CF
  AS --> OR
  AS --> ID
  AS --> AU
  WF --> CF
  WF --> ID
  WF --> AU
  WM --> OR
  WM --> AS
  WM --> WF
  WM --> CF
  WM --> ID
  WM --> AU
  WM --> NF
  NF --> ID
  PR --> OR
  PR --> ID
  PR --> AU
  NT --> CF
  NT --> OR
  NT --> AS
  NT --> ID
  NT --> AU
  RP --> ID
  RP --> AU
  IN --> ID
  WV -.-> WM
  WV -.-> OR
  WV -.-> AS
  WV -.-> WF
  WV -.-> CF
  WV -.-> ID
  WV -.-> AU
  SE -.-> WM
  SE -.-> OR
  SE -.-> AS
  SE -.-> CF
  SE -.-> ID
:::

Notes read off the csproj files:

- `WorkViews` references `Audit.Contracts` only (to log `EXPORT_RUN`) and the full projects of WorkManagement, Organization, Assets, WorkflowEngine, Configuration, Identity, plus `LptHub.Data`.
- `Search` references the full projects of WorkManagement, Organization, Assets, Configuration, `Identity.Contracts` and `LptHub.Data`.
- `LptHub.Data` references every module project except the query-side ones, Intake and Reports (it needs the entity types for the DbContext and the cross-module relationships).
- `LptHub.Api` (the host) references SharedKernel, Data and all 14 modules (WorkViews, Search, Intake included).
- `WorkflowEngine` needs the task status but does not reference WorkManagement: it declares `ITaskStatusGate` in its own Contracts and WorkManagement implements it (dependency inversion).
- `Audit` cannot know user names or object labels (Identity already depends on Audit). The host supplies `IAuditDisplayLookup` (`LptHub.Api/Http/AuditDisplayLookup.cs`, registered in `ModuleComposition`).

## What the architecture tests enforce

`backend/tests/LptHub.ArchitectureTests/`:

| Test class | Rule |
|---|---|
| `ModuleDependencyRulesTests` | A module references only SharedKernel and allowed `.Contracts` (the allowed list is in the test); Contracts reference only SharedKernel; SharedKernel references no other project; no cycles; only Data, Api and the query side reference internals; Contracts have no dependency on Domain, Infrastructure or EF; Domain has no EF dependency |
| `AuthorizationRulesTests` | Every controller action has a policy or is on the anonymous or authenticated-only allow-list; business policies name permissions that exist in the catalog; no authorization on role names |
| `AuditScopeRulesTests` | An audited entity that belongs to a matter declares its audit scope as the matter; explicit audit entries carry their matter |
| `RowVersionRulesTests` | Update requests carry a required, non-nullable `rowVersion`; a rowVersion that exists is never optional |
| `VisibilitySourceRulesTests` | Direct reads of matter, task, project and asset sets and raw SQL on those tables are only in reviewed files; no EF global query filters |
| `SourceHygieneRulesTests` | Duplicate keys are not detected by message text; managed-by filters use the shared scope; only the Reports module reads the report connection string |

## Other rules (from `docs/architecture.md` section 5.2)

1. Entities have no navigation properties across modules; cross-module links are scalar ids. The foreign keys themselves exist in the SQL scripts. `docs/architecture.md` says cross-module relationships are configured in a `CrossModuleRelationships.cs` in `LptHub.Data`, but no such file exists at this commit (the DbContext applies each module's own `IEntityTypeConfiguration` classes from `ModuleAssemblies`), so treat that sentence as out of date.
2. State-changing work happens inside the owning module's application service and transaction. Modules call each other synchronously through Contracts.
3. Controllers hold no business logic: they map DTOs to commands and results to problem details.
4. No code branches on role names, only on permission codes.
5. The query side may read other modules' entities only with `AsNoTracking()` projections, may not write and may not call other modules' Application classes.

## Adding a reference or a module

- Need data from another module? Add an interface to that module's `.Contracts`, implement it in the module, and use it. Do not add a reference to the other module.
- New module: [How to Add a Module](../Backend/How-to-Add-a-Module.md). The architecture test's `AllowedContracts` table must be updated too.

## Related pages

- [Module Guide](../Backend/Module-Guide.md)
- [Request Lifecycle](Request-Lifecycle.md)
- [Testing the Backend](../Backend/Testing-the-Backend.md)

Last verified against commit ba461d2.
