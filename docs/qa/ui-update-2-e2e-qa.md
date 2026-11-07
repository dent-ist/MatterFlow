# ui-update-2: end-to-end (Playwright) QA of `dev` (agent QA2)

Date: 2026-11-07. Subject: `origin/dev` at fd1428f (equal to the finished `ui-update-2`). Worktree `/home/user/wt/qa2`, local branch `qa2-work`, pushed to `origin/qa-e2e-fixes` (test-only changes, no application code touched, no pull request).

## 1. Verdict

**Not ready on the e2e side yet.** After the second round of fixes a clean full run (new database, all 2,530 tests) gives **2,032 passed, 390 failed, 108 skipped**; the first run gave 1,749 passed, 680 failed, 73 not run. The fixes are test-only (no application code touched). The sensitive-matter pass is green for the security check: **all 9 leak-scan tests pass**; 13 of 14 sensitive tests passed, the 14th was a stale locator, fixed (not re-run). 390 tests in 177 spec files still fail; most are stale specs for rebuilt pages whose rewrite is not finished, a few wait for application fixes (section 4). The release gate stays open until the list in 3.2 is down to the tests that wait for #1285.

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
| slices | Small re-runs of fixed families (create-task: 15/15 then 9/9 after the last fix; the Task Types / Workflows slice 55 of 87; several mixed slices) | used to prove each fix |

Not run: the full suite a second time (a clean full run would take about 2.1 hours and 1.2 GB of disk; not possible with the 2.9 GB I had and the restarts), the run with `E2E_SCREENSHOTS`, and `npm run e2e` with retries. Run 3 was not complete (46 tests), and no failed test was re-run strictly alone twice: reruns were in groups of up to 633 tests on a kept stack that had also run earlier tests, so a test that fails in run 2 and run 3 is "failed twice in a re-run", not "failed twice alone". Flaky: none observed (0 flaky in run 1; failures repeated in run 2).

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

### 3.2 Still failing after the fixes (full run 2: 390 tests in 177 files)

Remaining files and failing test counts (full run 2, before the last small fix commit 7770f24): wp9-list-columns (10), wp8-list-chrome (9), users-tab (7), profile-pf1-bugs (6), ty9-keyboard (6), users-us3-grid (6), users-us6-pods (6), clients-keyboard (5), dashboard-shell (5), profile-pf3-layout (5), task-header-t2 (5), task-status-note-t3 (5), ty2-strips (5), users-us8-final (5), clients-final (4), clients-permissions (4), dashboard-permissions (4), dashboard-v4-summary (4), md-forms-grid (4), sh5-toast-host (4), ty3-lists (4), users-capacity (4), users-us-copy-roles (4), users-us4-drawer (4), ux-round-4 (4), wp16-more-views (4), wp22-columns-widths (4), ad3-priorities-edit (3), ad6-custom-fields (3), as3-list (3), column-filters-admin (3), coverage-by-type (3), dashboard-audit (3), dashboard-period (3), matter-columns (3), mm-ui-update (3), my-work-per-tab-columns (3), pm-matters (3), pv-asset-disposition (3), pv-saved-views (3), px5-matter (3), px6-matrix (3), review-round-5 (3), rich-description (3), sr5-filters (3), swimlane-board (3), swimlane (3), t8-edit-create (3), task-detail-final (3), task-due-inline (3), ty-permissions-matrix (3), ty2-shell (3), ty2-states (3), ty3-narrow-columns (3), ty3-task-types (3), ty3-workflows-steps (3), ty7-step (3), users-us7-flows (3), wp13-narrow-rule (3), ad1-designer-states (2), ad3-labels-shell (2), admin-holidays (2), as5-forms (2), as757-assignee-suggestions (2), calendar (2), column-filters-rereview (2), column-filters-work-lists (2), dashboard-breakdowns (2), dashboard-fixed-height (2), final-verification (2), mm-qa (2), profile-absences (2), profile-pf7-keyboard (2), pv-export (2), pw3-strip (2), pw6-assign (2), sh-create-task (2), sh-list-load-error (2), sh-page-header (2), sh1-skip-link (2), sr3-grids (2), task-lifecycle (2), task-queue-copy (2), task-types-tabs (2), ty4-task-type (2), ty6-version-bar (2), ty8-designer-owners (2), ty9-audit (2), users-pods (2), wp10-hold-colours (2), wp10-matter-tabs (2), wp11-view-counts (2), wp20-resize (2), wp21-fit-menu (2), wp5-toolbar (2), wp6-client-overview (2), wp7-inline-row-actions (2), wp8-matter-cell (2), ad3-priorities-delete (1), ad3-priorities-list (1), ad4-asset-type-record (1), ad4-asset-types-list (1), ad5-link-roles (1), ad7-audit (1), ad8-axe-reflow (1), ad8-focus-rules (1), as2-record-page (1), assets-final (1), assets-keyboard (1), assets-screen (1), column-filters (1), dashboard-grid-resize (1), dashboard-scope (1), detail-layout (1), due-dates (1), landing (1), lc-list-toolbar (1), lc09-grid-scroll (1), matter-client-details-tab (1), md-notes-parity (1), md-summary (1), md-tasks-look (1), my-work-strip (1), my-work-vocabulary (1), page-header-icons (1), profile-availability (1), profile-pf4-hours-zone (1), profile-pf5-dialog (1), pv-asset-report-builder (1), pv-assets-pages (1), pv-final-gate (1), pv-matters-list (1), pv-task-types-on-hold (1), pw1-bugs (1), pw4-workload (1), pw7-keyboard (1), rp5-reports-admin (1), sh-403-in-place (1), sh-final-contract (1), sh-focus-heading (1), sh-rail-icons (1), sh-state-pages (1), sh1-user-name (1), sr3-results-tabs (1), sr6-a11y (1), swimlane-big-screens (1), t4-menus-dialogs (1), t7-comments-activity (1), task-create (1), task-detail-layout (1), task-detail-t1 (1), task-detail-t6 (1), task-detail-t9 (1), task-type-icons (1), tip-axe (1), ty-dialogs (1), ty-titles-crumbs (1), ty5-workflow (1), ty6-version-leave (1), ty6-version-tabs (1), ty8-designer-panes (1), ty8-designer-readonly (1), users-us03-us04 (1), users-us1-bugs (1), users-us2-status (1), users-us6-editors (1), users-us7-matrix (1), workflow-steps (1), wp1-dialogs-popovers (1), wp12b-keyboard (1), wp14-due-cell (1), wp19-compact (1), wp2-list-states (1), wp24-toolbar-keys (1), wp25-dash-due (1), wp26-print (1), wp9-fixed-layout (1).

Causes I confirmed or believe (each needs its own look, not yet fixed):
- **Users administration** (users-us*, users-tab, users-capacity, users-pods): the grid is a record grid; rows of 47-48 px **wait for #1285** (users-us3-grid, users-us8-final, others that assert 44 px); the drawer is 520 px wide where the specs say 480; the Roles and Pods cells are popovers; unknown selectors (\`tr[data-pod]\`, copy texts).
- **Profile** (profile-pf1, pf3, pf4, pf5, pf7, pf8, profile-absences): the old status radio and the header action were removed (the matching tests were deleted, see the commits); the rest still uses \`data-updated-note\`, \`data-stale\` and the old description line and needs a rewrite to the new page.
- **Row, column and header measures** (wp8-list-chrome, wp9-list-columns, wp13-narrow-rule, wp16, wp20 to wp22, clients-*, task-header-t2, task-status-note-t3, ux-round-4 at 1280 px): numbers and selectors of the standardised grids; ux-round-4/lc09 at 1280 and 1023 px need D-82 review.
- **Dashboard** (dashboard-shell, dashboard-permissions, dashboard-v4-summary, dashboard-period, dashboard-audit, dashboard-breakdowns): control and panel texts and the compact gauge.
- **Task Types / Workflows lists** (ty2-*, ty3-*, ty9-keyboard): counts with thousands separators ("1,073"), request shapes of the tab counts, 25 rows against 30 rows per page.
- **Dialogs and forms** (as2/as3/as5, pv-*, review-round-5, rich-description, email-intake, px5/px6, sr5-filters): dialog titles in Title Case and new form controls.
- Tests that need a fresh database: a few (profile-pf8-final, users-us6-editors) create fixed names and fail with 409 on a second run on the same database; a clean run is needed for them.

## 4. Real defects and open questions

### 4.1 Filed
- **#1281** QA e2e: the waiting-users badge on Administration > Users fails axe color-contrast (2.51:1) in the compact rail at 1024 px (dark text on the danger background). Low priority: 1024 px is not a design size.

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
