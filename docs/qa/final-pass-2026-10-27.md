# Combined verification pass, 2026-10-27 (final, after Project Manager v2)

Pinned SHA: `ade80ff` (origin/dev when the pass started). Own worktree with its own `npm ci`; every heavy command through `heavy.sh`.
This page is a working record: it is updated as the pass goes on (checkpoint commits) and finished at the end.

## Progress notes (checkpoint 1)

| Suite | Result |
|---|---|
| Backend build `-warnaserror --no-incremental` | 0 warnings, 0 errors; the build regenerates `contracts/openapi/v1.json`: no diff |
| `dotnet format --verify-no-changes` | clean |
| Unit | 2316 passed |
| Architecture | 47 passed |
| Schema | 98 passed |
| Frontend lint, format:check | clean |
| Frontend unit | 4192 passed (345 files) + form-engine 319 passed |
| `npm run build:report` (build + bundle gate) | initial 641.53 kB (limit 700 kB), every PM v2 chunk lazy |
| `node contracts/validate-contracts.mjs` | OK |
| Integration (full) | running |
| Playwright | not started |
