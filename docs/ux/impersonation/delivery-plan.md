# Admin impersonation (View as, read-only): delivery plan

Epic #828 (issues #829 to #842). **Status: planned; not started** (the owner asked for the design, plan and epic only; 2026-10-26). Design: `README.md` (same folder). Decisions: `docs/requirements/decisions-addendum.md` section AL. Epic: "Epic: Admin impersonation (View as, read-only)", label `phase-22`. **Priority: higher than the postponed Reports epic #671.** Estimates are agent-hours including tests. No SQL script number is claimed: next free number at implementation time (last used on `dev`: 39); every new table needs `db/report-access.json` plus GRANT/DENY for `mf_report_reader`.

## Honest estimate

The owner's guess was 8 to 12 h. The core (marker, effective user, read-only gate, banner, picker) is about **22 h** of agent work; the remaining hours are what makes it safe to ship: reviewing the 40 user-keyed paths and caches, the audit change, and a catalog-driven test suite so a future write endpoint cannot bypass the rule. **Total 38.5 agent-hours** (range 34 to 44). If the owner wants to start smaller, the minimum shippable slice is IM-01, IM-02, IM-03, IM-04, IM-05 (events only), IM-08 and IM-09 (about 25 h) with IM-10 and IM-11 kept, because without them the read-only promise is unproven.

## Work packages

| ID | Package | Hours | Depends on |
|---|---|---|---|
| IM-01 | Permission `User.Impersonate`: `contracts/permissions.json`, `Permissions.cs` (+ `All`), `permissions.ts`, Roles-screen warning, parity tests; no grant row | 1.0 | none |
| IM-02 | Session store and marker: table script (+ `report-access.json`), cookie, `ImpersonationService` (start, replace, stop, expire), endpoints POST/DELETE, `Impersonation:*` options, problem codes | 4.0 | IM-01 |
| IM-03 | Effective vs real user: `IRealUser`, `CurrentUser`, `ImpersonationMiddleware`, `[ActsAsRealUser]`, `ResolveByIdAsync` without side effects, effective cache entry, eligibility rules, `/me` block, `impersonationEnded` | 4.0 | IM-02 |
| IM-04 | Read-only enforcement: middleware default-deny, `[AllowWhileImpersonating]`/`[ReadSafe]`, SaveChanges guard, command-guard spike, fix GET-with-write (R14), refused-write limiter/log, error code in OpenAPI | 3.5 | IM-03, IM-10 |
| IM-05 | Audit: script (`OnBehalfOfUserId`, `ImpersonationSessionId`), events start/stop/expired/refused, interceptors on `IRealUser`, audit API and views show both names, "Viewed as" filter, log scope | 3.0 | IM-03 |
| IM-06 | User-keyed cache and read-path review fixes: `DashboardCache` key, notifications `ETag`/no-store, `Vary: Cookie`, any row of README section 5 marked WR | 2.5 | IM-03, IM-04 |
| IM-07 | Eligible-users endpoint, OpenAPI contract, nswag client regeneration, contract tests | 1.5 | IM-03 |
| IM-08 | Frontend core: `AuthStore` state, `SessionReset` on start/stop/expiry, banner on every page (shell, error, pending, connection pages), live region, countdown, prefs not persisted, stub provider support, bundle check | 4.0 | IM-07 |
| IM-09 | Frontend picker (lazy, `mf-entity-picker`), account-menu item, `mfWriteGuard` disabled-with-explanation, read-only message mapping, unit specs | 3.5 | IM-08 |
| IM-10 | Test harness first (red): `ImpersonationEndpointCatalog`, coverage test, write-refusal walk, GET-never-writes checksum test, mutation test, architecture tests | 4.0 | IM-01 |
| IM-11 | Security and persona tests: eligibility matrix, escalation, tamper/replay/expiry, cache leakage, sensitive-matter interaction, audit assertions, performance check | 2.5 | IM-02 to IM-06 |
| IM-12 | Playwright e2e: banner everywhere (desktop, phone), axe at four widths, picker, disabled writes, Stop, expiry, keyboard, bundle size | 3.0 | IM-09 |
| IM-13 | Docs and final verification: runbook section, `ux-spec` screen, README sync, contracts validate, addendum status, final verification issue | 1.5 | all |
| IM-14 | Reports interaction tracker (#671): refuse runs/saves while impersonating, decision on opening Reports read-only, report-login note | 0.5 | none |
| | **Total** | **38.5** | |

## Waves

1. **Wave 1:** IM-01, IM-10 (written first, red where the feature is missing), IM-14.
2. **Wave 2:** IM-02, then IM-03.
3. **Wave 3 (parallel):** IM-04, IM-05, IM-07.
4. **Wave 4:** IM-06 (needs IM-04), IM-08, then IM-09.
5. **Wave 5:** IM-11, IM-12, IM-13.

Critical path: IM-01, IM-02, IM-03, IM-04, IM-06, IM-11, IM-13 (about 19 h of serial work); IM-08/IM-09 (7.5 h) run beside IM-04 to IM-06.

## Definition of done (every package)

- `dotnet build -warnaserror`, `dotnet format --verify-no-changes`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build` green; module boundaries intact (`MatterFlow.ArchitectureTests`); the unit and integration tests of the package green twice.
- OpenAPI in `contracts/openapi` and the generated client in sync; `contracts/validate-contracts.mjs` passes; `permissions.json`, `Permissions.cs`, `permissions.ts` in step.
- SQL scripts take the next free number, are immutable once merged, and a new table has its `db/report-access.json` entry and GRANT/DENY.
- No new or changed keyboard shortcut (#420); initial bundle under 700 kB; no static import of `api-client` or the lookup store in eager shell code.
- Accessibility: banner and picker pass axe at four widths; announcements through the live region only on start, stop and expiry.
- The package's rows of README section 5 and its test-plan lines are done; the epic tick-list and the issue are updated.
- Epic done when IM-13's final verification shows: every catalogued write refused, no GET writes, cross-user leakage tests green, e2e green, `User.Impersonate` held only by System Administrator by default.
