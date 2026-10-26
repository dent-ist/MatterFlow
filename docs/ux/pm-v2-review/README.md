# PM v2: page-by-page review and design (epic #851)

Date 2026-10-26, base `origin/dev` at `325f203`. Extends `docs/ux/pm-experience/` (epic #758, #813 to #821 fixed; Workload removed, #826; Recent activity shows five rows, #827) and `docs/ux/pm-review/` (epic #667). Nothing from those is redone. Decisions: `docs/requirements/decisions-addendum.md` section AN. Plan: `delivery-plan.md`. Issues: epic #851 and its children (table in section 15).

**Nothing is implemented by this work.** It is a review, a design and a backlog.

## 0. Method

- **Walk.** Fresh publish of `dev` (frontend initial bundle 629.21 kB), one API on its own port with Dev authentication, own SQL Server 2022 container, `tools/seed-demo --seed 7` (50 users, 5 clients, 12 matters, 60 assets, 200 tasks). The person walked is the demo PM **`KE\testuser03` (Test User 03)**: manager (Primary or Secondary) of 5 of the 12 matters, 69 open tasks, 13 overdue, 9 on hold. The administrator pages were walked as `KE\kekim`. The e2e PM fixtures (`frontend/e2e/support/pm-fixtures.ts`, `docs/ux/pm-review/fixtures.md`) are reused for the test plans, not re-walked.
- **Sizes.** 1366x768, 1920x1080, 768x1024, 375x812, one screenshot per screen (`screenshots/<size>/<nn>-<screen>.png`, compressed; `...b-...-full` are full-page captures). The script is `walkthrough.mjs` (`BASE=... PM_USER=... node docs/ux/pm-v2-review/walkthrough.mjs`), the facts per shot (overflow in px, title, tabs, page height) are in `walkthrough.json`. No page overflowed sideways in any shot (all `overflowPx` are 0).
- **Thinking as a litigation (eDiscovery) project manager.** The PM's questions are: *which kind of work is late* (processing, review set-up, production, a vault request), *how much data do I hold and in what state* (GB per workspace, what is on hold, what waits for disposition), *what is blocked and why* (waiting for client data, waiting for approval), *what is about to slip* (before it is overdue) and *can I show this on a call without rebuilding it in a spreadsheet*. Today every screen answers "what is overdue" and none of the others.
- **Severity words.** major = the PM cannot do the job or loses minutes a day; minor = friction; nit = polish.

## 1. Summary

The product is calm and accessible for a PM, and the structure from epic #758 holds: one landing page, scoped lists, a record page per matter. What is missing is **the dimension a PM manages by: the task type and the data.**

1. **A task row says nothing about the kind of work.** The Task Queue shows a small grey type icon whose name is only a mouse `title` (no keyboard tooltip, the icon itself is `aria-hidden`); every My Matters list (Needs my attention, Upcoming deadlines, Since your last visit, Recent activity) shows none. The API item of those lists (`MyMattersTaskItem`) does not even carry the task type, the priority or the status. In the demo the title happens to start with the type name; real titles ("Review batch 4") do not.
2. **The sections cannot be sorted or filtered.** Each group is cut to 10 rows (deadlines 25) and "View all" leaves the page. Client-side sorting would sort the wrong ten rows, so sort and filter must be server-side.
3. **There is no cross-matter view by task type and no data view.** Nothing answers "how many Production tasks are open on my matters, per matter" or "how many GB do I hold and what is pending disposition". The Assets list has no size, the asset record has no disposition, the seeded number fields (`size_gb`, `volume_gb`, `capacity_gb`, `file_count`, `doc_count`, `page_count`) are **not indexed**: `dbo.CustomFieldIndex` holds **0** asset rows in the demo database because `IsFilterable` is off on all eight of them. Cheap aggregates need a rule change (section 9).
4. **On Hold has a reason, but only as a free-text comment** (required, stored with the status change; the Task Queue shows it truncated, "Blocked by the m..."). It cannot be listed, filtered or counted.
5. **Smaller things:** the Overview's first screen is spent on "Since your last visit" (106 reassigned, 104 new tasks in the demo) and Needs my attention starts below the fold at 1366x768; one task appears up to three times on the page (Overdue, Unassigned, Due soon/deadlines); all five matters are flagged Red, so the flag distinguishes nothing; three "new task" controls; the Matters list truncates names and clients while the Status column is wide; the Assets status filter is squeezed to "Act"; the bell shows 99+ unread "Overdue by n days" items one per task.

### Top recommendations (ranked by value over effort)

| Rank | Recommendation | Issues | Effort |
|---|---|---|---|
| 1 | Task type badge (icon, colour, name in tooltip and accessible name) in every task row; admin sets colour next to the existing icon | PV-01 to PV-04 | 17 h |
| 2 | Sort, multi-select type filter and **Focus** in every My Matters section, server-side, remembered per person | PV-05 to PV-08 | 19 h |
| 3 | **Breakdown** tab (matter x task type, open/overdue, clickable cells) | PV-09 to PV-11 | 17 h |
| 4 | **Disposition** field on every asset (Active, Inactive, Pending disposition, Disposed) and a designated **size** number field | PV-13 to PV-17 | 24.5 h |
| 5 | **Data** tab (counts and size per asset type, status, warnings) | PV-18, PV-19 | 15 h |
| 6 | On-hold reason from an admin list; "on hold for n days because ..." | PV-25, PV-26 | 12 h |
| 7 | Target turnaround and an **At risk** badge before overdue | PV-27 | 6 h |
| 8 | Asset report builder (table, then pie or bar, saved, personal) | PV-21 to PV-24 | 29 h |
| 9 | Export (CSV, copy as text) and saved views | PV-28, PV-29 | 12 h |
| 10 | Page fixes found in the walk (first screen, duplicates, Matters list, Assets list, bell, search) | PV-08, PV-30 to PV-35 | 4 h + 20 h |

Total 199 agent-hours nominal (230 to 250 realistic; see `delivery-plan.md`).

## 2. Page inventory (what a PM uses)

| # | Screen | Route | Screenshot |
|---|---|---|---|
| 1 | My Matters: Overview, Deadlines, Trends, Activity | `/my-matters?tab=` | 01, 01b, 02, 03, 04 |
| 2 | Matters list | `/matters` | 05 |
| 3 | Matter record: header, Overview, Tasks, Projects, Assets | `/matters/:id?tab=` | 06, 06b, 07, 08 |
| 4 | Task Queue (scoped) | `/tasks` | 11 |
| 5 | Assets list, Asset record | `/assets`, `/assets/:id` | 12, 13 |
| 6 | Clients, Projects lists | `/clients`, `/projects` | 14, 15 |
| 7 | Search as a PM | `/search?q=` | 16 |
| 8 | Create task from a matter | dialog / `/tasks/new?matter=` | 10 |
| 9 | Notification bell and page | header, `/notifications` | 17, 18 |
| 10 | Menu and landing | shell | 19 |
| 11 | Administration: Task Types, Task Type edit, Asset Types (baseline for the admin changes) | `/admin/...` | 20, 21, 21b, 22 |

The matter record has **no Details tab** (the owner brief lists one): the details (client, status, sensitive, created, custom fields) are the last block of the Overview and sit below the fold (screenshot 06b).

## 3. Findings (numbered, with severity)

Evidence is the screenshot number (1366x768 unless stated) and the facts above. Each finding worth doing has an issue in epic #851 (last column).

### 3.1 My Matters (screens 01 to 04)

| # | Sev | Finding | Issue |
|---|---|---|---|
| F-01 | major | No task type anywhere in the lists: Needs my attention, Upcoming deadlines, Since your last visit, Recent activity (01b). `MyMattersTaskItem` has no type, priority or status. Only the demo titles name the type. | PV-04, PV-06 |
| F-02 | major | No sort or filter inside a section; groups are cut to 10 rows (deadlines 25 of 26, "Showing the first 25 of 26"), so the PM must leave the page to see the rest. | PV-04, PV-06 |
| F-03 | major | No view of work per task type across matters (no matrix, no count by type). | PV-09 to PV-11 |
| F-04 | major | No data view at all: no size, no asset status, no warnings. | PV-18, PV-19 |
| F-05 | minor | First screen at 1366x768 is the strip plus "Since your last visit"; Needs my attention starts at y=720 and the page is 3,255 px tall (01, 01b). The summary lists 106 reassigned and 104 new tasks, which is noise for a PM who made them. | PV-08 |
| F-06 | minor | The same task appears up to three times: TSK-119 is in Overdue and in Unassigned, due-today tasks are in Due soon and in Upcoming deadlines (01b). | PV-08 |
| F-07 | minor | Matter health: all five matters are "Red"; the flag carries no information; the reason is behind "How is this decided?". | PV-08 |
| F-08 | minor | Three "new task" controls on one page: header "Create task", "New task" menu, "+ New task" per health row. | PV-08 |
| F-09 | minor | Trends: two large charts and a three-bullet warning take the whole tab; with demo data the history is flat except the last week; it is the least frequent question. | PV-12 |
| F-10 | nit | The Dates filter (Next 4 weeks) applies only to Upcoming deadlines and says so in a sentence; the filter bar takes three rows at 1366. | PV-08 |
| F-27 | major | Phone (375x812): the first screen is the title, the scope switch, a New task button, Filters and seven count cards (about 470 px) and then Since your last visit; Needs my attention is far down a 7,629 px page (desktop 3,255 px); the tab strip is cut ("Ac" with an arrow) and a sixth tab will not fit without scrolling inside the strip (375x812 shots 01, 19). The menu itself is short and fine. | PV-08, PV-38 |
| F-11 | minor | On hold 9 in the strip is a count with no reason and no age. | PV-26 |

### 3.2 Matters list and Matter record (screens 05 to 10)

| # | Sev | Finding | Issue |
|---|---|---|---|
| F-12 | minor | Matters list: Name and Client are truncated ("Demo Emp...", "90001 Demo...") while the Status column and the right side are wide; the Sensitive badge wraps the name. Columns that would help a PM are missing: on hold, at risk, data size, assets pending disposition (05). | PV-30 |
| F-13 | minor | Matter Overview shows a header strip and a skeleton first; the Details block is at the bottom; no task-type mix, no data size, no on-hold reasons (06, 06b). | PV-31 |
| F-14 | minor | Matter Tasks tab has no by-type summary and no sort by type; the Assets tab lists assets without size or disposition (07, 08). | PV-31, PV-32 |
| F-15 | nit | "Project manager: Test User 03(primary)" lacks a space before the bracket (06). | PV-31 |

### 3.3 Task Queue, Assets, Clients, Projects (screens 11 to 15)

| # | Sev | Finding | Issue |
|---|---|---|---|
| F-16 | major | Task Queue shows the type icon in grey with the name only as a mouse `title` attribute (not reachable by keyboard or screen reader), no colour; the On Hold status shows the reason comment truncated; no export, no copy, no saved views, no filter by on-hold reason or at risk (11). | PV-03, PV-26, PV-28, PV-29 |
| F-17 | major | Assets list: no size, no disposition; Linked tasks is 0 for every demo asset so the column does not help; the Status filter select is squeezed to "Act" at 1366 (12). | PV-15, PV-32 |
| F-18 | major | Asset record: Active/Inactive only; "This asset has no type-specific values" for a seeded asset, so the size field is not even offered; the record has only Details and Linked tasks tabs for a PM (History needs `Audit.View`), so a state change is not visible to the PM at all (13). | PV-14, PV-15, PV-16 |
| F-19 | minor | Clients and Projects lists are scoped correctly (scope switch, count line) but show no count of "my matters" per row (the optional part of #762 was not built). | PV-35 |

### 3.4 Search, bell, menu, create task (screens 10, 16 to 19)

| # | Sev | Finding | Issue |
|---|---|---|---|
| F-20 | minor | Search: task hits show Ref, Title, Matter, Status; no type, no due date; "Other matter" labels work (16). | PV-34 |
| F-21 | minor | Bell: 99+ unread, five "Overdue by n days" items, one notice per task; a PM with 13 overdue tasks gets 13 notices every morning and the popup says nothing about the type or the matter total (17, 18). | PV-33 |
| F-22 | nit | Menu is short and right (My Matters, Matters, Tasks, Assets, More); the header "Create task" and the page "New task" duplicate (F-08). | PV-08 |
| F-23 | minor | Create task from the matter header works (matter locked); the chooser is an alphabetical grid of 15 cards (Access Request first, 10 at 1366x768); for this demo user no recently used types are offered first (#814), and Focus types would be the natural first row (10, all four sizes). | PV-07 |

### 3.5 Administration baseline (screens 20 to 22)

| # | Sev | Finding | Issue |
|---|---|---|---|
| F-24 | major | **Task type icons already exist** (`TaskType.IconKey`, Tabler outline library `contracts/task-type-icons.json`, picker "Access key / Change icon" on the Task Type page, script 19): a required icon with default `file-text`. What is missing is the colour, the accessible name in lists (the component is `aria-hidden` and relies on the name next to it) and its use in My Matters. | PV-01 to PV-04 |
| F-25 | major | Asset Types have no size designation, no disposition vocabulary; the seeded number fields are not indexed (0 index rows). | PV-16 |
| F-26 | minor | Task Type page has no target turnaround; Labels page has no on-hold reasons. | PV-02, PV-25 |

## 4. How the new design fits together

```
My Matters   [Overview] [Deadlines] [Breakdown] [Data] [Activity] [Trends]
                 |            |           |         |        |         low priority, small
   sections ---- +------------+           |         |
   (icon, sort, type filter, Focus)       |         +--> asset report builder (/assets/reports)
                                          +--> cell click --> Task Queue filtered
Task Type (admin): icon + colour + target days      Asset Type (admin): size field + unit
Asset: Disposition   Task: on-hold reason, at-risk badge
Everywhere: Export / Copy, Saved views
```
Tab order: Overview, Deadlines, Breakdown, Data, Activity, Trends. Trends moves last and shrinks (section 8).

## 5. Task type icons and colour (requirement a)

**Decision: reuse the library already in the product** (Tabler outline icons, `IconKey`, picker, `contracts/task-type-icons.json`, `mf-task-type-icon`), not PrimeIcons. Reasons: it is the owner-approved set from epic #352, it has an EDRM-oriented catalogue (processing, review, production, vault), every task type already has a key (default `file-text`), and the Task Queue, Create task chooser and Task page already draw it. PrimeIcons (generic UI glyphs) would give a second icon system and a data migration. Open question Q1 if the owner meant PrimeIcons literally.

What is added:

- `TaskType.ColourKey` (nullable; null = neutral default). A **named palette of 10 colours** (slate, blue, teal, green, amber, orange, red, rose, violet, indigo), never a free hex value, so contrast is guaranteed in light and dark theme and in forced colours. Colour is **never the only signal**: the badge always has the icon and the name is in the tooltip and the accessible name.
- Shared component `mf-task-type-badge` (compact: icon in a 24 px tinted chip; wide: icon + name). Accessible name: `role="img"` with `aria-label="Task type: Production (Outgoing)"` in compact lists; when the name is already visible next to it, `aria-hidden` as today. Tooltip uses the existing tooltip pattern (focusable row link carries the type in its accessible description: `aria-describedby`), because a tooltip on a non-focusable icon is invisible to keyboard users.
- Where it shows (My Matters): Needs my attention rows, Upcoming deadlines rows and the Deadlines tab, Since your last visit, Recent activity, Matter health "next deadline" line, Breakdown headers, Focus chips, filter chips.

```
Task Type: Production (Outgoing)                                    [ Save ]
  Name  [Production (Outgoing)____________]
  Icon  [ package-export  Change icon ]   Colour [ (teal) v ]   preview [ [>] ]
  Expected turnaround  [ 3 ] days   (optional; used for the At risk badge)
  Description ...
```
The Task Types list gets a Colour/icon cell and a Target column (44 px rows, no new row height).

## 6. My Matters sections: icon, sort, filter, Focus (requirement b)

### 6.1 Rows

```
Needs my attention
Overdue (13)                         Sort [Due date v]  Types [All types v]   Focus
 [P] TSK-119  Review batch 4 - QC          23 d overdue   Critical  90003 Regulatory inquiry
 [R] TSK-102  Privilege log refresh        22 d overdue   High      90003 Data breach response
 (P) = Production badge, (R) = Review badge; hover/focus shows the name
```
Row = badge, ref and title (the one link), the fact ("23 d overdue" / "on hold 6 d: Waiting for client data" / "At risk"), priority badge (text, not colour only), matter. 44 px rows; phone: badge and title on the first line, fact and matter on the second.

### 6.2 Toolbar per section

```
[ Task types: 3 selected v ]  [ Sort: Due date v  ^ ]  [ Focus: Intake, Production x ]
```
- **Filter** = multi-select task types (searchable list with badges; "All types" default; chips of the selection; Clear). Server-side: `taskTypeId=` repeated.
- **Sort** = task type (name, then due), due date, priority, matter (reference), age (oldest first). Direction toggle; the label states it ("Due date, soonest first"). Server-side (`sort=`, `dir=`), stable tie-break by task id.
- **Remembered per person per section** (Needs my attention, Upcoming deadlines, Deadlines tab, Breakdown, Data): one row per surface in `dbo.UserView` (section 10), cached in `localStorage` for first paint, **the address wins** over the remembered state (explicit `?type=` from a link), as for the scope switch.
- **Focus** (decision b): a button "Focus" opens a list of task types with checkboxes and Save. The chosen set is stored once per person (`mf.focus`) and **stays until changed**; it is applied as the type filter of all sections that have no explicit filter of their own, shown as a chip "Focus: Intake, Production  [x]". Clearing the chip clears it for everybody sections at once. **No criticality weight, no task type groups** are stored (owner decision: criticality changes day to day). "Focus" is a filter, not a score.
- Counts: the group heading keeps the true total ("Overdue (13)"); with a filter it reads "Overdue (4 of 13)" so a PM never mistakes a filtered list for the whole.
- Empty state under a filter: "No overdue tasks of the selected types. [Show all types]".

### 6.3 Why server-side

The groups return at most 10 rows and deadlines 25. A client sort would reorder the wrong subset. The endpoints accept `taskTypeId[]`, `sort`, `dir` and keep their caps; "View all" opens the Task Queue with the same filters (`type=`, `sort=`), which already supports `type` (multi) and `matter`.

## 7. Breakdown tab (requirement c)

```
My Matters > Breakdown       View [ Per matter | All matters ]   Types [All v]  Status [Open v]  Client [All v]  [Export v]
                                                      (same scope switch, client and role filters as the page)
 Matter                    Intake      Processing   Review set-up   Production    Total
 90001-80001 Smith v Acme  4 / 1       6 / 0        2 / 1           1 / 0         13 open, 2 overdue
 90002-80002 Internal inv. 0 / 0       3 / 2        5 / 0           4 / 1         12 open, 3 overdue
 ...
 All my matters            19 / 4       27 / 5       14 / 2          9 / 3         69 open, 13 overdue
 Avg days (done, 90 d)     1.8 (tgt 2)  4.2 (tgt 3)  6.0 (tgt 7)    2.1 (tgt 3)
 cell "4 / 1" = 4 open, 1 overdue (labelled, not colour only)
```
- **All matters** view collapses the matrix to one row per task type with open, overdue, on hold, at risk and avg actual vs target (days).
- **Cells are links** to the Task Queue with `managedByMe=true&matter=<id>&type=<id>&status=open` (+ `overdue=true` for the overdue number). Two links per cell (open, overdue); a cell with 0 is plain text.
- **Accessible table**: a real `<table>` with `<th scope="col">` task type (with badge and visible name), `<th scope="row">` matter, a caption stating scope and filters, cell text "4 open, 1 overdue" as visually hidden text next to the "4 / 1" shorthand, sticky first column and header, the same filters as My Matters (client, role, scope) plus Types (reuses Focus) and Status.
- **Phone (375)**: one card per matter with a list "Production 1 open" for the non-zero types; "All matters" is the same list per type; the matrix is available only from 640 px (a 12-column table on a phone is not usable and not a sideways page scroll).
- **Limits**: at most 50 matters (sorted by overdue then open; "Show all 212" pages), at most 40 type columns (types with no task are not columns). Totals are computed over all matters, not over the shown page.
- Count parity: totals equal the strip (Open tasks 69, Overdue 13) and the Task Queue count of the linked query. A test pins this.
- Avg actual vs target: completed tasks of the last 90 days (CreatedAt to CompletedAt, calendar days, one decimal) against `TaskType.TargetDays`; "no target set" when null.

## 8. Trends demoted (requirement c)

Trends moves to the last tab, loses the three-bullet banner (becomes a one-line "Approximate, see how" disclosure) and its two charts become a 2-column strip of two 160 px sparklines with "Show as table" (same data, same endpoint, no change in the API). No new work on it; **data volume over time** moves to the Data tab (section 9.6). The `Trends` tab keeps its permission rule. Effort PV-12 2 h.

## 8a. Targets for the other pages (findings F-12 to F-23)

```
Matters (PV-30)                                      [My matters | All]  Filters  Select  + New matter
 Ref          Name                          Client            PM          Open Over On hold At risk Data   Status
 90001-80001  Smith v. Acme   [Sensitive]   Northwind Hold.   T. User 03   16   1     1      3     640 GB  Active
 (Name and Client take the free width; Status is narrow; extra columns come from the column chooser)

Matter record Overview (PV-31)
 Header strip: Open 16 | Overdue 1 | At risk 3 | On hold 1 | Unassigned 5      Details v (disclosure)
 Task types (open/overdue): Intake 4/1 | Processing 6/0 | Review set-up 2/1 | Production 1/0   [Open Breakdown]
 Data: 19 assets, 640 GB | 2 pending disposition | 1 inactive but linked   [chart: volume by month]
 On hold by reason: Waiting for client data 1 (6 d)      Next deadlines   Who is working on it   Recent activity

Notification bell (PV-33)
 Overdue: 13 tasks on 3 matters  [Open in Task Queue]   <- one grouped notice per day
 [P] Production (Outgoing) TSK-71 "Incoming..." overdue 5 d

Create task from a matter (existing; PV-07 adds Focus types first in the chooser)
 Task type  Focus: [Intake] [Production]  All types v

Search as a PM (PV-34):  [P] TSK-195 Review set-up and batching - 14   90001-80001  due Oct 27   In Progress
Menu: unchanged (My Matters, Matters, Tasks, Assets, More); Reports appears with #671 only.
```

## 9. Data tab, disposition, size and the report builder

### 9.1 Disposition (requirement d): the model

Every asset gets a built-in **Disposition** with four values: **Active, Inactive, Pending disposition, Disposed**.

Relation to what exists (decision):

| Existing | Decision |
|---|---|
| `Asset.IsActive` (BIT, used by lists, links, the Set inactive dialog) | **Stays as a column, becomes derived and constrained**: `IsActive = 1` iff `DispositionCode = 'ACTIVE'` (`CK_Asset_IsActive_Disposition`). The service writes both in one statement; every existing reader keeps working. Pending disposition and Disposed assets are therefore "not active": they cannot be newly linked, exactly as inactive assets today. |
| "Lifecycle" label (#513): the seeded optional select `asset_status` (Planned, Active, Archived, Retired; custom field, label only) | **Stays** as the type-specific business stage of the thing (a workspace is Planned or Archived). **Disposition is the retention state of the record.** Help text on both fields says so; the Lifecycle field is not read by any rule. Open question Q3: drop it from the SME seed. |

Migration (the app is not deployed, demo data only, scripts stay immutable): one new numbered script adds `DispositionCode VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'` with a CHECK of the four codes, `DispositionChangedAt DATETIME2 NULL`, `DispositionChangedByUserId INT NULL` (FK), `DispositionNote NVARCHAR(500) NULL`; backfills `IsActive = 0` rows to `INACTIVE` (the demo has none); adds the CHECK and the index `IX_Asset_Matter_Disposition (MatterId, AssetTypeId, DispositionCode)`. No data loss, replayable from an empty database. Audit event `ASSET_DISPOSITION_CHANGED` (from, to, note; same audit pattern as `Set inactive`).

Transitions: any of Active, Inactive, Pending disposition can move to any other; **Disposed is terminal** except for a holder of `Asset.Dispose` who can move it back to Inactive (a correction, note required, audited). Moving to Pending disposition or Disposed needs `Asset.Dispose` (new permission, in `contracts/permissions.json`, held by Project Manager by default); Active and Inactive keep `Asset.Edit`. The dialog states the impact: "3 open tasks keep this link" (existing `impactLine`), a note field (optional, required for Disposed), no hard block because open linked tasks are a warning not a rule (open question Q4).

UI:

```
Assets                                    [My matters | All]   Filters   + New asset
 Name                Type            Matter       Size        Disposition          Linked
 Relativity WS 14    Relativity WS   90001-80001  412.0 GB    Active               3 open
 Harvey Vault 2      Harvey Vault    90001-80001  --          Pending disposition  1 open  (!)
 Prod set 7          Production      90002-80002  28.4 GB     Inactive             2 open  (!)
 Disposition [Any v]   (!) = warning text "Inactive but still linked to open tasks"

Asset record: header badge "Pending disposition"; strip: Open 1 | Linked 3 | Size 412 GB | Disposition changed 12 Oct
  [ Change disposition v ] -> dialog: ( ) Active ( ) Inactive (x) Pending disposition ( ) Disposed
        Note [__________]   "1 open task keeps this link."   [Cancel] [Save]
  History tab: Disposition changed Active -> Pending disposition, Test User 03, 12 Oct, "Matter closed"
```
The list gets a Disposition filter (multi) and a Size column (sortable). Bulk change from the list selection (PV-15). Phone: the badge sits on the card's second line.

### 9.2 Size (requirement d)

Admins already define custom NUMBER fields on an asset type. The PM chooses which means size in two steps:

1. **Admin default per asset type**: Asset Types page gets "Size field" (select among the type's published NUMBER fields) and "Unit" (B, KB, MB, GB, TB, Items). Stored `AssetType.SizeFieldKey`, `AssetType.SizeUnit`.
2. **PM override** in the Data tab and the report builder: "Size field" per asset type in the current view (saved in the view or report). Not stored on the type.

Sizes of different units are added only after converting to a common unit within the size family (B..TB shown in GB); **Items** never mix with bytes. A view or report that mixes asset types with different units (Relativity Workspace in GB, Production in pages) shows the **units warning**: "This result mixes units: GB (Relativity Workspace, Collection / Data Set) and Items (Production). Totals are shown per unit."

### 9.3 Index rule (cheap aggregates)

`dbo.CustomFieldIndex` only holds fields with `IsFilterable`. All eight seeded asset number fields are not filterable, so the table holds 0 asset rows. **Rule change: the indexer always indexes NUMBER and SELECT fields of asset forms** (`ValueNumber`, `ValueText <= 450`), independent of `IsFilterable`; a one-time reindex of asset values (idempotent job, also callable per asset type) fills the table. `IsFilterable` keeps its meaning for the filter UI. Alternative rejected: forcing admins to tick Filterable (an immutable published version has to be re-published to change it).

### 9.4 Data tab (requirement d)

```
My Matters > Data        View [ Per matter | All matters ]   Asset type [All v]  Size field [per type defaults v]  [Export v]  [ Build a report > ]
 Warnings (3)
  (!) 2 inactive assets are still linked to open tasks        [Show]
  (!) 4 assets await disposition (oldest 41 days)             [Show]
 Matter                    Assets  Size        Active  Inactive  Pending  Disposed
 90001-80001 Smith v Acme   19     640.2 GB     15      2         2        0
 90002-80002 Internal inv.   9     128.0 GB      9      0         0        0
 All my matters             60     2.4 TB       52      3         4        1
 By asset type (count / size):  Relativity Workspace 12 / 1.8 TB   Collection 12 / 530 GB   Production 12 / 26,400 pages (Items)
 Volume over time (monthly, cumulative)        [Pie] [Bar] [Table]
```
- Rows are links: matter -> its Assets tab filtered (`disposition=`); counts -> Assets list with the same filters; warnings -> the Assets list filtered to the offending assets.
- Warnings are text with an icon, each with count and a link; dismissal is not offered (they are facts, not alerts).
- Accessibility and phone: same pattern as Breakdown (table from 640 px, cards below).
- Visibility: only matters visible to the caller (`IMatterVisibility`), scope mine/all as everywhere.

### 9.5 Disposition awaiting and warnings (rules)

- **Inactive linked**: asset with `DispositionCode <> 'ACTIVE'` and at least one linked task in New, In Progress or On Hold.
- **Awaiting disposition**: `DispositionCode = 'PENDING_DISPOSITION'`, with `DispositionChangedAt` giving the age.
- Both are counted in the Data tab, on the matter Overview ("Data" block) and as a count on the asset record.

### 9.6 Data volume over time (approved add-on)

Monthly cumulative size per matter (and all), from the size field of assets by `Asset.CreatedAt` (limitation stated on screen: an asset's size is its **current** value placed at its creation month; disposed assets leave the line at their `DispositionChangedAt`). No snapshot table in v1; if the measured p95 is over 500 ms or the PM needs true history, a monthly snapshot `dbo.MatterDataSnapshot` is the fallback (decided by the PV-36 measurement). Shown on the Data tab and as a small chart on the matter Overview; replaces the "created vs closed" chart of Trends as the thing PMs show clients.

### 9.7 Asset report builder (requirement e)

Narrow and built in; it is **not** the postponed SQL Reports epic #671 (no SQL, no parameters, no run history, no sharing, no schedule).

Flow (route `/assets/reports`, lazy; entry points: Data tab "Build a report", Assets list header menu, saved reports in a list on the same page):

```
Step 1  Define
 Report name  [Data by disposition_______]
 Asset type   [Relativity Workspace v]     Scope [My matters | All]   Matters [all in scope v]
 Measure      (x) Count  ( ) Sum  ( ) Average     Number field [Size (GB) v]   <- enabled for Sum/Average
 Group by     [Disposition v]   (Disposition, Matter, Client, Asset type, a Select custom field of the type)
 Filters      Disposition [Any v]
 [ Run ]  [ Save ]
Step 2  Result as a TABLE (always first)
 Disposition            Assets   Sum of Size (GB)
 Active                    12       412.0
 Pending disposition        3        88.5
 Total                     15       500.5            (!) units: GB only
 [ Show as: Table | Pie | Bar ]   Graph field [Sum of Size v]   [Export CSV] [Copy]
Step 3  Pie or Bar  (SVG, lazy)           [Show as table]
```
- **Result is a table first**; Pie/Bar are buttons above it and the "Show as table" button returns. The graph field is the measure column shown (Count or Sum or Average); Pie only for non-negative values with at most 8 slices (the rest folded into "Other", stated); Bar for the rest, horizontal bars with direct value labels.
- **Saved reports are personal** (`dbo.AssetReport`, owner = the person; list, rename, duplicate, delete; never visible to others, no sharing in v1). A saved report stores the definition only; each run recomputes with the viewer's **current** visibility.
- **Visibility**: the engine starts from `IMatterVisibility.WhereMatterVisible` over assets (via the asset's matter) and `IManagedMatterScope` for scope mine/all (All needs `Matter.AssignManagers`, 403 otherwise), exactly as `/assets` does (`Features:SensitiveMatterAccess`). A matter hidden by the sensitive rule contributes nothing to counts, sums, group labels or the matter list; direct report id of someone else is a 404.
- **Units warning** when the selected asset types' number fields carry different units (section 9.2); with "All asset types" the measure is restricted to Count unless every type has the same unit.
- **Limits**: group-by cardinality capped at 200 groups ("Top 200 by value, N more hidden"), definition JSON capped at 4 KB, 50 saved reports per person, run timeout 10 s.
- **Chart approach (decision)**: **reuse the hand-built SVG already used by Dashboard Trends** (`features/dashboard/ui/trend-chart.ts`, `breakdown-slices.ts`, `breakdown-pie.ts`: pie slices with patterns and labels, bar rendering, "Show as table"). No new dependency, no bytes in the initial bundle (the charts are in the lazy chunk of the report route and the Data tab), already reviewed for contrast, patterns and reduced motion. A small library (about 60 to 80 kB gzip for Chart.js) was rejected: canvas output is not accessible without an extra table, it adds a dependency that must be vetted for the corporate network move, and the two chart kinds needed are about 300 lines. The shared pie and bar are lifted out of `features/dashboard` into `shared/charts` (lazy) in PV-23.

## 10. Other new capabilities (requirement f)

### 10.1 On-hold reason

Today: moving a task to On Hold **requires a comment** (`TaskCommentPurpose.OnHold`, stored with the status change; `StatusChangedAt` is the hold start); the Task Queue shows the comment truncated; My Matters knows "stuck on hold" (7 days) and counts "On hold 9". There is no structured reason.

Design: `dbo.OnHoldReason` (admin-managed list: Waiting for client data, Waiting for approval, Waiting for vendor, Waiting for a decision; name, sort order, active) and `Task.OnHoldReasonId` (nullable FK). The status dialog adds a **Reason** select above the existing comment; **optional by default**, required when configuration `Tasks:OnHoldReasonRequired` is true (moves to the Settings page of #850 later; no dependency now). The free comment stays (detail), the reason is the structure. Leaving On Hold clears `OnHoldReasonId`; the audit event of the status change carries the reason name. Lists show "On hold 6 d - Waiting for client data" (aging from `StatusChangedAt`), Task Queue gets filters `onHoldReason` (multi) and sort "on hold since" (exists), Breakdown gets an "On hold" column optionally by reason, Attention's stuck group shows the reason. Admin: Administration > Labels gets a tab "On-hold reasons" (list with reorder, rename, deactivate; used reasons are deactivated, never deleted), permission `OnHoldReason.Manage` (new, like `Priority.Manage`).

```
Change status: On Hold
 Reason   [Waiting for client data v]        (required when the firm requires it)
 Comment  [Client promised the drive for Friday____]  (required, as today)
 [Cancel] [Put on hold]
```

### 10.2 Target turnaround and At risk

`TaskType.TargetDays` (nullable SMALLINT, 1 to 365, calendar days; Q5: business days). **At risk** = the task is open (New or In Progress), **not yet overdue** by its due date, the type has a target, and the task has used **at least 80 percent** of the target since creation (`now >= CreatedAt + 0.8 * TargetDays`; the 80 percent is a constant in code, Q6). On Hold tasks are not at risk (their aging is shown). Badge "At risk" (text and icon, amber) in lists beside the due fact; count in the strip ("At risk 6"); Task Queue quick filter and `atRisk=true`; Breakdown shows the at-risk count and avg actual vs target. Never changes status or sends mail (notifications are epic #753's).

### 10.3 Export and copy

Task Queue, each My Matters section, Breakdown, Data tab and report results get **Export > CSV** and **Copy as text** (tab-separated, pastes into a mail or a spreadsheet). It exports exactly the **filtered, sorted rows on screen** (all pages up to 10,000 rows; more is refused with a message, not truncated silently). CSV is UTF-8 with BOM, ISO dates, cells starting with `= + - @` are prefixed with `'` (formula injection), every row passes the visibility rule, an audit event `EXPORT_RUN` (surface, row count, filter summary, no data) is written. **It is not a status report**: no layout, no narrative, no scheduling, no mail (stated in the menu help text).

### 10.4 Saved filters and views

A **view** = name + the state of one surface (filters, sort, columns, scope, Focus choice). Surfaces: the Task Queue, each My Matters section, Breakdown, Data, Assets. Menu "Views": apply, Save current as..., Rename, Delete, Set as default. Examples a PM would create: "Intake focus" (types Intake and Collection Receipt, sort due), "Production week" (type Production, due next 7 days, sort priority). **Not seeded** (no invented firm vocabulary). Personal; no sharing. Stored in `dbo.UserView` (section 11), the same table that remembers the section state.

## 11. Data model changes (scripts take the next free number at implementation time; last used on dev is 39)

| Change | Table | Notes |
|---|---|---|
| `ColourKey VARCHAR(20) NULL` (CHECK against the palette in the application, malformed guard in SQL), `TargetDays SMALLINT NULL` CHECK 1..365 | `dbo.TaskType` | Existing `IconKey` stays |
| `DispositionCode VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'` + CHECK, `DispositionChangedAt`, `DispositionChangedByUserId`, `DispositionNote`, `CK_Asset_IsActive_Disposition`, `IX_Asset_Matter_Disposition` | `dbo.Asset` | Backfill from `IsActive` |
| `SizeFieldKey VARCHAR(64) NULL`, `SizeUnit VARCHAR(10) NULL` | `dbo.AssetType` | Validated against the published form (NUMBER) |
| New `dbo.OnHoldReason` (id, name unique, sort, active, audit columns, rowversion); `OnHoldReasonId INT NULL` FK + index on open on-hold | `dbo.Task` | Lookup: **allow** in `db/report-access.json` (business data like `Priority`) |
| New `dbo.AssetReport` (id, `OwnerUserId` FK, name, `DefinitionJson` ISJSON CHECK, created/modified, rowversion; unique (OwnerUserId, Name)) | new | **deny** for `mf_report_reader` (personal definitions); GRANT/DENY lines in the script, `report-access.json` entry |
| New `dbo.UserView` (id, `UserId` FK, `Surface VARCHAR(40)`, `Name NVARCHAR(80) NULL`, `IsDefault`, `StateJson` ISJSON CHECK, rowversion; unique (UserId, Surface, Name); name NULL = remembered state) | new | **deny** for `mf_report_reader` |
| Permissions `Asset.Dispose`, `OnHoldReason.Manage` | `contracts/permissions.json`, `Permissions.cs`, `permissions.ts`, data script (pattern of script 34) | Parity tests |
| Indexer rule: NUMBER and SELECT asset fields always indexed + reindex job | `dbo.CustomFieldIndex` (data only) | no schema change |

All additive; the scripts are separate small files (one per area) so a failed review of one does not block the others. Next free number at implementation time.

## 12. API (all `/api/v1`, additive, OpenAPI and nswag regenerated; every endpoint takes `IManagedMatterScope` / passes `IMatterVisibility`)

| Endpoint | Change |
|---|---|
| `GET /my-matters/attention`, `/deadlines` | new `taskTypeId[]`, `sort`, `dir`; items gain `taskTypeId, taskTypeName, taskTypeIconKey, taskTypeColourKey, priorityName, statusCode, ageDays, onHold{reasonName,days}, atRisk` |
| `GET /my-matters/breakdown` | new: `view=matrix|types`, scope/client/role/types/status; returns types, rows, totals, avg-vs-target |
| `GET /my-matters/data` | new: summary, per matter, per type, warnings, volume over time |
| `GET /task-types`, `PUT /task-types/{id}` | `colourKey`, `targetDays` |
| `GET/POST/PUT /on-hold-reasons` (+ activate/deactivate) | new lookup, `OnHoldReason.Manage` |
| `PUT /tasks/{id}/status` | `onHoldReasonId` with ON_HOLD |
| `GET /tasks/queue` (and My Work, Pod Work) | `onHoldReason[]`, `atRisk`, sort `type` |
| `PUT /assets/{id}/disposition`, `POST /assets/disposition` (bulk) | new, audited |
| `GET /assets` | `disposition[]`, sort `size`/`disposition`, `sizeValue`, `sizeUnit`, `disposition`, `inactiveLinked` |
| `PUT /asset-types/{id}/size-field` | new |
| `GET /asset-reports`, `POST`, `PUT/{id}`, `DELETE/{id}`, `POST /asset-reports/run`, `GET /asset-reports/{id}/run`, `GET /asset-reports/fields?assetTypeId=` | new, personal, visibility-checked |
| `GET /me/views?surface=`, `PUT /me/views/{surface}` (remembered), `POST/PUT/DELETE /me/views` (named) | new |
| `GET .../export` (`text/csv`) on queue, sections, breakdown, data, report | new, 10,000 row cap, audited |
| `GET /task-queue/export?format=csv|text` (built, PV-28 #879) | the Task Queue's filters and sort, every page, at most 10,000 tasks (400 `EXPORT_TOO_LARGE` beyond), UTF-8 BOM, formula-safe, audit `EXPORT_RUN`; catalogued as List |
| `POST /exports/log` (built, PV-28 #879) | records an `EXPORT_RUN` for an export the browser built from rows already on screen (My Matters sections, Breakdown): surface, format, count, filters; catalogued as Neutral. The sections and the Breakdown are exported client side from the loaded rows, so they need no new read endpoint |
| `GET /my-matters/summary` (PV-27 #878) | gains `atRisk` (same rule and count as the Task Queue's `atRisk=true`) |

Sensitive-matter coverage (docs/ux/sensitive-matters/README.md section 12 and 16): every endpoint above is added to `SensitiveAccessCatalog` with kind List/Aggregate and to the six-persona walk; aggregate parity tests (sum of cells = visible task count; Data totals = visible asset count) and a sentinel sweep over CSV and report results. PV-37.

## 13. Performance notes

Budget: p95 under 300 ms for Breakdown and Data, under 500 ms for a report run, at the harness size of `docs/ux/pm-review/performance.md` (200 matters, 24,000 tasks, 100,000 assets) **plus 100,000 `CustomFieldIndex` asset rows**. To verify in PV-36 with the plans in the test output:

- **Breakdown**: one grouped statement `GROUP BY MatterId, TaskTypeId` with conditional counts (open, overdue, on hold, at risk) over `Task` joined to the managed matter semi-join. `IX_Task_Matter (MatterId, StatusCode)` already covers due date, assignee and status time (script 33); it needs `TaskTypeId` and `CreatedAt` in the INCLUDE list: new `IX_Task_Matter_Type` (open statuses filtered) if the plan scans. Avg actual vs target is a second statement over completed tasks of 90 days (range on `CompletedAt`).
- **Data and reports**: assets of the scoped matters come from `IX_Asset_Matter_Disposition` (seek per matter); the measure is `CustomFieldIndex` joined on `OwnerKind='ASSET' AND OwnerId = AssetId` with `FormDefinitionId` and `FieldKey` of the designated field. `IX_CFI_Number` (OwnerKind, FormDefinitionId, FieldKey, ValueNumber) INCLUDE (OwnerId) turns the measure read into an index range of one field (at most 100,000 narrow rows, about 1 MB) and `IX_CFI_Owner (OwnerKind, OwnerId)` serves the per-asset path for small scopes; the optimizer picks, both are cheap. **Sum and Average are done in SQL (`SUM(ValueNumber)`, `AVG`)**, never in application memory; group-by on a SELECT field uses `IX_CFI_Text` the same way (a second join on the same owner); group-by disposition/matter/type uses columns of `Asset`.
- **Without the index rule** (section 9.3) the aggregate would fall back to `JSON_VALUE` over `FormValueSet`, a scan: not acceptable; this is why PV-16 is a prerequisite of PV-18 and PV-22.
- **Views and focus**: `dbo.UserView` reads are by (UserId, Surface), unique index, one row; the remembered state is cached in `localStorage`.
- **Export**: streamed, 10,000 rows max, same query as the screen with paging removed.
- **Bundle**: initial 629.21 kB stays; Breakdown, Data, report builder and charts are lazy chunks (route `loadComponent` and `@defer`); no static import of the api-client or lookup-store in shell code; the build reports each chunk (PV-38 gate: initial under 700 kB, each new chunk listed).

## 14. Accessibility, phone layouts, shell contracts

- Four widths (1920x1080, 1366x768, 768x1024, 375x812) on every new screen; axe 0 at each; no sideways page scroll (tables scroll inside their own region only above 640 px where a matrix needs it, with a labelled region and keyboard focus; on phones they become cards).
- Page header, states (loading, empty, error with reference, 403, 404) and "still loading" come from the shared kit; the document title rule is `<Page>: <Tab> - <App name>` (for example "My Matters: Breakdown - MatterFlow"; the application name will come from #850 and is read through the same title helper, no dependency).
- Tabs use the shared `mf-tabs` (tab, tabpanel, `aria-labelledby`); the six-tab strip scrolls inside itself at 375.
- Matrix and Data tables: real tables, caption, header scopes, links with unambiguous names ("4 open Production tasks on 90001-80001"), counts as text.
- Charts: always a "Show as table" alternative, patterns and direct labels (never colour only), tokens for dark mode, reduced motion respected; pie limited to 8 slices.
- Focus, Views and Export menus: button + menu, focus returns to the button, Escape closes. **No new or changed keyboard shortcuts (#420).**
- Colour badges: contrast checked for the 10 palette colours in light and dark (unit test over tokens, 4.5:1 for text, 3:1 for the icon).

## 15. Issues

Epic #851 (label `phase-24`), 39 child issues linked as sub-issues, nominal 199 agent-hours (230 to 250 realistic); plan with lanes and waves in `delivery-plan.md`.

| Package | Issue | Title | Hours |
|---|---|---|---|
| PV-01 | #852 | Task Type: colour, default and target days (DB, domain, API) | 3.5 |
| PV-02 | #853 | Task Type admin UI: colour picker, target days, preview, list columns | 4.0 |
| PV-03 | #854 | Shared task type badge (icon, colour, accessible name, tooltip) | 3.5 |
| PV-04 | #855 | My Matters task items: type, priority, status, age, on-hold, at-risk; server-side sort and type filter | 6.0 |
| PV-05 | #856 | UserView store: remembered section state and named views (table, API, client service) | 5.0 |
| PV-06 | #857 | My Matters sections: type badge in rows, filter and sort toolbar, remembered per section | 7.0 |
| PV-07 | #858 | Focus: pick today's task types once; stays until changed | 3.0 |
| PV-08 | #859 | My Matters Overview first screen: compact summary, no repeats, honest health flag, one New task | 4.0 |
| PV-09 | #860 | Task Queue and work queues: filters atRisk, onHoldReason, sort by type (base) | 3.0 |
| PV-10 | #861 | Breakdown API: tasks per task type per matter and total | 6.0 |
| PV-11 | #862 | Breakdown tab UI (lazy): matrix, per matter / all matters, clickable cells, accessible table, phone cards | 8.0 |
| PV-12 | #863 | Trends demoted: last tab, compact, one-line disclosure | 2.0 |
| PV-13 | #864 | Asset disposition: schema and migration | 3.0 |
| PV-14 | #865 | Asset disposition: domain, API, audit, permission Asset.Dispose, link guard | 6.0 |
| PV-15 | #866 | Asset disposition UI: list column/filter, record page, change dialog, bulk, history | 6.0 |
| PV-16 | #867 | Asset size: designated number field, unit, always-indexed NUMBER/SELECT fields, reindex | 6.0 |
| PV-17 | #868 | Demo seed and e2e fixtures for PM v2 | 3.5 |
| PV-18 | #869 | Data API: assets and size per matter and type, status, warnings | 7.0 |
| PV-19 | #870 | Data tab UI (lazy): tables, warnings, links, phone cards | 8.0 |
| PV-20 | #871 | Data volume over time per matter and across matters | 5.0 |
| PV-21 | #872 | Asset report definitions: personal saved reports (table and API) | 5.0 |
| PV-22 | #873 | Asset report engine: Count/Sum/Average, group-by, visibility, units, limits | 9.0 |
| PV-23 | #874 | Lazy chart components: Pie, Bar and Show as table (shared, no new dependency) | 6.0 |
| PV-24 | #875 | Report builder UI: define, run as table, Pie/Bar with graph field, save, open, export | 9.0 |
| PV-25 | #876 | On-hold reason: lookup table, admin page, status-change API, audit | 7.0 |
| PV-26 | #877 | On-hold reason in the UI: dialog, lists, filter, aging text | 5.0 |
| PV-27 | #878 | Target turnaround: At risk badge, strip count, filter, avg actual vs target | 6.0 |
| PV-28 | #879 | Export and copy of filtered lists (CSV, copy as text) | 6.0 |
| PV-29 | #880 | Saved views: name, apply, default, rename, delete | 6.0 |
| PV-30 | #881 | Matters list: column widths, truncation, PM columns | 3.5 |
| PV-31 | #882 | Matter record Overview: type mix, data block, on-hold reasons, Details placement | 5.0 |
| PV-32 | #883 | Assets tab and Assets list: size and disposition columns, status filter, linked column | 3.0 |
| PV-33 | #884 | Notifications for a PM: group overdue notices, task type in the text, honest bell | 4.0 |
| PV-34 | #885 | Search as a PM: type, due date and disposition in hits | 2.5 |
| PV-35 | #886 | Clients and Projects lists: count of my matters per row | 2.0 |
| PV-36 | #887 | Performance budget, indexes and plans for PM v2 | 5.0 |
| PV-37 | #888 | Sensitive-matter catalog and persona coverage for every new endpoint | 4.0 |
| PV-38 | #889 | Accessibility, four widths, phone, e2e and bundle gate for PM v2 | 9.0 |
| PV-39 | #890 | Docs, runbook and final verification for PM v2 | 2.5 |

## 16. Open questions for the owner (recommended answer first)

1. **Icon set.** Recommend: keep the Tabler library already built (`IconKey`, picker), add colour. Alternative: PrimeIcons (a second set and a migration, +6 h).
2. **Where do saved views live?** Recommend: on the server (`dbo.UserView`) so they follow the PM between workstations; the cost is one small table.
3. **Lifecycle select.** Recommend: keep as the type-specific stage, add help text; or drop it from the SME seed (no rule reads it).
4. **Disposed with open linked tasks.** Recommend: allowed with the impact line and a required note (a warning, not a block). Alternative: block until the tasks are done.
5. **Turnaround in business days?** Recommend: calendar days in v1 (no holiday calendar exists); business days when a calendar exists.
6. **At risk threshold.** Recommend: 80 percent of the target, a constant. Alternative: an admin setting per type (+2 h).
7. **On-hold reason required?** Recommend: optional by default, `Tasks:OnHoldReasonRequired` switch; moves to #850 Settings later.
8. **Report builder placement.** Recommend: `/assets/reports` reached from the Data tab, not a menu item (Reports in the menu belongs to #671).
9. **Data volume history.** Recommend: derive from asset creation month and state the limit; snapshot table only if a PM needs true history.
10. **Seeded views.** Recommend: none seeded ("Intake focus", "Production week" are examples a PM creates).
