# System Overview

[[_TOC_]]

**What this page is for.** The big picture: who uses the system, what runs where, what happens at startup and what runs in the background. Design decisions behind it are in `docs/architecture.md` sections 1 to 4.

## Context

::: mermaid
flowchart LR
  USER["Firm user: Edge or Chrome, domain-joined"] -->|"HTTPS, Windows auth"| IIS
  subgraph SERVER["Windows Server on the firm network"]
    IIS["IIS site: Windows auth on, anonymous off"] --> APP["ASP.NET Core 10 in process: /api and Angular static files"]
    APP -->|"integrated security, app pool identity"| SQL[("SQL Server: LPT Hub database")]
    APP -.->|"optional profile lookup, off by default"| AD[("Active Directory")]
  end
  OUTLOOK["New Outlook"] -.->|"drag and drop or paste an email"| USER
  REPORTUSER["Report authors"] -->|"read-only report login: lpt_report_reader"| SQL
:::

In development the picture is the same without IIS: the Angular dev server (port 4200) proxies `/api` to Kestrel (port 5080), and Dev authentication replaces Windows authentication.

## Containers

::: mermaid
flowchart TB
  subgraph FE["frontend/ (Angular 21)"]
    APPSHELL["App shell and routes"]
    FEAT["features/*: lazy pages"]
    SHARED["shared/* and core/*"]
    GEN["api/generated: NSwag client"]
    FORM["projects/form-engine"]
  end
  subgraph BE["backend/src/LptHub.Api (host)"]
    MWARE["Middleware and filters"]
    CTRL["Controllers in module Api folders"]
    APPSVC["Application services in modules"]
    DB["LptHub.Data: LptHubDbContext and interceptors"]
    MIG["SchemaMigrations runner"]
  end
  SQL[("SQL Server 2022")]
  SCRIPTS["db/scripts/*.sql embedded in LptHub.Data"]
  APPSHELL --> FEAT --> GEN
  FEAT --> SHARED
  FEAT --> FORM
  GEN -->|"/api/v1 JSON"| MWARE --> CTRL --> APPSVC --> DB --> SQL
  SCRIPTS --> MIG --> SQL
:::

| Container | Folder | Notes |
|---|---|---|
| Angular app | `frontend/src/app` | Lazy feature routes; served from `wwwroot` by the API in production |
| API host | `backend/src/LptHub.Api` | Wires modules, middleware, auth, error format, OpenAPI, SPA hosting |
| Modules | `backend/src/Modules/*` | Business logic and controllers; see [Backend Modules](Backend-Modules.md) |
| Data | `backend/src/LptHub.Data` | One `LptHubDbContext` over all modules; cross-module foreign keys are configured here |
| Database | `db/scripts/*.sql` | Applied at startup by the runner, recorded in `dbo.SchemaMigration` |

## Startup sequence

From `backend/src/LptHub.Api/Program.cs` (before the host listens):

1. If `--migrate-only` (or `LPTHUB_MIGRATE_ONLY=true`) is given, apply the schema and exit.
2. Build the host: register all modules (`ModuleComposition.AddLptHubModules`), controllers, JSON options, health checks, authorization, schema migrations, exception handler, problem details, rate limiting, OpenAPI.
3. `RunSchemaMigrationsAsync`: take the application lock, apply pending scripts in numeric order, record each in `dbo.SchemaMigration` (skipped when the build-time OpenAPI generator starts the app).
4. `RunModuleSeedsAsync` (under `SeedLock`): sync the permission catalog and starter roles (Identity), configuration seeds, the optional starter configuration (task types, workflows, forms, priorities), and reindex asset values.
5. `AuditStoreGuard` and `DatabaseSettingsCheck`: refuse to start when the API's own database identity could rewrite the audit trail (Production).
6. Build the pipeline (see [Request Lifecycle](Request-Lifecycle.md)) and listen.

Seeds can be turned off with `Seeds:Enabled=false`; migrations with `Migrations:Enabled=false` (production uses `--migrate-only` instead).

## Background work

The host has one background job: `NotificationSchedulerService` in `LptHub.Notifications` (a `BackgroundService` with a 5 minute timer). Each tick takes the SQL Server application lock `Notifications.Scheduler` without waiting, then runs jobs in order: `task-due`, `task-stalled` and (at most once a day) `retention`. Details: [Notifications Audit and Settings](Notifications-Audit-and-Settings.md). There is no message bus; modules call each other synchronously through Contracts.

## Key design decisions (short)

| Decision | Where |
|---|---|
| Modular monolith, one deployable | `docs/architecture.md` section 5 |
| Schema by a baseline script plus numbered SQL scripts, EF for data access only | section 4, `db/scripts/README.md` |
| Optimistic concurrency with `rowVersion` | section 10 |
| Hybrid transactional audit | section 9 |
| Permission-based authorization, never role names | section 6 |
| Signals and facade services, no NgRx | section 12 |
| PrimeNG with the Aura preset and shared wrappers | section 12 |

See [Decision Index](../Reference/Decision-Index.md) for more.

## Related pages

- [Backend Modules](Backend-Modules.md)
- [Deployment and Hosting](Deployment-and-Hosting.md)
- [Database Overview](../Database/Overview.md)

Last verified against commit ba461d2.
