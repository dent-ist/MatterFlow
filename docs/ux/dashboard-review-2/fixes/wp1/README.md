# WP1 Shell foundations: screenshots

Taken by `frontend/e2e/tests/dashboard-shell.spec.ts` with `E2E_SCREENSHOTS=docs/ux/dashboard-review-2/fixes/wp1`, at 1366x768 and 375x812. Axe (wcag2a, 2aa, 21aa, 22aa) is clean on every state shown.

| File | State | Issue |
|---|---|---|
| `01-error-breakdowns-*` | Summary request fails: error inside the panel, tab row, Refresh, reference, no toast | #90 #95 |
| `02-error-swimlane-*`, `03-error-users-*` | Swimlane and Users errors use the same block | #95 |
| `04-stale-banner-*` | Failed background refresh: figures kept, banner with text Retry | #95 |
| `05-stale-age-*` | "Updated 10 min ago" beside Refresh (375 px: read by screen readers, not shown) | #94 |
| `06-view-only-note-*` | `Dashboard.View` only: menu item hidden, route keeps its note page | #99 |
| `07-forbidden-tab-note-*` | Pod Lead opens `?tab=breakdowns`: note and rewritten address | #98 |
