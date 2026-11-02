# Consistent lists and shell polish, phase 1: progress (epic #1037)

Protocol: one section per agent below, append-only, newest entry last; `git pull --no-rebase origin matter-detail` before every push. Weight = hours / 27.5 (rounded to one decimal; the column sums to 100.0). Percent done is set by the agent at hand-back; total = sum of weight x percent.

| Issue | Code | Title | Hours | Weight % | Done % | Weighted % |
| --- | --- | --- | --- | --- | --- | --- |
| (this commit) | LC-00 | Epic, issues, plan, decision AR | 2.0 | 7.3 | 100 | 7.3 |
| #1038 | LC-01 | Shared list toolbar and title row | 6.0 | 21.8 | 0 | 0.0 |
| #1039 | LC-02 | Adopt the toolbar on eight lists | 7.0 | 25.5 | 0 | 0.0 |
| #1040 | LC-03 | Standard task and asset columns | 3.0 | 10.9 | 0 | 0.0 |
| #1041 | LC-04 | Matter Tasks cards on a phone | 2.0 | 7.3 | 0 | 0.0 |
| #1042 | LC-05 | Page size 50, Sorted by, First/Last | 1.5 | 5.5 | 0 | 0.0 |
| #1043 | LC-06 | Filters, + New Task, admin New buttons, Title Case | 1.0 | 3.6 | 0 | 0.0 |
| #1044 | SH-01 | Shell: radius and full-height navigation panel | 4.0 | 14.5 | 0 | 0.0 |
| #1045 | LC-07 | Verify Users Pods chip and Matter Projects New button | 1.0 | 3.6 | 0 | 0.0 |
| | | **Total** | **27.5** | **100.0** | | **7.3** |

## PM (LC-00)

- 2026-11-02 Epic #1037 and issues #1038 to #1045 created and linked as sub-issues; comment added on #1001; plan, this table and decision AR written on `matter-detail`.

## Agent E (lists)

- 2026-11-02 LC-01 (#1038) built: `mf-list-toolbar` (`shared/filters/list-toolbar.ts`: Search first, Filters (n), Other filters, `[mfView]`, `[mfColumns]`, `[mfMore]`, `[mfPrimary]`, chips with Clear filters, `[mfBarEnd]`, `[mfBulk]`, sheet), `mf-sorted-line` (`shared/ui/sorted-line.ts`: Sorted by X with Reset sort), `[count]` chip on `mf-page-header`, `FilterDef.search` (a text filter driven by the Search box), `ListFilters.badgeCount`. Documented in theme guide section 11.1.
- 2026-11-02 **Matter Tasks (LC-02) is on `matter-detail` (commit "WPx LC-02 Adopt the list toolbar on eight lists"): Agent F may start LC-04.** `shared/work-queue/scoped-tasks.ts` now renders `mf-list-toolbar` (Search tasks, Filters, View dropdown, Columns and Select, "+ New Task", Sorted by line, bulk bar in the toolbar) and the pager with 25/50/100 (default 50). The phone branch (`phone()`) still draws the same task table as before: LC-04 replaces it with cards. Please pull before editing that file; the toolbar block is the `<mf-list-toolbar>` element, the grid is `<mf-task-table>` below it.

- 2026-11-02 LC-02 (#1039), LC-05 (#1042), LC-03 (#1040), LC-06 (#1043) and LC-07 (#1045) are built and committed; see the hand-back report for the commit list, the checks run and the checks not run. Page size default is 50 in `list-query.ts` (every `ListQueryPage` list: Clients, Matters, Projects, Assets, Pods, Users, Workflows, Steps, ...), in `scoped-tasks.ts` and in Notifications. Audit Logs and Activities are untouched.

## Agent F (shell, phone cards)

(entries go here)

## Questions

(none)
