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
- **Shortcuts**: add new keyboard shortcuts in `frontend/src/app/shared/layout/shortcut-registry.ts` together with the handler. No new or changed shortcuts in the current phase (owner decision; Phase 2 backlog, issue #420).
- **Status (owner, 2026-10-24)**: MatterFlow has not been deployed and nobody is using it. All data is demo/test data. That is why a data backfill for old rows is rarely needed, but numbered SQL scripts stay immutable once merged (fix forward) so the first real deployment starts from a clean, replayable history. The repo will later be made private and moved to the corporate network.
- **Auth**: `Dev` provider is for Development/Test only; production uses Windows auth. Never weaken that guard.
- CI treats warnings as errors and checks formatting (`.editorconfig`, Prettier); run the checks before committing.
- Main integration branch is `dev`.
- **Wiki**: `wiki/` (published to the Azure DevOps wiki) documents the architecture, database and how-tos. Keep it in step: when you change the schema, a module, a route, a permission or a setting, update the matching wiki page in the same change (see `wiki/Reference/How-to-Keep-the-Wiki-Up-to-Date.md`).

## UI standard (mandatory for every screen, dialog, drawer, menu, button, chip, link, icon, grid, form, message, date, number or label you create or touch)

The app must look and read the same everywhere. The owner's rule: whatever the task, use the one consistent style.

- **Desktop only (owner, 2026-11-04).** Review and test at 1366x768 and 1920x1080. No phone or tablet layouts, checks or issues.
- **One source of truth: `docs/ux/design-guidelines.md`** (rules D-xx, which shared component to use for what, wording and format tables, tokens, the checklist). Read it BEFORE you design or change any UI, and follow it exactly: do not interpret, do not invent a new look. Until that file exists on your branch, use `docs/ux/ui-update/ui-spec.md` with `docs/ux/theme-guide.md` and `docs/ux/tokens.css`. If an issue contradicts the guideline, do what the issue says, say so in your report, and flag it for the UI designer.
- **Keep guideline and code in step.** If your change adds or changes a pattern, update `docs/ux/design-guidelines.md` (and the theme guide) in the same change. A new look that is not in the guideline is a defect. Never leave a screen on its own private style.
- **Use what exists.** Shared components in `frontend/src/app/shared/ui` (and shared filters/layout) and tokens in `docs/ux/tokens.css`. No colour literals, no hard-coded sizes where a token exists (icons use the icon scale 12/16/18/20 px, the 24 px token only in state blocks), no private chip, badge, link, button, card or dialog classes, no hand-built `p-dialog`, no browser-default selects or date styling. Buttons only from the shared theme (theme guide section 9).
- **Words and formats.** Anything you click or that names something is Title Case; text you read is sentence case. Use the shared copy tables and pipes for toasts, empty, loading and error states, dates, numbers, names and confirm dialogs. One date format, one number format. Cancel on the left, the primary action last, Delete far left. Same fact, same name everywhere (Last Updated, Primary PM, ...).
- **Checks before you push UI work:** `npm run lint` (includes the theme colour, contrast and icon-size scripts), the guard specs (capitalisation, icon sizes, link, chip and card style), `tsc` for app, spec and e2e, the Angular template type check (`ngc`), the unit tests, and the build with the initial bundle under 700 kB. Also run an accessibility check (axe) on the pages you changed.
- **Evidence.** Before and after screenshots at 1366x768 and 1920x1080 of every changed screen, dialog, drawer and menu, taken with real or realistic data. Say in your report what you did NOT check.
- **Commit messages for UI changes:** first line `<ID> <short what changed>`, a blank line, then one bullet per main navigation page (and tab or component) that changed, in the app's own menu and tab names, in plain words, so the owner knows what to open and check: `- Dashboard > Users: toolbar buttons are taller`. For shared changes list the shared component first, then the pages where it shows.
- **Who decides the look.** The UI designer role owns `docs/ux/design-guidelines.md`. A new pattern, or a reason to break a rule, goes to the designer; developers do not decide the look by themselves.
