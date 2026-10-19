# Permission matrix of the Clients, Matters and Projects pages (WP13, #285)

Rule: **a link exists only if its target is reachable by that person; a control without its permission is absent, not disabled**, except where the design says "disabled with a reason" (Set inactive with open tasks, New matter for an inactive client, Create task for an archived project, and a Tasks tab without `Task.View`, which says so in a sentence). Counts are `null` in the API without `Task.View`, so the strip and the Open tasks and Overdue columns are left out (never a fake 0, never a 403).

The matrix is walked by `frontend/e2e/tests/clients-permissions.spec.ts`: for each role it opens the three lists and the three detail pages (with their tabs), checks the table below, collects every link in the page content, opens each target as that person and fails on any 401, 403 or 404 from the API, any error alert or toast, or any "no access" notice (the Tasks-tab sentence excepted).

## Roles under test

| Role | Permissions |
| --- | --- |
| all | System Admin (everything) |
| client-only | `Client.View` |
| matter-no-client | `Matter.View`, `Project.View`, `Asset.View`, `Task.View` (no `Client.View`) |
| no-task | `Client.View`, `Matter.View`, `Project.View`, `Asset.View` (no `Task.View`) |
| no-project | `Client.View`, `Matter.View`, `Asset.View`, `Task.View` (no `Project.View`) |
| no-matter | `Client.View`, `Project.View`, `Task.View` (no `Matter.View`) |
| no-asset | `Client.View`, `Matter.View`, `Project.View`, `Task.View` (no `Asset.View`) |

## What each permission controls

| Element | Present only with |
| --- | --- |
| Clients, Matters, Projects pages, nav items | `Client.View`, `Matter.View`, `Project.View` |
| Open tasks and Overdue columns, count links to the Task Queue, the strip on Overview and above the Tasks grids | `Task.View` |
| Client Matters tab, the matter links in the client Overview, "Matters with the most open tasks" | `Matter.View` |
| Client column of the Matters list (link), the Client link on a Matter | `Client.View` (otherwise the number and name are plain text) |
| Matter cell of the Projects list (link), the Matter line and the two crumbs (Matters, matter reference) on a Project | `Matter.View` (otherwise plain text) |
| Projects tab of a Matter, Project links in the Tasks grids (Project cell) | `Project.View` |
| Assets tab of a Matter | `Asset.View` |
| Edit, Activity, New matter / project / task, Set inactive, Archive (header buttons and the "..." menu) | their `Create`, `Edit`, `SetActive`, `Archive`, `Audit.View` permissions; a person with only View permissions has no header actions and no "..." menu at all |
| New client, New matter, New project (list headers and empty states) | `Client.Create`, `Matter.Create`, `Project.Create` |

A bookmark to a tab the person may not see (`?tab=matters` without `Matter.View`, `?tab=projects` without `Project.View`) shows the Overview, never an error.

## Gaps found and fixed in this package

| Gap | Fix |
| --- | --- |
| The Client column of the Matters table linked to the client without `Client.View` (a 403 page on click; the cards were already right) | plain text without the permission (`matters-list-page.ts`) |
| The two crumbs of a Project (Matters, matter reference) linked to the matter without `Matter.View` | `Crumb.plain`: the project page sets it from `auth.canLink('matter')`, `mf-record-header` draws plain text |

## Known design left as it is

A Matter or Project without `Task.View` still shows its Tasks tab. The tab says "You don't have permission to view tasks." in a sentence (no alert, no request, no toast), as WP7 decided; the Project page also opens on that tab because Tasks is its default tab. Hiding the tab (and defaulting a Project to Details) is a product change for the owner, not a fix; it is not done here.
