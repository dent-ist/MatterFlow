# Matter detail redesign: QA report (epic #1001, issue #1019)

## PROGRESS (updated after each stage)

Overall: **15%** (stages 1 and 2 done). Verdict: pending.

| # | Stage | Weight | Status | Result |
| - | ----- | ------ | ------ | ------ |
| 1 | Setup, build, fresh stack | 5% | done | worktree with own node_modules, dev (a7f423d, shell menu fix) merged in, `dotnet build -warnaserror` 0 warnings 0 errors |
| 2 | Backend unit/arch/schema/format, frontend lint/prettier/tsc/unit, bundle, contracts/OpenAPI drift | 10% | done | unit 2,494, architecture 51, schema 107 (1 stale count fixed); `dotnet format` clean; lint (colour ledger 0 after 1 fix, contrast 74), prettier, tsc app/spec/e2e clean; frontend 368 files 4,349 tests + form-engine 319; initial bundle 656.16 kB (limit 700); contracts OK; no OpenAPI or nswag drift |
| 3 | Full backend integration in pieces | 15% | running | |
| 4 | Full Playwright (whole suite, one worker) | 35% | pending | |
| 5 | Sensitive e2e + axe at four sizes + visual review | 10% | pending | |
| 6 | Exploratory hunt on demo data | 18% | pending | |
| 7 | Fixes and re-runs | 4% | pending | |
| 8 | Report, issues, epic | 3% | pending | |
