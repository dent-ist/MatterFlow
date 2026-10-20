# Users administration review: delivery plan

Owner approval: "I like all of your recommendations, so please don't wait for me. create epics / issues and continue working" (2026-10-20), with product decisions delegated to the PM ("you can make decisions for me"). Decisions are recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-20, base `origin/dev` (Clients #245, Task Detail #288 and, mostly, Task Types #352 built; their shared components are on dev). Source review: `README.md` in this folder (16 findings, BUG-1 to BUG-7, 7 work packages of 71 agent-hours, 59 screenshots in `screenshots/`, mocks in `mocks/`).

Structure on GitHub: one epic **#422** (labels `epic` + `phase-11`) and 34 sub-issues (label `phase-11`): #423 to #460, not contiguous because other planning agents created issues at the same time; the exact numbers are in the table below. Folded IDs (named in the host issue title, nothing dropped): U13 and the availability-dialog nit in #428; BUG-5 in #423 (interim) and #445 (final); BUG-3 interim in #425 and final in #441; BUG-4 API in #426, interim UI in #427, final in #441; U7 in #433; U4 in #439; U12 split in #430 and #431; U10 in #447, #448, #449; U11 in #450 (with BUG-6) and #451. U16 (many rows) and the "verified good" items (URL-driven filters, error/403 states, role editor locks, availability dialog, 0 axe violations in 12 scans) are regression tests only. Nothing is decided "not now".

**Hours.** The review estimated **71** agent-hours; this plan is **90.5**. The difference is explained: the interim fixes for BUG-2/3/4 that ship in the first release before the drawer exists (about 5 h; the drawer keeps their tests), the two backend items as separate issues (#426, #436: 4.5 h), the verified-gap work the review listed in section 8 (read-only variants, last System Admin and concurrent edits, permission matrix: 5.5 h), and the docs and final verification package (7.5 h) that the review did not count. The first release is **10 hours**.

## 0. Cross-epic dependency: the Admin pages list kit

The **Admin pages UX epic owns the shared admin list kit** (list shell with crumb/description/Filters/primary action/"Skip to table", counted route tabs, one table stylesheet on the 44 px contract with the column-drop rule, row overflow convention, grid-body states, phone cards, "n inactive hidden - Show all", dialog wording). This epic **depends on it and does not duplicate it**; only user-specific work (drawer, approval flow, availability, roles/pods tabs, deactivation flow, open-task count and "View their tasks", Access Pending) is built here. Kit issues by number: shell #544, tabs #545, table stylesheet #543, row overflow #554, states #575, phone cards #579, inactive hint #575 (same issue as the states), health strip/segments helper #581. Where a number is not filled in an issue, the reference is review work package 2 of `docs/ux/admin-pages-review/README.md` ("dependency number to be filled"). Rule: if a kit piece is not on dev when a Users issue needs it, the Users agent waits (the first release does not need the kit and runs first) or reuses the Task Types implementation underneath and rebases onto the kit; no private copy of kit code is added.

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package | Lane |
|---|---|---|---|---|---|---|
| #423 | BUG-1, BUG-5 | BUG-1 / BUG-5: Pending access badge is no longer clipped; no "scroll sideways" hint over a one-... | 1 | None | WP-US1 (R1) | A |
| #424 | BUG-2 | BUG-2: Focus moves into the user panel when it opens, Esc closes it and focus returns to the row | 1.5 | None | WP-US1 (R1) | A |
| #425 | BUG-3 (interim) | BUG-3: The deactivation confirmation is visible when chosen and the button says what it does | 1.5 | None | WP-US1 (R1) | A |
| #426 | BUG-4 (API), U3 | openTaskCount on the user response (additive) and the Task Queue address for "View their tasks" | 3 | None | WP-US1 (R1) [backend] | B |
| #427 | BUG-4 | BUG-4: Open task count and "View their tasks" in the current user panel and the deactivation text | 2 | #426 | WP-US1 (R1) | A |
| #428 | BUG-7, U13, availability dialog nit | BUG-7 / U13 / dialog nit: Access Pending copy and the duplicate From/Until hint | 1 | None | WP-US1 (R1) | C |
| #429 | U2 | U2: Pending access, Active, Inactive and All as counted segments above the grid | 5 | kit #544 for the header slot and kit #581 (health strip helper with single-select segments) for the segment toolbar | WP-US2 | A |
| #430 | U12 (part) | U12 (tabs and crumb): Tab counts Users (n), Roles (n), Pods (n) and the Administration > Users ... | 2 | kit #545 | WP-US2 | B |
| #431 | U12 (part) | U12 (header): Filters with count and Clear in the page header; filter row open from 640 px | 2 | kit #544; after #429, before #432. | WP-US2 | A |
| #432 | U1, decision X.3 superseded | U1 / X.3 reopened: Users grid on the record-list contract (name over account, 6 columns, 44 px ... | 7 | kit #543, kit #575; #423, #429 | WP-US3 | A |
| #433 | U7 | U7: One row action column - Grant access for pending people, overflow with Edit availability, D... | 2.5 | #432, kit #554. | WP-US3 | A |
| #434 | U6 | U6: Availability chip only where it informs | 2 | #432. | WP-US3 | A |
| #435 | U8 | U8: Pods cell on one line (primary pod name +n) with a popover that does not clip | 2 | #432. | WP-US3 | A |
| #436 | U15 (API) | U15 (API): lastSeenUtc and sort keys name, firstSeen, lastSeen on the user list (additive) | 1.5 | None; serial with #426 for the OpenAPI file | WP-US3 [backend] | B |
| #437 | U15 (UI) | U15 (UI): Sortable Name, First seen and Last seen headers and the shared page-size select | 2.5 | #432, #436. | WP-US3 | A |
| #438 | U3 (shell), BUG-2 (final) | U3 (shell): User panel becomes a modal side drawer with header, sticky footer, focus and Esc | 5 | #432, #424, #425 | WP-US4 | B |
| #439 | U3 (Access), U4 | U3 / U4: Access section first - roles with description and counts, grouped permissions, System ... | 3.5 | #438. | WP-US4 | B |
| #440 | U3 (sections) | U3: Pods, Availability and Profile sections of the drawer | 3 | #438, #435, #428. | WP-US4 | B |
| #441 | BUG-3, BUG-4, U3 (final) | U3 / BUG-3 / BUG-4 (final): Deactivation is a confirm dialog with the open-task count and View ... | 2.5 | #438, #426. | WP-US4 | B |
| #442 | U3 (grant toast) | U3: A first grant of access shows a success toast with Undo | 2 | #438, #439. | WP-US4 | B |
| #443 | Section 3 item 5 (not verified), section 8 | Read-only drawer for a User.View-only administrator and the Pod.ManageMembers-only variant | 1.5 | #438, #440. | WP-US4 | B |
| #444 | Section 4 / section 8 (not exercised) | Tests for the last System Admin guard and concurrent edits of the same user | 2 | #438, #441. | WP-US4 | B |
| #445 | U5 | U5 / BUG-5 (final): Users phone cards below 640 px | 5 | #432, kit #579. | WP-US5 | B |
| #446 | U5 (drawer and filters) | U5: Drawer full width on phones and the Filters sheet with segments | 3 | #438, #445. | WP-US5 | B |
| #447 | U10 (part) | U10 (counts): Role list shows member and permission counts; list pane 320 px; permission count ... | 2.5 | kit #545 for the shell only. | WP-US6 | C |
| #448 | U10 (part) | U10 (editor): Select all or none per permission group and a Changed (n) chip row | 2.5 | #447 (same files). | WP-US6 | C |
| #449 | U10 (part) | U10 (description): Role description is a two-row textarea with a counter | 1 | #448. | WP-US6 | C |
| #450 | U11 (list), BUG-6 | U11 (list) / BUG-6: Pods list on the kit grammar - name is the link, no Edit link, "n inactive ... | 3 | kit #543, kit #575. | WP-US6 | C |
| #451 | U11 (editor) | U11 (editor): Pod editor with the record header and crumb Administration > Users > Pods > name | 3 | #450. | WP-US6 | C |
| #452 | U14 | U14: Skip to table, one Tab stop per row and accessible names with the account | 3 | kit #544, #433. | WP-US7 | A |
| #453 | Section 3 item 5, section 8 | Permission matrix for the Users area: no dead links, toasts or 403s | 2 | #438, #443, #450, #448. | WP-US7 | C |
| #454 | Section 5 | Keyboard and axe audit of the Users area with Tab-stop evidence | 2 | WP-US3 to WP-US6 done. | WP-US7 | A |
| #457 | Docs | ux-spec S12, decisions addendum section Z (X.3 superseded), UAT rows, e2e catalogue | 3.5 | All code issues. | WP-US8 | C |
| #460 | Verification | Final verification pass for the Users area | 4 | All issues. | WP-US8 | C |

Total: **90.5 agent-hours** (34 issues). R1 = first release. Review ID to issue: BUG-1 #423, BUG-2 #424 and #438, BUG-3 #425 and #441, BUG-4 #426, #427 and #441, BUG-5 #423 and #445, BUG-6 #450, BUG-7 #428; U1 #432, U2 #429, U3 #438, #440, #441, #442, U4 #439, U5 #445 and #446, U6 #434, U7 #433, U8 #435, U10 #447, #448, #449, U11 #450 and #451, U12 #430 and #431, U13 #428, U14 #452, U15 #436 and #437.

## 2. Decisions (PM) in one place

- **Decision X.3 is superseded.** The owner approved all recommendations of the review, so the nine-column Users grid of addendum decision X.3 is replaced by the record-list grid: **Name (name over Windows account), Roles, Pods, Availability, Status, one action column**, 44 px rows, name clamped at two lines and the one link, Email and First seen moved to the drawer (the Email filter stays), sortable Name and Last seen, phone cards below 640 px. Recorded in the decisions addendum section **Z** (#457), with a pointer added to X.3.
- **No new or changed keyboard shortcuts (owner decision; Phase 2 backlog #420).** In scope: "Skip to table", one Tab stop per row where possible, focus to the drawer heading and back, roving tabindex in the status segments, Esc closing a dialog/drawer (standard dialog behaviour, not an application shortcut), buttons for every action (including Undo and select all). The review's "next pending user" idea stays Phase 2.
- **First release = the defects that hurt today** (#423, #424, #425, #426, #427, #428, about 10 h): clipped badge and misleading hint, focus and Esc on the panel, the buried deactivation confirmation, the open-task count with "View their tasks". They are interim fixes on the current panel; the drawer deletes the code and keeps the tests.
- **User panel becomes a modal side drawer** (answers review question (b)): 480 px from 1024, full width below 640, sections Access (roles first), Pods, Availability, Profile, sticky footer, focus in and back, Esc closes with the dirty guard. Deactivation is a confirm dialog with the open-task count; Undo toast after a first grant.
- **Pending access is a first-class control:** counted segments Pending access (n) | Active | Inactive | All above the grid; the default rule (Pending when anyone is waiting, else Active) stays, but is visible and written to the URL.
- **Email and First seen leave the grid** (answers question (c)); Last seen replaces First seen as the sortable offboarding signal when the API has it (if not stored, the column is hidden and no tracking is added in this epic).
- **Additive API (all backend, no SQL planned; script 28 stays free).** #426: `openTaskCount` on user list and detail (null without `Task.View`; the UI then drops the sentence); #436: `lastSeenUtc`, `sort`, `dir` on the user list; possibly `permissionCount` on the role list inside #447.
- **Dialogs state impact** through the shared `impactLine()` helper of Task Types (#362): a number the API did not return is never shown.
- **Pods and Roles tabs** follow the kit grammar; the inactive state is called Inactive everywhere (not "Disabled"); `RecordKind` gains `pod` (additive).
- **Verified gaps get tests** (read-only drawer, `Pod.ManageMembers` without `Pod.Manage`, last System Admin guard, concurrent edits): #443, #444, #453.
- **Out of scope.** Invitation or provisioning screens, bulk actions, reassigning tasks, e-mail notifications, a dark theme, real Windows authentication and screen-reader testing, print, new last-seen tracking, shortcuts.

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes and never hand-merge them, run unit + integration + e2e + axe (0 violations at 1366, 1920, 768 and 375, with menus, dialogs, drawers open) and assert no page-level horizontal scroll, attach screenshots in `docs/ux/users-review/fixes/<package>/` (`us1-bugs` ... `us7-keyboard`, `final`), keep the initial bundle at its current size, do not add rules to `task-table.scss`, update the docs named in the issue (WP-US8). Do not add or change keyboard shortcuts.

| Rank | WP | Issues | Main files / areas | Agent-h | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP-US1 Bugs and first release | #423, #424, #425, #426, #427, #428 | `users-page.*` (interim fixes), access-pending page, availability dialog, `UsersController.cs`, `UserAdministration.cs`, OpenAPI + client | 10 | all lanes; nothing else | - | **#426 backend** (additive, no SQL) |
| 2 | WP-US2 Status segments and header chrome | #429, #430, #431 | `users-page.*`, the Users/Roles/Pods shell, `admin.routes.ts` (additive) | 9 | WP-US3 backend, WP-US6 | WP-US1 (same file) and the kit shell/tabs | Frontend only |
| 3 | WP-US3 Users grid on the list contract | #432, #433, #434, #435, #436, #437 | `users-page.html/.scss/.ts`, `user-pods-cell.ts`, `UsersController.cs` (sort), OpenAPI + client | 17.5 | WP-US4 (after the grid lands), WP-US6 | WP-US2, the kit grid and states | **#436 backend** (additive, no SQL) |
| 4 | WP-US4 User drawer | #438, #439, #440, #441, #442, #443, #444 | new `user-drawer.*`, `users-page.*` (opener), `user-pods-cell.ts` (reuse), `confirm-dialog.ts` (use) | 19.5 | WP-US3 rest, WP-US6 | #432 (opener), #426 | Frontend only |
| 5 | WP-US5 Phone cards | #445, #446 | `users-page.*`, `user-drawer.scss`, kit card renderer | 8 | WP-US4, WP-US6 | #432, #438, #437, kit cards | Frontend only |
| 6 | WP-US6 Roles and Pods polish | #447, #448, #449, #450, #451 | `roles-page.*`, `pods-page.*`, `record-header.ts`/`record-state.ts` (additive kind `pod`) | 12 | everything | kit shell/grid/hint (Pods list only) | Frontend only |
| 7 | WP-US7 Keyboard, permissions and a11y | #452, #453, #454 | `users-page.html`, `admin.routes.ts`, `denial.ts`, e2e | 7 | WP-US6 | WP-US3 to WP-US6 | Frontend only |
| 8 | WP-US8 Docs and final verification | #457, #460 | `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `docs/qa/e2e.md`, `docs/architecture.md`, e2e | 7.5 | none (late) | all code | Frontend only |

Total: about **90.5 agent-hours**.

### First release (do these first, about 10 hours)

The six defects that hurt today, independent of the kit and of each other except where noted: #423 BUG-1/BUG-5 (1 h), #424 BUG-2 (1.5 h), #425 BUG-3 (1.5 h), #426 openTaskCount API (3 h, backend), #427 BUG-4 (2 h, needs #426), #428 BUG-7/U13 (1 h). Three lanes run in parallel: lane A #423 then #424 then #425 then #427 (the same two files, serial, 6 h); lane B #426 (3 h, then #436); lane C #428. Wall-clock of the release is about 6 hours (lane A waits for #426 only for the last item).

### Waves for 3 parallel developer agents

Lanes are file owners, not people: one agent owns one lane's files for the whole epic, which removes merge conflicts. **Lane A** owns the Users page and grid (`users-page.*`, `user-pods-cell.ts`) and the keyboard issues; **lane B** owns the backend, the new drawer files, the tabs shell and the phone cards; **lane C** owns the access-pending page, Roles, Pods, the permission matrix, docs and the final pass.
- **Wave 1 (first release plus the API)**
  - Lane A (6 h): #423, #424, #425, #427
  - Lane B (4.5 h): #426, #436
  - Lane C (1 h): #428
- **Wave 2 (needs the kit shell/tabs/table: starts when they are on dev; roles work needs no kit)**
  - Lane A (14 h): #432, #429, #431
  - Lane B (2 h): #430
  - Lane C (6 h): #447, #448, #449
- **Wave 3 (drawer and grid rest; the drawer starts when the grid has merged)**
  - Lane A (9 h): #433, #434, #435, #437
  - Lane B (16 h): #438, #439, #440, #441, #442
  - Lane C (6 h): #450, #451
- **Wave 4**
  - Lane A (3 h): #452
  - Lane B (11.5 h): #443, #444, #446, #445
  - Lane C (2 h): #453
- **Wave 5 (verification and docs)**
  - Lane A (2 h): #454
  - Lane C (7.5 h): #457, #460

Lane totals: A 34 h, B 34 h, C 22.5 h. With three agents the wall-clock is about **41.5 hours** (lane A is the longest, then the docs and final pass of lane C run serially after it); one agent alone needs 90.5. A fourth agent can take #447, #448, #449 (roles, no kit needed) off lane C but gains only a few hours.

Dependency rules between lanes: #427 needs #426 (lane B); #429, #431 need the kit shell; #432 needs the kit table stylesheet and states; #438 needs #432 (opener) and the removal of the interim code of #424/#425; #440 needs #435 (lane A) and #428; #437 needs #436 (lane B); #445 needs #432, #437, #438 and the kit cards; #450 needs the kit grid/hint; #452 needs #433 and the kit skip link; #453 needs the drawer, read-only variants, pods and roles; #457 and #460 need everything.

### Exact first wave

1. Lane A: #423, #424, #425, then #427 (after #426 merges). 2. Lane B: #426, then #436 (serial for the OpenAPI file). 3. Lane C: #428, then #447 (no kit dependency).

### Critical path

Lane A: #423 1, #424 1.5, #425 1.5, #427 2, #432 7, #429 5, #431 2, #433 2.5, #434 2, #435 2, #437 2.5, #452 3, #454 2, then #457 3.5 and #460 4 (lane C, serial after lane A) = about 41.5 hours. Lane B (34 h) has slack of roughly 8 hours but is blocked at the start of the drawer on #432; lane C (22.5 h) has the most slack.

### Hot spots (merge-conflict watch)

- **`users-page.html/.scss/.ts`**: #423, #424, #425, #427, #429, #432, #431, #433, #434, #435, #437, #445, #452, in that order, one agent (lane A); #438 touches only the opener (small, lane B: rebase) and #445 adds the card template.
- **`user-pods-cell.ts`/`user-pods-draft.ts`**: #435 (lane A) then #440 (lane B).
- **New `user-drawer.*`**: lane B only, #438 first, then the section issues in order.
- **`roles-page.*`**: #447, #448, #449 serial (lane C). **`pods-page.*`**: #450 then #451.
- **Availability dialog and access-pending page**: #428 lands first; #440 and #434 rebase.
- **OpenAPI and the TS client**: #426, #436 (and possibly #447) regenerate the same two files: merge in that order. The Admin pages epic, Assets and Search epics also regenerate them: rebase, never hand-merge.
- **`shared/ui/record-header.ts`, `record-state.ts`**: additive kind `pod` only (#451). **`admin.routes.ts`**: shared with the Admin pages epic, additive only (#430, #453).
- **Decisions addendum**: shared with the other epics; #457 rebases and appends section Z.
- **Tests**: `users-page.spec.ts` and the older e2e that read nine columns, "Open" links, the cue button and the inline panel are updated by the issue that changes the behaviour (#432, #429, #438).

### Extension points (for the packages that follow)

- **Drawer shell (#438):** sections are components in `user-drawer.*`, so later fields (for example a reassign-tasks section) add a section without touching the shell.
- **Status segments (#429):** the toolbar is the Task Queue quick-view component; another status value is data.
- **Counts (#426):** the open-task definition equals the Task Types and Workflow version counts.

### Definition of done per package

Issues closed, tests green twice (including permission variants), axe clean at four sizes with overlays open, no page-level horizontal scroll, screenshots in `fixes/<package>/`, bundle and style budgets kept, API changes additive with regenerated OpenAPI and client, no new keyboard shortcut, the docs named in the issue noted for WP-US8, the epic #422 tasklist ticked, and the line below added to the Status section.

### Docs package (WP-US8, #457)

`ux-spec.md` S12 rewritten to the code (segments, grid, drawer, deactivation dialog, roles and pods tabs, Access Pending, copy deck, UAT rows), section **Z** of the decisions addendum (every Decision (PM) above; X is column filters, Y belongs to the Admin pages epic) including the explicit statement that **decision X.3 is superseded**, `docs/qa/e2e.md`, `architecture.md` for the additive fields, `tokens.css` note (target: no new token), a banner in the review README. Where the code differs from the issues, the docs follow the code and say so.

### Final verification package (WP-US8, #460)

Contract e2e over the seeded review data (62 and 1,072 users) at four sizes (axe 0 including `target-size`, no sideways scroll, 44 px rows, one primary action, no nested scroller), the state matrix (loading, error, empty, filtered empty, 403, offline, reduced motion), the permission matrix, regression subsets for every shared file touched (Task Types, Clients, Task Queue quick views, Activity drawer), the before/after table of the review's measurements (1,611 px grid, 51 to 204 px rows, 33 Tab stops, 75 stops per page), bundle report, screenshots in `fixes/final/`, and a comment on the epic with open items. It uses its own e2e stack and ports and never stops processes or containers of another agent's verification run.

## 4. Status

(One line per work package; keep other packages' lines when merging. Format: `WP name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Planning (2026-10-20): epic #422 and 34 sub-issues created and linked; PM requirements review comments posted on every issue; no issue is blocked on the owner; SQL script 28 is free and none is planned; decision X.3 superseded (to be recorded in section Z by #457).

- WP-US1 Bugs and first release: not started.
- WP-US2 Status segments and header chrome: not started.
- WP-US3 Users grid on the list contract: not started.
- WP-US4 User drawer: not started.
- WP-US5 Phone cards: not started.
- WP-US6 Roles and Pods polish: not started.
- WP-US7 Keyboard, permissions and a11y: not started.
- WP-US8 Docs and final verification: not started.
