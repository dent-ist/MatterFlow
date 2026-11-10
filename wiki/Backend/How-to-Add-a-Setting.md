# How to Add a Setting

[[_TOC_]]

**What this page is for.** How to add an application setting that an administrator changes in the app (stored in `dbo.AppSetting`), and how to tell it apart from a configuration key in `appsettings.json`.

## Two kinds of settings

| Kind | Stored in | Changed by | Takes effect | Examples |
|---|---|---|---|---|
| Application setting | `dbo.AppSetting` (key and value rows) | An administrator with `Settings.Manage` in Administration > Settings | At once (cached, `AppSettingsCache`) | `Branding.AppName`, `Dashboard.Gauge`, `Calendar.Thresholds` |
| Configuration | `appsettings*.json` or environment variables | A deployer | After a restart or app pool recycle | `Firm:TimeZoneId`, `Features:SensitiveMatterAccess`, `Notifications:Scheduler:Enabled` |

For configuration, add an options class bound with `services.Configure<T>(configuration.GetSection("..."))` and list the key in [Configuration Reference](../Operations/Configuration-Reference.md) and `deploy/appsettings.Production.template.json` if production needs it.

## Steps for an application setting

1. **Define it** in `backend/src/Modules/LptHub.Configuration/Domain/Settings/SettingDefinitions.cs`: a key `Group.Name` constant, the audit event names for change and reset (`SETTINGS_<GROUP>_<NAME>_CHANGED` and `_RESET`), a `SettingDefinition` (key, `Text` or `Binary`, default or null, changed event, reset event, label), and add it to `All`. **No seed row**: the default lives in code. Unknown keys found in the table are ignored.
2. **Model the value.** For structured values store one JSON text value and validate it in code (see `DashboardGaugeSettings` in `Configuration.Contracts` for defaults and `Validate`). If other modules need to read it, expose a small interface in `Configuration.Contracts` (like `IDashboardSettings`, `ICalendarSettings`).
3. **Add a service** in `Configuration/Application/Settings/` (pattern: `DashboardSettingsService`, `CalendarSettingsService`): read (with the default when nothing valid is stored), save (with the row version: 409 `CONCURRENCY_CONFLICT` on a stale value), reset (delete the row). Use `AppSettingsService` for the store and let it write the audit events. Register it in `ConfigurationModule`.
4. **Add the endpoint** under `/api/v1/admin/settings/<section>` in `Api/BrandingControllers.cs` (or a new controller) with the policy `Perm:Settings.Manage`. A read that every screen needs may be separate and anonymous only if it must work before sign-in (branding does).
5. **Add the settings section** in the frontend: `frontend/src/app/features/admin/settings` (the page has sections; the route is `/admin/settings`).
6. **Report access:** `AppSetting` is denied for the report login already; no change.
7. **Docs and wiki:** add the key to [Settings Catalogue](../Reference/Settings-Catalogue.md) with its default, who changes it and what reads it. If it changes behaviour described in the decisions addendum, note the decision.
8. **Tests:** unit test of the value rules; integration test in `IntegrationTests/Settings`.

## Related pages

- [Settings Catalogue](../Reference/Settings-Catalogue.md)
- [Notifications Audit and Settings](../Architecture/Notifications-Audit-and-Settings.md)
- [Configuration Reference](../Operations/Configuration-Reference.md)

Last verified against commit cf50a0a.
