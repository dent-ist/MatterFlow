# Grids and Column Preferences

[[_TOC_]]

**What this page is for.** How the app's grids are built, how column choices and widths are remembered, and where saved views come from. The visual rules (row heights, header, pager, column table) are in `docs/ux/design-guidelines.md` (rules D-42 to D-45) and `docs/ux/theme-guide.md` section 11; this page covers the code.

## One grid anatomy

Every list uses the same anatomy: rows 44 px (36 compact), header 40 px, pager 25, 50 or 100 rows, identifier column first, row action last, no "load more". The pieces:

| Piece | File |
|---|---|
| Frame, header, body | `shared/ui/grid-frame.ts`, `grid-body.ts`, `data-table.ts` |
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

Nothing about a matter is stored in the browser (Sensitive matter rule): the keys hold only a person's own preference ids.

## Adding a grid or a column

1. Use the shared components; do not hand-build a table. Start from a similar list page (for example `features/clients/pages/clients-list-page.ts`).
2. Declare column definitions with widths. Put the identifier first and the row action last.
3. Wire the Columns menu and `gridPrefsKey('<grid-name>', userId)`.
4. Add the filter definitions in `shared/filters` if the list is filterable; the server must accept the same filter parameters (unknown parameters are a 400).
5. Check at 1366 px width that the Title column keeps at least 160 px and nothing scrolls sideways (guideline D-43a, specs `grid-anatomy.spec.ts`, the default-columns spec).
6. Update the design guidelines column table if you add a shared column.

## Related pages

- [Shared Components Catalogue](Shared-Components-Catalogue.md)
- [UI Standard](UI-Standard.md)
- [Testing the Frontend](Testing-the-Frontend.md)

Last verified against commit 2e446f8.
