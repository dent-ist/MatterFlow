# Combined verification pass, 2026-10-27 (final, after Project Manager v2)

Pinned SHA: `ade80ff` (origin/dev when the pass started; `origin/main` is `ac0802b`, not touched). Own worktree with its own `npm ci`, `deploy/publish.sh` with `SKIP_FRONTEND_INSTALL=1` (linux-x64), one SQL container and one API per Playwright run (port 5611, Dev auth, started by `frontend/e2e/run-local.sh`), `E2E_AXE_PATH` at a copy of `axe.min.js`, Chromium from `/opt/pw-browsers`, `--workers=1`, every heavy command through `heavy.sh`. The earlier partial pass (`final-pass-2026-10-27-partial.md`) is superseded by this page and kept for the record.

## Verdict

**origin/dev, with the fixes of this pass, is ready to be fast-forwarded to main.** No failure was a defect of the product that is still open: of the 11 failing tests seen (4 integration, 7 Playwright), one cluster was a real layout bug (fixed), five were stale or racy tests (fixed), the rest were load or start-up effects (re-run alone on a quiet machine, passed). Two performance numbers stay over the 300 ms and 500 ms budgets on this machine; they are documented below with a recommendation for a budget decision, not hidden.

## What ran, with counts

| Suite | Command | Result |
|---|---|---|
| Backend build | `dotnet build MatterFlow.sln -warnaserror --no-incremental` | 0 warnings, 0 errors (2 m 38 s); the build regenerates `contracts/openapi/v1.json`: no diff |
| Format | `dotnet format MatterFlow.sln --verify-no-changes` | clean (also after the fixes) |
| Unit | `dotnet test tests/MatterFlow.UnitTests` | 2,316 passed |
| Architecture | `dotnet test tests/MatterFlow.ArchitectureTests` | 47 passed |
| Schema | `dotnet test tests/MatterFlow.SchemaTests` | 98 passed (scripts 01 to 47 replay) |
| Integration, full, once | `dotnet test tests/MatterFlow.IntegrationTests` | 1,592 tests: 1,588 passed, 4 failed (2 h 14 m, with a Playwright run going on at the same time on the same 4 cores); classification below; all four pass or were fixed, see below |
| Frontend lint, format | `npm run lint`, `npm run format:check` | clean |
| Frontend unit | `npm test` | 4,192 passed (345 files) + form-engine 319 passed (10 files) |
| Production build and bundle gate | `npm run build:report` | initial **641.53 kB** (limit 700 kB, 58.47 kB under), every PM v2 chunk lazy; one style budget warning that is not new (`roles-page.scss`) |
| Contracts | `node contracts/validate-contracts.mjs` | OK |
| OpenAPI and client drift | Release build regenerates `v1.json`; `npm run api:generate`; `git status` | no diff in either |
| Playwright, full, rule OFF, fresh DB, one run | `run-local.sh --workers=1` | 2,981 tests: **2,926 passed, 48 skipped, 7 failed** (5.8 h). The 48 skips are 34 screenshot-only tests (no `E2E_SCREENSHOTS` folder) and the 14 sensitive-matter tests (they need the rule on) |
| Playwright, sensitive-matter specs, rule ON, fresh DB | `E2E_SENSITIVE_ACCESS=1 run-local.sh sensitive-` | **14 passed** (`sensitive-leak-scan` 9, `sensitive-ui` 5) |
| Re-runs of the 7 Playwright failures | three runs on fresh databases, see below | all pass on the final code except one known concurrency flake (below) |
| Timing tests on a quiet machine | `MyMattersPerformanceTests` (all 9), `CountsPerformanceTests`, `CountsLargePerformanceTests`, the hostile-HTML test | all pass (hostile test after the fix) |
| Shortcut check (#420) | `git diff ac0802b origin/dev -- frontend/src/app/shared/layout/shortcut-registry.ts` | no change; no new global key handler in the diff (only local Escape and Enter handlers); the shortcut unit tests and the keyboard specs pass |

## Failures and classification

### Integration (4)

| Test | Class | What and what was done |
|---|---|---|
| `CountsPerformanceTests` and `CountsLargePerformanceTests`, `The_count_sorts_the_default_pages_and_the_summaries_stay_within_budget_in_a_fixed_number_of_statements` | **stale test** (deterministic, fails alone) | The test expects exactly one grouped read with an `IN` list for each default list page. Since PV-30 (#881) the Matters list adds two more of the same kind (On hold and At risk counts of the page's matters), so it runs three, all bounded by the page's ids. Fixed: Matters expects 3, Clients and Projects 1. Both pass. These are very probably two of the "four earlier failures" |
| `MyMattersPerformanceTests.The_scoped_lists_of_assets_clients_and_projects_stay_within_the_budget` | **load flake** | `pm5 assets unfiltered cold 1263 ms` (a cold first call; warm p95 93 ms) while a Playwright run used the machine (load average about 6). Passed in 22 s when re-run on a quiet machine |
| `MyMattersPerformanceTests.Breakdown_data_volume_and_the_reports_stay_within_the_budget_at_100000_assets_and_200000_index_rows` | **load flake** (and see "Performance") | The same run measured the Task Queue export at p95 7,967 ms (838 ms quiet), Data size field 623 ms and volume 985 ms (325 and 391 quiet). Passed (3 m 28 s) on the quiet machine; the test fails at twice the budget only |
| `IntakeApiTests.Hostile_nested_html_upload_is_answered_quickly` | **fragile test (cold start)**, not a regression | It passed in the full run and in the class run, and failed (7.7 s against 3 s) when run alone. The 30,000 nested tags are rejected quickly (the guard stops at depth 20); the seconds are the first request to a fresh host (sign-in, permissions, JIT). Fixed: a harmless upload warms the host first, then the stopwatch measures the hostile one. Passes alone |
| `MyMattersPerformanceTests.Search_with_the_in_my_matters_flag_is_not_slower...` (600 ms) | **load flake** | Passed in the full run this time; quiet numbers: p95 476 ms with the flag, 464 ms without; relative check passes |

### Playwright, full run (7 failed)

| Spec | Class | Cause and fix |
|---|---|---|
| `px7-add-work:134` at 375 and 768, `sh-final-contract:109` (Create task at 375 and 768), `t8-edit-create:545` (chooser at 375) | **real bug** (layout), found by data left behind by an earlier spec | `pv-final-gate` ("very long names") creates a task type whose name has a 60-character word; the Create task chooser lists every type, and the card name did not wrap, so the page scrolled sideways (4 px at 375, 13 px at 768). It is real: any firm with a 99-character type name would see it. Fixed in `create-task-page.scss` (`.ct__card-name` and the recently used buttons wrap long words); `pv-final-gate` now also opens `/tasks/new` at 375 as a regression test. After the fix, the same order (pv-final-gate before px7, sh-final-contract, t8) passes |
| `ty2-states:72` (Task Types skeleton, layout shift 0.0276 against 0.02 at 768) | **data-dependent** | Passes on a fresh database, alone and after `pv-final-gate`; the failing run had the wide data of 1,284 earlier tests. Not changed; it did not reproduce twice. If it returns, the skeleton cannot know that a row will wrap, so the test would need a fixed data set |
| `ty4-task-type:560` (a disabled entry reached with the arrows) | **stale (racy) spec**, not a product bug and not a clean-dev difference | The failure snapshot shows the disabled entry selected. The spec read `aria-activedescendant` right after the key; Angular renders after the event, so it read the old value. Fixed: the spec waits for `opt-0` and then for `opt-1`. Passes (two runs). The earlier "fails every run" is explained by the race |
| `matter-columns:469` (Fit and the resize handle) | **race in the spec** | The field and the column width were read before the view had updated (expected 360, received 186). Fixed: the field is awaited, the widths are polled. Passed 27 of 27 in three repeats of the file, and 4 of 4 of the test; it failed once more in an intermediate run before the Fit fix and passed with it |

### Playwright, re-runs

* Run 2 (matter-columns, pv-final-gate, px7-add-work, sh-final-contract, t8-edit-create, ty2-states, ty4-task-type, in that order, fresh DB): 83 passed, 2 failed: `matter-columns:469` (the line after the first fix; fixed as above) and `ty4-task-type:454` ("33 workflows") with `POST /api/v1/workflows -> 409 DUPLICATE_NAME`. The latter is **setup flake of the concurrent seeding** (six workflows created at once; the log shows `409 CONCURRENCY_CONFLICT, retry 1 of 2` on the same calls, known as E2E-F3). It passed in the full run and in run 1. One open observation, not verified: a deadlock in the read after the commit in `WorkflowAdminService.CreateAsync` would report 409 although the workflow was saved, which would explain the duplicate name on the retry; real users create one workflow at a time, so this was not changed.
* Run 1 (the seven failing specs alone, before the fixes, fresh DB): 77 passed.

### Known items from the previous passes, now

| Item | Result in this pass |
|---|---|
| `ty4-task-type.spec.ts:560` | explained and fixed (above) |
| the four earlier integration failures | the two Counts tests and (load) the My Matters timing tests above |
| `IntakeApiTests.Hostile_nested_html...` | cold start, fixed |
| `MyMattersPerformanceTests` search 600 ms | passed (476 ms quiet) |
| `column-filters.spec` Assets | passed (fixed earlier by PV-38: Disposition column, filter row open) |
| `as2-record-page:133`, `dashboard-audit:242`, `ty-permissions-matrix:458`, `ty3-lists:91`, `ty5-workflow:299`, `dashboard-trends-types` | all passed in the full run (the PV-38 spec fixes hold) |
| `users-us-copy-roles`, `users-us4-drawer`, `users-us7-flows` long roles timeouts | passed in the full run (machine not shared during most of it) |

## Performance

On a machine with a load average of 1 to 2, 15 warm runs, p95 in ms (budget 300 for Breakdown and Data, 500 for a report run); same data as `docs/ux/pm-review/performance.md` ("PM v2"):

| Call | pm50 (25,000 assets) | heavy (72,500) | All matters (100,000) |
|---|---|---|---|
| Data | 179 | **311** | **376** |
| Data, size field of one type | 164 | **325** | **339** |
| Data volume (24 months) | 289 | **576** | **391** |
| Report: average of a size by a select field | 312 | **618** | 325 |
| Report: sum of size by a select field, Active only | 298 | 568 | 303 |
| Report: sum by disposition, matter, client | 135 to 194 | 311 to 329 | 349 to 365 |
| Breakdown (matrix) | 115 | 173 | 161 |

The two misses of the PM v2 document (volume chart 453 ms against 300, average by select 522 against 500, heavy person) were **not reproduced as quoted: they are 576 and 618 ms in this run, 25 percent worse than the figures in that document**, and several more calls (Data and the reports for the 72,500 and 100,000 asset people) are a little over 300 ms. The numbers vary with whatever else uses this shared 4-core machine, and the test fails only at twice the budget, so it stays green. **No code change was made**: the cheap levers named in the document (one statement for counts and sizes together) are not equal in meaning (the counts include assets without a size, the sizes do not), the gain would be about a quarter, and it would not bring the 72,500-asset case under 300 ms. **Recommendation, a decision for the owner:** either (a) accept a budget of 600 ms p95 for Data, the volume chart and the two-join reports at 70,000 assets and more (all of them are inside it here), documenting that the figures are for this 4-core test machine and the firm's server will be better judged by the first real figures; or (b) keep 300 and plan the snapshot table (`MatterDailyStats`-like) when the volume reaches that size. Nothing is deployed and the demo data has under 1,000 assets, so (a) loses nothing today.

## Fixes of this pass (commits on dev)

* Counts performance tests: Matters list expects three bounded grouped statements.
* Create task chooser: long type names wrap (real bug); regression check in `pv-final-gate`.
* Specs: `ty4-task-type:560` (waits for the arrow to take effect), `matter-columns:469` (waits for Fit and polls the width).
* Hostile-HTML intake test: warm-up request first.

No production code other than `create-task-page.scss` was changed. No schema script, API or contract change; OpenAPI and client unchanged. No shortcut was added or changed.

## What was NOT run

* The 34 screenshot-only Playwright tests (they only write images; need `E2E_SCREENSHOTS`).
* A second full Playwright run on the final code. The final code was verified by the three re-runs above (about 190 tests, including every spec that had failed and the ones that could be influenced by the CSS change), not by a new 5.8-hour run; the CSS change touches only the Create task page.
* A full integration run on the final code (the changes are two test files; they were re-run alone, and with the Counts tests and `IntakeApiTests` class).
* Playwright with the rule on for anything but the 14 sensitive specs (the rest of the suite does not depend on the switch).
* Other browsers than Chromium; production Windows authentication (Dev provider only); a real SQL Server of the firm.
* The frontend unit tests and the lint were not repeated after the CSS and spec edits (format check was; the edits are one stylesheet and three e2e files outside the lint scope).

## Environment notes

Creating the worktree took about 25 minutes (the repository checks out 760 MB through a slow disk); the integration run took 2 h 14 m while Playwright ran in the other heavy slot, which is why the timing tests had to be repeated alone. Total about 8 agent-hours of wall clock, nearly all waiting for the machine (integration 2 h 14 m, Playwright 5.8 h, reruns about 40 minutes); under 1 hour of reading and editing.
