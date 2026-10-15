# Fixed-header grid screens

Product-owner request: on grid screens the whole page used to scroll. Now the page title, tabs, search box and control buttons stay where they are and **only the grid scrolls**, with sticky column headers and a pinned pager bar. This folder holds before and after screenshots of every affected screen (`before/` and `after/`, scrolled state, named `<screen>-<width>x<height>.png` at 1366x768, 1280x800, 1024x768, 768x1024 and 375x812) and this note.

## The pattern

```
+------------------------------------------------------------+
| app header (logo, global search, Create task, user)        |
+--------+---------------------------------------------------+
| nav    | [icon] Title      one-line description   actions  |  pinned (compact: one row)
| (own   | tabs ............................ search | Filters |  pinned
| scroll)| toolbar / chips                                    |  pinned
|        | +-----------------------------------------------+ |
|        | | column headers (position: sticky; top: 0)     | |
|        | | rows ...                                      | |  the ONE scrolling region
|        | | rows ...  (role="region", tabindex="0")       | |  (vertical and horizontal)
|        | +-----------------------------------------------+ |
|        | Rows per page [50]   Showing 1-50 of 312 [<] [>]   |  pinned bottom bar
+--------+---------------------------------------------------+
```

One shared mechanism (`frontend/src/app/shared/ui/fixed-page.ts`, `frontend/src/styles/_fixed-page.scss`):

| Piece | What it does |
| --- | --- |
| `<mf-fixed-page>` | The page layout: `height: 100%` of the shell's main area, a flex column, `min-height: 0`, never scrolls itself. Carries `data-fixed-page` (what the unit test looks for) and `data-scrolled` once the grid has scrolled. |
| `[mfScrollArea]="'Task Queue list'"` | The scrolling region: `role="region"`, `tabindex="0"`, name "Task Queue list, scrollable", `overflow: auto` both ways, `scroll-padding-top` for the sticky header, `data-scrolled` when scrolled. Returns to the top when the list changes, restores the position on Back/Forward. |
| `.mf-fill` | A container that fills what is left of a fixed page (tab panels, tab content, `mf-list-state`, `mf-work-list`). |
| sticky headers | `.mf-scroll-area thead th { position: sticky; top: 0 }` with a hairline and a soft shadow once rows have scrolled under it; the header scrolls sideways with the columns because it lives in the same box. |
| pager | `mf-pager` (and the Task list footer, the audit "Load more" bar) is a flex item pushed to the bottom (`margin-top: auto`) with a top border and shadow. |
| app shell | `ShellLayout` counts the fixed pages on screen; while one is shown the root is exactly one window tall (`100dvh`, below the dev banner if there is one), the main area does not scroll, and the left nav scrolls by itself. |
| compact parts | `mf-page-header` (22 px title, description on the title row cut with an ellipsis and a tooltip, actions right), `mf-tabs`, `mf-search-box` (no visible label, hint only while focused), `mf-status-filter` (label beside the select) switch to compact styles when they sit inside a fixed page. |

The page header, tabs and toolbar are simply whatever sits above the scroll area; nothing needs to be slotted. Dashboard, Create Task, the create/edit forms, the workflow designer and version page, the task detail page, the step/task type forms and the system pages (Access Pending, 403, 404, error) do not use it and keep the normal page scroll.

## Screens

| Screen | Route | Pinned | Scrolls | Screenshots (1366x768) |
| --- | --- | --- | --- | --- |
| Task Queue | `/tasks` | title + Sorted by / Columns, search, Filters, quick views, chips | task grid | [before](before/task-queue-1366x768.png) / [after](after/task-queue-1366x768.png) |
| My Work | `/my-work` | title + Sorted by / Columns, tabs, search, Filters | task grid | [before](before/my-work-1366x768.png) / [after](after/my-work-1366x768.png) |
| Pod Work | `/pods/work` | title + Pod picker + Sorted by / Columns, summary line, tabs, search, Filters | task grid (By member: member table above, own scroll) | [before](before/pod-work-1366x768.png) / [after](after/pod-work-1366x768.png) |
| Clients | `/clients` | title + New client, search, Status | client grid | [before](before/clients-1366x768.png) / [after](after/clients-1366x768.png) |
| Matters | `/matters` | title + New matter, search, Status | matter grid | [before](before/matters-1366x768.png) / [after](after/matters-1366x768.png) |
| Projects | `/projects` | title + New project, search, Status | project grid | [before](before/projects-1366x768.png) / [after](after/projects-1366x768.png) |
| Assets | `/assets` | title + New asset, search, Type, Status | asset grid | [before](before/assets-1366x768.png) / [after](after/assets-1366x768.png) |
| Client page | `/clients/:id` | breadcrumb, title, Activity, Matters search / Status / Create matter; Details panel scrolls by itself | the client's Matters grid | [before](before/client-matters-1366x768.png) / [after](after/client-matters-1366x768.png) |
| Matter page | `/matters/:id` | breadcrumb, title and actions, client line, Tasks / Projects / Assets tabs, Show filter; Details panel | the matter's Tasks grid (Projects and Assets tabs likewise) | [before](before/matter-tasks-1366x768.png) / [after](after/matter-tasks-1366x768.png) |
| Project page | `/projects/:id` | breadcrumb, title, matter line, Show filter; Details panel | the project's Tasks grid | [before](before/project-tasks-1366x768.png) / [after](after/project-tasks-1366x768.png) |
| Users (tab) | `/admin/users` | title, Users / Roles tabs, search, Status, pending cue | users grid; the detail panel scrolls by itself with its Save bar pinned | [before](before/admin-users-1366x768.png) / [after](after/admin-users-1366x768.png) |
| Users (Roles tab) | `/admin/roles` | title, tabs, intro line + New role | role list (the editor is a second scroll area with a pinned Save bar) | [before](before/admin-roles-1366x768.png) / [after](after/admin-roles-1366x768.png) |
| Pods | `/admin/pods` | title + New pod, search, Status | pods grid (the pod editor is a normal page with a sticky Save bar) | [before](before/admin-pods-1366x768.png) / [after](after/admin-pods-1366x768.png) |
| Task Types & Forms | `/admin/task-types` | title + New task type, search, Status | task types grid | [before](before/admin-task-types-1366x768.png) / [after](after/admin-task-types-1366x768.png) |
| Workflows | `/admin/workflows` | title + New workflow, search, Status | workflows grid | [before](before/admin-workflows-1366x768.png) / [after](after/admin-workflows-1366x768.png) |
| Workflow Steps | `/admin/steps` | title + New step, search, Status | steps grid | [before](before/admin-steps-1366x768.png) / [after](after/admin-steps-1366x768.png) |
| Labels: Priorities | `/admin/priorities` | title, Priorities / Status labels links, reorder hint | priorities grid (Add priority form pinned under it) | [before](before/admin-priorities-1366x768.png) / [after](after/admin-priorities-1366x768.png) |
| Labels: Status labels | `/admin/status-labels` | title, links | status labels grid | [before](before/admin-status-labels-1366x768.png) / [after](after/admin-status-labels-1366x768.png) |
| Assets admin: Asset Types | `/admin/asset-types` | breadcrumb, title, tabs, intro + New asset type, search, Status | asset types grid (the inline form is a capped panel with a sticky Save bar) | [before](before/admin-asset-types-1366x768.png) / [after](after/admin-asset-types-1366x768.png) |
| Assets admin: Link Roles | `/admin/asset-types?tab=link-roles` | breadcrumb, title, tabs, intro | link roles grid (Add form pinned under it) | [before](before/admin-link-roles-1366x768.png) / [after](after/admin-link-roles-1366x768.png) |
| Custom Fields | `/admin/custom-fields` | title | objects grid | [before](before/admin-custom-fields-1366x768.png) / [after](after/admin-custom-fields-1366x768.png) |
| Audit Logs | `/admin/audit` | title, Filters button (the filter form is folded away and capped when open), Group toggle | audit events grid; Load more is the pinned bottom bar | [before](before/admin-audit-1366x768.png) / [after](after/admin-audit-1366x768.png) |

Other sizes of every screen: `before/<screen>-1280x800.png`, `-1024x768`, `-768x1024`, `-375x812` and the same names under `after/` (screen = the first column of the file names: `task-queue`, `my-work`, `pod-work`, `clients`, `matters`, `projects`, `assets`, `client-matters`, `matter-tasks`, `project-tasks`, `admin-users`, `admin-roles`, `admin-pods`, `admin-task-types`, `admin-workflows`, `admin-steps`, `admin-priorities`, `admin-status-labels`, `admin-asset-types`, `admin-link-roles`, `admin-custom-fields`, `admin-audit`). The data is the seeded bulk set: 65 tasks, 30 clients (one with 40 matters), 30 projects, 60 assets, 25 users, 14 more workflows and task types and the audit rows they leave.

## Sticky action bars

Long forms keep their buttons in view: `mf-form-actions--sticky` (border-top, background, shadow) pins the Save / Cancel row to the bottom of the window (or of the scrolling panel it sits in) on Create Task, the Client, Matter, Project and Asset forms, Task Type edit, Step edit, Workflow edit, the Roles editor, the Pods editor, the Asset Type form and the Users details panel.

## Compactness

Pinned area at 1366x768 (without the dev banner): title row 36 px, toolbar 44 px, quick views on the same row from about 1280 px, grid header 40 px, pager bar 44 px. Visible grid rows with the seeded data (rows with a title and a "Client / Matter" line are about 52 px; a long title that wraps adds a line):

| Screen | 1366x768 | 1280x800 |
| --- | --- | --- |
| Task Queue | 9 | 7 |
| My Work | 7 | 7 |
| Pod Work | 7 | 6 |
| Clients | 12 | 13 |
| Matters / Projects | 10 | 11 |
| Assets | 9 | 10 |
| Client page (Matters) | 9 | 10 |
| Matter page (Tasks) | 7 | 8 |
| Users | 9 | 10 |
| Task Types & Forms | 10 | 10 |
| Workflows / Workflow Steps | 11 | 12 / 11 |
| Audit Logs | 8 | 9 |

Task Queue at 1366x768 shows at least 8 rows (asserted by an e2e test with short titles). My Work and the matter Tasks grid carry an extra "workflow progress" line or a narrower Title column, so they show 7 to 8.

## Phones, short windows and zoom (WCAG 1.4.10)

The fixed layout is on only from **768 px wide and 561 px high**. Below that (phones, a landscape tablet that is short, and any browser zoom that leaves less than that: 200% on a 1366x768 screen is 683x384 CSS px) the page scrolls normally, nothing is pinned, the grid is as tall as its rows and scrolls only sideways. The two media queries live in one place (`@media (min-width: 768px) and (min-height: 561px)`, also `FIXED_MODE_QUERY` in `fixed-page.ts`).

## Accessibility

- The grid region is focusable (`tabindex="0"`), has a role and a name ("Clients list, scrollable"), keeps its Tab order and scrolls with the arrow, Page and Home/End keys; focus rings are visible (inset on the region).
- A focused row link is never left under the sticky header (`scroll-padding-top`).
- The skip link still focuses `#mf-main`; the reading order of the page is the DOM order and did not change except that Columns / Sorted by now come right after the title and the quick views come before them in the toolbar.
- Reduced motion: nothing animates (the tokens already switch animations off).
- axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa and best-practice) on all 22 screens at 1366x768: 0 violations.

## Overlays, popovers, dialogs

The inline Status, Priority and Assignee menus are `position: fixed` (and close when the grid scrolls), the Undo toast is fixed, dialogs and the Activity drawer are PrimeNG overlays, so none is clipped by the scroll area. The Columns chooser and the sort rule open from the title row above the grid (the header sits above the toolbar in z-order) and the chooser is capped to the window height with its own scroll. A tall Filters panel (Task Queue, My Work, Pod Work) and the Audit Logs filter form are capped to 40 to 45% of the window height and scroll inside themselves, so the grid never leaves the screen. Inline forms (asset types) are capped panels with a sticky Save bar.

## Other behaviours

- Ctrl+F finds text in the whole grid (every row stays in the DOM; only the box scrolls).
- Back and Forward put the grid back where it was (`ScrollMemory`, per address, in memory; a reload starts at the top).
- A new page, sort, filter, tab or page size starts at the top (every one is a navigation; the audit filters and the local lists use `resetKey`).
- Printing (`@media print`): the shell, the main area and the grid become normal flow, the sticky headers become static and the pager bar is hidden, so the whole grid prints.
- Dashboard drill-through links (`/tasks?overdue=true...`) and `?tab=` links are unchanged.

## Tests

- Unit: `shared/ui/fixed-page.spec.ts` resolves every URL of the list above in the real route tree and asserts its component uses `mf-fixed-page` (22 URLs), asserts that the forms, the dashboard, the designers, the task page and the system pages do not (24 URLs), and covers the shell counter, the focusable named region, the scrolled flag, the reset on navigation and the scroll memory.
- E2E: `e2e/tests/fixed-header.spec.ts` seeds 64 tasks and long client/matter lists and asserts that title, search, Filters and the header row keep the same position while rows move (Task Queue, My Work, Pod Work, Clients, Client page), at least 8 rows at 1366x768, paging and sorting scroll back to the top, the Audit and Task Queue filter panels do not push the grid away, the inline Status menu and the Columns chooser are not clipped, keyboard scrolling and the skip link, a focused link is not under the sticky header, Back restores the position, print shows the whole grid, the Create Task action bar stays at the bottom, and at 375 px wide, under 561 px high the page scrolls normally while the Dashboard is unchanged.
- Screenshots: `E2E_SCREENSHOTS=docs/ux/fixed-header/after E2E_SEED_BULK=1 frontend/e2e/run-local.sh -g "fixed-header screenshots"` (`e2e/tests/fixed-header-screens.spec.ts`; `E2E_SEED_BULK=1` seeds the long lists first).

## Decisions and deferred

- Reading order: the quick views moved before Sorted by / Columns, which now sit on the title row; the page header description is one line on the title row (full text as a tooltip) instead of a paragraph under it.
- Audit Logs: the filter form is folded behind a Filters button (it was always open and 230 px tall); the active count shows on the button.
- Record pages narrower than 1100 px stack the Details panel above the grid; it starts open only when the window is at least 900 px high.
- Deferred: the Back/Forward position is kept in memory only (a reload starts at the top); the By member table of Pod Work and the Projects / Assets tabs of a matter use their own small scroll areas rather than the Task grid's pinned pager; row virtualisation for very long pages (the pages are server paged at 25 to 100 rows, so it is not needed).
