# PM experience: permission matrix (epic #758, #785)

Proved by `frontend/e2e/tests/px6-matrix.spec.ts` (and, per view, by `px3-*`, `px4-*`, `px5-*`, `pm5-access`). Fixtures: `frontend/e2e/support/pm-fixtures.ts`. A cell is what the test asserts; "-" means absent (hidden, never greyed).

| Variant (fixture) | Lands on | Menu | Scope switch on lists | My Matters tabs | Matter Overview | Matter header menu |
|---|---|---|---|---|---|---|
| Project Manager role (`pmA`; holds `Matter.AssignManagers`) | My Matters | My Matters, Matters, Tasks, Assets; More: Clients, Projects, My Work | My matters / All | Overview, Deadlines, Trends, Activity | health, status, deadlines, people, assets, activity | + New task, Bulk re-assign, Add comment, Open the matter's tasks |
| PM without `Matter.AssignManagers` (`pmNoAssign`) | My Matters | as above | - (held on My matters; `?scope=all` is ignored) | all five | all sections | as above |
| PM without `Task.View` (`pmNoTask`; has `Matter.AssignManagers`) | not My Matters | full menu, no My Matters, no Tasks | - | - | no tasks or deadlines sections, no overview request for them | - (no menu without Task.View) |
| Director (`Matter.BeManager` since issue #976, and `Matter.AssignManagers`; manages no matter in the fixture) | My Matters | full menu incl. My Matters | My matters / All | none while no matter is managed (the empty state "You do not manage any matter yet." with Go to Matters) | by permission | by permission |
| Read-Only Observer, Data Technician | not My Matters | full menu without My Matters | - | - | by permission | by permission |
| System Admin | previous landing (Dashboard / My Work) | full menu incl. Pod Work, no More group | - | My Matters opens from the menu | all | all |

## Endpoints (HTTP status asserted)

| Endpoint | Project Manager | PM without AssignManagers | PM without Task.View | Observer, technician |
|---|---|---|---|---|
| `GET /api/v1/my-matters/summary`, `deadlines`, `workload` (endpoint kept, not used by the UI since #826), `trends`, `activity`, `since-last-visit` | 200 | 200 | 403 | `summary` 403 |
| `GET /api/v1/my-matters/summary?scope=all` | 200 | **403** | 403 | 403 |
| `GET /api/v1/matters/{id}/overview` | 200 | 200 | 200 (tasks and assets sections are null) | not asserted |
| `GET /api/v1/matters?managedByMe=true` | 200 | 200 | not asserted | not asserted |
| `GET /api/v1/task-queue?managedByMe=true` | 200 | 200 | 403 | not asserted |
| `GET /api/v1/assets?matterManagedByMe=true`, `clients?...`, `projects?...` | 200 | 200 | not asserted | not asserted |

Sensitive-matter rule (`Features:SensitiveMatterAccess`): the PM specs were run once with the switch off and once on (see `docs/ux/pm-experience/review/README.md`, section "Verification").

## Reports (owner decision 8, 2026-11-07)

The starter Project Manager role holds `Report.Run` (script 65 for existing databases) and, from the starter seed, the two reports *Open and overdue tasks by matter* and *Tasks completed this month*. Persona rows: a Project Manager sees exactly those two in Reports (`ReportStarterTests`, `ReportAccessMatrixTests`); with scope *My matters* only matters they manage as Primary or Secondary manager; with scope *All matters* only if they hold `Matter.AssignManagers` (a PM without it gets *My matters*); a sensitive matter never unless they manage it; a report assigned to another role only (for example the Technician role) answers the Project Manager 404 on every endpoint. Director, Pod Lead, Data Technician and Data Scientist hold no `Report.Run` and the Reports menu item is hidden for them.
