# My Work review: delivery plan

Owner approval: "I like your recommendations for My Work page. Create epic and issues for all recommendations and bug fixes" (2026-10-17). Product decisions are delegated to the PM and recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-17, base `origin/dev`. Source review: `README.md` in this folder (54 screenshots in `screenshots/`).

Structure on GitHub: one epic **#138** (labels `epic` + `phase-7`), 55 sub-issues #139 to #193 (label `phase-7`). One issue per review ID or bug. Folded IDs (named in the host issue title or body, nothing dropped): M2 in BUG-1 (#142); A1 and D5 in M1 (#153); D2, C3, C5 in M5 (#171); A7 in BUG-9 (#148); A8 in BUG-11 (#150); D3 in BUG-10 (#149); G1 in BUG-6 (#169); D6 in D4 (#188); cross-cutting 3 in M11 (#192); 5 in M7 (#160); 7 in M9 (#162); 8 in M4 (#183), BUG-7 (#146), BUG-8 (#147); 9 (tests) in every test plan; 10 (saved views) stays in column-filters Batch 5. "Verified good" items (A11, D7, C6, G5, G7, G8) need no work.

Not approved / NOT in scope: snooze or pin (M12.6), bulk actions (M12.7, decided against), notification bell or "since your last visit" panel (M12.5, #168 closed as not planned), saved views, the Dashboard's own lists, real screen reader and dark theme testing.

Issues blocked on an owner decision: **none**.

## 1. Issue list

Effort: S under a day, M one to three days, L more. "Needs" lists hard prerequisites.

| # | ID | Title (short) | Effort | Needs | WP |
|---|---|---|---|---|---|
| #139 | BUG-5 | Confirm dialog text wraps | S | - | WP1 |
| #140 | X4 | One popover/disclosure behaviour | M | - | WP1 |
| #141 | BUG-12 | Keyboard help lists `/` for work lists | S | - | WP1 |
| #169 | BUG-6 (+G1) | Columns panel: Esc, outside click, scroll cue, Reset | S | #140, #152 (Reset) | WP1 |
| #142 | BUG-1 (+M2) | `hasWork` from `/me`, landing on My Work | S | - | WP2 |
| #143 | BUG-2 | No stale rows under a new tab | S | - | WP3 |
| #145 | BUG-4 | Reset to default really resets | S | - | WP3 |
| #144 | BUG-3 | "New" markers survive drill-in (visit = 30 min gap) | S | - | WP3 |
| #170 | M6 | Restored-view notice names the view; tab restore rule | S | #145 | WP3 |
| #183 | M4 | Open first non-empty tab | S | #170 | WP3 |
| #146 | BUG-7 | Matter/Client/Project links need view permission | S | - | WP4 |
| #147 | BUG-8 | Empty copy by permission | S | - | WP4 |
| #149 | BUG-10 (+D3) | Fixed value text in tab-owned filter cells | S | - | WP4 |
| #150 | BUG-11 (+A8) | Status choices per tab | S | - | WP4 |
| #155 | G2 | Due presets (no Overdue preset) | S | - | WP4 |
| #157 | A9 | Near-empty line under last row | S | soft #147 | WP4 |
| #159 | B4 | Created by me empty + Create task | S | soft #186 | WP4 |
| #177 | G6 | One error message | S | #143 | WP4 |
| #151 | BUG-13 | One meaning of Due soon / Completed | S | Dashboard closed | WP5a |
| #171 | M5 (+D2, C3, C5) | Tab names: Due soon and overdue, Closed | S | #151 | WP5a |
| #154 | D1 | Due soon and overdue default sort | S | - | WP5a |
| #187 | C4 | "Show older" = all time state | S | #171 | WP5a |
| #188 | D4 (+D6) | Tab help into info button, empty copy | S | #171, #140 | WP5a |
| #161 | M8 | Title, caption, live region name the tab | S | #171 | WP5a |
| #152 | X1 | Per-page/per-tab column sets | M | - | WP6a |
| #156 | G3 | Sortable Title, Matter, Updated, Age | M | - | WP6a |
| #172 | C1 | Sortable Closed column | S | #152 | WP6a |
| #173 | B1 | Created by me columns | S | #152 | WP6b |
| #184 | C2 | Closed default columns, muted priority | S | #152, #172 | WP6b |
| #185 | B3 | Created by me: Age | S | #173, #156 | WP6b |
| #174 | A2 | Matter ref into subline, drop default Matter column | S | #152, soft #146 | WP6b |
| #175 | A3 | Progress as one text line | S | #152 | WP6b |
| #186 | B2 | Created by me defaults to Open | M | #173, #171, #150 | WP6b |
| #148 | BUG-9 (+A7) | Row leaves tab after inline Cancel/Complete, counts update | S | - | WP7 |
| #158 | A10 | Toast not over the pager | S | - | WP7 |
| #166 | M12.3 | Progress step opens task at the step | S | - | WP7 |
| #167 | A6 | Inline Complete shows step-input truth | S | soft #166 | WP7 |
| #153 | M1 (+A1, D5) | Needs-attention strip | M | - | WP8a |
| #178 | X2 | Pod Work uses the strip | S | #153 | WP8a |
| #179 | A5 | "New" in strip, filter, Ref dot | M | #144, #153 | WP8b |
| #189 | M3 | Fold at 1180, Due cap, shorter chrome | M | #174, #175, #152, #188 | WP9 |
| #191 | BUG-14 | 768 px: Status visible, hint | S | #189 | WP9 |
| #190 | M3-Compact | Real Compact density | S | #189 | WP9 |
| #176 | G4 | Skeleton rows, reserved counts | S | #143 | WP9 |
| #165 | M12.2 | Hold reason in the row | M | - | WP10 |
| #162 | M9 (+X7) | Colour language | S | Dashboard closed | WP10 |
| #182 | A4 | On Hold row treatment | S | #165, #162 | WP10 |
| #160 | M7 (+X5) | Drill-in context | M | - | WP11 |
| #163 | M10 | Open in Task Queue | S | - | WP11 |
| #180 | M12.1 | Group by due bucket | M | #153, #154 | WP12a |
| #181 | M12.4 | Keyboard: skip link, rows, `g m` | M | #141, #140 | WP12b |
| #164 | M11-Nav | Collapse nav rail below 640 px | M | - | WP13a |
| #192 | M11 (+X3) | Phone task cards below 640 px | L | #189, #190, #191, #164, #152, #156 | WP13b, WP13c |
| #168 | M12.5 | Since-last-visit panel: not built | S | - | closed, docs in WP14 |
| #193 | X6 | Microcopy and documentation sweep | M | all | WP14 |

## 2. Decisions (PM) in one place

- **(a) Since your last visit panel (#168):** not built (contradicts "no notification bell"; needs per-user change tracking, out of scope). Substitute: the "New" marker with a fixed visit boundary (#144) plus a "New n" strip item, filter and Ref dot (#179).
- **(b) Tab restore (#170):** restore the last view only when the last tab was Active or Due soon and overdue; Closed and Created by me are never restored (plain visit opens Active). M4 (#183) then opens the first non-empty tab (Active, Created by me, Closed) once per plain visit.
- **(c) Names (#171):** Completed becomes **Closed** (completed or cancelled); the time tab is **Due soon and overdue**. Tabs: Active, Due soon and overdue, Closed, Created by me. URL values unchanged.
- **BUG-13 (#151), one definition:** "Due soon" = open, explicit due date today to +2 days, not overdue, not ASAP (the Dashboard definition, unchanged). The My Work tab with overdue added is called "Due soon and overdue" = Overdue + Due soon. "Completed" = completed only (Dashboard); "Closed" = completed or cancelled (My Work). Screens that change: My Work tab names/help/tooltips; Dashboard Summary caption/tooltip wording only; docs. An integration test asserts the equalities.
- **Landing (#142):** `hasWork` = active Pod member or open assigned task; created-by-me alone does not count.
- **Strip (#153):** counts cover the whole open assigned set and ignore grid filters; click applies the filter on Active, toggles, replaces other strip filters; it is the My Work equivalent of Task Queue quick views (ordinary column filters and chips); default sort untouched.
- **New (#144, #179):** visit = more than 30 minutes without activity, client-side `localStorage`, no per-task seen list (the strip count must equal the grid); device-specific by design.
- **Due soon and overdue sort (#154):** overdue first, then due ascending, then priority. Active keeps the addendum G rule.
- **Due presets (#155):** Today, Tomorrow, Next 7 days, This week, Next week, This month; no Overdue preset.
- **Created by me (#186):** defaults to Open using the Task Queue bare-link rule; count follows.
- **Columns (#152, #174, #175):** per tab and page, versioned; customised sets kept; Matter column leaves the Active defaults (ref in subline); progress is "n of m done . step", no bar. Task Queue and Pod Work defaults unchanged.
- **Phone (#192, #164):** breakpoint 640 px; shared card renderer on all three work lists; nav rail collapses behind a Menu button.
- **Toasts (#158):** keep bottom-left (Dashboard precedent), offset above the pager.
- **Drill-in (#160):** whitelisted `from` parameter plus history state; Dashboard lists not changed.
- **Keyboard (#181):** WCAG 2.1.4 compliant: grid-focus-only row keys and an on/off switch.
- **Colour (#162):** stripe = overdue everywhere (Swimlane too), On Hold grey with pause icon, New status neutral so blue means ASAP.

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes and never hand-merge them, run unit + integration + e2e + axe (0 violations), attach 1366x768, 1920x1080, 768x1024 and 375x812 screenshots (`docs/ux/my-work-review/fixes/<wp>/`), keep the initial bundle at about 622 kB of 700 kB, update the docs named in the issue. SQL scripts: next free number is **28** (latest `27-dashboard-unassigned.sql`); no package is known to need one. If profiling asks for an index (#142 assignee/status, #156 sorts, #165 hold comment lookup, #172 closed date), the first PR to merge takes 28 and the others renumber at merge time. All packages start after the Dashboard epics close (#83 to #88).

| Rank | WP | Issues | Main files / areas | Days | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP1 Dialogs, popovers, shortcut registry | #139, #140, #141, #169 | `shared/ui/confirm-dialog.ts`, new dismissable directive, `column-chooser.ts`, `work-view-controls.*`, keyboard-help registry | 2 | WP2, WP3, WP13a | - (Reset in #169 needs #152 from WP6a: ship Reset with WP6a if not merged) | Frontend only |
| 2 | WP2 Landing | #142 | `MeController`/`MeDto`, `core/auth/guards.ts`, `me-api.ts`, e2e landing assumptions | 1 | everything | - | Additive `hasWork`; index script 28 only if profiling asks |
| 3 | WP3 Page state | #143, #145, #144, #170, #183 | `my-work-page.ts`, `queue-page.ts`, `work-list.ts`, `last-view.ts`, `last-visit.ts`, `work-tabs.ts` | 3 | WP1, WP2, WP13a | - | Frontend only |
| 4 | WP13a Nav rail | #164 | shell/app layout, header, nav, e2e at 375 for all screens | 1.5 | WP1, WP2, WP3 | - | Frontend only |
| 5 | WP5a Vocabulary and tab rules | #151, #171, #154, #187, #188, #161 | `TaskQueueService.MyWorkAsync` (sort, `closedWindow`), `work-tabs.ts`, `my-work-page.ts`, Dashboard Summary caption constants, docs | 2.5 | WP4, WP7, WP13a | WP3 (#170 for tab files); Dashboard closed | `closedWindow=all` additive; no SQL |
| 6 | WP4 Links, filters, copy | #146, #147, #149, #150, #155, #157, #159, #177 | `shared/filters/queue-defs.ts`, cell components, empty-state function, Task detail breadcrumb | 2.5 | WP5a, WP7 | #143 (WP3) for #177 | Frontend only |
| 7 | WP7 Inline row actions | #148, #158, #166, #167 | `inline-edit.ts`, `inline-status-flow.ts`, `row-edit.ts`, toast placement, task detail `step` param, row DTO `currentStepId` | 2.5 | WP4, WP5a, WP6a | WP1 (menus) soft | Additive `currentStepId`; completion-check read endpoint only if missing |
| 8 | WP6a Sorts, Closed column, column framework | #152, #156, #172 | `column-prefs.ts`, `task-table.ts` header sort, `TaskQueueService.cs` sort keys, row DTO `closedAtUtc` | 3 | WP4, WP7 | WP5a (same backend file: merge first) | `sort` keys, `closedAtUtc`; index script 28 only if profiling asks |
| 9 | WP6b Per-tab columns | #173, #184, #185, #174, #175, #186 | column default sets, cells (subline, progress, assignee), `MyWorkAsync` Created-by-me default | 3 | WP8a, WP11 | WP6a | Created-by-me default handled in `MyWorkAsync`; no SQL |
| 10 | WP8a Needs-attention strip | #153, #178 | new `mf-work-strip`, `my-work-page.ts`, `pod-work-page.ts`, `MyWorkAsync` counts, DTO `attention` | 3 | WP6b, WP11 | WP3, WP5a | Additive `attention` object |
| 11 | WP11 Drill-in and Task Queue link | #160, #163 | task links with `from`, task detail breadcrumb/nav highlight, focus restore, toolbar link | 2 | WP6b, WP8a | WP4 (#146 breadcrumb), WP3 | Frontend only |
| 12 | WP8b New | #179 | `last-visit.ts` exposure, `assignedFrom` filter in `MyWorkAsync`, chip, Ref dot | 1.5 | WP9, WP10 | WP8a, WP3 (#144) | `assignedFrom`, `attention.new` additive |
| 13 | WP9 Density and space | #189, #191, #190, #176 | `task-table.ts`, `task-table.scss`, `work-page.scss`, skeleton rows | 3 | WP8b, WP10, WP12a | WP6b, WP5a (#188), WP3 (#143) | Frontend only |
| 14 | WP10 Row detail and colours | #165, #162, #182 | row DTO `holdReason`, `TaskQueueService.cs`, status/priority badges, `swimlane-card.ts` | 3 | WP9, WP12a | #162 and #151: Dashboard closed; #165 backend after WP8b (same file); #182 after both | `holdReason` additive; script 28 only if profiling asks |
| 15 | WP12a Group by due bucket | #180 | `MyWorkAsync` bucket ordering and `bucketCounts`, group header rows in `task-table.ts` | 2.5 | WP10 | WP8a, WP5a (#154), WP9 (task-table) | `group`, `bucketCounts` additive |
| 16 | WP12b Keyboard | #181 | grid key handling, skip link, shortcut registry and help, per-user switch | 2 | WP13b | WP1, WP9 | Frontend only |
| 17 | WP13b Phone cards: renderer + My Work | #192 (part 1) | `task-table.ts` card mode, card spec for My Work, chips as inline controls | 3 | WP12b | WP9, WP13a, WP6a | Frontend only |
| 18 | WP13c Phone cards: other lists and chrome | #192 (part 2) | card specs for Task Queue and Pod Work, tab strip with fades, strip 2x2, Filters sheet with sort select | 2.5 | - | WP13b, WP8a | Frontend only |
| 19 | WP14 Docs and final verification | #193, docs of #168 | ux-spec S02/S03/S04, UAT, column-filters README, addendum T, `fixes/final/` | 2 | - | everything | none |

Total about 46 developer days; with four agents in parallel roughly five to six calendar weeks.

### Parallelism at a glance

- **Wave 1 (start together):** WP1, WP2, WP3, WP13a. Different files; WP7 may also start (menus soft-wait on WP1).
- **Wave 2:** WP5a (after WP3), WP4 (after #143), WP7, then WP6a (after WP5a merges its backend part).
- **Wave 3:** WP6b, WP8a, WP11.
- **Wave 4:** WP8b, WP9, WP10, WP12a.
- **Wave 5:** WP12b, WP13b, then WP13c.
- **Wave 6:** WP14.

### Hot spots (merge-conflict watch)

- `TaskQueueService.cs` (`MyWorkAsync`) and the row/response DTOs: WP5a, WP6a, WP6b, WP8a, WP8b, WP10, WP12a. Give them to one backend-minded agent per wave, in the rank order above; additive changes only, separate methods; regenerate OpenAPI/client after each rebase.
- `task-table.ts` / `.scss`: WP6a, WP6b, WP9, WP12a, WP12b, WP13b, WP13c. Merge in rank order; one agent should own WP9 + WP13b.
- `my-work-page.ts`, `queue-page.ts`, `work-list.ts`: WP3, WP4, WP5a, WP8a, WP11. Keep changes inside the components named in each issue.
- `queue-defs.ts`: WP4, WP5a (tab text), WP6b.
- `swimlane-card.ts` and Dashboard Summary caption constants: #162 and #151 only, after the Dashboard epics close.
- `contracts/openapi/v1.json` and the generated TS client conflict on every API change: regenerate, never hand-merge.

### Definition of done per package

Issues closed, tests green twice, axe clean, four screenshots per changed screen, bundle budget, docs updated, counts check (tab count equals grid total and Task Queue), the epic #138 tasklist ticked.

## 4. Status

(One line per work package; keep other packages' lines when merging.)

- Planning: epic #138 and issues #139 to #193 created; PM requirements review comments posted on every issue; #168 closed as not planned.
- WP3 Page state (2026-10-17, commit e6690d4): #143 done, #145 done, #144 done, #170 done, #183 done. Unit specs, e2e (`my-work-page-state.spec.ts`, axe at 1366/1920/768/375), lint, prettier and tsc green; initial bundle 622.87 kB. Screenshots in `fixes/wp3/`. The 30 minute visit gap and the first-non-empty-tab rule are verified by unit tests with fixed clocks; the restored-view notice names the tab with the current labels (Due soon, Completed) until #171 renames them.
- WP2 Landing (2026-10-17, commit 0437ee5): #142 done. `/me` returns `hasWork` (active Pod member or an open assigned task; created-by-me alone does not count) via the new `IUserWorkSource` contract; OpenAPI and client regenerated; 8 integration tests, unit specs and `landing.spec.ts` (real API, axe at 1366/1920/768/375) green. Landing changes for everyone with a Pod or an open assigned task: announce in the release note. Screenshots in `fixes/wp2/`. No SQL script (IX_Task_AssignedUser already covers AssignedUserId, StatusCode); the 50 ms at 5,000 tasks target was not measured.
