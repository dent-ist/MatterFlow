# Dashboard v5: unassigned-only Summary and one Refresh in the tab row (issue #81, epic #68)

Screenshots from the real stack (SQL Server in Docker, published API serving the Angular build, Chromium), produced by `frontend/e2e/tests/dashboard-v5-screens.spec.ts`
(`E2E_SCREENSHOTS=docs/ux/dashboard-v5 frontend/e2e/run-local.sh -g "dashboard v5 screenshots"`), with axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa) run on every screen: no violations.

## 1. Summary split: `Dashboard.ViewUnassigned`

| Permission (with `Dashboard.View`) | Summary tab shows |
|---|---|
| `Dashboard.ViewSummary` | Needs attention and Overview tiles with the period control, the Unassigned queue (also needs `Task.Assign` or `Dashboard.ViewUnassigned`), Overdue and Due soon lists |
| `Dashboard.ViewUnassigned` only | The Unassigned queue alone (no tiles, no period control, no other lists). The server sends only the size of the queue; every other count is 0 and the breakdowns are empty |
| both | Everything, as `ViewSummary` |

Default roles: Data Technician, Data Scientist (and the SME Intake Coordinator) hold `Dashboard.View` + `Dashboard.ViewUnassigned`; Director, Pod Lead, Project Manager, Read-Only Observer and Compliance Auditor keep `Dashboard.ViewSummary`. Migration `27-dashboard-unassigned.sql` moves existing roles with `ViewSummary` + `Task.Assign` and no department-level tab to `ViewUnassigned`.

| Screenshot | What it shows |
|---|---|
| `06-summary-technician-1366.png`, `06-summary-technician-375.png` | Data Technician: one tab (Summary) with the Unassigned queue only |
| `01-summary-director-1366.png` | Director: unchanged Summary |
| `07-role-editor-dashboard-group-1366.png` | Roles screen, Dashboard group with `Dashboard.ViewUnassigned` |

## 2. One icon-only Refresh in the tab row

The page-header Refresh button and the visible "Updated ... refreshes every 5 minutes" text are replaced by one icon button at the right end of the tab row on every tab: `aria-label="Refresh"`, tooltip "Refresh. Updated <time>. Refreshes itself every 5 minutes.", spinner and `aria-busy` while loading. It refreshes the tab shown. The 5-minute auto-refresh and the failed-refresh banner with Retry are unchanged.

| Screenshot | Tab |
|---|---|
| `01-summary-director-1366.png` | Summary |
| `02-breakdowns-1366.png` | Breakdowns |
| `03-trends-1366.png` | Trends |
| `04-swimlane-1366.png` | Swimlane |
| `05-users-1366.png` | Users |
