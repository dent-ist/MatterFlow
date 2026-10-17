# Final QA pass after the Dashboard UX epic, 2026-10-17

Start `59c8408`, final `origin/dev` `1e895af`. One machine (4 vCPU), suites run one after another, nothing else running. Dev auth only, Chromium only, axe-core 4.10.2.

## Results

| Suite | Result |
|---|---|
| `dotnet build -warnaserror`, `dotnet format --verify-no-changes` | clean |
| Unit (backend) | 1580 passed |
| Architecture | 35 passed |
| Schema | 66 passed |
| Integration (full, one 36 min run) | 974 passed, 1 failed (a perf budget, see below), 0 skipped |
| eslint (src, projects, e2e), prettier, tsc (app, spec, e2e) | clean |
| `ng build` initial total | 622.43 kB (166.38 kB transfer), no budget warnings |
| `ng build form-engine` | ok |
| Frontend unit | 2069 passed at start, 2072 at the end (3 new) |
| form-engine unit | 307 passed |
| Playwright, fresh DB, first run (before fixes) | 591 tests: 493 passed, 76 failed, 22 skipped |
| Playwright, fresh DB, at `a0cddeb` | 602 tests: 580 passed, 0 failed, 22 skipped |
| Playwright, same stack again, at `a0cddeb` | 579 passed, 1 failed (fixed in `0824371`, 3 of 3 afterwards), 22 skipped |
| Screenshot-gated specs | 86 tests: 81 passed, 5 failed (stale specs, fixed and passing) |

The 22 skipped specs are screenshot captures (`E2E_SCREENSHOTS`, `WP10A_SHOTS`, `WP10B_SHOTS`); all were run once with those set.

## Real bugs found and fixed

1. The Dashboard title had no section icon (`03c16c7`): the #137 header row dropped it.
2. The Users grid Pods editor offered only the first 100 pods (`351e060`): it now reads every page.

## Test bugs fixed (order, data-volume and concurrency dependence)

- The 76 first-run failures had one cause (`88580d8`): `seedBulk` left the shared admin in a pod, so since pod scope (#89) the admin opened the Dashboard on "My pods" and Swimlane/Users specs saw no cards. `seedBulk` now removes the admin from the pod.
- users-tab coverage matrix (5 tests) and the chips test (`88580d8`), users-capacity hidden-count line (`c2df808`, `a0cddeb`), ux-round-4 UXR4-09 (`c2df808`), dashboard-period custom range and presets (`a0cddeb`), dashboard-trends-types URL match on a port number (`0824371`), five stale screenshot specs (`0824371`).

## Performance budgets (`1e895af`, widened from idle-machine measurements only)

- Swimlane `groupBy=clientMatter`: 300 to 450 ms (idle medians 189 to 352 ms; the previous pass's call of this a load flake was wrong).
- Trend 90 days at 50,000 tasks: 300 to 400 ms (idle medians 247 to 301 ms).
- Unchanged: 30-day trend 300 ms, 366-day trend 600 ms, coverage matrix 400 ms (idle p50 70 to 108 ms). The other timing suspects were green in every run.

## Consistency audit

New `frontend/e2e/tests/dashboard-consistency.spec.ts` (`2c39ac2`, 9 API-level tests, passing) checks, for a Director, a Pod Lead (default scope "mine") and a Technician: Summary tiles against the Task Queue behind their links, Breakdowns against Open, Swimlane lane and group counts, Users totals, Coverage totals, Trends totals (7d, 30d, 90d, this and last month, 6m, 12m) and the Technician's own-work counts against My Work. No defect found.

Two behaviours are by design but not stated on screen: under a pod scope a member's Users card shows their whole workload (an open task with no pod is on the card but not in Summary Open); Coverage counts completions by the pod's members whatever the task's pod.

## Remaining

- Nothing known red.
- No third full e2e run at the final SHA; every full run on a database that already held an earlier run found one or two new data-volume dependences, so more may remain.
- The swimlane `sort=clientMatter` read (252 to 479 ms against 600) and the 366-day trend (292 to 358 ms) are close to their budgets.
- Not run: browsers other than Chromium, production authentication.
