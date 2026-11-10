# Deployment and Hosting

[[_TOC_]]

**What this page is for.** How LPT Hub is packaged and hosted on a domain-joined Windows Server with IIS, which scripts do what, and which settings matter. The full procedure (install, upgrade, rollback, backup) is in `docs/runbook.md` sections 5 to 8; this page is the map. LPT Hub has not been deployed yet (`CLAUDE.md`), and the rehearsal on a real IIS server is still to do (runbook section 9).

## Topology

One IIS site hosts the ASP.NET Core app in process (`AspNetCoreModuleV2`, `hostingModel="inprocess"`). The same process serves the API (`/api`) and the Angular build (from `wwwroot`), so the browser sees one origin. IIS has Windows authentication on and anonymous off. The app connects to SQL Server with the app pool identity (integrated security). See the diagram in [System Overview](System-Overview.md).

## Packaging

| Item | What it does |
|---|---|
| `deploy/publish.sh` (Linux, macOS, CI) and `deploy/publish.ps1` (Windows) | Build the Angular app (`npm ci`, `npm run build`), run `dotnet publish` (framework-dependent, default runtime `win-x64`, `-p:OpenApiGenerateDocuments=false`), and copy `frontend/dist/frontend/browser` into the package's `wwwroot` |
| `deploy/web.config` | IIS configuration: AspNetCoreModuleV2 in process, `ASPNETCORE_ENVIRONMENT=Production`, stdout logging off |
| `deploy/appsettings.Production.template.json` | Copied into the package; copy it to `appsettings.Production.json` on the server and replace every `REPLACE_*` value |
| `deploy/configure-iis.ps1` | Sets the application pool to AlwaysRunning with idle timeout 0 and enables site preload, so the notification scheduler (a background timer in the worker process) keeps running |
| `.github/workflows/publish.yml` | Manual workflow that builds the package and uploads it as an artifact |

The server needs the .NET 10 Hosting Bundle (framework-dependent publish).

## Release flow (summary)

::: mermaid
flowchart TD
  A["Build package: deploy/publish.sh or publish.ps1"] --> B["Copy to the server, keep the previous folder for rollback"]
  B --> C["DBA or deploy step runs: dotnet LptHub.Api.dll --migrate-only (ConnectionStrings:Migrations)"]
  C --> D["Swap binaries, recycle the app pool"]
  D --> E["Startup: seeds (permission catalog), audit store guard"]
  E --> F["Check /health/ready and sign in"]
:::

- Production sets `Migrations:Enabled=false`: schema scripts are applied by the `--migrate-only` step with a DDL-capable login (`lpt_migrator` or a DBA), so the running site's identity (`lpt_app`) never needs DDL.
- At startup the API refuses to run in Production when its own database identity can UPDATE, DELETE or ALTER `dbo.AuditEvent` (`Security:AllowPrivilegedDatabaseIdentity` is the documented exception switch).
- Health: `/health/live` (process), `/health/ready` (database reachable, migrations applied; states `database_not_configured`, `database_unreachable`, `migrations_pending`, `migration_failed`).
- Rollback: restore the previous folder; scripts are forward-only, so a database rollback is a restore (runbook sections 7 and 8).

## Settings that matter in production

| Key | Production value |
|---|---|
| `AllowedHosts` | The site's real host name(s); the default allows only localhost and an unset value makes every request fail with 400 |
| `Auth:Provider` | `Windows` (`Dev` is refused outside Development and Test) |
| `ConnectionStrings:LptHub` and `:Migrations` | Two different identities |
| `ConnectionStrings:ReportsReadOnly` | A third, read-only login (reports) |
| `Bootstrap:SystemAdmins` | `["ke\\kekim"]` |
| `Features:SensitiveMatterAccess` | `false` until go-live of the rule (runbook section 12) |
| `Firm:TimeZoneId` | `America/New_York` |

Full table: [Configuration Reference](../Operations/Configuration-Reference.md).

## Related pages

- [Runbook](../Operations/Runbook.md)
- [Release Checklist](../How-To/Release-Checklist.md)
- [Configuration Reference](../Operations/Configuration-Reference.md)

Last verified against commit f45fc1d.
