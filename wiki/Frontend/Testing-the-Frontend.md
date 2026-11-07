# Testing the Frontend

[[_TOC_]]

**What this page is for.** The frontend checks in one place: unit specs (Vitest), guard specs, lint scripts, the end-to-end Playwright suite with axe accessibility checks, and how to run each. Related docs: `docs/qa/e2e.md`, `docs/ux/design-guidelines.md` section 6 (automated guards).

## Overview

| Check | Command (in `frontend/`) | Where | Notes |
|---|---|---|---|
| Unit specs | `npm test` | `*.spec.ts` beside the code (about 440 files in `src` and `projects`) | Vitest with jsdom through `ng test`; runs the app and the `form-engine` library |
| One spec | `npm run ng -- test frontend --watch=false --include=src/app/shared/ui/capitalisation-guard.spec.ts` | | |
| Lint | `npm run lint` | ESLint, then `scripts/check-theme-colours.mjs`, `check-theme-contrast.mjs`, `check-icon-sizes.mjs`, `check-off-scale.mjs` | Fails on colour literals, low contrast pairings, px icon sizes, off-scale sizes |
| Format | `npm run format:check` | Prettier over `src`, `projects`, `e2e` | Fix with `npx prettier --write <files>` |
| Build | `npm run build` | | Initial bundle must stay under 700 kB |
| Type check of e2e | `npm run e2e:typecheck` | `e2e/tsconfig.json` | |
| End to end | `npm run e2e` | `e2e/tests/*.spec.ts` | Needs Docker and a published API; see below |

## Guard specs (UI standard)

These unit specs enforce the design guidelines. A failing guard is fixed by changing the code, not the guard; a real exception goes into the guard's `ALLOWED` list with a reason and into section 8 of the guidelines.

| Guard spec | Catches |
|---|---|
| `shared/ui/capitalisation-guard.spec.ts` | A button, heading, dialog title or column text not in Title Case |
| `shared/ui/button-rule.spec.ts` | Local button paint, `size="small"` |
| `shared/ui/link-style.spec.ts`, `chip-kinds.spec.ts`, `private-classes.spec.ts`, `card-style.spec.ts` | Link, chip and card styles drifting; private `.chip`, `.badge`, `.lnk` classes |
| `shared/ui/page-header-rule.spec.ts` | A page drawing its own header |
| `shared/ui/grid-anatomy.spec.ts`, `form-anatomy.spec.ts`, `menu-anatomy.spec.ts`, `banner-anatomy.spec.ts` | Row, header, field, menu and banner values (a banner without its icon fails) |
| `shared/ui/record-grid-guard.spec.ts` | A new hand-built `<table class="pg-table">` record list outside its `ALLOWED` list |
| `shared/ui/tab-icons.spec.ts` | A tab without an icon |
| `shared/ui/form-dialog.spec.ts`, `slide-panel.spec.ts`, `lookup-dialog.spec.ts` | Dialog and drawer widths, footer order, focus |
| `shared/ui/icon-xl-use.spec.ts`, `shared/pipes/mf-date-long-use.spec.ts` | 24 px icon and long dates outside their allowed places |
| `core/theme/size-tokens.spec.ts` | `tokens.css` contradicting the styles |
| `shared/layout/initial-bundle.spec.ts` | Initial bundle over 700 kB |
| `route-icons.spec.ts`, `core/auth/guards.spec.ts` | Every route has an icon; guard behaviour |

## Writing a unit spec

- Put it next to the file. Use `TestBed` with the real standalone component; replace API clients and stores with fakes (see `core/auth/auth-testing.ts`, `shared/assignees/assignee-testing.ts`, `shared/filters/filters-testing.ts`, `core/lookups/lookups-testing.ts`).
- Pure logic (models, rules, formatters) gets plain function specs; keep logic out of components so it can.
- The permission list in `core/auth/permissions.ts` must stay equal to `contracts/permissions.json` (a backend unit test checks it).
- Use the shared helpers for dropdowns (`src/app/testing/dropdown-testing.spec-util.ts`) and token colours.

## End-to-end suite (Playwright)

- Location: `frontend/e2e/` (`tests/` 309 spec files, `pages/` page objects, `support/` fixtures and helpers, `fixtures/email`). Config: `e2e/playwright.config.ts` (parallel, 2 workers locally, 1 retry in CI, report in `playwright-report`).
- `npm run e2e` runs `e2e/run-local.sh`: it starts a throwaway SQL Server container (random loopback port) and the published API (Dev auth) that serves the built Angular app on one origin, runs the suite, and tears down only what it started. Useful variables: `E2E_API_PORT`, `E2E_SKIP_BUILD=1` (reuse `artifacts/e2e-publish`), `E2E_KEEP_STACK=1`, `E2E_CHROMIUM_PATH`, `E2E_SENSITIVE_ACCESS=1` (turns on the Sensitive matter switch; automatic when a `sensitive-*.spec.ts` file is named), `E2E_WORKERS`. Run one spec: `frontend/e2e/run-local.sh -g SCN-015` or name the file.
- **Personas** (`e2e/support/personas.ts`): people with a known permission set, created through the admin API. Dev auth signs in with the `X-Dev-User` header, so "sign in" is a browser context that sends it (`asUser` fixture, `personas.create({ permissions: [...] })`, `personas.named('director')`). Add a persona to `PERSONAS` instead of creating ad-hoc users.
- **Desktop only (D-82):** the screen sizes of the suite are 1366x768 and 1920x1080 (`SIZES` in `e2e/support/screens.ts`, also used by `atEverySize`; a few specs add 1024 or a 683 px window for 200 percent zoom). The phone and tablet sizes (375, 390, 414 px, 768x1024) are gone: their specs were deleted, not skipped (#1268). The phone and tablet code of the app itself (cards below 640 px, the Menu button) was left in place and has only unit specs.
- **Accessibility:** `e2e/support/axe.ts` runs axe-core (`E2E_AXE_PATH` overrides the library path); every changed page needs axe clean. `axeBestPractice` adds the best-practice rules (skip link, region); `tip-axe.spec.ts` checks the page with a tooltip open.
- **Spec list and counts:** `docs/qa/e2e.md` lists the specs by area (309 files, 2539 tests after the desktop-only clean-up).
- **Spec naming:** files start with a work package prefix (`ad3-`, `ty6-`, `md-`, `pv-`, `sh-`, `dashboard-`, `users-`, ...). Search by feature name or `data-testid` rather than by prefix.
- **CI:** `.github/workflows/e2e.yml` runs weekly, manually, and on pull requests labelled `e2e`; it also runs the `sensitive-` specs with the switch on.
- In the cloud container use the preinstalled Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `E2E_CHROMIUM_PATH`, `E2E_NO_SANDBOX=1`) and do not run `playwright install`.

## Reports checks in a browser without a stack

`tools/reports-checks` (README there) serves the production build and answers every `/api/**` call from a mock, so axe at both desktop sizes, a keyboard walk (Tab order, grid headings, Saved Views menu and dialogs) and a 50,000-row timing run need no API, SQL Server or data and write nothing. `node tools/reports-checks/axe.mjs frontend/dist/frontend/browser 4660`. The unit spec `features/reports/report-xss-inert.spec.ts` proves that markup in report data (cell, column name, view name, report name) renders as text.

## Visual checks

Before and after screenshots at 1366x768 and 1920x1080 are required for UI changes (`CLAUDE.md`); there are no phone or tablet screenshots. Crawl and probe scripts: `docs/ux/ui-update/crawl/` with the stack guide `docs/ux/ui-update/stack-howto.md`.

## Related pages

- [UI Standard](UI-Standard.md)
- [Testing the Backend](../Backend/Testing-the-Backend.md)
- [Continuous Integration](../Getting-Started/Continuous-Integration.md)

Last verified against commit a8142a1.
