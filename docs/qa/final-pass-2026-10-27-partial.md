# Combined verification pass, 2026-10-27: PARTIAL (paused by the owner)

Pinned SHA: `3f82cd9661287eb4afc89e0c52dd34b957294cba` (origin/dev when the pass started). The owner paused the pass because the Project Manager v2 work changes too much for this run to stay valid; the full pass is to be re-run from scratch at the end of that work. This page records what was done so far. No fixes were made, so no code was pushed; this page is the only commit.

Setup: own worktree at the pinned SHA with its own `npm ci`, `deploy/publish.sh` with `SKIP_FRONTEND_INSTALL=1` (linux-x64), `dotnet build -nodeReuse:false -p:UseSharedCompilation=false` then `dotnet build-server shutdown`, own SQL container and one API (port 5481, Dev auth, `Features__SensitiveMatterAccess=false`), `E2E_AXE_PATH` at a copy of `axe.min.js`, Chromium from `/opt/pw-browsers`, `--workers=1`, every heavy command through `heavy.sh`. The machine was shared with other agents (load average about 6), which made the timed tests slower than on 2026-10-23.

## Results

| Suite | Command | Result |
|---|---|---|
| Backend format | `dotnet format --verify-no-changes` | clean |
| Backend build | `dotnet build -warnaserror -nodeReuse:false -p:UseSharedCompilation=false` | 0 warnings, 0 errors. The final tree of the My Matters fixes (#824 to #827) rebased onto the profile commits builds; only the final tree was built, not the first two commits in isolation |
| Unit | `dotnet test tests/MatterFlow.UnitTests` | 2268 passed |
| Architecture | `dotnet test tests/MatterFlow.ArchitectureTests` | 47 passed |
| Schema | `dotnet test tests/MatterFlow.SchemaTests` | 94 passed |
| Integration (full, once) | `dotnet test tests/MatterFlow.IntegrationTests` | 1512 passed, 1 failed (1 h 53 m, machine shared) |
| SQL scripts 28 to 39 | listing, grep | consecutive (28 matter-managers ... 39 activity-seen-initial). Scripts 34 to 39 create no table (`CREATE TABLE` absent), so no new `db/report-access.json` entry is needed; script 35 has the explicit `DENY SELECT` for `mf_report_reader` on the three visibility functions. Schema tests (report-access rule) green |
| OpenAPI / client drift | Release build of the Api, `npm run api:generate`, `git status` | no diff |
| Frontend lint / format | `npm run lint`, `npm run format:check` | clean |
| Frontend unit | `npm test` | 4019 passed (323 files) + form-engine 319 passed |
| Production build | `npm run build` | initial total **629.21 kB** (limit 700 kB). One style budget warning, not an error: `roles-page.scss` 6.03 kB over 5.00 kB (predates the pass, was 5.80 kB) |
| Contracts | `node contracts/validate-contracts.mjs` | OK |
| Playwright full run, rule OFF, fresh DB | `playwright test --workers=1` | **stopped by the coordinator at test 2618 of 2679** (about 4.5 h in); 18 failures seen, 2600 other results not failing; no JSON report was written, so error messages were not captured |

## Failures and classification

None of these was investigated beyond naming it (the pass was stopped), so none is classified as a real bug yet. "Likely" is a guess from the earlier pass.

| Failure | Class | Note |
|---|---|---|
| Integration `MyMattersPerformanceTests.Search_with_the_in_my_matters_flag_is_not_slower_than_search_without_it_by_more_than_ten_percent` | F (load), likely | The absolute p95 budget of 600 ms was missed by 6 ms (606 ms with the flag); the same run measured 594 ms p95 and 455 ms median WITHOUT the flag, so the machine, not the flag, was slow. The relative check (median within 10 percent) passed. Re-run alone on a quiet machine in the final pass |
| `as2-record-page.spec.ts:133` Set inactive from the overflow | unknown | asset-record-page focus family; confirm the RecordLoadFlow fix |
| `column-filters.spec.ts` 57, 77, 121, 135, 186, 225 (Assets screen, six in a row) | unknown, **look first** | six consecutive failures in one file looks like one cause (a changed Assets screen or a stale test), not load |
| `dashboard-audit.spec.ts:242` trend chart keyboard | unknown | |
| `dashboard-trends-types.spec.ts` 150, 460, 512, 538 | unknown | four in one file: one cause likely |
| `ty-permissions-matrix.spec.ts:458` System Admin menu and tab strip | unknown | may be stale after the App shell or Project Manager menu changes |
| `ty3-lists.spec.ts:91` row menu at 375 | unknown | |
| `ty5-workflow.spec.ts:299` Deactivate dialog | unknown | |
| `users-us-copy-roles.spec.ts:137` (1.0 m), `users-us4-drawer.spec.ts:255` (1.1 m), `users-us7-flows.spec.ts:240` (52.6 s) | D / F, likely | long roles list (one Tab stop per role) and timeouts, as in the previous pass |

Passed in this partial run, so not reproduced: `client-detail-page`, `sh-route-announce`, `pm4-bulk-tasks`, `t8-edit-create`, `ad3`, `ad5`, `as757`, `clients-keyboard` (all ran before test 2618 without a failure line; issue #823 is therefore NOT closed, since the sensitive specs and the run end were not reached).

## What was NOT run

The last 61 Playwright tests (alphabetically after `users-us7-flows`), the sensitive-matter run with `Features__SensitiveMatterAccess=true` on a fresh database (sensitive-leak-scan, sensitive-ui, persona and endpoint catalog integration tests are part of the full integration run above, which passed apart from the timing test), the re-run of the failures on a used database, classification of the 18 failures, the shortcut check (#420), issue closing (#823 and others). Nothing was fixed or opened.

## The final pass must repeat

Everything above on the new dev SHA (the table is a baseline: unit 2268, architecture 47, schema 94, integration 1513, frontend 4019 + 319, initial bundle 629.21 kB), plus a full Playwright run with the rule off, the sensitive specs with the rule on (fresh database), classification of every failure (start with `column-filters`, `dashboard-trends-types`, `ty-permissions-matrix`), the timing test on a quiet machine, #823 evidence, and the shortcut check.

## Effort

About 8 agent-hours of wall clock, nearly all waiting for the machine (integration 1 h 53 m, Playwright 4.5 h); under 1 hour of reading and tooling.
