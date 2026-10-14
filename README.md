# MatterFlow

Internal law-firm eDiscovery Matter and Task tracker. ASP.NET Core (.NET 10) + SQL Server + Angular 21 (PrimeNG).

Design documents live in `docs/` (start with `docs/architecture.md`; environment notes in `docs/dev-environment.md`).

## Status

Working end to end today: identity and access (Windows/Dev auth, JIT provisioning, roles and permissions, Access Pending), audit,
organization (clients, matters, projects with custom fields), configuration (priorities, task types, status labels), forms and the
custom-field engine, workflow definitions and instances, assets, the admin screens, and the Angular shell with the lazy-loaded feature areas.
The Task module (creation, lifecycle, queues) is being built; Outlook intake, search and the e2e suite come later. The phase plan is in
`docs/architecture.md` section 18.

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | .NET solution `MatterFlow.sln`: `src/MatterFlow.Api` (host), `MatterFlow.SharedKernel`, `MatterFlow.Data`, `src/Modules/*` (one project per module plus `.Contracts`), `tests/*` |
| `frontend/` | Angular 21 workspace (`src/` app, `projects/form-engine` library) |
| `contracts/` | Cross-stack contracts (OpenAPI, form-rule schema and vectors, permission catalog) |
| `db/scripts/` | Numbered, immutable SQL schema scripts (see its README) |
| `docs/` | Requirements, architecture, ERD, UX spec and tokens |
| `.github/` | GitHub Actions workflows, the shared `setup-dotnet` action, Dependabot config |
| `docker-compose.dev.yml` | Local SQL Server 2022 (see below) |
| `tools/` | Helper tooling and spikes |

## Prerequisites

- .NET SDK 10 (`global.json`). On Debian/Ubuntu: `apt-get install -y dotnet-sdk-10.0`.
- Node.js 22 and npm. **Angular CLI is pinned to v21** (the latest CLI needs a newer Node). Always use the repo-local CLI
  (`npm run ng -- ...` or `npx ng ...` inside `frontend/`), or `npx @angular/cli@21`.
- SQL Server 2022 for local runs and integration work (`docker compose -f docker-compose.dev.yml up -d`; see `docs/dev-environment.md`).

## Backend

```bash
cd backend
dotnet build                 # add -warnaserror to match CI
dotnet test                  # everything: unit, architecture, schema and integration tests (the last two need Docker)
dotnet test tests/MatterFlow.UnitTests   # fast, no Docker (also tests/MatterFlow.ArchitectureTests)
dotnet run --project src/MatterFlow.Api   # http://localhost:5080, liveness at /health/live
dotnet format --verify-no-changes         # style check used by CI
```

### Adding to a module

Each module is its own project under `backend/src/Modules/` organised as `Domain/`, `Application/`, `Infrastructure/`, `Api/`
(controllers are discovered through the module's application part). Public interfaces go in the module's `.Contracts` project.
A module may reference only `SharedKernel` and other modules' `.Contracts` projects; the allowed graph is enforced by
`MatterFlow.ArchitectureTests` (architecture section 5.2). Each module registers itself with `Add<Module>Module(IServiceCollection)`;
all modules are listed in one place, `backend/src/MatterFlow.Api/ModuleComposition.cs`.

NuGet versions are centrally managed in `backend/Directory.Packages.props`.

## Frontend

```bash
cd frontend
npm ci                       # a .npmrc sets legacy-peer-deps (npm 10 cannot resolve the default tree otherwise)
npm start                    # dev server on http://localhost:4200, /api proxied to http://localhost:5080
npm run build                # production build to dist/
npm test                     # Vitest (jsdom) for the app and the form-engine library
npm run lint                 # angular-eslint
npm run format:check         # Prettier
```

Design tokens come from `docs/ux/tokens.css` (loaded through `angular.json` styles); PrimeNG uses the Aura preset.

## Walking skeleton: run it end to end

Login -> Access Pending -> admin grants a role -> dashboard (baseline 6.4 scenario 3). Needs Docker for SQL Server 2022
(in the cloud container start the daemon first: `nohup dockerd >/tmp/dockerd.log 2>&1 &`, see `docs/dev-environment.md`).

```bash
# 1. SQL Server with an empty MatterFlow database (password and port are in docker-compose.dev.yml)
docker compose -f docker-compose.dev.yml up -d

# 2. API (creates the schema and seeds the permission catalog and starter roles on first start)
cd backend
export ConnectionStrings__Default='Server=localhost,1433;Database=MatterFlow;User Id=sa;Password=MatterFlow_Dev1!;TrustServerCertificate=True'
export ConnectionStrings__MatterFlow="$ConnectionStrings__Default"
export Bootstrap__SystemAdmins__0='KE\kekim'      # first System Admin (granted once, at this account's first sign-in)
export Auth__Dev__DefaultUser='KE\newhire'         # the Dev provider signs every browser request in as this user
dotnet run --project src/MatterFlow.Api            # http://localhost:5080

# 3. Frontend against the real API (the default `npm start` uses an in-memory stub and needs no backend)
cd ../frontend && npm ci && npm run start:api      # http://localhost:4200
```

1. Open http://localhost:4200 as `KE\newhire`: the user is provisioned with no roles and lands on **Access Pending**.
2. Stop the API and restart it with `Auth__Dev__DefaultUser='KE\kekim'` (the bootstrap admin). **Administration > Users & Roles** shows
   `KE\newhire` under *Pending access* (the nav item carries the pending count).
3. Open the user, tick a role (create one first under **Roles & Permissions**, e.g. a role with `Task.View`), **Save**.
4. Restart as `KE\newhire` and press **Check again** on Access Pending (or reload): the dashboard and permitted screens appear.

Without a browser, the Dev provider also accepts the `X-Dev-User` header, for example
`curl -H 'X-Dev-User: KE\kekim' 'http://localhost:5080/api/v1/users?status=pending'`.
The same flow is covered by an automated test: `backend/tests/MatterFlow.IntegrationTests/Identity/WalkingSkeletonTests.cs`
(Testcontainers, real SQL Server).

## Local SQL Server (docker compose)

```bash
docker compose -f docker-compose.dev.yml up -d --wait   # SQL Server 2022 on localhost:1433, empty database MatterFlow
docker compose -f docker-compose.dev.yml down           # stop; add -v to also delete the data volume
```

The dev password is in the compose file (`MatterFlow_Dev1!`, not a secret). The compose file only creates the empty database;
the API creates the schema itself.

## Migrations

Schema changes are numbered SQL scripts in `db/scripts/` (immutable once merged; fix forward with a new script, see `db/scripts/README.md`).
The API applies pending scripts at startup before it listens (`Migrations:Enabled`, default true), under an application lock, and
records them in `dbo.SchemaMigration` with checksums. There are no EF migrations. Connection string: `ConnectionStrings:Migrations`,
falling back to `ConnectionStrings:Default`; the application uses `ConnectionStrings:MatterFlow`. Design: `docs/architecture.md` section 4.

## Configuration and dev authentication

| Setting | Meaning |
|---|---|
| `Auth:Provider` | `Windows` (IIS, production) or `Dev`. Unset means `Dev` in Development and `Windows` elsewhere; `Dev` is refused in Production. |
| `X-Dev-User` header | With the Dev provider, names the calling user (for example `KE\alice`); the query form `?devUser=` also works. Unknown names are provisioned like a first login. |
| `Auth:Dev:DefaultUser` | User signed in when a request names none (what the browser gets). Empty means 401. |
| `Dev:Users` | Optional seeded users: `[{ "Username": "KE\\alice", "DisplayName": "Alice", "Email": "...", "Roles": ["..."] }]` (Dev provider only). |
| `Bootstrap:SystemAdmins` | Accounts that become System Admin at their first sign-in (production value: `ke\kekim`). |
| `Seed:StarterConfiguration:Enabled` | Seeds starter task types, workflows, forms and priorities at startup. Default on in Development, off elsewhere; `DryRun` only logs. Never overwrites admin edits. |
| `ActiveDirectory:LookupEnabled` | Optional AD profile lookup (off by default). |
| `Firm:TimeZoneId` | Fallback time zone (default `America/New_York`). |

## CI

| Workflow | When | What |
|---|---|---|
| `ci.yml` | PRs and pushes to `dev` | `backend` (build with warnings as errors, OpenAPI drift, format, unit and architecture tests), `backend-integration` in parallel (SQL Server in Docker via Testcontainers: integration and schema tests), `frontend` (lint, format, Vitest, API client drift, production build). TRX results are uploaded as artifacts; NuGet packages are cached and restore retries once. |
| `nightly.yml` | daily and manual | Full backend suite with coverage plus frontend tests and build. |
| `codeql.yml` | push to `dev`, weekly | CodeQL for C# and JavaScript/TypeScript. |
| `e2e.yml` | manual | Placeholder for the Playwright suite (deferred); documents how it will run. |

`.github/dependabot.yml` opens weekly grouped (minor/patch) updates for NuGet, npm and GitHub Actions.

## Deployment

IIS with Windows authentication on a single origin: see `docs/runbook.md`.

## Documentation map

- `docs/architecture.md`: decisions, modules, schema runner, auth, CI outline, build phases
- `docs/requirements/baseline-v1.1.md` and `decisions-addendum.md`: requirements and later decisions
- `docs/erd.md`: data model; `docs/ux/ux-spec.md` and `tokens.css`: UX
- `docs/qa/`: test plan, traceability, risk register, permission matrix tests
- `docs/runbook.md`: deployment and operations; `docs/dev-environment.md`: cloud container notes
- `docs/adr/`: spikes and decision records
