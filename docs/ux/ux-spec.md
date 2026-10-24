# MatterFlow UX Specification (Phase 1)

**Version:** 1.0 draft  **Date:** 2026-10-14  **Audience:** Product owner, Angular engineers, QA, backend/architecture
**Sources:** `docs/requirements/baseline-v1.1.md` (baseline) and `docs/requirements/decisions-addendum.md` (addendum). **The addendum overrides the baseline.** Where this spec makes a UX choice the sources leave open, it is tagged **[UX-PROPOSAL]** and collected in Appendix D for product-owner confirmation.
Helper file: `docs/ux/tokens.css` (design tokens as CSS custom properties).

## Contents
1. Personas and top jobs-to-be-done
2. Information architecture and navigation
3. Design principles
4. Design tokens, badges, accessibility (WCAG 2.1 AA)
5. Global patterns (app shell, tables, forms, dialogs, errors, permissions, numbers, record pages)
6. Screen specifications S01 to S24
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
  My Matters                       /my-matters   (Matter.BeManager + Matter.View + Task.View; above My Work, S24)
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
- Default landing: My Matters if the user holds `Matter.BeManager`, `Matter.View` and `Task.View` (a Project Manager; **not** the System Admin, who holds every permission implicitly and keeps the landing below unless they also hold the Project Manager role, #691 and addendum AG item 12); else My Work if the user has any Pod membership or assignment, else Task Queue, else Dashboard (the full rule is `defaultLandingPath`, #628). A user with zero permissions is redirected to Access Pending from every route.
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
- The title of a Client, Matter or Project page is the H2 size (22 px, `--mf-fs-h2`), the H3 size (18 px) below 640 px; its crumb is 13 px. No token was added for the Clients epic.
- 12 px only for captions and badges (badges semibold). Non-table content works at 200% zoom and 400% reflow (WCAG 1.4.4, 1.4.10); tables scroll horizontally inside their own region.

### 4.3 Spacing and layout
4 px base: 4, 8, 12, 16, 24, 32, 48. Gutters 24 px. Forms single column, max 720 px; tables full width. Row height 44 (Comfortable) or 36 (Compact toggle) on the work grids (see Density below). Minimum target 24x24 CSS px (buttons 32+).

### 4.4 Status badges (lifecycle)
Always show the (configurable) label text plus an icon; pill, 12 px semibold, 4 px radius. Internal code kept in `data-status`.

| Code | Default label | Fg / Bg | Icon |
|---|---|---|---|
| `NEW` | New | #374151 / #FFFFFF, outlined | dot (filled circle) |
| `IN_PROGRESS` | In Progress | #0B5E55 / #DDF3EF | play-circle |
| `ON_HOLD` | On Hold | #111827 / #A9B0BB | pause-circle |
| `COMPLETED` | Completed | #146C2E / #E5F5EA | check-circle |
| `CANCELLED` | Cancelled | #4B5563 / #ECEEF1 | x-circle |

**One colour language (My Work review M9, #162).** Each colour means one thing across every list, the Dashboard and the Swimlane: the **left stripe is overdue** (red `--mf-due-overdue`, always together with the "Overdue Nd" text); **amber is High priority** (and the generic warnings); **grey with a pause icon is On Hold**; **blue with a bolt is ASAP** (blue is also the link and brand colour, but never a status). New is therefore a neutral dot in the Ref cell (the pill in the Title cell was removed with #196), not blue; On Hold is no longer amber. Contrast: both pills pass 4.5:1 (New 10.3:1, On Hold 8.1:1) and the On Hold fill is clearly darker than the High fill in greyscale, so the two stay apart without colour; the pause icon and the label are the non-colour cues, and forced-colours mode keeps the pill border, icon and text. Charts that colour by status use the same family (New dark slate `--mf-st-new-fg`, In Progress teal, On Hold mid grey `--mf-border-strong`) and always name the row in text.

**On Hold rows (#165, #182).** The row says why: the Status cell shows the pill and, on a second muted line, the reason (the latest hold comment as plain text, one line with an ellipsis; the tooltip and the screen reader text hold up to 200 characters, `...` after a cut). A pause marker with the accessible name "On hold" starts the Ref cell; the title and ref are not dimmed because the task still needs attention. In Compact density there is no second line (tooltip only); on a phone card the reason is its own line (pause icon and the reason; the old "Waiting: ..." line under the title is gone). A task on hold without a hold comment (data from before the rule) shows the pill and the marker only.

**Density (Comfortable and Compact; #210, #211).** A per-user, per-page preference (`mf.work-table.v3.<page>.<userId>`: Task Queue, My Work, Pod Work) in the Columns panel; it applies to the Matter and Project grids too and never changes column widths (user widths apply in both). **Comfortable rows are exactly 44 px** (two title lines, Matter reference over name, Due on two lines, Status pill with the hold reason). **Compact rows are exactly 36 px, one line per cell, in every state:** Title one line with an ellipsis (the tooltip and the accessible description carry the whole title and the hold reason), Matter reference only (no name), Due inline (`Oct 17 Overdue 6h`), Status and Priority pills without the hold note (the pause marker stays in Ref; the reason is the tooltip and screen reader text), Progress on one line, every other text cell (Client, Type, Workflow, Pod, names) one line with an ellipsis (`white-space: nowrap`). Skeleton rows have the row height of the density, so the first paint shifts nothing (CLS under 0.02). Group header rows are 36 px in both densities. Targets stay at least 24 px: the Title link and the pills are 24 px or more, and the 16 to 18 px text links (Matter reference, current-step link) get 3 to 4 px of vertical padding so they are 24 px targets without growing the line (WCAG 2.2 2.5.8). The focus ring (2 px outline with a 2 px offset, drawn in the system colour in forced-colours mode) stays inside the cell of the 36 px row and is not clipped; verified with `forcedColors: active` emulation (wp19-compact). Rows in view at 1366x768 (Compact, measured): Task Queue 13 (14 with the filter row closed), My Work 11 (12 with it closed); 23 on Task Queue at 1920x1080.

### 4.5 Priority badges
Admin-defined labels ordered by `SortOrder` (first = most urgent). Badge = label text + small level-bar glyph (1 to 4 bars by rank) so it is not colour-only. Defaults: **Critical** (white on #B42318), **High** (#5C2E00 on #FFD9A8), **Normal** (#1B1F27 on #E3E7EE), **Low** (#3B4350 on #F1F3F6). Admin colour overrides are validated for 4.5:1 text contrast on the Priorities screen; extra priorities use a neutral style plus glyph. Priority is never shown as a number.

### 4.6 Due date display (`mf-due-cell`, #208, #209)
One component, `mf-due-cell` (`shared/work-queue/due-cell.ts`), renders `describeDueCell` (`core/time/time.ts`) in the work grids (My Work, Task Queue, Pod Work, Matter and Project grids). The Dashboard Summary lists (#213), the Swimlane card and drawer, the Users drawer (#214) use the same component in its **inline** layout (`layout="inline"`: `Oct 17 Overdue 6h` on one line; the date gives way with an ellipsis, the relative text never does) and so say the same words as the grids ("In 2 days", "Overdue 24d", "Due today"). The old `describeDue`, the `dueLabel` and `dueState` pipes and `mf-due-chip` are gone; `dueCellText` (`core/time/time.ts`) is the one-line text for places that cannot hold a component (the Users table's next-due column). The Summary lists' creation age ("Created today", "10 days old") moved into the Due cell tooltip ("Created 10 days ago", after the full date). The task header and the Details tab use it in the two-line layout (the date with its time, then the relative text). The Swimlane Completed lane keeps "Done / Cancelled date".

| State | Line 1 (date) | Line 2 (bold) | Style |
|---|---|---|---|
| No due date | `ASAP` with a bolt (one line) | none | Blue ASAP token (`--mf-asap`), bold, never red, never overdue. Tooltip "No due date set. Handle promptly." |
| Overdue (date-only: after the due day in the viewer's zone; with time: after that instant), open task | `Oct 17, 6:00 AM` or `Oct 13` | `Overdue 6h`, `Overdue 4d`, `Overdue 120d` | Red (`--mf-due-overdue`) on both lines, alert icon before line 2; the row keeps the red left bar |
| Due today | `Oct 17, 11:59 PM` or `Oct 17` | `Due today` | Amber (`--mf-due-soon`) line 2 with a clock icon |
| Tomorrow, in 2 days | the date, with the time when one was set | `Tomorrow`, `In 2 days` | Bold, neutral colour (these two and Due today are what the Dashboard Due soon tile counts, so they always have line 2) |
| Later | the date, `Jan 5, 2027` with the year only outside the current year | none | Normal |
| Completed / Cancelled | the date | none | Muted, plain: no bolt, no red, no icon; no date shows `-` |

- **Eight states** (`describeDueCell`): ASAP, overdue with a time, overdue with a date only, due today, tomorrow, in 2 days, later, closed. There is no "Due soon" label and no "Overdue 9w" cap: the overdue text is hours below a day (`Overdue 6h`, `Overdue <1h`), then whole days (`Overdue 120d`).
- **Year rule.** The date has no year inside the current calendar year in the viewer's zone (`Oct 17`) and a year outside it (`Jan 5, 2027`).
- **No zone in the cell.** The zone abbreviation (EDT) is not part of line 1 or 2, in any layout. It is only in the tooltip of a timed due (`Oct 17, 2026, 6:00 AM EDT`); a date-only due has no zone because it is a calendar day. Addendum M still applies to every other timestamp (comments, activity, task detail); see addendum U.
- Two lines at Comfortable (18 px each, no gap, cell centred in the 44 px row); at Compact (and cards) the **inline** layout puts the date and the relative text on one line (`Oct 17 Overdue 6h`, a gap and no separator; time and year only in the tooltip).
- Colour is never the only cue (icon and words); every tone is at least 4.5:1 against the row.
- **One accessible name:** a visually hidden sentence (`Due Oct 17 at 6:00 AM, overdue 6 hours`, `Due tomorrow, Oct 18`, `No due date, ASAP`, `Was due Oct 1`); the visible lines are `aria-hidden`; line 1 is a `<time datetime>`; the cell `title` is the full date with the zone abbreviation for a timed due (`Oct 17, 2026, 6:00 AM EDT`), the full date for a date-only due, and "No due date set. Handle promptly." for ASAP. The Due column header tooltip does not carry the zone: it only says "Due (ASAP first)" or "Due (ASAP last)" while the list is sorted by Due.
- Due column: 136 px (minimum 120, maximum 200; see 5.2). Sorting (`aria-sort`), the Due filter cell and the Group by Due headers are unchanged; the Recently completed view shows Closed instead of Due. A task that is Completed or Cancelled shows its due date muted with no line 2 (`Was due Oct 1` to a screen reader), or `-` when it never had one.
- Timed dues are instants and show in the viewer's zone; date-only dues are floating calendar days judged in the viewer's zone (addendum M).

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
Left nav collapses to icons under 1100 px. Skip link first in DOM. A page with a list puts its own skip link ahead of "Skip to main content" as the first Tab stop ("Skip to task list" on the work pages, "Skip to table" on Clients, Matters, Projects and the record tabs that list rows; 5.2 and 5.9); a focused skip link fills the header strip on every width with an inside focus ring. Client, Matter and Project pages have a record header instead of the plain page header (5.9). Slim banners for: inactive-matter context, connection lost, dev-auth.

### 5.2 Tables (all queues and lists)
- Server-side pagination (default 50; 25/50/100), sort and filter. Footer: "Showing 1-50 of 312", Rows per page, and the pager (see the grid contract below).
- Sortable headers are buttons with `aria-sort`. Column chooser and density toggle per user (remembered); Ref and Title cannot be hidden.
- Filters: **inline column filters** (one `FilterDef[]` per grid; the standard is `docs/ux/column-filters-review.md` section 4 and the parts are in `docs/ux/column-filters/README.md`): a filter row under the column headers, a Filters toggle (`Filters (n)`: defaults are not counted), removable chips while the row is closed or for a filter on a hidden column, and **one** Clear filters (the bar shows none while an empty list offers its own). Filter state lives in the URL (shareable, back-button safe; any change resets the page). Below 768 px or when the grid overflows sideways the row is a **Filters sheet** with the same controls. A filtered grid prints with a "Filters: ..." line. See "Inline column filters" below for the rules and the surfaces.
- Loading: skeleton rows with the final column widths and row height of the density, `aria-busy`; refresh keeps old rows dimmed. Empty: message + primary action when permitted. Empty after filtering: "No tasks match these filters." + Clear filters. Error: inline alert ("Couldn't load tasks.") with Retry, keeping previous rows.
- Row actions: title link; overflow menu for secondary actions; inline edit of Priority/Assignee/Pod only with `Task.SetPriority`/`Task.Assign`/`Task.Reassign` (saves on change, toast with Undo for 8 s [UX-PROPOSAL]).
- No selection checkboxes in Phase 1 (bulk reassign dropped).

**The work grid contract (Task Queue and shared grid review, epic #195).** `mf-task-table` is the one grid of the Task Queue, My Work, Pod Work and the Matter and Project task lists, so every consumer inherits the numbers below. They are in code in `shared/work-queue/column-prefs.ts` (`ColumnDef`) and `task-table.scss` / `src/styles/_tables.scss`; `docs/ux/tokens.css` repeats them as `--mf-grid-*` and `--mf-col-*` tokens (a unit test keeps the column tokens equal to `column-prefs.ts`).

| Part | Number |
|---|---|
| Row, Comfortable | **44 px**, exactly, in every state (one line, two lines, long title, unbroken token, On Hold, closed): 2 px padding above and below, the 1 px line under the row, at most 39 px of content |
| Row, Compact | **36 px**, exactly, one line per cell, in every state |
| Line height | **18 px** for the two-line cells (Title, Due), 13 px for the hold reason under the Status pill |
| Header row, filter row | 40 px each (the filter row sticks under the header row) |
| Group header row (Due-sorted dividers) | 36 px in both densities; 44 px buttons on phone cards |
| Targets | at least 24 px (WCAG 2.2 2.5.8); the Title link has a 24 px box centred in the row |
| Rows in view at 1366x768 (Comfortable, measured) | Task Queue 11, My Work Active 9 (it has the strip); Compact 13 and 11 |

*The two-line rule.* Comfortable is the only density with a second line, and only these cells have one (the Matter cell lost its name line in #348: the work grids show the name in the Matter Name column):

| Cell | Line 1 | Line 2 (muted or bold) | Compact |
|---|---|---|---|
| Title | type icon and title | the same title wraps (at most two 18 px lines, then an ellipsis; the whole title is the tooltip) | one line with an ellipsis |
| Due | the date | `Overdue 6h`, `Due today`, `Tomorrow`, `In 2 days` (see 4.6) | inline: `Oct 17 Overdue 6h` |
| Status | the pill | On Hold only: the reason, 13 px, one line | pill only; the reason is the tooltip |

**Matter Number and Matter Name (#348).** The `matter` column is labelled **Matter Number** everywhere (header, sort tooltip, "Sorted by" note, Columns panel, column menu, widths panel, filter label, announcements, print); its storage key stays `matter`, so stored columns, widths and sorts survive the rename. Its cell is the matter reference only (monospace, a link with `Matter.View`, the sensitive marker), one line; the cell tooltip is `Client . Matter name`. The new column **Matter Name** (`matterName`, Columns panel group Where, right after Matter Number) shows the matter name on one line with an ellipsis, the full name as the tooltip, "(inactive)" appended for an inactive matter, a link to the matter with `Matter.View` and plain text without it; it sorts server-side (`sort=matterName`, accent- and case-insensitive, ties by matter reference then task id; unknown sort keys are still a 400) and has no column filter (the Matter Number filter finds a matter by reference or by name). `mf-matter-cell` keeps its two-line mode (`nameLine`, default on) for the Projects list; the grids pass `nameLine=false`. The Matter and Project task lists hide both columns (`hideContext`). Phone cards are unchanged (they show reference and name).

Every other cell (Client, Task type, Workflow, Pod, names, dates, Age, Progress) is one line with an ellipsis; the cell never wraps and never makes the row taller. There is no `ref . client . matter` line under the Title and no progress under it (decision, addendum U).

*Fixed layout.* The table is `table-layout: fixed` with a `<colgroup>`: one `<col data-col>` per shown column, shared by the header, the filter row, the group rows and the skeleton, so nothing moves when rows arrive or the filter row opens. Each `<col>` reads `--w-<key>` (rem, so text-only zoom scales the columns, WCAG 1.4.4; the app's root font size is 14 px, so 136 px is 136 px at the default zoom). **The Title is the spring:** it has no width, takes what the other columns leave, never goes under 160 px (its minimum), and is not resizable. The table's `min-width` is the fixed columns plus the Title minimum, so the grid scrolls sideways only below that.

*Widths (px at the default zoom: default, minimum, maximum).* Ref 112 (80 to 120); Title spring (160 minimum); Matter Number 144 (112 to 320); Matter Name 160 (112 to 360); Client 140 (96 to 280); Project, Task type, Pod, Creator, Requestor 140 (96 to 280); Workflow 150 (96 to 280); Workflow progress 160 (120 to 320); Priority 112 (96 to 160); Assignee 136 (112 to 240; 216 on Pod Work, where "Assign to me" shares the cell); Due 136 (**120** to 200); Status 140 (112 to 200); Closed 104 (88 to 160); Age 64 (56 to 100); Created 104 (88 to 160); Updated 120 (96 to 180). Ref is 112 px (not the 96 px of the review) so the pause marker and the New dot fit beside a four-digit number; Due has a 120 px minimum so `Overdue 120d` with its icon fits. A column that is added must declare these three numbers and say whether it may drop out (`autoHide`).

*One narrow-box rule.* While the Title would be narrower than 200 px, the columns marked `autoHide` drop out in this order: Matter Name, Updated, Created, Age, Project, Workflow, Task type, Pod, Requestor, Creator, Progress, Client. The widths used are the user's. Matter Name goes first (measured, #348: the Task Queue default with Matter Name needs a box of 1140 px; a 1366 px window has 1098 and a 1440 px window 1172, so at 1366 the columns that were there before, and the ones the person added, keep their room and Matter Name appears from about 1400 px; the PM's plan had it after Client). The table is laid out but not drawn until its first measure, so a column the rule drops is never on screen for one frame. Ref, Title, Matter Number, Priority, Assignee, Due, Status and Closed never drop. When only those are left and still do not fit (tablets: the Task Queue default set is 780 px of fixed columns (without Matter Name) plus the 160 px Title minimum, so it needs a box of 940 px; the box is the window minus 104 px below 1100 px and minus 268 px from 1100 px), the grid scrolls sideways, the hint "Scroll sideways" shows below 1024 px and **Ref is sticky**. A filter on a dropped column keeps its chip with "(hidden column)" and "Show column".

*Phones.* Below 640 px (viewport `max-width: 639.98px`: 639 px is cards, 640 px is the table with its sticky Ref) the Task Queue, My Work and Pod Work show cards instead of a table (`task-card-list.ts`); the Matter and Project grids keep the sideways-scrolling table. Cards have no resize handles, no column menu and no Columns or Column widths controls; the Filters sheet starts with "Sort by".

*Widths per user, page and tab.* Stored in `localStorage` under **`mf.work-widths.v1.<scope>.<userId>`** (`anon` without a user), value `{"v":1,"w":{"due":180}}`. The scope is the page, or the page and tab: `taskQueue`, `myWork.active`, `myWork.dueSoon`, `myWork.closed`, `myWork.createdByMe`, `podWork.<tab>`, and, from the final pass (#240), `matterTasks` (every Matter's Tasks tab) and `projectTasks` (every Project's task list): the record grids resize by drag, double-click fit and the column menu (Sort, width items, Reset width; no "Hide column", their column set is fixed), but have no Columns panel. There is no fallback between scopes (a width set on the Task Queue does not reach My Work), widths are independent of density and of the chosen columns (a width is kept while its column is hidden), they are sparse (a width equal to the default is not stored), integers in px at the default zoom (applied as rem), clamped to the current minimum and maximum on read, and never stored for the Title or an unknown column. Corrupt values or blocked storage give the default widths and never an error. There is no server preference (addendum U).

*Ways to change a width (WCAG 2.1.1, 2.5.7 Dragging Movements: the drag is never the only way).*
1. **Drag** the border of a header cell (from 640 px up; the handle is a 24 px hit area with a 1 to 3 px line, `aria-hidden`, outside the Tab order). The edge that follows the pointer is used: the right edge for columns before the Title, the left edge for columns after it. Esc puts the width back; a click on the header still sorts. Live up to 100 rows, a dashed guide line with a width tip above that, applied on release.
2. **Columns panel, "Column widths"** (the keyboard and single-pointer way): one row per shown column with - and + (8 px a step, 32 px with Shift), a number field in px (Up and Down step, a typed number clamps), Fit and Reset width; the Title row says "Fills the space left". Footer: "Reset all widths" beside "Reset columns" (Reset columns does not touch widths). Every change is read out politely ("Due column 160 pixels", "All column widths reset to the default.").
3. **Column menu** on a header: Menu key or Shift+F10 on its sort button, a right click or a touch held 500 ms. Sort ascending / descending, Widen and Narrow (8 px), Fit to content, Reset width, Hide column. Not on phones.
4. **Fit to content:** a double-click on a handle, or the menu or panel button, sets the column to its widest header or cell content on the page plus padding, within the minimum and maximum. The Title's Fit is disabled and says "Fills the space left".

*Keyboard in the grid.* The first Tab stop of the three work pages is "Skip to task list". With focus on a row: J / Down and K / Up move between rows, Enter opens the task (with `from=`), S and P open the row's Status and Priority menus (P only where the cell is editable), Esc returns to the row. `g` then `m`, `t` or `p` (within 1.5 s) go to My Work, Task Queue and Pod Work (Pod Work only with `Pod.View`). The Quick views strip is one toolbar with one Tab stop: Left and Right move (wrapping), Home and End go to the first and last. `/` focuses the first text filter. The `?` help lists all of these under Work lists; its "Keyboard shortcuts" switch (per user, `localStorage`) turns the single-character keys off (WCAG 2.1.4) while arrows, Enter, Esc, Ctrl+K and Menu / Shift+F10 stay on.

*Print.* Print and PDF show the title, a filters line, one print line (page and view "Task Queue: Overdue", "Sorted by Due date, ascending" or "Sorted by default order", "Page 1 of 9, 442 tasks, showing 1-50", "Printed Oct 18, 2026, 3:05 PM EDT") and the grid with a repeating header. Hidden in print: the app header and rail, quick views, filter bar and row, resize handles, tabs, strip, the footer and pager, toasts. Fixed layout and widths are kept (scaled to the sheet); the red bar and pills print.

**Record lists (Clients, Matters, Projects and the client's Matters tab; epic #245).** They use the table contract above with these differences, specified in 5.9 and S05 to S07: rows exactly 44 px (`.pg-table`, `shared/ui/page.scss`), names clamped at two lines with a tooltip, **the name is the only link**, the filter row is open by default from 640 px (remembered per list and person) with the Filters button and the one Clear filters in the page header, the default Status is not counted or chipped and the pager says how many records it hides (`of 37 active - 3 inactive hidden  Show all`), the Open tasks and Overdue count columns link to the Task Queue and sort server-side, there is no column chooser, resizing or density, and below 640 px the list is a column of cards with Sort by in the Filters sheet. The states are the shared ones: skeleton rows with the final widths, "No clients yet." with the creation button, "No clients match these filters" with Clear filters, "You don't have access to clients.", "Couldn't load clients." with the reference and Retry (focus then moves to the first row).

**Inline column filters (epic #75; verified by the re-review of 2026-10-20, `docs/ux/column-filters/re-review-2026-10-20.md`).** Every grid that has a column per attribute filters inline; the others keep a toolbar control (Search results, Advanced search, the Dashboard board toolbar, pickers) and the ordered configuration lists (Roles, Labels, Link roles, Custom Fields) have no filters.

| Rule | Behaviour |
|---|---|
| Surfaces (18) | Task Queue, My Work (four tabs), Pod Work (four tabs), the Tasks grids of a Matter and a Project, Clients, Matters, the client's Matters tab, Projects, Assets, the Matter's Assets tab, Users, Pods, Task Types, Workflows, Workflow Steps, Asset Types, Audit Logs. The Matter's Projects tab (a short in-memory list) has none. |
| Open or closed | Open by default on Task Queue, My Work, Pod Work and (from 640 px) Clients, Matters, Projects, the client's Matters tab and the Task Types, Workflows and Workflow Steps lists (TY-A2, #365); closed on every other grid. The choice is remembered per screen and person; an address that carries filters opens the row. |
| Controls | Text (contains, live after 300 ms, Enter at once, Esc clears a filled box, the placeholder is the column name), select, multi-select popover (checkboxes, find box above 8 options, applies 400 ms after the last tick or on close, Esc and an outside click close it, focus returns to the button), user (Me and Unassigned first), date range with presets (From and To; From after To is reported and not applied), tri-state. |
| Defaults | The default (Status Active, Open for tasks) is shown in its cell, never written to the address, never counted and never a chip; "All" is a filter with a chip. Clear filters returns to the defaults and shows only while something differs. |
| Empty | A filtered empty list keeps the headers and the row, says "No clients match these filters" with Clear filters and, when the default Status hides records that match ("2 inactive hidden  Show all"), says so. |
| Tabs | A tab owns some filters (My Work, Pod Work): they show as muted text with the reason ("Set by the Due soon tab") and are not sent. Changing tab drops the filters the new tab owns. |
| Keyboard | `/` opens the row (or the sheet) and focuses the first text filter; Esc clears, closes the popover or the sheet (nearest first). Shortcuts are unchanged by the re-review (see the Phase 2 backlog). |
| Live region | One polite message after a filter change has loaded ("23 results", "Filters cleared. 40 assets"); never per keystroke. |

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
| 403 page | "You don't have permission to view this." + link home. On a Client, Matter or Project page: "You don't have access to this client." with the same link; no Retry |
| 403 action | Toast: "You don't have permission to <action>."; permission state reloads |
| 404 | "We couldn't find that." with search box. On a Client, Matter or Project page: "We couldn't find that client." (matter, project) with "Go to clients" (or the page the landing rule picks when the person may not open the list); no Retry |
| 409 conflict | Conflict dialog (§5.3) |
| 422 validation | Field errors + summary |
| 5xx / network | Inline alert "Something went wrong. Try again." with Retry and copyable reference id. A Client, Matter or Project page shows the page title "Couldn't load this client." and the alert; the breadcrumb stays, the header and tabs do not; Retry keeps focus, says "Loading client" and, on success, "Loaded" and focuses the heading |
| Permissions removed mid-session | Next 403 triggers permission refresh; if none left, redirect to Access Pending |

### 5.7 Permission-gated actions: hide vs disable
- **Hide** when the user lacks the permission and the action is unrelated to their context (e.g. "New client" without `Client.Create`).
- **Disable with a visible reason (text reachable by focus, `aria-describedby`)** when permitted in general but blocked by state: Reopen or Create Task on an inactive Matter; Complete with unresolved steps; Set Matter inactive with open Tasks.
- **A link exists only if its target is reachable** (epic #245): a name that would open a page the person may not view (the Client of a Matter without `Client.View`, the Matter of a Project without `Matter.View`, a count link without `Task.View`) is plain text, and a count the person may not see is absent, never a 0. Disabled-with-reason cases of the record pages: New matter for an inactive client, Create task for an inactive matter or an archived project, Set inactive on a matter with open tasks; the Tasks tab without `Task.View` stays and says "You don't have permission to view tasks." (addendum V). Matrix: `docs/ux/clients-review/fixes/wp13/permissions.md`.
- Angular gating is for usability only; the backend authorizes every call.
- Phase 1 visibility: anyone with `Task.View` sees all Tasks; no Matter-level hiding in the UI (ethical walls deferred).

### 5.8 Numbers (Client and Matter) pattern (addendum B)
- Inputs accept **1 to 5 digits** and show the normalized value live: typing `343` shows "Will be saved as 00343". Non-digits: "Use digits only." More than 5: "Use at most 5 digits." Whether `0` is allowed is an open question (Appendix D).
- Elsewhere the padded form is displayed: `00343` and `00343-00012`.
- All search/lookup/typeahead fields accept padded, unpadded and hyphenated forms: `343`, `00343`, `343-12`, `00343-00012` all find Matter 00343-00012.
- Numbers are read-only after creation; a restricted, audited "Change number" action (confirm dialog) exists for users with edit permission [UX-PROPOSAL, per baseline §3.1].

### 5.9 Record pages: Client, Matter and Project (epic #245)

The three detail pages share one anatomy; what differs is data (tabs, actions, strip). The numbers below are measured in the e2e suite (`wp3-record-header`, `wp4-project-tabs`, `wp7-matter-overview`, at 1366x768, 1920x1080, 768x1024 and 375x812); decisions are in addendum section V.

```text
Matters > 00343-00012 > Custodian Processing       crumb: the last step is the current page (cut at 40 characters, full text in the tooltip)
[icon] 00343-00012 [copy]  Name, at most two lines  (Active) [lock]    [Edit] [Activity] [+ Create task] [...]     record header (mf-record-header)
Client 00343 Acme Corp                              context line, muted, one line; a link only with the parent's View permission
[lock] Sensitive matter. Handle ...                 Sensitive note, one 32 px line, only for a Sensitive matter
[ Overview ] [ Tasks (7) ] [ Projects (3) ] [ Assets (5) ]   tabs (mf-tabs)
[Open 7] [Overdue 2] [Due soon 1] [ASAP 0] [On hold 1]       summary strip (28 px + 8 px margin)
... the tab's panel scrolls; header, banners and tab list stay put ...
```

**Header.** The `h1` holds the type icon of the section, the number or reference in monospace (a Matter's with a copy button), the name and the badges (Active/Inactive, `Archived` for a project, the lock for Sensitive). Title size is the H2 token (22 px, `--mf-fs-h2`; 18 px, `--mf-fs-h3`, below 640 px), name clamped to two lines with the full text as a tooltip, the number or reference never breaks. Long names are a design case: with a 150-character matter name the tabs start at y 175 at 1366x768 (196 and 220 px for client and matter at 375x812), and the Sensitive note moves them by 40 px at most. The breadcrumb is `Clients` / `Matters` (and `Matters > <reference>` on a Project) with the current page as the last, unlinked step (`aria-current`); a step the person may not open is plain text. A crumb or "Back to ..." link to a list returns to the exact list view the person left (filters, sort, page) and focuses the row (see Keyboard below).

**The action rule (C3, #255).** The header holds Edit, Activity, **one primary create action** and a "..." overflow menu; nothing that changes a record is in a tab body.

| Page | Buttons | Overflow ("More actions") |
|---|---|---|
| Client | Edit (`Client.Edit`), Activity (`Audit.View`), **New matter** (`Matter.Create`; disabled with the reason for an inactive client) | Set inactive / Set active (`Client.Edit`) |
| Matter | Edit (`Matter.Edit`), Activity, **Create task** (`Task.Create`; disabled with the reason for an inactive matter) | New project (`Project.Create`), New asset (`Asset.Create`), Set inactive / Set active (`Matter.SetActive`; disabled with the reason while tasks are open) |
| Project | Edit (`Project.Edit`), Activity, **Create task** (`Task.Create`; prefilled with matter and project; disabled when archived) | Archive / Restore (`Project.Archive`) |

Labels: "New X" for a record, "Create task" for a task, no leading "+" in the text (the icon is decoration). Width: from 1024 px all three buttons; 640 to 1023 px the primary action and the next one of Edit and Activity; below 640 px only the primary action, and what does not fit moves to the overflow in the order Edit, Activity, creations, state change. On a phone "Back to Matters" replaces the trail and shares its row with the primary action and the overflow (44 px targets), so the title has the full width. The overflow is an ARIA menu button: Enter, Space or Down opens, Up opens on the last entry, arrows, Home and End move, Enter or Space picks, Esc closes and returns focus, Tab closes; a disabled entry keeps focus, is `aria-disabled` and shows its reason under the label. The menu is absent when nothing is in it; a person with only View permissions has no buttons and no menu. Empty states of the Projects and Assets tabs keep their own creation button. This reverses the review's "New project in the header" (three create buttons do not fit at 768 px).

**Tabs and addresses.** The shared `mf-tabs`: a tab list with roving tabindex (Left/Right, Home/End; the address and focus follow), a tab panel per record (`client-panel`, `matter-panel`, `project-panel`), an edge fade and a chevron on the side that has more tabs, the selected tab scrolled into view; a counted tab has the accessible name `Matters, 63` (a test that names it by its visible text must use a prefix). The label with its count is `Matters (63)`; `--` while the count loads; no count when the viewer may not see it (never a fake `(0)`).

| Record | Tabs (key, address) | Default |
|---|---|---|
| Client | **Overview** (`details`, no `tab`; `?tab=details` works), Matters (n) (`?tab=matters`, only with `Matter.View`) | Overview |
| Matter | **Overview** (`details`), Tasks (n) (`?tab=tasks`), Projects (n) (`?tab=projects`, `Project.View`), Assets (n) (`?tab=assets`, `Asset.View`) | Overview |
| Project | Tasks (n) (no `tab`), **Details** (`?tab=details`) | Tasks |

`?tab=activity` opens the Activity drawer over the default tab (with `Audit.View`). An unknown tab, or one the person may not see, shows the default tab. Changing the tab removes the filters, paging and sort of the tab that was left (on a Project the Tasks grid stays mounted, so its filters survive a visit to Details). The browser title is `<number or reference> <name>: <visible tab label> - MatterFlow` (`Overview`, `Matters`, `Tasks`; the record text cut at 60 characters, the count not included); until the record is known it is `Client`, `Matter` or `Project`.

**The summary strip (#260, #261, #263, #264).** `mf-work-strip` in two modes, always Open, Overdue, Due soon, ASAP, On hold, in that order, with the Task Queue's tooltips (8.2). *Link mode* (Overview of Client and Matter): each item is a link; a Client's go to the Task Queue scoped by `client=<id>` (Open = the three open statuses; Overdue `overdue=true`; Due soon `asap=false&overdue=false&dueTo=<today+2>`; ASAP `asap=true`; On hold `status=ON_HOLD`), a Matter's go to its own Tasks tab (`?tab=tasks&view=overdue|dueSoon|asap|onHold`). *Toggle mode* (above the Matter and Project Tasks grids): Open is pressed when `view` is absent; a press writes `view=` (merged, so sort and other filters stay), a second press or Open removes it, another item replaces it, an unknown value is ignored, Back restores it; the grid loads the Task Queue quick view of the same name, so the strip number, the grid total and the total behind the matching Task Queue link are the same number; Status (and Due for Due soon) are disabled with "Set by the Overdue view above." while a view is pressed; an empty view says "No overdue tasks." / "Nothing is due in the next 2 days." / "No open ASAP tasks." / "No tasks on hold."; leaving the Tasks tab drops `view`. A zero is muted in place, Overdue stays red with an icon and the word, unknown is `--`. The strip is absent without `Task.View` and while a summary has no numbers; a failed summary shows "Couldn't load the task numbers." with the reference and Retry. Definitions are the Dashboard's (addendum V, T and U): the counts come from `GET /{clients|matters|projects}/{id}/summary` (`docs/architecture.md` section 11); the strip is 28 px high plus 8 px margin; on a Matter at 1366x768 the Tasks grid shows 8 rows with the 8th ending at y 669.

**Counts in lists.** Open tasks is a right-aligned number, Overdue the shared overdue style (red, alert icon, the word "overdue" in the accessible name and tooltip) above 0 and a muted en dash at 0; a positive count links to the Task Queue (`<client|matter|project>=<id>` with the open statuses, plus `overdue=true`); a zero is plain text. On cards the same counts read "14 open" and "3 overdue" (44 px hit areas).

**Record lists (Clients, Matters, Projects, the client's Matters tab).** Rows 44 px exactly, names clamped at two lines with a tooltip, **the name is the only link** and the number or reference is plain monospace text; the filter row (one `FilterDef[]` per list, 5.2) is open by default from 640 px and remembered in `localStorage` as `mf.<screen>.filters.open.<userId>`; the Filters button and the one Clear filters are in the page header, the toolbar row exists only for the chips of a closed row; the default Status is neither counted nor shown as a chip; the pager shows `Showing 1-37 of 37 active - 3 inactive hidden  Show all` (second request `isActive=false&pageSize=1`, silent when it fails; the hint is not shown in an empty list; `archived` on Projects). Below 640 px each list is a column of cards (`mf-record-card-list`, 639 px is cards and 640 px is the table; the table markup is not rendered below it and no card above): 64 px at least, the name as the one link (its box covers the card), a muted monospace reference line, badges at the top right, counts as words, the copy button of a matter as a 44 px aside; the Filters sheet carries Sort by (a select; the count sorts only with `Task.View`; Clients and Matters show Active/Inactive, Matters also Sensitive, Projects only Archived). The states are those of the table (see 5.6). Tabs inside a record (Projects, Assets, Tasks grids) stay tables with the in-box "scroll sideways" hint on phones.

**Loading.** A record page shows `mf-record-skeleton`: the real breadcrumb from the address, grey bars where the title and context will be, the real tab labels with `--` counts and five 44 px rows, all hidden from assistive technology except one polite "Loading client". Nothing moves when the record arrives: the header skeleton is as tall as the loaded header at every width (`wp3-record-header`) and the layout shift of a loaded record page and of a list is under 0.02 (`detail-page-states`, `wp2-list-states`).

**Keyboard and focus (K-audit, #281 to #284).**
- **Skip links.** On Clients, Matters, Projects, the client's Matters tab and the matter's Projects and Assets tabs the first Tab stop is **"Skip to table"**, ahead of "Skip to main content"; Enter lands on the first row's name link (the first card on a phone), or on the empty, error or no-access message. The Matter and Project Tasks grids offer **"Skip to task list"** (the Project's grid stays mounted under Details, so it offers it only while Tasks is shown). A focused skip link fills the header strip on every width with an inside focus ring. The `?` help lists both.
- **One stop per row, the copy button by arrow.** In Matters and the client's Matters tab (and their cards) the name link is the row's Tab stop; the **copy button has `tabindex="-1"`**, keeps its place in the accessibility tree and is reached with the **right arrow** on the name link (left arrow or Shift+Tab back; Tab leaves to the next stop). It is shown on row hover and while the row has focus, always on a phone. Measurable: 25 rows cost 25 name-link stops and 0 copy stops. (The review asked for Tab to reach the button and the next Tab to leave the row, which is two stops per row and contradicts its own target; the target is what is kept.) The Matter header has a permanent copy button.
- **Focus returns on Back.** Leaving a row with a plain click remembers `{list, key}` in the history entry (the address is untouched). Back (browser Back, the header's "Back to ..." or the crumb) focuses that row's name link once the list is ready, or the page heading when the row is gone, or the toggle of the collapsed Archived group for an archived project. A reload, a forward visit, Back again, another list or a changed filter never moves focus. A record page reached by Back (from the Task Queue through a strip link, from a task, from Edit) focuses its selected tab button, unless the person left a row of a list inside the page (that list focuses its own row). The Task Queue return (`from=`, #160) is unchanged.
- **Tab stops before the first row** are recorded, not gated (decision U): at 1366 px Clients 33, Matters 36, Projects 33, client Matters tab 37, matter Projects tab 30, Tasks tab 35; with the skip link each is two presses (Tab, Enter). `fixes/wp13/tab-stops.json` holds the numbers.
- **Menus, dialogs, drawers.** The overflow menu (above), the confirm dialog (Tab and Shift+Tab stay inside, `aria-modal`, Esc closes, focus returns to the trigger), the Activity drawer and the Filters sheet were audited with axe at the four sizes; the column filter popover follows the shared popover rule.

**Permissions.** A link exists only if its target is reachable; a control without its permission is absent, not disabled, except the documented "disabled with a reason" cases (5.7). The full matrix, with the seven roles walked by `clients-permissions.spec.ts`, is `docs/ux/clients-review/fixes/wp13/permissions.md`.

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
| S23 | My profile: availability and work hours (and the header account menu) | epic #68 |

**Addendum deltas applied across all screens:** no attachment upload/list/tab, no File Upload form control, no source-email file; Task Type/Workflow/Matter immutable after creation; Requestor Name (required) and Requestor Email (optional) on every Task; comments are rich text, internal, soft-deletable; no ethical-wall UI; no reports/exports; no bulk reassign; no subtasks/dependencies/related tasks/cloning.

---

### S01 Dashboard

**Purpose.** Department overview for oversight; drill-through to filtered Task Queue. Not billing, not staff scoring.
**Who.** "The Dashboard is not for everyone": it needs `Dashboard.View` (menu item and route; without it the route is the 403 page and the Dashboard item is hidden), and each tab its own permission: Summary `Dashboard.ViewSummary` (everything on Summary) or `Dashboard.ViewUnassigned` (the unassigned queue alone), Breakdowns `Dashboard.ViewBreakdowns`, Trends `Dashboard.ViewTrends`, Swimlane `Dashboard.ViewSwimlane`, Users `Dashboard.ViewUsers`. A tab permission only has effect together with `Dashboard.View`.

```text
Dashboard  [Summary] [Breakdowns] [Trends] [Swimlane] [Users]     Scope [My pods v]  Updated 12 min ago  (refresh)
+---------------------------------+ +----------------------------------------------+
| Needs attention                 | | Unassigned                          View all |
| [Overdue 9 ] [Unassigned 17]    | |  TSK-1051 [type] Title [Assign v] Client High Age |
| [On hold 12] [ASAP open 3]      | |  (5 rows, one line each at list width > 540) |
| Overview        Period [30 days v] | Overdue (Critical first)            View all |
| [Open 128  ] [Due soon 14 ]     | |  ...                                         |
| [Completed 94] [Created 101]    | | Due soon                            View all |
+---------------------------------+ +----------------------------------------------+
  tiles scroll only on a very short window      each list scrolls inside its panel
```
The page is one fixed-height screen (see Page chrome). The three Summary lists use one column order, the order of the other work lists: reference, task type icon, title, client, priority, the inline Due cell (the Task Queue's words, one line: "Oct 17 Overdue 24d"; the 10.5 rem column holds "Overdue 120d" whole, the date gives way first; the creation age is in its tooltip). The Unassigned list has one extra column, the **Assign** menu, placed immediately before the client column (owner feedback on #101, #106, #107). Its trigger reads just "Assign" (accessible name "Assign TSK-n"); the menu opens with **Assign to me** as its first choice (accessible name "Assign TSK-n to me"), above the search box and the people, and picking it assigns the viewer, removes the row, announces it and offers Undo in the one toast host (bottom right, above the pager; #616 reverses decision T #158). There is no separate "Assign to me" link. The three lists share one column grid (same x positions for client, priority and due). A long title truncates with an ellipsis; a list never scrolls sideways. Row height adapts to the panel: 44 px, shrinking to a 32 px floor (24 px targets), so five rows fit with no scrollbar on a tall window (1920 x 1080 and up); on a window too short for the floor the rows scroll inside the panel (a named, focusable region). The other tabs are specified below: Breakdowns (four cards in three columns), Trends (two chart panels and the Task Types list), Swimlane (S01b) and Users (Workload and Coverage).
**Components.** `mf-stat-tile` (number, label, caption, delta, link), `mf-dash-task-list` (the three Summary lists), `mf-bar-list` and `mf-stacked-bar` (Breakdowns, with the table / bars / pie toggle) and the lazy `mf-breakdown-pie`, `mf-trend-chart` with `mf-trend-measure` and `mf-trend-legend`, the Swimlane and Users components, and the shared `mf-period-control`, `mf-scope-control`, `mf-dash-state` (error, stale, empty) and `mf-dash-skeleton` (loading).
**Behavior.**
- Every tile, list "View all", bar and overdue share is a link to `/tasks` with the equivalent filters preset (e.g. Overdue tile: `status=open&overdue=true`; Unassigned = no assigned user; a pod scope adds the `pod` filter). Counts honour the Task Queue definitions exactly, so counts match the list the user lands on.
- Overdue counts exclude ASAP tasks and Completed/Cancelled (never ASAP). The tile caption reads "Excludes ASAP tasks". The Overdue list is ordered by priority (Critical first), then most days overdue, and the tile carries the Critical and High counts as text with an icon (issue #82).
- Due soon is "Today and the next 2 days, not overdue, not ASAP" (one constant in `shared/work-queue/work-vocabulary.ts`; the resolved end date is in the tile's tooltip). The Completed tile counts completed tasks only; its tooltip says "Completed (cancelled not counted)". See the work vocabulary in 8.2. On hold doubles as the baseline's blocked/on-hold indicator ("Waiting on client, custodian or internal"). Tile captions wrap, never an ellipsis.
- The Summary lists read Task Queue rows: number, type icon, title, client, priority, inline Due cell and the row actions (assign to me, with an Undo toast in the one toast host, bottom right and above the pager, full width on a phone). A row is one line of 44 px when its list is wider than 540 px and two lines below; buttons and links are at least 24 px high. Every list holds 5 rows and scrolls inside its panel from 1280 px.
- Breakdowns and Trends use the priority and status badge colours and the categorical palette; every bar and line has a text value. No per-person productivity chart, no hours, no revenue; the "Open by Pod" chart is gone (the Scope replaces it).
**Page chrome (UX review 2, WP2, issues #137, #92, #93, #100).** The Dashboard is a fixed-height page (`mf-fixed-page`): from a window of 768 x 561 px the document never scrolls, the header row stays and only regions inside the tabs scroll (the Summary lists inside their panels from 1280 px and the whole Summary as one region below; the Breakdowns cards; the Task Types list of Trends while its two chart panels share the height; the Swimlane lane bodies; the Users cards, table and Coverage matrix). Under that size the page scrolls normally (reflow and 200 % zoom). The header row is one line of at most 56 px: the H1 (20 px; the tab's name when only one tab is permitted), the tab list (it scrolls inside itself on a phone, never the page), then Scope, the age text and Refresh at the right end; it is sticky from 600 px. Summary and Breakdowns keep a 1360 px reading cap; Swimlane, Users and Trends use the whole width from 1600 px (a lane is at most 480 px wide above 2200 px). Details per tab: `docs/ux/dashboard-review-2/fixes/wp2/README.md`.
**Period (UX review 2, P3, issue #91).** One vocabulary and one label, "Period", on Summary (the Overview group; it applies to Completed and Created only), Trends and Coverage: 7 days, 30 days (default), 90 days, This month, Last month and Custom (from and to, at most 366 days); Coverage adds Last 6 months and Last 12 months. "This week" and "Last quarter" are gone. Address `?period=7d|90d|this-month|last-month|6m|12m|custom&from=&to=` shared by the three tabs (the default is not written, the address wins, the last explicit choice is remembered per user; the old values week, month and quarter are migrated). Captions show the resolved dates ("Sep 17 to Oct 16"). Breakdowns, Workload and the Swimlane (its own "Done in the last" window) have no Period. The server resolves the range in the viewer's zone (`PERIOD_INVALID`, `PERIOD_TOO_LONG`).
**States.** Loading (the first read of a tab, or a new Scope): a skeleton with the shape of the tab (issue #96): Summary two tile groups of four tiles and the three list panels of five rows (a full list), Breakdowns four cards of four bar rows, Trends two chart frames with axis lines and the panel, Swimlane the lanes with three cards each, Users a grid of small tiles, Coverage table rows. It fills the same box as the loaded tab (layout shift at most 0.02), is `aria-hidden`, the region is `aria-busy="true"` with one polite "Loading" status per tab (never one per lane or tile), the pulse stands still with `prefers-reduced-motion`, and a manual Refresh that already has figures never shows it. Empty (no tasks yet): "No open tasks, and none were created or completed in this period." with the Period and, with `Task.Create`, "Create the first task". Error: the shared state block in the tab panel (`role="alert"`, message, text Retry, error reference); one failing tab never blanks the others and the tab row stays; a failed refresh keeps the figures with a stale banner and Retry (P2, P7).
**Permission.** Only the permitted tabs are shown; the first permitted tab is the default and a link to a forbidden tab falls back to it, with a one-line dismissible note under the tab row ("Breakdowns is not available for your role. Showing Summary."; "That tab does not exist. Showing Summary." for an unknown name) and the address is rewritten with replace. The address holds only values that differ from the default (`dashUrlState`). The Dashboard menu item is shown only with `Dashboard.View` and at least one tab permission (`Dashboard.ViewCoverage` alone does not count: it is a sub-view of Users; the helper is `AuthStore.hasAnyDashboardTab`, also used for the post-login landing). The route stays reachable: with `Dashboard.View` but no tab permission the page shows a short note ("No Dashboard tab is turned on for your role...") with a link to My Work. The server redacts the data of tabs the person may not see (counts, charts, trend). Summary has two layers: with `Dashboard.ViewSummary` it shows the Needs attention and Overview tiles, the Unassigned queue (with `Task.Assign` or `Dashboard.ViewUnassigned`) and the Overdue and Due soon lists; with `Dashboard.ViewUnassigned` alone (technicians) the Summary tab contains only the Unassigned queue (no tiles, no period control, no other lists) and the server sends no department-wide counts. The post-login landing page is never the Dashboard for people without `Dashboard.View` (My Work or the Task Queue, else the first screen they may open).
**Refresh.** One icon-only Refresh button (aria-label "Refresh", tooltip "Refresh. Updated 10:42 AM. Refreshes itself every 5 minutes.", spinner and `aria-busy` while reading) at the right end of the tab row, on every tab; it refreshes the tab shown. Beside it the text "Updated N min ago" (P6, issue #94) appears only when the figures on screen are 10 minutes old or more (two missed refreshes; whole minutes, warning colour with an icon); in a normal session there is no visible timestamp. The page refreshes itself every 5 minutes while visible and reads only the tab on screen (the shared summary is reused for 60 seconds when the person changes between Summary, Breakdowns and Trends); a failed refresh keeps the figures with a banner and Retry.

**Scope (UX review 2, P1, issue #89).** One page-wide Scope select, labelled "Scope", sits at the right end of the tab row, left of Refresh, on every tab (with a single permitted tab or the Technician variant, where the tab list is hidden, it sits next to the heading and Refresh; at 375 px it wraps onto the line below with the other controls, never a horizontal page scroll). Options: "All pods", "My pods" (only for a member of at least one active pod), then the person's own pods, then, only with `Pod.View`, "Other pods". The scope in effect is always text in the control and a change is announced in the page's polite live region ("Scope: Review Alpha"). A task belongs to a pod when its Pod field equals the pod, exactly the Task Queue `pod` filter, so every scoped number equals the count behind its link; "My pods" is the union of the person's pods; tasks with no pod belong to no pod scope and appear only under All pods, and under a pod scope the Summary says so in one quiet line above the lists ("N unassigned tasks have no pod. Show all pods", the link sets All pods). Applies to the Summary (tiles and the three lists), Breakdowns, Trends, Swimlane (task pod), Users workload and Coverage (members of the pod); the per-tab Pod controls of Swimlane (Filters), Users and Coverage are gone. Address: `?pod=all|mine|<id>`; the default is not written. Default (decision PM): My pods for anyone who is a member of at least one active pod, otherwise All pods (membership only, never role names, so it survives custom roles); the last explicit choice made with the control is remembered per user in this browser (`mf.dashboard.scope.v1.<user>`, guarded) and the address wins over it without changing it. An address that names a pod the person may not see (or "mine" without a pod) falls back to the default and says so in the one-line note under the tab row ("That pod is not available to you. Showing My pods."); the API answers 403 for such a pod. The old links are read once and rewritten: the Users tab's `upod=<id>` and the Swimlane `pod=<id>` filter become `pod=<id>`. A new scope shows the tab's skeleton and reads only the tab on screen (the other tabs read it when opened); the tab choice keeps the scope. An empty pod keeps the tabs (only an empty department shows the "No tasks yet" page). The control is a native `select`, 32 px high, keyboard operable.

**Users tab, Workload view (UX review 2, WP10a, issues #127, #128, #130, #133).** Population ("can take work"): active people who are members of at least one active pod or hold at least one open task; the server applies it (`includeNoPod`, default off in the page, `unopod=1` shows everyone, `hiddenCount` in the answer) and a quiet line says "Showing N people who can take work. M others are hidden. Show them" (nothing is hidden under a Pod scope); the Assign picker and Coverage are not affected. Toolbar: a text group of two toggle buttons "Workload | Coverage" first (`aria-pressed`, not a tablist, only with `Dashboard.ViewCoverage`), then search and filters, then icon buttons for tile size and layout with state-aware names, text tooltips on hover and focus, 32 px targets, and "Legend" (word from 1100 px). Capacity strip above the chips: one bar stacked by load level, each segment a filter button synchronised with its chip, "N unassigned tasks" linking to the Task Queue within the scope, and an Assign work menu (people who can take work now; the unassigned queue). Idle is a light tint with a thin outline; saturated fills stay for Heavy and Out of office. Details: `docs/ux/dashboard-users/README.md`.

**Users tab, Coverage (UX review 2, WP11, issues #134, #135, #136).** Two orientations behind a text switch "By task type | Matrix" (first in the Coverage toolbar, `aria-pressed`; `cov=matrix` only when the matrix is chosen). By task type (default): a table (cards below 561 px) with a disclosure button, Task type, Handled by (first five names alphabetically, then "+N"; names are plain text, never ordered by count), People, Completed and Status ("No one" neutral, "One person" amber, both with an icon); order "Fewest people first" (default), "Type name", "Most completed"; a row opens the people with their counts (each opens the Coverage drawer) and "Show people in <pod> who have not handled this type" (needs a pod scope). Above both orientations: a neutral collapsed statement "N task types had no completed tasks in this period." and an amber `role="status"` statement "N task types were handled by only one person in this period: <types>. Consider cross-training." (zero is informational, exactly one is the warning; no "gap" or "bus factor" wording). Matrix: zeros are blank (named "Ana B., Redaction: 0 completed"), possible training gaps are outlined with an icon only while the "Training gaps" toggle is on (default off), 30 people and 60 task types are drawn with "Show more". Details: `docs/ux/dashboard-users/README.md`, addendum Q.

**Tile deltas (UX review 2, S3, issue #102).** Four Summary tiles carry one line of change under their caption, in words with a glyph, never colour alone: Overdue and Open compared with the end of yesterday ("▲ +8 vs yesterday", "▼ -3 vs yesterday", "= no change vs yesterday"), Completed and Created compared with the period of equal length directly before the selected one ("▲ +14 vs previous 30 days"; for This month the same days of last month, "vs same days last month"). Unassigned, On hold, Due soon and ASAP have no line (there is no history to compare with). The glyph and the visible words are decoration for a screen reader, which hears "8 more than yesterday" / "3 fewer than yesterday" / "No change compared with yesterday" as part of the tile's one link; the tooltip says what the baseline was and repeats the Trends caveat (current due dates, no status replay). Only Overdue going up uses the attention colour (the red of the tile); every other change, a fall in Overdue included, is neutral text, and green is not used. A zero change is "no change", never "+0". API (`GET /api/v1/dashboard`, additive, nullable): `overdueYesterday` and `openYesterday` are the Trends snapshot of yesterday for the same scope (created by the end of the viewer's yesterday, not Completed or Cancelled by then, a due moment that had passed by then; so tile minus delta equals yesterday's Trends point), `completedPrevious` and `createdPrevious` count the `previousPeriod` (`kind` `previous` or `same-days-last-month`, `from`, `to`). A field is null, and its line absent, when the scope held no task at the baseline (yesterday) or none before the start of the previous period (an account or pod younger than the comparison: no partial count, no NaN). The comparison follows the page period (P3) and scope (P1) and is cached with them. The line wraps inside the tile at 375 and 320 px.

**Technician Summary (UX review 2, S9, issue #108).** With `Dashboard.ViewUnassigned` and no `Dashboard.ViewSummary` the Summary is the unassigned queue alone. When it is the only content (one permitted tab) the heading is "Unassigned work", there is no tab row, and the Scope select and Refresh sit on the heading row. Above the queue: the own-work line ("You have 6 open, 1 overdue. Open My Work", the counts are the viewer's own open and overdue tasks by the Task Queue definitions, `mine { open, overdue }` in the dashboard payload only for this variant, whatever the scope; neutral wording, no ranking or comparison; the link needs `Task.View`), then Priority and Task type filters built with the column-filter foundation (`ListFilters`, `mf-filter-control` and `mf-filter-chips`, not new filter UI). The address carries `sprio` and `stype` (comma lists of ids; repeated parameters are read too; defaults not written; a tab change drops them) and the queue is asked from the Task Queue itself with `priority` and `type`, so the list, its count and "Showing N of M" equal the Task Queue for the same filter and "View all" opens it with the same filters; a change of filter reads the queue again from the first row. A person in no pod gets All pods and the quiet note "You are not in a pod yet. Showing all pods."; the "N unassigned tasks have no pod" line of the Scope also applies. Empty states use the shared state block: "No unassigned tasks match these filters." with Clear filters, and "Nothing is unassigned in <scope>." with Show all pods. A holder of `Dashboard.ViewSummary` never sees this variant (the full Summary, with or without `Dashboard.ViewUnassigned`).

**Tabs (epic #68).** The page has five tabs (WAI-ARIA tabs, `?tab=` in the address, never remembered): Summary, Breakdowns, Trends, Swimlane and Users, each shown only with its own permission (see Permission above). Swimlane is specified below; Users (team workload and Coverage) above and in `docs/ux/dashboard-users/README.md`.

**Breakdowns tab (epic #85).** One caption, "Open tasks, now. Not affected by the period.", with the legend (Not overdue / Overdue), then four cards, each with one title (H3 under a visually hidden H2 "Open tasks"): Priority, Task type, Status and Age. Every bar is split into not overdue and overdue: the bar length is the row total, the overdue segment (existing danger tokens, hatched, 2 px minimum) is proportional and links to the Task Queue with the row's filter plus `overdue=true`, and "N overdue" (hidden at 0) is the same link as text; the row link to the total is unchanged and "View as table" adds an Overdue column. Overdue is the Overdue tile's definition (ASAP never overdue, closed tasks excluded), so the overdue of the rows of each card adds up to the tile. Age has six buckets (constants in `DashboardRules.AgingBands`, Age = whole days since creation in the viewer's zone): 0-2, 3-7, 8-14, 15-30, 31-60 and more than 60 days; they add up to Open, each links with `createdFrom`/`createdTo`, the caption "not a service-level target" stays. Low priority is drawn with a dashed 2 px outline and a lighter fill, Normal with a solid 1 px outline (no new colour token). Grid by the width of the tab (container query; the tab keeps its 1360 px cap), owner feedback v2 (issues #109-#113): from 1300 px three equal columns, Priority above Status on the left, Task type in the middle, exactly as tall as its list when that fits the visible height of the tab and otherwise capped at that height (`max-height: 100cqh` of the scroll region), so only its list scrolls inside the card under a pinned title, as the list grows with every new task type (the scrolling body is a named focusable region only while it overflows); no card is stretched, and the length of that list never moves Priority or Status, Age on the right; two columns flowing top to bottom from 700 px, one below. The DOM and tab order are Priority, Status, Task type, Age at every width. A Task type name wraps to at most two lines (three on a phone), the full name is the `title` and the link's label, numbers never wrap. Every card has three views, walked by one link in this order: table, bars, pie, table (the link names the next view: "View as pie" on the bars, "View as table" on the pie, "View as bars" on the table); the default is bars and the choice is remembered per card and per user in this browser (`mf.dashboard.breakdowns.view.v1.<user>.<card>`, guarded), never in the address. The pie (`mf-breakdown-pie`, hand-written SVG, loaded only when asked for) is a donut with the total in the middle, slices in the bar colours (task types use the categorical palette of the Trends lines), at most eight slices with the rest grouped as "Other", every slice numbered and outlined (Low dashed), the overdue part a hatched segment of a thin outer ring, and a legend of real text (number, name, count, share, "N overdue", the same Task Queue links as the bars); hovering or focusing a legend row shows its text in the middle and in a caption under the pie whose area is reserved (three lines, same size when empty), so the donut and the legend never move on hover, focus or leave. The SVG is one image with a text summary; forced colours and reduced motion are respected. A mouse press on the cards region shows no focus ring (`:focus-visible` for the keyboard only, `PointerFocus`). API: `overdue` on every breakdown row and aging bucket of `GET /api/v1/dashboard` (additive); the age bucket list grew from four to six. Screenshots: `docs/ux/dashboard-review-2/fixes/wp7/`.

**Trends tab (UX review 2, epic #86).** One card "Tasks over time" with the Period and its caption (the resolved dates) and, from 1000 px, the Task Types list beside the chart. Two stacked panels share one x scale and one cursor: flows (a segmented measure) and backlog (`Open and overdue` by default, `Open`, `Overdue`). "Open at end of day" means created by the end of that day and not Completed or Cancelled by then (no status replay). The y axis is fitted to the data in round steps (a peak of 21 gives 25). "All task types" is hidden while task types are compared and "Compare task types" is never a dead end. Lines are labelled at their right end (at most four per panel, nudged apart), markers sit only at the ends beyond 14 points, ticks fall on Mondays with their dates, up to 31 days there is one point per day and beyond that one per week (Monday to Sunday: flows summed, stocks at the end of the week, "Week of" tooltips and table). One title per panel and per tab. On a phone the chart is 16:9 at the width the shell leaves (271 px at 375 px because of the 56 px shell rail, issue #121, left open), the Task Types list is a disclosure and a tap opens the tooltip. A table view serves assistive technology. Details: `docs/ux/dashboard-trends-types/README.md`.

#### S01b Swimlane tab (issue #72)

**Purpose.** Show where every open task stands as cards in four lanes, and who holds what, without drag and drop. An operational view, not a performance evaluation: no per-person completion figures, speed or ranking.
**Layout.** Lanes are columns: **New | In Progress | On Hold | Completed**. A sticky lane header shows the exact count and a cue ("oldest 5d" for the open lanes). Each lane scrolls vertically by itself (the board is the height of the screen minus the page above it); the board scrolls sideways inside itself between 900 and about 1100 px, and below 900 px one lane shows at a time (see Below 900 px). A lane draws 40 cards at a time ("Show 40 more of N hidden"); a lane holds at most 200 cards and says "Showing 200 of N. Open the Task Queue" (a link with the same filters) when capped. Completed holds Completed and Cancelled tasks whose last status change is in the window (7, 14 or 30 days, default 7).
**Toolbar (one row from 1100 px, two lines at most below; WP9a, #122).** Search (title or ref), Group (None, Priority, Assignee, Client / matter), Sort (Priority, Due date, Client / matter, Created), Filters (count on the button: Assignee incl. Unassigned, Task type, Priority, Overdue only; the Pod is the page-wide Scope) and a "..." menu button (`aria-haspopup="menu"`, Enter or Arrow Down opens, arrows, Home and End move, Esc closes and returns the focus) holding Density (Comfortable, Compact), "Done in the last" (7, 14, 30 days), Only mine and, when grouped, Expand all / Collapse all. Settings in the menu that differ from the defaults (Compact, a window other than 7 days, Only mine) show as text chips beside the button. The refresh icon is in the Dashboard tab row.
**Card.** Left bar in the priority colour (same tokens as the priority badge), the level-bar icon and the priority text (never colour alone), task type icon, task number link, title clamped to two lines, client and matter name on one line (below), assignee with initials and an Out of office flag, inline Due cell (`Oct 17 Overdue 2d`, `Due today`, `Tomorrow`, `In 2 days`, ASAP or the date, in the viewer's zone, the grid's words; Done / Cancelled date in the Completed lane), workflow progress bar with "2/4", and a lock for a sensitive matter. Status, Priority and Assignee are the inline menus of the queues (`mf-row-edit`) with the same rules, dialogs (Hold, Cancel, Complete, Reopen) and Undo. A card whose status changes moves to the right lane at once. The whole card opens the drawer. **Compact (W1):** a one-line card of 44 px: priority bar with the level glyph, task type icon, task number link, title (one line), assignee initials (with the Out of office flag) and the due chip; client, matter, priority and assignee names are in the hover text, the menus and progress in the drawer (`m` opens the drawer on this card). **Client / matter (W3):** one line "Client / Matter name" (the matter number is in the hover text and in the drawer); cards of a client / matter tree omit it (the group is the client and matter); cards of an assignee group omit the assignee. **Lane count (W2):** the count in the lane header is a link to the Task Queue (lane status, Done window start for Completed, page scope and the filters the queue can show); search text is left out and the link says so ("Search text is not included").
**Grouping.** Priority: groups in rank order with a coloured header. Assignee: avatar, name and an Out of office chip, Unassigned last. Client / matter: a WAI-ARIA tree per lane (`role="tree"`, `treeitem`, `aria-level` 1 client, 2 matter, 3 card, `aria-expanded`), indented one step per level, a count on every node, collapse state shared by all lanes.
**Drawer peek.** Right-side modal dialog (focus trapped, Esc or Close returns focus to the card): summary, workflow steps with state words, the three latest comments, the same inline menus, "Open full task".
**Below 900 px (WP9b, #125).** A tablist "Swimlane lanes" (lane name and count, plain text) replaces the four lanes: one lane at a time as its tabpanel, In Progress first, `lane=` in the address only when not the default, remembered for the session; natural height with a sticky switcher on a scrolling page, the whole window height in the fixed-height page; the toolbar is Search, Filters and "..." (Group and Sort inside Filters). Above 2200 px a lane is at most 480 px wide, left aligned.
**Keyboard.** One tab stop per lane. Up, Down, Home, End move between cards (tree: Right opens or steps in, Left closes or steps out); Left and Right (Shift with them inside the tree) move to the neighbouring lane; Enter opens the drawer; `m` opens the status menu; a "Skip lane" button leads to the next lane.
**Refresh.** Every 5 minutes while the tab is visible, skipped while a menu, dialog or the drawer is open, never moves focus; a failed background read keeps the board and shows a banner with Retry. First load: three skeleton cards per lane and one polite "Loading the swimlane board." status; error: alert with reference and Retry.

---

### S02 My Work

**Purpose.** Everything assigned to me, from **all my Pods**, most urgent first.

```text
My Work
Needs attention: Overdue 3 | Due today 2 | ASAP 1 | On hold 2 | New 4
[ Active (23) ] [ Due soon and overdue (4) ] [ Closed (87) ] [ Created by me (6) ]
Sorted by Priority (i)   [ Open in Task Queue ] [ Columns v ] [ Other filters v ] [ Filters (1) v ]      (row 2, only when needed: chips, Clear filters)
+----------+------------------------------+--------------+-------------------+----------+------------+--------------+
| Ref      | Title                        | Matter Number | Matter Name | Workflow progress | Priority | Due        | Status       |
+----------+------------------------------+--------------+-------------------+----------+------------+--------------+
| TSK-1042 | [icon] Process Smith custod- | 00343-00012  | 3 of 6 done . Ded…| Critical | ASAP       | In Progress  |
|          | ians                         | Smith v Jones|                   |          |            |              |
| TSK-1039 | [icon] Export production     | 00101-00003  | 4 of 5 done . Rev…| High     | Oct 18     | On Hold      |
|          | vol 004                      | Acme audit   |                   |          | Due today  | (reason)     |
+----------+------------------------------+--------------+-------------------+----------+------------+--------------+
Rows per page [50 v]      Showing 1-23 of 23   Page 1 of 1   [First] [Previous] [Next] [Last]
```
My Work keeps its "Sorted by" note and info button in the toolbar (the Task Queue has it in the footer). Rows are 44 px (Comfortable), the Matter Number cell is the reference and the matter name is its own column (#348), the Due cell has its second line (4.6). Below 640 px every tab is a list of cards (see Phone cards).
**Tabs.**
- **Active** (default): assigned to me (`AssignedUserId = me`), status NEW / IN_PROGRESS / ON_HOLD.
- **Due soon and overdue** (URL `view=dueSoon`): my open tasks that are overdue, plus those with an explicit due date today or in the next 2 days. ASAP tasks are **not** here (they have no due date; find them under Active) [UX-PROPOSAL; reason: avoids ASAP flooding]. The count equals the Dashboard's Overdue plus Due soon for the same person. Default order: overdue first (oldest due first), then due date, then priority, then oldest created, then id (issue #154; Active keeps the addendum G rule below). The tab help is behind an "About this tab" info button next to the "Sorted by" note, not a paragraph.
- **Closed** (URL `view=completed`): my Completed or Cancelled tasks, newest first, the last 90 days by default (the tab tooltip and its info button say so). "Show older" is an explicit all-time state: URL `closed=all` (API `closedWindow=all`), chip "Closed: all time" (removing it returns to the 90 days); a chosen closed-date range still uses `completedFrom`/`completedTo`, and an old `completedFrom=2000-01-01` link shows its real date chip.
- **Created by me**: tasks I created, any assignee. It starts on its open tasks (New, In Progress, On Hold) like a plain Task Queue link; choosing "All" in the Status filter (or opening a link with other filters and no status) lists every status, and the tab count follows (#186).
Tab counts update with filters.
**Needs-attention strip (M1, #153).** Above the tabs: Overdue, Due today, ASAP, On hold and New, each with a count over the whole open assigned set (grid filters never narrow it; zero stays visible and muted). A click applies that filter on Active, replaces another strip filter and a second click clears it (a toggle button with `aria-pressed`). **New** counts tasks assigned to me since my last visit (a visit starts after more than 30 minutes without activity, kept in `localStorage`, so it is device specific); it is hidden on a first visit, the filter shows the chip "New since your last visit" and a 6 px dot in the Ref cell (accessible name "New") marks the tasks; the markers survive opening a task and Back. There is no "since your last visit" panel (addendum T). Pod Work shows its own summary with the same component.
**Landing and restore.** A plain visit opens My Work when the person has work (`hasWork` from `/me`: an active Pod membership or an open assigned task; having created tasks alone does not count). It restores the last view only when that was Active or Due soon and overdue, with a notice that names the view ("Restored your last view: Due soon and overdue.", Dismiss, Reset to default); Closed and Created by me are never restored. A plain visit with nothing assigned opens the first tab that has tasks (Active, Created by me, Closed), once, with a notice.
**Columns.** Each tab has its own default set, per user (`mf.work-columns.v2.<scope>.<userId>`; the Columns panel has "Reset columns" for the current tab). Active and Due soon and overdue: Ref, Title (the type icon and the title only: no line under it, #196), Matter Number (the reference, #197, #198) and Matter Name (#348), Workflow progress, Priority badge, Due (`mf-due-cell`), Status badge (columns appear in the grid's one column order). Closed: Ref, Title, Matter Number, Matter Name, Closed date, Status (no priority, due or progress; a priority added by the user is muted and Due carries no ASAP or Overdue emphasis on closed rows). Created by me: Ref, Title, Matter Number, Matter Name, Priority, Assignee, Due, Status, Age ("12 d"; tooltip: created time, or "Took 12 d" for a closed task). A person who customised a My Work set before Matter came back gets Matter inserted once after Title, with one dismissible notice (`mf.work-columns.v3.migrated.<page>.<userId>`; Task Queue and Pod Work users who removed Matter keep their choice and the notice offers "Add Matter Number column"). **Matter Name migration (#348):** a stored set equal to the scope's old default (the default without Matter Name) was never customised and is dropped once (`mf.work-columns.v4.migrated.<page>.<userId>`), so the new default with Matter Name applies; a customised set is left alone and Matter Name is one click away in the Columns panel. Workflow progress is one text line, "2 of 5 done · current step" (no bar: steps can be skipped, so a step index would mislead; "All steps resolved" when none is left). Matter, Client, Pod, Created, Requestor and the rest are in the column chooser. Default sort per Task Queue rule (below). Header sort available.
**Page, caption and live region (issue #161).** The browser title is "My Work: <tab> - MatterFlow" (and "Pod Work: <tab> - MatterFlow"), the table caption "My Work: <tab>" and the polite live region "Showing 1-50 of 87 in <tab>"; all follow a tab change without a reload.
**Default sort of Active (addendum G).** Priority (admin order, Critical first); within priority, **ASAP first**, then explicit due dates ascending (overdue/oldest due first); ASAP ties by age oldest first; explicit-date ties by age oldest first. See S03 for the definition and a visual cue.
**Group by: Due (WP12a, #180).** Active tab only, off by default. Chosen in the Columns panel ("Group by: None | Due"), remembered per user (`mf.work-group.v1.my-work.<userId>`), URL `group=due` (absent when none; ignored on the other tabs). The server orders by bucket (ASAP, Overdue, Today, Tomorrow, This week = the rest of the Monday to Sunday week after tomorrow, Later), then priority, due moment, oldest, and returns `bucketCounts` for the whole filtered set (the six buckets sum to the Active total; ASAP, Overdue and Today use the strip's predicates). A non-interactive `tr` with `th scope="colgroup"` and one button (`aria-expanded`, "Overdue (9 tasks)", "Overdue (9 tasks), continued" at the top of the next page) starts each bucket on the page; collapse state is not stored; the header sticks under the column headers (and the filter row). A header sort turns grouping off and forgets the choice; "Remove grouping" does the same. The client places headers from the counts and the page offset, so it has no date logic of its own.
**Task Queue sorted by Due (WP23, #232).** Sorting the Task Queue by Due (ascending or descending) shows the same divider rows as My Work's Group by Due (`mfGroupHeader`, `due-groups.ts`): ASAP, Overdue, Today, Tomorrow, This week, Later and, last in either direction, Closed (Completed and Cancelled are never overdue or ASAP, so they form their own bucket). Descending mirrors the open buckets (Later first, ASAP last) and keeps Closed last. The counts are the whole filtered set's, from `GET /task-queue?sort=due&group=due` (`bucketCounts`; the page sends `group=due` itself whenever the sort is Due, so API clients that do not ask get the same rows as before). A bucket that spans pages is announced "ASAP (51 tasks), continued" on the next page. Inside a bucket the rows follow the Due direction, then oldest created. There is no Group by control, no stored preference and no `group` in the address: the Due sort is the switch, and a collapsed divider is forgotten on reload. The Due header tooltip reads "Due (ASAP first)" or "Due (ASAP last)". Dividers are `tr[mfGroupHeader]` rows: skipped by J/K (collapsed rows are `hidden`), by the skeleton and by the row-height histogram; their cell spans every shown column (`colspan` = columns shown).
**Row actions.** Open; "Change status" quick menu (valid transitions only; a Completed or Cancelled row offers only Reopen, Appendix B); inline Priority (if `Task.SetPriority`); the Assignee menu, whose first item is "Assign to me" (Task.Assign; hidden when the row is already mine), then the picker (if permitted). Assigning a user from a NEW task moves it to In Progress; the inline control shows the helper "Assigning a person starts the task." A row that no longer belongs to the tab after an inline change is muted for 4 seconds (held while its menu is open), then removed; the counts follow at once.
**Open in Task Queue.** A toolbar link (the Filters sheet on a phone) opens the Task Queue with the tab's filters (Created by me opens with every status), so the totals are equal.
**Phone cards (#192).** Below 640 px all four tabs are cards, not a table: line 1 the type icon and title (two lines), line 2 the client and matter reference, line 3 the Priority, Due and Status chips (the inline editors where permitted, 44 px), the hold reason as its own chip line, and the assignee line and task number on Created by me. Closed cards show `Closed Oct 16` and the Status instead of Priority and Due. The Filters sheet holds Sort by, Group by and Open in Task Queue. J / K, S and P work on cards; Back focuses the card's title.
**States.** Empty Active: "Nothing is assigned to you right now. Check Pod Work for unassigned tasks." (the link only for people with Pod.View who are in a Pod). Empty Due soon and overdue: "Nothing is overdue and nothing is due in the next 2 days." Empty Closed: "No tasks were closed in the last 90 days." with Show older. Empty Created by me: "You have no open tasks you created." with Create task (Task.Create) and, when closed ones exist, "Show closed tasks". Loading: skeleton rows with the final widths. Error: one row "Couldn't load tasks." with the reference, Copy and Retry (the same on a first load and a reload; the live region says the same words).
**Permissions.** Needs `Task.View`. Inline controls follow permission; read-only users see plain text.

---

### S03 Task Queue (shared queue)

**Purpose.** Shared, searchable, filterable list of every Task. The source for dashboard drill-through. Its grid is the shared work grid (5.2), so the numbers there (rows, widths, resizing, narrow-box rule, cards) apply here unchanged.

```text
Task Queue                                                                              [+ Create task]
Row 1: (All open 442) (Unassigned 31) (Overdue 101) (Due soon 18) (ASAP 7) (On hold 12) (My pod 64) (More v)   [Columns] [Other filters] [Filters (3)]
Row 2 (only when needed): Restored your last view: Overdue. [Reset to default] [x]   |   chips: Priority: Critical x  Pod: Pod A x   Clear filters      Reset sort
+--------+-----------------------------+--------------+----------+-----------+-------------+-----------+
| Ref    | Title (spring)              | Matter Number | Matter Name | Priority | Assignee  | Due         | Status    |
+--------+-----------------------------+--------------+----------+-----------+-------------+-----------+
| filter | Title or ref                | Matter Number | (none)      | Priority | Assignee  | Due         | Status    |   (inline column filter row)
+--------+-----------------------------+--------------+----------+-----------+-------------+-----------+
| ... 44 px rows ...                                                                                    |
+------------------------------------------------------------------------------------------------------+
Showing 1-50 of 442   Sorted by Priority (default order) (i)   Rows per page [50 v]   [First] [Previous] Page 1 of 9 [Next] [Last]
```
**Quick views (WP10 to WP16, #218 to #224, #236).** One toolbar named "Quick views" in row 1, in the Dashboard's order: **All open** (New, In Progress, On Hold), **Unassigned**, **Overdue**, **Due soon**, **ASAP**, **On hold**, **My pod** (only with a primary Pod), **Created by me** (only with `Task.Create`; hidden, never disabled) and, always in the **More** menu, **Recently completed**. The strip measures the room the other buttons leave and moves what does not fit, last first, into More, so row 1 stays one line at 1366 and 1920 and never re-orders; More shows the name and count of the pressed view when that view is inside it. Every button shows its count (tabular numerals, three digits reserved, `--` while loading, muted zero); the accessible name is "Overdue, 101 tasks". The counts come from the `views` block of `GET /task-queue`, are never narrowed by the other filters, are worked out in the viewer's zone and equal the Dashboard tiles and the grid total of the same view. Every view has a one-sentence tooltip (`VIEW_TIPS`). The strip is **one Tab stop** (roving tabindex on the pressed view): Left and Right move (wrapping), Home and End go to the ends, Enter and Space press, `aria-pressed` marks the view.
**A view is filters + sort + column overlay**, nothing else. Unassigned sorts by priority then age (the Dashboard list order), Overdue by priority ascending, Due soon by Due ascending; All open, ASAP, On hold, My pod and Created by me keep the default order; **Recently completed** is the last 30 days including today (the Dashboard Completed tile; cancelled tasks are not included), sorted by Closed, newest first, and shows **Closed instead of Due** as an overlay: the saved column set is not changed, and the Columns panel says "Recently completed shows Closed instead of Due." A Dashboard link that is a view by shape presses it (Due soon only when `dueTo` is today plus 2 in the viewer's zone); a filter added on top keeps the view pressed and counts in "Filters (n)", the view's own filters show no chips. When the Status filter holds only Completed and/or Cancelled and Due is shown, the Columns panel offers "Showing finished tasks: show Closed instead of Due" with Show Closed (one click, then "Restore Due") and Dismiss.
**Toolbar.** Two fixed rows. Row 1: the Quick views, Columns (the column choice, density and Column widths), Other filters (filters whose column is hidden or that have no column: ASAP, Overdue, Closed, and so on) and Filters (n). Row 2 exists only when it has something to say: the restored notice, or the chips with Clear filters, and Reset sort at the right while a header sort is on. **Chips** follow one rule: no label repeats its value ("Overdue only", "Not overdue", "ASAP only", "Has a due date"; "Priority: Critical"). The restored notice has a Dismiss x and goes with the first sort, filter, view, tab, page or column action (not Esc). On a phone the toolbar is the Quick views and one Filters button; its sheet holds Sort by and every filter.
**Footer.** The range ("Showing 101-150 of 442"), the sort note ("Sorted by Priority (default order)" with an info button, or "Sorted by Due date" with its direction), Rows per page (25/50/100, remembered per user and page as `mf.work-table.v3.<page>.<userId>.page-size`; an explicit size in a link wins and does not overwrite it) and the pager: First, Previous, "Page 3 of 9", Next, Last (disabled buttons keep their place). Below 640 px the pager is one row: Previous, "Page n of m", Next. One polite message is announced per page change: "442 tasks, page 3 of 9, showing 101 to 150".
**Sorted by Due: dividers.** With Due as the sort (either direction) the grid shows divider rows (WP23; see S02): ASAP, Overdue, Today, Tomorrow, This week, Later and, last in either direction, **Closed** (Completed and Cancelled form their own bucket because the Task Queue lists closed tasks). Counts are the whole filtered set's, from `bucketCounts`; there is no Group by control, no stored preference and no `group` in the address; a collapsed divider is forgotten on reload.
**Filters.** Text and select-like filters sit in the inline filter row under the headers (their placeholder is the column name; Title or Ref says "Title or ref"); filters without a column or with a hidden one are in **Other filters**; a phone has one Filters sheet with all of them. Fields:
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
**Columns** (configurable per user; Ref and Title locked). Default set: Ref, Title, Matter Number, Matter Name, Priority, Assignee, Due, Status (Matter Name is dropped by the narrow-box rule below about 1400 px). In the Columns panel (five groups: Task, Where, Who, When, State; Where = Matter Number, Matter Name, Client, Project): Client, Project, Task type, Workflow, Workflow progress, Pod, Creator, Requestor, Closed, Age (days since created), Created, Updated. Each column has a default, minimum and maximum width (5.2).
**Default sort and its cue.** Priority order, then ASAP first, then due date ascending, then age oldest first. The footer note reads "Sorted by Priority (default order)" and its info button explains: "Default order: Priority, then ASAP first, then due date, then oldest. Choosing a column header sorts by it and replaces this order." Choosing a header sort replaces it; "Reset sort" restores. Assignee and Client sort case- and accent-insensitively, unassigned last in both directions, ties by matter reference then task id.
**Inline editing (only where authorized).** Priority (needs `Task.SetPriority`), Assignee and Pod (needs `Task.Assign`/`Task.Reassign`). Controls are hidden if not authorized; the Priority and Assignee cells of Completed/Cancelled tasks are read-only. The **Status menu of a Completed or Cancelled row offers only Reopen** (to In Progress); "Cancel task" is not offered, inline or in the task header, and the server refuses Completed to Cancelled (`INVALID_STATUS_TRANSITION`, 409). The **Assignee menu's first item is "Assign to me"** (anyone with `Task.Assign`, hidden when the row is already theirs; accessible name "Assign TSK-n to me"; toast "Assigned to you." with Undo). Changing priority/assignee/pod writes immediately, toast "Priority set to High. Undo". Assignee picker lists active users first; inactive users are not offered as new assignees but are shown if currently assigned.
**Row hints.** Overdue rows get a red leading bar + "Overdue" text in Due; ASAP shows the bolt and "ASAP"; On Hold shows the pause marker in Ref and the reason under the Status pill; unassigned shows "Unassigned" muted italic in Assignee (and "-" when also no Pod).
**States.** Empty (no tasks at all): "No tasks yet." + Create task if allowed. Empty view: the view's own good-news line without a dead-end Clear filters (8.2). Empty filtered: "No tasks match these filters." + Clear filters. Loading: skeleton rows. Error: one row "Couldn't load tasks." with Retry.
**Title, caption and announcement.** "Task Queue: Overdue" (browser title "Task Queue: Overdue - MatterFlow") when a quick view is pressed, "Task Queue" otherwise; the table caption is the same; one polite message per change, view first ("Overdue: 101 tasks, showing 1 to 50").
**Phone cards.** Below 640 px the Task Queue is a list of cards (see 5.2 and S02): line 1 type icon and title, line 2 `Client . matter reference`, line 3 Priority, Due (two-line cell) and Status chips, line 4 the assignee (initials and name, or "Unassigned" with the Assignee menu and "Assign to me") and the task number with the New dot. Counts, titles and order equal the table of the same address.
**Permissions.** `Task.View` for the page. Create button needs `Task.Create`. No bulk selection/actions.
**Interactions.** Filter state persisted in URL; column, density and width preferences persisted per user; Enter on a focused row link opens detail; `/` focuses the first text filter; keyboard model in 5.2. Print: 5.2.

---

### S04 Pod Work

**Purpose.** Pod-wide view: what is unclaimed, who has what, what needs attention. Pod Work stays its own page (owner decision; a later merge into the Task Queue is issue #351). The page-specific parts are described here (Pod Work UX epic #546, review `docs/ux/pod-work-review/`); the grid, its columns, the cards and the assignee picker are the shared ones of 5.2 and unchanged. No keyboard shortcut is added or changed (Phase 2, #420).

```text
Pod Work                                                  Pod [Demo Processing Pod (primary) v]
Demo Processing Pod . 23 members . you are a member (primary)          <- one muted context line
[Overdue 4] [Due today 2] [ASAP 3] [On hold 6]                         <- toggles, each filters All open
[ Unassigned (3) ] [ By member (7) ] [ All open (24) ]

Unassigned tab: the shared work grid scoped to Pod = selected, Assignee empty ("Assign to me" in the Assignee cell).
All open tab:   the shared work grid, every open task of the pod; the strip's filters show as chips.
By member tab:  Open work per person. These are workload facts, not a ranking. Select a column heading to sort.
  Member                        Open        Overdue  On hold
  Not assigned to a person      3              -        -     [View tasks]
  Test User 21                  5 ==          0        1     [View tasks]
  Test User 41  [Out of office until Oct 26]  7 ====  1  2     [View tasks]
  [Show 16 members with no open work]  1 out of office
```
**Header and scope (BUG-1, W2, W4).** The title never wraps. The Pod select (native, "Your pods" then "Other pods", the primary one marked) is in the actions slot and capped at 22 rem with an ellipsis; its full text is the tooltip. One muted context line under the title: `<pod> . <n> members . you are a member (primary)` or `you are not a member`; a part the page cannot know is left out; the line is one row with its whole text as the tooltip. The document title is `Pod Work: <pod>: <tab>`; a pod change is announced politely in a live region and does not move focus.
**No pod chosen (W3).** A person with a primary or only pod, or a remembered one, goes straight to it. Otherwise (a Director, a Project Manager, an Observer, anyone with `Pod.View` and no membership) the body is the list of pods: buttons grouped "Your pods" and "Other pods", alphabetical, each row the name and `<n> members . <n> unassigned` (and `. <n> overdue` only above zero). No default pod and no "All pods" aggregate (that would need a cross-pod API; the landing page for oversight roles and #351 own that question). Choosing a pod sets `podId` (remembered as before), moves focus to the page title and announces the pod. When the system has no pods at all: "There are no pods yet." with "Create a pod" (`Pod.Manage`, opens Administration > Users > Pods with the new-pod form) or, without that permission, "Ask an administrator to create one."
**Strip (W5, W11).** Four toggles in My Work's vocabulary: Overdue, Due today, ASAP, On hold, with the pod's own counts (`summary`), never narrowed by the grid's filters. Each opens the All open tab with its filter (Overdue: `overdue=true`; Due today: today's due range and not overdue; ASAP: `asap=true`; On hold: `status=ON_HOLD`), keeps `podId`, shows as pressed (`aria-pressed`) and as a filter chip in the grid, and a second click switches it off; one at a time. The address carries the filter, so Back and bookmarks work. Read-only people can use it (it only filters). Nothing in the strip repeats a tab. Below 640 px it is one horizontally scrolling line of chips with 44 px targets; the scroll is inside the strip, never the page.
**Tabs (W6, BUG-7).** `Unassigned (n)` (tasks), `By member (n)` (people with open work, not their tasks) and `All open (n)` (tasks). The old Overdue and on hold tab is retired because the strip's items open that view; the old address `view=attention` is replaced by `view=all&overdue=true` (Overdue only: the grid cannot express "overdue or on hold"). Keyboard model unchanged (one Tab stop, arrow keys, automatic activation).
**By member (W1, W12).** A workload table that grows with the page (no scroll box of its own; in the fixed layout the tab panel scrolls as a whole): first "Not assigned to a person" (the number of tasks nobody holds, a way to the Unassigned tab; the Overdue and On hold cells are an en dash because the API counts only the total), then the people with open work (alphabetical), then one folded row "Show 16 members with no open work" (a disclosure button with `aria-expanded`; "Hide ..." when open; it says how many of them are out of office). Idle members stay one click away because they are who you assign to. Each row: the name (the link that shows their tasks), the availability chip (the same text as the assignee picker's flag, "Out of office until Oct 26", shown only while the person is out of office) and "(inactive)" where it applies, Open (the number and a neutral bar scaled to the largest load: one token, no colour, no rank), Overdue, On hold and an always visible **View tasks** (`aria-pressed`: the Assignee filter and `assignee=<id>` in the address; two Tab stops per row). The headings sort (Member, Open, Overdue, On hold: ascending, descending, back to alphabetical; `aria-sort`; the viewer's choice, not kept, never load-first by default); the Unassigned and fold rows keep their places. Maximum width about 60 rem. Below 640 px every row is a card (`mf-record-card-list`): the name and chip, `5 open . 0 overdue . 1 on hold`, a 44 px View tasks; the fold is a card too. Workload facts, not a ranking (UX principle 12); no sorting by "most completed".
**Behavior.**
- "Assign to me" is the lightweight self-assign (ordinary assignment, no separate claim concept), in the Assignee cell and as the first item of the Assignee menu on Task Queue, My Work and Pod Work. Requires `Task.Assign`. The Undo toast is the shared one (S16): "Assigned to you." and, for a New task, one more short line "Task moved to In Progress."; the explanation "Undo puts the assignee back; the status stays." is the Undo button's tooltip; on the Unassigned tab the row leaves after 4 seconds and the tab counts and the By member numbers refresh.
- "Assign to..." (the Assignee menu) opens the assignee picker. The server allows assigning a pod's task to anyone active (the answer carries the warning `USER_NOT_IN_POD`; membership is informational only [baseline OPEN-12]); Pod Work's picker lists the pod's members first and only them in this phase, and people outside the pod are reached through the Task Queue (decision AD.9, #572).
- Pod-only assignment (setting Pod without a user) does **not** change status; the UI helper text says so on the Pod field.
**Default sort** same as Task Queue. The grid is the shared one (5.2): fixed layout, 44 / 36 px rows, resizable columns with widths kept per tab (`podWork.<tab>`), cards below 640 px with "Assign to me" next to Unassigned. From 640 to 899 px the Unassigned tab's default columns leave out Matter Number and the Assignee cell shows the link only, so "Assign to me" is in the first view (a column choice of the person wins).
**Phone.** Title, capped select, context line, chip row and the three tabs leave the first card within 200 px of the bottom of the page title at 375 px (it was 330 px; about 194 px now) and all three tabs fit in the row (the shared tabs component still scrolls when they do not); the shell's phone header is S20/S21.
**States.** No pods: see above. Empty queue: "Nothing waiting in Pod A." An empty pod's By member tab shows one message "No members yet." with "Add members" (`Pod.ManageMembers`, opens that pod in Administration > Users > Pods) and no grid. Loading and error as the other work lists (skeleton, "Couldn't load tasks" with Retry, offline).
**Permissions.** The page and its navigation item need `Pod.View` and `Task.View`. Without `Task.View` the item is hidden and the address shows the 403 page with no request and no toast. "Assign to me" needs `Task.Assign`; "Add members" needs `Pod.ManageMembers`; "Create a pod" needs `Pod.Manage`: a control the person may not use is hidden, never disabled. The matrix is `docs/ux/pod-work-review/fixes/pw7-access/permissions.md`.
**Keyboard.** Tab reaches the Pod select (arrow keys change the pod), the four strip toggles, the tab list (one stop), on By member the fold button, the sort headings and the two controls of each row, then the grid (skip link "Skip to member table" or "Skip to task list" first). Enter or Space press every button. Back from a task returns focus to its row.

---

### S05 Clients

**List.** Purpose: find and maintain Clients. A record list: the rules of 5.2 ("Record lists") apply.
```text
Clients                                     [Filters v] [+ New client]     (New client needs Client.Create)
+--------------+----------------------+---------+------------+---------+----------+
| Client number| Name                 | Matters | Open tasks | Overdue | Status   |
| [ number ]   | [ Name         ]     |         |            |         | [Active v]|   <- filter row, open by default from 640 px
| 00343        | Acme Corp (link)     | 4       | 14         | 3       | Active   |
+--------------+----------------------+---------+------------+---------+----------+
Showing 1-37 of 37 active - 3 inactive hidden  Show all          Rows per page [50 v]
```
- **Columns (WP9, #268, #266).** Client number (monospace, plain text), **Name (the one link to the client)**, Matters, **Open tasks**, **Overdue**, Status. Open tasks and Overdue are left out without `Task.View`; a positive count is a link to the Task Queue (`client=<id>` with the open statuses, and `overdue=true` for Overdue), a zero is plain text (Overdue shows an en dash). Both sort on the server and the first click sorts most first. Default sort Client number ascending. No column chooser, no resizing.
- **Filters (WP8).** Client number (a fragment of the padded number: `343` and `00343` both find 00343) and Name (a fragment), and Status with Active as the default. The Filters button and Clear filters sit in the page header; the row is open by default from 640 px and remembered per person. Below 640 px the controls are in the Filters sheet, together with Sort by (Client number, Name, Open tasks, Overdue). The `Matters` count has no sort (the API has none).
- **Hidden count (#271).** With the default Active the pager reads `of 37 active - 3 inactive hidden` and **Show all** sets Status to All.
- **Phone (WP12).** Below 640 px: cards (64 px at least, 96 px with a 105-character name): the name as the link, the client number and `4 matters` as a muted line, the Active/Inactive badge, `14 open` and `3 overdue` as links.
- **States.** Skeleton rows (five cards on a phone) with the final column widths; empty: "No clients yet." with New client (`Client.Create`); empty after filtering: "No clients match these filters" with Clear filters; 403: "You don't have access to clients."; error: "Couldn't load clients." with the reference and Retry (focus then moves to the first row link). Row focus after Back: see 5.9.
- **Keyboard.** The first Tab stop is "Skip to table" (Enter lands on the first row's name link, or on the empty, error or no-access message). One Tab stop per row (the name link). Back from a client returns focus to that row.

**Create/Edit** (page or dialog).
```text
New client
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
Edit: Client number locked with a "Change number" link (needs `Client.Edit`; confirm dialog: "Changing this number changes how matters are named in emails, Relativity workspaces and folders. This change is recorded."). Name always editable. (The forms were not part of the Clients epic.)
**Detail.** A record page (5.9).
```text
Clients > 00343 Acme Corp
[icon] 00343  Acme Corp  (Active)                       [Edit] [Activity] [+ New matter] [...]
                                                         ... = Set inactive / Set active
[ Overview ] [ Matters (4) ]                 (Activity: header button, opens a right-side drawer)
 Overview (default): [Open 14] [Overdue 3] [Due soon 2] [ASAP 1] [On hold 1]     (links to the Task Queue, client=<id>)
   Matters with the most open tasks   (up to 5)     Matter | Name | Open | Overdue | Status        View all 4 matters
   Created Oct 3, 2026 - Last changed Oct 9, 2026
   Custom fields
 Matters tab (?tab=matters): the client's Matters list (same columns as S06 without Client), count in the tab label.
```
- **Overview is the first tab and the default** (#261; the key `details` and the address are unchanged: no `tab`, and `?tab=details` still works). Both tabs use the full page width. `?tab=activity` opens the Activity drawer over Overview. Filters, paging and sort of the Matters tab leave the address when the tab changes.
- **Overview content.** The strip counts the tasks of **all the client's matters** (inactive ones included), see 5.9. The table lists the five matters with the most open tasks (the summary's `topMatters`: open desc, overdue desc, reference), each with the reference as a link, Open, Overdue (red with icon and word above 0) and Status; "View all N matters" opens the Matters tab. A client without matters says "No matters yet." with New matter (`Matter.Create`, client active) or the reason when inactive; a client whose matters have no open tasks says "No matter has open tasks." The number, name and status rows of the old Details tab are gone (the header shows them). Without `Task.View` there is no strip and the table lists the first five matters (reference, name, status). Without `Matter.View` there is no table and no Matters tab (`?tab=matters` shows the Overview). A failed summary shows "Couldn't load the task numbers." with the reference and Retry inside the tab; the rest of the tab stays.
- **Inactive client.** Set inactive is allowed ("Set 00343 Acme Corp inactive? New matters can't be created for an inactive client. Its existing matters and tasks keep working." in the confirm dialog). An inactive client **blocks New matter** (decision V): the header button is disabled with "This client is inactive. Set it active to add matters." (tooltip and screen-reader text), and so is the button in the Overview's empty state.
- The Edit and Set inactive/active actions keep their permissions (`Client.Edit`); the confirm dialog returns focus to its trigger.
**States.** Skeleton with the final header and tabs; not found: "We couldn't find that client." with a link to Clients; no access: "You don't have access to this client."; error: "Couldn't load this client." with the reference and Retry (see 5.6); save error: field errors and summary.
**Permissions.** `Client.View`; `Client.Create`; `Client.Edit`; `Matter.View` (Matters tab and matter links); `Matter.Create` (New matter); `Task.View` (strip and counts); `Audit.View` (Activity). The matrix is `docs/ux/clients-review/fixes/wp13/permissions.md`.

---

### S06 Matters

**List.** A record list (5.2). Purpose: find a matter by reference, name or client.
```text
Matters                                      [Filters v] [+ New matter]
+---------------+--------------------+-----------------+------------+---------+---------+
| Reference     | Name               | Client          | Open tasks | Overdue | Status  |
| [ ref ]       | [ Name        ]    | [ Client     ]  |            |         |[Active v]| [Sensitive v]
| 00343-00012 [copy] | Merger Review (link) | 00343 Acme | 14       | 3       | Active  |
+---------------+--------------------+-----------------+------------+---------+---------+
```
- **Columns (WP9).** Reference (monospace plain text with a copy button), **Name (the one link to the matter)**, Client (a link with `Client.View`, plain text without; shown from 900 px), Open tasks, Overdue (as on Clients; left out without `Task.View`), Status (Active/Inactive); a Sensitive matter has the lock badge beside its name. The Projects count column is gone. Default sort Reference ascending; the other sorts are Name, Client and the two counts.
- **Filters (WP8).** Reference, Name, Client (text), Status (Active by default; the pager says `of 120 active - 9 inactive hidden`) and **Sensitive** (a select: Any, Yes, No) in the filter row; "Other filters" is gone. `?clientId=` (a link from a client) shows a removable chip. Below 1100 px Sensitive stacks under Status in the row; below 640 px the controls are in the Filters sheet with Sort by (Reference, Name, Client, Open tasks, Overdue).
- **Phone (WP12).** Cards as on Clients: the name as the link, the reference with its copy button (44 px), the client text (a link only with `Client.View`), badges (Inactive, Sensitive), `14 open`, `3 overdue`.
- **Keyboard.** "Skip to table" first. **One Tab stop per row**: the name link (and the Client link when the column is shown). The copy button is not a Tab stop: **the right arrow on the name link steps to it**, the left arrow or Shift+Tab goes back, Tab goes on to the next stop after the row's link. The button shows on row hover and while the row has focus (always on a phone). `?` lists the arrow. Measurable: 25 matters = 25 name stops and 0 copy stops (decision V).
- **States.** As Clients: "No matters yet." with New matter, "No matters match these filters" with Clear filters, "You don't have access to matters.", "Couldn't load matters." with Retry.

**Create/Edit.**
```text
New matter
Client (required)   [ typeahead: 343 or Acme  v ]
Matter number (required) [ 12 ]  Will be saved as 00012.  Combined reference: 00343-00012
Matter name (required)   [__________________]
Status (edit only)        Active / Inactive
-- Custom fields --
```
Live combined-reference preview updates as the user types. Messages: "Select a client." / "Enter a matter number." / "Use digits only (1 to 5)." / "Matter 00012 already exists for client 00343." (unique only within the Client). Client is locked after creation. (The forms were not part of the Clients epic.)
**Detail.** A record page (5.9).
```text
Matters > 00343-00012 Merger Review
[icon] 00343-00012 [copy]  Merger Review  (Active) [lock Sensitive]    [Edit] [Activity] [+ Create task] [...]
Client 00343 Acme Corp                                                  ... = New project, New asset, Set inactive
[lock] Sensitive matter. Handle its tasks and assets with extra care. This flag is a warning only ...   (only when Sensitive)
[ Overview ] [ Tasks (7) ] [ Projects (3) ] [ Assets (5) ]       (Activity: header button, opens a right-side drawer)
Overview (default): [Open 7] [Overdue 2] [Due soon 1] [ASAP 0] [On hold 1]  (links to ?tab=tasks&view=...)
                    Client (link) | Status | Sensitive (Warning only) | Created | Last changed | custom fields
Tasks tab (?tab=tasks): the summary strip as toggles (view=), then the scoped Task Queue grid (Project column and filter when the matter has projects).
Projects tab (?tab=projects): Name (link; description as a muted second line), Open tasks, Overdue, Status; Active first, then "Archived (7)".
Assets tab (?tab=assets): the matter's assets (en dash for an empty external reference); New asset in the empty state and the header overflow.
```
- **Overview is the first tab and the default** (#263). No `tab` in the address means Overview; `?tab=tasks|projects|assets` deep links work, `?tab=activity` opens the Activity drawer over Overview, anything else (and a tab the person may not see) shows Overview. Links that mean the project or asset list (cancel of New project / New asset launched from the matter) carry `?tab=projects` / `?tab=assets`. The Tasks and Assets filters, paging and sort leave the address when the tab changes. Tabs are the shared `mf-tabs` (5.9). The Overview is a left-aligned definition list under the strip that scrolls inside the panel (region "Matter overview") while the header, banners and tab list stay fixed; the reference, number and name rows are gone.
- **Strip.** The Overview's items are links to the matter's own Tasks tab with the matching view (Open = `?tab=tasks`). Above the Tasks grid the same strip toggles a `view` (5.9): the grid then shows exactly the strip number.
- **Tabs and counts (#262, #264, #273, #274).** Tasks (n) = open tasks, the number loaded with the matter (only with `Task.View`; an inline edit in the grid refreshes the strip but not this number), Projects (n) = all projects, archived included (only with `Project.View`), Assets (n) = all assets, retired included (only with `Asset.View`; the Assets pager says `of 5 active - 1 inactive hidden` so the number and the rows agree; the Assets tab keeps its filter row closed by default). A Matter without `Task.View` still shows the Tasks tab: it says "You don't have permission to view tasks." in a sentence, with no request.
- **Projects tab.** The projects of the matter sorted with a natural (numeric) order inside each group; Active first, then one collapsed group row `Archived (7)` (`aria-expanded`, Enter and Space; open when every project is archived; absent when none). Name is the one link; a description is a muted second line. Open tasks and Overdue are links to the Task Queue scoped to the project (left out without `Task.View`). Empty: "No projects in this matter yet." with New project.
- **Header actions.** Edit (`Matter.Edit`), Activity (`Audit.View`), **Create task** (`Task.Create`, disabled with "This matter is inactive. New tasks can't be created." for an inactive matter), and in the overflow New project (`Project.Create`), New asset (`Asset.Create`) and Set inactive / Set active (`Matter.SetActive`). The Assets and Projects tabs have no in-tab create buttons except in their empty states.
**Set inactive.** Allowed only when all Tasks are Completed or Cancelled.
- While tasks are open the overflow item **Set inactive is disabled with the reason** "This matter has N tasks that aren't Completed or Cancelled. Finish or cancel them first." (shown under the item and read with it). If the server still refuses (the tasks changed meanwhile, `MATTER_HAS_OPEN_TASKS`), the dialog "Can't set this matter inactive" gives the same sentence, a Close button and, with `Task.View`, "View open tasks" (opens the Task Queue for the matter).
- Inactive Matter shows a persistent banner "This matter is inactive. New tasks can't be created and completed or cancelled tasks can't be reopened." Create task and Reopen are disabled with that reason. Set active is in the overflow (`Matter.SetActive`); an inactive client adds the banner "The client 00343 is inactive."
**States/permissions.** Skeleton with the final header, tabs and rows (`Tasks (--)`); 404 "We couldn't find that matter.", 403 "You don't have access to this matter.", error "Couldn't load this matter." with Retry. `Matter.View/Create/Edit/SetActive`; Create task needs `Task.Create` and an active Matter; the permission matrix is in `fixes/wp13/permissions.md`.

---

### S07 Projects

Projects are flat folders of Tasks within a Matter (no nesting).
**Global Projects list** (`/projects`, a record list, 5.2).
```text
Projects                                          [Filters v] [+ New project]
+-------------------+----------------------+--------------+------------+---------+----------+
| Name              | Matter               | Client       | Open tasks | Overdue | Status   |
| [ Name       ]    | [ Matter     ]       |              |            |         |[Active v]|
| Custodian Proc.   | 00343-00012          | 00343 Acme   | 6          | 1       | Active   |
|                   | Merger Review        |              |            |         |          |
```
- **Columns (WP9, #267).** **Name (the one link to the project)**, Matter (the two-line Matter cell of the Task Queue: reference over name, a link with `Matter.View`, so two projects with the same name are told apart), Client (plain text, from 1100 px), Open tasks and Overdue (as on Clients), Status (Active, Archived). Default sort Name; Matter sorts by reference. Status filter default Active, the pager says `of 50 active - 4 archived hidden`.
- **Phone (WP12).** Cards: name link, the matter (link with `Matter.View`), `Archived` badge only, counts. Sort by: Name, Matter, Open tasks, Overdue.
- **States.** "No projects yet. Open a matter and choose New project." (the link only with `Matter.View`), "No projects match these filters", 403 "You don't have access to projects.", "Couldn't load projects." with Retry. "Skip to table" is the first Tab stop.

**Create/Edit (dialog).** Fields: Matter (prefilled and locked when launched from a Matter; else typeahead; required), Name (required, max 200, unique within Matter [UX-PROPOSAL]), Description (optional), Active toggle (edit), custom fields. Messages: "Enter a project name." "A project named 'X' already exists in this matter."
**Detail.** A record page (5.9) with two tabs.
```text
Matters > 00343-00012 > Custodian Processing
[icon] Custodian Processing  (Active)                          [Edit] [Activity] [+ Create task] [...]
Matter 00343-00012 Merger Review                                 ... = Archive / Restore
[ Tasks (6) ] [ Details ]
Tasks (default, no tab in the address): the summary strip as toggles, then the Task Queue grid of this project.
Details (?tab=details): Matter (link) | Description (only when set) | Status | Created | Last changed | custom fields
```
- **No side panel (#257).** The Project page has the same tab strip as the other records and uses the full width. **Tasks (n) is first and the default**; Details holds what the old panel held, without the name (it is in the header). The count is the summary's open-task number (the strip's Open), so it survives a filtered grid and a deep link with filters; until the summary answers it reads `--`; without `Task.View` there is no count. The grid stays mounted while Details is open, so its filters, sort and page survive a visit to Details. An old `?tab=activity` link opens the Activity drawer over Tasks.
- **Header actions.** Edit (`Project.Edit`), Activity, **Create task** (prefilled with the matter and the project; disabled with "This project is archived. New tasks can't select it." when archived) and in the overflow Archive / Restore (`Project.Archive`). The breadcrumb is `Matters > <matter reference> > <project name>`; the first two steps are plain text without `Matter.View`.
- A Project without `Task.View` opens on Tasks, which says "You don't have permission to view tasks." (a known design, decision V).
- Moving a Task between Projects (or to "No project") is a dialog listing only that Matter's Projects; the Matter cannot change. Audited.
- Archive (inactive) a Project: allowed; the confirm dialog says "Existing tasks keep this project, but new tasks can't select it."; an archived project shows the banner "This project is archived. Existing tasks keep it, but new tasks can't select it."
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
Tasks > Create task                       (Tasks > 00343-00012 Merger Review > Create task from a matter you may open)
[+] Create task
Choose a task type to start                (after the choice: Task type Data Processing)
+-- Quick fill from email (optional) -------------------------------------------------------------+
|  [ Drop an Outlook email here ]   or   [ Paste email text ]   or   [ Choose .eml/.msg file ]   |
|  We read the subject, body, sender and sent date. Attachments and the original email are NOT saved.|
+------------------------------------------------------------------------------------------------+
 (after parse) [ok] Filled Title, Description, Requestor, Sent date.   [Review highlighted fields] [Clear]

What kind of task is this?                  (step 1: the chooser; type, workflow and matter can't be changed later)
 Search task types [ Name or description ]   3 of 12 task types
 +----------------+ +----------------+ +----------------+      3 cards per row from 1024 px, 2 from 640, 1 below;
 | [icon] Data    | | [icon] Review  | | [icon] Export  |      the description is cut after the last whole word
 | Processing     | | ...            | | ...            |      (110 characters), the whole text is the tooltip
 +----------------+ +----------------+ +----------------+

(after the choice, one 720 px column)
 +-- Matter -----------+-- Task type ----+-- Workflow ---------------------------------+
 | 00343-00012 Merger  | Data Processing | Standard Processing v2 (6 steps, ordered)    |
 +---------------------+-----------------+----------------------------------------------+
 Type, workflow and matter can't be changed after you create the task.
 [icon] Task type Data Processing                                     [Change type]

 Task
  Matter (required)        [ typeahead 343-12 / name v ]  Only active matters are listed.
  Title (required)         [______________________________]  n / 200
  Description              [ rich text ___ ]   Source email sent: Oct 13, 2026 9:12 AM
  Project (optional)       [ none v ]
 Input
  Requestor name (required) [______________]   Requestor email (optional) [______________]
  (DynamicForm for the selected Task Type form version, in form order, with conditional rules)
  Requires OCR? [x]   -> OCR language (required) [ English v ]
  Workflow (required)       ( ) Standard Processing v2   ( ) Rush Processing v1
 [v] Priority, due date and assignment      (collapsed by default)
     Normal priority, due Oct 24, 2026 at 5:00 PM, Unassigned          (the summary line)
  (open:) Priority (required) [ Normal v ]
          Due date [ date ]  Time [ time optional ]  [x] No due date (ASAP)      (one row, same height and top)
          Pod [ none v ]   Assignee [ none v ]
           helper: "Assigning a person starts the task (In Progress). Assigning only a Pod doesn't."
-------------------------------------------------------------------------------------------------
[Create task] [Create and add another] [Cancel]              (sticky footer)
```
**Sections (#349).** Three sections, exactly: Task (Matter, Title, Description, Project), Input (Requestor name and email, the request-form fields in form order, the Workflow choice; "More details" no longer exists) and "Priority, due date and assignment". The third is collapsed on every new page (nothing is remembered); its header is a button (`aria-expanded`, `aria-controls`, Enter and Space) with a one-line summary of the values, and it opens by itself when one of its fields has an error. Input always shows because the requestor and the workflow always belong to it; with a type without request-form fields only the form-field block is left out. Due date and Time are top-aligned on one row from 640 px and stack at equal width below.

**Layout (Task Detail epic T8, #322, #323).** The page uses the shared record header (`mf-record-header`, kind `task`): the h1 "Create task" with a plus icon in the `mfIcon` slot, the crumb `Tasks > Create task` (or `Tasks > matter > Create task` when opened from a matter the person may open) and the chosen type as the one context line ("Choose a task type to start" before). There are two steps on one page: the **type chooser** (cards: 3 per row from 1024 px, 2 from 640, 1 below; the search box appears when there are many types; the description is cut after the last whole word at 110 characters with the whole text as the tooltip) and then the form. The form is **one 720 px column** with one input width rule (`--mf-field-max`, default 480 px for other forms); the former sticky right-hand Summary card is now a **three-tile strip** (Matter, Task type, Workflow) above the form, built locally from the work-strip tokens, with the sentence that type, workflow and matter can't be changed; the action row is a sticky footer. Not a wizard otherwise: Task type must be chosen before Workflow and Request details render. The form engine and Fill from email are unchanged.

**Fields and rules.**
| Field | Required | Rules / behavior | Error message |
|---|---|---|---|
| Matter | Yes | Active matters only; if launched from a Matter, prefilled and still changeable until submit | "Select a matter." / "This matter is inactive. Choose an active matter." |
| Project | No | Lists only projects of selected Matter; clears if Matter changes (with note) | "That project doesn't belong to this matter." |
| Title | Yes | max 200, 2 to 4 line auto-growing box with an `n / 200` counter (announced from 180), line breaks stripped; prefilled from Subject | "Enter a title." |
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

**Purpose.** Single source of truth for one Task: what it is, who has it, what state it is in, workflow execution, assets, comments and history. The page follows the Task Detail epic #288 (issues #289 to #331); the decisions are in `decisions-addendum.md` section W and the plan, with what each package shipped and where it deviated, in `docs/ux/task-detail-review/delivery-plan.md` section 4. **Where the code differs from the issues, this section follows the code** (listed in section W, "Code versus plan").

```text
Tasks > 00343-00012 Merger Review > TSK-1042                       (crumb; "Back to My Work" on a phone)
[icon] TSK-1042  Process Smith custodians                  [Edit] [Activity] [Complete task] [...]
Matter 00343-00012 Merger Review . Client 00343 . Data Processing . Standard Processing v2 (ordered)
(Sensitive matter: one line)   (View only: you don't have permission to edit tasks.)
+--------+----------+---------+-----------+---------+----------------------+
| Status | Priority | Due     | Assignee  | Pod     | Workflow             |
| [In Pr]| [Critical]| Oct 14  | Tariq M.  | Pod A   | 3 of 6 resolved      |
+--------+----------+---------+-----------+---------+----------------------+
(status note, only On hold / Completed / Cancelled)
  On hold since Oct 18, 4:03 PM by KE\kekim: Waiting for the client's reply   [Show more]
[ Workflow (3/6) ]  Assets (2)  Comments (48)       (tabs: one pane at a time, the full width of the left column)
  WORKFLOW pane (the default tab)                         | DETAILS (side panel, from 1100 px,
  one-line head: mode sentence, [Show All v]              |  sticky, splitter, no nested scroll)
  (3) Deduplicate [current, expanded] ...                 |   Description (12 lines, Show more)
  (1)(2)(4)(5) one-line summaries                         |   Task information (requestor, project,
  ASSETS pane: linked assets, [Link asset]                |     created, last updated)
  COMMENTS pane: thread, composer (above the thread       |   Request details (Search and Culling,
    when there are > 5 comments)                          |     form 1)   14 fields   [open/closed]
                                                          |
Below 1100 px one column: header, strip, note, tabs and the selected pane, then
Details as a closed disclosure:  > Details   Requestor Dana W-M . 14 request fields
```

**Page layout (`mf-detail-layout`, tabs since #347).** The page is one page like Client, Matter and Project, and since #347 its left column holds the shared `mf-tabs` strip **Workflow | Assets | Comments** (in that order, Workflow the default) and one pane at a time, each the full width of the column. This reverses the stacked Assets and Comments sections and the section nav of T5 (#307, #308) and the owner's earlier "Assets first, full width, stacked" request; the tabs keep **Assets before Comments** (decisions-addendum section W, "Tabs reverse the stacked layout"). Details is **not a tab**: from **1100 px** it is the right column (sticky, sized by its content, draggable splitter, width remembered per person in `mf.detail-panel.open` and `mf.task-detail.split.<userId>`); below 1100 px it is a **closed disclosure** after the pane (`aria-expanded`, 44 px target) whose button carries the one-line summary `Requestor Dana W-M . 14 request fields`, remembered per person (`mf.task-detail.details.open.<userId>`; `?tab=details` opens it without remembering). Below 1100 px the order is **header, facts strip, status note, tabs, the selected pane, Details**. The wide panel hands the mouse wheel on to the page at its ends and shows a bottom fade while more is below; with Request details closed and a long description it has no scrollbar and no fade (1366x768, 1920x1080). Activity is a right-side drawer opened by the header's Activity button. **The tab is kept in `?tab=`** (`assets`, `comments`; the default Workflow is not written; an unknown value shows the Workflow); choosing a tab **replaces** the address instead of adding to the history, so Back still leaves the task for the page it was opened from (drill-in, T9) however many tabs were visited. `?tab=activity` opens the drawer, `?tab=details` shows the page and opens the disclosure, `?step=<id>` opens and focuses that step on the Workflow tab. All three panes stay on the page (the inactive ones `hidden`), so the counts are live, a step being filled in or a comment being written survives a change of tab, and a link into a comment finds its thread. The old remembered open/closed choices (`mf.task-detail.comments.open.<userId>`, `mf.task-detail.assets.open.<userId>`) are no longer written or read. There is **no Attachments section** (nothing is stored). Measured Workflow heading y (typical overdue task / 200-character sensitive task; the heading is the pane's first line, for screen readers): 375 px 375 / 423, 768 px 322 / 347, 1366 and 1920 px 267 / 292 (before the tabs, with the section nav: 377 / 425, 324 / 349, 269 / 294). 

**Header (`mf-record-header`, kind `task`).** The same component as the Client, Matter and Project pages with a different data set.
- **Crumb:** `Tasks > matter > TSK-n` (the matter only with `Matter.View`); the middle step is cut at 40 characters with the full text as a tooltip and for screen readers. The first crumb names the page the task was opened from (see "Drill-in" below). Below 640 px the crumb becomes "Back to <list>".
- **Title:** `TSK-n  title` is the one `h1`, 22 px (18 px on a phone), one line, two at most, the full title as a tooltip; the task type icon sits in front of it. No Active badge.
- **Context line:** one muted line `Matter 00343-00012 Merger Review . Client 00343 . Data Processing . Standard Processing v2 (ordered)`; the matter reference links with `Matter.View`, the client number with `Client.View`, otherwise plain text; the whole sentence is the tooltip. Matter, Task type and Workflow are immutable (the lock explanation, "Can't be changed after creation. To correct it, cancel this task and create a new one.", is in the Edit dialog's locked block).
- **Actions** (data, `RecordAction`, permission-gated), in this order: **Edit** (`Task.Edit`), **Activity**, the primary **Complete task** (**Reopen task** on a closed task; no primary on an On hold task, whose Resume is in the overflow), and the "..." overflow with **Put on hold** or **Resume**, **Copy link**, a divider and **Cancel task** (danger, last). Complete is **never disabled for missing information**: while steps need information it keeps the `n steps need information` hint (tooltip and `aria-describedby`; the dialog then offers "Go to first step"). A status action the Matter blocks is shown disabled with its reason; one the person has no permission for is absent. On a phone the primary and the overflow share one row of 44 px targets and Edit and Activity move into the overflow. There is one Edit control on the page (the Details panel has no pencil).
- **Sensitive note:** one line under the title (`data-sensitive-banner`), a warning only.
- **View only line:** a person who can change nothing on the task (no edit, assign, priority, status, workflow permission) sees "View only: you don't have permission to edit tasks." once, under the header; commenting alone does not count as editing.

**Facts strip (`mf-task-facts`).** Exactly **six tiles**, each fact once: **Status** (menu), **Priority** (menu), **Due** (`mf-due-cell`, inline; a closed task with a due date reads `Was due Oct 14`; for a person with `Task.Edit` on an open task it is a menu button like the other three, see **Inline Due date** below), **Assignee** (menu), **Pod** (an en dash and "No pod" for readers when empty) and **Workflow** `2 of 3 resolved` ("No steps" without steps). The three menus are the same `mf-row-edit` menus as the work lists, with the same names and words (a person without the permission sees the plain badge or text); they are plain while the Edit dialog is open. **Status menu:** one label per item (the target status only as a tooltip), a divider, Cancel task last in the danger style; a closed task offers only Reopen. **Assignee menu:** **Assign to me** is the first item; each Pod member shows `n open` (read from the Pod Work loads, quiet and best effort; needs `Pod.View`, otherwise the hint is simply absent). The look is the global `_facts-strip.scss` (the work-strip tile tokens, no new token). Below 640 px the strip is 2 x 3.

**Status note (`mf-task-status-note`).** One neutral note under the header replaces every old banner (the closed banner, the reason banner, the Workflow notice and the step footer line). Texts: `Completed Oct 18, 4:03 PM by Test User 01`, `Cancelled Oct 18, 4:03 PM by KE\kekim: Duplicate of an earlier request`, `On hold since Oct 18, 4:03 PM by KE\kekim: <reason>`. The time is in the viewer's zone (year only outside this year), the full date and whole reason are the tooltip, a reason over two lines is cut with Show more / Show less; grey icons, no warning colours, **no buttons** (Reopen task and Resume stay in the header). A closed task in an inactive Matter adds the one sentence that it cannot be reopened. The actor is `TaskResponse.statusChangedBy`, read from the audit trail, so a task completed before audit existed shows no "by".

**Tabs (`mf-tabs`, `dense`).** `Workflow (2/3)   Assets (0)   Comments (48)`: the tab strip of the Client, Matter and Project pages (WAI-ARIA tabs, automatic activation, roving tabindex so the strip is one Tab stop, Left and Right wrap, Home and End jump), with the edge-fade cue and chevrons when the strip scrolls sideways (WP11, #279; at 320 px it scrolls on its own and the page does not). The strip is **dense** on this page (2.5 rem tabs, 4 px below) so the pane starts where the old nav row let it (the Workflow heading targets of T5, T6 and the final pass hold). The Workflow count is `resolved/total` with the accessible name "Workflow, 2 of 3 steps resolved" (no count without steps); Assets and Comments show their count as soon as the pane has loaded (`--` before), on **any** tab and live: a posted comment, a linked or unlinked asset and a completed step change them without a reload. Assets keeps its tab without `Asset.View` (decision: the T10 matrix keeps the one designed sentence; the tab has **no count** and its pane says "You don't have permission to view assets, so linked assets aren't shown here."). The tab panel is `role="tabpanel"` `id="task-panel"`, labelled by the selected tab (`task-tab-<key>`). Choosing a tab does not scroll the page and does not move focus off the tab. The panes' headings ("Workflow", "Assets", "Comments") are visually hidden: the tab already names the pane. 

**Workflow.** The head is one row: the (visually hidden) heading, the one-line mode sentence ("Ordered: complete or skip each step in order" / "Unordered: work these in any order") and at the right the **Show All / Unresolved** filter (56 px at most at 1366 and 1920). The filter appears **from 6 steps**, for ordered and unordered workflows alike. A step's number and title are one item (a long title wraps beside its number; the date and badge wrap below). The step stepper, skip, reopen and completion rules are unchanged (below).

**Assets.** The Assets tab (`Assets (n)`) shows the list with the "Link asset" button above it (needs `Asset.Link`, `Asset.View` and the right to edit the task); a closed task shows "Linked assets can't be changed while the task is Completed or Cancelled. Reopen it to change them." Without `Asset.View` the tab reads "Assets" (no count) and the pane the explanation "You don't have permission to view assets, so linked assets aren't shown here." (the one designed no-access notice of the page); asset references in the request form read `Asset 12 (not available)` and **no request goes to the Asset API**.

**Comments.** Above **5 comments** the composer is above the thread (below it for 5 or fewer); without `Task.Comment` the internal-only note takes the composer's place. A long thread shows `Showing latest 3 of 48. Show all` (and `Showing all 48. Show latest 3`), remembered per person; the old "Show latest" select is gone.The Comments tab has no bar and no preview; a **"N new" cue** (comments by other people since the person last saw the thread) shows at the top of the pane, the thread counts as seen while the tab is showing and again when the person leaves it (a new comment never switches the tab by itself). The composer is one line until it gets focus; a draft survives a visit to another tab.

**Inline Due date (#664).** The Due tile of a person with `Task.Edit` (New, In Progress or On Hold; not while the Edit dialog is open) is a button with `aria-haspopup`, `aria-expanded` and the chevron of the other tiles; its name starts with the visible text ("Oct 18 Overdue 2d, change due date of TSK-1042"). Click or Enter opens a small popover (`mf-due-edit`, fixed under the tile, kept inside the window, follows the tile on scroll and resize; it never closes on a phone keyboard resize) with the shared **Due date** input, **Time (EDT)** (the viewer's zone), the past-date warning of the Edit dialog, **Save**, **Cancel** and, when a date is set, **Clear due date (ASAP)** (saves at once). The cursor starts in the date field. Esc closes and returns focus to the tile, a click or focus outside closes without saving (the shared popover rule). Save sends the one update call of the Edit dialog with the task's other details unchanged; on success the popover closes, the tile, the status note and the Overdue or ASAP styling follow, a polite status line says "Due date set to Oct 24, 2026 5:00 PM" or "Due date cleared", and focus returns to the tile. On failure the popover stays open: field errors under the date or time, any other server message and the conflict message with **Reload** in an alert inside the popover, and focus on Save; no toast unless the request fails entirely. A time without a date and text that is not a date are refused in the popover with the Edit dialog's words. No new shortcut.

**Details panel.** `Description` (cut at **12 lines** with "Show more / Show less" only when it overflows, measured before the first paint; links, lists and tables inside keep working), `Task information` (Requestor with a mail link, Request sent, Project, Created and Last updated; Type, Pod and Due are not repeated here) and the **request details section** (`mf-request-section`, shared with the Edit dialog): `Request details (Search and Culling, form 1)  14 fields`, **open at 6 fields or fewer and closed above**, the choice remembered per task type and person (`mf.task-detail.request.open.<userId>.<typeId>`); the body is hidden, not removed, so the dialog still validates, and the dialog opens it on a request-form error.

**Edit dialog (`mf-task-edit-dialog`).** Opened by the header's Edit; 720 px wide (the screen's width below 720); header and footer stay in place (Save changes, Cancel); the body scrolls; every grid column is `minmax(0, 1fr)` so nothing scrolls sideways at 375 px. Sections (#350, the same three as Create task): **Task** (Title, Description, Project; Matter stays in the locked block because it can't change), **Input** (the shared section component headed `Input` with the field count, holding Requestor name and email and the request-form fields in form order, with the task type and form version as a muted caption; default open for 6 fields or fewer, closed above, remembered per task type and person, kept mounted so it validates, opened on its own error including a requestor error) and **Priority, due date and assignment** (collapsed on every open with a one-line summary of the current values, e.g. `Normal priority, due Oct 24, 2030 at 5:00 PM, Unassigned`; opens by itself on an error in Priority, Due date, Time, Pod or Assignee, client or server; Priority shows only with Set priority or when changed; Pod and Assignee only with `Task.Assign`, a person without it sees the task's current assignee in the summary; Due date and Time are top-aligned like Create task). The Details panel keeps its own `Request details` heading. The Title is `mf-title-area`: a 2 to 4 line auto-growing textarea with an `n / 200` counter (announced politely from 180 characters and on error; line breaks stripped; Enter does nothing). A failed Save puts the cursor in the first invalid field (the summary stays), server field errors map back onto the fields. **Esc is ignored with unsaved changes.** A locked block lists Matter, Task type and Workflow with the lock explanation.

**Immutable fields.** Matter, Task Type, Workflow (and version) are shown read-only (context line, Edit dialog). Project is editable (same Matter only).

#### Details
Request form values are edited in the Edit dialog against the **form version the task was created under** (a caption "Form version 3"); conditional rules apply. Saved edits are audited with before/after. Editing is not offered when status is Completed/Cancelled (the status note and Reopen) and when the Matter is inactive.

#### Workflow: stepper
Two layouts driven by workflow mode.

```text
Workflow   ORDERED - complete or skip each step in order                        [Show All v]
(1) [ok] Intake QC                Completed  Oct 13 by Tariq   [Reopen]
(2) [//] Load to Relativity       Skipped    "Already loaded by vendor"  [Reopen]
(3) [>>] Deduplicate              In progress  <- current                [expand]
      Instructions (rich/preformatted), Docs: link ->
      Inputs:  Items in  [ 12,400 ]   Items out [ ____ ]  Dedup method [Global v]
      [Save inputs] [Mark complete] [Skip step...]   (Skip shown only if step is skippable)
(4) [  ] OCR                      Pending (locked until step 3 is resolved)
(5) [  ] QC sample                Pending (locked)
(6) [  ] Handover                 Pending (locked)
```
There is no progress bar or "Resolved n of m" line in the Workflow head: the progress is the Workflow tile of the facts strip and the count on the Workflow tab. The Complete block is not in the Workflow section; Complete task is the header's primary action. Unordered: the same rows with no locked states, the filter from 6 steps.

**Step states** (internal `PENDING`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`; reopen = audited return to In Progress): icon + text, never colour only. "n of m resolved" counts Completed or Skipped.
**Ordered rules in the UI.**
- Only the first unresolved step (the "current" step) can be started/completed/skipped. Later pending steps show a lock icon and "Complete or skip step N first". They remain expandable for reading instructions.
- Reopened earlier step: shown with an amber "Reopened" tag; downstream completed steps **stay** Completed and unchanged. A note beneath: "Step 2 was reopened. Later steps are unchanged. Resolve step 2 before completing the task." The task cannot be completed until the reopened step is resolved. New (pending) downstream steps remain locked behind the reopened step.
**Completing a step.** "Mark complete" validates required visible inputs (conditional rules apply: hidden inputs not required). Field errors show inline: "Enter <label> to complete this step." Save inputs without completing is allowed (draft values). Starting or completing a step does not change Task status: workflow progress and lifecycle are independent, except the addendum rules (assigning a user, reopening a step on a Completed Task).
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
**Reopen step.** One click opens a small confirm popover (no reason in Phase 1): "Reopen this step so you can change it? Later steps keep their status." [Reopen step] [Keep as is]. After reopening, the step opens in edit mode and its prior values are shown.
- If the Task is **Completed**, the popover adds "This task is Completed. Reopening a step will move the task back to In Progress." and the action does both, audited as two events; the Activity drawer shows "Task status changed to In Progress (step reopened)". If the Matter is inactive, the control is disabled with reason.
- Requires `Workflow.StepReopen`; editing inputs requires `Workflow.StepEdit`; completing/skipping requires `Workflow.Execute`.
**Complete task.** The header's primary button (and the Status menu's Complete). **Never disabled for missing information** (with `Task.Complete`). If steps are unresolved but ready, a confirmation dialog appears: "You have N steps not completed. Do you want to mark them all completed?" [Complete all steps and finish] / [Cancel] (addendum K). Confirm completes the unresolved steps (as Completed, not Skipped) and the Task in one action. If any of those steps is missing required inputs, the dialog instead lists them ("These steps need required information first: ...") with links, its primary button is **Go to first step** (opens, scrolls to and focuses the step; from a work list it opens the Task at `?tab=workflow&step=`), and the Task stays open. The button's hint `n steps need information` is shown before the click (tooltip, `aria-describedby`, the menu item's note). Optional/skippable steps follow the workflow's completion policy (Appendix D: OPEN-05). The blocked-step links are 24 px targets.
**No step assignee picker, no approval controls, no approver fields.**

#### Status change rules (UI)
The Status menu lists only valid targets for the current state (see Appendix B):
| From | Allowed to | Notes |
|---|---|---|
| New | In Progress, On Hold, Cancelled | Assigning a user auto-moves New -> In Progress (toast) |
| In Progress | On Hold, Completed*, Cancelled | *Completed through the Complete flow |
| On Hold | In Progress (Resume), Cancelled | |
| Completed | In Progress | = Reopen task; blocked if Matter inactive |
| Cancelled | In Progress | = Reopen task; blocked if Matter inactive |
Unassigning later does **not** revert status. Any transition is audited. Permissions: `Task.ChangeStatus`, `Task.Complete`, `Task.Cancel`, `Task.Reopen`.
**Dialog wording.** Put on hold: field "Reason", dismiss "Close". Cancel task: field "Reason" (required: "Add a comment explaining why you're cancelling."), buttons "Cancel task" and "Keep task"; the comment is posted to Comments and shown in Activity. Reopen task: "Move TSK-1042 back to In Progress?" [Reopen] [Keep]; no reason; disabled with reason when the Matter is inactive.
**Focus after an action.** After Complete (straight through or after the bulk dialog), Put on hold, Resume, Reopen and Cancel task, focus goes to the **Status menu button** (waits until the closed dialog has left the page), or to the page heading for a person with no Status menu; a failed or cancelled action moves nothing.

#### Comments
```text
Comments (5)
[ Write a comment... ]            (composer first above 5 comments; Ctrl+Enter posts)
+-- Dana P.  Oct 13, 9:25 AM ---------------------------------------+
| Called the client; approved by A. Lee (email 10/13). [edit] [delete] (own comments)|
| Edited Oct 13, 10:01 AM  [View edit history]                                         |
+----------------------------------------------------------------------+
Showing latest 3 of 48. Show all
Internal only: comments are visible to people who can view tasks.
```
- Rich text with bold/italic/lists/links and tables (see §5.5, decision R); sanitized server-side; no attachments/images/mentions.
- Authors edit/delete their own comments; edit shows "Edited" and "View edit history"; delete is a soft-delete: confirm "Delete this comment? It will be hidden from view but kept in the audit record."
- Cancel comments appear as comments with a "Cancellation reason" tag.
- Posting requires `Task.Comment`; users without it see read-only comments.
- Empty: "No comments yet." Error on post: inline, keeps typed text.
- Comments are separate from system history (Activity).

#### Assets
Linked Assets (Name, Type, External ref, Link label Source/Destination/Subject/Result, Remove link). "Link asset" opens a picker restricted to the Task's Matter Assets (search + paginate). Duplicate links prevented. Needs `Asset.Link` (and `Task.Edit`). Empty: "No assets linked."

#### Activity (drawer)
Chronological, filterable by type (Status, Assignment, Fields, Workflow, Comments, Assets). Each event: actor, time (viewer's zone, tooltip UTC), event text, and "View changes" showing old -> new values. Dates in sentences and changes are `Oct 15, 2026` (whole-value calendar dates only; free text is never rewritten). The drawer title is clamped to two lines with the whole text as a tooltip. A failed load shows one inline message with Retry (a failed "Load more" one message under the list). **Comment events** carry `commentId` and an `excerpt` (visible text of the comment, whitespace collapsed, at most 80 characters, cut at a word and ended with "..."; null for a deleted or empty comment and for other event types): the excerpt is a link that closes the drawer, opens Comments, loads older pages when needed, shows the whole thread for now (not remembered), scrolls to the comment, highlights it for 4 seconds and focuses it. **Folding rule:** 3 or more consecutive plain "Comment added" events by one person, each at most 10 minutes after the previous one, fold into `KE\kekim added 12 comments (4:03 to 4:05 PM)` with a Show/Hide control; edits, deletes, hold and cancel reasons and every other event type are never folded; "Load more" extends a fold (a fold counts the events loaded so far, a page holds 25). The tab title becomes `Activity - TSK-n title` while the drawer is open and stays pinned when it closes.

#### Drill-in, `?from=` and the way back
`?from=` names the page the task was opened from. The work lists (`my-work`, `task-queue`, `pod-work`) are as in S02 to S04; **for the Task page only** it also accepts `matter`, `project`, `dashboard` and `search` (this reverses decision T, "Dashboard lists unchanged", for the Task page only, as the PM ruled). Task links on a Matter's and a Project's Tasks grid, on the Dashboard (the Summary lists, the Swimlane card and drawer, the Users table and its drawers) and in Search (results page and Advanced Search) carry `from=<origin>` and the exact address of the page in the router state `returnTo`. The crumb names the origin ("Matter 00107-00001", "Project Alpha", "Dashboard", "Search", "My Work"), and the crumb and "Back to ..." go to the exact view (filters, tab, query) with focus on the link that was left; browser Back does the same. The return address is read once when the page opens, and only an address on the origin's own path is used (otherwise `/matters/<id>?tab=tasks`, `/projects/<id>`, `/dashboard`, `/search`). A Matter origin is the one crumb (the matter is not repeated). **An origin the person cannot use is dropped** and the page behaves as opened without `from`: Matter or Project without the View permission, a task without a project, Pod Work without `Pod.View`, the Dashboard without `Dashboard.View` plus at least one Dashboard tab permission. An unknown value is ignored. The navigation keeps Matters, Projects, Dashboard, My Work, Task Queue or Pod Work current (Search has no item). Exactly one link to the origin is visible at every width (the crumb from 640 px, "Back to ..." below it).

#### Keyboard
- **Tab order:** app shell (skip link "Skip to main content", then the navigation), then the page: crumb, matter crumb, Edit, Activity, Complete task, More actions, the matter and client links of the context line, the Status, Priority and Assignee menus, the tab strip (one stop: the selected tab; the arrows, Home and End move between the three tabs), then the selected pane (hidden panes have no stops). The count to the first Workflow step is **recorded, not gated** (33 stops at 1366 for a System Admin, 19 in the shell and 14 in the page; 27 for an assignee Data Technician, 25 without Asset.View, 12 for Task.View only; `task-permissions-t10.spec.ts` prints and annotates the number for every role, annotation `tab-stops-before-first-step`). The page has no skip link of its own.
- **Shortcuts C, A, S** (T9, #327): `C` writes a comment (**shows the Comments tab from any tab and puts the cursor in the composer**; nothing without `Task.Comment`), `A` opens the Assignee menu, `S` opens the Status menu. Only with the per-user **Keyboard shortcuts** switch on (WCAG 2.1.4), no modifier (Shift + letter is a capital), never in a field, menu, dialog or the Edit form, not while the `g` chord is pending, and nothing when the control is not on the page (no `Task.Comment`, no assign or status right). A menu button that is out of view is scrolled to first and pressed after the scroll ends (inline menus close on scroll). They are listed in the `?` help under "This page" while a task is open.
- Menus: Enter, Space or Arrow Down opens; arrows move; Esc closes and returns focus to the button. The Activity drawer, the Edit dialog and the confirm dialogs trap focus and return it to the opener.

**Concurrency.** Row-version conflict on any save shows the conflict banner "This task was changed by someone else, so your change wasn't saved." with Reload. Step updates are per-step atomic.
**States.** Loading: `mf-record-skeleton kind="task"` (the same header, six-tile strip and tab strip at today's heights, reduced motion honoured); 404 "We couldn't find that task."; 403 "You don't have access to this task."; failure "Couldn't load this task." with the error reference and Retry (shared `mf-record-state`); tab titles "Task not found", "No access to this task", "Task could not be loaded"; the generic 403/404 pages link to a page the person can open. Read-only mode for users lacking edit permissions: controls are absent, not disabled (a status action blocked by an inactive Matter is the exception: disabled with its reason).
**Permissions (the matrix is walked by `task-permissions-t10.spec.ts`).** A link exists only when its target opens for the person; a control without its permission is absent. Matter crumb and context link: `Matter.View`; Client link: `Client.View`; Assets count: `Asset.View` (the tab and its sentence stay); Link asset: `Asset.Link` + `Asset.View` + edit right; composer: `Task.Comment`; Edit: `Task.Edit`; Assignee menu: `Task.Assign`; Priority menu: `Task.SetPriority`; Status menu, Complete, Hold, Cancel, Reopen: the status permissions; the `n open` hint: `Pod.View`; origins: see Drill-in.

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

**Users page.** Three tabs: **Users**, **Roles** (the roles and permissions screen) and **Pods** (S13). The Users tab is a grid with inline column filters (Name, Windows account, First seen with presets, Email, Roles, Availability, and the **Status** column: **Pending access (N)**, **Active**, **Inactive**, **All**); it opens on Pending access when someone is waiting, otherwise Active (shown in the cell, not counted), and the filters live in the URL (`name`, `account`, `email`, `roleId`, `availability`, `registeredFrom`, `registeredTo`, `status`, `page`). First seen shows the day only (the time is the tooltip). Its nine columns are wider than the box at 1366 px, so the grid scrolls sideways there, the filters are in the Filters sheet (the row appears from about 1600 px) and the row actions (Open, Grant access) stay pinned at the right edge.
```text
Administration > Users                                   [ Users ] [ Roles ] [ Pods ]
[ filter row: Name | Windows account | First seen | Email | Roles | Availability | Status [Pending access v] ]   (3 waiting for access)
Table: Name | Windows account | First seen | Email | Roles | Pods | Availability | Status | [Open] [Grant access]
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
**Users page as built (epic #422; where this differs from the sketches above the code is right).**
- **Header and tabs.** `Administration > Users`, one description line, tabs `Users (n)`, `Roles (n)`, `Pods (n)` (quiet counts of the active records: people waiting or active, roles, active pods) and the Filters button with its count. A tab the person may not use is not offered; a tab address falls back to the first allowed tab; a person with no tab gets the 403 page.
- **Segments** `Pending access (n) | Active | Inactive | All` above the grid, `status` in the address. **Grid** (decision X.3 is superseded): Name over the Windows account (the one link), Roles, Pods (primary pod and `+n`, tooltip lists all), Availability (chip only for Out of office and Off hours; plain `Available`; nothing for Pending or Inactive people), Last seen (from 1440 px, sortable), Status, one action column. Name and Last seen sort from their headers (`sort=name`, `-lastSeen`, `aria-sort`); rows per page 25, 50 or 100 (`size`). Below 640 px: cards, and a Sort by select in the Filters sheet.
- **User drawer** (`?user=<id>`: a link opens it, Back closes it, Back from "View their tasks" reopens it). 480 px modal from 640 px, the whole window on a phone (sections fold, Access open; the footer follows the visual viewport). Header: name (two lines), account, status badge, availability chip, last seen, open tasks, `View their tasks`, Deactivate / Activate. Body: **Access** (roles with description and permission count; permissions grouped like the Roles tab, `After you save: n permissions` while the ticks differ; a System Admin warning), **Pods** (the pods popover; saves at once with Undo), **Availability** (sentence and Edit availability; its own dialog), **Profile** (name, email; account and first seen are facts). Footer: Save changes and Cancel (Close without `User.Manage`). Esc and Cancel ask first when there are unsaved edits.
- **Deactivate** is a confirm dialog: `Deactivate Alex Abbott? They can no longer sign in. This user has 7 open tasks. They stay assigned until you reassign them one by one.` with Cancel (focus), Deactivate and `View their tasks`; no number without `Task.View`. The last active System Admin message shows once, in the drawer. Activate needs no question.
- **First grant of access**: Save closes the drawer, a toast `Alex now has access (Data Technician).` offers Undo (refused if someone changed the person since), focus goes to the next row.
- **Read only**: `User.View` only sees everything read only with one reason line; `Pod.ManageMembers` can change pods and nothing else.
- **Roles tab**: member and permission counts, `Select all` / `Select none` per group, `Changed (n)` chips with one undo each, a two-row description with a counter (500). **Pods tab**: name is the link; a pod opens as a record page `Administration > Users > Pods > name` (Active badge, Deactivate pod in the overflow, Back and the crumb return to the list as it was with focus on the row; unknown pod is the not-found state; `?pod=new` needs `Pod.Manage`).
- **Reads**: `Role.Manage` alone reads roles and the permission catalog (there is no `Role.View`).

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

> Rewritten to the built code in #418 (Task Types epic #352, review `docs/ux/task-types-review/`, decisions section AF of `docs/requirements/decisions-addendum.md`). Where the old text described a feature that was never built (Validate button on the workflow, per-step settings drawer, drag handles, Open tasks on a "Versions" tab, autosave) it is gone; where the code has more than the old text (tabs with counts, health strips, phone cards, row overflow, tag filter, record headers) it is described here.

**Pages and permissions.** One Administration menu item, "Task Types", with three route-based tabs: `/admin/task-types` (Task Types, `TaskType.Manage`), `/admin/workflows` (Workflows) and `/admin/steps` (Workflow Steps), the last two with `Workflow.Manage`. Only permitted tabs show; a tab address the person may not open falls back to the first allowed tab, a create, edit, version or form address shows the 403 page (`features/admin/denial.ts`, #416; matrix in `docs/ux/task-types-review/fixes/ty10-permissions/permissions.md`). Each administration permission is enough to read what it manages, `Task.View` is not needed (open-task numbers and links are then absent). Document titles "Task Types", "Task Types - Workflows", "Task Types - Workflow Steps" and, on a record, the record's name.

**Page shell (all three tabs).** Breadcrumb `Administration > Task Types`, one-line description, tabs with the count of **active** records (Task Types, Workflows, Workflow Steps), the Filters button in the header (the filter row is open by default from 640 px; below 640 px it is a sheet), a health strip, the grid, the pager. State is in the address (filters, sort, page) and Back or the breadcrumb returns to the same list with focus on the row left (`list-return.ts`, #354). Loading is a skeleton with the table's columns, a failure is one message with Retry (no second New button), an empty result says what filtered it. The Status filter defaults to Active and the pager says "N inactive hidden" with Show all. Rows are 44 px; the name is the only link; one overflow menu per row in the last, sticky column. Below 640 px the rows are cards; optional columns drop by width.

**Task Types tab.** Columns: Name (two lines clamped, tooltip), Default workflow, Workflows (count, "No workflow" muted), Request form (Published, Draft, Retired or No form with its version), **Open tasks** (sortable, links to the Task Queue filtered `type=<id>`; absent without `Task.View`), Status (Active, Inactive, or the neutral badge **Not usable**). Optional columns drop in this order: Open tasks below 1280 px, Workflows below 1100, Request form below 900. Filters: Name, Request form, Can create tasks, Workflow. Strip: Active, Not usable, Form in draft, Inactive (client side). Row menu: Edit form, Deactivate or Activate.

**Task Type page (existing type).** `mf-record-header`: icon and name (H1 clamped, crumb cut at 40 characters), status badge (Active, Inactive or the neutral Not usable), actions Edit, Activity (`Audit.View`), the primary **Edit form**, overflow with Deactivate (confirm names the open tasks that keep the type and the workflows left without an active task type) or Activate. Summary strip: Form, Workflows, Default workflow, Open tasks (link), Status. One neutral status note under the header names each reason the type is not usable (no published workflow, no published form, inactive) with the fix as a link or button. Tabs `Overview | Workflows (n) | Request form` (`?tab=`, replaced not added; **Option A**: editing is inline and every tab saves on its own with the unsaved-changes guard).
- Overview: name (counter), description (counter), icon; no Active checkbox on an existing type (it is the header menu), the checkbox stays on create.
- Workflows: a table of the chosen workflows with a **Default** radio and Remove, and an Add workflow combobox that lists published, active workflows (draft-only and inactive ones are disabled with the reason). The first added becomes the default.
- Request form: the published state and the **Edit form** button.
- Create (`/admin/task-types/new`): the same card (720 px, one validation summary plus inline messages with focus on the first error); the Request form tab is disabled with "Save the task type first".

#### Form designer (`/admin/task-types/:id/form`, shared with Steps, Asset Types and Custom Fields)
```text
Administration > Task Types > Data Processing > Request form          Draft v4 (published: v3)
[Versions (3)]  Unsaved changes                                         [Save draft] [Publish...]
+-- Add a field --+ +-- Fields (12) ----------------------+ +-- Properties | Preview | Validation (2) --+
| Section heading | | 1 Requires OCR?    Checkbox  [^][v][x] | | Label, Key (locked after save)          |
| Text ...        | | 2 OCR language     Dropdown  [^][v][x] | | Type, Help, Required, Default, Options  |
| (13 controls)   | | 3 ...                                  | | Rules (visibility, required)           |
+-----------------+ +----------------------------------------+ +-----------------------------------------+
```
- A fixed-height page (`mf-fixed-page`): the header and the sticky action bar stay; Add a field (13 rem), Fields and the details column each scroll inside themselves and become named, focusable scroll regions only while they overflow. Below 768 x 561 the page scrolls and the bar sticks. No page-level scroll at 1366 and 1920 with 45 long-labelled fields.
- **Controls (no File Upload, addendum C):** single-line text, multi-line text, number, checkbox, single-select dropdown, radio group, multi-select, date, datetime, URL, Asset reference, User reference, section heading and help text.
- **Reordering and removal:** Up, Down and Remove buttons on each row. There is no drag and drop, no Alt+Arrow and no Undo on Remove in the designer (#411 was decided not planned: no new or changed shortcuts in this phase, #420). Field keys are an auto-slug of the label until the first save and then locked; option ids are stable.
- **Properties, Preview and Validation are tabs of the details column** (WAI-ARIA tabs, automatic activation, one Tab stop, Left and Right with wrap, Home and End). "Validation (2)" carries the live error count. Choosing a field opens Properties. All three panels stay in the page, so the Preview keeps its answers.
- **Rules builder** (structured, no scripting): visibility and required rules with operators by type, ALL or ANY groups, one nesting level, a plain-language summary. Circular chains and references to missing fields are errors; deleting or renaming a field that a rule uses is blocked with the list of dependents.
- **Preview** renders the same form as Create Task. **Validation** lists errors (block publish: duplicate keys, dropdown without options, missing rule reference, circular dependency, invalid pattern) and click-to-focus. **Publish... never sits disabled without a reason:** with errors it opens the Validation tab, focuses it and says "Fix 2 errors before publishing. They are listed under Validation."; the same happens when the server reports publish problems.
- **Publish dialog** (`publishCopy`): "Publish v4", the list of changes (its own scroll region when long), the impact line "Tasks already running keep v3. New tasks use v4.", buttons "Publish v4" and "Back to draft". Retire (in the Versions dialog): "Retire v3?", "Keep published".
- **Versions** is a dialog opened from the bar (version, state, who, when). Published and retired versions are immutable; the edit path is Create new draft, or Open draft vN when one exists.
- **Read-only versions** show the Fields list and the Preview side by side (no palette, Preview selected, Properties one tab away with disabled controls). The title carries a badge: "Published v3" (green), "Draft v4" (amber), "Retired v2" (neutral), and "(published: v3)" as muted text while a draft exists.
- **Narrow layout (below 1100 px):** the Fields come first (at 375 px the first field is in the first screen); one Add field button opens the palette as a bottom sheet (a native modal dialog: focus trapped, Escape and Close return focus to the button); choosing a control adds the field and the sheet becomes its properties with the Label focused; Preview and Validation (n) are buttons beside Add field that open the same sheet.
- Unsaved-changes guard on leaving; autosave is off; "Save draft" is explicit; two admins on one draft get the conflict dialog.
- **Permissions:** `TaskType.Manage` for a task type's form (Steps: `Workflow.Manage`, Asset Types: `AssetType.Manage`, Custom Fields: `CustomField.Manage`).

---

### S15 Admin: Workflow Steps (step library)

The step library is the third tab of the Task Types page (`/admin/steps`, `Workflow.Manage`). The model reads left to right: a Task Type has eligible Workflows (one default), a Workflow is built from Steps of this shared library.

**List.** Columns: Title (the spring, two lines clamped), Description (from 1600 px, one clipped line), Tags (two chips then "+n more", from 1180 px), Inputs (none, published, draft; from 1024 px), **Used in** (the number is the link, `aria-label` "Used in 5 workflows", "Not used" when none; sortable), Status. Strip: Active, Not used, Inputs in draft (a plain count, there is no API filter for it), Inactive. Filters: Title, Description, **Tags** (a button under the Tags header opens a panel of the existing tags with counts, a find box above eight tags; chosen tags are removable chips), Tag match (**Match all tags** by default, Match any tag; idle until a tag is chosen), Used in (Any, Used in a workflow, Not used), Status. The address holds `title`, `description`, `tags` (repeated), `tagMatch=any`, `used`, `status`, `sort`, `page`. The Used in link opens the Workflows tab filtered by the step (`?step=:id`, chip "Step: X", line "Filtered by step X"). Row menu: Edit inputs, Deactivate or Activate. Phone cards below 640 px.

**Step page (existing step).** `mf-record-header` kind `step`: the step title is the H1 with an Active or Inactive badge; Edit, Activity (`Audit.View`), the primary **Edit inputs**, overflow with Deactivate (the confirm says how many workflow drafts contain the step and that published versions are not changed) or Activate. Summary strip: Status, Used in workflows (n or "Not used"), Inputs (None, `n inputs`, `Draft, n inputs`, `n inputs, newer draft`), Tags. Tabs `Details | Inputs | Used by (n)` (`?tab=` replaced). Details is the only tab with edits and saves on its own: title (unique among active steps), description, tags, instructions, documentation URL. Inputs shows the field list read-only with its status and the Edit inputs button (the shared designer, S14). Used by lists workflow versions as links. On create, Inputs and Used by are disabled with "Save the step first", and a saved new step opens on Inputs.
- **Tags.** Free-form. Type and press Enter or comma (leaving the box also commits), Backspace on an empty box removes the last chip, every chip has "Remove tag X", existing tags are suggested (a combobox with a listbox; free text is always allowed), a polite live region announces additions and removals. Trimmed, inner whitespace collapsed, at most 40 characters per tag, at most 20 per step, no control characters, case-insensitive uniqueness per step (the first spelling wins; an existing tag keeps its stored spelling across steps). Editing tags never changes a published workflow version and is audited (field `Tags`).
- One muted sentence on edit: "Editing this step doesn't change workflows that are already published. Workflows pick up changes only when you add the updated step to a new workflow version." (addendum A.) Inputs are operational values recorded on the task, not staff or billing metrics.
- Deactivating hides the step from new workflow drafts and changes no published version; a used step is never deleted.

---

### S16 Admin: Workflows, the Workflow page and the Version editor

**Workflows tab.** Columns: Name, Versions (Published, Draft in progress, Not published; the Draft badge links to the draft, **Not published is neutral**), Steps, Task types (count of active ones, links to the Task Types tab filtered `?workflow=:id`; below 1100 px it drops), Last published (below 1280 it drops), Status. Strip: Published, Draft in progress, Not published, Inactive (API `summary`). Filters: Name, Versions, Task type, Step, Status. Row menu: Open draft vN (when one exists), Deactivate or Activate.

**Workflow page (existing workflow).** `mf-record-header` kind `workflow`: name, Active badge, and on their own line Published vN or Not published and Draft vN in progress (neutral and amber, never red); Edit, Activity, one primary (**Open draft vN** when a draft exists, else **Create new draft** from the published version, never both), overflow with Deactivate (the confirm names the task types that lose the workflow and the open tasks that keep running on it) or Activate. Summary strip: Published, Draft, Steps, Task types, Open tasks of the published version (a Task Queue link only when every open task runs on that version). Tabs `Overview | Versions (n) | Task types (n)`: Versions is a table with Created, By, Tasks (open), a link to the version and a row overflow (Retire); Task types shows which active task types use the workflow.

**Version editor (`/admin/workflows/:id/versions/:versionId`).** A fixed-height page like the form designer: header, tabs `Steps (n) | Used by (n)` (`?tab=used-by`; there is no Versions tab, the list lives on the Workflow page) and a sticky action bar: Publish..., Save draft, Unsaved changes, an inline **execution mode** control (Ordered: steps must be resolved in sequence, Unordered: any order; changing it asks `changeMode`), and an overflow with Discard draft. The version switcher is a text menu button ("v3 Draft") under the title: every version newest first, "(current)" for the published one.
```text
Administration > Task Types > Workflows > Standard Processing > v3            [Publish...] [Save draft] [...]
Steps (4) | Used by (2)                         Mode: Ordered v
+-- Step library (pane from 1280 px, drawer from "Add step" below) -+  +-- Steps (this version) -----------------+
| search, tag filter, [+ Add]                                        |  | 1 Intake QC          Required        [...]  |
+--------------------------------------------------------------------+  | 2 Load to Relativity Skippable - comment [...] |
```
- A step is a 44 px row: number, one-line title (two lines cut, tooltip), one rule badge (Required, Skippable, Skippable - comment) and an overflow with Move up, Move down, Skip rules (a popover: Skippable, comment required on skip, disabled unless skippable), Preview inputs and Remove (with the shared Undo toast). Two Tab stops per row. Reordering is by those buttons or by **Alt+Up / Alt+Down** on any control of a row (existing, unchanged, announced in a live region). No drag handle, no assignee, approver or approval controls, **no Validate button and no per-step settings drawer**: the checks run on Save and Publish and the server's messages are shown.
- The library lists active steps only with their tags, searches title and tag text, has the Tags filter and says "first 50 of N". The drawer stays open for several adds and counts them ("3 added").
- Steps come first at every width (at 375 and 768 px the first step is in the first screen).
- **Publish dialog** (`publishCopy`, `impactLine('publishVersion')`): "Publish v3", the changes against the previous published version (added, removed, reordered, skip rules and mode changed; pure position shifts fold into one line such as "13 steps moved"), long step titles wrap, "Tasks already running keep v2 (14 open). New tasks use v3.", buttons "Publish v3" and "Back to draft". The list of changes is a named scroll region.
- **Read-only versions** (Published, Retired) show one neutral note with the link to the draft and **Open draft vN** (or Create new draft) instead of a disabled button. **Retire** (`retireCopy`): "Retire v2?", impact "A and 3 other task types have no other published workflow. 14 open tasks keep running on v2. New tasks cannot use it.", buttons "Retire v2" and "Keep published". Publishing snapshots the step definitions, so later library edits never change it; published versions are immutable.
- Leaving a dirty draft offers Save draft and leave. A conflict (the draft changed elsewhere) shows the `conflict` dialog.
- After publish, retire, deactivate or discard: focus goes to the status badge (the heading when the row is gone), a live region says the result, and a failure stays in the dialog as an alert and keeps focus on its button (`after-action.ts`, #414).
- Needs `Workflow.Manage`; `GET .../versions/{id}` also accepts `Task.View` for published versions (counts are then null).

---

### S17 Admin: Asset Types and Link Roles

> Rewritten to the built code in #662 (Administration pages epic #518, review `docs/ux/admin-pages-review/`, decisions section Y). The inline asset-type form, the Order column and the "Task link labels" list of the first spec are gone.

**Page.** `Administration > Asset Types` (heading and sidebar item "Asset Types"), `AssetType.Manage` (Asset Types and Link Roles tabs). Tabs `Asset Types (n)` and `Link Roles (n)` with active counts (`?tab=link-roles`), Filters and New asset type in the header, a strip (Active, No published fields, Inactive), the grid contract (44 px rows, one name link, one row menu, hidden-count line, cards below 640 px).
- **Asset Types list.** Name, Fields (`8 fields`), Assets (a plain number, only with `Asset.View`), Status. Row menu: Edit, Edit fields, History (`Audit.View`), Move up and Move down (swap the sort order with the shown neighbour; no drag), Deactivate (impact line) or Activate. Asset types are never deleted.
- **Asset Type page** (`/admin/asset-types/new`, `/:id`): record header (icon, name, Active badge, Edit, Activity, primary Edit fields, overflow Deactivate), tabs `Overview | Fields (n) | Assets (n)`, the 720 px form card with validation summary, footer only while dirty, unsaved-changes guard with Save and leave. A new type has no Active checkbox. The Fields tab opens the shared form designer (S14; crumb `Administration > Asset Types > <name> > Fields`, Back focuses the row). Field changes apply to future edits; values of removed fields are kept but hidden.
- **Link Roles tab.** The roles tasks use to link assets: Order, Name (clamped, tooltip), Links, Status and one menu: Rename (a dialog with a 50-character counter and the duplicate-name message), Move up, Move down, Deactivate ("n links keep this role") or Activate, Delete only when the page knows the count is 0 (refused deletes show one inline sentence). The pointer drag stays; no inline rename and no Active checkbox. `?tab=link-roles&edit=<id>|new`.

---

### S18 Admin: Labels (Priorities, Status labels) and Custom Fields

**Labels** (`Administration > Labels`, one route with a tab segment). Tabs `Priorities (n)` and `Status labels (n)`; a person with only `Priority.Manage` or only `StatusLabel.Manage` sees no tab strip and the menu item opens the allowed tab. Both lists read with their own `*.Manage` permission (`Task.View` is not needed; open-task numbers are then absent and the columns hidden).
- **Priorities.** Name with its badge, colour, Default, Open tasks (links to the Task Queue filtered by the priority), Status, one menu: Rename and recolour (a dialog with live badge preview and the 4.5:1 contrast check), Make default (one-line confirm), Move up, Move down (the pointer drag stays), Deactivate or Activate, Delete only when unused. The default priority can be neither deactivated nor deleted and says why in a visible sentence. Deactivated priorities still display on existing tasks.
- **Status labels.** The five fixed statuses (`NEW`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `CANCELLED`; codes read-only), an editable display label with live badge preview (a rename dialog) and the number of tasks in each. No add or remove.

**Custom Fields** (`Administration > Custom Fields`, `CustomField.Manage`). A list of **three** objects that carry custom fields: Client, Matter, Project (there are no Task or Asset tabs: task fields live in Task Type forms, asset fields in Asset Type forms). Columns: Object (the one link), Fields (`8 fields, 2 required`), Published (`v2 - Oct 12`, publisher as tooltip), Form badge, one menu (Edit fields, History with `Audit.View`); cards below 640 px. Viewing creates nothing; the designer provisions the form on the first Edit fields. The designer is `Administration > Custom Fields > Matter`, titled "Matter custom fields".

---

### S19 Admin: Audit Logs

`Administration > Audit Logs` (`Audit.View`), on the admin list shell: heading, "Every recorded change, newest first. Read only.", Filters with a count and the one Clear in the header (the filter row is open from 640 px), four quick views, the loaded count with the "1,000 loaded" hint, a grid with day dividers (`Today`, `Oct 19`) and the time alone in When (the firm time zone is the When tooltip), cards below 640 px.
- Columns: When, Who (from the loaded events when the viewer lacks `User.View`), Object, Event (friendly names), Details. Filters: date range, actor, object type (comma list), object, event type.
- Configuration objects are named by the API (`object.label` for asset types, priorities, status labels, link roles, roles and form definitions; a deleted record keeps its last stored name). Object links exist only when the viewer holds the target's View or Manage permission (asset type record, Labels tabs, Link Roles tab, Roles, Pods, task type, workflow, step, task); otherwise plain text.
- Row details: a sentence, the Old -> New pair, Show full, a "Technical details" disclosure and "Show only this operation" (focus ends on the chip). Read only, append only, no export (addendum F), no read-access log. No virtualization (measured fine at 3,000 events).
- `Audit.View` alone opens the page; it does not need `Task.View`.

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

### S23 My profile: availability and work hours (epic #68, issues #70 and #74)

**Purpose.** Each person tells colleagues when they are out of office and when they usually work. It feeds the availability chip on the Users administration screen, the flag in assignee menus and pickers, the Swimlane card dot and the Dashboard Users tiles. Operational capacity only: it never ranks or rates anyone, and "Off hours" is information, never "unavailable" (work can still be assigned).
**Who.** Anyone with `Task.View` edits their own profile (`GET/PUT /api/v1/me/availability`); `User.Manage` also edits another person from Administration > Users ("Edit availability of <name>", the same form in a dialog). A person without `User.Manage` has no such button and the API answers 403; a read-only user can still edit their own availability. Route `/profile`, title "My profile - MatterFlow", H1 with its own icon.
**Header account menu.** The user area is a menu button (`aria-haspopup="menu"`; Enter, Space or Arrow Down opens; arrows, Home and End move; Esc closes and returns focus to the button; Tab closes). Items: My profile, "Set out of office..." (or "I'm back" while out of office), Keyboard shortcuts. While out of office the button carries "Out of office until ..." under the name (the name only, icon-only on a phone). "Set out of office..." opens a small dialog (Until optional, Note optional, plain-language sentence); Cancel, Esc and Save return focus to the menu button.
**Layout.** Page header, a status preview ("Your current status: Available / Off hours / Out of office until Oct 20"; the API's evaluation when nothing is edited, a client preview of the draft otherwise), Status (radios Available / Out of office; Out of office adds From and Until with the shared date input, a note of 200 characters with a counter, and the sentence "You will show as out of office from Oct 16 until Oct 20 and as available again on Oct 21."), Work hours (Monday to Sunday: working-day checkbox with start and end time; "Copy Monday to all weekdays"; "Reset to Mon-Fri 9:00 AM-5:00 PM"), Time zone (type-ahead of IANA ids, the browser zone preselected for a person who never chose one), and a sticky action bar (Save changes, Discard changes). One column up to about 640 px wide from 1024 px; full width on a phone.
**States and rules.** Live validation per field plus an error summary after Save (focused; each link moves to its field and is a 24 px target); server codes `OOO_RANGE_INVALID`, `NOTE_TOO_LONG`, `TIMEZONE_UNKNOWN`, `WORK_HOURS_INVALID` land in the same places; a 409 reloads the latest values and says the edits were not saved. An unchanged default week is saved as `workHours: null`; no working days is `[]`. Out of office covers whole local days From..Until in the person's own zone; without dates it lasts until the person sets Available. "Leave without saving?" guards the route and the dialog.
**Keyboard.** Status radios, From/Until with their calendar buttons, Note, then per working day: checkbox, start time, end time (each native time field is several tab stops: hour, minute, AM/PM), the two helper buttons, Time zone, Save, Discard. The error summary takes focus on a failed Save.
**Users administration.** An Availability column (chip: Available, Off hours, Out of office until ...), an Availability filter (All, Available, Out of office, Off hours; `GET /users?availability=`), "Edit availability" with `User.Manage`; below about 1100 px the list scrolls sideways and says "Scroll sideways to see every column." Screens: `docs/ux/profile-availability/` and `docs/ux/review-round-5.md`.

### S24 My Matters (epic #667; review `docs/ux/pm-review/`, API `docs/ux/pm-review/my-matters-api.md`)

**Purpose.** The Project Manager's home: what needs attention on the matters they manage, as a Primary or a Secondary manager (identical rights). It is a default view, never access control: `Matter.View` still shows every matter. No status report, Gantt, time or budget, email, and no new or changed keyboard shortcut (#420).
**Who and route.** `/my-matters`, menu item "My Matters" above "My Work" for holders of `Matter.BeManager` **and** `Matter.View` **and** `Task.View` (the menu item, the route guard and the landing rule use the same three permissions; without them the item is hidden and the address shows the 403 page with no request and no toast). Landing: these three permissions put a person here, except the System Admin, who keeps the previous landing and can still open the page from the menu. The API (`/api/v1/my-matters/*`) needs `Task.View` and `Matter.BeManager` or `Matter.AssignManagers`.
**Layout (1366 px, one scroll, no tabs).** Header "My Matters"; filters Client, Role (Both, Primary, Secondary) and Dates (Today, Next 2 weeks, Next 4 weeks default, Custom), kept in the address (`?clientId=&role=&range=&from=&to=`) and restored by Back; with `Matter.AssignManagers` also a scope switch "My matters / All matters" (`scope=all`), a Project manager filter, and a "Set project managers" link that opens the Matters list in selection mode. Then the **count strip** (Matters I manage, Open tasks, Overdue, Due in 3 days, Due in 7 days, Unassigned, On hold with the oldest hold age; each cell is a link to the list whose total equals the cell, 3 is inside 7 and they are never summed), then the panels in reading order: **Needs my attention** (Overdue, Due soon, Unassigned, Stuck on hold over 7 days; ten rows per group and "View all"), **Matter health** (Client, Matter, Open, Overdue, Due this week, Unassigned, % workflow complete, Next deadline, Flag, "+ New task"), **Upcoming deadlines** (2 or 4 weeks, by day, 25 rows), **Workload and capacity** (pod, then person, alphabetical, never ranked, out-of-office chip), **Recent activity** (7 days, 30 rows, "Show more", unread marker, "Mark all as read").
**Rules.** Flag: Red = an open task is overdue; Amber = none overdue but one is unassigned, due within 3 days or on hold longer than 7 days; Green otherwise (no open tasks is Green); the word comes first and colour second, "How is this decided?" states the rule, and the flag never ranks matters or people. % workflow complete = steps done or skipped over all steps of the matter's open tasks. **A matter without a manager is normal: it is never flagged, listed as a problem or counted** (in the All scope it is an ordinary row; "No project manager" exists only as a plain filter option on the Matters list). Activity shows structured facts only (comment text is never shown); the unread marker moves only with "Mark all as read" or by opening an event, and the first visit has nothing unread. Bulk re-assign and re-prioritise live on the matter's Tasks tab (Select mode, at most 100 tasks, a result list, no undo), not on this page.
**Manager fields elsewhere.** Matters list: "Project manager" (Primary) and "Secondary" columns with inline filters (the Secondary leaves below 1440 px, the Primary below 900 px), a "Mine" quick filter, `?managerId=`, a "No project manager" filter option and, with `Matter.AssignManagers`, a bulk "Set project managers". Matter header: "Project manager: <Primary>, <Secondary>" (nothing when none is set and the viewer cannot assign) and a Change dialog with `Matter.AssignManagers`; out-of-office people are marked but can be chosen; a person who lost the role stays on the matter.
**States.** Each panel loads and fails on its own with Retry. A manager with no matters sees "You are not the project manager of any matter yet." with a link to My Work (and "Show all matters" with `Matter.AssignManagers`), in a calm tone and with no count of unmanaged matters.
**Phone and tablet.** At 375 px one "Filters (n)" button opens a sheet, the strip is one scrolling chip row, health rows are cards with a 44 px "+ New task", Workload and Recent activity show five lines then "Show all"; at 768 px the lower panels use two columns. No sideways page scroll and axe 0 at 1366x768, 1920x1080, 768x1024 and 375x812.
**Keyboard.** Existing keys only: Tab order is scope, Client, Role, Dates, the seven counts, panel links, sort buttons, rows; Enter and Space activate; focus returns to the row after Back and to the trigger after menus and dialogs.

---

### S25 Notifications: bell, panel, page and profile switches (epic #753; review `docs/ux/notifications-review/`, decisions section AH)

In-app only: no email, Teams, browser push, sound, toast or tab-title count in this release. Everything needs `Task.View` (the bell is absent without it; `/notifications` shows the 403 page with no request). No keyboard shortcut was added (#420).

**Bell.** In the header next to the user menu (`shared/layout/notification-bell.ts`, loaded lazily after the shell is idle so the initial bundle does not grow). Accessible name "Notifications" or "Notifications, 3 unread"; a badge shows the unread count ("99+" above 99). The client polls `GET /me/notifications/poll?sinceId=` every 30 seconds with jitter (ETag and 304), pauses while the tab is hidden or the shell is offline, and never toasts an error. Items found after the first poll are announced in a polite live region: "New notification: <message>" or "3 new notifications. Latest: <message>".

**Panel.** A non-modal dialog under the bell (a bottom sheet below 640 px): heading "Notifications" (focus goes there on open; Esc and Close return focus to the bell), "Mark all as read" (only when something is unread), the ten newest items (unread dot, bold text and a hidden "Unread:" prefix; message at most two lines; relative time "5 min ago", "1 h ago", "yesterday", "Oct 18" with the absolute time as tooltip), "View all notifications". Choosing an item marks it read and opens the task or the matter, then the panel closes. Empty: "You're all caught up." and "New notifications appear here." Failure: "Couldn't load notifications." with Retry, no toast.

**Page `/notifications`.** Header (icon, H1 "Notifications", the line "Your recent notifications. Read ones are removed after about 90 days.", Mark all as read), a toggle group All and Unread (n) with `aria-pressed`, rows that are links (44 px; cards below 640 px), page size and pager (Previous and Next on a phone). The address holds `?filter=unread&page=2&pageSize=50`. Items about objects the person can no longer view are not listed or counted. Empty: "No notifications yet." or "No unread notifications." with Show all.

**My profile, "Notifications".** One switch per event type, all on by default, grouped Technician, Project manager and Pod Lead; groups for a role the person does not hold are folded under "Other events" so no switch is out of reach. A switch saves at once with a polite "Saved." and reverts with an inline message on failure. Turning a switch off stops future items; existing ones stay; turning it on does not backfill.

**Events and message wording (server-written snapshots, English, at most 200 characters, titles trimmed at 60; the link is built by the client from kind and id).**

| # | Event | Recipient | Message |
|---|---|---|---|
| 1 | Task assigned | New assignee | `Assigned to you - TSK-1042 "Review privilege log" on Acme v. Smith` (`Reassigned to you` when the task had another assignee) |
| 2a | Due soon | Assignee | `Due tomorrow - TSK-1042 "Review privilege log" on Acme v. Smith` / `Due today - ...` |
| 2b | Overdue | Assignee | `Overdue by 3 days - TSK-1042 "Review privilege log" on Acme v. Smith` (`Overdue by 1 day`; `Overdue` when it became overdue today by its time) |
| 3 | Comment | Assignee | `New comment from Ann Lee - TSK-1042 "Review privilege log" on Acme v. Smith` (the comment text is not repeated) |
| 3m | Mention | Mentioned person | Deferred by the owner (#737); the event type exists, nothing creates it |
| 4 | Matter task overdue | Primary and Secondary manager | `Overdue by 3 days - TSK-1042 "Review privilege log" on Acme v. Smith` |
| 5 | Task created on my matter | Manager | `New task on your matter - TSK-1051 "Load production volume 3" on Acme v. Smith` |
| 6a | Unassigned 2 days | Manager | `Unassigned for 2 days - TSK-1042 "Review privilege log" on Acme v. Smith` |
| 6b | On hold 5 days | Manager | `On hold for 5 days - TSK-1042 "Review privilege log" on Acme v. Smith` |
| 7 | Set as manager | The person | `You are now Primary manager - Acme v. Smith` (or Secondary) |
| 8 | Unassigned in my pod | Pod Lead | `Unassigned in Demo Processing Pod - TSK-1042 "Review privilege log" on Acme v. Smith` |

Rules: never the person who made the change; only people who may view the object now (checked again on read); one notification per person per action (the lower priority number wins, so a manager who is the assignee gets event 1); no scheduled event for a task without a due date, a closed task, or one fixed before the scheduler ran; scheduled events are made by the 5-minute background job (runbook 6.1) and are idempotent by the unique key of `dbo.Notification`; read items are deleted after 90 days and any item after 365 days. Pod Leads are the pod members who hold the active role named "Pod Lead".

---

## 7. Component inventory (reusable Angular components)

Prefix `mf-`. Standalone components, OnPush, signals-friendly inputs, a11y built in. Presentational components take inputs/outputs; data fetching lives in feature containers. The underlying component library is chosen in the architecture doc; these wrap it so screens stay library-agnostic.

| Component | Purpose | Key inputs / outputs | Used in |
|---|---|---|---|
| `mf-app-shell` | Header, left nav, banners, skip link, router outlet | `navItems`, permissions | all |
| `mf-global-search` | Header combobox typeahead (number-aware) | `query`, `(select)`, `(viewAll)` | header, S11/S20 |
| `mf-page-header` | Breadcrumb, H1, action slot | `title`, `crumbs[]` | all |
| `mf-record-header` | Header of a Client, Matter or Project: crumb (last step cut at 40 characters), title at H2, badges, context line, Sensitive note, action buttons and the overflow; actions are data (`RecordAction`: `role` edit, activity, primary, secondary, state); skeleton mode draws the same boxes | `kind`, `parents[]`, `current`, `ref`, `name`, `actions[]`, `skeleton` | S05-S07 (5.9), S09, S10 |
| `mf-task-facts` | The six-tile facts strip of the Task page (Status, Priority, Due, Assignee menus as `mf-row-edit`, Pod, workflow progress); focus to the Status button after an action | store | S10 |
| `mf-task-status-note` | The one neutral note for On hold, Completed and Cancelled (when, who, reason, Show more) | store | S10 |
| `mf-tabs` on the Task page | The shared tab strip, `dense`, with counts (`Workflow (2/3)`, `Assets (n)`, `Comments (n)`), `?tab=` in the address (replaced, not added) | `tabs[]`, `selected`, `dense`, `(tabChange)` | S10 |
| `mf-request-section` | Collapsible "Request details (type, form n) n fields", open at 6 fields or fewer, remembered per type | `heading`, `count`, `open` | S10 details, Edit dialog |
| `mf-clamped-rich` | Rich text cut at 12 lines with Show more / Show less only when it overflows | `html`, `format` | S10 description |
| `mf-task-edit-dialog` / `mf-title-area` | The Edit dialog (720 px, sticky footer, three sections) / 2 to 4 line title box with `n / 200` counter | `definition` / `maxLength`, `value` | S10, S09 |
| `mf-action-menu` | The "..." ARIA menu button of a record header; disabled entries keep focus and show their reason | `items[]`, `label` | record header |
| `mf-record-skeleton` / `mf-record-state` | Loading page (real crumb and tab labels with `--`, five 44 px rows) / 404, 403 and failure page with the error reference and Retry | `kind`, `activeTab` / `kind`, `state` | S05-S07 |
| `mf-tabs` | Tab list with roving tabindex, counts (`Matters, 63` as the accessible name), edge fade and chevron, selected tab scrolled into view | `tabs[]`, `selected`, `(tabChange)` | record pages, admin |
| `mf-work-strip` (link and toggle modes) / `mf-summary-strip` | Needs-attention strip; in link mode each item is a link (record Overview), in toggle mode a pressed `view` (Matter and Project Tasks; Pod Work's four toggles, with the opt-in `chipRow` for a scrolling chip row below 640 px); `mf-summary-strip` loads a matter or project summary and maps it with `recordStripItems()` | `items[]`, `kind`, `id`, `active`, `(pick)` | My Work, Pod Work, S05-S07 |
| `mf-pod-picker-list` / `mf-pod-work-strip` / `mf-pod-member-table` | Pod Work parts (`features/pod-work/ui`, epic #546): the list of pods with counts when no pod is chosen; the four-toggle strip (Overdue, Due today, ASAP, On hold) on `mf-work-strip` with its `chipRow` input; the By member workload table (Unassigned row, folded idle members, availability chip, neutral bar, sortable headings, cards below 640 px) | `pods[]`, `(chosen)` / `summary`, `active`, `(pick)` / `loads[]`, `unassigned`, `selected[]`, `(memberToggle)`, `(showUnassigned)` | S04 |
| `mf-client-overview` / `mf-matter-projects` | The Client Overview tab / the Matter Projects tab (Active first, collapsed Archived group, natural sort) | `client` / `matterId`, `projects[]` | S05, S06 |
| `mf-task-count` | One Open tasks or Overdue cell or card count; links to the Task Queue above 0; the overdue style | `kind`, `scope`, `recordId`, `count`, `word` | S05-S07 lists |
| `mf-record-card-list` / `mf-record-card` | Phone cards (below 640 px) with the table's states; the name is the one link | `noun`, `state`, `empty`, `filtered` | S05-S07 lists |
| `mf-data-table` | Server-paged sortable table with column chooser, density, skeleton/empty/error | `columns`, `rows`, `sort`, `page`, `state` | S02-S04, lists |
| `mf-filters-bar` / `mf-column-filter-row` / `mf-filter-chips` / `mf-filter-sheet` (shared/filters) | Inline column filters generated from one `FilterDef[]` with URL state (`ListFilters`); see docs/ux/column-filters/README.md | `filters`, `columns`, `controls` | Every filtered grid (the 18 surfaces of 5.2, epic #75) |
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

**Record pages and lists (epic #245).** Records are "New X" in sentence case with no leading "+" in the label: New client, New matter, New project, New asset (never "Create matter", "Create client" or "New Matter"); a task is "Create task". Header: Edit, Activity, Set inactive, Set active, Archive, Restore; the overflow is named "More actions". Lists: Filters, Clear filters, Show all (the hidden-records hint), Retry; skip links "Skip to table" and "Skip to task list"; phone: "Back to Clients", "Back to Matters", "Back to Projects"; Overview: "View all 4 matters".

### 8.2 Tooltips and helper text
| Context | Text |
|---|---|
| ASAP | "No due date set. Handle promptly." |
| ASAP column help | "ASAP tasks have no deadline and are never overdue." |
| Default sort | "Default order: Priority, then ASAP first, then due date, then oldest." (the info button of the footer note "Sorted by Priority (default order)") |
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
| Chip text (all work lists) | One rule: no label that repeats its value. Tri-state chips read "Overdue only", "Not overdue", "ASAP only", "Has a due date"; other chips keep "Priority: Critical". |
| Restored notice, Task Queue | "Restored your last view: Overdue." when the filters are a quick view; otherwise the filters in chip words ("Restored your last view: Status Open, Priority Critical."). |
| Task Queue empty, Unassigned | "Every open task has an owner." |
| Task Queue empty, Overdue | "Nothing is overdue." |
| Task Queue empty, Due soon | "Nothing is due in the next 2 days." |
| Task Queue empty, ASAP / On hold | "No ASAP tasks." / "Nothing is on hold." |
| Task Queue empty, My pod | "Your pod has no open tasks." |
| Task Queue empty, Recently completed | "Nothing was completed in the last 30 days." |
| Task Queue empty, Created by me | "You have no open tasks you created." with Create task (Task.Create). |
| Task Queue empty, other filters | "No tasks match these filters." with Clear filters (also a view plus extra filters). |
| Task Queue empty, no tasks | "No tasks yet." with Create task (Task.Create only). |
| Task Queue title, caption | "Task Queue: Overdue" (browser title "Task Queue: Overdue - MatterFlow"); "Task Queue" with no quick view or on All open. |
| Work list live region | One message per change, view first: "Overdue: 101 tasks, showing 1 to 50"; "101 tasks, showing 1 to 50"; "Closed: 1 task"; "No tasks". My Work and Pod Work lead with the tab ("Active: 7 tasks, showing 1 to 7"). With more than one page: "442 tasks, page 3 of 9, showing 101 to 150". Loading: "Loading tasks". Failure: "Couldn't load tasks." |
| Due cell (4.6) | Line 2 words: "Overdue 6h", "Overdue 4d", "Due today", "Tomorrow", "In 2 days" (never "Due soon" and never a capped "Overdue 9w"); ASAP; a closed task shows only its muted date or "-". No zone abbreviation in the cell; the tooltip of a timed due has it ("Oct 17, 2026, 6:00 AM EDT"). |
| Toolbar buttons | "Columns", "Other filters" (not "More filters"), "Filters (3)", "Reset sort", "Clear filters", "Reset to default", "Dismiss", "Open in Task Queue" (My Work). The overflow menu of the Quick views is "More"; its panel is named "More views". |
| Quick view buttons | Name and count ("Overdue 101"), accessible name "Overdue, 101 tasks"; `--` while the counts load. Tooltips: All open "Tasks that are New, In Progress or On Hold"; Unassigned "Open tasks nobody is assigned to"; Overdue "Open tasks whose due date or time has passed"; Due soon "Open tasks due today, tomorrow or in 2 days; not overdue, not ASAP"; ASAP "Open tasks marked ASAP"; On hold "Tasks that are on hold"; My pod "Tasks assigned to your pod"; Created by me "Open tasks you created"; Recently completed "Completed in the last 30 days (cancelled tasks are not included)". |
| Pager | "Showing 101-150 of 442", "Rows per page", First, Previous, "Page 3 of 9", Next, Last; on a phone Previous, "Page n of m", Next. |
| Filter boxes | The placeholder is the column name ("Matter", "Assignee"); the Title and Ref box says "Title or ref"; select-like controls say "All" or "Any". |
| Column widths (Columns panel, column menu) | Section "Column widths"; "Widen", "Narrow", "Fit to content" (panel: "Fit"), "Reset width", "Hide column"; disabled Fit of the Title says "Fills the space left"; footer "Reset all widths" and "Reset columns"; handle tooltip "Double-click to fit the rows on this page"; polite messages "Due column 144 pixels" and "All column widths reset to the default." |
| Closed instead of Due | "Showing finished tasks: show Closed instead of Due" with "Show Closed", "Restore Due" and "Dismiss"; the view note "Recently completed shows Closed instead of Due." |
| Columns notice | "The client and matter line under task titles is gone. Matter Number shows the reference and Matter Name has its own column. Client is in Columns." with "Add Matter Number column" (Task Queue and Pod Work, when the user had removed Matter) and "Dismiss". |
| Assign to me | First item of the Assignee menu and the link-button in an unassigned Pod Work row; toast "Assigned to you." with Undo. |

**Record pages (epic #245).**
| Context | Text |
|---|---|
| New matter, inactive client | "This client is inactive. Set it active to add matters." (tooltip and screen-reader text of the disabled button; visible in the Overview's empty state) |
| Create task, inactive matter / archived project | "This matter is inactive. New tasks can't be created." / "This project is archived. New tasks can't select it." |
| Set inactive, open tasks | "This matter has 3 tasks that aren't Completed or Cancelled. Finish or cancel them first." (shown under the disabled menu item) |
| Client Overview | Section "Matters with the most open tasks" ("Matters" without `Task.View`); "View all 4 matters" (singular "View all 1 matter"); "No matters yet."; "No matter has open tasks."; muted "Created Oct 3, 2026 - Last changed Oct 9, 2026"; "Couldn't load the task numbers." |
| Matter Overview | Sensitive value "Sensitive" badge with the muted "Warning only"; Sensitive note "Sensitive matter. Handle its tasks and assets with extra care. This flag is a warning only and does not restrict who can see them." |
| Strip item tooltips | Open "Tasks that are New, In Progress or On Hold"; Overdue "Open tasks whose due date or time has passed"; Due soon "Open tasks due today, tomorrow or in 2 days; not overdue, not ASAP"; ASAP "Open tasks marked ASAP"; On hold "Tasks that are on hold" (the Task Queue's words) |
| Count cell | Accessible name and tooltip "14 open tasks in Acme Corp", "3 overdue tasks in Acme Corp"; a zero Overdue is an en dash with the hidden words "0 overdue tasks in ..." |
| Tasks grid, pressed view | Status (and Due for Due soon) disabled: "Set by the Overdue view above."; empty: "No overdue tasks.", "Nothing is due in the next 2 days.", "No open ASAP tasks.", "No tasks on hold." |
| Tasks tab without `Task.View` | "You don't have permission to view tasks." |
| Hidden-records hint | "Showing 1-37 of 37 active - 3 inactive hidden" and "Show all" ("archived" on Projects, assets: "of 5 active - 1 inactive hidden") |
| Archived group | "Archived (7)" |
| Copy button in a list row | Visible on hover and row focus; the `?` help: "On a matter name in a list, step to its Copy button (Tab skips it); left arrow or Shift + Tab comes back" |
| Skip link | "On Clients, Matters, Projects and their tabs, the first stop is 'Skip to table'; press Enter to land on the first row" |

**Task page (epic #288).**
| Context | Text |
|---|---|
| Header actions | "Edit", "Activity", "Complete task" (closed: "Reopen task"), overflow "More actions": "Put on hold" / "Resume", "Copy link", "Cancel task"; the same words as the work lists. Toast "Link copied." |
| Complete hint | "3 steps need information" (singular "1 step needs information"): tooltip, `aria-describedby`, and the note under the Complete item of the Status menu |
| View only | "View only: you don't have permission to edit tasks." |
| Status note | "Completed Oct 18, 4:03 PM by Test User 01"; "Cancelled Oct 18, 4:03 PM by KE\kekim: Duplicate of an earlier request"; "On hold since Oct 18, 4:03 PM by KE\kekim: <reason>" with "Show more" / "Show less"; closed in an inactive matter adds "The matter is inactive, so this task can't be reopened." |
| Due tile, closed task | "Was due Oct 14" (a dash without a due date) |
| Facts strip | Tiles "Status", "Priority", "Due", "Assignee" ("Unassigned"), "Pod" (en dash, spoken "No pod"), "Workflow" ("2 of 3 resolved", "No steps") |
| Assignee menu | First item "Assign to me"; then "Unassigned" (hint "Remove the assignee") and the Pod members, each with "n open" |
| Tabs | Label "Task sections"; "Workflow (2/3)" (spoken "Workflow, 2 of 3 steps resolved"), "Assets (0)" (no count without `Asset.View`), "Comments (48)" |
| Details disclosure | Button "Details" with the summary "Requestor Dana W-M . 14 request fields"; request section "Request details (Search and Culling, form 1)" with "14 fields" |
| Workflow head | "Ordered: complete or skip each step in order" / "Unordered: work these in any order"; filter "Show All" / "Unresolved" from 6 steps |
| Comments | "Showing latest 3 of 48. Show all" / "Showing all 48. Show latest 3"; composer placeholder "Add a comment... (Ctrl+Enter to post)" |
| Assets without `Asset.View` | "You don't have permission to view assets, so linked assets aren't shown here."; request-form references "Asset 12 (not available)" |
| Activity | Folded run "KE\kekim added 12 comments (4:03 to 4:05 PM)" with Show / Hide; comment excerpt as a link; dates "Oct 15, 2026" |
| Edit dialog | Title "Edit task details"; sections "Task", "Input", "Priority, due date and assignment" (collapsed, with a summary); buttons "Save changes" / "Cancel"; counter "n / 200" |
| States | "We couldn't find that task." / "You don't have access to this task." / "Couldn't load this task." with the reference and Retry; tab titles "Task not found", "No access to this task", "Task could not be loaded" |
| Create task | h1 "Create task"; "Choose a task type to start"; "What kind of task is this?"; "Search task types"; "Type, workflow and matter can't be changed after you create the task."; "Change type" |

**Work vocabulary (BUG-13, M5; one set of words on the Dashboard, My Work, the Task Queue links and the docs).**
| Term | Meaning |
|---|---|
| Due soon | Open task (New, In Progress, On Hold) with an explicit due date today or in the next 2 days (the viewer's zone), not overdue, not ASAP. Never overlaps Overdue. |
| Overdue | Open task whose due moment has passed. |
| Due soon and overdue | The My Work tab holding both. Its count equals Dashboard Overdue + Due soon for the same person and scope. |
| Completed | Status Completed only (Dashboard tile and Trends). The tile tooltip says "Completed (cancelled not counted)". |
| Closed | Completed or Cancelled (My Work tab and the Closed column). |
| Tab tooltips | Active "Open tasks assigned to you"; Due soon and overdue "Overdue plus due in the next 2 days. ASAP tasks have no due date and are listed under Active"; Closed "Completed or cancelled in the last 90 days (use Show older for more)"; Created by me "Tasks you created, any status or assignee". |
| Dashboard Due soon caption | "Today and the next 2 days, not overdue, not ASAP". |

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
- **Put on hold:** field "Reason", buttons "Put on hold" / "Close" (T4 #305).
- **Complete task with unresolved steps:** "You have <n> steps not completed. Do you want to mark them all completed?" buttons "Complete all steps and finish" / "Cancel"; when steps need information the dialog lists them and the primary button is "Go to first step" with "Close".
- **Reopen task:** "Move <TSK-1042> back to In Progress?" "Reopen" / "Keep" (the dialog's buttons are Reopen and Keep). Completed/Cancelled + inactive matter: disabled, reason "The matter is inactive, so this task can't be reopened."
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
| My Work empty | "Nothing is assigned to you right now. Check Pod Work for unassigned tasks." (the Pod Work link only for people with Pod.View who are in a Pod; without Pod.View the sentence stands alone; in no Pod it adds "You are not in a Pod yet; ask an administrator.") |
| Queue empty | "No tasks yet." |
| Filter empty | "No tasks match these filters." |
| Task list error | "Couldn't load tasks." with the reference, Copy and Retry; the same row on a first load and on a reload, and the same words in the live region. |
| Record page not found / no access / failed (Client, Matter, Project, Task) | "We couldn't find that client." with "Go to clients" / "You don't have access to this client." with the same link / "Couldn't load this client." with "Something went wrong. Try again.", the reference and Retry. Matter and project in place of client. |
| Record list empty, filtered, no access, failed | "No clients yet." (Matters: "No matters yet."; client's Matters tab: "No matters yet for this client."; Projects: "No projects yet. Open a matter and choose New project."; matter Projects tab: "No projects in this matter yet."; Assets tab: "No assets in this matter yet.") with the creation button when permitted / "No clients match these filters" with Clear filters / "You don't have access to clients." / "Couldn't load clients." with the reference and Retry. The record lists say the noun in the plural; the pages in the singular. |
| Record list loading | Skeleton rows (five cards on a phone) with the final widths and 44 px height; "Loading clients" in the live region; a record page says "Loading client" once and "Loaded" after a Retry. |
| Task list loading | Skeleton rows (cards on a phone) with the final column widths and row height; "Loading tasks" in the live region. |
| My Work, Created by me empty | "You have no open tasks you created." with Create task (Task.Create) and, when closed ones exist, "Show closed tasks". |
| Task Queue, empty view | One good-news sentence per view (8.2), without Clear filters. |
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
- [ ] UAT-X-4 No approval controls, billing widgets, notification bell, step assignee pickers, attachment upload/list, bulk reassign (except the Project Manager's bulk change inside one matter, epic #667), export buttons, subtasks, dependencies, related-task links, cloning anywhere.
- [ ] UAT-X-5 Controls the user lacks permission for are hidden (or disabled with a reason when state-blocked); direct URL/API access is still denied.
- [ ] UAT-X-6 Keyboard-only: every action reachable, visible focus ring, no trap, dialogs return focus.
- [ ] UAT-X-7 Screen reader (NVDA): landmarks, headings, labels, errors announced, table headers/sort announced.
- [ ] UAT-X-8 Text and UI contrast meet 4.5:1 / 3:1; badges readable in forced-colors mode.
- [ ] UAT-X-9 200% zoom and 1024 px width remain usable.
- [ ] UAT-X-10 Loading, empty, error states exist and match copy deck.
- [ ] UAT-X-11 Dates shown in the single firm timezone.
- [ ] UAT-X-12 Unsaved-changes guard works on every form.
- [ ] UAT-X-13 A link exists only when its target is reachable by the person (no 403 page behind any link on a Client, Matter or Project page); counts the person may not see are absent, never 0 (epic #245).
- [ ] UAT-X-14 Pages with a list start with a skip link ("Skip to table" or "Skip to task list"); Back from a record returns focus to the row that was left.

### S01 Dashboard
- [ ] UAT-S01-1 The eight Summary tiles (Overdue, Unassigned, On hold, ASAP open; Open, Due soon, Completed, Created) show correct counts, and Completed and Created follow the Period.
- [ ] UAT-S01-2 Each tile/bar drills to Task Queue with matching filters, and the count matches the list total.
- [ ] UAT-S01-3 Overdue excludes ASAP, Completed, Cancelled.
- [ ] UAT-S01-4 The Priority, Task type, Status and Age cards have text values, an overdue share per row ("N overdue", linked to the queue with `overdue=true`) and "View as table" with an Overdue column; Age has six buckets that add up to Open.
- [ ] UAT-S01-5 The Unassigned, Overdue and Due soon lists link to tasks and "View all" opens the Task Queue with the same filters.
- [ ] UAT-S01-6 Without `Dashboard.View` the Dashboard item is hidden and the route is 403; with it but without a tab permission a note points to My Work; each tab appears only with its own permission.
- [ ] UAT-S01-7 No staff productivity, billing, or export features.
- [ ] UAT-S01-8 One failing tab shows its own error with Retry while the other tabs and the tab row keep working; the first load of each tab shows a skeleton of its shape and nothing jumps when the figures arrive.
- [ ] UAT-S01-9 Swimlane: four lanes with exact counts, groups (priority, assignee, client / matter tree), sort, filters and the completed window; the board and its choices survive a reload and a copied link.
- [ ] UAT-S01-10 Swimlane: inline Status, Priority and Assignee menus with Undo, the drawer peek returns focus to its card, keyboard works without a mouse, and axe is clean.

### S02 My Work
- [ ] UAT-S02-1 Shows tasks assigned to me from all my Pods (SCN-007).
- [ ] UAT-S02-2 Active tab = New/In Progress/On Hold only; the Closed tab shows completed and cancelled.
- [ ] UAT-S02-3 Due soon and overdue excludes ASAP; includes overdue explicit dates; its count equals Dashboard Overdue + Due soon for the same person (UAT-S01 Due soon excludes overdue and ASAP).
- [ ] UAT-S02-4 Created by Me shows tasks I created regardless of assignee.
- [ ] UAT-S02-5 Active default sort: priority, then ASAP first, then due ascending, then oldest.
- [ ] UAT-S02-5b Due soon and overdue default sort: overdue first (oldest due first), then due date, then priority; a header sort replaces it and Reset sort restores it.
- [ ] UAT-S02-8 Tab names are Active, Due soon and overdue, Closed, Created by me; `?view=completed` opens Closed; the browser title, table caption and live region name the tab.
- [ ] UAT-S02-9 Closed: "Show older" gives the chip "Closed: all time" and the count of all time; removing the chip returns to 90 days.
- [ ] UAT-S02-6 Active and Due soon and overdue show Ref, Title, Matter, workflow progress ("n of m done . step", one line, no bar), priority, Due and status; Closed shows Matter, Closed date and status; Created by me adds Assignee and Age (#173, #184, #185). Each tab keeps its own columns and "Reset columns" restores only the current tab.
- [ ] UAT-S02-6b (#196) The Title cell holds the task type icon and the title only, on every grid: no client / matter line, no progress under the title, no "New" pill (the New dot stays in the Ref cell). Comfortable titles take at most two lines with an ellipsis, Compact one; the full title is the tooltip. A 170-character title and a 90-character unbroken word change neither the column width nor the row height.
- [ ] UAT-S02-6c (#204) On Task Queue, My Work and Pod Work a column can be resized by dragging its header border (from 640 px up; none on a phone): the Title gives way first, then the grid scrolls sideways; the width stays within the column's minimum and maximum (Due 120 to 200 px), applies to every row and to the filter row, survives a reload per page and tab, and Esc during the drag puts it back. A click on a header still sorts; the handles are not in the Tab order. Above 100 rows a dashed guide line shows the width and it applies on release. The keyboard and single-pointer way to set a width is the Columns panel (#206).
- [ ] UAT-S02-6d (#205, #207) Double-click on a column's resize handle fits it to the rows on the page (the widest header or cell content plus padding, within the column's minimum and maximum; the tooltip says "Double-click to fit the rows on this page"); nothing is cut or ellipsized afterwards and it survives a reload. The Title has no handle. A column header opens a menu with the Menu key or Shift+F10 on its sort button (or on the header of a column that cannot sort), with a right click (at the pointer, the browser menu stays away) or with a touch held for 500 ms: Sort ascending / descending, Widen and Narrow (8 px a step), Fit to content, Reset width (off until a width is stored), Hide column (not Ref or Title; the Columns panel then shows it unchecked). The menu is a `menu` with arrow keys, Esc or Tab closes it and returns to the header, and the new width is read out politely ("Due column 144 pixels"). The Title's menu has only Sort and a disabled "Fit to content" that says "Fills the space left". The help (`?`) lists "Menu / Shift + F10" under Work lists; it stays on when "Keyboard shortcuts" is off. Below 640 px there is no menu, no handle and no extra Tab stop.
- [ ] UAT-S02-7 Inline priority/assign only appears with permission.
- [ ] UAT-S02-8b Empty/loading/error states: the empty texts name only screens the person can open; a failed first load and a failed reload show the same row "Couldn't load tasks." with Retry, and Retry puts focus on the first row.
- [ ] UAT-S02-10 (#153) The needs-attention strip (Overdue, Due today, ASAP, On hold, New) counts the whole open assigned set whatever the grid filters are; a click filters Active, replaces another strip filter and toggles off; the counts equal the Dashboard for the same person.
- [ ] UAT-S02-11 (#144, #179) "New" counts tasks assigned since the last visit (30 minutes without activity starts a new visit): the filter lists exactly them with the chip "New since your last visit", a dot in Ref, and they survive opening a task and Back; a first visit shows no New item. There is no "since your last visit" panel.
- [ ] UAT-S02-12 (#170, #183) A plain visit restores the last view only when it was Active or Due soon and overdue, and says so with the view's name; Closed and Created by me are never restored; a person with nothing assigned lands once on the first tab that has tasks, with a notice; Back does not bounce.
- [ ] UAT-S02-13 (#186, #155) Created by me opens on its open tasks and "All" in Status widens it with the count following; the Due filter offers Today, Tomorrow, Next 7 days, This week, Next week and This month (no Overdue preset).
- [ ] UAT-S02-14 (#180) Group by Due on Active shows the ASAP, Overdue, Today, Tomorrow, This week and Later headers with whole counts, "continued" on the next page, collapse by keyboard; a header sort turns it off.
- [ ] UAT-S02-15 (#192) Below 640 px every tab is a list of cards (title, client and matter, Priority, Due and Status chips, the hold reason, the assignee on Created by me); chips are the inline editors with 44 px targets; 640 px and up is the table with its sticky Ref; no sideways scroll at 375 and 320 px.
- [ ] UAT-S02-16 (#235) A Completed or Cancelled row offers only Reopen in its Status menu; a row that leaves its tab after an inline change is muted for 4 seconds and removed, and the counts follow.

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
- [ ] UAT-S03-12 (#196, #210) The two-line rule: in Comfortable only the Title (two 18 px lines), Due (date over relative text) and Status (pill over the hold reason) take a second line; every other cell is one line with an ellipsis. Every row is exactly 44 px (36 px in Compact) in every state: one-word title, 170-character title, 90-character unbroken token, On Hold, closed, the wide column set; group header rows are 36 px. There is no `client . matter` line under the Title and no New pill (the New dot is in Ref).
- [ ] UAT-S03-13 (#200) Widths are fixed: Title is the spring, no column changes width when the rows, the page, the sort or the filter row change, and the skeleton rows line up with the header. At 1366x768 the default Task Queue shows at least 11 rows; Compact 13.
- [ ] UAT-S03-14 (#204 to #207) Resize: dragging a header border changes the width by the distance (Due 120 to 200 px), every row and the filter row follow, the Title gives way, Esc puts it back, it survives a reload and is kept per page and tab (Task Queue widths do not reach My Work). The same is possible without a mouse: Columns > Column widths (- and +, number field, Fit, Reset width, "Reset all widths"), and the column menu on Menu or Shift+F10. Fit to content never clips; the Title says "Fills the space left".
- [ ] UAT-S03-15 (#201) Narrow windows: Matter Name, Updated, Created, Age, Project, Workflow, Task type, Pod, Requestor, Creator, Progress and Client drop out in that order (Matter Name first of all) while the Title would be under 200 px; Ref, Title, Matter Number, Priority, Assignee, Due and Status never do. Tablets (640 to 1023 px) scroll sideways with the hint and a sticky Ref; below 640 px the list is cards.
- [ ] UAT-S03-16 (#218 to #224) Quick views: All open, Unassigned, Overdue, Due soon, ASAP, On hold, My pod (only with a primary Pod), Created by me (only with Task.Create), More with Recently completed. Each shows its count, not narrowed by filters; the count equals the grid total and the Dashboard tile; row 1 stays one line at 1366 and 1920; a Dashboard link that is a view presses it; Recently completed (30 days including today) shows Closed instead of Due without changing the saved columns.
- [ ] UAT-S03-17 (#225 to #227) Copy: chips never repeat their value; the restored notice names the view; each empty view has its own sentence (8.2) and no dead-end Clear filters; the title, caption and one live message name the view.
- [ ] UAT-S03-18 (#237) The footer shows "Showing 101-150 of 442", Rows per page (remembered; a link with a size wins), First, Previous, "Page 3 of 9", Next, Last; the page count is ceil(total / size); one announcement per page change; at 375 px one row with Previous, "Page n of m", Next.
- [ ] UAT-S03-19 (#232) Sorted by Due, the grid shows ASAP, Overdue, Today, Tomorrow, This week, Later and Closed dividers with whole-set counts; descending mirrors them with Closed last; no other sort has dividers.
- [ ] UAT-S03-20 (#235, #234) A Completed or Cancelled row's Status menu offers only Reopen; the Assignee menu starts with "Assign to me".
- [ ] UAT-S03-21 (#236) The Quick views are one Tab stop (nine before) with Left, Right, Home and End, and the `?` help lists those keys; "Skip to task list" reaches the first row with Tab, Enter. Decision (PM): the earlier target of at most 25 Tab stops before the first row is relaxed; without the skip link the page still needs about 42 presses at 1366 px (the side navigation 14, the filter row 7 and the column sort buttons 7 are the rest), and collapsing those is a separate design question (addendum U).
- [ ] UAT-S03-22 (#215) Print (preview or PDF) shows the title, the filters line, the print line with the sort, page and printed time, and the grid with a repeating header; the toolbar, filter row, handles, footer and Assign to me are hidden; the red bar and pills print.
- [ ] UAT-S03-23 (#348) Matter Number is the reference only (one line); Matter Name is its own column (link with `Matter.View`, one line with an ellipsis, tooltip, "(inactive)"), in the defaults of the Task Queue, every My Work tab and Pod Work, sortable server-side with stable paging; a user who never customised the columns gets Matter Name, a customised set is left alone; the Columns panel, header menu, resize, fit, Compact and print treat it like any column.

### S04 Pod Work
- [ ] UAT-S04-1 Pod selector lists my Pods first; Primary Pod default; remembers last. With no pod chosen (Director, Observer, no membership) the page lists the pods with counts.
- [ ] UAT-S04-2 Pod queue shows tasks with the Pod and no assignee; By member lists the workload table (people with work first, idle members folded).
- [ ] UAT-S04-3 Assign to me works for permitted users and moves New to In Progress with toast (SCN-006).
- [ ] UAT-S04-4 Cross-Pod assignment allowed by the server (a person in another Pod can be assigned through the API and the task page); the Pod Work picker lists the Pod's members, non-membership only informational (#572).
- [ ] UAT-S04-5 Pod-only assignment doesn't change status.
- [ ] UAT-S04-6 The strip (Overdue, Due today, ASAP, On hold) and the tabs agree: each strip number equals the rows its filter shows on All open; By member counts people with open work.
- [ ] UAT-S04-7 No ranking/performance display; the member table is alphabetical until the viewer sorts.
- [ ] UAT-S04-8 With no pods in the system the page says "There are no pods yet." (Create a pod only with Pod.Manage); a person with no pod gets the list of pods.
- [ ] UAT-S04-9 (#199) There is no Actions column: an unassigned row shows "Unassigned" and an "Assign to me" link-button in the Assignee cell on one line (visible from 640 px); it assigns with the toast "Assigned to you." and Undo, the row leaves the Unassigned tab after 4 seconds and the counts refresh; a read-only viewer sees no link.

### S05 Clients
- [ ] UAT-S05-1 Entering `343` previews and saves `00343`; `00343` is treated as the same client (SCN-001).
- [ ] UAT-S05-2 Duplicate (padded equivalent) rejected with link to existing.
- [ ] UAT-S05-3 6+ digits and non-digits rejected with copy-deck messages.
- [ ] UAT-S05-4 The Client number filter finds a client by `343` or `00343`, the Name filter by a name fragment; Status is Active by default and the pager says how many inactive clients are hidden, with Show all.
- [ ] UAT-S05-5 Number locked on edit; change requires confirm dialog and is audited.
- [ ] UAT-S05-6 Custom fields render and validate.
- [ ] UAT-S05-7 Detail opens on **Overview** (strip, matters with the most open tasks, Created / Last changed line, custom fields) with no side panel and no number, name or status rows; the **Matters (n)** tab (`?tab=matters`) shows the matters; the header has Edit, Activity, New matter and a "..." menu with Set inactive.
- [ ] UAT-S05-8 Create/Edit buttons hidden without permission; a person with only `Client.View` has no header buttons and no "..." menu.
- [ ] UAT-S05-9 The strip order is Open, Overdue, Due soon, ASAP, On hold; each item is a link that opens the Task Queue for this client with the same number as the strip; without `Task.View` there is no strip and no count columns.
- [ ] UAT-S05-10 List: the name is the only link (the number is plain text); Open tasks and Overdue link to the Task Queue when above 0 and sort most first; rows are 44 px; the filter row is open and its state is remembered; Clear filters is in the page header.
- [ ] UAT-S05-11 Below 640 px the list is cards (name link, number, `14 open`, `3 overdue`), Sort by is in the Filters sheet; at 640 px it is the table.
- [ ] UAT-S05-12 An inactive client shows New matter disabled with "This client is inactive. Set it active to add matters."
- [ ] UAT-S05-13 Tab: "Skip to table" is the first stop and Enter lands on the first row; Back from a client puts focus on that row's name link (the heading when the row is gone); a reload does not move focus.
- [ ] UAT-S05-14 Not found, no access and a server failure each show their own page text (5.6) with Retry only for the failure.

### S06 Matters
- [ ] UAT-S06-1 Same matter number allowed under different clients; duplicate within a client rejected (SCN-002, SCN-003).
- [ ] UAT-S06-2 Combined reference preview updates live; display `00343-00012`.
- [ ] UAT-S06-3 Client locked after creation.
- [ ] UAT-S06-4 Set inactive (header "..." menu) is disabled with its reason while any task is not Completed/Cancelled; when the server still refuses, the dialog explains and links to the open tasks.
- [ ] UAT-S06-5 Inactive matter: banner shown; Create task disabled with reason; reopen disabled with reason.
- [ ] UAT-S06-6 Detail tabs are **Overview** (first, default), Tasks (n), Projects (n), Assets (n), with no side panel; `?tab=tasks|projects|assets` deep links show correct data; Create task prefilled; New project and New asset are in the "..." menu; the Overview strip items open the Tasks tab on the matching view.
- [ ] UAT-S06-7 Search accepts unpadded and hyphenated forms.
- [ ] UAT-S06-8 List columns are Reference, Name (link), Client (from 900 px; a link only with `Client.View`), Open tasks, Overdue, Status; Sensitive is a select in the filter row and there is no "Other filters".
- [ ] UAT-S06-9 The strip above the Tasks grid toggles Overdue, Due soon, ASAP and On hold (`view=` in the address, Back restores); the grid total equals the strip number and the Task Queue total behind the matching link.
- [ ] UAT-S06-10 Projects tab: Active first, `Archived (7)` collapsed (Enter and Space), natural order (`Batch 2` before `Batch 10`), Open tasks and Overdue links; Assets tab: en dash for an empty external reference, count in the tab label.
- [ ] UAT-S06-11 Keyboard: 25 matters cost 25 name-link Tab stops and no copy-button stop; the right arrow on a name link reaches Copy, the left arrow returns; "Skip to table" first; Back from a matter or a project focuses the row left.
- [ ] UAT-S06-12 Without `Task.View` the Tasks tab says "You don't have permission to view tasks." and no strip, count column or count link appears; without `Client.View` the client is plain text.

### S07 Projects
- [ ] UAT-S07-1 Create from Matter with Matter locked.
- [ ] UAT-S07-2 Moving a task offers only projects of the same Matter; Matter unchanged (SCN-005).
- [ ] UAT-S07-3 Archived project can't be chosen for new tasks, existing tasks keep it.
- [ ] UAT-S07-4 Flat structure (no nesting UI).
- [ ] UAT-S07-5 Project detail has two tabs, **Tasks (n)** (default, no `tab` in the address) and **Details** (`?tab=details`: Matter, Description only when set, Status, Created, Last changed, custom fields; no Name), the full page width and no side panel; the filters of the Tasks grid survive a visit to Details.
- [ ] UAT-S07-6 Header: Edit, Activity, Create task, "..." with Archive / Restore; the crumb is Matters > reference > name, the first two plain text without `Matter.View`.
- [ ] UAT-S07-7 The global list has the columns Name (link), Matter (reference over name), Client (from 1100 px), Open tasks, Overdue, Status; two projects with the same name are told apart by the Matter cell; cards below 640 px.
- [ ] UAT-S07-8 A 130-character project name keeps the header to the limits of 5.9 (title two lines, tabs not pushed below the fold at 1366x768).

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
- [ ] UAT-S09-18 Create task uses the record header (h1, crumb, type as context line); the type chooser shows 3 cards per row from 1024 px, 2 from 640, 1 below, with descriptions cut at a whole word.
- [ ] UAT-S09-19 The form is one 720 px column with one input width; Matter, Task type and Workflow are a three-tile strip with the "can't be changed" sentence; the Title box shows `n / 200`.

### S10 Task detail
- [ ] UAT-S10-1 Header and facts strip always show the task number and title, the Matter ref, Client, task type and workflow (context line), and the six tiles Status, Priority, Due, Assignee, Pod and Workflow progress, each fact once.
- [ ] UAT-S10-2 One page with tabs (the Task Detail epic, #347): header, six-tile facts strip, status note, the tabs Workflow, Assets and Comments (left column, Assets before Comments, one pane at a time, each full width, counts live) and Details (side panel from 1100 px, closed disclosure below, not a tab), Activity drawer. No section nav, no stacked sections, no Attachments section.
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
- [ ] UAT-S10-24 Header actions: Edit, Activity, the primary Complete task (Reopen task on a closed task), overflow with Put on hold or Resume, Copy link and Cancel task last; one Edit control on the page; on a phone Edit and Activity are in the overflow.
- [ ] UAT-S10-25 Complete task is never disabled for missing information: it shows "n steps need information" and the dialog's primary button is "Go to first step".
- [ ] UAT-S10-26 One neutral status note for On hold, Completed and Cancelled (when, who, reason; Show more for a long reason); a closed task shows "Was due Oct 14" in the Due tile.
- [ ] UAT-S10-27 Tabs `Workflow (2/3), Assets (n), Comments (n)` at every width: one Tab stop, arrows, Home and End, `?tab=assets|comments` deep links (the default is not written, the address is replaced), counts live from any tab, a link into a comment and shortcut C show the Comments tab.
- [ ] UAT-S10-28 Below 1100 px the order is the tabs with the selected pane, then Details (closed disclosure with a one-line summary); only one pane is on screen, never side by side.
- [ ] UAT-S10-29 Request details section: open at 6 fields or fewer, closed above, remembered per task type; a long description is cut at 12 lines with Show more / Show less; no nested scrollbar in the wide Details panel.
- [ ] UAT-S10-30 Edit dialog: 720 px, sticky Save footer, sections Task / Input / Priority, due date and assignment (collapsed with a summary, opens on an error), title box with counter, no sideways scroll at 375 px, Esc ignored with unsaved changes.
- [ ] UAT-S10-31 Comments: composer above the thread above 5 comments; "Showing latest 3 of 48. Show all". Activity: comment events link to the comment (excerpt), 3 or more comments in a row by one person within 10 minutes fold into one line.
- [ ] UAT-S10-32 Drill-in: a task opened from a Matter, Project, Dashboard or Search names that page in the crumb and goes back to the exact view with focus on the link; an origin the person cannot use is dropped; one way back is visible at every width.
- [ ] UAT-S10-33 Shortcuts C, A and S work only with "Keyboard shortcuts" on, never in a field, menu or dialog, and only when the control is on the page; focus lands on the Status menu button after Complete, Hold, Resume, Reopen and Cancel.
- [ ] UAT-S10-34 Permission variants (System Admin, assignee Data Technician, Task.View only, no Asset.View, no Matter.View, no Client.View, no Project.View, no Pod.View, no Dashboard.View): no 401/403/404 request, no toast, every link opens, every control present exactly when allowed, "View only" line shown when nothing can be changed.
- [ ] UAT-S10-35 Loading skeleton, 404, 403 and failure use the shared record states with tab titles "Task not found", "No access to this task", "Task could not be loaded".
- [ ] UAT-S10-36 Asset references in the request form and the Assets section make no Asset API request without `Asset.View` (they read "Asset n (not available)").
- [ ] UAT-S10-37 axe 0 and no page-level sideways scroll at 375, 768, 1366 and 1920 px, also with a menu, the Activity drawer or the Edit dialog open.

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
- [ ] UAT-S12-9 Users: Pending access (n), Active, Inactive and All segments; the tabs show Users (n), Roles (n), Pods (n).
- [ ] UAT-S12-10 A person opens in a side drawer; Back closes it; Esc with unsaved edits asks; focus returns to the row.
- [ ] UAT-S12-11 Deactivate asks in a dialog that states the open tasks; View their tasks opens the Task Queue and Back returns to the drawer.
- [ ] UAT-S12-12 A first grant of access shows a toast with Undo; Undo puts the person back in Pending access.
- [ ] UAT-S12-13 User.View only sees a read-only drawer; Pod.ManageMembers changes pods only.
- [ ] UAT-S12-14 Roles: Select all / none per group and Changed (n) with undo; a pod opens as a record page with the crumb.

### S13 Pods
- [ ] UAT-S13-1 Create/edit Pod; add/remove members; user can be in multiple Pods.
- [ ] UAT-S13-2 No per-pod lead flag; guidance text present.
- [ ] UAT-S13-3 Unique pod name validated; deactivation shows open-task impact.
- [ ] UAT-S13-4 Pods is the third tab of Users; `/admin/pods` and `?pod=` deep links work; there is no separate Pods menu item and Users stays highlighted.
- [ ] UAT-S13-5 Users grid Pods column: chips (primary starred with the text Primary), inline popover to add/remove pods and choose the primary one with Apply/Cancel; removing the primary asks for the new one; one Undo; read-only without Pod.ManageMembers.

### S14 Task Types and form designer
- [ ] UAT-S14-1 Palette contains exactly the specified controls; no File Upload.
- [ ] UAT-S14-2 Add, reorder (Up and Down buttons; there is no drag and no Alt+Arrow in the designer), edit and remove fields; keys stay stable after the first save.
- [ ] UAT-S14-3 Conditional show and conditional required rules can be built; the plain-language summary is shown.
- [ ] UAT-S14-4 Preview behaves like the Create Task form.
- [ ] UAT-S14-5 Validation lists circular rules, missing references, empty dropdowns and invalid patterns; Publish... with errors opens the Validation tab and says how many errors to fix (it is never disabled without a reason).
- [ ] UAT-S14-6 The publish dialog shows the changes and the impact ("Tasks already running keep v3. New tasks use v4."); a published version is read-only (Fields and Preview side by side); editing creates a new draft, or Open draft vN when one exists.
- [ ] UAT-S14-7 Existing tasks keep their form version after a new publish.
- [ ] UAT-S14-8 Eligible workflows: a table with a Default radio and Remove; Add workflow lists published, active workflows only; a type with none shows the neutral Not usable badge and one status note naming the reason and the fix.
- [ ] UAT-S14-9 Requires `TaskType.Manage` (alone, without `Task.View`); a person without it gets the 403 page on create, edit and form addresses; unsaved-changes guard.
- [ ] UAT-S14-10 The designer is operable by keyboard alone (Tab, the tab widget arrows, Up and Down buttons); focus returns to the button after the sheet or a dialog closes.
- [ ] UAT-S14-11 Task Types list: 44 px rows, tab counts of active records, strip (Active, Not usable, Form in draft, Inactive), Open tasks column links to the Task Queue filtered by the type, one row menu (Edit form, Deactivate or Activate), cards below 640 px, "N inactive hidden - Show all".
- [ ] UAT-S14-12 Task Type page: header with status badge, Edit, Activity, primary Edit form and overflow Deactivate whose confirm names the open tasks and the workflows left without a task type; tabs Overview, Workflows (n), Request form; each tab saves alone; on create the Request form tab is disabled ("Save the task type first").
- [ ] UAT-S14-13 Designer at 1366, 1920, 768 and 375 px: no page-level horizontal scroll; at 375 px the first field is in the first screen and Add field opens the palette sheet.

### S15 Step Library
- [ ] UAT-S15-1 Create a step with title, description, instructions, documentation URL, tags; add inputs on the Inputs tab (a saved new step opens on it).
- [ ] UAT-S15-2 Editing a step shows the "doesn't change workflows that are already published" sentence, and published workflows are unchanged (addendum A).
- [ ] UAT-S15-3 Used in is visible on the list (number as link, "Not used"); a used step is deactivated, never deleted; the deactivate confirm says how many workflow drafts contain it.
- [ ] UAT-S15-4 Inputs are described as operational values, not staff metrics.
- [ ] UAT-S15-5 One "Task Types" menu item with the tabs Task Types, Workflows and Workflow Steps (only permitted tabs show; a person with only `Workflow.Manage` lands on Workflows); the breadcrumb of a step is Administration > Task Types > Workflow Steps > step.
- [ ] UAT-S15-6 Tags: add with Enter or comma, remove with Backspace or "Remove tag X", suggestions from existing tags, limits (40 characters, 20 tags).
- [ ] UAT-S15-7 The list filters by title, description and tags (Match all by default, Match any on request), Used in and Status; the designer's step library shows tags and finds steps by tag.
- [ ] UAT-S15-8 The Used in link opens the Workflows tab filtered by the step (chip "Step: X"); the Task Types and Workflows tabs link to each other filtered the same way (`?taskType=`, `?workflow=`).
- [ ] UAT-S15-9 Step page: the title is the H1 with an Active or Inactive badge, primary Edit inputs, tabs Details, Inputs, Used by (n), summary strip; Details saves alone.

### S16 Workflow designer
- [ ] UAT-S16-1 Choose Ordered or Unordered in the bar; changing it asks to confirm.
- [ ] UAT-S16-2 Add (library pane from 1280 px, drawer below), reorder (Move up and Move down, or Alt+Up and Alt+Down on a row, existing) and remove (with Undo) steps with keyboard and mouse.
- [ ] UAT-S16-3 Per-step Skippable and comment-required settings in the Skip rules popover; comment-required is disabled unless skippable.
- [ ] UAT-S16-4 No assignee, approver or approval settings exist; there is no Validate button (errors come back on Save and Publish).
- [ ] UAT-S16-5 Publish shows the changes against the previous version and the impact; tasks already running stay on the old version (SCN-014).
- [ ] UAT-S16-6 A published version is immutable (one neutral note, Open draft vN or Create new draft); the Workflow page's Versions tab lists versions with Created, By and open Tasks; retire asks with the impact ("Retire v2?", "Keep published").
- [ ] UAT-S16-7 Only the current published version is offered to new tasks.
- [ ] UAT-S16-8 Workflows list: Versions column (Published, Draft in progress as a link, Not published neutral), Task types count, Last published, strip from the API summary, row menu (Open draft vN, Deactivate or Activate), cards below 640 px.
- [ ] UAT-S16-9 Workflow page: header badges, one primary (Open draft vN or Create new draft), overflow Deactivate naming the task types that lose the workflow; tabs Overview, Versions (n), Task types (n).
- [ ] UAT-S16-10 After publish, retire, deactivate or discard focus is on the status badge (heading when the row is gone) and a live region states the result.
- [ ] UAT-S16-11 Permission variants: System Admin; `TaskType.Manage` only; `Workflow.Manage` only; `Task.View` only (403 page on every address of the area); no dead link, toast or refused request.

### S17 Asset Types
- [ ] UAT-S17-1 Create an asset type (record page, no Active checkbox), add fields with conditional rules on the Fields tab, preview works, publish.
- [ ] UAT-S17-2 Fields appear in Asset create and edit.
- [ ] UAT-S17-3 Removing a field keeps existing values hidden, not deleted.
- [ ] UAT-S17-4 The list has counted tabs, strip, 44 px rows, one menu (Move up and Move down swap with the shown neighbour; Deactivate names the assets that keep the type); asset types are never deleted.
- [ ] UAT-S17-5 Link Roles tab: Rename in a dialog (duplicate name explained), Move up and Move down, Deactivate says "n links keep this role", Delete only when unused and a refused delete is one inline sentence.
- [ ] UAT-S17-6 Requires `AssetType.Manage`; the Assets count appears only with `Asset.View`.

### S18 Labels and custom fields
- [ ] UAT-S18-1 Priority add, rename, recolour, reorder (menu or drag), deactivate; exactly one default which cannot be deactivated or deleted and says why; colour contrast validated.
- [ ] UAT-S18-2 Changes don't alter existing tasks' labels beyond rename; deactivated priorities still display; Open tasks links to the Task Queue filtered by the priority.
- [ ] UAT-S18-3 Status labels: five fixed rows, editable labels, codes read-only, no add or remove.
- [ ] UAT-S18-4 Custom fields lists three objects only: Client, Matter, Project (no Task and no Asset entry); viewing creates nothing; the designer provisions the form on the first Edit fields.
- [ ] UAT-S18-5 Custom fields render on the relevant create, edit and detail screens.
- [ ] UAT-S18-6 A person with only `Priority.Manage` or only `StatusLabel.Manage` sees one list without a tab strip; the other tab's address opens the allowed one.

### S19 Audit
- [ ] UAT-S19-1 Visible only with `Audit.View` (which needs no `Task.View`).
- [ ] UAT-S19-2 Filters by date, actor, object, event; quick views; the loaded count and the 1,000 hint.
- [ ] UAT-S19-3 Shows the events of baseline 11.3 and admin, configuration, user-provision and access-grant events, with friendly names and readable details (Old -> New, Technical details).
- [ ] UAT-S19-4 Read only; no export; no read-access log entries.
- [ ] UAT-S19-5 An object link exists only when the viewer may open its target; otherwise plain text.

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

### S23 My profile
- [ ] UAT-S23-1 A person sets Out of office with an until date and a note on My profile or from the header menu; the header says "Out of office until ..."; "I'm back" ends it; the Users screen, assignee pickers, Swimlane cards and Dashboard Users tiles show the same state.
- [ ] UAT-S23-2 Work hours and time zone: a person in another zone with their own hours shows Available and Off hours at the right local times, also on the days clocks change.
- [ ] UAT-S23-3 Validation: an until date before the from date, an end time before the start time and an unknown time zone are named in the error summary, each link moves to its field, and nothing is saved.
- [ ] UAT-S23-4 Only the person themselves or a `User.Manage` holder edits availability; everyone else has no button and gets 403 from the API.
- [ ] UAT-S23-5 Focus returns to the header menu button after the "Set out of office" dialog closes; axe is clean on every state.

### S24 My Matters and the manager fields (epic #667)

- [ ] UAT-S24-1 A Project Manager (role, no pod, no matters) opens the app on My Matters with "You are not the project manager of any matter yet."; My Work is right below it in the menu; the logo and the 404 "Go to" link say My Matters.
- [ ] UAT-S24-2 The System Admin keeps the Dashboard (or My Work) landing and still opens My Matters from the menu; a System Admin who also has the Project Manager role lands on My Matters. A Director, a Read-Only Observer and a technician have no My Matters item and meet the 403 page at the address.
- [ ] UAT-S24-3 A manager without `Task.View` keeps the old landing, has no My Matters item and meets the 403 page at the address with no request and no toast.
- [ ] UAT-S24-4 Each of the seven strip counts opens a list with exactly that total; Client, Role and Dates change every panel and the strip, are in the address and come back with Back; Clear filters resets them.
- [ ] UAT-S24-5 Needs my attention groups overdue, due soon, unassigned and stuck on hold, each row opens the task and Back returns to the same place; "View all" totals match the groups.
- [ ] UAT-S24-6 Matter health: Red, Amber and Green follow the rule in the popover (overdue; unassigned, due in 3 days or on hold over 7 days; else), the word is shown with the colour, sorting announces `aria-sort`, "+ New task" opens Create task with the matter fixed and returns to My Matters on Create and Cancel.
- [ ] UAT-S24-7 A matter without a manager shows no warning, flag, badge or count on My Matters, the Matters list, the matter header and the Task Queue.
- [ ] UAT-S24-8 Workload lists pods and people alphabetically with out-of-office chips and no ranking or "overloaded" wording; Recent activity shows an event by somebody else as unread until "Mark all as read" (kept after a reload) and never shows comment text.
- [ ] UAT-S24-9 With `Matter.AssignManagers` (Director, Project Manager) the All matters scope, the Project manager filter and "Set project managers" appear and the strip equals the lists; without it there is no switch, filter or link, `scope=all` in the address is ignored and the API answers 403. More than 5,000 matters in scope asks the person to narrow by client or manager.
- [ ] UAT-S24-10 On a matter's Tasks tab, Select mode re-assigns or re-prioritises up to 100 tasks, the dialog states the count and "no undo", a task that cannot change is listed with the reason and the rest change; the controls are hidden without `Task.Assign` / `Task.SetPriority`.
- [ ] UAT-S24-11 Setting Primary and Secondary on the matter header and in bulk on the Matters list is audited per field; a Secondary without a Primary is allowed; a person who lost the role stays on the matter; an ineligible person is refused (`MANAGER_NOT_ELIGIBLE`).
- [ ] UAT-S24-12 Keyboard only with the existing keys (no new or changed shortcut), focus visible and returned, axe 0 and no page-level sideways scroll at four sizes with the menus, dialogs and the phone Filters sheet open.

### S25 Notifications
- [ ] UAT-S25-1 Assigning a task to a technician (by somebody else) shows the badge after one poll (within 30 seconds), the item in the panel with its unread dot, and one polite announcement; the person who made the change gets nothing.
- [ ] UAT-S25-2 The panel opens on its heading, shows the ten newest items, closes with Esc or Close and returns focus to the bell; choosing an item marks it read, lowers the count and opens the task or matter.
- [ ] UAT-S25-3 Mark all as read clears the badge in the panel and on `/notifications`; the page filters All and Unread, pages and keeps its state in the address (Back returns to it).
- [ ] UAT-S25-4 A comment by another person on the technician's task, a task due tomorrow, an overdue task (once, not again on the next scheduler run), a new task on a managed matter, being set as a manager and an unassigned pod task each produce the message of the S25 table for the right person only.
- [ ] UAT-S25-5 A person who loses the right to view the task no longer sees its notifications (list, count and badge); a person without `Task.View` has no bell and `/notifications` is the 403 page with no request.
- [ ] UAT-S25-6 My profile > Notifications: eight switches, all on by default, saved at once ("Saved."); switching one off stops the next notification of that type, existing ones stay.
- [ ] UAT-S25-7 At 375 px the panel is a sheet and the page rows are cards; axe 0 at 1366, 1920, 768 and 375 px with the panel open; no page-level horizontal scroll.
- [ ] UAT-S25-8 Keyboard only with the existing keys: the bell, panel, page rows, filter toggle, pager and switches are reachable and operable; no new shortcut exists.
- [ ] UAT-S25-9 No toast, sound or title count appears for a new item.

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
- Cancel allowed from every **open** state (New, In Progress, On Hold), comment mandatory, workflow state irrelevant. A Completed or Cancelled task offers only Reopen, in every menu (the inline Status menus and the Task page's header) and "Cancel task" is not offered for it. Decision (PM), Task Queue review BUG-TQ4: this resolves the earlier contradiction with the line above.
- Editing a Completed/Cancelled Task requires first moving to In Progress.
- Reopening a step on a Completed Task auto-moves it to In Progress.
- Assigning a user to New -> In Progress. Pod-only assignment: no change. Unassigning: no revert.
- Task can only be created on an active Matter; Matter can go inactive only if all tasks are Completed/Cancelled.

## Appendix C: Permission-to-UI map

| Permission | UI it gates |
|---|---|
| `Client.View/Create/Edit` | Clients nav, New/Edit client, Set inactive/active, change number; the Client link of a Matter and the Client column of Matters (plain text without `Client.View`) |
| `Matter.View/Create/Edit` | Matters nav, New/Edit matter, set inactive/active; the Matters tab and the matter links of a Client, the Matter cell and crumbs of a Project (plain text without `Matter.View`) |
| `Project.View/Create/Edit/Archive` | Projects list/dialog, archive; the Projects tab of a Matter and the Project cell of the Tasks grids |
| `Task.View` | All task screens, search results for tasks, dashboard drill-through; the summary strip, the Open tasks and Overdue columns, their links and the tab counts of Client, Matter and Project (absent without it, never 0) |
| `Task.Create` | Create Task buttons and page |
| `Task.Edit` | The header's Edit and the Edit dialog (details, request form values, move Project); with `Asset.Link` and `Asset.View`, Link asset and Remove link |
| `Task.Assign` / `Task.Reassign` | Assignee menu (Assign to me first) and the Edit dialog's Assignment section (Pod, assignee); shortcut `A` |
| `Task.SetPriority` | Priority menu in the facts strip and work lists |
| `Task.ChangeStatus` / `Task.Complete` / `Task.Cancel` / `Task.Reopen` | Status menu (shortcut `S`) and header entries: Complete task, Put on hold, Resume, Cancel task, Reopen task (absent without the permission, disabled with the reason when the Matter is inactive) |
| `Task.Comment` | Comment composer (shortcut `C`); without it the internal-only note takes its place |
| `Workflow.Execute` / `Workflow.StepEdit` / `Workflow.StepReopen` | Complete/skip steps; edit inputs; reopen step |
| `Asset.View/Create/Edit/Link` | Assets screens; the Assets tab of a Matter; on the Task page `Asset.View` shows the Assets section's list and count and the asset names in the request form (otherwise "not available", no Asset API request), `Asset.Link` the Link asset button |
| `Matter.BeManager` | Can be named a matter's Primary or Secondary project manager; with `Matter.View` and `Task.View` it shows the My Matters menu item and route and decides the landing (not for the System Admin, who lands as before)                              |
| `Matter.AssignManagers` | Change a matter's managers (header Change, bulk "Set project managers"), My Matters' All matters scope and Project manager filter                                                                                                                 |
| `Pod.View/Manage/ManageMembers` | Pod Work, Pods admin; on the Task page the `n open` hint in the Assignee menu, the Pod choice in Edit and Pod Work as a `?from=` origin |
| `Role.Manage` | Users & Roles admin (incl. grant access) |
| `User.Manage` | Administration > Users edits, and "Edit availability" for another person (everyone edits their own availability with `Task.View`) |
| `Dashboard.ViewCoverage` | The Coverage view inside the Users tab (needs `Dashboard.View`) |
| `TaskType.Manage` | Task Types and form designer |
| `Workflow.Manage` | Step Library, Workflow designer |
| `AssetType.Manage`, `CustomField.Manage`, `Priority.Manage`, `StatusLabel.Manage` | respective admin screens |
| `Dashboard.View` | Dashboard nav item and route (403 without it); a tab permission has no effect without it; the Task page offers `?from=dashboard` only with `Dashboard.View` and at least one tab permission |
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
11. **Inactive Client** behavior: decided (addendum V): an inactive client blocks New matter; the button is disabled with the reason.
12. **Comment deletion** leaves no tombstone in the thread.
13. **Draft step input saving** before completion allowed?
14. **Past due dates** allowed with warning (proposed).
15. **Pending-user badge** on Administration nav acceptable (not a notification system)?
