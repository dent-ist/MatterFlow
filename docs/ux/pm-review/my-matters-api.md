# My Matters API as built (WP-PM2, epic #667)

The contract is `contracts/openapi/v1.json`; this page records the decisions where the build refined the plan in `README.md` section 5 and 6. The routes are in `MyMattersController` (WorkViews) and `MatterBulkTasksController` (WorkManagement).

## Access
- `GET/POST /api/v1/my-matters/*` need **`Task.View` and (`Matter.BeManager` or `Matter.AssignManagers`)**. A manager without `Task.View` gets 403 (the pages show task data and every count opens the Task Queue, which needs `Task.View`).
- `scope=all` and `managerId` need `Matter.AssignManagers` (403 `PERMISSION_DENIED`, `meta.permission`). `managerId` without `scope=all` is a 400.
- "My matters" is a default view, not access control: nothing here hides a matter from anybody who can view tasks.

## Common parameters
`scope=mine|all`, `role=both|primary|secondary`, `clientId`, `from`, `to`, `managerId` (All scope only), `fresh=true` (skip the summary cache). Unknown parameters are a 400. The viewer's time zone (`X-Time-Zone`) decides overdue and "due in N days", as in My Work.

- **`from` / `to` are a due-date range on the tasks**: with a range only open tasks with an explicit due date inside it are counted or listed (ASAP tasks have none), and every Task Queue link carries `dueFrom` / `dueTo`, so a count still equals its list. Overdue tasks fall outside a range that starts today or later; the page should send the range to the deadlines and activity calls only if it wants overdue work in the strip. On the activity call the range replaces the 7-day window (at most 90 days back).
- **No "No project manager" filter** was added to the All scope: the Task Queue has no equivalent filter, so counts could not equal their lists, and adding one would change the generated positional client methods of the Task Queue. The Matters list has `hasNoManager` already.

## Definitions
- **Unassigned** = open and no person (a pod may be set): the Task Queue's `unassigned=true` and the Dashboard's definition. (The plan text "no person and no pod" would not equal its link.)
- **Matters** = active matters in the scope. Inactive matters cannot hold open tasks (deactivation is refused while any task is open).
- **Flag**: Red = any open overdue task; Amber = no overdue but an open task is unassigned, or due within 3 days, or on hold longer than 7 days; Green otherwise; a matter with no open tasks is Green with reason `NO_OPEN_TASKS`. `flagReasons` lists every branch that applies. Manager state never enters it (`MyMattersRules.Flag`).
- **% workflow complete** = steps COMPLETED or SKIPPED over all steps of the workflow instances of the matter's open tasks, whole percent rounded down; null with no open task.
- **Stuck on hold** = On Hold since more than 7 full days (fixed). The attention group's "View all" query lists *all* tasks on hold, oldest first (the Task Queue has no age filter), so its total can exceed the group total.
- **On hold in the strip** carries `oldestHoldDays` and `oldestHoldSinceUtc`.

## Endpoints
| Route | Returns | Statements |
|---|---|---|
| `GET /my-matters/summary` | matters, open, overdue, dueIn3Days, dueIn7Days, unassigned, onHold (each `{count, query}`; `query` is for the Task Queue, or the Matters list for `matters`) + oldest hold | 2 |
| `GET /my-matters/attention` | groups `overdue`, `dueSoon`, `unassigned`, `stuckOnHold` with `total`, `query` and the first 10 tasks (`factCode`, `factDays`) | 7 |
| `GET /my-matters/health?sort=&dir=&page=&pageSize=` | rows, `total`, flag + reasons; sort `nextDeadline` (default) `client` `matter` `open` `overdue` `dueThisWeek` `unassigned` `flag`; page size 50 (max 100) | 3 |
| `GET /my-matters/workload` | pods (alphabetical, no-pod group last) with people; `userId` null = "not assigned to a person"; `availability` only while out of office | 4 |
| `GET /my-matters/deadlines?days=14\|28` | open, not overdue, due today to +N days, soonest first, 25 rows, `total`, `query` | 4 |
| `GET /my-matters/activity?take=` | last 7 days, 30 rows (max 100), structured events, `isUnread`, `unreadCount`, `seenEventId`, `hasMore` | 8 |
| `POST /my-matters/activity/seen` `{upToEventId?}` | moves the person's marker forward (to the newest event when omitted) | 2 |

## Activity and the unread marker
Kinds: `TASK_CREATED`, `STATUS_CHANGED` (from/to status codes), `REASSIGNED` (from/to names), `COMMENTED` (ordinary comments only, **never the text**), `MANAGER_CHANGED` (`managerPlace`, from/to names). The marker is the highest audit event id the person marked as read, in `dbo.UserMatterActivitySeen` (script 31); the Notifications store keeps one flag per notification and was not reusable. The first call of a person creates the marker at the newest event (nothing unread on the first visit); a person's own actions are never unread; the marker only moves forward.

## Bulk change: `POST /api/v1/matters/{matterId}/tasks/bulk`
Body `{taskIds[1..100], reassignTo?: {userId?, podId?}, priorityId?}`. A person alone keeps each task's pod; a pod alone moves the task to the pod's queue and clears its person; both set both. Needs `Task.Assign` for `reassignTo` and `Task.SetPriority` for `priorityId` (a missing one is a 403 for the whole request, nothing changes). Request-level problems (size, duplicates, nothing to change, unknown or inactive person, pod or priority, unknown matter) are 400/404 before anything is touched. Then each task is its own transaction through the single-task commands (assignment + priority atomic per task, auto-start on assignment, notifications and audit as for one task). The answer lists every task in request order: `{taskId, ok, code, message, warnings}` with codes `NOT_FOUND`, `NOT_IN_MATTER`, `TASK_NOT_EDITABLE` (completed or cancelled; New, In Progress and On Hold can change), `CONCURRENCY_CONFLICT`; the cross-pod case is the warning `USER_NOT_IN_POD`. `changed`, `failed` and one `correlationId` (shared by every audit entry of the batch) complete the answer. No undo.
