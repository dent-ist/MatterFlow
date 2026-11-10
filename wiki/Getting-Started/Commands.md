# Commands

[[_TOC_]]

**What this page is for.** Every command a developer runs regularly: build, test, lint, format, e2e, client generation, database. Commands come from `README.md`, `CLAUDE.md`, `backend/`, `frontend/package.json` and the root `package.json`.

## Backend (run in `backend/`)

| Task | Command | Notes |
|---|---|---|
| Build like CI | `dotnet build -warnaserror` | CI builds `-c Release --no-restore -warnaserror`; warnings are errors |
| Fast tests | `dotnet test tests/LptHub.UnitTests` | No Docker |
| Architecture tests | `dotnet test tests/LptHub.ArchitectureTests` | No Docker |
| All tests | `dotnet test` | Needs Docker (Schema and Integration tests start SQL Server) |
| One test | `dotnet test tests/LptHub.UnitTests --filter "FullyQualifiedName~Name"` | |
| Format check | `dotnet format --verify-no-changes` | CI uses `dotnet format --no-restore --verify-no-changes` |
| Run the API | `dotnet run --project src/LptHub.Api` | Needs connection strings, see [Local Setup](Local-Setup.md) |
| Apply schema only | `dotnet run --project src/LptHub.Api -- --migrate-only` | Also `LPTHUB_MIGRATE_ONLY=true` (`Hosting/MigrateOnlyCommand.cs`) |
| Regenerate OpenAPI | `dotnet build` (the API build writes `contracts/openapi/v1.json`) | Then regenerate the client, see below |

## Frontend (run in `frontend/`)

| Task | Command | Notes |
|---|---|---|
| Install | `npm ci` | `.npmrc` sets `legacy-peer-deps` |
| Dev server (stub API) | `npm start` | In-memory stub, no backend needed |
| Dev server (real API) | `npm run start:api` | Proxies `/api` to `http://localhost:5080` (`proxy.conf.json`) |
| Unit tests | `npm test` | Vitest for the app and the `form-engine` library |
| Lint | `npm run lint` | ESLint plus the theme colour, theme contrast, icon size and off-scale scripts |
| Format check | `npm run format:check` | Prettier over `src`, `projects`, `e2e` |
| Production build | `npm run build` | Initial bundle must stay under 700 kB (owner rule) |
| Bundle report | `npm run build:report` | `scripts/bundle-report.mjs` |
| Generate API client | `npm run api:generate` | Runs `nswag run nswag.json` into `src/app/api/generated/api-client.ts` |
| Angular CLI | `npm run ng -- <command>` | For example `npm run ng -- build form-engine` |
| End to end | `npm run e2e` | `bash e2e/run-local.sh`: throwaway SQL Server container plus published API |
| Playwright only | `npm run e2e:run`, `npm run e2e:report`, `npm run e2e:typecheck` | |

## Root (run in the repository root)

| Command | Meaning |
|---|---|
| `npm run setup` | `npm --prefix frontend ci` and build the `form-engine` library |
| `npm start` | `db:up`, `form-engine`, then API, web and report login together |
| `npm run db:up` / `db:down` | Start or stop SQL Server (and create database and report login) |
| `npm run db:reset` | Delete the database volume and start fresh |
| `npm run seed:demo` | Fill a running app with demo data |
| `node contracts/validate-contracts.mjs` | Check the form-rule schema, vectors and messages |

## Before you commit

1. Backend: `dotnet build -warnaserror`, `dotnet test tests/LptHub.UnitTests`, `dotnet test tests/LptHub.ArchitectureTests`, `dotnet format --verify-no-changes`.
2. Frontend: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`.
3. If the API changed: regenerate `contracts/openapi/v1.json` and the client (`npm run api:generate`) and commit both.
4. UI work: the extra checks in [UI Standard](../Frontend/UI-Standard.md).

## Related pages

- [Continuous Integration](Continuous-Integration.md)
- [Testing the Backend](../Backend/Testing-the-Backend.md)
- [Testing the Frontend](../Frontend/Testing-the-Frontend.md)
- [API Contracts](../Architecture/API-Contracts.md)

Last verified against commit b03d0ac.
