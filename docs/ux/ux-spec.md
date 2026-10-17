# MatterFlow UX Specification (Phase 1)

**Version:** 1.0 draft  **Date:** 2026-10-14  **Audience:** Product owner, Angular engineers, QA, backend/architecture
**Sources:** `docs/requirements/baseline-v1.1.md` (baseline) and `docs/requirements/decisions-addendum.md` (addendum). **The addendum overrides the baseline.** Where this spec makes a UX choice the sources leave open, it is tagged **[UX-PROPOSAL]** and collected in Appendix D for product-owner confirmation.
Helper file: `docs/ux/tokens.css` (design tokens as CSS custom properties).

## Contents
1. Personas and top jobs-to-be-done
2. Information architecture and navigation
3. Design principles
4. Design tokens, badges, accessibility (WCAG 2.1 AA)
5. Global patterns (app shell, tables, forms, dialogs, errors, permissions, numbers)
6. Screen specifications S01 to S22
7. Component inventory (Angular)
8. Copy deck
9. User-acceptance checklists per screen
- Appendix A: Addendum deltas applied to baseline §19
- Appendix B: Status transition rules used by the UI
- Appendix C: Permission-to-UI map
- Appendix D: UX proposals and open questions

---

## 1. Personas and top jobs-to-be-done

Roles are configurable permission sets, not hard-coded branches. Personas are typical holders of the starter roles. Attorneys and paralegals (requestors) are **not users** in Phase 1; they appear only as free-text Requestor Name/Email.

| Persona | Typical role | Context | Top jobs-to-be-done (JTBD) |
|---|---|---|---|
| **Dana, Project Manager** | Project Manager | Receives requests by email from attorneys; creates and prioritizes work; 10+ tasks/day across Pods | 1) Turn an Outlook email into a Task in under a minute. 2) See what is unassigned or at risk and assign it. 3) Find any Matter/Task fast by number. 4) Answer "where is my request?" without opening each task. |
| **Tariq, Data Technician** | Data Technician (Pods A and B) | Executes workflows in Relativity etc. outside the tracker; records results here | 1) See my work across all my Pods, most urgent first. 2) Work the workflow steps in order and record operational values. 3) Pick up unassigned Pod work (assign to myself). 4) Leave comments / record outside approvals. 5) Reopen and fix a step. |
| **Priya, Pod Lead** | Pod Lead (a role, not a per-Pod flag) | Balances load in a Pod | 1) See Pod Work: tasks not yet with a person, per-member load, overdue/on-hold. 2) Reassign quickly. 3) Change priority. |
| **Marcus, eDiscovery Director** | Director | Oversight, no daily execution | 1) Department overview: open, unassigned, overdue, aging. 2) Drill from a count into the filtered queue. (No productivity scoring, no billing.) |
| **Sam, Data Scientist** | Data Scientist | Similar to technician; specialist tasks | Same as Tariq; also creates Tasks for analytics requests. |
| **Alex, System Administrator** | System Admin (built-in) | Configures the system, onboards users | 1) Grant roles/Pods to newly registered users (pending queue). 2) Build Task Types, forms with conditional rules, steps, workflows; publish safely. 3) Maintain priorities, status labels, Asset Types, custom fields. 4) Offboard: find and reassign a leaver's open tasks one by one. |
| **Pending user** | No roles | First login | Understand that access is pending and what to do next. |

## 2. Information architecture and navigation

### 2.1 Site map

```text
Header (persistent): Logo | Global Search | [Create Task] | User menu (name, Windows account)
  Windows Integrated Auth: no sign-in/sign-out form.
Left nav (items hidden when the user lacks the matching View permission):
  Dashboard                        /dashboard
  My Work                          /my-work
  Task Queue                       /tasks
  Pod Work                         /pods/work
  Clients                          /clients, /clients/:id, /clients/new
  Matters                          /matters, /matters/:id, /matters/new
  Projects                         /projects (global list), /projects/:id    (also inside Matter)
  Assets                           /assets (global list), /assets/:id         (also inside Matter)
  ----
  Administration (permission-gated)  /admin
     Users                         /admin/users (Users tab), /admin/roles (Roles tab), /admin/pods (Pods tab, ?pod=<id>|new opens the pod editor);
                                   one menu item, highlighted on all three; shown with any of User.View/User.Manage/Role.Manage/Pod.Manage/Pod.ManageMembers
     Task Types                    /admin/task-types (Task Types tab), /admin/workflows (Workflows tab), /admin/steps (Workflow Steps tab);
                                   filtered links: /admin/workflows?taskType=:id, /admin/workflows?step=:id, /admin/task-types?workflow=:id;
                                   the pages /admin/task-types/new, /admin/task-types/:id[/form], /admin/workflows/new, /admin/workflows/:id[/versions/:v],
                                   /admin/steps/new, /admin/steps/:id[/form] keep their own URLs and highlight this item
     Labels                        /admin/priorities, /admin/status-labels
     Assets                        /admin/asset-types (tabs Asset Types, ?tab=link-roles = Asset Link Roles; page title "Asset types and link roles")
     Custom Fields                 /admin/custom-fields
     Audit Logs                    /admin/audit
Other routes
  Create Task                      /tasks/new   (+ ?matterId=&projectId= prefill)
  Task detail                      /tasks/:id   (?tab=details|workflow|comments|assets|activity)
  Search results                   /search?q=   ; Advanced Search /search/advanced
  Access Pending                   /access-pending  (only screen reachable with zero permissions)
  Forbidden / Not found / Error    /403 /404 /error
```

No notification bell, no approvals inbox, no billing widgets, no reports/exports (addendum F), no attachments tab (addendum C).

### 2.2 Navigation rules
- Left nav items require the matching `*.View` permission; unusable items are **hidden**. Within pages see §5.7 for hide vs disable.
- Default landing: My Work if the user has any Pod membership or assignment, else Task Queue, else Dashboard. A user with zero permissions is redirected to Access Pending from every route.
- Breadcrumbs on detail pages: `Clients > 00343 Acme Corp > 00343-00012 Merger Review > TSK-1042`.
- The combined Matter reference `#####-#####` (monospace, e.g. `00343-00012`) links to Matter detail wherever it appears.
- Every list row's primary identifier is a real link (keyboard reachable, middle-click opens a new tab).
- Create Task is reachable from header, Matter detail, Project detail, Pod Work and Task Queue.
- Unsaved-changes guard on all forms and designers.

## 3. Design principles

1. **Work first, administration second.** Queues and Task detail get the best layout; admin screens can be denser.
2. **Urgency is legible without inventing deadlines.** Priority is a labelled badge; due date is a date or **ASAP**; ASAP is never red and never "overdue".
3. **Lifecycle status is not workflow progress.** Two visibly different components: a status badge (5 fixed states, configurable labels) and a workflow stepper/progress bar. They never share colours or shapes.
4. **Matter number everywhere, in one format.** `00343-00012`, monospace.
5. **Never trust the client; always explain the server.** Server validation errors map to fields and a summary. Forbidden actions explain themselves.
6. **Forgiving and fast.** Few clicks to create, assign, step. Inline edits where permitted; no optimistic UI for workflow/status transitions.
7. **Reversible and auditable.** Reopen and edit are normal and cheap; Activity shows what changed. Cancel needs a reason, not a maze.
8. **Intake always has a manual path.** Outlook drag-drop is an enhancement; paste and manual entry always work.
9. **Accessible by default.** Keyboard operable, screen-reader labelled, colour never the only signal.
10. **Say what is not stored.** The system keeps no attachments and no original email. Tell the user at the point of intake.
11. **Desktop-first** (1280 px+ primary, usable at 1024; tablet-tolerant at 768; phones not a target).
12. **No people-scoring.** Counts describe work, not staff performance.

## 4. Design tokens, badges, accessibility

Tokens: `docs/ux/tokens.css`. Light theme only in Phase 1 (dark deferred; tokens are semantic so it can be added).

### 4.1 Color (light)
| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--mf-bg` | #F5F6F8 | App background | n/a |
| `--mf-surface` | #FFFFFF | Cards, tables, dialogs | n/a |
| `--mf-text` | #1B1F27 | Body text | 16.0:1 on surface |
| `--mf-text-muted` | #4B5563 | Secondary text | 7.6:1 |
| `--mf-primary` | #1F4E9C | Buttons, links, active nav | 7.9:1 |
| `--mf-border-strong` | #6B7280 | Input borders | 4.8:1 (>=3:1 required) |
| `--mf-focus` | #B45309 | 2 px focus ring, 2 px offset | >=3:1 on bg and surface |
| `--mf-danger` | #B42318 | Errors, overdue, destructive | 6.5:1 |
| `--mf-warning` | #8A4B00 | Due soon, on hold | 7.2:1 |
| `--mf-success` | #146C2E | Success, completed | 6.7:1 |
(Contrast ratios are design-time estimates; verify in the build with an automated checker.)

### 4.2 Typography
- Segoe UI (firm Windows estate) with system fallbacks; Consolas for Client/Matter numbers and task refs.
- Scale 12 / 13 / **14 (body, tables)** / 16 / 18 (H3) / 22 (H2) / 28 (H1); line height 1.45; weights 400 and 600.
- 12 px only for captions and badges (badges semibold). Non-table content works at 200% zoom and 400% reflow (WCAG 1.4.4, 1.4.10); tables scroll horizontally inside their own region.

### 4.3 Spacing and layout
4 px base: 4, 8, 12, 16, 24, 32, 48. Gutters 24 px. Forms single column, max 720 px; tables full width. Row height 40 (comfortable) or 32 (compact toggle). Minimum target 24x24 CSS px (buttons 32+).

### 4.4 Status badges (lifecycle)
Always show the (configurable) label text plus an icon; pill, 12 px semibold, 4 px radius. Internal code kept in `data-status`.

| Code | Default label | Fg / Bg | Icon |
|---|---|---|---|
| `NEW` | New | #1F4E9C / #E3ECFA | circle-dot |
| `IN_PROGRESS` | In Progress | #0B5E55 / #DDF3EF | play-circle |
| `ON_HOLD` | On Hold | #8A4B00 / #FFF4DB | pause-circle |
| `COMPLETED` | Completed | #146C2E / #E5F5EA | check-circle |
| `CANCELLED` | Cancelled | #4B5563 / #ECEEF1 | x-circle |

### 4.5 Priority badges
Admin-defined labels ordered by `SortOrder` (first = most urgent). Badge = label text + small level-bar glyph (1 to 4 bars by rank) so it is not colour-only. Defaults: **Critical** (white on #B42318), **High** (#5C2E00 on #FFD9A8), **Normal** (#1B1F27 on #E3E7EE), **Low** (#3B4350 on #F1F3F6). Admin colour overrides are validated for 4.5:1 text contrast on the Priorities screen; extra priorities use a neutral style plus glyph. Priority is never shown as a number.

### 4.6 Due date display (`DueCell`)
| Case | Display | Style |
|---|---|---|
| No due date | **ASAP** | Bold blue outlined pill. Never red. Tooltip "No due date set. Handle promptly." Never overdue, never counted as overdue. |
| Future date, more than 2 days away | `Oct 28, 2026` | Normal |
| Due today or within 2 days | date + "Due soon" | Amber text + clock icon [UX-PROPOSAL: 2-day threshold] |
| Date + time | `Oct 28, 2026 3:00 PM` | Same colour rules |
| Overdue (date-only: after 23:59 firm time on that date; with time: after that time) and status not Completed/Cancelled | date + "Overdue 4d" | Red text + alert icon |
| Completed/Cancelled | Date, muted | No overdue styling |
Dates render in the **single firm timezone** (tooltip shows the zone abbreviation). Storage is UTC (backend concern).

### 4.7 Accessibility (WCAG 2.1 AA)
- **Perceivable:** 4.5:1 text, 3:1 UI components and focus indicators; no colour-only meaning (badges have text+icon, errors icon+text, required fields say "(required)"); meaningful icons have text alternatives, decorative `aria-hidden`; reflow and text-spacing tolerant.
- **Operable:** everything keyboard accessible; logical tab order; visible 2 px focus ring; skip-to-content link; dialogs trap focus legitimately, close on Esc and return focus to the invoker; **every drag-and-drop interaction (Outlook drop, workflow step reorder, form-designer field reorder) has a keyboard/button alternative** (Paste, file picker, Move up/down); no time limits; no flashing.
- **Understandable:** `lang="en"`; every input has a visible `<label>`; errors in text, tied via `aria-describedby`; form-level error summary focused on failed submit with links to fields; consistent navigation; confirmation for destructive actions.
- **Robust:** landmarks (`header`, `nav`, `main`), ordered headings, real `<table>` with `<th scope>`, `aria-sort` on sortable headers; polite live region for toasts/async results, `role=alert` for errors (WCAG 4.1.3); dialogs `role=dialog aria-modal aria-labelledby`; WAI-ARIA tabs; ARIA 1.2 combobox for typeaheads; stepper as ordered list with `aria-current="step"`; rich-text toolbar with labelled buttons and shortcuts (Ctrl+B, Ctrl+I, Ctrl+K).
- Test with NVDA + Edge/Chrome (firm stack), keyboard only, 200% zoom, Windows forced-colors (badges keep borders and icons).

---

## 5. Global patterns

### 5.1 App shell
```text
+--------------------------------------------------------------------------------------+
| [MatterFlow]  [ Search clients, matters, tasks, assets...  (Ctrl+K) ]  [+ Create Task]  Alex D v |
+----------------+---------------------------------------------------------------------+
| Dashboard      |  Breadcrumb > trail                                                 |
| My Work        |  Page title (H1)                      [Primary action] [Secondary v]|
| Task Queue     |  ----------------------------------------------------------------- |
| Pod Work       |  Page content                                                       |
| Clients        |                                                                     |
| Matters        |                                                                     |
| Projects       |                                                                     |
| Assets         |                                                                     |
| ----------     |                                                                     |
| Administration |                                                                     |
+----------------+---------------------------------------------------------------------+
 Non-production only: "Dev auth: acting as <user> [switch]" banner (development auth provider).
```
Left nav collapses to icons under 1100 px. Skip link first in DOM. Slim banners for: inactive-matter context, connection lost, dev-auth.

### 5.2 Tables (all queues and lists)
- Server-side pagination (default 50; 25/50/100), sort and filter. "Showing 1-50 of 312".
- Sortable headers are buttons with `aria-sort`. Column chooser and density toggle per user (remembered); Ref and Title cannot be hidden.
- Filters: chip bar above the table, removable chips, "Clear all". Filter state lives in the URL (shareable, back-button safe). Drawer on narrow widths.
- Loading: 5 skeleton rows with `aria-busy`; refresh keeps old rows dimmed. Empty: message + primary action when permitted. Empty after filtering: "No results match these filters" + Clear filters. Error: inline alert with Retry, keeping previous rows.
- Row actions: title link; overflow menu for secondary actions; inline edit of Priority/Assignee/Pod only with `Task.SetPriority`/`Task.Assign`/`Task.Reassign` (saves on change, toast with Undo for 8 s [UX-PROPOSAL]).
- No selection checkboxes in Phase 1 (bulk reassign dropped).

### 5.3 Forms and validation
- Single column; label above input; "(required)" text after labels; help text beneath; errors beneath with icon.
- Validate on blur for format, on submit for required/cross-field. Server errors map by field key; unmapped ones go into a top summary.
- Submit buttons are not disabled just because the form is invalid; disabled only while saving ("Saving...").
- Concurrency: edits send the row-version; on conflict the dialog offers "Reload latest" / "Review my changes" (field-level diff).
- Unsaved-changes guard: "You have unsaved changes. Leave / Stay".

### 5.4 Dialogs
Modal for confirmations and short forms (<= 5 fields); pages or drawers for larger. Destructive primary buttons use danger style and are not the default focus. Titles state the action; bodies state the consequence; buttons use verbs ("Cancel task", "Keep task"), never OK/Yes/No.

### 5.5 Rich-text editor (comments and Task description)
Toolbar: Bold, Italic, Bulleted list, Numbered list, Link, Insert table (decision R, issue #80). No images, files, colours, fonts or mentions. **Tables:** Insert table opens a small form (Rows 1-8, Columns 1-8, Header row); with the caret in a table a second toolbar ("Table") offers Row above, Row below, Delete row, Column left, Column right, Delete column, Delete table (merged cells are stretched or shrunk, never duplicated). Tab and Shift+Tab move between cells and, at the first and last cell, leave the editor (no keyboard trap); every table action is announced in a polite live region ("Row added below. Now row 3 of 3, column 2 of 2."). A field holds at most 200 table cells. **Paste and drop:** HTML from Outlook, Word or a web page is rebuilt from the allow-list (paragraphs, bold, italic, underline, lists, http/https/mailto links, tables with merged cells and header scopes); styles, classes, fonts, images and everything else are dropped; a table over 200 cells is pasted as plain text with a notice. Wide tables scroll inside their own box in the editor and in the read view (`mf-rich`). Link dialog accepts `http(s)` and `mailto:`; links open in a new tab with `rel=noopener noreferrer`. Character counter near the limit [UX-PROPOSAL: 10,000]. The server sanitizes again; the UI renders only sanitized HTML.

### 5.6 Error and system states
| State | Pattern |
|---|---|
| Windows auth failed | Full-page "Can't verify your Windows sign-in", Retry, contact guidance (browser handles the credential prompt) |
| Zero permissions | Redirect to Access Pending (S21) |
| 403 page | "You don't have permission to view this." + link home |
| 403 action | Toast: "You don't have permission to <action>."; permission state reloads |
| 404 | "We couldn't find that." with search box |
| 409 conflict | Conflict dialog (§5.3) |
| 422 validation | Field errors + summary |
| 5xx / network | Inline alert "Something went wrong. Try again." with Retry and copyable reference id |
| Permissions removed mid-session | Next 403 triggers permission refresh; if none left, redirect to Access Pending |

### 5.7 Permission-gated actions: hide vs disable
- **Hide** when the user lacks the permission and the action is unrelated to their context (e.g. "New Client" without `Client.Create`).
- **Disable with a visible reason (text reachable by focus, `aria-describedby`)** when permitted in general but blocked by state: Reopen or Create Task on an inactive Matter; Complete with unresolved steps; Set Matter inactive with open Tasks.
- Angular gating is for usability only; the backend authorizes every call.
- Phase 1 visibility: anyone with `Task.View` sees all Tasks; no Matter-level hiding in the UI (ethical walls deferred).

### 5.8 Numbers (Client and Matter) pattern (addendum B)
- Inputs accept **1 to 5 digits** and show the normalized value live: typing `343` shows "Will be saved as 00343". Non-digits: "Use digits only." More than 5: "Use at most 5 digits." Whether `0` is allowed is an open question (Appendix D).
- Elsewhere the padded form is displayed: `00343` and `00343-00012`.
- All search/lookup/typeahead fields accept padded, unpadded and hyphenated forms: `343`, `00343`, `343-12`, `00343-00012` all find Matter 00343-00012.
- Numbers are read-only after creation; a restricted, audited "Change number" action (confirm dialog) exists for users with edit permission [UX-PROPOSAL, per baseline §3.1].

---

## 6. Screen specifications

Screen IDs map to baseline §19 (item number in brackets). Each spec: purpose, layout, components (see §7), fields, states, validation, permission-gated actions, key interactions.

| ID | Screen | §19 |
|---|---|---|
| S01 | Dashboard | 1 |
| S02 | My Work | 2 |
| S03 | Task Queue | 3 |
| S04 | Pod Work | 4 |
| S05 | Clients (list, create/edit, detail) | 5 |
| S06 | Matters (list, create/edit, detail) | 6 |
| S07 | Projects (create/edit/detail) | 7 |
| S08 | Assets (list, create/edit, detail) | 8 |
| S09 | Create Task / create from Outlook email | 9 |
| S10 | Task detail | 10 |
| S11 | Search results and Advanced Search | 11 |
| S12 | Admin: Users, pending users, roles/permissions | 12 |
| S13 | Admin: Pods | 13 |
| S14 | Admin: Task Types and form designer | 14 |
| S15 | Admin: Workflow Steps (third tab of Task Types, with tags) | 15 |
| S16 | Admin: Workflow designer and publish | 16 |
| S17 | Admin: Asset Types | 17 |
| S18 | Admin: Priorities, status labels, custom fields | 18 |
| S19 | Admin: Audit Logs | 19 |
| S20 | Global search typeahead (header) | 13.1 |
| S21 | Access Pending | 6.4 |
| S22 | System pages (403, 404, error, conflict) | n/a |

**Addendum deltas applied across all screens:** no attachment upload/list/tab, no File Upload form control, no source-email file; Task Type/Workflow/Matter immutable after creation; Requestor Name (required) and Requestor Email (optional) on every Task; comments are rich text, internal, soft-deletable; no ethical-wall UI; no reports/exports; no bulk reassign; no subtasks/dependencies/related tasks/cloning.

---

### S01 Dashboard

**Purpose.** Department overview for oversight; drill-through to filtered Task Queue. Not billing, not staff scoring.
**Who.** "The Dashboard is not for everyone": it needs `Dashboard.View` (menu item and route; without it the route is the 403 page and the Dashboard item is hidden), and each tab its own permission: Summary `Dashboard.ViewSummary` (everything on Summary) or `Dashboard.ViewUnassigned` (the unassigned queue alone), Breakdowns `Dashboard.ViewBreakdowns`, Trends `Dashboard.ViewTrends`, Swimlane `Dashboard.ViewSwimlane`, Users `Dashboard.ViewUsers`. A tab permission only has effect together with `Dashboard.View`.

```text
Dashboard                                             Period: [30 days v]
+-----------+ +-----------+ +-----------+ +-----------+ +-----------+
| Open      | | Unassigned| | Overdue   | | On Hold   | | Completed |
| 128       | | 17        | | 9         | | 12        | | 94 (30d)  |
| [View]    | | [View]    | | [View]    | | [View]    | | [View]    |
+-----------+ +-----------+ +-----------+ +-----------+ +-----------+
+--------------------------------+ +----------------------------------+
| Open by Pod            (bars)  | | Open by Priority        (bars)   |
|  Pod A  ######## 40            | |  Critical ## 6                    |
|  Pod B  ###### 31  ...         | |  High   ###### 29 ...             |
|  (no pod) ## 17                | |                                   |
+--------------------------------+ +----------------------------------+
| Open by Task Type (bars)       | | Open by Status (bars)            |
+--------------------------------+ +----------------------------------+
| Aging: open > 7d / 14d / 30d   | | Recently created   | Recently completed |
| (by priority, counts)          | | TSK-1051 ...       | TSK-1040 ...       |
+--------------------------------+ +----------------------------------+
```
**Components.** `StatTile` (number + label + link), `BarListChart` (accessible horizontal bars with numbers, plus data-table toggle "View as table"), `RecentTaskList`, `PeriodSelect`.
**Behavior.**
- Every tile and bar is a link to `/tasks` with the equivalent filters preset (e.g. Overdue tile: `status=open&overdue=true`; "Unassigned" = no assigned user; Pod bar = Pod filter). Counts honour the Task Queue definitions exactly, so counts match the list the user lands on.
- Overdue counts exclude ASAP tasks and Completed/Cancelled (never ASAP). A caption on the tile reads "Excludes ASAP tasks".
- "On Hold" doubles as the baseline's blocked/on-hold indicator.
- Charts use the categorical palette only for Pod/Type bars; every bar has a text value. Priority and status bars reuse badge colours + labels.
- No per-person productivity chart, no hours, no revenue.
**States.** Loading: tile skeletons. Empty (no tasks yet): "No tasks yet. Create the first task." with button (needs `Task.Create`). Error: per-widget inline error with Retry so one failing widget does not blank the page.
**Permission.** Only the permitted tabs are shown; the first permitted tab is the default and a link to a forbidden tab falls back to it, with a one-line dismissible note under the tab row ("Breakdowns is not available for your role. Showing Summary."; "That tab does not exist. Showing Summary." for an unknown name) and the address is rewritten with replace. The address holds only values that differ from the default (`dashUrlState`). The Dashboard menu item is shown only with `Dashboard.View` and at least one tab permission (`Dashboard.ViewCoverage` alone does not count: it is a sub-view of Users; the helper is `AuthStore.hasAnyDashboardTab`, also used for the post-login landing). The route stays reachable: with `Dashboard.View` but no tab permission the page shows a short note ("No Dashboard tab is turned on for your role...") with a link to My Work. The server redacts the data of tabs the person may not see (counts, charts, trend). Summary has two layers: with `Dashboard.ViewSummary` it shows the Needs attention and Overview tiles, the Unassigned queue (with `Task.Assign` or `Dashboard.ViewUnassigned`) and the Overdue and Due soon lists; with `Dashboard.ViewUnassigned` alone (technicians) the Summary tab contains only the Unassigned queue (no tiles, no period control, no other lists) and the server sends no department-wide counts. The post-login landing page is never the Dashboard for people without `Dashboard.View` (My Work or the Task Queue, else the first screen they may open).
**Refresh.** One icon-only Refresh button (aria-label "Refresh", tooltip "Refresh. Updated 10:42 AM. Refreshes itself every 5 minutes.", spinner and `aria-busy` while reading) at the right end of the tab row, on every tab (Summary, Breakdowns, Trends, Swimlane, Users); it refreshes the tab shown. There is no visible "Updated" text; the time of the last read is the tooltip. The page also refreshes itself every 5 minutes while visible, and a failed refresh keeps the figures with a banner and Retry.

**Scope (UX review 2, P1, issue #89).** One page-wide Scope select, labelled "Scope", sits at the right end of the tab row, left of Refresh, on every tab (with a single permitted tab or the Technician variant, where the tab list is hidden, it sits next to the heading and Refresh; at 375 px it wraps onto the line below with the other controls, never a horizontal page scroll). Options: "All pods", "My pods" (only for a member of at least one active pod), then the person's own pods, then, only with `Pod.View`, "Other pods". The scope in effect is always text in the control and a change is announced in the page's polite live region ("Scope: Review Alpha"). A task belongs to a pod when its Pod field equals the pod, exactly the Task Queue `pod` filter, so every scoped number equals the count behind its link; "My pods" is the union of the person's pods; tasks with no pod belong to no pod scope and appear only under All pods, and under a pod scope the Summary says so in one quiet line above the lists ("N unassigned tasks have no pod. Show all pods", the link sets All pods). Applies to the Summary (tiles and the three lists), Breakdowns, Trends, Swimlane (task pod), Users workload and Coverage (members of the pod); the per-tab Pod controls of Swimlane (Filters), Users and Coverage are gone. Address: `?pod=all|mine|<id>`; the default is not written. Default (decision PM): My pods for anyone who is a member of at least one active pod, otherwise All pods (membership only, never role names, so it survives custom roles); the last explicit choice made with the control is remembered per user in this browser (`mf.dashboard.scope.v1.<user>`, guarded) and the address wins over it without changing it. An address that names a pod the person may not see (or "mine" without a pod) falls back to the default and says so in the one-line note under the tab row ("That pod is not available to you. Showing My pods."); the API answers 403 for such a pod. The old links are read once and rewritten: the Users tab's `upod=<id>` and the Swimlane `pod=<id>` filter become `pod=<id>`. A new scope shows the tab's skeleton and reads only the tab on screen (the other tabs read it when opened); the tab choice keeps the scope. An empty pod keeps the tabs (only an empty department shows the "No tasks yet" page). The control is a native `select`, 32 px high, keyboard operable.

**Users tab, Workload view (UX review 2, WP10a, issues #127, #128, #130, #133).** Population ("can take work"): active people who are members of at least one active pod or hold at least one open task; the server applies it (`includeNoPod`, default off in the page, `unopod=1` shows everyone, `hiddenCount` in the answer) and a quiet line says "Showing N people who can take work. M others are hidden. Show them" (nothing is hidden under a Pod scope); the Assign picker and Coverage are not affected. Toolbar: a text group of two toggle buttons "Workload | Coverage" first (`aria-pressed`, not a tablist, only with `Dashboard.ViewCoverage`), then search and filters, then icon buttons for tile size and layout with state-aware names, text tooltips on hover and focus, 32 px targets, and "Legend" (word from 1100 px). Capacity strip above the chips: one bar stacked by load level, each segment a filter button synchronised with its chip, "N unassigned tasks" linking to the Task Queue within the scope, and an Assign work menu (people who can take work now; the unassigned queue). Idle is a light tint with a thin outline; saturated fills stay for Heavy and Out of office. Details: `docs/ux/dashboard-users/README.md`.

**Users tab, Coverage (UX review 2, WP11, issues #134, #135, #136).** Two orientations behind a text switch "By task type | Matrix" (first in the Coverage toolbar, `aria-pressed`; `cov=matrix` only when the matrix is chosen). By task type (default): a table (cards below 561 px) with a disclosure button, Task type, Handled by (first five names alphabetically, then "+N"; names are plain text, never ordered by count), People, Completed and Status ("No one" neutral, "One person" amber, both with an icon); order "Fewest people first" (default), "Type name", "Most completed"; a row opens the people with their counts (each opens the Coverage drawer) and "Show people in <pod> who have not handled this type" (needs a pod scope). Above both orientations: a neutral collapsed statement "N task types had no completed tasks in this period." and an amber `role="status"` statement "N task types were handled by only one person in this period: <types>. Consider cross-training." (zero is informational, exactly one is the warning; no "gap" or "bus factor" wording). Matrix: zeros are blank (named "Ana B., Redaction: 0 completed"), possible training gaps are outlined with an icon only while the "Training gaps" toggle is on (default off), 30 people and 60 task types are drawn with "Show more". Details: `docs/ux/dashboard-users/README.md`, addendum Q.

**Tile deltas (UX review 2, S3, issue #102).** Four Summary tiles carry one line of change under their caption, in words with a glyph, never colour alone: Overdue and Open compared with the end of yesterday ("▲ +8 vs yesterday", "▼ -3 vs yesterday", "= no change vs yesterday"), Completed and Created compared with the period of equal length directly before the selected one ("▲ +14 vs previous 30 days"; for This month the same days of last month, "vs same days last month"). Unassigned, On hold, Due soon and ASAP have no line (there is no history to compare with). The glyph and the visible words are decoration for a screen reader, which hears "8 more than yesterday" / "3 fewer than yesterday" / "No change compared with yesterday" as part of the tile's one link; the tooltip says what the baseline was and repeats the Trends caveat (current due dates, no status replay). Only Overdue going up uses the attention colour (the red of the tile); every other change, a fall in Overdue included, is neutral text, and green is not used. A zero change is "no change", never "+0". API (`GET /api/v1/dashboard`, additive, nullable): `overdueYesterday` and `openYesterday` are the Trends snapshot of yesterday for the same scope (created by the end of the viewer's yesterday, not Completed or Cancelled by then, a due moment that had passed by then; so tile minus delta equals yesterday's Trends point), `completedPrevious` and `createdPrevious` count the `previousPeriod` (`kind` `previous` or `same-days-last-month`, `from`, `to`). A field is null, and its line absent, when the scope held no task at the baseline (yesterday) or none before the start of the previous period (an account or pod younger than the comparison: no partial count, no NaN). The comparison follows the page period (P3) and scope (P1) and is cached with them. The line wraps inside the tile at 375 and 320 px.

**Technician Summary (UX review 2, S9, issue #108).** With `Dashboard.ViewUnassigned` and no `Dashboard.ViewSummary` the Summary is the unassigned queue alone. When it is the only content (one permitted tab) the heading is "Unassigned work", there is no tab row, and the Scope select and Refresh sit on the heading row. Above the queue: the own-work line ("You have 6 open, 1 overdue. Open My Work", the counts are the viewer's own open and overdue tasks by the Task Queue definitions, `mine { open, overdue }` in the dashboard payload only for this variant, whatever the scope; neutral wording, no ranking or comparison; the link needs `Task.View`), then Priority and Task type filters built with the column-filter foundation (`ListFilters`, `mf-filter-control` and `mf-filter-chips`, not new filter UI). The address carries `sprio` and `stype` (comma lists of ids; repeated parameters are read too; defaults not written; a tab change drops them) and the queue is asked from the Task Queue itself with `priority` and `type`, so the list, its count and "Showing N of M" equal the Task Queue for the same filter and "View all" opens it with the same filters; a change of filter reads the queue again from the first row. A person in no pod gets All pods and the quiet note "You are not in a pod yet. Showing all pods."; the "N unassigned tasks have no pod" line of the Scope also applies. Empty states use the shared state block: "No unassigned tasks match these filters." with Clear filters, and "Nothing is unassigned in <scope>." with Show all pods. A holder of `Dashboard.ViewSummary` never sees this variant (the full Summary, with or without `Dashboard.ViewUnassigned`).

**Tabs (epic #68).** The page has five tabs (WAI-ARIA tabs, `?tab=` in the address, never remembered): Summary, Breakdowns, Trends, Swimlane and Users, all for `Dashboard.ViewDepartment`. Swimlane is specified below; Users (team workload) is issue #73.

**Breakdowns tab (epic #85).** One caption, "Open tasks, now. Not affected by the period.", with the legend (Not overdue / Overdue), then four cards, each with one title (H3 under a visually hidden H2 "Open tasks"): Priority, Task type, Status and Age. Every bar is split into not overdue and overdue: the bar length is the row total, the overdue segment (existing danger tokens, hatched, 2 px minimum) is proportional and links to the Task Queue with the row's filter plus `overdue=true`, and "N overdue" (hidden at 0) is the same link as text; the row link to the total is unchanged and "View as table" adds an Overdue column. Overdue is the Overdue tile's definition (ASAP never overdue, closed tasks excluded), so the overdue of the rows of each card adds up to the tile. Age has six buckets (constants in `DashboardRules.AgingBands`, Age = whole days since creation in the viewer's zone): 0-2, 3-7, 8-14, 15-30, 31-60 and more than 60 days; they add up to Open, each links with `createdFrom`/`createdTo`, the caption "not a service-level target" stays. Low priority is drawn with a dashed 2 px outline and a lighter fill, Normal with a solid 1 px outline (no new colour token). Grid by the width of the tab (container query; the tab keeps its 1360 px cap): four equal cards from 1300 px, two columns flowing top to bottom from 700 px, one below; cards are never stretched and the DOM and tab order stay Priority, Task type, Status, Age. API: `overdue` on every breakdown row and aging bucket of `GET /api/v1/dashboard` (additive); the age bucket list grew from four to six. Screenshots: `docs/ux/dashboard-review-2/fixes/wp7/`.

#### S01b Swimlane tab (issue #72)

**Purpose.** Show where every open task stands as cards in four lanes, and who holds what, without drag and drop. An operational view, not a performance evaluation: no per-person completion figures, speed or ranking.
**Layout.** Lanes are columns: **New | In Progress | On Hold | Completed**. A sticky lane header shows the exact count and a cue ("oldest 5d" for the open lanes). Each lane scrolls vertically by itself (the board is the height of the screen minus the page above it); the board scrolls sideways inside itself between 900 and about 1100 px, and below 900 px the lanes stack. A lane draws 40 cards at a time ("Show 40 more of N hidden"); a lane holds at most 200 cards and says "Showing 200 of N. Open the Task Queue" (a link with the same filters) when capped. Completed holds Completed and Cancelled tasks whose last status change is in the window (7, 14 or 30 days, default 7).
**Toolbar (one row from 1100 px, two lines at most below; WP9a, #122).** Search (title or ref), Group (None, Priority, Assignee, Client / matter), Sort (Priority, Due date, Client / matter, Created), Filters (count on the button: Assignee incl. Unassigned, Task type, Priority, Overdue only; the Pod is the page-wide Scope) and a "..." menu button (`aria-haspopup="menu"`, Enter or Arrow Down opens, arrows, Home and End move, Esc closes and returns the focus) holding Density (Comfortable, Compact), "Done in the last" (7, 14, 30 days), Only mine and, when grouped, Expand all / Collapse all. Settings in the menu that differ from the defaults (Compact, a window other than 7 days, Only mine) show as text chips beside the button. The refresh icon is in the Dashboard tab row.
**Card.** Left bar in the priority colour (same tokens as the priority badge), the level-bar icon and the priority text (never colour alone), task type icon, task number link, title clamped to two lines, client and matter name on one line (below), assignee with initials and an Out of office flag, due chip (Overdue 2d, Due today, Tomorrow, ASAP or the date, in the viewer's zone; Done / Cancelled date in the Completed lane), workflow progress bar with "2/4", and a lock for a sensitive matter. Status, Priority and Assignee are the inline menus of the queues (`mf-row-edit`) with the same rules, dialogs (Hold, Cancel, Complete, Reopen) and Undo. A card whose status changes moves to the right lane at once. The whole card opens the drawer. **Compact (W1):** a one-line card of 44 px: priority bar with the level glyph, task type icon, task number link, title (one line), assignee initials (with the Out of office flag) and the due chip; client, matter, priority and assignee names are in the hover text, the menus and progress in the drawer (`m` opens the drawer on this card). **Client / matter (W3):** one line "Client / Matter name" (the matter number is in the hover text and in the drawer); cards of a client / matter tree omit it (the group is the client and matter); cards of an assignee group omit the assignee. **Lane count (W2):** the count in the lane header is a link to the Task Queue (lane status, Done window start for Completed, page scope and the filters the queue can show); search text is left out and the link says so ("Search text is not included").
**Grouping.** Priority: groups in rank order with a coloured header. Assignee: avatar, name and an Out of office chip, Unassigned last. Client / matter: a WAI-ARIA tree per lane (`role="tree"`, `treeitem`, `aria-level` 1 client, 2 matter, 3 card, `aria-expanded`), indented one step per level, a count on every node, collapse state shared by all lanes.
**Drawer peek.** Right-side modal dialog (focus trapped, Esc or Close returns focus to the card): summary, workflow steps with state words, the three latest comments, the same inline menus, "Open full task".
**Keyboard.** One tab stop per lane. Up, Down, Home, End move between cards (tree: Right opens or steps in, Left closes or steps out); Left and Right (Shift with them inside the tree) move to the neighbouring lane; Enter opens the drawer; `m` opens the status menu; a "Skip lane" button leads to the next lane.
**Refresh.** Every 5 minutes while the tab is visible, skipped while a menu, dialog or the drawer is open, never moves focus; a failed background read keeps the board and shows a banner with Retry. First load: skeleton cards per lane; error: alert with reference and Retry.

---

### S02 My Work

**Purpose.** Everything assigned to me, from **all my Pods**, most urgent first.

```text
My Work
[ Active (23) ] [ Due Soon (4) ] [ Completed ] [ Created by Me ]
Search in my work [____________]  Filters: [Pod v] [Priority v] [Status v] [Matter v]   (chips: x Pod A)
+----+----------+-----------------------------+------------+----------+-------------+-------------+--------------+
| !  | Ref      | Title                       | Matter     | Priority | Workflow    | Due         | Status       |
|    |          |                             |            |          | progress    |             |              |
+----+----------+-----------------------------+------------+----------+-------------+-------------+--------------+
|    | TSK-1042 | Process Smith custodians    | 00343-00012| [Critical]| Step 3/6 Dedup | ASAP     | In Progress  |
|    | TSK-1039 | Export production vol 004   | 00101-00003| [High]   | 4/5 [====-] | Oct 16 Due soon| On Hold     |
+----+----------+-----------------------------+------------+----------+-------------+-------------+--------------+
Showing 1-23 of 23                                           < 1 2 >
```
**Tabs.**
- **Active** (default): assigned to me (`AssignedUserId = me`), status NEW / IN_PROGRESS / ON_HOLD.
- **Due Soon**: my active tasks with an explicit due date in the next 2 days or overdue. ASAP tasks are **not** in Due Soon (they have no due date) [UX-PROPOSAL; reason: avoids ASAP flooding]. Tab help text says so.
- **Completed**: my Completed/Cancelled tasks, newest first, 90-day default window with date filter.
- **Created by Me**: tasks I created, any status, any assignee.
Tab counts update with filters.
**Columns.** Ref, Title, Matter (combined ref + matter name in tooltip), Priority badge, Workflow progress (current step name + "n of m resolved" + mini progress bar with text), Due (`DueCell`), Status badge, Pod, Requestor (optional). Default sort per Task Queue rule (below). Header sort available.
**Default sort (addendum G).** Priority (admin order, Critical first); within priority, **ASAP first**, then explicit due dates ascending (overdue/oldest due first); ASAP ties by age oldest first; explicit-date ties by age oldest first. See S03 for the definition and a visual cue.
**Row actions.** Open; "Change status" quick menu (valid transitions only); inline Priority (if `Task.SetPriority`); "Unassign / Reassign" via assignee picker (if permitted). Assigning a user from a NEW task moves it to In Progress; the inline control shows the helper "Assigning a person starts the task."
**States.** Empty Active: "Nothing assigned to you right now. Check Pod Work for unassigned tasks." (link). Loading skeleton. Error banner with Retry.
**Permissions.** Needs `Task.View`. Inline controls follow permission; read-only users see plain text.

---

### S03 Task Queue (shared queue)

**Purpose.** Shared, searchable, filterable list of every Task. The source for dashboard drill-through.

```text
Task Queue                                                       [+ Create Task]
Search title or ref [ TSK-10 or "dedup"          ]  [Filters (3) v]  [Columns v] [Density v]
Quick views: (All open) (Unassigned) (My Pod) (Created by me) (Overdue) (Recently completed)
Chips: Status: Open x | Priority: Critical, High x | Pod: Pod A x         [Clear all]
+------------------------------------------------------------------------------------------------------+
| Ref v | Title | Matter | Project | Type | Workflow | Priority | Pod | Assignee | Requestor | Due | Status | Age |
+------------------------------------------------------------------------------------------------------+
| ... rows ...                                                                                         |
+------------------------------------------------------------------------------------------------------+
Showing 1-50 of 312   Rows per page [50 v]   < 1 2 3 ... >
```
**Filter drawer fields.**
| Filter | Control | Notes |
|---|---|---|
| Search | text | Matches Task title and ref (`TSK-1042`, `1042`); case-insensitive, partial |
| Client | typeahead (number or name; padded/unpadded) | |
| Matter | typeahead (number `343-12`, `00343-00012` or name); dependent on Client if set | Shows inactive matters with "(inactive)" |
| Project | typeahead, dependent on Matter | |
| Task Type | multi-select | |
| Workflow | multi-select (workflow names) | |
| Pod | multi-select + "No Pod" | |
| Assignee | multi-select incl. **inactive users marked "(inactive)"** + "Unassigned" (addendum E) | |
| Creator | multi-select users (incl. inactive) | |
| Requestor | text contains (name or email) | requestors are free text |
| Status | multi-select by display label; preset groups "Open" = New + In Progress + On Hold | |
| Priority | multi-select by label | |
| Due date | range picker (from/to) | applies to explicit dates only |
| ASAP | tri-state: Any / ASAP only / Has due date | |
| Overdue | tri-state: Any / Overdue only / Not overdue | ASAP never matches Overdue |
| Created / Completed date | ranges | |
**Columns** (configurable per user; Ref and Title locked): Ref, Title, Matter, Client name, Project, Task Type, Workflow, Priority, Pod, Assignee, Creator, Requestor, Due, Status, Age (days since created), Created, Updated, Workflow progress.
**Default sort and its cue.** Priority order, then ASAP first, then due date ascending, then age oldest first. Sort indicator reads "Default order: Priority, ASAP first, Due date, Oldest" (info icon explains). Choosing a header sort replaces it; "Reset sort" restores.
**Inline editing (only where authorized).** Priority (needs `Task.SetPriority`), Assignee and Pod (needs `Task.Assign`/`Task.Reassign`). Controls are hidden if not authorized; cells for Completed/Cancelled tasks are read-only (editing requires moving back to In Progress via Task detail). Changing priority/assignee/pod writes immediately, toast "Priority set to High. Undo". Assignee picker lists active users first; inactive users are not offered as new assignees but are shown if currently assigned.
**Row hints.** Overdue rows get a red leading bar + "Overdue" text in Due; ASAP shows the ASAP pill; unassigned shows "Unassigned" muted italic in Assignee (and "-" when also no Pod).
**States.** Empty (no tasks at all): "No tasks yet." + Create Task if allowed. Empty filtered: "No tasks match these filters." + Clear filters. Loading: skeleton. Error: alert + Retry.
**Permissions.** `Task.View` for the page. Create button needs `Task.Create`. No bulk selection/actions.
**Interactions.** Filter state persisted in URL; column and density preference persisted per user; Enter on a focused row link opens detail; `/` focuses the table search.

---

### S04 Pod Work

**Purpose.** Pod-wide view: who has what, what is unclaimed.

```text
Pod Work       Pod: [Pod A v]  (your Pods first; Primary Pod default)       [+ Create Task]
Summary: Unassigned to a person 6 | Assigned 31 | Overdue 3 | On Hold 4
[ Pod queue (unassigned to person) (6) ] [ By member ] [ Overdue & On Hold (7) ] [ All Pod tasks (37) ]

Pod queue tab: table identical to Task Queue columns, scoped to Pod = selected, Assignee empty.
  Row action: [Assign to me] [Assign to... v]

By member tab:
  Tariq M.   9 open | 1 overdue    [expand v]  -> task rows
  Sam K.     5 open | 0 overdue
  Unassigned 6
```
**Pod selector.** Lists the user's Pod memberships first (Primary Pod preselected if set), then, only for users with `Pod.View` scope, all other Pods under "Other Pods". Last selection remembered. A Pod with no members shows "No members yet".
**Behavior.**
- "Assign to me" is the lightweight self-assign (ordinary assignment, no separate claim concept). Requires `Task.Assign`. On a NEW task it moves to In Progress and says so in the toast: "Assigned to you. Task moved to In Progress."
- "Assign to..." opens the assignee picker (any active user; cross-Pod allowed; shows each person's Pods and open count; picker warns "Not a member of Pod A" informationally only, since membership is not a rule [baseline OPEN-12]).
- Pod-only assignment (setting Pod without a user) does **not** change status; the UI helper text says so on the Pod field.
- "By member" counts are workload facts, not performance scores; no ranking, no sorting by "most completed".
**Default sort** same as Task Queue.
**States.** User in no Pods and without wider scope: "You aren't in a Pod yet. Ask an administrator." Empty queue: "Nothing waiting in Pod A." Loading/error as tables.
**Permissions.** `Task.View` + `Pod.View`.

---

### S05 Clients

**List.** Purpose: find and maintain Clients.
```text
Clients                                                   [+ New Client]  (needs Client.Create)
Search [ 343 or Acme            ]   Status: (Active v)
+--------------+----------------------+----------+----------+-----------+
| Client No.   | Name                 | Matters  | Open tasks| Status   |
| 00343        | Acme Corp            | 4        | 7         | Active   |
+--------------+----------------------+----------+----------+-----------+
```
Search accepts `343` or `00343` or a name fragment. Default sort Client Number ascending. Empty: "No clients yet" + New Client.

**Create/Edit** (page or dialog).
```text
New Client
Client number (required)  [ 343   ]  Will be saved as 00343.   Enter 1 to 5 digits, as issued by the firm's main system.
Client name   (required)  [____________________]
Status                    (o) Active ( ) Inactive           (edit only)
-- Custom fields (admin-defined for Client) rendered by DynamicForm --
[Save client] [Cancel]
```
| Field | Rules | Messages |
|---|---|---|
| Client number | Required; digits only; 1 to 5 digits; unique after zero-padding | "Enter a client number." / "Use digits only." / "Use at most 5 digits." / "Client 00343 already exists." (link to it) |
| Client name | Required; max 200 | "Enter a client name." |
Edit: Client number locked with a "Change number" link (needs `Client.Edit`; confirm dialog: "Changing this number changes how matters are named in emails, Relativity workspaces and folders. This change is recorded."). Name always editable.
**Detail.**
```text
Clients > 00343 Acme Corp                                   [Edit] [Set inactive]
00343  Acme Corp   (Active)     Custom: Industry = Pharma
[ Matters (4) ] [ Details ] [ Activity ]
 Matters table: Matter ref, Name, Status, Open tasks, [+ New Matter for this client]
```
- Set inactive: allowed (Client inactive does not itself change Tasks) [UX-PROPOSAL: inactive Client blocks creating new Matters]; confirm dialog states the consequence.
**States.** Loading skeleton; not found -> 404; save error -> field errors + summary.
**Permissions.** `Client.View`; `Client.Create`; `Client.Edit`.

---

### S06 Matters

**List.**
```text
Matters                                                   [+ New Matter]
Search [ 343-12 | 00343-00012 | name ]  Client [All v]  Status [Active v]
+---------------+---------------------+----------------+--------+---------+--------+
| Matter ref    | Name                | Client         | Open tasks | Assets | Status|
| 00343-00012   | Merger Review       | 00343 Acme     | 7      | 212     | Active |
```
**Create/Edit.**
```text
New Matter
Client (required)   [ typeahead: 343 or Acme  v ]
Matter number (required) [ 12 ]  Will be saved as 00012.  Combined reference: 00343-00012
Matter name (required)   [__________________]
Status (edit only)        Active / Inactive
-- Custom fields --
```
Live combined-reference preview updates as the user types. Messages: "Select a client." / "Enter a matter number." / "Use digits only (1 to 5)." / "Matter 00012 already exists for client 00343." (unique only within the Client). Client is locked after creation.
**Detail.**
```text
Matters > 00343-00012 Merger Review                  [+ Create Task] [+ New Project] [+ New Asset] [Edit] [Set inactive]
00343-00012  Merger Review   Client: 00343 Acme Corp   (Active)
[ Tasks (7 open) ] [ Projects (3) ] [ Assets (212) ] [ Details ] [ Activity ]
Tasks tab: table (Task Queue columns subset) grouped optionally by Project; filter "Project: All / None / <name>".
Projects tab: list of projects with task counts.  Assets tab: asset list scoped to matter.
```
**Set inactive.** Allowed only when all Tasks are Completed or Cancelled.
- If blocked: dialog "This matter has N tasks that aren't Completed or Cancelled. Finish or cancel them first." + button "View open tasks" (opens Task Queue filtered) and Close. The action itself shows enabled (so the reason is reachable) but the dialog explains; alternatively disabled with reason tooltip. [UX-PROPOSAL: disabled-with-reason + hint text.]
- Inactive Matter shows a persistent banner "This matter is inactive. New tasks can't be created and completed or cancelled tasks can't be reopened." Create Task and Reopen are disabled with that reason. Reactivate action available to `Matter.Edit`.
**States/permissions.** `Matter.View/Create/Edit`; Create Task needs `Task.Create` and an active Matter.

---

### S07 Projects

Projects are flat folders of Tasks within a Matter (no nesting).
**Create/Edit (dialog).** Fields: Matter (prefilled and locked when launched from a Matter; else typeahead; required), Name (required, max 200, unique within Matter [UX-PROPOSAL]), Description (optional), Active toggle (edit), custom fields. Messages: "Enter a project name." "A project named 'X' already exists in this matter."
**Detail.**
```text
Matters > 00343-00012 > Project: Custodian Processing        [+ Create Task] [Edit] [Archive]
Description ...      Custom: ...
Tasks table (Project filter fixed). Row action: "Move to another project" (same matter only).
```
- Moving a Task between Projects (or to "No project") is a dialog listing only that Matter's Projects; the Matter cannot change. Audited.
- Archive (inactive) a Project: allowed; existing Tasks keep it; new Tasks cannot select it.
**Global Projects list** (`/projects`): search by name/matter, columns Name, Matter ref, Open tasks, Status.
**Permissions.** `Project.View/Create/Edit/Archive`.

---

### S08 Assets

Assets are Matter-owned references to external resources. The product records, does not provision.
**List (global and per Matter).**
```text
Assets                                         [+ New Asset]
Search [name, ref, type]  Matter [00343-00012]  Type [All v]  Status [Active v]
+--------------------+----------------------+----------------+------------+--------------+
| Name               | Type                 | Matter         | External ref| Linked tasks|
| ACME Review WS     | Relativity Workspace | 00343-00012    | WS-8841     | 5           |
```
Per-Matter assets can reach 200 to 300: server pagination and search, no client-side filtering.
**Create/Edit.**
```text
New Asset
Matter (required)         [typeahead]            (locked once created; prefilled from Matter)
Asset type (required)     [ Relativity Workspace v ]  -> loads type-specific fields
Display name (required)   [__________]
External reference / URL  [__________]   (URL validated if looks like URL)
Description               [__________]
Status                    Active / Retired
-- Type-specific fields (Asset Type's form via DynamicForm) --
   Workspace ID [___]  Environment [Prod v]
-- Custom fields (Asset-level) --
```
Asset type change after creation: not allowed [UX-PROPOSAL: type drives the fields; to change, retire and create a new one]. Matter cannot change (an Asset belongs to exactly one Matter).
**Detail.** Header with type badge, Matter link, external ref (copy button; link if URL), tabs: **Details**, **Linked Tasks** (table, with link label Source/Destination/Subject/Result), **Activity**.
**Linking to Tasks** happens from Task detail > Assets tab (S10): the picker lists only Assets of the Task's Matter; a cross-Matter attempt (e.g. via URL) shows server error "That asset belongs to a different matter."
**Messages.** "Enter a display name." "Select an asset type." "Enter a valid URL (starting with http:// or https://)."
**Permissions.** `Asset.View/Create/Edit/Link`.

---

### S09 Create Task (manual and from Outlook email)

**Purpose.** Fast, one-page, single-transaction task creation. A task cannot change Task Type, Workflow, or Matter later, so the page makes those three choices deliberate and summarises them before submit.

**Entry points.** Header "+ Create Task", Task Queue, Matter detail (Matter prefilled), Project detail (Matter + Project prefilled), Pod Work (Pod prefilled).

```text
Create Task
+-- Quick fill from email (optional) -----------------------------------------------------------+
|  [ Drop an Outlook email here ]   or   [ Paste email text ]   or   [ Choose .eml/.msg file ]   |
|  Drag-and-drop from new Outlook may not work in your browser. Paste always works.               |
|  We read the subject, body, sender and sent date. Attachments and the original email are NOT saved.|
+------------------------------------------------------------------------------------------------+
 (after parse) [ok] Filled Title, Description, Requestor, Sent date.   [Review highlighted fields] [Clear]

1 Where
 Matter (required)   [ typeahead 343-12 / name v ]  Only active matters are listed.
 Project (optional)  [ none v ]            (depends on Matter)
2 What
 Title (required)        [______________________________]
 Description             [ multiline ____________________ ]   (plain text; email body prefilled)
 Task type (required)    [ Select... v ]
 Workflow (required)     ( ) Standard Processing v2   ( ) Rush Processing v1     <- only published, eligible for type
                         [Preview steps v]   Ordered workflow: steps must be done in order.
3 Request details       (DynamicForm for the selected Task Type form version, with conditional rules)
 Requires OCR? [x]   -> OCR language (required) [ English v ]
4 Who is asking
 Requestor name (required)  [______________]   Requestor email (optional) [______________]
 Source email sent: Oct 13, 2026 9:12 AM (read-only, shown only when filled from email)
5 Priority, due, assignment
 Priority (required)   [ Normal v ]
 Due date              [ date ] [ time optional ]   (empty = ASAP, handled promptly, never overdue)   [x] No due date (ASAP)
 Pod                   [ none v ]       Assignee [ none v ]
   helper: "Assigning a person starts the task (In Progress). Assigning only a Pod doesn't."
-------------------------------------------------------------------------------------------------
Summary: Matter 00343-00012 | Type: Data Processing | Workflow: Standard Processing v2 (6 steps, ordered)
Type, workflow and matter can't be changed after you create the task.
[Create task] [Create and add another] [Cancel]
```
**Layout.** Single scrolling page, sections numbered, left-aligned form column (max 720 px) with a sticky right-hand "Summary" card on wide screens (>=1280). Not a wizard; sections 3+ unlock progressively: Task type must be chosen before Workflow and Request details render.

**Fields and rules.**
| Field | Required | Rules / behavior | Error message |
|---|---|---|---|
| Matter | Yes | Active matters only; if launched from a Matter, prefilled and still changeable until submit | "Select a matter." / "This matter is inactive. Choose an active matter." |
| Project | No | Lists only projects of selected Matter; clears if Matter changes (with note) | "That project doesn't belong to this matter." |
| Title | Yes | max 250; prefilled from Subject | "Enter a title." |
| Description | No | prefilled from the email's HTML body (tables kept, sanitized) or its plain text; rich text editor (decision R) | n/a |
| Task type | Yes | active types with >=1 published eligible workflow; types without one are listed disabled "(no workflow available)" | "Select a task type." |
| Workflow | Yes | exactly one; radio list; default pre-selected if the type has a default but user must see it; current published version per workflow only | "Select a workflow." |
| Request details | per form | dynamic, conditional: hidden fields are not validated and not submitted; backend re-validates | per field: "Enter <label>." / "<label> must be a number." etc. |
| Requestor name | Yes | max 200; prefilled from From | "Enter the requestor's name." |
| Requestor email | No | valid email format | "Enter a valid email address." |
| Priority | Yes | default = admin default (Normal) | "Select a priority." |
| Due date | No | date required if time given; may be today or future (past dates allowed with warning "This date has already passed. The task will be overdue immediately.") | "Enter a date before adding a time." |
| Pod / Assignee | No | assignee any active user; independent of Pod | n/a |
Changing Task type after filling the dynamic section: confirm "Changing the task type clears the request details you entered." with Change / Keep. Switching workflow does not clear details.

**Create-from-Outlook intake (addendum C; baseline §10.2).** Parse and discard; never persists email or attachments. Three input paths, in priority order of reliability:
1. **Paste** (always available, primary path): "Paste email text" opens a dialog/textarea. User copies from Outlook (header block + body) and pastes. The parser looks for header lines `From:`, `Sent:` (or `Date:`), `To:`, `Subject:` at the top; the remainder is the body. Pasting just the body fills Description only and leaves Title empty with a hint. Parsed values appear in a **review panel** (editable) before applying: Subject -> Title, Body -> Description, From name/email -> Requestor, Sent -> read-only "Source email sent".
2. **Drag and drop**: the drop zone accepts a dragged email if the browser exposes `.eml`/`.msg` file data or text/HTML payload; on any unsupported payload it shows "We couldn't read that drop. Paste the email text or choose a file instead." and automatically focuses the Paste button. Drag-drop from new Outlook is an unvalidated spike; the UI never claims it will work.
3. **File picker** for `.eml`/`.msg` saved from Outlook (parsed in memory, discarded) [UX-PROPOSAL, subject to the spike; remove if the architecture will not parse server-side].
Rules:
- Never overwrite user-entered values silently: if fields already contain text, the review panel shows "Replace" per field (default Replace for empty, Keep for non-empty).
- Parsed Subject strips leading `RE:`/`FW:` prefixes only if the user opts in ("Clean subject prefixes", default off).
- From parsing: `Name <addr@x.com>`, `"Last, First" <addr>`, `addr` only (name falls back to the part before @, flagged "Please confirm name").
- Dates parsed in firm timezone; unparseable -> not filled, no error.
- HTML body is converted to plain text; signatures and quoted chains are kept (user trims).
- Attachment filenames are not recorded; if an attachment indicator is detected a note says "Attachments aren't saved. Add what's needed to the task description or an Asset."
- Sensitive-content note near the zone: "Email content you paste is saved in the task description. Remove anything that shouldn't be stored."
- Manual entry always possible; Quick fill is collapsed by default for users who don't use it (remembers state).
- Accessibility: drop zone is a button-like region that also opens the paste dialog by keyboard; announces results via live region.

**Submit.** One transaction. Success: navigate to the new Task detail with toast "Task TSK-1043 created." "Create and add another" keeps Matter/Project/Priority/Pod and clears the rest. On validation failure: error summary at top (focus), scroll to first error. If the server says the Matter became inactive or the workflow version changed: banner and re-select.
**States.** Loading metadata (skeleton for Task Type and priority lists). If no Task Types exist: "No task types are set up yet. Ask an administrator." If user lacks `Task.Create` -> 403 page. Partial draft is held in session storage only (no server drafts) and the leave guard warns.
**Permissions.** `Task.Create`. Priority control visible/editable only with `Task.SetPriority` or creator default (a creator may set it at creation per baseline §7.2); Pod/Assignee controls require `Task.Assign`, otherwise hidden and the task is created unassigned.

---

### S10 Task detail

**Purpose.** Single source of truth for one Task: metadata, workflow execution, comments, assets, history.

```text
Tasks > 00343-00012 Merger Review > TSK-1042
TSK-1042  Process Smith custodians                           [Change status v] [Edit] [Cancel task] [...]
[In Progress]  [Critical]  Due: ASAP   Pod: Pod A   Assignee: Tariq M. [Change]   Matter: 00343-00012 Merger Review
Type: Data Processing   Workflow: Standard Processing v2 (ordered)    Workflow: 3 of 6 resolved [=====-----]
(banner when Completed/Cancelled: "This task is Completed. Move it back to In Progress to edit." [Reopen task])
(banner when matter inactive: "Matter is inactive. This task can't be reopened.")
  WORKFLOW (main, fluid)                              | DETAILS (side panel, 340 px, sticky)
  (3) Deduplicate  [current, expanded]                |   requestor, dates, due, project, pod, request form
  (1)(2)(4)(5) one-line summaries                     |   [Edit details]
  COMMENTS (composer + thread)                        | ASSETS (links, roles, Link asset)
```
**Page layout (single page, `mf-detail-layout`, docs/ux/task-detail).** The former Details / Workflow / Comments / Assets / Activity tabs are one page, like Client, Matter and Project. Main column: Workflow, then Comments (loaded when scrolled near). Side panel (`aside`, from 1100 px, sticky, own scroll): Details, then Assets. Below 1100 px one column: Details (collapsible, collapsed on phones), Workflow, Comments, Assets, plus a "Jump to" link row (Workflow, Comments, Assets) that scrolls and moves focus to the section heading. Activity is a right-side drawer opened by the header's Activity button. Old links: `?tab=workflow|comments|assets` scroll to the section, `?tab=activity` opens the drawer, `?tab=details` shows the page; `?step=<id>` opens that step. Only the current step is expanded; other steps are one-line summaries that can be opened. Edit (header, or "Edit details" in the panel) opens the edit form in a dialog and returns to the same page. There is **no Attachments section** (nothing is stored).

**Header.** Ref, title, status badge, priority badge (inline editable with `Task.SetPriority`), due (`DueCell`), Pod, assignee (inline editable with `Task.Assign`/`Reassign`), Matter ref link, workflow name + version + progress. Primary actions: **Change status** menu, **Edit**, **Cancel task**. The same status control is the only place status changes (plus Complete in the Workflow tab when all resolved).

**Immutable fields.** Matter, Task Type, Workflow (and version) are shown read-only with a lock icon and tooltip "Can't be changed after creation. To correct it, cancel this task and create a new one." Project is editable (same Matter only).

#### Details tab
```text
Details                                                       [Edit details]
Title            Process Smith custodians
Description      (multi-line)
Requestor        Jane Roe  <jane.roe@client.com>        (email link; optional)
Source email sent  Oct 13, 2026 9:12 AM  (only when created from email)
Project          Custodian Processing  [Move]
Priority / Due / Pod / Assignee (also editable inline in header)
Created by / on  Dana P., Oct 13 9:20 AM       Last updated ...
-- Request details (Task Type form: Data Processing, form v3) --
  Requires OCR?  Yes     OCR language  English
-- Task Type and Workflow  [locked]
```
Edit mode: fields become inputs in place (page-level Save/Cancel), same validation as Create. Request detail values edit against the **form version the task was created under** (a small caption "Form version 3"); conditional rules apply. Saved edits are audited with before/after. Editing is disabled when status is Completed/Cancelled (banner + Reopen) and when the Matter is inactive.

#### Workflow tab: stepper
Two layouts driven by workflow mode.

```text
Workflow: Standard Processing v2    ORDERED - complete or skip each step in order      Resolved 3 of 6
(1) [ok] Intake QC                Completed  Oct 13 by Tariq   [Reopen]
(2) [//] Load to Relativity       Skipped    "Already loaded by vendor"  [Reopen]
(3) [>>] Deduplicate              In progress  <- current                [expand]
      Instructions (rich/preformatted), Docs: link ->
      Inputs:  Items in  [ 12,400 ]   Items out [ ____ ]  Dedup method [Global v]
      [Save inputs] [Mark complete] [Skip step...]   (Skip shown only if step is skippable)
(4) [  ] OCR                      Pending (locked until step 3 is resolved)
(5) [  ] QC sample                Pending (locked)
(6) [  ] Handover                 Pending (locked)
-----------------------------------------------------------------------------
Task completion: 3 required steps unresolved.      [Complete task] (disabled with reason)
```
Unordered:
```text
Workflow: Quick Export    UNORDERED - work these in any order            Resolved 1 of 4
[ Steps list as accordion; each row: icon, title, status, Required/Optional tag, Complete / Skip / Reopen ]
No "locked" states. A filter "Show: All | Unresolved".
```
**Step states** (internal `PENDING`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`; reopen = audited return to In Progress): icon + text, never colour only. Header summary "n of m resolved" (resolved = Completed or Skipped).
**Ordered rules in the UI.**
- Only the first unresolved step (the "current" step) can be started/completed/skipped. Later pending steps show a lock icon and "Complete or skip step N first". They remain expandable for reading instructions.
- Reopened earlier step: shown with an amber "Reopened" tag; downstream completed steps **stay** Completed and unchanged. A note beneath: "Step 2 was reopened. Later steps are unchanged. Resolve step 2 before completing the task." The task cannot be completed until the reopened step is resolved. New (pending) downstream steps remain locked behind the reopened step.
**Completing a step.** "Mark complete" validates required visible inputs (conditional rules apply: hidden inputs not required). Field errors show inline: "Enter <label> to complete this step." Save inputs without completing is allowed (draft values) [UX-PROPOSAL]. Starting or completing a step does not change Task status: workflow progress and lifecycle are independent, except the addendum rules (assigning a user, reopening a step on a Completed Task). If a user marks a step complete on a NEW task, no automatic status change (Appendix D asks the PO).
**Skip with comment dialog.**
```text
Skip "Load to Relativity"?
This step is skippable. Skipped steps count as resolved.
Comment (required)   [ rich-less multi-line, 2000 max ]    <- label shows "(required)" only if the step config demands it, else "(optional)"
                   "Explain why this step isn't needed."
[Skip step] [Keep step]
```
- Skip button appears only for skippable steps. For non-skippable steps no Skip button is rendered; the info line says "This step is required and can't be skipped." (read via `aria-describedby`).
- Required skip comment -> inline error "Add a comment to skip this step."
- Skip comment later editable on a Skipped step by editing after reopening or via "Edit comment" (audited).
**Reopen step.** One click opens a small confirm popover (not a reason prompt; no reason required in Phase 1): "Reopen this step so you can change it? Later steps keep their status." [Reopen step] [Keep as is]. After reopening, the step opens in edit mode and its prior values are shown.
- If the Task is **Completed**, the popover adds "This task is Completed. Reopening a step will move the task back to In Progress." and the action does both, audited as two events; the Activity tab shows "Task status changed to In Progress (step reopened)". If the Matter is inactive, the control is disabled with reason.
- Requires `Workflow.StepReopen`; editing inputs requires `Workflow.StepEdit`; completing/skipping requires `Workflow.Execute`.
**Complete task.** Button at the end of the Workflow tab and in the Change status menu. **Always enabled** (with `Task.Complete`). If steps are unresolved, a confirmation dialog appears: "You have N steps not completed. Do you want to mark them all completed?" [Mark all completed and finish task] / [Cancel] (addendum K). Confirm completes the unresolved steps (as Completed, not Skipped) and the Task in one action. If any of those steps is missing required inputs, the dialog instead lists them ("These steps need required information first: ...") with links to the steps, and the Task stays open. SUPERSEDES the disabled-state text below. If an optional/skippable step is unresolved, the dialog lists it: "Optional step X is unresolved. It will stay unresolved." only if the workflow's completion policy permits; otherwise it must be skipped (Appendix D: OPEN-05). Disabled reason: "2 required steps are unresolved: Deduplicate, OCR." with links that scroll to the steps. Requires `Task.Complete`.
**No step assignee picker, no approval controls, no approver fields.** If the workflow's step instructions mention approvals, the UI shows the instruction text only; users record outside approvals in a comment.

#### Status change rules (UI)
The Change status menu lists only valid targets for the current state (see Appendix B):
| From | Allowed to | Notes |
|---|---|---|
| New | In Progress, On Hold, Cancelled | Assigning a user auto-moves New -> In Progress (toast) |
| In Progress | On Hold, Completed*, Cancelled | *Completed only when workflow resolved |
| On Hold | In Progress, Cancelled | |
| Completed | In Progress | = Reopen; blocked if Matter inactive |
| Cancelled | In Progress | = Reopen; blocked if Matter inactive |
Unassigning later does **not** revert status. Any transition is audited. Permissions: `Task.ChangeStatus`, `Task.Complete`, `Task.Reopen`.
**Cancel task dialog (mandatory comment, any time).**
```text
Cancel TSK-1042?
This marks the task Cancelled. Unresolved workflow steps don't block this. You can reopen it later.
Comment (required)  [______________________________]   (saved as a comment on the task)
[Cancel task] [Keep task]
```
Error: "Add a comment explaining why you're cancelling." The comment is posted to the Comments tab and referenced in Activity.
**Reopen task.** From banner or Change status: confirm "Move TSK-1042 back to In Progress?" [Reopen] [Keep]. No reason required. Disabled with reason when Matter inactive.

#### Comments tab
```text
Comments (5)                                      Oldest first | Newest first
+-- Dana P.  Oct 13, 9:25 AM ---------------------------------------+
| Called the client; approved by A. Lee (email 10/13). [edit] [delete] (own comments)|
| Edited Oct 13, 10:01 AM  [View edit history]                                         |
+----------------------------------------------------------------------+
[ B I | list | numbered | link ]  Add a comment... (Ctrl+Enter to post)    [Post comment]
Internal only: comments are visible to people who can view tasks.
```
- Rich text with bold/italic/lists/links and tables (see §5.5, decision R); sanitized server-side; no attachments/images/mentions.
- Authors edit/delete their own comments; edit shows "Edited" marker and "View edit history" (list of previous versions with timestamps); delete is a soft-delete: confirm "Delete this comment? It will be hidden from view but kept in the audit record." then the comment disappears (no tombstone in the thread for others; Activity records "Comment deleted" [UX-PROPOSAL]).
- Cancel comments appear as comments with a "Cancellation reason" tag.
- Posting requires `Task.Comment`; users without it see read-only comments.
- Empty: "No comments yet." Error on post: inline, keeps typed text.
- Comments are separate from system history (Activity).

#### Assets tab
Table of linked Assets (Name, Type, External ref, Link label Source/Destination/Subject/Result, Remove link). "Link asset" opens a picker restricted to the Task's Matter Assets (search + paginate; 200 to 300 assets). Duplicate links prevented. "New asset" shortcut creates an Asset for the same Matter then links it. Needs `Asset.Link` (and `Task.Edit`). Empty: "No assets linked."

#### Activity tab
Chronological, filterable by type (Status, Assignment, Fields, Workflow, Comments, Assets). Each event: actor, time (firm timezone, tooltip UTC), event text, and "View changes" showing old -> new values (viewing before/after values may be limited by `Audit.View` [UX-PROPOSAL: tab visible to everyone with `Task.View` but values hidden without `Audit.View`]). Paginated, read-only. Empty: not possible (creation event always exists).

**Concurrency.** Row-version conflict on any save opens the conflict dialog. Step updates are per-step atomic.
**States.** Loading skeleton of header + tabs; 404 if no such task; error banner with Retry; read-only mode for users lacking edit permissions (controls hidden).
**Keyboard.** Tabs per WAI-ARIA (arrow keys); `S` shortcut not used; focus moves to first error on failed save/complete.

---

### S11 Global Search results and Advanced Search

**Typeahead (S20 in header).**
```text
[ 343-12                                  ]
 Matters
   00343-00012  Merger Review  (Acme Corp)
 Clients
   00343  Acme Corp
 Tasks
   TSK-1042  Process Smith custodians
 Projects / Assets ...
 [View all results for "343-12"]
```
- ARIA 1.2 combobox; Up/Down to move, Enter to open, Esc to close; `Ctrl+K` or `/` focuses. Debounce 250 ms, min 2 characters (numbers: min 1 digit), max 5 suggestions per group, groups ordered Matters, Clients, Tasks, Projects, Assets.
- Number-aware: `343`, `00343`, `343-12`, `00343-00012` all resolve; exact number matches are ranked first; the search echo shows the normalized form: `Showing results for 00343-00012`.
- Server-side authorization filtering only returns records the user may view (Phase 1: any `Task.View` holder sees all tasks).
- States: no match -> "No results for 'x'. Try a client or matter number, a task title, or an asset name." Error -> "Search is unavailable. Try again." Loading spinner with live announcement "Searching".
**Results page `/search?q=`.** Tabs by object (All, Clients, Matters, Projects, Tasks, Assets) with counts, paginated tables with the same columns as the lists, match highlight. "Advanced search" link.
**Advanced Search (lower priority).** Object selector (Matter, Client, Task, Project, Asset) then object-specific filters (same as list filters; custom fields only if admin flagged "Searchable" on the field definition) and paginated results; export not offered. Only SQL-backed matching: no attachment content, no natural language (Phase 2).

---

### S12 Admin: Users, Pending Users, Roles and Permissions

**Users page.** Two tabs: **Users** and **Roles** (the roles and permissions screen). The Users tab lists users with a **Status** filter next to the search box: **Pending access (N)**, **Active**, **Inactive**, **All**; it opens on Pending access when someone is waiting, otherwise Active, and the choice lives in the URL (`status`, `q`, `page`).
```text
Administration > Users                                   [ Users ] [ Roles ]
Search [____________]  Status [Pending access (3) v]   (3 waiting for access)
Pending table: Name | Windows account | First seen | Email | Roles | Pods | [Grant access]
```
- **Pending access** lists newly registered users with zero roles (the admin queue instead of notifications). Badge count also appears on the Administration nav item for users with `User.Manage`/`Role.Manage` [UX-PROPOSAL]. Row action "Grant access" opens the user drawer.
**User drawer/detail.**
```text
Tariq Mahmood   DOMAIN\tmahmood   tariq@firm.com   First seen Oct 1   Last seen today
Status: (o) Active ( ) Inactive           Primary Pod [Pod A v]
Roles   [x] Data Technician  [ ] Pod Lead  [ ] Project Manager ...   (checkboxes; effective permissions preview on the right)
Pods    [x] Pod A  [x] Pod B
Open assigned tasks: 7  [View in Task Queue ->]     <- offboarding aid
[Save]
```
- **Offboarding (addendum E):** marking a user Inactive does not reassign work. The confirm dialog states "This user has 7 open tasks. They stay assigned until you reassign them one by one." with "View their tasks" opening Task Queue filtered by that assignee. No bulk reassign.
- Inactive users remain visible in historical records and in the Task Queue assignee filter (marked "(inactive)"); they're not offered as new assignees.
- Hiding/disabling: the built-in System Admin role cannot be edited or removed from the last System Admin ("At least one active System Admin is required.").
- No password fields; identity is the Windows account (read-only). The seeded initial admin is marked "Seeded".
**Roles list/editor.**
```text
Roles:  System Admin (built-in, locked) | Director | Project Manager | Pod Lead | Data Technician | Data Scientist | [+ New role]
Role editor: Name, Description, Permission matrix grouped:
  Client/Matter | Project | Task | Workflow execution | Assets | Organization | Configuration | Oversight
  e.g. Task: [x] View [x] Create [x] Edit [x] Assign [x] Reassign [x] SetPriority [x] ChangeStatus [x] Complete [x] Reopen [x] Comment
  Search permissions [____]   Copy from role [ v ]   Members: 14
```
- A short explanation under each permission; permissions with dependencies auto-check prerequisites (e.g. Assign requires View) with a visible note.
- Pod Lead is just another role in this list (not a per-Pod flag).
- Deleting a role in use is blocked ("14 users have this role. Remove them first"). Save shows "Changes apply on each user's next request" (permission refresh policy).
- Changes audited. Needs `Role.Manage`.
**States.** Empty pending: "No one is waiting for access." Loading/error as usual.

---

### S13 Admin: Pods

Pods is the **third tab of the Users page** (`Users | Roles | Pods`, `/admin/pods`, needs `Pod.Manage` or `Pod.ManageMembers`; document title "Users - Pods"; the page header keeps the Users icon on all three tabs, see docs/ux/users-pods/README.md). The Users grid also has a **Pods column** with an inline editor for people with `Pod.ManageMembers`.

```text
Users  [Users] [Roles] [Pods]                               [+ New Pod]
+--------+------------------+---------+--------+
| Pod A  | Members 8        | Active  | [Edit] |
Pod editor: Name (required, unique), Description, Active
  Members: table (Name, Roles shown as read-only chips, Primary Pod star per user is user-level)
  [+ Add members] typeahead multi-add; [Remove]
```
- There is **no Lead flag** on the Pod; the UI shows each member's roles so Pod Leads are recognizable (e.g. "Pod Lead" role chip). Helper text: "Pod leads are a role. Assign the Pod Lead role on the Users tab."
- Deactivating a Pod with open tasks: allowed; tasks keep it; the confirm says how many open tasks reference it.
- Messages: "Enter a pod name." "A pod named 'X' already exists."
- Needs `Pod.View/Manage/ManageMembers`.

---

### S14 Admin: Task Types and the Form Designer

**Task Types list** (first tab of the Task Types page, with the Workflows and Workflow Steps tabs; see [task-types-tabs](task-types-tabs/README.md)). Columns: Name, Request form (status and version), **Workflows** (the eligible workflows as chips that open the workflow; the default one starred and marked "default"; three chips then "+n more" and a "Workflows (n)" link that open the Workflows tab filtered to the type; "No workflow" as a warning when none), Status, Open tasks. Actions: New, Edit (creates a draft from the published version if needed), Deactivate. Warning chip "No eligible published workflow: users can't create tasks of this type."

**Task Type editor (tabs).** `General` (name, description, active, default workflow) | `Form` (designer) | `Workflows` (eligible published Workflow list: picker listing published workflow definitions, "current published version" shown; remove) | `Versions` (history).

#### Form designer
```text
Task Type: Data Processing > Form      Draft v4 (published: v3)      [Preview] [Validate] [Save draft] [Publish...]
+-- Palette -----+ +-- Canvas (drag or Add) ------------------------+ +-- Properties --------------+
| Section heading| | [Section] Request details                      | | Selected: OCR language       |
| Text           | |  ::  Requires OCR?          [Checkbox]  req   | |  Label  [OCR language]       |
| Multi-line     | |  ::  OCR language           [Dropdown]  cond  | |  Key    ocr_language (locked)|
| Number         | |  ::  Contains encrypted?    [Checkbox]        | |  Type   Dropdown             |
| Checkbox       | |  ::  Password instructions  [Text] cond  req  | |  Help   [..........]         |
| Dropdown       | |  [ + Add field ]                              | |  Required  ( ) Always         |
| Radio group    | |  (move up/down buttons beside each ::)        | |            (o) Conditional... |
| Multi-select   | +------------------------------------------------+ |  Options [Eng][Spa][+]       |
| Date/Datetime  |                                                    |  Default [ ]                  |
| URL            |   Preview ----------------------------------------| |  Rules (see below)           |
| Asset reference|   [live form, toggle controls to test rules]       | |  Validation: min/max/regex   |
| User reference |                                                    | +-----------------------------+
| Help text      |
+----------------+
```
**Controls (no File Upload, per addendum C):** single-line text, multi-line text, number, checkbox, single-select dropdown, radio group, multi-select, date, datetime, URL, Asset reference, User reference, section heading/help text.
**Field properties.** Stable internal key (auto-slug from label on first save, then locked), label, type, help text, display order (drag handle **and** Move up/down buttons), required (Always / Never / Conditional), default value, type validation (text: min/max length, optional pattern with a plain-language error message; number: min/max/integer; date: min/max; select: options with value+label; option ids are stable, labels editable only in a new version), active/hidden.
**Conditional rules builder** (structured metadata, no scripting).
```text
Rules for "OCR language"
 Visibility:  (o) Always shown   ( ) Show only when...
 Required:    ( ) Never  ( ) Always  (o) Required when...
 Show only when   [ Requires OCR? v ] [ is v ] [ checked v ]            [+ Add condition]  Match [ALL v ANY]
                  and  [ Language group v ] [ is one of v ] [ A, B ]
 Option set (dropdowns, optional): when [Region = EU] show options [ ... ]
 Plain-language summary: "Show OCR language when Requires OCR? is checked. Required whenever shown."
```
- Operators by type: equals, not equals, is one of, is empty, is not empty, checked/unchecked, greater/less than (number/date), contains (text).
- Two levels max (a group of conditions with ALL/ANY, one nesting level) [UX-PROPOSAL, per baseline "limited nesting"].
- A hidden field is not required and not submitted. If a field that other rules depend on is itself hidden, the dependent field is treated as "value empty".
- Referenced field picker only lists fields **above** it in the order or any field, but circular chains are blocked: validation error "These fields depend on each other: A -> B -> A. Remove one rule."
- Deleting/renaming a field referenced by a rule is blocked with a list of dependents.
**Preview.** Right/bottom preview renders the form with the same `DynamicForm` component used in Create Task; the author can toggle values to see conditional behavior; a "Test submit" shows the validation messages a user would get (client-side only, labelled "Server re-validates on submission").
**Validate (pre-publish checks).** Errors (block publish): duplicate keys; dropdown without options; rule referencing missing field; circular dependency; required conditional with no condition; regex invalid. Warnings: no fields; field has no help text on a number with units. Results shown in a panel with click-to-focus.
**Publish dialog.** Shows a diff vs the published version (fields added/changed/removed) and states "Existing tasks keep form version 3. New tasks will use version 4. Published versions can't be edited." [Publish version 4] [Cancel]. Version note optional. Retire version available in Versions tab (new tasks can't use it).
**States.** Empty form: "No fields yet. Add your first field from the palette." Unsaved-changes guard; autosave of drafts is off; "Save draft" explicit. Concurrency: two admins editing the same draft -> conflict dialog.
**Permissions.** `TaskType.Manage` (+ `CustomField.Manage` for core object fields in S18).

---

### S15 Admin: Workflow Steps (step library)

The step library is the **third tab ("Workflow Steps") of the Task Types page**; the Administration menu has one "Task Types" item for three tabs (`/admin/task-types` = Task Types, `/admin/workflows` = Workflows, `/admin/steps` = Workflow Steps; route-based like Users/Roles). The model reads left to right: a Task Type has eligible Workflows (one default), a Workflow is built from Steps of this shared library. Task Types needs `TaskType.Manage`, Workflows and Workflow Steps need `Workflow.Manage`; only permitted tabs show, and a person with only `Workflow.Manage` lands on Workflows. Document titles "Task Types", "Task Types - Workflows" and "Task Types - Workflow Steps"; breadcrumb `Administration > Task Types > Workflow Steps`.

```text
Administration > Task Types > Workflow Steps                [+ New step]
Task Types | Workflows | Workflow Steps
Search [Title, description or tag]  Status [Active v]  [Tags v]  (o) Match all ( ) Match any   [Relativity x] [QC x]
+----------------------+--------------------+-------------------------+--------------------+
| Title                | Description        | Tags                    | Used in            |
| Deduplicate          | Remove duplicates  | (Relativity) (QC) +2 more | Used in 3 workflows (link) |
```
**Tags.** Each step has free-form tags (examples: Relativity, Processing). The Tags column shows chips (first three, then "+n more", long tags cut with an ellipsis). The free-text search also matches tag text. The **Tags** button opens a panel of checkboxes of the existing tags with counts ("Relativity (3)"; a find box above eight tags); chosen tags show as removable chips ("Remove tag filter X"); "Match all" (default: a step needs every chosen tag) or "Match any". The state is in the address (`q`, `tags` repeated, `tagMatch=any`, `status`, `sort`, `page`). The workflow designer's step picker shows the same chips, searches tag text and has the same Tags filter.
**Tag input (step editor).** Type and press Enter or comma to make a chip (leaving the box also commits), Backspace on an empty box removes the last chip, every chip has a "Remove tag X" button, existing tags are suggested as you type (a combobox with a listbox; free text is always allowed), a polite live region announces added and removed tags. Rules: trimmed, inner whitespace collapsed, at most 40 characters per tag, at most 20 per step, no control characters, case-insensitive uniqueness per step (the first spelling wins; an existing tag keeps its stored spelling across steps). Tags are library metadata: editing them never changes a published workflow version, and the change is audited (field `Tags`).
**Step editor.**
```text
Title (required) [__________]
Description [__________]  (short)
Instructions [ rich text? plain multi-line with line breaks / basic markdown-free ]  (detailed SOP)
Documentation URL [https://...]  (optional, validated)
Tags [(Relativity x) (Processing x) type a tag...]  (optional)
Data inputs (operational values only): same field designer pattern (types as in S14, no file upload) with conditional rules
   e.g. Items in [number, required]  Items out [number]  QC result [dropdown Pass/Fail, required]
   Hint: "These are operational values recorded on the task, not staff or billing metrics."
Default placement settings (overridable per workflow): Skippable [ ]  Skip comment required [ ]  Required inputs...
[Save] [Deactivate]
```
- Banner on edit: **"Editing this step doesn't change workflows that are already published. Workflows pick up changes only when you add the updated step to a new workflow version."** (addendum A). The step usage list shows "Used by: Standard Processing v1, v2 (snapshotted)".
- Deactivating hides the step from new workflow drafts; it does not touch published versions.
- Step titles unique among active steps [UX-PROPOSAL]. Needs `Workflow.Manage`.
- Deletion: not offered if used; "Deactivate" instead.

---

### S16 Admin: Workflow Designer and Publish

```text
Administration > Task Types > Workflows > Standard Processing           Draft v3 (published: v2)    [Validate] [Save draft] [Publish...]
Name [Standard Processing]   Description [____]
Execution mode:  (o) Ordered - steps must be resolved in sequence     ( ) Unordered - any order
+-- Step library (search) --+   +-- Workflow steps (this version) --------------------------------------+
| Intake QC          [+ Add]|   | 1 :: Intake QC         Required  Skippable: no                [Settings][^][v][x] |
| Load to Relativity [+ Add]|   | 2 :: Load to Relativity Required  Skippable: yes, comment required   [Settings] ...  |
| Deduplicate        [+ Add]|   | 3 :: Deduplicate ...                                                  |
+---------------------------+   +-----------------------------------------------------------------------+
Step settings drawer (per placement):
  Title/description/instructions/docs: inherited from library step "Deduplicate" (snapshot of current library state)  [Override...]
  Skippable [ ]   Comment required on skip [ ]  (disabled unless skippable)   Required to complete task [x]
  Input fields: add/override/hide library inputs; per-field required & conditional rules
  NO assignee, NO approver, NO approval gate controls.
Eligible Task Types (read-only list here; edited on the Task Type)  Used by 14 open tasks (v2)
```
- Switching mode Ordered <-> Unordered in a draft: confirm if it changes meaning ("Ordered numbering will be hidden; steps can be done in any order."). Ordering is meaningful only in Ordered mode; in Unordered mode the order is display-only.
- Reordering by drag handle **and** Up/Down buttons; add from library; remove; duplicate step placement.
- **Validate** checks: at least one step; no duplicate placements unless allowed; skip comment requires skippable; conditional rules valid; referenced library steps still active (warning if deactivated).
- **Publish screen/dialog.**
```text
Publish Standard Processing v3
Changes since v2: + Added "OCR"  ~ Changed skip rule on step 2  - Removed none
Impact: Existing tasks stay on their current version (14 open on v2). New tasks can use v3.
[ ] Make v3 the version offered for new tasks   (current published only; older versions retired for new tasks)  
[Publish v3] [Back to draft]
```
- Publishing snapshots the step definitions as they are now, so later library edits don't change it. Published versions are immutable; "Create new draft from v3" is the edit path. Retire version available.
- Version list tab: v1, v2 (retired for new tasks), v3 (current), with counts of tasks using each; read-only view of any version.
- Needs `Workflow.Manage`.

---

### S17 Admin: Asset Types

```text
Asset Types                                               [+ New asset type]
Relativity Workspace (4 fields) | Harvey Vault | Physical Drive/Media | Collection / Data Set | Production | Third-Party Data Set | Other
Editor: Name, Description, Active; Fields = the same form designer pattern (S14) using the Asset Type's form with conditional rules; preview.
```
- Field changes to an Asset Type apply immediately to future edits; existing values for removed fields are kept but hidden [UX-PROPOSAL, since Asset Types are not versioned in the baseline; flag in Appendix D].
- Link labels list (Source/Destination/Subject/Result) managed here as "Task link labels" (editable list) [UX-PROPOSAL pending OPEN-14].
- Needs `AssetType.Manage`.

---

### S18 Admin: Priorities, Status Labels, Custom Fields

**Priorities.**
```text
Priorities (system-wide)       Drag or use arrows to set order (top = most urgent)
 1 :: Critical  [color] Active   Default ( )     [Rename]
 2 :: High      ...
 3 :: Normal    ...              Default (o)
 4 :: Low
 [+ Add priority]
```
Labels only (no numbers shown to users). Exactly one default. Rename/deactivate allowed; existing tasks keep the label; deactivated priorities are not offered for new/changed tasks but still display. Color picker validates contrast ("Text must be readable: 4.5:1 minimum"). Live preview of the badge. Message: "Enter a label." "A priority named 'X' exists." "Choose a default priority." Needs `Priority.Manage`.
**Status labels.** Five fixed rows (internal code visible, read-only): `NEW`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `CANCELLED`; editable display label per row, live badge preview. Helper: "You can rename how statuses appear but not add or remove statuses." Needs `StatusLabel.Manage`.
**Custom fields (Client, Matter, Project, Asset).** Object selector tabs: Client | Matter | Project | Asset. **There is no Task tab** (global task custom fields dropped; Task-specific fields live in Task Type forms). Field list + the shared field designer pattern (label, key, type, required, default, help, order, validation, active, "Searchable in Advanced Search" toggle for indexed types only) and conditional rules where supported. Asset fields specific to a type are managed in S17. Needs `CustomField.Manage`.

---

### S19 Admin: Audit Log

```text
Administration > Audit Log           (needs Audit.View)
Filters: Date range | Actor | Object type (Task, Step, Client, Matter, Project, Asset, User, Role, Config) | Object id/ref | Event type
+---------------------+---------------+----------+---------------------+-----------------------+----------------------+
| Time (firm tz)      | Actor         | Object   | Event               | Field                 | Old -> New           |
```
Read-only, append-only, server-paginated; no export (addendum F). Object refs link to the entity. Old/new values display truncated with "Show full". Loading/empty ("No events match") / error states. Read-access logging does not exist and is not shown.

---

### S21 Access Pending

**Purpose.** Calm, restricted landing for authenticated users with zero effective permissions. Shown for any route; no navigation, no search, no data.

```text
+------------------------------------------------------------------+
|  MatterFlow                                                      |
|                                                                  |
|   Your access is pending                                         |
|   You're signed in as  Tariq Mahmood  (DOMAIN\tmahmood)         |
|   An administrator needs to give you a role before you can use   |
|   MatterFlow. Registered Oct 14, 2026, 9:05 AM.                  |
|                                                                  |
|   What to do next                                                |
|   - Ask your Pod Lead or manager to request access for you.      |
|   - Tell the administrator your Windows account name:  [Copy]    |
|   - Already granted? [Check again]                               |
|                                                                  |
|   Need help? Contact: <firm-configured contact>                  |
+------------------------------------------------------------------+
```
- Shows only the user's own minimal registration info (display name, Windows account, registered time, email if known).
- **Check again** re-fetches permissions; if permissions now exist, routes to the default landing page; otherwise "Still pending. Nothing has changed yet." (polite live region). No auto-polling, no notifications.
- If the account is disabled: different message "Your account is disabled. Contact the administrator." (no Check again).
- No search box, no nav, no API data; `Copy` copies the Windows account.
- Contact line is a configuration value; if unset, omit it.
- Accessibility: single `main`, H1 "Your access is pending", focus on H1 on load.

### S22 System pages
403 "You don't have permission to view this page" (links: Go to my work, Contact admin text); 404 "We couldn't find that page"; error page with correlation id and Copy; **Conflict dialog** (§5.3) "This task was changed by someone else. [Reload latest] [Review my changes]"; session/connection lost banner "Connection lost. Retrying..."; Browser sign-in problem page for failed Windows authentication.

---

## 7. Component inventory (reusable Angular components)

Prefix `mf-`. Standalone components, OnPush, signals-friendly inputs, a11y built in. Presentational components take inputs/outputs; data fetching lives in feature containers. The underlying component library is chosen in the architecture doc; these wrap it so screens stay library-agnostic.

| Component | Purpose | Key inputs / outputs | Used in |
|---|---|---|---|
| `mf-app-shell` | Header, left nav, banners, skip link, router outlet | `navItems`, permissions | all |
| `mf-global-search` | Header combobox typeahead (number-aware) | `query`, `(select)`, `(viewAll)` | header, S11/S20 |
| `mf-page-header` | Breadcrumb, H1, action slot | `title`, `crumbs[]` | all |
| `mf-data-table` | Server-paged sortable table with column chooser, density, skeleton/empty/error | `columns`, `rows`, `sort`, `page`, `state` | S02-S04, lists |
| `mf-filter-bar` / `mf-filter-drawer` / `mf-filter-chip` | Filters with URL state | `filterDefs`, `(change)` | S02-S04, S11 |
| `mf-filters-bar` / `mf-column-filter-row` / `mf-filter-chips` / `mf-filter-sheet` (shared/filters) | Inline column filters generated from one `FilterDef[]` with URL state (`ListFilters`); see docs/ux/column-filters/README.md | `filters`, `columns`, `controls` | Assets (more screens: epic #75) |
| `mf-task-table` | Task columns, default sort, inline edit hooks on top of data-table | `scope`, `columnsPreset` | S02-S04, Matter/Project |
| `mf-status-badge` | Lifecycle badge from code + label map | `code` | tasks everywhere |
| `mf-priority-badge` | Priority label + glyph | `priority` | tasks |
| `mf-due-cell` | ASAP / date / due soon / overdue display | `due`, `status` | tasks, dashboard |
| `mf-matter-ref` | Monospace `00343-00012` link (+ copy) | `clientNo`, `matterNo`, `link` | everywhere |
| `mf-number-input` | 1 to 5 digit input with live zero-padded preview | `value`, `label`, `(normalized)` | S05, S06 |
| `mf-entity-picker` | Typeahead for Client/Matter/Project/Asset/User/Pod; dependent filters; shows inactive marker | `type`, `scope`, `allowInactive` | forms, filters |
| `mf-assignee-picker` | User + Pod chooser with open-load hint, inactive handling | `taskId`, `(assign)` | S03, S04, S10 |
| `mf-inline-select` | Click-to-edit select with save/undo toast | `value`, `options`, `canEdit` | queues, header |
| `mf-stat-tile` | Dashboard count tile with drill link | `value`, `label`, `link` | S01 |
| `mf-bar-list-chart` | Accessible horizontal bars + table toggle | `series[]` | S01 |
| `mf-dynamic-form` | Renders a form definition version with conditional show/require; emits values + validity; same component used in Create, Task edit, Step inputs, Asset/Custom fields, designer preview | `definition`, `values`, `mode` | S08, S09, S10, S14-S18 |
| `mf-field-renderer` (+ per-type fields) | One field control with label, help, error | `field`, `control` | dynamic-form |
| `mf-form-designer` | Palette, canvas, properties, preview | `definition`, `(change)` | S14, S15, S17, S18 |
| `mf-rule-builder` | Structured condition/requirement editor with plain-language summary | `field`, `allFields` | form-designer |
| `mf-workflow-stepper` | Ordered/unordered step list with states, lock logic, reopen flag | `instance`, `mode`, `perms` | S10 |
| `mf-step-card` | One step: instructions, inputs, actions | `step` | stepper |
| `mf-skip-step-dialog` | Skip with (conditional) required comment | `step` | S10 |
| `mf-workflow-designer` | Library pane, ordered list, step settings drawer | `draft` | S16 |
| `mf-publish-dialog` | Diff + impact + confirm for form/workflow versions | `diff`, `impact` | S14, S16 |
| `mf-version-list` | Draft/Published/Retired history | `versions` | S14, S16 |
| `mf-status-menu` | Valid transitions only; triggers cancel/reopen/complete dialogs | `task`, `perms` | S02, S10 |
| `mf-cancel-task-dialog` | Mandatory comment cancel | `task` | S10 |
| `mf-confirm-dialog` | Generic confirm with verb buttons and consequence text | `title`, `body`, `confirmLabel`, `danger` | all |
| `mf-comment-thread` | List, edit/delete own, edit history | `taskId` | S10 |
| `mf-rich-text-editor` | Basic formatting (B/I/lists/link) and tables, paste/drop clean-up (lazy chunk), counter, live announcements | `value`, `maxLength`, `label`, `placeholder` | comments, Task description (Create, Edit), email intake review |
| `mf-activity-feed` | Filterable audit events with before/after | `objectRef` | S10, entity details |
| `mf-email-intake` | Drop zone + paste dialog + file picker + parse review panel | `(parsed)` | S09 |
| `mf-email-parser` (service) | Deterministic header/body parser | pure functions, unit tested | S09 |
| `mf-empty-state` / `mf-error-state` / `mf-skeleton` | Standard states | `message`, `action` | all |
| `mf-toast` / `mf-live-region` | Polite/assertive announcements, undo | service | all |
| `mf-error-summary` | Focusable validation summary with field links | `errors` | forms |
| `mf-permission-directive` (`*mfCan`, `mfCanDisable`) | Hide, or disable with reason | permission code, reason | all |
| `mf-unsaved-guard` | Route/dialog leave guard | `dirty` | forms, designers |
| `mf-conflict-dialog` | Concurrency conflict handling | `local`, `server` | forms, detail |
| `mf-pod-select` | Pod selector with memberships first | | S04, filters |
| `mf-permission-matrix` | Role editor grouped checkboxes with dependencies | `role` | S12 |
| `mf-pending-users` | Access queue and grant drawer | | S12 |
| `mf-access-pending` | S21 page | | auth route |
| `mf-copy-button` | Copy to clipboard with announcement | `text` | refs, Windows account |
| `mf-dev-auth-banner` | Non-production only identity switcher | | shell |

Shared utilities: number normalizer (`normalizeNumber('343') -> '00343'`), due-state calculator (firm timezone), default-sort comparator documentation (server is authoritative), HTML sanitizer for display, form-rule evaluator (mirrors server; server authoritative).

---

## 8. Copy deck (key messages)

Tone: plain, specific, no blame, no jargon. Sentence case. Buttons are verbs. Replace `<...>` placeholders at runtime.

### 8.1 Buttons and labels
Create task, Create and add another, Save changes, Save draft, Publish version <n>, Cancel task, Keep task, Reopen task, Reopen step, Skip step, Keep step, Mark complete, Complete task, Assign to me, Post comment, Link asset, Clear all filters, Retry, Check again.

### 8.2 Tooltips and helper text
| Context | Text |
|---|---|
| ASAP | "No due date set. Handle promptly." |
| ASAP column help | "ASAP tasks have no deadline and are never overdue." |
| Default sort | "Default order: priority, then ASAP, then due date, then oldest first." |
| Immutable task fields | "Can't be changed after creation. To correct this, cancel the task and create a new one." |
| Number input | "Enter 1 to 5 digits. Saved as <00343>." |
| Combined reference | "Client number and matter number, e.g. 00343-00012." |
| Assign helper | "Assigning a person starts the task. Assigning only a pod doesn't." |
| Intake privacy | "We read the subject, body, sender and sent date. Attachments and the original email are not saved." |
| Intake paste | "Drag-and-drop from Outlook may not work in your browser. Paste always works." |
| Step required | "This step is required and can't be skipped." |
| Reopened step | "Reopened. Later steps are unchanged. Resolve this step before completing the task." |
| Workflow ordered | "Ordered: complete or skip each step in order." |
| Workflow unordered | "Unordered: work these steps in any order." |
| Comments | "Internal only. Visible to people who can view tasks." |
| Workflow Steps edit | "Editing this step doesn't change workflows that are already published." |
| Status labels | "You can rename how statuses appear. You can't add or remove them." |
| Priority admin | "Order from most to least urgent. Users see labels, not numbers." |
| Pod lead | "Pod leads are a role. Assign the Pod Lead role under Users & Roles." |

### 8.3 Validation messages
| Condition | Message |
|---|---|
| Required generic | "Enter <field>." / "Select <field>." |
| Number not digits | "Use digits only." |
| Number > 5 digits | "Use at most 5 digits." |
| Duplicate client number | "Client <00343> already exists." |
| Duplicate matter number | "Matter <00012> already exists for client <00343>." |
| Email | "Enter a valid email address." |
| Form rules: Required (checkbox, choice, date, reference) | "Select <field>." |
| Form rules: Wrong type, generic | "Enter a valid <field>." |
| Form rules: Number not a number | "Enter a number." |
| Form rules: Date not a date | "Enter a valid date." |
| Form rules: Date and time not valid | "Enter a valid date and time." |
| Form rules: Out of range (both limits) | "Enter a value from <min> to <max>." |
| Form rules: Out of range (minimum only) | "Enter a value of <min> or more." |
| Form rules: Out of range (maximum only) | "Enter a value of <max> or less." |
| Form rules: Too long | "Use at most <n> characters." |
| Form rules: Pattern mismatch (no custom message) | "Enter <field> in the expected format." |
| Form rules: Option not available | "Choose one of the available options." |
| Form rules: Value for unknown field (server) | "This field is not part of the form." |
| Form rules (designer, publish-time) | Wording for every definition error code: `contracts/form-rules.messages.json`. Pattern mismatch shows the field's own plain-language message when the admin set one. |
| URL | "Enter a valid web address starting with http:// or https://." |
| Requestor name | "Enter the requestor's name." |
| Matter inactive on create | "This matter is inactive. Choose an active matter." |
| Project mismatch | "That project doesn't belong to this matter." |
| Asset mismatch | "That asset belongs to a different matter." |
| Cancel without comment | "Add a comment explaining why you're cancelling." |
| Skip without comment | "Add a comment to skip this step." |
| Step inputs missing | "Enter <field> to complete this step." |
| Complete blocked | "<n> required steps are unresolved: <names>." |
| Past due date | "This date has already passed. The task will be overdue immediately." |
| Time without date | "Enter a date before adding a time." |
| Form rule cycle | "These fields depend on each other: <A -> B -> A>. Remove one rule." |
| Dropdown no options | "Add at least one option." |
| Last admin | "At least one active System Admin is required." |

### 8.4 Dialogs and confirmations
- **Cancel task:** title "Cancel <TSK-1042>?" body "This marks the task Cancelled. Unresolved steps don't block this. You can reopen it later." buttons "Cancel task" / "Keep task".
- **Reopen task:** "Move <TSK-1042> back to In Progress?" "Reopen" / "Keep as is". Completed/Cancelled + inactive matter: disabled, reason "The matter is inactive, so this task can't be reopened."
- **Reopen step on completed task:** "Reopening this step moves the task back to In Progress. Later steps keep their status."
- **Skip step:** "Skip <step>? Skipped steps count as resolved."
- **Set matter inactive (blocked):** "This matter has <n> tasks that aren't Completed or Cancelled. Finish or cancel them first."
- **Set matter inactive (confirm):** "Set <00343-00012> inactive? New tasks can't be created and completed or cancelled tasks can't be reopened until it's active again."
- **Change task type on create form:** "Changing the task type clears the request details you entered."
- **Leave unsaved:** "You have unsaved changes." "Leave" / "Stay".
- **Conflict:** "Someone else changed this while you were editing." "Reload latest" / "Review my changes".
- **Delete comment:** "Delete this comment? It will be hidden from view but kept in the audit record."
- **Change client/matter number:** "Changing this number changes how matters are named in emails, workspaces and folders. This change is recorded."
- **Publish form/workflow:** "Existing tasks keep version <n>. New tasks will use version <n+1>. Published versions can't be edited."
- **Deactivate user:** "<Name> has <n> open tasks. They stay assigned until you reassign them one by one." [View their tasks]
- **Retire/deactivate priority:** "Existing tasks keep this label. It won't be offered for new changes."

### 8.5 Toasts
"Task <TSK-1043> created." / "Assigned to you. Task moved to In Progress." / "Priority set to <High>. Undo" / "Status changed to <On Hold>." / "Step completed." / "Step skipped." / "Step reopened." / "Comment posted." / "Saved." / "Couldn't save. Try again."

### 8.6 Empty, loading, error
| State | Text |
|---|---|
| My Work empty | "Nothing assigned to you right now. Check Pod Work for unassigned tasks." |
| Queue empty | "No tasks yet." |
| Filter empty | "No tasks match these filters." |
| Pod empty | "Nothing waiting in <Pod A>." |
| No pod | "You aren't in a pod yet. Ask an administrator." |
| Comments empty | "No comments yet." |
| Assets empty | "No assets linked." |
| Search empty | "No results for '<q>'. Try a client or matter number, a task title, or an asset name." |
| Search error | "Search is unavailable. Try again." |
| No task types | "No task types are set up yet. Ask an administrator." |
| Type without workflow | "No workflow available for this task type." |
| Generic error | "Something went wrong. Try again." + "Reference: <id> [Copy]" |
| Forbidden action | "You don't have permission to <action>." |
| 403 page | "You don't have permission to view this." |
| 404 page | "We couldn't find that." |
| Intake failure | "We couldn't read that drop. Paste the email text or choose a file instead." |
| Intake success | "Filled title, description, requestor and sent date. Review before you create the task." |
| Intake attachments | "Attachments aren't saved. Add what's needed to the description or an asset." |
| Pending users empty | "No one is waiting for access." |

### 8.7 Access Pending
Title "Your access is pending". Body "You're signed in as <Name> (<DOMAIN\user>). An administrator needs to give you a role before you can use MatterFlow." Next steps "Ask your pod lead or manager to request access for you. Give the administrator your Windows account name: <DOMAIN\user>." Check again result "Still pending. Nothing has changed yet." Disabled account: "Your account is disabled. Contact the administrator."

---

## 9. User-acceptance checklists

Use per screen. Pass requires all items true. IDs `UAT-<screen>-<n>`. "A11y" items apply WCAG 2.1 AA checks from §4.7. Baseline scenarios (SCN-xxx) referenced where relevant.

### Cross-cutting (apply to every screen)
- [ ] UAT-X-1 Matter references always shown as `#####-#####` zero-padded, monospace, linking to the Matter.
- [ ] UAT-X-2 Priority is a labelled badge with glyph; no numeric priority anywhere.
- [ ] UAT-X-3 No due date shows ASAP (not red); ASAP tasks never count or style as overdue (SCN-015).
- [ ] UAT-X-4 No approval controls, billing widgets, notification bell, step assignee pickers, attachment upload/list, bulk reassign, export buttons, subtasks, dependencies, related-task links, cloning anywhere.
- [ ] UAT-X-5 Controls the user lacks permission for are hidden (or disabled with a reason when state-blocked); direct URL/API access is still denied.
- [ ] UAT-X-6 Keyboard-only: every action reachable, visible focus ring, no trap, dialogs return focus.
- [ ] UAT-X-7 Screen reader (NVDA): landmarks, headings, labels, errors announced, table headers/sort announced.
- [ ] UAT-X-8 Text and UI contrast meet 4.5:1 / 3:1; badges readable in forced-colors mode.
- [ ] UAT-X-9 200% zoom and 1024 px width remain usable.
- [ ] UAT-X-10 Loading, empty, error states exist and match copy deck.
- [ ] UAT-X-11 Dates shown in the single firm timezone.
- [ ] UAT-X-12 Unsaved-changes guard works on every form.

### S01 Dashboard
- [ ] UAT-S01-1 Tiles show Open, Unassigned, Overdue, On Hold, Completed (period) with correct counts.
- [ ] UAT-S01-2 Each tile/bar drills to Task Queue with matching filters, and the count matches the list total.
- [ ] UAT-S01-3 Overdue excludes ASAP, Completed, Cancelled.
- [ ] UAT-S01-4 The Priority, Task type, Status and Age cards have text values, an overdue share per row ("N overdue", linked to the queue with `overdue=true`) and "View as table" with an Overdue column; Age has six buckets that add up to Open.
- [ ] UAT-S01-5 Recently created/completed lists link to tasks.
- [ ] UAT-S01-6 Without `Dashboard.View` the Dashboard item is hidden and the route is 403; with it but without a tab permission a note points to My Work; each tab appears only with its own permission.
- [ ] UAT-S01-7 No staff productivity, billing, or export features.
- [ ] UAT-S01-8 One failing widget shows its own error with Retry.
- [ ] UAT-S01-9 Swimlane: four lanes with exact counts, groups (priority, assignee, client / matter tree), sort, filters and the completed window; the board and its choices survive a reload and a copied link.
- [ ] UAT-S01-10 Swimlane: inline Status, Priority and Assignee menus with Undo, the drawer peek returns focus to its card, keyboard works without a mouse, and axe is clean.

### S02 My Work
- [ ] UAT-S02-1 Shows tasks assigned to me from all my Pods (SCN-007).
- [ ] UAT-S02-2 Active tab = New/In Progress/On Hold only; Completed tab shows completed/cancelled.
- [ ] UAT-S02-3 Due Soon excludes ASAP; includes overdue explicit dates.
- [ ] UAT-S02-4 Created by Me shows tasks I created regardless of assignee.
- [ ] UAT-S02-5 Default sort: priority, then ASAP first, then due ascending, then oldest.
- [ ] UAT-S02-6 Columns show priority, Matter ref, workflow progress (step n/m), due/ASAP, status.
- [ ] UAT-S02-7 Inline priority/assign only appears with permission.
- [ ] UAT-S02-8 Empty/loading/error states.

### S03 Task Queue
- [ ] UAT-S03-1 All listed filters work and combine; state survives reload/back via URL.
- [ ] UAT-S03-2 Search matches title and ref, partial, case-insensitive.
- [ ] UAT-S03-3 Matter/Client filters accept `343`, `00343`, `343-12`, `00343-00012`.
- [ ] UAT-S03-4 Assignee filter includes inactive users, marked "(inactive)", and Unassigned.
- [ ] UAT-S03-5 Overdue filter excludes ASAP; ASAP filter works.
- [ ] UAT-S03-6 Default sort verified with a seeded dataset: Critical ASAP, Critical overdue, Critical future, then High... (ASAP before explicit dates within priority; ASAP oldest first).
- [ ] UAT-S03-7 Column chooser and density persist per user; Ref and Title cannot be hidden.
- [ ] UAT-S03-8 Server pagination and sort with counts; sort headers announce `aria-sort`.
- [ ] UAT-S03-9 Inline priority/assignee changes save with Undo toast; read-only for Completed/Cancelled rows; hidden without permission.
- [ ] UAT-S03-10 Assigning a user to a New task shows it as In Progress.
- [ ] UAT-S03-11 No row selection/bulk actions.

### S04 Pod Work
- [ ] UAT-S04-1 Pod selector lists my Pods first; Primary Pod default; remembers last.
- [ ] UAT-S04-2 Pod queue shows tasks with the Pod and no assignee; By member view lists load.
- [ ] UAT-S04-3 Assign to me works for permitted users and moves New to In Progress with toast (SCN-006).
- [ ] UAT-S04-4 Cross-Pod assignment allowed; non-membership only informational.
- [ ] UAT-S04-5 Pod-only assignment doesn't change status.
- [ ] UAT-S04-6 Overdue & On Hold tab correct; counts match.
- [ ] UAT-S04-7 No ranking/performance display.
- [ ] UAT-S04-8 User with no Pods sees guidance.

### S05 Clients
- [ ] UAT-S05-1 Entering `343` previews and saves `00343`; `00343` is treated as the same client (SCN-001).
- [ ] UAT-S05-2 Duplicate (padded equivalent) rejected with link to existing.
- [ ] UAT-S05-3 6+ digits and non-digits rejected with copy-deck messages.
- [ ] UAT-S05-4 Search by `343`/`00343`/name works.
- [ ] UAT-S05-5 Number locked on edit; change requires confirm dialog and is audited.
- [ ] UAT-S05-6 Custom fields render and validate.
- [ ] UAT-S05-7 Detail shows matters; New Matter shortcut prefilled.
- [ ] UAT-S05-8 Create/Edit buttons hidden without permission.

### S06 Matters
- [ ] UAT-S06-1 Same matter number allowed under different clients; duplicate within a client rejected (SCN-002, SCN-003).
- [ ] UAT-S06-2 Combined reference preview updates live; display `00343-00012`.
- [ ] UAT-S06-3 Client locked after creation.
- [ ] UAT-S06-4 Set inactive blocked when any task is not Completed/Cancelled, with link to those tasks.
- [ ] UAT-S06-5 Inactive matter: banner shown; Create Task disabled with reason; reopen disabled with reason.
- [ ] UAT-S06-6 Detail tabs Tasks/Projects/Assets show correct data; Create Task prefilled.
- [ ] UAT-S06-7 Search accepts unpadded and hyphenated forms.

### S07 Projects
- [ ] UAT-S07-1 Create from Matter with Matter locked.
- [ ] UAT-S07-2 Moving a task offers only projects of the same Matter; Matter unchanged (SCN-005).
- [ ] UAT-S07-3 Archived project can't be chosen for new tasks, existing tasks keep it.
- [ ] UAT-S07-4 Flat structure (no nesting UI).

### S08 Assets
- [ ] UAT-S08-1 Create with Matter and Asset Type; type-specific fields appear and validate.
- [ ] UAT-S08-2 Matter and Type fixed after creation.
- [ ] UAT-S08-3 List handles 300 assets per matter with server search/pagination.
- [ ] UAT-S08-4 Detail lists linked tasks with link labels.
- [ ] UAT-S08-5 Linking from Task offers only same-Matter assets; cross-Matter rejected (SCN-016).

### S09 Create Task
- [ ] UAT-S09-1 Manual creation with required fields works; created task has the exact selected Type, Workflow, Matter.
- [ ] UAT-S09-2 Only active Matters selectable; project list limited to Matter.
- [ ] UAT-S09-3 Only task types with a published eligible workflow selectable; exactly one workflow chosen (SCN-009).
- [ ] UAT-S09-4 Dynamic form shows/hides fields and conditional requirements correctly; hidden fields not required; backend rejects missing visible required value (SCN-008).
- [ ] UAT-S09-5 Requestor name required; requestor email optional and format-validated.
- [ ] UAT-S09-6 Priority required, default applied; due date optional; blank = ASAP with explanatory text; time optional.
- [ ] UAT-S09-7 Assigning a user at creation yields In Progress; Pod only yields New.
- [ ] UAT-S09-8 Paste of an Outlook email (header + body) fills Title, Description, Requestor name/email, sent date; user can edit all; Task Type and Workflow remain manual (SCN-017).
- [ ] UAT-S09-9 Drag-drop of unsupported payload gives fallback message and focuses Paste; no crash.
- [ ] UAT-S09-10 Existing user input is not overwritten without choice.
- [ ] UAT-S09-11 UI states attachments and original email are not stored; no file is saved.
- [ ] UAT-S09-12 Without Quick fill, the form works fully (manual path).
- [ ] UAT-S09-13 Changing Task type warns before clearing details.
- [ ] UAT-S09-14 Failed validation shows summary, focuses it, errors per field; no partial task created.
- [ ] UAT-S09-15 Create and add another keeps Matter/Project/Priority/Pod.
- [ ] UAT-S09-16 Past due date shows a warning but is allowed.
- [ ] UAT-S09-17 Quick fill is fully keyboard operable.

### S10 Task detail
- [ ] UAT-S10-1 Header always shows Matter ref, title, priority, status, Pod/assignee, due/ASAP, workflow.
- [ ] UAT-S10-2 One page: Workflow and Comments (main), Details and Assets (side panel), Activity drawer. No tabs, no Attachments section.
- [ ] UAT-S10-3 Matter, Task Type, Workflow are read-only with lock explanation; Project is editable within the Matter.
- [ ] UAT-S10-4 Request form values editable and audited; form version caption shown.
- [ ] UAT-S10-5 Completed/Cancelled tasks are read-only until moved to In Progress; blocked with reason when Matter inactive.
- [ ] UAT-S10-6 Ordered workflow: later steps locked until earlier resolved (SCN-010); unordered: any order.
- [ ] UAT-S10-7 Skippable step with required comment cannot be skipped without comment (SCN-011); non-skippable step shows no Skip (SCN-012).
- [ ] UAT-S10-8 Completing a step validates visible required inputs incl. conditionals.
- [ ] UAT-S10-9 Reopen step requires no reason; downstream completed steps remain; reopened flag displayed (SCN-013).
- [ ] UAT-S10-10 Reopening a step on a Completed task moves the task to In Progress; both events in Activity.
- [ ] UAT-S10-11 Complete task with N unresolved steps shows "You have N steps not completed..." dialog; confirm completes all steps and the Task in one action; steps missing required inputs are listed and block completion.
- [ ] UAT-S10-12 Cancel works from any status; comment mandatory; unresolved steps don't block; comment appears in Comments.
- [ ] UAT-S10-13 Reopen Completed or Cancelled task to In Progress; disabled with reason if Matter inactive.
- [ ] UAT-S10-14 Assigning a user to a New task moves to In Progress; unassigning doesn't revert; Pod-only doesn't change status.
- [ ] UAT-S10-15 Status menu lists only valid transitions.
- [ ] UAT-S10-16 Comments: bold/italic/lists/links only; pasted other formatting stripped; script injection not rendered; own comment edit shows Edited + history; own delete is soft (hidden, audited); others' comments not editable.
- [ ] UAT-S10-17 Comments carry no attachment option and are labelled internal.
- [ ] UAT-S10-18 Assets tab links only same-Matter assets with relationship label.
- [ ] UAT-S10-19 Activity shows status, assignment, field, step, comment, asset events with actor/time and old/new values.
- [ ] UAT-S10-20 Task from a version-2 workflow still shows v2 steps after v3 published (SCN-014).
- [ ] UAT-S10-21 Concurrency conflict dialog appears when another user changed the task.
- [ ] UAT-S10-22 No step assignee, no approval UI.
- [ ] UAT-S10-23 Stepper uses ordered list semantics with `aria-current`, lock reasons accessible.

### S11 and S20 Search
- [ ] UAT-S11-1 Header search visible on every page except Access Pending.
- [ ] UAT-S11-2 Typeahead groups Matters, Clients, Tasks, Projects, Assets, max 5 each, debounced.
- [ ] UAT-S11-3 `00002-00001`, `2-1`, `00002-1` resolve to matter 00002-00001 (SCN-020).
- [ ] UAT-S11-4 Results contain only records the user may view.
- [ ] UAT-S11-5 View all leads to paginated, tabbed results page.
- [ ] UAT-S11-6 Keyboard: Ctrl+K/`/`, arrows, Enter, Esc; combobox semantics.
- [ ] UAT-S11-7 Empty/error messages per copy deck.
- [ ] UAT-S11-8 Advanced search filters per object; custom fields only if flagged searchable.

### S12 Users, roles
- [ ] UAT-S12-1 First login of unknown Windows user appears in Pending access with zero roles; repeated login creates no duplicate.
- [ ] UAT-S12-2 Granting a role and Pods takes effect on the user's next check (Check again).
- [ ] UAT-S12-3 Role editor permissions grouped, dependencies auto-handled; built-in System Admin locked.
- [ ] UAT-S12-4 Pod Lead appears as an ordinary role.
- [ ] UAT-S12-5 Deactivating a user shows open-task count and link; no bulk reassign exists.
- [ ] UAT-S12-6 Cannot remove the last active System Admin.
- [ ] UAT-S12-7 Roles in use cannot be deleted.
- [ ] UAT-S12-8 Requires `Role.Manage`; others get 403 (SCN-019).

### S13 Pods
- [ ] UAT-S13-1 Create/edit Pod; add/remove members; user can be in multiple Pods.
- [ ] UAT-S13-2 No per-pod lead flag; guidance text present.
- [ ] UAT-S13-3 Unique pod name validated; deactivation shows open-task impact.
- [ ] UAT-S13-4 Pods is the third tab of Users; `/admin/pods` and `?pod=` deep links work; there is no separate Pods menu item and Users stays highlighted.
- [ ] UAT-S13-5 Users grid Pods column: chips (primary starred with the text Primary), inline popover to add/remove pods and choose the primary one with Apply/Cancel; removing the primary asks for the new one; one Undo; read-only without Pod.ManageMembers.

### S14 Task Types and form designer
- [ ] UAT-S14-1 Palette contains exactly the specified controls; no File Upload.
- [ ] UAT-S14-2 Add, reorder (drag and Up/Down buttons), edit, remove fields; keys stable after first save.
- [ ] UAT-S14-3 Conditional show and conditional required rules can be built; plain-language summary shown.
- [ ] UAT-S14-4 Preview behaves identically to Create Task rendering.
- [ ] UAT-S14-5 Validation blocks publish for circular rules, missing refs, empty dropdowns, invalid patterns.
- [ ] UAT-S14-6 Publish dialog shows diff and impact; published version becomes read-only; edit creates a new draft.
- [ ] UAT-S14-7 Existing tasks keep their form version after a new publish.
- [ ] UAT-S14-8 Eligible workflows association; type with none is flagged and not usable for new tasks.
- [ ] UAT-S14-9 Requires `TaskType.Manage`; unsaved-changes guard.
- [ ] UAT-S14-10 Designer is operable by keyboard alone.

### S15 Step Library
- [ ] UAT-S15-1 Create step with title, description, instructions, doc URL, data inputs.
- [ ] UAT-S15-2 Editing a step shows the "doesn't change published workflows" notice, and published workflows are unchanged (addendum A).
- [ ] UAT-S15-3 Used-in list visible; deletion replaced by deactivate when used.
- [ ] UAT-S15-4 Inputs described as operational values, not staff metrics.
- [ ] UAT-S15-5 One "Task Types" menu item with the tabs Task Types, Workflows and Workflow Steps; /admin/task-types, /admin/workflows and /admin/steps open their tab; the step pages' breadcrumb is Administration > Task Types > Workflow Steps > step.
- [ ] UAT-S15-8 The Workflow Steps list has a Used in column ("Used in 3 workflows", "Not used" when none); the link opens the Workflows tab filtered by that step (`?step=:id`, a removable chip "Step: X" and the line "Filtered by step X"). The Task Types tab lists each type's workflows as chips (default starred and marked "default", three then "+n more", "No workflow" as a warning) that open the workflow, and "+n more" / "Workflows (n)" open the Workflows tab filtered by the task type (`?taskType=:id`); the Workflows tab lists the task types per workflow the same way (`?workflow=:id` on the Task Types tab).
- [ ] UAT-S15-6 Tags: add with Enter or comma, remove with Backspace or the "Remove tag X" button, suggestions from existing tags, limits explained (40 characters, 20 tags).
- [ ] UAT-S15-7 The Workflow Steps list shows a Tags column, searches tag text and filters by tags (Match all by default, Match any on request); the designer's step picker shows tags and finds steps by tag.

### S16 Workflow designer
- [ ] UAT-S16-1 Choose Ordered/Unordered; ordering UI only meaningful for ordered; mode change confirm.
- [ ] UAT-S16-2 Add/reorder/remove library steps with keyboard and mouse.
- [ ] UAT-S16-3 Per-step skippable and skip-comment-required settings; comment-required disabled unless skippable.
- [ ] UAT-S16-4 No assignee/approval settings exist.
- [ ] UAT-S16-5 Validate and Publish with diff and impact; existing tasks remain on old version (SCN-014).
- [ ] UAT-S16-6 Published version immutable; new draft required to edit; version list with usage counts.
- [ ] UAT-S16-7 Only current published version is offered to new tasks.

### S17 Asset Types
- [ ] UAT-S17-1 Create type with fields and conditional rules; preview works.
- [ ] UAT-S17-2 Fields appear in Asset create/edit.
- [ ] UAT-S17-3 Removing a field keeps existing values hidden, not deleted.

### S18 Priorities, labels, custom fields
- [ ] UAT-S18-1 Priority add/rename/reorder/deactivate; exactly one default; colour contrast validated.
- [ ] UAT-S18-2 Changes don't alter existing tasks' labels beyond rename; deactivated priorities still display.
- [ ] UAT-S18-3 Status labels: five fixed rows, editable labels, codes read-only, no add/remove.
- [ ] UAT-S18-4 Custom fields tabs only Client, Matter, Project, Asset (no Task tab).
- [ ] UAT-S18-5 Custom fields render on the relevant create/edit/detail screens.

### S19 Audit
- [ ] UAT-S19-1 Visible only with `Audit.View`.
- [ ] UAT-S19-2 Filters by date, actor, object, event; paginated.
- [ ] UAT-S19-3 Shows events listed in baseline §11.3 and admin/config/user-provision/access-grant events.
- [ ] UAT-S19-4 Read-only; no export; no read-access log entries.

### S21 Access Pending
- [ ] UAT-S21-1 A user with zero roles lands on Access Pending from any URL; sees only own registration info.
- [ ] UAT-S21-2 No nav, search, or data; direct API calls denied.
- [ ] UAT-S21-3 Check again routes to the app after access is granted; otherwise says still pending.
- [ ] UAT-S21-4 Disabled account shows the disabled message.
- [ ] UAT-S21-5 Copy button copies Windows account; screen reader announces result.
- [ ] UAT-S21-6 Role removal mid-session returns the user to this page on next request.

### S22 System pages
- [ ] UAT-S22-1 403/404/error/conflict pages match copy deck and offer next steps.
- [ ] UAT-S22-2 Error page shows a copyable correlation id; no stack traces or privileged content.

---

## Appendix A: Addendum deltas applied to baseline §19

| Baseline | Change in this spec |
|---|---|
| §19 item 9 (create from email) | Parse-and-discard; no source email file; Requestor Name/Email fields; paste/manual always available; drag-drop an enhancement (spike) |
| §19 item 10 (Task detail) | No attachments; Matter/Type/Workflow immutable; Project movable in-Matter; cancel with mandatory comment; reopen from Completed/Cancelled; rich text comments |
| §19 item 14 (form designer) | No File Upload control |
| §19 item 18 (global custom fields) | No Task-level global custom fields; only Client, Matter, Project, Asset |
| §19 item 13 (Pods) | Pod Lead is a role, not a per-Pod flag |
| §19 item 12 (Users) | Offboarding manual, one-by-one; inactive users in assignee filter |
| Matter/Client numbers | 1 to 5 digits, normalized to 5-char zero-padded, search accepts either |
| Sorting | ASAP above explicit due dates within a priority |
| Visibility | Any `Task.View` holder sees all tasks; no ethical-wall UI |
| Removed | Reports/exports, bulk reassign, subtasks, dependencies, related tasks, cloning, read-audit logging |

## Appendix B: Status transition rules used by the UI

Internal codes fixed: NEW, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED. Rules (addendum-derived, plus UX-proposed gaps):
- New -> In Progress (manual, or automatic when a user is assigned); New -> On Hold [UX-PROPOSAL]; New -> Cancelled (comment).
- In Progress -> On Hold; -> Completed (workflow resolved, `Task.Complete`); -> Cancelled (comment).
- On Hold -> In Progress; -> Cancelled (comment).
- Completed -> In Progress (reopen; blocked if Matter inactive); Cancelled -> In Progress (reopen; same block).
- Completed -> Cancelled and Cancelled -> Completed are not offered (go via In Progress) [UX-PROPOSAL].
- Cancel allowed at any non-cancelled state, comment mandatory, workflow state irrelevant.
- Editing a Completed/Cancelled Task requires first moving to In Progress.
- Reopening a step on a Completed Task auto-moves it to In Progress.
- Assigning a user to New -> In Progress. Pod-only assignment: no change. Unassigning: no revert.
- Task can only be created on an active Matter; Matter can go inactive only if all tasks are Completed/Cancelled.

## Appendix C: Permission-to-UI map

| Permission | UI it gates |
|---|---|
| `Client.View/Create/Edit` | Clients nav, New/Edit client, change number |
| `Matter.View/Create/Edit` | Matters nav, New/Edit matter, set inactive/active |
| `Project.View/Create/Edit/Archive` | Projects list/dialog, archive |
| `Task.View` | All task screens, search results for tasks, dashboard drill-through |
| `Task.Create` | Create Task buttons and page |
| `Task.Edit` | Edit details, request form values, move Project |
| `Task.Assign` / `Task.Reassign` | Assignee/Pod pickers, Assign to me |
| `Task.SetPriority` | Priority inline/edit control |
| `Task.ChangeStatus` / `Task.Complete` / `Task.Reopen` | Status menu entries; Complete; reopen task |
| `Task.Comment` | Comment composer, cancel (comment is part of cancel) |
| `Workflow.Execute` / `Workflow.StepEdit` / `Workflow.StepReopen` | Complete/skip steps; edit inputs; reopen step |
| `Asset.View/Create/Edit/Link` | Assets screens; link in Task |
| `Pod.View/Manage/ManageMembers` | Pod Work, Pods admin |
| `Role.Manage` | Users & Roles admin (incl. grant access) |
| `TaskType.Manage` | Task Types and form designer |
| `Workflow.Manage` | Step Library, Workflow designer |
| `AssetType.Manage`, `CustomField.Manage`, `Priority.Manage`, `StatusLabel.Manage` | respective admin screens |
| `Dashboard.View` | Dashboard nav item and route (403 without it); a tab permission has no effect without it |
| `Dashboard.ViewUnassigned` | The Summary tab with only the Unassigned queue (technicians; needs `Dashboard.View`) |
| `Dashboard.ViewSummary` / `ViewBreakdowns` / `ViewTrends` / `ViewSwimlane` / `ViewUsers` | The Summary, Breakdowns, Trends, Swimlane and Users tabs of the Dashboard (and the matching part of the server payload) |
| `Audit.View` | Audit Logs; old/new values in Activity |

## Appendix D: UX proposals and open questions for the product owner

Items tagged [UX-PROPOSAL] above need confirmation. Highest impact:
1. **Email intake paths:** Is a `.eml`/`.msg` file picker (parsed in memory, discarded) acceptable alongside paste and drag-drop? Does Outlook "copy" reliably include the From/Sent header block?
2. **Due soon threshold** (2 days) and whether Due Soon tab excludes ASAP tasks (proposed: yes).
3. **Step completion vs task status:** should completing/saving a step on a New task move it to In Progress? (Spec: no.)
4. **Completion policy for unresolved optional/skippable steps (OPEN-05):** must they be Skipped, or may they stay unresolved?
5. **Task description format:** plain multi-line (proposed) versus rich text.
6. **Zero as a client/matter number** (`0` -> `00000`): allow?
7. **Number editing:** is "restricted, audited Change number" acceptable for users with edit permission?
8. **Asset Type changes:** not versioned in baseline; proposed hide-not-delete behavior on removed fields. Link labels (Source/Destination/Subject/Result) configurable (OPEN-14)?
9. **Dashboard scope**: who gets which tab (`Dashboard.View` plus one permission per tab); whether technicians should see the department counts of Summary or only the unassigned queue (decided, issue #81: only the unassigned queue, `Dashboard.ViewUnassigned`).
10. **Task Activity values** visible only with `Audit.View`?
11. **Inactive Client** behavior (blocks new Matters?).
12. **Comment deletion** leaves no tombstone in the thread.
13. **Draft step input saving** before completion allowed?
14. **Past due dates** allowed with warning (proposed).
15. **Pending-user badge** on Administration nav acceptable (not a notification system)?
