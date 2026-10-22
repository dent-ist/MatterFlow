# Runbook: deployment and operations

Sources: `docs/architecture.md` sections 2, 4, 6 and 11, `docs/qa/security-review-1-resolutions.md`, and
`docs/requirements/decisions-addendum.md` (L, M). If this file and those disagree, the architecture document and addendum win; fix this file.

Everything here was exercised on Linux (published package, SQL Server container, headless Chromium). The IIS, Windows authentication, Kerberos
and Active Directory parts have **not** been run on a real Windows Server yet: section 9 is the list the product owner must verify there.

## 1. Target topology

- One Windows Server on the firm intranet running **IIS**: one site, ASP.NET Core Module V2 **in-process**, framework-dependent publish
  (`win-x64`, needs the .NET 10 Hosting Bundle).
- The Angular production build is published into the app's `wwwroot/`. The API serves the static files and `/api/*` from the **same origin**
  (no CORS, no separate front-end host). Client routes (any `GET` without a file extension that is not `/api`, `/health` or `/openapi`) fall back to
  `index.html`. Hashed build files (`main-ABC123XY.js`) are cached for a year (`immutable`); `index.html` and other files are `no-cache`; text assets
  are compressed by the application (gzip/brotli), API JSON is not; `/api` responses are `no-store`.
- **Windows Authentication ON, Anonymous Authentication OFF** on the IIS site, HTTPS only. Add the site to the browsers' **Intranet zone** so
  Edge/Chrome sign in silently (Kerberos/Negotiate).
- SQL Server access uses the app-pool identity (a gMSA is recommended) with integrated security (`Trusted_Connection`), as a member of the database
  role `mf_app`. A different login (the DBA or a `mf_migrator` member) applies schema changes.
- The API sets HSTS, `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and
  `Cross-Origin-Opener-Policy` on every response, static files included (the app policy allows `'self'` plus inline styles, no inline scripts, no `eval`).
  IIS must not add, replace or strip them.

The hosting pieces live in `backend/src/MatterFlow.Api/Hosting/`; packaging in `deploy/`.

## 2. Configuration

Set through `appsettings.Production.json` (template: `deploy/appsettings.Production.template.json`, copied into every package), environment
variables (`Section__Key`, double underscore) or IIS configuration. Nothing secret lives in the repository; with integrated security there is no
password in any setting.

| Key | Purpose |
|---|---|
| `ConnectionStrings:MatterFlow` | Application connection, run as the app-pool identity in role `mf_app` (DML + EXEC, no DDL; audit table INSERT/SELECT only). Example: `Server=SQLHOST;Database=MatterFlow;Trusted_Connection=True;Encrypt=True;TrustServerCertificate=False`. Install a certificate on SQL Server that the web server trusts; `TrustServerCertificate=True` disables validation of the SQL link and is for development only. |
| `ConnectionStrings:Migrations` | Used by the schema runner only (`--migrate-only`, or startup when `Migrations:Enabled=true`). Needs DDL (DBA or `mf_migrator`). With `Trusted_Connection=True` it means the Windows account that runs the command. Must differ from the application login (architecture section 9, SEC-04). Falls back to `ConnectionStrings:Default` with a warning. |
| `AllowedHosts` | **The site's real host name(s)**, for example `matterflow.firm.local` (semicolon separated, no scheme or port). The shipped default allows only `localhost`, `127.0.0.1` and `[::1]`, so an unset value makes every request fail with 400 (host-header attacks and DNS rebinding are refused by design; SEC-19). Add every alias users type, including a short name if there is one. |
| `Auth:Provider` | Leave as `Windows` in Production. `Dev` is rejected at startup unless `ASPNETCORE_ENVIRONMENT` is `Development` or `Test` (so also in Staging/UAT). |
| `Bootstrap:SystemAdmins` | Accounts that become System Admin at their first sign-in. `["ke\\kekim"]` (domain `KE`, SAM `kekim`; case-insensitive). As an environment variable: `Bootstrap__SystemAdmins__0=ke\kekim`. |
| `Firm:TimeZoneId` | Default time zone, `America/New_York` (Eastern), used when a browser does not send a valid `X-Time-Zone` header. Timestamps are stored in UTC; users see their own local time (addendum M). Windows Server resolves IANA ids through ICU; if the server logs a time zone error use `Eastern Standard Time`. |
| `ActiveDirectory:LookupEnabled` | Optional display-name/email lookup at first login. **Off by default.** It reads AD with the web app's own identity, so enable it only after IT confirms that identity can read AD. When off or on any failure the display name falls back to `KE\sam` and an admin can edit name and email. |
| `Seed:StarterConfiguration:Enabled` | Optional starter data (task types, workflows, forms, priorities). Default: on in Development, **off elsewhere**. Idempotent, never overwrites admin edits. `DryRun=true` only logs what it would create. |
| `Migrations:Enabled` | Default `true` (the site migrates at startup). The Production template sets `false` because upgrades use `--migrate-only` (section 7). Also `LockTimeoutSeconds` (300), `CommandTimeoutSeconds` (600), `ConnectionStringName` (`Migrations`), `ScriptsFolder` (ops hotfix testing only). |
| `Security:AllowPrivilegedDatabaseIdentity` | Default `false`. In `Production` the API refuses to start when its own database identity can UPDATE, DELETE or ALTER `dbo.AuditEvent` (for example `sa`, `db_owner`). Set `true` only as a documented, temporary exception. |
| `Dashboard:CacheSeconds` | Default `15`. The dashboard answer is kept this long per user, period, time zone, date and Dashboard tab rights (Summary, Breakdowns, Trends), so repeated refreshes and a morning rush cost one computation per user per 15 s. `0` switches the cache off. Per process: each node of a farm keeps its own. |
| `Dashboard:Workload:LightMax`, `Dashboard:Workload:NormalMax` | Defaults `3` and `8`. Load levels of the Dashboard Users tab by number of open Tasks per person: `IDLE` (0), `LIGHT` (up to LightMax), `NORMAL` (up to NormalMax), `HEAVY` above. A capacity hint for leads, not a performance rating; no restart-free change (per process configuration). |
| `Queries:ReadCommandTimeoutSeconds` | Default `15`. SQL command timeout of the Task queue, My Work, Pod Work, search, audit browser and dashboard reads (all other calls keep 30 s). A query over the limit is cancelled and answered with 503 `QUERY_TIMEOUT` ("narrow the filters"), so one pathological filter cannot hold a connection. `0` keeps the 30 s default. |
| `Hosting:ServeSpa` | Unset (default): the Angular build in `wwwroot` is served when `wwwroot/index.html` exists and the environment is not Development. `true` forces it on, `false` runs the API alone. |
| `Notifications:Scheduler:Enabled` | Default `true`. The background timer that makes the scheduled notifications and removes old ones (section 6.1). Further keys `IntervalMinutes`, `InitialDelaySeconds`, `DegradedAfterMinutes`, `RetentionBatchPauseMilliseconds`. |
| `ASPNETCORE_ENVIRONMENT` | `Production` (set in `web.config`). |

## 3. Database and migrations

- The scripts `db/scripts/NN-*.sql` are embedded in the API. The runner takes an application lock, applies pending scripts in order (each in one
  transaction), verifies the checksums of applied scripts and records them in `dbo.SchemaMigration`. It runs **either** at startup before the host
  listens (`Migrations:Enabled=true`, any failure aborts the start) **or** as the separate `--migrate-only` command (section 7). Details: architecture 4.3.
- The database itself must exist and be empty or already managed by this runner: `CREATE DATABASE MatterFlow;`.
- Script `13-security-hardening.sql` creates the database roles `mf_app` (DML + EXECUTE, no DDL, `DENY UPDATE, DELETE, ALTER` on `dbo.AuditEvent`)
  and `mf_migrator` (DDL + DML, audit rows still append-only). Because the roles only exist after the first migration, a fresh install is
  ordered: create database, **migrate-only**, map logins to roles (section 5, steps 2 to 4).
- Audit protection in layers: the DENYs above; an INSTEAD OF trigger against UPDATE/DELETE; a permanently empty `dbo.AuditEventGuard` table whose
  foreign key makes `TRUNCATE TABLE` impossible even for sysadmin; a database DDL trigger against DROP/ALTER of the audit objects. A sysadmin can still
  disable triggers deliberately; monitor `sys.triggers` (`is_disabled`) and `sys.database_permissions` on the audit table in the periodic access review.
- Recommended, once, as a DBA (cannot run inside a migration transaction): `ALTER DATABASE MatterFlow SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;`
  (SEC-17; fewer reader/writer deadlocks).
- Sizing for 300 users (memory, cores, `max server memory`, MAXDOP, file sizes) and what to watch: `docs/qa/performance-round-1.md`, section "Recommendations".
- Applied scripts are immutable (checksum guard); fix forward with a new script. A `Success=0` row in `dbo.SchemaMigration` blocks startup and
  `--migrate-only` until an operator repairs the database and removes the row.
- Script `22-user-availability.sql` (epic #68) adds `dbo.UserAvailability` and `dbo.UserWorkHour` (own availability, out-of-office dates, weekly work hours). It only
  creates tables, so it is safe to apply with the normal upgrade (no data backfill; existing users simply have no row and are treated as available during Mon-Fri
  09:00-17:00 in the firm zone `Firm:TimeZoneId`). Rollback: the tables can stay; the previous application version ignores them.
  Availability (Available, Off hours, Out of office) is never stored: it is computed when read, in each person's own IANA time zone, so the host needs its time zone
  data (Linux: the `tzdata` package; a container image without it rejects every saved time zone with `TIMEZONE_UNKNOWN` and evaluates in UTC). Nothing needs to run at midnight or
  at the end of work hours; a Dashboard tab that is open picks up a change at its next 5-minute refresh. Support check for "she shows as out of office but is back":
  Administration > Users > Availability shows what the server evaluates now, and the audit log (`USER_AVAILABILITY_CHANGED`) says who changed it and when.
- After migrations the app syncs the permission catalog and starter roles idempotently (architecture 4.6) at every start where it has a database,
  also when `Migrations:Enabled=false`.

## 4. First login behavior

1. A user's first request creates their account just-in-time with **zero roles**; they land on **Access Pending** and can call only `GET /api/v1/me`.
2. If their account matches `Bootstrap:SystemAdmins`, they receive the System Admin role once, at that first sign-in (audit event `ADMIN_BOOTSTRAPPED`).
   Because it is applied once per user, an admin can later revoke it without it re-granting.
3. A System Admin opens **Administration > Users & Roles**, finds the user under *Pending access* and assigns roles. The user presses **Check again**
   (or reloads) and the permitted screens appear.
4. The last active System Admin cannot be disabled or lose the role (409 `LAST_ADMIN`).

## 5. Install on a domain-joined Windows Server with IIS

Assumptions: server `WEB01` and SQL Server `SQL01` in domain `KE`, site name `matterflow.firm.local`, service account (gMSA) `KE\svc-matterflow$`.

### 5.1 Prerequisites

- IIS with **Windows Authentication** (`Web-Windows-Auth`) and **Request Filtering**; Anonymous Authentication may stay installed but is switched off for the site.
  Optional: URL Rewrite for an HTTP to HTTPS redirect.
- **ASP.NET Core Hosting Bundle for .NET 10** (installs the .NET runtime and ASP.NET Core Module V2). Install after IIS, then `iisreset`.
  Check: `dotnet --list-runtimes` shows `Microsoft.AspNetCore.App 10.*`.
- A certificate for the site's host name (internal CA, trusted by clients) in the machine store, and DNS for the name.
- A gMSA for the app pool (recommended): `New-ADServiceAccount svc-matterflow -DNSHostName svc-matterflow.firm.local -PrincipalsAllowedToRetrieveManagedPassword WEB01$`,
  then `Install-ADServiceAccount svc-matterflow` on the server. Kerberos with a custom identity needs an SPN so browsers can do Negotiate:
  `setspn -S HTTP/matterflow.firm.local KE\svc-matterflow$` (and the short name if used). Without the SPN, clients fall back to NTLM.
- A trusted TLS certificate on SQL01 (`Encrypt=True` is the default in the connection string template).

### 5.2 SQL Server (DBA)

1. Create the database (collation as per firm standard) and the logins:
   ```sql
   CREATE DATABASE MatterFlow;
   CREATE LOGIN [KE\svc-matterflow$] FROM WINDOWS;       -- the app pool identity
   -- the person or account that will run migrate-only needs DDL on MatterFlow: a DBA already has it, otherwise:
   -- CREATE LOGIN [KE\dba-deploy] FROM WINDOWS;
   ```
2. Apply the schema once, before the site exists: on WEB01 or any machine with the package and the .NET 10 runtime, as the DBA account, follow section 7
   step 3 (`dotnet MatterFlow.Api.dll --migrate-only`). This creates all tables, the roles `mf_app` and `mf_migrator` and the audit DENYs.
3. Map the app identity to the least-privilege role (never `db_owner`, never `sysadmin`):
   ```sql
   USE MatterFlow;
   CREATE USER [KE\svc-matterflow$] FOR LOGIN [KE\svc-matterflow$];
   ALTER ROLE mf_app ADD MEMBER [KE\svc-matterflow$];
   -- optional, for a non-DBA deployer:  CREATE USER [KE\dba-deploy] FOR LOGIN [KE\dba-deploy]; ALTER ROLE mf_migrator ADD MEMBER [KE\dba-deploy];
   ```
4. Verify the audit trail is protected for the app login (all three must return 0):
   ```sql
   EXECUTE AS LOGIN = 'KE\svc-matterflow$';
   SELECT HAS_PERMS_BY_NAME('dbo.AuditEvent','OBJECT','UPDATE') AS can_update,
          HAS_PERMS_BY_NAME('dbo.AuditEvent','OBJECT','DELETE') AS can_delete,
          HAS_PERMS_BY_NAME('dbo.AuditEvent','OBJECT','ALTER')  AS can_alter;
   REVERT;
   ```
   The API runs the same check at startup and **refuses to start in Production** when any is 1 (`AuditStoreGuard`).
5. Optional: `ALTER DATABASE MatterFlow SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;` and set the backup plan (section 8).

### 5.3 The package

Build it where Node 22 and the .NET 10 SDK are available (a developer machine or the `publish` GitHub Actions workflow, which uploads the folder as the
artifact `matterflow-publish-<sha>`):

```powershell
deploy\publish.ps1 -Output C:\build\matterflow      # or: deploy/publish.sh /path/out win-x64
```

The folder contains `MatterFlow.Api.dll` and its dependencies, `wwwroot/` (the Angular build), `web.config` (from `deploy/web.config`) and
`appsettings.Production.template.json`. Copy it to `C:\inetpub\matterflow` on WEB01.

### 5.4 Settings

1. `copy appsettings.Production.template.json appsettings.Production.json` and replace every `REPLACE_*` value (`AllowedHosts`, the SQL host name in
   both connection strings). Remove the `_...` comment keys if you like.
2. Folder permissions: the app pool identity needs **Read & Execute** on the site folder (and Modify on a `logs` folder only if `stdoutLogEnabled` is
   switched on for troubleshooting). Nobody else needs access except administrators.

### 5.5 IIS site

1. App pool `MatterFlow`: **.NET CLR version: No Managed Code**, pipeline Integrated, identity **Custom account** `KE\svc-matterflow$` (leave the password empty for a gMSA),
   Start mode `AlwaysRunning`, Idle time-out `0` (the first request otherwise waits for the app to start, and the notification scheduler, section 6.1, would stop with the idle pool).
   `configure-iis.ps1`, shipped in every win-x64 package, sets both and the site's `preloadEnabled` idempotently (`.\configure-iis.ps1 -SiteName MatterFlow -AppPoolName MatterFlow`).
2. Site `MatterFlow`: physical path `C:\inetpub\matterflow`, application pool `MatterFlow`, HTTPS binding on 443 with the certificate and host name `matterflow.firm.local`.
   Remove the HTTP binding, or keep it only to redirect (section 5.5 step 4).
3. **Authentication** (site level): *Windows Authentication* Enabled, *Anonymous Authentication* Disabled. These switches are locked at server level
   by default; set them in IIS Manager (writes `applicationHost.config`) or unlock the section once; `web.config` carries the same intent.
   Under Windows Authentication > Providers, `Negotiate` must come first (then `NTLM`). Do not enable *Basic*.
4. Optional HTTP redirect: uncomment the URL Rewrite rule in `web.config`. HSTS from the API only takes effect over HTTPS.
5. Leave IIS compression alone: `web.config` turns static and dynamic compression off because the API compresses its text assets.
6. Request limits: `maxAllowedContentLength` is 12582912 bytes (12 MB, the email upload ceiling) in `web.config`; the API caps every other request body at 2 MB itself.
   Do not raise it without raising the application limits (`IntakeRequestLimitsAttribute`).
7. Add `https://matterflow.firm.local` to the **Local intranet zone** of client browsers by Group Policy (Site to Zone Assignment List), so Edge/Chrome send Kerberos tickets silently.

### 5.6 First start and verification

1. Browse to the site on WEB01 (or `Start-Process https://matterflow.firm.local/health/live`). With Anonymous off, tools without Windows credentials get 401; use
   `curl.exe --negotiate -u : https://matterflow.firm.local/health/ready` or a browser. Expected `/health/live`: `Healthy`; `/health/ready`: `{"status":"ready"}`.
2. If `/health/ready` answers 503, the `reason` says why (section 6).
3. Sign in as `ke\kekim`: you are provisioned and made System Admin once (section 4); **Administration** is visible. Create roles and grant access to staff.
4. Open the browser developer console: no CSP violations (section 9).

## 6. Health checks and monitoring

| URL | Meaning |
|---|---|
| `/health/live` | 200 `Healthy` as long as the process runs; no dependency checks. Also lists the notification scheduler (section 6.1): 200 `Degraded` when it has not completed a run for 30 minutes. |
| `/health/ready` | 200 `{"status":"ready"}` when the database is reachable with the application connection and `dbo.SchemaMigration` lists every script embedded in this build as applied successfully. Otherwise 503 `{"status":"not_ready","reason":"..."}` with one of: `database_not_configured`, `database_unreachable`, `migrations_pending`, `migration_failed`. No server names, messages or stack traces. |

Both are exempt from the app's own authorization (anonymous at the API level). On IIS they are behind Windows authentication like everything else, so an external
monitor needs a domain account (or `curl --negotiate`). Ship the Windows Event Log and the application log to the firm's monitoring and alert on 503 from `/health/ready`
for more than a few minutes.

### 6.1 Notification scheduler

The in-app notifications that no person's action causes (a task is due within a day, a task is overdue, an unassigned or on-hold task has waited for a while) and the
clean-up of old notifications are made by a background timer inside the web application (`NotificationSchedulerService`, epic #753). It needs the process to stay up:

- **IIS:** the application pool must have Start mode `AlwaysRunning` and Idle time-out `0`, and the site `preloadEnabled` (script `configure-iis.ps1`, section 5.5). With the default
  idle time-out of 20 minutes the pool sleeps, the timer stops and no scheduled notification is made until the next request wakes the app. The IIS role service *Application Initialization*
  (`Web-AppInit`) lets preload start the app after a recycle; without it the app starts with the first signed-in request after a recycle (a recycle is rare: the pool's periodic restart, a deploy).
- **Rhythm:** every 5 minutes (first run 30 seconds after start). One run takes the SQL Server application lock `Notifications.Scheduler` without waiting, so overlapping runs and a second web server
  never execute twice; the late one logs "another run holds the lock" and skips. Running a step again creates nothing new (keys carry the due date or the start of the state).
- **Steps, in this order:** `task-due` (events 2 and 4, the firm time zone `Firm:TimeZoneId` decides "today"), `task-stalled` (event 6: unassigned 2 calendar days, on hold 5 calendar days), and once a day
  `retention` (deletes read notifications older than 90 days and any notification older than 365 days, in batches of 1,000 with a 100 ms pause). A step that throws is logged
  (`Notification scheduler: <step> failed`) and the other steps and the timer carry on. Each finished step logs how many rows it created or deleted.
- **First run after the release:** every task that is already overdue is reported once to its assignee and its matter's managers (the current state, never one notice per missed day). Expect a burst of
  notifications for the first few minutes after the first deploy.
- **Health:** `/health/live` lists the check `notification-scheduler`. It is `Healthy` while a run completed in the last 30 minutes and `Degraded` (HTTP 200, text `Degraded`) when none did; it is never `Unhealthy`,
  because people can still work. `/health/ready` is not affected. Alert on `Degraded` for more than an hour: look in the application log for `Notification scheduler` lines, check that the pool is running
  (`startMode`), and that the database account has DELETE on `dbo.Notification` (script 29).
- **Settings** (all optional): `Notifications:Scheduler:Enabled` (default `true`; `false` switches the timer off, for example on a second web server that must not run it), `IntervalMinutes` (5),
  `InitialDelaySeconds` (30), `DegradedAfterMinutes` (30), `RetentionBatchPauseMilliseconds` (100).

## 7. Upgrade and rollback

### 7.1 `--migrate-only`

`dotnet MatterFlow.Api.dll --migrate-only` (or environment variable `MATTERFLOW_MIGRATE_ONLY=true`) applies the pending scripts with the
`ConnectionStrings:Migrations` login, writes progress to the console, and exits **0** when the schema is up to date or **1** on any failure. It does not start the web
host, run seeds or the audit guard, and it ignores `Migrations:Enabled=false`. It reads `appsettings.json` and `appsettings.<Environment>.json` from the folder of the binaries (set
`ASPNETCORE_ENVIRONMENT=Production`), environment variables and extra command-line settings, for example
`--ConnectionStrings:Migrations="Server=SQL01;Database=MatterFlow;Trusted_Connection=True;Encrypt=True"`. Concurrent runs are serialized by the application lock.

### 7.2 Upgrade procedure

1. Announce a short window. Take a **full backup** of `MatterFlow` first (`BACKUP DATABASE MatterFlow TO DISK = '...' WITH COMPRESSION, CHECKSUM;`): it is the rollback point.
2. Build or download the new package. Unzip it to a staging folder next to the live one, for example `C:\inetpub\matterflow-new`, and copy the live `appsettings.Production.json` into it.
3. As the DBA/migrator account, from the staging folder:
   ```powershell
   $env:ASPNETCORE_ENVIRONMENT = 'Production'
   dotnet .\MatterFlow.Api.dll --migrate-only
   if ($LASTEXITCODE -ne 0) { throw "Migration failed: do not switch binaries" }
   ```
   The old site can keep running during this step only if the release notes say the new scripts are backward compatible (additive); otherwise stop the site before step 3.
4. Stop the site (`Stop-WebSite MatterFlow`; the app pool recycles), swap the folders (rename the live folder to `matterflow-previous`, the staging folder to `matterflow`; or `robocopy
   C:\build\matterflow C:\inetpub\matterflow /MIR /XF appsettings.Production.json web.config /XD logs` when `web.config` has local edits), then `Start-WebSite MatterFlow`.
   Keep `appsettings.Production.json`: it is not in the package.
5. Verify `/health/ready` is `ready`, sign in, open the dashboard and one task. Keep the previous folder and the backup for at least a week.

### 7.3 Rollback

- **No schema change in the release** (`SELECT MAX(Prefix) FROM dbo.SchemaMigration` is the same as before): swap back to `matterflow-previous`.
- **Schema scripts were applied:** the old binaries refuse to start (they find applied scripts they do not contain, by design). Either **fix forward** with a corrected release (preferred), or
  restore the pre-upgrade full backup (`RESTORE DATABASE MatterFlow FROM DISK = '...' WITH REPLACE, RECOVERY;`, site stopped), losing everything entered since, and swap back the binaries.
  If the incident is in the app only and data entered since must be kept, restore to a side database, export what is needed, and fix forward.
- Never edit or delete rows of `dbo.SchemaMigration` to make an old build start, except to clear a `Success=0` row after repairing the database by hand.

## 8. Backup and restore

The firm has not specified a backup policy yet. **Proposal for approval:**

- Recovery model `FULL`. Nightly full backup (for example 01:00), transaction log backup every 15 minutes (RPO 15 minutes), differential optional at midday.
- `WITH COMPRESSION, CHECKSUM`, written to a share on another server or to the backup system; retain 35 days online and monthly fulls for the firm's retention period; encrypt backups
  at rest (backup encryption or storage-level), because the database holds matter data and the audit trail.
- Back up the site's `appsettings.Production.json` and `web.config` with the server image or configuration management. They contain no secrets.
- Restore drill at least quarterly into a side database: `RESTORE DATABASE ... WITH NORECOVERY` (full), then the log chain `WITH STOPAT`, then `RECOVERY`; start a copy of the app against it and check `/health/ready`.
- Restore in place: stop the site, restore, start the site. Logins and role membership are inside the database, so a restore to the same domain keeps `mf_app`; on a **new** SQL Server instance create
  the Windows login for the app identity first (`CREATE LOGIN ... FROM WINDOWS`), then `ALTER USER [KE\svc-matterflow$] WITH LOGIN = [KE\svc-matterflow$]` if the user is orphaned.
- The audit table is part of the same database; no separate backup is needed, but never restore a partial or older backup over it without recording the reason.

## 9. What the product owner must verify on the real server

Not exercised yet outside Linux. Tick each on the production-like server and report failures:

- [ ] **Hosting Bundle and module:** the site starts in-process; `https://<host>/health/live` is `Healthy` and `/health/ready` is `{"status":"ready"}` for a signed-in user.
- [ ] **Negotiate sign-in:** from a domain-joined PC in the Intranet zone, Edge and Chrome open the site without a credential prompt and show the user's own name top right (`KE\sam`).
      On the same PC `klist` shows a ticket for `HTTP/<host>` (Kerberos; if only NTLM works, the SPN is missing). A PC outside the domain gets a prompt or 401, never an anonymous session.
- [ ] **Anonymous off:** `curl.exe -i https://<host>/api/v1/system/ping` without credentials returns 401, not 200.
- [ ] **First admin:** `ke\kekim` becomes System Admin at the first sign-in and sees Administration; a second account lands on Access Pending.
- [ ] **AllowedHosts:** the site answers on its real name; an unlisted name (IP address, alias) answers 400.
- [ ] **Audit protection:** the app starts with the `mf_app` login; temporarily running it as a `db_owner` login makes startup fail with the audit message (then restore).
- [ ] **AD lookup (optional):** with `ActiveDirectory:LookupEnabled=true`, a new user's display name and email are filled from AD using the app pool identity; if not, leave it off.
- [ ] **Time zone:** after a hard refresh, a task due today shows the due time in the user's local time zone, and the overdue flag flips at the right local moment; check one user in another zone if any.
- [ ] **CSP in the browser:** with the developer tools console open, load the dashboard, a task, an admin screen and a form: no `Content-Security-Policy` violations or blocked scripts/styles; the response
      headers on `/` and `/api/...` match section 1 (Network tab). No header is duplicated or removed by IIS.
- [ ] **Deep links and refresh:** pasting `https://<host>/tasks/new` (and refreshing any inner page) opens the app, not a 404; an unknown `/api/...` URL shows a JSON problem body.
- [ ] **Caching and compression:** after an upgrade, a normal reload shows the new version (index.html is `no-cache`); `main-*.js` transfers compressed (`content-encoding: br` or `gzip`) once.
- [ ] **Uploads:** an email upload near 12 MB succeeds; a larger one is refused cleanly.
- [ ] **Rich text description (script 26, decision R):** after the upgrade, an old task still shows its description as it was (plain text with line breaks); paste a table from Outlook into a new task's Description, save, reload: the table is there; paste a table of more than 200 cells: it arrives as text with a notice; no CSP violation in the console. Support note: the database column `Task.DescriptionFormat` is `TEXT` for tasks created before the upgrade and `HTML` after; a description error `HTML_TOO_LARGE`, `TABLE_TOO_LARGE` or `TOO_COMPLEX` means the pasted content is over a limit (100,000 characters of HTML, 200 table cells, nesting 20), not a server fault.
- [ ] **Upgrade drill:** do section 7.2 once on a copy of production data, including `--migrate-only` run by the DBA account, and the rollback restore of section 7.3.
- [ ] **Backups:** the nightly and log backups run, and one restore drill succeeded (section 8).

## 10. Troubleshooting

- **Site fails to start (HTTP 500.30/500.0):** read the Windows Event Log (source *IIS AspNetCore Module V2*) and, if needed, switch `stdoutLogEnabled="true"` in `web.config` for one run (create `logs`). Migration failures name the script, batch and
  SQL error; fix the database or add a new script, never edit an applied one. The audit guard message means the app login is too privileged (section 5.2 step 4).
- **HTTP Error 500.19 with `0x80070021`:** the Windows/Anonymous authentication sections are locked; set them in IIS Manager (section 5.5 step 3).
- **Every request answers 400 `Bad Request - Invalid Hostname`:** `AllowedHosts` does not contain the name used.
- **`/health/ready` 503:** `database_not_configured` (connection string missing), `database_unreachable` (network, SQL login, certificate trust; the details are in the application log), `migrations_pending` (run `--migrate-only`),
  `migration_failed` (a `Success=0` row; repair, then delete the row).
- **Everyone sees Access Pending:** expected for new accounts until an admin assigns roles; check `Bootstrap:SystemAdmins` spelling (`ke\\kekim` in JSON) if the admin does too.
- **Browser asks for credentials:** site not in the Intranet zone, missing SPN, or Anonymous is still enabled/Windows disabled.
- **Display names show as `KE\sam`:** AD lookup is off (default) or failing; an admin can edit the profile.
- **Wrong "overdue" times:** check the client sends `X-Time-Zone`; the server falls back to `Firm:TimeZoneId`.
- **Blank page after an upgrade:** a stale cached `index.html` pointing to removed hashed files; hard refresh, and check that no proxy overrides `Cache-Control`.
