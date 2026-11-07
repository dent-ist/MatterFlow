# Grids and Column Preferences

[[_TOC_]]

**What this page is for.** How the app's grids are built, how column choices and widths are remembered, and where saved views come from. The visual rules (row heights, header, pager, column table) are in `docs/ux/design-guidelines.md` (rules D-42 to D-45) and `docs/ux/theme-guide.md` section 11; this page covers the code.

## One grid anatomy

Every list uses the same anatomy: rows 44 px (36 compact), header 40 px, pager 25, 50 or 100 rows, identifier column first, row action last, no "load more". The pieces:

| Piece | File |
|---|---|
| **Record grid (every list of records)** | `shared/ui/record-grid.ts`: `mf-record-grid` (the table), `RecordGridState` (columns, order, visibility, widths per person and grid id), `mf-record-columns` (the Columns button), `mfCell` templates (#1241) |
| Frame, header, body (inside the record grid) | `shared/ui/grid-frame.ts`, `grid-body.ts`, `data-table.ts` |
| Columns menu, reorder, resize | `shared/ui/grid-columns.ts`, `reorder-columns.ts`, `resizable-columns.ts` |
| Pager | `shared/ui/pager.ts`, `local-paging.ts` |
| Keyboard and row navigation | `shared/ui/grid-nav.ts`, `row-nav.ts` |
| Column filters in the header | `shared/filters/column-filter-row.ts` and the filter definitions in `shared/filters/` |
| Task table (the biggest grid) | `shared/work-queue/task-table.ts` with `column-prefs.ts`, `column-resize.ts`, `column-widths.ts`, `column-chooser.ts`, `due-cell.ts`, `inline-edit.ts`, `empty-copy.ts` |
| Export | `shared/ui/export-menu.ts`, `list-export.ts`, backend `GET /task-queue/export` |

## Column definitions

- A grid declares its columns as definitions: `GridColumnDef` (`shared/ui/grid-prefs.ts`: `key`, `label`, `locked` (cannot be hidden), `defaultHidden`, `pinned`) and, for the work tables, `ColumnDef` (`shared/work-queue/column-prefs.ts`: adds `sortField` (the API `sort` value), `width`, `minWidth`, `maxWidth`, `fill` (the Title column), `resizable`, `scopedOnly`). **A new column without width, min and max does not ship** (column contract #200).
- The `key` is the stable id used by storage, the header cell `data-col` attribute and the filter definition. Do not rename a key lightly: a person's stored choice refers to it.

## What is remembered, and where

| What | Stored in | Key and notes |
|---|---|---|
| Order and visibility of columns, per grid and person | Browser `localStorage` | `mf.grid.v1.<grid>.<userId or anon>`; sparse and safe: unknown keys ignored, new columns placed by the definitions, locked columns always shown; every access in try/catch |
| Column widths | Browser `localStorage` (separate store) | `mf.col-widths.v1.<grid>.<userId or anon>` (`resizable-columns.ts`); resetting order or visibility never loses widths |
| Screen state per surface (filters, sort, Focus, scope) and named saved views | Server table `dbo.UserView` through `/api/v1/me/views`, with a `localStorage` write-through cache | `core/views/view-state.service.ts`; works with storage blocked or the endpoint failing (defaults); **the address always wins over a remembered state** |
| Page scope (All, Mine, a pod) | `localStorage` per person and page | `shared/scope/scope.service.ts`; "All" only with `Matter.AssignManagers` on My Matters |
| Dashboard preferences (for example the hidden right panel) | Dashboard prefs | `features/dashboard/dashboard-prefs.ts` |
| Task grid column widths | Browser `localStorage` | `mf.work-widths.v1.<scope>.<userId or anon>` (`shared/work-queue/work-widths.ts`). The Title is the spring until a person drags its divider; then its width is stored (96 to 1600 px). **"Reset Width" removes it** and the spring returns: in the Title header menu (with "Fit to Content", both enabled only while a width is stored), in the Columns panel > Column Widths (a Title row with the stepper), on a double-click of the Title divider, and with "Reset Columns" and "Reset All Widths" (#1243). |

Nothing about a matter is stored in the browser (Sensitive matter rule): the keys hold only a person's own preference ids.

## The record grid (#1241)

A list of records is `<mf-record-grid>` (Matters, Clients, Projects, Assets, the Assets tab of a matter's linked tasks, and the Administration lists: Asset Types, Note Tags, Workflows, Steps, Custom Fields, Reports and report runs): one place for the frame, sortable headings, drag-to-resize handles with the width stored per person and grid, drag-to-reorder, the Columns chooser (show, hide, move, "Reset to Default", "Reset Width"), the loading, empty and error body and the optional selection and row-action columns. A page gives it a `RecordGridState` and one `<ng-template mfCell="key" let-row><td>...</td></ng-template>` per column:

```ts
protected readonly grid = new RecordGridState('clients', this.gridDefs);   // gridDefs: RecordGridColumn[] (key, label, sort, num, width, minWidth, locked, defaultHidden, pinned)
```
```html
<mf-record-columns mfColumns [grid]="grid" />                              <!-- in mf-list-toolbar -->
<mf-record-grid label="Clients list" noun="clients" [grid]="grid" [rows]="rows()" [loadState]="state()" ...>
  <tr mfGridFilterRow mfColumnFilterRow [filters]="filters" [columns]="columns()"></tr>
  <ng-template mfCell="name" let-c><td>...</td></ng-template>
  <div mfGridFoot><mf-pager ... /></div>
</mf-record-grid>
```

The grid id (`'matters'`, `'clients'`) is the storage key: `mf.grid.v1.<id>.<userId>` (order and visibility) and `mf.col-widths.v1.<id>.<userId>` (widths). `exclude` (third constructor argument) drops columns that a permission or the window hides. The heading cell carries the width rules (`width`, `minWidth`), so the columns do not move between loading, empty, error and rows; the cell templates belong to the page (the grid styles are not encapsulated, so `.pg-table td` rules reach them). **Guard:** `record-grid-guard.spec.ts` fails on a hand-built `<table class="pg-table">` outside its `ALLOWED` list. What is still hand-built (each with a reason in the spec): the report preview, report categories and the report matrix, the workflow versions tab, the Client Matters tab, the Matter Projects, Activities, Productions and Assets tabs, Search results and the shell of the Administration lists.

### A grid whose columns are known at run time (Reports result, #720)

`RecordGridState` takes a `Signal` of definitions, so a page can build the columns from data (the Reports result: `features/reports/report-column-defs.ts`). Three things make it work without a private grid: the cells are `@for (c of columns()) { <ng-template [mfCell]="c.key" let-row>...</ng-template> }` (the grid finds them inside the block), the state is made in `ngOnInit` inside `runInInjectionContext` because its id holds an input (`report-result-<reportId>`), and the filters are `ListFilters` with `memory: true` (the state lives in the component, not the address; the default stays the URL). A filter def of `numberRange` can say `numberShape: 'long' | 'decimal'` for numbers beyond 9 digits or with decimals. Sort is one column (the header cycles ascending, descending, ascending; "Reset Sort" in the sorted line); the page maps the grid's `-c3` to the server's `Name:desc`.

### Sticky header and filter bands (#1259)

The heading cells of the table stay at the top of the scroll area while the rows scroll, and the inline filter row stays directly under them; both are opaque, and the pinned first column is also fixed at the left and sits one layer above the pinned row cells (`shared/ui/grid-frame.ts`, `styles/_fixed-page.scss`). The same rule holds for the Task Queue, My Work, Dashboard > Summary and the Matter and Project Tasks grids. The page footer (pager) stays at the bottom of the frame. Spec: `grid-frame.spec.ts` and the e2e `grid-sticky-bands.spec.ts` (1366 and 1920).

### Extension points, the action column and the keyboard (#1245)

| Input or output | What it does |
| --- | --- |
| `[groupBy]="fn"` | `fn(row)` returns `{ key, label }` or null. Rows of one group must be next to each other. Each run gets a 36 px header row ("Archived (3)", a text button with `aria-expanded`; Enter and Space toggle it). |
| `[collapsedGroups]` and `(groupToggle)` | The group keys that start closed (a new array resets the person's choice), and the toggle report. |
| `[rowClass]="fn"` | Extra CSS classes of a row (inactive, selected). |
| `[rowClickable]` and `(rowClick)` | A click on the row (not on a link, button, field or menu inside it) and Enter or Space on the focused row emit the row. A row with its own link is opened through the link, so `rowClick` does not fire for it. |
| `[actions]` | The "..." column, always 48 px (`--mf-col-actions-w`); a `data-no-resize` column ignores stored widths. |
| `[tableId]`, `[emptyParts]`, `[filters]` | The `id` of the `<table>` (the "Skip to table" target), the empty sentence with a link in it, and the page's `ListFilters` (the empty body then says what was searched). A row key (`[rowKey]`) is the record id, never a name (D-44m); the row carries it as `data-record-id`. All options are listed on the [Shared Components Catalogue](Shared-Components-Catalogue.md). |

Every column definition gives a `width` or `minWidth` (the tokens `--mf-col-*-w`, counts `--mf-col-count-w`), except the one spring column. Keyboard: one Tab stop per heading; the resize handle is not a Tab stop. With a heading focused, Shift + Left or Right resizes by 16 px (Ctrl + Shift: 64 px) and Shift + Home sets the minimum.

## Adding a grid or a column

1. Use `mf-record-grid`; do not hand-build a table. Start from a similar list page (for example `features/clients/pages/clients-list-page.ts`).
2. Declare column definitions with widths. Put the identifier first and the row action last.
3. Create the `RecordGridState` with a stable grid id and add `mf-record-columns` to the toolbar.
4. Add the filter definitions in `shared/filters` if the list is filterable; the server must accept the same filter parameters (unknown parameters are a 400).
5. Check at 1366 px width that the Title column keeps at least 160 px and nothing scrolls sideways (guideline D-43a, specs `grid-anatomy.spec.ts`, the default-columns spec).
6. Update the design guidelines column table if you add a shared column.

## Related pages

- [Shared Components Catalogue](Shared-Components-Catalogue.md)
- [UI Standard](UI-Standard.md)
- [Testing the Frontend](Testing-the-Frontend.md)

Last verified against commit a8142a1.
