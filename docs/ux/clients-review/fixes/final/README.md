# Clients, Matters and Projects: final verification screenshots (#287, WP15)

Taken by `frontend/e2e/tests/clients-final.spec.ts` (run with `E2E_SCREENSHOTS=docs/ux/clients-review/fixes/final`) on the final tree of the epic (#245), System Admin, Dev auth, Chromium, one file per screen and size: `<screen>-<width>x<height>.png` at 1366x768, 1920x1080, 768x1024 and 375x812. Every shot is taken after the page passed axe (WCAG 2.2 AA and best-practice, 0 violations), the no-page-level-horizontal-scroll check and, for the lists, the 44 px row check (cards below 640 px) and, for the record pages, the header limit (tabs above y 200 at 1366, 260 on a phone).

| Screen | Files (sizes) |
|---|---|
| Clients list: filter row open, 44 px rows, Open tasks and Overdue columns, Status (cards at 375) | `clients-list-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Matters list (cards at 375) | `matters-list-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Projects list (cards at 375) | `projects-list-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Client Details, Overview tab, 150-character client name (header limit, summary strip) | `client-overview-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Client Details, Matters tab (matters list of the client, `Matters (n)` count) | `client-matters-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Matter Details, Overview tab, 150-character matter name (header limit, summary strip) | `matter-overview-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Matter Details, Tasks tab (summary strip in toggle mode over the Tasks grid) | `matter-tasks-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Matter Details, Projects tab (Active first, Archived group, counts) | `matter-projects-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Matter Details, Assets tab | `matter-assets-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Project Details, Tasks tab, 130-character project name | `project-tasks-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |
| Project Details, Details tab | `project-details-*.png` (1920x1080, 1366x768, 768x1024, 375x812) |

Also in this folder:

- `counts-System-Admin-1366x768.png`, `counts-all-View-permissions-1366x768.png`: the Project Tasks tab with its strip, taken at the end of the counts-in-the-browser check for those two people (the person without `Task.View` gets no strip and no count columns; no shot).
- `zoom-200-683x384.png`: 200 percent zoom at 1366 (a 683 px window), last of six screens checked there.

## Spot checks recorded with the shots

- Tabs of the long-name records (150-character client and matter, 130-character project) start at y 154 (client), 175 (matter) and 174 (project) at 768, 1366 and 1920, and at y 196, 220 and 188 at 375 (limits 200 and 260).
- Tab stops before the first row on the lists at 1366x768 (skip link not used): Clients 33, Matters 36, Projects 33.
- Not photographed (covered by the earlier package folders `fixes/wp1` to `fixes/wp13`): the loading, empty, filtered-empty, 403, 404, 500 and offline states, the Filters sheet, menus and the Activity drawer.
