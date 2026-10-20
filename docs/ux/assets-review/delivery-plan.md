# Assets (user-facing) UX review: delivery plan

Owner approval: "I like all of your recommendations, so please don't wait for me. create epics / issues and continue working" (2026-10-20), with product decisions delegated to the PM ("you can make decisions for me"). Decisions are recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-20, base `origin/dev` (Clients epic #245, Task Detail epic #288 and the Task Types epic #352 largely built; their shared components are on dev). Source review: `README.md` in this folder (13 findings A1 to A13, 6 bugs BUG-1 to BUG-6, 35 screenshots in `screenshots/`, one mock in `mocks/`).

Structure on GitHub: one epic **#485** (labels `epic` + `phase-12`), 32 sub-issues **#486 to #517** (label `phase-12`; the numbers are in creation order: the ten first-release issues come first, then the packages in order). None is decided "not now". Folded IDs (named in the host issue title, nothing dropped): A5 skeleton and A2 reference/BUG-5 in #489 and #500; A2 (rows) and A11 in #497, #496 and #501; A1 in #490, #493 and #506; A7 in #492 and #507; A13 and BUG-4 in #494; section 3 item 6 in #495; A10 in #511 and #512; decisions (c) and (d) of the review in #513; BUG-1 in #487 (list), #493 (detail) and the matrix #515. "Verified good" items (total counts equal the API, hidden-inactive hint with Show all, URL state survives reload, required-field blocking, 0 axe violations on the current list, filters, panel and new page, no horizontal scroll at 375) are regression tests only.

Issues blocked on an owner decision: **none**. The four decisions the review put to the owner (section 6) are decided: (a) the record page replaces master-detail (owner approved all recommendations; recorded below as a PM decision superseding `docs/ux/assets-screen`), (b) `linkedTaskCount` is added to the API (plus `openLinkedTaskCount`), (c) the type form's "Status" field is labelled "Lifecycle", (d) assets are Inactive/Active, S08's "Retired" is corrected.

Effort is in **AI-agent hours** (wall-clock of one developer agent, including unit, integration, e2e, axe and screenshots). The review estimated 58 hours; the plan is **87.5** because the review's package totals did not include the two additive API changes (#496, #504, 7 h), the summary strip, the dialog impact line, the record page phone pass, the retirement of the master-detail code and docs, the permission matrix, the docs package and the final verification (about 22 h together), and the Linked tasks tab needs the due and assignee data from the API. The first release is **26.5 hours** (ten issues).

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package |
|---|---|---|---|---|---|
| #486 | BUG-6 | BUG-6 (API): One POST /assets returned 500; find the cause and make a lost race a retryable 409 w... | 3 | None. First release. | WP-AS1 (R1) |
| #487 | BUG-1 (list) | BUG-1 (list): Matter references in the Assets list are links only with Matter.View | 1.5 | None. First release. | WP-AS1 (R1) |
| #488 | BUG-3 | BUG-3: The asset name in the list is a real link to the record page | 1 | None. First release. | WP-AS1 (R1) |
| #489 | BUG-5, A2 (reference) | BUG-5: The external reference is one line with an ellipsis, a tooltip and a copy button; rows no ... | 1.5 | None. First release. | WP-AS1 (R1) |
| #490 | A1 | A1 (header): Asset record page at /assets/:id with the shared record header, skeleton and actions | 6 | None (Clients/Task Detail headers on dev). First release. | WP-AS2 (R1) |
| #491 | BUG-2 | BUG-2: Honest asset load states: 404, no access and 5xx each say what happened, with the referenc... | 2 | #490 | WP-AS2 (R1) |
| #492 | A1, A7 | A7 (tabs): Record page tabs Details, Linked tasks (n) and History with counts and a URL key | 3 | #490 | WP-AS2 (R1) |
| #493 | A1, BUG-1 (detail) | A1 (Details tab): Details tab with the matter link by permission, reference, description, type fi... | 4.5 | #490, #492, #487 | WP-AS2 (R1) |
| #494 | BUG-4, A13 | BUG-4 / A13: Focus goes to the record heading; Back returns to the list with focus on the row; ol... | 2.5 | #490, #492 | WP-AS2 (R1) |
| #495 | Section 3 item 6 | Inbound links: the Matter Assets tab, the Task page Assets tab, search and activity open /assets/:id | 1.5 | None. | WP-AS2 (R1) |
| #496 | A2, A11 (API) | API (additive): linkedTaskCount and openLinkedTaskCount on the asset list and detail, and sort by... | 4.5 | After #486 (serial on AssetService.cs and OpenAPI) | WP-AS3 |
| #497 | A2 | A2: List rows are 44 px with the Name link, Type, Matter number, Status and a clamp for long values | 4 | #487, #488, #489, list kit #543/#544/#575/#579 | WP-AS3 |
| #498 | A2 (Linked tasks) | A2: Linked tasks column (open count, links to the Task Queue filtered to the asset, hidden withou... | 2 | #496, #497 | WP-AS3 |
| #499 | A3 | A3: List chrome like Clients: filter row open from 640 px, Filters and Clear in the page header | 2.5 | #497, list kit #543/#544/#575/#579 | WP-AS3 |
| #500 | A5 | A5: List loading skeleton and state rows follow the grid-body contract | 2 | #497, #499 | WP-AS3 |
| #501 | A11 | A11: Sort the list by Matter (and keep Name and Type) | 1 | #496, #497 | WP-AS3 |
| #502 | A4 | A4: Assets phone cards below 640 px and the narrow-window column drop at 768 | 4.5 | #497, #498, list kit #543/#544/#575/#579 | WP-AS3 |
| #503 | A9 | A9: Skip to table link and one Tab stop per row on the Assets list | 2.5 | #497 | WP-AS3 |
| #504 | A8 (API) | API (additive): due date, assignee and open flag on each linked task | 2.5 | After #496 (serial on the OpenAPI file) | WP-AS4 |
| #505 | A8 | A8: Linked tasks tab with the shared Due and Assignee cells, Role, sort by due, a tab count and a... | 5 | #496, #504, #492 | WP-AS4 |
| #506 | A1 (strip) | A1 (summary strip): Open, Overdue, Linked and Created/Modified in the shared summary strip | 2.5 | #490, #496, #504 | WP-AS4 |
| #507 | A7 (dialog) | A7: Set inactive / Set active dialogs say how many open linked tasks keep the asset | 2 | #490, #496 | WP-AS4 |
| #508 | A12 | A12: Long text on the record page: description clamped at 6 lines with Show more, reference as on... | 2 | #490, #493 | WP-AS4 |
| #509 | A4 (record) | A4: Record page at 375 and 768 (header, tabs, strip and tab content) | 2.5 | #493, #505, #506, #490 | WP-AS4 |
| #510 | A1 (cleanup) | Retire the master-detail panel: remove the panel code, the selected parameter and update docs/ux/... | 3 | #490, #493, #505, #507, #495, #494 | WP-AS4 |
| #511 | A10 (New) | A10 (New asset): New asset page on the Create task form pattern with sections, the real matter fo... | 3 | Task Detail #322, Task Types #361 (on dev) | WP-AS5 |
| #512 | A10 (Edit) | A10 (Edit asset): Edit page shows status, type badge and matter link; matter and type stay locked | 2.5 | #511 | WP-AS5 |
| #513 | Section 3 item 5, decisions (c), (d) | Vocabulary: the type form's Status field is called Lifecycle in the seeded asset types; S08 says ... | 1.5 | None. | WP-AS5 |
| #514 | Section 5 | Keyboard and axe audit of the Assets list, record page and forms with Tab-stop evidence | 2 | All code issues | WP-AS6 |
| #515 | BUG-1 (matrix), Section 3 item 3 | Permission matrix and denial rule for the Assets area: no dead links, no failing requests, no 403... | 2.5 | Task Types #416; WP-AS1 to WP-AS5 code | WP-AS6 |
| #516 | Docs | Docs: ux-spec S08 rewritten to the record page, decisions addendum section AA, UAT rows, e2e cata... | 3 | All code issues | WP-AS7 |
| #517 | Verification | Final verification pass for the Assets area | 4 | All issues | WP-AS7 |

Total: **87.5 agent-hours** (32 issues). R1 = first release. Review ID to issue: A1 #490 (header), #493 (Details tab), #506 (strip); A2 #497, #498 (API #496); A3 #499; A4 #502 (list) and #509 (record page); A5 #500; A7 #492, #507; A8 #505 (API #504); A9 #503; A10 #511, #512; A11 #501 (API #496); A12 #508; A13 #494; BUG-1 #487, #493, #515; BUG-2 #491; BUG-3 #488; BUG-4 #494; BUG-5 #489; BUG-6 #486; cleanup #510; vocabulary #513.

## 2. Decisions (PM) in one place

- **The record page replaces master-detail (supersedes `docs/ux/assets-screen`).** The owner approved all recommendations of the review, including A1. `/assets/:id` becomes a record page like Clients, Matters and Projects: `mf-record-header` (new `RecordKind` `asset`; crumb, clamped title, type badge, Active/Inactive badge), the action rule **Edit, Activity, overflow** (Set inactive / Set active in the overflow; no primary action because linking is made from the Task page), a summary strip (Open, Overdue, Linked, Created, Modified) and `mf-tabs` **Details | Linked tasks (n) | History** with `?tab=` replaced not added. The list keeps its full height and Back returns to the exact list address with focus on the row. The details panel, its `pg-tabs`, the `?selected=` parameter, the 60/40 fixed-height split and the Esc-closes-panel handler are **retired** (#510); old `/assets?selected=:id` links redirect once to `/assets/:id` (#494). The column-filter part of the `assets-screen` document still applies. The decisions addendum section AA records this explicitly (#516).
- **No new or changed keyboard shortcuts in this phase** (owner decision; Phase 2 backlog #420). Accessibility mechanisms are in scope: a skip link, one Tab stop per row, focus to the heading and back to the row, names. The review's "copy by right arrow" is not built; the copy button leaves the list row (reference copy stays on the record page). Esc no longer closes anything because the panel is gone; that is a removal with the panel, not a changed shortcut.
- **Matter links follow permissions (decision V).** A matter reference is a link only with `Matter.View` (one shared helper, list and record page); the form schema is requested only when it can succeed, and a muted sentence replaces the type fields otherwise (#487, #493). Task items (counts, Linked tasks, strip) are absent for people without `Task.View`; History needs `Audit.View`.
- **Counts (additive API).** `linkedTaskCount` (all) and `openLinkedTaskCount` (New, In Progress, On Hold) on the list and the detail, `null` without `Task.View`, computed by one grouped query through `IAssetTaskLinkReader`; list column shows the open count, tooltip and tab show the total; new sorts `matter` and `linkedTaskCount` (#496). Due date, assignee, priority, open and overdue flags on each linked task (#504).
- **List contract.** 44 px rows, name is the only link (a real `a`), matter number plain text (link with `Matter.View`, no second line, no copy button), reference on one line with ellipsis from 1280 px, Status badge only for Inactive, phone cards below 640 px, filter row open from 640 px with Filters and Clear in the header, shared skeleton and state rows. **Reuse of the Admin pages list kit:** the Admin pages epic owns the shared admin list kit (chrome, columns, row menu, states, phone-card renderer); the Assets list uses it where it fits (rows, chrome, states, cards) and otherwise the Clients implementation, and never waits for it. Kit issues of the Admin pages epic #518 used here: #543 (one admin table stylesheet and the 44 px cell patterns, for the rows), #544 (list shell with Filters, primary action and Skip to table, for the chrome and the skip link), #575 (grid-body states, for the skeleton and error rows) and #579 (phone cards and the 768 column-drop order, for the cards). Not used: #554 row overflow (Assets list rows have no menu), #545 counted route tabs, #564 lookup dialog, #581 health strip, #583 control kit, #542 dialog wording, #588 titles (admin routes only).
- **BUG-6 (the single `POST /assets` 500).** The cause is investigated and recorded; a deadlock victim (SQL 1205) is retried once and otherwise returned as 409 `CONCURRENCY_CONFLICT`, as `UserAdministration` (SEC-17) and `WorkflowAdminService` already do; the deliverable is a regression test that fails before the fix. "Not reproduced" is not accepted as a reason to close (#486).
- **Forms.** New and Edit asset use the Create task pattern and the shared form stack (record-header-style title, one input width, sections `Asset` and `<Type> fields (n)`, validation summary, sticky footer, leave guard); the matter placeholder uses the real format `90001-80011`; matter and type stay locked on Edit (#511, #512).
- **Vocabulary.** Assets are **deactivated / Inactive**; published versions are retired. The type form's "Status" select is relabelled "Lifecycle" (label only, no data change); S08 "Retired" becomes "Inactive" (#513).
- **Dialogs.** Set inactive uses the shared `impactLine()` helper (open linked tasks keep their link) and drops the sentence when the count is unknown (#507).
- **Denial rule.** The Task Types rule #416 applied to Assets: a tab the person cannot see falls back to Details, create/edit URLs without the permission show the 403 page (#515).
- **Out of scope.** Linking and unlinking (Task page, Task Detail epic), a Task Queue filter by asset (raised separately if missing), the Asset Types and Custom Fields screens and the form designer (Task Types epic #352), the Users, Admin pages and Search pages (their epics), dark theme, real screen-reader testing, forced colours, 200% zoom, print, exports, saved views, keyboard shortcuts (#420).

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes and never hand-merge them, run unit + integration + e2e + axe (0 violations at 1366, 1920, 768 and 375, with menus, dialogs and sheets open) and assert no page-level horizontal scroll, attach screenshots in `docs/ux/assets-review/fixes/<package>/` (`as1-defects`, `as2-record-page`, `as3-list`, `as4-record-complete`, `as5-forms`, `as6-keyboard-permissions`, `final`), keep the initial bundle at its current size, do not add rules to `task-table.scss`, add no keyboard shortcut, update the docs named in the issue (WP-AS7). Shared files (`record-header.ts`, `record-state.ts`, `record-skeleton.ts`, `tabs.ts`, `work-strip.ts`, `page-header.ts`, `drill.ts`, `grid-body.ts`, `action-menu.ts`, `confirm-dialog.ts`, `record-card-list.ts`) serve other pages: additive changes only, their specs are the regression tests.

| Rank | WP | Issues | Main files / areas | Agent-h | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP-AS1 Defects | #486, #487, #488, #489 | `assets-list-page.ts` (matter cell, name, reference), `AssetService.cs`, `AssetsApiTests.cs` | 7 | everything | - | **#486 backend** (no SQL unless an index is found: script 28) |
| 2 | WP-AS2 Record page core | #490, #491, #492, #493, #494, #495 | `assets.routes.ts`, new `asset-record-page.ts` and `asset-details-tab.ts`, `record-header.ts` / `record-state.ts` / `record-skeleton.ts` (additive kind), `list-return`/`drill.ts` (use), `matter-assets.ts`, `task-asset-links.ts`, `audit-links.ts` (route constants) | 19.5 | WP-AS1, WP-AS3 (API), WP-AS5 | - | Frontend only |
| 3 | WP-AS3 List contract | #496, #497, #498, #499, #500, #501, #502, #503 | `assets-list-page.ts`, `AssetService.cs`, `AssetDtos.cs`, `IAssetTaskLinkReader`, `TaskAssetLinkReader.cs`, OpenAPI | 23 | WP-AS2, WP-AS4, WP-AS5 | WP-AS1 (same list file) | **#496 backend** (additive, no SQL) |
| 4 | WP-AS4 Record page completion | #504, #505, #506, #507, #508, #509, #510 | `asset-record-page.ts`, `asset-linked-tasks.ts`, `asset-details-tab.ts`, `AssetContracts.cs`, `TaskAssetLinkReader.cs`, OpenAPI, docs/ux/assets-screen | 19.5 | WP-AS3, WP-AS5 | WP-AS2; #504 before #505; #510 last | **#504 backend** (additive, no SQL) |
| 5 | WP-AS5 Forms and vocabulary | #511, #512, #513 | `asset-form-page.ts`, seed label / `db/scripts/28-*.sql` (only if the seed is SQL) | 7 | WP-AS1 to WP-AS4 | #490 for the landing page | **#513: SQL script 28 only if needed** |
| 6 | WP-AS6 Keyboard and permissions | #514, #515 | e2e specs, `assets.routes.ts`, small fixes | 4.5 | none (late) | WP-AS2 to WP-AS5 | none |
| 7 | WP-AS7 Docs and final verification | #516, #517 | `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `docs/qa/e2e.md`, `docs/architecture.md`, `frontend/e2e/*` | 7 | none | all | none |

Total: about **87.5 agent-hours**.

**Backend work and SQL.** Backend issues: #486 (BUG-6 fix and regression test), #496 (counts, sorts), #504 (linked-task fields); all additive, in this serial order on `AssetService.cs` and `contracts/openapi/v1.json`. SQL script numbers: **last used 27, 28 is free**. None is planned; #486 (only if the investigation finds a missing index), #496 (only if the performance test shows a scan on the link table) and #513 (only if the seeded label lives in SQL) may each need one; whichever lands first takes 28 and the others take the next free number at implementation time (other epics may also claim 28; check `db/scripts` before choosing).

### First release (do these first, about 26.5 hours)

The defects that hurt today and the record page that removes three of them at once: #486 BUG-6 (the 500, 3 h), #487 BUG-1 dead matter links in the list (1.5 h), #488 BUG-3 name is a real link (1 h), #489 BUG-5 one-line reference (1.5 h), and the record page core #490 (header, 6 h), #491 BUG-2 honest states (2 h), #492 tabs (3 h), #493 Details tab with BUG-1 for the detail and no failing schema request (4.5 h), #494 BUG-4 and A13 focus, return and redirect (2.5 h), #495 inbound links (1.5 h). After it, `/assets/:id` is a page, nothing on the Assets pages leads to a 403, the grid has its height back and the 500 is a retryable 409. Four lanes run in parallel; wall-clock of the release is about 16 hours (lane B: header, states, tabs, then focus = 13.5 h; lane D's Details tab starts when the tabs land).

### Waves for 3 to 4 parallel developer agents

Lanes are file owners, not people: one agent owns one lane's files for the whole epic, which is what removes merge conflicts. Lane A owns `assets-list-page.ts` and its specs, lane B the record page shell, lane C the backend and routes/docs, lane D the New/Edit forms and the record page tab contents.

- **Wave 1 (first release plus forms)**
  - Lane A (8 h): #487, #488, #489, #497
  - Lane B (13.5 h): #490, #491, #492, #494
  - Lane C (7.5 h): #486, #496
  - Lane D (11.5 h): #495, #511, #512, #493 (#493 starts when #492 has merged)
- **Wave 2**
  - Lane A (7.5 h): #499, #500, #498, #501
  - Lane B (4.5 h): #506, #507
  - Lane C (4 h): #504, #513
  - Lane D (7 h): #505, #508
- **Wave 3**
  - Lane A (7 h): #502, #503
  - Lane B (5.5 h): #510, #509
  - Lane C (2.5 h): #515
- **Wave 4 (late)**: Lane A (2 h): #514
- **Wave 5 (docs)**: Lane C (3 h): #516
- **Wave 6 (verification)**: Lane B (4 h): #517

Lane totals: A 24.5 h, B 27.5 h, C 17 h, D 18.5 h. With four agents the wall-clock is about **35 hours**; one agent alone needs 87.5. Three agents: fold lane D into lanes B and C and the wall-clock is about 50 hours.

Dependency rules between lanes: #493 (lane D) needs #490, #492 and #487; #497 needs the three small list edits of its own lane; #498 needs #496 (lane C); #505 needs #496 and #504; #494 edits a few lines of the list file after lane A's first four issues; #510 needs #505, #507, #495, #494; #509 needs the tab contents; #515, #514 need all code lanes.

### Exact first wave

1. Lane A: #487, #488, #489 (one list file, serial), then #497. 2. Lane B: #490, then #491, #492, #494. 3. Lane C: #486 (backend, first), then #496. 4. Lane D: #495, #511, #512, then #493 as soon as #492 has merged.

### Critical path

Lane B: #490 6, #491 2, #492 3, then (via lane D's #493 4.5 h, #505 5 h, which waits for lane C's #496 and #504) #510 3 and #509 2.5, then #514 2, #516 3 and #517 4: about 35 hours. Lane A (24.5 h) and lane C (17 h) have 3 to 10 hours of slack.

### Hot spots (merge-conflict watch)

- **`assets-list-page.ts`** (606 lines) and its spec: #487, #488, #489, #497, #499, #500, #498, #501, #502, #503, in lane A order; #494 (a few lines for the return link) and #510 (deleting the panel) are the only outside edits: rebase on lane A's latest.
- **`assets.routes.ts`, `asset-record-page.ts`**: #490, #491, #492, #494, #506, #507, #509, then #515 (route guards); lane B, one agent. The tab contents live in their own files (`asset-details-tab.ts`, `asset-linked-tasks.ts`) so lane D does not touch the shell.
- **`asset-details.ts`**: source for #490 and #493; read, not edited, until #510 deletes what is left.
- **`asset-form-page.ts`**: #511 then #512; lane D only. Not related to the Asset Types designer (Task Types epic).
- **`AssetService.cs`, `AssetDtos.cs`, `IAssetTaskLinkReader`, `contracts/openapi/v1.json` and the TS client**: #486, #496, #504 each regenerate the same two files: merge in that order, lane C only.
- **`shared/ui/record-header.ts`, `record-state.ts`, `record-skeleton.ts`, `tabs.ts`, `work-strip.ts`**: additive kinds and options only; the Client, Matter, Project, Task and Task Types page specs are the regression tests.
- **`matter-assets.ts`, `task-asset-links.ts`, `audit-links.ts` and the search result link helper**: #495 changes route constants only; the Search epic owns the Search page (rebase on it).
- **Docs**: `decisions-addendum.md` and `ux-spec.md` are edited by every epic's docs issue (Admin pages, Users, Search, Assets): pull and rebase right before pushing #516.
- **Tests**: `assets-screen.spec.ts`, `assets-screen-screens.spec.ts`, `assets.spec.ts` and `assets-pages.spec.ts` select the button, the panel and `?selected=`; the issue that changes the behaviour (#488, #494, #510) updates them.

### Cross-epic coordination

- **Admin pages epic (owns the shared admin list kit).** The Assets list reuses the kit where it fits (rows #497, chrome #499, states #500, cards #502); the kit issues are #543, #544, #575 and #579 (Admin pages epic #518). If the kit is not on dev when a list issue starts, use the Clients implementation and leave a note to swap; do not wait.
- **Users epic and Search epic.** No shared files except the search result route constant (#495) and the addendum/spec docs (#516). The Users review's "one drawer/panel pattern" point does not apply to Assets any more because the panel is gone.
- **Task Types epic (#352).** The form designer, Asset Types and Custom Fields screens are theirs; this epic only reads the type fields (Details tab) and does not change the designer. Shared helpers used: `impactLine()` (#362), the form-page pattern (#361), the denial rule (#416), list return (#354).

### Extension points (for the packages that follow)

- **Record header and strip (WP-AS2, WP-AS4):** `RecordKind` gains `asset`; header actions are data, so later issues add overflow items without header code.
- **Counts and linked-task fields (WP-AS3, WP-AS4):** the API now returns what the cells need, so a later "assets of a task type" view or a Task Queue asset filter needs no new endpoint.
- **List contract (WP-AS3):** the Assets list is the second user-facing list built on the shared kit; a future list can reuse it.

### Definition of done per package

Issues closed, tests green twice (including permission variants), axe clean at four sizes with overlays open, no page-level horizontal scroll, screenshots in `fixes/<package>/`, bundle and style budgets kept, API changes additive with regenerated OpenAPI and client, no keyboard shortcut added, the docs named in the issue noted for WP-AS7, the epic #485 tasklist ticked, and the line below added to the Status section.

### Docs package (WP-AS7, #516)

`ux-spec.md` S08 rewritten to the code (list, record page, tabs, forms, copy deck, UAT rows; "Retired" becomes "Inactive"), section **AA** of the decisions addendum (every Decision (PM) above, including that the record page supersedes the master-detail design of `docs/ux/assets-screen`; the last section on dev is X and the other epics add theirs, so the letter is confirmed when the issue starts), `docs/qa/e2e.md`, `architecture.md` for the additive fields, `db/scripts/README.md` if a script was added, a banner in the review README and the superseded banner on `docs/ux/assets-screen/README.md` (#510). Where the code differs from the issues, the docs follow the code and say so.

### Final verification package (WP-AS7, #517)

Contract e2e over the seeded data of the review at four sizes (axe 0 including `target-size`, no sideways scroll, 44 px list rows, one record header with Edit, Activity and overflow, no nested scroller), the state matrix (loading, 404, 403, 5xx, offline, reduced motion), the permission matrix, regression subsets for every shared file touched (Clients, Matters, Projects, Task Detail, Task Types record pages, Admin lists), the before/after table of the review's measurements (grid 277 px to full height, 3,048 px phone page to cards, 77 Tab stops, 26 dead links to 0, 55/77 px rows to 44 px), bundle report, screenshots in `fixes/final/`, and a comment on the epic with the open items. It uses its own e2e stack and ports and never stops processes or containers of another agent's verification run.

## 4. Status

(One line per work package; keep other packages' lines when merging. Format: `WP name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Owner decisions (2026-10-20): all recommendations of the review approved; no new or changed keyboard shortcuts in this phase (Phase 2 backlog #420); the record page replaces the master-detail design of `docs/ux/assets-screen`.
- Planning (2026-10-20): epic #485 and issues #486 to #517 created and linked as sub-issues; PM requirements review comments posted on every issue; no issue is blocked on the owner; SQL script 28 is free and none is certain (see "Backend work and SQL"); Admin pages list kit issues referenced: #543, #544, #575, #579 (epic #518).
- First release (#486, #487, #488, #489, #490, #491, #492, #493, #494, #495): not started.
- WP-AS1 Defects: not started.
- WP-AS2 Record page core: not started.
- WP-AS3 List contract: not started.
- WP-AS4 Record page completion: not started.
- WP-AS5 Forms and vocabulary: not started.
- WP-AS6 Keyboard and permissions: not started.
- WP-AS7 Docs and final verification: not started.
