# Consistent lists and shell polish, phase 1: progress (epic #1037)

Protocol: one section per agent below, append-only, newest entry last; `git pull --no-rebase origin matter-detail` before every push. Weight = hours / 27.5 (rounded to one decimal; the column sums to 100.0). Percent done is set by the agent at hand-back; total = sum of weight x percent.

| Issue | Code | Title | Hours | Weight % | Done % | Weighted % |
| --- | --- | --- | --- | --- | --- | --- |
| (this commit) | LC-00 | Epic, issues, plan, decision AR | 2.0 | 7.3 | 100 | 7.3 |
| #1038 | LC-01 | Shared list toolbar and title row | 6.0 | 21.8 | 100 | 21.8 |
| #1039 | LC-02 | Adopt the toolbar on eight lists | 7.0 | 25.5 | 100 | 25.5 |
| #1040 | LC-03 | Standard task and asset columns | 3.0 | 10.9 | 100 | 10.9 |
| #1041 | LC-04 | Matter Tasks cards on a phone | 2.0 | 7.3 | 100 | 7.3 |
| #1042 | LC-05 | Page size 50, Sorted by, First/Last | 1.5 | 5.5 | 100 | 5.5 |
| #1043 | LC-06 | Filters, + New Task, admin New buttons, Title Case | 1.0 | 3.6 | 100 | 3.6 |
| #1044 | SH-01 | Shell: radius and full-height navigation panel | 4.0 | 14.5 | 100 | 14.5 |
| #1045 | LC-07 | Verify Users Pods chip and Matter Projects New button | 1.0 | 3.6 | 100 | 3.6 |
| | | **Total** | **27.5** | **100.0** | | **100.0** |

## PM (LC-00)

- 2026-11-02 Epic #1037 and issues #1038 to #1045 created and linked as sub-issues; comment added on #1001; plan, this table and decision AR written on `matter-detail`.

## Agent E (lists)

- 2026-11-02 LC-01 (#1038) built: `mf-list-toolbar` (`shared/filters/list-toolbar.ts`: Search first, Filters (n), Other filters, `[mfView]`, `[mfColumns]`, `[mfMore]`, `[mfPrimary]`, chips with Clear filters, `[mfBarEnd]`, `[mfBulk]`, sheet), `mf-sorted-line` (`shared/ui/sorted-line.ts`: Sorted by X with Reset sort), `[count]` chip on `mf-page-header`, `FilterDef.search` (a text filter driven by the Search box), `ListFilters.badgeCount`. Documented in theme guide section 11.1.
- 2026-11-02 **Matter Tasks (LC-02) is on `matter-detail` (commit "WPx LC-02 Adopt the list toolbar on eight lists"): Agent F may start LC-04.** `shared/work-queue/scoped-tasks.ts` now renders `mf-list-toolbar` (Search tasks, Filters, View dropdown, Columns and Select, "+ New Task", Sorted by line, bulk bar in the toolbar) and the pager with 25/50/100 (default 50). The phone branch (`phone()`) still draws the same task table as before: LC-04 replaces it with cards. Please pull before editing that file; the toolbar block is the `<mf-list-toolbar>` element, the grid is `<mf-task-table>` below it.

- 2026-11-02 LC-02 (#1039), LC-05 (#1042), LC-03 (#1040), LC-06 (#1043) and LC-07 (#1045) are built and committed; see the hand-back report for the commit list, the checks run and the checks not run. Page size default is 50 in `list-query.ts` (every `ListQueryPage` list: Clients, Matters, Projects, Assets, Pods, Users, Workflows, Steps, ...), in `scoped-tasks.ts` and in Notifications. Audit Logs and Activities are untouched.
- 2026-11-02 Agent E hand-back: LC-01, LC-02, LC-03, LC-05, LC-06, LC-07 done. Checks: unit specs of the touched areas (290 files, 3121 tests, all green), ESLint, Prettier, tsc app, spec and e2e, theme colour and contrast scripts, `ng build` (initial 659 kB), targeted e2e against a local stack (about 540 test runs in seven batches, the last four batches green; open items: Matters filter-row specs in `column-filters-records.spec.ts` and Agent-F or Matter-detail areas, see the report). Not run: the full Playwright suite, the .NET integration tests, axe at 1920 and 768 on every one of the eight pages (axe runs inside the targeted specs only). Open questions for the owner are in the hand-back report.

## Agent F (shell, phone cards)

- 2026-11-02 SH-01 (#1044) done: navy panel runs full height with the logo and name at its top (from 640 px; rail at 640 to 1099 px shows the mark), top bar to its right with the search aligned to the page content, 6 px selection corners with 8 px side margins (token `--mf-nav-item-radius`), white-on-navy `logo-light.svg` for the built-in mark, uploaded logos on a light tile, phone unchanged (logo in the white top bar, drawer). Also fixed a 4 px overshoot of the version line in the rail. New e2e `sh-full-height-panel.spec.ts` and a tile test in `app-settings.spec.ts`; `sh-nav-version` updated to the 6 px radius. Screenshots in `docs/ux/grid-consistency/shots/`. Theme guide 7.6 and `docs/ux/app-settings` updated.
- 2026-11-02 LC-04 (#1041) done: the Matter Tasks tab (and a Project's task list) is cards under 640 px using the existing `mf-task-card-list` through `mf-task-table [phoneCards]`; the card leaves out the Client and Matter line in a matter's own list (`hideContext`) and shows "Progress: n of m steps" with a thin bar; the whole card opens the task (existing stretched title link). The Sort select is `mf-phone-sort` in the Filters sheet (Priority, Due date, Created, Ref, Status, Title, Assignee); Select (bulk) moved from the Columns slot to the More slot so it stays on a phone, where Columns is hidden. E2E `lc04-matter-task-cards.spec.ts`; `pm4-bulk-tasks` "at most 100" follows the page size 50.
- 2026-11-02 MM-20 (#1053) done (`features/my-matters` only; no shared grid or toolbar file touched): the two dropdowns are gone, the Client and Matters tree (renamed) is open by default and stays open after a pick, the scope is a removable chip beside the title (`scope-chip.ts`), under 1100 px one Scope button opens the tree (a bottom sheet on a phone). The title row and the button row are one row (about 50 px more content). The tree's "pin" button no longer changes anything (the tree no longer collapses after a pick); left in place, tell me if it should go. E2E: new `mm20-scope-chip.spec.ts`; `mm-ui-update`, `mm-qa`, `pm5-access` follow the tree. `mm-qa` "New calendar item" lookup made case-insensitive (Title Case from LC-06).

## Questions

(none)
