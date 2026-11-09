# Administration > Lists: backend check (#1316, epic #1314)

Read from code at `dev` d5418ae (controllers, services, DTOs, policies). Nothing was guessed; no code changed.

## Recommendation

**No new endpoint.** The catalogue reads each permitted list with the existing `GET` (one quiet request per list the person may manage, at most 8, in parallel) and derives `itemCount = items.length` and `activeCount = items.filter(isActive).length` on the client. This is exactly what the Labels page and Matter Lists page already do (`AdminTabCounts.start` in `features/admin/admin-tabs.ts`: one quiet request per allowed tab, silent on failure, "--" until known). Reasons:

- **Permission leakage:** every list `GET` policy is "read permission OR the list's Manage permission", so the server already refuses what the person may not read. A summary endpoint would need a second, composite policy and a hand-written per-caller filter, a new place to get permissions wrong.
- **Module boundaries:** Note Tags live in `MatterFlow.Notes`, the rest in `MatterFlow.Configuration`; a server-side summary would need new contracts across modules for two integers per list.
- **Latency / call count:** the lists are tiny (tens of rows). The selected list's response is reused for the detail pane, so a first visit costs 8 parallel small calls (7 extra), later visits cost 1. Matter lists, priorities and link roles add one grouped usage query each; nothing is N+1.
- **Freshness:** after an edit the detail pane already has the new list, so it sets its own count (`AdminTabCounts.set`), no refetch.
- **A person who manages one list can always load it:** all eight `GET` policies include the matching Manage permission (see table), with no extra permission needed. Existing integration tests prove it for Priority, Status Label and Asset Type (`AdminReadPermissionsApiTests`). Not covered by a test today: MatterList.Manage alone, OnHoldReason.Manage alone, and StatusLabel.Manage alone reading Note Tags (see gaps).

What the client must NOT use for the catalogue counts: `openTaskCount`, `taskCount`, `linkCount` (they are null without `Task.View` / `Asset.View`, and mean something other than "in use"). Count rows instead.

## Per list

| | Matter Types | Current States | Team Titles |
|---|---|---|---|
| Endpoints | `/api/v1/matter-types` | `/api/v1/current-states` | `/api/v1/team-titles` |
| Verbs | GET, POST, PUT `{id}`, PUT `order`, DELETE `{id}` | same | same |
| Read | `Matter.View` or `MatterList.Manage` | same | same |
| Write | `MatterList.Manage` | same | same |
| Item fields | `id, name, sortOrder, isActive, rowVersion, inUseCount` | same | same |
| Name rule | required, max 100, unique (exact match as the database collation compares) | same | same |
| Reorder | `PUT order {ids}`: every id exactly once, else 400 `INVALID` on `ids`; returns full list | same | same |
| Deactivate | `PUT {id}` with `isActive=false`, sends name + rowVersion; always allowed | same | same |
| Delete | 204 only when inUseCount is 0, else 409 `IN_USE` | same | same |
| In use means | matters carrying the type | matters carrying the state | team members carrying the title |
| Other codes | 409 `DUPLICATE_NAME`, 409 `CONCURRENCY_CONFLICT`, 400 `INVALID` (bad rowVersion), 404 | same | same |

| | Priorities | Status Labels | On-Hold Reasons |
|---|---|---|---|
| Endpoints | `/api/v1/priorities` | `/api/v1/status-labels` | `/api/v1/on-hold-reasons` |
| Verbs | GET, POST, PUT `{id}`, PUT `order`, POST `{id}/default`, DELETE `{id}` | GET, PUT `{code}` only | GET, POST, PUT `{id}`, PUT `order` (no delete) |
| Read | `Task.View` or `Priority.Manage` | `Task.View` or `StatusLabel.Manage` | `Task.View` or `OnHoldReason.Manage` |
| Write | `Priority.Manage` | `StatusLabel.Manage` | `OnHoldReason.Manage` |
| Item fields | `id, label, sortOrder, color, isActive, isDefault, rowVersion, openTaskCount?` | `code, displayLabel, sortOrder, rowVersion, taskCount?` (no id, no isActive) | `id, name, sortOrder, isActive, rowVersion` (no in-use count) |
| Name rule | label required, max 50, unique; color token or `#RRGGBB`, else 400 `INVALID` on `color` | displayLabel required, max 50, unique | name required, max 100, unique |
| Reorder | `PUT order {ids}` (most urgent first) | none (five fixed codes, lifecycle order) | `PUT order {ids}` |
| Deactivate | allowed except the default: 409 `DEFAULT_REQUIRED` | n/a, always active | always allowed |
| Delete | 204 if not default and no task references it; 409 `DEFAULT_REQUIRED` for the default, 409 `IN_USE` otherwise | none, never | none by design (history keeps the name) |
| In use means | any task referencing it (delete probe). `openTaskCount` is a different number (open tasks only) and null without `Task.View` | tasks per status, `taskCount` null without `Task.View`; informational | not counted anywhere |
| Other codes | 409 `DUPLICATE_NAME` (field `label`), `CONCURRENCY_CONFLICT`, 404 | 409 `DUPLICATE_NAME` (field `displayLabel`), `CONCURRENCY_CONFLICT`, 404 for an unknown code | 409 `DUPLICATE_NAME`, `CONCURRENCY_CONFLICT`, 404 |

| | Note Tags | Asset Link Roles |
|---|---|---|
| Endpoints | `/api/v1/note-tags` (module Notes) | `/api/v1/asset-link-roles` |
| Verbs | GET `?includeInactive=true`, POST, PUT `{tagId}`, DELETE `{tagId}?rowVersion=` (no reorder) | GET, POST, PUT `{id}`, PUT `order`, DELETE `{id}` |
| Read | `MatterNote.View` or `StatusLabel.Manage` | `Task.View` or `AssetType.Manage` |
| Write | `StatusLabel.Manage` (gate confirmed: `NotePolicies.TagManage`) | `AssetType.Manage` |
| Item fields | `noteTagId, name, colourKey?, isActive, visibleNoteCount, isInUse, rowVersion` | `id, name, sortOrder, isActive, rowVersion, linkCount?` |
| Name rule | required, max 60, unique, colourKey from the ten-colour palette else 400 `UNKNOWN_COLOUR` | required, max 50, unique |
| Order | alphabetical by name, fixed, no sortOrder | `PUT order {ids}` |
| Deactivate | `PUT` with name, colourKey, isActive, rowVersion; always allowed | always allowed |
| Delete | 204 when no note or template uses it; 409 `IN_USE` otherwise; rowVersion required (400 `REQUIRED`) | 204 when no link uses it; 409 `IN_USE` otherwise |
| In use means | `isInUse` = any note or template link (including notes the caller cannot see). `visibleNoteCount` = linked notes the caller can see | any task-asset link. `linkCount` is null without `Task.View` + `Asset.View` |
| Other codes | 409 `DUPLICATE_NAME`, 409 `CONCURRENCY_CONFLICT`, 400 `REQUIRED`/`UNKNOWN_COLOUR`, 404 | 409 `DUPLICATE_NAME`, `CONCURRENCY_CONFLICT`, 404 |

## Differences the shared editor must handle

- **Id:** `id` everywhere except Note Tags (`noteTagId`) and Status Labels (`code`, a string, and the URL key).
- **Name:** `name` except Priorities (`label`) and Status Labels (`displayLabel`). Duplicate errors are reported on the same field name.
- **Active:** `isActive` everywhere except Status Labels (no field: always active, five rows).
- **Order:** `sortOrder` + `PUT order` for six lists; Note Tags are alphabetical (no field), Status Labels fixed. The editor needs a "can reorder" flag per list.
- **Colour:** Priorities `color` (token or hex), Note Tags `colourKey` (palette name, optional), nothing for the others.
- **In use:** `inUseCount` (number) only on the three matter lists; Priorities/Status Labels/Link Roles have an optional, permission-dependent count with other semantics; Note Tags have `isInUse` (boolean) + `visibleNoteCount`; On-Hold Reasons have nothing. The editor should treat "in use" as unknown unless a list supplies the exact field, and rely on `IN_USE` 409 from delete as the truth.
- **Row version:** all lists have `rowVersion` (base64), sent in the PUT body; Note Tags also need it as a query parameter on DELETE; other deletes take none.
- **Create body:** `{name, isActive?}` for matter lists, On-Hold and Link Roles; `{label, color, isActive?}` for Priorities; `{name, colourKey?}` for Note Tags (always created active); Status Labels cannot be created.
- **Status codes:** all creates return 201; only the matter lists and others set a `Location`; Note Tags returns 201 without one. Not relevant to the client.
- **Duplicate error shape:** top-level `code` is `DUPLICATE_NAME` for all eight, but the per-field error code is `DUPLICATE` in Configuration lists and `DUPLICATE_NAME` in Note Tags. Key off the top-level code.
- **Note Tags list default hides inactive tags.** The editor must call `?includeInactive=true` (and any other query parameter is a 400). Counts then include inactive rows like the other lists.
- **Priorities extras:** `POST {id}/default` and the `isDefault` flag, `DEFAULT_REQUIRED` on deactivate/delete of the default. Needs an optional per-list action.
- **Delete rules differ today:** deletes exist for Matter Types, Current States, Team Titles, Priorities, Note Tags and Link Roles (all "only when unused", 409 `IN_USE`); not for On-Hold Reasons and Status Labels. This corrects the mockup README (decision 4), which says only Matter Lists have delete. Unifying delete would add exactly one endpoint (On-Hold Reasons, which would also need a usage probe from the Tasks module); Status Labels stay undeletable by nature.

## Nav rule "any permitted"

Nothing in the backend blocks it. The five permissions are independent codes (`MatterList.Manage`, `Priority.Manage`, `StatusLabel.Manage`, `OnHoldReason.Manage`, `AssetType.Manage`); Note Tags need no separate code (`StatusLabel.Manage`). The frontend already decides tabs from the person's own permission list (`allowedAdminTabs`, `firstAllowedTab`), so the catalogue shows exactly the permitted lists and the nav item shows for any of the five. Note: `AssetType.Manage` also opens the Asset Types page, so it stays a separate nav item for that holder; Link Roles then appear in both places and must not be removed from the Asset Types API.
Counts and lists never leak: a list the person cannot manage is simply not requested, and if it were, the policy returns 403. Having only a read permission (for example `Matter.View`) does not show the list in the catalogue, because the catalogue is driven by the Manage permissions.

## Gaps and proposed minimal changes (none block the epic; none done)

1. **No test that Manage alone can read** for MatterList (3 lists), OnHoldReason and Note Tags (via `StatusLabel.Manage` without `MatterNote.View`). Proposal: three short cases in `AdminReadPermissionsApiTests` when the frontend work (#1317 to #1320) starts. The policies already say it.
2. **Per-field duplicate code differs** (`DUPLICATE` vs `DUPLICATE_NAME` in Note Tags). Proposal: none now; the editor keys off the top-level code. Changing it would alter the OpenAPI contract for no user benefit.
3. **On-Hold Reasons have no usage count or delete.** Only matters if the owner chooses one delete rule for all lists (decision 4). Proposal then: `DELETE /api/v1/on-hold-reasons/{id}` (409 `IN_USE`) plus an `IOnHoldReasonUsage` probe, about 2 to 4 hours as the README estimates; otherwise nothing.
4. **No unified "in use" number.** Proposal: the UI shows "In Use" only where a list supplies an exact figure (matter lists, Note Tags) and shows the delete rule text for the others; do not add fields.
5. **Count fields are null without Task.View / Asset.View** (Priorities, Status Labels, Link Roles). Proposal: the UI shows "--" for them, never 0. No change.
