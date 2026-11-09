# ui-update-2: end-to-end (Playwright) QA of `dev` (agent QA2)

Date: 2026-11-07. Subject: `origin/dev` at fd1428f (equal to the finished `ui-update-2`). Worktree `/home/user/wt/qa2`, local branch `qa2-work`, pushed to `origin/qa-e2e-fixes` (test-only changes, no application code touched, no pull request).

## 1. Verdict

**Not ready on the e2e side: 279 failing tests in 157 spec files remain.** Stage 5 final clean full run (new database, rebuilt publish of `dev` b38af52 plus the stage 5 spec changes, all 2,515 tests): **2,139 passed, 279 failed, 97 skipped**. Trend: 1,749 / 680 (first run), 2,101 / 294 (stage 4), 2,139 / 279 (stage 5). The sensitive pass is **14 of 14**. Fixes are test-only. All 16 pixel-budget rows were decided by the designer (`docs/qa/ui-update-2-e2e-measures.md`) and applied; two page defects came out of it (#1296; and a Filters/Name-filter placement question, rows 17 and 18 of the measures doc). The duplicate-name 409s are fixed (cause proven, section 3.3).

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
| 8 | Stage 5 sensitive pass | **14 passed** |
| full 5 | **Clean full run, stage 5**, 2 workers, 2 h | **2,139 passed, 279 failed, 97 skipped, 0 flaky** (2,515 tests) |
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

### 3.2 Stage 5: what was done, and what is still failing (full run 5: 279 tests in 157 files)

Done in stage 5, per family: the designer's decisions for the pixel-budget rows applied (task-header-t2 budgets 320 / 300 / 44, wp13 Title >= 120 and the spring rule, wp20 drag with the Title giving way plus a new test with the Title at 120, wp21 Widen 160 / Narrow 152 / 144, wp22 Title row, wp9-fixed-layout ellipsis cells, wp8 toolbar, wp16 waits for the More popover); duplicate-name 409s fixed; Dashboard Users tab: the idle out-of-office card reads "Out of Office" without "until" (seeded without an end date). Issues from it: **#1296** (Matters: the open filter row shows a chip for Sensitive). #1295 (Title 120 px) is **not a page defect** (D-43a, owner decision in #1232); it should be closed as spec stale by whoever owns it.

Remaining files and failing test counts, first error as the reason (each needs a look at the live page; none is proven stale and none is claimed as a defect except where an issue is named):

- users-tab (8): Error: expect(received).toBeLessThanOrEqual(expected) /  / Expected: < expected <= 64 got 77
- ty9-keyboard (6): locator('a[data-row-key]') expected 25 got 30
- clients-final (4): locator('mf-scoped-tasks [data-strip]') expected visible
- clients-keyboard (4): Error: expect(page).toHaveURL(expected) failed /  / Expected pattern:  expected /\/projects\/17/ got "http://127.0.0.1:5290/matters/147?tab=p
- matter-columns (4): Error: expect(received).toBeGreaterThanOrEqual(expected) /  / Expected expected >= 160 got 120
- md-forms-grid (4): Error: page.evaluate: TypeError: Cannot read properties of undefined (
- sh5-toast-host (4): locator('[data-toast][data-severity="error"]') expected 1 got 0
- ty2-strips (4): event "response"
- ty3-lists (4): locator('.mf-table-wrap, ul[data-record-cards]').first()
- ad3-priorities-edit (3): locator('tbody tr[data-row], li.rc').filter({ has: getByRole expected visible
- ad6-custom-fields (3): getByRole('navigation', { name: 'Breadcrumb' }).locator('li'
- as3-list (3): locator('tbody tr[data-record-id]').first() expected "62" got ""
- clients-permissions (3): Error: project links in the Tasks grid /  / expect(received).toBe(expe expected true got false
- coverage-by-type (3): getByRole('button', { name: /^Order:/ })
- dashboard-period (3): locator('[data-period] button') expected "90d"
- dashboard-v4-summary (3): locator('mf-dash-grid [data-list-count]') expected "216"
- mm-ui-update (3): locator('mf-mm-task-list tr[data-task]').first().locator('mf expected 1 got 0
- pm-matters (3): locator('[data-managers]') expected "(primary)" got "Primary PMP2PM Alpha 230FT"
- profile-pf3-layout (3): locator('[data-name]') expected "pf2long Featherstonehaugh Cholmondeley  got ""
- pv-saved-views (3): locator('[data-export-menu] [data-overflow]')
- px5-matter (3): locator('p-dialog').locator('[data-task-list] label') expected 2 got 0
- px6-matrix (3): Error: expect(received).toEqual(expected) // deep equality /  / Expect expected ArrayContaining ["health", "status", "de got []
- swimlane-board (3): getByRole('menu', { name: 'Board options' }).getByRole('menu
- t8-edit-create (3): locator('[data-locked-fields]') expected in viewport got viewport ratio 0
- task-detail-final (3): locator('[data-task-header] .mf-btn--primary').filter({ visi expected /Reopen task/ got " Reopen Task "
- ty2-shell (3): Error: expect(received).toEqual(expected) // deep equality /  / - Expe
- ty2-states (3): locator('[data-empty="none"]').locator('a, button') expected 0 got 1
- ty3-narrow-columns (3): locator('.mf-table-wrap')
- ty3-task-types (3): locator('tbody .chip') expected 0 got 3
- ty3-workflows-steps (3): locator('tbody tr:is([data-row], [data-record-id])').last() expected "pjtxtgl12 Draft only" got ""
- users-capacity (3): getByRole('button', { name: 'Hide them' })
- ux-round-4 (3): locator('[data-icon-trigger]') expected /Icon.*Document.*Change icon/
- wp11-view-counts (3): locator('[data-view="overdue"]').locator('.qv-n:not([data-co expected visible
- ad1-designer-states (2): getByRole('navigation', { name: 'Breadcrumb' }).getByRole('l
- ad3-labels-shell (2): getByRole('tab')
- admin-holidays (2): getByRole('dialog', { name: 'Import or paste holidays' }).ge
- calendar (2): locator('[data-day][data-level="GOOD"], [data-day][data-leve expected 1 got 0
- column-filters-admin (2): getByRole('region', { name: 'Users list, scrollable' }).loca expected "Pending Access"
- column-filters-rereview (2): getByText(/match these filters/) expected visible
- column-filters-work-lists (2): getByRole('textbox', { name: 'Filter by Project' })
- dashboard-audit (2): getByRole('tablist', { name: 'Dashboard views' }).getByRole( expected focused got inactive
- dashboard-breakdowns (2): locator('[data-section="breakdowns"]').locator('mf-bar-list'
- dashboard-fixed-height (2): Error: expect(received).toEqual(expected) // deep equality /  / - Expe
- dashboard-permissions (2): Error: expect(received).toBeLessThanOrEqual(expected) /  / Expected: < expected <= 1078 got 1233
- dashboard-shell (2): getByRole('button', { name: 'View as pie for Priority' }) expected focused
- final-verification (2): locator('a.tile').first() expected visible
- mm-qa (2): getByRole('dialog').getByRole('button', { name: 'Add item' }
- my-work-per-tab-columns (2): locator('[data-task]').filter({ hasText: 'Assigned zlt2cpy35 expected "12 d"
- pv-asset-report-builder (2): getByRole('dialog').getByRole('button', { name: 'Rename', ex
- pv-export (2): locator('[data-export-menu] [data-overflow]') expected /not a status report/
- pw6-assign (2): locator('.im-pop').getByRole('menuitemradio', { name: 'ke\\e expected visible
- sh-create-task (2): getByRole('button', { name: 'New Task' }) expected 1 got 0
- sh-list-load-error (2): locator('[data-toast]') expected 0 got 1
- sh-page-header (2): Error: title height at 1366: one line /  / expect(received).toBeLessTh expected <= 37 got 39.375
- sh1-skip-link (2): locator('a.mf-skip[data-skip-list]') expected /Skip to (task list/table)/ got "Skip to Task List"
- sr3-grids (2): getByRole('region', { name: 'Assets (58)' }) expected visible
- sr3-results-tabs (2): getByRole('region', { name: 'Tasks (30)' }) expected visible
- swimlane (2): locator('[data-lane="NEW"]').getByRole('tree').locator('[rol expected "8"
- task-due-inline (2): locator('[data-due-live]') expected "Due date set to 10/24/2030 05:00 PM" got "Due date set to 10/24/2030 5:00 PM"
- task-lifecycle (2): locator('[data-status-note]') expected "ke\\kekim" got "On hold since 11/07 07:46 PM by kekim: 
- task-queue-copy (2): getByRole('toolbar', { name: 'Quick views' }).getByRole('but
- task-types-tabs (2): getByRole('tab')
- tip-axe (2): locator('[role="tooltip"]') expected "true"
- ty-permissions-matrix (2): Error: /admin/priorities: 4 tab links for Priority=true, Status=true /
- ty4-task-type (2): Error: note at 1366: axe /  / expect(received).toEqual(expected) // de
- ty6-version-bar (2): getByRole('dialog').getByRole('button', { name: 'Cancel' }) expected focused
- ty7-step (2): locator('[data-footer] button')
- users-pods (2): getByRole('tab')
- users-us4-drawer (2): locator('[data-pods-popover]').locator('[data-pods-apply]')
- wp10-matter-tabs (2): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected 36 got 40
- wp5-toolbar (2): locator('[data-toolbar-row2] [data-sort-note]') expected 1 got 0
- wp6-client-overview (2): Error: expect(received).toEqual(expected) // deep equality /  / - Expe
- wp7-inline-row-actions (2): locator('[data-task]').filter({ hasText: 'Step shsmpvh87' }) expected "1 of 2"
- wp8-list-chrome (2): getByRole('button', { name: /^Filters/ }) expected "(2)" got " Filters (1)"
- ad3-priorities-delete (1): locator('tbody tr[data-row], li.rc').filter({ has: getByRole
- ad3-priorities-list (1): locator('tbody tr[data-row], li.rc').filter({ has: getByRole expected "3"
- ad4-asset-type-record (1): getByRole('navigation', { name: 'Breadcrumb' }).locator('li'
- ad4-asset-types-list (1): locator('tr:has(td[data-row="Alpha 4ukeu4f25"])').locator('[ expected /Updated [A-Z][a-z]{2} \d{1,2}/ got "Published v18 fields · Updated 11/07"
- ad5-link-roles (1): getByRole('menuitem')
- ad7-audit (1): Error: expect(received).toContain(expected) // indexOf /  / Expected v expected "Asset Type" got ["Any Object", "Configuration Changes", 
- ad8-axe-reflow (1): locator('tr[data-row="Matter"], li.rc').first() expected visible
- ad8-focus-rules (1): locator('tr[data-row="Focus Type 6r824iu1"]') expected visible
- as1-defects (1): locator('.dd-panel [role="option"]:not([aria-disabled="true"
- as2-record-page (1): getByRole('menuitem', { name: 'Set active' })
- as5-forms (1): getByText('Asset Created 93rvwez17 saved') expected visible
- as757-assignee-suggestions (1): Error: axe: Edit task list at 1366x768 /  / expect(received).toEqual(e
- assets-final (1): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected 3 got 4
- assets-keyboard (1): Error: expect(received).toBeLessThanOrEqual(expected) /  / Expected: < expected <= 6 got 22
- assets-screen (1): getByRole('region', { name: 'Assets list, scrollable' }).loc expected 8 got 9
- column-filters (1): getByRole('dialog', { name: 'Filters' }) expected visible
- dashboard-alignment (1): TypeError: Cannot read properties of null (reading 'y')
- dashboard-grid-resize (1): Error: type: title keeps its width /  / expect(received).toBeLessThanO expected <= 1.5 got 6
- detail-layout (1): Error: expect(received).toBeGreaterThan(expected) /  / Expected: > 127 expected > 1270 got 1266
- edit-task-sections (1): locator('#td-due-date') expected focused got inactive
- lc-list-toolbar (1): getByRole('columnheader', { name: /^Name/ }).getByRole('butt
- matter-client-details-tab (1): getByRole('dialog').getByRole('button', { name: 'Set inactiv
- md-notes-parity (1): locator('[data-notes-list] [data-notes-controls]').getByRole expected visible
- md-summary (1): Error: columns at 768 /  / expect(received).toBe(expected) // Object.i expected 1 got 2
- md-tasks-look (1): getByRole('tooltip') expected /^\d+ of \d+ steps$/
- my-work-strip (1): Error: expect(received).toBeLessThan(expected) /  / Expected: < 112.37 expected < 112.375 got 162.375
- my-work-vocabulary (1): Error: expect(received).toEqual(expected) // deep equality /  / - Expe
- page-header-icons (1): getByRole('heading', { level: 1 }).locator('i[data-page-icon expected /pi-compass/
- profile-absences (1): getByRole('button', { name: 'Add Out of Office' }).first()
- profile-availability (1): locator('tbody tr').filter({ hasText: 'ke\\e2e-axe1366-4j2vw expected visible
- pv-asset-disposition (1): getByRole('dialog').getByRole('button', { name: 'Set Asset I
- pv-assets-pages (1): getByRole('columnheader', { name: 'Size' }).getByRole('butto
- pv-final-gate (1): locator('[data-filter-toggle]')
- pv-task-types-on-hold (1): locator('[data-row="E2E Type 94ov2dr41"]').locator('[data-ta expected "4"
- pw1-bugs (1): Error: expect(received).not.toBe(expected) // Object.is equality /  /  expected not "105"
- pw2-scope (1): locator('[data-pod-list]').locator('button') expected 135 got 128
- pw7-keyboard (1): Error: expect(received).not.toBe(expected) // Object.is equality /  /  expected not "174"
- review-round-5 (1): getByRole('dialog').locator('[data-actions]') expected visible
- rich-description (1): Error: page.evaluate: TypeError: Cannot read properties of null (readi
- rp5-reports-admin (1): locator('tr:has(td[data-row="Added fcsemft1"])') expected visible
- sh-403-in-place (1): locator('[data-back-link]') expected focused got inactive
- sh-final-contract (1): getByRole('navigation', { name: 'Main' }).locator('[data-nav
- sh-focus-heading (1): locator('[data-back-link]') expected focused got inactive
- sh-rail-icons (1): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected "21px" got "19px"
- sh-state-pages (1): locator('[data-back-link]') expected focused got inactive
- sh1-user-name (1): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected 57 got 53
- sr5-filters (1): getByRole('button', { name: /^Remove filter Task status: On 
- sr6-a11y (1): getByTestId('search-button')
- swimlane-big-screens (1): Error: summary 2560 /  / expect(received).toBeLessThanOrEqual(expected expected <= 1360 got 2292
- t4-menus-dialogs (1): getByRole('dialog').getByRole('button', { name: 'Keep' }) expected visible
- t7-comments-activity (1): locator('[data-comment-id]').first().locator('time') expected /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}: got "11/07 07:40 PM"
- task-detail-layout (1): Error: expect(received).toBeGreaterThan(expected) /  / Expected: > 127 expected > 1270 got 1266
- task-detail-t1 (1): locator('[data-toast]') expected 0 got 1
- task-detail-t6 (1): locator('[data-filter="unresolved"]')
- task-detail-t9 (1): locator('[data-panel="unassigned"] a.main[data-row-key="3648 expected visible
- task-detail-tabs (1): getByRole('tablist', { name: 'Task sections' }).getByRole('t expected focused got inactive
- task-type-icons (1): getByRole('dialog', { name: 'Change task type' }).getByRole(
- ty-dialogs (1): locator('[data-status]') expected "Published v2"
- ty-titles-crumbs (1): TypeError: Cannot read properties of null (reading 'height')
- ty1-list-return (1): Error: expect(received).toBe(expected) // Object.is equality /  / Expe expected "/admin/workflows?name=h6utmt222&size=25 got "/admin/workflows/878"
- ty5-workflow (1): getByRole('menuitem', { name: /Create draft from this versio expected "true"
- ty6-version-editor (1): Error: expect(received).toEqual(expected) // deep equality /  / - Expe
- ty8-designer-owners (1): getByRole('heading', { level: 1 }) expected "Client custom fields"
- ty8-designer-readonly (1): getByRole('dialog', { name: /Discard/ }) expected visible
- ty9-audit (1): getByRole('button', { name: /^Versions/ }).first()
- users-us03-us04 (1): getByRole('region', { name: 'Skills matrix, scrollable' }) expected visible
- users-us1-bugs (1): locator('[data-edit-availability]') expected focused got inactive
- users-us2-status (1): Error: pending rows /  / expect(received).toBe(expected) // Object.is  expected 24 got 23
- users-us7-matrix (1): Error: User.View + User.Manage /  / expect(received).toEqual(expected)
- workflow-steps (1): getByRole('dialog').getByRole('button', { name: 'Skip Step' 
- wp1-dialogs-popovers (1): getByRole('dialog').filter({ has: locator('[data-reason-body expected "Workflow steps can't be changed while i got " TSK-4975 stays On Hold until someone r
- wp10-hold-colours (1): locator('tbody tr, li[data-task]').filter({ has: getByRole(' expected 1 got 0
- wp12b-keyboard (1): locator('[data-task] a.wt-title').nth(2) expected focused got inactive
- wp14-due-cell (1): locator('[data-task="TSK-5165"] td[data-col="due"] .dc').loc expected "Overdue 120d" got " +120d "
- wp19-compact (1): Error: forced colours /  / expect(received).toEqual(expected) // deep 
- wp2-list-states (1): locator('[data-empty=none]') expected /No projects yet\. Open a matter and cho
- wp21-fit-menu (1): locator('[data-column-menu]').locator('[data-item="widen"]')
- wp22-columns-widths (1): locator('[data-width-row="matterName"]').locator('[data-widt expected "160"
- wp24-toolbar-keys (1): getByRole('toolbar', { name: 'Quick views' }).locator('> but expected /^Unassigned/ got "More views"
- wp25-dash-due (1): Error: overdue24d: Swimlane card = queue row /  / expect(received).toE
- wp8-matter-cell (1): getByRole('button', { name: /Reset columns/ })
- wp9-density (1): Error: a Compact row is 36 px (#211): 44,44,44,44,44,44,44,44,44,44,44 expected <= 1 got 8
- wp9-fixed-layout (1): Error: nothing is cut off at 1366 for /tasks?q=tzpjnka31 /  / expect(r

Not done in stage 5 (ran out of time): the Dashboard Users tab rewrite beyond the idle card (users-tab 6, users-capacity 3: the toolbar holds Workload / Coverage / Skills, the "Who is counted" popover holds Show them / Hide them), the matter and client pages (px5, px6, wp7-matter-overview, clients-final, clients-keyboard), the dialogs and forms (as2, as3, as5, pv-*, rich-description, email-intake, sr5) and the Task Types / Workflows specs (ty2 to ty9, including ty9-keyboard 25 versus 30 rows: the list shows 30 name links, so the spec cannot simply say 25 without knowing what the other five are). The measure rows 17 (users-tab card height 77 against 64) and 18 (wp8 counter and the placement of the Filters toggle and the Name search on Clients) wait for the designer.

### 3.3 Duplicate-name 409s: cause and fix

Cause, proven with `--repeat-each=2` on a kept stack: a `test.beforeAll` that runs again in the same worker (a second repeat, or a new group after a failed test) has module-level fixed names (the file's TAG), so `POST /api/v1/roles` and `POST /api/v1/pods` answered 409 DUPLICATE_NAME for the role and pod it had created in its first run. It is not a retry under load and not a leftover from another file. Fix: `Seeder.roleOnce` and `Seeder.pod` return the existing role or pod on 409; users-us3-grid, us6-editors, us6-pods, us7-flows and users-us-copy-roles use them. After the fix a run with `--repeat-each=2` over those files and users-us1-bugs and users-us4-drawer gave no 409 (169 passed, 5 failed for other reasons).

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


## 7. Stage 6 (targeted runs only; the owner asked for no full run)

Branch `qa-e2e-fixes-3` from dev 2d7da13. Only the spec files named below were run (kept stack, own database); no full suite was run in stage 6, so the totals of section 1 are still those of the stage 5 full run (2,139 passed, 279 failed, 97 skipped).

Baseline of the stage 6 families (one targeted run before the edits, 496 tests): 405 passed, 81 failed, 10 skipped. Failing per file: users-tab 9, ty9-keyboard 5, clients-final 4, clients-keyboard 4, ty3-lists 4, as3-list 3, pv-saved-views 3, px5-matter 3, px6-matrix 3, ty2-shell 3, ty2-states 3, ty2-strips 3, ty3-narrow-columns 3, ty3-task-types 3, ty3-workflows-steps 3, users-capacity 3, pv-asset-report-builder 2, pv-export 2, ty4-task-type 2, ty7-step 2, and one each in as5-forms, pv-asset-disposition, pv-assets-pages, pv-final-gate, pv-task-types-on-hold, rich-description, sr5-filters, ty5-workflow, ty6-version-bar, ty8-designer-owners, ty8-designer-readonly, ty9-audit, users-us1-bugs, wp22-columns-widths.

Fixed and verified in targeted runs:
- pv-export: Export lives in the toolbar Options menu as two plain buttons; 2 of 2 pass (the file was 9 + 2 tests in the slice, all pass).
- pv-final-gate: filter toggle attribute is `data-filters-toggle`; the Views and Export check now opens Options; 3 of 3 pass.
- pv-saved-views: the Export check opens Options; 2 of 3 pass, 1 still fails (the saved view row's apply button is not clickable: `[data-view-apply]`).
- ty9-keyboard: the "25 versus 30 rows" is a page-size fact, not extra links: the Workflows, Task Types and Steps lists default to 50 rows per page and the seeded 30 to 35 rows all fit on one page, so the count was the number of rows, not 25 plus hidden links. The three URLs now ask for `size=25`, and row links are counted as `tbody tr a[data-row-key]`; 19 of 21 pass, 2 still fail (the Discard draft and Create new draft buttons of the version bar, a different cause).

Not touched in stage 6 (unverified, still failing as in section 3.2): the Dashboard Users tab rest (users-tab 9, users-capacity 3), px5, px6, wp7-matter-overview, clients-final, clients-keyboard, as2, as3, as5, rich-description, email-intake, sr5, ty2 to ty8, wp22 row 10, users-us1-bugs Esc focus return (a probe showed focus on the Edit availability button 800 ms after Esc, so the failure may be timing). Rows 17 and 18 of the measures doc wait for the designer.
