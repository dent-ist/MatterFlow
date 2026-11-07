# ui-update-2: end-to-end (Playwright) QA of `dev` (agent QA2)

Date: 2026-11-07. Subject: `origin/dev` at fd1428f (equal to the finished `ui-update-2`). Worktree `/home/user/wt/qa2`, local branch `qa2-work`, pushed to `origin/qa-e2e-fixes` (test-only changes, no application code touched, no pull request).

## 1. Verdict

**Still not ready on the e2e side.** Stage 3 ran on `qa-e2e-fixes` merged with `ui-fixes` (#1285, Users rows 44 px). A clean full run (new database, rebuilt publish, all 2,526 tests) gives **2,058 passed, 362 failed, 106 skipped**, against 2,032 / 390 / 108 at the end of stage 2 and 1,749 / 680 / 73 not run at the start. The Users row-height tests that waited for #1285 pass now. The sensitive pass is green for the security check (all 9 leak-scan tests). 362 tests in 175 spec files still fail: they are stale specs of rebuilt pages that I did not finish (3.2), or they wait for an open application issue (4.1). The gate stays open.

## 2. What was run, and how

| Run | What | Result |
| --- | --- | --- |
| 1 | Whole suite, `E2E_WORKERS=2 npm run e2e -- --trace off`, own SQL Server container, API on port 5290, `E2E_SKIP_BUILD=1` after a manual publish (see 6) | 2,542 tests: **1,749 passed, 680 failed, 40 skipped, 73 did not run, 0 flaky** (retries are off locally), 2.1 h |
| 2 | The 592 failed test locations re-run on a kept stack (not alone) after the first fix commits | 150 passed, 481 failed, 13 skipped |
| sensitive | `npm run e2e -- sensitive-` (switch on by itself, own stack on port 5291) | 14 tests: 7 passed, 7 failed (section 4.4) |
| 3 | The same 592 locations (633 tests) after all fixes, kept stack | the run hit the 50 minute `timeout` of my wrapper at test 587 of 633: **173 passed, 414 failed** in the 587 that finished, 46 not evaluated |
| 4 | The 592 failed locations again on a kept stack after round 2 of fixes | 194 passed, 424 failed, 13 skipped (631 tests; spec files were edited while it ran) |
| 5 | The remaining 369 locations after round 3 | 88 passed, 358 failed, 13 skipped |
| full 2 | **Clean second full run**, own SQL container, E2E_SKIP_BUILD with a rebuilt publish of dev fd1428f, 2 workers, 2 h | **2,032 passed, 390 failed, 108 skipped, 0 flaky** (2,530 tests) |
| sensitive 2 | `npm run e2e -- sensitive-` again | 13 passed, 1 failed (stale locator, fixed afterwards) |
| 6 | Stage 3 slice: landing, my-work-per-tab-columns, wp12b-keyboard, users-*, ad3-priorities (fix 7770f24 checked) | landing and wp12b-keyboard pass; my-work-per-tab-columns still fails 3 (progress line 24 px) |
| full 3 | **Clean full run, tree = qa-e2e-fixes + ui-fixes b2650b4**, 2 workers, 1.9 h | **2,058 passed, 362 failed, 106 skipped, 0 flaky** (2,526 tests) |
| slices | Small re-runs of fixed families (create-task: 15/15 then 9/9 after the last fix; the Task Types / Workflows slice 55 of 87; several mixed slices) | used to prove each fix |

Not run: the sensitive-ui fix and the last small fix commit (7770f24) after the second full run; the run with `E2E_SCREENSHOTS`, and `npm run e2e` with retries. Run 3 was not complete (46 tests), and no failed test was re-run strictly alone twice: reruns were in groups of up to 633 tests on a kept stack that had also run earlier tests, so a test that fails in run 2 and run 3 is "failed twice in a re-run", not "failed twice alone". Flaky: none observed (0 flaky in run 1; failures repeated in run 2).

Stack: SQL Server 2022 container per run (`mf-e2e-sql-<pid>`), published API (Dev auth), axe from `node_modules/axe-core`, Chromium from `/opt/pw-browsers/chromium-1194` with `E2E_NO_SANDBOX=1`. Heavy commands went through `heavy.sh`.

## 3. Failures by family, category and resolution

Categories: (a) stale test (UI standardisation or another intended change), (b) real application defect, (c) flaky or environment, (d) skipped by design.

### 3.1 Fixed (test files only)

| Family | Specs | Cause | Cat. | Fix |
| --- | --- | --- | --- | --- |
| `POST /api/v1/tasks` 400 in setup (37 tests) | as4-record-complete, dashboard-scope, landing, matter-columns, my-work-links-copy, my-work-per-tab-columns, wp12b-keyboard | The API refuses to assign a task to a person without `Workflow.Execute` (`USER_CANNOT_EXECUTE`, commit 56d06b9, DB-14, 4 Nov). The specs created assignees with only `Task.View`/`Task.Create`. **Not date dependent, not a defect.** | a | The test roles get `Workflow.Execute`. |
| Dialog buttons with a "Close <title>" sibling | admin-holidays, mm-ui-update, profile-*, sh5-toast-host, sh-toast-dedupe, pv-asset-disposition, ty-dialogs, ty8, workflow-steps, review-round-5 | Substring button names now match the close icon too (strict mode violation). | a | `exact: true` and Title Case names. |
| Calendar tab | users-tab, swimlane, dashboard-audit | The Dashboard has a sixth tab, Calendar. | a | List extended. |
| Title Case words | assets-*, as2/as4, ty5-workflow, users drawer, my-work-*, wp5-toolbar, md-notes-parity, ad1/ad2/ad4/ad6, ty-record-states, pw* (Pod Work tabs "All Open", "By Member"), profile-pf5-menu, task-permissions-t10 | D-20. | a | Expected texts follow the app. |
| Edit Task dialog | pages/task-detail.page.ts, t8-edit-create, t4-menus-dialogs, workflow-steps, wp7-inline-row-actions | Commit 0e52f13 (#1138): titles "Edit Task", "Complete Task", "Steps Need Information First"; dialog 768 px. | a | Page object and specs updated. |
| My Profile | profile-pf3, pf7, pf8 | H1 is "My Profile"; the name and chip are in `[data-profile-who]`. | a | Selectors updated. |
| Record grid rows | ty1, ty2, ty3, ty9, ad2-kit-shell | Workflows, Steps and Task Types lists are record grids (`tr[data-record-id]`, no `tr[data-row]`). | a | Selectors accept both. |
| 1024 px size lists | task-detail-final/t5/t6/tabs, ty4, ty5, ty6-version-tabs, ty7 | D-82: 1024x768 is not a design size. | a | 1024 entry removed; one test and one loop that only covered the narrow Details disclosure removed from task-detail-t5. |
| People without the domain | assignment-and-views, pw1-bugs, users-us4-drawer, wp6-assign-to-me | D-62. | a | Short names expected. |
| Error and date texts | dashboard-shell, swimlane, dashboard-trends-types, users-us4-drawer, wp9-list-columns, wp10-matter-tabs | D-51 "Couldn't load ...", D-60 numeric dates, hyphen for a zero count. | a | Expected texts updated. |
| mf-dropdown | pages/create-task.page.ts, task-create, create-task-sections, sensitive-leak-scan | Project, Priority, Pod and report Group By are `mf-dropdown`, not native selects. | a | Dropdown helper used. |
| Sensitive dialog | sensitive-ui | The confirm dialog is "Mark Matter Sensitive". | a | Spec updated (not yet re-run, see 4.4). |

### 3.2 Still failing after stage 3 (full run 3: 362 tests in 175 files)

Remaining files and failing test counts: users-tab (10), wp8-list-chrome (10), wp9-list-columns (7), profile-pf1-bugs (6), ty9-keyboard (6), users-us3-grid (6), clients-keyboard (5), profile-pf3-layout (5), task-header-t2 (5), task-status-note-t3 (5), ty2-strips (5), users-us8-final (5), clients-final (4), clients-permissions (4), matter-columns (4), md-forms-grid (4), sh5-toast-host (4), ty3-lists (4), users-capacity (4), ux-round-4 (4), wp22-columns-widths (4), ad3-priorities-edit (3), ad6-custom-fields (3), as3-list (3), coverage-by-type (3), dashboard-period (3), dashboard-v4-summary (3), mm-ui-update (3), my-work-per-tab-columns (3), pm-matters (3), pv-saved-views (3), px5-matter (3), px6-matrix (3), review-round-5 (3), swimlane-board (3), swimlane (3), t8-edit-create (3), task-detail-final (3), task-due-inline (3), ty2-shell (3), ty2-states (3), ty3-narrow-columns (3), ty3-task-types (3), ty3-workflows-steps (3), users-us4-drawer (3), wp13-narrow-rule (3), wp16-more-views (3), ad1-designer-states (2), ad3-labels-shell (2), admin-holidays (2), assets-keyboard (2), calendar (2), column-filters-admin (2), column-filters-rereview (2), column-filters-work-lists (2), dashboard-audit (2), dashboard-breakdowns (2), dashboard-fixed-height (2), dashboard-permissions (2), dashboard-shell (2), final-verification (2), matter-client-details-tab (2), mm-qa (2), profile-absences (2), profile-pf7-keyboard (2), pv-export (2), pw1-bugs (2), pw6-assign (2), sh-create-task (2), sh-list-load-error (2), sh-page-header (2), sh1-skip-link (2), sr3-grids (2), task-lifecycle (2), task-queue-copy (2), task-types-tabs (2), tip-axe (2), ty-permissions-matrix (2), ty4-task-type (2), ty7-step (2), ty8-designer-owners (2), users-us1-bugs (2), users-us7-flows (2), wp10-hold-colours (2), wp10-matter-tabs (2), wp11-view-counts (2), wp20-resize (2), wp21-fit-menu (2), wp5-toolbar (2), wp6-client-overview (2), wp7-inline-row-actions (2), wp8-matter-cell (2), ad3-priorities-delete (1), ad3-priorities-list (1), ad4-asset-type-record (1), ad4-asset-types-list (1), ad5-link-roles (1), ad7-audit (1), ad8-axe-reflow (1), ad8-focus-rules (1), ad8-tab-stops (1), as5-forms (1), assets-final (1), assets-screen (1), column-filters (1), create-task-sections (1), dashboard-grid-resize (1), dashboard-scope (1), detail-layout (1), due-dates (1), edit-task-sections (1), lc-list-toolbar (1), lc09-grid-scroll (1), md-notes-parity (1), md-summary (1), md-tasks-look (1), my-work-strip (1), my-work-vocabulary (1), page-header-icons (1), profile-availability (1), profile-pf5-dialog (1), pv-asset-disposition (1), pv-asset-report-builder (1), pv-assets-pages (1), pv-final-gate (1), pv-task-types-on-hold (1), pw3-strip (1), pw7-keyboard (1), rich-description (1), rp5-reports-admin (1), sh-403-in-place (1), sh-final-contract (1), sh-focus-heading (1), sh-rail-icons (1), sh-state-pages (1), sh1-user-name (1), sr1-link-permissions (1), sr3-results-tabs (1), sr5-filters (1), sr6-a11y (1), swimlane-big-screens (1), t4-menus-dialogs (1), t7-comments-activity (1), task-create (1), task-detail-layout (1), task-detail-t1 (1), task-detail-t6 (1), task-detail-t9 (1), task-type-icons (1), ty-dialogs (1), ty-titles-crumbs (1), ty1-list-return (1), ty5-workflow (1), ty6-version-bar (1), ty6-version-editor (1), ty6-version-leave (1), ty6-version-tabs (1), ty8-designer-panes (1), ty8-designer-readonly (1), ty9-audit (1), users-pods (1), users-us-copy-roles (1), users-us03-us04 (1), users-us2-status (1), users-us6-editors (1), users-us6-pods (1), users-us7-matrix (1), workflow-steps (1), wp1-dialogs-popovers (1), wp14-due-cell (1), wp19-compact (1), wp2-list-states (1), wp24-toolbar-keys (1), wp25-dash-due (1), wp9-fixed-layout (1).

Done in stage 3 (counts are failing tests before -> after in the slice runs): Dashboard family 50 -> 24 in its slice (permission count 10, title row with Scope and Refresh, Calendar tab on End, scope and period dropdowns, "Couldn't refresh", phone-width tab tests deleted); Users pods list rows (`tr[data-record-id]`), drawer 520 px (D-33); dialog and form specs: 33 -> about 25; Access Pending copy (D-53b); saved views in the Options menu; priorities rows are name buttons.

Not done, with the reason (each needs a live look at the rebuilt page, and I did not prove them stale, so none is claimed as a defect):
- **Dashboard Users tab** (users-tab, users-capacity): `[data-users-views]`, workload / coverage switch and the matrix selects moved; Trends `[data-plot]` not visible in the this-month view of dashboard-period; swimlane tree counts.
- **Users administration** (users-us1 to us8): grant button cells, availability dialog focus, the primary-pod button in the drawer, the Roles editor 1233 px form.
- **Profile** (pf1, pf3, pf4, pf5, pf7, pf8): `data-updated-note`, `data-stale` and the old description line.
- **Measures** (wp8-list-chrome, wp9-list-columns, wp13, wp16, wp20-22, task-header-t2, task-status-note-t3, clients-*, ux-round-4, lc09): numbers of the standardised grids. Rule for the narrow checks, as the coordinator asked: a narrow frame (1023 or 1098 px inside the 1366 window) is kept; a narrow window under 1280 px is deleted. I have not applied it yet to ux-round-4 at 1280 and lc09 at 1024.
- **px5, px6, sr5, review-round-5, rich-description, email-intake, as3, pv-export, pv-final-gate** and the Task Types / Workflows list specs (counts with thousands separators, 25 versus 30 rows).
- Tests that fail on a second run on the same database (fixed names): users-us6-editors, users-us6-pods, profile-pf8-final.
- wp9-fixed-layout "menu value ... clipped": not an application defect. The priority cells show seeded priority names such as "Rush ..." created by other specs on the shared database, and a long label is clipped with an ellipsis by design; the test depends on global data (category c).
- dashboard-permissions "header buttons": not a defect. The title row holds Scope and Refresh by design (D-21, #1135); the spec was stale and is fixed.

## 4. Real defects and open questions

### 4.1 Filed
- **#1281** waiting-users badge on the Users nav item fails axe color-contrast (2.51:1) in the compact rail at 1024 px (low priority).
- **#1285** (filed by the designer) Users rows 47-48 px instead of 44: fixed on `ui-fixes`; the row-height tests pass.
- **#1293** the availability chip in grids reads `Out of Office until Oct 25, 2027` (month name); D-60 wants numeric dates in cells. users-us3-grid line 263 asserts only the prefix, so it is green once the casing is fixed; the issue is kept apart so the date format is not hidden.
- **#1294** axe `heading-order` in the Users person drawer (`<h3 id="ud-access">` without a parent heading); users-us8-final (2 tests) stays failing until it is fixed.

### 4.2 Not defects
- The 37 setup failures (4.3 of the coordinator's question): intended API rule, see 3.1.
- Dashboard "Calendar" tab, Pod Work "All Open": intended.

### 4.3 The three possible defects (resolved with the designer)
- Users grid rows of 47-48 px against 44: **real, issue #1285** (parent #1106): the Name cell clamps to two lines and adds 2 px padding; fix in `users-page.scss`. The Users row-height assertions stay failing until it is fixed (waiting for #1285).
- "Pod" field in the Edit Task dialog: **stale spec**. The dropdown exists in the collapsed section; its button reads "Pod: <name>". Fixed (task-permissions-t10 passes).
- Breadcrumb "FormForm": **stale spec**, not an accessibility defect (the visible text is aria-hidden and a screen-reader span repeats it; the accessibility tree reads it once). Fixed in task-types-tabs.
- Texts that differ between sentence case and Title Case for plain status text ("Not published" in the custom fields list, "Unsaved changes" in the notes state line, "Not used" paragraph) were read as intended sentence-case status text, not chips; specs follow the app.

### 4.4 Sensitive pass
Second run (`npm run e2e -- sensitive-`, switch on): **13 of 14 passed, including all nine leak-scan tests** (screens, storage and network scanned for five people, the hidden address answering byte for byte like a missing one). The one failure was the Matters list check in sensitive-ui, which took the hidden print line of the Filters for the matter name; the locator is now the link (fixed, not re-run). The axe failure of the first pass (account menu button without a name on the assignee's My Work page) did **not** reproduce: the button has `aria-label="<name>, account menu"` (user-menu.ts), so it was a load race of that run. No issue filed.

## 5. Machine, disk and time

4 cores, 15 GB RAM, 2 workers (memory stayed far below 11 GB). Disk was the limit: 2.9 GB free at the start; npm ci took 0.5 GB, the build and publish 0.3 GB, the SQL container grew by about 0.4 GB per full run; failure videos were deleted during the run (`--trace off`). The lowest free space was 0.8 GB (the coordinator then deleted `amazing_bohr`); the 600 MB guard never fired. `ng build` printed "Output location" but its wrapper did not exit; I ended my own wrapper and ran `dotnet publish` and the copy into `wwwroot` by hand (the same steps as `deploy/publish.sh`). The machine restarted once: the run in progress was repeated. The Angular build prints three SCSS budget warnings (page.scss, notes-tab-panel.scss, roles-page.scss); they do not fail the build. Wall time of the e2e work: about 9 hours, of which 2.1 h run 1, about 0.8 h each for runs 2 and 3; effort about 9 agent-hours.

## 6. Recommendation

Do not release on the e2e side yet. (1) Fix #1285 and #1281 in the application; (2) finish the 177 spec files of 3.2 (390 tests; the Users, Profile and list-measure families first), proving each stale before editing; (3) run the whole suite again and require 0 failures except what waits for an open application issue. The application itself shows no sign of a broken flow in the first run beyond those items, but a stale spec can hide a real regression, so the 414 are not cleared.
