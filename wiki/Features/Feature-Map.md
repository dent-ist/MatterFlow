# Feature Map

[[_TOC_]]

**What this page is for.** The master lookup from a feature to everything that implements it: backend module, tables, endpoints, frontend route and folder, and the main tests. Start here when you are asked to change a feature and do not know where it lives. Names of tables link to [Table Reference](../Database/Table-Reference.md); permissions are explained in [Permission Catalogue](../Reference/Permission-Catalogue.md). Endpoint paths are relative to `/api/v1`. Frontend paths are under `frontend/src/app/features/`. E2E specs are under `frontend/e2e/tests/` (name prefixes; list the folder for the full set). Integration tests are under `backend/tests/MatterFlow.IntegrationTests/`.

## Work items

| Feature | Backend module | Tables | Endpoints | Frontend route and folder | Main tests |
|---|---|---|---|---|---|
| **Clients** | Organization | `Client` (+ custom fields in `FormValueSet`, `CustomFieldIndex`) | `/clients` (list, custom-fields, get, summary, create, update, `PUT /clients/{id}/number`) | `/clients`, `/clients/new`, `/clients/:clientId`, `/clients/:clientId/edit`; `clients/` | `Organization/`; e2e `clients-final`, `clients-keyboard`, `clients-permissions`, `wp6-client-overview` |
| **Matters** (list, form, header) | Organization | `Matter` | `/matters` (list, lookup, custom-fields, get, summary, create, update, `PUT .../number`, `PUT .../managers`, `POST .../active`), `/users/matter-managers`; `GET /matters/{id}/overview` (WorkViews) | `/matters`, `/matters/:matterId`, `/matters/:matterId/edit`; `matters/` | `Organization/`, `Visibility/`; e2e `md-matter-form`, `md-matter-header`, `pv-matters-list`, `pm-matters` |
| **Matter detail: Summary tab** (overview, managers, AI allowed, calendar events panel) | Organization, WorkViews | `Matter`, `MatterEvent` | `/matters/{id}/overview`, `/matters/{id}/events`, `/matter-events/{id}`, `/matter-event-types` | `matters/ui/matter-summary.ts`, `matter-event-panel.ts`, `matter-managers-dialog.ts`, `matter-ai.ts` | e2e `md-summary`, `matter-client-details-tab` |
| **Matter detail: Tasks tab** | WorkManagement, WorkViews | `Task` | `/task-queue?matterId=`, `/matters/{id}/tasks/bulk` | `matters/pages/matter-detail-page.ts` with `shared/work-queue/scoped-tasks`; bulk dialog `shared/work-queue/bulk-tasks-dialog.ts` | `WorkManagement/`; e2e `md-tasks-look`, `lc04-matter-task-cards`, `pm4-bulk-tasks` |
| **Matter detail: Projects tab** | Organization | `Project` | `/projects?matterId=` | `matters/pages/matter-projects.ts`, `projects/ui/project-panel.ts` | e2e `wp4-project-tabs` |
| **Matter detail: Assets tab** | Assets | `Asset` | `/assets?matterId=` | `shared/ui/matter-assets.ts` | `Assets/`; e2e `assets*` |
| **Matter detail: Productions tab** | Productions | `ProductionSpec`, `Production`, `ProductionComment` | `/production-specs`, `/productions`, `/production-comments/{id}`, `/matters/{id}/productions/summary` | `productions/productions-tab.ts` | `Security/MatterContentApiTests`; unit `Productions/` |
| **Matter detail: Notes tab** | Notes | `Note`, `NoteTag`, `NoteTagLink`, `NoteLink`, `NoteTemplate`, `NoteTemplateTag` | `/notes`, `/note-tags`, `/note-templates` | `notes/notes-tab.ts`, `note-editor.ts` | `Security/MatterContentApiTests`; e2e `md-notes-parity` |
| **Matter detail: Activities tab** | Audit | `AuditEvent` | `/audit/events`, `/audit/search` | `matters/ui/matter-activities.ts` | `Audit/`; e2e `comments-activity` |
| **Projects** | Organization | `Project` | `/projects` | `/projects`, `/projects/:projectId`, `.../edit`, `/projects/new`; `projects/` | `Organization/`; e2e `wp4-project-tabs` |
| **Assets** (list, record, form, disposition) | Assets | `Asset`, `AssetType`, `AssetNumberCounter` | `/assets` (list, counts-by-type, lookup, get, create, update, `PUT .../disposition`, `POST /assets/disposition`, `GET .../disposition-history`, `POST .../active`, `POST .../assign-number`, `GET .../linked-tasks`), `/asset-types` (incl. `PUT .../size-field`, `POST .../reindex`, and the automatic numbering: `numbering` on create and update, `GET .../numbering/counters`, `GET/PUT .../numbering/counters/{matterId}`; every asset read model carries `assetNumber`) | `/assets`, `/assets/:assetId`, `/assets/new`, `/assets/:assetId/edit`; `assets/` | `Assets/`; e2e `assets`, `assets-final`, `assets-permissions`, `pv-asset-disposition` |
| **Asset reports** (group by disposition, matter, client, asset type, Asset Number or a select field; the Asset Number group, issue #1297, lists one row per generated number, e.g. the size per Media folder) | Assets (definitions), WorkViews (run) | `AssetReport`, `CustomFieldIndex` | `/asset-reports` (list, fields, get, create, update, delete), `POST /asset-reports/run`, `GET /asset-reports/{id}/run` | `/assets/reports`; `assets/reports/` | e2e `pv-asset-report-builder` |
| **Tasks: create** (incl. from an email) | WorkManagement, Intake, Configuration | `Task`, `FormValueSet`, `WorkflowInstance`, `StepInstance` | `POST /tasks`, `POST /intake/parse-email` | `/tasks/new`; `tasks/create/`; `shared/ui/email-intake.ts` | `Tasks/TaskCreateApiTests`, `Intake/`; e2e `task-create`, `email-intake`, `create-task-sections` |
| **Tasks: detail, edit, lifecycle, assignment** | WorkManagement | `Task`, `TaskStatusLabel`, `OnHoldReason` | `GET/PUT /tasks/{id}`, `POST /tasks/{id}/assignment`, `/priority`, `/status`, `/complete`, `/cancel`, `/reopen`, `GET /tasks/{id}/completion`, `POST /tasks/assign-batch` | `/tasks/:id`; `tasks/detail/` | `Tasks/TaskLifecycleApiTests`, `TaskEditApiTests`; e2e `task-lifecycle`, `task-detail-*`, `task-permissions-t10` |
| **Task comments** | WorkManagement | `TaskComment`, `TaskCommentRevision` | `/tasks/{id}/comments` | `tasks/panels/` | `Tasks/TaskCommentsApiTests`; e2e `t7-comments-activity`, `comments-toolbar` |
| **Task assets (links)** | WorkManagement, Assets | `TaskAsset`, `AssetLinkRole` | `/tasks/{id}/assets` | `tasks/panels/` | `Tasks/TaskAssetLinksApiTests` |
| **Task activity** | WorkManagement, Audit | `AuditEvent` | `/tasks/{id}/activity` | `tasks/panels/`, `shared/ui/activity-drawer.ts` | `Tasks/TaskActivityApiTests` |
| **Workflows on a task** (steps: start, values, complete, skip, reopen) | WorkManagement, WorkflowEngine | `WorkflowInstance`, `StepInstance`, `FormValueSet` | `GET /tasks/{id}/workflow`, `POST /tasks/{id}/workflow/steps/{stepInstanceId}/start`, `/values`, `/complete`, `/skip`, `/reopen` | `tasks/detail/` workflow panel | `Workflows/`; e2e `task-workflow-steps-666`, `workflow-steps` |
| **Task Queue** | WorkViews | `Task` (read) | `/task-queue`, `/task-queue/export`, `/exports` | `/tasks`; `task-queue/pages/task-queue-page.ts`, `shared/work-queue/` | `WorkViews/`; e2e `task-queue-copy`, `task-queue-due-groups`, `wp*` list specs |
| **My Work** | WorkViews | `Task` (read) | `/my-work` | `/my-work`; `my-work/` | e2e `my-work-*` |
| **Pod Work** | WorkViews | `Task`, `Pod`, `PodMember` (read) | `/pod-work` | `/pods/work`; `pod-work/` | e2e `pw1-*` to `pw8-*` |
| **My Matters** (Project Manager home: Overview, Calendar, Assets, Metrics, Activity) | WorkViews | `Matter`, `Task`, `Asset`, `AuditEvent`, `UserMatterActivitySeen`, `UserView` | `/my-matters/*` (summary, attention, deadlines, activity, activity/seen, since-last-visit, breakdown, data, data/volume, calendar, events, feed, task-counts, tree, assets, workload) | `/my-matters`; `my-matters/` | `WorkViews/`, `Visibility/`; e2e `mm-qa`, `mm-ui-update`, `px5-matter` |
| **Search** | Search | all searched tables (read) | `/search`, `/search/{type}` | `/search`; `search/`, `shared/search/` | `Search/`; e2e `search`, `sr1-*` to `sr7-*` |
| **Notifications** | Notifications | `Notification`, `NotificationPreference` | `/me/notifications`, `/me/notification-preferences` | `/notifications`; bell in `shared/layout/notification-bell.ts` | `Notifications/`; e2e `notifications-bell` |
| **Profile and Out of Office** (also the My Landing Page card; opens for every non-pending person, the work cards need `Task.View`) | Identity | `UserAvailability`, `UserWorkHour`, `UserAbsence`, `UserIdentity`, `HolidayCalendar`, `UserView` | `/me`, `/me/availability`, `/me/landing-page`, `/me/landing-pages`, `/users/{id}/absences`, `/me/notification-preferences` | `/profile`; `profile/`, `shared/availability/` | `Identity/`; e2e `profile-*` |
| **Landing page** (role default in Role Setup, personal choice, resolution chain, list default scope) | Identity | `Role.LandingPage`, `UserView` (surface `landing-page`) | `/me/landing-page`, `/me/landing-pages`, `/roles/{id}/landing-page` | `/profile` (card), `/admin/roles` (field); `core/landing/`, `profile/landing-card.ts`, `core/auth/guards.ts` | `contracts/landing-pages.json`; e2e `landing-pages`, `landing-list-scope`, `sh-landing` |
| **Access Pending, sign-in** | Identity | `AppUser`, `UserIdentity`, `UserRole` | `GET /me` | `/access-pending`; `access-pending/` | `Identity/WalkingSkeletonTests`; e2e `sh-landing` |

## Dashboard

| Tab | Backend (`WorkViews`) | Tables | Endpoints | Frontend | Tests |
|---|---|---|---|---|---|
| Summary (cards, capacity battery, unassigned gauge, task grid) | `DashboardService`, `CapacityService`, `UnassignedGauge` | `Task`, `Pod`, `PodMember`, `UserAvailability`, `AppSetting` | `/dashboard`, `/dashboard/scopes`, `/dashboard/capacity`, `/dashboard/capacity/people` | `dashboard/summary/` | e2e `dashboard-v4-summary`, `dashboard-scope`, `dashboard-period` |
| Breakdowns | `DashboardService` | `Task` | `/dashboard` | `dashboard/ui/dash-breakdowns-tab.ts` | e2e `dashboard-breakdowns` |
| Trends | `DashboardTrendService` | `Task` | `/dashboard/trend` | `dashboard/ui/dash-trends-tab.ts` | e2e `dashboard-trends-types` |
| Swimlane | `SwimlaneService` | `Task`, `UserAvailability` | `/dashboard/swimlane` | `dashboard/swimlane/` | e2e `swimlane*` |
| Users (Workload, Skills, History, Coverage) | `WorkloadService`, `SkillsMatrix`, `UserHistory`, `CoverageService` | `Task`, `UserAvailability`, `UserAbsence` | `/dashboard/workload`, `/dashboard/users/skills`, `/dashboard/users/{id}/history`, `/dashboard/coverage` | `dashboard/users/` | e2e `users-*`, `coverage-by-type` |
| Calendar | `CalendarService` | `UserAbsence`, `Holiday`, `HolidayCalendar`, `Pod`, `AppSetting` | `/dashboard/calendar/days`, `/day`, `/summary`, `/users/{id}/absences/check` | `dashboard/calendar/` | e2e `calendar` |

## Administration

| Page (menu) | Backend module | Tables | Endpoints | Frontend route and folder | Permission | Tests |
|---|---|---|---|---|---|---|
| Users | Identity | `AppUser`, `UserIdentity`, `UserRole`, `PodMember` | `/users` (list, counts, get, put, `PUT /users/{id}/roles`, `PUT /users/{id}/status`), `GET/PUT /users/{id}/pods` (PodsController), `/users/lookup` | `/admin/users`; `admin/users/` | `User.View`, `User.Manage` | `Identity/`; e2e `users-*` |
| Roles (incl. the Landing Page field) | Identity | `Role`, `RolePermission`, `Permission` | `/roles`, `/permissions`, `/roles/{id}/landing-page` | `/admin/roles`; `admin/roles/` | `Role.Manage` | e2e `users-us6-editors` |
| Pods | Identity | `Pod`, `PodMember` | `/pods` (list, get, create, update, members, primary, `member-candidates`) | `/admin/pods`; `admin/pods/` | `Pod.Manage`, `Pod.ManageMembers` | e2e `users-pods` |
| Task Types | Configuration | `TaskType`, `TaskTypeWorkflowEligibility`, `FormDefinition`, `FormVersion`, `FormField` | `/task-types`, `/forms` | `/admin/task-types`; `admin/task-types/` | `TaskType.Manage` | e2e `ty*` |
| Workflows | WorkflowEngine | `WorkflowDefinition`, `WorkflowVersion`, `WorkflowVersionStep` | `/workflows` | `/admin/workflows`; `admin/workflows/` | `Workflow.Manage` | `Workflows/`; e2e `workflow-version`, `ty5-workflow`, `ty6-*` |
| Workflow Steps | WorkflowEngine | `StepDefinition`, `StepDefinitionTag`, `StepTag` | `/step-definitions` | `/admin/steps`; `admin/steps/` | `Workflow.Manage` | e2e `ty7-step`, `workflow-tabs-tags-screens` |
| Lists: Priorities (Task) | Configuration | `Priority` | `/priorities` | `/admin/lists/priorities`; `admin/priorities/` (grid), `admin/lists/` (page) | `Priority.Manage` | e2e `ad3-priorities-*`, `lists-*` |
| Lists: Status Labels (Task) | Configuration | `TaskStatusLabel` | `/status-labels` | `/admin/lists/status-labels`; `admin/status-labels/` | `StatusLabel.Manage` | e2e `ad3-status-labels` |
| Lists: On-Hold Reasons (Task) | Configuration | `OnHoldReason` | `/on-hold-reasons` | `/admin/lists/on-hold-reasons`; `admin/on-hold-reasons/` | `OnHoldReason.Manage` | `Tasks/OnHoldReasonTests`; e2e `pv-task-types-on-hold` |
| Lists: Note Tags (Notes) | Notes | `NoteTag` | `/note-tags` | `/admin/lists/note-tags`; `admin/note-tags/` | `StatusLabel.Manage` (see Routing) | |
| Lists: Matter Types, Current States, Team Titles (Matter) | Configuration | `MatterType`, `CurrentState`, `TeamTitle` | `/matter-types`, `/current-states`, `/team-titles` | `/admin/lists/matter-types` and the other two; `admin/matter-lists/` | `MatterList.Manage` | e2e `lists-*` |
| Lists: Link Roles (Assets) | Assets, Configuration | `AssetLinkRole` | `/asset-link-roles` | `/admin/lists/link-roles`; `admin/asset-link-roles/` | `AssetType.Manage` | e2e `ad5-link-roles` |
| Asset Types | Assets, Configuration | `AssetType`, `FormDefinition` | `/asset-types` | `/admin/asset-types`; `admin/asset-types/` | `AssetType.Manage` | e2e `ad4-*` |
| Custom Fields | Configuration | `FormDefinition`, `FormVersion`, `FormField` | `/forms/custom-fields` and `/forms/...` | `/admin/custom-fields`; `admin/custom-fields/` | `CustomField.Manage` | e2e `ad6-custom-fields` |
| Reports | Reports | Report tables | `/report-admin/*`, `/reports/*` | `/admin/reports`; `admin/reports/` | `Report.Manage`, `Report.Assign`, `Report.Run` | `Reports/`; e2e `rp5-reports-admin` |
| Audit Logs | Audit | `AuditEvent` | `/audit/search`, `/audit/facets`, `/audit/events` | `/admin/audit`; `admin/audit/` | `Audit.View` | `Audit/`; e2e `ad7-audit` |
| Settings: Branding | Configuration | `AppSetting` | `/admin/settings/branding`, `/branding` | `/admin/settings`; `admin/settings/` | `Settings.Manage` | `Settings/`; e2e `app-settings` |
| Settings: Dashboard | Configuration | `AppSetting` | `/admin/settings/dashboard` | `admin/settings/dashboard-settings.ts` | `Settings.Manage` | |
| Settings: Holidays | Identity, Configuration | `HolidayCalendar`, `Holiday`, `AppSetting` | `/admin/holiday-calendars`, `/admin/settings/holidays`, `/admin/settings/calendar`, `/users/{id}/holiday-calendar` | `admin/holidays/` | `Settings.Manage` (user calendar: `User.Manage`) | e2e `admin-holidays` |

## Cross-cutting features

| Feature | Where |
|---|---|
| Authentication, `/me`, landing page (role default, personal choice, chain) | [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md) |
| Sensitive matters | [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md); `Matter.IsSensitive`, `Matter.ViewSensitive` |
| Audit trail | [Notifications Audit and Settings](../Architecture/Notifications-Audit-and-Settings.md) |
| Saved views and remembered state | `Identity` `UserViewsController` (`/me/views`), `UserView`; `core/views/` |
| Application name and icon | `Configuration` branding; `core/branding/` |
| Health and readiness | `/health/live`, `/health/ready`; `SystemController` (`/system`) |

## Controller index (all 70 controllers, grouped by module)

Every controller class in `backend/src/Modules/*/Api` and `backend/src/MatterFlow.Api/Controllers`. Where a route base is shared (for example `/report-admin`, `/dashboard`, `/audit`), the actions are split across controllers by topic.

| Module | Controller | Route base |
|---|---|---|
| Api | `SystemController` | `/api/v1/system` |
| Assets | `AssetReportsController` | `/api/v1/asset-reports` |
| Assets | `AssetTypesController` | `/api/v1/asset-types` |
| Assets | `AssetsController` | `/api/v1/assets` |
| Audit | `AuditEventsController` | `/api/v1/audit` |
| Audit | `AuditSearchController` | `/api/v1/audit` |
| Configuration | `SettingsBrandingController` | `/api/v1/admin/settings/branding` |
| Configuration | `SettingsCalendarController` | `/api/v1/admin/settings/calendar` |
| Configuration | `SettingsDashboardController` | `/api/v1/admin/settings/dashboard` |
| Configuration | `AssetLinkRolesController` | `/api/v1/asset-link-roles` |
| Configuration | `BrandingController` | `/api/v1/branding` |
| Configuration | `FormsController` | `/api/v1/forms` |
| Configuration | `OnHoldReasonsController` | `/api/v1/on-hold-reasons` |
| Configuration | `PrioritiesController` | `/api/v1/priorities` |
| Configuration | `StatusLabelsController` | `/api/v1/status-labels` |
| Configuration | `TaskTypesController` | `/api/v1/task-types` |
| Identity | `RolesController` | `/api/v1` |
| Identity | `HolidayCalendarsController` | `/api/v1/admin/holiday-calendars` |
| Identity | `SettingsHolidaysController` | `/api/v1/admin/settings/holidays` |
| Identity | `MeController` | `/api/v1/me` |
| Identity | `MyAvailabilityController` | `/api/v1/me/availability` |
| Identity | `UserViewsController` | `/api/v1/me/views` |
| Identity | `PodsController` | `/api/v1/pods` |
| Identity | `UsersController` | `/api/v1/users` |
| Identity | `UsersLookupController` | `/api/v1/users/lookup` |
| Identity | `MatterManagersController` | `/api/v1/users/matter-managers` |
| Identity | `AbsencesController` | `/api/v1/users/{userId:int}/absences` |
| Identity | `UserAvailabilityController` | `/api/v1/users/{userId:int}/availability` |
| Identity | `UserHolidayCalendarController` | `/api/v1/users/{userId:int}/holiday-calendar` |
| Intake | `IntakeController` | `/api/v1/intake` |
| Notes | `NoteTagsController` | `/api/v1/note-tags` |
| Notes | `NoteTemplatesController` | `/api/v1/note-templates` |
| Notes | `NotesController` | `/api/v1/notes` |
| Notifications | `NotificationPreferencesController` | `/api/v1/me/notification-preferences` |
| Notifications | `NotificationsController` | `/api/v1/me/notifications` |
| Organization | `ClientsController` | `/api/v1/clients` |
| Organization | `MatterEventTypesController` | `/api/v1/matter-event-types` |
| Organization | `MatterEventItemController` | `/api/v1/matter-events/{eventId:int}` |
| Organization | `MattersController` | `/api/v1/matters` |
| Organization | `MatterEventsController` | `/api/v1/matters/{matterId:int}/events` |
| Organization | `ProjectsController` | `/api/v1/projects` |
| Productions | `ProductionCommentsController` | `/api/v1/production-comments/{commentId:int}` |
| Productions | `ProductionSpecsController` | `/api/v1/production-specs` |
| Productions | `ProductionsController` | `/api/v1/productions` |
| Reports | `ReportChoicesController` | `/api/v1` |
| Reports | `ReportAdminController` | `/api/v1/report-admin` |
| Reports | `ReportAssignmentController` | `/api/v1/report-admin` |
| Reports | `ReportDefinitionsController` | `/api/v1/report-admin` |
| Reports | `ReportSchemaController` | `/api/v1/report-admin/schema` |
| Reports | `ReportsController` | `/api/v1/reports` |
| Search | `SearchController` | `/api/v1/search` |
| WorkManagement | `MatterBulkTasksController` | `/api/v1/matters/{matterId:int}/tasks` |
| WorkManagement | `TasksController` | `/api/v1/tasks` |
| WorkManagement | `TaskActivityController` | `/api/v1/tasks/{taskId:long}/activity` |
| WorkManagement | `TaskAssetsController` | `/api/v1/tasks/{taskId:long}/assets` |
| WorkManagement | `TaskCommentsController` | `/api/v1/tasks/{taskId:long}/comments` |
| WorkManagement | `TaskWorkflowController` | `/api/v1/tasks/{taskId:long}/workflow` |
| WorkViews | `AssetReportRunController` | `/api/v1/asset-reports` |
| WorkViews | `DashboardBoardController` | `/api/v1/dashboard` |
| WorkViews | `DashboardController` | `/api/v1/dashboard` |
| WorkViews | `DashboardCalendarController` | `/api/v1/dashboard/calendar` |
| WorkViews | `ExportsController` | `/api/v1/exports` |
| WorkViews | `MatterOverviewController` | `/api/v1/matters/{matterId:int}/overview` |
| WorkViews | `MyMattersController` | `/api/v1/my-matters` |
| WorkViews | `MyWorkController` | `/api/v1/my-work` |
| WorkViews | `PodWorkController` | `/api/v1/pod-work` |
| WorkViews | `TaskQueueController` | `/api/v1/task-queue` |
| WorkViews | `AbsenceCheckController` | `/api/v1/users/{userId:int}/absences/check` |
| WorkflowEngine | `StepDefinitionsController` | `/api/v1/step-definitions` |
| WorkflowEngine | `WorkflowsController` | `/api/v1/workflows` |

## Related pages

- [Module Guide](../Backend/Module-Guide.md)
- [Routing and Navigation](../Frontend/Routing-and-Navigation.md)
- [Permission Catalogue](../Reference/Permission-Catalogue.md)

Last verified against commit a8f9659.
