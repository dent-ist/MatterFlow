# WP6: Summary deltas and the Technician Summary (#102 S3, #108 S9)

Screenshots in this folder are taken by `frontend/e2e/tests/dashboard-summary-deltas.spec.ts` (run with `E2E_SCREENSHOTS` set to this folder). Each scenario owns a pod and opens the Dashboard with `?pod=<id>`, so the numbers come from the tasks the spec seeded (backdated with `Seeder.ageTask`).

| File | What it shows |
|---|---|
| `deltas-neutral-1366.png` | Overdue "= no change vs yesterday", Open "+1 vs yesterday", Created "+1 vs previous 30 days", Completed "-1 vs previous 30 days"; nothing under Unassigned, On hold, Due soon, ASAP open |
| `deltas-attention-1366.png` | Overdue "+2 vs yesterday" in the attention colour (glyph and words as well), Open "+2 vs yesterday" neutral |
| `deltas-axe-1366.png`, `deltas-axe-1920.png`, `deltas-axe-375.png` | The same page at the three sizes after axe (375 is a full-page shot: the line wraps inside its tile) |
| `technician-1366.png` | "Unassigned work", no tab row, Scope "My pods", the own-work line, Priority and Task type filters, the queue limited to the pod |
| `technician-filtered-1366.png` | Priority = Critical and Task type = Redaction: chips, one row, "1" in the count; the address carries `sprio` and `stype` |
| `technician-axe-1366.png`, `technician-axe-1920.png`, `technician-axe-375.png` | The technician page at the three sizes after axe (filters wrap at 375) |

## What the API adds (`GET /api/v1/dashboard`, additive, no SQL script)

- `overdueYesterday`, `openYesterday`: the Trends snapshot of yesterday for the same scope (created by the end of the viewer's yesterday; not Completed or Cancelled by then; for Overdue a due moment that had passed by then; no status replay), three scalar counts in the one headline statement. Tile minus delta equals yesterday's Trends point (integration test `DashboardDeltasApiTests`, 88 cases at four fixed instants and three zones).
- `completedPrevious`, `createdPrevious`, `previousPeriod { kind, from, to }`: the period of equal length directly before the selected one, or for "This month" the same days of the last month (`DashboardPeriods.Previous`).
- Each value is null when nothing existed at the baseline (no task by the end of yesterday; none before the start of the previous period). A pod or account younger than the comparison shows no line.
- `mine { open, overdue }`: only for `Dashboard.ViewUnassigned` without `Dashboard.ViewSummary`; the viewer's own open and overdue tasks by the Task Queue definitions. Such a viewer still gets no department figures and no deltas.

## Small fixes in the same package

- The tab list is the only part of the header row that may be wider than the window: `contain: inline-size`, and the tab is revealed by scrolling the list (`revealInList`), never with `scrollIntoView`, which also scrolls the page sideways. `dashboard-shell.spec.ts` checks 320 and 375 px on every tab and with End, Home and the arrow keys.
- `TaskQueueColumnFilterTests.Updated_range_keeps_the_tasks_updated_in_it...` builds its own database with a fixed host clock (23:30 on the 13th in New York, 17:30 on the 14th in Kiritimati) instead of the UTC date of the day it runs.
- `dashboard-fixed-height.spec.ts` seeds one open task in each of nine task types so the Breakdowns cards are taller than a 1024x768 window on an empty database.
