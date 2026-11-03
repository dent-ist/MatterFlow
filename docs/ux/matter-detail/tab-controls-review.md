# Matter detail: tab controls review (LC-08, issue #1051, epic #1037)

Date: 2026-11-02. Scope: the seven tabs of a Matter (Summary, Tasks, Projects, Assets, Productions, Notes, Activities), their tab strip and the controls above each grid. Pictures are small crops of the strip and the control row at 1366x768 (`tab-controls/before-*.png` and `after-*.png`; the "before" pictures come from the start of the review on another demo matter, so the rows differ, the controls do not). The rule that came out of this review is theme guide section 11.2.

## 1. The tab strip

All seven tabs already use the one shared `mf-tabs` (icon, label, count in brackets where the viewer may see it, 2 px primary underline, roving tab stop, sideways scroll with edge cues on a phone). Nothing to fix; the guard is that a tab never draws its own strip (Productions and Notes use the shared segmented control for their sub-views, not tabs). Counts show for Tasks, Projects, Assets, Productions and Notes; Summary and Activities have none by design.

## 2. Matrix: what each tab had before, and what it has now

| Control | Tasks | Projects | Assets | Productions | Notes | Activities | Summary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Search, before | Search tasks (toolbar) | none | none (a "Name" box in the filter row) | Search, last in the row, label just "Search" | own card, full width, "Search title and text" | none | n/a |
| Search, after | unchanged, first | Search projects, first | Search assets, first (the Name filter) | Search productions / Search specs, first | unchanged text; compact box, same height class | none (nothing to search) | n/a |
| Filters / view, before | Filters, View dropdown | none | Filters toggle alone at the right | segmented Productions / Specs, Direction dropdown | segmented By tag / Latest / Templates, View options | Kind dropdown inside the frame head with an H2 | n/a |
| Filters / view, after | unchanged | none (no filters to offer) | Filters (n) after Search; column filters in the row | segmented and Direction after Search | unchanged (Agent D's layout) | Kind dropdown in a row above the frame; the H2 is screen-reader only | n/a |
| Primary action, before | + New Task (right end) | New Project alone, right | only in the empty state | + New Production (right end) | + New Note with a split menu | none | Edit in the Details card |
| Primary action, after | unchanged | in the control row, right end | + New Asset in the control row, right end (also in the header New menu and the empty state) | unchanged | unchanged | none | unchanged |
| Sorted by line | row 3 (always, stable) | no sorting | row 2, before the primary action | no sorting | no sorting | newest first (fixed) | n/a |
| Columns menu | yes | no | no (phase 2) | no | no | no | n/a |

## 3. Differences found, and how they were fixed

| # | Difference | Fix |
| --- | --- | --- |
| 1 | Projects had no Search and its only control floated right, alone in a row | `mf-list-toolbar` with Search projects (filters the loaded projects by name) and the primary New Project at the right end |
| 2 | Assets showed a lone Filters button; the name filter hid in the filter row; Sorted by was missing | `mf-list-toolbar`: Search assets first (it is the Name filter, same `name` address parameter), Filters (n), the Sorted by line and + New Asset |
| 3 | Productions put Search last and labelled it just "Search" | Search first, "Search productions" or "Search specs", compact box like the others |
| 4 | Activities had its title and Kind dropdown inside the frame head, a different anatomy from every other tab | the Kind dropdown moves to a control row above the frame, the title stays as a screen-reader heading |
| 5 | Matter Tasks row 2 wrapped unpredictably when the Sorted by sentence did not fit | `[sortedBelow]`: row 3 always holds the Sorted by line on Tasks (and on the Task Queue, My Work and Pod Work, whose row 2 is full of quick views and tabs) |
| 6 | Notes has its own card with a full-width search, a split New Note and a second row of segmented control and View options | owned by Agent D: only the Search box was made compact (`[compact]="true"` in `notes-tab.ts`); the card layout is left as a follow-up |
| 7 | Nothing stopped a page painting its own segmented control or dropdown | the guard `button-rule.spec.ts` now also fails on a local colour, border or background on `mfSegmented`, `mf-dropdown`, `.p-select` and `select` in the tab components |

## 4. Standard anatomy of a tab

See theme guide 11.2. In short: the strip, then one control row (Search first, Filters and the view, then at the right the Sorted by line, Columns, the "..." menu and the one primary "+ New Thing"), then the frame. A tab with nothing to search leaves Search out and keeps the rest in the same places.

## 5. Left for later

- Notes: the card layout (search above, split button, segmented control and View options in a second row) differs from the other tabs; moving it to the standard row is Agent D's call.
- Columns on Matter Assets and Matter Projects (phase 2 of the grid work).
- Summary keeps its Edit button in the Details card header (a card action, not a list control).

## 6. Checks

Unit: the guard spec, the matter detail page spec. E2E: `lc08-tab-controls.spec.ts` (strip with icons on every tab; Search first and the primary action last on one line with one control height; Activities Kind row above the frame; axe 0 and no sideways page scroll on every tab at 1366x768 and 375x812), `wp10-matter-tabs.spec.ts`, `wp11-tabs-pager.spec.ts`, `column-filters-records.spec.ts`.
