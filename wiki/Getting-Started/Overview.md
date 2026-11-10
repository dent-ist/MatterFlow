# Overview

[[_TOC_]]

**What this page is for.** A short explanation of what LPT Hub does and of the technology and building blocks you will meet in the code. Read this first, then [Repository Map](Repository-Map.md).

## What LPT Hub is

LPT Hub is an internal law-firm **eDiscovery Matter and Task tracker**. People in the eDiscovery department create **Tasks** (for example "Production" or "Analytics / TAR Setup") against **Matters** (client cases). Each Task type can have a **Workflow** (a list of Steps) that technicians complete. Leads and directors watch the work on a **Dashboard**; Project Managers follow their own matters in **My Matters**.

Status (from `CLAUDE.md`, owner, 2026-10-24): LPT Hub has not been deployed and nobody is using it. All data is demo or test data. The repository will later be made private and moved to the corporate network.

## Technology

| Layer | Technology | Where |
|---|---|---|
| Backend | ASP.NET Core on .NET 10, modular monolith, EF Core for data access (no EF migrations), FluentValidation | `backend/` |
| Database | SQL Server 2022, schema = one baseline script plus numbered SQL scripts | `db/scripts/` |
| Frontend | Angular 21 (standalone components, signals), PrimeNG with the Aura preset, Tiptap rich text editor | `frontend/` |
| Contracts | OpenAPI document (generated, committed), permission catalog, form-rule schema and vectors | `contracts/` |
| Tests | xUnit (unit, architecture, schema, integration with Testcontainers), Vitest (frontend), Playwright (end to end, with axe accessibility checks) | `backend/tests/`, `frontend/`, `frontend/e2e/` |
| Hosting | Windows Server with IIS and Windows authentication (the API also serves the Angular build) | `deploy/` |

## Main building blocks

::: mermaid
flowchart TB
  subgraph Browser
    FE["Angular app: features, shared, core"]
  end
  subgraph Host["LptHub.Api (host)"]
    MW["Middleware, auth, filters"]
    MOD["Modules: Identity, Audit, Configuration, Organization, Assets, WorkflowEngine, WorkManagement, WorkViews, Search, Intake, Notifications, Reports, Productions, Notes"]
    DATA["LptHub.Data: DbContext, interceptors, schema runner"]
  end
  DB[("SQL Server: dbo schema")]
  FE -->|"/api/v1"| MW --> MOD --> DATA --> DB
:::

- **Modules** own their tables, services and controllers. They talk to each other only through `.Contracts` projects. See [Backend Modules](../Architecture/Backend-Modules.md).
- **The host** (`LptHub.Api`) wires everything: middleware, authentication, error format, OpenAPI, startup migration and seeds. See [Request Lifecycle](../Architecture/Request-Lifecycle.md).
- **The schema** is built at startup from `db/scripts/00-baseline.sql` and the numbered scripts after it. See [Database Overview](../Database/Overview.md).
- **The frontend** is lazy-loaded feature folders on top of shared UI components and a generated API client. See [Frontend Architecture](../Architecture/Frontend-Architecture.md).

## Where the design decisions are

| Document | Purpose |
|---|---|
| `docs/architecture.md` | Source of truth for design decisions (ADR summary in section 1, modules in section 5, auth in section 6, API conventions in section 11) |
| `docs/requirements/decisions-addendum.md` | Owner decisions by section letter; overrides the baseline |
| `docs/requirements/baseline-v1.1.md` | The original requirements |
| `docs/ux/design-guidelines.md` | The UI standard (rules D-xx) |
| `docs/erd.md` | Logical ERD written at the start; see the warning on [Database Overview](../Database/Overview.md) |
| `docs/runbook.md` | Operations: install, upgrade, backup, troubleshooting |

See [Documentation Map](../Reference/Documentation-Map.md) for every file in `docs/`.

## Not implemented

`app-framework/` holds design documents for a planned app and extension framework. It is not implemented code and nothing in `backend/` or `frontend/` depends on it.

## Related pages

- [Repository Map](Repository-Map.md)
- [System Overview](../Architecture/System-Overview.md)
- [Glossary](../Reference/Glossary.md)

Last verified against commit b03d0ac.
