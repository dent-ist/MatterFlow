# Theme rollout: QA report (epic #982, issue #998)

## PROGRESS (updated 2026-11-01 18:25 UTC, stage 3 running)

Overall: **15%**

| # | Stage | Weight | Status | Result so far |
| - | ----- | ------ | ------ | ------------- |
| 1 | Setup, build, fresh stack | 5% | done | worktree, npm ci, backend build -warnaserror 0 warnings, Release build 0 warnings |
| 2 | Backend unit/arch/schema, lint, prettier, tsc, unit suite, bundle, contracts/OpenAPI | 10% | done | all pass: format clean; unit 2455/2455, architecture 47/47, schema 102/102; lint (colour ledger 0, contrast 74 pairings), prettier, tsc app/spec/e2e ok; frontend unit 363 files 4319/4319 (+ form-engine 319/319); bundle 655.47 kB; contracts OK; no OpenAPI/nswag drift |
| 3 | Full backend integration | 15% | running | 12 pieces by namespace (performance first), logs /tmp/qa/it-*.log, trx /tmp/qa/it-*.trx |
| 4 | Full Playwright | 35% | waiting | 0 / ? tests |
| 5 | Sensitive e2e, axe four sizes, visual review | 10% | waiting | - |
| 6 | Exploratory hunt | 18% | waiting | - |
| 7 | Fixes and re-runs | 4% | ongoing | none yet |
| 8 | Report, issues, epic | 3% | waiting | - |

Running now: integration piece 1 of 12 (performance classes). Expected time left: about 7 hours (integration 1.5 h, Playwright 3 to 4 h, rest).

Findings so far: none. Style budget warnings app-shell.scss 5.20 kB and roles-page.scss 6.08 kB are the same two as before (5.17 and 6.03 kB in the ui-update QA), not new.
