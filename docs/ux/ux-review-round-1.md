# UX review, round 1: consistency across every screen

Reviewer: UI/UX lead. Build reviewed: `dev` at `cd5aeaf` (inline Status/Priority/Assignee editing included). Date: 2026-10-14.
Method: ran the real app (SQL Server in Docker, API with Dev auth and the starter seed, `npm run start:api`), created sample data (3 clients, 4 matters incl. one sensitive, 2 pods, 12 tasks in New / In Progress / On Hold / Cancelled with mixed priorities, overdue/due-soon/ASAP dates, assets, partial workflow progress), then drove it with Playwright + Chromium. Every route in `app.routes.ts` and `admin.routes.ts` was captured at 1280 px (about 45 routes), plus dialogs, validation, error, loading, empty, permission-denied and Access Pending states, and key screens at 1024 and 768 px. Screenshots: `docs/ux/review-round-1/screenshots/` (58 PNGs, referenced below by file name). No application code was changed.

Not verified (be aware): toasts and "Undo" after an inline edit (my automation could not drive the inline menu reliably, so only the open menus were captured); behaviour with a screen reader; the Completed task state (no seed task could be bulk-completed, so the Completed badge, "Recently completed" and the reopen flow were not seen); Task Type / Asset Type activate-deactivate beyond the one case described in UXR-06.

Findings already in the UAT reports are cited by ID (UAT-nn, UAT2-nn) and not repeated unless this review adds something. Severity: High = harms daily use or looks broken; Med = visible inconsistency or avoidable friction; Low = polish. Effort: S under 1 day, M 1 to 3 days, L more. "Shared" = fixed once in a shared component or stylesheet.

---

## 1. Executive summary

The task-facing screens (Task Queue, My Work, Task detail, Create Task, entity forms, dialogs) are well built and close to the spec. The inconsistency is between those screens and everything else. The app currently looks like four apps: (a) work screens, (b) entity lists/forms, (c) admin screens that use unstyled native controls, and (d) the PrimeNG-based form engine. Most problems are cheap to fix once in a shared component, because the same decisions (button style, page header, table, date, select, badge) were taken separately on each screen.

### Top 10 recommendations

1. **Introduce one page-header component** (breadcrumb, H1, description, primary action top-right, secondary actions) and one document-title strategy. Today 35 of about 45 screens leave the browser tab as "MatterFlow", breadcrumbs exist on some details only, and the primary action sits at three different heights (UXR-01, 02, 03).
2. **Define four button variants** (primary, secondary outline, tertiary text, danger) and one destructive rule. Today grey-filled, outlined, text-link and pill styles are mixed, and "Delete/Deactivate" are red text links in admin but red filled buttons in dialogs (UXR-04).
3. **Fix the Asset Types table, where Edit/Deactivate buttons overflow and overlap rows at 1280 and 1024 px**, and give every admin list the same row-action pattern (UXR-05).
4. **Confirm every deactivate/delete the same way.** Task Type "Deactivate" fires immediately with only a "Saved." toast; roles, tasks and leave-page already use a proper dialog (UXR-06).
5. **One date/time format and one date input everywhere** ("Oct 12, 2026", "Oct 12, 2026, 10:23 PM EDT"; one date picker). Today: three display formats, native `mm/dd/yyyy` pickers, a `yy-mm-dd` PrimeNG picker, and ISO in filter chips (UXR-08).
6. **One `mf-data-table` contract**: sortable headers, page-size selector, "Showing x-y of n", status filter that defaults to Active, empty/loading/error states. Entity lists, Pods, Task Types, Audit currently each do their own thing (UXR-12, 11, 19).
7. **Make the Task Queue fit a 1280 px screen**: Status is clipped, Title wraps to 3 to 4 lines, Project is almost always "-", Due takes 3 lines. Same for the "Assign to me" action in Pod Work (UXR-09).
8. **Restyle the admin forms** (Roles, Pods, Users search, Audit filters, Pod members) with the same field component as entity forms: bold label above, 40 px inputs, "(required)" marker, and a card surface. They currently use browser-default inputs and an asterisk (UXR-16).
9. **Adopt a vocabulary and verb rule**: titles "New X", create button "Create X", edit button "Save changes", one word per concept ("No Pod" / "-" / "None" / "Unassigned"; "Deactivate" / "Set inactive" / "Archive" / "Retire"; "Link roles" / "Link labels") (UXR-14).
10. **Speed for power users**: put the same inline Status/Priority/Assignee menus in the Task detail header, remember the last Pod in Pod Work, remove the always-open "Quick fill from email" panel from the top of Create Task, and show the filter default state quietly (no triple "All open / Status: Open / Filters (1)") (UXR-10, 26, 31, 38).

---

## 2. Design-system rules to adopt (pattern standard)

One decision per pattern. "Today" is what was observed; "Rule" is the proposal. Items marked (PO) need a product-owner call (section 5).

| Pattern | Today (observed) | Rule |
|---|---|---|
| Document title | Set on Dashboard, My Work, Task Queue only; others "MatterFlow" | `<page> - MatterFlow`; detail pages `TSK-12 Load Jones mailbox - MatterFlow`; set by route `title` plus a `TitleStrategy` |
| Page header | H1 position and primary-action height vary; some pages put a link or description beside the H1 | `mf-page-header`: breadcrumb row, H1 (28 px token), optional one-line description under it, primary action right-aligned on the H1 row, secondary actions after it |
| Breadcrumb | 2-level on some details, none on lists, "Back to ..." links on Task Type and Pods, free text on form designer | Every non-top-level page: `Section > parent > current`, real links, `nav aria-label="Breadcrumb"`; no separate "Back to" links |
| Case | Nav and H1 in Title Case ("Task Queue"), sentence case in some H1 ("Task types", "Asset link roles") | (PO) Sentence case everywhere per spec 8, except feature names that are proper nouns in the nav |
| Create / edit titles and buttons | "New Client" + "Save client"; "Create Task" + "Create task"; "New step" + "Save step"; "New task type" + "Create task type"; "Add priority" | Title "New <thing>", submit "Create <thing>"; edit page title "Edit <thing>" (or the record name) and submit "Save changes"; inline add-rows (<= 3 fields) use "Add <thing>" |
| Button variants | Grey fill, white outline, text link, pill chip | Primary (filled brand), Secondary (white outline), Tertiary (text link style, no border), Danger (red outline in rows, red fill only inside confirm dialogs). One size, 14 px label, 32 px min height |
| Button order | Dialogs: Cancel left, primary right. Page forms: primary left, Cancel right | Keep both and write it down: dialogs end with Cancel then primary (right); page forms start with primary then Cancel (left) |
| Destructive actions | Delete role: dialog. Cancel task: dialog with reason. Task Type deactivate: none. Priority delete: inline confirm | Any delete/deactivate/cancel/archive: confirm dialog stating the consequence, verb buttons ("Deactivate task type" / "Keep active"). Reversible toggles (Activate) need no confirm |
| Leave-page guard | Custom dialog "Leave without saving?" Stay / Leave (good) | Keep; apply to every form incl. admin forms and inline add-rows |
| Toasts vs inline | Success toast bottom-right "Saved."; errors both as inline banner and toast | Toast = result of an action that has no other visible result (Saved, Assigned). Inline alert = load failure or validation. Never both for the same error. Errors carry the reference id inside the inline alert with a Copy button |
| Validation | Summary banner + inline messages on entity forms and Create Task (good); none visible on admin Roles/Pods forms | Keep summary + inline everywhere; summary links to each field and receives focus; clears when fixed (UAT2-17); copy per spec 8.3 |
| Required marker | "(required)" in most, "*" on Pods, none on Roles; "(optional)" only on Create Task | Mark **required** with "(required)" after the label; do not label optional fields |
| Selects and dates | Native `<select>` in 17 files, native `date`/`time` in 5, PrimeNG select/datepicker in form engine and Pod Work | One `mf-select` and one `mf-date` look. Recommend styled native controls (accessible, no aria-label bug UAT2-04); PrimeNG only for searchable pickers (PO) |
| Date display | `Oct 12, 2026` (queue, two lines), `Oct 14, 2026 10:23 PM UTC` (detail), two-line stamp (audit), ISO (filter chips) | Date: `Oct 12, 2026`. Date and time: `Oct 12, 2026, 10:23 PM EDT` (viewer zone abbreviation, per addendum M). Due cell: `Oct 12 · Overdue 2d` on one line. One `mfDate` pipe/function; filter chips use the same |
| Date input | `mm/dd/yyyy` native (locale) vs `yy-mm-dd` PrimeNG | Native date input everywhere (browser locale), placeholder hint not needed; form engine switched to the same |
| Tables | Task tables: sort, page size, columns, inline edit. Entity lists: no sort, Prev/Next. Pods: no pager. Audit: Load more | `mf-data-table`: sortable headers (button + `aria-sort`), page size 25/50/100, "Showing x-y of n", Previous/Next, row actions in a last column, sticky header, horizontal-scroll hint, status filter default "Active" |
| Row actions | Text links (Task types), grey buttons (Pods, Asset types), red link Delete (priorities) | Last column, right-aligned: primary row action as a text link on the name; secondary actions in a "..." menu or max two tertiary buttons; danger action inside the menu |
| Search | Live in queues and Users; Enter-only on Clients/Matters/Projects/Assets; "Apply filters" on Audit | Live (300 ms debounce) for all list search boxes, with a clear (x); Enter searches immediately; "Apply" only for forms with 4+ filters (Audit, Advanced search) |
| Filters | Chip bar + Filters drawer in queues, selects above entity lists | Default state is not shown as a chip/count; "Clear filters" appears only when something non-default is set; filter state in the URL |
| Status/priority/due badges | Lifecycle badges with icon (good); plain "Active" tint chip; black outline chips in workflow; plain text status in Pods | `mf-badge` with tones: neutral, info, success, warning, danger, plus icon for lifecycle states. Task status and priority badges unchanged |
| Empty / loading / error | Skeleton in the queue only (verified), dashed card with CTA in queues, blank elsewhere | Skeleton rows while loading, dashed empty card (message + one action), inline alert with Retry on error; same in every list |
| Read-only / permission | Hidden actions without explanation for viewers; disabled with reason beside the button for matter inactive | Hide actions unrelated to the user's role; show a one-line "view only" notice on detail pages; disable with a reason adjacent to the control when state-blocked (spec 5.7) |
| Dialogs | Custom dialog, title as question, verb buttons (good) | Keep. Return focus to the trigger on close (UAT2-03); X button gets an accessible name (UAT2-04) |
| Tabs | Underline tabs; pill pair on Priorities; chip groups for Activity filters and Comment sort | Underline tabs for page sections; segmented control only for view toggles; chips only for filters |
| Content width | Forms 640 px in a white card; Task Types, Priorities, Link roles tables stop at ~960 px; Roles and Pods forms have no surface | Forms: 640 px max in a card. Tables: full content width. Settings pages: card |
| Icons | Plus on "Create Task"/"New X", none on Save; icons on Search/Refresh | Icon only on create actions (plus) and on icon-only buttons; none on Save/Cancel |
| Typography | H1 28 px; section headings inside cards also large (22 px "1. Where") | H1 28, section H2 18 (token `--mf-fs-h3`), body 14, controls 14. Raise button text from about 12 px (UAT2-22) |

---

## 3. Findings per screen and area

Evidence cells give the two-digit prefix of the file in `docs/ux/review-round-1/screenshots/` (for example 09 = `09-matter-detail.png`). "Shared" says whether the fix lives in a shared component or stylesheet.

### 3.1 App shell and navigation

| ID | Sev | Finding | Evidence | Recommendation | Eff. | Shared |
|---|---|---|---|---|---|---|
| UXR-01 | High | Document title is "MatterFlow" on about 35 screens; only Dashboard, My Work and Task Queue set a title. Browser tabs, history and screen-reader page announcements cannot tell Clients from Pods from a task. | all admin and entity shots | Route `title` on every route plus a `TitleStrategy` that appends " - MatterFlow"; detail pages set the title from the loaded record (`TSK-1 Load Jones mailbox`). | S | Yes |
| UXR-02 | Med | Breadcrumbs are inconsistent: 2 levels on Client/Matter/Project/Asset detail and on forms; Task detail has 3 levels (`Tasks > 00343-00012 Merger Review > TSK-1`) but the Matter segment is not a link and the nav highlights "Task Queue" even when arriving from a Matter; Task Type edit uses a "Back to task types" link; Pods uses a grey "Back to Pods"; form designer uses free text "Task Type: Access Request > Form". The spec (2.2) asks for the full trail `Clients > Client > Matter > Task`. | 07, 09, 12, 38, 41, 42 | One breadcrumb component in the page header (rule in section 2). Make every segment a link. Spec trail for matter-scoped objects. | M | Yes |
| UXR-03 | High | No shared page header. The H1 and its primary action sit at different heights: Clients/Matters at y=94, Pods at y=91 with a description pushed below, Asset Types/Steps/Workflows at y=117 because a description sits between, Task Types puts "New task type" under the description at left, Pod Work puts the pod selector on the title row and offsets the H1, Users puts a "Roles & Permissions" link beside the H1, Roles puts "Users" beside it. | 06, 03, 35, 36, 37, 39, 43, 44, 46 | `mf-page-header` (rule in section 2). Cross-links between Users and Roles become tabs or a secondary action. | M | Yes |
| UXR-22 | Med | Sidebar: not full height or sticky, so on an 800 px window the Administration group runs off the visible area and "Audit Log" is below the fold with no scroll cue (UAT-22, UAT2-22 still open). Eleven admin items are one flat list. At 1024 and 768 px the rail is icon-only; the admin icons are hard to tell apart and the Audit icon is the only way to find the log. | 01, 51, 52, 54 | Sticky full-height sidebar with its own scroll. Group the admin items: People (Users and Roles, Pods), Work set-up (Task Types, Step Library, Workflows, Priorities and Status Labels), Data set-up (Asset Types, Link roles, Custom Fields), Oversight (Audit Log); collapsible. Keep tooltips and add `aria-label`s on the rail. | M | Yes |
| UXR-23 | Low | Header "Create Task" is global, yet Task Queue, Matter detail (twice), Project detail and the Create Task page itself repeat a "Create Task" button. Pod Work has none although the spec lists it there. The user area is plain text (`ke\kekim`), with no user menu as in the spec 2.1 diagram. | 01, 09, 17 | Keep the header button as the one global entry; keep contextual buttons only when they prefill context and label them "Create task in this matter". Hide the header button on `/tasks/new`. Add a minimal user menu (name, account, version, link to Access help). | S | Yes |
| UXR-24 | Low | The global search box changes appearance depending on the pages visited: small square input on first load, taller rounded PrimeNG-styled input after visiting a PrimeNG screen (task Workflow tab, form designer). Looks like PrimeNG theme CSS leaking into the shell. | 01 vs 13, 42 | Scope the PrimeNG theme to the components that use it or style the shell input explicitly. | S | Yes |
| UXR-35 | Low | Icon use is irregular: plus on Create/New buttons only; "Search" button has an icon but "Save" and "Reset" do not; copy icon is tiny (about 12 px) and has no label in lists; nav icons are 14 px beside 14 px text. | 08, 22, 23 | Icon rule in section 2; bump nav and copy icons to 16 px. | S | Yes |

### 3.2 Task Queue, My Work, Pod Work (the three work tables)

| ID | Sev | Finding | Evidence | Recommendation | Eff. | Shared |
|---|---|---|---|---|---|---|
| UXR-09 | High | At 1280 px the Task Queue does not fit: the Status badge is clipped at the table edge (the table is wider than the container and the Age column is off-screen; UAT2-21 only noted 1024/768), Title wraps to 3 to 4 lines at about 80 px wide, "Task type" wraps to 3 lines, Project is "-" in almost every row, and Due uses 3 lines (icon, date, "Overdue 2d"). Pod Work's "Assign to me" action is cut off at the right edge. | 01, 04, 25 | Give Title a flexible min width (220 px), single-line Due (`Oct 12 · Overdue 2d`), make Project and Task type optional columns off by default, keep Status and Priority fixed width, and make the Actions column sticky. Verify at 1280 and 1024 with the default column set. | M | Yes (`task-table`) |
| UXR-10 | Med | The default filter is shown three times ("All open" chip highlighted, a removable "Status: Open" chip, "Filters (1)") plus a "Clear all filters" link even when nothing but the default is applied. "My Pod" is greyed with no explanation for users without a pod. The inline filter panel pushes the table down and uses native checkboxes and native date inputs. | 01, 26 | Treat "All open" as the default view: no chip, no count, no Clear link until something changes. Disabled chips get a tooltip reason ("You are not in a pod"). Filters open as a drawer or popover on narrow widths (spec 5.2). | M | Yes (`work-filter-bar`) |
| UXR-11 | Med | Search behaves differently: queues filter live and show a "Search: x" chip; Clients, Matters, Projects, Assets and Steps search only on Enter with no hint (UAT-06); Audit needs "Apply filters". | 06, 27, 50 | Live debounced search with clear button everywhere (rule in section 2). Placeholders show examples; one `mf-search-box`. | M | Yes (`list-helpers`) |
| UXR-26 | Med | Inline editing exists on Task Queue, My Work, Pod Work and the Matter Tasks tab, but not where users spend most time: the Task detail header shows the same Status, Priority and Assignee as static badges, and the page has two Edit buttons ("Edit" in the header and "Edit details" on the tab) with no visible difference. Inline menus are labelled by action ("Start", "Put on hold", "Complete", "Cancel task") in the status menu but by value in Priority and Assignee, and the chevron affordance is a faint 10 px glyph that appears only on hover/focus for some rows. | 25, 12, 16 | Reuse the same inline menus on the Task detail header chips. One Edit button (opens the Details form; remove the duplicate). Show the chevron always, 14 px. Add a toast with Undo for Priority and Assignee (spec 5.2 proposal) - not verified in this build. | M | Yes |
| UXR-30 | Low | Pod Work: tab names are long and contradictory ("Pod queue (unassigned to person)", stat "Unassigned to a person"); the last-chosen Pod is not remembered and no Pod is preselected for a member of exactly one pod; the pod `<select>` is native and right-aligned on the H1 row. My Work tab "Created by Me" is Title Case while the queue chip is "Created by me". | 03, 04, 02 | Preselect the user's primary pod and remember the last choice. Rename tab to "Unassigned" with a count and align stat names. Sentence case. | S | No |
| UXR-19 | Low | Loading: the queue shows a clean 5-row skeleton (good). Entity and admin lists were not seen with a skeleton in this review (only the queue was throttled); verify and apply the same skeleton to every list. | 28 | Part of `mf-data-table`. | S | Yes |
| UXR-20 | Low | Empty states vary in wording and action: queue "No tasks match these filters." + Clear filters (good), My Work has a link to Pod Work, Dashboard "No tasks completed yet." plain text, Users "No one is waiting for access." Custom Fields "No custom fields" in the table body. Search with no hits shows nothing for one non-numeric character (UAT2-08). | 02, 27, 35, 47 | Dashed card: message + one action; first-run vs filtered variants. | S | Yes |

### 3.3 Dashboard

| ID | Sev | Finding | Evidence | Recommendation | Eff. | Shared |
|---|---|---|---|---|---|---|
| UXR-29 | Low | Tiles use rows of 4, 6 and 2 with different widths, leaving ragged gaps; "No Pod" is used here while the queue shows "-" and Create Task shows "None" (UXR-14); task-type names truncate ("Analytics / TAR Set..."); "View as table" is repeated five times with identical link text; "Updated 10:24 PM UTC" uses a different time format from the rest; zero bars still show a sliver (UAT2-22). | 05 | Fixed 4-column grid; truncated labels get a title tooltip; link text "View Open by Pod as table" (visually hidden suffix); use the shared date-time format. | S | Partly |

### 3.4 Clients, Matters, Projects, Assets

| ID | Sev | Finding | Evidence | Recommendation | Eff. | Shared |
|---|---|---|---|---|---|---|
| UXR-12 | Med | List behaviour differs by screen: Task tables have sort, page size and column chooser; Clients/Matters/Projects/Assets/Steps/Workflows have Previous/Next only, no sort and no page size; Pods shows only "Showing 2 of 2" with no pager; Task Types has no search, status filter or pager at all and shows inactive types inline; Audit uses "Load more". Default status filter is "Active" on most lists but "All" on Pods. | 06, 08, 10, 11, 37, 39, 43, 50 | `mf-data-table` contract in section 2; sort by every text column; default Active; Task Types and Pods gain search and status filter. | L | Yes |
| UXR-13 | Med | Matter references render as a pure-blue monospace link in lists, detail headers and the task header, a different blue from the themed underlined links (`--mf-link`). UAT-10 listed unthemed links; this is the one that remains on every screen. The copy icon appears in some lists (Matters, Projects, Assets) but not in Client detail's Matters tab header or Search results consistently. | 07, 08, 09, 11 | One `mf-matter-ref` component: token colour, monospace, optional copy button, same everywhere. | S | Yes |
| UXR-36 | Low | Detail headers differ: Client H1 is "00343 Acme Corp" in one monospace run; Matter H1 is monospace ref plus a lighter name plus badge, Asset H1 runs name and type together without a gap ("...Smith v Acme Relativity WorkspaceActive" in the DOM); Task H1 is "TSK-1 Load Jones mailbox" with a letter-spaced hyphen. | 07, 09, 12 | `mf-record-title`: ref (mono) + name (regular weight) + badge, wraps cleanly; same tokens. | S | Yes |
| UXR-40 | Low | Matter detail: "Create Task" appears twice (header actions and above the tab table); "Set inactive" is disabled with its reason shown at far right under the buttons, not next to the control (spec 5.7 asks for `aria-describedby`); "Show: Open tasks" select above the tab table where the queue uses chips. | 09 | One contextual Create Task; reason text directly below the disabled button; reuse the queue's filter chips. | S | No |
| UXR-41 | Low | Search results page: Client "Reference" is plain text (not a link) while Name is the link; groups reuse one 5-column layout so Client rows have two empty columns and Asset rows an empty Reference; no Tasks or Projects group was returned for "acme" (verify what is searchable). | 22 | Per-type columns; reference is always the link; show "Showing results for..." with result count. | S | No |
| UXR-38 | Med | Create Task (the most frequent action): the "Quick fill from email" panel is open by default and occupies about 400 px before the first field, so Matter, Title and Task type are below the fold at 800 px. Labels mark both "(required)" and "(optional)". The summary card on the right says "Not chosen" for three rows at all times. Validation summary appears mid-page below the email box. Native date and time inputs differ from the form-engine date picker used once a Task Type is chosen. | 17, 18 | Collapse the email panel by default (remember per user, button "Fill from email"); show Matter, Task type, Title, Requestor first. Mark only required fields. Scroll to and focus the summary. Use the shared date input (UXR-08, UXR-25). | M | Partly |
| UXR-42 | Low | Entity create forms sit in a 640 px card (good), but Edit buttons "Change number" and "Save client" mix a link-styled secondary and a grey Cancel; Cancel on a dirty form was not checked for the leave prompt (the sidebar link does prompt, see 33). | 19, 20, 21 | Verify Cancel triggers the same guard; apply button variants. | S | Yes |

### 3.5 Task detail

| ID | Sev | Finding | Evidence | Recommendation | Eff. | Shared |
|---|---|---|---|---|---|---|
| UXR-27 | Low | The Details tab mixes two layouts: core fields as a left-label definition list, request-form values as stacked label above value with a different indent; core facts repeat in the header strip (Priority, Due, Pod, Assignee, Matter, Workflow) and again in Details. Workflow step status uses black-outline chips ("Completed", "Pending", "Required", "Current step") unlike the rest of the app's badges. | 12, 13 | One definition-list style; header strip is the summary, Details only adds what is not in it; step chips use `mf-badge` tones. | S | Yes |
| UXR-21 | Med | Read-only presentation (Read-Only Observer): Task detail simply loses Edit and Change status, with no sign it is view-only; queue cells render "Unassigned" in italic without a chevron (good) but nothing explains why. The 403 page offers "Go to my work" to a user who cannot see My Work reliably. UAT2-18 found the same in the form copy. | 55, 56 | A quiet "View only: you don't have permission to edit tasks" line under the header; the 403 page links to the user's landing page. Apply spec 5.7 hide/disable consistently. | S | Partly |
| UXR-28 | Med | Activity and Audit log text still exposes internals and is noisy: "Owner kind set to StepInstance", "Form answers #22", "Form #35", "CANCEL comment added", "ON_HOLD comment added", "Owner id set to 40"; one step completion produces about 8 rows, and "Group events of one operation" is off by default. The task Activity tab is clean by comparison ("On hold reason added"). (UAT2-14 is the same family.) | 15, 50 | Default to grouped; humanise entity names ("Step: Intake Review"), hide technical owner/version rows behind "View changes"; use the same sentences as the task Activity tab. | M | Yes (`audit-format`) |

### 3.6 Admin screens

| ID | Sev | Finding | Evidence | Recommendation | Eff. | Shared |
|---|---|---|---|---|---|---|
| UXR-05 | High | **Asset Types: the Edit and Deactivate buttons are rendered outside the table, overlap the next row and run past the card at 1280 and 1024 px.** The actions column has no width. Other admin lists use different row-action styles: Task Types and Priorities use text links (Deactivate/Delete in red), Pods uses a grey "Edit" button, Roles uses a master/detail list with a text "Delete role". | 46, 54, 39, 48, 37, 36 | Fix the Asset Types column now (S). Then adopt the row-action rule (section 2). | S then M | Yes |
| UXR-06 | High | Task Type "Deactivate" executes immediately, with a "Saved." toast and the row flips to "Inactive / Activate". There is no confirmation or statement of consequences (existing tasks, whether the type stays selectable). Delete role, Cancel task, Archive project and leave-page all confirm. Priorities uses an inline confirm instead of the dialog (UAT-15 era). | 40, 34, 32 | Confirm dialog "Deactivate task type?" with consequence copy from spec 8.4 and buttons "Deactivate" / "Keep active". Same for Workflows, Steps, Asset Types, Pods. Use the same dialog for Priorities and Link roles delete. | S | Yes (`confirm-dialog`) |
| UXR-16 | High | Admin forms look unstyled next to the rest: Roles (name, description, search, "Copy from role" at about 22 px height, labels not bold, permission checkboxes native), Pods (Name `*`, Description, Active, Members), Users (search box in the tab strip, UAT-11), Audit filters, Pod "Add members". Required marker is "(required)" on entity forms, "*" on Pods, absent on Roles. | 35, 36, 38, 50 vs 19, 21 | Move these onto the shared field styles (`form-field.scss`), 40 px inputs, bold labels, "(required)" marker, card surface, same button variants. | M | Yes |
| UXR-14 | Med | Terminology and verb drift. Create: "Create Task", "New Client", "New step", "New task type", "New role", "New Pod", "Add priority", "Add asset link role". Submit: "Create task", "Save client", "Save matter", "Save step", "Save workflow", "Create task type", "Create workflow", "Save". Retire: "Set inactive" (client, matter, asset), "Archive" (project), "Deactivate" (task type, asset type, step), "Retire version" (form), "Delete" (priority, role). No pod: "No Pod" (dashboard, task header), "-" (queue), "None" (create), "Unassigned" (person). Names: nav "Task Types & Forms", H1 "Task types", designer H1 "Task Types & Forms"; nav "Priorities & Status Labels" but H1 "Status labels" on the other tab (UAT-25); "Asset link roles" vs spec "link labels"; "Matter ref" / "Matter" / "Reference"; "Client No." vs "Client number"; "Name" vs "Display name". Case: Title Case in nav and most H1, sentence case elsewhere. | 06 to 11, 19, 21, 39 to 49 | Adopt the verb rules in section 2 and a short glossary (below). Rename in one pass. | M | Mostly copy; some shared |
| UXR-17 | Med | Validation presentation is good on entity forms and Create Task (summary + inline + red border + icon) but stale summaries (UAT2-17), vague form-engine copy (UAT2-9, UAT2-10) and no visible validation on the Roles and Pods screens; on Create Task the summary renders below the email panel, so it is off-screen after submit. | 18, 20 | Rule in section 2; add focus management. | S | Yes |
| UXR-33 | Low | Content width: Task Types, Priorities and Link roles tables stop at about 960 px while Steps/Workflows span the full 1012 px; Task Type edit, Roles and Pods forms sit directly on the grey page background, entity forms sit in a white card; Pods table has no header fill or borders unlike other tables. | 37, 39, 41, 43, 48, 49 | Width and surface rules in section 2. | S | Yes |
| UXR-34 | Low | Tab styles: underline tabs (Users, My Work, Task detail, Matter), a two-button pill group (Priorities / Status labels), chip groups (Activity filter, Comment sort). The Users tab strip also hosts the search input (UAT-11). | 35, 48, 15, 14 | Underline tabs for sections only; segmented control for toggles; search below the tab strip. | S | Yes |
| UXR-39 | Low | Add patterns differ: Priorities, Status labels and Link roles use an inline "Add" row at the bottom; everything else uses a "New" button top-right. Not wrong, but undocumented and the inline add rows have no validation display or unsaved guard. | 48, 49 | Document: inline add for lists of at most 3 simple fields; otherwise page. Add the validation and guard. | S | No |
| UXR-43 | Low | Form designer (Task Types, Asset Types, Custom Fields, Step inputs) opens with H1 "Task Types & Forms" whatever the owner (the route data sets "Custom Fields" etc.; check), and uses grey "Retire version" next to a primary "Create new draft"; field list rows show "conditionally required, conditional" (duplicate wording). | 42 | Heading "Form: Access Request"; breadcrumb `Task types > Access Request > Form`; wording "Required when ...". | S | No |

### 3.7 Cross-cutting

| ID | Sev | Finding | Evidence | Recommendation | Eff. | Shared |
|---|---|---|---|---|---|---|
| UXR-04 | High | Button hierarchy is not systematic: filled blue primary (good); grey filled secondary (Edit, Set inactive, Cancel, Reset, Retire version, Create and add another, Change number, Remove, Create new draft from v1); white outline (Filters, Columns, Previous, Next, Edit and Change status on Task detail, Hide, Check again); text links as buttons (Edit/Deactivate/Rename/Delete/Design/Edit fields); pills for chips. A disabled primary ("Post comment") looks like a different colour family. Body-size buttons are about 12 to 13 px (UAT2-22). | 09, 12, 14, 16, 39, 45, 48 | Four variants and one size (section 2). Implement as a button class set in the global stylesheet and use it in all templates. | M | Yes |
| UXR-08 | High | Date and time formats and inputs: queue `Oct 12, 2026` wrapped on two lines; detail `Oct 14, 2026 10:23 PM UTC`; audit two lines; dashboard `Updated 10:24 PM UTC`; activity `Oct 14, 2026 10:23 PM UTC`; filter chips ISO (UAT2-20); inputs: native `mm/dd/yyyy` (queue filters, Create Task, Audit) vs PrimeNG `yy-mm-dd` (form engine, UAT2-02). UAT-24 flagged the format; it is still three formats. Zone shown is "UTC" because the review browser was UTC; verify local-zone abbreviation per addendum M. | 12, 13, 15, 26, 05, 50 | One formatting function; date-time with zone abbreviation; one date input. | M | Yes |
| UXR-25 | Med | Controls come from three sources: native `select`/checkbox/radio (17 files), PrimeNG select/datepicker (form engine, Pod Work), custom inline menus. Side by side (Create Task form vs the Task Type request form inside it) the dropdown, date and focus styles differ, and p-select has the `aria-label="Select..."` bug (UAT2-04). | 17, 13 | Single set of form-control styles on tokens; keep PrimeNG only for searchable pickers; fix labels. | L | Yes |
| UXR-15 | Med | Badges are not one family: lifecycle badges with icon (good), flat green "Active" chip, outlined green "Published", black-outline workflow step chips, amber "Sensitive", blue "Built-in, locked", tiny grey "Inactive" text next to a Task Type, and plain text status on Pods. | 06, 08, 13, 36, 37, 40, 44 | `mf-badge` tones; "Inactive" always a grey badge. | S | Yes |
| UXR-18 | Med | Page-level load errors appear twice: an inline alert and a toast with the same text; only the toast carries "Reference: abc-123" and it auto-dismisses, so the reference cannot be copied. The Retry button is outlined on the queue and grey on Clients. | 29, 30 | Inline alert with reference + Copy + Retry (one style); no toast for load errors. | S | Yes |
| UXR-31 | Med | Power-user speed: Ctrl+K search and inline edits are good; missing: any other shortcuts (`/` focus search, `c` create task), last-used Pod/filter memory (Pod Work, queue view), a way to save a filter view, a visible "default" for new tasks beyond priority Normal. Bulk selection is out of scope by addendum F, so only per-row speed matters. | 04, 25 | Remember last Pod, last queue view and sort in local storage; add "Saved views" later (needs PO); keyboard shortcut help overlay (`?`). | M | Partly |
| UXR-37 | Low | Accessible names for repeated row links and buttons: "Edit", "Deactivate", "Rename", "Delete", "Design", "View as table", "View" have no row context for a screen reader (unverified with AT; the links render identical text). Focus after dialogs (UAT2-03) is still open per that report. | 39, 48, 05 | `aria-label="Edit Access Request"` or visually hidden suffix; implemented in the row-action component. | S | Yes |
| UXR-44 | Low | Typography versus tokens: section headings inside cards use 22 px bold ("1. Where", "Details", "Fields") and compete with the 28 px H1; control text about 12 to 13 px against 14 px body; muted help text is 12 px. | 17, 12, 42 | Section headings 18 px, controls 14 px, help text 13 px (all existing tokens). | S | Yes |

---

## 4. Prioritised implementation plan (shippable work items)

Ordered to fix shared pieces once, with visible wins first. Suggested GitHub issue titles are in bold. Effort is the total for the batch.

### Batch 0: quick wins, each under a day, no design dependency
- **Fix Asset Types table action column overflow at 1280 and 1024 px** (UXR-05). S.
- **Confirm dialog for Task Type, Workflow, Step, Asset Type and Pod deactivate** (UXR-06). S.
- **Set document title on every route and detail page via TitleStrategy** (UXR-01). S.
- **Show error reference id and Copy button inside the inline error alert; stop duplicating it as a toast** (UXR-18). S.
- **Scope PrimeNG styles so the global search box looks the same on every page** (UXR-24). S.
- **Copy and wording pass: verbs, "No Pod", sentence case, glossary** (UXR-14 copy part, UXR-43, UXR-23 header button hiding). S to M.

### Batch 1: foundations (do these first, then everything else is cheap)
- **Button variants and sizes in the global stylesheet; migrate templates** (UXR-04, UXR-35, UXR-44). M.
- **`mf-page-header` with breadcrumb and description slots; migrate all pages** (UXR-02, UXR-03, UXR-34, UXR-40, UXR-23). M.
- **`mfDate` formatting function and shared date input; switch queue, detail, audit, dashboard, chips and form engine** (UXR-08, with UAT2-02 and UAT2-20). M.
- **`mf-badge` tones; migrate Active/Published/Sensitive/step chips** (UXR-15, UXR-27). S.
- **`mf-matter-ref` component (link colour, monospace, copy)** (UXR-13, UXR-36). S.

**Batch 1 status: implemented.** How to use the shared pieces:
- Buttons: `.mf-btn` (secondary outline) with `--primary`, `--danger` (red outline; add `--solid` only for the confirming button in a confirm dialog), `--text` (link style), `--icon`; PrimeNG `p-button` is themed to the same four variants (`severity="secondary"` is the outline, `[text]="true"` the link style, `severity="danger"` the red outline, `styleClass="mf-btn--solid"` in dialogs). One size: 14 px label, 32 px high. Source: `frontend/src/styles/_buttons.scss` and `core/theme/mf-preset.ts`.
- Page header: `<mf-page-header heading="..." description="..." [crumbs]="[...]">` with `mfActions` on each action (secondary first, primary last = top right), `mfTitle` for a rich title (`mf-record-title` with `mfRef`), default slot for extra header content. Nothing else renders an H1 on a screen.
- Dates: `mfDate(value, zone)` / `| mfDate` (`Oct 12, 2026`; `Oct 12, 2026, 10:23 PM EDT`; `'date'` for the day of an instant). The one input is `mf-date-input` (from `form-engine`): accepts `Oct 12, 2026`, `10/12/2026`, `10/12/26`, `2026-10-12`, `12 Oct 2026`, shows a visible hint, tidies to the display format, keeps and reports text it cannot read. Native `type="time"` stays for the time of day.
- Badges: `mf-badge` (tone neutral, info, success, warning, danger + optional icon), `mf-active-badge`, `mf-sensitive-badge`; matter references: `mf-matter-ref` (themed link, monospace, optional copy button via `[copy]`).

### Batch 2: tables and filters
- **`mf-data-table` for Clients, Matters, Projects, Assets, Steps, Workflows, Task Types, Pods: sort, page size, status default, loading/empty/error** (UXR-12, UXR-19, UXR-20, UXR-05 row actions, UXR-37). L.
- **Live debounced search box on all lists** (UXR-11). M. Depends on the table work for the shared hook.
- **Task Queue / My Work / Pod Work column and filter-bar rework: fit at 1280, single-line Due, quiet default filter** (UXR-09, UXR-10, UXR-30). M.

### Batch 3: forms
- **Move Roles, Pods, Users search and Audit filters onto the shared field styles; "(required)" marker everywhere** (UXR-16, UXR-17, UXR-33, UXR-39). M.
- **Single select/date control style; fix p-select aria label** (UXR-25, with UAT2-04). L.
- **Create Task: collapse email panel by default, essentials above the fold, focused validation summary** (UXR-38). M.

### Batch 4: task detail and power use
- **Inline Status/Priority/Assignee menus in the Task detail header; single Edit button; read-only notice** (UXR-26, UXR-21, UXR-27). M.
- **Remember last Pod and queue view; shortcut help overlay** (UXR-31, UXR-30). M.
- **Humanise Audit and Activity rows, group by default** (UXR-28, with UAT2-14). M.

### Batch 5: shell polish
- **Sticky full-height sidebar with grouped, collapsible admin section; labelled icon rail** (UXR-22, with UAT-22). M.
- **Dashboard grid, tooltips and link text** (UXR-29), **Search results columns** (UXR-41). S.

Dependencies: Batch 1 before 2 and 3. UAT items already tracked elsewhere (UAT2-03 focus return, UAT2-04, UAT2-05 contrast, UAT2-13) should ride along with the components they touch.

### Suggested glossary (to apply in Batch 0)
Task Queue, My Work, Pod Work (nav names, unchanged). "No pod" for a task without a pod, "Unassigned" for a task without a person, in every screen including the dashboard and the table cells (display "No pod" rather than "-"). "Deactivate / Activate" for configuration records (task type, step, workflow, asset type, pod, user, priority); "Set inactive / Set active" for Clients, Matters, Assets; "Archive / Unarchive" for Projects; "Retire" only for form and workflow versions. "Link role" (admin) and "Role" (on the task's asset link) - not "label". "Matter reference" in column headers, "Client number" in column headers.

---

## 5. Open questions for the product owner

1. **Case convention:** sentence case everywhere (spec section 8), or Title Case for nav and page names ("Task Queue", "Pod Work") as built today?
2. **Controls:** are we willing to standardise on styled native selects and date inputs (smaller, more accessible) and keep PrimeNG only where search-as-you-type is needed? This removes the `yy-mm-dd` picker.
3. **Date display:** confirm `Oct 12, 2026` and `Oct 12, 2026, 10:23 PM EDT` (viewer zone abbreviation, per addendum M). Is a relative form ("2 days ago") wanted anywhere?
4. **Admin deactivate:** should deactivating a Task Type or Workflow that has open tasks be blocked, or allowed with a warning? (Today it is allowed silently.)
5. **Inline edit Undo:** adopt the spec 5.2 proposal (8-second Undo toast after Priority/Assignee inline edits), or rely on the audit trail?
6. **Task detail header:** OK to make Status, Priority and Assignee editable in place there, replacing the duplicate Edit button?
7. **Default Pod:** for a user in exactly one pod, may Pod Work open on that pod and My Work/Task Queue remember the last view per user?
8. **Saved filter views:** wanted in Phase 1 for the Task Queue (for example "Mine, overdue")? Not in the current spec.
9. **Create Task:** is the email quick-fill used often enough to stay open by default, or should it start collapsed and remember the user's last choice?
10. **Pods list default:** should inactive Pods and Task Types be hidden by default like Clients and Matters ("Active" default)?
11. **Audit Log default:** grouped by operation by default, and should entity names replace numeric ids (for example "Step Instance #40") in the visible text?
12. **Global search scope:** are Tasks and Projects intended to appear in the dropdown and results page? The review saw Matters, Clients and Assets only for a client-number query.
13. **Read-only users:** show a "view only" notice on detail pages, or keep silent hiding?

---

## 6. What is already good (keep)

Custom confirm dialogs with verb buttons and consequence text (Cancel task, Put on hold with required reason, Delete role, Leave without saving); validation summary plus inline messages with icon and red border on entity forms; "(required)" markers on entity forms; priority and status badges that combine icon, text and colour; the inline status menu with actions labelled by what they do and the resulting state; skeleton loading and the filtered-empty state with "Clear filters" on the queue; the "Scroll sideways to see every column" hint at 1024 and 768 (improves UAT2-21); orange focus ring; Ctrl+K search with grouped results; nav pending-user badge; the Access Pending page; monospace matter references; the sensitive-matter badge; unsaved-changes guard now uses an app dialog (UAT-21 fixed).
