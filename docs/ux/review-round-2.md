# UX review, round 2: verification of batches 0-5

Reviewer: independent UI/UX and QA. Build: `dev` at `b2be38d` (all batches 0-5). Date: 2026-10-15 (browser zone America/New_York).
Method: ran everything for real. SQL Server 2022 in Docker, the published API with Dev auth and the starter seed serving the built app, plus `ng serve` (dev build) for console checks; Chromium via Playwright. Seed: 3 Acme/Globex/Initech clients, 4 matters (one sensitive), 2 projects, 3 assets, 4 users (PM, Data Technician, Director, Read-Only Observer), 2 pods, 12 tasks (New, In Progress, On Hold, Cancelled, Completed, partial workflow, overdue, due soon, ASAP). About 55 routes and states captured at 1280 px; 12 key screens at 1024, 768 and 375 px; interactions driven (inline menus, Undo, dialogs, validation, error and loading states, view-only user, sidebar groups, keyboard focus). 39 screenshots in `docs/ux/review-round-2/screenshots/` (referenced by file name). No application code was changed.

Verdict: **batches 0-5 are largely delivered and a clear step up** (document titles, one page header, button variants, one date format, shared list behaviour, inline editing with Undo, view-only notice, grouped sidebar, humanised audit, no a11y violations, no console errors). **Not yet done: Task Queue still does not fit 1280 px for a user who can edit (UXR-09), 375 px has page-level sideways scroll, and the admin row-action pattern is still four different things.** 1 High, 8 Med, 11 Low new findings (section 3).

## 1. Test results

| Check | Result |
|---|---|
| Playwright e2e (`frontend/e2e/run-local.sh`, 13 spec files) | **81 passed, 0 failed, 0 flaky** (1.5 min) |
| Backend integration tests, filter WorkViews + Audit + Workflows (154 tests, Testcontainers SQL Server) | **154 passed, 0 failed** (3 m 46 s). Not run: the rest of the integration suite, unit, schema and architecture tests |
| axe (wcag2a, wcag2aa, wcag21aa), 62 routes and states at 1280 px as System Admin | **0 violations** |
| axe at 1024, 768, 375 px (12 key screens each) | **0 violations** |
| axe in states | **0 violations**: Create task validation, email panel open, filled Create task, deactivate dialog, role editor, pod editor, global search open, shortcut dialog, list error, collapsed sidebar, view-only task detail |
| Console errors and warnings | **None** on any route, in both the production build and the dev build (`ng serve`). No NG0956 on `/assets/new`, including after choosing an asset type with a form (the open item from batch 5 is not reproducible; treat as closed) |
| HTTP errors in the console | None, apart from the 500s I injected on purpose |

## 2. Verdict per UXR

Fixed = seen working in the running app. Partial = improved, a visible gap remains (new finding cited).

| UXR | Verdict | Evidence / remaining gap |
|---|---|---|
| 01 Document titles | Fixed | Every route sets `<page> - MatterFlow`; tasks read `TSK-2 Load Jones mailbox - MatterFlow`. Edit pages for task type, workflow, step omit the record name (UXR2-17) |
| 02 Breadcrumbs | Fixed | Task detail Matter segment is a link (05); Edit pages show record names. Small: "Tasks > New" above "Create task", "Project: Mailbox collection" (UXR2-17) |
| 03 Page header | Mostly fixed | H1 at y=98 with the primary action top-right on all lists and admin pages (03, 07, 08). Exceptions: Matter detail header (UXR2-08), Pod Work label touches H1 (UXR2-11) |
| 04 Button hierarchy | Mostly fixed | Variants consistent; destructive = red text/outline in rows, red fill only in the confirm dialog (25). Gaps: heights 30 px vs 32 px, Cancel is a text link on Create task but an outline button elsewhere (UXR2-14) |
| 05 Asset Types overflow | **Fixed** | Edit/Deactivate sit inside the actions column at 1280 and 1024 (07). Row-action pattern across admin lists is still inconsistent (UXR2-04). At 375 px the table is not scrollable (UXR2-03) |
| 06 Deactivate confirm | Fixed (2 of 5 exercised) | Task type and Asset type: dialog with consequence, "Keep active" / "Deactivate task type", focus returns to the trigger on Esc and Keep (25). Workflow, Step, Pod use the same component; not clicked individually |
| 08 Dates | Fixed | `Oct 12, 2026`, `Oct 14, 2026, 8:44 PM EDT`, `Oct 12, 2026 · Overdue 2d` on one line, audit one line, dashboard `Updated ... EDT`. One date input (typed or calendar, visible hint) in Create task, Audit, queue filters and form engine. Time of day is still the native control (06); placeholders look like a real value (UXR2-13) |
| 09 Task Queue fit | **Partial, not fixed at 1280** | Admin: table 1101 px in a 1012 px container, Status clipped, "Scroll sideways" hint shown, "No pod" wraps to two lines (01, 23). Fits at 1440. Read-only user: fits except Status touching the edge (23). UXR2-01 |
| 10 Quiet default filter | Fixed | Only the "All open" chip is highlighted; no count, no Clear link (01) |
| 11 Search behaviour | Fixed | Clients, Matters, Projects, Assets, Steps, Workflows, Task types, Pods, Users: live after 300 ms, hint text, clear (x), URL keeps `q` |
| 12 List behaviour | Fixed for entity lists, Pods, Steps, Workflows, Task types | Sortable headers, page size, "Showing 1-6 of 6", Status default Active (03, 09). Asset types has none of these (UXR2-04) |
| 13 Matter reference | Fixed | One themed monospace link with copy button everywhere (03, 04) |
| 14 Vocabulary | Mostly fixed | "New X" / "Create X" / "Save changes", "No pod", "Deactivate" are applied. Leftovers: "Inactive labels aren't offered" on link roles, "None" for Pod and Project in Create task, Title Case H1s (UXR2-07, 15) |
| 15 Badges | Fixed | Active, Published, Sensitive, "Built-in, locked", role chips share one family |
| 16 Admin forms | Fixed | Roles, Pods, Users search, Priorities, Link roles on shared field styles with "(required)" (11, 13, 14). Audit filter grid is ragged (UXR2-06) |
| 17 Validation | Fixed (Create task verified) | Summary takes focus, lists 4 problems, inline messages, red borders (24). Roles and Pods validation not triggered |
| 18 Load errors | **Fixed** | Injected 500: one inline alert with `Reference: 00-abc123def456`, Copy, Retry; no duplicate toast (28) |
| 19 Loading | Fixed | Skeleton rows on Clients (29); queue as before |
| 20 Empty states | Fixed | "No clients match these filters." + Clear filters; first-run cards with one action |
| 21 View-only | **Fixed** | Notice "View only: you don't have permission to edit tasks." under the header, no Edit, no disabled Complete (22). Queue shows plain badges and italic "Unassigned" (23) |
| 22 Sidebar | Mostly fixed | Sticky, full height, background reaches the bottom, groups People / Work set-up / Data set-up / Oversight with `aria-expanded`, collapse remembered across reload (31). At 800 px high the Audit log row is below the fold with no scroll cue (UXR2-16) |
| 23 Header Create task | Fixed | Hidden on the Create task page, single button on Task Queue; user menu still deferred |
| 24 Global search look | **Fixed** | Same 40 px / 4 px radius / border before and after visiting PrimeNG screens |
| 25 Controls | Partial | Native and PrimeNG selects are themed alike, but widths differ (480 vs 560 px) and the chevrons differ (06, 30). UXR2-12 |
| 26 Inline Status/Priority/Assignee on Task detail | **Fixed** | Three menus in the header (19, 21); status lists Start / Put on hold / Complete / Cancel task with result states; Hold opens its dialog; single Edit button, focus to the title and back to Edit on Cancel |
| 27 Details layout | Partial | One list layout; "Matter" row label sits 7 px above its value (05) |
| 28 Activity and Audit text | Mostly fixed | "Priority changed from Low to High", "Unassigned from ...", grouped operations "Status changed from In Progress to Completed and 3 related changes" with "Show only this operation" (27). Still raw: `Form #45`, `AssetType 8 and 3 related changes` (UXR2-17) |
| 29 Dashboard | Fixed | 4-column grid, "No pod", no zero slivers (02). "Priorities & status labels" nav item wraps to two lines |
| 30 Pod Work | Fixed | Pod preselected for a one-pod member, tabs "Unassigned / By member / Overdue and on hold / All pod tasks" (35). Spacing under H1 (UXR2-11) |
| 31 Power use | Partial | `?` opens "Keyboard shortcuts" (26) and `/` is listed; last-view memory in queue and My Work not re-tested |
| 33 Content width | Fixed | Priorities, Link roles, Task types full width; forms 640 px cards |
| 34 Tabs | Fixed | Underline tabs, Priorities / Status labels now underline (13) |
| 36 Detail headers | Fixed | Client, Matter, Asset, Project H1s read consistently (03, 04, 37) |
| 37 Row action names | Partial | Pods "Edit Processing Pod" and Task types "Edit Access Request" are good; Asset types "Edit" and "Deactivate" have no row name (UXR2-04) |
| 38 Create Task | **Fixed** | Email panel collapsed behind "Fill from email", choice remembered across reload, Matter / Task type / Title / Requestor above the fold, validation summary focused (06, 24). Focus stays in the matter picker after a pick ("Change") |
| 40 Matter detail | Partial | Duplicate Create task removed; the disabled "Set inactive" now carries its reason beside it, but the header wraps awkwardly (04, UXR2-08) |
| 41 Search results | Fixed with a nit | Per-type columns and reference link (17); badge touches name (UXR2-10) |
| 42 Entity forms | Fixed | "Create client" / "Save changes" / Cancel outline |
| 43 Form designer | Fixed | H1 "Form: Access Request", outline "Retire version" next to primary "Create new draft" (15) |
| 44 Typography | Mostly fixed | H1 28 px, section H2 18 px, buttons 14 px. Form designer field cards still about 11 px |
| 16/UAT2-03 focus return | Mostly fixed | Dialogs return focus (deactivate, leave-guard Stay). Not the inline menus (UXR2-05) |
| NG0956 | Not reproducible | see section 1 |
| 07, 32, 35, 39 | Not re-checked individually (low value) | |

Round-2 UAT items seen fixed: UAT2-17 (summary follows fields), UAT2-20 (no ISO chips), UAT2-21 and UAT2-24 at 768 and 1024 (hint plus scrolling tables; 375 see UXR2-02/03), UAT2-22 (sidebar background, button size, Access Pending untouched).

## 3. New findings

Severity: High harms daily use or looks broken; Med visible inconsistency; Low polish. Effort S under 1 day, M 1-3 days.

| ID | Sev | Finding | Shot | Recommendation | Effort |
|---|---|---|---|---|---|
| UXR2-01 | High | UXR-09 residual: Task Queue for an editing user is 1101 px wide in a 1012 px container at 1280. Status is clipped, the sideways hint shows, and the Pod column (50 px) wraps "No pod" onto two lines. Due column is 216 px, Title 220 px. | 01, 23, 34 | Pod cell `white-space: nowrap` (or hide the column when no tasks have a pod); trim Due to about 190 px and Assignee/Priority to the content width; verify `scrollWidth <= clientWidth` at 1280 with the inline-edit chevrons present | S |
| UXR2-02 | Med | At 375 px every screen scrolls sideways: the header Help button ends at x=412. Create task wraps to two lines, user name is cropped. Regression from the shortcut-help button. | 32 | Hide the Help button and the user name text under 480 px (keep an icon), or let the header shrink; `Create task` as icon + "Create" | S |
| UXR2-03 | Med | At 375 px the Asset types table is not in a scroll wrapper (page width 457 px): the Edit / Deactivate column is off-screen. Task Queue is fine (it scrolls). | 33 | Wrap Asset types in `.mf-table-wrap`/`.mf-scroll`, or move it to `mf-data-table` (see 04) | S |
| UXR2-04 | Med | Admin lists still use four row-action patterns: Asset types bordered buttons "Edit / Deactivate" (aria names without the row, no search, status filter, sort or pager), Task types text links Design / Edit / Deactivate (red link), Pods only an Edit link, Steps and Workflows none. Task types has name link plus Edit doing the same thing. | 07, 08, 09 | Put Asset types on `ServerListPage`/`LocalListPage`; one rule: name link opens the record, last column holds at most two text actions, row-named aria-labels | M |
| UXR2-05 | Med | Focus is lost after choosing an item in an inline menu (Priority, Assignee, Status): focus lands on `body` / "Skip to main content". Esc is fine. | 20 | Return focus to the trigger button after a pick, as with dialogs; `?` help already promises "return to where you were" | S |
| UXR2-06 | Med | Audit filters render as a ragged 3-row grid: labels and inputs sit at different heights (Object id at y=178 vs Object type 198, From 270 vs Event type 290), Apply/Reset float beside the search box. | 12 | Use a fixed responsive grid (3 columns, labels aligned) and put Apply / Reset in one row after the fields | S |
| UXR2-07 | Med | Sentence case rule broken in three H1s and in the Pods description: "Users & Roles", "Roles & Permissions", "Priorities & Status Labels", "... under Users & Roles". The nav and every other title use sentence case ("Users & roles", "Audit log"). Needs product owner decision on Task Queue / My Work / Pod Work (still Title Case, treated as feature names). | 10, 11, 13 | Rename to "Users & roles", "Roles & permissions", "Priorities & status labels" | S |
| UXR2-08 | Med | Matter detail header: the disabled "Set inactive" and its reason are on their own row indented to x=316, while Edit / New project / Create task in this matter wrap on the right of that row, not on the H1 row. | 04 | Put all actions on the H1 row (secondary first, primary last) and move the reason into a note under the title or into a tooltip with `aria-describedby` | S |
| UXR2-09 | Med | A spurious `autofocus="true"` is rendered on every PrimeNG `p-button`. On Pods, Priorities and Asset link roles the browser focuses the first row button on load, so a focus ring appears on "Edit" / "Add priority" / "Add asset link role" and a screen reader announces it. | 09, 13, 14 | Do not pass `autofocus` to `p-button` (check the wrapper default); verify `document.activeElement` is `body` after load | S |
| UXR2-10 | Low | Search results: the "Sensitive" badge touches the name link ("Smith v Acme[Sensitive]"). | 17 | Add a 8 px gap in `mf-search-hit-table` | S |
| UXR2-11 | Low | Pod Work: the "Pod" label sits directly under the H1 and the select is full width (1012 px) while other filters are 280-400 px. Clients, Matters, Assets: the Search and Status controls sit at different heights (label y=140 vs 159). | 03, 36, 35 | Align filter rows to the bottom with a shared `.mf-filter-row`; cap the Pod select at 360 px; 16 px under the H1 | S |
| UXR2-12 | Low | Form-engine controls differ from page controls: 560 px vs 480 px wide, custom chevron vs native arrow, group headings ("Request details", "Relativity Workspace fields") sit tight on the first label with no spacing, date placeholder `Oct 12, 2026` looks like a value. | 06, 30 | One width token for both, 16 px after group headings, placeholder "mm/dd/yyyy" or the hint only | S |
| UXR2-13 | Low | Undo toast is bottom-left and covers the sidebar footer, while success and error toasts are bottom-right. | 20 | Same corner for all toasts (bottom-right) or offset the Undo toast past the sidebar | S |
| UXR2-14 | Low | Button height 30 px on entity pages and 32 px on lists and p-buttons; Cancel is an outline button on forms but a text link on Create task. | 06 | Same height token; use the outline Cancel on Create task | S |
| UXR2-15 | Low | Wording: "Inactive labels aren't offered for new links" on Asset link roles (glossary: "link role"); "None" for Pod and Project in Create task (glossary: "No pod"); "Design" as a row action (reads as styling; "Edit form"); Task Completed shows two messages ("This task is Completed. Move it back to In Progress to edit." banner and "This task is Completed. Reopen it to edit.") and the first contradicts the Reopen task button. | 08, 06, 18 | Copy pass; keep the banner only | S |
| UXR2-16 | Low | Sidebar at 1280x800 with all groups open: Audit log is below the fold and the nav scrolls with no cue. Groups are expanded by default. | 31 | Collapse Work set-up / Data set-up by default, or add a bottom fade | S |
| UXR2-17 | Low | Remaining internals and titles: audit rows "Form #45 / #46 / #47" and "AssetType 8 and 3 related changes"; tab titles "Edit task type - MatterFlow", "Edit workflow", "Edit step" omit the record name; crumbs "Tasks > New" vs H1 "Create task" and "Project: Mailbox collection". | 12, 27 | Lookup names for forms and asset types in `IAuditDisplayLookup`; add `resolve` titles; drop "Project:" | M |
| UXR2-18 | Low | Users & roles, empty Pending tab: a dashed empty card sits inside a bordered card (double border). Pod editor has no breadcrumb and a gap under the description; Workflow edit stacks a 640 px form card on a full-width version-history card without a gap. | 10, 16 | Remove the outer border for empty state; unify surfaces | S |
| UXR2-19 | Low | Task detail Details tab: "Matter" label baseline is offset from its value in the locked group. Form designer field cards use about 11 px type. | 05, 15 | Align rows; raise to 12-13 px | S |
| UXR2-20 | Low | Asset types row actions "Edit" and "Deactivate" have no accessible row name (the rest of the app has). Counted under UXR2-04 for the fix. | 07 | see UXR2-04 | S |

Counts: High 1, Med 8, Low 11 (20 total).

## 4. Things verified good (keep)

Inline Status, Priority and Assignee on Task detail and tables including **Undo** (Priority back to High verified through the API, "Undone" toast; Assignee undone, audit shows both events); status menu lists result states; Hold opens its dialog; collapsed email panel and persisted choice; view-only notice; sidebar groups and persistence; grouped audit; one inline error with reference and Copy; live search with clear; default Active filter; "Showing x-y of n"; deactivate confirm with consequence text; leave-page guard with Stay focus return; skeleton loading; 0 axe violations in all states; clean console.

## 5. Open questions

1. Assigning an unassigned New task moves it to In Progress; Undo restores the assignee but leaves the task In Progress (documented in batch 4). Is that acceptable, or should Undo restore New?
2. Is Title Case wanted for Task Queue, My Work, Pod Work (proper-noun feature names) while everything else is sentence case? Tell the team so UXR2-07 stops at the three H1s.
3. Should Asset types, Custom fields and Link roles (small configuration tables) get search, sort and paging, or stay as plain tables with only the scroll fix?
4. Not exercised because no data path in this seed: Pod Work table with "Assign to me", My Work with rows, Access Pending, the Task Queue last-view memory, Roles and Pods validation. They follow the same components and are covered by e2e where relevant; worth a quick manual pass in round 3.
5. Screen reader behaviour (announcements, live region for Undo) was not tested with assistive technology, only through axe and DOM inspection.
