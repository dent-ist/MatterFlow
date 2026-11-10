# Notifications, Audit and Settings

[[_TOC_]]

**What this page is for.** The three cross-cutting services every feature may touch: in-app notifications (`LptHub.Notifications`), the audit trail (`LptHub.Audit` plus `LptHub.Data` interceptors) and application settings (`dbo.AppSetting`, owned by `LptHub.Configuration`). Use it to decide what to write when your feature changes data.

## Audit

**Decision (architecture section 9): hybrid and transactional.** `AuditEvent` rows are written by the same `SaveChanges` and the same transaction as the change they describe. A failing audit write fails the business operation.

| Mechanism | How | Use it for |
|---|---|---|
| Field-level events | `AuditSaveChangesInterceptor` (`backend/src/LptHub.Data`) writes `FIELD_CHANGED` for entities marked `[Audited]`, for properties not marked `[AuditExplicit]`. JSON value columns are diffed per field key | Plain property edits; zero code in the service |
| Explicit events | `IAuditWriter` (`Audit.Contracts`) called from an application service | Semantic actions: `TASK_CREATED`, `TASK_STATUS_CHANGED`, `ROLE_GRANTED`, `MATTER_SENSITIVITY_CHANGED`, `EXPORT_RUN`, and so on |
| Audit columns | `AuditColumnsInterceptor` stamps `CreatedAt/By`, `ModifiedAt/By` on `IAuditStamped` entities | Automatic |

- Attributes `[Audited]`, `[AuditExplicit]` live in `SharedKernel/Audit/AuditAttributes.cs`. `Redaction.cs` masks secret-looking values (`[REDACTED]`).
- Table `dbo.AuditEvent` (script 03, indexes in 17 and 18, `IsSensitiveScope` in 36): `OccurredAtUtc`, `ActorUserId` (null = system), `EventType`, `ObjectType`, `ObjectId`, `MatterId`, `TaskId` (denormalised scope columns, no foreign keys), `FieldKey`, `OldValue`, `NewValue`, `CorrelationId`, `Summary`.
- Append-only: the application login has INSERT and SELECT only on the table (script 13 and trigger `TR_AuditEvent_AppendOnly`); `AuditStoreGuard` refuses to start in Production when the API identity could change it.
- An audited entity that belongs to a matter must declare its audit scope as the matter (architecture test `AuditScopeRulesTests`), so history respects the Sensitive matter rule.
- Reading: `GET /api/v1/tasks/{id}/activity` (task activity), `GET /api/v1/audit/events`, `/audit/search`, `/audit/facets` (`Audit.View`; `AuditSearchService`, `AuditSummaryComposer` for readable text; the host's `AuditDisplayLookup` supplies names and labels). The frontend page is Administration > Audit Logs (`features/admin/audit`).
- How to add an event: [How to Add an Audit Event](../Backend/How-to-Add-an-Audit-Event.md).

## Notifications

- Table `dbo.Notification` (script 29): in-app notifications with a poll cursor `Id` and a unique dedupe key. `dbo.NotificationPreference`: sparse per-user switches (rows only when changed).
- Event types (`Notifications.Contracts/NotificationEventType.cs`): task assigned; due within a day or overdue (scheduler); comment on your task; mention (reserved); task on your matter overdue (scheduler); task created on your matter; unassigned or on hold for a while (scheduler); set as Primary or Secondary manager; task unassigned in your pod. Lower numeric value wins when two rules hit the same person for the same action.
- Producers call `NotificationPublisher` (through `Notifications.Contracts`) from the same transaction as the business change (Organization, WorkManagement reference `Notifications.Contracts`).
- Scheduler: `NotificationSchedulerService` (5 minute `PeriodicTimer`, application lock `Notifications.Scheduler`, jobs `task-due`, `task-stalled`, `retention`). It needs the application pool to stay running: `deploy/configure-iis.ps1` sets AlwaysRunning. Options under `Notifications:Scheduler:*`.
- Visibility: a notification is checked with the Sensitive matter rule both when produced (per recipient) and when read.
- Endpoints: `/api/v1/me/notifications`, `/api/v1/me/notification-preferences` (policy `Task.View`). Frontend: bell and list in `features/notifications` and `shared/layout`; switches on My Profile.
- The mention type is reserved and not produced.

## Application settings

- Table `dbo.AppSetting` (script 48): `SettingKey` (primary key), text value, binary value with content type and SHA-256 (256 KB limit), `RowVersion`, who and when. Denied for the report login. **No seed rows**: defaults live in code.
- Registry: `backend/src/Modules/LptHub.Configuration/Domain/Settings/SettingDefinitions.cs`. Each definition names the key, the type (text or binary), the default, and the audit events for change and reset. Unknown keys in the table are ignored.
- Services (`Configuration/Application/Settings`): `AppSettingsService` (generic store with row version), `BrandingService`, `DashboardSettingsService`, `CalendarSettingsService`, `AppSettingsCache`.
- Admin endpoints under `/api/v1/admin/settings/*` need `Settings.Manage`; the branding read (`GET /api/v1/branding`, icon) is anonymous so the sign-in and error pages can show the name and icon.
- Current keys: see [Settings Catalogue](../Reference/Settings-Catalogue.md). Adding one: [How to Add a Setting](../Backend/How-to-Add-a-Setting.md).
- Do not confuse these with **configuration** (`appsettings.json`, environment variables), which needs a restart or app pool recycle: [Configuration Reference](../Operations/Configuration-Reference.md).

## Related pages

- [Request Lifecycle](Request-Lifecycle.md)
- [Availability Capacity and Calendar](Availability-Capacity-and-Calendar.md)
- [Settings Catalogue](../Reference/Settings-Catalogue.md)

Last verified against commit f45fc1d.
