# Pod Work UX review: delivery plan

Owner approval: "I like all of your recommendations, so please don't wait for me. create epics / issues and continue working" (2026-10-20), with product decisions delegated to the PM ("you can make decisions for me"). Decisions are recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-20, base `origin/dev`. Source review: `README.md` in this folder (14 findings W1 to W14, 7 bugs BUG-1 to BUG-7, 7 work packages, screenshots in `screenshots/`, mocks in `mocks/`).

**Binding owner decisions.** (1) No new or changed keyboard shortcuts in this phase; existing shortcuts stay; shortcuts are the Phase 2 backlog #420. (2) Pod Work stays its own page for now; a later merge into the Task Queue is tracked in #351. Only the page-specific parts change (header, pod scope, By member workload presentation, strip, empty states, phone layout, permission handling); the shared work grid and cards are reused unchanged. Members are never ranked (alphabetical stays).

Structure on GitHub: one epic **#546** (labels `epic` + `phase-15`), 27 sub-issues **#547 to #577** (label `phase-15`; the numbers are in creation order and are not contiguous, other epics were created in parallel: #547, #548, #549, #550, #551, #552, #553, #555, #556, #557, #558, #559, #560, #561, #562, #563, #565, #566, #568, #569, #570, #571, #572, #573, #574, #576, #577). Folded IDs (named in the host issue title, nothing dropped): W4 in #548; W14 in #550; W7 with BUG-6 in #555; W12 in #566; W6 with BUG-7 and W1(e) in #562; W1 is split in #565 (API), #566 (table), #568 (sort), #569 (cards); W3 is split in #556 (API), #558 (pod list), #559 (no pods hint); W2 in #548 (cap), #556 (API) and #557 (context line and title); W11 in #563. "What works" items of the review (grid, URL, remembered pod, Assign to me grace, read-only rendering, drill-in and Back) are regression tests only.

Issues blocked on an owner decision: **none**. The five product questions the review put to the owner (section 9) are decided by the PM: (1) the strip vocabulary is **Overdue, Due today, ASAP, On hold** on both pages; (2) By member default order is **alphabetical** (members with work first, sortable by the viewer, never load-first); (3) the By member tab count is **people with open work**; (4) the cross-pod picker rule is **investigated, recorded and tested, the shared picker is not changed** (#572); (5) people with no pod get **a pod list with counts**, no default pod and no "All pods" aggregate.

Effort is in **AI-agent hours** (wall-clock of one developer agent, including unit, integration, e2e, axe and screenshots). The review estimated 39 hours; the plan is **54** because the three backend items are separate issues (6.5 h), the fixtures, the keyboard audit, the permission matrix and the docs are explicit issues (about 8.5 h), and the By member table is split into API, table, sort and cards (11.5 h against 10). The first release is **10 hours**.

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package |
|---|---|---|---|---|---|
| #547 | fixtures | Test fixtures for every review case (empty pod, long-name pod, multi-pod, no-pod, Pod.View without Task.View) | 1.5 | None. Land first. | WP-PW1 (R1) |
| #548 | BUG-1, W4 | Title never wraps, pod select capped, title row aligned | 2 | #547; page-header contract of the App shell epic #585 (use if landed) | WP-PW1 (R1) |
| #549 | BUG-2 | Pod.View without Task.View: item hidden, 403 page, no requests, no toasts | 2 | #547 | WP-PW1 (R1) |
| #550 | W9, W14 | Assign to me visible from 640 to 899 px on the Unassigned tab | 2.5 | #547, #548 (same file) | WP-PW1 (R1) |
| #551 | BUG-4 | No page-level horizontal scroll at 375 on any tab | 1 | #548 | WP-PW1 (R1) |
| #552 | BUG-3 | Strip follows assignments | 1 | #547 | WP-PW1 (R1) |
| #553 | BUG-5 | Skip link on By member lands on the first member row | 1 | the App shell epic #585 skip-link fix (coordinate) | WP-PW4 |
| #555 | BUG-6, W7 | Empty pod shows one message with an Add members action | 1 | #547; Users epic link target | WP-PW4 |
| #556 | W3, W2 (API) | Pod choices carry memberCount, openCount, unassignedCount, overdueCount | 2 | None. Backend. | WP-PW2 |
| #557 | W2 | Context line under the title and the pod in the document title | 2.5 | #548, #556; the App shell epic #585 header contract | WP-PW2 |
| #558 | W3 | With no pod chosen: pods as a list with counts | 3 | #556 | WP-PW2 |
| #559 | W3 | Honest "There are no pods yet." copy | 1 | #558 | WP-PW2 |
| #560 | W5 (API) | Pod Work summary carries dueToday and asap | 2 | Serial with #556, #565. Backend. | WP-PW3 |
| #561 | W5 | Strip: Overdue, Due today, ASAP, On hold; every item a link | 3.5 | #560, #552 | WP-PW3 |
| #562 | W6, BUG-7, W1(e) | Tabs: Unassigned, By member (people), All open | 2 | #561, #565 | WP-PW3 |
| #563 | W11 | Phone: strip is one scrolling chip row | 1 | #561 | WP-PW3 |
| #565 | W1 (API) | Member loads carry availability, unassigned and membersWithWork | 2.5 | Serial with #556, #560. Backend. | WP-PW4 |
| #566 | W1, W12 | Workload table: people with work first, idle folded, availability, neutral bar, Unassigned row | 5 | #565, #553, #555 | WP-PW4 |
| #568 | W1 | Sortable headers (viewer decides) | 1.5 | #566 | WP-PW4 |
| #569 | W1 | Member cards below 640 px | 2.5 | #566, #551 | WP-PW4 |
| #570 | W10 | Phone first screen about 150 px, third tab reachable | 1.5 | #548, #557, #562, #563; the App shell epic #585 phone header | WP-PW5 |
| #571 | W8 | Short Undo toast in the shared toast style | 1.5 | the App shell epic #585 toast system | WP-PW6 |
| #572 | W13 | Cross-pod assignment rule confirmed, recorded and tested | 1.5 | #547 | WP-PW6 |
| #573 | keyboard | Keyboard-only walk and axe audit with Tab-stop evidence | 1.5 | #558, #561, #562, #566, #568 | WP-PW7 |
| #574 | permissions | Permission matrix: no dead links, toasts or 403 requests | 1.5 | #549, #555, #558, #559, #561, #566 | WP-PW7 |
| #576 | docs | ux-spec S04, UAT rows, decisions section AD, e2e catalogue | 2.5 | All code issues | WP-PW8 |
| #577 | verification | Final verification pass | 3.5 | All issues | WP-PW8 |

Total: **54 agent-hours** (27 issues). R1 = first release. Review ID to issue: BUG-1 #548, BUG-2 #549, BUG-3 #552, BUG-4 #551, BUG-5 #553, BUG-6 #555, BUG-7 #562; W1 #565 to #569, W2 #548 #556 #557, W3 #556 #558 #559, W4 #548, W5 #560 #561, W6 #562, W7 #555, W8 #571, W9 #550, W10 #570, W11 #563, W12 #566, W13 #572, W14 #550.

## 2. Decisions (PM) in one place

- **Page scope.** Pod Work stays its own page. Every change is page-specific; the shared grid, columns, cards and assignee picker are reused unchanged. Where the page configures the grid (default columns on the Unassigned tab, #550) it does so through the existing configuration, not through new grid rules. The only touch of a shared file is the string of the Undo toast (#571) and additive inputs recorded in the PR.
- **Header and scope (WP-PW1, WP-PW2).** Native select kept, capped at 22rem with ellipsis and tooltip; the title never wraps and wins the width; one muted context line ("Demo Processing Pod . 23 members . you are a member (primary)"); document title `Pod Work: <pod>: <tab>`. The header uses the page-header contract of the App shell epic (the App shell epic #585); Pod Work adds no header of its own.
- **No pod chosen.** A list of pods (Your pods / Other pods, alphabetical) with member and unassigned counts; no default pod, no "All pods" aggregate (that would need a cross-pod API and belongs to the landing decision of the App shell epic #585 for oversight roles and to #351). The old "You aren't in a pod yet" copy is replaced by "There are no pods yet." (with "Create a pod" for `Pod.Manage`).
- **Strip and tabs (WP-PW3).** Strip = Overdue, Due today, ASAP, On hold (My Work's vocabulary), every item a link that filters All open and toggles off; counts are the pod's, independent of grid filters. Tabs: Unassigned (n) | By member (people with work) | All open (n). The Overdue and on hold tab is retired because the strip opens exactly that view; `view=attention` bookmarks redirect to All open with the Overdue and On hold filters (Overdue only if the grid cannot combine them). BUG-7 disappears with this.
- **By member (WP-PW4).** A workload table: first "Not assigned to a person", then members with open work (alphabetical), one folded row "Show 16 members with no open work"; columns Member (name and availability chip), Open (number plus neutral bar scaled to the largest load), Overdue, On hold, always visible View tasks (`aria-pressed`); no nested scroll box; sortable headers chosen by the viewer, never a default load-first order; cards below 640 px. No colours carry meaning, no rank, no score (UX principle 12).
- **Permissions.** Pod Work needs `Pod.View` and `Task.View`; without `Task.View` the nav item is hidden and the URL shows the 403 page with no request and no toast. Links "Add members" (`Pod.ManageMembers`) and "Create a pod" (`Pod.Manage`) are hidden, never disabled.
- **Tablet and phone.** Below 900 px the Unassigned tab's default columns put Assignee after Title and drop Matter Number; from 640 to 899 px the Assignee cell shows the link only. Phone: one chip row for the strip, capped select under the title, tabs reachable; header about 150 px.
- **Assign flow.** Undo toast "Assigned to you. Moved to In Progress. [Undo]" in the shared toast style, the long sentence as tooltip (#571); the picker keeps listing the pod's members; the cross-pod rule of UAT-S04-4 is investigated, recorded and tested (#572); overdue and on-hold counts in the picker are not added (shared component).
- **Additive API (all backend, no SQL planned).** #556: `PodChoice.memberCount/openCount/unassignedCount/overdueCount`; #560: `PodWorkSummary.dueToday/asap`; #565: `PodMemberLoad.availability`, page-level `unassigned`, `counts.membersWithWork`. None of BUG-1 to BUG-7 needs an API change.
- **Keyboard.** No new or changed shortcuts; the audit (#573) covers the new controls with the existing keys only.
- **Out of scope.** Merging into the Task Queue (#351), an All pods view, a default load-first order, people scoring, shortcuts (#420), grid or picker changes, the shell's header, toast system, skip link, offline banner, landing and phone header (the App shell epic #585), the admin Pods page (Users epic), real screen-reader tests, 200/400 percent zoom, forced colours.

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes and never hand-merge them, run unit + integration + e2e + axe (0 violations at 1366, 1920, 768 and 375, with menus and dialogs open) and assert no page-level horizontal scroll, attach screenshots in `docs/ux/pod-work-review/fixes/<package>/` (`pw1-bugs` ... `pw7-access`, `final`), keep the initial bundle at its current size, do not add rules to the shared grid styles, add no keyboard shortcut. Shared files (`work-strip.ts`, `narrow-columns.ts`, `empty-copy.ts`, `page-header.ts`, `nav-items.ts`, the inline assign flow) serve other pages: their specs are regression tests and changes are additive. **SQL scripts:** the next free number is **28** (latest `27-dashboard-unassigned.sql`); **none planned**; if a count query needs an index it is script 28 and is recorded on the issue (#556 is the likely one); other epics may also need 28, so check `db/scripts` before taking it. **Backend work:** #556 (2 h), #560 (2 h), #565 (2.5 h): `TaskQueueService.cs`, `TaskQueueDtos.cs`, `contracts/openapi/v1.json`, TS client; merge order #556, #560, #565, regenerating the client after each rebase.

| Rank | WP | Issues | Main files / areas | Agent-h | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP-PW1 Bugs and fixtures | #547, #548, #549, #550, #551, #552 | `pod-work-page.ts` (header, column defaults, strip merge), `pod-work.routes.ts`, `nav-items.ts`, e2e support | 10 | WP-PW4 backend, #553, #555, #572 | none | Frontend only |
| 2 | WP-PW2 Pod scope | #556, #557, #558, #559 | `pod-work-page.ts` header and no-pod block, new `pod-picker-list.ts`, `TaskQueueService.cs` | 8.5 | WP-PW3, WP-PW4 | #548; #556 before #557/#558 | **#556 backend** (additive) |
| 3 | WP-PW3 Strip and tabs | #560, #561, #562, #563 | new `pod-work-strip.ts`, tab list in `pod-work-page.ts`, `work-strip.ts` (use) | 8.5 | WP-PW2, WP-PW4 | #552; #565 before #562 | **#560 backend** (additive) |
| 4 | WP-PW4 By member | #553, #555, #565, #566, #568, #569 | new `pod-member-table.ts`, `empty-copy.ts`, `TaskQueueService.cs` | 13.5 | WP-PW2, WP-PW3 | #565 before #566 | **#565 backend** (additive) |
| 5 | WP-PW5 Tablet and phone | #570 | `pod-work-page.ts` styles | 1.5 | none (late) | #557, #562, #563 | none |
| 6 | WP-PW6 Assign flow | #571, #572 | assign toast string, tests | 3 | all | #571 waits for the shell toast system | none |
| 7 | WP-PW7 Access and keyboard | #573, #574 | e2e specs, small fixes | 3 | none (late) | all UI issues | none |
| 8 | WP-PW8 Docs and final verification | #576, #577 | `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `docs/qa/e2e.md`, `docs/architecture.md`, e2e | 6 | none | all | none |

Total: about **54 agent-hours**.

### First release (do these first, about 10 hours)

The defects that hurt today: #548 the title break at 768 px (2 h), #550 Assign to me clipped at 640 to 899 px (2.5 h), #549 Pod.View without Task.View (2 h), plus #551 the 375 px overflow (1 h), #552 the stale strip (1 h) and the fixtures #547 (1.5 h) they all need. Lane A runs #548, #549, #550, #551, #552 in that order (8.5 h, one file); lane C lands #547 in the first hour. Wall-clock of the release is about 9 hours.

### Waves for 3 parallel developer agents

Lanes are file owners, not people: one agent owns one lane's files for the whole epic, which removes merge conflicts. Lane A owns the page shell (`pod-work-page.ts` header, columns, no-pod block, styles, nav, toast string) and the docs; lane B owns the By member block and its new component, then the audits; lane C owns the backend items, the strip and the tab list.

- **Wave 1 (first release plus the backend)**
  - Lane A (8.5 h): #548, #549, #550, #551, #552
  - Lane B (3.5 h): #553, #555, #572
  - Lane C (8 h): #547, #565, #556, #560
- **Wave 2**
  - Lane A (6.5 h): #557, #558, #559
  - Lane B (9 h): #566, #568, #569
  - Lane C (6.5 h): #561, #562, #563
- **Wave 3**
  - Lane A (5.5 h): #570, #571, #576
  - Lane B (3 h): #573, #574
- **Wave 4 (verification)**
  - Lane A (3.5 h): #577

Lane totals: A 24 h, B 15.5 h, C 14.5 h (54 in all). With three agents the wall-clock is about **25 hours**; one agent alone needs 54. With two agents (fold lane C into B) about 32 hours.

Dependency rules between lanes: #547 lands in the first hour (every e2e imports it); lane C's order inside wave 1 is #547, #565, #556, #560 so that lane B's #566 and lane A's #558 find their APIs merged; #557 and #558 need #556; #562 needs #561 and #565; #570 needs #562 and #563; #571 needs the shell toast system; #573, #574 wait for all UI issues.

### Exact first wave

1. Lane C: #547 (fixtures, first hour), then #565, #556, #560 (backend, serial for the OpenAPI file). 2. Lane A: #548, #549, #550, #551, #552 (the first release). 3. Lane B: #553, #555, #572.

### Critical path

Lane A: #548 2, #549 2, #550 2.5, #551 1, #552 1, #557 2.5, #558 3, #559 1, #570 1.5, #571 1.5, #576 2.5, #577 3.5 = 24 hours. Lane B (15.5 h) and lane C (14.5 h) have about 9 to 10 hours of slack. The shell epic (the App shell epic #585) can stall #557 (header contract), #570 (phone header) and #571 (toast system); each has a local fallback recorded in its issue, so none blocks the lane.

### Hot spots (merge-conflict watch)

- **`frontend/src/app/features/pod-work/pages/pod-work-page.ts`** (437 lines, one file): lane A owns it through wave 1 (#548 to #552); lane B edits only the member block (#553, #555) and then moves it into the new `pod-member-table.ts` (#566); lane C removes the inline strip (#561, new `pod-work-strip.ts`) and edits the tab list (#562) in wave 2 while lane A edits the header and no-pod block (#557 to #559): rebase before every push, keep each diff to its block. Extracting `pod-picker-list.ts`, `pod-work-strip.ts` and `pod-member-table.ts` as new components is what keeps these edits apart.
- **`TaskQueueService.cs`, `TaskQueueDtos.cs`, `contracts/openapi/v1.json`, TS client**: #556, #560, #565 in this order; other epics also regenerate OpenAPI: rebase and regenerate, never hand-merge.
- **`shared/layout/nav-items.ts`**: #549 changes one line; the Admin, Users, Search and App shell epics also edit this file.
- **`shared/work-queue/work-strip.ts`, `narrow-columns.ts`, `empty-copy.ts`, the inline assign flow**: shared with My Work and Task Queue; additive changes only (#561, #550, #555, #571).
- **Tests**: older e2e (`wp9-fixed-layout`, `wp13-narrow-rule`, `wp19-compact`, `task-permissions-t10`, `column-filters-work-lists-screens`, `fixed-header-screens`, `nav-phone`) select Pod Work text, the old strip and tab names; the package that changes the behaviour updates them.

### Extension points (for the packages that follow)

- **Pod picker list (WP-PW2):** `pod-picker-list.ts` is reusable for any "choose a pod" surface.
- **Strip (WP-PW3):** `pod-work-strip.ts` is the one place the pod's attention counts live; items are data.
- **Workload table (WP-PW4):** `pod-member-table.ts` takes member loads as data, so a later move into the Task Queue (#351) can reuse it.

### Definition of done per package

Issues closed, tests green twice (including permission variants), axe clean at four sizes with overlays open, no page-level horizontal scroll, screenshots in `fixes/<package>/`, bundle and style budgets kept, API changes additive with regenerated OpenAPI and client, the docs named in the issue noted for WP-PW8, the epic #546 tasklist ticked, and the line below added to the Status section.

### Docs package (WP-PW8, #576)

`ux-spec.md` S04 rewritten to the code (header, context line, pod list, strip, tabs, workload table, phone cards, permission rule, toast, copy deck), UAT-S04-4/-6/-9, section **AD** of the decisions addendum (every Decision (PM) above; the last section on dev when this plan was written is X and other epics are reserving letters, so AD is taken first and renamed in the plan if it is taken), `docs/qa/e2e.md`, `architecture.md` for the additive fields, a banner in the review README. Where the code differs from the issues, the docs follow the code and say so.

### Final verification package (WP-PW8, #577)

Contract e2e over the fixtures at four sizes (axe 0 including `target-size`, no sideways scroll, no 403 requests or permission toasts, no nested scroller on By member, Assign to me in view at 768), the state matrix (loading, empty pod, no pod, no pods, error, offline, reduced motion), the permission matrix, regression subsets for every shared file touched (My Work, Task Queue, work strip, nav, page header), the before/after table of the review's measurements, bundle report, screenshots in `fixes/final/`, and a comment on the epic with the open items. It uses its own e2e stack and ports and never stops processes or containers of another agent's verification run.

## 4. Status

(One line per work package; keep other packages' lines when merging. Format: `WP name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Owner decision (2026-10-20): no new or changed keyboard shortcuts in this phase (Phase 2 backlog #420); Pod Work stays its own page (#351 tracks the later merge decision).
- Planning (2026-10-20): epic #546 and issues #547 to #577 created and linked as sub-issues; PM requirements review comments posted on every issue; no issue is blocked on the owner; SQL script 28 is free and none is planned; App shell epic: the App shell epic #585.
- WP-PW1 Bugs and fixtures: not started.
- WP-PW2 Pod scope: not started.
- WP-PW3 Strip and tabs: not started.
- WP-PW4 By member: not started.
- WP-PW5 Tablet and phone: not started.
- WP-PW6 Assign flow: not started.
- WP-PW7 Access and keyboard: not started.
- WP-PW8 Docs and final verification: not started.
