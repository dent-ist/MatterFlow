# Column filters: the shared foundation

Issue #76 (Batch 1 of epic #75). Implements the pattern standard of `docs/ux/column-filters-review.md` (section 4) with the product manager's decisions of the epic, as reusable parts, and proves it by moving the Assets screen onto them (no visible change at 1366x768; the filter row is now a sheet where it could not work before).

Issue #77 (Batch 2) moved Clients, Matters, Projects, the Client's Matters grid and the Matter's Assets tab onto the same parts (section "Batch 2: the record lists" below). Issue #79 (Batch 4) did the administration lists (section "Batch 4: administration") and issue #78 (Batch 3) the work lists: Task Queue, My Work, Pod Work and the Tasks grids of a Matter and a Project (section "Batch 3: the work lists").

Screenshots are in `screenshots/` (`<name>-<width>x<height>.png`):

- Assets, 1366x768: `assets-filters-closed`, `assets-filters-open`, `assets-filters-active` (row open, values in the cells), `assets-chips-row-closed` (chips instead), `assets-print` (print rendering with the "Filters: ..." line).
- Assets, 375x812: `assets-closed`, `assets-sheet`, `assets-sheet-filtered`, `assets-chips`.
- The controls, from a throwaway build in which Assets carried one demo filter of every type (not committed): `controls-row`, `control-multiselect`, `control-user`, `control-daterange` (with presets), `control-numberrange`, `more-filters` (1366x768) and `sheet-all-controls`, `sheet-all-controls-scrolled` (375x812, every control expanded).

## Anatomy

```
[ presets ]  [ chips (row closed) ........ ]  Clear filters   Sorted by ...   Other filters  [Filters (3)]    <- mf-filters-bar
+ Name ⇅ ----+ Type ⇅ ---+ Matter ---+ External reference ---+ Status ---+                                  <- header row (sort), sticky, 40 px
| [Filter  x]| [All ▾]   | [Filter ] | [Filter ]             | [Active ▾]|                                  <- mf-column-filter-row, sticky, 32 px controls
+ rows ...
```

| Part | Selector | What it is |
| --- | --- | --- |
| `FilterDef` | (type) | One declaration per filter: key, label, column, control type, URL parameter names, options, default, whether the default counts, disabled reason, span, hidden-column behaviour. Everything below is generated from `FilterDef[]`. |
| `ListFilters` | (class) | The URL/state helper. URL is the single source of truth. Defaults are shown but neither written to the URL nor counted. A plain link is never silently filtered. Owns the open state, sheet mode, the restored-view notice, the live-region text and the print line. |
| `mf-filters-bar` | `shared/filters/filters-bar.ts` | Above the grid, right aligned: chips, Clear filters, your own toolbar items, Other filters, the Filters toggle (filter icon, name, `(n)`, `aria-pressed`, `aria-expanded`, `aria-controls`). Also holds the polite live region, the print line, the restored-view notice and the sheet. Handles the `/` key. |
| `mf-column-filter-row` | `tr[mfColumnFilterRow]` | The second sticky head row: one cell per visible column, `colspan` for a filter that spans columns, stacked controls when a column has several. |
| `mf-filter-chips` | `shared/filters/filter-chips.ts` | One removable chip per active value ("Priority: Critical", remove button "Remove filter Priority: Critical"), one line with "+N more". Shown when the row is closed or the sheet is in use, and for a filter on a hidden column ("(hidden column)", "Show column") or without a column. |
| `mf-filter-sheet` | `shared/filters/filter-sheet.ts` | The same definitions as a bottom-sheet dialog below 768 px or when the grid overflows sideways: modal, focus kept inside and returned to the Filters button, live apply, footer "Show N results" and "Clear filters". |
| `mf-filter-control` | `shared/filters/filter-control.ts` | Picks the control for a definition and wires it to `ListFilters`. The row, the sheet and the "Other filters" menu all use it. |

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
- **Hidden columns**: `visibleColumns` tells `ListFilters` which columns are on screen. A filter on another column stays active and shows as a chip; `moreDefs()` feeds the "Other filters" menu (hidden-column filters and filters without a column, such as Matter "Sensitive").
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

Useful options: `openByDefault`, `visibleColumns` (a signal of the shown column keys), `noun`. Filters without a column (`column` omitted) appear in Other filters; `noControl: true` keeps a link-only parameter (`?matterId=`) as a removable chip. `queue-defs.ts` holds the `QueueFilters` parameters as `FilterDef[]` for the work lists, with a link-contract spec.

## Assets retrofit

`AssetsListPage` now declares six `FilterDef`s (Name, Type, Matter, External reference, Status with default Active, and the link-only `matterId`), renders `mf-filters-bar` and `tr[mfColumnFilterRow]`, and uses `ServerListPage`'s `listFilters()` hook. New compared with the earlier screen: chips when the row is closed, the polite result announcement, the print line, the sheet at 375 px and on an overflowing grid, "Clear filters" and the count from the shared code, and `/`. URLs (`name`, `typeId`, `matter`, `extref`, `status`, `matterId`) are unchanged. The removable Matter chip's button is now named "Remove filter Matter: <ref name>" (it was "Remove matter filter").

## Tests

- Unit (Vitest): `shared/filters/*.spec.ts` for the definitions (parse/serialise round trips, defaults, explicit empty), date presets (Monday weeks, month and year ends, time zones), `ListFilters` (URL, replace vs push, clear, presets, chips, hidden columns, print line, open state incl. blocked storage, sheet mode, restored notice, announcements), `queue-defs` (link contract against `QueueFilters` for 12 dashboard and search link shapes), every control, the popover, the control dispatcher, the row (span, stacked, empty cells), the bar (toggle, Clear, chips, Other filters, live region, print line, `/`), the sheet (modal, focus trap and return, Esc order, live apply). `assets-pages.spec.ts` was adapted: the page reads its filters from the route, so the spec feeds a fake route; expectations changed only for `replaceUrl` on text filters and the chip button name.
- E2E: `e2e/tests/column-filters.spec.ts` on Assets (chips, live region, keyboard order, Enter and Esc, `/`, sheet at 375 px, sheet on an overflowing grid, print line with `emulateMedia`, axe closed/open/filtered/chips/sheet). The existing `assets-screen.spec.ts` and `assets.spec.ts` pass unchanged.
- Screenshots of Assets: `E2E_SCREENSHOTS=docs/ux/column-filters/screenshots frontend/e2e/run-local.sh -g "column filters screenshots"` (`e2e/tests/column-filters-screens.spec.ts`).

## Decisions and deferred

- Type stays a single select on Assets: the multi-select needs `assetTypeId[]` on `GET /assets` (Batch 2, item 2.0). The control itself is built and tested.
- The server typeahead for more than 50 users, facet counts per option (`FilterOption.count` is rendered when given) and saved views are later items.
- The work lists and the other record lists were not migrated by the foundation (Batches 2 to 4 did them); `queue-defs.ts` is the adapter the work lists use.
- Funnel icon in the header of a filtered column (review 4.3) is Batch 5.6.

## Batch 2: the record lists

Issue #77 (Batch 2 of epic #75). Clients, Matters, Projects, the Client page's Matters grid and the Matter page's Assets tab lost their standalone search box and status select (`mf-search-box`, `mf-status-filter`, `mf-list-state` on these screens) and use `mf-filters-bar` + `tr[mfColumnFilterRow]`. The filter row is closed by default on all of them (the open state is remembered per screen and user); a link that carries filters opens it.

| Screen | Filters (URL parameter) | Notes |
| --- | --- | --- |
| Clients `/clients` | Client number (`clientNumber`, text), Name (`name`, text), Status (`status`, Active default) | The old `q` is no longer read; Clear filters still drops it from an old link. |
| Matters `/matters` | Matter reference (`matterRef`), Name (`name`), Client (`client`, name or number digits), Status (`status`), Sensitive (`isSensitive`, in Other filters, Yes / No), `?clientId=` as a removable chip | The typed pair `343-12` finds the padded reference (and `343-120` while typing); a full padded reference is exact. |
| Projects `/projects` | Name (`name`), Matter (`matter`, reference, typed pair or name), Status (`status`; inactive is called Archived), `?matterId=` chip | |
| Client page, Matters | Matter (`matterRef`), Name (`name`), Status (`status`), Sensitive (`isSensitive`, Other filters) | Create matter sits at the left of the bar. `page`, `size`, `sort` stay router inputs of the page. |
| Matter page, Assets tab (`?tab=assets`) | Name (`name`), Type (`typeId`, multi-select), External reference (`extref`), Status (`status`) | Same parameter names as the Assets screen. Switching tab removes the tab's filters, paging and sort from the address. New asset sits at the left of the bar. |
| Assets `/assets` | Type is now a multi-select (`typeId=4&typeId=5`; `assetTypeId[]` on the API) | Other filters unchanged. |

Shared pieces added for these screens:

- `shared/ui/grid-body.ts`, `tbody[mfGridBody]`: the loading, error and empty rows live inside the table body, so the column headers and the filter row stay on screen in every state (`mf-list-state` replaced the whole table). The first-run empty state keeps its action (`mfEmptyAction`), the filtered one offers Clear filters.
- `shared/filters/common-defs.ts`: `statusDef()` (Active default, "Archived" wording for Projects) and `matterColumnDefs()` (the Matters filters that Matters and a Client's Matters share).
- Test helper `fakeQuery()` in `shared/testing/org-testing.ts` feeds a page's `ListFilters` a query string.

API (query parameters, all `Contains`, parameterised, case-insensitive, `%` `_` `[` literal, combined with AND, max 200 characters; the list permission is unchanged):

| Endpoint | New parameters |
| --- | --- |
| `GET /clients` | `clientNumber` (digits the padded 5-digit number contains; anything else finds nothing), `name` |
| `GET /matters` | `matterRef`, `name`, `client` (client name, or digits the client number contains) |
| `GET /projects` | `name`, `matter` (Matter reference, typed pair or Matter name) |
| `GET /assets` | `assetTypeId` is repeatable (any of the given types) |
| `GET /asset-types` | `name` (the Asset Types page itself moves in Batch 4) |

All of these resolve inside the Organization / Assets modules, so no directory lookup is needed. A created-date range was left out (it needs the viewer's time zone and no Batch 2 grid shows a Created column). Pods, Workflows and Steps text parameters are left to Batch 4.

Screenshots of these screens (`<name>-<width>x<height>.png`): `clients-filters-closed`, `clients-filters-open`, `clients-filters-active`, `clients-empty-filtered`, `matters-more-filters`, `matters-filters-active`, `matters-chips-row-closed`, `projects-filters-open`, `client-matters-closed`, `client-matters-filtered`, `matter-assets-type-multiselect` (1366x768), `clients-closed`, `clients-sheet`, `clients-sheet-filtered`, `matter-assets-closed` (375x812). Regenerate with `E2E_SCREENSHOTS=docs/ux/column-filters/screenshots frontend/e2e/run-local.sh -g "column filters records screenshots"`.

Tests: unit specs for each page, `grid-body.spec.ts`, `common-defs.spec.ts`; e2e `column-filters-records.spec.ts` (filters, empty states, chips, sheet, tab switch, axe closed / open / filtered / empty / sheet); integration tests `OrganizationColumnFilterTests` and the Asset type tests in `AssetsApiTests`.

## Batch 4: administration

Issue #79 (Batch 4 of epic #75). Users, Pods, Task Types, Workflows, Workflow Steps, Asset Types and Audit Logs lost their standalone search boxes, status selects, the Steps tag popover and the Audit filter form, and use `mf-filters-bar` + `tr[mfColumnFilterRow]` like the record lists of Batch 2: the row is closed by default (remembered per screen and user, opened by a link that carries filters), chips and the Filters sheet at 375 px, polite result announcements, URL parameters, and loading / error / empty states inside `tbody[mfGridBody]` so the headers and the row never disappear. Roles, Priorities, Status labels, Link roles and Custom Fields keep no filters, as decided in the review.

| Screen | Filters (URL parameter) | Notes |
| --- | --- | --- |
| Users `/admin/users` | Name (`name`), Windows account (`account`), First seen (`registeredFrom`, `registeredTo`, presets Today / Last 7 / Last 30 / This month), Email (`email`), Roles (`roleId`, several), Availability (`availability`: `AVAILABLE`, `OUT_OF_OFFICE`, `OFF_HOURS`), Status (`status`) | **New Status column** (badge: Pending access, Active, Inactive) carries the Status filter. The default is Pending access while someone waits and Active otherwise, shown in the cell and never counted. The "N waiting for access" cue stays in the bar as a preset. Availability and Roles are worked out by the server; the 1000-user browser read is gone. The old `q` search is no longer read. |
| Pods `/admin/pods` | Name (`name`, the name only), Status (`status`, Active default) | `q` (name or description) still exists on the API. |
| Task Types `/admin/task-types` | Name (`name`), Request form (`form`: `published`, `draft`, `retired`, `none`), Status (`status`); `?workflow=<id>` stays a removable chip | The list loads whole, so these filters run in the browser (`LocalListPage.matchesFilters`). The "Filtered by workflow X: n task types" sentence stays, the chip is the one in the bar. |
| Workflows `/admin/workflows` | Name (`name`), Latest published (`hasPublished`), Draft (`hasDraft`), Status (`status`); `?taskType=<id>` and `?step=<id>` stay removable chips | `hasPublished` / `hasDraft` are tri-states: Any, Published / Not published, Has a draft / No draft. |
| Workflow Steps `/admin/steps` | Title (`title`), Description (`description`), Tags (`tags`, several, with counts) with **Match all tags / Match any tag** under it (`tagMatch`, idle until a tag is chosen), Used in (`used`), Status (`status`) | The tag options follow the Status filter. Match all is the default and is not counted. |
| Asset Types `/admin/asset-types` | Name (`name`), Status (`status`) | **Active is the default now** (it was All) and the state is in the address. Switching to the Link Roles tab drops the filters from the address. |
| Audit Logs `/admin/audit` | When (`from`, `to`, presets Today / Last 7 / Last 30 / This month in the viewer's zone), Who (`actor`, several people; the user id box without `User.View`), Event type (`eventType`) and Summary or field (`q`) stacked, Object type (`objectType`) and Object id (`objectId`, waits for a type) stacked; `correlationId` is a removable chip ("Operation: One operation") with the existing banner | Filters apply live (text after 300 ms, the others on change) and live in the address; there is no Apply / Reset. "Group events of one operation" stays in the bar. The Who list is the first 500 people of the user list (inactive ones marked); an actor in the address that is not in it still filters. Cursor paging ("Load more") is unchanged. |

API (all `Contains` parameters are parameterised, case-insensitive, `%` `_` `[` literal, combined with AND, max 200 characters; permissions unchanged):

| Endpoint | New parameters |
| --- | --- |
| `GET /users` | `name`, `account`, `email`, `roleId` (repeatable: any of the roles), `availability`, `registeredFrom`, `registeredTo` (`yyyy-MM-dd`, viewer's zone, To inclusive; 400 on a bad date, a reversed range or an unknown state). Availability is evaluated for the people the other filters left, in the list's order, and paged over that result. |
| `GET /pods` | `name` |
| `GET /workflows` | `name`, `hasPublished`, `hasDraft` |
| `GET /step-definitions` | `title`, `description`, `used` |
| `GET /audit/search` | `actor` is repeatable |

Positional callers of the generated client were updated (`listPods`, `listWorkflows`, `listStepDefinitions`, `listUsers`, `searchAuditEvents`). The Pods popover list, the task pickers and the workflow lookup pass `undefined` for the new arguments.

Shared pieces: `ServerListPage` reloads on the filters as text (a computed over `ListFilters.queryParams()`), so options that arrive later or a count in a label never reload the list by themselves; `LocalListPage.matchesFilters()` is the hook for browser-side filters; `triBool()` in `common-defs.ts` turns a tri-state filter into the API argument. `AssocFilter` shows only the "Filtered by ..." sentence now; its chip is the bar's. `ListFilters.watchOverflow` holds sheet mode until the grid area changes width: the filter row itself can be what makes a grid overflow (its controls have a minimum width) and it is not rendered in sheet mode, so without the hold the row and the overflow took turns on every frame (found on the Users grid at 1366 px, where a person with two pods and an availability chip already fills the width). On that grid the filters therefore move into the sheet when it overflows, as designed.

Screenshots (`<name>-<width>x<height>.png`): `admin-users-filters-closed`, `admin-users-filters-open`, `admin-users-roles-multiselect`, `admin-users-filters-active`, `admin-users-empty-filtered`, `admin-pods-filters-active`, `admin-task-types-filters-active`, `admin-workflows-filters-active`, `admin-steps-filters-active`, `admin-steps-tags-multiselect`, `admin-steps-tags-match-any`, `admin-asset-types-filters-open`, `admin-asset-types-filters-active`, `admin-audit-filters-closed`, `admin-audit-filters-open`, `admin-audit-when-presets`, `admin-audit-filters-active`, `admin-audit-empty-filtered` (1366x768) and `admin-users-closed`, `admin-users-sheet`, `admin-pods-closed`, `admin-pods-sheet`, `admin-steps-closed`, `admin-steps-sheet`, `admin-audit-closed`, `admin-audit-sheet` (375x812). Regenerate with `E2E_SCREENSHOTS=docs/ux/column-filters/screenshots frontend/e2e/run-local.sh -g "column filters admin screenshots"`.

Tests: unit specs for each page (URL to API arguments, row closed by default, defaults not counted, empty states inside the table), `common-defs.spec.ts`; integration tests `AdminColumnFilterTests` (every new parameter, literal wildcards, combination, bad input); e2e `column-filters-admin.spec.ts` (filters, empty states, chips, Match any, availability and roles on the server, live Audit filters, tab switch, axe closed / open / filtered / empty at 1366 and the sheet at 375 on all seven lists). The older e2e specs that used the removed boxes (`?q=` links, "Search users", the Audit form) were moved to the column filters.

## Batch 3: the work lists

Issue #78 (Batch 3 of epic #75). The Task Queue, My Work, Pod Work and the Tasks grids of a Matter and of a Project lost the "Filters" panel (`mf-work-filter-bar`, ten controls), the "Search title or ref" box and the standalone "Show: Open tasks / All tasks" select. Their filters are inline column filters under the headers of the shared task table (`mf-task-table`), driven by one `FilterDef[]` per screen (`queueFilterDefs()` in `shared/filters/queue-defs.ts`), with the same chips, "Other filters", Filters sheet, live region, print line and `/` shortcut as the other batches. The shared `QueuePageBase` keeps reading the address into a `QueueState` for the API (so dashboard links, the remembered view, sort, paging and tabs behave as before) and owns a `ListFilters` for the screen.

| Column | Control | URL parameter(s) | On screen |
| --- | --- | --- | --- |
| Ref and Title (one control across both) | text, "Title or Ref" | `q` | always |
| Matter | text: reference, the typed pair `343-12`, or name | `matterText` (new) | default |
| Client | text: name, or digits of the number | `clientText` (new) | chooser |
| Project | text: project name | `projectText` (new) | chooser |
| Task type, Workflow | multi-select | `type`, `workflow` | chooser |
| Priority | multi-select | `priority` | default |
| Pod | multi-select with "No pod" | `pod`, `noPod` | chooser (not on Pod Work) |
| Assignee | people with "Me" and "Unassigned" | `assignee`, `unassigned` | default (Task Queue, Pod Work) |
| Creator | people with "Me" | `creator` | chooser |
| Requestor | text | `requestor` | chooser |
| Due | date range with presets | `dueFrom`, `dueTo` | default |
| Status | multi-select; the three open statuses read "Open" | `status` | default |
| Created | date range | `createdFrom`, `createdTo` | chooser |
| Updated | date range | `updatedFrom`, `updatedTo` (new) | chooser |
| (no column) ASAP, Overdue | tri-states in Other filters | `asap`, `overdue` | Other filters |
| (no column) Closed | date range in Other filters | `completedFrom`, `completedTo` | Other filters |
| (link only) | removable chips with the record name | `client`, `matter`, `project` (ids) | chips |

Every parameter that existed keeps its name and meaning, so the 12 dashboard and Advanced-search link shapes still land on the same list (`queue-defs.spec.ts` and `dashboard-links.spec.ts` prove it). The people, task types and workflows offered come from `QueueChoices` (read once per session after the list has loaded, only with the permission each needs: Task.View for task types, User.View for people, Workflow.Manage for workflows) plus what is on screen, so nobody gets a 403 and a value in the address still filters.

### Behaviours that were decided for the work lists

- **Open by default.** The filter row starts open on Task Queue, My Work and Pod Work (remembered per user and screen); closed on a Matter's and a Project's Tasks, as on the other record lists.
- **Task Queue status.** A plain `/tasks` starts on the open statuses: the Status cell says "Open", it is not counted and is not a chip. A link that carries any filter and no `status` still means every status, exactly as such links always did (`FilterDef.defaultOnlyBare`; the cell then says "All" and a chip takes it back). Choosing a filter on a plain link keeps the open statuses in the address (otherwise the link would read as "every status" and the list would widen by itself), and Clear filters returns to the plain link. Sorting, paging and the quick views follow the same rule (`ListFilters.keepBareDefaults`, `toQueryParams(..., { explicitStatus })`).
- **My Work, Created by me status (#186).** The tab starts on the open statuses with the same rule as the Task Queue: a plain `?view=createdByMe` means Open (the Status cell says "Open", no chip), a link with other filters and no `status` means every status, and "All" is written as `status=`. The API follows the same convention without a new parameter: `GET /my-work` with no filter at all counts Created by me as its open tasks (`TaskQueueFilter.IsBare` in `MyWorkAsync`), any other filter without a status means every status, and the page sends "All" as every status written out. The Open default is the tab's own: it is not carried to another tab, and the count of Created by me reads the same on every tab (plain request: open tasks only).
- **Quick views are presets.** All open, Unassigned, My pod, Created by me, Overdue and Recently completed write their column filters (`ListFilters.applyPreset`, so they show in the row and as chips and can be removed one by one); a manual change un-presses them. All open is the plain link.
- **Restored view.** A bare `/tasks` or `/my-work` still opens on the view the user last used and now says so ("Restored your last view", with Reset to default and Dismiss). The default view is never called restored; "every status" is a view of its own.
- **Tabs stay tabs and own columns.** My Work: Assignee is disabled ("This tab lists the tasks assigned to you") on Active, Due soon and Completed; Creator is disabled on Created by me; Due, ASAP and Overdue are disabled on Due soon (the tab is the window); the Status choices follow the tab (open ones, closed ones, all). Pod Work: Pod is the scope (the picker), not a filter; Assignee is disabled on the Unassigned tab; "Show tasks" on By member sets the Assignee filter. A disabled filter is shown with the reason as tooltip and description, is not counted, has no chip and is not sent to the API. **Changing tab drops the filters the new tab owns** (and statuses it cannot show) and keeps the rest.
- **Tab counts.** The existing design is unchanged: every count is worked out under the same filters (`TaskQueueService.MyWorkAsync` / `PodWorkAsync`), the Completed tab's closed-date window (90 days or the user's range) belongs to the Completed tab only, and a count never depends on which tab is open. Because the tab-owned filters are dropped when the tab changes, no count mixes filters that are only valid on one tab. Covered by `MyWorkAndPodWorkApiTests` (the closed-date regression) and `TaskQueueColumnFilterTests` (the new parameters, on every tab).
- **Hidden columns.** A filter on a column the user hid (or the table folded away on a narrow window) stays active and shows as a chip with "(hidden column)" and "Show column"; Other filters lists the filters without a column or on hidden columns. The table reports the columns it really shows (`columnsShown`).
- **States.** Loading, error and empty are rows of `tbody[mfGridBody]` (the skeleton rows are gone), so the headers and the filter row never disappear. With rows already on screen a reload dims them and an error keeps them under an alert with Retry.
- **Toolbar.** The quick views (Task Queue), the chips, Clear filters, "Sorted by", Columns, Other filters and Filters are one bar (`mf-filters-bar`) above the grid. My Work and Pod Work keep their tabs on their own row above it; the bar is inside the tab panel.
- **Matter and Project grids.** `mf-scoped-tasks` has Title or Ref, Project (a choice of the Matter's projects; not on a Project's own page), Priority, Assignee, Due and Status (Open by default, so the old "Show: Open / All tasks" select is the Status filter now). The filters live in the address (`q`, `status`, `project`, `priority`, `assignee`, `unassigned`, `dueFrom`, `dueTo`); the Matter page drops them when another tab is chosen. Paging and sorting stay in the page.

### API

`GET /task-queue`, `/my-work` and `/pod-work` accept (all `Contains`, parameterised, case-insensitive, `%` `_` `[` literal, AND with the rest, max 200 characters; unknown parameters are still a 400):

| Parameter | Meaning |
| --- | --- |
| `matterText` | contained in the Matter reference (`00343-00012`, or the typed pair `343-12`) or the Matter name |
| `clientText` | contained in the Client name, or digits contained in the Client number |
| `projectText` | contained in the Project name (a Task without a Project never matches) |
| `updatedFrom`, `updatedTo` | last updated in the range (`yyyy-MM-dd`, the viewer's zone, To inclusive); a Task never updated never matches |

They are conditions inside the existing reads (subqueries on the small Matter, Client and Project tables), not extra reads and not id lists, so the number of SQL statements per page is unchanged; `TaskQueuePerformanceTests` measures them at 5,000 tasks: 60 to 120 ms per page for every combination (Matter, Client, Project text, Updated, all together, My Work and Pod Work), 5 SQL statements per Task Queue page, the same as the unfiltered page. The generated client and `contracts/openapi/v1.json` were regenerated; the positional arguments of `getTaskQueue`, `getMyWork` and `getPodWork` gained five entries before `sort` (`queueArgs()` and the Matter / Project grid were updated).

### Tests

- Unit: `queue-defs.spec`, `list-filters-bare-default.spec` (the default that only a plain link gets, value groups), `queue-filters.spec`, `last-view.spec`, `quick-views.spec`, `queue-choices.spec`, `task-table.spec`, `work-list.spec`, and the three page specs (`task-queue-page`, `my-work-page`, `pod-work-page`) and the Matter / Project page specs. The page specs wait for the page itself (`vi.waitFor` on the table) instead of a fixed number of timer ticks: the old spec "puts the search box and Filters on the tab row..." was flaky under load because it asserted right after `whenStable()`, and on a busy machine the first render of a routed page can still be pending then. Every page spec now waits for a structural element that exists in every state.
- Integration: `TaskQueueColumnFilterTests` (every new parameter, literal wildcards, combinations, bad input, the counts on every tab for each new filter, the closed-date window with a column filter, Pod Work summary unchanged) and a performance case in `TaskQueuePerformanceTests`.
- E2E: `column-filters-work-lists.spec.ts` (Task Queue filters on the server, default status and deep links, presets, restored view, hidden-column chips, Other filters, loading / error / empty rows, `/`, My Work tab ownership and counts, Pod Work scope, Matter and Project grids, the 375 px sheet, axe closed / open / filtered / empty at 1366 and the sheet at 375 on all four grids). The older specs that used the removed controls were updated (`queues.pages.ts` `search()` is the Title or Ref filter now; `assignment-and-views`, `fixed-header`, `dashboard-audit`, `ux-round-4`).

Screenshots (`<name>-<width>x<height>.png`): `work-queue-filters-open`, `work-queue-priority-multiselect`, `work-queue-due-daterange`, `work-queue-more-filters`, `work-queue-filters-active`, `work-queue-hidden-column-chips`, `work-queue-chips-row-closed`, `work-queue-quick-view-overdue`, `work-queue-empty-filtered`, `work-queue-restored-notice`, `my-work-active`, `my-work-created-by-me`, `my-work-due-soon`, `pod-work-unassigned`, `pod-work-by-member`, `matter-tasks-filters-open`, `matter-tasks-filtered`, `admin-users-availability-select` (1366x768) and `work-queue-closed`, `work-queue-sheet`, `work-queue-sheet-filtered`, `work-queue-chips`, `my-work-closed`, `my-work-sheet` (375x812). Regenerate with `E2E_SCREENSHOTS=$PWD/docs/ux/column-filters/screenshots frontend/e2e/run-local.sh -g "column filters work lists screenshots"`.

### Also in this change

- The Availability select in the Users filter row (Batch 4) clipped "Out of office": the select in a filter row now has tight side padding (`.cf__select`), so the widest choice and the arrow fit the column it already had. (Widening the column was tried first: it makes the Users grid overflow into the sheet more often, which is the wrong trade.) `admin-users-availability-select-1366x768.png` shows it.
- Quick view buttons no longer render `title="null"` when they have no tooltip.
- The work table's header row is exactly 40 px when the filter row is shown (the filter row sticks under it at 40 px), and Columns is the same 32 px as Filters and Other filters.
- A text filter in the work table fills its cell and no longer asks for room: an input's own preferred width (20 characters) had widened the Matter column and squeezed the Title into two lines (6 rows instead of 8 on screen at 1366x768); the table sizes its columns by their content, unlike the record lists, which use a fixed layout.
- Tests that were flaky or tied to a layout accident: the Users e2e tests ran on a grid that is borderline at 1366 px (they asserted "closed by default" through the sheet fallback); they use 1600 px and a plain link now. The Audit smoke test opened an event row while the live Object id filter was still about to reload the list; it waits for that load.

### Deferred

- ASAP and Overdue are in Other filters, not stacked under Due: a second and third control in the 40 px row would cost the grid the height this batch spends on the row. The date presets of the Due filter are the shared ones; "Overdue" and "Next 7 days" are quick access through the preset and the ASAP / Overdue filters.
- The funnel icon in the header of a filtered column, filter by value from a cell, saved views and facet counts are Batch 5.

## Matter and Client columns of the work lists (TQ-WP8, #197, #198)

- The Matter column of the Task Queue, My Work and Pod Work is the shared `mf-matter-cell`: line 1 the reference (a link only with `Matter.View`) and the sensitive marker, line 2 the matter name (muted, one line, ellipsis, "(inactive)" appended). Compact shows line 1 only; the tooltip is `Client . Matter name`. The Matter filter in the filter row is unchanged (`matterText`).
- The Client column is a plain one-line cell with a tooltip and is not in any default set (one click in Columns). The Matter and Project task grids (`hideContext`) have neither column.
- Default sets: Task Queue and Pod Work: Ref, Title, Matter, Priority, Assignee, Due, Status; My Work Active and Due soon and overdue: Ref, Title, Matter, Progress, Priority, Due, Status; Created by me adds Matter; Closed is unchanged. A filter on a hidden Matter column still shows as a chip.
- Stored sets: the one-time migration (`mf.work-columns.v3.migrated.<page>.<userId>`) inserts Matter into My Work sets that lack it; Task Queue and Pod Work sets are kept and the notice offers "Add Matter column".
