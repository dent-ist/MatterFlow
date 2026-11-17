# Task Type access by role: design and read-path inventory

Epic #1397, design issue #1398. Status: **design only, owner decisions of 2026-11-17 recorded in section 17** (written 2026-11-17 on `origin/dev` at `11fae2b4`; no code, schema, OpenAPI or permission change comes with this note). Decisions: `docs/requirements/decisions-addendum.md` section AW. The model is a sibling of the sensitive-matter rule (`docs/ux/sensitive-matters/README.md`, architecture section 6.8) and reuses its port, its 404 mode, its guards and its go-live pattern. Code facts below were read from `dev` on the date above; file:line references drift, so the first work package that touches a file re-greps it (the endpoint catalogue test is the real authority, section 12).

The inventory (section 15) is the work list for #1399 to #1403.

## 1. The rule (binding owner decisions)

Each Task Type has three role lists. A role is an app permission role (`dbo.Role`, granted through `dbo.UserRole`; a person can have several). It is not the HR Title.

| List | Meaning |
|---|---|
| Can View | Roles that may see tasks of this type. |
| Can Edit | Roles that may change tasks of this type (fields, status, complete, cancel, reopen, comments, workflow steps) and create tasks of it. |
| Can Be Assigned | Roles whose people the server accepts as assignee of tasks of this type, and that the assignee pickers offer. |

- A person qualifies for a list when **any** of their (active) roles is in it. Roles add up (union); nothing subtracts.
- **No roles in Can View = open to everyone.** Today's types keep working unchanged. A type is *restricted* exactly when Can View has at least one role. Edit and Assign imply View: every role in Can Edit or Can Be Assigned is also in Can View (the screen adds it; the database refuses anything else, section 3).
- The type rule is **additional**. A task is visible only when the existing rules pass (`Task.View`, the sensitive-matter rule of epic #788) **and** the type rule passes. Edit and assign actions keep their normal permission (`Task.Edit`, `Task.Assign`, `Workflow.Execute`) and also need the type rule.
- **Hidden means hidden.** A hidden task is absent from every list, count, search, notification, export, audit view, report and picker, and a direct address gets the same 404 as a missing id (the mode of architecture 6.8).
- **No exception for the assignee** (unlike sensitive matters, where the assignee sees their own task). **No special access for project managers.** **System Admin sees everything** (and only System Admin: `Matter.ViewSensitive` does not lift the type rule).
- Reports respect the rule (target of the epic; at go-live reports stay as they are, an accepted limitation, section 14).
- System actions may create tasks of a restricted type (section 9.5).
- Counts come from the visible set, never from "all minus hidden".
- Go-live switch `Features:TaskTypeAccess`, default `false`; off means behaviour exactly as today. `TaskType.IsRestricted` keeps the unrestricted case cheap. The app is not deployed, so no backfill of old rows is needed (CLAUDE.md, status of 2026-10-24).

### 1.1 What an empty Edit or Assign list means (owner decision)

The owner text fixes the View list only. This note reads the other two the same way, as "no extra limit":

| Can View | Can Edit | Can Be Assigned | Result |
|---|---|---|---|
| empty | empty | empty | open type, today's behaviour |
| A, B | empty | empty | A and B see it; both may edit; any person who can see it and holds `Workflow.Execute` may be assignee |
| A, B | A | empty | A and B see it; only A edits (B is read-only) |
| A, B | A | B | A edits; only B can be assignee (a person with both roles qualifies for both) |

Empty Edit meaning "nobody may edit" would make a freshly restricted type read-only for everyone, which nobody wants; empty Assign meaning "nobody" would make it unassignable. Owner decision: the table above.

### 1.2 Definitions

For a viewer `v` (person, roles, `IsSystemAdmin`) and a task `t` of type `ty`:

- `TypeViewable(ty, v)`: `NOT ty.IsRestricted OR v.IsSystemAdmin OR EXISTS access row (ty, role in v.ActiveRoles, CanView = 1)`.
- `TypeEditable(ty, v)`: `TypeViewable AND (v.IsSystemAdmin OR no row of ty has CanEdit = 1 OR EXISTS row (ty, role in v.ActiveRoles, CanEdit = 1))`. For an open type (not restricted) the Edit and Assign lists are empty by constraint, so it reduces to true.
- `TypeAssignable(ty, user)`: the same for `CanAssign`, evaluated for the proposed assignee, not the caller. System Admin is a valid assignee only if they hold `Workflow.Execute` (they hold every permission); the Admin bypass applies to *seeing*, not to being offered as assignee. Owner decision: no admin exception.
- `TaskVisible(t, v)` = `(matter rule OR assigned to v)  AND  TypeViewable(t.TaskTypeId, v)` (the existing mode T from 6.8, with the new term AND-ed on the outside, so the assignee exception of sensitive matters does not rescue a hidden type).
- Active roles only: a deactivated role (`Role.IsActive = 0`) grants nothing, matching how the permission snapshot treats inactive roles (`MatterVisibility.ForAsync` filters `ur.Role.IsActive`).

## 2. Permission

No new permission. Reading and writing the access lists uses the existing **`TaskType.Manage`** ("Manage task types and their workflows", group Configuration, `contracts/permissions.json`), which already guards `POST/PUT /api/v1/task-types` (`ConfigurationPolicies.TaskTypeManage`, `PrioritiesController.cs:22`). Nothing in `contracts/permissions.json`, `Permissions.cs` or `permissions.ts` changes, so there is no permission parity work.

The role pick list needs one read widening: `GET /api/v1/roles` is open to `User.View` or `Role.Manage` (`RolesController.cs`, `ReadAccess`); the file already states the principle "each administration permission is enough to read what it manages". Add `TaskType.Manage` to that read access (names, ids and active flag are all the dialog needs; the member counts in the same payload are a minor extra). If the owner prefers not to widen it, #1399 adds a names-only `GET /task-types/access-roles` instead. Recommendation: widen (precedent, one line).

Who sees the access lists on a type: only `TaskType.Manage` holders (the `access` object is omitted otherwise, like `openTaskCount` is null without `Task.View`). Everyone else sees only the types the type rule lets them see, with no hint about the lists.

System Admin holds every permission implicitly; the role-screen grant rows are unaffected.

## 3. Data model changes

New numbered script (**next free number at implementation time; 81 on `dev` today**; scripts after the baseline are immutable, fix forward; never touch `archive/`).

| Change | Why |
|---|---|
| `dbo.TaskType.IsRestricted BIT NOT NULL DEFAULT 0` | The cheap flag. Maintained in the same transaction as the access rows by the one service that writes them; true exactly when a row with `CanView = 1` exists. A consistency query ships with the tests and the runbook (a type with the flag and no View row, or the reverse, is a defect). |
| `dbo.TaskTypeRoleAccess (TaskTypeId INT, RoleId INT, CanView BIT, CanEdit BIT, CanAssign BIT, CreatedAt, CreatedByUserId)`, PK `(TaskTypeId, RoleId)`, FK to `TaskType` and `Role`, `CHECK (CanView = 1 OR (CanEdit = 0 AND CanAssign = 0))` (Edit and Assign imply View), `CHECK (CanView = 1 OR CanEdit = 1 OR CanAssign = 1)` (no empty rows), index `IX_TaskTypeRoleAccess_Role (RoleId) INCLUDE (TaskTypeId, CanView, CanEdit, CanAssign)` | The viewer lookup is "rows for my roles". |
| `GRANT SELECT, INSERT, UPDATE, DELETE` to `lpt_app` (Delete is needed: the lists are replaced as a set) | Standard. |
| `db/report-access.json` entry plus GRANT or DENY line | See section 14: the table is **allow**ed only if the chosen report mechanism needs it; the default is DENY (access configuration is not report data). A unit test fails for an unclassified table. |
| Replace `dbo.fnTaskVisible` | Section 4.3. |
| Wiki: `Database/Table-Reference.md`, `ER-Diagrams.md`, `Schema-Script-History.md` | Same change as the script (CLAUDE.md wiki rule). |

### 3.1 One wide table, not three tables and not an "Access kind" column

| Option | Verdict |
|---|---|
| **One row per (type, role) with three flags** (chosen) | The implication rule is a row-level `CHECK`, so the database itself refuses "Edit without View". One row per role is what the dialog edits and what the audit event describes. The viewer lookup is one seek by role. |
| One row per (type, role, `AccessKind`) | Implication across rows cannot be a constraint (it needs a trigger or a service-only guarantee); three rows to read for one fact; more joins in the predicate. |
| Three tables | Same implication problem, three FKs and three indexes, no benefit. |

The cost of the wide table is that a future fourth kind of access (for example "Can Reassign") is a new column in a new script. That is acceptable: kinds are product decisions, not data.

### 3.2 No index change on `Task`

The rule filters `Task.TaskTypeId`, which is already the second term of `IX_Task_Type (TaskTypeId, StatusCode)` and an INCLUDE of `IX_Task_Queue`, `IX_Task_CompletedCoverage` and `IX_Task_Matter_Type`. The predicate is a `NOT IN (small list of constants)` (section 4.2), so no new `Task` index is expected; the performance gate (12.5) proves it with the plan.

## 4. The visibility port (one place)

The rule is written once, next to the sensitive-matter rule, in the same port. No module gets a second implementation, no EF global query filter (the sensitive design decided against it, section 4 of that note, and nothing here changes the reasons).

### 4.1 Interface changes (SharedKernel `Visibility/`, implemented in Identity)

- `Viewer` gains the facts the type rule needs: `IsSystemAdmin` (the matter `SeeAll` is not enough: `Matter.ViewSensitive` holders are `SeeAll` for matters only) and, once per request, `HiddenTypeIds` (see 4.2). `Viewer.Nobody` (jobs without a person) sees open types only.
- `TaskAccessRow` (SharedKernel `AccessRows.cs`) gains `TaskTypeId`; `TaskAccessSource.Rows()` (`WorkManagement/Application/TaskAccessSource.cs:14`) projects it.
- Every task-shaped method of `IMatterVisibility` applies the type term on the outside: `VisibleTasks`, `WhereTaskVisible`, `WhereTaskVisibleBy`, `WhereTaskFlagVisible`, `WhereTaskRowVisible`, `CanSeeTaskAsync`. The ones that take column expressions (`WhereTaskVisibleBy`, `WhereTaskFlagVisible`, `WhereTaskRowVisible`) get an additional `Expression<Func<T, int>> taskTypeId` parameter. A caller that cannot supply it does not compile, so "forgot the type" is a build error, not a leak.
- New single-record helpers: `CanEditTaskAsync(taskId)`, `CanEditType(typeId)`, `CanCreateType(typeId)` (same as edit), `CanBeAssigned(userId, typeId)`, and `TypeNotFound()` (the generic 404 / "not found" validation, section 5). Matter-only methods (`VisibleMatters`, `WhereMatterVisible*`, `CanSeeMatterAsync`) are untouched: the type rule never hides a matter.
- `AccessStampAsync` (section 10).
- `Enabled` becomes `SensitiveEnabled || TypeAccessEnabled`; each rule has its own switch (`Features:SensitiveMatterAccess`, `Features:TaskTypeAccess`, one options class each, read only in the port).

### 4.2 How the viewer's hidden types are found (cheap, no caching of a stale answer)

At the start of a request (`PrepareAsync`, the same hook as the managed-matter list; `[PreparesViewer]` filter) the port reads, in **one indexed statement**:

```
HiddenTypeIds(viewer) =
  SELECT ty.TaskTypeId FROM dbo.TaskType ty
  WHERE ty.IsRestricted = 1
    AND NOT EXISTS (SELECT 1 FROM dbo.TaskTypeRoleAccess a
                    JOIN dbo.UserRole ur ON ur.RoleId = a.RoleId AND ur.UserId = @me
                    JOIN dbo.Role r ON r.RoleId = ur.RoleId AND r.IsActive = 1
                    WHERE a.TaskTypeId = ty.TaskTypeId AND a.CanView = 1)
```

It returns nothing for a System Admin and nothing at all when no type is restricted (the common case after go-live of the switch, and always while the switch is off, where the statement is not even issued). The result is a short list (restricted types are a handful; the screen will not make dozens). Every task predicate then becomes `!HiddenTypeIds.Contains(t.TaskTypeId)`, a sargable `NOT IN (constants)`, written as a closure over the list (like `_managed` for sensitive managers). Reasons for this shape: (a) no per-row join to the access table in the hot task queries; (b) the answer is read from the database each request, so removing a role takes effect on the next request on every node and not after the 60 s permission cache; (c) `IsRestricted` is what makes the statement trivial when nothing is restricted.

Edit and assign checks use the same access table with the Edit or Assign flag (section 9) and are single-record, so they read the table directly.

For a person other than the caller (`ForAsync(userId)`, used by notification producers and jobs) the same statement runs with that user id, without any cache.

### 4.3 The SQL twin

`dbo.fnTaskVisible (@UserId INT, @SeeAll BIT)` (baseline `00-baseline.sql:1992`, inline TVF returning `TaskId, MatterId`) cannot ignore the type rule: its raw-SQL callers (`TaskDueJob.cs:63`, `TaskStalledJob.cs:58,93` through the recipient insert, tools) would otherwise write notifications for tasks the recipient may not see. The new script replaces it with a three-argument inline function `(@UserId INT, @SeeAll BIT, @IsAdmin BIT)` that keeps the existing matter term and adds:

```
AND (ISNULL(@IsAdmin,0) = 1
     OR NOT EXISTS (SELECT 1 FROM dbo.TaskType ty WHERE ty.TaskTypeId = t.TaskTypeId AND ty.IsRestricted = 1)
     OR EXISTS (SELECT 1 FROM dbo.TaskTypeRoleAccess a
                JOIN dbo.UserRole ur ON ur.RoleId = a.RoleId AND ur.UserId = @UserId
                JOIN dbo.Role r ON r.RoleId = ur.RoleId AND r.IsActive = 1
                WHERE a.TaskTypeId = t.TaskTypeId AND a.CanView = 1))
```

Note the existing function has one boolean (`@SeeAll`) that short-circuits the whole function; the type rule needs its own `@IsAdmin` because `SeeAll` includes `Matter.ViewSensitive` holders. The function stays inline (no scalar UDF, no multi-statement TVF: both would block inlining and cost an order of magnitude at 24,000 tasks, the lesson of issue #810 recorded in the port's XML comments). `DENY SELECT ... TO lpt_report_reader` is re-issued for the new signature (the DENY line in the baseline names the function; the script re-applies it and `report-access.json` stays as is, because that file lists tables only). The function does not read the feature switch: the C# callers decide, as today.

A C# and SQL parity test (the existing pattern for the matter rule) compares the two over the persona fixtures.

### 4.4 Order inside a handler

Same as 6.8: load through the visible source, then validate. A hidden id in a request body is the same "not found" validation as a missing one (section 5).

## 5. 404 and refusal semantics

| Situation | Response |
|---|---|
| Read of a hidden task (`GET /tasks/{id}`, `/completion`, `/workflow`, comments, assets, activity, revisions) | `404` identical to a missing id (`IMatterVisibility.NotFound()`), including body and timing class (single indexed read first). |
| Write to a hidden task (any action) | the same `404`, before any other check (`TaskTransactions.LockTaskAsync`, `TaskTransactions.cs:50`, already does this for sensitive matters; the type term is added to `CanSeeTaskAsync`). |
| Write to a **visible** task the caller may not edit (View-only role) | `403` problem with a stable code `TASK_TYPE_READ_ONLY` and plain text "You can see this task but not change it." The task is visible, so no existence is leaked. The screen shows it read-only, no edit controls (#1401). |
| Hidden task id inside a body (bulk, batch, asset link, `assign-batch`) | per-item `NOT_FOUND` result / validation, same text as a missing id. |
| Create with a type the caller cannot edit, or a hidden type | `400 VALIDATION_FAILED`, field `taskTypeId`, code `NOT_FOUND`, same text as a missing type ("Select a task type."), so a hidden type cannot be probed (`TaskService.cs:268`). A visible type that the caller may see but not edit: `TASK_TYPE_READ_ONLY` on the field. |
| Assignee not allowed for the type | `400`, field `userId`, code `USER_CANNOT_ASSIGN_TYPE` ("{name} can't be assigned tasks of this type."), the pattern of `USER_CANNOT_EXECUTE` (`TaskService.cs:860`, `TaskBulkService.cs:70`). The assignee is a person the caller may already see, so no secret leaks. |
| Asking for a hidden type in a filter (`taskTypeId=` on the queue, search, dashboard, my matters) | behaves as today for an id that matches nothing (empty result), never an error that distinguishes hidden from missing. |

Timing: the sensitive design accepts the generic 404 without a timing study; the same here. Task numbers (`TSK-1042`) are sequential, so "number exists" is inferable only by adjacent visible numbers; this is the same residual as sensitive matters and is accepted (same as Q6 of that note).

## 6. Counts and totals

Every number that counts tasks comes from `VisibleTasks` (or the matching predicate on a joined row), never from `all - hidden`. That includes: list totals and paging, filter facets, tab badges, KPI tiles, dashboard breakdowns and trend, swimlane lanes, My Matters sections, matter and client and project strips, "open task count" on Task Types, users and pods, search counts, notification unread counts. A restricted type with no visible task for the caller shows `0`, and **a type the caller may not see is not listed at all**, so a zero cannot be told from "does not exist".

Three deliberate gaps are named so nobody "fixes" them by accident (owner decision):

1. **Capacity and workload numbers per person** (`CapacityService.cs:169,277`, `CalendarService.cs:446`, the ranker's true load) count all of a person's open assigned tasks as a bare integer. This is the existing exception of decision AS item 12 for sensitive matters (no names, ids or matter data; otherwise busy people look free). The type rule would extend it to tasks of hidden types. Recommendation: keep the exception, owner to confirm .
2. **Integrity guards** that must tell the truth, for example the matter deactivation check (`TaskDirectory.cs:85`, text built at `MatterService.cs:717`: "This matter has N tasks that aren't Completed or Cancelled", with `openTaskCount` in the problem). The block stays, but the number must not include tasks the caller cannot see: show the visible count and, when hidden ones exist, "and other tasks you can't see" without a number. #1400 owns it.
3. **The pre-save impact warning** on the Task Types screen (section 9.1) reports how many open tasks become hidden and for how many people. It is an aggregate about a change, shown only to `TaskType.Manage`; it does not list tasks.

## 7. Pickers, lookups and search

- **Task type pickers** (Create Task, Task Queue type filter, My Matters type filter, dashboard filters, search filters, the reports lookup): `GET /task-types` lists only types the caller may view; a person with `TaskType.Manage` sees all types on the admin screen (where the access summary shows) and only the viewable ones in pickers. The create picker lists only types the caller may **edit** (create needs Edit). The server decides; the client never filters (as in 6.8 "mode H").
- **Assignee pickers**: `GET /users/lookup?assignable=true&taskTypeId=` (the frontend already passes `taskTypeId`; `UsersLookupController.cs:65`) adds the `TypeAssignable` filter on top of "active, `Workflow.Execute`, not out of office". Without `taskTypeId` the old behaviour. The ranker input is filtered before ranking (`LoadBalancedAssigneeRanker`). The server accepts the same set on every assign path (section 9.2).
- **Search** (`SearchService.cs:333` task hits, `:400` the type name join): task hits and counts go through the same predicate; the hit's type name is selected only for visible tasks; suggestions too.
- **Notes**: note tags use only the colour palette of task types (`NoteTagService.cs:113`, `NoteSupport.cs:19`), not tasks. Nothing to do; recorded so the issue's "Notes tags" line is closed as verified N.

## 8. Notifications and audit

### 8.1 Notifications

- **Read** (`NotificationService.cs:42,133`, through `IObjectVisibility`, `TaskObjectVisibility.cs`): the task id set comes from `TaskAccess.Visible()`, so once the port changes, hidden notifications drop out of the list, the poll and the unread count at once. A notification stores a text snapshot (task title, type name, matter name); it is filtered by object id on read, never by its text.
- **Create** (`NotificationPublisher.cs:36`, `ScheduledNotificationWriter.cs:44`, `RecipientVisibility.cs:34`): recipients are filtered with `ForAsync(recipient)` + `VisibleTasks(viewer)`; the type term comes with the port. The two scheduler jobs (`TaskDueJob.cs:63`, `TaskStalledJob.cs:58,93`) read `dbo.Task` as the system for the candidate scan and then check each recipient; they also select the **type name** (`tt.Name`) into the notification text, which is harmless only because the recipient is checked first. #1400 adds a test with a restricted type, a recipient without the role, and the assignee (who must get nothing).
- No e-mail is sent by the application today (`MsgEmailParser` only parses; no SMTP or mail sender exists in `src`), so there is no e-mail path to protect. If one is added, it is a producer and goes through `RecipientVisibility`.
- A task assigned to a person who is later cut off (access config change) keeps its already-created notifications, hidden at read.

### 8.2 Audit

- **Views** (`AuditVisibility.cs:33` `Apply`, `FacetFilterAsync` at `:54` for the facet skip scan, `AuditDisplayLookup.cs:65`): an event with a `TaskId` is hidden when that task's current type is in the viewer's `HiddenTypeIds`. Written as `NOT (e.TaskId IS NOT NULL AND EXISTS (task with that id and TaskTypeId IN hidden))`; the hidden list is a few ids and `Task` is read by its primary key, so the page stays an index walk. The facet statement receives the hidden type ids as one more table variable. Events without a task id (users, roles, configuration) are unchanged; the Task Type **access change events** (below) have no `TaskId` and are visible to `Audit.View` holders, they name roles only, never people.
- A type is read at view time from the task's *current* type. Task types are immutable on a task (`TaskService.cs:418` refuses a change), so history cannot jump between types; it can only change visibility when the access lists change, and then all of that task's events change with it. No `AuditEvent` column is needed (the sensitive design needed `IsSensitiveScope` only because un-marking should keep old events restricted; the owner decision here is the opposite: access follows the current lists).
- `AuditDisplayLookup` (object labels for audit text): a hidden task is labelled with the existing restricted label, as for sensitive matters.
- **New events** (written in the same transaction as the change, through `IAuditWriter`, explicit semantic events like `TASK_TYPE_WORKFLOWS_CHANGED`, `TaskTypeService.cs:408`):
  - `TASK_TYPE_ACCESS_CHANGED` with object type `TaskType`, one event per save that changed any list. Old and new value hold the three lists as role names; readable text such as "Task Type 'Privilege Review': Can View changed from (everyone) to Director, Partner; Can Edit changed to Partner". Role ids are stored in the metadata so a later rename does not rewrite history.
  - `TASK_TYPE_RESTRICTED` and `TASK_TYPE_UNRESTRICTED` as an extra row when the flag flips (easy to find in the audit page and the runbook).
  - No event is needed for a role deleted out from under a list: a role in a list cannot be deleted (9.3).
  - The audit page labels these in the existing event catalogue (`audit-format.ts`).
- Refused actions (a View-only person trying to edit) are not audited; they are ordinary 403s.

## 9. Behaviour of changes

### 9.1 Saving a restriction

`PUT /api/v1/task-types/{id}` (policy `TaskType.Manage`, row version as today) accepts an `access` object `{ canView: roleId[], canEdit: roleId[], canAssign: roleId[] }` and replaces the set. The server also makes the implication true (it adds Edit and Assign roles to View itself, in case a client forgot; the dialog shows it). Validation: unknown, inactive or duplicate role id is `400` on the field (`ROLE_NOT_FOUND`); a role that is inactive today is refused. `GET /task-types[/{id}]` returns `access { isRestricted, canView[], canEdit[], canAssign[] }` to `TaskType.Manage` holders only, plus the new list column data for the Access column (Everyone / Restricted: n roles).

Before saving, the dialog asks `POST /api/v1/task-types/{id}/access/preview` with the proposed lists and receives `{ openTasksBecomingHidden, peopleLosingView, openTasksAssignedToPeopleLosingView, peopleLosingEdit }` (counts only; no names, no ids). The confirm text names the numbers ("12 open tasks will be hidden from 7 people"). It is computed over **all** tasks of the type, because the confirming administrator has to know the real effect (section 6, gap 3). The save endpoint recomputes nothing and does not require a preview; the preview is advisory.

Effect is immediate: the next request of every affected person reads the new lists (4.2). Open sessions are not terminated; their next list call simply excludes the tasks, and a task page open in a browser gets 404 on its next call (the screen already handles a vanished task, as for sensitive matters).

### 9.2 Edit and assign enforcement

- Every mutation of a task needs `TypeEditable` in addition to its permission: edit fields (`TaskService.cs:392`), priority (`:721`), status, complete, cancel, reopen (`TaskLifecycleService.cs:56`), comments (`TaskCommentService.cs:77,111,163`), workflow steps (`TaskWorkflowService.cs:47`), asset links (`TaskAssetService.cs:40,86,135`), matter bulk (`TaskBulkService.cs:30,116`), batch assign. The check lives where the task is locked and loaded (`TaskTransactions.LockTaskAsync`) plus one `TaskEditGate` in `TaskActionRules`, so the 15 or so endpoints cannot each forget it; the endpoint catalogue test (12.2) classifies each endpoint as "edit-gated".
- **Comments** are an edit (the epic says Edit covers comments): a View-only person can read comments, not add them.
- **Assigning** needs `Task.Assign` (who may perform it, unchanged) **and** the caller may see the task, **and** the proposed assignee satisfies `TypeAssignable` and today's checks (active, `Workflow.Execute`). The single check sits next to the existing one (`TaskService.ValidateAssigneesAsync`, `TaskService.cs:842`, plus `TaskBulkService.cs:70`) and is called by create, update, assignment, assign-batch and bulk reassign alike, so there is one rule (the same shape as `USER_CANNOT_EXECUTE`). Unassigning needs only Edit.
- Does the **caller** need Edit to assign? Yes: assigning changes the task. A person with `Task.Assign` and a View-only role cannot reassign (they get `TASK_TYPE_READ_ONLY`). This follows "Edit covers everything that changes the task".

### 9.3 A role is removed, deactivated or deleted

- **A user loses a role** (`UserRole` row deleted): effective on the next request (4.2 reads `UserRole` with no cache). A person with another qualifying role keeps access (union).
- **A role is deactivated**: it grants nothing (the `Role.IsActive` join). The type stays restricted even if that was the last View role; only System Admin then sees it (fail closed). The Task Types screen shows a warning on a type whose View roles are all inactive.
- **A role is deleted** (`RoleAdministration.DeleteAsync`, `RoleAdministration.cs:135`, today allowed once it has no members): deleting the last View role of a restricted type would delete its rows and silently turn the type **open to everyone** (fail open). The role delete must therefore be refused while the role is in any access list (`409 ROLE_USED_BY_TASK_TYPE`, same shape as `ROLE_IN_USE`, message "This role is used by N Task Types. Remove it there first." with the type names in the problem meta); the administrator removes it from the type first (a save that empties Can View is allowed, because it is the owner's rule that no roles means open to everyone, but the preview and the confirm text say "This task type will become visible to everyone"). This is a change in the Identity module's role delete (#1399).
- **A user has several roles**: union per list; there is no deny and no precedence.
- **The caller is the only person who can see a type and removes themselves**: allowed with the preview warning (as for marking sensitive, `SENSITIVE_CONFIRMATION_REQUIRED`); no server-side block, but the confirm text says "You will no longer see this task type" when the caller's own access ends. System Admin cannot lose access.

### 9.4 A visible task whose type "changes"

A task's type cannot change after creation (`TaskService.cs:418`, `ImmutableField`), nor can its matter (`:416`). So the only way the visibility of an existing task changes is that the type's lists, or the viewer's roles, change (9.1, 9.3). This design keeps the immutability; if a later feature adds "change type", it must require Edit on both the old and the new type, re-validate the assignee against the new type, and refuse a change that would hide the task from the person making it.

### 9.5 System actions and tasks assigned to people who lose access

- **System creation.** Today only one code path inserts a task (`TaskService.CreateAsync`, `TaskService.cs:343`); no e-mail intake or workflow step creates tasks (`IntakeController` only parses, the Outlook flow then creates through the same endpoint as the user). A system creator (future) calls the service with an explicit "system actor" flag that skips the *Edit-role* check for the type and the caller-visible check but **not** the assignee check: a system action may create a restricted task, assigned to a person who qualifies or to nobody. `Viewer.Nobody` stays "open types only" for reads, so a job never gains access.
- **Open tasks assigned to someone who loses View.** No exception (owner decision): the task disappears from that person's queue, My Work, notifications and counts. It stays assigned to them, is visible to System Admin and to roles that still qualify, and appears in their numbers only as the capacity integer (section 6, gap 1). The preview shows `openTasksAssignedToPeopleLosingView` so the administrator can reassign first. No automatic unassign and no automatic notification to the person (the person would learn that a hidden task exists). Recommendation: keep, and revisit only if the owner sees real stranded work after go-live (not in the open questions: not in production).

## 10. Caches

- **Server caches that hold viewer-dependent numbers** (`DashboardCache`, My Matters cache; keys built with `VisibilityStamp.cs`): the stamp from `AccessStampAsync` must change whenever the viewer's visible set changes. Today it is `off` / `all` / `none` / a hash of managed and assigned sensitive ids. The new stamp is the sensitive part **plus** a hash of the viewer's `HiddenTypeIds` (computed in the same preparation statement, so no extra round trip). `all` is returned only when both rules short-circuit (a System Admin; a `Matter.ViewSensitive` holder who is not System Admin gets a real stamp). With the type switch on and no restricted types, `HiddenTypeIds` is empty and the stamp equals today's, so cache hit rates are unchanged.
- **Permission snapshot** (`UserAccessCache`, 60 s across nodes): not used by the type rule, which reads roles per request (4.2). Role grants affecting `Task.View` stay as today.
- **Task type catalogue cache** (`ITaskTypeCatalog`, used by task creation and display name lookups): contains no access data and is shared across users; the *list* a user sees is filtered after the catalogue is read (the filter runs per request, so the cache can stay shared). It must not be keyed by user.
- **Frontend caches** (section 11).

## 11. Frontend leak checklist (the UI reflects the server)

The server decides; the client never reads roles to decide visibility. Places that cache or derive from task type data:

| Place | File | Risk and fix |
|---|---|---|
| Queue filter choices | `shared/work-queue/queue-choices.ts:66` (`listTaskTypes()`, kept in a signal) | Lists come from the filtered `GET /task-types`; the service must reload when the signed-in person changes (impersonation, `docs/ux/impersonation`) and not survive a logout. |
| Create Task type picker | `features/tasks/create/create-task-page.ts:585`, `shared/tasks/recent-choices.ts` (`mf.create-task.types.<userId>`, ids only) | The recent three ids are matched against the loaded usable list; an id no longer offered is dropped silently. Never render a recent id without a loaded match. |
| My Matters type filter | `features/my-matters/section-types.ts:35` | Same list. |
| Saved views and last view | `core/views/view-state.service.ts`, `shared/work-queue/last-view.ts` | A saved filter may carry a `taskTypeId` the person can no longer see: the request answers as an id that matches nothing, the chip must show "Unavailable" or be dropped, never the type name from an old cache. |
| Task Types admin | `features/admin/task-types/*`, `features/admin/workflows/workflow-impact.ts:38`, `workflow-task-types-tab.ts` | Admin screens read with `TaskType.Manage` and see all types; they must not pass through the shared picker cache. |
| Assignee pickers | `shared/assignees/assignee-list.ts`, `mf-assignee-picker`, `row-edit` | Already pass `taskTypeId`; add a test that a person outside Can Be Assigned never appears, and that the "Search all users" fallback does not bypass it. |
| Task header / chips / cells | `shared/ui/task-type-chip.ts`, `task-type-cell.ts`, `features/tasks/detail/task-header.ts` | Render only what the API returned for a visible task. Read-only mode on `TASK_TYPE_READ_ONLY` (no edit controls). |
| Search, assets linked tasks | `features/search/*`, `features/assets/pages/asset-linked-tasks.ts` | Counts and hits from the server only. |
| Breadcrumbs, recent items, route titles, document titles | layout | A 404 task page must not leave its title in the tab or in recents (the sensitive e2e `sensitive-leak-scan.spec.ts` pattern). |
| Exports built in the browser (`POST /exports/log`) | `TaskQueueController.cs:65` | Only rows already on screen; no change. |

No new or changed keyboard shortcuts (CLAUDE.md; owner decision of 2026-11-10). Desktop only. The new Access section and column follow `docs/ux/design-guidelines.md` and the shared copy tables (#1402).

## 12. Test plan

### 12.1 Fixtures

Extend the sensitive fixtures with: two task types, `Open` (no roles) and `Privileged` (View: role V; Edit: role E; Assign: role A, where V includes E and A); six personas with roles (none of V/E/A, V only, E, A, V+E+A in different roles to prove union, System Admin) plus one persona who is the *current assignee* of a `Privileged` task but has none of the roles (proves "no assignee exception") and one project manager of the matter with none of the roles (proves "no PM special access"); sentinel text in the title, comment, custom field and type name of the `Privileged` type so sweeps find leaks.

### 12.2 Systematic security suite (the same three guards as sensitive)

1. **Endpoint catalogue** (`SensitiveAccessCatalog`, `SensitiveEndpointCatalogTests`): extend the catalogue with a task-type classification per endpoint (mode T-typed, edit-gated, assign-gated, N/not task data). An unclassified or newly added endpoint fails the build.
2. **Persona walk** (`PersonaWalk`, `SensitivePersonaWalkTests`): send every catalogued GET as each persona and sweep the bodies, CSV and text exports for the sentinels; counts compared against the visible set computed independently (the parity test of 6.8).
3. **Mutation tests** (`SensitiveMutationTests` pattern): removing a role, deactivating a role, changing the lists, assigning and unassigning take effect on the next request; View-only edit is `403 TASK_TYPE_READ_ONLY`; a hidden task id in any body is the missing-id answer; assignment of a person outside Can Be Assigned is `USER_CANNOT_ASSIGN_TYPE` on single, batch and bulk paths.
4. **Architecture tests** (`VisibilitySourceRulesTests`): ban unreviewed `Set<WorkTask>()` outside the port-aware sources and unreviewed raw SQL on `dbo.Task` outside the allow-list (jobs, reports, tools). The list of current offenders is the section 15 rows whose Today column says `none`; each is either converted or added to the reviewed allow-list with a reason.

### 12.3 Identity-with-no-restriction proof (regression)

- With the switch on and **no restricted type**, every response of every catalogued endpoint is byte-identical to the response with the switch off, for all personas (a snapshot over the walk), and the statement count per endpoint is unchanged (a statement-count test, like the 5-vs-50-user lookup test).
- With the switch off and a restricted type present in the data, responses are identical to today (the switch really switches).
- `fnTaskVisible` parity: the SQL function and the C# predicate return the same task ids for the persona set.

### 12.4 Frontend and e2e

Unit specs for the Access section of the dialog (implication adds the role; sentence text), the Access column and filter, read-only task page, assignee picker. Playwright (`sensitive-*.spec.ts` pattern; `run-local.sh` sets the switch for the specs that need it): restricted type hidden from queue, search and matter Tasks tab; View-only is read-only; assignee picker offers only eligible people; the Task Types dialog and its confirmation; axe on the dialog and list.

### 12.5 Performance

Plans for Task Queue, Dashboard, My Matters and the Audit page with 24,000 tasks and 0, 1 and 10 restricted types: no new scan, the `NOT IN` list uses the existing indexes; the viewer statement is one seek; statement counts constant (no N+1 per type). Gate: no regression above 10 percent on the existing perf suite at zero restricted types, and an agreed budget at ten.

## 13. Threat model

| # | Threat | Control |
|---|---|---|
| 1 | Hidden task shows in a list, count or export | Single port, signature forces the type column, catalogue and walk tests |
| 2 | Hidden task inferred from a total or a strip (matter, client, project, user, pod) | Counts from the visible set; gaps are named (section 6) |
| 3 | Probing by id or number | Generic 404; same validation text for ids in bodies |
| 4 | Probing the type list | Types the caller cannot view are not listed; creation answers "not found" |
| 5 | Assignee keeps seeing a task after losing access | No assignee exception in the type term (AND-ed outside) |
| 6 | Asset reached through a hidden task | `TaskAssetLinkReader.PrepareAsync` and `AssetIdsOfTasksAssignedTo` (section 15, rows A1 to A3) must apply the type term, or an assignee of a hidden task keeps asset access |
| 7 | Report SQL reads `dbo.Task` directly | Section 14 |
| 8 | A role delete fails open | Role delete blocked while used (9.3) |
| 9 | Cache serves another person's numbers | Stamp includes the hidden-type set (section 10) |
| 10 | A job runs as "see all" | `ForAsync` per recipient; `Viewer.Nobody` sees open types only |
| 11 | Bulk or batch bypass | Per-item check in the shared validator and loader |

## 14. Reports (decide, do not hide it)

Reports run as a separate SQL login (`lpt_report_reader`) with `SELECT` on `dbo.Task` and the other business tables, outside the port; `fnTaskVisible` is denied to it. The sensitive-matter rule was never applied to them (reports review section 7.5, "option A": `Report.Run` plus role assignment is the gate; decision AI item 6; `ReportLookupStore.cs:19` excludes sensitive matters from lookups only). The epic says reports respect the Task Type rule. That cannot be done by the port, because administrators write free SQL.

What reads tasks today (all of these would show hidden tasks): 10 starter reports reading `dbo.Task` or `dbo.TaskAsset` (`aging-of-open-tasks`, `tasks-per-matter`, `tasks-created-per-week`, `open-tasks-by-assignee`, `users-with-no-pod-or-inactive-assignees`, `assets-linked-to-open-tasks`, `tasks-completed-per-person`, `tasks-completed-this-month`, `overdue-tasks-by-pod`, `open-and-overdue-tasks-by-matter`, all in `Modules/LptHub.Reports/Starters/`), every report an administrator writes, parameter choices (`ReportChoiceService`, `ReportLookupStore`: a task type lookup lists all types today), run results, the in-memory result store, CSV export (`ReportExportService`), report views (`ReportViewService`), run log (parameters may carry a type id) and `POST /asset-reports/run` (the WorkViews asset report engine; that one is on the app login and already uses `access.Visible()` through the link reader).

| Option | What it is | Cost |
|---|---|---|
| A. Trusted report roles | Reports keep reading everything; `Report.Run` plus report-to-role assignment is the gate (as for sensitive matters). The restricted type's data is visible to anyone who may run a report that selects tasks. | Zero build. Contradicts "reports respect the rule" for any person who can run a task report and is not in the type's View roles. |
| B. Row-level filter on the report login | Give the report login only views or a security policy over `dbo.Task`: run each report on a connection that carries the *running person's* id in `SESSION_CONTEXT` (set read-only by the app before the query), and let a SQL Server row-level security policy or a filtered view on `dbo.Task` apply `fnTaskVisible`-style logic (type rule; matter rule optional). | Real design and spike work (does RLS apply to the report login as configured, does pooling reset session context, does the validator allow only the allow-listed names, plan quality), touches the reports module and `report-access.json`. Also fixes sensitive matters in reports (R58 to R60 open since #808). |
| C. Report-level type tag | A report is marked "may read restricted types"; unmarked reports get a rewritten `dbo.Task` reference to a filtered view (the SQL validator already parses and allow-lists names). | Medium; every new report author must understand the view; joins to `TaskAsset` need the same treatment. |

**Owner decision: reports stay as they are for now.** Report roles have their own permissions (`Report.Run`, report-to-role assignment); no report row filter is built in this epic and no new issue is opened. This is an accepted limitation at go-live (the runbook states it plainly): a person who may run a task report can see restricted tasks through it. The access table stays **denied** to the report login. Options B and C remain a possible later step, together with the sensitive-matter rows R58 to R60.

## 15. Read-path inventory

Legend. **Today**: how the path is filtered now. `T` = the sensitive-matter task rule through the port (`VisibleTasks.Of`, `TaskAccess.Visible()`, `WhereTask*`); `M` = matter rule only; `own` = assignee shortcut; `none` = no visibility filter; `sys` = system job. **Change** is what the type rule needs; where the answer is "automatic" the path already goes through a port method that gains the type term (section 4.1). Test codes: **W** persona walk, **C** count parity, **X** special test, **N** verify-only (no task data).

Counts per area are at the end of the section.

### 15.1 The port and its chokepoints (change here, many paths follow)

| ID | Where | What it is | Change |
|---|---|---|---|
| P1 | `SharedKernel/Visibility/IMatterVisibility.cs` (all `WhereTask*`, `VisibleTasks`, `CanSeeTaskAsync`, `AccessStampAsync`), `VisibilityPredicates.cs` | The rule's surface | Add the type term and the new parameter (4.1) |
| P2 | `Identity/Access/MatterVisibility.cs:45` `PrepareAsync`, `:87` `AccessStampAsync`, `:118` `ForAsync`, `:122` `Current` | Viewer facts and stamp | Roles lookup, `HiddenTypeIds`, `IsSystemAdmin`, stamp (4.2, 10) |
| P3 | `SharedKernel/Visibility/AccessRows.cs`, `WorkManagement/Application/TaskAccessSource.cs:14` | Task row shape | Add `TaskTypeId` |
| P4 | `WorkManagement/Application/TaskAccess.cs:15` `Visible()`, `:34` linked-asset join | Task module's visible source | Automatic via P1 |
| P5 | `WorkViews/Application/Queries/VisibleTasks.cs:15` `Of`, `:22` `OpenUnassigned` | Starting set of every WorkViews reader (about 25 call sites, section 15.4) | Automatic via P1 |
| P6 | `baseline 00-baseline.sql:1992` `dbo.fnTaskVisible` | SQL twin | New three-argument function (4.3) |
| P7 | `WorkManagement/Application/TaskTransactions.cs:50` `LockTaskAsync` | Hidden = missing before every write | Automatic via `CanSeeTaskAsync`; add the edit gate (9.2) |
| P8 | `Search/Application/Queries/SearchService.cs:333` | Task hits | Automatic via `WhereTaskFlagVisible` once the type column is passed |
| P9 | `WorkViews/Application/Queries/OrganizationTaskCounts.cs:63,108` | Strip counts, `WhereTaskVisible` / `WhereTaskRowVisible` | Automatic, plus the `Matter` and `Project` scopes below (row O2) |

### 15.2 Task module (`WorkManagement`)

| ID | Endpoint / code | Exposes | Today | Change | Test |
|---|---|---|---|---|---|
| K1 | `GET /tasks` (`TaskControllers.cs:43`, `TaskService.cs:109` `ListAsync`, `TaskPresenter.cs:146`) | Task list, totals, type filter | T | Automatic via P4 | W,C |
| K2 | `GET /tasks/{id}` (`TaskControllers.cs:56`, `TaskPresenter.cs:52`) | Full task | T (`afterWrite` reads unfiltered at `:54` after a write) | Automatic; the `afterWrite` path is only reached after a gated write, keep | W |
| K3 | `GET /tasks/{id}/completion` (`TaskControllers.cs:141`, `TaskLifecycleService.cs:36`) | Completion check | T | Automatic | W |
| K4 | `GET /tasks/{id}/workflow` (`TaskService.cs:103`, `TaskPresenter.cs:203`) | Workflow state | T | Automatic | W |
| K5 | `GET /tasks/{id}/comments`, `/comments/{id}/revisions` (`TaskPanelControllers.cs:33,70`, `TaskCommentService.cs:42,62`) | Comment text and history | T on parent | Automatic | W |
| K6 | `GET /tasks/{id}/assets` (`TaskPanelControllers.cs:86`, `TaskAssetService.cs:27`) | Linked assets | T on task | Automatic | W |
| K7 | `GET /tasks/{id}/activity` (`TaskPanelControllers.cs:132`, `TaskActivityService.cs:31`) | Audit feed of the task | T on task; also reads `TaskComment` (`:100`) | Automatic; assignee-only branch (events of own tasks) must not rescue a hidden type | W,X |
| K8 | `ITaskDirectory` (`TaskDirectory.cs:14,20,29,38,43,53,86,94`) | Task summary by id / number / matter, counts per status, "any task uses priority" | **none** (internal; only `AuditDisplayLookup.cs:22` uses it, after checking `VisibleTasks`) | Keep unfiltered but reviewed: `FindManyAsync`, `FindAsync`, `FindByNumberAsync`, `ListForMatterAsync`, `CountByStatusAsync` must either gain a viewer argument or stay allow-listed with the caller doing the check; no new caller without review (architecture test) | X |
| K9 | `IMatterTaskGuard` (`TaskDirectory.cs:85`), message at `MatterService.cs:717` | True open task count on matter deactivation | none (integrity) | Keep the block, count only visible tasks in the message (6) | X |
| K10 | `TaskObjectVisibility.cs` (notification read filter) | Visible task ids | T | Automatic | W,X |
| K11 | `TaskAssetLinkReader.cs:28` `Grouped`, `:65` `AssetIdsOfTasksAssignedTo`, `:49` `PrepareAsync`, `:84` `ListForAssetAsync` (`IAssetTaskLinkReader`, used by Assets, Search and My Matters assets) | Linked and open task counts per asset; linked task list; the assets an assignee reaches through their tasks | `Grouped` and `ListForAssetAsync` use `access.Visible()` (T); `PrepareAsync` and `AssetIdsOfTasksAssignedTo` read `WorkTask` **directly** (assignee rule) | **Leak risk**: the assignee-asset rule must add the type term, else a person assigned a hidden task keeps access to its assets (`:49,:65`) | W,X |
| K12 | `TaskAccess.cs:34` linked-task join, `TaskAssetLinkReader.cs:155` | Task data for asset linked-task rows | T | Automatic | W |

### 15.3 Task Queue, My Work, Pod Work, Swimlane, exports (`WorkViews`)

| ID | Endpoint / code | Exposes | Today | Change | Test |
|---|---|---|---|---|---|
| Q1 | `GET /task-queue` (`TaskQueueController.cs:22`, `TaskQueueService.cs:47` `Tasks()`) | List, counts, filters, quick-view badges | T via `VisibleTasks.Of` | Automatic | W,C |
| Q2 | `GET /task-queue/export?format=csv|text` (`TaskQueueController.cs:36`, `TaskQueueExportService.cs:16`) | Every page as file | T (same service) | Automatic; sentinel sweep over CSV and text | W,X |
| Q3 | `POST /exports/log` (`TaskQueueController.cs:65`) | Export log | N | none | N |
| Q4 | `GET /my-work` (`TaskQueueController.cs:86`, `MyWorkController`) and `AttentionAsync` (`TaskQueueService.cs:256`) | Own list; needs-attention strip counts | list T; **strip reads `WorkTask` by assignee with no visibility** | **Leak risk**: the "own tasks" shortcut was safe under the sensitive rule (assignee exception) and is not safe under the type rule. Route through `Tasks()` | W,C,X |
| Q5 | `GET /pod-work` (`TaskQueueController.cs:107`, `PodWorkController`) | Pod member load and tasks | T | Automatic | W,C |
| Q6 | `TaskQueueService.cs:711` detail load by ids (`LoadDetails`), `:778` comment join | Rows for a page of ids | by id after a visible page | Safe only if ids come from `Tasks()`; add an assertion test | X |
| Q7 | `GET /dashboard/swimlane` (`DashboardController.cs:76`, `SwimlaneService.cs:89,250`) | Cards, lane counts | T via `queue.Tasks()`; card details by ids | Automatic (same caveat as Q6) | W,C |

### 15.4 Dashboard, capacity, workload, calendar

| ID | Endpoint / code | Exposes | Today | Change | Test |
|---|---|---|---|---|---|
| D1 | `GET /dashboard` (`DashboardController.cs:23`, `DashboardService.cs:69,184`) | KPIs, breakdowns, unassigned count and gauge | T | Automatic | W,C |
| D2 | `DashboardService.cs:193` ("mine" for Technician Summary) | Own open and overdue counts | **none** (own tasks) | **Leak risk**: filter through `VisibleTasks.Of` | W,C |
| D3 | `GET /dashboard/scopes` (`DashboardController.cs:37`) | Counts per scope | T | Automatic | W,C |
| D4 | `GET /dashboard/trend` (`DashboardTrendService.cs:60`) | Trend series | T, cached by stamp | Automatic; stamp change (10) | W,C |
| D5 | `GET /dashboard/workload` (`WorkloadService.cs:40`) | Per-person load | T | Automatic | W,C |
| D6 | `GET /dashboard/capacity`, `/capacity/people` (`CapacityService.cs:169,277`; unassigned at `:178`) | Battery, per-person load integer | load: **none** by design (AS item 12); unassigned: T | unassigned automatic | W,C,X |
| D7 | `GET /dashboard/users/{id}/history` (`UserHistory.cs:153`) | Completed tasks of a person | T | Automatic | W |
| D8 | `GET /dashboard/users/skills` (`SkillsMatrix.cs:101`) | Skills by type | T | Automatic; type names listed only for viewable types | W,C |
| D9 | `GET /dashboard/coverage` (`CoverageService.cs:44`) | Coverage by type | T | Automatic; same | W,C |
| D10 | `GET /dashboard/calendar/days|day|summary` (`DashboardCalendarController.cs:22,33,44`, `CalendarService.cs:446`) | Per-person load integer | **none** by design (AT item 21) | Owner decision (capacity keeps the integer) | W,X |
| D11 | `DashboardCache.cs`, `VisibilityStamp.cs` | Cache keys | stamp | Stamp change (10) | X |
| D12 | `GET /matters/{id}/overview` (`MatterOverviewController.cs:22`, `MatterOverviewService.cs:81`) | Matter task summary | T | Automatic | W,C |

### 15.5 My Matters (all through one scope)

| ID | Endpoint / code | Exposes | Today | Change | Test |
|---|---|---|---|---|---|
| M1 | `MyMattersScope.Tasks()` / `OpenTasks()` (`MyMattersScope.cs:68,80`) | The one task set for every My Matters section | **matter rule only**: the matters are visible, then *all* their tasks | **Leak risk and the single fix point**: add the type term here (a project manager gets no special access). Covers `summary`, `health`, `attention`, `deadlines`, `workload`, `task-counts`, `breakdown`, `tree`, `calendar`, `since-last-visit`, `feed` (11 endpoints in `MyMattersController.*.cs`) | W,C,X |
| M2 | `MyMattersAttentionService.cs:453`, `MyMattersTaskFacts.cs:36`, `MyMattersFeedService.cs:159`, `MyMattersActivityService.cs:184` | Detail rows and titles by id | by id after M1 sets, or from audit events | Safe once M1 and the audit filter (F1) apply; add the by-ids assertion test | X |
| M3 | `GET /my-matters/activity`, `POST activity/seen`, `/events`, `/events/upcoming` (`MyMattersActivityService`, `MyMattersEventsService`) | Audit-derived events with task titles | M on `MatterId`, T on `TaskId` | Via F1 | W,X |
| M4 | `GET /my-matters/data`, `/data/volume`, `/assets`, `/assets/{id}` (`MyMattersAssetsService.cs:161,181,242`) | Asset linked and open-linked counts; linked task rows and task comments | `:161` T; **`:242` joins `WorkTask` directly** for `OpenLinked`; `:181` comments after `:161` | **Leak risk**: `OpenLinked` count at `:242` ignores visibility; use the visible set | W,C |
| M5 | `POST /asset-reports/run`, `GET /asset-reports/{id}/run` (`AssetReportRunController.cs:21,27`) | Asset report counts incl. linked tasks | via link reader (T) | Automatic via K11 | W |

### 15.6 Organization counts (client, project, matter, users, config)

| ID | Endpoint / code | Exposes | Today | Change | Test |
|---|---|---|---|---|---|
| O1 | `GET /clients`, `/clients/{id}`, `/summary` (`ClientService.cs:102,120,144,148,175`) via `OrganizationTaskCounts` | Task counts, "most open tasks" | Client scope: T (`OrganizationTaskCounts.cs:63`) | Automatic | W,C |
| O2 | `GET /projects`, `/projects/{id}`, `/summary` (`ProjectService.cs:81,102,122,138`), `GET /matters`, `/matters/{id}`, `/summary` (`MatterService.cs:198,223,228,254,263`) | Task counts and strips for **matter and project scope** | `OrganizationTaskCounts.cs:58-66` uses `tasks.Where(t => t.MatterId == key)` / `ProjectId == key` with **no task visibility** (the matter is visible, so all its tasks were) | **Leak risk**: matter and project strips and matter list counts (`:41` hold/at-risk, `:85`, `:100` grouped) must apply the type term | W,C |
| O3 | `OrganizationTaskCounts.cs:41` `MatterStatesAsync` (on hold, at risk per matter) | Matter list state badges | none | Same as O2 | W,C |
| O4 | `GET /task-types[/{id}]` `openTaskCount` (`ConfigurationTaskCounts.cs:23` `OpenByTaskTypeAsync`) | Count per type | T | Automatic; types the caller cannot view are not listed (7) | W,C |
| O5 | Priorities, status labels, workflows "tasks using" counts (`ConfigurationTaskCounts.cs:38,54,64,82,103,147`) | Counts per priority, status, workflow | T | Automatic | W,C |
| O6 | `GET /users`, `/users/counts`, `/users/{id}` open task counts (`UserAdministration.cs:258,321`, `UserTaskCounts` at `ConfigurationTaskCounts.cs:73`) | Open tasks per person | T | Automatic | W,C |
| O7 | `MeController.cs:55-67` `HasWorkAsync` (landing page decision, `IUserWorkSource` via `TaskDirectory`) | Whether the person has any open assigned work | **none** (existence only) | Add the type term (an assigned hidden task must not steer the landing page) | X |

### 15.7 Search, assets, lookups

| ID | Endpoint / code | Exposes | Today | Change | Test |
|---|---|---|---|---|---|
| S1 | `GET /search` (`SearchController.cs:30`, `SearchService.cs:333` task ranked, `:400` type name) and suggestions | Task hits, counts, types | T | Automatic; hit type name only for visible tasks | W,C |
| S2 | `GET /search/advanced` (`SearchController.cs:43`) | Same with filters, paging, counts | T | Automatic | W,C |
| S3 | `SearchService.cs:159` `AssignedAssets` | Assets reached via the assignee rule | uses K11 | K11 change | W |
| S4 | `GET /assets`, `/assets/{id}`, `/assets/{id}/linked-tasks`, `/assets/lookup` (`AssetControllers.cs:133`, `AssetService.cs:72`, `AssetAccess.cs:28`) | Linked task counts and rows; asset access via assigned tasks | via K11 | K11 change | W,C |
| S5 | `GET /users/lookup` (`UsersLookupController.cs:44,65`, `LoadBalancedAssigneeRanker`, `IAssigneeLoadReader` / `IAssigneeExperienceReader` at `ConfigurationTaskCounts.cs:92,137`) | Candidates, open counts, completed-by-type counts | counts T; ranking true load (Q5 of sensitive) | Filter candidates with `TypeAssignable` when `taskTypeId` is given; experience counts only for viewable types | W,C,X |

### 15.8 Notifications, audit, reports, intake, other modules

| ID | Endpoint / code | Exposes | Today | Change | Test |
|---|---|---|---|---|---|
| N1 | `GET /me/notifications`, `/poll`, unread count (`NotificationControllers.cs:31,45`, `NotificationService.cs:42`) | Notification list and count | T through `IObjectVisibility` | Automatic (K10) | W,X |
| N2 | `POST /me/notifications/{id}/read`, `/read-all` (`NotificationControllers.cs:62,72`, `NotificationService.cs:133`) | Changed-row count | T | Automatic | W,X |
| N3 | Producers: `NotificationPublisher.cs:36`, `TaskNotifier.cs` (WorkManagement) | Recipient creation | `RecipientVisibility` (T for the recipient) | Automatic | X |
| N4 | `TaskDueJob.cs:63`, `TaskStalledJob.cs:58,93` (raw SQL on `dbo.Task` + `TaskType`), `ScheduledNotificationWriter.cs:44` | Candidate scan; notification text includes the type name | sys; recipients checked with `RecipientVisibility` | Automatic for recipients; test that a recipient without the role gets nothing, including the assignee | X,S |
| F1 | `GET /audit/events` (`AuditEventsController.cs:28`), `/audit/search` (`AuditSearchController.cs:33`), `/audit/facets` (`:54`), `AuditVisibility.cs:33,54` | Events with task ids, facet values and counts | M on `MatterId`, assignee branch on `TaskId` | New type term (8.2); facets recomputed | W,C |
| F2 | `IAuditReader`, task activity, My Matters activity | Internal audit reads | same predicate | Automatic with F1 | X |
| F3 | `AuditDisplayLookup.cs:65` (labels) | Task labels in audit text | `VisibleTasks` (T) | Automatic | X |
| R1 | Starter reports (10 files in `Reports/Starters/`) reading `dbo.Task` / `dbo.TaskAsset` | Task rows and aggregates | **none** (report login) | Section 14 | open |
| R2 | `POST /reports/{id}/runs`, `GET runs/{id}/rows`, CSV (`ReportsController.cs`, `ReportExportService`), report views (`ReportViewService`), run log (`ReportRunLogReader`) | Results of any SQL | none | Section 14 | open |
| R3 | `POST /reports/{id}/choices/{parameter}` and `/lookups` (`ReportChoiceService.cs:82`, `ReportLookupStore.cs`, `LookupKind` includes task types) | Parameter choice lists | none (type lookup lists all types) | Filter the task type lookup by view access at minimum, whatever option of section 14 is chosen | W |
| R4 | Admin report authoring: preview, analyze, schema browser (`ReportAuthoringService`, `ReportSchemaService`) | Sample rows of any table | none | Section 14 (`Report.Manage` is a trusted role in any option) | open |
| I1 | `POST /intake/parse-email*` (`IntakeController.cs:36,51,62`) | Parsed e-mail values | N (no task or type data, no suggestion of a type) | none | N |
| W1 | Workflow engine API (`WorkflowControllers.cs`; `WorkflowAdminService.cs:85,101-117,811`) | Workflow to task-type links: `WorkflowTaskTypeRef` carries type id, name, active, default | admin (`Workflow.Manage|TaskType.Manage`) | Admin sees all types; non-admin has no path | N,C |
| W2 | `WorkflowInstanceService` (task workflow state) | Step state of a task | via `TaskService` (T) | Automatic | W |
| X1 | `NoteControllers` (notes, tags, templates) | Notes of matters, tag colours | M; tags use the type colour palette only | none | N |
| X2 | `ProductionAccess`, `VendorAccess`, `MatterEventService`, `MatterTeamService` | Matter-level data | M | none (no task data) | N |
| X3 | Forms: `FormsController.cs`, `FormDefinitionResolver.cs`, `FormIndexService.cs` (TaskType-scoped form definitions and index) | Request form of a type | config perms | Reading a type's form for a task the caller can see needs no change; an admin reads all. Form **values** belong to the task (K1 to K4) | N |
| U1 | `GET/PUT/POST/DELETE /me/views` (`UserViewsController.cs`) | Saved filters (may carry type ids) | N | The server returns the stored ids; see the frontend row | N |
| U2 | `GET /me`, `/me/availability` etc. | N | N | none | N |

### 15.9 Frontend, tools and docs

| ID | Where | Change |
|---|---|---|
| FE1 | The 9 places in section 11 (`queue-choices.ts:66`, `create-task-page.ts:585`, `recent-choices.ts`, `section-types.ts:35`, saved views and last view, admin screens, assignee pickers, task header chips, breadcrumbs and titles) | Per section 11; Access section and column on Task Types (#1402) |
| T1 | `tools/seed-demo/seed-demo.mjs` (+ `lib/aged.mjs`) and `tools/perf/seed-perf-data.sql` insert tasks directly | Add one restricted demo type with roles and personas; the perf seed gets a restricted type for the 12.5 plans |
| T2 | `docs`: architecture addendum next to 6.8, runbook go-live section next to section 12, wiki (Feature-Map, Permission and role pages, Table-Reference, ER-Diagrams, Schema-Script-History, how-to) | #1403 and #1399 |

### 15.10 Write paths

Rule for all rows: load through the visible source (hidden = 404), then the permission, then the type rule (`TypeEditable`, `TypeAssignable`), then the existing validation.

| ID | Action | Where | Rule added | Test |
|---|---|---|---|---|
| E1 | Create task | `POST /tasks` (`TaskControllers.cs:67`, `TaskService.cs:216`; type checks `:268-271`; insert `:343`) | Caller needs Edit on the type; hidden type = "not found"; assignee passes `TypeAssignable` | W,X |
| E2 | Edit fields (title, description, due date, form values, pod, project) | `PUT /tasks/{id}` (`TaskService.cs:392`) | `TypeEditable` | W,X |
| E3 | Assign / reassign / unassign | `POST /tasks/{id}/assignment` (`TaskService.cs:635`) | Edit + `Task.Assign` + `TypeAssignable(assignee)`; validator `:842` | W,X |
| E4 | Batch assign | `POST /tasks/assign-batch` (`TaskService.cs:645`) | per item: hidden = `NOT_FOUND`; read-only = `TASK_TYPE_READ_ONLY`; assignee check | W,X |
| E5 | Priority | `POST /tasks/{id}/priority` (`TaskService.cs:721`) | `TypeEditable` | W,X |
| E6 | Status, complete, cancel, reopen | `POST /tasks/{id}/status|complete|cancel|reopen` (`TaskLifecycleService.cs:56`; reopen path writes a reason comment at `:157`) | `TypeEditable` | W,X |
| E7 | Comments add, edit, delete | `TaskCommentService.cs:77,111,163` | `TypeEditable` (Edit covers comments) | W,X |
| E8 | Workflow steps start, values, complete, skip, reopen | `POST /tasks/{id}/workflow/steps/*` (`TaskControllers.cs:186-217`, `TaskWorkflowService.cs:47`) | `TypeEditable` | W,X |
| E9 | Asset links add, change role, remove | `TaskAssetService.cs:40,86,135` | `TypeEditable` on the task; asset id checked with the asset rule | W,X |
| E10 | Bulk reassign / re-prioritise | `POST /matters/{id}/tasks/bulk` (`MatterBulkTasksController.cs:22`, `TaskBulkService.cs:30`, assignee check `:70`) | per item as E3 and E5; hidden = per-item `NOT_FOUND` | W,X |
| E11 | Bulk set project | `POST /matters/{id}/tasks/project` (`MatterBulkTasksController.cs:33`, `TaskBulkService.cs:116`) | per item `TypeEditable` | W,X |
| E12 | Move to another matter, change type | **none exist** (`TaskService.cs:416,418` refuse) | none; keep it so (9.4) | X |
| E13 | System creation (intake, workflows) | none today (`TaskService.cs:343` is the only insert) | Explicit system-actor flag (9.5) when the first one is built | X |
| E14 | Task type save | `PUT /task-types/{id}` (`TaskTypesController.cs:54`, `TaskTypeService.cs:340`) | `TaskType.Manage`; access lists, audit events, preview | W,X |
| E15 | Role delete / role remove from user | `RoleAdministration.cs:135`; user role editing in `UserAdministration` | Block delete while in a list (9.3) | X |

### 15.11 Totals

Counted from the tables above (rows, not endpoint operations; the catalogue test counts operations):

| Area | Rows |
|---|---|
| Port and chokepoints (P) | 9 |
| Task module reads (K) | 12 |
| Task Queue / My Work / Pod Work / Swimlane (Q) | 7 |
| Dashboard, capacity, calendar (D) | 12 |
| My Matters (M) | 5 |
| Organization, configuration and user counts (O) | 7 |
| Search, assets, lookups (S) | 5 |
| Notifications, audit, reports, intake, workflow, other (N, F, R, I, W, X, U) | 19 |
| Frontend, tools, docs (FE, T) | 3 |
| Write paths (E) | 15 |
| **Total** | **94** |

Paths that read tasks **without** any visibility filter today and become leaks under this rule (the ones to hunt first): Q4 (My Work attention strip), D2 (dashboard "mine"), D6 and D10 (capacity and calendar load, by design, Q4), M1 (the My Matters scope, 11 endpoints), M4 (asset open-linked count), O2 and O3 (matter and project strips and matter list counts), O7 (landing-page work probe), K8 and K9 (directory and deactivation guard), K11 (assignee-asset rule), R1 to R4 (reports), the scheduler jobs' type name text (N4, safe only because recipients are checked).

## 16. Split of issues #1399 to #1403 (confirmed, with adjustments)

| Issue | Scope in the issue | Verdict |
|---|---|---|
| #1399 data model, admin API, audit and switch | Script, `IsRestricted`, access table, admin read/write, audit, switch | **Confirmed**, with additions: the `PUT` takes the three lists, the **preview endpoint** (9.1), `GET /roles` read widening for `TaskType.Manage` (2), the **role delete block** with the message "This role is used by N Task Types. Remove it there first." (9.3, owner decision), the `fnTaskVisible` replacement (4.3, could sit in #1400), `report-access.json` entry (DENY by default), wiki table pages. The switch class and the `Viewer` shape change can start here so #1400 builds on them. |
| #1400 hide restricted tasks on every read path | Port, sources, all read paths | **Confirmed, and it is the big one** (most of the read rows of section 15). Adjust the list: add My Matters through the single scope (M1), the matter and project strips (O2, O3), the "own tasks" shortcuts (Q4, D2, O7), the asset assignee rule (K11, M4), audit facets, the stamp, the by-ids assertion tests, the deactivation guard text (K9). Reports are **not** in #1400 . Suggest cutting into two pull requests: port, SQL twin, Task module, Task Queue and Dashboard first; then My Matters, Organization, Search, Assets, Audit, Notifications. |
| #1401 Edit and Assign rules, pickers, creation | Edit gate, assignee check, pickers, create | **Confirmed**; add: the 403 `TASK_TYPE_READ_ONLY` and a read-only task screen (the issue says it), the `GET /task-types` filtering and the Edit-only create list (7), `GET /users/lookup` type filter and ranker input, the system-actor flag design (9.5, build only the hook, no caller exists). Depends on #1400 (shares the port). |
| #1402 Task Types screen | Access section and column | **Confirmed**; add: the preview confirmation text including "will become visible to everyone" when Can View empties and "You will no longer see this task type" for the caller's own lost access, the inactive-roles warning (9.3), the role-delete refusal message on the Roles screen (small, belongs here or #1399). Depends on #1399 only; can run in parallel with #1400. |
| #1403 test guards, regression proof and go-live | Catalogue, walk, mutation, regression, e2e, docs | **Confirmed**; add: the by-ids assertion tests, `fnTaskVisible` parity, statement-count and plan checks (12.5), seed-demo restricted type (T1), runbook section (Reports interim statement, section 14), and the consistency query for `IsRestricted`. Because every earlier issue must keep the existing suites green, #1403's catalogue extension should land **with #1400** (the build fails on unclassified endpoints); the rest of #1403 stays last. |
| (Reports) | not in the epic | **No new issue** (owner decision): reports are an accepted limitation at go-live, section 14. |

Order: #1399 then (#1400, #1402 in parallel) then #1401 then #1403, with the catalogue test landing with #1400. The epic notes work starts after the current issues of epic #1389 are done; no code change is needed from this note.

## 17. Owner decisions on the open questions (2026-11-17)

1. **Empty Can Edit or Can Be Assigned list = no extra limit.** Anyone who can view may edit, and anyone who can view and holds `Workflow.Execute` may be assignee (section 1.1).
2. **System Admin** sees everything, but on a restricted type is assignable only through Can Be Assigned (or when that list is empty). No admin exception.
3. **Reports stay as they are for now.** Report roles have their own permissions; no report row filter in this epic and no new reports issue. Accepted limitation at go-live (section 14).
4. **Capacity and calendar** keep counting hidden-type tasks as a bare integer, as for sensitive matters (section 6, gap 1).
5. **Deleting a role named in any Task Type access list is blocked** with a message naming the Task Types: "This role is used by N Task Types. Remove it there first." (section 9.3).

Also decided earlier: comments need Edit; no assignee exception; no PM exception; no backfill; roles add up (union); type and matter of a task stay immutable; a task assigned to someone who loses View is not auto-reassigned (the preview warns).

## 18. What this note did not check

- **Behaviour at run time.** Nothing was built or run: no test, no plan, no SQL execution. The plans in 12.5 and the `NOT IN` shape are the expected cost, not a measured one. The inline `fnTaskVisible` extension is untested SQL.
- **Report SQL Server mechanisms.** Whether row-level security or session context works for `lpt_report_reader` with the current pooling and validator was not spiked (section 14).
- **Exhaustiveness of line numbers.** The inventory is from a grep of `dev` at `11fae2b4` over `Application`, `Infrastructure`, `Api`, the baseline SQL, the report starters and the frontend task-type usage. A few frontend caches (global search recents, route titles) were not opened; `SensitiveAccessCatalog` should be walked once more at the start of #1400 because it enumerates operations, not rows.
- **Workflow engine internals** (`WorkflowInstanceService`) and `Integrations` (Entra/Graph) were not read beyond confirming they do not insert tasks.
- **Wiki.** `wiki/Architecture/Sensitive-Matter-Visibility.md` and `wiki/How-To/Add-a-Task-Type-or-Workflow.md` describe neighbouring areas; this change adds no behaviour, schema, route, permission or setting, so no wiki page is edited. The wiki changes belong to #1399 (tables) and #1403 (feature, permission and how-to pages).
