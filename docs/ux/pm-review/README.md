# Project Manager role and "My Matters": review and specification

Scope: the **Project Manager (PM)** role as a user of MatterFlow, the two manager fields on a Matter, the **My Matters** landing page that replaces My Work as the PM's home, and the changes this needs in the Matters list, the matter record, the landing rule, permissions, data model and API. Written on `origin/dev` (2026-10-22). **Documentation only: no application code was changed, nothing was built or run.** Code facts below come from reading `origin/dev` (named files); anything not in the code is marked *proposed*. Plan and estimates: `delivery-plan.md`. Decisions: `docs/requirements/decisions-addendum.md` section AG.

## 0. Binding owner decisions (not re-opened here)

1. A Matter has an **optional Primary** and an **optional Secondary** project manager, users with the Project Manager role; at most those two. A matter with no manager is **normal**: no warning, no red flag, no "needs attention" item, no empty-state scolding anywhere.
2. Primary and Secondary have **identical PM rights always**; the secondary is not "just a backup". Every query, panel, action and notification treats them the same; the only difference is a label and the Primary / Secondary / Both filter.
3. Changes to either field are **audited**. Both fields show in the **matter header strip** and as filterable **"Project manager" columns** on the Matters list.
4. A PM sees **their own matters** (primary or secondary) by default. With a permission (proposed `Matter.AssignManagers`) they can **search all matters** and **change manager assignment**.
5. The **Project Manager role's landing page is "My Matters"**, replacing My Work. My Work stays in the menu. The existing landing rule (shell wave 3, #628) is extended.
6. My Matters content: count strip, five panels, filters, bulk re-assign / re-prioritise inside a matter. **No** status report, Gantt, time or budget tracking, per-matter dashboards (a small health strip on the matter record is fine), email.
7. **No new or changed keyboard shortcuts** (Phase 2, #420). Notifications are specified in a separate epic; this document only says where PM events plug into it.

## 1. What the code already has (so the plan does not duplicate it)

| Fact | Where | Consequence |
|---|---|---|
| A starter role named **"Project Manager"** already exists: everything for work plus client, matter, number, activation and project edit rights, and `Dashboard.View/ViewSummary/ViewSwimlane`. | `Identity/Seeding/StarterRoles.cs` | The role is **not new**; it is **extended**. Roles are seeded once and editable, so existing databases need a grant script (see 5). Question Q1. |
| Landing rule: `defaultLandingPath`: My Work if `Task.View` and `/me.hasWork`; else Dashboard if any tab; else Task Queue; else per-permission fallbacks. Pure function of permissions, covered by `guards.spec.ts` and e2e `sh-landing`. | `frontend/src/app/core/auth/guards.ts` | The PM rule is a new first line of this function, keyed by a permission, never by a role name. |
| `Matter` (Organization module) has `ClientId`, numbers, `Name`, `IsActive`, `IsSensitive`, custom fields; `[Audited]`, matter-scoped audit (`IAuditScoped`). No manager fields. `AuditEvent` has `MatterId` and `CorrelationId` with index `IX_Audit_Matter`. | `Organization/Domain/OrganizationEntities.cs`, `db/scripts/03-audit.sql` | Manager changes are audited by the existing mechanism (`[AuditExplicit]` on the new ids); the Recent activity panel can read audit by `MatterId`. |
| Task has `Status` (New / InProgress / OnHold / ...), `AssignedPodId`, `AssignedUserId`, `DueDate`, `DueAtUtc`, `DueSortKey`, `StatusChangedAtUtc`, `PriorityId`, `WorkflowInstanceId`. Indexes `IX_Task_Matter (MatterId, StatusCode)`, `IX_Task_Queue`, `IX_Task_AssignedUser`, `IX_Task_Pod`. | `WorkManagement/Domain/TaskEntities.cs`, `db/scripts/12-tasks.sql` | Open / overdue / due soon / unassigned / on-hold-age all derive from existing columns. "On hold since" = `StatusChangedAtUtc` while status is On Hold. |
| `TaskQueueRules` (Open, Overdue, DueSoonExcludingOverdue, due on the viewer's date and zone) are shared by Dashboard, My Work, Pod Work and Task Queue. Counts on every strip equal the grid total of the same filter. | `WorkViews/Application/Queries/*` | My Matters **reuses these predicates**; no second definition of "overdue". |
| Dashboard summary is cached (`DashboardCache`) and scoped (`DashboardScopeResolver`). Strips elsewhere use `mf-work-strip`. | `DashboardService.cs`, `shared/work-queue/work-strip.ts` | The strip component is reused; caching approach is reused (section 8). |
| Out-of-office: `IUserAvailabilityReader` (Identity.Contracts), evaluated with time zones. | `Identity.Contracts`, `SharedKernel/Availability` | Workload panel reads it through the contract (module rule). |
| No bulk task endpoint exists; bulk completion is only a preview. Create task accepts `?matterId=&projectId=&taskType=`. | `TaskControllers.cs`; `docs/ux/create-task-review/README.md` | Bulk re-assign / re-prioritise is a new API; "+ New task" reuses the existing prefill (no change to Create task needed). |
| No workflow-progress aggregate and no per-user "last seen" store. | schema | % workflow complete and the unread marker each need a defined query / a small table (sections 6 and 8). |

## 2. Users and jobs

**Project Manager** (also a Director or Pod Lead who is set as manager). Jobs, in order: (1) "Is anything on fire on my matters?" (2) "Who is overloaded or away?" (3) "What is due in the next weeks?" (4) "Move work from A to B, change priorities, quickly." (5) Create a task on a matter without searching for it. Typical: 8 to 40 matters, 100 to 600 open tasks. Not a job of this page: reporting to clients, planning dates, hours, money.

## 3. Roles and permissions

Existing catalogue: `contracts/permissions.json` (`Group.Verb`, synced to `dbo.Permission` at startup; `Permissions.cs` and `permissions.ts` must match). *Proposed additions* (names adjustable to convention):

| Code | Group | Meaning | Default grant |
|---|---|---|---|
| `Matter.BeManager` | Client/Matter | "Can be set as a matter's project manager" and gets the My Matters landing page. A marker permission so eligibility and landing never depend on a role **name** (roles are renamable and customisable). | Project Manager |
| `Matter.AssignManagers` | Client/Matter | Search **all** matters on My Matters and change a matter's Primary / Secondary manager (matter edit form, Matters list bulk action). | Director (Q2: also Project Manager?) |

Rules:
- My Matters needs `Matter.BeManager` + `Matter.View` + `Task.View`. Its actions need the existing task permissions (`Task.Assign`, `Task.SetPriority`, `Task.Create`); an action the person lacks is **hidden, never disabled** (Pod Work rule).
- **"Own matters" is a view default, not a security boundary**: `Matter.View` already lets anyone see all matters (no row-level matter security exists, addendum O). The manager fields therefore never grant or deny access; they select. State this in the UI copy and tests.
- Eligible managers = active users holding `Matter.BeManager` (through any role). Setting a user who is not eligible is rejected (422, `MANAGER_NOT_ELIGIBLE`). If a manager later loses the role they stay on the matter (history is not rewritten); the Matters list shows them normally and the picker offers them as "no longer a project manager" only in the current value, not as a choice. Q3.
- Primary and Secondary may not be the same user (`MANAGER_DUPLICATE`). A Secondary without a Primary is allowed (no hierarchy is implied; Q4).
- Viewing the manager fields needs `Matter.View`; changing them needs `Matter.AssignManagers` (and **not** `Matter.Edit`, so a Director can reassign without editing matter details, and a matter editor cannot).

## 4. Data model (proposed)

```
dbo.Matter  + PrimaryManagerId   INT NULL  FK -> dbo.[User](UserId)
            + SecondaryManagerId INT NULL  FK -> dbo.[User](UserId)
            CHECK (PrimaryManagerId IS NULL OR SecondaryManagerId IS NULL OR PrimaryManagerId <> SecondaryManagerId)
            IX_Matter_PrimaryManager   (PrimaryManagerId)   WHERE PrimaryManagerId   IS NOT NULL
            IX_Matter_SecondaryManager (SecondaryManagerId) WHERE SecondaryManagerId IS NOT NULL

dbo.UserMatterActivitySeen (UserId PK/FK, SeenAtUtc)      -- unread marker of Recent activity (section 6.6); superseded by the
                                                           -- notification read state if that epic lands first (Q6)
```
Domain: `Matter.PrimaryManagerId`, `Matter.SecondaryManagerId` (`int?`, both `[AuditExplicit]` so the audit shows names resolved at read time, not just ids). Existing rows: both NULL (no backfill; a matter without a manager is normal). The role/permission grants for existing databases are a data change in the same script. **SQL script: next free number at implementation time** (do not claim one; other epics are writing scripts). Scripts are immutable once merged, no EF migration.

Contracts: `Matter` DTO gains `primaryManager` / `secondaryManager` as `{ userId, displayName, isActive, isOutOfOffice? }` (null when unset). Write DTO takes `primaryManagerId`, `secondaryManagerId`. Module rule: Organization stores ids and validates eligibility through an `Identity.Contracts` reader (`IMatterManagerEligibility`, *proposed*); it never references the Identity module. WorkViews reads the columns through the shared read model exactly like it already reads `MatterRef`.

## 5. API (proposed, all additive, `/api/v1`, OpenAPI + nswag regenerated, never hand-merged)

| Verb and path | Purpose | Permission |
|---|---|---|
| `PUT /matters/{id}/managers` body `{primaryManagerId, secondaryManagerId}` | Set / clear both; one audit entry per changed field, one correlation id | `Matter.AssignManagers` |
| `GET /matters/{id}` (existing) | + `primaryManager`, `secondaryManager`, `health` (small strip: open, overdue, unassigned, on hold) | `Matter.View` |
| `GET /matters` (existing) | + filters `primaryManagerId`, `secondaryManagerId`, `managerId` (either), `managedByMe`, `hasNoManager`; + sort by manager name | `Matter.View` |
| `GET /users/matter-managers?q=&take=` | Eligible users for the picker and the column filter | `Matter.View` |
| `GET /my-matters/summary` | The count strip (6.1) | `Matter.BeManager` or `Matter.AssignManagers` |
| `GET /my-matters/attention` | Needs my attention list (6.2) | same |
| `GET /my-matters/health?sort=&page=` | Matter health rows (6.3) | same |
| `GET /my-matters/workload` | Workload and capacity (6.4) | same |
| `GET /my-matters/deadlines?days=14\|28` | Upcoming deadlines (6.5) | same |
| `GET /my-matters/activity?take=` and `POST /my-matters/activity/seen` | Recent activity and the unread marker (6.6) | same |
| `POST /matters/{id}/tasks/bulk` body `{taskIds[], reassignTo? , priorityId?}` | Bulk re-assign / re-prioritise inside **one** matter; per-task result list; one correlation id | `Task.Assign` / `Task.SetPriority` (per field) |

Common query parameters for every `/my-matters/*` call: `scope=mine|all` (`all` only with `Matter.AssignManagers`), `role=both|primary|secondary`, `clientId`, `from`, `to` (date range applied to due dates and activity time), `managerId` (only with `scope=all`). The **viewer's time zone and local date** decide overdue / due today exactly as My Work does. Errors follow the existing problem-details shape; a bulk call never partially hides a failure: the response lists `{taskId, ok, code}` and the UI shows "12 changed, 2 could not be changed" with the reasons.

## 6. My Matters page

Route `/my-matters` (menu item "My Matters", placed above "My Work" for holders of `Matter.BeManager`; My Work stays right below it). Document title `My Matters`. Page header uses the shell page-header contract (#585). One scroll, no nested scroll boxes, no tabs.

### 6.1 Mock-up, 1366 px

```
My Matters                                              [ + Create task ]   (shell header button, unchanged)
Filters: Client [All v]  Role [Both v]  Dates [Next 4 weeks v]    Scope [My matters | All matters]*   (* only with Matter.AssignManagers)
---------------------------------------------------------------------------------------------------------------
| 14 matters | 212 open | 9 overdue | 17 due in 3 d | 41 due in 7 d | 6 unassigned | 3 on hold (oldest 12 d) |
|  I manage  |  tasks   |           |               |               |              |                         |
---------------------------------------------------------------------------------------------------------------
Needs my attention                                          | Upcoming deadlines          [2 wk] [4 wk]
  Overdue (9)         Smith v Jones - Review batch 4  3 d   |  Mon 26 Oct   Review batch 4      Smith v Jones
  Due soon (17)       Acme - Production volume 2      1 d   |  Tue 27 Oct   Privilege log       Acme Merger
  Unassigned (6)      Acme - QC sample                none  |  Fri 30 Oct   Production vol. 2   Acme Merger
  On hold > 7 d (2)   Roe - Collection        on hold 12 d  |  ...                          [View all]
---------------------------------------------------------------------------------------------------------------
Matter health                                                         sort: Next deadline v      [14 rows]
 Client   Matter            Open Overdue Wk Unass %Done  Next deadline  Flag            
 Acme     90001-80001 Merger   31   4     9   1   62%    Mon 26 Oct     [Red   ]  [+ New task]
 Smith    90002-80003 v Jones  18   0     5   0   40%    Thu 29 Oct     [Green ]  [+ New task]
 Roe      90005-80002 Audit     7   1     0   3   15%    none           [Amber ]  [+ New task]
 (row click opens the matter; the button opens Create task with the matter prefilled)
---------------------------------------------------------------------------------------------------------------
Workload and capacity (my matters)                  | Recent activity                       [Mark all as read]
 Pod / person        Open  Overdue  Status         |  * 09:42 Dana moved "Privilege log" to On Hold   Acme
 Processing Pod        64    5                      |  * 09:10 New task "QC sample" (Acme)             Acme
   Alex Kim            14    2                      |    Yest. Priya commented on "Review batch 4"   Smith
   Priya Rao            9    0     Out of office to 30 Oct |  Yest. "Collection" reassigned Lee -> Sam   Roe
 Review Pod            40    1                      |  (* = unread since you last opened or marked read)
```

Strip cells (each is a link to the **filtered list**; counts never follow a panel's own filter, but they do follow the page filters Client / Role / Dates / Scope, stated in the strip's `aria-label`):

| Cell | Count | Opens |
|---|---|---|
| Matters I manage | active matters where I am Primary / Secondary / either per Role filter | Matters list `?managedByMe=true&role=` |
| Open tasks | open tasks on those matters | Task Queue `?managedByMe=true` (open) |
| Overdue | open and overdue | Task Queue `...&overdue=true` |
| Due in 3 days / 7 days | open, due within N days, not overdue (3 is inside 7; both shown, labelled "in 3 days" and "in 7 days", never summed) | Task Queue `...&dueWithin=3\|7` |
| Unassigned | open, no person and no pod | Task Queue `...&unassigned=true` |
| On hold | status On Hold; second line "oldest 12 d" (age of the longest hold) | Task Queue `...&status=OnHold` (sorted oldest hold first) |

This needs **one additive Task Queue filter**: `managedByMe` / `managerId` (+ `role`) on the existing query (`TaskQueueQuery`), so strip numbers equal grid totals (the rule every strip in the app already obeys). Detail Q7.

### 6.2 Needs my attention
A short list (cap 10 per group, "View all" opens the filtered Task Queue): **Overdue** (oldest due first), **Due soon** (within 3 days), **Unassigned** (open and due within 7 days first), **Stuck on hold** (On Hold longer than a threshold, default 7 days, one fixed number in this phase, Q8). Each row: task title, matter, one fact (3 d overdue / due tomorrow / no assignee / on hold 12 d), opens Task Detail; Back returns here. **Matters with no manager, or tasks of matters nobody manages, never appear as an item.** Empty state: "Nothing needs your attention." (positive copy, no illustration).

### 6.3 Matter health table
One row per matter in scope (default sort: next deadline, soonest first; headers sortable by the viewer; server paged at 50).

| Column | Definition |
|---|---|
| Client, Matter | `ClientNumber` name, `MatterRef` + name (links to the matter) |
| Open / Overdue / Due this week / Unassigned | counts as in 6.1 for that matter; "this week" = next 7 days incl. today, not overdue |
| % workflow complete | steps completed or skipped / all steps, over the matter's **open** tasks' workflow instances (completed tasks excluded so the number moves as work is done); "-" with no open tasks. Definition Q9 |
| Next deadline | earliest due date among open tasks, not overdue; "none" if none |
| Flag (RAG) | see below; text label always, colour second |
| + New task | button; opens `/tasks/new?matterId=<id>` (existing prefill: matter fixed, project optional, task type chosen on the page); on return (Create / Cancel) the person lands on My Matters, not the Task Queue (uses the existing `returnUrl` behaviour of the page, or adds it: one line, listed in the plan) |

**RAG rule (proposed, deliberately simple, not a score):** *Red* = at least one open overdue task. *Amber* = no overdue, but any open task is unassigned, or due within 3 days, or on hold longer than the threshold. *Green* = none of those. A matter with no open tasks is Green with "No open tasks". **No manager state enters the flag.** The flag never ranks matters or people and is not a default sort. Tooltip and a "How is this decided?" popover spell the rule out. Q10.

Row interaction: the whole row is a link to the matter (a real `<a>` in the Matter cell, row click as enhancement, same pattern as the shared grid); "+ New task" is a separate button with `aria-label="New task for <matter ref>"`, not nested inside the link. A row action menu (...) is not added: bulk actions are on the matter page (6.7).

### 6.4 Workload and capacity
Open tasks **on my matters** grouped by pod, then person (assigned person; an "Unassigned" row first, like Pod Work's "Not assigned to a person"): Open, Overdue, On hold, and an availability chip while the person is out of office (same text as the assignee picker; `IUserAvailabilityReader`). Alphabetical until the viewer sorts; **never ranked, no load bars coloured by threshold, no "overloaded" label** (UX principle 12, as in Pod Work). Row click filters the Task Queue by person + managed-by-me. Folded: people with no open work on my matters are not listed.

### 6.5 Upcoming deadlines
Open tasks with a due date from today to +2 or +4 weeks (toggle, default 2), grouped by day, with matter and assignee; capped at 25 with "View all" to the filtered Task Queue sorted by due date. Overdue is **not** here (it is in 6.2). Date range filter applies.

### 6.6 Recent activity
Last 7 days (cap 30, "Show more" +30) on my matters, newest first: status changes, new tasks, comments, reassignments (and manager changes: "Alex became primary manager"). Source: `AuditEvent` rows by `MatterId` (indexed) filtered to those event kinds, plus comment creation; text is generated from structured fields, never a free-text copy of comments (privilege: comment bodies are not shown, only "commented on <task>"). **Unread marker:** a dot and "unread" text on events newer than the person's `SeenAtUtc`; "Mark all as read" and leaving the page with the panel in view for 3 s do not move it silently: only the button (and opening an item) updates it; first visit marks nothing unread. If the Notifications epic (specified separately) provides read state it replaces the small table; PM events (a task on my matter becomes overdue, goes on hold, is reassigned; I am set as manager) are registered with that epic as event kinds and **no email is added**.

### 6.7 Bulk actions inside a matter
From the **matter's task grid** (matter record, Tasks tab; bulk selection mode added there) a PM selects tasks and chooses **Re-assign...** (person or pod) or **Set priority...**; a confirm dialog shows the count and result. Not on the health table (it is a summary, not a task list). Rules: only open tasks; maximum 100 per call; each task still follows the single-task rules (permission, pod, status; the cross-pod warning of the picker is shown as a warning, not blocked); result list with reasons; one `CorrelationId` so the audit groups the batch; Undo is **not** offered (reversal is another bulk action; the dialog says so). Available to anyone with the task permissions, not only PMs (the surface is the matter page).

### 6.8 Filters
Client (typeahead, all clients the PM has matters with), Role (Both / Primary / Secondary), Date range (applies to deadlines and activity and to "due" counts: Next 4 weeks default; Today, Next 2 weeks, Next 4 weeks, Custom). State in the URL (`?clientId=&role=&range=`), restored on Back, remembered per person in local storage as a convenience only. Scope switch All matters (with `Matter.AssignManagers`) adds a "Project manager" filter (any eligible user, or "No project manager" as a plain filter option, never a warning).

### 6.9 States
Loading: skeleton per panel, panels load independently (one slow panel never blocks the others). Error per panel with Retry. **No matters yet** (a PM with none): "You are not the project manager of any matter yet." plus, with `Matter.AssignManagers`, "Show all matters" ; otherwise "Ask a director to assign you." No red, no counts of "unmanaged matters".

## 7. Matters list and matter record

**Matters list** (shared grid, inline column filters): two new columns **Primary manager** and **Secondary manager** (header text "Project manager (primary)" / "(secondary)", display name; empty cell is empty, no "Unassigned" shaming), each with the standard inline filter (typeahead of eligible users; "Any" and "None" are ordinary options). Plus a quick filter "Mine". Default columns: Primary manager on, Secondary off below 1100 px; phone card shows "PM: Alex Kim / Priya Rao" only when set. Sorting by manager name. Bulk "Set project managers" for rows selected (`Matter.AssignManagers`).

**Matter header strip** (record page): `Client . Matter ref . Active . Sensitive` then `Project manager: Alex Kim (primary), Priya Rao (secondary)`; with nobody set the strip simply omits the part (or, for `Matter.AssignManagers` holders, shows a quiet "Add project manager" link). Changing opens a small dialog with two pickers (eligible users, out-of-office shown), Save, audit note. **Small health strip** under it (open, overdue, unassigned, on hold, as links to the matter's task grid): the only per-matter "dashboard".

```
90001-80001  Acme Merger          Active
Client: Acme Corp    Project manager: Alex Kim (primary) . Priya Rao (secondary)   [Change]
Open 31   Overdue 4   Unassigned 1   On hold 2
```

**Create task prefill:** the existing `?matterId=` path is used unchanged (matter chosen and shown, project select enabled, crumb `Tasks > matter > Create task`). The button must work at 375 px (see 9).

## 8. Dashboard queries and performance

All queries start from `matterIds = SELECT Id FROM Matter WHERE IsActive AND (PrimaryManagerId = @me OR SecondaryManagerId = @me)` (role filter narrows it; client filter adds `ClientId`). The two filtered indexes make this a seek; a PM has tens of matters. Then **one grouped pass over `Task` by `MatterId`** using `IX_Task_Matter (MatterId, StatusCode)` and the existing predicates (`TaskQueueRules.Open`, `Overdue(queueClock)`, `DueSoonExcludingOverdue`):

| Query | Shape | Cost note |
|---|---|---|
| Summary strip | `COUNT` with conditional aggregation over open tasks of `matterIds`; oldest hold = `MIN(StatusChangedAtUtc)` where OnHold | One pass, seek per matter; also the `Matters I manage` count. Cache 30 s per (user, filters) like `DashboardCache`; busted by task writes already (same hook as Dashboard). |
| Health table | `GROUP BY MatterId` conditional counts + `MIN(DueSortKey)` of non-overdue open; % workflow via `WorkflowInstanceStep` counts joined by `WorkflowInstanceId` for open tasks of the page's matters only (50 matters) | The step join is the one expensive part; page-limited and computed after paging by the grouped counts; measure at 200 matters / 20 k open tasks, budget below. |
| Attention | four `TOP 10` queries with `ORDER BY DueSortKey` / `StatusChangedAtUtc` | Use `IX_Task_Queue`; each bounded by TOP. |
| Workload | `GROUP BY AssignedPodId, AssignedUserId` over open tasks of `matterIds`; availability fetched for the returned user ids in one contract call | `IX_Task_Pod` / `IX_Task_AssignedUser`; result rows = people, small. |
| Deadlines | open tasks with `DueSortKey` between today and today+N days, `TOP 25` | `IX_Task_Queue` range on DueSortKey after status filter. |
| Activity | `AuditEvent WHERE MatterId IN (...) AND CreatedAt > @since AND Kind IN (...) ORDER BY ... TOP 30` | `IX_Audit_Matter (MatterId, AuditEventId)`; a 7-day cutoff on `AuditEventId` bounds it. Needs the "kind" filter to be selective: verify in the first spike; if not, add one script index (Q11). |
| All matters scope | same queries without the manager predicate | Equals the Dashboard summary cost; the health table is paged, the strip is cached 60 s; cap enforced at 5,000 matters. |

**Budgets (proposed, to be measured by PM-14):** with the seeded 200 matters / 20,000 open tasks, each endpoint p95 < 300 ms warm, < 800 ms cold, whole page loaded < 1.5 s on the test server; no query scans `Task`. Panels are fetched in parallel (6 calls, ~1 KB to 20 KB each). Strip numbers must equal the Task Queue totals for the same filters (an integration test per cell).

## 9. Accessibility, phone and tablet

- Landmarks: `main` > h1 "My Matters", each panel an `h2` region; the strip is a list of links (as `mf-work-strip`) with text counts and no colour-only meaning; the RAG flag is **text** ("Red", "Amber", "Green" with an icon) with contrast of 4.5:1; the unread marker is a dot **plus** the word "unread" (visually hidden is not enough: visible on focus/hover and in the accessible name).
- Tables: real `<table>` with `scope` headers, sortable headers are buttons with `aria-sort`; row link is the Matter cell; "+ New task" is a button with a full accessible name. Panels announce updates politely only on user action (filters, mark read); no live region for background refresh.
- Keyboard: existing keys only (Tab order: filters, strip, panels in reading order, table rows, row button); **no new or changed shortcut** (#420). Focus after Back returns to the row left.
- Axe 0 violations at 1366, 1920, 768, 375, with the filter menus and the bulk dialog open; no page-level horizontal scroll.
- **Phone (375 px):** filters collapse into one "Filters (2)" button opening a sheet; the strip is one scrolling chip row (as Pod Work); panels stack in the order Needs my attention, Matter health, Upcoming deadlines, Workload, Recent activity; the health table becomes **cards** (below 640 px, shared `mf-record-card-list`): matter name and client, "4 overdue . 9 this week . 1 unassigned", flag text, and a full-width **+ New task** button inside the card, touch target >= 44 px. Workload and activity collapse to the first 5 with "Show all". Tablet (640 to 1099): two columns for the lower panels, health table drops "Due this week" and "% complete" into the row detail.
- Copy is plain, no jargon ("Needs my attention", "Matter health").

## 10. Findings and risks (ranked)

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| F1 | major | "New role" is not new: a "Project Manager" starter role exists, and starter roles are seeded once. Adding a role would duplicate it; changing code alone would not reach existing databases. | Extend the role; grant script for existing databases (PM-02). |
| F2 | major | No row-level matter security exists, so "my matters" can only be a **default view**, not access control. Users may read this as "PMs only see their matters". | Say it in UI copy and docs; owner decision AG-4 already frames it as a default. |
| F3 | major | Task Queue has no "matters managed by X" filter; without it strip links cannot satisfy the "count equals grid total" rule. | One additive filter (PM-09/PM-10). |
| F4 | minor | "% workflow complete" has no definition or API. | Define per 6.3; confirm (Q9). |
| F5 | minor | Activity unread needs state per user; notifications epic may own it. | Small table now, replaced if the notification epic lands first (Q6). |
| F6 | minor | Eligibility by role name breaks on rename. | Marker permission `Matter.BeManager`. |
| F7 | nit | A PM with no matters would see an empty landing page forever. | Positive empty state with a link to My Work and (permission) all matters; the landing rule is unchanged (owner decision). |

## 11. Out of scope
Status reports, Gantt/timeline, time and budget tracking, per-matter dashboards beyond the small strip, email or digest, keyboard shortcuts (#420), merging My Work and My Matters, matter-level access control, manager hierarchy or approval workflow, more than two managers, notification delivery (separate epic), Dashboard (department) changes.

## 12. Open questions for the owner (recommended answer first)

- **Q1** The "Project Manager" role already exists as a starter role. OK to extend it (add `Matter.BeManager`; existing databases get the grant by script) rather than create a second role? *Recommended: yes.*
- **Q2** Who gets `Matter.AssignManagers` by default? *Recommended: Director only; admins can tick it on Project Manager.* (Owner text: a PM "with the permission".)
- **Q3** When a manager loses the role, should they stay on their matters? *Recommended: yes, shown as is, no warning, removable.*
- **Q4** May a matter have a Secondary but no Primary? *Recommended: yes (they are equals).*
- **Q5** Marker permission name `Matter.BeManager` and eligibility keyed by it (not by role name): OK?
- **Q6** Unread marker: own small table now, or wait for the Notifications epic's read state? *Recommended: own table, swap later.*
- **Q7** Strip links need a Task Queue filter "on matters managed by me": OK to add it to the shared Task Queue query (additive)?
- **Q8** "Stuck on hold" threshold: fixed 7 days now, configurable later?
- **Q9** "% workflow complete": steps done or skipped over steps of **open** tasks' workflows. OK?
- **Q10** RAG rule as in 6.3 (Red = any overdue; Amber = unassigned / due in 3 d / long hold; Green otherwise). OK?
- **Q11** Recent activity reads the audit log; a covering index may be needed (decided by measurement).
