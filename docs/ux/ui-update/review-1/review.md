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
