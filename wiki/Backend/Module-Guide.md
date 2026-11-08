# Module Guide

[[_TOC_]]

**What this page is for.** One section per backend module (all 14 projects under `backend/src/Modules/`): what it is for, which tables it owns, its controllers and routes, its main services, the permissions its code uses, where its tests are and where its screens are. Use it to find where a feature lives. Dependencies between modules are on [Backend Modules](../Architecture/Backend-Modules.md); tables in [Table Reference](../Database/Table-Reference.md).

Conventions common to all modules:

- Project `MatterFlow.<Module>` has `Domain/` (entities and pure rules, no EF), `Application/` (services, DTOs, validation), `Infrastructure/` (EF configurations, queries), `Api/` (controllers). `MatterFlow.<Module>.Contracts` is the public surface for other modules.
- Each module registers itself in `<Module>Module.cs` (`Add<Module>Module`), listed in `backend/src/MatterFlow.Api/ModuleComposition.cs`. Controllers are found through `AddApplicationPart`.
- Unit tests are in `backend/tests/MatterFlow.UnitTests/<Module>/`; HTTP tests in `backend/tests/MatterFlow.IntegrationTests/<Area>/`; schema tests in `backend/tests/MatterFlow.SchemaTests`.
- The permission list per module is what the module's source references (`Permissions.X.Y`); the meaning of each code is in [Permission Catalogue](../Reference/Permission-Catalogue.md).

## Identity

- **Purpose:** users, roles, permissions, pods, availability and Out of office, holiday calendars, saved screen state, the Dev and Windows authentication handlers, permission policies, the Sensitive matter rule implementation.
- **Tables:** `AppUser`, `UserIdentity`, `Role`, `Permission`, `RolePermission`, `UserRole`, `Pod`, `PodMember`, `UserView`, `UserAvailability`, `UserWorkHour`, `UserAbsence`, `HolidayCalendar`, `Holiday`, `SeedMarker`.
- **Controllers:** `/api/v1/me` (`MeController`), `/me/availability`, `/me/views`, `/me/landing-page`, `/me/landing-pages`, `/roles/{id}/landing-page` (`LandingPagesController`), `/users` (`UsersController`), `/users/lookup`, `/users/matter-managers`, `/users/{id}/availability`, `/users/{id}/absences`, `/users/{id}/holiday-calendar`, `/roles` and `/permissions` (`RolesController`, base `/api/v1`), `/pods`, `/admin/holiday-calendars`, `/admin/settings/holidays`.
- **Key services:** `UserResolver` (just-in-time provisioning), `UserAdministration`, `RoleAdministration`, `PodService`, `UserAvailabilityService`, `AbsenceService`, `HolidayCalendarService`, `MatterVisibility` and `ManagedMatterScope` (Access/), `LoadBalancedAssigneeRanker`, `CurrentUser`.
- **Seeding:** `Seeding/IdentitySeeder.cs`, `PermissionCatalog.cs`, `StarterRoles.cs`.
- **Contracts:** `Permissions.cs`, `IUserDirectory`, `IPodDirectory`, `IUserAvailabilityReader`, `ICalendarAccess`, `IAssigneeRanker`, `IMatterManagerEligibility`, `IFirmHolidayCalendar`, `IUserWorkSource`.
- **Frontend:** `features/admin/users`, `roles`, `pods`, `holidays`; `features/profile`; `features/access-pending`; `core/auth`, `core/identity-admin`.
- **Tests:** `IntegrationTests/Identity`, `IntegrationTests/Seeding`, `UnitTests/Identity`.

## Audit

- **Purpose:** the audit trail and its browser.
- **Tables:** `AuditEvent`, `AuditEventGuard`.
- **Controllers:** `/api/v1/audit` (`AuditEventsController`: events; `AuditSearchController`: search, facets).
- **Key services:** `AuditSearchService`, `AuditSummaryComposer`, `AuditVisibility`, `AuditReader`, `AuditEntryBuffer` (queued explicit entries); the interceptor itself is in `MatterFlow.Data`.
- **Contracts:** `IAuditWriter`, `IAuditReader`, `IAuditDisplayLookup`.
- **Permission:** `Audit.View` for the browser.
- **Frontend:** `features/admin/audit`; task Activity drawer (`shared/ui/activity-drawer.ts`, `entity-activity.ts`).
- **Tests:** `IntegrationTests/Audit`, `ArchitectureTests/AuditScopeRulesTests`.

## Configuration

- **Purpose:** admin-managed configuration: priorities, status labels, task types, asset link roles, on-hold reasons, forms and custom fields (the engine), application settings and branding.
- **Tables:** `Priority`, `TaskStatusLabel`, `TaskType`, `TaskTypeWorkflowEligibility`, `AssetLinkRole`, `OnHoldReason`, `FormDefinition`, `FormVersion`, `FormField`, `FormFieldOption`, `FormValueSet`, `CustomFieldIndex`, `AppSetting`.
- **Controllers:** `/priorities`, `/status-labels`, `/task-types`, `/asset-link-roles`, `/on-hold-reasons`, `/forms`, `/branding` (anonymous read), `/admin/settings/branding`, `/admin/settings/dashboard`, `/admin/settings/calendar`.
- **Key services:** `PriorityService`, `StatusLabelService`, `TaskTypeService`, `OnHoldReasonService`, `AssetLinkRoleService`, `FormAdminService`, `FormValueStore`, `FormIndexService`, `AppSettingsService`, `BrandingService`, `DashboardSettingsService`, `CalendarSettingsService`, `ConfigurationSeeder`. Domain: the rule evaluator and validator (`FormEvaluator`, `FormValidation`, `FormSchema*`), `SettingDefinitions`.
- **Contracts:** catalogs (`IPriorityCatalog`, `ITaskTypeCatalog`, ...), `IConfigurationNameDirectory`, form validator interfaces under `Contracts/Forms`, `DashboardGaugeSettings`, `CalendarSettings`, task type colours and icons.
- **Permissions:** `Priority.Manage`, `StatusLabel.Manage`, `TaskType.Manage`, `OnHoldReason.Manage`, `AssetType.Manage`, `CustomField.Manage`, `Settings.Manage`, plus `Task.View` for lookups.
- **Frontend:** `features/admin/task-types`, `priorities`, `status-labels`, `on-hold-reasons`, `asset-link-roles`, `custom-fields`, `settings`; the shared engine is `frontend/projects/form-engine`.
- **Tests:** `IntegrationTests/Configuration`, `Forms`, `Settings`; `UnitTests/Configuration`; contract vectors `contracts/form-rules.vectors.json`.
- **Related:** the startup starter configuration is seeded by the host (`MatterFlow.Api/Seeding`).

## Organization

- **Purpose:** clients, matters, projects and matter calendar events.
- **Tables:** `Client`, `Matter`, `Project`, `MatterEvent`.
- **Controllers:** `/clients`, `/matters`, `/projects` (`OrganizationControllers.cs`), `/matter-event-types`, `/matters/{id}/events`, `/matter-events/{id}` (`MatterEventControllers.cs`).
- **Key services:** `ClientService`, `MatterService`, `ProjectService`, `MatterEventService`, `CustomFieldValues`, `MatterAccessSource` (feeds the visibility rule), `MatterObjectVisibility`.
- **Contracts:** `OrganizationContracts.cs` (matter and project lookups, `BusinessNumber` helpers).
- **Permissions:** `Client.*`, `Matter.*` (including `Matter.AssignManagers`, `Matter.BeManager`, `Matter.EditNumber`, `Matter.SetActive`), `Project.*`.
- **Frontend:** `features/clients`, `features/matters` (list, form, detail with tabs), `features/projects`.
- **Tests:** `IntegrationTests/Organization`, `Visibility`; `UnitTests/Organization`.

## Assets

- **Purpose:** asset types, assets of matters, disposition, saved asset reports.
- **Tables:** `AssetType`, `Asset`, `AssetReport`, `AssetNumberCounter`.
- **Controllers:** `/asset-types` (also the numbering counters: `GET/PUT /asset-types/{id}/numbering/counters[/{matterId}]`), `/assets`, `/asset-reports` (`AssetControllers.cs`; running reports is in WorkViews).
- **Key services:** `AssetService`, `AssetTypeService`, `AssetReportService`, `AssetNumberGenerator` (takes the next Asset Number with one atomic `UPDATE ... OUTPUT` in the transaction of the asset insert), `AssetNumberingService` (the next-number admin control), `AssetNumbering` (pure pattern rules in `Domain/`), `AssetAccess` (visible assets), `AssetReferenceValidator`, `AssetDirectory`.
- **Permissions:** `Asset.View`, `Asset.Create`, `Asset.Edit`, `Asset.Link`, `Asset.Dispose`, `AssetType.Manage`.
- **Frontend:** `features/assets`, `features/admin/asset-types`, `matter-assets` and Assets tab in `features/matters`.
- **Automatic numbering (issue #1297), how to use it from other code:** an asset type with `NumberingEnabled` gives every NEW asset `AssetNumber` = the matter's CM Number + the type's pattern tail with the counter filled in (default tail `_{###}`: `90003-80008_001`; the counter restarts for each matter and widens past its width). Assets are created only through `AssetService.CreateAsync`; any new creation path must call `AssetNumberGenerator.TakeNextAsync` inside the transaction that inserts the asset. The number is a snapshot, read-only (the database trigger and the update endpoint refuse changes), never reused. An asset created before numbering was switched on gets a number only through `POST /assets/{id}/assign-number` (`AssetService.AssignNumberAsync`, same transaction and counter as a create). Rules and shared vectors: `AssetNumbering`, `contracts/asset-numbering/pattern-vectors.json`.
- **Tests:** `IntegrationTests/Assets`, `UnitTests/Assets`.

## WorkflowEngine

- **Purpose:** the step library, workflow definitions and versions, running instances and the step state machine.
- **Tables:** `StepDefinition`, `StepDefinitionTag`, `StepTag`, `WorkflowDefinition`, `WorkflowVersion`, `WorkflowVersionStep`, `WorkflowInstance`, `StepInstance`.
- **Controllers:** `/step-definitions`, `/workflows` (`WorkflowControllers.cs`). Instance actions are exposed through WorkManagement (`/tasks/{id}/workflow`).
- **Key services:** `StepDefinitionService`, `WorkflowAdminService`, `WorkflowInstanceService` (contract `IWorkflowInstantiator`), `WorkflowPublishValidator`, `TaskStepGuard`.
- **Contracts:** `WorkflowCatalog`, `WorkflowInstanceService` interfaces, `ITaskStatusGate` (implemented by WorkManagement).
- **Permissions:** `Workflow.Manage`, `TaskType.Manage` (reads), `Task.View`.
- **Frontend:** `features/admin/workflows`, `steps`; task workflow panel in `features/tasks/detail`.
- **Tests:** `IntegrationTests/Workflows`, `UnitTests/WorkflowEngine`.

## WorkManagement

- **Purpose:** tasks, their lifecycle (New, In Progress, On Hold, Completed, Cancelled), assignment, comments, asset links, activity, bulk change.
- **Tables:** `Task`, `TaskComment`, `TaskCommentRevision`, `TaskAsset`.
- **Controllers:** `/tasks` (`TasksController`), `/tasks/{id}/workflow`, `/tasks/{id}/comments`, `/tasks/{id}/assets`, `/tasks/{id}/activity`, `/matters/{id}/tasks` bulk (`MatterBulkTasksController`).
- **Key services:** `TaskService`, `TaskLifecycleService`, `TaskWorkflowService`, `TaskCommentService`, `TaskAssetService`, `TaskActivityService`, `TaskBulkService`, `TaskAccess` (the one place tasks are read through the visibility rule), `TaskPresenter`, `TaskNotifier`. Domain: `TaskLifecycle` state machine, `TaskDue`, `CommentHtml`.
- **Permissions:** `Task.View/Create/Edit/Assign/SetPriority/ChangeStatus/Complete/Cancel/Reopen/Comment`, `Workflow.Execute`, `Workflow.StepReopen`, `Asset.Link`.
- **Frontend:** `features/tasks` (create, detail), `features/task-queue`, `shared/tasks`, `shared/work-queue`.
- **Tests:** `IntegrationTests/Tasks`, `WorkManagement`; `UnitTests/WorkManagement`.

## WorkViews (query side)

- **Purpose:** read models: Task Queue, My Work, Pod Work, Dashboard (summary, breakdowns, trends, swimlane, users, coverage, capacity, calendar), My Matters, matter overview, asset data and reports, list export. Reads other modules' entities directly with `AsNoTracking()` through the visibility rule; never writes.
- **Tables:** none of its own (reads `UserMatterActivitySeen` by raw SQL).
- **Controllers:** `/task-queue`, `/exports`, `/my-work`, `/pod-work` (`TaskQueueController.cs`); `/dashboard` (`DashboardController`, `DashboardBoardController`); `/dashboard/calendar` and `/users/{id}/absences/check`; `/my-matters` (`MyMattersController`); `/matters/{id}/overview`; `/asset-reports/run` (`AssetReportRunController`).
- **Key services:** `TaskQueueService`, `DashboardService`, `DashboardTrendService`, `SwimlaneService`, `WorkloadService`, `CoverageService`, `CapacityService`, `CalendarService`, `UnassignedGauge`, `MyMatters*Service` family, `MatterOverviewService`, `AssetDataService`, `AssetReportRunService`, `VisibleTasks`, `AtRiskRules`, `TaskQueueRules`.
- **Permissions:** `Task.View`, `Dashboard.*` (View, ViewSummary, ViewUnassigned, ViewBreakdowns, ViewTrends, ViewSwimlane, ViewUsers, ViewCoverage, ViewCalendar, ViewAbsenceReasons), `Matter.BeManager`, `Matter.AssignManagers`, `Pod.View`.
- **Frontend:** `features/dashboard`, `my-work`, `pod-work`, `task-queue`, `my-matters`.
- **Tests:** `IntegrationTests/WorkViews`, `UnitTests/WorkViews`, Playwright dashboard specs.

## Search

- **Purpose:** global search and advanced search over clients, matters, projects, tasks, assets (query side).
- **Controllers:** `/api/v1/search` (`SearchController`: grouped results and `/search/{type}`).
- **Key services:** `SearchService`, `SearchQueries`, `SearchRanking`, `SearchTerm` (number-aware matching: `343`, `343-12`, `TSK-1042`).
- **Permissions:** `Client.View`, `Matter.View`, `Project.View`, `Task.View`, `Asset.View` (each type runs only with its own permission; the endpoint policy accepts any of them).
- **Frontend:** `features/search`, `shared/search` (global search box).
- **Tests:** `IntegrationTests/Search`, `UnitTests/Search`.

## Intake

- **Purpose:** parse a dropped or pasted email (`.eml`, `.msg`, text) into task fields. Nothing is stored.
- **Controllers:** `POST /api/v1/intake/parse-email` (`IntakeController`).
- **Key services:** `EmailParseService`, `EmlEmailParser`, `MsgEmailParser`, `PastedTextParser`, `HtmlToText`.
- **Permission:** `Task.Create`. Limits: `Intake:MaxEmailBytes`.
- **Frontend:** `shared/ui/email-intake.ts`, create task page. Spike: `tools/spike-outlook-dnd`, `docs/adr/outlook-dnd-spike.md`.
- **Tests:** `IntegrationTests/Intake`, `UnitTests/Intake`.

## Notifications

- **Purpose:** in-app notifications, preferences and the scheduler.
- **Tables:** `Notification`, `NotificationPreference`.
- **Controllers:** `/me/notifications`, `/me/notification-preferences` (`NotificationControllers.cs`).
- **Key services:** `NotificationService`, `NotificationPublisher`, `NotificationPreferenceService`, `NotificationScheduler` with `TaskDueJob`, `TaskStalledJob`, `NotificationRetentionJob`, `NotificationSchedulerService`.
- **Contracts:** `NotificationEventType`, `NotificationRequest`, `NotificationMessages`.
- **Permission:** `Task.View`.
- **Frontend:** `features/notifications`, `shared/layout/notification-bell.ts`.
- **Tests:** `IntegrationTests/Notifications`, `UnitTests/Notifications`, `SchemaTests/NotificationsSchemaTests`.

## Reports

- **Purpose:** admin-authored SQL reports run on a read-only login. See [Reports Module](../Architecture/Reports-Module.md).
- **Tables:** `ReportCategory`, `ReportDefinition`, `ReportVersion`, `ReportParameter`, `RoleReport`, `SavedReportView`, `ReportFavourite`, `ReportRecent`, `ReportRun`.
- **Controllers:** `/report-admin` (several controllers), `/reports` (`ReportsController`: run, rows).
- **Key services:** `ReportAuthoringService`, `ReportAdminService`, `ReportRunService`, `ReportResultStore`, `ReportChoiceService`, `ReportSchemaService`; Domain: `SqlValidator`, `SqlScanner`, `ParameterBinder`; Infrastructure: `ReportExecutor`, `ReportsStartupProbeService`.
- **Permissions:** `Report.Manage`, `Report.Assign`, `Report.Run`.
- **Frontend:** `features/admin/reports`.
- **Tests:** `IntegrationTests/Reports`, `UnitTests/Reports`, `SchemaTests/ReportsSchemaTests`.

## Productions

- **Purpose:** production specs, productions and their comments for a matter (epic #1001).
- **Tables:** `ProductionSpec`, `Production`, `ProductionComment`.
- **Controllers:** `/production-specs`, `/productions`, `/production-comments/{id}` (`ProductionControllers.cs`).
- **Key services:** `ProductionService`, `ProductionSpecService`, `ProductionAccess`, `ProductionHistory`, `ProductionSpecRules`.
- **Permissions:** `Production.View/Edit/Comment`, `ProductionSpec.View/Edit`.
- **Frontend:** `features/productions`, Productions tab of the matter detail.
- **Tests:** `IntegrationTests/Security/MatterContentApiTests`, `UnitTests/Productions`.

## Notes

- **Purpose:** rich-text matter notes, tags, templates (epic #1001).
- **Tables:** `Note`, `NoteLink`, `NoteTag`, `NoteTagLink`, `NoteTemplate`, `NoteTemplateTag`.
- **Controllers:** `/notes`, `/note-tags`, `/note-templates` (`NoteControllers.cs`).
- **Key services:** `NoteService`, `NoteTagService`, `NoteTemplateService`, `NoteAccess`, `NoteContent` (sanitises HTML with `RichHtml` and the `Note` profile).
- **Permissions:** `MatterNote.View/Edit/Delete`.
- **Frontend:** `features/notes`, Notes tab of the matter detail, Administration > Labels > Note Tags.
- **Tests:** `IntegrationTests/Security/MatterContentApiTests`, `UnitTests/Notes`.

## Loading an entity for writing under the Sensitive matter rule

Rule of thumb: **a visibility filter decides who may touch a row; it must never be the query that loads the row you are going to change.** Issue #1304: with the Sensitive matter rule on, a caller who is not "see all" got a 200 from an update but nothing was saved. The filters (`WhereMatterVisible` and its relatives on `IMatterVisibility`, `AssetAccess.OfVisibleMatters`, `NoteAccess.Visible`, `ProductionAccess.Visible`) restrict the rows with a subquery over the access rows. EF applies `AsNoTracking` to the whole statement, so if that subquery (or any part of the composed query) is no-tracking, the entity comes back untracked and `SaveChanges` has nothing to save, without any error.

- **Write path (load to change):** check the target with a separate no-tracking query, then load the entity by its key, tracked. The shape is the same everywhere: `await Visible(db.Set<T>().AsNoTracking()).AnyAsync(where, ct) ? await db.Set<T>().SingleOrDefaultAsync(where, ct) : null`. Existing helpers: `AssetService.LoadForWriteAsync`, `NoteAccess.FindTrackedAsync` and `ProductionAccess.FindTrackedAsync`, `ProjectService.LoadForWriteAsync`. Task commands use `TaskTransactions.LockTaskAsync` (visibility check, then a tracked `FromSql` load under an update lock).
- **Hidden target:** return exactly what a missing id returns (the module's `NotFound`, 404 with the same body). Never answer 403 for a hidden row.
- **Read path:** add `AsNoTracking()` on the entity set as usual; the filter may stay on the query.
- **Never** put `AsNoTracking()` in the access sources behind `IMatterVisibility` (`MatterAccessSource`, `TaskAccessSource`); they are projections and are never tracked anyway. `VisibilitySourceRulesTests` fails the build if one does, and `VisibilityFilterTrackingTests` proves an entity loaded through each helper is tracked.
- **Tests:** a hidden-target test (404) is not enough. Add a **successful** write by a non-"see all" persona with the rule on and read the value back with an administrator (see `IntegrationTests/Security/LostWrite*Tests`: Organization, Work, Content, Admin).
- **Row predicates** (`WhereMatterRowVisible`, `WhereTaskRowVisible`) filter on columns of the entity itself and do not use a subquery, so the entity stays tracked; the rule above still applies if the same query also contains `AsNoTracking()`.

## Non-module projects

| Project | What it is |
|---|---|
| `MatterFlow.SharedKernel` | Result and error types, paging, time (`IClock`), `IMatterVisibility`, audit attributes, text sanitiser `RichHtml`, availability and capacity rules |
| `MatterFlow.Data` | `MatterFlowDbContext`, interceptors, model conventions, schema runner |
| `MatterFlow.Api` | Host, middleware, error format, OpenAPI, starter seeding, `SystemController` (`/api/v1/system`) |

## Related pages

- [Feature Map](../Features/Feature-Map.md)
- [Backend Modules](../Architecture/Backend-Modules.md)
- [How to Add a Module](How-to-Add-a-Module.md)

Last verified against commit cf50a0a.
