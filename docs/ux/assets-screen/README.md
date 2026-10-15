# Assets screen: inline column filters and details below the grid

Product-owner request for `/assets` (the data records): the three standalone filter boxes were misaligned and a click opened a new page. Now the filters sit in the grid and the selected asset's details appear in the same screen.

Screenshots (1366x768 and 375x812): `before/` (the earlier screen, from docs/ux/fixed-header, scrolled state) and `after/`:
`assets-filters-hidden`, `assets-filters-shown`, `assets-filters-active`, `assets-selected`, `assets-empty`.

## Column filters

- A **Filters** button (filter icon, name "Filters", count of active filters, `aria-pressed` + `aria-expanded`, tooltip "Show filters" / "Hide filters") sits at the right end of a bar directly above the grid (same place as Sorted by / Columns on the work lists). **Clear filters** appears in that bar while any filter is active.
- It shows or hides a **filter row**: the second row of the table head, right under the column headers, one 32 px control per column inside the column width, each named for screen readers ("Filter by Name", "Filter by Type", ...). Both header rows are sticky together in the scroll area (`--mf-head-h`, `styles/_fixed-page.scss`).
- Name, Matter (matter reference, the typed pair such as `343-12`, or matter name) and External reference are text filters: live after 300 ms, immediately on Enter, an x button clears, Esc clears a filled box. Type is a select (All types + types). Status is a select Active (default) / Inactive / All.
- Every filter is in the URL (`name`, `typeId`, `matter`, `extref`, `status`, plus `sort`, `page`, `size`), any change resets the page, and filtering is server-side.
- The open/closed state of the row is remembered per user (`localStorage`, wrapped in try/catch) and the row opens by itself when the address carries filters.
- Nothing matching: the headers and the filter row stay, the body says "No assets match these filters" with Clear filters.
- Reusable pieces: `shared/ui/column-filters.ts` (`mf-column-text-filter`, `mf-column-select-filter`, `mf-filters-toggle`, `readFlag` / `writeFlag`) and the `.mf-filter-row` styles.

### Backend

`GET /api/v1/assets` gained `name`, `externalReference` (fragment of that column only) and `matter` (matter reference, typed pair or matter name). Matching uses EF `Contains` (parameterised LIKE, wildcards literal, database collation, like the Client, Matter and Project lists); the Matter text is resolved through the new `IMatterDirectory.FindIdsMatchingAsync` (Organization contract, at most 1000 matters) because the Assets module does not see the Matter table. `q`, `matterId`, `assetTypeId`, `isActive` are unchanged, permissions unchanged (`Asset.View`). No index is needed (all are `%text%` matches). Integration test: `Column_filters_match_one_column_each_literally_and_combine`.

## Details below the grid

- The Name cell is a button. Choosing it puts `?selected=<id>` in the URL (a normal navigation that does **not** reset the grid's scroll position: `mfScrollArea [keepOn]="['selected']"`) and opens the details panel under the grid. Selecting another row swaps the panel's content in place.
- Selected row: `aria-current="true"`, a 4 px bar at the left edge, tinted background and a bold name (not colour alone).
- The panel (`mf-asset-details`, extracted from the old asset page) shows name, type and status badges, Set inactive / Set active and Edit (same permissions and rules), Matter, external reference (link and copy button), description, dates, the type's custom fields with their form version, a Linked Tasks tab and a History tab (Audit.View). It loads lazily with loading and error (Retry) states and ignores superseded answers. Set inactive updates the row without a reload. Edit still opens `/assets/:id/edit`; Save and Cancel return to `/assets?selected=<id>`.
- Layout: in the fixed-header layout (768 x 561 and up) the grid keeps the upper part and the panel takes 40% of the height, with its own scroll, a Close button and a top shadow. Below that size the page scrolls normally: the panel follows the grid, and choosing a row scrolls the panel into view.
- Keyboard: Name button (Enter / Space) selects and moves focus to the panel heading; **Esc** (or Close) closes the panel and puts focus back on the row's name; Esc inside a dialog or a filled filter box is left to that control.
- `/assets/:id` redirects to `/assets?selected=:id`, so search results, Task, Matter and audit links keep working. A selected asset that is not on the loaded page (a deep link, an inactive asset under the Active default) narrows the list once to its Matter, all states, so the row is highlighted and scrolled into view; the panel shows it in any case.

## Tests

Vitest: `assets-pages.spec.ts` (filter row, URL sync, toggle persistence incl. blocked storage, selection, panel, redirect, keyboard and focus, empty state), `column-filters.spec.ts`, `fixed-page.spec.ts` (`keepOn`). E2E: `e2e/tests/assets-screen.spec.ts`; screenshots: `E2E_SCREENSHOTS=docs/ux/assets-screen/after frontend/e2e/run-local.sh -g "assets screen screenshots"`. axe-core (wcag2a/aa, 2.1 AA, 2.2 AA, best-practice) on list, filters shown, filters active, selected (all three tabs) and empty at 1366x768 and 375x812: 0 violations.

## Decisions and deferred

- The split stays on from 768 x 561 (the fixed-header rule) instead of 1100 px, because the 60/40 split works on tablets; below that the page flows normally.
- Up/Down arrow selection was not added (Tab and Enter already work).
- A deep link to an asset on another page narrows the filters rather than computing its page number.
