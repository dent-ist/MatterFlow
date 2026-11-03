# Feasibility: Dashboard v4 (data and endpoints)

Checked against `dev` on 2026-11-03 (backend `WorkViews`, `Identity`, `WorkManagement`; scripts 12 and 22).

| Need | Exists today | Missing |
|---|---|---|
| 4 card counts | `GET /api/v1/dashboard` returns Overdue, Unassigned, On hold, ASAP open with the Task Queue `query` for each and the pod scope; Dashboard.ViewUnassigned alone gets only Unassigned. | Nothing. The grid reuses those queries on the Task Queue endpoint (`unassigned`, overdue, hold, ASAP filters). Counts must keep the sensitive-matter filter (`VisibleTasks`), already applied. |
| Worker list by Workflow.Execute | `GET /dashboard/workload` lists every active user with any active role permission, in pod scope, with `openTotal`, `onHold`, availability and `loadLevel`. | No Workflow.Execute filter. **All seeded roles hold Workflow.Execute** (Director, Project Manager, Pod Lead, Technician, Data Scientist), so Execute alone includes managers. Needs: Execute (via role permissions, as the workload query already joins them) plus active pod membership, or a "takes work" flag. |
| Assigned task counts per worker | `openTotal` (New, In progress, On hold) and `onHold` per user, visibility-filtered. | Load for the battery = open minus on hold (derivable from `onHold`). Decide visible-only versus all (open question 6). |
| Work hours | `UserAvailability` (script 22): custom hours per weekday (`UserWorkHour`), `TimeZoneId`, firm default hours and zone. `IUserAvailabilityReader.EvaluateAsync` returns `AVAILABLE`, `OUT_OF_OFFICE` or `OFF_HOURS` per user at an instant, two queries for many users. The workload board already carries it. | Nothing for the battery. |
| Out of office | Same profile: from/until dates, note, `OutUntil`; `AwayWindowsAsync`. | Nothing. Show the note only to people who may see it (it is free text; the mockup shows only the date). |
| Task "unassigned since" | `Task.CreatedAt`; `Task.AssignedAt` is set on assign and **nulled on unassign** (`TaskService`), so "since the last unassign" is not stored. The Task Queue has a `created` sort and `AssignedAtUtc` in rows. | New column, e.g. `Task.UnassignedAt` (script 57, fix forward), set to now when the assignee is cleared and at create when none; the list shows `coalesce(UnassignedAt, CreatedAt)`. No backfill needed (demo data; old rows fall back to `CreatedAt`). Without it the age counts from creation, which overstates reassigned tasks. |
| Oldest and count for the gauge | Unassigned count exists. | Oldest unassigned timestamp in the scope: add to the summary DTO (min of unassigned-since over visible unassigned tasks in scope), computed in the same statement as the count. The level logic is client side (pure function, testable). Working-hours age needs the firm hours on the client (setting exists) or server-computed minutes. |
| Scope by pod | `DashboardScopeResolver` (all, my pods, one pod); Task has `AssignedPodId`; workload lists pod members for a pod scope. | Nothing. Unassigned tasks with no pod appear only under All pods (existing "no pod" hint applies). |

## Endpoints
- Reuse: `GET /dashboard` (cards), Task Queue list (grid), `GET /dashboard/scopes`.
- Extend `GET /dashboard/workload` with a `workersOnly` rule (Execute plus pod member) and a per-person `assignedActive` (open minus on hold), or add `GET /dashboard/capacity` returning only the battery data (id, name, initials, pod, state, load, `outUntil`), smaller than the full workload board. Needs `Dashboard.ViewUsers`.
- Extend the summary DTO with `oldestUnassignedAtUtc` (null when none), permitted for ViewSummary or ViewUnassigned. OpenAPI and nswag regenerate.
- Task Queue: sort and filter by `unassignedSince`; extra row field.

## Performance and sensitivity
- All counts are grouped queries on indexed `Task` columns (same shape as the existing summary and workload statements); the battery adds one availability read (two queries). 40 workers or 400 changes nothing. Poll with the existing 5-minute refresh; the gauge level is computed client side each minute from `oldestUnassignedAtUtc`, no extra calls.
- Visibility: every count and list goes through `VisibleTasks.Of(db, visibility)`. A person without access to sensitive matters sees lower counts, a lower gauge and lower worker loads. For capacity this hides real load; if the owner wants true load, return per-person numbers without task details (a deliberate aggregate disclosure, needs a decision). Never return matter names or task titles for hidden tasks.
- People data: availability note is free text; return state and end date only.
- No new permission needed (battery = ViewUsers, cards, grid, gauge = ViewSummary). Update the descriptions in `contracts/permissions.json` (Summary mentions the unassigned queue; Users mentions capacity).
