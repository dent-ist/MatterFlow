# UX / QA review, round 4

Reviewer: independent UI/UX expert and QA. Build: `dev` at `cfa2110` (2026-10-15). No application code was changed.
Screenshots: `docs/ux/review-round-4/screenshots/` (40 files, referenced as `sNN`).

## 1. Method

- Real stack: SQL Server 2022 in Docker, the published API with Dev auth and `Seed__StarterConfiguration__Enabled=true`, the built Angular app served on one origin, Chromium (Playwright + axe-core). Servers and containers were stopped afterwards.
- Data: 12 clients (one with 26 matters), 49 matters, 16 projects, 33 task types (15 starter + 18 eDiscovery types with 18 different icons), 6 workflows of 3 to 7 steps, 25 reusable steps, 5 pods, 9 people, about 190 tasks (new, in progress, on hold, completed, cancelled; all priorities; overdue, due today, later and no due date; varied ages by SQL back-dating), comments, 40 assets with links.
- Personas: System Admin, Director (dana), Pod Lead (marcus), Data Technicians (jamal, tim), read-only user (Read-Only Observer, vera), a technician role without any Asset permission (nina), a user in Access Pending (newhire).
- Walked about 40 routes at 1280 as admin and 17 routes at 1280 for each of 6 other personas; 20 key routes at 1024, 768 and 375; dashboard at 1920. Axe `wcag2a/2aa/21aa` on every walk plus `best-practice` on 28 routes. Keyboard checks for tabs, drawers, dialogs, the icon picker and the Create Task chooser. Spot-check of all 300 icons on contact sheets (s25 to s28).

## 2. Verdict

**Ship, with a short fix list.** All eight changes work as described, the earlier fixes did not regress, and the suite is green twice. There is no Blocker or High finding. The new screens are consistent in header (icon, H1, breadcrumb, actions), toolbar alignment (all list search boxes and status selects sit at identical offsets), tabs (ARIA tablist, arrow/Home/End, URL sync, Back works) and drawers (modal, focus trap, Esc, focus returns to the opener). Dashboard v4 is fast (tiles visible in about 0.5 s) and clean in axe at 1920.

What to fix before calling the UX done: two real page-level horizontal overflows (Users at 375, Audit Logs at 768), the work/matter tables that still need sideways scrolling at 1280, the icon picker (small viewport, no category navigation, Esc loses focus), and the admin naming mismatches between the menu, the H1 and the document title.

Counts: Blocker 0, High 0, Medium 6, Low 16, Info 1 (23 findings). Axe: 0 violations on 39 of 40 admin/user routes (wcag2a/2aa/21aa); 3 distinct rule hits listed in section 5.

## 3. Findings

Severity: Medium = visible inconsistency or avoidable friction; Low = polish. Effort: S under 1 day, M 1 to 3 days.

### Layout and responsive

**UXR4-01 Medium (S): two screens still scroll the page sideways.** Users at 375 px (page 606 px wide; the table is not inside a scroll wrapper, s20) and Audit Logs at 768 px (page 821 px; the From/To date inputs overflow their grid cells, s38). Everything else tested had no page-level overflow at 1024/768/375. Recommendation: wrap the Users table in the shared scroll wrapper with the "Scroll sideways" hint, give the audit filter grid `min-width: 0` and one column below 900 px. Also add both to the e2e overflow check.

**UXR4-02 Medium (M): task tables still need sideways scrolling at 1280.** My Work (s04, s05), the matter Tasks tab with the 340 px Details panel (s17) and the Task Queue at 1024 (s40) all show "Scroll sideways to see every column" and clip Due/Status (the status chip chevron is cut at the edge in s04). The Title cell is only about 150 px wide, so titles wrap to 2 lines and the "New" badge ellipsizes the title ("Intake: new custodian...", s05). On a matter's own page every row repeats "Client · Matter" under the title, which the header already states. Recommendation: on matter/project pages hide the Matter column and the context line; on My Work put Workflow progress under the title (it is already a second line elsewhere) or drop it below 1360 px; let the Details panel collapse to 300 px or sit above the table below 1280 px.

**UXR4-03 Low (S): task detail H1 carries two icons (s10, s15).** The section icon (list) and the task type icon sit side by side, and at 375 the section icon wraps to its own line above the type icon and number. Recommendation: on task detail show only the type icon (the breadcrumb already gives the section).

**UXR4-04 Low (S): Create Task chooser uses 716 px of 1000 px (s08).** The card grid and the form stop at about 720 px, leaving a 300 px empty strip at 1280; with 33 types the flat alphabetical list is long and the search box is the only way to scan. Recommendation: four columns or full width, and optionally "Recently used" first. Note the "Fill from email" strip is full width of the same column, so it looks wider than the grid.

**UXR4-05 Low (S): Roles tab is a 280 px card in a 1000 px page (s19).** "System Admin" and its badge push the member count to a second line; the right side is empty; rows give no hint that they open a role. Recommendation: full-width table (Name, Description, Members, chevron) like the Users tab.

**UXR4-06 Low (S): Edit task dialog polish (s14).** The "Due Date" label wraps onto two lines and sits higher than "Time (UTC)"; the time input pokes past the column; Create uses "Time" while Edit says "Time (UTC)"; the dialog is 615 px with fields stopping at 480 px. Use one label ("Due date", "Time (UTC)" on both) and the same grid.

### Task type icons and the type chooser

**UXR4-07 Medium (M): the admin icon picker is hard to browse (s23, s24).** 300 icons in 12 categories, but the grid area is only about 310 px tall (3.5 rows) at 1280x800 and 3 rows at 375; there is no category chip row or jump list, so reaching "Production" means scrolling past about 150 icons. Search works well, but browsing does not. Recommendation: taller dialog (use up to 85 vh), a sticky category chip row (All, Review, Production, ...) that scrolls/filters, and keep the live result count.

**UXR4-08 Medium (S, a11y): Esc in the icon picker loses focus.** Opening the picker, pressing Esc closes it and focus lands on `body` (the Skip link is next); picking an icon returns focus to the Icon button correctly. This is the UAT2-03 pattern again. Recommendation: return focus to `#tt-icon` on every close path.

**UXR4-09 Low (S): icon search ranking and matching.** Search matches substrings and keeps catalog order: "tar" returns Rocket, Star, Target, Target sources, Collect folder, Predictive coding; "email" lists "Audio recording" first. Prefix and whole-word matches should rank first. The Create Task chooser search covers name and description only, so "dedup" finds "Data Processing" (description) but not "De-duplication", and "custodian" returns "De-duplication (QA)" through its description. Recommendation: rank (name prefix, word prefix, keywords, substring) and reuse the picker's keyword idea for type names only if admins can edit keywords (open question 3).

Search quality for the requested terms (picker; chooser in brackets): custodian 7 icons led by "Confirmed custodian, Custodian interview, Custodian search, Custodians" (3 types); redaction 2 ("Redaction", "Redaction removal"); legal hold 1 ("Legal hold" shield); production 23; OCR 2 ("OCR", "Text extraction"); dedup 1 ("De-duplication"); duplicate 3; privilege 3; hash 2; bates 4; "zzzz" and a two-word query with no common icon give 0 with a count. Good for eDiscovery.

**UXR4-10 Low (S): a few icons are not distinguishable or have a repeated label (s25 to s28).** "Cloud" and "OneDrive" are the same cloud outline; "Server" and "Servers" are near identical; "Signal" is an unlabeled dashed circle; "Responsive" appears twice in Review (thumbs up and flag-check); "Hash value" and "Forensic fingerprint" share the fingerprint idea. Brand logos (Apple, AWS, Azure, Facebook, Instagram, Slack, X, WhatsApp, ...) are trademarks and are drawn in a different style from the neutral set (see open question 2). Recommendation: rename or drop the duplicates, keep brands only if wanted.

Icon library verdict: the 12 categories are all well populated (General 29, Identification 21, Preservation 18, Collection 25, Processing 26, Review 31, Analysis 28, Production 23, Presentation 17, Data & systems 28, Communication 30, Admin 24) and nearly all icons read correctly for their label in the spot-check of all 300 (legal hold, shredder, mask/eye-off for redaction, OCR frame, Bates stamp, funnel for culling, scales for trial are all good). Weakest: "Email threading", "Keyword" (quote marks), "Demonstrative", "Anonymize".

**UXR4-11 Low (S, a11y): the Icon button's accessible name is "Icon (required)".** The `<label for>` wins over the button text, so the name does not contain the visible "Document / Change icon" (WCAG 2.5.3 label in name; voice control "click Change icon" fails). Use `aria-labelledby` of both the label and the button text.

Icon chunk timing: opening the picker takes about 190 ms to the dialog and about 230 ms to 300 rendered icons (catalog chunk already cached after first use); cold `/tasks` loads in 1.0 s on localhost including all chunks (58 JS files; see UXR4-23).

### Administration

**UXR4-12 Medium (S): admin names do not match the menu (s22, s34, s36).** The menu says "Task Types & Forms", the H1, breadcrumb and document title say "Task types". The menu says "Assets", the H1 is "Asset types and link roles" (documented, but the sidebar then has two entries named Assets: the data list and the admin page, with different icons). The menu says "Labels", the document title says "Priorities" or "Status labels". `/admin/roles` has the document title "Users". Case is mixed: Title Case in "Workflow Steps", "Custom Fields", "Audit Logs", "Task Types & Forms" (menu) and sentence case in "Task types", "New task type", "Asset types and link roles". Recommendation: H1 = menu label exactly for the section roots; document title = H1 + active tab; pick one case rule (the pattern standard says sentence case except menu proper nouns) and apply it to menu and H1.

**UXR4-13 Low (S): admin list toolbars are not uniform.** Pods, Task Types, Workflows, Workflow Steps, Users, Clients, Matters, Projects, Assets share one toolbar (checked numerically: inputs and selects have the same top offset on all 11 lists, labels at the same offset). Asset Types and Custom Fields have no search or status filter, Asset Link Roles and Labels add rows through a card below the table while Asset Types uses a header button (s34 to s36). Recommendation: give Asset Types the same toolbar and decide one add pattern.

**UXR4-14 Low (S): Users tab opens on "Pending access (2)" when anyone is pending (s18).** The admin lands on a two-row list and must change the filter to see the 9 active users. The status text says so, but it is easy to read as "this is everyone". See open question 1.

**UXR4-15 Medium (S): grouped audit rows show no Object (s37).** In the default "Group events of one operation" view the Object column is empty for grouped rows ("Status changed from New to In Progress and 1 related change"), so you cannot tell which task changed without expanding. Ungrouped rows show "User: ke\tim". Also the Activity drawer still says "Assigned to Analytics Pod (pod)" (s13, UAT2-14 leftover). Recommendation: show the object link of the first event on the group row; drop "(pod)".

**UXR4-16 Low (S): small control inconsistencies.** On the queue row "Filters" is 40 px high and "Columns" 32 px (s03, s04); on client detail "Create matter" is top-aligned (button top 206, input top 207, heights 32 vs 40) so it sits 4 px above the input centre (s16); "Edit" has a pencil but "Set inactive" has no icon next to it (the standard says icons only on create actions).

### Dashboard, queues, detail pages

**UXR4-17 Low (S): Open by task type is dominated by "Other" (s02).** With 33 types the top 5 account for 36% and "Other task types" is 64%, so the card says little. Type icons beside the labels are about 12 px (smaller than in queues). Recommendation: show the top 8 to 10 and a link to the table; use the `sm` 16 px icon.

**UXR4-18 Low (S): wording.** The task header says "Due Oct 15, 2026 · Due soon" for a task due today, the queues say "Due today" (s10 vs s05). A search term shows as a chip "Search: TSK-48" beside the search box that already shows it, and counts as one filter ("Filters (1)", s39).

**UXR4-19 Low (S): small My Work items.** With 2 tasks the near-empty line ("That's everything on your plate...") sits beside the full pager "Showing 1-2 of 2 / Rows per page" (s06); at 375 the four tabs wrap to two rows and the second row has no underline (s07). The "New" marker works (visible once, gone at the next visit, s05).

**UXR4-20 Low (S): focus start differs between drawers.** Task Activity focuses the "All" filter chip; Client and Matter Activity focus the Close button. Pick one (Close, or the heading).

### Accessibility (details in section 5)

**UXR4-21 Low (S): contrast.** My Work zero-count text (`.count--zero`, #6b7280 on #f5f6f8) is 4.47:1 (needs 4.5), reported as serious by axe on My Work for every persona; the PrimeNG success toast ("Draft saved") fails `color-contrast`.

**UXR4-22 Low (S): `landmark-unique`.** The global search region (`.mf-gs`) is reported as a duplicate landmark on about half of the routes (best-practice, moderate). Give it a unique label or remove the role.

**UXR4-23 Info: cold load of `/tasks` pulls 58 JS chunks.** About 1.0 s on localhost; fine behind HTTP/2 or with a preload list, worth a performance check on the real network (the icon chunks are about 100 kB combined).

## 4. Cross-screen inconsistencies (summary)

1. Search placement: left of Filters on the Task Queue, right of the tabs on My Work (PO-approved), above the table on entity lists; the label "Search" is visible on lists but absent on queues.
2. H1 text vs menu label (UXR4-12); case rules.
3. Add pattern: header button (Pods, Task Types, Workflows, Asset Types), button inside the tab (New role), card below the table (Link Roles, Labels).
4. Two icons in the task H1; one everywhere else.
5. Button heights (32 vs 40) and icon use on Edit vs Set inactive.
6. Tab pattern is consistent (ARIA tablist with URL sync on Dashboard, Users, Matter, Assets admin, My Work; route-link `nav` on Labels, which is visually identical).
7. Time label "Time" (Create) vs "Time (UTC)" (Edit).

## 5. Test and axe results

- **Playwright e2e (`frontend/e2e/run-local.sh`): run 1 (fresh build) 121 passed, 0 failed, 0 flaky (2.4 min). Run 2 (`E2E_SKIP_BUILD=1`) 121 passed, 0 failed, 0 flaky (2.4 min).** Regression areas covered by the suite: inline Status/Priority/Assignee, bulk-complete, comments, audit grouping, Create Task email intake, type-first chooser, task detail layout, page header icons, admin menu.
- Manual regression checks: inline priority change shows "TSK-48 priority set to Low. Undo", Undo restores it (s39); status menu Esc returns focus to its button; the bulk-complete dialog lists the 4 open steps and focuses Cancel; comment composer posts; `?tab=activity`, `?tab=comments` old links work; Create Task: arrow keys move focus without choosing, Enter chooses and focuses Matter, Change type returns to the grid.
- Backend: see section 7.
- **Axe wcag2a/2aa/21aa, admin walk (39 routes at 1280): 1 serious** (My Work `.count--zero` contrast 4.47:1, UXR4-21). Other personas (6 x 17 routes): only the same My Work/Pod Work hit. Key states: icon picker dialog 0, Activity drawers 0, Edit dialog 0, chooser and form 0, workflow designer 0, publish dialog 1 (toast contrast). 375 px: only the same My Work hit.
- **Axe best-practice (28 routes):** only `landmark-unique` (UXR4-22). Heading order is valid (task: H1, H2 Workflow, H3 per step, H2 Comments, Details, Assets).
- **Console and network:** no console errors or warnings and no 4xx/5xx on any walked route for any persona (UAT2-19 `/me/pods` 403 and NG0956 are gone).
- **Permissions:** read-only user sees no Edit, Create or Complete actions and a "View only" line; the no-asset persona has no Assets menu item and `/assets` gives 403; Pod Lead is blocked from Users, Task Types and Audit with a 403 page; Access Pending redirects every route.
- **Performance:** dashboard tiles visible in 488 ms (1920 px), icon picker 190 ms; `/tasks` cold 1.0 s.

## 6. Verified good

Admin menu order and labels exactly as requested; Users/Roles tabs and Assets tabs with `?tab=` and legacy-URL redirects; Back/Forward through tabs; flat Pods/Task Types/Workflows toolbars aligned; client/matter/project layout with the Details panel and the Activity drawer; workflow step search (debounced, count, no-results text), badges, "Added" state with focus moving to the next addable step, publish dialog diff (Added badge plus Impact); task detail with only the current step expanded, Jump to, Edit dialog with focus return; dashboard v4 tiles and the ASAP tile; section icon in every H1 (aria-hidden, headings read correctly); type icon in rows, header, dashboard and admin list; the type chooser with radio-group keyboard behaviour and search count.

## 7. Backend tests

Run against Testcontainers SQL Server 2022: integration tests for the touched modules (filter Tasks, Configuration, Seeding, Organization) **260 passed, 0 failed (9 min 12 s)**; unit tests **1050 passed, 0 failed**.

## 8. Open product questions

1. Users tab default: keep "Pending access" as the default while anyone is pending, or always open on Active with a pending banner?
2. Brand logos in the icon library: acceptable to ship trademarks (Apple, AWS, Slack, X, ...) in a firm tool, or limit to neutral icons?
3. Should type search (chooser) be extended with admin-editable keywords or synonyms (dedup/de-dupe, TAR/CAL)?
4. Should the chooser group types (by EDRM stage or a "category" on the type) once there are more than about 20?
5. On task detail, should the section icon be dropped in favour of the type icon (UXR4-03)?
6. Matter task tables: is Status/Due more important than the Details panel at 1280 (UXR4-02)?

## 9. Cleanup

The API process, the `r4-sql` container and the e2e containers were stopped. Scratch scripts (seed, walks, axe) are in the session scratchpad `r4/` folder and are not committed.

## 10. Round 4 fixes

Status of every finding after the fix round (branch `dev`). Screenshots of each fixed screen are in `docs/ux/review-round-4/fixes/` (named `uxr4-NN-...`). Regression tests: `frontend/e2e/tests/ux-round-4.spec.ts` (one scenario per finding) plus unit specs next to the changed components.

### 10.1 Product-owner decisions (answers to section 8)

1. **Users tab default (UXR4-14):** unchanged. It opens on "Pending access" only while someone is waiting, otherwise on Active. The "N waiting for access" cue and the status line stay.
2. **Brand logos (UXR4-10):** removed. The icon library has no trademarked third-party logos; the 23 `brand-*` icons were replaced by generic ones (cloud storage, cloud network, cloud drive search, shared folder, video meeting, screen sharing, social media, website, forwarded message, ...), so it is still 300 icons with the same per-category counts. The contract (`contracts/task-type-icons.json`), the API allow-list, the generator and the frontend catalog are regenerated together; the generator now also refuses duplicate labels and trademarked names. New script `21-task-type-icon-retire-brands.sql` (script 16 stays unused) moves any Task Type that stored a removed key to its generic replacement, so every stored `IconKey` stays valid; the API refuses a retired key with `UNKNOWN_ICON`. The allow-list parity tests pass unchanged.
3. **Admin-editable search keywords:** not built. Icon search keeps its built-in keywords; the Create Task chooser search covers name and description, with name matches first.
4. **Chooser grouping by category:** not needed now; not built.
5. **Task detail H1:** shows the task type icon only (the section icon is no longer drawn there; the breadcrumb gives the section).
6. **Matter page priority:** Status and Due win over the Details panel between 1100 and 1399 px. The Details panel can be collapsed there (it starts collapsed and the choice is remembered); from 1400 px it is always open at 340 px. The matter and project Tasks grids no longer repeat "Client · Matter" under the title.

### 10.2 Per finding

| Finding | Status | What changed |
| --- | --- | --- |
| UXR4-01 | Fixed | Users: the flex column no longer lets the list grow to its widest row at 375 px (no page scroll; the table scrolls inside its wrapper). Audit Logs: filter grid cells have `min-width: 0` and the grid is one column below 900 px. Both are in the e2e overflow check (Users, Roles, Audit at 375 and 768). |
| UXR4-02 | Fixed | The work table measures its box. Below 1100 px Workflow progress moves under the title ("2 of 6 steps · Dedup"), below 960 px the Matter column drops (the line under the title still names client and matter), below 800 px Project drops. My Work and Task Queue fit at 1280 and 1024 px, the matter Tasks grid at 1280 px, with Status and Due fully visible (e2e asserts no inner scroll). The "New" pill moved to the line under the title, so it can no longer ellipsize it. Matter and project grids drop the repeated context line (`hideContext`). The Details panel is collapsible between 1100 and 1399 px (see 10.1). Below about 860 px (tablet portrait) wide tables still scroll sideways inside their wrapper with the hint, as before. A user who picked the Workflow progress or Matter column still gets them on wide screens. |
| UXR4-03 | Fixed | Task header passes `icon=""`: only the task type icon is shown, also at 375 px. |
| UXR4-04 | Fixed (part deferred) | While choosing a type the page is one full-width column (cards and email strip). "Recently used" first is deferred (needs per-user history). |
| UXR4-05 | Fixed | Roles is a full-width list with Name, Description, Members and a chevron; it narrows to the old 280 px list while a role is open for editing. |
| UXR4-06 | Fixed | Create and Edit both say "Due date" and "Time (zone)"; the Edit dialog uses a two-column grid so the labels sit on one line and the time input stays inside its column. |
| UXR4-07 | Fixed | Dialog is 60 rem wide and the grid area is 90 vh minus the chrome (about 500 px at 1280x800, 410 px at 375x700, up from 310 and 3 rows); sticky category buttons (All plus 12, each with a count that follows the search) filter the grid; the live result count stays. |
| UXR4-08 | Fixed | The picker explicitly returns focus to the Icon button after the dialog hides, in addition to `mfDialogFocus`. I could not reproduce the loss in dev (Esc from the search box and from an icon both returned focus), so the e2e covers click, Enter, Esc and Esc from the search box. |
| UXR4-09 | Fixed | Icon search ranks: whole label, whole word, label word start, key/keyword word start, then substring ("tar" lists Predictive coding (keyword TAR) and Target before Star and Rocket); while typing the matches are one best-first list. Chooser search ranks name matches first and ignores hyphens ("dedup" finds "De-duplication"). |
| UXR4-10 | Fixed | See 10.1 item 2; "Server/Servers", "Signal", "Cloud/OneDrive", "Responsive" (twice, now "Flagged responsive") and "Hash value/Forensic fingerprint" are gone or distinct, and a unit test fails on any repeated label. |
| UXR4-11 | Fixed | The Icon button is named by `aria-labelledby` = field label + its own visible text ("Icon (required) Document Change icon"). |
| UXR4-12 | Fixed | H1 = menu label: "Task Types & Forms" (also breadcrumb and form-page crumb), "Workflows", "Workflow Steps", "Labels", "Custom Fields", "Audit Logs", "Users". Document title = page plus open tab: "Users" / "Users - Roles", "Labels - Priorities" / "Labels - Status labels", "Asset Types & Link Roles - Asset Types" / "... - Link Roles". The menu label stays "Assets" for the administration item (it sits under the Administration heading, with a different icon); its page has the breadcrumb "Administration > Assets" and the H1 "Asset Types & Link Roles", so it cannot be mistaken for the Assets data list. Case rule: Title Case for section names that are menu labels, sentence case for everything else. |
| UXR4-13 | Partly fixed | Asset Types has the same search box and status filter as the other lists (server side, everything shown until narrowed). Custom Fields (five fixed objects) keeps no toolbar. The add pattern is unchanged: header action for top-level lists, a button inside the tab for tabbed pages, the inline add card for Labels and Link Roles; one pattern for all would be a larger redesign and is deferred. |
| UXR4-14 | Decision | Unchanged, see 10.1. |
| UXR4-15 | Fixed | A grouped audit row has its own Object cell (link to the object of the first thing that happened). The Activity drawer and the audit log no longer say "(pod)" (`Assigned to Analytics Pod`); backend narrator, audit text and their tests changed. |
| UXR4-16 | Fixed | Columns is as high as Filters (40 px); Create matter is vertically centred on the search input; the pencil is gone from Edit (icons on create actions only). |
| UXR4-17 | Fixed (part deferred) | The dashboard lists the top 8 task types (was 5) before "Other task types", and the type icons are the 20 px size. A drill-through for the "Other" row is deferred (the Task Queue cannot express "all but these"). |
| UXR4-18 | Fixed | Header due line says "Due today" and "Tomorrow" like the queues (then "Due soon"); the search term is no longer a chip and no longer counts in "Filters (n)". |
| UXR4-19 | Fixed | My Work tabs stay on one row (they scroll sideways inside their strip on a phone) with the underline under every tab; the "That's everything on your plate" line shares the row with the pager. |
| UXR4-20 | Fixed | Every Activity drawer opens with focus on its Close button. |
| UXR4-21 | Fixed | The zero count uses the muted text colour (7.6:1); toasts (success, info, warn, error) use dark text of the same hue on the pale tint (7:1 or better). |
| UXR4-22 | Fixed | The global search region is named "Search MatterFlow", so it is a distinct landmark from page-level search regions. |
| UXR4-23 | No change | Information only. 58 chunks load in about 1 s on localhost; revisit with a real-network performance check. |

Not in the review but found while fixing: the dashboard "Age of open tasks" bar (`a.seg` with `role="listitem"`) is reported as a minor best-practice `aria-allowed-role`; left as is.
