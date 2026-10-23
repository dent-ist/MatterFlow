# Sensitive matter access control: design

Epic #788. Status: **proposed design** (written 2026-10-23 on `origin/dev`, documentation only, nothing built). Decisions: `docs/requirements/decisions-addendum.md` section AJ. Plan: `delivery-plan.md`. Epic: "Epic: Sensitive matter access control" (phase-20). Code facts come from reading `origin/dev`; anything else is marked _proposed_.

## 1. The rule (binding owner decisions)

Today `Matter.IsSensitive` is only a warning flag ("display-only", addendum O, line `OrganizationEntities.cs`); any user with `Matter.View` can open any matter. New rule for a matter with `IsSensitive = 1`:

| Who | Sees |
|---|---|
| (a) Primary or Secondary project manager of that matter (`Matter.PrimaryManagerId` / `SecondaryManagerId`, script 28) | the whole matter |
| (b) holder of the new permission `Matter.ViewSensitive` | ALL sensitive matters, whole |
| (c) a user to whom a task of the matter is **currently assigned** (`Task.AssignedUserId`) | only those tasks, plus the matter header needed to open them |
| anyone else | NOTHING |

"Nothing" means: absent from lists, counts, totals, search and suggestions, dashboards, notifications, activity and audit views, pickers, bulk actions, exports; a direct address or API call returns **404, never 403**. A sensitive matter without a manager is visible to (b) and (c) only. Access ends immediately when a manager is removed, a task is reassigned, or the permission is taken away. Marking and un-marking is an audited action. Non-sensitive matters behave exactly as today. `Matter.View` (and `Task.View`, `Asset.View`, ...) stay necessary: this rule only **narrows** what those permissions reach, it never widens.

Definitions used below. `Viewer` = (UserId, SeeAll) where `SeeAll` = `IsSystemAdmin` or holds `Matter.ViewSensitive`.
- `MatterVisible(m)`: `NOT m.IsSensitive OR SeeAll OR m.PrimaryManagerId = u OR m.SecondaryManagerId = u`  (mode **M**)
- `TaskVisible(t)`: `MatterVisible(t.Matter) OR t.AssignedUserId = u`  (mode **T**)
- `AssetVisible(a)`: `MatterVisible(a.Matter) OR EXISTS link(a, task) with task.AssignedUserId = u`  (mode **A**; an assignee can open assets linked to their own task, nothing else)
- `HeaderOnly(m)`: for a visible task whose matter is not `MatterVisible`, the task DTO carries a minimal matter header (id, reference, name, client name, `IsSensitive`) and **no** manager names, counts, custom fields or links to the matter page (mode **H**). `GET /matters/{id}` for that user is still 404.
- A task's project name is task data and is shown on a visible task. The Project itself follows the matter (mode **M**).

## 2. Permission

- Code `Matter.ViewSensitive`, group "Client/Matter", description "See all sensitive matters (every sensitive matter, with all its tasks and assets, regardless of manager or assignment)". Naming follows `Matter.View`, `Matter.BeManager`, `Matter.AssignManagers` in `contracts/permissions.json`.
- Add to `contracts/permissions.json`, `Permissions.cs` (Identity.Contracts) and the Angular `permissions.ts` together (tests enforce parity).
- Default grants (new numbered script, **next free number at implementation time**, same pattern as script 28 which grants by role name): roles `Director` and the System Administrator role. System Admin holds every permission implicitly, but the grant row keeps role screens truthful. Existing databases get the grants through the script; roles are assignable to any other role in Roles administration.
- It is not a marker: it has an effect (the SeeAll flag). It does not imply `Matter.View`; a holder without `Matter.View` still gets 403 from the policy as for any matter.
- Roles screen: show the permission with a plain warning text ("Grants access to every sensitive matter").
- Grant changes are already audited (role permission events). Permission lookups must not be cached across requests longer than zero (section 11.4).

## 3. Data model changes

Minimal; the rule uses columns that exist.

| Change | Why | Notes |
|---|---|---|
| None to `Matter` | `IsSensitive`, `PrimaryManagerId`, `SecondaryManagerId` exist | |
| Index `IX_Matter_Sensitive` filtered `WHERE IsSensitive = 1` on (`MatterId`) INCLUDE (`PrimaryManagerId`, `SecondaryManagerId`) | the "sensitive set" is small; keeps the NOT-EXISTS style predicates cheap | script 33 added manager indexes; check before adding |
| Index on `Task (AssignedUserId, MatterId)` INCLUDE (`StatusCode`) | assignee rule (c) | verify with the existing `IX_Task_*` set |
| Index on `AuditEvent (MatterId, TaskId)` | audit filter | `IX_Audit_Matter` exists; extend only if the plan shows a scan |
| Inline table-valued functions `dbo.fnMatterVisible(@UserId, @SeeAll)` and `dbo.fnTaskVisible(@UserId, @SeeAll)` (and `fnAssetVisible`) | SQL-level twin of the C# predicate for raw-SQL modules | these are functions, not tables: `report-access.json` lists tables only, but the script must `DENY EXECUTE/SELECT` on them to `mf_report_reader` (section 14). If a new **table** is added later it needs `db/report-access.json` plus GRANT/DENY. |
| _Proposed, optional_ `AuditEvent.IsSensitiveScope BIT NOT NULL DEFAULT 0` stamped at write time | history written while sensitive stays restricted after un-marking (open question Q4) | `AuditEvent` is append-only behind `AuditEventGuard`; adding a defaulted column is allowed by a new script |

No script number is claimed here: every script is "next free number at implementation time" (28 to 33 are used on `dev`). Scripts are immutable once merged; fix forward.

## 4. The visibility port (one place)

Modules may reference only `SharedKernel` and other modules' `.Contracts`. So the port lives in **SharedKernel** (`MatterFlow.SharedKernel/Visibility/`), implemented once, consumed by every module:

```
public readonly record struct Viewer(int? UserId, bool SeeAll);        // UserId null = system/background

public interface IMatterVisibility                                     // scoped DI service
{
    Viewer Current { get; }                                            // from ICurrentUser + IPermissionChecker (SeeAll)
    Viewer For(int userId);                                            // async variant for jobs: ForAsync(userId, ct) resolves SeeAll from role grants
    // C# side: predicates as expression trees, composable into any IQueryable
    Expression<Func<TMatter,bool>> MatterPredicate<TMatter>(...)       // shape-agnostic via selectors (below)
    IQueryable<T> WhereMatterVisible<T>(IQueryable<T> q, Expression<Func<T,int>> matterId, ...);
    IQueryable<T> WhereTaskVisible<T>(...);  IQueryable<T> WhereAssetVisible<T>(...);
    // SQL side: the same rule for raw SQL
    string SqlMatterVisible(string matterIdColumn, string userParam, string seeAllParam);   // returns "EXISTS (SELECT 1 FROM dbo.fnMatterVisible(...) ...)"
    // single-record gates for writes and ids from the client
    Task<bool> CanSeeMatterAsync(int matterId, ct);  Task<bool> CanSeeTaskAsync(long taskId, ct);
    // 404 helper
    Error NotFound(string resource);                                   // identical error for hidden and missing
}
```

Because SharedKernel cannot see `Matter` or `WorkTask`, the predicate is written over a tiny **shape**, not the entity: the selectors pick `IsSensitive`, `PrimaryManagerId`, `SecondaryManagerId` from whatever the module has. To keep it type-safe and in one place, the **Organization module owns the matter table** and exposes (in `Organization.Contracts`) `IMatterAccessSource` that returns `IQueryable<MatterAccessRow>` (`MatterId, IsSensitive, PrimaryManagerId, SecondaryManagerId`) already restricted by the rule; `WorkManagement` exposes the same for tasks. Other modules join their rows to these queryables (`MatterId IN visible`) instead of reading `Matter` directly. This keeps the boundary rule and gives one definition.

Decision (proposed, to be proven in the first work package): **explicit scoped sources + EF global query filter as a safety net**.
1. Primary mechanism: every read path obtains matters, tasks, projects, assets, audit events and notifications through the visible sources above (one call per read path). An architecture test forbids `db.Set<Matter>()`, `db.Set<WorkTask>()`, `db.Set<Project>()`, `db.Set<Asset>()` and the `dbo.Matter`/`dbo.Task` text in raw SQL outside a short allow-list (the sources, the writers, migrations, the audit writer).
2. Safety net: an EF global query filter on `Matter`, `Project`, `Asset`, `WorkTask` using the current viewer (mode M or T), so a forgotten read path returns less, not more. Known cost: a filtered required navigation (`Task.Matter`) turns into an inner join that would hide the matter header from an assignee (mode H). Task DTO projections therefore read the header through a dedicated `MatterHeader` query that ignores the matter filter (allow-listed `IgnoreQueryFilters` in one file) and are only reachable from a task that already passed `TaskVisible`. If the spike (work package SM-02) shows the filter is not workable with the existing projections, ship the explicit sources plus the architecture test and drop the filter; the rule stays the same.
3. Writes: every command loads its target through the same sources, so a hidden target yields the same 404 as a missing one. No command path may use the unfiltered set except the audit writer, schema migration and the notification scheduler's candidate scan (which re-checks per recipient, section 8).
4. Background jobs have no HTTP user: they call `ForAsync(recipientUserId)`; they never run as "see all".

**Built in SM-02 (#790), decisions recorded:**
- `MatterFlow.SharedKernel/Visibility`: `Viewer`, `IMatterVisibility`, `VisibilityPredicates` (the rule as expression trees), `MatterAccessRow`/`TaskAccessRow`, the options class of the go-live switch. The implementation `MatterVisibility` lives in the **Identity** module (the see-all flag is a role grant; it needs EF for `ForAsync` and the single-record gates).
- The sources are `IMatterAccessSource` (Organization) and `ITaskAccessSource` (WorkManagement). They are declared in SharedKernel, not in the `.Contracts` projects as first proposed: the port in SharedKernel consumes them and SharedKernel cannot reference a Contracts project. Each module only projects its own table to the tiny row shape; no module sees another module's entity.
- API: `Current`, `ForAsync(userId)`, `VisibleMatters`, `VisibleTasks`, `WhereMatterVisible(q, matterId)`, `WhereTaskVisible(q, taskId)`, `CanSeeMatterAsync`, `CanSeeTaskAsync`, `NotFound()` (one generic 404 error). Mode A (assets) and mode H (header-only projection) are built with their read packages (SM-06, SM-07); H is a projection concern (a visible task whose matter is not in `VisibleMatters`).
- Go-live switch: `Features:SensitiveMatterAccess` (default **false**, in `appsettings.json`). Read in one place, the port. While off, `VisibleMatters`/`VisibleTasks`/`WhereX` return everything and behaviour is exactly as before; the single-record gates still answer "exists". Tests cover both states.
- A viewer without a person (system or background, `UserId` null) is never "see all" and never matches a manager or assignee. The comparison is not written against a null parameter, which SQL would turn into `IS NULL` and match every matter without a manager.
- **Permission cache check:** the caller's snapshot (`UserAccessCache`, TTL `Authorization:CacheSeconds`, default 60 s) is dropped immediately on this node when roles, grants or user status change through the application, so `Current.SeeAll` is correct on the next request (integration test through the roles API). Manager and assignment reads are never cached. Residual: with more than one API node a change made on node A reaches node B after at most the TTL; `Authorization:CacheSeconds=0` closes that gap if the deployment ever has more than one node. `ForAsync` (jobs, recipients) always reads the grants from the database.
- **EF global query filter spike: decided against.** The filter would have to be the viewer-dependent `Matter`/`WorkTask` filter on a shared DbContext used by 30+ read sites, plus raw SQL in the scheduler jobs, which a filter never covers; a filtered required navigation turns `Task.Matter` into an inner join and would hide the matter header from an assignee (mode H). Shipping explicit sources plus the architecture/catalog tests (SM-16) keeps every read path visible in code review. There is therefore no `IgnoreQueryFilters` allow-list.

Parity: the C# predicate and the SQL functions are tested against the same fixture matrix (section 12.3) so they cannot drift.

## 5. 404 semantics

- A hidden matter, project, task, asset, comment, notification target and anything under them returns the **same** response as a nonexistent id: status 404, same problem-details `type`/`title`/`detail` text ("The resource was not found."), same headers and size; no `ETag`, `Location`, `Retry-After` or rowversion; the resource name is generic. Tested by comparing the body of a hidden id with a missing id byte for byte (minus `traceId`).
- The permission policy runs first: a user without `Matter.View` gets 403 for every matter (hidden or not), which reveals nothing. For a user who has the permission, 403 is never used for hiddenness.
- Resolution order inside a handler: load through the visible source, then business validation. Never validate (conflict, state, form errors) before visibility.
- Child ids under a hidden parent (`/tasks/{id}/comments/{c}`, `/matters/{m}/tasks/bulk`) resolve through the parent first.
- Request bodies that carry ids (`matterId`, `taskIds`, `assetId`, `projectId` in create/assign/link) are checked the same way: a hidden matter in a body is 404-equivalent ("not found" validation on that field, same text as a nonexistent id), never "no permission".
- Batch endpoints answer per item with `{id, ok:false, code:"NOT_FOUND"}` for hidden items, indistinguishable from missing ones.
- Known residual oracles (accepted, listed in threat model): number uniqueness (section 13 T6) and timing.

## 6. Counts and totals

Every count is computed from the visible sources, never from the unfiltered table and then subtracted. Totals, `X of Y`, pager totals, tab badges, strip cells, "no results" empty states, facet counts, "N matters" on client pages, user "open tasks", pod load, dashboard KPIs, trends, swimlanes, coverage, My Matters strip, notification unread count, audit facet counts and the global search counts all use the viewer. A test (section 12) asserts for every list+count pair: count equals the number of rows obtained by paging the matching list, for each persona.

Integrity checks that must see the truth (cannot delete or retire a task type / status label / priority / form because tasks use it, cannot deactivate a user who has open tasks, cannot delete a client with matters) keep using the **unfiltered** internal check, but what they show is limited: "In use" without a number when hidden rows exist (never "in use by 12 tasks" if some are hidden). Proposed wording: "in use" plus the visible count only if no hidden rows exist.

## 7. Search and suggestions

`SearchService` runs one query per type (Clients, Matters, Projects, Tasks, Assets). Matters: mode M. Projects: M. Tasks: T. Assets: A. Clients: unchanged, but any matter count or "last matter" field uses M. Suggestions (top 5 per type) and advanced search share the same service, so one change covers both; the advanced search "Sensitive" filter yields only what the viewer may see, and the `IsSensitive` column on hits is only ever true for visible rows. The task assignee finds their own task by title but not the matter in the Matters group.

## 8. Notifications and activity

- **Creation time:** a notification is only created for a recipient who can see the subject at that moment. The producer asks `IMatterVisibility.ForAsync(recipient)` (task assigned to X: X is the assignee so visible; manager-set event: X is the manager; due/stalled jobs: recipients are the assignee and managers, still checked). This closes "mentioned user" or "watcher" style leaks if recipients ever widen.
- **Read time (the important one):** `GET /me/notifications`, `/poll`, the unread count, mark-read, read-all all filter by the viewer's **current** visibility of `MatterId`/`TaskId`. Access that ended (manager removed, task reassigned) makes the rows disappear at once and drops the unread count; they come back if access returns. Bodies/titles stored at creation never contain more than the recipient could see at that time and are never shown after access ends.
- **Scheduler SQL** (`TaskDueJob`, `TaskStalledJob`, and the retention job): candidate queries join `dbo.Task`/`dbo.Matter` as system; the per-recipient insert step joins `dbo.fnTaskVisible(@recipient, @seeAll)`. The retention job deletes by age and needs no filter.
- **Activity:** Task activity (`GET /tasks/{id}/activity`) is behind task visibility and shows only events with that `TaskId` to an assignee-only user (matter-level events with no `TaskId` are not shown to them). My Matters "Recent activity" and the "activity seen" marker use mode M. The Audit module reads (`/audit/events`, `/audit/search`, `/audit/facets`, `IAuditReader`) restrict `AuditEvent.MatterId` by mode M and `TaskId` by T. `IAuditDisplayLookup` (names for ids in audit text) must return a neutral label for hidden matters/tasks/assets so a non-matter event that mentions a hidden record leaks no name.
- Events with neither `MatterId` nor `TaskId` that reference a record only inside old/new values (for example a client event) carry no matter data; the audit test lists all `IAuditScoped` entities to prove every matter-related entity sets `AuditMatterId`.

## 9. Marking and un-marking

Who may do it today (code): `IsSensitive` is a normal field of `POST /matters` (permission `Matter.Create`) and `PUT /matters/{id}` (permission `Matter.Edit`), recorded as a generic field change by `[Audited]`. Anyone with `Matter.Edit` can flip it.

Proposed:
- Marking and un-marking stay behind `Matter.Create` / `Matter.Edit` **and** require the actor to see the matter (otherwise 404). It writes a dedicated audit event `MATTER_SENSITIVITY_CHANGED` (who, from, to, matter, time), shown on the matter's activity and visible only to those who can see the matter.
- Un-marking requires `Matter.ViewSensitive` or being a manager of the matter (open question Q3: a plain editor should not be able to declassify).
- Creating a sensitive matter without `Matter.ViewSensitive` and without naming yourself or someone as manager is rejected with a validation error ("A sensitive matter needs a project manager, or be created by someone who can see all sensitive matters"), so nobody creates a matter that instantly disappears from them. The POST response itself returns the created matter once.
- Marking an existing matter hides it at once from everybody outside the rule; the actor, if outside the rule, gets a confirmation dialog first ("You will no longer see this matter").
- Bulk or import paths do not exist for the flag; if one appears it must call the same service.

## 10. Caches

Nothing about a sensitive matter may sit in a cache keyed without the viewer.
- Server: `DashboardCache` (60 s) is partitioned by a **visibility key**: `all` for SeeAll viewers, else `u:{userId}`; existing scope keys stay inside it. The My Matters strip cache follows the same key. Any other `IMemoryCache`/response cache found by `git grep` is classified in the inventory (R-rows) and keyed or disabled. Output caching of GETs must `Vary` on the user or stay off.
- Permission cache: `SeeAll` must reflect a role change on the next request (verify how the current permission checker caches; work package SM-02). Manager and assignment reads are never cached.
- Frontend: section 11.

## 11. Frontend leak checklist (the UI only reflects the server)

The frontend adds **no** security logic beyond: hide actions that would 404, show the "not found" page for 404, and never fabricate access.
1. Lookup stores / typeahead caches (matters, tasks, projects, assets): cleared on user change and sign-out; entries never persist to `localStorage`.
2. Pickers (new task matter picker, asset link, bulk dialogs, filters): fed by the filtered endpoints only; no client-side filtering of a bigger list.
3. Route titles, `document.title`, breadcrumbs, history entries, tab names: built from loaded data, so a 404 page shows "Not found", never a name from the URL, a cache, or a previous page.
4. Error and toast messages: never echo the matter ref/name from the request; validation messages for hidden ids use the generic "not found" text.
5. Notifications text and toasts; push of unread counts: from the server only.
6. Audit/activity text: server-composed; the UI does not resolve ids to names itself.
7. Search suggestions and "recent searches/recent items" (`localStorage`): store ids only if needed, re-fetch names, and drop an item on 404; clear on user change.
8. Exports and CSV: only from the server's filtered result; no client CSV from cached data.
9. Bulk dialogs: counts "N selected" derive from the server response, per-item results show "not found" generically.
10. Task page for an assignee: matter header chip is plain text (no link to the matter page); breadcrumbs stop at the task or the queue; no "other tasks in this matter", no matter-level tabs.
11. Matters list `Sensitive` filter and badge appear unchanged but only ever show visible rows.
12. The frontend never reads or stores `Matter.ViewSensitive` to make visibility decisions beyond showing the Roles screen entry; the permission shows in `/me` like any other.
13. Deep links to a hidden matter: same 404 page as a mistyped id; no "request access" prompt (that would confirm existence).
14. No new or changed keyboard shortcuts (#420).

## 12. Test plan

### 12.1 Fixtures
One seeded "universe" (test data builder in the integration test project, also used by e2e):
- Users: `pmPrimary`, `pmSecondary`, `assignee` (non-manager with one task on the sensitive matter, none on others), `viewer` (holds `Matter.ViewSensitive`), `unrelated` (Matter.View, Task.View, Asset.View, Dashboard.*, Audit.View but nothing sensitive), `noPerm` (authenticated, no matter permissions) plus an unauthenticated client.
- Matters: `S1` sensitive with both managers; `S2` sensitive with no manager; `S3` sensitive where only a task is assigned to `assignee`; `N1` normal control. Each carries sentinels (`ZZSENS-<id>`) in number, name, custom field, task title and description, comment, asset name, project name, notification text and audit values.

### 12.2 Systematic security suite ("walk every endpoint as six personas")
Personas: **P1** PM-primary, **P2** PM-secondary, **P3** task assignee, **P4** ViewSensitive holder, **P5** unrelated user, **P6** "anonymous-without-permission" (6a unauthenticated: 401; 6b authenticated with none of the relevant permissions: 403 from the policy, never 404/200).

Mechanism:
1. Enumerate all endpoints from `EndpointDataSource` (every controller action, plus the generated OpenAPI operations). A test-side **catalog** (`SensitiveAccessCatalog`) classifies each endpoint: `Gated(idSource)` (resource by id), `List(countField?)`, `Aggregate`, `Write(idSource)`, `Neutral(reason)` (no matter data, with a one-line justification). **An endpoint not in the catalog fails the build** (same idea as `db/report-access.json` and the permission catalog), so new endpoints cannot ship unreviewed.
2. For each endpoint x persona the harness issues the request with ids from the universe and asserts the expected outcome from an access matrix table (data, not code): P1/P2: S1 yes, S2 no, S3 no; P3: only its task; P4: all; P5/P6: none.
3. Assertions per kind: `Gated` hidden -> 404 and body equals the 404 of a nonexistent id; visible -> 2xx. `List` -> no sentinel string and no hidden id anywhere in the JSON; `Aggregate` -> value equals the same aggregate recomputed over the visible list (count parity); `Write` hidden -> 404 and no row changed (re-read as P4); write bodies containing hidden ids -> not-found validation.
4. Response sweep: the harness scans every response (all personas, all endpoints, including 4xx problem details, headers and CSV) for sentinel strings of rows the persona must not see.
5. Mutation tests (access ends immediately): remove a manager, reassign a task, revoke the permission from a role, flip `IsSensitive` on and off; the very next request changes (no cache lag); notifications and unread counts follow.
6. Id enumeration: 404 of hidden vs missing is identical (status, body, headers, length).
7. Batch endpoints: mixed hidden/visible ids give per-item generic results.

### 12.3 Parity and static tests
- C# predicate vs SQL function: a generated matrix of (sensitive?, manager slot, assignee, SeeAll) rows, both evaluated, results equal.
- Architecture tests: (a) no `Set<Matter>/Set<WorkTask>/Set<Project>/Set<Asset>` outside the allow-list; (b) every `.sql`/inline SQL string touching `dbo.Matter|Task|Project|Asset|AuditEvent|Notification` either calls the visibility function or is on the allow-list with a reason; (c) every `IAuditScoped` entity under a matter sets `AuditMatterId`; (d) `IgnoreQueryFilters` only in the allow-listed file; (e) modules still only reference SharedKernel and `.Contracts`.
- Cache tests: dashboard cache returns different results for P4 and P5 within 60 s.

### 12.4 Frontend
Vitest/unit for stores and pickers (cleared on user change); Playwright e2e per persona that walks lists, search, task page, notifications and then scans DOM, `localStorage`, `sessionStorage`, IndexedDB, network responses and `document.title` for sentinels; a hidden deep link shows the generic 404 page.

### 12.5 Performance
Seed 200 matters / 20,000 open tasks with 10% sensitive; compare the heaviest reads (Task Queue, Dashboard summary, My Matters, Search, Audit events) before/after; budget: p95 not worse than +15%. Use the existing `tools/perf` approach. The functions are inline TVFs so the optimiser expands them; no scalar functions in hot paths.

## 13. Threat model

| # | Threat | Control | Residual |
|---|---|---|---|
| T1 | Direct id guessing / enumeration | 404 identical to missing; visibility before validation | none expected |
| T2 | Leak through aggregates (counts, totals, facets, workload) | counts from visible sources, parity tests | assignee load shown by the ranker, see Q5 |
| T3 | Leak through free text (notifications, audit text, error messages, titles) | creation-time and read-time checks; neutral display lookup | text stored before a matter was marked sensitive (see Q4) |
| T4 | Forgotten read path / new endpoint | single source + safety-net filter + catalog test fails for unclassified endpoints + architecture tests | a raw SQL string not matched by the static scan: reviewed in the inventory |
| T5 | Stale access (cache, token claims) | zero-lifetime permission lookup, viewer-partitioned caches, mutation tests | |
| T6 | Number/name uniqueness oracle (creating matter number N for a client returns "in use") | conflict text generic; cannot be removed without losing the uniqueness rule | accepted: reveals that a number exists, not what it is (Q6) |
| T7 | Privilege path by administrators (Audit.View, Report.Manage, Roles) | audit hidden by rule; role admin can grant `Matter.ViewSensitive` (audited); **reports not decided** (T8) | an admin who edits roles can give themselves access, as in any role system; the grant is audited |
| T8 | Reports read raw tables | **open decision, section 15** | |
| T9 | Assignee widening access by reassigning (Task.Assign) | allowed (they see the task) and audited; reassigned person gains task-only access | Q7 |
| T10 | Timing difference between hidden and missing | same code path (load through filtered source, then 404); no cache warmness difference | small residual |
| T11 | Frontend caches / history | checklist section 11, e2e scan | browser history of an earlier user on a shared PC: cleared on sign-out |
| T12 | Export/CSV and Reports downloads | exports reuse the filtered read path | Reports: T8 |
| T13 | Unmarking exposes history | restrict un-marking (Q3); optional stamp (Q4) | |
| T14 | Insider with DB access | out of scope (database permissions, not application) | |

## 14. Migration of existing sensitive matters

On deploy every matter already flagged `IsSensitive` becomes restricted at once. Required before enabling in production:
1. A read-only report (a SQL script in `docs/runbook` plus a `tools` helper, not an automatic change) lists each sensitive matter with its managers, number of assigned people, and whether it has no manager. Matters with no manager are visible to `Matter.ViewSensitive` holders only; the owner decides who gets manager assignments before go-live.
2. Grant script gives `Matter.ViewSensitive` to Director and System Administrator.
3. Optional feature switch `Features:SensitiveMatterAccess` (default on in Development/Test, set by the owner for production at go-live) so the code can ship before the data is prepared; when off, behaviour is exactly today's. The switch is read in one place (the port) and the test suite runs with it on.
4. Release note and a message to users who will lose sight of matters; open tasks assigned to people remain reachable through My Work.
5. Rollback: switch off, no data change.

## 15. Reports (epic #671): NOT decided, do not design here

Open decision to settle during the Reports work (phase-19). Options only: (1) **filtered views for reports** (reports read `rv.*` views that apply the rule per run user), or (2) **trusted report roles** (only trusted roles run reports and see everything; the existing addendum AI item 6 "option A" says exactly that: reports are not filtered).

Note that AI item 6 predates this rule; the owner must confirm it still stands. Exact interaction risks, whichever option is chosen:
1. Reports run as the SQL login `mf_report_reader`, not as the user; the app's visibility port never sees the query, so rule enforcement for reports cannot come from the C# layer.
2. The allow-list grants SELECT on `Matter`, `Task`, `Project`, `Asset`, `Client`, custom field tables: a report can return every sensitive matter's number, name, custom fields, task titles and descriptions.
3. Starter and admin-written SQL may join to sensitive data without the author noticing; the SELECT-only parser is not a control.
4. **Preview** (first 20 rows) is available to `Report.Manage` holders and shows real rows: an administrator without `Matter.ViewSensitive` can read sensitive data in a preview.
5. Parameter choice queries (`/reports/{id}/choices/{parameter}`, `choices/test`) build pickers from tables: matter/task pickers would list hidden matters.
6. Result pages (`runs/{id}/rows`), CSV export (current filtered/sorted rows) and the stored result carry the data out of the app; saved views and run history keep parameters (they may contain matter references).
7. Run audit records parameters and row counts; it must not reveal that a sensitive matter exists to a viewer without access.
8. Report assignment by role (`Report.Assign`) gives sensitive access indirectly to any role assigned a report; the access matrix and role screens would need to say so.
9. If views with row filtering are chosen, the per-run user must be passed to SQL (for example `SESSION_CONTEXT`) and the new functions/views need `report-access.json` handling; if trusted roles are chosen, the roles that run reports must be told they see everything, and `Matter.ViewSensitive` should be a prerequisite for roles holding `Report.Run`.
10. Counts in report results are unaffected by the app's counts and will differ from screens (explainable only if the owner picks trusted roles).

Interim state until decided: reports behave as today (option A) and this is recorded in the AJ addendum and on the epic. Tracking issue in the epic.

## 16. Read-path inventory

Modes: **M** matter rule, **T** task rule, **A** asset rule, **H** header only, **N** no matter data (verify only), **S** system/job (re-check per recipient). Test column: **W** = personas walk in the catalog suite (12.2), **C** = count parity, **X** = special test named. Current filter for all rows below is only the permission policy unless stated.

| ID | Endpoint / query | Current filter | How the rule applies | Test |
|---|---|---|---|---|
| R01 | `GET /clients` (list, any matter count field) | `Client.View` | client rows unchanged; matter counts via M | W,C |
| R02 | `GET /clients/{id}` | `Client.View` | unchanged (no matter data) | W |
| R03 | `GET /clients/{id}/summary` (matters, open tasks, "matters with most open tasks", strip) | `Client.View` | all matter/task aggregates through M/T sources | W,C |
| R04 | `GET /clients/custom-fields`, `/matters/custom-fields`, `/projects/custom-fields` | view perm | form definitions only | N |
| R05 | `POST/PUT /clients`, `PUT /clients/{id}/number` | edit perms | client-level; "has matters" integrity check uses unfiltered truth, response generic | W |
| R06 | `GET /matters` (list, filters, sort, paging, `isSensitive` filter, manager columns) | `Matter.View` | M on the base query | W,C |
| R07 | `GET /matters/lookup` (pickers) | `Matter.View` | M | W |
| R08 | `GET /matters/{id}`, `/matters/{id}/summary` | `Matter.View` | M, else 404 | W |
| R09 | `POST /matters` | `Matter.Create` | creator rule (section 9); number-conflict text generic | W,X |
| R10 | `PUT /matters/{id}`, `/number`, `/active`, `/managers` | edit perms | load through M, 404; sensitivity change audited, un-mark rule | W,X |
| R11 | `GET /projects`, `/projects/{id}`, `/summary` | `Project.View` | M via matter | W,C |
| R12 | `POST/PUT /projects`, `/projects/{id}/active` | project perms | M on the matter id (body and path) | W |
| R13 | `IMatterDirectory`, `IProjectDirectory` (Organization.Contracts, used by Audit display, Tasks, Assets) | none | the port's sources; callers decide mode; display lookups return neutral label if hidden | X |
| R14 | `GET /tasks` (list, filters, counts) | `Task.View` | T | W,C |
| R15 | `GET /tasks/{id}`, `/completion`, `/workflow` | `Task.View` | T; matter header mode H when matter hidden | W |
| R16 | `POST /tasks` | `Task.Create` | M on `matterId` (an assignee-only user cannot create siblings) | W |
| R17 | `PUT /tasks/{id}`, `/assignment`, `/priority`, `/status`, `/complete`, `/cancel`, `/reopen` | per-action perms | load via T, 404 if hidden; assignee may act on own task | W,X |
| R18 | `POST /tasks/assign-batch` | `Task.Assign` | per-item T, generic `NOT_FOUND` result | W,X |
| R19 | `POST /matters/{id}/tasks/bulk` (bulk reassign / re-prioritise) | `Task.Assign\|Task.SetPriority` | M on matter, then per-task result; hidden tasks "not found" | W,X |
| R20 | `POST /tasks/{id}/workflow/steps/*` (start, values, complete, skip, reopen) | `Workflow.Execute` / `StepReopen` | T | W |
| R21 | `GET/POST/PUT/DELETE /tasks/{id}/comments`, `/revisions` | `Task.View`, `Task.Comment` | T on parent | W |
| R22 | `GET/POST/PUT/DELETE /tasks/{id}/assets` | `Task.View`, `Asset.Link` | T on task; asset id in body checked with A | W |
| R23 | `GET /tasks/{id}/activity` | `Task.View` | T; assignee-only sees events with that `TaskId` only | W,X |
| R24 | `GET /assets` (list), `/assets/lookup` | `Asset.View` | A | W,C |
| R25 | `GET /assets/{id}`, `/assets/{id}/linked-tasks` | `Asset.View` | A; linked tasks through T | W |
| R26 | `POST/PUT /assets`, `/assets/{id}/active` | asset perms | M on matter (assignee cannot create assets) | W |
| R27 | `GET /asset-types`, `/asset-types/{id}` and similar config reads with "in use" counts | view perm | counts via A/T; guard text per section 6 | W,C |
| R28 | `GET /search` (5 types, suggestions) | any view perm | per type M/M/T/A, clients unchanged | W,C |
| R29 | `GET /search/advanced` (+ sensitive filter, counts, paging) | any view perm | same service | W,C |
| R30 | `GET /task-queue` | `Task.View` | T | W,C |
| R31 | `GET /my-work` | `Task.View` | T (own tasks always T) | W,C |
| R32 | `GET /pod-work` | `Task.View`+`Pod.View` | T; pod member load excludes hidden | W,C |
| R33 | `GET /dashboard` (summary, KPIs, breakdowns, unassigned) | `Dashboard.*` | T/M sources; cache key by viewer class | W,C,X |
| R34 | `GET /dashboard/scopes` | `Dashboard.*` | counts per scope via visible sources | W,C |
| R35 | `GET /dashboard/trend` | `Dashboard.ViewTrends` | T; cached | W,C |
| R36 | `GET /dashboard/swimlane` | `Dashboard.ViewSwimlane` | T/M (`MatterIsSensitive` only on visible) | W,C |
| R37 | `GET /dashboard/workload` | `Dashboard.ViewUsers` | per-user load over visible tasks | W,C |
| R38 | `GET /dashboard/coverage` | `Dashboard.ViewCoverage` | T | W,C |
| R39 | `GET /my-matters/summary`, `/health`, `/attention`, `/deadlines`, `/workload` | `Task.View` + `Matter.BeManager\|AssignManagers` | base set = visible matters (scope all = M, not "all rows") | W,C |
| R40 | `GET /my-matters/activity`, `POST /activity/seen` (`MyMattersActivityService`) | same | M on `AuditEvent.MatterId`, seen marker only for visible | W,X |
| R41 | `GET /users/lookup` (assignee ranker, open counts, suggestion reasons) | lookup perms | open-task counts computed over visible tasks of the viewer; ranker internals see true load (Q5) | W,C,X |
| R42 | `GET /users`, `/users/counts`, `/users/{id}` (open task counts, if any) | `User.View` | counts via T | W,C |
| R43 | `GET /users/matter-managers` | `Matter.AssignManagers`/Create/Edit | user list only (N); no matter data; verify | N |
| R44 | `GET /pods`, `/pods/{id}`, `/me/pods`, `/users/{id}/pods`, `member-candidates` | pod perms | member lists; any task/load number via T | W |
| R45 | `IAssigneeLoadReader`, `IUserWorkSource`, `IAssigneeRanker` (Identity.Contracts, implemented over tasks) | internal | called with Viewer; counts filtered; ranking policy Q5 | X |
| R46 | `GET /me`, `/me/availability`, `/users/{id}/availability` | auth | N (availability has no matter data) | N |
| R47 | `GET /me/notifications`, `/poll`, unread count | `Notification.View` | filter `MatterId/TaskId` by current visibility | W,X |
| R48 | `POST /me/notifications/{id}/read`, `/read-all` | same | hidden rows are not touched; count of changed rows from visible only | W,X |
| R49 | `GET/PUT /me/notification-preferences` | same | N | N |
| R50 | Notification producers (task assigned, manager set, comments, status events) | domain code | recipient visibility check at creation (S) | X |
| R51 | `TaskDueJob`, `TaskStalledJob` scheduler SQL (`dbo.Task` join `dbo.Matter` join managers) | system | candidate scan as system, per-recipient insert joined to `fnTaskVisible` | X,S |
| R52 | `NotificationRetentionJob` | system | age-based delete, no filter | N |
| R53 | `GET /audit/events` | `Audit.View` | M on `MatterId`, T on `TaskId`; no sentinel in values | W,C |
| R54 | `GET /audit/search`, `/audit/facets` (facet values and counts) | `Audit.View` | same service predicate; facets recomputed over visible | W,C |
| R55 | `IAuditReader` (Audit.Contracts; used by task activity, My Matters) | internal | takes Viewer, same predicate | X |
| R56 | `IAuditDisplayLookup` (`AuditDisplayLookup` in Api/Http) | internal | neutral label when hidden | X |
| R57 | Audit writer | system | unfiltered by design (writes only); stamp optional | N |
| R58 | `POST /reports/{id}/runs`, `GET runs/{runId}/rows`, `DELETE runs/*`, CSV | `Report.Run` | **undecided** (section 15) | open |
| R59 | `POST /reports/{id}/choices/{parameter}` and admin `choices/test`, `preview`, `analyze`, schema browser | Report.Run / Manage | **undecided** (section 15) | open |
| R60 | Reports admin CRUD (`report-admin/*`), role assignment | Report.Manage / Assign | N (definitions) except preview, run history parameters | open |
| R61 | `POST /intake/parse-email*` | intake perm | confirm no matter lookup or suggestion (N) | N |
| R62 | `SystemController` (version, health) | none | N | N |
| R63 | Configuration reads with "in use" counts (task types, priorities, status labels, forms; `ConfigurationTaskCounts`) | admin perms | display via visible counts; integrity guard unfiltered, text generic | W,C |
| R64 | Roles/Permissions `GET /roles`, `/permissions` | `Role.Manage` | `Matter.ViewSensitive` listed; role user counts N | W |
| R65 | `DashboardCache`, My Matters cache | in-memory | key partition by viewer class | X |
| R66 | Workflow engine API (`WorkflowControllers`) | `Workflow.Manage` | definitions only; any "tasks using" counts via T | N,C |
| R67 | Frontend: lookup-store, recent items/searches, route titles, breadcrumbs, exports | client | section 11 checklist | e2e |
| R68 | `tools/seed-demo`, `tools/perf` | dev tools | create sensitive sample data and personas | N |

**Count: 68 rows** (about 150 endpoint operations; the catalog test enumerates operations, not rows). Unclassified endpoints fail the catalog test, so this table is a starting point, not the final authority: the first work package that touches a module re-greps for `dbo.Matter`, `dbo.Task`, `Set<Matter>`, `Set<WorkTask>`, `Set<Asset>`, `Set<Project>`, `AuditEvent`, `Notification` and updates the row.

## 17. Open questions for the owner (recommended answers)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Does a task assignee keep access after the task is completed/cancelled? | Yes while they are still the assignee (history stays reachable); access ends on reassignment only |
| Q2 | Does the assignee see the matter name in the task header? | Yes, minimal header (ref, name, client) so they can identify the work; no link to the matter |
| Q3 | Who may un-mark a sensitive matter? | Only `Matter.ViewSensitive` holders and the matter's managers; any `Matter.Edit` holder who can see it may mark |
| Q4 | Audit rows written while sensitive: stay restricted after un-marking? | Yes, via the optional `IsSensitiveScope` stamp |
| Q5 | Workload/ranker: show true load (includes hidden tasks) or visible load? | Ranker orders by true load but shows only visible counts, since hiding load makes busy people look free; owner to confirm |
| Q6 | Number/name conflict oracle accepted? | Accept (generic text) |
| Q7 | May a non-manager assignee reassign their sensitive task to someone else (grants that person access)? | Yes if they hold `Task.Assign`; audited |
| Q8 | Reports: filtered views or trusted report roles? | Settle in the Reports work; until then option A (AI item 6) |
| Q9 | Feature switch for staged go-live? | Yes (section 14) |
| Q10 | A sensitive matter's client page: should client name itself stay visible to everybody with `Client.View`? | Yes (clients are not sensitive today) |
