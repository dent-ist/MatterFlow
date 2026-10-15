# Column filters: the shared foundation

Issue #76 (Batch 1 of epic #75). Implements the pattern standard of `docs/ux/column-filters-review.md` (section 4) with the product manager's decisions of the epic, as reusable parts, and proves it by moving the Assets screen onto them (no visible change at 1366x768; the filter row is now a sheet where it could not work before).

Screenshots (1366x768 and 375x812) are in `screenshots/`: `assets-filters-closed`, `assets-filters-open`, `assets-filters-active`, `assets-chips-row-closed`, `assets-sheet-375`, `assets-sheet-active-375`, `control-multiselect`, `control-daterange`, `control-numberrange`, `control-user`, `more-filters`, `restored-notice`.

## Anatomy

```
[ presets ]  [ chips (row closed) ........ ]  Clear filters   Sorted by ...   More filters  [Filters (3)]    <- mf-filters-bar
+ Name ⇅ ----+ Type ⇅ ---+ Matter ---+ External reference ---+ Status ---+                                  <- header row (sort), sticky, 40 px
| [Filter  x]| [All ▾]   | [Filter ] | [Filter ]             | [Active ▾]|                                  <- mf-column-filter-row, sticky, 32 px controls
+ rows ...
```

| Part | Selector | What it is |
| --- | --- | --- |
| `FilterDef` | (type) | One declaration per filter: key, label, column, control type, URL parameter names, options, default, whether the default counts, disabled reason, span, hidden-column behaviour. Everything below is generated from `FilterDef[]`. |
| `ListFilters` | (class) | The URL/state helper. URL is the single source of truth. Defaults are shown but neither written to the URL nor counted. A plain link is never silently filtered. Owns the open state, sheet mode, the restored-view notice, the live-region text and the print line. |
| `mf-filters-bar` | `shared/filters/filters-bar.ts` | Above the grid, right aligned: chips, Clear filters, your own toolbar items, More filters, the Filters toggle (filter icon, name, `(n)`, `aria-pressed`, `aria-expanded`, `aria-controls`). Also holds the polite live region, the print line, the restored-view notice and the sheet. Handles the `/` key. |
| `mf-column-filter-row` | `tr[mfColumnFilterRow]` | The second sticky head row: one cell per visible column, `colspan` for a filter that spans columns, stacked controls when a column has several. |
| `mf-filter-chips` | `shared/filters/filter-chips.ts` | One removable chip per active value ("Priority: Critical", remove button "Remove filter Priority: Critical"), one line with "+N more". Shown when the row is closed or the sheet is in use, and for a filter on a hidden column ("(hidden column)", "Show column") or without a column. |
| `mf-filter-sheet` | `shared/filters/filter-sheet.ts` | The same definitions as a bottom-sheet dialog below 768 px or when the grid overflows sideways: modal, focus kept inside and returned to the Filters button, live apply, footer "Show N results" and "Clear filters". |
| `mf-filter-control` | `shared/filters/filter-control.ts` | Picks the control for a definition and wires it to `ListFilters`. The row, the sheet and the "More filters" menu all use it. |

Controls (all named "Filter by <column>"):

| Type | Component | Behaviour |
| --- | --- | --- |
| `text` | `mf-column-text-filter` | Live after 300 ms, Enter applies at once, x clears, Esc clears a filled box, trimmed, max 200. "Contains" only. |
| `select` | `mf-column-select-filter` | Native select; `allLabel` adds the leading "All ..." option; a `default` is shown and not counted. |
| `multiSelect` | `mf-column-multiselect-filter` | Button "All" / the value / "3 selected" opening a fixed-position popover: checkbox group, find box above 8 options, optional counts, Clear, Done. Applies 400 ms after the last tick or when the panel closes. Flag options (`Unassigned`, `No pod`) travel as their own boolean parameter. |
| `user` | `mf-column-user-filter` | The multi-select with "Me" first, special choices, inactive people marked "(inactive)" but selectable. |
| `dateRange` | `mf-column-date-range-filter` | Button "Any date" / "Oct 1 to Oct 16" opening From and To (`mf-date-input`, commit on blur or Enter) and presets: Today, This week (Monday to Sunday), Last 7 days, Last 30 days, This month, Next 7 days. Presets are worked out in the viewer's time zone; the URL keeps absolute dates. From after To shows an error and is not applied. |
| `numberRange` | `mf-column-number-range-filter` | Min and Max whole numbers, live after 300 ms; Min above Max shows an error. |
| `triState` | `mf-column-tristate-filter` | Any / Yes / No with domain wording from `options` ("Overdue only"). |

The multi-select, user, date and number controls are lazy (`@defer`), so a screen that only uses text and select filters does not load them. The popover (`mf-filter-popover`) is `position: fixed` from the trigger, flips upward near the bottom, closes on scroll, outside click and Esc (focus returns to the trigger).

## Rules (what the code guarantees)

- **The URL is the source of truth**: every filter, read with `ActivatedRoute`, written with `Router.navigate` (merge). Any change resets `page`. Typing (text controls) rewrites the history entry (`replaceUrl`) so Back is not flooded; selects and popovers push.
- **Defaults are visible and not counted**: Status = Active is shown in its cell, never written to the URL, not in the `(n)` count and not a chip. Clearing a default (Status "All") is an active filter with a chip that removes back to the default. `status=` (empty) means "explicitly nothing" when a default exists.
- **Clear filters** returns to the defaults (not to nothing) and is shown only while something differs.
- **A plain link never filters silently**: `ListFilters.isDeepLink()` tells a link that carries filters from a plain one; a page that applies a remembered view calls `markRestored()` and the bar shows "Restored your last view" with Reset to default and Dismiss.
- **Open state** is remembered per screen and per user (`mf.<screen>.filters.open.<userId>`, guarded `localStorage`), `openByDefault` for Task Queue, My Work and Pod Work, and the row opens by itself when the address carries active filters.
- **Hidden columns**: `visibleColumns` tells `ListFilters` which columns are on screen. A filter on another column stays active and shows as a chip; `moreDefs()` feeds the "More filters" menu (hidden-column filters and filters without a column, such as Matter "Sensitive").
- **Disabled with a reason** (`disabledReason`, for a column a tab owns): a disabled stand-in with the reason as tooltip and description; not counted, no chip.
- **Live region**: after a filter change has loaded, one polite message ("23 results", "1 asset", "No assets", "Filters cleared. 40 assets"). Not per keystroke, not while loading, not for paging or sorting. The page reports totals with `filters.reportResults(total)` (`ServerListPage` does it).
- **Print**: `@media print` hides the bar, row, chips and sheet and shows "Filters: Name acme, Status Active" above the grid.
- **Sheet**: below 768 px or when `ListFilters.watchOverflow(scrollArea)` sees the grid overflow sideways. The filter row is not rendered then.
- **`/`** opens the row (or the sheet) and focuses the first text filter, except while typing, with a modifier, inside a dialog or on a screen without a text filter.

## Adding a filter row to a new screen

1. Declare the filters (one `FilterDef` per filter, keyed to the grid's column keys):

```ts
private readonly defs = computed((): FilterDef[] => [
  { key: 'name', label: 'Name', column: 'name', type: 'text' },
  { key: 'typeId', label: 'Type', column: 'type', type: 'select', allLabel: 'All types',
    options: this.typeOptions() },
  { key: 'status', label: 'Status', column: 'status', type: 'select', default: 'active',
    options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' },
              { value: 'all', label: 'All' }] },
]);
protected readonly filters = new ListFilters({ screen: 'clients', noun: 'clients', defs: this.defs });
```

2. A list that extends `ServerListPage` / `ListQueryPage` hands the helper over, which wires `hasFilter`, `clear()`, the reload and the result announcement:

```ts
protected override listFilters() { return this.filters; }
protected override fetch() {
  return firstValueFrom(this.api.listClients(this.filters.text('name') || undefined, /* ... */));
}
```

3. Template: the bar above the grid, the row as the second head row, and the overflow watch:

```html
<mf-filters-bar [filters]="filters" controls="client-filter-row" />
<div class="mf-fill">
  <div class="mf-table-wrap" mfScrollArea="Clients list" #scroll>
    <table class="pg-table" style="table-layout: fixed">
      <thead>
        <tr><th mfSort="name" ...>Name</th> ... </tr>
        @if (filters.rowVisible()) {
          <tr mfColumnFilterRow id="client-filter-row" [filters]="filters" [columns]="columns"></tr>
        }
      </thead>
```

```ts
protected readonly columns = ['name', 'type', 'status'];
constructor() { super(); afterNextRender(() => this.filters.watchOverflow(this.scroll()?.nativeElement)); }
```

4. Empty state: when `filters.activeCount() > 0` say "No clients match these filters" with a Clear filters button that calls `filters.clear()`.

Useful options: `openByDefault`, `visibleColumns` (a signal of the shown column keys), `noun`. Filters without a column (`column` omitted) appear in More filters; `noControl: true` keeps a link-only parameter (`?matterId=`) as a removable chip. `queue-defs.ts` holds the `QueueFilters` parameters as `FilterDef[]` for the work lists, with a link-contract spec.

## Assets retrofit

`AssetsListPage` now declares six `FilterDef`s (Name, Type, Matter, External reference, Status with default Active, and the link-only `matterId`), renders `mf-filters-bar` and `tr[mfColumnFilterRow]`, and uses `ServerListPage`'s `listFilters()` hook. New compared with the earlier screen: chips when the row is closed, the polite result announcement, the print line, the sheet at 375 px and on an overflowing grid, "Clear filters" and the count from the shared code, and `/`. URLs (`name`, `typeId`, `matter`, `extref`, `status`, `matterId`) are unchanged. The removable Matter chip's button is now named "Remove filter Matter: <ref name>" (it was "Remove matter filter").

## Tests

- Unit (Vitest): `shared/filters/*.spec.ts` for the definitions (parse/serialise round trips, defaults, explicit empty), date presets (Monday weeks, month and year ends, time zones), `ListFilters` (URL, replace vs push, clear, presets, chips, hidden columns, print line, open state incl. blocked storage, sheet mode, restored notice, announcements), `queue-defs` (link contract against `QueueFilters` for 12 dashboard and search link shapes), every control, the popover, the control dispatcher, the row (span, stacked, empty cells), the bar (toggle, Clear, chips, More filters, live region, print line, `/`), the sheet (modal, focus trap and return, Esc order, live apply). `assets-pages.spec.ts` was adapted: the page reads its filters from the route, so the spec feeds a fake route; expectations changed only for `replaceUrl` on text filters and the chip button name.
- E2E: `e2e/tests/column-filters.spec.ts` on Assets (chips, live region, keyboard order, Enter and Esc, `/`, sheet at 375 px, sheet on an overflowing grid, print line with `emulateMedia`, axe closed/open/filtered/chips/sheet). The existing `assets-screen.spec.ts` and `assets.spec.ts` pass unchanged.
- Screenshots: `E2E_SCREENSHOTS=docs/ux/column-filters/screenshots frontend/e2e/run-local.sh -g "column filters screenshots"`.

## Decisions and deferred

- Type stays a single select on Assets: the multi-select needs `assetTypeId[]` on `GET /assets` (Batch 2, item 2.0). The control itself is built and tested.
- The server typeahead for more than 50 users, facet counts per option (`FilterOption.count` is rendered when given) and saved views are later items.
- The work lists and the other record lists are not migrated here (Batches 2 to 4); `QueueFilters` and `ListQueryPage` keep working. `queue-defs.ts` is the adapter they will use.
- Funnel icon in the header of a filtered column (review 4.3) is Batch 5.6.
