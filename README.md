# LPT Hub

Internal law-firm eDiscovery Matter and Task tracker. ASP.NET Core (.NET 10) modular monolith + SQL Server 2022 + Angular 21 (PrimeNG).

It tracks Clients, Matters, Projects, Assets, Tasks and the Workflows that run a Task. Production runs on IIS with Windows authentication, on one origin (the API serves the Angular build).

**Where to read more.** The developer wiki in [`wiki/`](wiki/Home.md) is the main guide: setup, architecture, database, how-tos and references. It is published as the Azure DevOps wiki. Design decisions are in [`docs/architecture.md`](docs/architecture.md).

## Status

All Phase 1 features are built and verified end to end (identity and access, clients, matters, projects, assets, the Task module, Task Queue, My Work, Pod Work, Dashboard, search, audit log, reports, hosting). The app has not been deployed yet and all data is demo data. Open work: the UI consistency round on the `ui-update-2` branch (see [`docs/ux/design-guidelines.md`](docs/ux/design-guidelines.md)), a performance pass with realistic data, and a rehearsal on a domain-joined IIS server ([Runbook](wiki/Operations/Runbook.md)). The phase plan is in `docs/architecture.md` section 18.

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | .NET solution `LptHub.sln`: `src/LptHub.Api` (host), `SharedKernel`, `Data`, `src/Modules/*`, `tests/*` |
| `frontend/` | Angular workspace (`src/` app, `projects/form-engine` library, `e2e/` Playwright) |
| `contracts/` | Cross-stack contracts (OpenAPI, form-rule schema, permission catalog) |
| `db/scripts/` | `00-baseline.sql` (the whole schema) and the numbered SQL scripts after it; `archive/` holds the old chain 01 to 66 |
| `deploy/` | IIS publish scripts and settings template |
| `tools/` | Demo data seeder, performance tools, icons |
| `docs/` | Requirements, architecture, UX design, QA reports, runbook |
| `wiki/` | Developer wiki (see above) |
| `app-framework/` | Design documents for a planned extension framework (not code) |

More detail: [Repository Map](wiki/Getting-Started/Repository-Map.md).

## Quick start

Needs Docker, the .NET 10 SDK and Node 22.12+ (use the repo-local Angular CLI: `npm run ng -- ...`).

```bash
npm install        # root helper tools
npm run setup      # frontend dependencies and the form-engine library (first time and after dependency changes)
npm start          # SQL Server (Docker), the API on :5080 and the web app on :4200; Ctrl+C stops both
npm run seed:demo  # optional, from a second terminal: fills the app with demo users, matters and tasks
```

**Existing local database from before the schema baseline (issue #1307)?** The API refuses it at startup with a message; run `npm run db:reset` once (it deletes the local SQL Server volume and rebuilds the database from `db/scripts/00-baseline.sql`; run `npm run seed:demo` again afterwards).

Open http://localhost:4200. You are signed in as the System Admin `KE\kekim` (Dev authentication, which only works in Development and Test). Swagger is at http://localhost:5080/swagger. In a cloud container, start Docker first (`nohup dockerd >/tmp/dockerd.log 2>&1 &`).

Details: [Local Setup](wiki/Getting-Started/Local-Setup.md), [Commands](wiki/Getting-Started/Commands.md), [Demo Data and Personas](wiki/Operations/Demo-Data-and-Personas.md), [Cloud Container Notes](wiki/Getting-Started/Cloud-Container-Notes.md), [Troubleshooting](wiki/Operations/Troubleshooting.md).

## Testing and QA

Pick the level that matches the change. Each level includes the one above it. Run commands from the folder shown.

| Level | Use it when | Needs Docker | Time |
|---|---|---|---|
| 1. Quick check | Before every commit | No | minutes |
| 2. Unit tests | You changed logic in one area | No | minutes |
| 3. Integration tests | You changed the API, database, permissions or a module boundary | Yes | 10 to 20 minutes |
| 4. Full QA | Before merging a branch into `dev`, and before a release | Yes | hours |

**1. Quick check (what CI checks first)**

```bash
cd backend  && dotnet build -warnaserror && dotnet format --verify-no-changes
cd frontend && npm run lint && npm run format:check && npx tsc -p tsconfig.app.json --noEmit
```

**2. Unit tests**

```bash
cd backend  && dotnet test tests/LptHub.UnitTests          # fast; also tests/LptHub.ArchitectureTests (module boundaries)
cd frontend && npm test                                         # Vitest (jsdom): the app and the form-engine library
node contracts/validate-contracts.mjs                          # OpenAPI, form-rule and permission contracts
```

If you changed the API, regenerate the client with `npm run api:generate` (in `frontend/`) and commit the result: CI fails on drift.

**3. Integration tests**

```bash
cd backend  && dotnet test        # everything: unit, architecture, schema and integration tests (SQL Server in Docker through Testcontainers)
```

**4. Full QA**

1. Levels 1 to 3 green, plus `cd frontend && npm run build` (the initial bundle must stay under 700 kB).
2. End-to-end suite on a fresh database: `cd frontend && npm run e2e` (builds, starts SQL Server and the API, runs every Playwright test, tears down; about 3,000 tests). One area: `npm run e2e -- <file or -g pattern>`; the sensitive-matter specs: `npm run e2e -- sensitive-`.
3. Real-stack browser check of every changed page at 1366x768 and 1920x1080, as each role that can see it, with demo data. Run an accessibility check (axe); the target is 0 violations.
4. Performance check when you changed lists or queries: [`tools/perf/README.md`](tools/perf/README.md).
5. Write the result (what was run, what failed, what was NOT run) in a report under `docs/qa/` or the epic's folder, and link it from the issue.

Where these levels fit in a change (pull request, full QA on `dev`, UAT, release): [Change Management Process](wiki/Getting-Started/Change-Management-Process.md).

More: [Testing the Backend](wiki/Backend/Testing-the-Backend.md), [Testing the Frontend](wiki/Frontend/Testing-the-Frontend.md), [Continuous Integration](wiki/Getting-Started/Continuous-Integration.md), [Release Checklist](wiki/How-To/Release-Checklist.md). The end-to-end suite is described in [`docs/qa/e2e.md`](docs/qa/e2e.md) and running the app for a browser check in [`docs/ux/ui-update/stack-howto.md`](docs/ux/ui-update/stack-howto.md).

## Working rules

- **Branches:** the main integration branch is `dev`; see [Branching and Workflow](wiki/Getting-Started/Branching-and-Workflow.md). CI runs on pull requests and pushes to `dev` (`ci.yml`, `e2e.yml`, `nightly.yml`, `codeql.yml`, `publish.yml`): [Continuous Integration](wiki/Getting-Started/Continuous-Integration.md).
- **Backend modules** may reference only `SharedKernel` and other modules' `.Contracts` projects (enforced by `LptHub.ArchitectureTests`): [Backend Modules](wiki/Architecture/Backend-Modules.md), [How to Add a Module](wiki/Backend/How-to-Add-a-Module.md).
- **Database:** the schema is `db/scripts/00-baseline.sql` (one script with every table, index, constraint and trigger) and schema changes after it are numbered SQL scripts from 67, immutable once merged (fix forward with a new script). The API applies them at startup. A database built before the baseline (issue #1307) is refused at startup: rebuild it with `npm run db:reset` (all local data is demo data). No EF migrations: [How to Change the Schema](wiki/Database/How-to-Change-the-Schema.md).
- **API changes** keep `contracts/openapi/v1.json` and the generated frontend client in sync: [API Contracts](wiki/Architecture/API-Contracts.md), [API Client and Generated Code](wiki/Frontend/API-Client-and-Generated-Code.md).
- **Permissions** come from `contracts/permissions.json`: [How to Add a Permission](wiki/Backend/How-to-Add-a-Permission.md), [Permission Catalogue](wiki/Reference/Permission-Catalogue.md).
- **UI** follows one standard, [`docs/ux/design-guidelines.md`](docs/ux/design-guidelines.md) (summary: [UI Standard](wiki/Frontend/UI-Standard.md)). Desktop only (1366x768 and 1920x1080). Add pages and components with [How to Add a Page](wiki/Frontend/How-to-Add-a-Page.md) and the [Shared Components Catalogue](wiki/Frontend/Shared-Components-Catalogue.md).
- **Keyboard shortcuts:** the list is in the app (press `?`) and in `frontend/src/app/shared/layout/shortcut-registry.ts`. New or changed shortcuts are on hold (issue #420).
- **Keep the wiki in step:** when you change the schema, a module, a route, a permission or a setting, update the matching wiki page in the same change: [How to Keep the Wiki Up to Date](wiki/Reference/How-to-Keep-the-Wiki-Up-to-Date.md).

## Configuration and sign-in

Settings are in `appsettings*.json` and environment variables. `Auth:Provider` is `Windows` in production and `Dev` in Development and Test only (any other environment refuses to start with `Dev`). With the Dev provider, the `X-Dev-User` header names the caller. The first System Admin comes from `Bootstrap:SystemAdmins`. Full list: [Configuration Reference](wiki/Operations/Configuration-Reference.md), [Settings Catalogue](wiki/Reference/Settings-Catalogue.md), [Authentication and Authorization](wiki/Architecture/Authentication-and-Authorization.md).

## Deployment

IIS with Windows authentication on a single origin. Build the package with `deploy/publish.sh` (or `deploy/publish.ps1` on Windows). Install, upgrade, rollback and backup steps: [Runbook](wiki/Operations/Runbook.md) and [`docs/runbook.md`](docs/runbook.md). Health checks: `/health/live` and `/health/ready`.

## App version

The version shown at the foot of the navigation panel comes from the `"version"` in the root `package.json` (and the root entry of `package-lock.json`). Change it there and rebuild the frontend. A unit test fails if the two ever disagree.

## Documentation map

- [Developer wiki](wiki/Home.md): start here. Quick answers: [Find Things](wiki/How-To/Find-Things.md), [Glossary](wiki/Reference/Glossary.md), [Documentation Map](wiki/Reference/Documentation-Map.md).
- `docs/architecture.md`: decisions, modules, schema runner, auth, build phases.
- `docs/requirements/`: baseline requirements and later decisions. `docs/erd.md`: data model ([ER Diagrams](wiki/Database/ER-Diagrams.md)).
- `docs/ux/`: UX specification, design tokens, design guidelines and the review and delivery folders for each epic.
- `docs/qa/`: test plan, traceability, risk register, QA reports. `docs/runbook.md`: operations. `docs/adr/`: decision records.
