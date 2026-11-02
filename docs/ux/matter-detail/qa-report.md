# Matter detail redesign: QA report (epic #1001, issue #1019)

## PROGRESS (updated after each stage)

Overall: **5%** (stage 1 done). Verdict: pending.

| # | Stage | Weight | Status | Result |
| - | ----- | ------ | ------ | ------ |
| 1 | Setup, build, fresh stack | 5% | done | worktree with own node_modules, dev (a7f423d, shell menu fix) merged in, `dotnet build -warnaserror` 0 warnings 0 errors |
| 2 | Backend unit/arch/schema/format, frontend lint/prettier/tsc/unit, bundle, contracts/OpenAPI drift | 10% | running | |
| 3 | Full backend integration in pieces | 15% | pending | |
| 4 | Full Playwright (whole suite, one worker) | 35% | pending | |
| 5 | Sensitive e2e + axe at four sizes + visual review | 10% | pending | |
| 6 | Exploratory hunt on demo data | 18% | pending | |
| 7 | Fixes and re-runs | 4% | pending | |
| 8 | Report, issues, epic | 3% | pending | |
