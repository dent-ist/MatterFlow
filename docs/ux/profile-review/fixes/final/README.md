# My profile: final verification (epic #520, issue #601)

Run on 2026-10-26 against a fresh stack (real SQL Server 2022, the published API, Dev auth) with `frontend/e2e/tests/profile-pf8-final.spec.ts`, which signs in as the review's persons (a technician with a primary Pod, out of office, an invalid out-of-office range, a 66-character name, a person with no display name) and walks the four sizes (375x812, 768x1024, 1366x768, 1920x1080) through every state: available, out of office, errors, loading, load error. The raw numbers are in [`measurements.json`](measurements.json) (one row per person, state and width); the screenshots are `final-<state>-<width>x<height>.png` in this folder.

Every row asserts: axe 0 violations (WCAG 2.2 AA, which includes `target-size`), no page-level horizontal scroll, the title is 22 px (18 px below 640 px) and 12 px from the top of the main area, and exactly one primary action in the header (none while loading and after a failed load). At 1366 the Save bar ends at or above 768 px and the time zone text is in view.

## Before and after

| Measurement (review, `README.md`) | Before | After |
|---|---|---|
| Page structure at 1366 | one 644 px column in a 1146 px page | two columns from 1100 px: left 649 px (cards, error summary and action bar are the same width), Account and Notifications on the right; one column below 1100 px |
| Widths in play | five (page 1146, form 644, hours grid 560, summary 1098, bar 888) | one per column (left 649 px; the summary, cards and bar equal it) |
| First screen at 1366x768 | ends after Friday: Saturday, Sunday, Copy Monday, Time zone and Save need a scroll | Availability, Work hours with the time zone, and the Save bar end at 750 px (bar bottom) and are in view |
| Work hours section | seven rows of 57 px, 400 px tall grid | seven day toggles and one pair; the card is 356 px with the description, the buttons and the time zone |
| Tab stops from Status to Save | about 50 | **17** (budget 18) |
| Page title | 28 px, title top at 24 px | 22 px (18 px below 640 px), 12 px from the top, like My Work |
| Header | no person named, a grey "Your current status" panel | name (or account), chip, context line "role, primary Pod", ONE primary action |
| Action bar | 888 px wide on a 644 px form, no shadow, covers the last field on a phone | the column's width, the shared top shadow, "No unsaved changes" / "Unsaved changes", a focused field is scrolled clear of it |
| Loading | the text "Loading...", a jump of about 700 px | a skeleton of the final page; layout shift under 0.05, height within 8 px at 1366 |
| Load error | a plain alert with Retry | the shared record state: reason, error reference with copy, Retry, "Loaded" and focus on the heading |
| Time zone | free text with about 420 ids in a datalist | a select (US zones with their ids, the saved and browser zones as extra options, Other zones...), local time there, the display-zone sentence |
| Account menu | three entries, no identity or status | identity and status row, divider, a dot on the phone icon while out of office |
| Long name (66 characters) at 768 | header grows 57 to 66 px, search collapses (shell BUG-2, fixed by #592) | the title clamps to two lines with the full name as tooltip; header height unchanged |
| Initial bundle | 626.51 kB | 629.21 kB (budget 700 kB; the account menu now imports the availability chip) |

## Regression subsets run for the shared files that were touched

`record-skeleton` and `record-state` (unit specs of the Client, Matter, Project, Task, Asset and administration pages that use them: 77 files, 1061 tests), the user menu (`user-menu`, `nav-phone`, `shell-axe-guard`, every `sh-*` spec), Administration > Users "Edit availability" (`profile-pf7-users-dialog`, `profile-availability`), the Notifications section (`notifications-bell`, eight switches unchanged), and the PM, Search, Assets and `review-round-5` specs: 443 passed and 2 failed in the combined run; the two failures (`pm4-bulk-tasks`) passed on their own and on a quiet machine (they ran while the full unit suite shared the CPU).

## Open items

None for the page itself. Known limits: the Notifications card (added by the Notifications epic) sits in the right column, so the page as a whole still scrolls a little at 1366x768; the skeleton's card heights are those of a person with one role and no extra Pods.
