# Administration > Lists: one page for every list of choices (mockup)

Mockup only, no issue yet. Open `mockup.html` in a browser (self-contained: tokens from `docs/ux/tokens.css` and a PrimeIcons subset are embedded, no network). Controls above the frame switch size (1366x768, 1920x1080), the Custom Fields variant, who is looking, the data state (normal, empty, load error), an arrival from an old link, and the page in variant A. Nothing saves except in-page demo edits. Screenshots are not committed.

## What it shows

- One nav entry **Lists** replacing Labels and Matter Lists (and the Link Roles tab of Asset Types).
- Master-detail page. Left (320 px card): "Find a list" search, lists grouped by what they belong to (Matter: Matter Types, Current States, Team Titles; Task: Priorities, Status Labels, On-Hold Reasons; Notes: Note Tags; Assets: Link Roles), each with the number of active items and a one-line "used for". Right: the chosen list: name, active count, "Shown on" chips (where people will see the choices), the existing reorder list (Order, Name, In Use, Status, row menu) and a one-line rule about deactivate and delete.
- States: empty list ("No priorities yet." + New), load error with Retry, read-only viewer, row menu, deactivate and delete confirms, rename and new dialogs, toasts, old-link notice.
- Permissions: a person sees only the lists they may manage; one permitted list = no left pane, the editor fills the page; 2 to 4 lists = pane without the search box.

## Recommendation on Custom Fields

Keep **Custom Fields as its own page** (variant A, default) and link both ways ("Need a new field instead?" in the Lists pane and in the search when someone types "field"; "Looking for the choices of a dropdown?" at the top of Custom Fields). It creates new fields with versions and a full-page designer, a different job and permission from editing the choices of a dropdown. Variant B (switch in the mockup) adds an "Extra Fields" section to the same pane: one menu entry fewer, but one page with two editor shapes.

## Decisions for the owner

1. Variant A or B for Custom Fields.
2. Name of the nav item and page: "Lists" (shown), or "Pick Lists", "Choices", "Lists and Fields" (variant B).
3. Read-only viewer: today Manage opens a page, there is no view-only right. Showing lists read-only needs a new permission; the mockup shows the state only for completeness. Default: not built.
4. **Correction (backend check #1316, owner decision 3 stands):** this README first said only Matter Lists have "Delete only when In Use is 0". In fact Delete already exists for Matter Types, Current States, Team Titles, Priorities, Note Tags and Link Roles (409 `IN_USE` when used); only On-Hold Reasons has none, and Status Labels have no create or delete. Delete rules stay per list as today; no new delete endpoints. The mockup's per-list rules table shows Delete only for the matter lists: read `ui-spec.md` section 4.2 for the real rules.
5. Note Tags are gated by `StatusLabel.Manage` today. Keep (shown) or give them their own permission.
6. Asset Types keeps its page (asset types are records with forms), now without the Link Roles tab.

## Old addresses (redirects, never a second copy)

`/admin/priorities`, `/admin/status-labels`, `/admin/on-hold-reasons`, `/admin/note-tags`, `/admin/matter-types`, `/admin/current-states`, `/admin/team-titles` go to `/admin/lists/<same name>`; `/admin/asset-types?tab=link-roles` and `/admin/asset-link-roles` go to `/admin/lists/link-roles`. `?edit=<id>` is kept. A person without the permission for the target lands on their first permitted list (`firstAllowedTab` rule). Variant A leaves `/admin/custom-fields` unchanged.

## Keys and focus (no new or changed shortcuts, #420)

Tab order: nav, Find a list, the list catalogue (one Tab stop, Up/Down/Home/End move and open, keys of one focused widget as in D-44b), New button, grid, pager, cross-link. No key for "Find a list" (a "/" key would be a shortcut). Reorder keeps Move Up/Move Down in the row menu. Dialogs return focus to their opener. Catalogue is a named listbox with a live region.

## Effort and risks (estimate)

- Frontend about 22 to 30 agent-hours: config-driven list editor shared by the six lists (8), catalogue pane with search and a11y (5), routes, redirects and nav (3), moving Priorities, Status Labels, On-Hold Reasons, Note Tags, Matter Lists and Link Roles onto it (4), specs and e2e (6), guideline D-80/D-44 text and QA (3).
- Backend 0 to 1 hour (a counts summary can reuse today's per-list endpoints); 2 to 4 more if decision 4 unifies delete.
- Risks: deep links and `?edit=` and list-return (`list-return.ts`) behaviour; permissions (single-list view, Note Tags gate, nav rule "any permitted"); existing specs and e2e that open `/admin/priorities` etc., `admin-tabs.spec`, `labels-tabs.spec`, nav-items specs; unsaved-changes guard on pages with inline edit rows; Asset Types page left with one tab; a master-detail catalogue is a new pattern (the Roles tab is the only precedent, D-44l) and needs owner approval under guidelines section 7.
