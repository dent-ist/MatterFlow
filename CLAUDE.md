# MatterFlow

Internal law-firm eDiscovery Matter and Task tracker. ASP.NET Core (.NET 10) modular monolith + SQL Server 2022 + Angular 21 (PrimeNG).
`README.md` has the full setup, run and CI details; `docs/architecture.md` is the source of truth for design decisions.

## Layout

- `backend/` .NET solution `MatterFlow.sln`: `src/MatterFlow.Api` (host), `SharedKernel`, `Data`, `src/Modules/*`, `tests/*`
- `frontend/` Angular workspace (`src/` app, `projects/form-engine` library, `e2e/` Playwright)
- `contracts/` cross-stack contracts (OpenAPI, form-rule schema/vectors, permission catalog); `validate-contracts.mjs` checks them
- `db/scripts/` numbered SQL schema scripts; `deploy/` IIS publish scripts; `tools/` seed-demo, perf, icons; `docs/` design, QA, runbook
- `app-framework/` design docs for a planned app/extension framework (not implemented code)

## Commands

- Whole stack: `npm install && npm run setup && npm start` (needs Docker; API :5080, web :4200)
- Backend (in `backend/`): `dotnet build -warnaserror`, `dotnet test tests/MatterFlow.UnitTests` (fast), `dotnet test` (needs Docker), `dotnet format --verify-no-changes`
- Frontend (in `frontend/`): `npm ci`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run e2e`
- Use the repo-local Angular CLI (`npm run ng -- ...`); the global/latest CLI is incompatible with the Node version.
- Cloud container: start Docker first (`nohup dockerd >/tmp/dockerd.log 2>&1 &`), install .NET via apt; see `docs/dev-environment.md`.

## Rules to respect

- **Module boundaries**: a module (`Domain/`, `Application/`, `Infrastructure/`, `Api/`) may reference only `SharedKernel` and other modules' `.Contracts` projects. `MatterFlow.ArchitectureTests` enforces this. Register new modules in `backend/src/MatterFlow.Api/ModuleComposition.cs`.
- **Schema**: SQL scripts in `db/scripts/` are immutable once merged; fix forward with a new numbered script. No EF migrations.
- **NuGet versions** live in `backend/Directory.Packages.props` only.
- **API changes** must keep the OpenAPI contract in `contracts/openapi` and the generated frontend client (nswag) in sync; CI fails on drift.
- **Permissions** come from `contracts/permissions.json`; keep backend and frontend in step.
- **Shortcuts**: add new keyboard shortcuts in `frontend/src/app/shared/layout/shortcut-registry.ts` together with the handler.
- **Auth**: `Dev` provider is for Development/Test only; production uses Windows auth. Never weaken that guard.
- CI treats warnings as errors and checks formatting (`.editorconfig`, Prettier); run the checks before committing.
- Main integration branch is `dev`.
