# Shared Components Catalogue

[[_TOC_]]

**What this page is for.** A short "which component for what" lookup for the Angular app. It is a summary. The normative and complete catalogue, with exact values and rule numbers (D-xx), is section 3 of `docs/ux/design-guidelines.md`; read it before you build or change any UI. If a need is not in the guidelines, ask the UI designer instead of inventing a component.

Paths are under `frontend/src/app/`. Names and inputs below were read from the code (the component files) when the page was last verified; the exact values (px, tokens) stay in the guidelines.

## Structure and navigation

| Need | Use | File |
|---|---|---|
| Page header of a list, workspace or admin page | `mf-page-header`, `mf-title-icon` | `shared/ui/page-header.ts` |
| Record page header (title, tile, actions) | `mf-record-header`, `mf-record-title` | `shared/ui/record-header.ts` |
| Tabs | `mf-tabs` with icons from `tab-icons.ts` | `shared/ui/tabs.ts` |
| Two-way switch inside a page | segmented control `[mfSegmented]` | `shared/ui/segmented.ts` |
| Side drawer for reading detail | `mf-slide-panel` | `shared/ui/slide-panel.ts` |
| App shell, menu, user menu, bell | `app-shell`, `NAV_ITEMS`, `user-menu`, `notification-bell`, `global-search` | `shared/layout/`, `shared/search/` |

## Lists and grids

| Need | Use | File |
|---|---|---|
| List toolbar, filters button, search box, sorted line | `mf-list-toolbar`, `mf-list-filters-button`, `mf-search-box`, `mf-sorted-line` | `shared/filters/list-toolbar.ts`, `shared/ui/search-box.ts`, `sorted-line.ts` |
| Column filters in a grid | `mfColumnFilterRow` | `shared/filters/column-filter-row.ts` |
| Record grid (a list of records: table, sort, resize, reorder, Columns, states; options in the table below) | `mf-record-grid`, `mf-record-columns`, `RecordGridState`, `mfCell` | `shared/ui/record-grid.ts` |
| Grid frame, pager, columns | `mf-grid-frame`, `mf-pager`, `mf-grid-columns`, `mf-zero-dash` | `shared/ui/grid-frame.ts`, `pager.ts`, `grid-columns.ts` |
| Task table (Task Queue, My Work, Pod Work, Dashboard, Matter and Project Tasks) | `mf-task-table` | `shared/work-queue/task-table.ts` |
| Row actions | `mf-action-menu`, `mf-options-menu` | `shared/ui/action-menu.ts`, `options-menu.ts` |
| Admin list with states | `AdminListState`, `admin-list-shell` | `shared/ui/admin-list-state.ts`, `admin-list-shell.ts` |
| Export menu | `export-menu` | `shared/ui/export-menu.ts` |
| Saved views menu | `views-menu` | `shared/ui/views-menu.ts` |

### Record grid options

`mf-record-grid` (`shared/ui/record-grid.ts`) is the one table of every record list (Matters, Clients, Projects, Assets, the Administration lists). The inputs and outputs a page uses besides `grid`, `label`, `noun`, `rows`, `loadState`:

| Input or output | What it does |
|---|---|
| `[tableId]` | The `id` of the `<table>`, the target of the "Skip to table" link of the Administration list shell |
| `[rowKey]` | The identity of a row (the record id, never a name; D-44m). Every record row carries `data-record-id` with this value |
| `[groupBy]`, `[collapsedGroups]`, `(groupToggle)` | `fn(row)` returns `{ key, label }` or null; rows of one group must be next to each other. Each run gets a 36 px header row with a chevron button ("Archived (3)"). `collapsedGroups` lists the keys that start closed; `groupToggle` reports a toggle |
| `[rowClass]` | `fn(row)` gives extra CSS classes of a row (`is-selected` is styled by the grid; other names by the page) |
| `[rowClickable]` and `(rowClick)` | The row is clickable and a Tab stop when it has no link of its own; a click or Enter or Space emits the row. A row with its own link is opened through the link |
| `[emptyText]` or `[emptyParts]` | The sentence of the empty list. `emptyParts` is the same sentence with a link in it (copy parts); it is used when the list is empty and not filtered |
| `[filters]` | The page's `ListFilters`: the empty body then says what was searched (`No results for "zzz"`) and the bar above shows no second Clear Filters |
| `[filtered]`, `[hidden]`, `[hiddenLabel]` | The filtered-empty state and the "N inactive hidden, Show all" sentence (`(showAll)`) |
| `[selecting]`, `[allSelected]`, `[someSelected]` | A selection column first (bulk actions) |
| `[actions]` | The "..." row-action column, last, always 48 px |
| `mfEmptyAction` (content) | The "+ New <Thing>" button of the empty body |

The pager, the Columns button and the column filter row go in the content slots (`mfGridFoot`, `mfGridFilterRow`). How the state is stored is on [Grids and Column Preferences](Grids-and-Column-Preferences.md).

## Forms and dialogs

| Need | Use | File |
|---|---|---|
| Create and edit dialog | `mf-form-dialog` (`size` small, default, large) | `shared/ui/form-dialog.ts` |
| Confirm dialog | `mf-confirm-dialog` | `shared/ui/confirm-dialog.ts` |
| Picker dialogs | `lookup-dialog`, `entity-picker`, `asset-picker` | `shared/ui/` |
| Text field, number input | `mf-text-field`, `number-input` | `shared/ui/text-field.ts`, `number-input.ts` |
| Dropdown, multi-select | `mf-dropdown` (`multi`, `search`, `size`). **Inside a form, dialog or record page add `field`**: the button is then a white field with or without a value. The blue fill means an active filter and belongs only in filter rows, popovers and toolbars (D-44r) | `shared/ui/dropdown.ts` |
| Assignee picker | `mf-assignee-picker`, `AssigneeList` | `shared/assignees/` |
| Dynamic (admin-defined) form | `mf-dynamic-form` from the `form-engine` library | `projects/form-engine` |
| Rich text | Tiptap based note editor; comment editor | `features/notes/note-editor.ts` |

## Display

| Need | Use | File |
|---|---|---|
| Chips and badges (four kinds: status, count, filter, tag) | `mf-status-chip`, `mf-badge`, `mf-count-chip`, `mf-tag-chip`, `mf-filter-chips`, `mf-priority-flag`, `mf-task-type-chip` | `shared/ui/*.ts` |
| Task status or disposition as a chip (icon and word, never colour alone) | `mf-status-chip`: `code` (required), `kind` = `task` (the default) or `disposition` (an asset's Active, Inactive, Pending Disposition, Disposed, and a record's Active or Inactive), `label` (changes the word, for example "Archived"), `stepNumber`, `stepTotal` and `showBar` (the workflow step of an In Progress task), `detail` (the hover and focus text; a chip with a detail is a Tab stop) | `shared/ui/status-chip.ts` |
| Filter or toggle chips with counts | `mf-filter-chips` with `FilterChip` items: `key`, `label`, `count`, `icon`, `hint`, `ariaLabel`, `tinted`, `alert`, `inert`, `hidden` and **`pressed`**. By default one chip is chosen (`value`, `aria-pressed`). A chip's `pressed` overrides that, for a multiple choice (the Work Hours day toggles): each chip says whether it is on and a press returns the chip's key. `emptyKey` makes a second press on the chosen chip clear the choice; `strip` marks a summary strip | `shared/ui/filter-chips.ts` |
| Record fields on a record page | `mf-details-card` with `title` (required), `count` (a count chip beside the title), `threeColumns` and `scrollLabel` (the Matter Summary options). Fields are `div[mfDetailField]` with `label` and `wide`. A second group (custom fields) is a second card: `mf-custom-fields-view [card]` (D-44f) | `shared/ui/details-card.ts`, `custom-fields.ts` |
| Notice bar (offline, sign-in, sensitive, inactive) | the `.pg-banner` class (a plain `div`, not a component), see "Banner" below | `styles/_banners.scss` |
| Cards and stat tiles | `.mf-card`, `mf-stat-tile` | `styles/_cards.scss`, `shared/ui/stat-tile.ts` |
| Empty, error, loading, missing record | `mf-state-block`, `mf-record-state`, `mf-state-page`, `mf-record-skeleton` | `shared/ui/state-block.ts`, `record-state.ts`, `state-page.ts`, `record-skeleton.ts` |
| Tooltips | `[mfTip]`. The tip is a fixed element on `body`; it is `aria-hidden` (so axe's "region" rule does not flag it) and the owner points at it with `aria-describedby` while it shows (#1268) | `shared/ui/tip.ts` |
| Toasts | `NotificationService` (`success`, `info`, `warn`, `error(summary, detail?, options?)`; the option **`copy`** adds a "Copy Reference" button for the support reference of an error), `UndoService` (never PrimeNG `MessageService`) | `core/notify/`, `shared/ui/toast-host.ts` |
| Charts | `bar-chart`, `column-chart`, `pie-chart`, chart panel | `shared/charts/` |
| Dates, numbers, names | `mfNum`, `numericDate*`, `describeDueCell`, `formatInt/Percent/Duration/Bytes`, `shortAccountName` | `shared/ui/numeric-date.ts`, `core/time/time.ts`, `shared/ui/number-format.ts`, `person-name.ts` |
| Matter reference text (`00343-00012`) | `matterRef` pipe, `mf-matter-ref` | `shared/pipes/matter-ref.pipe.ts`, `shared/ui/matter-ref.ts` |
| Icons | PrimeIcons through the icon registry; task type icons; person state icons | `shared/ui/tab-icons.ts`, `shared/layout/section-icons.ts`, `shared/icons/` |

## Buttons, links and banners

| Need | Use | File |
|---|---|---|
| Buttons | `p-button` (the preset) or `mf-btn` with `mf-btn--primary`, `--danger`, `--text`, `--icon` (36 px; a button inside a table cell is 32 px) | `styles/_buttons.scss`, `core/theme/mf-preset.ts` |
| A record name that opens a drawer or dialog | `mf-btn mf-btn--text mf-btn--name`: underlined at rest like every name link in a grid, at most two lines (D-44m). No private class | `styles/_buttons.scss` |
| A chip or pill that opens a dialog (a priority pill) | `mf-btn mf-btn--text mf-btn--chip` around the pill, with an `aria-label` such as "Edit <name>": no padding or fill, a 1 px outline on hover (D-44v) | `styles/_buttons.scss` |
| Links | the global link rule, `.mf-link`, `.mf-link--id` for identifiers; actions are text buttons | `styles.scss` |

### Banner

One bar for every notice: add `pg-banner` to a `div` with a leading `pi` icon, one sentence and optionally one text button at the right. Variants by modifier class:

| Class | Meaning |
|---|---|
| `pg-banner` (default) | Warning (amber): offline, sensitive matter, inactive record |
| `pg-banner--info` | Information (blue), for example the Dev auth bar |
| `pg-banner--danger` | A failed sign-in (red; announce with `role="alert"`) |
| `pg-banner--success` | "Back online." (green) |
| `pg-banner--full` | The global kind: full width at the top of the main area, no radius, a bottom line only (offline, sign-in, Dev auth) |

The bar is 36 px high (taller only when the text must wrap), the icon is `--mf-icon-md` (18 px in `tokens.css`; the text of rule D-10a still says 16, rule D-53a and the code say 18), and its action is a 32 px text button. Every banner has its icon (`banner-anatomy.spec.ts` fails without one). The global banners live in `shared/layout/connection-banner.ts` and `dev-auth-banner.ts`; the sensitive bars of the record headers use the same styles (`.rh__note`, `.mh__note`).

## Behaviour helpers

| Need | Use | File |
|---|---|---|
| Show or hide by permission | `*mfHasPermission` | `shared/directives/has-permission.directive.ts` |
| Warn about unsaved changes | `unsavedChangesGuard` | `shared/guards/unsaved-changes.guard.ts` |
| Page scope (All, Mine, a pod) | `ScopeService`, `mf-scope-switch` | `shared/scope/` |
| Remembered screen state and saved views | `ViewState` service | `core/views/` |

## Related pages

- [UI Standard](UI-Standard.md)
- [Grids and Column Preferences](Grids-and-Column-Preferences.md)
- [How to Add a Page](How-to-Add-a-Page.md)

Last verified against commit 78f445a.
