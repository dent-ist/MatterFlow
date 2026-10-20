# Admin list kit, core (WP-AD2 lane A: #542, #543, #544, #554, #545)

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

## Tests

Unit: `dialog-copy.spec.ts`, `admin-list-shell.spec.ts`, `row-actions.spec.ts`, `admin-tabs.spec.ts`, `admin-counts.spec.ts`, `task-types-admin-page.spec.ts`.
E2E: `ad2-kit-grid` (every cell pattern, 44 px rows, column drop, sticky actions, axe incl. target-size at 1920/1366/1024/768/375),
`ad2-kit-shell` (the shell on Task Types: header lines, skip link, counted tabs, one Clear, permission variants, axe with the row menu and the sheet open).
