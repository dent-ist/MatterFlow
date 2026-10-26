# Application settings: branding, delivery plan

Epic: "Epic: Application settings: title and icon" (phase-23). Design: `README.md`. Decisions: addendum section AM.
**Status: planned; ready to start after the current verification.** Priority: after the combined verification that is running and **before** the impersonation epic #828.

## Honest estimate

The owner's guess was 8 to 10 h. The code is small, but three things add time that is easy to forget: image validation by content without a new library (PNG/ICO/SVG, with reject cases), the public/cacheable endpoints with the `SecurityHeadersMiddleware` exception, and the touch-up of about ten frontend places plus the bootstrap with the bundle limit. With tests in each package and one final verification: **about 13 h** of agent work; a trimmed version (name only, icon later) would be about 8 h.

## Work packages

| ID | Package | Hours | Depends on |
|---|---|---|---|
| BR-01 | Foundation: permission `Settings.Manage` (catalog, `Permissions.cs`, `permissions.ts`, parity), table `AppSetting` script (+ `report-access.json`, GRANT/DENY), setting registry, repository, audit events, Roles screen shows the permission | 2.5 | none |
| BR-02 | Validation: name rules; image sniffing, PNG/ICO dimension parsing, SVG allow-list; unit tests with a reject corpus | 2.0 | none |
| BR-03 | API: public `GET /branding`, `/branding/icon` (ETag, cache, 304, server cache), admin GET/PUT/DELETE, `SecurityHeadersMiddleware` exception + test, OpenAPI + nswag regeneration, integration tests | 2.0 | BR-01, BR-02 |
| BR-04 | Frontend bootstrap and integration: `loadBranding()` in `main.ts`, localStorage last-known, `BrandingService`, `documentTitle`, header, state pages, access-pending, error/not-found, search labels, favicon/apple-touch links; unit specs; bundle check | 2.0 | BR-03 (contract) |
| BR-05 | Admin page: lazy `/admin/settings`, rail item, form, file picker, live preview, per-field reset, conflict handling, mobile layout, a11y; unit specs | 2.0 | BR-03 |
| BR-06 | Playwright e2e, axe at four widths, no sideways scroll, security cases (unsafe SVG, oversize, 403), IIS anonymous-auth check of the deploy scripts | 2.0 | BR-04, BR-05 |
| BR-07 | Docs and final verification: runbook section, `architecture.md` pointer, ux-spec screen, "future outputs read the name from settings" note, contracts validate, addendum status | 0.75 | all |
| | **Total** | **13.25** | |

BR-01 and BR-02 are independent and can run in parallel; BR-04 and BR-05 run in parallel after BR-03. Critical path: BR-01, BR-03, BR-04/BR-05, BR-06, BR-07 (about 9 h serial).

## Waves

1. BR-01 + BR-02. 2. BR-03. 3. BR-04 + BR-05. 4. BR-06. 5. BR-07.

## Definition of done (every package)

* Builds with `-warnaserror`, `dotnet format --verify-no-changes`, frontend lint, Prettier and unit tests green; new code has unit tests written with it.
* Module boundaries respected (`MatterFlow.ArchitectureTests`); no new NuGet package; no new or changed keyboard shortcut (#420).
* API change: `contracts/openapi` and the nswag client in sync; `validate-contracts.mjs` passes; SQL script is the next free number at implementation time (check `ls db/scripts` on `origin/dev`), immutable once merged.
* Initial bundle stays under 700 kB; no static import of `api-client` or `lookup-store` in eager code.
* Documentation and the issue checklist updated; epic tick-list ticked.
