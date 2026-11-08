# Schema Script History

[[_TOC_]]

**What this page is for.** One line per numbered SQL script in `db/scripts/`, in order: what it did, which tables it created and which it changed. Use it to find which script introduced a column or table, and to see how the schema grew. Rules for writing a new script: [How to Change the Schema](How-to-Change-the-Schema.md).

There are 60 scripts, numbered 01 to 60 and 63 (61 and 62 belong to the `reports` branch and are merged into dev later). **Number 16 does not exist** (a gap is allowed by the runner). Scripts are immutable once merged, so where one later fixed another (for example 32 after 31) the fix is a new script. "Created" and "changed" are derived by pattern matching on `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` and `CREATE TRIGGER` in the script text; permission and data scripts are described in plain words.

| # | File | What it did | Tables created | Tables or indexes changed |
|---|---|---|---|---|
| 01 | `01-init.sql` | Baseline: schema conventions and the sequence `TaskNumberSeq` for task numbers. | - | - |
| 02 | `02-identity-authz.sql` | Identity and authorization tables; the built-in System Admin role row. The permission catalog and starter roles come from the application. | `AppUser`, `Permission`, `Role`, `RolePermission`, `UserIdentity`, `UserRole` | - |
| 03 | `03-audit.sql` | The append-only audit table (INSTEAD OF trigger blocks update and delete). No foreign keys on purpose. | `AuditEvent` | - |
| 04 | `04-pods.sql` | Pods and pod membership (one primary pod per user at most). | `Pod`, `PodMember` | - |
| 05 | `05-organization.sql` | Clients, matters and projects: zero-padded 5-digit numbers, `MatterRef`, composite keys that keep client number and project matter consistent. | `Client`, `Matter`, `Project` | - |
| 06 | `06-forms.sql` | The forms and custom-field engine: definitions, versions, fields, options, stored values, typed index; published versions are immutable (triggers). | `CustomFieldIndex`, `FormDefinition`, `FormField`, `FormFieldOption`, `FormValueSet`, `FormVersion` | - |
| 07 | `07-configuration-basics.sql` | Configuration lookups: priorities, the five fixed task status labels (trigger fixes the codes), asset link roles. | `AssetLinkRole`, `Priority`, `TaskStatusLabel` | - |
| 08 | `08-task-types.sql` | Task types. | `TaskType`, `TaskTypeWorkflowEligibility` | - |
| 09 | `09-workflow-config.sql` | Workflow configuration: step library, workflow definitions, versions and version steps (immutable once published), and the foreign key from form definitions to steps. | `StepDefinition`, `WorkflowDefinition`, `WorkflowVersion`, `WorkflowVersionStep` | `FormDefinition` |
| 10 | `10-assets.sql` | Asset types and matter-owned assets (guard trigger), and the foreign key from form definitions to asset types. | `Asset`, `AssetType` | `FormDefinition` |
| 11 | `11-workflow-instances.sql` | Workflow execution state: workflow instances and step instances. | `StepInstance`, `WorkflowInstance` | - |
| 12 | `12-tasks.sql` | The task core: tasks (no delete, immutable fields by trigger) and comments. | `Task`, `TaskComment` | - |
| 13 | `13-security-hardening.sql` | Security hardening: database roles `mf_app` and `mf_migrator`, audit table permissions, the empty guard table that blocks `TRUNCATE`, a DDL trigger protecting the audit objects, the `SeedMarker` table, and moves last sign-in bookkeeping from `AppUser` to `UserIdentity`. | `AuditEventGuard`, `SeedMarker` | `UserIdentity` |
| 14 | `14-task-links.sql` | Task to asset links with roles, and the edit history of task comments. | `TaskAsset`, `TaskCommentRevision` | - |
| 15 | `15-dashboard-indexes.sql` | Indexes for the Dashboard aggregates (created and completed in a period). | - | `Task` |
| 17 | `17-audit-indexes.sql` | Index for the admin audit browser (`IX_Audit_EventType`). | - | `AuditEvent` |
| 18 | `18-performance-indexes.sql` | Indexes found by the performance pass with realistic volumes (task queue, assigned user, pod, comments). | - | `Task`, `TaskComment` |
| 19 | `19-task-type-icon.sql` | `TaskType.IconKey`, the id of a task type icon from the curated library. | - | `TaskType` |
| 20 | `20-task-assigned-at.sql` | `Task.AssignedAt`, when the current assignee was assigned (My Work). | - | `Task` |
| 21 | `21-task-type-icon-retire-brands.sql` | Data fix: retires trademarked brand icons of the task type icon library. | - | - |
| 22 | `22-user-availability.sql` | Per-user availability and weekly work hours. | `UserAvailability`, `UserWorkHour` | - |
| 23 | `23-step-tags.sql` | Free-form tags on library steps. | `StepDefinitionTag`, `StepTag` | - |
| 24 | `24-dashboard-permissions.sql` | Dashboard permissions: replaces `Dashboard.ViewDepartment` by `Dashboard.View` and tab permissions, with grants. | - | - |
| 25 | `25-dashboard-coverage.sql` | Permission `Dashboard.ViewCoverage` (task type coverage matrix). | - | `Task` |
| 26 | `26-task-description-format.sql` | `Task.DescriptionFormat` (TEXT or HTML). | - | `Task` |
| 27 | `27-dashboard-unassigned.sql` | Permission `Dashboard.ViewUnassigned` (Summary tab with only the unassigned queue). | - | - |
| 28 | `28-matter-managers.sql` | Project Manager epic: `Matter.PrimaryManagerId` and `SecondaryManagerId`, permissions `Matter.BeManager` and `Matter.AssignManagers`, grants. | - | `Matter` |
| 29 | `29-notifications.sql` | In-app notifications and per-user preference switches. | `Notification`, `NotificationPreference` | - |
| 30 | `30-reports.sql` | Reports: all report tables, the read-only role `mf_report_reader` with GRANT and DENY lines from `db/report-access.json`, two procedures, append-only triggers. | `ReportCategory`, `ReportDefinition`, `ReportFavourite`, `ReportParameter`, `ReportRecent`, `ReportRun`, `ReportVersion`, `RoleReport`, `SavedReportView` | - |
| 31 | `31-my-matters-activity-seen.sql` | `UserMatterActivitySeen`: how far a person has read My Matters recent activity. | `UserMatterActivitySeen` | - |
| 32 | `32-report-access-activity-seen.sql` | Classifies the table of script 31 as denied for the report role (forgotten in 31). | - | - |
| 33 | `33-my-matters-indexes.sql` | Re-creates `IX_Task_Matter` and `IX_StepInstance_Workflow` with more included columns so My Matters reads are seeks. | - | `StepInstance`, `Task` |
| 34 | `34-matter-view-sensitive.sql` | Permission `Matter.ViewSensitive` and its grant to Director (Sensitive matter rule). | - | - |
| 35 | `35-matter-visibility.sql` | The SQL twin of the visibility rule: functions `fnMatterVisible`, `fnTaskVisible`, `fnAssetVisible`, plus supporting indexes. | - | `Matter`, `Task` |
| 36 | `36-audit-sensitive-scope.sql` | `AuditEvent.IsSensitiveScope`: history stays restricted after a matter is un-marked. | - | `AuditEvent` |
| 37 | `37-task-matter-sensitivity.sql` | `Task.IsMatterSensitive` copy of the matter flag, kept in step by two triggers, for speed. | - | `Matter`, `Task` |
| 38 | `38-project-manager-no-dashboard.sql` | Removes dashboard permissions from the starter Project Manager role. | - | - |
| 39 | `39-activity-seen-initial.sql` | `UserMatterActivitySeen.IsInitial` (marks the starting point of the first read). | - | `UserMatterActivitySeen` |
| 40 | `40-task-type-colour-target.sql` | `TaskType.ColourKey` and `TargetDays` (colour badge and the At risk rule). | - | `TaskType` |
| 41 | `41-user-views.sql` | `UserView`: remembered screen state and named saved views per person. | `UserView` | - |
| 42 | `42-on-hold-reason.sql` | `OnHoldReason` list and `Task.OnHoldReasonId`. | `OnHoldReason` | `Task` |
| 43 | `43-asset-disposition.sql` | Asset disposition: `DispositionCode`, `DispositionChangedAt/ByUserId`, `DispositionNote`, constraint tying `IsActive` to it, an index. | - | `Asset` |
| 44 | `44-asset-type-size.sql` | `AssetType.SizeFieldKey` and `SizeUnit` (which number field means size). | - | `AssetType` |
| 45 | `45-asset-report.sql` | `AssetReport`: a person's saved asset reports. | `AssetReport` | - |
| 46 | `46-asset-dispose-permission.sql` | Permission `Asset.Dispose` and its grants. | - | - |
| 47 | `47-pm-v2-performance-indexes.sql` | Performance indexes for PM v2: `IX_CFI_Kind_Field_Owner` and `IX_Task_Matter_Type`. | - | `CustomFieldIndex`, `Task` |
| 48 | `48-app-settings.sql` | `AppSetting` table and permission `Settings.Manage`. | `AppSetting` | - |
| 49 | `49-matter-events.sql` | `MatterEvent`: calendar items of a matter. | `MatterEvent` | - |
| 50 | `50-asset-type-icon-colour.sql` | Asset type icon and colour (`IconKey`, `ColourKey`). | - | `AssetType` |
| 51 | `51-matter-ai-allowed.sql` | `Matter.AiAllowed` (0, 1 or 2). | - | `Matter` |
| 52 | `52-production-specs.sql` | `ProductionSpec` (guard trigger). | `ProductionSpec` | - |
| 53 | `53-productions.sql` | `Production` and `ProductionComment`. | `Production`, `ProductionComment` | - |
| 54 | `54-notes.sql` | Notes: `Note`, `NoteTag`, `NoteTagLink`, `NoteLink`. | `Note`, `NoteLink`, `NoteTag`, `NoteTagLink` | - |
| 55 | `55-note-templates.sql` | Note templates and their tags. | `NoteTemplate`, `NoteTemplateTag` | - |
| 56 | `56-note-template-levels.sql` | Note template levels: System, Client, Matter (`ScopeCode`, `ClientId`). | - | `NoteTemplate` |
| 57 | `57-task-unassigned-at.sql` | `Task.UnassignedAt` and the filtered index `IX_Task_Unassigned`. | - | `Task` |
| 58 | `58-user-absence.sql` | `UserAbsence`: many Out of office entries per person (replaces the single value of script 22). | `UserAbsence` | - |
| 59 | `59-holiday-calendars.sql` | Holiday calendars and holidays; `AppUser.HolidayCalendarId`, `Pod.DefaultHolidayCalendarId`. | `Holiday`, `HolidayCalendar` | `AppUser`, `Pod` |
| 60 | `60-calendar-permissions.sql` | Permissions `Dashboard.ViewCalendar`, `Dashboard.ViewAbsenceReasons`, `User.ManageAvailability` and grants. | - | - |
| 63 | `63-asset-numbering.sql` | Automatic asset numbering (issue #1297): `AssetType.NumberingEnabled`, `NumberingPattern` (the tail after the CM Number, default `_{###}`), `NumberingScope`; `Asset.AssetNumber` and `AssetNumberSeq` (null for every existing asset, no backfill) with the unique filtered index `UQ_Asset_AssetNumber`; the counter table `AssetNumberCounter` (denied for the report login); `TR_Asset_Guard` re-created so an assigned number never changes. Idempotent. | `AssetNumberCounter` | `AssetType`, `Asset` |
| 64 | `64-matter-fields.sql` | Matter fields (epic #1298): lists `MatterType`, `CurrentState`, `TeamTitle`; `Matter.MatterTypeId`, `CurrentStateId`, `DmsPath`, `DfsPath`; `MatterTeamMember` (typed-in team contacts, email unique per matter). | `MatterType`, `CurrentState`, `TeamTitle`, `MatterTeamMember` | `Matter` |

## Related pages

- [Database Overview](Overview.md)
- [Table Reference](Table-Reference.md)
- [Views and Procedures](Views-and-Procedures.md)

Last verified against commit a80aa5a.
