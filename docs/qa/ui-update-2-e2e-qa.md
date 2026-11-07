# ui-update-2: end-to-end (Playwright) QA of `dev` (agent QA2)

Date: 2026-11-07. Subject: `origin/dev` at fd1428f (equal to the finished `ui-update-2`). Worktree `/home/user/wt/qa2`, local branch `qa2-work`, pushed to `origin/qa-e2e-fixes` (test-only changes, no application code touched, no pull request).

## 1. Verdict

**Not ready on the e2e side: 294 failing tests in 159 spec files remain.** Stage 4 final clean full run (new database, rebuilt publish of `qa-e2e-fixes` + `ui-fixes`, all 2,514 tests): **2,101 passed, 294 failed, 119 skipped**. Progress: 1,749 / 680 (first run), 2,032 / 390 (stage 2), 2,058 / 362 (stage 3), 2,101 / 294 (stage 4). The sensitive pass is **14 of 14** (leak scan and the other sensitive tests). Fixes are test-only. The gate stays open: every remaining failure is listed per file in 3.2, most of them old specs of rebuilt pages that need a rewrite against the live page.

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
| 7 | Stage 4 sensitive pass | **14 passed** |
| full 4 | **Clean full run, stage 4**, tree = qa-e2e-fixes + ui-fixes b2650b4, 2 workers, 1.9 h | **2,101 passed, 294 failed, 119 skipped, 0 flaky** (2,514 tests) |
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

### 3.2 Stage 4: what was done, and what is still failing (full run 4: 294 tests in 159 files)

Stage 4 work, per family (failing before -> in the slice after): Users administration 32 -> 18 (record-grid headers and rows, drawer error text, Make Primary only when offered, 403 text, Tab-stop budget 18, unique run tags); Profile 17 -> about 10 (four stale-note tests, one preview test, two save-bar tests and review-round-5 capture and UXR5-04 deleted: the Status radio and the stale coupling are gone; wording fixes); measures 60 -> 13 (Due 152 px arithmetic in wp20, wp21, wp22; record links `a[data-row-key]`; numeric dates in the status note; matter strip assertions removed because the strip was removed); Task Types / Workflows wording (Retire dialogs without question mark, "Couldn't save", counts with thousands separators, Title Case headings).
Rules applied as asked: deleted only tests of removed features or narrow windows under 1280 px (lc09 at 1024, wp13 at 1023, dashboard-shell phone widths); ux-round-4 now checks the default columns at 1366; the progress control is a 24 px line (the guideline gives no smaller bar), so that test allows at most 24 px.

Still failing, sorted by number of tests, with the first error as the reason (each needs a look at the live page; none is proven stale and none is claimed as a defect except where an issue is named):

- users-tab (11): locator('[data-user-card][data-user="ke\\\\e2e-wlkybq45d208- expected /, 0 open tasks, Idle, Out of Office unt got "ke\\e2e-wlkybq45d208-kyragq436, 0 open 
- ty9-keyboard (5): locator('a[data-row-key]') expected 25 got 30
- wp8-list-chrome (5): locator('[data-grid-toolbar]') expected 0 got 1
- clients-final (4): locator('mf-scoped-tasks [data-strip]') expected visible
- clients-keyboard (4): Error: expect(page).toHaveURL(expected) failed /  / Expected pattern:  expected /\/projects\/15/ got "http://127.0.0.1:5290/matters/144?tab=p
- matter-columns (4): Error: expect(received).toBeGreaterThanOrEqual(expected) /  / Expected expected >= 160 got 120
- md-forms-grid (4): Error: page.evaluate: TypeError: Cannot read properties of undefined (
- sh5-toast-host (4): locator('[data-toast][data-severity="error"]') expected 1 got 0
- ty2-strips (4): event "response"
- ty3-lists (4): locator('.mf-table-wrap, ul[data-record-cards]').first()
- ad3-priorities-edit (3): locator('tbody tr[data-row], li.rc').filter({ has: getByRole expected visible
- ad6-custom-fields (3): getByRole('navigation', { name: 'Breadcrumb' }).locator('li'
- as3-list (3): locator('tbody tr[data-record-id]').first() expected "64" got ""
- clients-permissions (3): Error: project links in the Tasks grid /  / expect(received).toBe(expe expected true got false
- coverage-by-type (3): getByRole('button', { name: /^Order:/ })
- dashboard-period (3): locator('[data-period] button') expected "90d"
- dashboard-v4-summary (3): locator('mf-dash-grid [data-list-count]') expected "168"
- mm-ui-update (3): locator('mf-mm-task-list tr[data-task]').first().locator('mf expected 1 got 0
- pm-matters (3): locator('[data-managers]') expected "(primary)" got "Primary PMPFPM Alpha FXX5Y"
- profile-pf3-layout (3): locator('[data-name]') expected "pf2long Featherstonehaugh Cholmondeley  got ""
- pv-saved-views (3): locator('[data-export-menu] [data-overflow]')
- px5-matter (3): locator('p-dialog').locator('[data-task-list] label') expected 2 got 0
- px6-matrix (3): Error: expect(received).toEqual(expected) // deep equality /  / Expect expected ArrayContaining ["health", "status", "de got []
- swimlane-board (3): getByRole('menu', { name: 'Board options' }).getByRole('menu
- t8-edit-create (3): locator('[data-locked-fields]') expected in viewport got viewport ratio 0
- task-detail-final (3): locator('[data-task-header] .mf-btn--primary').filter({ visi expected /Reopen task/ got " Reopen Task "
- task-header-t2 (3): Error: Workflow y at 1366 /  / expect(received).toBeLessThanOrEqual(ex expected <= 300 got 316
- ty2-shell (3): Error: expect(received).toEqual(expected) // deep equality /  / - Expe
- ty2-states (3): locator('[data-empty="none"]').locator('a, button') expected 0 got 1
- ty3-narrow-columns (3): locator('.mf-table-wrap')
- ty3-task-types (3): locator('tbody .chip') expected 0 got 3
- ty3-workflows-steps (3): locator('tbody tr:is([data-row], [data-record-id])').last() expected "1dcopli12 Draft only" got ""
- users-capacity (3): getByRole('button', { name: 'Hide them' })
- ux-round-4 (3): locator('[data-icon-trigger]') expected /Icon.*Document.*Change icon/
- wp21-fit-menu (3): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected 144 got 152
- ad1-designer-states (2): getByRole('navigation', { name: 'Breadcrumb' }).getByRole('l
- ad3-labels-shell (2): getByRole('tab')
- admin-holidays (2): getByRole('dialog', { name: 'Import or paste holidays' }).ge
- calendar (2): locator('[data-day][data-level="GOOD"], [data-day][data-leve expected 1 got 0
- column-filters-admin (2): getByRole('region', { name: 'Users list, scrollable' }).loca expected "Pending Access"
- column-filters-rereview (2): getByText(/match these filters/) expected visible
- column-filters-work-lists (2): getByRole('textbox', { name: 'Filter by Project' })
- dashboard-audit (2): getByRole('tablist', { name: 'Dashboard views' }).getByRole( expected focused got inactive
- dashboard-breakdowns (2): locator('[data-section="breakdowns"]').locator('mf-bar-list'
- dashboard-permissions (2): Error: expect(received).toBeLessThanOrEqual(expected) /  / Expected: < expected <= 1078 got 1233
- dashboard-shell (2): getByRole('button', { name: 'View as pie for Priority' }) expected focused
- final-verification (2): locator('a.tile').first() expected visible
- matter-client-details-tab (2): getByRole('tab', { name: 'Summary' }) expected focused got inactive
- mm-qa (2): getByRole('dialog').getByRole('button', { name: 'Add item' }
- my-work-per-tab-columns (2): locator('[data-task]').filter({ hasText: 'Assigned df9b6jp34 expected "12 d"
- pv-export (2): locator('[data-export-menu] [data-overflow]') expected /not a status report/
- pw6-assign (2): locator('.im-pop').getByRole('menuitemradio', { name: 'ke\\e expected visible
- sh-create-task (2): getByRole('button', { name: 'New Task' }) expected 1 got 0
- sh-list-load-error (2): locator('[data-toast]') expected 0 got 1
- sh-page-header (2): Error: title height at 1366: one line /  / expect(received).toBeLessTh expected <= 37 got 39.375
- sh1-skip-link (2): locator('a.mf-skip[data-skip-list]') expected /Skip to (task list/table)/ got "Skip to Task List"
- sr3-grids (2): getByRole('region', { name: 'Assets (58)' }) expected visible
- swimlane (2): locator('[data-lane="NEW"]').getByRole('tree').locator('[rol expected "8"
- task-detail-t9 (2): locator('[data-panel="unassigned"] a.main[data-row-key="3468 expected visible
- task-due-inline (2): locator('[data-due-live]') expected "Due date set to 10/24/2030 05:00 PM" got "Due date set to 10/24/2030 5:00 PM"
- task-lifecycle (2): locator('[data-status-note]') expected "ke\\kekim" got "On hold since 11/07 03:15 PM by kekim: 
- task-queue-copy (2): getByRole('toolbar', { name: 'Quick views' }).getByRole('but
- task-types-tabs (2): getByRole('tab')
- tip-axe (2): locator('[data-tree-collapse]')
- ty-permissions-matrix (2): Error: /admin/priorities: 4 tab links for Priority=true, Status=true /
- ty4-task-type (2): Error: note at 1366: axe /  / expect(received).toEqual(expected) // de
- ty6-version-bar (2): getByRole('dialog').getByRole('button', { name: 'Cancel' }) expected focused
- ty7-step (2): locator('[data-footer] button')
- users-us-copy-roles (2): locator('[data-role="522"] .mf-name') expected "usc95034mpnq Senior Document Review Coo got "usc95034mpnq Senior Document Review Coo
- users-us4-drawer (2): locator('[data-pods-popover]').locator('[data-pods-apply]')
- users-us7-flows (2): Error: expect(received).toEqual(expected) // deep equality /  / - Expe
- users-us8-final (2): Error: axe, user panel open, 1366x768 /  / expect(received).toEqual(ex
- wp10-matter-tabs (2): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected 36 got 40
- wp11-view-counts (2): locator('[data-view="overdue"]').locator('.qv-n:not([data-co expected visible
- wp13-narrow-rule (2): Error: expect(received).toBeGreaterThanOrEqual(expected) /  / Expected expected >= 160 got 120
- wp16-more-views (2): Error: all views at 1366 /  / expect(received).toEqual(expected) // de
- wp20-resize (2): Error: expect(received).toBeLessThanOrEqual(expected) /  / Expected: < expected <= 1 got 44
- wp22-columns-widths (2): locator('[data-width-row="title"]') expected "Fills the space left" got "Title Reset Width "
- wp5-toolbar (2): locator('[data-toolbar-row2] [data-sort-note]') expected 1 got 0
- wp6-client-overview (2): Error: expect(received).toEqual(expected) // deep equality /  / - Expe
- wp7-inline-row-actions (2): locator('[data-task]').filter({ hasText: 'Step 3i7ibds76' }) expected "1 of 2"
- ad3-priorities-delete (1): locator('tbody tr[data-row], li.rc').filter({ has: getByRole
- ad3-priorities-list (1): locator('tbody tr[data-row], li.rc').filter({ has: getByRole expected "3"
- ad4-asset-type-record (1): getByRole('navigation', { name: 'Breadcrumb' }).locator('li'
- ad4-asset-types-list (1): locator('tr:has(td[data-row="Alpha jobamfq29"])').locator('[ expected /Updated [A-Z][a-z]{2} \d{1,2}/ got "Published v18 fields · Updated 11/07"
- ad5-link-roles (1): getByRole('menuitem')
- ad7-audit (1): Error: expect(received).toContain(expected) // indexOf /  / Expected v expected "Asset Type" got ["Any Object", "Configuration Changes", 
- ad8-axe-reflow (1): locator('tr[data-row="Matter"], li.rc').first() expected visible
- ad8-focus-rules (1): locator('tr[data-row="Focus Type le8w8cj21"]') expected visible
- ad8-tab-stops (1): locator('[data-announce]') expected "moved to position" got ""
- as5-forms (1): getByText('Asset Created nhars8r17 saved') expected visible
- assets-final (1): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected 3 got 4
- assets-keyboard (1): Error: expect(received).toBeLessThanOrEqual(expected) /  / Expected: < expected <= 6 got 22
- assets-screen (1): getByRole('region', { name: 'Assets list, scrollable' }).loc expected 8 got 9
- column-filters (1): getByRole('dialog', { name: 'Filters' }) expected visible
- dashboard-grid-resize (1): Error: type: title keeps its width /  / expect(received).toBeLessThanO expected <= 1.5 got 6
- detail-layout (1): Error: expect(received).toBeGreaterThan(expected) /  / Expected: > 127 expected > 1270 got 1266
- lc-list-toolbar (1): getByRole('columnheader', { name: /^Name/ }).getByRole('butt
- md-notes-parity (1): locator('[data-notes-list] [data-notes-controls]').getByRole expected visible
- md-summary (1): Error: columns at 768 /  / expect(received).toBe(expected) // Object.i expected 1 got 2
- md-tasks-look (1): getByRole('tooltip') expected /^\d+ of \d+ steps$/
- my-work-strip (1): Error: expect(received).toBeLessThan(expected) /  / Expected: < 112.37 expected < 112.375 got 162.375
- my-work-vocabulary (1): Error: expect(received).toEqual(expected) // deep equality /  / - Expe
- page-header-icons (1): getByRole('heading', { level: 1 }).locator('i[data-page-icon expected /pi-compass/
- profile-absences (1): getByRole('button', { name: 'Add Out of Office' }).first()
- profile-availability (1): locator('tbody tr').filter({ hasText: 'ke\\e2e-axe1366-i636b expected visible
- profile-pf5-dialog (1): locator('[data-ooo-label]') expected "Out of office until Nov 14"
- pv-asset-disposition (1): getByRole('dialog').getByRole('button', { name: 'Set Asset I
- pv-asset-report-builder (1): getByRole('dialog').getByRole('button', { name: 'Rename', ex
- pv-assets-pages (1): getByRole('columnheader', { name: 'Size' }).getByRole('butto
- pv-final-gate (1): locator('[data-filter-toggle]')
- pv-task-types-on-hold (1): locator('[data-row="E2E Type m5vv9lm22"]').locator('[data-ta expected "4"
- pw1-bugs (1): Error: expect(received).not.toBe(expected) // Object.is equality /  /  expected not "103"
- pw2-scope (1): locator('[data-pod-list]').locator('button') expected 130 got 124
- pw7-keyboard (1): Error: expect(received).not.toBe(expected) // Object.is equality /  /  expected not "172"
- review-round-5 (1): getByRole('dialog').locator('[data-actions]') expected visible
- rich-description (1): Error: page.evaluate: TypeError: Cannot read properties of null (readi
- rp5-reports-admin (1): locator('tr:has(td[data-row="Added s9dxme354"])') expected visible
- sh-403-in-place (1): locator('[data-back-link]') expected focused got inactive
- sh-final-contract (1): getByRole('navigation', { name: 'Main' }).locator('[data-nav
- sh-focus-heading (1): locator('[data-back-link]') expected focused got inactive
- sh-rail-icons (1): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected "21px" got "19px"
- sh-state-pages (1): locator('[data-back-link]') expected focused got inactive
- sh1-user-name (1): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected 57 got 53
- sr3-results-tabs (1): getByRole('region', { name: 'Tasks (30)' }) expected visible
- sr5-filters (1): getByRole('button', { name: /^Remove filter Task status: On 
- sr6-a11y (1): getByTestId('search-button')
- swimlane-big-screens (1): Error: summary 2560 /  / expect(received).toBeLessThanOrEqual(expected expected <= 1360 got 2292
- t4-menus-dialogs (1): getByRole('dialog').getByRole('button', { name: 'Keep' }) expected visible
- t7-comments-activity (1): locator('[data-comment-id]').first().locator('time') expected /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}: got "11/07 03:09 PM"
- task-detail-layout (1): Error: expect(received).toBeGreaterThan(expected) /  / Expected: > 127 expected > 1270 got 1266
- task-detail-t1 (1): locator('[data-toast]') expected 0 got 1
- task-detail-t5 (1): getByRole('tablist', { name: 'Task sections' }).getByRole('t expected focused got inactive
- task-detail-t6 (1): locator('[data-filter="unresolved"]')
- task-type-icons (1): getByRole('dialog', { name: 'Change task type' }).getByRole(
- ty-dialogs (1): locator('[data-status]') expected "Published v2"
- ty-titles-crumbs (1): TypeError: Cannot read properties of null (reading 'height')
- ty5-workflow (1): getByRole('menuitem', { name: /Create draft from this versio expected "true"
- ty8-designer-owners (1): getByRole('heading', { level: 1 }) expected "Client custom fields"
- ty8-designer-readonly (1): getByRole('dialog', { name: /Discard/ }) expected visible
- ty9-audit (1): getByRole('button', { name: /^Versions/ }).first()
- users-pods (1): getByRole('tab')
- users-us03-us04 (1): getByRole('region', { name: 'Skills matrix, scrollable' }) expected visible
- users-us2-status (1): locator('[data-strip-item="active"]') expected "1588" got "Active   1,588"
- users-us3-grid (1): Error: POST /api/v1/roles -> 409: {"type":"urn:matterflow:error:duplic
- users-us6-editors (1): Error: POST /api/v1/roles -> 409: {"type":"urn:matterflow:error:duplic
- users-us6-pods (1): Error: POST /api/v1/pods -> 409: {"type":"urn:matterflow:error:duplica
- users-us7-matrix (1): Error: User.View + User.Manage /  / expect(received).toEqual(expected)
- workflow-steps (1): getByRole('dialog').getByRole('button', { name: 'Skip Step' 
- wp1-dialogs-popovers (1): getByRole('dialog').filter({ has: locator('[data-reason-body expected "Workflow steps can't be changed while i got " TSK-4913 stays On Hold until someone r
- wp10-hold-colours (1): locator('tbody tr, li[data-task]').filter({ has: getByRole(' expected 1 got 0
- wp12b-keyboard (1): getByRole('switch', { name: /Keyboard Shortcuts/ }) expected checked
- wp14-due-cell (1): locator('[data-task="TSK-5092"] td[data-col="due"] .dc').loc expected "Overdue 120d" got " +120d "
- wp19-compact (1): Error: forced colours /  / expect(received).toEqual(expected) // deep 
- wp2-list-states (1): locator('[data-empty=none]') expected /No projects yet\. Open a matter and cho
- wp24-toolbar-keys (1): getByRole('toolbar', { name: 'Quick views' }).locator('> but expected /^Unassigned/ got "More views"
- wp25-dash-due (1): Error: overdue24d: Swimlane card = queue row /  / expect(received).toE
- wp8-matter-cell (1): getByRole('button', { name: /Reset columns/ })
- wp9-fixed-layout (1): Error: nothing is cut off at 1366 for /tasks?q=5d3zjgf11 /  / expect(r

What these would need, by value:
1. **Waiting for an application fix:** wp13-narrow-rule Title width (#1295); users-us8-final heading-order (#1294); the availability chip date format (#1293, the specs are green once the casing is fixed).
2. **Dashboard Users tab** (users-tab 11, users-capacity 3): the page was redesigned (the "Who is counted" popover holds Show them / Hide them, the capacity strip and the view switch moved); needs a rewrite from the current page object.
3. **Task Types / Workflows lists and designer** (ty2, ty3, ty4, ty5, ty6, ty7, ty8, ty9): selectors of the record grid, the version bar and the dialogs; 25 versus 30 rows per page (ty9-keyboard) needs the page size decided.
4. **Matter and client pages** (px5, px6, wp7-matter-overview, clients-final, clients-keyboard): the matter overview strips were replaced by the Summary tab (D-44f); the specs must target the Summary tab and the Tasks tab strip instead.
5. **Measures** (wp8-list-chrome, wp13, wp16, wp20 drag, wp21 menu, wp22, wp9-fixed-layout, task-header-t2 budgets): numbers and toolbar markup of the standardised grids; the Workflow y budgets of task-header-t2 (300 / 275 / 40 px) need a design decision.
6. **Dialogs and forms** (as2, as3, as5, pv-*, rich-description, email-intake, sr5): form and dialog markup.
7. **Fixed names and timing** (users-us6-editors, users-us6-pods, users-us7-flows): the 409 duplicate-name errors come from requests retried under load; the run tag now has a time suffix; if it persists a unique name per call is needed.

## 4. Real defects and open questions

### 4.1 Filed
- **#1281** waiting-users badge on the Users nav item fails axe color-contrast (2.51:1) in the compact rail at 1024 px (low priority).
- **#1285** (filed by the designer) Users rows 47-48 px instead of 44: fixed on `ui-fixes`; the row-height tests pass.
- **#1293** the availability chip in grids reads `Out of Office until Oct 25, 2027` (month name); D-60 wants numeric dates in cells. users-us3-grid line 263 asserts only the prefix, so it is green once the casing is fixed; the issue is kept apart so the date format is not hidden.
- **#1294** axe `heading-order` in the Users person drawer (`<h3 id="ud-access">` without a parent heading); users-us8-final (2 tests) stays failing until it is fixed.
- **#1295** the Title column of the task grids is 120 px wide with Client and Type added at 1366 (D-43 says min 200); wp13-narrow-rule (user-added columns) stays failing.

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
