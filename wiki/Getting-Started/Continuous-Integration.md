# Continuous Integration

[[_TOC_]]

**What this page is for.** What the GitHub Actions workflows check, when they run, and how to reproduce each check on your machine before you push. Source: `.github/workflows/*.yml`, `.github/actions/setup-dotnet`, `.github/dependabot.yml`.

## Workflows

| Workflow | When | What it does |
|---|---|---|
| `ci.yml` | Push to `dev` and every pull request, except changes that only touch `docs/**` or `*.md` (so wiki-only changes do not run it) | Three parallel jobs, below |
| `e2e.yml` | Manually, weekly (Mondays 03:43 UTC), and on pull requests carrying the label `e2e` | Playwright suite against a real stack, in 14 parallel jobs, each with its own stack: 12 shards of the `chromium` project (`--project=chromium --shard=1/12` to `12/12`, about 218 tests each, one worker), the `branding` spec alone (`--project=branding --no-deps`, 18 tests) and the `sensitive-*` specs on a stack with the sensitive-matter switch on (14 tests); 40-minute job limit and 35-minute test step limit each, plus one `e2e (result)` job that fails when any of them did not succeed |
| `nightly.yml` | Weekly (Mondays 03:17 UTC) and manually | Full backend suite with code coverage (`backend-quick` for unit and architecture tests, and the same seven `backend-integration` shards as `ci.yml`; keep the lists in step), frontend test and build, NuGet vulnerability scan, `npm audit --omit=dev --audit-level=high` |
| `publish.yml` | Manually | Builds the IIS package with `deploy/publish.sh ... win-x64` and checks its contents; uploads it as an artifact |
| `codeql.yml` | Weekly (Mondays 04:41 UTC) and manually | CodeQL analysis for C# and JavaScript/TypeScript |
| Dependabot | Monthly, grouped | Minor and patch updates only; major versions are ignored on purpose (owner, 2026-10-24) |

## The three jobs of `ci.yml`

| Job | Steps | Reproduce locally |
|---|---|---|
| `backend` | Build `-c Release -warnaserror`; OpenAPI drift check (`git diff --exit-code -- ../contracts/openapi/v1.json` after the build); `dotnet format --verify-no-changes`; unit and architecture tests | In `backend/`: `dotnet build -warnaserror`, then `git diff --exit-code -- ../contracts/openapi/v1.json`, `dotnet format --verify-no-changes`, `dotnet test tests/LptHub.UnitTests`, `dotnet test tests/LptHub.ArchitectureTests` |
| `backend-integration` (7 parallel shards) | Per shard: pre-pull the SQL Server image, build, run one slice of `LptHub.IntegrationTests` (by namespace; the last shard `integration-rest` takes every namespace not named elsewhere) or all of `LptHub.SchemaTests`, each in its own SQL Server container; about 8 to 11 minutes per shard, 30-minute job limit, 22-minute test step limit; results upload per shard (`backend-test-results-<shard>`) | Needs Docker: `dotnet test tests/LptHub.IntegrationTests` and `dotnet test tests/LptHub.SchemaTests` (all of it, one container, about 35 minutes), or one slice with `--filter "FullyQualifiedName~LptHub.IntegrationTests.Reports."` |
| `frontend` | `npm ci`; `npm run lint`; `npm run format:check`; `npm test` (`scripts/run-ng-test.mjs`: runs `ng test` for the app and `form-engine`, and ends the run after the Vitest summary because the Angular test process does not exit by itself; 15-minute step limit); API client drift check (`npm run api:generate` then `git diff --exit-code -- src/app/api/generated`); `npm run build` (`scripts/run-ng-build.mjs`: runs `ng build` and ends the run after its `Output location` line, because the `ng` process does not exit by itself; fails on a non-zero exit or an `[ERROR]` line, bundle budgets included; 10-minute step limit). The job limit is 30 minutes (about 12 are used) | In `frontend/`: the same commands |

A newer push to the same branch or pull request cancels the run in progress.

## Common reasons CI fails

| Symptom | Cause and fix |
|---|---|
| OpenAPI drift | You changed an endpoint or DTO and did not commit the regenerated `contracts/openapi/v1.json`. Build the backend and commit the file. |
| API client drift | You changed the OpenAPI document and did not run `npm run api:generate`. Commit `src/app/api/generated/`. |
| Architecture test failure | A module references something it must not, or a controller action has no policy, or a new endpoint is not in `SensitiveAccessCatalog`. See [Backend Modules](../Architecture/Backend-Modules.md) and [Testing the Backend](../Backend/Testing-the-Backend.md). |
| `ReportAccessCatalogueTests` fails | A new table is not classified in `db/report-access.json` and not granted or denied in its script. See [How to Change the Schema](../Database/How-to-Change-the-Schema.md). |
| Format check | Run `dotnet format` or `npx prettier --write` on the changed files. |
| Lint colour or icon-size scripts | A colour literal or off-scale size in a template or stylesheet; use the tokens. |
| Duplicate script prefix | Two scripts share a number; renumber the unmerged one. |

## Related pages

- [Commands](Commands.md)
- [Troubleshooting](../Operations/Troubleshooting.md)
- [Release Checklist](../How-To/Release-Checklist.md)

Last verified against commit b03d0ac.

## Test shards of `backend-integration`

All integration tests share one SQL Server collection, so they run one after the other in a single container; the whole project takes about 35 minutes and did not fit one job (issue #1353). `ci.yml` therefore runs the project in parallel shards, split by namespace. Test names per shard (`dotnet test --list-tests`, 2026-11-10; the shards together list exactly the 1,922 integration and 111 schema test names of the old single run, no test is dropped; `WorkViews` took about 19 minutes in one shard and was split in run 580's follow-up, #1354):

| Shard | Namespaces | Tests |
|---|---|---|
| `integration-work-views-dashboard-my-matters` | `WorkViews` classes whose name starts with `Dashboard` or `MyMatters` | 339 |
| `integration-work-views-other` | the other `WorkViews` classes | 261 |
| `integration-reports-notifications-audit` | `Reports`, `Notifications`, `Audit` | 322 |
| `integration-tasks-workflows` | `Tasks`, `Workflows`, `WorkManagement`, `Visibility` | 283 |
| `integration-identity-organization-security` | `Identity`, `Organization`, `Security` | 324 |
| `integration-rest` | everything not named above (`Assets`, `Configuration`, `Search`, `Settings`, `Forms`, `Intake`, `Seeding` and the classes at the project root) | 393 |
| `schema` | all of `LptHub.SchemaTests` | 111 |

When you add a namespace it runs in `integration-rest` without any change. When a shard grows past about 15 minutes, move a namespace into its own shard: add it to a `filter` and to the negation list of `integration-rest` (the lists must stay disjoint). `nightly.yml` repeats the same matrix; change both files together.

The required status checks for branch protection are the job names `backend`, `frontend` and one `backend-integration (<shard>)` per shard of the table above (seven names).

## E2E shards

Counts from `npx playwright test -c e2e/playwright.config.ts --list` (2026-11-10): 2,635 tests in 325 files = 2,617 in the `chromium` project (324 files) + 18 in `branding` (1 file). The 14 `sensitive-*` tests are part of the `chromium` count: they skip themselves in the 12 shards (switch off) and run in the sensitive-matter job.

- Why not `--shard=i/4` on the whole suite (run 42881292528, #1356): Playwright keeps a project together with the projects it depends on, and `branding` depends on `chromium`, so shard 1 got all 2,635 tests (one worker, cut by the 35-minute step limit at test 501) and shards 2 to 4 got none and passed in about two minutes, because Playwright exits 0 for an empty shard.
- Now: `--project=chromium --shard=i/12` gives 214 to 222 tests per shard (about 2 s per passing test, 8 s per failed attempt with its retry, so about 15 to 20 minutes plus 3.5 minutes for the build and the stack). Each job first runs `--list` and fails when it would run 0 tests. `branding` runs alone because it changes the application name for everybody.
- To change the shard count, change `/12` and the matrix entries together; check with `--list` that the slices add up to 2,617 tests. Make `e2e (result)` the required check instead of the single jobs.
