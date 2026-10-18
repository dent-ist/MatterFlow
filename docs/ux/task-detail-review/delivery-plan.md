# Task Detail review: delivery plan

Owner approval: "I like your recommendations about Task detail page review. create Epics / Issues as you need and continue working after your current planned works" (2026-10-18), with product decisions delegated to the PM ("you can make decisions for me"). Decisions are recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-18, base `origin/dev` (Clients WP1, WP2, WP3, WP5, WP8 and WP11 merged; Clients WP4, WP6, WP7, WP9, WP10, WP12 to WP15 still running or waiting). Source review: `README.md` in this folder (46 findings, BUG-1 to BUG-9, 79 screenshots in `screenshots/`, mock-ups in `mocks/`).

Structure on GitHub: one epic **#288** (labels `epic` + `phase-8`), 43 sub-issues **#289 to #331** (label `phase-8`). All 43 are built; none is decided "not now". Folded IDs (named in the host issue title, nothing dropped): H4 and H7 in #297; H5 and BUG-2 in #296; S4 in #294 (BUG-8); S3 in #291 (BUG-4); BUG-9 in #295 (document title) and #290 (error titles); B2 in #302; W2 in #311 (BUG-7); D1 in #312 (BUG-6); E2 in #321 (BUG-3); X3 in #295; CT1 split in #322 and #323. L4 (splitter handle) and C2 (Assets) are "no change recommended" in the review and need no issue. "Verified good" items (menus, reasons, focus return, `?tab=`/`?step=` links, View-only, 0 axe violations on 27 of 32 scans) are regression tests only.

Issues blocked on an owner decision: **none**. The five product questions of the review (section 6) are decided by the PM: (a) one page with no tabs (UAT-S10-2) and a section nav instead; (b) **Complete task** is the header's primary action and **Reopen** replaces it on a closed task; (c) Activity gets comment excerpts and grouping (additive API field); (d) Task-page single-key shortcuts **are built**, last, behind the existing shortcuts switch (#327); (e) Create task adopts the record header and the 720 px form width (header and layout only).

Effort is in **AI-agent hours** (wall-clock of one developer agent, including unit, integration, e2e, axe and screenshots). The review estimated 72 hours; the plan is **75** (permission variants 1.5 was not in the review's ten packages; docs 2.5 and final verification 5 replace the review's 7; splitting the Activity API and the Create page added about 1 hour).

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package |
|---|---|---|---|---|---|
| #289 | BUG-1 | No Asset API call or toast without Asset.View | 1 | - | T1 |
| #290 | S2 (BUG-9 errors) | Shared record state for task (404, 403, 5xx) | 1.5 | Clients #246 (done) | T1 |
| #291 | S3 (BUG-4) | 403 page links to a page the person can open | 1 | #290 | T1 |
| #292 | S1 | Task loading skeleton | 1.5 | #290, Clients #247 (done) | T1 |
| #293 | BUG-5 | Activity dates in Month-day format | 1 | - | T1 |
| #294 | S4 (BUG-8) | Failed Activity load: one message | 0.5 | #293 (order) | T1 |
| #295 | X3 (BUG-9) | Document title cut at 60 characters | 1 | #290 (order) | T1 |
| #296 | H1 (H5, BUG-2) | Task header on `mf-record-header` | 3.5 | T1, Clients #253-#256 (done) | T2 |
| #297 | H2 (H4, H7) | Facts strip, context line, Details trimmed | 4 | #296 | T2 |
| #298 | H3 | Primary action and overflow in the header | 3 | #296, #304 | T2 |
| #299 | H6 | Sensitive note on one line | 0.5 | #296 | T2 |
| #300 | Phone header | Back link, primary + overflow, 2x3 grid | 1.5 | #296-#298 | T2 |
| #301 | B1 | One status note | 3 | #296, #298 | T3 |
| #302 | B2 | Completed on/by, "Was due" | 1 | #301, #297 | T3 |
| #303 | M1 | Status menu labels and order | 1.5 | - | T4 |
| #304 | M2 | Complete readiness hint, first blocked step | 2.5 | - | T4 |
| #305 | M3 | Dialog wording | 1 | #304 (order) | T4 |
| #306 | M4 | Assign to me, Pod load hint | 1.5 | - | T4 |
| #307 | L1 | Narrow order, Details closed disclosure | 3 | #296, #297, Clients #257 | T5 |
| #308 | L3 | Section nav with counts | 3 | - (#296 for offsets) | T5 |
| #309 | L2 | Side panel without nested scroll | 2.5 | #313, #314, Clients #257 | T5 |
| #310 | W1 | Slim Workflow head, filter from 6 steps | 1.5 | #297, #298, #301 | T6 |
| #311 | W2 (BUG-7) | Completed step number stays with title | 0.5 | - | T6 |
| #312 | D1 (BUG-6) | Details heading row, alignment | 1 | #297 | T6 |
| #313 | D2 | Request details collapsible | 2 | #297, #312 | T6 |
| #314 | D3 | Description clamp | 2 | #313 | T6 |
| #315 | C1 | Composer first, "Showing latest 3 of 48" | 1.5 | - | T7 |
| #316 | A1 (API) | Comment id and excerpt in Activity events (backend) | 1.5 | - | T7 |
| #317 | A1 (UI) | Excerpt, link, grouping in Activity | 2.5 | #316, #293, #294 | T7 |
| #318 | A2 | Activity drawer title clamp | 0.5 | #293 | T7 |
| #319 | E1 | Edit dialog sticky footer, grouped sections | 2 | #313, #298 | T8 |
| #320 | E1 | Title textarea with counter | 1.5 | #319 | T8 |
| #321 | BUG-3 (E2) | Edit dialog no sideways scroll at 375 | 0.5 | - (#319 order) | T8 |
| #322 | CT1 | Create task header, 720 px column | 3 | #296, #297 | T8 |
| #323 | CT1 | Task-type chooser cards | 1.5 | #322 | T8 |
| #324 | X1 | `from=` for Matter, Project, Dashboard, Search | 2 | Clients #281, #264 | T9 |
| #325 | X2 | One way back | 0.5 | #296, #300, #324 | T9 |
| #326 | K1 | Drop the Details pencil | 0.5 | #298, #312 | T9 |
| #327 | K2 | Shortcuts C, A, S | 1.5 | #297, #315 | T9 |
| #328 | K3 | Focus after Complete, Hold, Resume, Reopen | 1 | #301, #298 | T9 |
| #329 | Permissions | Permission-variant matrix | 1.5 | #289, #297, #298, #291, #324 | T10 |
| #330 | Docs | ux-spec, addendum section W, UAT | 2.5 | all code | T10 |
| #331 | Verify | Final verification pass | 5 | all | T10 |

Total: **75 agent-hours** (43 issues). Review ID to issue: BUG-1 #289, BUG-2 #296, BUG-3 #321, BUG-4 #291, BUG-5 #293, BUG-6 #312, BUG-7 #311, BUG-8 #294, BUG-9 #295 and #290; H1 #296, H2 #297, H3 #298, H4 #297, H5 #296, H6 #299, H7 #297; M1 #303, M2 #304, M3 #305, M4 #306; B1 #301, B2 #302; L1 #307, L2 #309, L3 #308; W1 #310, W2 #311; D1 #312, D2 #313, D3 #314; C1 #315; A1 #316 and #317, A2 #318; E1 #319 and #320, E2 #321; CT1 #322 and #323; S1 #292, S2 #290, S3 #291, S4 #294; X1 #324, X2 #325, X3 #295; K1 #326, K2 #327, K3 #328.

## 2. Decisions (PM) in one place

- **Primary action (#298).** Header = Edit, Activity, **Complete task** (Reopen task on a closed task) and an overflow `...` with Put on hold / Resume, a divider, Cancel task (danger, last) and Copy link. The status chip keeps its menu. Nothing that changes the task stays in a banner or in the Workflow section. **Assign to me** is the first item of the assignee menu, not a header button (#306).
- **One status note (#301, #302).** One neutral note under the header replaces every banner: `Cancelled by KE\kekim, Oct 18, 4:03 PM: reason  [Reopen task]`, `On hold since ... by ...: reason  [Resume]`, `Completed Oct 18, 4:03 PM by ...`. Reasons clamp to 2 lines (shared `hold-note`), full text in the tooltip and in Activity. A closed task shows "Was due Oct 14" instead of a dash. The note's action appears only when the header does not already show it.
- **Facts strip (#297).** Exactly six tiles: Status (menu), Priority (menu), Due, Assignee (menu), Pod, Workflow progress "2 of 3". Matter, Client, Type and Workflow name are one muted context line (links gated by `Matter.View` / `Client.View`). Type and Pod leave Details. The strip reuses the work-strip CSS tokens, not the component (Clients #260 changes it).
- **Complete when steps need information (#304).** Never disabled, never hidden: a hint "3 steps need information" (tooltip, `aria-describedby`); the dialog lists the blocked steps and its primary button is "Go to first step". Ready tasks go straight to the confirm. No API change.
- **Header reuse (#296).** The Task page uses `mf-record-header` (on dev, 3f251ff) with a different data set; additive inputs only. BUG-2 (`target-size` on the wrapped crumb) is closed by the crumb truncation and 24 px links.
- **Narrow layout (#307, #308).** Below 1100 px: header, strip, status note, section nav, Workflow, Comments, Assets, Details. Details is a **closed disclosure with a one-line summary** at every width below 1100 px. The section nav `Workflow 2/3 . Comments 48 . Assets 0` is shown at all widths (sticky from 640 px, static below), with scroll-spy; it expands a collapsed section and focuses its heading. The page stays one page with no tabs.
- **Side panel (#309, #313, #314).** Shorter content first (Request details collapsible, open by default only at 6 fields or fewer; Description clamps at 12 lines), the bottom fade as the fallback cue; no nested scrollbar in the common case.
- **Edit dialog (#319, #320, #321).** 720 px wide, sticky Save footer, sections Task / Request details / Assignment, Request details collapsed and auto-opened on an error; Title is a 2 to 4 line textarea with "n / 200" (line breaks stripped).
- **BUG-1 (#289).** Fixed at the UI level: no Asset API call without `Asset.View`, and the one lookup that can still fail is quiet. No API change.
- **Activity (#293, #316 to #318).** Dates are formatted in the client (no server change, no migration). Comment events carry `commentId` and an 80-character excerpt derived at read time (no stored copy of user text). 3 or more consecutive comment events by one person within 10 minutes fold into "KE\kekim added 12 comments". The drawer title clamps at 2 lines.
- **Drill-in (#324).** `from=matter|project|dashboard|search` is added to the whitelist: this reverses decision T ("Dashboard lists unchanged") for the Task page only, approved.
- **Shortcuts (#327).** C, A, S built, behind the existing switch, last in the package.
- **Create task (#322, #323).** Header and layout only: record header, 720 px column, Summary as a facts-strip shape, 3 chooser cards per row at 1366. The form engine is out of scope.
- **Dialog wording (#305).** Hold dialog dismiss is "Close"; the Cancel-task dialog keeps "Keep task"; the field is "Reason" in both; Complete confirm "Complete all steps and finish".
- **Out of scope.** The fixed-height tab pattern for the Task page, the form engine and Fill from email, workflow completion rules, server-side changes of stored activity text, bulk actions, a dark theme, real screen reader testing, saved views, exports.

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes and never hand-merge them, run unit + integration + e2e + axe (0 violations at 1366, 1920, 768 and 375) and assert no page-level horizontal scroll, attach screenshots in `docs/ux/task-detail-review/fixes/<package>/` (t1 to t10, final), keep the initial bundle at its current size (about 641 kB of 700 kB), do not add rules to `task-table.scss` (use partials or new components), update the docs named in the issue (T10). Shared files (`row-edit.ts`, `hold-note.ts`, `entity-activity.ts`, `activity-drawer.ts`, `record-state.ts`, `record-skeleton.ts`, `record-header.ts`, `detail-layout.ts`, `drill.ts`) serve other pages: their specs are regression tests and changes are additive. **SQL scripts:** next free number is **28** (latest `27-dashboard-unassigned.sql`); **none planned** for this epic. **Backend work:** only #316 (Activity comment id and excerpt, `TaskActivityService.cs`, `TaskActivityNarrator.cs`, `contracts/openapi/v1.json`, TS client); everything else is frontend or tests.

Owner agent roles: **Header agent** (T1, T2, T3, T6, T8 edit dialog, T10), **Menus and layout agent** (T4, T7, T5, T9, Create page #322/#323), **Backend** (#316 only, 1.5 h, can be taken by whoever does T7). One agent can take several roles in sequence; the order inside a role must be kept.

| Rank | WP | Issues | Main files / areas | Agent-h | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | T1 Bugs and states | #289, #290, #291, #292, #293, #294, #295 | `task-details-tab.ts`, `task-asset-links.ts`, `record-state.ts`, `record-skeleton.ts`, `task-detail-page.ts`, `task-activity.ts`, `entity-activity.ts` | 7.5 | T4, T7 | - | Frontend only |
| 2 | T2 Header and facts strip | #296, #297, #298, #299, #300 | `task-header.ts`, `task-detail-page.ts`, `task-details-tab.ts`, `task-workflow-tab.ts`, `record-header.ts` (additive), strip styles | 12.5 | T4, T7, T5 (#308) | T1 (files), #304 for #298 | Frontend only |
| 3 | T3 Status note | #301, #302 | `task-detail-page.ts`, `task-workflow-tab.ts`, `task-step.ts`, `hold-note.ts` | 4 | T4, T5, T7 | T2 | Frontend only (actor name on the task response if missing: additive) |
| 4 | T4 Menus and dialogs | #303, #304, #305, #306 | `task-action-dialogs.ts`, `row-edit.ts`, `task-header.ts` | 6.5 | T1, T2, T7 | - (#304 before #298) | Frontend only |
| 5 | T5 Layout | #307, #308, #309 | `detail-layout.ts`, `task-detail-page.ts`, `section-state.ts`, new nav component | 8.5 | T3, T6, T7 | #308: none; #307: T2 (#296, #297) and Clients #257; #309: T6 (#313, #314) | Frontend only |
| 6 | T6 Workflow head and Details | #310, #311, #312, #313, #314 | `task-workflow-tab.ts`, `task-step.ts`, `task-details-tab.ts`, `rich-text.ts` | 7 | T4, T5, T7 | T2, T3 | Frontend only |
| 7 | T7 Comments, Assets, Activity | #315, #316, #317, #318 | `task-comments.ts`, `task-activity.ts`, `entity-activity.ts`, `activity-drawer.ts`, TaskActivity backend, OpenAPI | 6 | everything | #317 waits for #293, #294 (T1) | **#316 backend, additive, no SQL** |
| 8 | T8 Edit dialog and Create | #319, #320, #321, #322, #323 | `task-details-tab.ts` (dialog), `rich-text-editor.ts`, `create/create-task-page.*` | 8.5 | T5, T7, T9 | T6 (#313), T2; #321 can go first | Frontend only |
| 9 | T9 Drill-in and keyboard | #324, #325, #326, #327, #328 | `drill.ts`, `scoped-tasks.ts`, dashboard and search links, `task-header.ts`, `task-details-tab.ts`, shortcuts registry | 5.5 | T5, T8 | Clients #281 and #264 for #324; T2, T3, T6 | Frontend only |
| 10 | T10 Permissions, docs, verification | #329, #330, #331 | `frontend/e2e/tasks/*`, `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `docs/qa/e2e.md` | 9 | - | all code; #330 also waits for Clients #286 (section V) | none |

Total: about **75 agent-hours**. Independent of in-flight Clients work (can start now): T1, T4, T7, #308, #321 = about 30 hours. The old dependency of T2 on Clients WP3 is gone because WP3 is merged. With two agents the wall-clock is about **49 hours** (the critical path); one agent alone needs 75.

### Parallelism at a glance (waves)

- **Wave 1 (start together, mostly different files):** T1 (Header agent: states, `task-detail-page.ts`, record-state/skeleton), T4 (Menus agent: `task-action-dialogs.ts`, `row-edit.ts`, assignee menu) and T7 (Menus agent after T4, or a third agent: comments, Activity, backend #316). T1 and T7 both touch `task-activity.ts` and `entity-activity.ts` (#293, #294 are T1 and merge before #317/#318).
- **Wave 2:** T2 after T1 (same files `task-detail-page.ts`, `task-details-tab.ts`) and after #304 for #298; the Menus agent continues with #308 (section nav, independent) and #321 (CSS fix).
- **Wave 3:** T3 after T2 (Header agent); #307 after #297 and after Clients #257 (Menus agent); Create page #322/#323 after #296/#297 (Menus agent).
- **Wave 4:** T6 after T3 (Header agent: `task-workflow-tab.ts`, `task-details-tab.ts`); #324 after Clients #281 and #264 (Menus agent).
- **Wave 5:** #309 after #313/#314; T8 dialog (#319, #320) after #313; #325, #326, #328 after the header and note issues.
- **Wave 6:** #327 (shortcuts, last), then T10: #329, #330 (after Clients #286), #331.

### Critical path

T1 (7.5) then T2 (12.5), T3 (4), T6 (7), T8 dialog (3.5), T10 (9, of which #331 is 5) = **43.5 hours** on the Header agent; with the T8 Create page (4.5) and T9 on the Menus agent the Header agent's tail adds the permissions matrix and docs, so wall-clock is about 49 hours. The Menus agent's chain T4 (6.5), T7 (6), #308 (3), #307 (3), #322/#323 (4.5), #324 (2), T9 rest (3.5), #309 (2.5) = 31 hours and has about 15 hours of slack. T4's #304 must land before #298 starts (about hour 20), which it does by hour 3.

### Hot spots (merge-conflict watch)

- `task-detail-page.ts`: T1, T2, T3, T5 (#307, #308), T9 (#327, #328), strictly in that order for the Header agent; the Menus agent rebases onto it. It is the Task page's equivalent of `matter-detail-page.ts` in the Clients plan.
- `task-header.ts`: T2 (all five), then #303/#306 (T4 menu items, rebase), #325 and #326. #303 and #298 both define menu items: land #298 first or agree the item list.
- `task-details-tab.ts`: #289 (T1), #297 (T2), then T6 (#312, #313, #314), T8 dialog (#319, #320, #321), #326: strictly in that order.
- `task-workflow-tab.ts` and `task-step.ts`: T2 (#298 removes the Complete button), T3 (#301), T6 (#310, #311), #304: one agent, in that order.
- `task-action-dialogs.ts`: #304 then #305 (T4), #328.
- `shared/ui/detail-layout.ts`: **Clients #257 (open, WP4) removes the Project side panel and keeps `mf-detail-layout` for the Task page.** T5 (#307, #309) changes the narrow order and the aside cap: land after #257 or coordinate; #308 does not touch it.
- `shared/work-queue/drill.ts`: **Clients #281 (open)** and #324; `scoped-tasks.ts`: **Clients #264/#265 (open)** and #324. #324 goes after both.
- `shared/work-queue/work-strip.ts`: Clients #260 changes it; this epic does not use the component, only its tokens, so there is no conflict.
- `shared/ui/record-header.ts`, `record-state.ts`, `record-skeleton.ts`: additive changes only (#290, #292, #296); their specs and the three Clients pages are the regression tests. No open Clients issue edits them.
- `row-edit.ts`, `hold-note.ts`: shared with My Work, Pod Work and Task Queue (#303, #306, #301): regress their e2e. `entity-activity.ts`, `activity-drawer.ts` are shared with the Client, Matter and Project drawers (#293, #317, #318).
- Docs: `docs/ux/ux-spec.md` and `decisions-addendum.md` are also written by Clients #286 (section V); #330 uses the next letter (**W**) after it merges.
- Tests that select the old banners, the Workflow "Complete task" button, the panel pencil, "Jump to" or the status-menu second labels are updated by the package that changes the behaviour.

### Extension points (for the packages that follow)

- **Record state and skeleton (T1):** `RecordKind` gains `task`; the header (T2) changes only what is inside the skeleton boxes.
- **Header (T2):** the Task action set is data (`RecordAction`, permission-gated) so T3, T4 and T9 add items without header code; the facts strip is a Task-local component that other pages may reuse later.
- **Status note (T3):** one component fed by status, actor, time and reason; the work lists' `hold-note` is the text clamp.
- **Complete state (T4):** `completeState` computed (ready / blocked with n steps) is used by the header button, the dialog and the step focus.
- **Section nav (T5):** a small generic component (items with counts, scroll-spy) that the `section-state` helper feeds.

### Definition of done per package

Issues closed, tests green twice (including permission variants), axe clean at four sizes, no page-level horizontal scroll, screenshots in `fixes/<package>/`, bundle and style budgets kept, docs named in the issue noted for T10, the epic #288 tasklist ticked, and the line below added to the Status section.

### Docs package (T10, #330)

`ux-spec.md` S10 and the Create task section with UAT rows, section **W** of the decisions addendum (every Decision (PM) above), `tokens.css` (target: no new token), `docs/qa/e2e.md`, and a banner in the review README. Where the code differs from the issues, the docs follow the code and say so.

### Final verification package (T10, #331)

Contract e2e over TSK-123, 124, 126, 127, 128, 129 at four sizes (axe 0 including `target-size`, no horizontal scroll, Workflow-position and header limits for the 200-character task, no nested scroller, one Edit control, one primary action), the state matrix (loading, 404, 403, 5xx, offline Activity, reduced motion), regression subsets for every shared file touched, the before/after table of the review's measurements, bundle report, screenshots in `fixes/final/`, and a comment on #288 with the open items. It uses its own e2e stack and ports and never stops processes or containers of another agent's verification run.

## 4. Status

(One line per work package; keep other packages' lines when merging. Format: `Tn name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Planning (2026-10-18): epic #288 and issues #289 to #331 created and linked as sub-issues; PM requirements review comments posted on every issue and on the epic; no issue is blocked on the owner; SQL script 28 is free and none is planned.
- T1 Bugs and states: not started.
- T2 Header and facts strip: not started.
- T3 Status note: not started.
- T4 Menus and dialogs: not started.
- T5 Layout: not started.
- T6 Workflow head and Details: not started.
- T7 Comments, Assets, Activity: not started.
- T8 Edit dialog and Create task: not started.
- T9 Drill-in and keyboard: not started.
- T10 Permissions, docs, final verification: not started.
