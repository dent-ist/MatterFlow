# Configuration Reference

[[_TOC_]]

**What this page is for.** Every configuration key the application reads (`appsettings*.json`, environment variables, command line), with defaults and the code that reads it. Environment variables use a double underscore for a colon (`Auth__Dev__DefaultUser`). Production values live in `appsettings.Production.json` (template: `deploy/appsettings.Production.template.json`; runbook section 2). **Application settings stored in the database** (changed in Administration > Settings) are different: see [Settings Catalogue](../Reference/Settings-Catalogue.md).

Shipped defaults: `backend/src/LptHub.Api/appsettings.json` has only logging, `AllowedHosts`, `Features:SensitiveMatterAccess=false` and `Firm:TimeZoneId`. `appsettings.Development.json` adds the report connection string and the `Dev:Users` list (`KE\user1` to `KE\user10`).

## Connection and hosting

| Key | Default | Meaning |
|---|---|---|
| `ConnectionStrings:LptHub` | none | The application connection (role `lpt_app`). Seeds run only when it is present (or migrations are enabled) |
| `ConnectionStrings:Default` | none | Fallback for the migration runner |
| `ConnectionStrings:Migrations` | falls back to `Default` | Used only by the schema runner (needs DDL); must differ from the application login |
| `ConnectionStrings:ReportsReadOnly` | none | The read-only report login; must be a different login than the application. Reports stay off without it |
| `AllowedHosts` | `localhost;127.0.0.1;[::1]` | The site's real host names (semicolon separated). An unset production value makes every request fail with 400 |
| `Hosting:ServeSpa` | unset: serve when `wwwroot/index.html` exists and not Development | `true` forces, `false` runs the API alone (`Hosting/SpaHosting.cs`) |
| `ASPNETCORE_ENVIRONMENT` | `Production` in `web.config` | `Development` and `Test` allow the Dev auth provider |
| `LPTHUB_MIGRATE_ONLY` or `--migrate-only` | off | Apply the schema and exit |

## Authentication and bootstrap

| Key | Default | Meaning |
|---|---|---|
| `Auth:Provider` | `Dev` in Development, `Windows` elsewhere | `Windows` or `Dev`; `Dev` is refused outside Development and Test |
| `Auth:Dev:DefaultUser` | empty (401) | The user every request is signed in as when none is named |
| `Auth:Dev:HeaderName`, `QueryName` | `X-Dev-User`, `devUser` | Header and query names; the query form works in Development only |
| `Dev:Users` | none | Dev users seeded at startup (Dev provider only) |
| `Bootstrap:SystemAdmins` | none | Accounts that become System Admin at first sign-in, only while no active System Admin exists |
| `ActiveDirectory:LookupEnabled` | `false` | Optional display name and email lookup at first sign-in |
| `Authorization:CacheSeconds` | `60` | How long a person's permissions are cached per process |

## Database and startup

| Key | Default | Meaning |
|---|---|---|
| `Migrations:Enabled` | `true` (production template: `false`) | Apply scripts at startup |
| `Migrations:ConnectionStringName` | `Migrations` | Which connection string the runner uses |
| `Migrations:LockTimeoutSeconds` | `300` | Wait for the migration lock |
| `Migrations:CommandTimeoutSeconds` | `600` | Per batch timeout |
| `Migrations:ScriptsFolder` | embedded scripts | Ops hotfix testing only |
| `Seeds:Enabled` | `true` | Module startup seeds when migrations are off |
| `Seed:StarterConfiguration:Enabled` | on in Development, off elsewhere | Seed starter task types, workflows, forms, priorities |
| `Seed:StarterConfiguration:DryRun` | `false` | Only log what would be created |
| `Seed:StarterReports:Enabled` | on in Development, off elsewhere | Create the eight starter reports once (issue #724); never overwrites an edit; assigns no role |
| `Seed:StarterReports:DryRun` | `false` | Only log what would be created |
| `Security:AllowPrivilegedDatabaseIdentity` | `false` | Production refuses to start when the API identity can alter the audit table; `true` is a documented temporary exception |

## Behaviour

| Key | Default | Meaning | Read by |
|---|---|---|---|
| `Firm:TimeZoneId` | `America/New_York` | Time zone used when the browser sends no valid `X-Time-Zone` | `UserTimeZoneAccessor` |
| `Features:SensitiveMatterAccess` | `false` | Go-live switch of the Sensitive matter rule; read once at start | `SensitiveMatterAccessOptions` (SharedKernel) |
| `Tasks:OnHoldReasonRequired` | `false` | Require an on-hold reason when putting a task On Hold | `TaskLifecycleService` |
| `Dashboard:CacheSeconds` | `15` | Per user dashboard cache; `0` off | `DashboardCache.cs` |
| `Dashboard:Workload:LightMax`, `NormalMax` | `3`, `8` | Load levels of the Users tab | same |
| `Dashboard:Capacity:SlotsPerPerson` | `3` | Slots per person in the capacity battery | same |
| `Queries:ReadCommandTimeoutSeconds` | `15` | SQL timeout of the heavy reads; `0` keeps 30 s | `ReadQueryOptions` |
| `Notifications:Scheduler:Enabled` | `true` | Background notification job | `NotificationSchedulerOptions` |
| `Notifications:Scheduler:IntervalMinutes` | `5` | Tick interval | same |
| `Notifications:Scheduler:InitialDelaySeconds` | `30` | Delay before the first tick | same |
| `Notifications:Scheduler:DegradedAfterMinutes` | `30` | Health turns degraded after this long without a run | same |
| `Notifications:Scheduler:RetentionBatchPauseMilliseconds` | `100` | Pause between deletion batches | same |
| `Intake:MaxEmailBytes` | 10 MB | Largest accepted email | `IntakeOptions` |
| `Intake:ParseTimeout` | 15 s | Parse time limit | same |
| `Intake:MaxConcurrentParses`, `MaxQueuedParses` | `2`, `4` | Parse concurrency | same |

Fixed values (constants, not configuration): notification rules in `NotificationRules` (due soon 1 day, unassigned 2 days, on hold 5 days, read retention 90 days, unread retention 365 days).

## Rate limits (`RateLimits:*`, per user per minute; 0 or less turns a budget off)

| Key | Default |
|---|---|
| `ApiPerMinute` | 1200 |
| `CommentWritesPerMinute` | 30 |
| `TaskWritesPerMinute` | 120 |
| `SearchPerMinute` | 180 |
| `AdvancedSearchPerMinute` | 60 |
| `AuditPerMinute` | 60 |
| `DashboardPerMinute` | 60 |
| `MaxQueryStringLength` | 4096 characters |
| `MaxQueryValues` | 100 |

Source: `backend/src/LptHub.Api/Http/ApiRateLimiting.cs`.

## Reports (`Reports:*`)

Defaults from `ReportsOptions`: `DefaultTimeoutSeconds` 60, `MaxTimeoutSeconds` 300, `DefaultMaxRows` 50,000, `MaxRowsCeiling` 200,000, `GlobalConcurrency` 4, `RunsPerUserPerHour` 30, `PreviewRows` 20, `PreviewTimeoutSeconds` 15, `ChoiceQueryTimeoutSeconds` 10, `ChoiceQueryMaxRows` 1,000, `LockTimeoutMilliseconds` 5,000, `ResultIdleMinutes` 15, `ResultMaxMinutes` 60, `ResultMemoryBudgetMegabytes` 512 (file `backend/src/Modules/LptHub.Reports/Application/ReportsOptions.cs`).

## Frontend configuration

The Angular app reads `frontend/src/environments/*` (`environment.authProvider`: `stub` for the in-memory stub, otherwise the real API) and `proxy.conf.json` (dev proxy). The `api` configuration of `angular.json` serves with the proxy to port 5080.

## Related pages

- [Deployment and Hosting](../Architecture/Deployment-and-Hosting.md)
- [Settings Catalogue](../Reference/Settings-Catalogue.md)
- [How to Add a Setting](../Backend/How-to-Add-a-Setting.md)

Last verified against commit 6c2e523.
