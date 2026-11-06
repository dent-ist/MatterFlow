# Shared Components Catalogue

[[_TOC_]]

**What this page is for.** A short "which component for what" lookup for the Angular app. It is a summary. The normative and complete catalogue, with exact values and rule numbers (D-xx), is section 3 of `docs/ux/design-guidelines.md`; read it before you build or change any UI. If a need is not in the guidelines, ask the UI designer instead of inventing a component.

Paths are under `frontend/src/app/`.

## Structure and navigation

| Need | Use | File |
|---|---|---|
| Page header of a list, workspace or admin page | `mf-page-header` | `shared/ui/page-header.ts` |
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
| Record grid (a list of records: table, sort, resize, reorder, Columns, states, `groupBy`, `rowClass`, `rowClick`) | `mf-record-grid`, `mf-record-columns`, `RecordGridState`, `mfCell` | `shared/ui/record-grid.ts` |
| Grid frame, pager, columns | `mf-grid-frame`, `mf-pager`, `mf-grid-columns`, `mf-zero-dash` | `shared/ui/grid-frame.ts`, `pager.ts`, `grid-columns.ts` |
| Task table (Task Queue, My Work, Pod Work, Dashboard, Matter and Project Tasks) | `mf-task-table` | `shared/work-queue/task-table.ts` |
| Row actions | `mf-action-menu`, `mf-options-menu` | `shared/ui/action-menu.ts`, `options-menu.ts` |
| Admin list with states | `AdminListState`, `admin-list-shell` | `shared/ui/admin-list-state.ts`, `admin-list-shell.ts` |
| Export menu | `export-menu` | `shared/ui/export-menu.ts` |
| Saved views menu | `views-menu` | `shared/ui/views-menu.ts` |

## Forms and dialogs

| Need | Use | File |
|---|---|---|
| Create and edit dialog | `mf-form-dialog` (`size` small, default, large) | `shared/ui/form-dialog.ts` |
| Confirm dialog | `mf-confirm-dialog` | `shared/ui/confirm-dialog.ts` |
| Picker dialogs | `lookup-dialog`, `entity-picker`, `asset-picker` | `shared/ui/` |
| Text field, dropdown, number input | `mf-text-field`, `mf-dropdown`, `number-input` | `shared/ui/text-field.ts`, `dropdown.ts`, `number-input.ts` |
| Assignee picker | `mf-assignee-picker`, `AssigneeList` | `shared/assignees/` |
| Dynamic (admin-defined) form | `mf-dynamic-form` from the `form-engine` library | `projects/form-engine` |
| Rich text | Tiptap based note editor; comment editor | `features/notes/note-editor.ts` |

## Display

| Need | Use | File |
|---|---|---|
| Status, count, tag and filter chips; badges | `mf-status-chip`, `mf-count-chip`, `mf-tag-chip`, `mf-filter-chips`, `mf-badge`, `mf-priority-flag`, `mf-task-type-chip` | `shared/ui/*.ts` |
| Cards and stat tiles | `.mf-card`, `mf-stat-tile` | `styles/_cards.scss`, `shared/ui/stat-tile.ts` |
| Empty, error, loading, missing record | `mf-state-block`, `mf-record-state`, `mf-state-page`, `mf-record-skeleton` | `shared/ui/state-block.ts`, `record-state.ts`, `state-page.ts`, `record-skeleton.ts` |
| Tooltips | `[mfTip]` | `shared/ui/tip.ts` |
| Toasts | `NotificationService`, `UndoService` (never PrimeNG `MessageService`) | `core/notify/` |
| Charts | `bar-chart`, `column-chart`, `pie-chart`, chart panel | `shared/charts/` |
| Dates, numbers, names | `mfNum`, `numericDate*`, `describeDueCell`, `formatInt/Percent/Duration/Bytes`, `shortAccountName` | `shared/ui/numeric-date.ts`, `core/time/time.ts`, `shared/ui/number-format.ts`, `person-name.ts` |
| Matter reference text (`00343-00012`) | `matterRef` pipe, `mf-matter-ref` | `shared/pipes/matter-ref.pipe.ts`, `shared/ui/matter-ref.ts` |
| Icons | PrimeIcons through the icon registry; task type icons; person state icons | `shared/ui/tab-icons.ts`, `shared/layout/section-icons.ts`, `shared/icons/` |

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

Last verified against commit 2e446f8.
