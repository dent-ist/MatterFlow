# Theme rollout: QA report (epic #982, issue #998)

## PROGRESS (updated 2026-11-01 21:25 UTC, stage 4 running)

Overall: **40%**

| # | Stage | Weight | Status | Result so far |
| - | ----- | ------ | ------ | ------------- |
| 1 | Setup, build, fresh stack | 5% | done | worktree, npm ci, backend build -warnaserror 0 warnings, Release build 0 warnings |
| 2 | Backend unit/arch/schema, lint, prettier, tsc, unit suite, bundle, contracts/OpenAPI | 10% | done | all pass: format clean; unit 2455/2455, architecture 47/47, schema 102/102; lint (colour ledger 0, contrast 74 pairings), prettier, tsc app/spec/e2e ok; frontend unit 363 files 4319/4319 (+ form-engine 319/319); bundle 655.47 kB; contracts OK; no OpenAPI/nswag drift |
| 3 | Full backend integration | 15% | done | 12 pieces, 1,640 test cases covering all 1,235 distinct names: all pass; the one timing failure (MyMattersPerformanceTests, 100,000 assets, assets name filter 1,191 ms while I was publishing in parallel) passes alone (12/12) |
| 4 | Full Playwright | 35% | running | 839 / 2,939 done, 8 failed so far (log /tmp/qa/pw-full.log); first classifications: asset-types strip spec stale (strip is filter chips now), Dashboard 375 skeletons real (8 px layout shift when the Scope dropdown appears; fix prepared) |
| 5 | Sensitive e2e, axe four sizes, visual review | 10% | waiting | - |
| 6 | Exploratory hunt | 18% | waiting | - |
| 7 | Fixes and re-runs | 4% | ongoing | none yet |
| 8 | Report, issues, epic | 3% | waiting | - |

Running now: Playwright, spec 839 of 2,939 (about 12 tests a minute). Expected time left: about 4.5 hours.

Findings so far: (1) real: Dashboard at phone width shifts 8 px when the Scope dropdown appears (44 px dropdown in a 36 px row), fix prepared in dash-tabs.ts; (2) stale spec ad4-asset-types-list (strip now filter chips). Style budget warnings app-shell.scss 5.20 kB and roles-page.scss 6.08 kB are the same two as in the ui-update QA, not new.
