# Dashboard Frontend

[[_TOC_]]

**What this page is for.** How the Dashboard screens are organised in code, which tab needs which permission and which backend endpoint feeds it, and where its design rules are. The Dashboard is the largest feature folder (`frontend/src/app/features/dashboard`, 98 files). Backend side: [Availability Capacity and Calendar](../Architecture/Availability-Capacity-and-Calendar.md) and `WorkViews` in the [Module Guide](../Backend/Module-Guide.md).

## Tabs

The page (`pages/dashboard-page.ts`) is a WAI-ARIA tab set. The selected tab lives in the address (`?tab=`); only the permitted tabs are shown, the first is the default, and a link to a forbidden tab falls back to it. Each tab has its own `Dashboard.View<Tab>` permission in addition to `Dashboard.View`; a Dashboard with no tab permission is hidden from the menu and landing.

| Tab (`?tab=`) | Permission | Folder and main files | Backend endpoint (`/api/v1/dashboard/...`) |
|---|---|---|---|
| Summary (`summary`) | `Dashboard.ViewSummary` for the full Summary; `Dashboard.ViewUnassigned` alone gives the unassigned queue only (technician view) | `summary/`: `dash-summary-tab.ts`, `dash-cards.ts` (Overdue, Unassigned, On Hold), `dash-battery.ts` (capacity), `dash-gauge.ts` (unassigned gauge), `dash-grid.ts` (task grid), `dash-compact.ts`, `dash-people.ts` | `GET /dashboard`, `/dashboard/scopes`, `/dashboard/capacity`, `/dashboard/capacity/people`, and the Task Queue API for the grid |
| Breakdowns (`breakdowns`) | `Dashboard.ViewBreakdowns` | `ui/dash-breakdowns-tab.ts`, `breakdown-*.ts`, `bar-list.ts`, `stacked-bar.ts` | `GET /dashboard` (shared summary read) |
| Trends (`trends`) | `Dashboard.ViewTrends` | `ui/dash-trends-tab.ts`, `shared/charts` | `GET /dashboard`, `GET /dashboard/trend` |
| Swimlane (`swimlane`) | `Dashboard.ViewSwimlane` | `swimlane/`: `swimlane-lane.ts`, `swimlane-card.ts`, `swimlane-drawer.ts`, `swimlane-toolbar.ts`, `swimlane-prefs.ts`; `ui/dash-swimlane-tab.ts` | `GET /dashboard/swimlane` |
| Users (`users`) | `Dashboard.ViewUsers` | `users/` and `ui/dash-users-tab.ts`: views Workload, Skills, History drawer, and Coverage (`?view=coverage`, needs `Dashboard.ViewCoverage`) | `GET /dashboard/workload`, `/dashboard/users/skills`, `/dashboard/users/{id}/history`, `/dashboard/coverage` |
| Calendar (`calendar`) | `Dashboard.ViewCalendar` (absence reasons need `Dashboard.ViewAbsenceReasons`) | `calendar/`: `calendar-tab.ts`, `calendar-month-grid.ts`, `calendar-week-grid.ts`, `calendar-panel.ts`, `calendar-model.ts`, `calendar-api.ts` | `GET /dashboard/calendar/days`, `/day`, `/summary` |

## Shared pieces

- **Scope** (All, Mine, one pod) is page-wide: `dash-scope.ts`, `ui/scope-control.ts`; the server resolves `mine` from the caller's active pods.
- **Period** control: `dashboard-period.ts`, `ui/period-control.ts` (the Summary, Breakdowns and Trends tabs share one summary read; Swimlane and Users never wait on it).
- **URL state:** `dash-url-state.ts`, `dashboard-links.ts` (cards and charts link to the Task Queue with the exact filter that lists the number shown: every count equals the list it opens).
- **Preferences** (for example the hidden Summary panel and the collapsed role groups of the Calendar day panel): `dashboard-prefs.ts`.
- **Staleness and refresh:** `dash-stale.ts` (5 minute refresh, manual Refresh).
- **Server cache:** `Dashboard:CacheSeconds` (default 15) per user, period, zone, date and tab rights.

## Calendar day panel (#1242)

`calendar/calendar-panel.ts` draws the day panel of Month and Week: the three count tiles, coverage by pod, a search box, then the **Available** and **Not Available** lists. Each role is a sticky header band (a button in an `h4`, `aria-expanded`, `aria-controls`); the collapsed roles are kept per user in `DashboardPrefs.calendarCollapsed` (stored as `calendarCollapsed` in `mf.dashboard.v2.<user>`, written only while some are collapsed) and apply to both lists. "Collapse All" / "Expand All" and one jump chip per role (`mf-filter-chips`) sit under the Available title. A row shows the shared `mf-user-state-icon` (load 0 Idle, 1 Light, 2 Normal, 3 or more Heavy; Out of Office / Off Hours in the Not Available list), the name, the pods on one line and the load with three dots; a Not Available row shows a reason chip instead ("Back MM/DD", "Holiday", "Off Hours"). The state is the icon tooltip and the row's accessible name. Rules: guideline D-48a. No API change: the day endpoint already sends load, pods, reason and return day.

## Design rules and mockups

The Dashboard rules are in `docs/ux/theme-guide.md` sections 11.4 to 11.12 and 12 (Summary, Breakdowns, Users, Calendar) and guidelines D-43a, D-45, D-46, D-48 in `docs/ux/design-guidelines.md`. Design history: `docs/ux/dashboard-v2` to `dashboard-v5`, `docs/ux/dashboard-users`, `docs/ux/dashboard-trends-types`, `docs/ux/dashboard-swimlane`, `docs/ux/calendar`, mockups in `docs/ux/mockups/`.

## Tests

Unit specs sit beside the files (`*-model.spec.ts`, `users-table.spec.ts`, ...). End to end: Playwright specs named `dashboard-*.spec.ts` and `swimlane*.spec.ts` in `frontend/e2e/tests`.

## Related pages

- [Routing and Navigation](Routing-and-Navigation.md)
- [Feature Map](../Features/Feature-Map.md)
- [Testing the Frontend](Testing-the-Frontend.md)

Last verified against commit 2e446f8.
