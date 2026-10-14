# MatterFlow

Internal law-firm eDiscovery Matter and Task tracker. ASP.NET Core (.NET 10) + SQL Server + Angular 21 (PrimeNG).

Design documents live in `docs/` (start with `docs/architecture.md`; environment notes in `docs/dev-environment.md`).

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | .NET solution `MatterFlow.sln`: `src/MatterFlow.Api` (host), `MatterFlow.SharedKernel`, `MatterFlow.Data`, `src/Modules/*` (one project per module plus `.Contracts`), `tests/*` |
| `frontend/` | Angular 21 workspace (`src/` app, `projects/form-engine` library) |
| `contracts/` | Cross-stack contracts (OpenAPI, form-rule schema and vectors, permission catalog) |
| `db/scripts/` | Numbered, immutable SQL schema scripts (see its README) |
| `docs/` | Requirements, architecture, ERD, UX spec and tokens |
| `.github/workflows/` | CI |

## Prerequisites

- .NET SDK 10 (`global.json`). On Debian/Ubuntu: `apt-get install -y dotnet-sdk-10.0`.
- Node.js 22 and npm. **Angular CLI is pinned to v21** (the latest CLI needs a newer Node). Always use the repo-local CLI
  (`npm run ng -- ...` or `npx ng ...` inside `frontend/`), or `npx @angular/cli@21`.
- SQL Server 2022 for local runs and integration work (`docker compose -f docker-compose.dev.yml up -d`; see `docs/dev-environment.md`).

## Backend

```bash
cd backend
dotnet build                 # add -warnaserror to match CI
dotnet test                  # unit, architecture, schema and smoke integration tests
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

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `dev`: backend (build with warnings as errors, format check, all
test projects) and frontend (`npm ci`, lint, format check, tests, production build).
