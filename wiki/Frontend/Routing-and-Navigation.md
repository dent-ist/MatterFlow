# Routing and Navigation

[[_TOC_]]

**What this page is for.** The complete route table: address, feature folder, page component and the permission that guards it, plus the navigation menus. Use it to go from a URL you see in the browser to the code. Source: `frontend/src/app/app.routes.ts` and each `features/*/*.routes.ts`, `shared/layout/nav-items.ts`.

## How routing works

- `app.routes.ts` has two routes outside the shell (`/access-pending`, `/error`) and one shell route (`AppShell`) behind `accessGuard`. Every feature is lazy-loaded with `loadChildren`.
- Guards use `canActivate`. `permissionGuard(...)` passes when the person holds **any** listed permission; `permissionAllGuard(...)` needs **all**. A refused person lands on `/403`. Forms use `canDeactivate: [unsavedChangesGuard]`.
- Page titles come from the `title` of each route through `MfTitleStrategy` (`core/title/page-title.ts`); tab names are appended with `pageTab('Users', 'Roles')`.
- Tabs of a page are usually a query parameter (`?tab=`); the address wins over remembered state.
- A route can carry `data: { hidesGlobalCreateTask: true }` (`HIDES_GLOBAL_CREATE_TASK` in `shared/layout/app-shell.ts`): the shell then hides its own create-task button, because the page has its own "New Task" prefilled for the record. Set on My Work, Task Queue, Pod Work (#1167) and on the Matter and Project record routes.

## Top-level routes

| Route | Feature folder | Page component | Guard (permission) |
|---|---|---|---|
| `/access-pending` | `features/access-pending` | `AccessPendingPage` | `pendingOnlyGuard` (only Access Pending people) |
| `/error` | `features/system/pages` | `ErrorPage` | none |
| `/` | (redirect) | `landingGuard` sends to the landing page | `accessGuard` |
| `/dashboard` | `features/dashboard` | `DashboardPage`; tabs `?tab=summary`, `breakdowns`, `trends`, `swimlane`, `users` (`?view=coverage`), `calendar` | `Dashboard.View`, and one tab permission per tab |
| `/my-matters` | `features/my-matters` | `MyMattersPage` (`ui/shell.ts`); tabs `overview`, `calendar`, `assets`, `metrics`, `activity` | all of `Matter.BeManager`, `Matter.View`, `Task.View` |
| `/my-work` | `features/my-work` | `MyWorkPage` | `Task.View` |
| `/tasks` | `features/tasks` routes, page from `features/task-queue` | `TaskQueuePage` | `Task.View` |
| `/tasks/new` | `features/tasks/create` | `CreateTaskPage` | `Task.Create` |
| `/tasks/:id` | `features/tasks/detail` | `TaskDetailPage` | `Task.View` |
| `/pods/work` | `features/pod-work` | `PodWorkPage` | all of `Pod.View`, `Task.View` |
| `/clients` | `features/clients` | `ClientsListPage` | `Client.View` |
| `/clients/new` | | `ClientFormPage` | `Client.Create` |
| `/clients/:clientId/edit` | | `ClientFormPage` | `Client.Edit` or `Client.EditNumber` |
| `/clients/:clientId` | | `ClientDetailPage` | `Client.View` |
| `/matters` | `features/matters` | `MattersListPage` | `Matter.View` |
| `/matters/new` | | redirects to `/matters?newMatter=1` (create dialog on the list; optional `newClient`) | `Matter.View` |
| `/matters/:matterId/edit` | | `MatterFormPage` | `Matter.Edit` or `Matter.EditNumber` |
| `/matters/:matterId` | | `MatterDetailPage`; tabs `?tab=summary`, `tasks`, `projects`, `assets`, `productions`, `notes`, `activities` | `Matter.View`; each tab has its own permission (`Project.View`, `Asset.View`, `Production.View`, `MatterNote.View`, `Audit.View`) |
| `/projects` | `features/projects` | `ProjectsListPage` | `Project.View` |
| `/projects/new` | | `ProjectFormPage` | `Project.Create` |
| `/projects/:projectId/edit` | | `ProjectFormPage` | `Project.Edit` |
| `/projects/:projectId` | | `ProjectDetailPage` | `Project.View` |
| `/assets` | `features/assets` | `AssetsListPage` (`?selected=<id>` redirects to the record) | `Asset.View` |
| `/assets/reports` | | `AssetReportsPage` | `Asset.View` |
| `/assets/new` | | `AssetFormPage` | `Asset.Create` |
| `/assets/:assetId/edit` | | `AssetFormPage` | `Asset.Edit` |
| `/assets/:assetId` | | `AssetRecordPage` | `Asset.View` |
| `/reports` | `features/reports` | `ReportsListPage` (`?q=` search, `?category=` filter) | `Report.Run` |
| `/reports/:reportId` | | `ReportRunPage`; the parameter values travel as `?NAME=value` (a date range as `NAME.from` and `NAME.to`, a list repeats the name); opening such an address fills the form and never runs the report | `Report.Run` (the server decides whether the report is assigned; unknown, inactive and unassigned look the same) |
| `/profile` | `features/profile` | `ProfilePage` | `Task.View` |
| `/notifications` | `features/notifications` | `NotificationsPage` | `Task.View` |
| `/search` | `features/search` | `SearchResultsPage` | any one of `Matter.View`, `Client.View`, `Task.View`, `Project.View`, `Asset.View` |
| `/search/advanced` | | redirect to `/search` with the filters panel open | |
| `/403`, `/404`, `**` | `features/system/pages` | `ForbiddenPage`, `NotFoundPage` | none |

## Administration routes (`/admin/...`, `features/admin`)

The `/admin` route is open to anyone who may open any admin menu item (`ADMIN_NAV_ITEMS`); each child has its own guard. `/admin` redirects to `/admin/users`.

| Route | Folder under `features/admin` | Page | Permission (any of) |
|---|---|---|---|
| `/admin/users`, `/admin/roles`, `/admin/pods` (three tabs of one page) | `users`, `roles`, `pods` | `UsersRolesPage` | `User.View`, `User.Manage`, `Role.Manage`, `Pod.Manage`, `Pod.ManageMembers` |
| `/admin/task-types`, `/admin/workflows`, `/admin/steps` (three tabs) | `task-types`, `workflows`, `steps` | `TaskTypesAdminPage` | `TaskType.Manage` or `Workflow.Manage` |
| `/admin/task-types/new`, `/:id`, `/:ownerId/form` | `task-types` | task type edit and request form designer | `TaskType.Manage` |
| `/admin/steps/new`, `/:stepId`, `/:ownerId/form` | `steps` | `StepEditPage`, step form designer | `Workflow.Manage` |
| `/admin/workflows/new`, `/:workflowId`, `/:workflowId/versions/:versionId` | `workflows` | `WorkflowEditPage`, version page | `Workflow.Manage` |
| `/admin/asset-types` (`?tab=link-roles` for link roles; `/admin/asset-link-roles` redirects there) | `asset-types`, `asset-link-roles` | `AssetAdminPage` | `AssetType.Manage` |
| `/admin/asset-types/new`, `/:id`, `/:ownerId/form` | `asset-types` | `AssetTypeRecordPage`, form designer | `AssetType.Manage` |
| `/admin/custom-fields`, `/:ownerId/form` | `custom-fields` | `CustomFieldsPage`, designer | `CustomField.Manage` |
| `/admin/priorities`, `/status-labels`, `/on-hold-reasons`, `/note-tags` (tabs of Labels) | `priorities`, `status-labels`, `on-hold-reasons`, `note-tags` | `LabelsAdminPage` | per tab (`labels-tabs.ts`): Priorities `Priority.Manage`, Status Labels `StatusLabel.Manage`, On-Hold Reasons `OnHoldReason.Manage`, Note Tags `StatusLabel.Manage` (there is no separate note tag permission) |
| `/admin/reports` (`?tab=` is `categories`, `runs`, `assignments` or `health`; the page and menu item are called Report Setup) | `reports` | `ReportsAdminPage` | `Report.Manage` |
| `/admin/reports/new`, `/admin/reports/:id` | `reports` | `ReportEditorPage` | `Report.Manage` |
| `/admin/settings` (tabs Branding, Dashboard, Holidays) | `settings`, `holidays` | `SettingsPage` | `Settings.Manage` |
| `/admin/audit` | `audit` | `AuditPage` | `Audit.View` |

## Navigation menus (`shared/layout/nav-items.ts`)

Items are hidden, never disabled, without the permission. A person who lands on My Matters gets a compact menu (`compact` flags on `NAV_ITEMS`).

| Main menu item | Path | Permission rule |
|---|---|---|
| Dashboard | `/dashboard` | `Dashboard.View` and at least one Dashboard tab permission |
| My Matters | `/my-matters` | `Matter.BeManager` (all three of `Matter.BeManager`, `Matter.View`, `Task.View`) |
| My Work | `/my-work` | `Task.View` |
| Clients | `/clients` | `Client.View` |
| Matters | `/matters` | `Matter.View` |
| Projects | `/projects` | `Project.View` |
| Assets | `/assets` | `Asset.View` |
| Pod Work | `/pods/work` | `Pod.View` and `Task.View` |
| Task Queue | `/tasks` | `Task.View` |
| Reports | `/reports` | `Report.Run` (shown also when nothing is assigned; the page explains it; it is not hidden in the compact menu of the Project Manager) |

Administration menu (`ADMIN_NAV_ITEMS`): Users, Task Types, Labels, Asset Types, Custom Fields, Report Setup, Audit Logs, Settings (each with the permissions listed above).

Keyboard shortcuts are defined in `shared/layout/shortcut-registry.ts`; no new or changed shortcuts are allowed in the current phase (issue #420).

## Related pages

- [How to Add a Page](How-to-Add-a-Page.md)
- [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md)
- [Feature Map](../Features/Feature-Map.md)

Last verified against commit a8142a1.
