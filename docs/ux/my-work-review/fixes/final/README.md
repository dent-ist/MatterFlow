# My Work: final verification (issue #193, WP28)

Date 2026-10-18, base `origin/dev` 9e61ba6 (after the My Work epic #138 and the Task Queue packages WP1 to WP27 of #195). The run is the whole Playwright suite against a fresh stack (real API with Dev authentication, SQL Server 2022 in Docker, the production Angular build served by the API), with axe from `E2E_AXE_PATH`.

## Result

| Check | Result |
|---|---|
| Whole e2e suite | 921 tests in 109 files: 912 passed, 2 skipped (screenshot helpers that need their own environment variable), 7 failed on the first run. Every failure was looked at (list below); after the two test fixes and one rerun alone, all 7 pass except the screenshot helper `column-filters-admin-screens`, which is a screenshot helper, not a test of this epic (a Roles checkbox click times out under load; nothing in it touches the work lists). |
| axe, 0 violations, all four tabs at 1366x768, 1920x1080, 768x1024 and 375x812 | Passed. Active, Created by me and Closed: `my-work-per-tab-columns` ("axe, no horizontal page scroll and screenshots of the three default sets at four widths"); Due soon and overdue and Closed: `my-work-vocabulary` and `my-work-columns-sorts` (the tab strip and the Closed tab at the four sizes); cards at 375 and 320: `wp13b-phone-cards`; Group by Due, New, the strip, the notices, the sheets and Compact have their own axe runs at the same sizes (`my-work-group-by-due`, `my-work-new`, `my-work-strip`, `my-work-page-state`, `wp19-compact`). 0 violations everywhere (WCAG 2.2 AA and best practice tags, `support/axe.ts`). |
| The review's 16-combination count check | Passed: `my-work-consistency` runs 3 people x 4 tabs x 4 filter combinations; every tab count equals its grid total and the row count, the four counts are the same on every tab, the grid total equals the Task Queue's for the same person and filters, and the needs-attention strip equals the Task Queue (5 tests, API level). The Dashboard tiles equal the Task Queue links in `dashboard-consistency` (passed). |
| Initial bundle | 641.28 kB raw (172.62 kB transfer) of the 700 kB budget, no budget warning (622.87 kB at the start of the My Work epic; the rest of the growth is the Task Queue epic's global styles and shared code). |
| Screenshots | The 16 files in this folder: Active, Due soon and overdue, Closed and Created by me at 1366x768, 1920x1080, 768x1024 and 375x812 (`my-work-<tab>-<size>.png`), taken by the specs above on seeded data. |

## First-run failures

| Test | Cause | What was done |
|---|---|---|
| `assignment-and-views` "the Task Queue shows everything to anyone with Task.View and filters by Title or Ref" | The locator `[data-empty]` also matched the empty filter cells ("All", "Any", "Any date") that carry that attribute since the filter placeholders (#228): a strict-mode violation, not a defect in the page | Locator narrowed to `tbody [data-empty]` |
| `my-work-links-copy` G6 "a failed first load and a failed reload show the same message" | The size loop at the end looked for `tbody [data-error]` at 375 px, where the list has been cards since #192 | At widths under 640 px the test looks for the card list's `[data-error]` |
| `users-tab` "changing a task in the drawer updates the card" | Timing under load (passes alone, twice) | None |
| `wp11-view-counts` "a button keeps its place while the counts load", `wp13c-queue-pod-cards` Pod Work cards, `wp21-fit-menu` keyboard-only column menu | Timing under load (two workers beside other agents' stacks); pass on the rerun | None |
| `column-filters-admin-screens` capture | A screenshot helper (needs `E2E_SCREENSHOTS`): the Roles checkbox click times out under load | None; not part of the My Work or Task Queue epics |

Also in this change: `wp16-more-views` "More follows the popover rule" (#220) was failing on `origin/dev` and is fixed (the test pressed Tab once per view, but the Quick views have been one roving Tab stop since WP24, #236; the test now walks the strip with the arrow keys). The live region of a failed list load said "Could not load tasks" while the row said "Couldn't load tasks."; both now use the second wording (#193 copy audit).

## Known limits

- #155 (Due presets) stays open: the presets are done, but the filter chip shows the dates and not the preset name.
- A real screen reader (NVDA) pass and a dark theme are out of scope of the epic.
