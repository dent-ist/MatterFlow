# Designer review 1: batches 1 to 3 of ui-update-2 (tip 1f95bb7) on the real demo stack

Reviewer: Agent U, 2026-11-05. Real stack from the branch (frontend dev server built from `ui-update-2`, demo data `--aged --seed 7`), desktop 1366x768 and 1920x1080, Director, Pod Lead, Technician, plus Project Manager and System Admin. 480 screenshots in this folder, measurements in `measurements-review.json`, axe in `axe-review.json` (28 pages x 2 sizes: 0 violations everywhere). Scripts: `../crawl/` (crawl.js to crawl5.js).

| Issue | Result | Evidence and note |
| --- | --- | --- |
| #1122 tokens | PASS | tokens.css: ctl-h 36, ctl-h-sm 32, tab-h 40, dialog widths 416/576/768, drawer 520/720, target-min 24 (override gone), fs-title gone |
| #1123 buttons 36 | PASS WITH NOTES | 1,167 buttons measured 36 px, dense 32, top-bar Create task now 36 (was 40). Text buttons 24 px (owner: keep). Calendar day cells 28 px (cells, not buttons). Disabled pager buttons are flat grey now |
| #1124 inputs | PASS | inputs 36 px, radius 4 on all forms; dates `mm/dd/yyyy` in both fields of Out of Office; Settings time fields 36 px |
| #1125 dropdown | PASS WITH NOTES | Swimlane and Trends native selects gone; triggers 36 px. Note: My Matters toolbar "Show: Everything" is 32 px next to 36 px buttons; Users pods cell "No pod" wraps to two lines (fix issue) |
| #1126 toolbar | PASS WITH NOTES | Search 36, Sorted line next to Columns, short text ("Sorted by Load", "Search by name" fit). Clients list has no Columns button (Clients epic) |
| #1127 segmented | PASS | Users and Calendar Month/Week both solid blue selected, 36 px |
| #1128 tabs | PASS | every strip 40 px (353 + 102 tabs measured), Title Case labels, description above strip on Labels, Users, Settings |
| #1129 chips | PASS WITH NOTES | chip kinds in place (Client record Open 42 / Overdue 8, Asset facts no longer pills). Private chip classes still exist (issue #1130) |
| #1131 links | PASS | one underlined regular-weight link in grids (Title no longer bold), Users name underlined, Edit/Delete on Profile are text buttons |
| #1133 icons | PASS | Dashboard Summary tab has its own icon; Task Types tab differs from Asset Types nav icon |
| #1134 cards | PASS | Profile, Search, record cards radius 12, headings 16/600 |
| #1135 page header | PASS WITH NOTES | tile on lists, Dashboard, My Matters, Profile, Create Task; no focus box on H1 (Asset record). Notes: Profile title "My profile" must read "My Profile" (decision); 403/404 pages not converted (system epic) |
| #1136 record header | PASS WITH NOTES | tile, bold title, Edit / Activity / primary order on Client, Matter, Task, Asset, Project. Note: Asset record keeps a second smaller type tile (decision: remove) |
| #1152 grid anatomy | PASS WITH NOTES | rows 44 (1,089 measured), header 40, pager everywhere, zero dash. Not yet: Matter Activities rows 34/51/68, Pod Work By Member and Settings Holidays rows 49, Users/Skills header 44. FAIL (regression): Dashboard Summary pager wraps to two rows in the narrow frame |
| #1153 row actions | PASS | quiet "..." on Labels, Task Types; no boxed 40 px buttons. Note: menu item "Deactivate" has no icon while others do (aligns differently) |
| #1156 form layout | PASS | Settings > Dashboard is a real form (labels above, 36 px, defaults under), Create Task bar `[Cancel] [Create and add another] [Create task]`, profile bar Cancel + Save Changes |
| #1137 dialog anatomy | PASS WITH NOTES | 56 px header, 36 px grey close, footer top line, widths 416 / 576 / 768 measured. Note: New Matter opens at 768 (large), should be 576 (Matters dialogs issue #1178) |
| #1138 task dialogs | PASS | Edit Task 768, Cancel left / Save Changes right |
| #1139 availability dialogs | PASS | Add Out of Office 576, same date format in both fields |
| #1140 admin dialogs | PASS WITH NOTES | New Priority 416 with the new footer, assign dialog 576. Note: the Assign Work dialog has only a right-aligned Close; task type icon picker and task-type form page still use a raw p-dialog |
| #1141 confirm wording | PASS WITH NOTES | "Deactivate Priority" with Cancel / Deactivate Priority; grep: only one bare "Deactivate", two "Close", one "Stay"/"Leave" left. Confirm body has a large blank gap under the title |
| #1142 drawers | PASS | measured 520 px on person, unassigned, swimlane, activity and admin user drawers; header, grey close; admin user drawer footer Cancel left / Save changes right |
| #1143 menus | PASS WITH NOTES | user menu, row menu, search popover use one surface and 36 px items; "Set Out of Office" without dots. Search popover group headings are uppercase ("MATTERS (12)") against D-23 |

Counts (23 issues): 12 PASS, 11 PASS WITH NOTES, 0 FAIL, plus one regression (Dashboard Summary pager, fix #1214). #1130 #1132 #1144 to #1151 #1154 #1155 are not in these batches and were not judged.

## Fix issues created from this review
#1214 pager and grid leftovers; #1215 dense dropdown and pods cell; #1216 titles, Asset tile and Matter dialog size; #1217 dialog leftovers; #1218 menu details. All under the shared epic #1107.

PASS issues (the PM may close): #1122 #1124 #1127 #1128 #1131 #1133 #1134 #1138 #1139 #1142 #1153 #1156. PASS WITH NOTES (close once the named fix issue is done): #1123 #1125 (#1215) #1126 #1129 #1135 (#1216) #1136 (#1216) #1152 (#1214) #1137 (#1216) #1140 (#1217) #1141 (#1217) #1143 (#1218).

Not checked: hover states by pointer, the Coverage drawer and the Matters header New menu (the capture script missed them), keyboard focus order beyond axe, 1920 only for dialogs that open the same at both sizes.

## Re-check after batch 3c (tip 478413a, 2026-11-05, screenshots in `../review-2/`)

Axe on 10 changed pages at both sizes: 0 violations (`../review-2/axe-review2.json`). Measurements: `../review-2/measurements-review2.json`.

| Issue | Result | Evidence |
| --- | --- | --- |
| #1214 pager and grids | PASS | Dashboard Summary pager on one row; Matter Activities rows 44 (50 measured), Pod Work By Member rows 44, Settings Holidays rows 44, headers 40 |
| #1215 dropdown and pods | PASS | My Matters "Show" dropdowns 36 px; Users "No pod" on one line; pods popover Cancel then Apply |
| #1216 titles and tiles | PASS | "My Profile"; Asset record one tile, type text under the title; New and Edit Matter dialogs 576 px |
| #1217 dialog leftovers | PASS | Assign Work footer `[Cancel] [Assign 0 selected] [Assign the next 3]` (accepted); icon picker uses the shared dialog (768 px); confirm band gone, Cancel / Deactivate Priority |
| #1218 menus | PASS | disabled "Move up" one line, menu text aligned; search headings "Matters (12)", See all as links |
| #1123 #1125 #1126 #1129 #1135 #1136 #1137 #1140 #1141 #1143 #1152 | PASS | the notes of review 1 are fixed (numbers above); #1126 Clients Columns belongs to #1179 |
| Icon-only switch extra | FAIL | Breakdowns Bars / Pie / Table is cut at 1366 in Priority, Status, Age (fix #1219) |
| Other 32 px toolbar dropdowns | NOTE | Activities Kind, Productions filter, Trends period 32 px; Assign confirmation buttons; Holidays names break mid-word (fix #1220) |

## Review 3: batch 4 (tip fd8be47, 2026-11-05, screenshots in `../review-3/`)

Real stack, 1366x768 and 1920x1080, 460 screenshots, `../review-3/measurements-review3.json`; axe on 26 pages at both sizes: 0 violations; text scans `scan-review3.json` (month-name and ISO dates, raw accounts, browser tab titles) and `crawl/caps.js` (Title Case).

| Issue | Result | Evidence |
| --- | --- | --- |
| #1144 toasts | PASS WITH NOTES | "Priority added / Review sample", "Availability saved", "Couldn't copy the link." follow the pattern. Note: a failed list load still raises "Couldn't complete the request. x3" next to the inline block (fix #1223) |
| #1145 states | PASS WITH NOTES | Matters filtered-empty and error blocks with icon, Notifications centred, missing task on the state card, skeleton. Notes: admin Note Tags empty is still a plain line, 403 not converted (System epic), icon 24 px token (fix #1223) |
| #1146 dates part 1 | PASS | Matter Summary `11/04 10:54 PM`, Last Updated, Task details `10/11 09:57 PM`, Task Due `10/17 +19d` |
| #1147 dates part 2 | FAIL | Due cells still print month names (`Nov 4, 5:00 PM`, `Nov 25`) on Task Queue, My Work, Pod Work, Matter and Project Tasks, Swimlane; Asset custom date `Nov 6, 2026`; saved reports `d MMM y` (fix #1221). Decision: the Due date is part of #1147, the `+9d` suffix stays with #1168 |
| #1148 numbers and names | PASS WITH NOTES | counts, sizes, durations fine; raw `KE\kekim` in Task Information and My Matters activity (fix #1221) |
| #1149 capitalisation | PASS WITH NOTES | buttons, menus, dialog titles, tabs, chips Title Case; leftovers "Link asset", "Add holiday", "Edit calendar", "Import / paste list", dropdown options (decision spec 15.1, fix #1222) |
| #1150 nav, routes, tabs | PASS | tab titles "Users: Roles - MatterFlow", "Labels: Status Labels - MatterFlow", "Search Results: All"; nav "Asset Types"; tabs "Note Tags", "On-Hold Reasons" |
| #1151 vocabulary | PASS | Last Updated, Primary PM, AI Allowed, Matter Number, CM Number, Off Hours |
| #1219 Breakdowns switch | PASS | icon-only, three whole segments in Priority, Status, Age at 1366 |
| #1220 dropdowns, Assign, Holidays | PASS | Activities Kind, Productions, Trends dropdowns 36 px; Holiday names wrap by word; Assign confirmation step not reachable by the script (not checked) |

Regressions seen: Task Queue, My Work and Pod Work show the top-bar "New Task" and the page "New Task" side by side (they were "Create task" and "New Task" before); the Tasks epic issue #1167 already says to hide the top-bar button there. No truncation introduced by the longer Title Case labels; toolbars at 1366 do not overflow; "Clear Filters" blocks fit.

## Review 4: batch 5a (tip f7e21b4, 2026-11-06, screenshots in `../review-4/`)

Real stack, 1366x768 and 1920x1080, `../review-4/measurements-review4.json`, axe on 18 pages at both sizes (`axe-review4-a.json`, `-b.json`): 0 violations; `crawl/caps.js` and `crawl/probe-dates.js` text probes.

| Issue | Result | Evidence |
| --- | --- | --- |
| #1221 dates and names | PASS WITH NOTES | Due cells `11/25`, `11/04 05:00 PM` + words on Task Queue, Matter Tasks (and 1920), Swimlane `11/04 +1d`, "Done 11/04"; long form "November 4, 2026, 10:54 PM (UTC)"; no `KE\` in Task Information, activity, My Matters (Profile and Audit keep it); Assets custom date, saved reports clean. Note: Trends still shows "Oct 7, Oct 12" (fix #1226) |
| #1222 Title Case | PASS | `caps.js`: no flagged button, tab or dropdown option; "My Pods", "Any Date", "Link Asset" etc. |
| #1223 errors and empty | PASS | Matters load failure: one block "Couldn't load matters." + Retry, no toast; Note Tags empty: icon, "No tags yet.", "+ New Tag"; `--mf-icon-xl` used only in `state-block.ts` |
| #1144 toasts | PASS | "Priority added / Review sample" (review 3), no duplicate error toast now |
| #1145 states | PASS WITH NOTES | blocks on lists, records, admin lists; the 403 page is still the old card (System pages epic #1193) |
| #1147 dates part 2 | PASS WITH NOTES | Due, custom fields, reports fixed; Trends axis and form status cell (fix #1226) |
| #1148 numbers and names | PASS | no raw account outside Profile and Audit |
| #1149 capitalisation | PASS WITH NOTES | leftovers column menu, step badge, "by" rule (fix #1226) |

New fix issue #1226 (AD leftovers; decision: "by" and other short prepositions stay lowercase in Title Case). #1224: comment posted (source of the colour and the shared solid chip).

## Review 5: batch 5b (tip a8d7b0d, 2026-11-06, screenshots in `../review-5/`)

Real stack, 1366x768 and 1920x1080 (54 screenshots, `measurements-review5.json`); axe on 50 pages/tabs at both sizes: 0 violations (`axe-review5-a/b/c.json`); clipped-element probe `crawl/clip.js`.

| Issue | Result | Evidence |
| --- | --- | --- |
| #1226 | PASS | Trends axis `10/08`, `10/12`; calendar "Week of 11/01 to 11/07"; column menu "Sort Ascending", "Hide Column"; "Produced by Us"; "Skippable - Comment"; guard `MINOR` has "by" |
| #1225 | PASS WITH NOTES | red Sun/Sat headers and numbers, `--mf-cal-off-bg` tint distinct from the header; red on `#dde2ea` 5.05:1; legend line "12 Red numbers = weekend or holiday". Notes: the legend row wraps ("Days" and "Holidays" labels orphaned), Week table header is 45 px, not 40 |
| #1224 | PASS WITH NOTES | picker cards show solid colour chips (blue, teal, green, orange, purple, rose) as the grids; selected strip still plain black (#1228) |
| #1154 | PASS WITH NOTES | Status, Priority, Assignee, Project whole; Type column tile only; Matter and Project Tasks Progress off by default; probe: all clipped text elements are ellipsis with a tooltip except an empty sizing span. Notes: Pod Work "Assign" cut at 1366, Progress text cut (#1227) |
| #1155 | PASS | off-scale lint present in `npm run lint`; Summary, Breakdowns, Swimlane, Users, Calendar, Notes editor, My Matters, Task Types form designer show no regression |

Decisions: (a) grid headers 12/700 uppercase for data grids, calendar weekday row is the exception, no existing grid changes; (b) print line: full month, time, no zone; (c) stripes remain in Breakdowns and the gauge, covered by #1158; (d) `--mf-radius-md` retired (#1229); (e) Progress = bar + "2 of 5", step in tooltip (#1227); (f) selected-type strip coloured chip (#1228); (g) Pod Work "Assign to Me" becomes an icon button in a 160 px Assignee cell (#1227).

## Review 6: batch 6a (tip 5bf3cef, 2026-11-06, screenshots in `../review-6/`)

Real stack, both sizes (54 screenshots, `measurements-review6.json`); axe on 12 pages at both sizes: 0 violations (`axe-review6.json`); computed-radius scan of 17 pages (`crawl/rad.js`): no 6 px element outside the navigation.

| Issue | Result | Evidence |
| --- | --- | --- |
| #1229 radius | PASS | computed radii are 4, 8, 12, 50%, 999; no 6 px except the nav pill; Dashboard, Matters, Task page, dialogs, drawers, Notes unchanged |
| #1227 Progress, Assign, print | PASS WITH NOTES | Progress cell "0 of 3"; Pod Work Assignee 160 px with the person-plus icon; print line "Printed November 6, 2026, 1:10 AM". Notes: Matters > Tasks print view has no print line; time lacks the leading zero ("1:10 AM", D-60 says "01:10 AM"); Pod Work default columns still total 1,334 px at 1366 so Status is cut (decision D-43a, fix #1230); Matter Name is off by default but Project is still on |
| #1228 strip chip | PASS | the selected-type strip shows the blue chip like the picker card |
| #1225 tidy | PASS | legend wraps in two clean rows ("Days 12 Red numbers = weekend or holiday", "Holidays"); Week header 40 px, 13/600, red Sat and Sun |
| #1224 | PASS | picker and strip colours agree with the grids |
| #1154 | PASS WITH NOTES | everything except the Pod Work / Task Queue column totals at 1366 (#1230) |

Decision (Pod Work and Task grids): D-43a in the guideline; fix issue #1230 under #1110.

## Review 7: batch 6b (tip 7d4a540, 2026-11-06, screenshots in `../review-7/`)

Real stack, both sizes (87 screenshots, `measurements-review7.json`), axe on 15 pages at both sizes: 0 violations (`axe-review7.json`); `crawl/cols.js`, `crawl/resize.js`, `scan-private-classes.mjs`.

| Issue | Result | Evidence |
| --- | --- | --- |
| #1230 | PASS WITH NOTES | default column sum at 1366: Task Queue, Pod Work and My Work 1,096 px (frame 1,098): no sideways scroll, Status whole. Note: Type is 168 px so Title is only 126 px on Pod Work (fix #1237). Summary grid: 988 px in a 718 px frame (fix #1236). CM Number stays default; dropping Age is fine |
| #1231 | PASS WITH NOTES | Title drag both ways (704 to 584 to 784 px at 1920) and the width survives a reload; "Reset Width" not reached by the script |
| #1232 | PASS | Type chip plus name in Task Queue, My Work, Pod Work, Matter Tasks (ellipsis and tooltip), Dashboard Summary; Search results have no task type column |
| #1130 | PASS WITH NOTES | scan: 16 chip pairs in 15 files, 8 private classes remain; decisions per class in #1238 |
| #1132 | PASS | scan: 0 private link classes |
| #1227 | PASS | Progress "0 of 3", Pod Work Assign icon, Status visible at 1366; print line on the Task Queue |
| #1154 | PASS | nothing clipped at 1366 in the default views |

New: #1236 (Summary defaults), #1237 (Type 128 px, Title at least 160), #1238 (last chip classes). #1235: comment posted (colour fallback stays, more sources, order, sensitive personas).

## Review 8: batch 7a (tip f01fd37, 2026-11-06, screenshots in `../review-8/`)

Real stack, both sizes; axe on 13 pages and tabs at both sizes: 0 violations (`axe-review8.json`); scripts `crawl/sum.js`, `sum2.js`, `sum3.js`, `rs3.js`, `g.js`.

| Issue | Result | Evidence |
| --- | --- | --- |
| #1237 | PASS | Type 128, Title at 1366: Pod Work 166, Task Queue 190, My Work 326; default sum 1,096; no sideways scroll |
| #1236 | PASS WITH NOTES | Summary frame 718, columns Type 128, Title 206, Priority 112, Assignee 136, Due 136 = no scroll; "Unassigned for" 152 replaces Due while the card is on; Columns menu offers Ref and Status. Notes: type name cut ("Incomin...", tooltip), Due text touches the edge (#1239) |
| #1233 | PASS WITH NOTES | button at x=1306/1860, y=174, 36 px in both states and both sizes; aria-expanded true/false; "Hide Panel" tooltip; collapsed grid 1,070 / 1,624 px; state remembered after reload; compact battery and gauge on the row; gauge click selects Unassigned and shows "Unassigned for"; Technician has no button, Pod Lead has it. Notes: at 1366 collapsed the gauge level word is dropped and only "5" and "4 over" stay (acceptable) |
| #1234 | PASS | three tiles Available / Out of Office / Off Hours, number at the bottom; Thanksgiving: Available 2, Off Hours 10; Month and Week |
| #1230 | PASS | Type 128 and Title >= 160 on every task grid at 1366 |
| #1231 | PASS WITH NOTES | drag both ways persists; Title has no "Reset Width" in the Columns panel (the other columns do, disabled until changed); the header-menu reset could not be reached by script: confirm by hand |

New: #1239 (Due 152). Comments on #1238 and #1235 (Type 128).

## Review 9: batch 7b (tip 5798b78, 2026-11-06, `../review-9/`: 15 compressed JPEG at 1366 wide, `measurements-review9.json`, `axe-review9.json`)

Real stack, API rebuilt and restarted from the branch tip (demo database untouched), both sizes; axe on 12 pages at both sizes: 0 violations. The demo data has no asset with linked tasks, so the Asset > Linked Tasks list was reviewed from the committed screenshot (`asset-linked-tasks-mock-1366.jpg`) and the contract (`AssetTaskLink` carries taskTypeId, taskTypeName, taskTypeIconKey as required and taskTypeColourKey).

| Issue | Result | Evidence |
| --- | --- | --- |
| #1239 | PASS WITH NOTES | Due 152: Summary Due text fits (all rows), Summary frame 718 and no scroll; Pod Work Title 150 (fix #1240: Ref 100) |
| #1238 | PASS | Note Tags, calendar legend holiday chip, Settings > Holidays calendar chip, count overlay 18 px (bell, side rail) and 22 px, Out of Office presets 26 px filter chips, Search filter chips, Task Types list with the shared Type cell; no mismatched colour |
| #1235 | PASS WITH NOTES | type colour equals the Task Queue for every type shown (14 in the queue, 15 in Task Types, 11 on Summary, 7 in the unassigned panel: 0 mismatches); contract fields present; the linked-tasks columns fit 1366 in the mock; person drawer and Assign Work lists not separately sampled; sensitive personas not tested (no linked data) |
| #1236 | PASS | Summary default columns fit 718 px, Due whole |
| #1130 | PASS | private chip classes replaced; scan allows only the skeleton |

Decisions: Pod Work Title guard stays 160, Ref 100 px (#1240). Link role removed from the table is acceptable; it becomes a tooltip (#1240). The Set Out of Office and Add Out of Office dialogs keep a native Type select (shared input style, chevron) and the native date field: both are allowed by D-14 and D-35, so no fix issue. When Type is hidden the Task Queue title cell draws no small type icon: acceptable (the Columns menu brings it back). My Matters Overview Due column is still cut at 1366 (belongs to #1164).

## review-10 Tasks group (tip 06b7a76, 2026-11-06)

Evidence (13 JPEG at 1366, measurements, axe) is on the `design-evidence` branch: `evidence/2026-11-06-review-10-tasks/`. Real stack, both sizes, axe on 12 pages at both sizes: 0 violations. Scripts in `docs/ux/ui-update/crawl/` (`rs4.js`, `r10*.js`).

| Issue | Result | Evidence |
| --- | --- | --- |
| #1240 | PASS WITH NOTES | Title at 1366: Pod Work 162, Task Queue 186, My Work 322 (Ref 100); one "New Task" button on the three pages; link role tooltip not sampled (no linked data). Note: four-digit On Hold ref "|| TSK-1234" is about 92 px: fix #1244 (cell padding 8 px) |
| #1167 | PASS | top bar button hidden on Task Queue, My Work, Pod Work and shown on Matters; Pod Work chips in the toolbar row (26 px), My Work chips under the tabs; Search box 201 px on Pod Work, 252 px elsewhere: Matters, Clients, Projects, Assets, Users toolbars unchanged |
| #1168 | PASS | Normal and Low are 14 px, weight 400, normal text colour |
| #1169 | PASS WITH NOTES | menu entries 36 px (Other Filters list, Columns); decision: drop the bulk bar part (the work lists have no selection or bulk action; no backend issue now); steppers in Column Widths stay 24 px (text buttons, owner rule); date presets and ASAP are 36 px menu entries |
| #1170 | PASS WITH NOTES | work lists show "-" (accessible "not available") while loading and on error; Matters and the other lists show no chip while loading; empty sentences "No tasks match these filters." are correct for a filtered list. One rule for all lists: fix #1244 |
| #1231 | FAIL | Title width is stored, but there is no way back: header menu has no Reset Width (Fit disabled), double-click does nothing, the Columns panel has no Title row: fix #1243 |
| #1235 | PASS WITH NOTES | colours equal the Task Queue for the person drawer and the Assign Work list (0 mismatches over the types shown); backend integration tests for the Asset linked tasks were NOT run (need Docker/SQL test containers): QA to run `dotnet test` for `TaskAssetLinksApiTests` and `SensitiveAssetsAndSearchTests` |

New: #1243, #1244.

## review-11 Matters, Clients and record grid (tip d6fadfe+, 2026-11-06)

Evidence on `design-evidence` (`evidence/2026-11-06-review-11-record-grid/`: 15 JPEG, measurements, axe). Real stack, both sizes, axe on 11 pages at both sizes: 0 violations. Scripts `crawl/rg.js`, `rg2.js`, `rg3.js`.

**Shared record grid (`shared/ui/record-grid.ts`), Matters and Clients at 1366 and 1920.**
Pass: resize (stored `mf.col-widths.v1.<grid>.<user>`, survives reload), reorder (survives reload), Columns show/hide, "Reset to Default", **"Reset Width" works** (stored key removed, Clients name 548 back to the spring 488 px; the primary column is the spring), sticky first column, sort by heading (`aria-sort`), Enter on the heading, default columns fit the 1,096 px frame (Matters: Secondary PM off by default: acceptable, it is in Columns). Fails: the actions column is 48 px but **72 px after a reload with a resized grid** (confirmed at both sizes); Clients headings jump between loading, empty, error and rows (Matters is stable); every resize handle is a Tab stop. The component API is good for Clients, Matters and the Assets list; for Projects (group rows), row click and inactive rows it needs `groupBy`, `rowClass` and `(rowClick)`: fix #1245 (under #1107) before those pages adopt it.

| Issue | Result | Evidence |
| --- | --- | --- |
| #1241 steps 1, 2, 4 | PASS WITH NOTES | see above (#1245) |
| #1174 Matters list | PASS | columns fit 1366, "..." column 48, New Matter dialog 576 px |
| #1175 Matter record | PASS | tile, Edit, New primary 36 px, asset tiles with 24 px counts, banners one bar |
| #1176 Tasks, Projects, Assets tabs | PASS WITH NOTES | Tasks tab whole at 1366 (Project in Columns); Projects and Assets tabs not on the record grid yet (follow #1245) |
| #1177 Notes, Productions, Activities | PASS WITH NOTES | Activities still ends with "Show More" instead of the pager (fix #1246) |
| #1178 Matter dialogs | PASS | New Matter 576 px, Cancel left, primary right |
| #1179 Clients list | PASS | Columns menu, no row action: decision, Clients get none (Edit and Activity are in the record header) |
| #1180 Client record | PASS WITH NOTES | overdue chips, 16/600 heading, View all link; mini-table headings "Matter, Name, Open" differ from the Matters list (fix #1246) |
| #1181 Client forms | PASS WITH NOTES | unsaved-changes wording (fix #1246) |
| #1174-#1181 shared side effects | PASS | Action Menu text trigger 36 px and the shared amber banner (one compact bar) look right on Project, Asset and Task records; no regression seen |

New: #1245, #1246.

## review-12 Dashboard group (tip 7430210, 2026-11-06)

Evidence on `design-evidence` (`evidence/2026-11-06-review-12-dashboard/`: 9 JPEG, measurements, axe). Real stack, both sizes, Director, Pod Lead and Technician; axe on 8 pages and tabs at both sizes: 0 violations. Computed-style scan of all six tabs: 0 elements with a repeating or hatch background, 0 SVG patterns (also in the Breakdowns Pie views); the only 6 px radii are the 10 navigation items; a task type chip is followed by its name in every row measured (Summary 30 of 30 at both sizes, Breakdowns 8 of 8, Technician queue 4 of 4).

| Issue | Result | Evidence |
| --- | --- | --- |
| #1157 Summary | PASS | legend tiles are figure tiles, semantic tokens, no stripes |
| #1158 stripes | PASS | solid red overdue segments with "N overdue" links in Priority, Status, Age and Task Type; Pie views without patterns; guard `no-stripes.spec.ts` covers `features/dashboard` (the shared pie keeps report patterns only for Administration > Reports) |
| #1159 Breakdowns and Trends | PASS | card titles 16/600, switches whole at 1366, "Measure:" dropdowns, axis `10/08` |
| #1160 Swimlane | PASS WITH NOTES | "Group:" and "Sort:" prefixes, icon options button, shared chips; hidden skip links report as clipped (#1247) |
| #1161 Users | PASS | popovers on the menu standard, shared Unassigned button, search box 200 px |
| #1162 Calendar, Technician queue | PASS WITH NOTES | legend chips, slim risk banner, shared states; day-panel names that open a dialog are underlined links (#1247) |
| #1242 day panel | PASS | three tiles, role header bands, jump chips, Collapse All, 3 px green row edge |
| #1239 | PASS | Due whole |
| user-menu test fix 7202e0b, no-stripes guard | PASS | spec no longer depends on today's date; guard in place |

Decisions: (1) Trends "Measure:" stays a shared dropdown: five measures are more than the 2 to 4 a segmented switch allows (D-16). (2) "Back 11/23" stays (short, numeric date per D-60); the full words "Out of office until November 23, 2026" are the tooltip and accessible name. (3) No person drawer on the Calendar is accepted: a name opens Add Out of Office only with User.ManageAvailability and is then a text button (#1247). (4) The 3 px green row edge in the day panel is recorded as the owner-approved exception D-48a; keep it limited to that list (D-04 forbids it elsewhere). (5) Confirmed: the type name shows beside the chip in every grid and list at both sizes; the owner's rule overrides the earlier "chip alone below 900 px" note, remove that sentence from D-43a if still present.

## review-13 record grid and Matters follow-ups (2026-11-06, tip 54f84dc, 1366 and 1920)

Evidence: `design-evidence` branch, `evidence/2026-11-06-review-13-record-grid/` (10 JPEG, `measurements.json`, `axe.json`). Axe (wcag2a/aa/21aa/22aa + best practice): 0 violations on 12 pages at both sizes (Dashboard, Matters, Matter, Clients, Client, Projects, Assets, Task Queue, My Work, Pod Work, Users, Task Types).

| Issue | Result | Notes |
|---|---|---|
| #1245 record grid | PASS | Actions column 48 px after reload at both sizes (was 72). Clients headings identical (154/477/96/125/105/140) in loading, empty, error and rows; Matters the same. First heading sticky at left 0; Tab order is headings, filters, first row link (handles are not Tab stops). `groupBy`, `rowClass`, `rowClick` judged: fits Projects, Assets and the Administration lists, rules recorded as D-44a. |
| #1243 Title width reset | FAIL (partial) | Task Queue passes at both sizes: header menu "Reset Width", double-click on the divider, Columns panel Title row, Reset Columns all return the spring (186 and 740 px). Dashboard > Summary: header menu and double-click work, but the Columns panel has no Title row and "Reset to Default" keeps the narrow width. Fix issue #1248. |
| #1244 Ref padding, count chip | PASS | Ref cell 100 px, 8 px left, 0 right; chip shows "-" while loading and after an HTTP 500 on Clients, Matters, Projects, Assets, Task Queue, My Work. Rule D-44c. |
| #1246 Clients and Matters leftovers | PASS with two leftovers | Client Overview and Matters tab headings correct; unsaved-changes question reads "Keep Editing / Discard Changes"; Clients placeholder "Number". Matter > Activities stays "Show More". Left over: Client > Matters tab filter placeholders "Matter" and "Name", and a white sticky first cell in a grey filter row; "Save and leave" extra buttons. Fix issue #1248. |

Decisions: (a) heading keyboard resize accepted as keys of one focused widget, not shortcuts, outside `shortcut-registry.ts` (D-44b); (b) Ref cell 8/0 padding accepted (D-44c); (c) Activities keeps "Show More", no total needed (D-44d); (d) "Save and Leave" and placeholders "Number" and "Name" (D-44d, D-44e), issue #1248.

## review-14 Projects, Assets and fixes (2026-11-06, tip 760cae2, 1366 and 1920)

Evidence: `design-evidence` branch, `evidence/2026-11-06-review-14-projects-assets/` (13 JPEG, `measurements.json`, `axe.json`). The demo API was rebuilt from 760cae2 so Asset linked tasks carry the task type name. Axe: 0 violations on 10 pages at both sizes (Projects, Project, Assets, Asset, Asset Reports, Dashboard Swimlane, Calendar, Summary, Client, Task Types) and on the Calendar with a day panel open.

| Issue | Result | Notes |
|---|---|---|
| #1247 Calendar names, Swimlane skips | PASS | Day panel names are `mf-btn--text` buttons (blue, no underline); the four Swimlane lane skip links are `mf-sr-only` (1 x 1 px, visible only on focus). Names are 19 px high (inline in a dense list; axe target-size clean). |
| #1248 review 13 leftovers | PASS | Summary: Columns panel has "Reset Width" (Title 110 -> 190, 664 -> 744) and "Reset to Default" returns the Title to the spring; Client > Matters placeholders "Number" and "Name"; "Save and Leave" on Task Type, Asset Type, Workflow and Step pages. Ruling: one "Reset Width" for all widths is right (D-44h). |
| #1182 Projects on record grid | PASS with leftovers | 48 px actions column, widths stored per person and kept after reload, Reset Width, row menu, tab order name link, matter link, counts, menu. Left over (#1250): filter row has 6 cells so the grey band stops before the Actions column; headings jump while loading (Project Name 277 and Client 192, loaded 301 and 168). |
| #1183 Project record | PASS with one point | Header, Tasks tab and crumb are in place. Details tab is a bare label-left list: card anatomy D-44f, built in #1250. |
| #1184 | PASS | No change needed. |
| #1185 Assets on record grid | FAIL (small) | Resize stored per person, Columns, Reset Width and Disposition chip (162 px holds the 154 px "Pending Disposition" chip) all work. Default columns total 1105 px in a 1096 px frame at 1366 (9 px sideways scroll, "..." cut); headings jump while loading (Name 220, External Reference 150 vs 200 and 140); "External Reference" heading wraps. Fix in #1249. |
| #1186 Asset Linked Tasks | PASS | Record grid, 44 px rows, Ref/Type/Title/Priority/Assignee/Due/Status inside 1096 px at 1366 (no scroll); with the rebuilt API the task type NAME is in the Type cell (chip plus "Collection Receipt", "Archive and Disposition", "Search and Culling"). |
| #1187 Asset forms, dialog | PASS | Dialog title "Change Disposition", `[Cancel] [Change Disposition]` (bulk: "Change N Assets"); width is 576 px (four options with descriptions), accepted (D-44g). |
| #1188 Asset reports | NOT DONE, rulings below | No native select (verified). Saved list still has two text buttons per row. Build in #1249. |

Rulings: (1) Disposition 162 px accepted, paid for by Type 128 px (D-43a); (2) Assets row menu stays Change Disposition only, no Edit Asset (D-44g); (3) dialog primary stays "Change Disposition", it does not follow the option (D-44g); (4) saved reports stay a side card, 44 px rows with name button and one "..." menu (Rename, Delete), not a table (D-44g, #1249); (5) Details tabs use the Matter Summary card (D-44f): Project in #1250, Asset in #1249.

## review-15 My Matters, Task page and Create Task (2026-11-06, tip 44f1417, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-15-my-matters-task-page/` (JPEG, `measurements.json`, `axe.json`; the same folder holds the review-16 images). Axe: 0 violations on 10 pages at both sizes (Assets, Matters, Projects, Project, Asset, Asset Reports, My Matters as the Project Manager, Task, Create Task, Summary).

| Issue | Result | Notes |
|---|---|---|
| #1163 My Matters header | PASS | Options is the 36 px secondary button, weight 600 like the others. |
| #1164 Overview table | PASS with a point | 44 px rows, Due 152, Status 176, Priority 112 whole at both sizes; at 1366 with the side panel open the Ref is cut ("TSK-10...") and the Title is cramped (Task 304 px, Assignee hidden). Collapsed: Task 446 px, Assignee 150. Fix in #1252. |
| #1165 side panels | PASS | Standard cards, 36 px header buttons. |
| #1166 last native select | PASS (code only) | Unit is `mf-dropdown`, shown only with more than one unit (not reachable in demo data). Native selects remain elsewhere: #1251. |
| #1171 Task page header and facts strip | PASS | 36 px buttons and menu triggers; status menu "Put on Hold", "Complete", "Cancel Task". |
| #1172 Request Details, comments | PASS | Text buttons; Comment Edit and Delete are 24 px text buttons, Delete in the danger colour. |
| #1173 Create Task | PASS with a point | Crumb "Task Queue", type cards, fields 480 px including Title. The task type is shown twice (strip and "Change Type" card): #1252. |

Real defects found outside the issues: Options > Focus on task types shows no type names (container query on the type cell, #1252); native selects remain in the New Production, Out of Office, bulk update, holiday and absence dialogs (#1251).

Rulings: (1) side panel starts collapsed under 1500 px, Type tile only and Assignee hidden only while it is open (D-44i); (2) Due 152 confirmed; (3) Status 176 with step bar, 140 chip only (D-44i); (4) crumb "Task Queue" (D-44j, #1252); (5) 480 px fields including Title confirmed; (6) Options weight 600 confirmed; (7) New menu descriptions allowed in that menu only (D-36a); (8) card sub-headings 14/700 (D-11a); (9) "Request Details (General / Ad Hoc Request, Form 1)" confirmed.

## review-16 Projects and Assets leftovers (2026-11-06, tip ca11f21, 1366 and 1920)

| Issue | Result | Notes |
|---|---|---|
| #1250 Projects | PASS | Filter row covers the Actions column; headings 301/210/168/125/105/140/48 identical in loading, empty, error and rows; Project Details is the shared `mf-details-card`. |
| #1249 Assets | PASS | Columns 24/128/201/123/105/137/168/162/48 = 1096 px, no sideways scroll at 1366; headings identical in all four states; header checkbox at x249 over the row checkboxes; Asset Details with "Relativity Workspace Fields (8)". |
| #1188 saved reports | PASS | One 44 px row: name button (38 px) and one "..." (36 px) with Rename and Delete; tested by saving and deleting a report. |
| #1182, #1183 | PASS | Covered by #1250. |
| Matters list regression check | PASS | Headings 158/223/152/125/125/105/161/48, no overflow. |

Rulings: External Reference 168 and CM Number 123 accepted; the select column 24 px accepted; the saved report date goes in the tooltip; "<Type Name> Fields" is the card name; Matter Summary moves to the shared card in a follow-up (#1253). Recorded as D-44k.

## review-17 System pages and shell (2026-11-06, tip 7c5c2b7, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-17-system-pages-shell/` (the same images and measurements also sit in `evidence/2026-11-06-review-18-search-notifications-profile/`). Axe: 0 violations on 10 pages at both sizes (404, 403, Error, matter and task not found, Users, sensitive Matter, inactive Asset, Swimlane, Create Task).

| Issue | Result | Notes |
|---|---|---|
| #1193 state pages | PASS with a point | One 480 px card, 48 px tile, H1 22/700 on one line with no ring and focus on it, one sentence and one 36 px button on 404, 403, Error and Access Pending. Record not-found pages (`/matters/99999999`, `/tasks/99999999`) do not move focus to the H1. |
| #1194 search menu, user menu | PASS | Menu surface, footer "See All Results" and "285 results for "Demo"", user menu items 14/400. Group links read "See all 12" (casing: #1254). |
| #1195 nav count chip | PASS | Users shows the shared count chip. |
| #1196 banners | PASS | Sensitive, inactive, offline (warning with Retry), "Back online." (green, leaves) and Dev auth share `.pg-banner`: 36 px, 4 px radius, icon. Create Task notes and Task page warnings lack the icon (#1254). |
| swimlane unit failure | spec is stale | In the browser the status menu opens with "m" and reads "Put on Hold", "Complete... (needs step inputs)", "Cancel Task" (36 px items); the spec still expects lower case. Fix in #1254. |

Rulings: no search box on 404 and no Copy link on 403 accepted; the Error page text button is named like the 404 button, not "Go to Home"; Access Pending without the list accepted; red and green banner variants accepted; no impersonation banner needed; banners all carry an icon; long record names never appear in the H1, and two lines are allowed (D-53a, D-53b). "See All N" casing fixed once in #1254.

## review-18 Search, Notifications and Profile (2026-11-06, tip 0f603c1, 1366 and 1920)

Axe: 0 violations on Search (results and none), Notifications (two users) and Profile at both sizes.

| Issue | Result | Notes |
|---|---|---|
| #1189 Search results | PASS | Section count chips (Matters 12, Clients 5, Tasks 204, Projects 4, Assets 60), 44 px rows, "No results for "zzzqq"." state block; "See all N" is an `<a>` styled as a text button (24 px). Casing: #1254. |
| #1190 Notifications | PASS | 56 px rows, unread bold with dot, relative times for yesterday and `MM/DD` after, empty state "No notifications yet." and "You're all caught up." in the bell. |
| #1191 My Profile | PASS | Seven pressed filter chips for work days (26 px), absence type chips shared; Conference is neutral. |
| #1192 Out of Office dialog | PASS with leftovers | 576 px, "Save Changes" on Edit, `mm/dd/yyyy` dates with `lang="en-US"`, overlap answer shown as a tinted danger banner with icon (own style, radius 8, 50 px): use `.pg-banner` (#1255). The Type field is still a native select (#1251). |

Rulings: Conference stays neutral (no seventh tone, D-54); "See All N" is a link-as-text-button (D-13a) and the casing change is done together for the menu and the page in #1254; the overlap and advice banners move to `.pg-banner` (#1255); relative times today and yesterday, numeric from two days ago confirmed (D-54).

## review-19 Administration Users and Task Types lists (2026-11-06, tip e23e129, 1366 and 1920, as KE\kekim)

Evidence: `design-evidence`, `evidence/2026-11-06-review-19-admin-users-task-types/` (15 JPEG, `measurements.json`, `axe.json`). Axe: 0 violations on Users, Task Types, Task Type, Workflow and Step at both sizes; the form designer has one `heading-order` (fix in #1256).

| Issue | Result | Notes |
|---|---|---|
| #1197 Users list | PASS | Record grid, 44 px rows, columns 303/126/210/140/113/155/48 (1096 px), no "Other Filters" button (extra columns in Columns), Grant Access in the Roles cell, 520 px drawer. Private `.us-open` name class: #1257. |
| #1198 | PASS | Already done (drawer 520 px, footer Cancel and Save Changes). |
| #1199 Roles | PASS with a point | "Built-in, Locked" chip, 36 px permission rows; master-detail accepted. "System Admin" wraps at 1366: #1257. |
| #1200 Pods | PASS | Record grid with Name, Members, Status. |
| #1201 Task Types list | FAIL (small) | Table 1139 px in a 1096 px frame at 1366 (43 px sideways scroll). Fix in #1256. |
| #1202 Task Type record | NOT DONE | Header shows "Edit" and "Edit Form" while Overview is already a form; icon is a bare glyph; designer has its own H1, versions bar and 32 px inner tabs. Specs in #1256. |
| #1203 Workflows | PASS with a point | Record grid. Row key is the name: use the id (#1256). |
| #1204 Steps | PASS with a point | Record grid. Row key is the title, unique only among active steps: use the id (#1256). |

Rulings: D-44l, D-44m, D-44n. Pods popover stays Apply and Cancel; Grant Access stays in the Roles cell; role checklist stays; Roles master-detail accepted; Pods Lead and Open Tasks not built; user name = `mf-btn--name`; "Built-in, Locked" confirmed.

## review-20 Administration Lookups, Settings, Reports and Audit Logs (2026-11-06, tip 6f2b312, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-20-admin-lookups-reports-audit/` (JPEG, `measurements.json`, `axe.json`). The sticky header and filter row scroll bug is #1259 and is not reported again.

| Issue | Result | Notes |
|---|---|---|
| #1205 Labels | PASS with points | Four tabs, Note Tags on the record grid, 44 px rows. Priority glyph differs from the grids (badge vs flag), no visible drag handle on the reorder lists, "Colour" vs "Color": #1260. |
| #1206 | PASS | No change needed. |
| #1207 Asset Types, Link Roles | PASS with a point | Record page tabs on the Details card, Link Roles list. Header "Edit" duplicates the form (#1260). |
| #1208 Custom Fields | PASS | Record grid, columns 560/96/152/240/48. |
| #1209 Settings > Dashboard | PASS | Working Days are seven pressed filter chips (26 px). |
| #1210 Branding, Holidays | PASS with a point | "Upload Icon", "..." per holiday row, dialog primary names the action. Native dropdowns remain in Holidays (#1251). |
| #1211 Reports tabs | PASS | Reports and Run Log on the record grid; pies checked on Assets > Reports, My Matters > Metrics and Dashboard > Breakdowns: solid colors, numbered legend, no pattern, stripe or hatch anywhere. Legend word "Pending disposition" and "All matters": #1262. |
| #1212 Report editor | PASS with a ruling | Title Case buttons, shared card look; actions stay in the header (D-44q, #1261). Native Category dropdown (#1251). |
| #1213 Audit Logs | PASS | Who column, headings, "Show More"; works for the Director and the System Admin. |

Rulings: D-44o, D-44p, D-44q; priority glyph points to `mf-priority-flag` (the grids' glyph), drag handle visible, "Color" spelling, "Upload Icon" confirmed, Holidays table stays, Audit Logs accepted without Columns and pager.

## review-21 My Matters narrow rule, native selects, system page leftovers and Calendar day panel (2026-11-06, tip d9850bf, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-21-my-matters-selects-leftovers/` (JPEG, `measurements.json`, `axe.json`). Axe: 0 violations on 10 pages at both sizes. Sticky header bug is #1259 (not reported again).

| Issue | Result | Notes |
|---|---|---|
| #1252 My Matters narrow rule | PASS with a point | Side panel starts collapsed under 1500 px (Task 446, Assignee 150), choice stored per user (`mf.mymatters.v2.<id>`) and kept after reload; opened at 1366: Type tile only, Ref whole above the title, Assignee hidden; Focus list shows names; crumb and Back link "Task Queue"; one Task Type block on Create Task. The At Risk pill still shows its word at about 200 px: #1264. #1164 and #1173 can close after #1264. |
| #1253 Matter Summary | PASS | On the shared Details card; field rows at the same y as before (300, 355, 410, 465, 520), card 1098 px at 1366. |
| #1251 native selects | PASS | 0 native selects on the 13 pages and dialogs checked (New Production, Add Out of Office, Add Holiday, Change Managers, Task edit, Matter edit, Report editor, Asset Type, new Asset Type, Asset form, Priorities, Users, Holidays). Two form dropdowns are blue-filled: #1264. |
| #1254 | PASS | "See All N" in the menu and on the Search page, banner icons 18 px, Error page button "Retry" only until it fails, title focus on not-found pages, swimlane menu labels. |
| #1255 | PASS | Overlap answer is `.pg-banner--danger` (4 px radius, two lines, `role="alert"`, icon). |
| #1258 Calendar day panel | PASS with a finding | Role groups open and close on their own; the repeat is the chip row "Data Technician 6, Director 1, Pod Lead 4" above the groups: #1263. |

Rulings: D-44r (white form dropdowns; Assignee hides only while a user-opened panel leaves the frame under 900 px; Ref natural width; Change Type under the name; banner icon 18 px on the first line; each role once per section).

## review-22 Admin lookups, report editor and chart casing (2026-11-06, tip eea249f, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-22-admin-reports-casing/` (JPEG, `measurements.json`, `axe.json`). Axe: 0 violations on 8 pages at both sizes. To see the real report flow I created one category ("UD Review Category") and one report ("UD Review Report", inactive, two versions) on the demo stack; categories are never deleted and the API has no report delete, so they stay (demo data). The report preview fails on the demo stack (SQL error 18456, the report login is not configured), so Activate could not be run.

| Issue | Result | Notes |
|---|---|---|
| #1260 lookups | PASS with a point | Priorities and the dialog preview use `mf-priority-flag`; 16 px grips (grab cursor) on Priorities, On-Hold Reasons and Link Roles, none on Status Labels; "Color" everywhere (0 "colour" left); Asset Type header is Activity, Edit Fields, "...". Plain priorities are link-blue with no underline: #1265. |
| #1261 report editor | PASS with points | Clean: Activity and "...". Changed: [Discard Changes] [Save Changes]; query changed: "Save as New Version" and the information banner with its icon; History shows Version 2 (Inactive, Compare with version 1, Activate disabled until previewed) and Version 1 (Restore); Activity drawer 520 px. Duplicate toasts, two error toasts on a failed preview, Categories add row order: #1266. |
| #1262 casing | PASS | "Pending Disposition", "All Matters", "All Asset Types" in the table, bar, pie legend and Metrics; Trends "Open and Overdue"; Breakdowns "Not Overdue". |

Rulings: D-44s (banner wording for an active report, Activate only for the current version with Restore for older ones, "..." stays in the changed state, plain priorities, no grip on Status Labels).

## review-23 Calendar role chips, form dropdowns and At Risk icon (2026-11-06, tip 18f737a, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-23-calendar-dropdowns-at-risk/` (JPEG, `measurements.json`, `axe.json`). Axe: 0 violations on 7 pages at both sizes. (The dev server on port 4200 had died; I restarted it from the same worktree.)

| Issue | Result | Notes |
|---|---|---|
| #1263 Calendar day panel | PASS | Busy day (Mon 11/16, Director): the role chip row is gone; group headers "Data Technician 6", "Director 1", "Pod Lead 4" open and close independently; legend "Chip color = category". |
| #1264 form dropdowns | PASS | 20 form, dialog and record dropdowns checked: all white with a value (New Production, Add Out of Office, Task edit, Matter edit, Change Managers, Asset form, Calendar Out of Office, Holidays, Add Holiday, Priority, Task Type, Asset Type, new Asset Type, Report editor, Copy From Role, Profile time zone); filter dropdowns stay blue when valued (Assets, Matters, Task Types "Active"). Create Task Project is grey while disabled (no matter chosen). Bulk Update dialog not reached. |
| #1264 At Risk icon | PASS with a rule change | Open panel at 1366: 26 px clock circle, title 240 px. At 1920 the word stays. Panel closed at 1366 (Task cell 446 px) the word shows while the title is cut: rule changed to the whole cell under 460 px (#1267). |
| #1252, #1164, #1173 | PASS | Their remaining point (At Risk icon) is delivered; the 460 px rule is a refinement (#1267). |

Rulings: whole-cell threshold of 460 px (D-44t); icon circle 26 px with 18 px icon accepted; Asset Reports criteria, Metrics Unit pickers, Comments sort and Note editor text style count as toolbar controls.

## review-24 sticky grid bands, Users and Task Types (2026-11-06, tip 23ace03, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-24-sticky-users-task-types/` (JPEG, `measurements.json`).

| Issue | Result | Notes |
|---|---|---|
| #1259 sticky bands | PASS | Mouse-wheel test on 20 grids at both sizes: the header and filter bands keep their position while the data rows move (Matters, Assets, Task Queue, Dashboard Summary, Matter Tasks, Project Tasks, Task Types, Steps, Audit Logs at 1366; Assets, Task Queue, Dashboard Summary at 1920); the band is on top of the rows; the first column keeps its x after a sideways wheel. Clients, Projects, My Work, Pod Work, Users, Pods, Workflows, Asset Types, Custom Fields, Priorities and Asset Linked Tasks have too few rows to scroll in the demo data (Pod Work: 6 rows). Filters button: standard focus ring (2 px solid `--mf-focus`, offset 2) only for keyboard focus; none after a mouse click. |
| #1257 | PASS | Names are `mf-btn--name` (underlined), no `.us-open`; Roles Name and the chip on one line; Pods popover on the menu surface with the Primary chip. |
| #1256 | PASS | Task Types list is 1096 px, no sideways scroll; Workflow and Step rows keyed by id; no header "Edit" on Task Type, Workflow, Step; designer on the record header with `[Retire Version] [Create New Draft]`, information banner with icon, tabs 40 px, "Access Request Form". |

Rulings: D-44u and D-82 (widths, `[Save Draft] [Publish...]` without Discard, 32 px tile, library tab copy, "<Name> Form", delete the phone spec). Fix issue #1268.

## review-25 priority names, report toasts and At Risk threshold (2026-11-06, tip 6cb1083, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-25-priorities-toasts-at-risk/`.

| Issue | Result | Notes |
|---|---|---|
| #1265 | PASS | Critical and High are pills in `mf-btn--chip` ("Edit Critical", 1 px outline on hover); Normal, Low and custom names are `mf-btn--name`; no `.pr-open`; three Tab stops per row (name, count, menu). |
| #1266 | PASS | One visible toast per report event ("Saved as version 3" with the detail); a failed preview shows one error toast with "Copy Reference" and "Dismiss"; Categories add row `[Cancel] [Add Category]`, 32 px (D-02). |
| #1267 | PASS | Task cell 446 px (1366 closed) and 304 px (open) show the clock icon, 1920 (1000 and 708 px) shows the word. At Risk rows have a title about 170 px, other rows 262 px at 1366 closed: accepted (D-44v). |
| axe region | not from #1267 | `region` comes from the shared tooltip element (`role="tooltip"` appended to `body`), visible after hovering the panel toggle at 1366 open and at 1920 closed; fix in #1268. |

Rulings: D-44v; `mf-btn--name`, `mf-btn--chip` and the toast copy action are added to the catalogue (section 3).

## review-26 closing sweep of open UI update 2 issues (2026-11-06, tip ca460b4, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-26-closing-sweep/` (JPEG, `measurements.json`). Tested on the real stack (empty and error states made with request blocking, nothing written).

| Issue | Verdict | Notes |
|---|---|---|
| #1170 task list states | PASS, close | Empty "No tasks match these filters." + Clear Filters, error "Couldn't load tasks." + Retry (no visible toast), count chip "--" while loading or failed, on Task Queue, My Work and Pod Work at both sizes. |
| #1176 Matter Tasks, Projects, Assets tabs | FAIL | Tasks tab is complete (7 resize handles, Columns, Select, Ref 100, Type 128, Title 330, Priority 112, Assignee 136, Due 152, Status 140). Projects and Assets tabs are hand-built: no Columns, no Sorted line, no resize (0 handles). Fix: #1269. |
| #1177 Productions, Notes, Activities | PASS, close | Notes segmented switch, Productions Direction and Spec as form dropdowns, Activities Kind dropdown, 44 px rows, `11/04 hh:mm` dates. The Activities and Productions tables still lack resize and Columns: #1269. |
| #1180 Client record | PASS, close | Header, fact chips, 16/600 heading, 40 px header, overdue chip, "View all 3 matters" link. The Client > Matters tab table is hand-built: #1270. |
| #1181 Client new and edit | PASS, close | Header "New Client" / "Edit Client", `[Cancel] [Create Client]`, `[Cancel] [Save Changes]` at 36 px. |
| #1185 Assets list | PASS, close | Covered by #1249 (review 16): fits 1096 px, stable headings, chip whole. |
| #1201 Task Types list | PASS, close | Covered by #1256 (review 24). |
| #1202 Task type record and designer | PASS, close | Covered by #1256: record header, no duplicate Edit, designer on the record header, 40 px tabs, banner with icon. The draft header `[Save Draft] [Publish...]` is covered by unit specs, not seen live (it would create a draft on demo data). |
| #1231 Title resize | PASS, close | Task Queue, My Work, Pod Work, Dashboard Summary, Matter Tasks, Project Tasks at both sizes: narrower, wider, kept after reload, Reset Width restores the spring. |
| #1235 task type name and colour | UI PASS; NOT VERIFIED backend | Same type, same color in Task Queue, Dashboard Summary and Asset Linked Tasks; the Type name shows on the linked tasks API. Not verified: the backend integration tests (Docker, never run), the sensitive-matter personas on `/assets/{id}/linked-tasks` (the demo sensitive assets 26, 28, 29 have no linked tasks), a type without color on every source. |
| #1241 shared record grid | PASS, close | Steps 1, 2 and 4 are in place (Matters, Clients, Projects, Assets, Asset Linked Tasks resize and store widths; guard spec exists). The tables still on the guard's ALLOWED list are tracked in #1269 and #1270. |

Epics: #1108, #1109, #1111, #1114, #1116, #1117, #1118, #1120, #1121 have no open child. Open: #1107 (1241, 1268), #1110 (1170, 1231, 1235), #1112 (1176, 1177, 1269), #1113 (1180, 1181, 1270), #1115 (1185), #1119 (1201, 1202), #1106 (all epics).

Guideline text updated in this sweep: D-80 (rail below 1100 px removed), D-46 (under 768 px removed), D-44i (Assignee rule and At Risk threshold now match D-44r and D-44t), "colour" to "color" in the guideline prose, theme-guide toolbar diagram ("Other filters") and the Phone row removed. Left in `theme-guide.md`: the 768x1024 and 375x812 sweep line (sweep.md history), the 44 px touch control size.

## review-27 desktop-only clean-up, tooltip and wiki (2026-11-06, tip 28c5324, 1366 and 1920)

| Item | Verdict | Notes |
|---|---|---|
| #1268 tooltip | PASS | The tooltip is `aria-hidden="true"`; its owner keeps `aria-describedby` (id equal to the tooltip id). Axe 0 with a tooltip open on My Matters with the side panel open (toggle button) and on Dashboard (Hide Panel), at 1366 and 1920. Other pages checked (Tasks, Projects) showed no tooltip on the elements tried, axe 0. |
| #1268 e2e clean-up | PASS (read only) | Eight specs deleted, swimlane and Task Types card specs cut and renamed, size lists reduced to 1366x768 and 1920x1080, 200 percent zoom check kept. The e2e suite was not run. |
| D-10a conflict | fixed | Banner icon is 18 px (`--mf-icon-md`) everywhere: D-10a corrected; stale texts in `_banners.scss` and the wiki are #1271. |
| Wiki | OK | Catalogue and UI Standard match section 3 (`mf-btn--name`, `--chip`, details card, record grid, Copy Reference, `field` on the dropdown, banners). One sentence in the Banner section mentions the old D-10a conflict: #1271. |

Rulings (D-82 exceptions): 200 percent zoom (683 px), 1098 and 1023 px frame checks stay; 400 percent (342 px), tablet rail tips, narrow column-drop tests and tab-strip scroll cues are deleted correctly; non-layout tests moved to 1366x768 are right; phone code and phone unit specs stay.

## review-28 Matter tabs and Client Matters tab on the shared grid (2026-11-06, tip c4cce1a, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-28-matter-client-tabs-grid/`. I created one production through the dialog on the real stack, looked at it, and deleted it again (demo data is clean).

| Issue | Verdict | Notes |
|---|---|---|
| #1269 Matter tabs | PASS | Projects (679/125/105/140/48), Assets (128/485/105/168/162/48), Productions (216/168/246/106/160/152/48), Activities (124/876/96): table 1096 px at 1366, no sideways scroll, rows 44 px, no clipped cell, resize handles and Columns on each, axe 0 at both sizes. Productions row menu "Open Production", "Delete Production" (confirm "Delete Production"); Specs empty state shown. Activities: band stays while rows move (#1259). |
| #1270 Client > Matters | PASS with a point | Same grid, 5 handles, Columns, filters kept. Status is 238 px but the filters are stacked as on the Matters list (Status 160): #1272. |
| #1176 | closed by decision | Select and View are not needed on the Projects and Assets tabs; point 3 (Project cell as a link) is #1273. |

Rulings: no Search box on Client > Matters accepted; Productions menu Open/Delete and Specs menu Open/Duplicate accepted (D-44g); more than 100 projects sorting only the loaded ones accepted; the Project cell becomes a link with "Move to Project..." in the row menu (#1273); the `button-rule.spec` failure is a CSS fault, the chip button takes `min-height: var(--mf-chip-h)` (#1274).

## review-29 last small fixes (2026-11-06, tip 6b6f358, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-29-last-small-fixes/`.

| Issue | Verdict | Notes |
|---|---|---|
| #1274 chip min-height | PASS | `min-height: 26px` from `--mf-chip-h`; button box 28 px around the 26 px pill (1 px transparent border), accepted. |
| #1271 banner icon texts | PASS | `_banners.scss` and the wiki say 18. |
| #1272 Client > Matters Status | PASS | 157 / 501 / 125 / 105 / 161 / 48 at 1366 and Matter Name 1055 at 1920, filters stacked. The Matters list is still 238 px at 1920 (side by side from 1500 px): #1276. |
| #1273 Project cell and move | PASS with points | Underlined link or dash, "Move to Project..." dialog 416 px with a white dropdown. Corrections: one action is an icon button (D-36), toast wording for No Project, the dash speaks "0" instead of "No project": #1275. |

New fix issues: #1275 (Move to Project action, toast, spoken name), #1276 (Matters list filters stacked at every width), #1277 (Create Task scrolls its header out of view at 1366), #1278 (Asset Reports dashed placeholder). Rule D-44w.

## review-30 last four fixes (2026-11-06, tip bf2dd16, 1366 and 1920)

Evidence: `design-evidence`, `evidence/2026-11-06-review-30-last-four-fixes/`. I moved TSK-59 into the project and back to "No Project" on the real stack; the demo data is unchanged.

| Issue | Verdict | Notes |
|---|---|---|
| #1275 | PASS | Icon-only "Move to Project" (32 px, tooltip), 416 px dialog, toasts "Task moved" with "TSK-59 is in Demo Custodian wave 1." and "TSK-59 is no longer in a project."; the dash speaks "No project". |
| #1276 | PASS | Matters list Status 161 at 1366 and 1920, Matter Name 577 at 1920 (accepted instead of "about 605"); Client > Matters 161, filters stacked. |
| #1277 | PASS | At 1366 the crumb (65) and title (93) are in place after choosing a type, Matter is focused, Tab goes to Title. |
| #1278 | PASS | Idle "Choose what to count, then run the report."; Disposed plus Harvey Vault: "No assets match this report." with "Clear Filters", which resets both. |

Rulings: the `window.scrollTo({ top: 0 })` at the step change stays (a new step starts at the top; do it only when the step changes). Dashed boxes: one real one seen (Holidays no match), two dead CSS rules, the rest used by states that cannot be reached with the demo data: #1279.
