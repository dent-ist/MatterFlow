# Dashboard v4 (Summary tab): plan (epic #1063)

Branch `dev`. Progress: `progress.md` in this folder. Decision: `docs/requirements/decisions-addendum.md` section AS. Mockup, README and feasibility: `docs/ux/mockups/dashboard-v4/` on branch `dashboard-mockup-v4` (read with `git show origin/dashboard-mockup-v4:docs/ux/mockups/dashboard-v4/index.html`). Related: #997 (TH-15). Note: the older files in this folder (`README.md`, `screenshots/`) belong to an earlier "Dashboard v4" tile change that is already built; this plan replaces the Summary design.

## 1. Goal

The Summary tab shows, in one fixed page: three Needs attention cards (Overdue, Unassigned, On hold) that filter the task grid; the grid in the shared list standard; and a fixed-width right column with one department capacity battery and an unassigned-duration gauge. A manager can assign an unassigned task inline. The Overview section is gone.

## 2. Issues and hours (agent-hours)

| Issue | Code | Title | Hours | Agent |
| --- | --- | --- | --- | --- |
| #1064 | DB-01 | Backend: unassigned-since (script 57), oldest unassigned and counts in the summary, working-hours age, settings | 6.0 | G |
| #1065 | DB-02 | Backend: capacity summary endpoint and People list | 7.0 | G |
| #1066 | DB-03 | Frontend: Summary layout, cards, grid in list standard, right column, Scope, phone, Technician | 6.0 | H |
| #1067 | DB-04 | Frontend: grid columns (Type icon, Due +9d, inline assign) | 7.0 | H |
| #1068 | DB-05 | Frontend: capacity battery | 4.5 | H |
| #1069 | DB-06 | Frontend: unassigned gauge and settings form | 4.5 | H |
| #1070 | DB-07 | Cross-cutting: OpenAPI/nswag, catalog/persona walk, e2e, axe, guide, decisions | 5.0 | G 2.0, H 3.0 |
| #1071 | DB-08 | Final QA (only when the owner says) | 6.0 | any |
| #1063 | DB-00 | Epic, issues, plan, decision AS | 2.0 | PM |
| | | **Total** | **48.0** | |

Agent G 15.0 h, Agent H 25.0 h, QA 6.0 h, PM 2.0 h. The mockup estimated 26 h with backend (17.5 h frontend only). Here: fewer cards and one battery instead of a cell grid save time; inline assign with the picker (about 4 h), the People popover, the settings form, the working-hours calculation and the larger test load add more.

## 3. Rules that shape the build

- **Worker** = active user holding Workflow.Execute AND an active member of a pod in the scope (join the way `WorkloadService` joins roles). No "takes work" flag.
- **State** by open assigned tasks (New, In progress; On hold excluded): 0 Available, 1 Occupied, 2 Busy, 3 or more Overloaded. Out of office and Off hours (existing `IUserAvailabilityReader`) are their own states with zero free slots. 3 slots per person.
- **Free capacity %** = free slots / (3 x workers). Charge of the battery = free %. Big text = "Capacity used" = 100 - free % (rounded). "N of M can take work now" = people available with at least one free slot. Evening note: off hours people count as used, so the figure is high after hours (explained in the tooltip).
- **Rate hint (planner decision):** a small "N assigned in the last hour" line from `Task.AssignedAt` (one cheap indexed count, aggregate). No trend arrow ("up 12% since 9 AM" needs history; not built). Dropped if it costs more than 0.5 h.
- **Gauge level** (server side, one function): age of the oldest unassigned task in WORKING minutes (default 8 AM to 6 PM, Monday to Friday, firm default time zone, the same zone source as `UserAvailability`; one level for all viewers); under 1 h = 0; 1 h = 1, 2 h = 2, 3 h = 3, 4 h = 4, 5 h or more = 5; plus 1 per 5 unassigned tasks, at most +2; total at most 5; none unassigned = All clear. Settings (defaults in code, no seed row): `Dashboard:Gauge:WorkdayStart` 08:00, `WorkdayEnd` 18:00, `WorkDays` Mon-Fri, `AgeBasis` WORKING|CLOCK, `LevelHours` 1,2,3,4,5, `TasksPerLevel` 5, `CountBonusMax` 2; `Dashboard:Capacity:SlotsPerPerson` 3.
- **Unassigned since:** script `db/scripts/57-task-unassigned-at.sql` adds nullable `Task.UnassignedAt` and a filtered index. Set to now when a task is created without assignee and whenever the assignee is cleared; set to null on assign. No backfill; reads use `coalesce(UnassignedAt, CreatedAt)`. `db/report-access.json` is expected to stay unchanged (check).
- **Sensitive matters, how:** cards, grid and gauge use `VisibleTasks.Of(db, visibility)` like today (hidden tasks not counted, never named). The capacity numbers count a worker's open assigned tasks in the database without the visibility filter, but only as integers inside the aggregate: the capacity endpoint returns no per-person data; the People endpoint (Dashboard.ViewUsers) returns name, state and load number per person; no task id, title, matter name or id is selected or returned for any task. Persona walk and endpoint catalog document this as the deliberate exception (decision AS item 12).
- **Permissions (none new):** battery, capacity endpoints, People = Dashboard.ViewUsers; cards, grid, gauge = Dashboard.ViewSummary; Technician (View + ViewUnassigned) = "Unassigned work" queue only. Inline assign = existing Task.Assign and the existing `POST /tasks/{id}/assignment`; the picker uses the existing `GET /users/lookup` (Task.Assign) which already returns availability and open task count; it gains `capacityState` and `load`.
- **Code location:** the Dashboard lives in `MatterFlow.WorkViews` (`DashboardController`, `Application/Queries/WorkloadService`, `DashboardScope`); the column writes live in `MatterFlow.WorkManagement` (`TaskService`); the lookup in `MatterFlow.Identity`. No new module; references only through `.Contracts`; `MatterFlow.ArchitectureTests` stays green.

## 4. API contract sketch (so G and H can work in parallel)

JSON is camelCase, enums are upper snake strings, times are UTC ISO strings. The scope parameter is the one `GET /dashboard` already takes (`DashboardScopeResolver`). These shapes are a sketch: Agent G may add fields, but renames or removals are announced in `progress.md` first.

```
GET /api/v1/dashboard            (existing; Dashboard.View + ViewSummary|ViewUnassigned|...)
  + unassignedGauge: {                      // only with Dashboard.ViewSummary; null otherwise
      count: int,
      oldestSinceUtc: string|null,
      oldestAgeMinutes: int,                // working minutes when ageBasis = WORKING
      ageBasis: "WORKING" | "CLOCK",
      level: int (0..5),
      asOfUtc: string }
  (existing cards: overdue, unassigned, onHold with counts and task-queue query; ASAP no longer drawn)

GET /api/v1/task-queue           (existing)
  + row.unassignedSinceUtc: string|null
  + row.unassignedForMinutes: int|null      // same basis as the gauge
  + sort key "unassignedSince" (oldest first)

GET /api/v1/dashboard/capacity   (new; Dashboard.ViewUsers; scope param)
  -> {
      asOfUtc: string,
      workers: int,
      slotsPerPerson: int (3),
      totalSlots: int, freeSlots: int,
      usedPercent: int, freePercent: int,
      canTakeWork: int,
      states: [ { state: "AVAILABLE"|"OCCUPIED"|"BUSY"|"OVERLOADED"|"OUT_OF_OFFICE"|"OFF_HOURS", count: int } ],  // all six, fixed order
      assignedLastHour: int|null }

GET /api/v1/dashboard/capacity/people   (new; Dashboard.ViewUsers; scope param; optional q, state)
  -> [ { userId: int, displayName: string, state: (same enum), load: int,
         outUntil: string|null /* date only */, podNames: string[] } ]   // at most 200, severity then name

GET /api/v1/users/lookup         (existing; Task.Assign)
  + item.capacityState: (same enum)
  + item.load: int                           // open minus on hold

POST /api/v1/tasks/{taskId}/assignment   (existing AssignTask; 409 on concurrency conflict)
```

Errors: 403 without the permission, 409 on assign conflict, empty scope returns `workers: 0` and zero counts (not 404).

## 5. Parallel split and file ownership

Two agents, each in its own worktree under `/home/user/wt/`, pushing only to `dev` (`git pull --no-rebase origin dev`, then `git push origin HEAD:dev`; no rebase, no force; never `main`).

**Agent G (backend):** DB-01, DB-02, the backend part of DB-07. Order: DB-01 script and column first, then DB-02, then regenerate OpenAPI and the nswag client and push them early (even before every test is polished) and write "client pushed" in `progress.md`.

**Agent H (frontend):** DB-03, DB-04, DB-05, DB-06, the frontend part of DB-07. Starts at once against fixtures that follow section 4 (a local `features/dashboard/dash-v4-contract.ts` with hand-written types and `dash-v4-fixtures.ts`, clearly marked temporary). When G has pushed the client, H deletes the temporary types, switches to the generated client and runs the full unit set. H never edits generated client files or `contracts/openapi`.

| Owner | Files and folders |
| --- | --- |
| Agent G | `db/scripts/57-*.sql` (number 57 reserved), `backend/src/Modules/MatterFlow.WorkViews/**`, `backend/src/Modules/MatterFlow.WorkManagement/Application/**` (task create/assign/unassign), `backend/src/Modules/MatterFlow.Identity/Api/UsersLookupController.cs`, Configuration settings keys, backend tests, `tools/seed-demo`, `contracts/**` (OpenAPI, permissions descriptions), generated frontend client, sensitive-matter catalog and persona walk, `db/report-access.json` if needed |
| Agent H | `frontend/src/app/features/dashboard/**`, new shared pieces only under `frontend/src/app/shared/ui/` (people picker, battery, gauge if shared), admin Settings Dashboard group, Dashboard e2e specs, `docs/ux/theme-guide.md` (section 11 additions only) |
| Shared | `docs/ux/dashboard-v4/progress.md` (append-only, one section per agent), decision AS status line |

Conflict points: `contracts/openapi` and the generated client (only G); `shortcut-registry.ts` (nobody); `dashboard-page.ts` (only H, so DB-03 first, then DB-04 to DB-06 in separate component files to keep diffs small); theme guide (H only).

Testing: cheap checks while building (lint, tsc, targeted unit tests). One full QA run only through DB-08, when the owner says.

## 6. Work per issue (short)

- **DB-01** script 57, `TaskService` writes, summary `unassignedGauge`, working-time and level pure functions with tests, settings keys, Task Queue row field and sort.
- **DB-02** `CapacityService` and two endpoints, shared `CapacityRules`, lookup extension, aggregate-only tests, permissions descriptions.
- **DB-03** layout, `mf-tabs`, Scope, 3 cards, grid in list standard, right column slots, phone and Technician views, Overview removal, spec updates.
- **DB-04** Type icon cell, Due formatter with suffix, Assign control and picker, refresh and 409.
- **DB-05** battery component, legend, tooltip, People popover.
- **DB-06** gauge A, aria-live on level change, reduced motion, settings form.
- **DB-07** OpenAPI/nswag, catalog, persona walk, e2e, axe, theme guide, decision status.
- **DB-08** full QA with evidence, only on the owner's word.

## 7. Risks

See epic #1063. Main ones: many Dashboard specs break together; a missed code path that clears the assignee; capacity deliberately not visibility-filtered (security review); off hours people make the evening battery read high; the worker rule depends on pod rosters; the working-hours age uses one firm time zone.

## 8. Not in this work

Assign actions beyond inline assign of unassigned tasks; a "takes work" flag; a battery trend or history; the list date-format change of other lists; retiring other widgets. No new or changed keyboard shortcuts (#420).

## 9. Open for the owner

None blocks the start. Optional: (a) accept that after hours the battery reads near 100% used; (b) accept the "assigned in the last hour" rate hint instead of a trend arrow; (c) confirm that the gauge uses the firm's time zone for all viewers.
