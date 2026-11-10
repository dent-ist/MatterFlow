# Administration > Lists: UI design spec (#1315, epic #1314)

One Administration page, **Lists**, for every admin-maintained list of choices, with a master-detail layout (a catalogue of lists on the left, the list's editor on the right). **Custom Fields stays its own page**, cross-linked both ways (variant A of the approved mockup). Built from `docs/ux/admin-lists/mockup.html` (same folder; commit 0f1ab05 of branch `admin-lists-mockup`) and checked against the code on `origin/dev` (d5418ae). Follows `docs/ux/design-guidelines.md` (D-xx). Desktop only, 1366x768 and 1920x1080 (D-82). **No new or changed keyboard shortcut** (#420).

**Status of the new pattern:** the master-detail catalogue is drafted as **D-44y** in `design-guidelines.md`, marked *pending owner approval* (guidelines section 7). Frontend work (#1317 to #1320) does not start before the owner approves it.

## 0. Owner decisions (fixed, from epic #1314 and its go comment)

1. Page and nav name **Lists**. 2. **No read-only view**: nobody reaches a list they cannot edit; no new permission. 3. Delete and deactivate rules **stay per list as today**; no new delete endpoints. 4. Note Tags stay gated by `StatusLabel.Manage`. 5. Asset Types keeps its own page with one tab (Link Roles moves to Lists). 6. Old addresses keep working by redirect. 7. Two pages, Lists and Custom Fields, cross-linked.

### 0.1 Corrections to the mockup (found while reading the code)

The mockup and its README said "only Matter Lists have Delete when In Use is 0". **Delete already exists today for 6 of the 8 lists**: Matter Types, Current States, Team Titles, Priorities, Note Tags and Link Roles (409 `IN_USE` when used; Priorities also 409 `DEFAULT_REQUIRED` for the default). Only **On-Hold Reasons** has no delete, and **Status Labels** have neither create nor delete (five fixed rows). The backend check (`backend-notes.md`, #1316) confirms it. This spec follows the code, i.e. "as today" (owner decision 3): the editor shows Delete only where the list supports it, and only when the item is unused. Other deliberate deviations from the mockup, all to reuse today's components and keep the guidelines:

| Mockup | This spec | Why |
| --- | --- | --- |
| Generic "In Use" column with "14 matters" | Today's count column per list, number only, heading = the unit ("Matters", "Team Members", "Open Tasks", "Tasks", "Notes", "Links") | the editors already exist; a 160 px "n unit" column would push the Name below its 200 px minimum with a Color column at 1366 (section 4.2) |
| "Shown on" as chips | One muted sentence "Shown on: ..." | a fifth chip look is not allowed (D-12) |
| Editor title 18/700 | 16/600 section heading | D-11 |
| "New" badge on the nav item | none | a mockup device |
| Per-list rule line invented for all lists | each list keeps its existing one-line sentence (`LABEL_TAB_TEXT`, `ASSET_TAB_TEXT`, matter list text); Matter Lists get one new sentence | no new rules wording where code has it |

## 1. Navigation

- **New item "Lists"** in the Administration group, icon `pi-list` (page icon key `lists`, one registry, D-17), path `/admin/lists`. Order: Users, Task Types, **Lists**, Asset Types, Custom Fields, Report Setup, Audit Logs, Settings (it takes the place of Labels).
- **Shown when the person holds any of** `Priority.Manage`, `StatusLabel.Manage`, `OnHoldReason.Manage`, `MatterList.Manage`, `AssetType.Manage` (same "any permitted" rule as today's Labels item, `adminMenuTarget`). Target = `/admin/lists/<first permitted list>`.
- **Removed: "Labels" and "Matter Lists"** (the items, their `alsoActive` lists and their rail names). "Asset Types" loses `alsoActive: ['/admin/asset-link-roles']`. "Custom Fields" is unchanged. The rail tooltip comes from the item label through the existing `mfNavTip` (`data-tip="Lists"`); nothing new to build. The first admin item shown for a person is chosen by the existing rule (`/admin` landing and the landing spec of #1331 name the item "Administration", not a list).
- Page title (browser tab and route announcer): **"Lists: <List Name>"** (`pageTab('Lists', 'Priorities')`, like "Users: Roles"); with no list "Lists". Crumb: **Administration > Lists**.

## 2. The page at 1366 and 1920

`mf-page-header` (D-21): tile with `pi-list`, H1 **Lists**, one-line description **"The choices people pick from in forms and filters."** (87 characters, at most 90), no actions in the header (each list's New button is in the editor header). Breadcrumb row above. Then, when needed, the old-link notice (section 6.3). Then the body.

```
[tile] Lists   The choices people pick from in forms and filters.
+-- catalogue card 320 px ---+  Matter Types  [6 active]                 [+ New Matter Type]
| [ Find a list          ]   |  Shown on: Matter form, Matters list (column and filter), Matter page.
| Matter                     |  +--------------------------------------------------------------+
|  Matter Types           6  |  | ORDER  MATTER TYPE            MATTERS   STATUS        [..]   |
|  Kind of matter ...        |  | 1      Securities Litigation       14   Active          ...   |
|  Current States         5  |  | ...                                                           |
| Task / Notes / Assets ...  |  +--------------------------------------------------------------+
| Need a new field instead?  |  (i) rule sentence of the list              Rows per page 50
+----------------------------+
```

- **Frame** (D-03): the page never scrolls; the body is `display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 16px` from the header to the bottom gutter.
- **1366x768** (grid frame about 1098 px): catalogue **320 px**, gap 16, **editor pane about 762 px**. Body height about 600 px.
- **1920x1080** (frame about 1668 px): catalogue 320 px, **editor pane about 1332 px**, body about 912 px. The Name column is the spring and takes the extra room; nothing else changes. The catalogue is a fixed 320 px at both sizes (it never grows).
- **Catalogue card** (`mf-card`, D-10, radius 12, `--mf-shadow-card`): search box row (padding 12 12 8), the listbox (fills the card, scrolls inside when it must), the pointer block at the foot. Eight lists in four groups need about 560 px: it fits at 1366 with at most a few pixels of inner scroll and with room to spare at 1920.
- **Editor pane** has no card around it (no nested cards, D-10): its header, the "Shown on" sentence, then **today's grid frame** (`mf-grid-frame` look: radius 12, row 44, header 40, row line, pager 25 / 50 / 100) which fills to the bottom gutter and scrolls inside.

## 3. The catalogue

### 3.1 Groups and lists (the registry)

One constant `ADMIN_LISTS` (key, group, label, permission, hint, shown-on, count loader) feeds the catalogue, the routes, the redirects, the page title and the guard. Groups and their icons (D-17 registry): **Matter** `pi-briefcase`, **Task** `pi-check-square`, **Notes** `pi-file-edit`, **Assets** `pi-database`. Group heading: 13/600 muted, icon 16 px, normal case (D-23), 8 px above, 2 below. Empty groups are not drawn.

| Group | List (catalogue label) | Key / address | Permission | Today's component | "Used for" hint (one line, exact) | "Shown on" (editor sentence, exact) |
| --- | --- | --- | --- | --- | --- | --- |
| Matter | Matter Types | `matter-types` | `MatterList.Manage` | `MatterListTab` | Kind of matter, set on the matter form | Shown on: Matter form, Matters list (column and filter), Matter page. |
| Matter | Current States | `current-states` | `MatterList.Manage` | `MatterListTab` | Where a matter stands now | Shown on: Matter form, Matters list (column and filter), Matter page. |
| Matter | Team Titles | `team-titles` | `MatterList.Manage` | `MatterListTab` | Title of each person on a matter team | Shown on: Matter page, Team tab. |
| Task | Priorities | `priorities` | `Priority.Manage` | `PrioritiesPage` | Urgency of every task | Shown on: New Task form, task lists (column and filter), Task page. |
| Task | Status Labels | `status-labels` | `StatusLabel.Manage` | `StatusLabelsPage` | Wording of the task statuses | Shown on: task lists, Task page, Dashboard. |
| Task | On-Hold Reasons | `on-hold-reasons` | `OnHoldReason.Manage` | `OnHoldReasonsPage` | Why a task is put on hold | Shown on: Put on Hold dialog, Task page. |
| Notes | Note Tags | `note-tags` | `StatusLabel.Manage` (owner decision) | `NoteTagsPage` | Tags people put on matter notes | Shown on: Matter Notes tab (tag picker and filter), note templates. |
| Assets | Link Roles | `link-roles` | `AssetType.Manage` | `AssetLinkRolesPage` | How an asset relates to a task | Shown on: Link Asset dialog, Asset page, Linked Tasks tab. |

The hint and "Shown on" strings are static copy in the registry (no endpoint). The frontend verifies each "Shown on" against the screens when building and corrects the copy in this table, not by inventing a new place. Hints are at most 40 characters of 12 px text (the Matter Types hint was 41 and was shortened to "set on", #1321) (the 320 px card shows about 38; longer ones ellipsize with the full text as `title`).

### 3.2 Catalogue rows

- **Listbox** (`role="listbox"`, accessible name "Lists"); each list is an option (`role="option"`, `aria-selected`), a 44 px button: line 1 the label (14/600, one line, ellipsis), line 2 the hint (12 px muted, one line, ellipsis, tooltip with the full hint); at the right the **count chip** (`mf-count-chip`, 22 px) spanning both lines.
- **Selected** option: `--mf-selected-bg` with the 2 px inset `--mf-primary` (D-05, selected card). Hover `--mf-row-hover`. Radius 8.
- **No new API** (backend check #1316). The catalogue calls **each permitted list's existing GET** (at most 8, in parallel, quiet) and counts on the client: `itemCount = rows`, **`activeCount = rows with isActive`** (Status Labels have no `isActive`: all five rows count). It must **not** use `inUseCount`, `openTaskCount`, `taskCount`, `linkCount` or `visibleNoteCount` for the chip: they mean different things per list and are null without `Task.View` or `Asset.View`. **Count** = the number of **active** items, from today's list endpoints, never a new one (Note Tags are requested with `?includeInactive=true`, the only query parameter that endpoint accepts, otherwise inactive tags would be missing): `listPriorities`, `listStatusLabels` (5), `listOnHoldReasons`, `listNoteTags(true)`, `listAssetLinkRoles`, and the three matter list clients (`MatterTypesClient`, `CurrentStatesClient`, `TeamTitlesClient`). They are started once per page by the existing `AdminTabCounts` (quiet requests, `start(...)` with one loader per permitted list; `refresh(key)` after a create, deactivate or delete; `set(key, n)` from the open editor after its own load). While unknown the chip shows `--`; a failed count is silent (no toast): the open editor shows its own error. Accessible name of the count: "6 active" (`--`: "count not available").
- **Who sees what:** only lists whose permission the person holds are drawn; a group without any is not drawn. Loaders for lists the person may not manage are never started.

### 3.3 Search ("Find a list")

- Shown only when the person may manage **more than four** lists. `mf-search-box`, 36 px, accessible name and placeholder **"Find a list"** (D-44d short word). No `/` key (that would be a shortcut); Tab reaches it and Esc clears a filled box (existing widget behaviour).
- Matches, ignoring case, any part of: list label, group name, hint, "Shown on" text. Groups and lists that do not match are hidden; the selected list stays selected even when hidden by the search (the editor does not change).
- **No match:** inside the listbox area, a muted block (`mf-state-block` look, no icon, centred): **`No list matches "<text>".`** and under it one sentence: with `CustomField.Manage` **"Looking for a new field on a client, matter or project? That is Custom Fields."** followed by the text button **Open Custom Fields**; without that permission **"Try the name of the dropdown or where it shows, such as "matter form"."**
- The result count is announced politely ("3 lists") after typing settles (300 ms), not per key.

### 3.4 Views by permission

| Person holds | What the page shows |
| --- | --- |
| lists in more than one group, or more than 4 lists | catalogue with search, all permitted groups |
| 2 to 4 lists (for example only `MatterList.Manage`: 3 lists, one group) | catalogue **without** the search box, only that group's heading and rows |
| exactly **one** list (for example only `Priority.Manage`) | **no catalogue**: the editor fills the page width; the H1 stays "Lists"; the editor header names the list |
| none | the nav item is not shown; the address answers the 403 page (existing denial rule) |

In the one-list view the Custom Fields pointer (3.5) is a single muted line at the foot of the editor pane, only with `CustomField.Manage`.

### 3.5 The Custom Fields pointers (both ways)

- **On Lists (with `CustomField.Manage`):** at the foot of the catalogue card (not scrolling away): **"Need a new field instead?"** (14/600) and under it the text button **"Open Custom Fields"** with `pi-arrow-right` (it navigates, so it is an `<a>` styled as the text button, D-13a). Tooltip: "Custom Fields add extra fields to Clients, Matters and Projects." Hidden without the permission. 44 px block on `--mf-surface-alt`, radius 8, 8 px margin.
- **On Custom Fields (with any Lists permission):** one `.pg-banner` (info, 36 px, D-10a, `role="status"`) under the page header and above the grid: **"Looking for the choices of a dropdown, such as Priority or Matter Type?"** with the text button **"Open Lists"** at the right (target `/admin/lists`, which opens the first permitted list). Not dismissible, shown on every visit (it is wayfinding, not news). Hidden without any Lists permission. The Custom Fields page and its description are otherwise unchanged.

## 4. The editor pane

### 4.1 Header, "Shown on", rule line

- **Header row** (36 px): H2 (16/600, the list's plural name, focus target after a selection by pointer only if the person asked, see 7), `mf-badge` success "**6 active**" (`pi-check-circle`; **Status Labels**, which have no active state, show the neutral badge "**5 statuses**" with `pi-list` instead: QA review of #1321), spring, the list's **primary button** (last, D-41): `+ New Matter Type`, `+ New State`, `+ New Title`, `+ New Priority`, `+ New Reason`, `+ New Tag`, `+ New Link Role`. **Status Labels have no New button** (fixed five statuses). Hidden if the person lacks the list's permission (cannot happen: the list would not be offered).
- **"Shown on" sentence** under the header (13 px muted): the exact string of 3.1.
- **Rule line**: the foot of the grid frame, 13 px muted with `pi-info-circle`, the list's existing sentence (exact):

| List | Rule line |
| --- | --- |
| Matter Types, Current States, Team Titles | An item in use is deactivated, not deleted. Delete appears only for an item that nothing uses. (new sentence; the same one for all three) |
| Priorities | Order priorities from most to least urgent. Exactly one is the default. |
| Status Labels | Rename how the five statuses read. You can't add or remove statuses. |
| On-Hold Reasons | The reasons offered when a task is put on hold. A used reason is deactivated, not deleted. |
| Note Tags | The tags people pick in a note. A tag that notes use is deactivated, not deleted. |
| Link Roles | The roles an asset can have on a task, such as Source, Destination or Result. |

(The one-line description that the old tab shell printed under the H1 moves here; the H1 description of the new page is the generic sentence of section 2.)

### 4.2 Columns and menus per list (today's behaviour, unchanged)

The grid is today's kit table or record grid of each list, embedded as is. Name is the spring (min 200); count columns 96 (`--mf-col-count-w`); Status 140 (`--mf-col-status-w`); actions 48. **Order** (grip and number) 80 where the list is orderable. Fit at 1366 (pane about 762 px): widest case Priorities = 80 + Name + Color 140 + Open Tasks 96 + Status 140 + 48 = 504, leaving Name about 258 (>= 200). Note Tags = Name + Color 140 + Notes 96 + Status 140 + 48 = 424, Name about 338.

**As built and measured (#1339, #1312, at 1366 and 1920):** these widths are budgets for the fit, not the drawn widths. The kit table (the admin grid contract, `styles/_admin-lists.scss`) draws an Order, count or badge column as narrow as its content (`mf-cell-order`, `mf-cell-num`, `mf-cell-badge` at `width: 1%`): Matter Types, Current States and Team Titles measure Order 67, count 85, Status 99, Name takes the rest. That is accepted and not widened to 80 / 96 / 140. Note Tags is the shared record grid (D-44a), so its headings show the resize dividers of that grid; the six kit-table lists have no column resize and no dividers. Accepted, not unified: the record grid keeps its resize and Columns features, and a kit table that resized would be a new component.

**Rule line and short lists (#1339):** the editor body takes the height its grid needs, never more, so the rule line of 4.1 sits directly under the grid frame, also under a short list (Status Labels: five rows); a long list still fills the pane and scrolls inside its frame, with the rule line at the foot of the pane.

| List | Columns (headings) | Row menu / actions | Delete |
| --- | --- | --- | --- |
| Matter Types, Current States | Order, Matter Type / Current State, Matters, Status, actions | Rename, Move Up, Move Down, Deactivate or Activate, Delete | only when the count is 0 |
| Team Titles | Order, Title, Team Members, Status, actions | same | only when the count is 0 |
| Priorities | Order, Priority (flag; "Default" badge on the default one), **Color** (swatch and name), Open Tasks (needs `Task.View`, else column absent), Status, actions | Edit Priority, Move Up, Move Down, Set as Default, Deactivate or Activate, Delete | only for a priority no open task uses; never the default (disabled, reason in the menu) |
| Status Labels | Status (badge with the display label; "was <name>" when renamed), Tasks (needs `Task.View`), actions. **Five fixed rows, no Order, no Status column, no New** | Rename (the name link opens it too) | none; statuses cannot be added, removed or deactivated |
| On-Hold Reasons | Order, Name, Status, actions | Rename, Move Up, Move Down, Deactivate or Activate | **none** (a reason is never deleted) |
| Note Tags | Name, **Color** (the ten-colour palette), Notes (count of notes the person can see), Status, actions. **No Order** (tags are not ordered) | Edit, Deactivate or Activate, Delete | only when no note or template uses it (disabled with the reason while used) |
| Link Roles | Order, Name, Links (needs `Task.View` and `Asset.View`), Status, actions | Rename, Move Up, Move Down, Deactivate or Activate, Delete | only when the page knows no link uses it (an unknown count offers Deactivate only) |

- **Color column** (Priorities and Note Tags): a 14 px rounded swatch from the tag or priority palette token plus the colour name, as today. Never colour alone.
- **Count cells** link to the filtered list where today's page does (Matters list filter for matter types and states, Task Queue for Priorities and Status Labels, notes filter for tags); a count the person may not see is absent, not zero.
- **Dialogs are today's**, unchanged in wording and size: lookup dialog (New, Rename; 416 px) for the name lists and Status Labels, the Priority dialog (label and color) and the Note Tag panel (name and color), the deactivate and delete confirm dialogs (D-34) with their impact sentences from `dialog-copy.ts` (for example "14 matters keep this matter type. It won't be offered for new or changed records. You can activate it again." and "No task uses this priority. Deleting it can't be undone."). Toasts are today's ("Matter type added", "Priority deleted", ...). This epic adds no dialog text.
- **Addresses of dialogs:** `?edit=<id>` and `?edit=new` now sit on the list address (`/admin/lists/<key>?edit=<id>`); the name links, row menus and New buttons keep using them, and row focus returns to the row after a dialog closes (`mfRowLink` keys per list unchanged: `matter-types`, `current-states`, `team-titles`, `priorities`, `status-labels`, `on-hold-reasons`, `note-tags`, `link-roles`). **Matter Types, Current States, Team Titles and Note Tags (#1339):** the address opens the dialog once the list is loaded (`?edit=new`, `?edit=<id>`: Rename or Edit), an id that is not in the list is dropped from the address without a dialog, and closing the dialog takes `edit` off the address. Their New buttons and row menus open the dialog directly and do not write the address (Priorities, Status Labels, On-Hold Reasons and Link Roles do).
- **Unsaved text:** the six editors are dialog-based (no inline edit rows). The page implements `HasUnsavedChanges` by delegating to the mounted editor (`hasUnsavedChanges()` is true while its New/Rename/Edit dialog is open with edited text); the route keeps `canDeactivate: [unsavedChangesGuard]`, so leaving by the nav, a link or a back button asks the standard "Unsaved Changes" question (`[Keep Editing] [Discard Changes]`, D-31). A catalogue click cannot discard text: while a dialog is open the page is modal.
- **Switching lists:** only the selected editor is mounted (`@switch`, lazy `import()` per list so the page's bundle stays small); its state is not kept when another list is picked.

### 4.3 What differs between the lists (the shared editor must handle all of it)

From `backend-notes.md` (#1316), so the six editors keep their own fields behind one page:

| | Matter Types, Current States, Team Titles | Priorities | Status Labels | On-Hold Reasons | Note Tags | Link Roles |
| --- | --- | --- | --- | --- | --- | --- |
| Item id | `id` | `id` | **`code`** (string, also the URL key) | `id` | **`noteTagId`** | `id` |
| Name field | `name` (max 100) | **`label`** (max 50) | **`displayLabel`** (max 50) | `name` (max 100) | `name` (max 60) | `name` (max 50) |
| Active | `isActive` | `isActive` | **none** (always active) | `isActive` | `isActive` | `isActive` |
| Order | `sortOrder`, drag and Move Up/Down | `sortOrder` (most urgent first) | fixed (five codes) | `sortOrder` | **alphabetical, no reorder** | `sortOrder` |
| Extras | none | **`color`** (token or hex), **`isDefault`** and the **Set as Default** action | none | none | **`colourKey`** (ten-colour palette, optional) | none |
| Delete | `DELETE {id}`, 409 `IN_USE` | `DELETE {id}`, 409 `IN_USE`, 409 `DEFAULT_REQUIRED` for the default | **none** | **none** | `DELETE {id}?rowVersion=` (the row version is required, else 400), 409 `IN_USE` | `DELETE {id}`, 409 `IN_USE` |
| "In use" figure for the count column | `inUseCount` (exact) | `openTaskCount` (open tasks only; null without `Task.View`) | `taskCount` (null without `Task.View`) | not counted | `visibleNoteCount` (notes the person can see; `isInUse` is exact) | `linkCount` (null without `Task.View` and `Asset.View`) |

- **Optimistic concurrency:** every list has `rowVersion`, sent in the PUT body; a 409 `CONCURRENCY_CONFLICT` is the existing "changed by someone else" handling of each editor (unchanged).
- **Duplicate names:** the editor keys off the **top-level error code `DUPLICATE_NAME`**, which is the same for all eight (the per-field code differs: `DUPLICATE` in the Configuration lists, `DUPLICATE_NAME` for Note Tags). The message under the field is the existing one of each editor.
- **The server decides "in use":** where a list gives no exact figure (Priorities, Status Labels, Link Roles, On-Hold Reasons), the editor offers Delete only when its own rule says the item is unused (as today) and treats a 409 `IN_USE` as the truth, showing the existing inline sentence ("Tasks use <name>, so it can't be deleted. Deactivate it instead.", "Links use ..."). A count the person may not see is shown as `--`, never 0.
- **Create bodies** differ (`{name}`, `{label, color}`, `{name, colourKey}`); Status Labels cannot be created, so the page has no New button for them. All of this stays inside the existing editors; the Lists page passes no data between them.

## 5. States

| State | Display (exact) |
| --- | --- |
| **Loading, first visit** | the catalogue renders at once from the registry (names, hints) with `--` counts (the names do not wait for data); the editor shows its header, the "Shown on" sentence and **grid skeleton rows** with the final column headings (D-50, no jump); live text "Loading <list>" |
| **Loading, switching lists** | the previous editor stays until the next is ready only if it is quicker than 150 ms; otherwise the new editor's skeleton |
| **Empty list** | `mf-state-block` inside the grid frame: **"No matter types yet."** (per list: "No current states yet.", "No team titles yet.", "No priorities yet.", "No on-hold reasons yet.", "No tags yet.", "No link roles yet.") and the primary button again (**New <Thing>**, same labels as the header). Status Labels cannot be empty |
| **List error** | the editor's `adminListView` state: warning icon, **"Couldn't load <things>."**, the error reference, **Retry**; no toast (D-51); the other lists stay usable |
| **Counts error** | silent; chips show `--` |
| **Search no match** | section 3.3 |
| **Single-list user** | section 3.4 |
| **Came from an old link** | section 6.3 |
| **Unknown or forbidden list key** | silent redirect to the first permitted list (the denial rule of #416, `firstAllowedTab`) |
| **Offline or session errors** | the global banners and error pages (unchanged) |
| **Read-only** | does not exist (owner decision 2) |

## 6. Addresses, redirects and the old nav

### 6.1 New addresses

`/admin/lists` (opens the first permitted list) and `/admin/lists/:list` with `:list` one of `matter-types`, `current-states`, `team-titles`, `priorities`, `status-labels`, `on-hold-reasons`, `note-tags`, `link-roles`. One route with a matcher, like today's tab pages; the component stays alive when the list changes (the catalogue keeps its scroll and focus). Guard: any of the five permissions opens the page, the list key must be permitted for that person else the first permitted list is used (`resolveAdminTab` over `ADMIN_LISTS`).

### 6.2 Redirect table (every old address keeps working, by redirect, not by a copy)

| Old address | Goes to | Notes |
| --- | --- | --- |
| `/admin/priorities` | `/admin/lists/priorities` | |
| `/admin/status-labels` | `/admin/lists/status-labels` | |
| `/admin/on-hold-reasons` | `/admin/lists/on-hold-reasons` | |
| `/admin/note-tags` | `/admin/lists/note-tags` | |
| `/admin/matter-types` | `/admin/lists/matter-types` | |
| `/admin/current-states` | `/admin/lists/current-states` | |
| `/admin/team-titles` | `/admin/lists/team-titles` | |
| `/admin/asset-link-roles` | `/admin/lists/link-roles` | today it redirects to `/admin/asset-types?tab=link-roles`; it now goes straight to the new address |
| `/admin/asset-types?tab=link-roles` | `/admin/lists/link-roles` | decided in the Asset Types route (`runGuardsAndResolvers` already reads the query); every other `/admin/asset-types...` address is unchanged |
| any of the above with `?edit=<id>` or `?edit=new` | the new address with the same `edit` value | so a bookmark or a link from a dialog still opens it (`edit` is the only query parameter these lists use) |
| `/admin/lists` and `/admin/lists/<unknown>` | the first permitted list | |
| `/admin/custom-fields`, `/admin/custom-fields/:id/form`, `/admin/asset-types`, `/admin/asset-types/new`, `/admin/asset-types/:id`, `/admin/asset-types/:id/form` | unchanged | |

Redirect rules: preserve the `edit` value and nothing else; use `replaceUrl` so Back does not loop; a person without the permission of the target list lands on their first permitted list (6.1), or on the 403 page when they hold none. The redirects carry a one-time marker `moved=<old-key>` (for example `moved=priorities`); the page reads it once, shows the notice of 6.3 and removes it from the address with `replaceUrl`.

**`list-return.ts`:** no change. `ADMIN_LIST` contains only lists that open record pages (task types, workflows, steps, asset types, custom fields, pods, reports); none of the eight lists is in it, because they open dialogs, not record pages. The Asset Type record and form pages keep returning to `/admin/asset-types` (their crumbs, `ADMIN_LIST.assetTypes`, `sectionPath`, `heading: 'Asset Types'` are unchanged). `restoreRowFocus` ids stay as listed in 4.2.

### 6.3 The "came from an old link" notice

When the address carried `moved=<key>`, one `.pg-banner` (info, 36 px, `role="status"`, D-10a) shows between the page header and the body: **"<List> has moved here, under Lists > <Group>. Update your bookmark."** (for example "Priorities has moved here, under Lists > Task. Update your bookmark."; "Link Roles has moved here, under Lists > Assets. Update your bookmark."). Text button **Dismiss** at the right. It shows once per arrival, is not stored, and is not shown for `/admin/lists/...` addresses. If the person may not manage that list, no notice is shown (they land on their first list silently).

### 6.4 Asset Types page after the change

Heading "Asset Types", the types grid and its description **"Each type has its own fields. Fields are versioned; publishing never changes saved values."**, **no tab strip** (one allowed tab gives a header without the strip, as the shell already does), no tab counts; `tabsLabel`, the `link-roles` branch, `AssetLinkRolesPage` and the "New Link Role" header button leave the page; the title is "Asset Types". The page's `New Asset Type` button stays. The old `ASSET_TABS` link-roles entry moves into `ADMIN_LISTS`. **Link Roles stay in the API and the permission stays `AssetType.Manage`**: a holder of it sees the Asset Types page and, on the Lists page, the Link Roles list (the person who holds only `AssetType.Manage` lands on a one-list Lists page, section 3.4, plus Asset Types in the nav). Nothing is removed from the Asset Types API.

## 7. Focus, landmarks, live regions (no new or changed shortcuts)

- **Landmarks:** `nav` (main menu), `main` containing: breadcrumb `nav` (existing), the H1, the optional notice (`role="status"`), `aside` named "Lists" (the catalogue card) and `section` labelled by the editor H2. The listbox is named "Lists".
- **Tab order:** skip link, navigation, notice's Dismiss, **Find a list**, the **catalogue (one Tab stop**: the selected option, roving `tabindex`), **Open Custom Fields**, the editor's **New** button, then the grid (name buttons and count links per row, the row menu button per row), the pager. Shift+Tab reverses. The catalogue's pointer link is deliberately before the editor so the order follows the visual order left to right.
- **Listbox keys** (keys of one focused widget, D-44b, not shortcuts): Up and Down move and select, Home and End go to the first and last list, no Enter needed. The editor swaps after 150 ms of idle so holding an arrow key does not start a request per list. Typing a letter is not bound (the search box is for that).
- **Focus:** choosing a list by key or click keeps focus on the catalogue option (the person is browsing). Opening a dialog and closing it returns focus to its opener (D-31). After a redirect arrival the H1 receives focus as on every page (route announcer).
- **Live regions:** one polite region owned by the catalogue says **"<List>, <n> active"** after the selection changes and "<n> lists" after a search; each editor keeps its own live region ("Moved Antitrust to position 2.", "Antitrust deactivated.", "Antitrust deleted."), so there is no double announcement.
- Screen-reader reading of an option: "Priorities, 4 active, Urgency of every task, selected".

## 8. Components and tokens

Reused, no private widgets: `mf-page-header`, `mf-card`, `mf-search-box`, `mf-count-chip`, `mf-badge`, `.pg-banner`, `mf-state-block` and `adminListView`/`AdminListState`, `mf-admin-list-shell` pieces where useful (or a thin page shell), `AdminTabCounts`, the six existing editors, `mf-lookup-dialog`, `mf-confirm-dialog`, `mf-action-menu`, `mf-pager`, `[mfTip]`. **New (to be approved as D-44y):** the catalogue listbox (`mf-list-catalogue`: group headings, options with count chip, selected state, roving focus, no-match slot, pointer slot). Tokens only; no new color, size or radius beyond the scales; the one new fixed width is the catalogue card 320 px (it equals the Roles list column, D-44l: add `--mf-catalogue-w: 320px` to `tokens.css`).

## 9. Implementation notes and touch points

- Frontend: new `features/admin/lists/` (page, catalogue, registry, redirects), `admin.routes.ts` (matcher plus redirects plus `asset-types?tab=link-roles` redirect; remove the Labels and Matter Lists routes after the redirects exist), `nav-items.ts` (Lists in, Labels and Matter Lists out, Asset Types `alsoActive`), `tab-icons.ts` / `section-icons.ts`, `asset-admin-page.ts` (no strip), `custom-fields-page.ts` (pointer banner), the six editors (their `routerLink`s and `?edit=` addresses to `/admin/lists/<key>`; the header parts they get from their old shells, New buttons, descriptions and tab counts, move to the editor header).
- Specs and e2e to update: `admin-tabs.spec`, `labels-tabs.spec`, nav-items and `app-shell` specs, the pages' specs that open `/admin/priorities` and similar, e2e that visit those addresses (they keep working through the redirects, but assertions on the old headings and tab strips change), `private-classes`, capitalisation and record-grid guards (no change expected).
- Backend: none (counts reuse the list endpoints).
- Guidelines: D-44y (draft, this PR); on approval D-80's Administration list (Lists replaces Labels and Matter Lists; Asset Types has one tab), the catalogue table of section 3 (components), `theme-guide.md` and `tokens.css` (`--mf-catalogue-w`).

## 10. Open points

No genuine open question for the owner beyond the pattern approval. Two items for the frontend to confirm while building, without changing this design: the exact "Shown on" copy per list (3.1) against the real screens, and the ten-colour palette names shown in the Color column (unchanged from today).
