# Issue #1401: Task Type access, edit and assign rules, pickers and task creation

Branch `tasktype-access-write`. Screenshots taken on a real stack (SQL Server 2022, the published API with Dev auth, `Features:TaskTypeAccess=true`), Chromium, 1366x768 and 1920x1080, realistic data (the starter task types, a restricted "Privilege Review" type).

The type has Can View = reviewer role, Can Edit = editor role, Can Be Assigned = assigner role. "Before" is the same screens and the same people while the type has no roles (open to everyone, today's behaviour); "after" is with the lists saved.

| File prefix | Person | What changes |
|---|---|---|
| `before/after-create-task-type-list` | Rita Reviewer (can view, not edit) | Task > New Task chooser: the restricted type is no longer offered (she may see the type but not create tasks of it) |
| `before/after-task-page-reviewer` | Rita Reviewer | Task page: the existing "View only" line says "you can see this task but not change it"; no Edit button, no inline menus, no status actions |
| `before/after-edit-task-assignee-list` | Eddie Editor (can edit) | Edit Task > Priority, due date and assignment > Assignee: only people in Can Be Assigned are listed |
| `after-bulk-reassign-result` | Rita Reviewer | Matter > Tasks > Select > Re-assign: "1 changed, 1 could not be changed", the read-only task listed with the reason |

Not checked: other screens that show the Task Type filter (they use the same shared source); dark mode; any size other than the two named.
