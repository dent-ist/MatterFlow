# Settings Catalogue

[[_TOC_]]

**What this page is for.** The application settings that administrators change in the app (Administration > Settings), stored as rows of `dbo.AppSetting`, and the closely related configuration keys. The registry in code is `backend/src/Modules/MatterFlow.Configuration/Domain/Settings/SettingDefinitions.cs`; a key not in that registry is ignored. **Defaults live in code; the table has no seed rows**, so "no row" means "the default". Changes are audited (each setting has a changed and a reset event).

All settings need `Settings.Manage` to change; only the branding read is public. See [Notifications Audit and Settings](../Architecture/Notifications-Audit-and-Settings.md) and [How to Add a Setting](../Backend/How-to-Add-a-Setting.md).

## Application settings (`dbo.AppSetting`)

| Key | Type | Default | Meaning | Edited at | API | Audit events |
|---|---|---|---|---|---|---|
| `Branding.AppName` | Text | `MatterFlow` | Application name shown in the header and the browser title (`Settings: Branding - <name>`) | Settings > Branding | `/admin/settings/branding` (read for everyone: `GET /branding`) | `SETTINGS_BRANDING_NAME_CHANGED`, `SETTINGS_BRANDING_RESET` |
| `Branding.Icon` | Binary (png, svg or ico, 256 KB limit in the table; minimum pixel size for png and ico) | none: the built-in mark (`favicon.svg`) stays | Custom application icon; the version (a short hash) is the cache buster and ETag | Settings > Branding | `/admin/settings/branding`, `GET /branding/icon` | `SETTINGS_BRANDING_ICON_CHANGED`, `SETTINGS_BRANDING_RESET` |
| `Dashboard.Gauge` | Text (JSON) | Working day 8 AM to 6 PM, Monday to Friday; age basis Working; level hours 1, 2, 3, 4, 5; one extra level per 5 unassigned tasks, at most +2 | The unassigned gauge: working day, age basis (`WORKING` or `CLOCK`), hours per level, count bonus. Time zone is `Firm:TimeZoneId` | Settings > Dashboard | `/admin/settings/dashboard` | `SETTINGS_DASHBOARD_GAUGE_CHANGED`, `SETTINGS_DASHBOARD_GAUGE_RESET` |
| `Dashboard.Capacity` | Text (JSON `{"countOffHours": true}`) | `countOffHours` true | Whether people outside work hours still count as capacity in the battery | Settings > Dashboard | `/admin/settings/dashboard/capacity` | `SETTINGS_DASHBOARD_CAPACITY_CHANGED`, `SETTINGS_DASHBOARD_CAPACITY_RESET` |
| `Calendar.Thresholds` | Text (JSON) | Firm minimum 75 percent, pod minimum 60 percent, no per-pod minimum people | Coverage levels of the Dashboard Calendar | Settings > Holidays | `/admin/settings/calendar` | `SETTINGS_CALENDAR_THRESHOLDS_CHANGED`, `SETTINGS_CALENDAR_THRESHOLDS_RESET` |
| `Calendar.FirmHolidayCalendarId` | Text (a calendar id) | none (no firm calendar) | The firm holiday calendar, the last fallback after a person's and a pod's calendar | Settings > Holidays | `/admin/settings/holidays` | `SETTINGS_CALENDAR_FIRM_HOLIDAY_CHANGED`, `SETTINGS_CALENDAR_FIRM_HOLIDAY_RESET` |

The audit object type of every setting event is `AppSetting`.

## Related configuration keys (not stored in the database)

These are in `appsettings` and take effect on restart; full list in [Configuration Reference](../Operations/Configuration-Reference.md).

| Key | Default | Relation to the settings above |
|---|---|---|
| `Firm:TimeZoneId` | `America/New_York` | Firm time zone: gauge working day, availability default zone, "overdue" fallback |
| `Dashboard:CacheSeconds` | 15 | Caches the Dashboard answer, so a changed setting can show up to this much later |
| `Dashboard:Capacity:SlotsPerPerson` | 3 | Slots per person in the capacity battery |
| `Dashboard:Workload:LightMax`, `NormalMax` | 3, 8 | Load levels of the Users tab |
| `Features:SensitiveMatterAccess` | `false` | Go-live switch of the Sensitive matter rule |
| `Tasks:OnHoldReasonRequired` | `false` | Whether an on-hold reason is required |
| `Notifications:Scheduler:*` | see reference | Notification scheduler |

## Adding a setting

1. Define it in `SettingDefinitions.cs` and add it to `All`.
2. Add service, endpoint and settings section ([How to Add a Setting](../Backend/How-to-Add-a-Setting.md)).
3. Add a row to the table above.

## Related pages

- [How to Add a Setting](../Backend/How-to-Add-a-Setting.md)
- [Configuration Reference](../Operations/Configuration-Reference.md)
- [Availability Capacity and Calendar](../Architecture/Availability-Capacity-and-Calendar.md)

Last verified against commit c4bfdaf.
