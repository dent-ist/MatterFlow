# Project Manager experience: review and specification

> **Update 2026-10-26 (owner decision, addendum AK item 16, #826):** Workload and capacity is removed from the Project Manager UI. The My Matters tabs are **Overview, Deadlines, Trends, Activity**; the Overview has no Workload panel and no Workload skip link; `?tab=workload` opens Overview. The Workload parts of this document (panel, tab, section 6.3, issues #696, #766, #779) are **superseded** and kept only as history. `GET /my-matters/workload` stays in the backend and is not used by the UI. Recent activity on the Overview shows five events with "View all activity" (#827).

Date 2026-10-23, base `origin/dev`. Epic #758 (children #759 to #787). Extends epic #667 (Project Manager role and My Matters, built: `docs/ux/pm-review/`); nothing from #667 is rebuilt here. Decisions: `docs/requirements/decisions-addendum.md` section AK. Plan: `delivery-plan.md`.

Method: code and docs read against `origin/dev`; no build, no running product (a review with screenshots runs after the build, issue #787).

## 0. Binding owner decisions

1. "Projects" means **Matters**. PMs are assigned to Matters, not to the Projects entity. The UI keeps the word **Matter**.
2. **My matters is the default scope everywhere** for people holding `Matter.BeManager`: Matters list, Task Queue, Assets, Clients and Projects lists open scoped to matters they manage, with a visible, remembered **My matters / All** switch. **All** only for holders of `Matter.AssignManagers` (the permission that can already change managers). **Search stays global**; results outside the PM's matters carry a small label.
3. **Shorter menu**: My Matters (landing), Matters, Tasks, Assets (of my matters), Reports (when epic #671 exists), search. No Pod Work, no department Dashboard, no everyone's-tasks view.
4. The Dashboard is hidden from the Project Manager role **through permissions** (still configurable). My Matters therefore gains the monitoring views: tabs **Overview, Deadlines, Trends, Activity** (Workload removed 2026-10-26), and a **Since your last visit** summary on Overview.
5. The matter record **Overview tab is enriched** (reverses the earlier "no per-matter dashboards" decision; addendum AK item 5).
6. Quick actions per matter: + New task (exists), bulk re-assign / re-prioritise (exists), add a comment, open the matter's tasks. Starter Reports for the role: tables, CSV only, no status report, no email.
7. Primary and Secondary identical. A matter with no manager is normal (no warning, no red flag). **No new or changed keyboard shortcuts** (#420). Initial bundle under 700 kB (about 614 kB now): new pages and tabs are lazy.
8. **Sensitive matters** are a separate epic (`Matter.ViewSensitive`; visible to Primary/Secondary PMs, holders of the permission and assignees of tasks on the matter). This document does not design it. **Every new PM view, filter and endpoint below goes through the shared matter-visibility rule that epic defines** (implemented once, issue #760).

## 1. What exists (do not duplicate)

| Fact | Where | Consequence |
|---|---|---|
| My Matters at `/my-matters`: strip, panels Needs attention, Health, Workload, Deadlines, Activity; `scope=mine|all`, role, client, dates | `features/my-matters/*`, `MyMattersController`, `docs/ux/pm-review/my-matters-api.md` | Becomes the **Overview** tab; panels stay |
| Landing: `landsOnMyMatters` (needs `Matter.BeManager`, `Matter.View`, `Task.View`; System Admin lands there only if explicitly PM) | `core/auth/guards.ts` | Reused for the compact menu rule |
| Menu: `NAV_ITEMS` with `permissions` / `permissionsAll`; My Matters sits above My Work | `shared/layout/nav-items.ts` | Add a "compact for PMs" rule, no role-name check |
| `managedByMe`, `managerId`, `role` on the Matters list and the Task Queue; `MyMattersScope` in WorkViews | `MatterService`, `TaskQueueService`, `MyMattersScope.cs` | Three implementations: unify in #760 |
| Assets list filters by one `matterId` only; Clients list has no matter filter; Projects list has `matterId` | `AssetDtos.cs`, `OrganizationSupport.cs` | Missing "any matter I manage" filters: #761, #762 |
| Matter record tabs Overview / Tasks / Projects / Assets, `mf-summary-strip`, header `mf-matter-health-strip` | `matter-detail-page.ts` | Overview is a thin details list: enrich (#782) |
| Starter role "Project Manager" holds `Dashboard.View`, `ViewSummary`, `ViewSwimlane`, `Matter.BeManager`, `Matter.AssignManagers` | `StarterRoles.cs` | Remove Dashboard codes (#764) |
| Matter-level comments do not exist; task comments do | schema, `TaskLifecycleService` | "Add a comment" posts to a task of the matter (Q4) |
| Performance harness and indexes for My Matters (script 33) | `docs/ux/pm-review/performance.md` | New reads reuse them; #770 extended the budget (section "Epic #758 additions") |

## 2. The PM's day, and what is missing today

| Question the PM asks | Today | Gap |
|---|---|---|
| What changed since I last looked? | Activity panel with unread marker | No summary at the top; 7 days only; no filters |
| What is due in the next weeks, by matter? | Deadlines panel (25 rows, 14/28 days) | No grouping by matter, no calendar |
| Who is overloaded or away? | (no longer answered for Project Managers, #826) Workload panel | No away window, no per-matter split |
| Is it getting better or worse? | Nothing (Dashboard trends are hidden from PMs) | Trends missing entirely |
| Everything about one matter | Header strip + thin Overview + Tasks tab | No deadlines, people, assets, activity, reasons on one screen |
| Only my stuff | Matters list and Task Queue offer filters; Assets, Clients, Projects open unscoped | A PM drowns in other matters' data |
| Where do I click? | 9 menu items incl. Dashboard, Pod Work, My Work | Menu not built for the role |

## 3. Scope rules (one rule, everywhere)

1. **Eligibility**: the switch exists only for people holding `Matter.BeManager`. Everyone else sees exactly what they see today (no switch, no change).
2. **Default**: `mine` for PMs. `all` is offered only with `Matter.AssignManagers` (check on server: `scope=all` without it answers 403 `PERMISSION_DENIED`; a stored `all` is ignored without the permission).
3. **Meaning of "mine"**: matters where I am Primary **or** Secondary (identical). Per list:
   - Matters: `managedByMe=true`. Task Queue: `managedByMe=true` (exists). Assets: `matterManagedByMe=true` (new). Projects: `matterManagedByMe=true` (new). Clients: clients with at least one matter I manage, `matterManagedByMe=true` (new).
4. **Remembered**: per page key and per person in `localStorage` (try/catch, page works without it). **The address wins**: a link with explicit filters (strip cell, notification, report) never gets the remembered scope added. `?scope=mine|all` is in the URL so Back restores it.
5. **Visible**: toggle group "My matters | All" in the header context line, a count ("14 of 212 matters"), and chip text when scoped. Text states the scope, colour is never the signal.
6. **Not access control**: opening a record outside the scope by link works (`Matter.View` is not row-secured); the **Sensitive matters** epic is the only thing that hides rows, through one shared visibility rule that every endpoint here calls (#760).
7. **Search is global**; results outside my matters get a small muted text label "Other matter" (null/absent for people without `Matter.BeManager`).
8. A PM with no matters: empty state "You do not manage any matter yet." plus, with the permission, "Show all matters".

### 3.1 Scoped list header (mock-up, 1366 px, Assets)

```
Assets                                           [ + New asset ]
Assets of matters you manage  (63 of 1,204)      Scope [ My matters | All ]
Name [____]  Type [All v]  Ref [____]            Matter-scoped by: Acme Merger +13  [Clear]
------------------------------------------------------------------------------
 Name            Type        Matter                 Ref        Active
 Custodian_01    Laptop      90001-80001 Acme       EXT-118    Yes
 ...
```
Phone 375 px: the switch is a full-width two-button group under the title; the count line wraps; filters stay in the existing filter sheet.

## 4. Menu for the Project Manager

Rule: `compactMenu = landsOnMyMatters(store)` (permissions, not a role name). A System Admin who does not land on My Matters keeps the full menu.

```
Before (9 items)              After (PM)
 Dashboard                     My Matters      <- landing
 My Matters                    Matters
 My Work                       Tasks           (Task Queue)
 Task Queue                    Assets
 Pod Work                      Reports         (when #671 is on dev, Report.Run)
 Clients                       More  >         Clients, Projects, My Work (collapsed, remembered)
 Matters                      [ search box in the header, unchanged ]
 Projects
 Assets
```
- Dashboard disappears by permission (starter role change), Pod Work by the compact rule (PM may still open it by address if granted; it is just not offered).
- "More" keeps every route reachable without a role-name check and without losing My Work for a PM who also does tasks (Q3).
- Phone overlay and collapsed rail show the same list. The go-to sequences (`g` then letter) are untouched (#420).

## 5. Permissions and starter-role changes

| Change | Detail |
|---|---|
| Starter "Project Manager" loses `Dashboard.View`, `Dashboard.ViewSummary`, `Dashboard.ViewSwimlane` | New idempotent data script; applied to an existing role only if it still equals the old starter definition; admins can grant them back |
| No new permission code | Scope switch uses `Matter.AssignManagers` (owner), tabs use `Matter.BeManager` + `Task.View` as today |
| Report grants | The two starter reports are assigned to the role by the Reports mechanism (#784) |
| Conflict to settle | Addendum AG-14 gave the PM role `Matter.AssignManagers` by default, so every starter PM sees the **All** switch. That matches the wording "All for holders of the permission" but means "All" is not rare. See Q1 |

## 6. My Matters: five tabs

Route `/my-matters` keeps the page header, the filter bar (client, role, dates, scope) and the count strip of #667 above the tabs. Tab in `?tab=` (absent = overview). Each tab is a lazy component; filters are shared and live in the URL.

```
My Matters                                          Scope [My matters | All]
Client [All v] Role [Both v] Dates [Next 4 wk v]
| 14 matters | 212 open | 9 overdue | 17 due 3d | 41 due 7d | 6 unassigned | 3 on hold |
[ Overview ] [ Deadlines ] [ Trends ] [ Activity ]
```

### 6.1 Overview (current page + summary)

```
Since your last visit (Mon 19 Oct 09:12)                         [ Mark as read ]
  4 tasks became overdue - 2 reassigned - 7 completed - 3 comments - 1 put on hold
  Dana moved "Privilege log" to On hold (Acme)  - Priya commented on "Review batch 4" ...
-------------------------------------------------------------------------------
Needs my attention | Upcoming deadlines | Matter health | Recent activity (5 events + View all activity)
```
Empty: "Nothing has changed since your last visit." Opening the page does not move the marker, only Mark as read does (as today).

### 6.2 Deadlines

```
Deadlines   Range [2 weeks | 4 weeks]   View [List | Calendar]
List by matter                               Calendar (week rows)
 Acme Merger (5)                              Mon26 Tue27 Wed28 Thu29 Fri30
  Mon 26  Review batch 4      Alex               3     1     .     2     4
  Tue 27  Privilege log       Priya             [Review batch 4] [Priv.. ]  +1 more
 Smith v Jones (2) ...                         (day count = link to filtered Task Queue)
```
Phone: calendar becomes the grouped list. Weekends muted, today marked by text "Today".

### 6.3 Workload (REMOVED 2026-10-26, #826; kept as history)

```
Workload   (open work on my matters, per person)
 Pod / person        Open  Overdue  Wk  Hold   Away
 Processing Pod        64     5     12    3
   Alex Kim            14     2      4    0
   Priya Rao            9     0      3    1    Away 26 Oct to 30 Oct
 Review Pod            40     1      8    0
   [> top matters: Acme 6, Roe 3 ...]
```
Away is a text badge with dates; no free-text reason. Away people holding overdue work sort first inside their pod (a sort, not a verdict).

### 6.4 Trends

```
Trends   Range [8 | 12 | 26 weeks]
Overdue at week end       Created vs closed per week      Average task age      On hold
 /\_/\__/\                 ||  |||  ||  |||                 9.4 days  (~)        3 now, oldest 12 d
 (Show as table)           (Show as table)
How is this counted?
```
Definitions: week Monday to Sunday in the viewer's zone. *Created* = `CreatedAt`; *closed* = completed; *overdue at week end* = open at that moment with a due date before it, derived from `DueDate` and completion time (limitation: a task re-dated or re-opened is counted by its current dates; stated on screen); *average age* = now minus `CreatedAt` of open tasks; *on hold* from status-change audit events. A nightly snapshot table is the fallback only if measurement fails (#770). Every chart has a text summary and a "Show as table" alternative; no colour-only meaning; no chart library unless one is already in the bundle; the tab chunk is lazy.

### 6.5 Activity

```
Activity   Matter [All v]  Kind [All v]            [ Mark all as read ]
 -- Since your last visit ------------------------------------------------
 New  09:42 Dana moved "Privilege log" to On hold          Acme
 New  09:10 New task "QC sample"                           Acme
 -- Earlier --------------------------------------------------------------
      Yest. Priya commented on "Review batch 4"           Smith   (no text shown)
                                                          [ Load more ]
```
30 days, cursor paging. "New" is text, not colour only.

## 7. Matter record: enriched Overview

```
Matter 90001-80001 Acme Merger     [Red] reasons: 4 overdue, 1 unassigned    PM: Dana R. / Lee K.
[ Overview ] [ Tasks ] [ Projects ] [ Assets ]            [ + New task ] [ More actions v ]
Tasks by status                       Next five deadlines
 New 4 | In progress 21 | On hold 3    Mon 26  Review batch 4      Alex
 Completed (30 d) 12                   Tue 27  Privilege log       Priya   ...
Who is working on it                  Linked assets (14)   Recent activity (10)
 Alex Kim  14 open 2 overdue           Custodian_01 ...     09:42 Dana ... On hold
 Priya Rao  9 open  Away to 30 Oct     [Open Assets tab]    [Open activity]
Details (client, status, sensitive, dates, custom fields, as today)
```
Health reasons are words first ("4 overdue tasks"), colour second. No warning for a missing manager. Sections for which the person lacks the permission are absent. One call (`GET /matters/{id}/overview`, #769). Quick actions menu: + New task, Bulk re-assign / re-prioritise (opens Tasks tab in selection mode), Add comment (choose one of the matter's open tasks, then write), Open the matter's tasks. The same menu is a row action on My Matters health rows and the Matters list. Notifications of epic #753 for PM events link to the matter or task; #783 proves it per event.

## 8. Backend: filters, endpoints and performance

| Change | Issue | Performance note |
|---|---|---|
| Shared scope service + visibility seam | #760 | Resolves managed matter ids from the two filtered indexes (`IX_Matter_PrimaryManager`, `IX_Matter_SecondaryManager`); used as semi-join, never as a big `IN` list in application code |
| `GET /assets?matterManagedByMe=&role=` | #761 | `Asset.MatterId` has an index; semi-join; budget p95 under 300 ms at 100,000 assets |
| `GET /clients` and `/projects` `?matterManagedByMe=&role=` | #762 | `EXISTS` on matters of the client; distinct, correct totals |
| Search result `inMyMatters` | #763 | Same round trip; no N+1; search p95 not worse by more than 10 percent |
| Deadlines `groupBy=day|matter` | #765 | Extends the covering `IX_Task_Matter` of script 33 |
| Workload with away windows and matter split | #766 | `IUserAvailabilityReader` in one batch |
| `GET /my-matters/trends` | #767 | Only history in the epic; derive first, snapshot `dbo.MatterDailyStats` only if p95 over 500 ms |
| Activity 30 days, filters, `GET /my-matters/since-last-visit` | #768 | Clustered range on audit id (as measured in `performance.md`); no new table |
| `GET /matters/{id}/overview` | #769 | One round trip, constant statements |
| Budget and plans | #770 | Extends `MyMattersPerformanceTests` (200 matters, 24,000 tasks, 100,000 audit events, 100,000 assets) |

All additive, `/api/v1`, OpenAPI and nswag regenerated (CI drift check). Every endpoint calls the shared visibility rule (#760); a sensitive matter the caller may not see is absent from lists and counts and answers 404 on direct access.

## 9. Accessibility and phone layouts

- Scope switch: toggle group with `aria-pressed`, polite live region on change, 44 px targets on touch.
- Tabs: shared `mf-tabs` pattern (tab, tabpanel, `aria-labelledby`), focus back to the tab on Back; tab strip scrolls inside itself on 375 px, never the page.
- Charts: text summary + "Show as table", patterns/labels not colour alone, dark mode via tokens, reduced motion respected.
- Calendar: a grid of links in tab order; no arrow-key grid and no new shortcuts. Below 480 px it is the grouped list.
- Row action menu: button + menu, focus returns to the button.
- Four widths on every new screen: 1920x1080, 1366x768, 768x1024, 375x812; axe 0; no horizontal page scroll. Phone: single column, panels stack, tables become cards where #700 did so already.
- Initial bundle under 700 kB: tabs and charts are separate lazy chunks; the build reports each chunk (#785).

## 10. Findings and risks (ranked)

1. **Three copies of "managed by me"** (Matters, Task Queue, My Matters) will become six with the new filters and are the place a sensitive-matter leak would hide. One seam first (#760).
2. **Trends needs history the schema does not keep.** Derivation from `CreatedAt`, `DueDate`, completion and audit events is possible but approximate; a snapshot table is the fallback. Decide by measurement (#770), state the limitation on screen.
3. **PM starter role holds `Matter.AssignManagers`**, so "All" is available to every starter PM (Q1).
4. **Clients "mine" is indirect** (via matters): totals and duplicates need care (#762).
5. **Remembered scope vs links**: an explicit address must win or counts stop equalling lists.
6. **Bundle**: 614 kB of 700 kB; five tabs and charts must stay lazy.
7. **Menu without role names**: a data rule keyed on the landing test; a PM with Dashboard granted back still lands on My Matters.

## 10a. Fixtures (PX-01, #759, built)

Backend integration fixture `backend/tests/MatterFlow.IntegrationTests/Fixtures/PmScopeFixture.cs` (extends the epic #667 data in `docs/ux/pm-review/fixtures.md`, nothing there is redone). `PmScopeFixture.BuildAsync(factory)` builds, through the public API (managers through `PUT /matters/{id}/managers`, so the audit trail is real), on a fresh test database:

| Person | Role | Manages |
|---|---|---|
| `PmFew` | PM (Matter.BeManager + view permissions, no AssignManagers) | exactly 3 matters: `few1` (Primary), `few2` (Secondary), `few3` (Primary, PmOther Secondary) |
| `PmMany` | PM | exactly 40 matters `many01` to `many40` (Primary; every fifth has PmOther as Secondary) |
| `PmNone` | PM | nothing (empty scope) |
| `PmOther` | PM | `few2` (Primary), `primaryOnly`, `secondaryOnly` (Secondary, no Primary), `sensitiveManaged`, `sensitiveOther` (Secondary), Secondary of 8 `many` matters |
| `PmNoTaskView` | Matter.View + BeManager + AssignManagers, no Task.View | nothing (403 on My Matters) |
| `Director` | Matter.AssignManagers, cannot be named | nothing (may use scope=all) |
| `Technician` | work permissions, no manager permission | assignee of the tasks on `none1` and `sensitiveManaged` |

Matters without a manager: `none1`, `none2` (normal, nothing flagged) and `sensitiveOpen` (sensitive-ready). Sensitive-ready matters (the `IsSensitive` flag is set; with `Features:SensitiveMatterAccess` off the product ignores it): `sensitiveManaged` (Primary PmOther, task assigned to the technician), `sensitiveOpen` (no manager), `sensitiveOther` (Secondary PmOther only). Clients: `Managed` (matters of PmFew and PmOther), `Mixed` (matters of PmMany, PmOther and unmanaged ones), `Unmanaged` (no matter any PM manages). Every matter has a project; `few1`, `few2`, `many01`, `many02`, `primaryOnly`, `none1` and `sensitiveManaged` have two assets; `few1`, `many01`, `primaryOnly`, `none1` and `sensitiveManaged` have one task. `ManagedKeys(userId, role)` gives the expected set for assertions. `PmScopeFixtureTests` pins today's answers of the Matters list, the Task Queue and My Matters on this data; they are the safety net of PX-02 (#760). The end-to-end side (`frontend/e2e/support/pm-fixtures.ts`) and the demo seeder (`tools/seed-demo`) are the frontend lane's; they can mirror this table.

## 10b. The scope seam (PX-02, #760, built)

"Matters managed by X" is resolved once: `IManagedMatterScope` (`MatterFlow.SharedKernel/Visibility`, implemented in Identity as `ManagedMatterScope`). `WhereManagedBy` (rows that are matters: Matters list, My Matters scope), `WhereMatterManagedBy` (rows that reference a matter: Task Queue now, Assets, Clients, Projects, search and the tabs next), `ManagedMatterIds`, `RequireAllScope` (scope=all or another person's matters need `Matter.AssignManagers`; 403 `PERMISSION_DENIED`, same shape as before) and `CurrentUserId`. The rule itself is `ManagedMatterRule.Predicate` (Primary, Secondary or either; a matter without a manager never matches). Every query built here passes through `IMatterVisibility.WhereMatterVisible`, which lets everything through until `Features:SensitiveMatterAccess` is switched on (epic #788); `ManagedScopeSeamTests` proves each managed-by endpoint calls it, and the architecture test `Managed_by_filters_go_through_the_shared_scope_and_so_through_the_visibility_hook` fails when anyone compares a manager column outside the seam. Responses and the OpenAPI document are unchanged. A new PM endpoint takes `IManagedMatterScope` and nothing else.

## 10c. Backend filters (PX-03 to PX-06, #761 to #764, built)

- **`matterManagedByMe` and `role`** on `GET /assets`, `/clients` and `/projects`: `matterManagedByMe=true` keeps the rows of the matters the caller manages (Primary or Secondary, identical); `role=primary|secondary|both` picks the place. `false` is the same as leaving it out; `role` without `matterManagedByMe=true`, an unknown `role` and unknown parameters are a 400 (`VALIDATION_FAILED` with `ROLE_NEEDS_MATTER_MANAGED_BY_ME` or `UNKNOWN_ROLE`), never ignored. The two parameters are parsed once, by `IManagedMatterScope.ResolveFilter`. Assets and projects are a semi-join on the managed matter ids (`WhereMatterManagedBy`); a client is "mine" when at least one of its matters, active or inactive, is (an `EXISTS`, so the client is one row and the total is right). A caller who manages nothing gets an empty list, not an error. Everything passes through the visibility seam (a sensitive matter the caller may not see is not in the scope). The "count of my matters in the client row" of #762 is not built (optional).
- **`inMyMatters`** on every search hit (`GET /search`, `GET /search/advanced`): true when the hit's matter (for a client: one of its matters) is managed by the caller, false when not, **null for a caller without `Matter.BeManager`**. The test is part of the projection over the paged rows of the same statement (an `IN` on the managed matter ids), so there is no extra round trip and no per-row query; search stays global and no hit is left out or moved.
- **Starter role** (`38-project-manager-no-dashboard.sql`, `StarterRoles`): the Project Manager role no longer holds `Dashboard.View`, `ViewSummary`, `ViewSwimlane`. The script removes them from a role named "Project Manager" only while its grants equal the old starter definition exactly (a customised, renamed or extended role is left alone), says what it did (the migration runner logs what a script `PRINT`s) and replaces the old description only while it is unchanged. An administrator can grant any tab back; nothing keys on the role name.

## 10d. Backend monitoring endpoints (PX-07 to PX-11, #765 to #769, built)

Deadlines `groupBy=day|matter`, workload with away windows and the matter split, activity with 30 days, filters, cursor paging and `GET /my-matters/since-last-visit`, `GET /my-matters/trends` and `GET /matters/{id}/overview` are specified in `docs/ux/pm-review/my-matters-api.md` ("Epic #758 additions"). Decisions made while building them: trends are derived from existing columns and answer with `approximate: true` and the list of `limitations` (no snapshot table); the overview returns `null` for a section the caller may not use and has no manager-warning field; the unread marker is moved only by `POST /my-matters/activity/seen`, never by a read.

## 11. Out of scope

Sensitive-matter design (separate epic), status report, Gantt, time or budget, email, scheduled reports, matter-level comments or notes (Q4), keyboard shortcuts (#420), new notification events (epic #753 owns them).

## 12. Open questions for the owner (recommended answer first)

1. **Who gets "All"?** AG-14 gave `Matter.AssignManagers` to the starter PM role, so every PM sees the switch. Recommend: keep (as decided in AG-14); tell customers to remove the permission from the role if PMs must stay strictly scoped. Alternative: a separate permission for "All" (+1.5 h).
2. **Trends accuracy.** Recommend: derive from existing columns, state the limitation on screen; snapshot table only if slow.
3. **"More" group for Clients, Projects, My Work.** Recommend: yes, collapsed; alternative is to drop them from the PM menu and rely on search and links.
4. **Add a comment** posts to a task of the matter (pick the task). Recommend: yes; a matter-level note would be a new entity and notification event.
5. **Since your last visit** uses the existing seen marker, advanced only by Mark as read. Recommend: yes.
6. **Reports menu item** only when #671 is built; before that it is absent. Recommend: yes.
7. **Pod Work** for a PM who also leads a pod: hidden from the compact menu, reachable by address. Recommend: accept; such a person can be given a non-PM landing.
8. **Review issue (#787)** at about 8 agent-hours runs after #786. Recommend: schedule right after the verification pass.
