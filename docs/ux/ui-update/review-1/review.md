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
