# Detail layout: main area + Details panel

> **Update (#244):** the Client and Matter pages no longer use this layout. Their Details are the first tab (the default) and the right-hand panel is gone; see `docs/ux/org-details-tab/` and S05/S06 in `ux-spec.md`. The text and screenshots below still describe the Project page (and the earlier Client and Matter pages).

> **Update (#257, epic #245):** the Project page no longer uses this layout either: its Details are the second tab (Tasks (n) is first) and the panel is gone, see `ux-spec.md` 5.9 and S07. `mf-detail-layout` and the stored `mf.detail-panel.open` preference now serve the Task page only (the preference is ignored on a Project). The Client, Matter and Project rows below are history.

The Client, Matter and Project detail pages share one layout (`mf-detail-layout`, `frontend/src/app/shared/ui/detail-layout.ts`).

| Part | Behaviour |
|---|---|
| Main area (left, fluid) | Client: its Matters grid (search, status filter default Active, sortable, paging, "Create matter"). Matter: Tasks / Projects / Assets tabs (`mf-tabs`, kept in `?tab=`). Project: its Tasks grid. |
| Details panel (right, 340 px) | `aside` named by its "Details" heading: the record's fields, custom fields ("Not provided" for empty ones), Edit and Set inactive / Set active (Project: Archive / Restore). Sticky from 1100 px; scrolls by itself when taller than the window. |
| Below 1100 px | The panel moves above the main area (also in tab order) as a collapsible summary: a disclosure button (`aria-expanded`), expanded on tablets (>= 600 px), collapsed on phones. No horizontal page scroll at 768 or 375. |
| Activity | No longer a tab. An "Activity" button (history icon, needs `Audit.View`) in the page header opens a right-side modal drawer titled "Activity: <record name>" (`mf-activity-drawer`; focus trap, Esc closes, focus returns to the button). It reuses `mf-entity-activity`, so loading, empty and error states are unchanged. |
| Old links | `?tab=activity` opens the drawer (and the parameter is removed when it closes); `?tab=details` and `?tab=matters` just show the page. |

Screenshots (`<page>-<width>.png`; `-activity` has the drawer open; `-375-details-open` has the summary expanded), taken against the real stack (SQL Server in Docker, API with Dev auth, Chromium) with a client with 7 matters (one sensitive), a matter with 6 open tasks and a project:

- `client-1280.png`, `client-1024.png`, `client-768.png`, `client-375.png`
- `matter-1280.png`, `matter-1024.png`, `matter-768.png`, `matter-375.png`
- `project-1280.png`, `project-1024.png`, `project-768.png`, `project-375.png`
- `*-activity.png` for every page and width, `*-375-details-open.png` for every page

At 1280 the Matter's task table is about 650 px wide and scrolls sideways inside its own wrapper (as on every narrow table); the page itself never scrolls sideways.
