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
- SQL Server 2022 for local runs and integration work (not needed yet for the scaffold; see `docs/dev-environment.md`).

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

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `dev`: backend (build with warnings as errors, format check, all
test projects) and frontend (`npm ci`, lint, format check, tests, production build).
