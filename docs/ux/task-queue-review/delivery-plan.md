# Task Queue review: delivery plan

Owner approval: "create epic and issues from the Task Queue review" (2026-10-18), with product decisions delegated to the PM ("you can make decisions for me"). Decisions are recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-18, base `origin/dev` (after the My Work packages WP1 to WP12b). Source review: `README.md` in this folder (56 screenshots in `screenshots/`).

Structure on GitHub: one epic **#195** (labels `epic` + `phase-7`), 48 sub-issues #196 to #243 (label `phase-7`). 45 are built, 3 are decided "not now" and closed as not planned (#241, #242, #243). Folded IDs (named in the host issue title or body, nothing dropped): TQ3 in #216; TQ8 in #225; TQ13 in #200; TQ14 and TQ48 in #196; TQ15 and TQ44 in #209; TQ16 in #210; TQ17 in #197; TQ20 in #211; TQ26 in #235; TQ33 in #226; TQ35 in #222; TQ36 in #227; TQ39 in #215; TQ41 and TQ42 in #201; BUG-TQ1 in #200; BUG-TQ3 in #208. "Verified good" items (TQ11, TQ27, TQ30, TQ32, TQ34, TQ37, TQ43, TQ45, TQ46) and the decided TQ24 need no work.

Issues blocked on an owner decision: **none**.

Effort is in **AI-agent hours** (wall-clock of one developer agent, including unit, integration, e2e, axe and screenshots). A typical package took 1 to 3 hours in the My Work epic; a full verification pass about 5.

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package |
|---|---|---|---|---|---|
| #196 | R1-1 (TQ14, TQ48) | Title cell: icon and title only | 2 | - | WP2 |
| #197 | R1-2 (TQ17) | Matter two-line cell, Client one-line | 1.5 | #196 | WP8 |
| #198 | R1-3 | Default columns per page, migration v3, notice | 1.5 | #196, #197 | WP8 |
| #199 | R1-4 | Pod Work: Actions into the Assignee cell | 1 | #196, #234 | WP6 |
| #200 | R2-1 (BUG-TQ1, TQ13) | Fixed layout, colgroup, Title spring | 3 | #196 | WP9 |
| #201 | R2-2 (TQ41, TQ42) | One narrow-box rule, sticky Ref | 1.5 | #200, #196 | WP13 |
| #202 | TQ28 | Priority/Status chevron inside, narrower | 1 | #200 | WP13 |
| #203 | R2-3 | Width storage `mf.work-widths.v1` | 1 | #200 | WP17 |
| #204 | R2-4 | Drag handle, guide-line fallback | 3 | #200, #203 | WP20 |
| #205 | R2-5 | Fit to content | 1 | #203, #204 | WP21 |
| #206 | R2-6 | Column widths section in the panel | 2 | #203, #205 | WP22 |
| #207 | R2-7 | Header context menu | 2 | #203, #205 | WP21 |
| #208 | R3-1 (BUG-TQ3) | Due text logic, "In 2 days" | 1.5 | - | WP1 |
| #209 | R3-2 (TQ15, TQ44) | `mf-due-cell` in the grid | 2.5 | #208, #200 | WP14 |
| #210 | R3-3 (TQ16) | Fixed 44 px rows, one-line cells | 2 | #196, #197, #200, #209 | WP15 |
| #211 | R3-4 (TQ20) | Compact 36 px | 1.5 | #210, #209, #197 | WP19 |
| #212 | TQ31 | Skeleton follows the colgroup | 1 | #200, #210 | WP15 |
| #213 | BUG-TQ2 | Dashboard lists clip the Due badge | 1.5 | #208, #209 | WP25 |
| #214 | TQ47 | Swimlane and task header use `mf-due-cell` | 1.5 | #208, #209 | WP25 |
| #215 | BUG-TQ6 (TQ39) | Print | 1 | #200, #209 (soft #237) | WP26 |
| #216 | TQ2 (TQ3) | Two-row toolbar, Sorted by in footer | 1.5 | - | WP5 |
| #217 | TQ10 | Restored notice in the chip row | 1 | #216 | WP5 |
| #218 | TQ1 | Quick view counts (`views`) | 3 | - (merge after #233) | WP10 |
| #219 | TQ4 | View = filters + sort + overlay | 2.5 | soft #218 | WP11 |
| #220 | TQ7 | Views Due soon, ASAP, On hold | 1.5 | #218, #219, #216 | WP16 |
| #221 | TQ9 | Recognise Dashboard links | 1 | #220 | WP16 |
| #222 | TQ5 (TQ35) | One vocabulary with My Work | 1 | - | WP12 |
| #223 | TQ6 | Hide My pod / Created by me | 0.5 | - | WP16 |
| #224 | BUG-TQ7 | Recently completed window | 1 | #219 | WP12 |
| #225 | BUG-TQ5 (TQ8) | Chip and notice wording | 1 | soft #155, #220 | WP4 |
| #226 | BUG-TQ8 (TQ33) | Empty copy per view | 1 | soft #220 | WP4 |
| #227 | BUG-TQ9 (TQ36) | Title, caption, one announcement | 0.5 | - | WP4 |
| #228 | TQ12 | Filter placeholders | 0.5 | - | WP18 |
| #229 | TQ49 | Microcopy, "Other filters" | 0.5 | #216 | WP18 |
| #230 | TQ18 | Columns panel groups | 1 | soft #206 | WP22 |
| #231 | TQ19 | Closed instead of Due suggestion | 1 | #230, #219 | WP24 |
| #232 | TQ22 | Group labels in Due-sorted lists | 2.5 | #200, #233, #218 | WP23 |
| #233 | TQ23 | Sort by Assignee and Client | 2 | - | WP3 |
| #234 | TQ25 | Assign to me in the Assignee menu | 1 | - | WP6 |
| #235 | BUG-TQ4 (TQ26) | Closed row Status menu: Reopen only | 1 | - | WP7 |
| #236 | TQ29 | Quick views toolbar, Tab stops | 1.5 | #220, #216, #207 | WP24 |
| #237 | TQ38 | Pager Page n of m | 1.5 | soft #216 | WP18 |
| #238 | TQ40 | Phone cards content (owner #192) | 2 | #192, #209, #218, #237, #197 | WP27 |
| #239 | H1 | Documentation | 2 | all | WP28 |
| #240 | H2 | Final verification pass | 5 | all | WP29 |
| #241 | TQ21 | Column order | - | not now (closed) | - |
| #242 | TQ50-4 | Group by Assignee or Pod | - | not now (closed) | - |
| #243 | X4 | Server-side preferences | - | not now (closed) | - |

Total: about **70 agent-hours** (45 issues), of which the three owner requirements are #196 to #211 (about 28 hours: requirement 1 = #196 to #199, requirement 2 = #200 to #207, requirement 3 = #208 to #211).

## 2. Decisions (PM) in one place

The owner's three requirements are implemented as written. Decisions already made by the PM before this plan: **(a)** the Due cell drops the zone abbreviation (the tooltip and the column header tooltip carry the zone; addendum M stays for comments, activity and detail timestamps); **(b)** a Completed or Cancelled row's Status menu does not offer "Cancel task" (closed tasks are only reopened); `docs/ux/ux-spec.md` Appendix B is corrected in the commit that carries this plan.

Review of the requirements against the existing decisions and the shipped grid:

- **Title lines.** Comfortable titles may use 2 lines (the line freed by the subline); WP9's one-line title applies to Compact only (#196, #211). Row 44 px, 10 rows at 1366x768 (WP9's target of 9 is exceeded).
- **Subline removed everywhere, My Work included (#196).** Reverses part of My Work A2 (#174, `ref . client . matter` subline, Matter column dropped from Active and Due soon and overdue) and A3 (#175 fold); the WP8b "New" pill goes (the Ref dot stays); the WP9 tablet Ref fold (`foldRef`) goes. **My Work impact:** Active, Due soon and overdue and Created by me gain the Matter column (two lines: reference over name); Closed already had it; users who customised their set get Matter inserted once with a notice (#198). Task Queue and Pod Work users who deliberately removed Matter keep their choice and the notice offers "Add Matter column".
- **#189 and #190 (My Work, partly done by WP9): closed as completed in part, superseded.** The fold at 1180 px is obsolete (no subline, #196); the Due cap becomes the colgroup and the two-line cell (#200, #209); chrome is #216 and #217; Compact is #211 (single owner, shared density control); the row-count targets (9 on My Work Active, 14 at 1920) are acceptance criteria in #210 and #240. #191 and #176 had already shipped; #176's skeleton is re-based on the colgroup in #212.
- **Fixed layout replaces the WP9 `min-width` rules** (`src/styles/_tables.scss`: Ref, Priority, Due, Status, Progress, Age) and the Title `min-width/max-width` (#200). Due minimum is 120 px (the review said 112) so that "Overdue 120d" with its icon fits; Ref default 96 px must be measured with the WP10 pause marker and the New dot.
- **One narrow-box rule** replaces `PROGRESS_FOLDS_BELOW`, `MATTER_HIDES_BELOW`, `PROJECT_HIDES_BELOW` and the WP9 tablet drops (#201); on tablets Ref is the sticky column (not Title).
- **Persistence key and migration.** Widths: `mf.work-widths.v1.<scope>.<userId>`, sparse, integers in px at a 16 px root, applied in `rem`, clamped on read, never stored for the Title, independent of density (#203); no migration needed (new key). Column sets: migration flag `mf.work-columns.v3.migrated.<page>.<userId>`, idempotent, runs after the v2 flag (#198). The review's `work-prefs.ts` umbrella module is not built (it would refactor four working storage paths for no user gain); only `work-widths.ts` is new.
- **Minimum and maximum widths** are the review's table, set in `ColumnDef` (#200), except Due min 120. The Title minimum is 160 px and not user-changeable in this epic (#206).
- **Live resize limit and fallback.** Live up to 100 rows (the largest page size); above that, or when a frame takes more than 24 ms, a guide line and the width is applied on release (#204). Resize code is lazy-loaded (bundle about 635 kB of 700).
- **Keyboard alternative.** The Columns panel "Column widths" section (#206) is primary (WCAG 2.1.1 and 2.5.7); the header menu (#207, Menu key, Shift+F10, right click, long press) is secondary; drag handles are `aria-hidden`, outside the tab order and outside `tbody`, so the WP12b key model (`tr[data-task]`, `a.wt-title`, `td[data-col=status|priority] [data-inline-trigger]` on `.wt-wrap`) is unaffected.
- **Phone cards ownership.** Single owner: **My Work #192** (renderer, 640 px breakpoint, My Work, Task Queue, Pod Work). #238 is the Task Queue's card content and acceptance, implemented inside #192 (the WP13c step) and closed with it; both issues say so. #192's dependencies #189 and #190 are replaced by #196, #197, #200, #209, #210, #211, #218, #237. The WP10 phone "Waiting:" line under the title goes with the card.
- **Server-side preferences: out** (#243), column order out (#241), group by assignee or pod out (#242); the due-bucket labels for Due-sorted lists (#232) reuse WP12a. Nothing is blocked on the owner.
- **Zone abbreviation, "In 2 days", no "Overdue 9w" cap** (#208). **Quick views:** All open, Unassigned, Overdue, Due soon, ASAP, On hold, My pod (only with a primary pod), Created by me (only with `Task.Create`), More (Recently completed); order follows the Dashboard tiles (#220, #223). **Vocabulary:** Created by me starts on Open like My Work; the 30 and 90 day windows stay (#222); the Recently completed window equals the Dashboard tile (30 days including today, #224). **Chips:** one rule, no label repeats its value; My Work #155 keeps its preset names (#225). **Dashboard lists adopt `mf-due-cell`;** their "Created today" second line is replaced and the creation info moves to the tooltip (#213).
- **Overlaps with open My Work issues:** #169 (Columns panel, close before the panel packages), #155 (chip function, shared with #225), #173 and #184 (default sets, only Matter added), #193 (docs sweep must not document the subline; #239 coordinates). Each has a comment.

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes and never hand-merge them, run unit + integration + e2e + axe (0 violations at 1366, 1920, 768 and 375), attach screenshots in `docs/ux/task-queue-review/fixes/<package>/`, keep the initial bundle at about 635 kB of 700 kB, keep `task-table.scss` at or under its 5 kB budget (new rules go to `src/styles/_tables.scss` or to a new component; never raise the budget), update the docs named in the issue (the Status section below). SQL scripts: next free number is **28** (latest `27-dashboard-unassigned.sql`); no package is known to need one. If profiling at 5,000 tasks asks for an index (#218 counts, #232 bucket counts, #233 sorts), the first PR to merge takes 28 and the others renumber at merge time.

| Rank | WP | Issues | Main files / areas | Agent-h | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP1 Due logic | #208 | `core/time/time.ts`, `time.spec.ts` | 1.5 | everything | - | Frontend only |
| 2 | WP2 Title cell | #196 | `shared/work-queue/task-table.ts`, `src/styles/_tables.scss`, specs that read the subline | 2 | WP1, WP3, WP4, WP5, WP7 | - | Frontend only |
| 3 | WP3 Sort keys | #233 | `TaskQueueService.cs`, `TaskQueueRules.SortFields`, `queue-filters.ts`, `column-prefs.ts` (`sortField`) | 2 | WP1, WP2, WP4, WP5 | - | Additive keys; script 28 only if profiling asks |
| 4 | WP4 Copy | #225, #226, #227 | `filter-chips.ts`, `restore-summary.ts`, `empty-copy.ts`, `work-list.ts` live region and title | 2.5 | WP1, WP2, WP3 | soft #155 | Frontend only |
| 5 | WP5 Toolbar | #216, #217 | `filters-bar.ts`, `work-view-controls.*`, `work-list.*`, restore notice | 2.5 | WP1 to WP4, WP6, WP7 | - | Frontend only |
| 6 | WP6 Assign to me | #234, #199 | `inline-menu.ts`, `row-edit.ts`, Pod Work page, assignee case in `task-table.ts` | 2 | WP1 to WP5 | merge after WP2 (same file, other branch) | Frontend only |
| 7 | WP7 Closed row menu | #235 | `inline-status-flow.ts`, task detail menu and header, status-change command check | 1 | all | - | Additive validation only; no SQL |
| 8 | WP8 Matter cell and defaults | #197, #198 | new `mf-matter-cell`, `column-prefs.ts` (defaults, migration v3), `my-work-page.ts` notice | 3 | WP10, WP3 | WP2 | Matter active flag on the row only if missing |
| 9 | WP9 Fixed layout | #200 | `task-table.ts` (colgroup), `column-prefs.ts` (`ColumnDef` widths), `_tables.scss`, print override | 3 | WP10 to WP12 | WP2, WP8 (serial, same files) | Frontend only |
| 10 | WP10 View counts | #218 | `TaskQueueService.cs`, DTOs, `quick-views.ts`, view button rendering | 3 | WP8, WP9 | WP3 (same backend file) | Additive `views`; script 28 only if profiling asks |
| 11 | WP11 View overlay | #219 | `quick-views.ts`, `dashboard-links.ts` `LIST_ORDER`, `queue-page.ts` | 2.5 | WP9 | WP10 | None |
| 12 | WP12 Vocabulary and window | #222, #224 | `quick-views.ts`, `queue-page.ts`, tooltip text | 2 | WP9, WP13 | WP11 | None |
| 13 | WP13 Narrow rule and controls | #201, #202 | `task-table.ts` (`shownColumns`), `mf-row-edit` triggers, `_tables.scss` | 2.5 | WP12, WP14 only after WP9 merge | WP9 | Frontend only |
| 14 | WP14 Due cell in the grid | #209 | new `mf-due-cell`, due case of `task-table.ts` | 2.5 | WP12, WP13 | WP1, WP9 | Frontend only |
| 15 | WP15 Rows and skeleton | #210, #212 | `task-table.ts`, `_tables.scss`, `task-skeleton.ts` | 3 | WP12, WP16, WP17 | WP14, WP8 | Frontend only |
| 16 | WP16 More views | #220, #221, #223 | `quick-views.ts`, `queue-page.ts`, toolbar | 3 | WP15, WP17 | WP11, WP5, WP10 | None |
| 17 | WP17 Width storage | #203 | new `work-widths.ts`, applied in `task-table.ts` | 1 | WP15, WP16 | WP9 | Frontend only |
| 18 | WP18 Pager and microcopy | #237, #228, #229 | pager footer in `work-list`, `column-filter-row.ts`, button text | 2.5 | WP15 to WP17 | WP5 | Frontend only |
| 19 | WP19 Compact | #211 | `task-table.ts`, `_tables.scss` | 1.5 | WP16, WP18, WP20 | WP15 | Frontend only |
| 20 | WP20 Drag resize | #204 | header cells in `task-table.ts`, lazy `column-resize.ts`, handle styles | 3 | WP16, WP18, WP19 | WP17, WP13 | Frontend only |
| 21 | WP21 Fit and header menu | #205, #207 | lazy resize chunk, `header-menu.ts`, `shortcut-registry.ts` | 3 | WP19, WP23 | WP20 | Frontend only |
| 22 | WP22 Columns panel | #206, #230 | `column-chooser.ts` (+ `.scss`) | 3 | WP19, WP23, WP25 | WP21 (Fit), #169 closed | Frontend only |
| 23 | WP23 Due sort groups | #232 | `TaskQueueService.cs` (`bucketCounts`), `due-groups.ts`, `task-table.ts` group rows | 2.5 | WP19, WP22 | WP9, WP3, WP10 | Additive `bucketCounts`; script 28 only if profiling asks |
| 24 | WP24 Toolbar keys and suggestion | #236, #231 | quick views toolbar, `column-chooser.ts` suggestion line | 2.5 | WP25, WP26 | WP16, WP21, WP22 | Frontend only |
| 25 | WP25 Dashboard and Swimlane adoption | #213, #214 | `task-list-panel.ts`, `due-chip.ts`, `swimlane-card.ts`, drawer, task header | 3 | WP19 to WP24 | WP1, WP14 | Frontend only |
| 26 | WP26 Print | #215 | print partial in `src/styles`, print line | 1 | WP24, WP25 | WP14, WP9, WP18 | Frontend only |
| 27 | WP27 Phone cards (Task Queue content, inside #192 WP13c) | #238 (with #192) | card renderer owned by #192 | 2 (on top of #192) | - | #192 WP13b, WP14, WP10, WP18, WP8 | Frontend only |
| 28 | WP28 Docs | #239 | `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `tokens.css` | 2 | WP26, WP27 | all code packages | none |
| 29 | WP29 Final verification | #240 | e2e contract tests, `fixes/final/` | 5 | - | everything | none |

Total: about **70 agent-hours**. With three developer agents working in parallel (one on the grid chain, one on views and backend, one on cells, copy and Dashboard) the wall-clock is about **26 hours** (3 to 3.5 working days); one agent alone needs about 70 hours.

### Parallelism at a glance

- **Wave 1 (start together, different files):** WP1 (`time.ts`), WP2 (`task-table.ts`), WP3 (backend sorts), WP4 (copy), WP5 (toolbar), WP7 (status menu). WP6 may start too and merges after WP2.
- **Wave 2:** WP8 after WP2, then WP9 (same files, one agent: WP2, WP8, WP9 in a row); WP10 after WP3, then WP11, WP12.
- **Wave 3:** WP13 and WP14 after WP9 (they touch different parts of `task-table.ts`: rebase carefully, WP14 first if only one agent), WP17 after WP9, WP15 after WP14 and WP8, WP16 after WP11 and WP5, WP18 after WP5.
- **Wave 4:** WP19 after WP15, WP20 after WP17 and WP13, WP21 after WP20, WP22 after WP21 (and #169 closed), WP23 after WP9 and WP10.
- **Wave 5:** WP24, WP25, WP26 (each after its prerequisites), WP27 with #192's WP13c (waits for the grid contract).
- **Wave 6:** WP28 then WP29.

### Critical path

WP2 (2) then WP8 (3), WP9 (3), WP14 (2.5), WP15 (3), WP19 (1.5) is about 15 hours; the resize chain WP17 (1), WP13 (2.5), WP20 (3), WP21 (3), WP22 (3) runs beside it on a second agent after WP9 and ends at about 20 hours; WP29 (5) follows. Hence about 25 to 26 hours wall-clock.

### Hot spots (merge-conflict watch)

- `frontend/src/app/shared/work-queue/task-table.ts` and `.scss`: WP2, WP6, WP8, WP9, WP13, WP14, WP15, WP19, WP20, WP23. Merge in rank order; `task-table.scss` is at its 5 kB style budget: do not add rules there; use `src/styles/_tables.scss` (shared, global) or the new cell components (`mf-matter-cell`, `mf-due-cell`).
- `src/styles/_tables.scss`: WP2, WP9, WP13, WP15, WP19, WP20, WP26 (also holds the WP9 widths and the WP12a group rows).
- `column-prefs.ts` (`ColumnDef`, `DEFAULT_COLUMNS`, migration): WP3, WP8, WP9. `column-chooser.ts`: WP22, WP24 (and My Work #169).
- `TaskQueueService.cs`, `TaskQueueRules.SortFields` and the response DTOs: WP3, WP10, WP23. One backend-minded agent, in that order, additive only, separate methods; regenerate `contracts/openapi/v1.json` and the TS client after each rebase, never hand-merge.
- `quick-views.ts`, `queue-page.ts`, `work-list.ts`, `filters-bar.ts`: WP4, WP5, WP10, WP11, WP12, WP16, WP18, WP24.
- `core/time/time.ts`: WP1 only (keep the old `describeDue` signature working until WP25 migrates the Dashboard users).
- Specs that assert the subline, the one-line Due text or `More filters` (`my-work-per-tab-columns`, `wp9-density`, `wp10-hold-colours`, column-filters, my-work specs): updated by the package that changes the behaviour.

### Extension points (for the packages that follow)

- **Column contract (written by WP9, #200):** every `ColumnDef` declares `width`, `minWidth`, `maxWidth`, `fill?` and its cell's line budget; widths are CSS variables on the table read by `col`; a new column without them does not ship. Skeleton cells keep `td[data-col]` (`task-skeleton.ts`) so widths come from the colgroup.
- **Cells (WP8, WP14):** `mf-matter-cell` (reference over name, tooltip client and matter) and `mf-due-cell` (`layout: 'two-line' | 'inline'`, spoken sentence, `<time>`); the pure text logic stays in `core/time/time.ts` (`describeDue`). New cell content goes into a cell component, not into the `@switch (col.key)`.
- **Widths (WP17, #203):** `loadWidths`, `saveWidth`, `resetWidth`, `resetWidths`, key `mf.work-widths.v1.<scope>.<userId>`; scope is `columnScope(page, tab)`; the fit measure `fitWidth(col, cells)` (#205) is shared by the panel and the header menu.
- **Quick views (WP10, WP11):** a view is `{ filters, sort, dir, columnOverlay }` in `quick-views.ts`; counts come from `views` of `GET /task-queue`; sort definitions come from `LIST_ORDER` (`dashboard-links.ts`).
- **Grid keyboard model (WP12b):** reads only `tr[data-task]`, `a.wt-title`, `td[data-col=status|priority] [data-inline-trigger]` on `.wt-wrap`; resize handles live in `thead`, are `aria-hidden` and are never in the tab order; group header rows (WP12a, `tr[mfGroupHeader]`) span the shown columns through `colspan`.

### Definition of done per package

Issues closed, tests green twice, axe clean at four sizes, screenshots in `fixes/<package>/`, bundle and style budgets kept, docs named in the issue updated, Dashboard tile equals grid total for the touched views, the epic #195 tasklist ticked, and the line below added to the Status section.

## 4. Status

(One line per work package; keep other packages' lines when merging. Format: `WPn name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Planning (2026-10-18): epic #195 and issues #196 to #243 created; PM requirements review comments posted on every issue; #189 and #190 closed as superseded; #241, #242, #243 closed as not planned; comments with coordination points on #138, #155, #169, #173, #184, #192, #193; ux-spec Appendix B corrected (closed tasks only reopen).
- WP1 Due logic (2026-10-18, 3072f73): #208 done (describeDueCell in core/time/time.ts; old describeDue unchanged); unit specs, lint, prettier, tsc app+spec green; no UI change so no bundle or e2e impact; no screenshots (pure logic).
- WP2 Title cell: not started.
- WP3 Sort keys: not started.
- WP4 Copy: not started.
- WP5 Toolbar: not started.
- WP6 Assign to me: not started.
- WP7 Closed row menu: not started.
- WP8 Matter cell and defaults: not started.
- WP9 Fixed layout: not started.
- WP10 View counts: not started.
- WP11 View overlay: not started.
- WP12 Vocabulary and window: not started.
- WP13 Narrow rule and controls: not started.
- WP14 Due cell in the grid: not started.
- WP15 Rows and skeleton: not started.
- WP16 More views: not started.
- WP17 Width storage: not started.
- WP18 Pager and microcopy: not started.
- WP19 Compact: not started.
- WP20 Drag resize: not started.
- WP21 Fit and header menu: not started.
- WP22 Columns panel: not started.
- WP23 Due sort groups: not started.
- WP24 Toolbar keys and suggestion: not started.
- WP25 Dashboard and Swimlane adoption: not started.
- WP26 Print: not started.
- WP27 Phone cards (inside #192): not started.
- WP28 Docs: not started.
- WP29 Final verification: not started.
