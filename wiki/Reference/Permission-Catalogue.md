# Permission Catalogue

[[_TOC_]]

**What this page is for.** Every permission code of the application, what it allows, which starter roles hold it by default and where it is enforced. The source of truth is `contracts/permissions.json` (70 permissions in 13 groups); this page is built from it, from `backend/src/Modules/MatterFlow.Identity/Seeding/StarterRoles.cs` and from a search of the backend and frontend source for each code.

How to read it:

- **System Admin** is a built-in role that holds every permission implicitly (including future ones); it is not listed in the "default roles" column.
- **Default roles** are the starter roles seeded once on a new install (Director, Project Manager, Pod Lead, Data Technician, Data Scientist). Administrators can change roles; existing databases got new permissions through the scripts named in [Schema Script History](../Database/Schema-Script-History.md).
- **Backend** lists the classes whose source mentions the permission constant (controllers, services, policy classes). It is a search result, not a proof of every enforcement point: open the file to see the policy. A permission with a Sensitive or visibility effect may also be applied through `IMatterVisibility`.
- **Frontend** lists files that use the code (routes, guards, menu items, components). Specs and the permission list itself are left out.
- Policy names are `Perm:<code>`; alternatives are written `Perm:A|B` (any one is enough). See [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md).

## Client/Matter

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Client.View` | View clients | all five starter roles | `OrganizationControllers`, `SearchController`, `SearchService` | `app.routes`, `audit-links`, `guards` and 5 more |
| `Client.Create` | Create clients | Director, Project Manager, Pod Lead | `OrganizationControllers` | `clients-list-page`, `clients.routes` |
| `Client.Edit` | Edit client details | Director, Project Manager, Pod Lead | `NoteTemplateService`, `OrganizationControllers` | `client-detail-page`, `clients.routes`, `notes-tab` |
| `Client.EditNumber` | Change a client number | Director, Project Manager | `OrganizationControllers` | `client-form-page`, `clients.routes` |
| `Matter.View` | View matters | all five starter roles | `ClientService`, `MatterManagersController`, `MatterObjectVisibility`, `MatterOverviewController` and 4 more | `app.routes`, `audit-links`, `client-detail-page` and 10 more |
| `Matter.Create` | Create matters | Director, Project Manager, Pod Lead | `OrganizationControllers` | `client-detail-page`, `client-matters`, `client-overview` and 1 more |
| `Matter.Edit` | Edit matter details | Director, Project Manager, Pod Lead | `MatterEventService`, `OrganizationControllers` | `calendar-tab`, `matter-detail-page`, `matters.routes` and 1 more |
| `Matter.EditNumber` | Change a matter number | Director, Project Manager | `OrganizationControllers` | `matter-form-dialog`, `matter-form-page`, `matters.routes` |
| `Matter.SetActive` | Activate or deactivate matters | Director, Project Manager | `OrganizationControllers` | `matter-detail-page` |
| `Matter.BeManager` | Can be named as a matter's project manager (Primary or Secondary). A marker: it opens no screen by itself | Project Manager | `ClientService`, `MatterManagerEligibility`, `MyMattersController`, `SearchService` | `app.routes`, `calendar-tab`, `clients-list-page` and 8 more |
| `Matter.AssignManagers` | Set or clear the Primary and Secondary project manager of matters, and search all matters on My Matters | Director, Project Manager | `ManagedMatterScope`, `MatterService`, `MyMattersController`, `OrganizationControllers` | `matter-detail-page`, `matters-list-page`, `metrics-tab` and 2 more |
| `Matter.ViewSensitive` | See all sensitive matters (every sensitive matter, with all its tasks and assets, regardless of manager or assignment). Grants access to every sensitive matter | Director | `MatterVisibility` | `roles-page` |

## Project

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Project.View` | View projects | all five starter roles | `OrganizationControllers`, `SearchController`, `SearchService` | `app.routes`, `audit-links`, `guards` and 6 more |
| `Project.Create` | Create projects | Director, Project Manager, Pod Lead, Data Technician | `OrganizationControllers` | `in-memory-identity-admin-api`, `matter-detail-page`, `matter-projects` and 3 more |
| `Project.Edit` | Edit projects | Director, Project Manager, Pod Lead, Data Technician | `OrganizationControllers` | `project-detail-page`, `project-tasks-panel`, `projects.routes` |
| `Project.Archive` | Archive and unarchive projects | Director, Project Manager, Pod Lead, Data Technician | `OrganizationControllers` | `project-detail-page` |

## Task

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Task.View` | View tasks | all five starter roles | `AssetControllers`, `AssetLinkRoleService`, `AssetService`, `AvailabilityControllers` and 23 more | `app.routes`, `asset-link-roles-page`, `asset-linked-tasks` and 35 more |
| `Task.Create` | Create tasks | all five starter roles | `AccessAuthorization`, `IntakeController`, `TaskControllers` | `create-task-page`, `dashboard-page`, `email-intake` and 11 more |
| `Task.Edit` | Edit task details | all five starter roles | `MatterBulkTasksController`, `TaskActionRules`, `TaskAssetService`, `TaskBulkService` and 1 more | `project-tasks-panel`, `scoped-tasks`, `task-detail-testing` and 1 more |
| `Task.Assign` | Assign or reassign tasks to pods and users | all five starter roles | `MatterBulkTasksController`, `TaskActionRules`, `TaskBulkService`, `TaskControllers` and 2 more | `create-task-page`, `dash-users-tab`, `dashboard-page` and 10 more |
| `Task.SetPriority` | Set task priority | all five starter roles | `MatterBulkTasksController`, `TaskActionRules`, `TaskBulkService`, `TaskControllers` and 1 more | `create-task-page`, `inline-edit`, `matter-actions` and 3 more |
| `Task.ChangeStatus` | Change task status (start, hold, resume) | all five starter roles | `TaskControllers` | `inline-edit`, `task-detail-testing`, `task-detail.store` |
| `Task.Complete` | Complete tasks | all five starter roles | `TaskControllers` | `in-memory-identity-admin-api`, `inline-edit`, `task-detail.store` |
| `Task.Cancel` | Cancel tasks | all five starter roles | `TaskControllers` | `inline-edit`, `task-detail.store` |
| `Task.Reopen` | Reopen completed or cancelled tasks | all five starter roles | `TaskControllers` | `inline-edit`, `task-detail.store` |
| `Task.Comment` | Add task comments | all five starter roles | `TaskActionRules`, `TaskCommentService`, `TaskPanelControllers` | `matter-actions`, `matter-detail-page`, `task-comments` and 1 more |

## Workflow execution

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Workflow.Execute` | Start, fill in, complete and skip workflow steps | all five starter roles | `CalendarService`, `CapacityService`, `TaskActionRules`, `TaskControllers` and 2 more | `task-detail-testing`, `task-detail.store` |
| `Workflow.StepReopen` | Reopen a completed workflow step | all five starter roles | `TaskActionRules`, `TaskControllers` | `task-detail.store` |

## Assets

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Asset.View` | View assets | all five starter roles | `AssetControllers`, `AssetLinkRoleService`, `AssetReportRunController`, `AssetTypeService` and 6 more | `app.routes`, `asset-link-roles-page`, `asset-picker` and 17 more |
| `Asset.Create` | Create assets | all five starter roles | `AssetControllers` | `assets-list-page`, `assets.routes`, `matter-assets` and 3 more |
| `Asset.Edit` | Edit assets | all five starter roles | `AssetControllers`, `AssetService` | `asset-record-page`, `assets-list-page`, `assets.routes` |
| `Asset.Link` | Link assets to tasks | all five starter roles | `TaskAssetService`, `TaskPanelControllers` | none |
| `Asset.Dispose` | Move assets to Pending disposition or Disposed | Director, Project Manager | `AssetControllers`, `AssetService` | `asset-record-page`, `assets-list-page` |

## Productions

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Production.View` | View productions | all five starter roles | `ProductionControllers` | `audit-links`, `matter-detail-page`, `matter-tabs` |
| `Production.Edit` | Create, edit and delete productions | all five starter roles | `ProductionControllers` | `productions-tab` |
| `Production.Comment` | Comment on productions | all five starter roles | `ProductionControllers` | `productions-tab` |
| `ProductionSpec.View` | View production specs | all five starter roles | `ProductionControllers` | `audit-links`, `productions-tab` |
| `ProductionSpec.Edit` | Create, edit, duplicate and retire production specs | Director, Project Manager, Pod Lead | `ProductionControllers` | `productions-tab` |

## Notes

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `MatterNote.View` | Matter Note Read | all five starter roles | `NoteControllers` | `audit-links`, `matter-detail-page`, `matter-tabs` |
| `MatterNote.Edit` | Matter Note Edit | all five starter roles | `NoteControllers` | `notes-tab` |
| `MatterNote.Delete` | Matter Note Delete | Director, Project Manager, Pod Lead | `NoteControllers` | `notes-tab` |

## Organization

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Pod.View` | View pods | all five starter roles | `DashboardScope`, `PodsController`, `TaskQueueController` | `app.routes`, `create-task-page`, `empty-copy` and 6 more |
| `Pod.Manage` | Create, edit and deactivate pods | Director, Pod Lead | `PodService`, `PodsController` | `admin.routes`, `audit-links`, `nav-items` and 4 more |
| `Pod.ManageMembers` | Manage pod membership | Director, Pod Lead | `PodsController` | `admin.routes`, `in-memory-identity-admin-api`, `nav-items` and 5 more |
| `User.View` | View the user list and access queue | Director | `CalendarAccess`, `PodService`, `RolesController`, `UsersController` | `admin.routes`, `app-shell`, `audit-links` and 6 more |
| `User.Manage` | Activate or disable users and assign roles | none (System Admin only) | `AvailabilityControllers`, `HolidayControllers`, `UsersController` | `admin.routes`, `nav-items`, `pods-page` and 3 more |
| `User.ManageAvailability` | Create, edit and delete Out of office entries of other people (a Pod Lead: members of their own pods) | Director, Pod Lead | `AvailabilityControllers`, `CalendarAccess`, `DashboardCalendarController` | `calendar-tab` |

## Configuration

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Role.Manage` | Create and edit roles and their permissions | none (System Admin only) | `RolesController` | `admin.routes`, `audit-links`, `nav-items` and 2 more |
| `TaskType.Manage` | Manage task types and their workflows | none (System Admin only) | `FormDefinitionResolver`, `FormsController`, `PrioritiesController`, `WorkflowControllers` | `admin-counts`, `admin.routes`, `audit-links` and 6 more |
| `Workflow.Manage` | Manage step definitions and workflows | none (System Admin only) | `FormDefinitionResolver`, `FormsController`, `WorkflowAdminService`, `WorkflowControllers` | `admin-counts`, `admin.routes`, `audit-links` and 6 more |
| `AssetType.Manage` | Manage asset types and asset link roles | none (System Admin only) | `AssetControllers`, `FormDefinitionResolver`, `FormsController`, `PrioritiesController` | `admin.routes`, `asset-link-roles-page`, `asset-tabs` and 5 more |
| `CustomField.Manage` | Manage client, matter and project custom fields | none (System Admin only) | `FormAdminService`, `FormDefinitionResolver`, `FormsController` | `admin.routes`, `custom-fields-page`, `form-schema` and 2 more |
| `Priority.Manage` | Manage priorities | none (System Admin only) | `PrioritiesController` | `admin-tabs`, `audit-links`, `labels-admin-page` and 4 more |
| `OnHoldReason.Manage` | Manage the reasons for putting a task on hold | none (System Admin only) | `PrioritiesController` | `audit-links`, `labels-admin-page`, `labels-tabs` and 2 more |
| `StatusLabel.Manage` | Manage task status labels | none (System Admin only) | `NoteControllers`, `PrioritiesController` | `admin-tabs`, `audit-links`, `labels-tabs` and 3 more |

## Dashboard

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Dashboard.View` | Open the Dashboard (the Dashboard menu item and page). Each tab below also needs its own permission | Director, Pod Lead, Data Technician, Data Scientist | `DashboardCalendarController`, `DashboardController`, `DashboardService` | `app.routes`, `dashboard-page`, `nav-items` |
| `Dashboard.ViewSummary` | Summary tab: the Overdue, Unassigned and On hold cards, the task grid and the unassigned-duration gauge | Director, Pod Lead | `CapacityService`, `DashboardController`, `DashboardService` | `dash-summary-tab`, `dashboard-page`, `dashboard-prefs` |
| `Dashboard.ViewUnassigned` | See the unassigned task queue on the Dashboard Summary tab (assign work to yourself or others) | Data Technician, Data Scientist | `CapacityService`, `DashboardController`, `DashboardService` | `dashboard-prefs` |
| `Dashboard.ViewBreakdowns` | Breakdowns tab: open tasks by priority, task type and status, and their age | Director | `DashboardController`, `DashboardService` | `dashboard-prefs` |
| `Dashboard.ViewTrends` | Trends tab: tasks created and completed per day | Director | `DashboardController` | `dashboard-prefs` |
| `Dashboard.ViewSwimlane` | Swimlane tab: every open task on a board by status | Director, Pod Lead | `DashboardController` | `dashboard-prefs` |
| `Dashboard.ViewUsers` | Users tab: team workload per person (open, overdue and due soon tasks), and the department capacity battery with its People list on the Summary tab | Director, Pod Lead | `DashboardController` | `dash-summary-tab`, `dashboard-prefs` |
| `Dashboard.ViewCoverage` | See how many tasks each person completed per task type (training and coverage planning) | Director, Pod Lead | `DashboardController` | `dash-users-tab` |
| `Dashboard.ViewCalendar` | Open the Calendar tab: who is out and who can work each day, and holidays | Director, Pod Lead | `DashboardCalendarController` | `dashboard-prefs` |
| `Dashboard.ViewAbsenceReasons` | See the type of an absence (vacation, sick, training) in the Calendar | Director, Pod Lead | `CalendarService` | `calendar-fixtures` |

## Reports

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Report.Manage` | Create and edit reports, categories and parameters, preview and activate them, browse the report schema and read the run log | none (System Admin only) | `ReportAdminControllers` | `admin.routes`, `nav-items`, `report-tabs` and 1 more |
| `Report.Assign` | Choose which roles can run which reports. Shows report names only, never the SQL | none (System Admin only) | `ReportAdminControllers` | `report-editor-page`, `report-tabs`, `reports-list-tab` and 1 more |
| `Report.Run` | Run the reports assigned to your roles, keep personal views and download the result as CSV | none (System Admin only) | `ReportAdminControllers` | none |

## Administration

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Settings.Manage` | Change application settings (name and icon, holiday calendars, calendar coverage thresholds) | none (System Admin only) | `HolidayControllers`, `PrioritiesController` | `admin.routes`, `nav-items` |

## Oversight

| Code | Meaning | Default roles | Backend | Frontend |
|---|---|---|---|---|
| `Audit.View` | Browse the audit log | Director | `TaskActivityService` | `admin.routes`, `asset-record-page`, `asset-type-record-page` and 10 more |

## Notes on special permissions

- `Matter.BeManager` is a marker: it lets a person be named Primary or Secondary project manager of a matter (and shows My Matters together with `Matter.View` and `Task.View`). `Matter.AssignManagers` lets a person change a matter's managers and use the All scope and manager picker in My Matters.
- `Matter.ViewSensitive` lets a person see all Sensitive matters (effective only when `Features:SensitiveMatterAccess` is on).
- `Dashboard.View` opens the Dashboard; every tab needs its own `Dashboard.View<Tab>` permission as well (a Dashboard with no tab permission is hidden). `Dashboard.ViewAbsenceReasons` only shows the absence type in the Calendar.
- `Settings.Manage` and the three Reports permissions are granted to no starter role; only the System Admin holds them until an administrator grants them.
- `Task.View` also unlocks several personal pages (My Work, Profile, Notifications) and the notification endpoints.
- `Report.Run` has no frontend use at this commit: the people-facing run page does not exist yet ([Reports Module](../Architecture/Reports-Module.md)).

## Related pages

- [How to Add a Permission](../Backend/How-to-Add-a-Permission.md)
- [Routing and Navigation](../Frontend/Routing-and-Navigation.md)
- [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md)

Last verified against commit c4bfdaf.
