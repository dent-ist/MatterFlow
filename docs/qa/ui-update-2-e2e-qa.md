# ui-update-2: end-to-end (Playwright) QA of `dev` (agent QA2)

Date: 2026-11-07. Subject: `origin/dev` at fd1428f (equal to the finished `ui-update-2`). Worktree `/home/user/wt/qa2`, local branch `qa2-work`, pushed to `origin/qa-e2e-fixes` (test-only changes, no application code touched, no pull request).

## 1. Verdict

**Not ready on the e2e side.** The first full run failed 680 of 2,542 tests (1,749 passed, 40 skipped, 73 did not run). Almost all failures are specs that were edited for the UI standardisation but never run. A first round of test-only fixes cut the failing tests to about 414 (third run, below), but **414 failing tests in 172 spec files are still unresolved**. They have not been proven stale one by one: I classified them from the error text and from reading the application code for the biggest families only. One small application defect was found and filed (issue #1281, low priority). The release gate for e2e is therefore open: the remaining families need a spec rewrite pass (about 170 files) and a clean full run before `dev` goes to `uat`/`main`.

## 2. What was run, and how

| Run | What | Result |
| --- | --- | --- |
| 1 | Whole suite, `E2E_WORKERS=2 npm run e2e -- --trace off`, own SQL Server container, API on port 5290, `E2E_SKIP_BUILD=1` after a manual publish (see 6) | 2,542 tests: **1,749 passed, 680 failed, 40 skipped, 73 did not run, 0 flaky** (retries are off locally), 2.1 h |
| 2 | The 592 failed test locations re-run on a kept stack (not alone) after the first fix commits | 150 passed, 481 failed, 13 skipped |
| sensitive | `npm run e2e -- sensitive-` (switch on by itself, own stack on port 5291) | 14 tests: 7 passed, 7 failed (section 4.4) |
| 3 | The same 592 locations (633 tests) after all fixes, kept stack | the run hit the 50 minute `timeout` of my wrapper at test 587 of 633: **173 passed, 414 failed** in the 587 that finished, 46 not evaluated |
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

### 3.2 Still failing after the fixes (run 3: 414 tests in 172 files, not fixed)

Most of these look like stale specs for pages that were rebuilt, but each file needs its own look. Families with the cause I could confirm from the code or the error:

- **Profile page** (profile-pf1, pf4, pf5, pf7, profile-absences, profile-availability): the Available / Out of office radio (`[data-status-available]`) and the page action "Set out of office..." no longer exist; availability is changed through the absence dialogs. The specs need a rewrite. (a)
- **Users administration** (users-us1 ... us8, users-tab, users-capacity, users-pods, users-us-copy-roles): the grid is now a record grid (`tr[data-record-id]`, no `.mf-table-wrap`), the Roles and Pods cells are popovers, rows are 48 px where the specs expect 44 (needs a decision: see 4.3), dialog texts changed (Deactivate). (a, one possible (b))
- **Admin lookups** (ad3-priorities-edit/list, ad6-custom-fields, ad3-labels, ad4, ad5, ad7): dialog titles are Title Case ("New Priority"), the grip and the flag are new, menu items are Title Case ("Edit Fields"), H1 contains a version badge. (a)
- **Task Types / Workflows** (task-types-tabs, ty2-*, ty3-*, ty9-keyboard, ty-record-states, ty6): row selectors by name, thousands separators in counts ("1,073"), the strip counts come from a different request. (a)
- **Task and My Work lists** (task-permissions-t10, task-header-t2, task-status-note-t3, wp8-list-chrome, wp9-list-columns, wp13-narrow-rule, wp19, wp20, wp22, clients-keyboard, clients-final, clients-permissions, my-work-*, pw3-strip, wp16): texts, row heights and column widths of the standardised grids; "Pod field in Edit" in task-permissions-t10 (see 4.3). (a)
- **Dashboard** (dashboard-v4-summary, dashboard-shell, dashboard-period, dashboard-permissions, dashboard-trends-types): control names and spacing of the new dropdowns, panel texts. (a)
- **Fixed-size and layout checks** (ux-round-4 at 1280, lc09-grid-scroll at 1024, ty3-narrow-columns, column-filters at 1024): widths that are not D-82 sizes; to be removed or moved to 1366 and 1098/1023. (a, D-82)

Remaining files and failing test counts (run 3): ad3-priorities-edit (10), clients-keyboard (9), ad6-custom-fields (9), task-permissions-t10 (8), profile-pf7-permissions (8), task-types-tabs (7), profile-pf1-bugs (7), users-us6-pods (6), users-us4-drawer (6), users-us3-grid (6), ty9-keyboard (6), wp16-more-views (5), users-us8-final (5), task-status-note-t3 (5), task-header-t2 (5), pm-matters (5), my-work-per-tab-columns (5), md-forms-grid (5), dashboard-v4-summary (5), dashboard-trends-types (5), dashboard-shell (5), wp13-narrow-rule (4), ux-round-4 (4), users-us7-flows (4), users-us-copy-roles (4), users-capacity (4), ty3-lists (4), sh5-toast-host (4), rich-description (4), profile-pf7-keyboard (4), dashboard-permissions (4), column-filters-work-lists (4), clients-permissions (4), clients-final (4), wp20-resize (3), wp19-compact (3), users-us1-bugs (3), users-pods (3), ty3-narrow-columns (3), ty2-states (3), ty2-shell (3), task-due-inline (3), t8-edit-create (3), swimlane-board (3), sr5-filters (3), review-round-5 (3), px6-matrix (3), px5-matter (3), pv-saved-views (3), pv-asset-report-builder (3), pv-asset-disposition (3), my-work-page-state (3), mm-ui-update (3), lc09-grid-scroll (3), final-verification (3), email-intake (3), coverage-by-type (3), column-filters-admin (3), calendar (3), as3-list (3), wp14-due-cell (2), wp11-view-counts (2), wp10-matter-tabs (2), wp10-hold-colours (2), ty8-designer-owners (2), ty6-version-bar (2), ty-permissions-matrix (2), tip-axe (2), task-queue-copy (2), task-lifecycle (2), task-detail-layout (2), sr3-grids (2), sh1-skip-link (2), sh-page-header (2), sh-list-load-error (2), sh-create-task (2), sh-403-in-place (2), pw6-assign (2), pw4-workload (2), pw3-strip (2), pv-export (2), profile-absences (2), my-work-links-copy (2), my-work-drill-in (2), mm-qa (2), matter-client-details-tab (2), lc-list-toolbar (2), detail-layout (2), dashboard-period (2), dashboard-breakdowns (2), dashboard-audit (2), comments-activity (2), column-filters-rereview (2), assignment-and-views (2), as757-assignee-suggestions (2), as5-forms (2), admin-holidays (2), ad7-audit (2), ad4-asset-type-record (2), ad3-labels-shell (2), wp22-columns-widths (1), wp21-fit-menu (1), wp2-list-states (1), wp1-dialogs-popovers (1), workflow-steps (1), users-us7-matrix (1), users-us2-status (1), users-us03-us04 (1), ty9-audit (1), ty8-designer-readonly (1), ty8-designer-panes (1), ty6-version-leave (1), ty3-workflows-steps (1), ty3-task-types (1), ty2-strips (1), ty1-list-return (1), ty-titles-crumbs (1), ty-dialogs (1), task-type-icons (1), task-detail-t9 (1), task-detail-t1 (1), t7-comments-activity (1), swimlane-big-screens (1), sr6-a11y (1), sr3-results-tabs (1), sh1-user-name (1), sh-state-pages (1), sh-rail-icons (1), sh-focus-heading (1), sh-final-contract (1), rp5-reports-admin (1), pw8-final (1), pw7-keyboard (1), pw2-scope (1), pw1-bugs (1), pv-task-types-on-hold (1), pv-matters-list (1), pv-final-gate (1), pv-assets-pages (1), profile-pf8-final (1), profile-pf5-dialog (1), profile-pf4-hours-zone (1), profile-pf3-layout (1), profile-availability (1), page-header-icons (1), my-work-vocabulary (1), my-work-strip (1), my-work-new (1), my-work-columns-sorts (1), md-tasks-look (1), md-summary (1), md-notes-parity (1), md-matter-header (1), landing (1), edit-task-sections (1), due-dates (1), detail-page-states (1), dashboard-scope (1), dashboard-grid-resize (1), column-filters (1), assets-screen (1), assets-keyboard (1), assets-final (1), as2-record-page (1), ad8-tab-stops (1), ad8-focus-rules (1), ad8-axe-reflow (1), ad5-link-roles (1), ad4-asset-types-list (1), ad3-priorities-list (1), ad3-priorities-delete (1), ad1-designer-states (1).

## 4. Real defects and open questions

### 4.1 Filed
- **#1281** QA e2e: the waiting-users badge on Administration > Users fails axe color-contrast (2.51:1) in the compact rail at 1024 px (dark text on the danger background). Low priority: 1024 px is not a design size.

### 4.2 Not defects
- The 37 setup failures (4.3 of the coordinator's question): intended API rule, see 3.1.
- Dashboard "Calendar" tab, Pod Work "All Open": intended.

### 4.3 Possible defects I could not confirm (no issue filed)
- Users grid rows measure 48 px (users-us3-grid, users-us8-final) where D-44o and the specs say 44. Either the specs are out of date or the grid regressed; needs a look at the design.
- task-permissions-t10: with `Task.Assign` the Edit Task dialog has no field with the accessible label "Pod" ("Pod field in Edit"). It may only have been renamed; not checked in the browser.
- task-types-tabs: the breadcrumb of a form type reads "FormForm" in the accessibility tree (a duplicated label); to check by a person.

### 4.4 Sensitive pass
`npm run e2e -- sensitive-`: 7 of 14 passed. Failures: sensitive-leak-scan (5, the report "Group By" is now a dropdown: **spec fixed, not re-run**), sensitive-ui marking dialog (title changed to "Mark Matter Sensitive": **spec fixed, not re-run**), sensitive-ui axe at both desktop sizes (the account menu button had no accessible name on the assignee's My Work page once: not reproduced or diagnosed; **open**, to check). The leak scan therefore has **not yet shown that nothing leaks**: it stopped at the first screen of every person. This must be re-run before release.

## 5. Machine, disk and time

4 cores, 15 GB RAM, 2 workers (memory stayed far below 11 GB). Disk was the limit: 2.9 GB free at the start; npm ci took 0.5 GB, the build and publish 0.3 GB, the SQL container grew by about 0.4 GB per full run; failure videos were deleted during the run (`--trace off`). The lowest free space was 0.8 GB (the coordinator then deleted `amazing_bohr`); the 600 MB guard never fired. `ng build` printed "Output location" but its wrapper did not exit; I ended my own wrapper and ran `dotnet publish` and the copy into `wwwroot` by hand (the same steps as `deploy/publish.sh`). The machine restarted once: the run in progress was repeated. The Angular build prints three SCSS budget warnings (page.scss, notes-tab-panel.scss, roles-page.scss); they do not fail the build. Wall time of the e2e work: about 9 hours, of which 2.1 h run 1, about 0.8 h each for runs 2 and 3; effort about 9 agent-hours.

## 6. Recommendation

Do not release on the e2e side yet. (1) Rewrite the 172 remaining spec files in the families of 3.2 (about 400 tests), starting with Profile, Users and the admin lookups; (2) re-run the sensitive pass (4.4); (3) run the whole suite again and require 0 failures; (4) look at the three questions in 4.3 and at #1281. The application itself shows no sign of a broken flow in the first run beyond those items, but a stale spec can hide a real regression, so the 414 are not cleared.
