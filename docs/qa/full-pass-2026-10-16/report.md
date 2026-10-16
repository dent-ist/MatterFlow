# Full QA pass of `dev`, 2026-10-16

Start: `e8155d5`. Final: `38f7f85`. Machine idle; suites ran one after another. Dev auth only, Chromium only.

## Results

| Suite | First pass | Final commit |
|---|---|---|
| Build, `dotnet format --verify-no-changes` | clean | clean |
| Unit (backend) | 1499 passed | 1499 |
| Architecture | 35 passed | 35 |
| Schema | 66 passed | 66 |
| Integration (full, one 25 min background run) | 762 passed, 0 failed, 0 skipped | 762 |
| eslint src and projects | clean | clean |
| eslint e2e | 2 errors | clean |
| prettier, tsc (app, spec, e2e) | clean | clean |
| `ng build` initial total | 621.30 kB (165 kB transfer) | 621.30 kB |
| `ng build form-engine` | ok | ok |
| Frontend unit | 1790 passed (145 files) | 1792 (+2 new) |
| form-engine unit | 307 passed | 307 |
| Playwright e2e (whole suite, one run, axe loaded) | 370 tests: 351 passed, 2 failed, 17 skipped | 353 passed, 0 failed, 17 skipped |

- `ng build` warns that `coverage-view.ts` styles are 5.55 kB against a 5.00 kB budget (warning only).
- The 17 skipped e2e specs are screenshot-capture specs that need `E2E_SCREENSHOTS`. Run once manually: 15 passed; the 2 stale ones were fixed and now pass.
- axe-core 4.10.2 was loaded with `E2E_AXE_PATH` (see `docs/qa/e2e.md`), so no axe spec skipped.

## Real bugs found and fixed

1. **Dashboard Refresh lost keyboard focus** (`616e684`). The tab row was rendered by separate `ngTemplateOutlet`s in the loading and ready branches, so the button was recreated when the first read finished. One outlet above the state switch fixes it. New unit test fails without the fix. e2e repeat: failing 2 of 12 before, 15 of 15 after.
2. **Dialog focus not returned to the opener** (`36d0d66`). PrimeNG's focus trap pulled focus back into the closing dialog after `DialogFocus` restored it, so focus fell to body (this broke "Set out of office"; applies to every dialog). `DialogFocus` now restores again once `.p-dialog-mask` is gone. New unit test fails without the fix. e2e repeat: failing 6 of 12 before, 15 of 15 after.

## Test bugs fixed

- **`DashboardTrendApiTests` New_York and Pago_Pago** (`6f0a721`). The server was correct: a cancelled task was seeded due one UTC day before cancellation, so in zones whose date differs from the UTC date it was never overdue. Added an optional `Clock` to `DatabaseApiFactory`, fixed at 03:30 UTC, moved that due date back to 12 days; `MF_TEST_NOW` runs the class at another instant. Without the seed change the cases fail at 00:10, 03:30, 06:30, 09:30 UTC; with it the class passes 18 of 18 at 12 instants (every 3 hours, 23:50, DST-end and DST-start windows, 31 Dec 23:50).
- **Trends-by-task-type e2e** (`6af1c2f`). The server caches a trend for 15 s and all e2e tests are one user, so a visit could show a legend from before the file's task types existed. Tests now click Refresh, as `dashboard-audit.spec` does. The race could not be reproduced before the fix (needs two workers in the same 15 s window); evidence is the failing screenshot and the cache key in `DashboardTrendService`. After the fix all dashboard specs passed 3 times in a row (102 of 102).
- **e2e lint** (`7d879f7`): unused `admin` in `workflow-version.spec.ts`, unused `page` in `profile-availability.spec.ts`.
- **Stale screenshot specs** (`964d51b`): `profile-availability` and `workflow-tabs-tags-screens` used pre-Batch-4 controls. The profile spec now uses its own user prefix so other specs' users do not push the Users grid into sheet mode.

## Load flakes (no failure on an idle machine)

Each passed in the full run and in 3 of 3 isolated reruns; no thresholds changed.

- `HtmlToTextTests.Nested_tags_are_converted_in_linear_time`
- `EmailParseServiceTests.Hostile_nested_html_eml_of_a_megabyte_is_still_fast`
- `CommentHtmlHostileInputTests`
- `BoardPerformanceTests`

`task-types-pages` "requires an icon" and `page-header-icons` did not fail in either full run.

## Theme regression check (`aura-lite.ts`)

- **Static:** the only PrimeNG imports in `src` and `projects` are button, dialog, inputtext, toast, textarea, select, radiobutton, multiselect, inputnumber and checkbox. Following their transitive imports, every style with an Aura token set is already in `AuraLite`. No Popover, Drawer, Tabs, Menu, DatePicker, Splitter, Chip, Badge or Tooltip is used by import, tag or selector.
- **Visual:** both variants built; 49 steps each, pixel diff at 1440x900 over all main screens, admin lists, a form-engine form with every control type (rest, open, picked, focus, error), the rich editor, dialogs, toasts, account menu and a tooltip hover.
  - Dev with full Aura (699.91 kB) vs AuraLite (621.30 kB): 0 of 49 differ (the create-task toast differs only in the task number, TSK-8 vs TSK-9).
  - `a9f284b^` vs `a9f284b`: 0 of 49 differ.
  - Sensitivity check: with `select`, `multiselect` and `checkbox` removed from AuraLite, 7 of 49 differ, so the method detects a missing token set.
- **Result:** nothing renders unstyled; no change to `aura-lite.ts` needed. Not exercised: the task-detail dialogs (no button found by the generic search). Users and Task Queue filter controls are native or app-owned, not PrimeNG.
- Artifacts: `theme-compare.spec.ts.txt`, `theme-diff.py.txt`, `img/`.

## Remaining

- Nothing red.
- `coverage-view` style budget warning.
- The four timing tests above can still fail under heavy load.
- Not run: browsers other than Chromium; production auth.
