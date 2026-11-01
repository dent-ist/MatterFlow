# Theme rollout: QA report (epic #982, issue #998)

## PROGRESS (updated 2026-11-01 stage 2 running)

Overall: **8%**

| # | Stage | Weight | Status | Result so far |
| - | ----- | ------ | ------ | ------------- |
| 1 | Setup, build, fresh stack | 5% | done | worktree, npm ci, backend build -warnaserror 0 warnings, Release build 0 warnings |
| 2 | Backend unit/arch/schema, lint, prettier, tsc, unit suite, bundle, contracts/OpenAPI | 10% | running | lint (incl. colour ledger 0, contrast 74 pairings) ok, prettier ok, tsc app/spec/e2e ok; backend tests and frontend unit running |
| 3 | Full backend integration | 15% | waiting | - |
| 4 | Full Playwright | 35% | waiting | 0 / ? tests |
| 5 | Sensitive e2e, axe four sizes, visual review | 10% | waiting | - |
| 6 | Exploratory hunt | 18% | waiting | - |
| 7 | Fixes and re-runs | 4% | ongoing | none yet |
| 8 | Report, issues, epic | 3% | waiting | - |

Running now: backend format and unit/architecture/schema tests. Expected time left: many hours (integration and Playwright are long).

Findings so far: none.
