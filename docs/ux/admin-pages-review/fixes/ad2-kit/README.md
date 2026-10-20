# Admin list kit (WP-AD2 lane A: core #542, #543, #544, #554, #545; second batch #575, #579, #581, #583, #564, #588, #631)

The shared parts that every Administration list is built from. The Users, Assets (data) and Search epics reference this page and the
issue numbers instead of building their own chrome. Paths are under `frontend/src/`. **No keyboard shortcut is added or changed** (owner
decision, Phase 2 backlog #420); the skip link and focus rules are accessibility mechanisms, not shortcuts.

Proof of use: the Task Types administration (`/admin/task-types`, `/admin/workflows`, `/admin/steps`) now renders in `mf-admin-list-shell`
with counted tabs from `AdminTabCounts` (its lists keep their own "Skip to table" target from the Task Types keyboard audit, #413, so the Task Types shell passes no `tableId`). The grid classes, `rowActions()` and the new dialog
wording are proven by their specs and by the e2e fixture `ad2-kit-grid`; the Labels, Asset Types, Link Roles, Custom Fields and Audit pages
move onto them in their own issues.

| Part | Issue | File |
|---|---|---|
| Dialog wording and impact lines | #542 | `app/features/admin/shared/dialog-copy.ts` |
| The 44 px grid stylesheet | #543 | `styles/_admin-lists.scss` |
| List shell `mf-admin-list-shell` | #544 | `app/shared/ui/admin-list-shell.ts` |
| Row overflow `rowActions()` | #554 | `app/shared/ui/row-actions.ts` |
| Counted tabs `AdminTab`, `AdminTabCounts` | #545 | `app/features/admin/admin-tabs.ts` |
| `AdminListState`, `AdminColumn`; grid-body `columnSpec`, `errorRef`; card list `filters`, `errorRef` | #575 | `app/shared/ui/admin-list-state.ts`, `grid-body.ts`, `record-card-list.ts`, `error-reference.ts` |
| `mf-admin-card-list`, `AdminCardSpec`, `columnDropOrder` | #579 | `app/shared/ui/admin-card-spec.ts` |
| `stripItems`, `stripActiveKey`, `stripPick`, `mf-work-strip [segments]` | #581 | `app/shared/ui/strip-items.ts`, `app/shared/work-queue/work-strip.ts` |
| The control rule, `mf-text-field [counter]`, `ADMIN_FIELD_LIMITS`, `.mf-control--fill` | #583 | `styles/_admin-lists.scss` (header), `styles/_forms.scss`, `app/shared/ui/text-field.ts`, `app/features/admin/shared/field-limits.ts` |

## 1. Dialog wording (#542)

`dialogCopy.<kind>(facts)` returns `{ title, body, confirm, cancel, danger }`; `impactLine(kind, facts)` returns the sentence. Pages never
spell dialog text. A number the API did not return (`null`, `undefined`) leaves its sentence out; a known zero is an answer ("No open
task uses this priority.").

| Kind | Facts | Title / confirm / cancel | Body (with all numbers) |
|---|---|---|---|
| `deactivateAssetType` | `assets` | Deactivate asset type? / Deactivate asset type / Keep active | 12 assets keep this type. It won't be offered for new assets. You can activate it again. |
| `deactivatePriority` | `openTasks` | Deactivate priority? / Deactivate priority / Keep active | 31 open tasks keep this priority. It won't be offered for new or changed tasks. You can activate it again. |
| `deactivateLinkRole` | `links` | Deactivate link role? / Deactivate link role / Keep active | 14 links keep this role. It won't be offered for new links. You can activate it again. |
| `deleteUnusedPriority` | `openTasks` | Delete priority? / Delete priority / Keep priority | No task uses this priority. Deleting it can't be undone. |
| `deleteUnusedLinkRole` | `links` | Delete link role? / Delete link role / Keep link role | No link uses this role. Deleting it can't be undone. |
| `setDefaultPriority` | `name`, `previousName` | Make Normal the default priority? / Set as default / Keep current default | Normal is the default priority. New tasks start with it. High stays available. |
| `renameStatusLabel` | `code` | Rename status label / Save name / Cancel | Only the name changes. The code IN_PROGRESS and every task's status stay as they are. (helper text) |

Rule: Deactivate/Activate everywhere; Delete only for Priorities and Link roles, only when unused, only in the row overflow. The safe button
is the cancel one and takes the default focus (`mf-confirm-dialog`). `ImpactFacts` gained `assets`, `links`, `name`, `previousName`, `code`.

## 2. Grid contract (#543)

```html
<div class="mf-table-wrap">
  <table class="mf-grid" id="asset-types-table">
    <caption class="mf-sr-only">Asset types</caption>
    <thead><tr>
      <th class="mf-cell-name" scope="col">Name</th>
      <th class="mf-cell-num" data-drop="1100" scope="col">Assets</th>
      <th class="mf-cell-badge" scope="col">Status</th>
      <th class="mf-cell-date" data-drop="900" scope="col">Updated</th>
      <th class="mf-cell-muted" data-drop="1280" scope="col">Note</th>
      <th class="mf-cell-actions" scope="col"><span class="mf-sr-only">Actions</span></th>
    </tr></thead>
    <tbody>
      <tr>
        <td class="mf-cell-name"><a class="mf-name" [routerLink]="..." [title]="t.name">{{ t.name }}</a><span class="mf-desc" [title]="d">{{ d }}</span></td>
        ...
        <td class="mf-cell-actions"><mf-action-menu [floating]="true" [label]="m.label" [items]="m.items" /></td>
      </tr>
    </tbody>
  </table>
</div>
```

- Rows are **exactly 44 px** (18 px lines, 2 px padding above and below): a cell holds 39 px at most.
- `mf-cell-name`: the only link of the row; `.mf-name` is clamped to 2 lines, to 1 line when a `.mf-desc` (one muted clipped line) sits under it; the
  full text is the `title`. It is the spring column (takes the spare width, at least 14rem).
- `mf-cell-num` right aligned with tabular figures (header too); `mf-cell-badge` and `mf-cell-date` never wrap; `mf-cell-muted` one clipped line, 14rem.
- `mf-cell-actions`: last, sticky at the right edge, a 44 px wide target holding ONE `mf-action-menu`; the filter row's last cell follows it.
- **Column drop**: `data-drop="N"` (N is one of 640, 768, 900, 1100, 1280) on the th and every td (also the filter-row and skeleton cells) hides the column
  when the **window** is narrower than N px. Never the actions cell, never the name. Give the least useful column the largest N. Below 640 px a list is
  cards (#579).
- Empty, no-match and error rows (`mf-grid-body`, class `gb-state`) share one height (9rem). No second scroll box inside a page that scrolls:
  `mf-table-wrap` is the only horizontal one.
- No new colour or token. The legacy `.grid`, `.pg-table`, `.au-table` stay until #658 deletes them; `mf-col-menu` / `mf-has-menu` of the Task Types
  lists are the same rules as `mf-cell-actions`.

## 3. List shell (#544)

```html
<mf-admin-list-shell
  heading="Asset Types" icon="pi pi-tags"
  description="One line, 90 characters at most."
  [crumbs]="null" [tabs]="tabs()" [tab]="current()" [counts]="null" idPrefix="assets-admin"
  [filters]="filters" controls="asset-filter-row" [clearAlso]="['q']"
  tableId="asset-types-table"
  (tabChange)="select($event)">
  <p-button mfPrimary label="New asset type" icon="pi pi-plus" />
  <mf-work-strip mfStrip ... />
  <div class="mf-table-wrap"> <table id="asset-types-table" class="mf-grid">...</table> </div>
</mf-admin-list-shell>
```

| Input | Meaning |
|---|---|
| `heading` (required), `icon` | The H1 and its PrimeIcons classes (default: the section icon). |
| `crumbs` | Default `Administration > <heading>`; pass your own trail or `[]`. |
| `description` | One line, 90 characters at most; the page header shows it on one line (ellipsis, full text as tooltip). |
| `tabs`, `tab`, `tabsLabel`, `idPrefix` | `mf-tabs` items (build with `adminTabItems`), the open key, the tab list name, the id prefix (`<prefix>-panel` is the tab panel). Fewer than two tabs render no strip. |
| `counts` | Optional map `{ [tabKey]: number \| null }`: number = active records ("Label, n active"), `null` = `--`. `AdminTabCounts.snapshot` fits. `adminTabItems` already applies counts, so use one of the two. |
| `filters`, `controls`, `clearAlso` | The list's `ListFilters`: the header shows `mf-list-filters-button` (count, and the one Clear filters while the row is open). Open by default from 640 px, remembered per user, a sheet below 640 (all `ListFilters`). Omit for a list without filters. |
| `tableId`, `skipLabel` | Id of the table; registers "Skip to table" as the first Tab stop through the `SkipTarget` contract of #586 (the shell's body region is the element the link names; visible on focus, drawn by the app shell). A list that registers its own target (`registerTableSkip`) replaces it: then omit `tableId`. Focus moves to that element (`tabindex=-1`, named by the heading when it has no name); on a phone to the first card link; when the table is not there (loading, error) to the empty/error message or the body. |
| Output `tabChange` | The key the person chose; the page navigates. |
| Slots | `mfPrimary` (the primary action, last/right, after Filters), `mfStrip` (above the body, below the tabs), default (the body). |

The shell is a fixed-header page (`mf-fixed-page`): header, tabs and strip stay, the body scrolls; below 768 px or 561 px high the page scrolls
normally. The host is `display: contents`, so the shell must be the page's direct child. `page-header.ts` was not changed.

## 4. Row overflow (#554)

```ts
const menu = rowActions(row.name, [
  { id: 'edit', label: 'Edit', icon: 'pi-pencil', run: () => ..., permission: 'AssetType.Manage' },
  { id: 'up', label: 'Move up', run: ..., reason: first ? 'Already first' : undefined },
  { id: 'deactivate', label: 'Deactivate', kind: 'state', run: ... },
  { id: 'delete', label: 'Delete', danger: true, reason: 'Used by 31 tasks. Deactivate it instead.', run: ... },
], { can: (p) => auth.has(p) });
```
```html
<mf-action-menu [floating]="true" [label]="menu.label" [items]="menu.items" />   <!-- "Actions for <name>" -->
```

Order: primary entries, then the state change, then the danger entry (set apart, red on the item only, never a red text link in the row). An entry with a
`reason` is disabled and the reason is **on screen** under its label and read out with it (no `title`). An entry whose `permission` (any of) the person lacks
is not offered; no entries means no menu. One Tab stop per row; arrows move, Esc closes and returns focus to the button (`mf-action-menu`). `floating` keeps it in
view at the last row. `action-menu.ts` was not changed.

## 5. Counted route tabs (#545)

```ts
const TABS: AdminTab[] = [
  { id: 'priorities', label: 'Priorities', route: '/admin/priorities', permission: ['Priority.Manage'], countKey: 'priorities' },
  { id: 'status-labels', label: 'Status labels', route: '/admin/status-labels', permission: ['StatusLabel.Manage'], countKey: 'status-labels' },
];
@Component({ providers: [AdminTabCounts] })
class LabelsPage {
  counts = inject(AdminTabCounts); auth = inject(AuthStore);
  can = (p: string) => this.auth.has(p);
  tabs = computed(() => adminTabItems(TABS, this.can, this.counts.snapshot()));   // [tabs] of the shell
  current = computed(() => resolveAdminTab(TABS, this.tab(), this.can)?.id);      // falls back to the first allowed tab
  constructor() { void this.counts.start(TABS, { priorities: () => ..., 'status-labels': () => ... }, this.can); }
}
```

- `AdminTab { id, label, route, permission[] (any of; empty = everyone), countKey? }`; a hidden tab is never built, one allowed tab renders no strip.
- `adminMenuTarget(TABS, can)` is the route of the first tab the person may open: the target of a sidebar item (BUG-1). The sidebar wiring itself is in the app shell
  files (`nav-items.ts`), which belong to the app shell epic; the Labels issue (#523/#593) calls this function.
- `AdminTabCounts.start(tabs, loaders, can)` asks once per page, one quiet request per allowed tab (a loader must start its request synchronously:
  `() => firstValueFrom(api.list()).then(...)`); `count(key)` is a signal (`'--'` while loading or after a silent failure, else the number of ACTIVE
  records, zero included); `refresh(key)` asks again after a create/deactivate; `set(key, n)` and `AdminTabCounts.report(key)` let the open tab report its own number; `snapshot` feeds the shell.
- The Task Types `AdminCounts` extends it (same behaviour, three loaders) and `TASK_TYPES_TABS` is its tab data.
- `resolveAdminTab` uses `firstAllowedTab` of `denial.ts` (the #416 rule).

## 6. List states (#575)

```ts
readonly ls = adminListState({ state: this.state, rows: this.rows, filters: this.filters, hidden: this.hiddenCount });
readonly columnSpec: AdminColumn[] = [ { cls: 'mf-cell-name', bone: '12rem' }, { cls: 'mf-cell-num', bone: '2rem', drop: 1100 }, ... ];
```
```html
<tbody mfGridBody noun="asset types" [columnSpec]="columnSpec" [filters]="filters" [state]="ls.state()" [empty]="ls.empty()"
       [filtered]="ls.filtered()" [hidden]="ls.hidden()" hiddenLabel="inactive" [errorRef]="null"
       (retry)="load()" (clear)="clear()" (showAll)="showAll()"> ...rows... </tbody>
```

- `adminListState({ state, rows, filters?, filtered?, hidden? })` derives `state`, `empty`, `filtered`, `hidden` and `view` (`loading | forbidden | error | empty |
  no-match | rows`; the pure rule is `adminListView`) from the page's signals. Bind the same object to the table body and to the phone cards, so they cannot disagree.
- `AdminColumn { cls?, bone?, drop? }`: one list of the real columns. `tbody[mfGridBody] [columnSpec]` takes the column count, the bone width, the cell
  class and the `data-drop` of each column from it, so the skeleton has the shape of the loaded table and drops the same columns at the same widths
  (`columns`, `skeleton`, `skeletonCells` still work).
- The states: loading = five 44 px skeleton rows and one polite "Loading ..."; error = one message with the reference (copyable) and Retry, no toast; forbidden
  (403) = "You don't have access to ..." without Retry; empty = the first-run text with **no second New button** (the header's primary action is the only one;
  `[mfEmptyAction]` stays for lists that really want one); no-match = "No ... match these filters" with **Clear filters**, and, when the default Status hides
  records, "n inactive hidden" with **Show all**. Pass `[filters]` (to the grid body and to the card list) so the bar above shows no second Clear filters (RR-10).
- `[errorRef]` shows an explicit reference (an error that did not come through the HTTP layer); by default the last reference the server sent (`mf-error-reference` got a
  `reference` input for it).
- `mf-record-card-list` got `filters` and `errorRef`, so the cards follow the same rules.
- Proof of use: the Task Types list (`/admin/task-types`) builds its states with `adminListState` and its skeleton from `columnSpec`.

## 7. Phone cards and the column-drop order (#579)

```ts
readonly drop = columnDropOrder(['note', 'updated', 'assets']);     // { note: 1280, updated: 1100, assets: 900 }: the first leaves first
readonly cardOf = (r: Row): AdminCardSpec => ({
  title: r.name, link: ['/admin/asset-types', r.id], rowKey: r.id, state: this.leave.state(),
  subtitle: r.description,                                     // muted line under the name
  badges: [activeCardBadge(r.isActive)],                       // or { text, tone, icon }
  meta: ['Not used', { text: '3 assets', link: { commands: ['/assets'], queryParams: { type: r.id } } }],   // subtitle + meta: 3 lines at most
  actions: rowActions(r.name, [...], { can }),                 // the SAME menu as the table row
});
```
```html
@if (phone()) {   <!-- phoneCards(): below 640 px -->
  <mf-admin-card-list noun="asset types" label="Asset types" [items]="rows()" [spec]="cardOf" listId="admin-asset-types" [filters]="filters"
    [state]="ls.state()" [empty]="ls.empty()" [filtered]="ls.filtered()" [hidden]="ls.hidden()" (retry)="load()" (clear)="clear()" (showAll)="showAll()">
    <p-button mfEmptyAction label="..." />   <!-- optional -->
  </mf-admin-card-list>
} @else { <div class="mf-table-wrap"> ...table... </div> }
```

- A card is the name (the one link, the whole card is its target, two lines at most), the badges top right, up to three muted lines, and the row overflow. Cards are 2 to 4 lines
  tall; the table is kept from 640 px (`phoneCards()` is true below 640). `mf-admin-card-list` is `mf-record-card-list` + `mf-record-card` driven by data, so the stretched link, the focus ring, the
  44 px targets, Back-to-list focus (`listId`, `rowKey`) and the states are those of Clients (#275-#278, #374).
- `AdminCardBadge { text, tone?, icon?, active? }`: `activeCardBadge(bool)` draws `mf-active-badge` (same words and icon as the table). `AdminCardLine { text, link?, warn?, attrs? }`; `attrs` puts `data-*` hooks on the line.
- `columnDropOrder(ids)` gives the `data-drop` of each optional column (thresholds 1280, 1100, 900, 768, 640, at most five): the first id leaves first. The name, the status and the
  actions are never listed. Put the value on the th, every td, the filter cell and the skeleton cell (`AdminColumn.drop`).
- Proof of use: the Workflow Steps list (`/admin/steps`) renders its cards through `mf-admin-card-list` (its former `data-used-in-link` and `data-card-inputs` hooks are `attrs`).

## 8. Health strip helper (#581)

```ts
const defs: StripDef<AssetType>[] = [
  { key: 'active', label: 'Active', matches: (t) => t.isActive, params: { status: null } },
  { key: 'noFields', label: 'No published fields', hint: '...', matches: (t) => t.isActive && !t.fieldCount, params: { status: null, fields: 'none' } },
  { key: 'inactive', label: 'Inactive', matches: (t) => !t.isActive, params: { status: 'inactive' } },
];
readonly strip = computed(() => stripItems(this.state() === 'ready' ? this.all() : null, defs, { mode: 'chips' }));
readonly stripActive = computed(() => stripActiveKey(defs, (p) => this.address(p)));        // address(p): the value as `params` writes it, null when absent/default
pick(key: string) { const to = stripPick(defs, key, this.stripActive(), { mode: 'chips' }); if (to) this.navigate({ ...to.params, page: null }); }
```
```html
<mf-work-strip label="Asset types summary" [items]="strip()" [interactive]="true" [active]="stripActive()" [segments]="false" (pick)="pick($event)" />
```

- `stripItems(list, defs, { mode })` -> `WorkStripItem[]`: counts over the whole loaded list in the browser (no filter applies), `null` (shown `--`, width reserved) while loading, zero stays in place and muted.
- **chips**: counts that are toggles (as Task Types #367); the pressed chip pressed again goes back to the first item (or `home`). **segments**: one status choice, exactly one pressed
  (Pending / Active / Inactive / All, Users WP U-2); pressing the pressed segment keeps it; segments are never `alert`. Pass `[segments]="true"` to `mf-work-strip` for the connected-group look (same tokens; on a phone the segments share the row).
- `StripDef.params` is what the item writes to the address (`null` = absent/default); every parameter of the strip is cleared by the items that do not name it. `stripActiveKey` finds the item the address stands for exactly,
  `stripPick` returns `{ key, params }` for the page's navigate. `inert: true` is a plain count beside the toggles.
- Proof of use: the Task Types strip (chips) is built with these functions; the segment mode is proven by `strip-items.spec.ts` (a host with the real `mf-work-strip`) until the Users list adopts it.

## 9. Control rule (#583)

The rule is written in the header of `styles/_admin-lists.scss`. In short: inputs are `.mf-control` (`--fill` for the whole width, `--compact` only in a row or toolbar), or `mf-text-field` where a labelled
field exists (the same look); every limited text field has its counter (`[counter]="true"` on `mf-text-field`, or `mf-char-counter`) with the API's limit from `ADMIN_FIELD_LIMITS`; buttons are `p-button`
(primary, `severity="secondary"`, `[text]="true"`; danger only in a confirm dialog); a row has its name link and one overflow menu, never a button or a red text link.

- `mf-text-field [counter]` shows "n / max" (polite announcement near the limit) under the field and adds it to `aria-describedby`; it needs `maxLength`. Off by default, so older forms are unchanged.
- `ADMIN_FIELD_LIMITS`: asset type name 100, asset type description **500** (the API column; the issue text said 1000), link role 50, priority label 50, status label 50.
- Proof of use: the Workflow Step form (`/admin/steps/new`) counts Title (200) and Description (1000).

## Tests

Unit (second batch): `admin-list-state.spec.ts`, `admin-card-spec.spec.ts`, `strip-items.spec.ts`, `text-field.spec.ts`; `steps-pages.spec.ts` and the Task Types specs stay as they were.
E2E (second batch): `ad2-kit-lists` (hidden-count line with Show all at four widths, skeleton columns, Steps cards 2 to 4 lines with the table's menu entries and the 639/640 boundary, keyboard flow, Task Types chips).

Unit: `dialog-copy.spec.ts`, `admin-list-shell.spec.ts`, `row-actions.spec.ts`, `admin-tabs.spec.ts`, `admin-counts.spec.ts`, `task-types-admin-page.spec.ts`.
E2E: `ad2-kit-grid` (every cell pattern, 44 px rows, column drop, sticky actions, axe incl. target-size at 1920/1366/1024/768/375),
`ad2-kit-shell` (the shell on Task Types: header lines, skip link, counted tabs, one Clear, permission variants, axe with the row menu and the sheet open).
