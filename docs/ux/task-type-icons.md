# Task Type icons and the type-first Create Task

Product-owner decisions, how it is built, and how to add icons. Screenshots are in `docs/ux/task-type-icons/`.

## Decisions

1. **Create Task is type first.** The page opens on a grid of cards (icon, name, short description) instead of a "Task type" field.
   Choosing a card reveals the form; the chosen type stays at the top as a chip with a **Change type** action. Changing the type
   goes back to the grid and clears the type's request details; a confirm dialog asks first only when some were entered (Title,
   Matter and the other common fields are kept).
   - `?taskType=<id>` skips the chooser (ignored when the id is not a type the user may use).
   - The "Fill from email" panel keeps working on the chooser page; a note says the email details are ready and are applied when the type is chosen.
   - Only active types that can be used for new Tasks (published request form and an eligible workflow) are offered.
   - More than 12 usable types: a search box (name and description). No types: an empty state that tells the user to ask an administrator.
   - Keyboard: the cards are one radio group. Tab enters it (one tab stop), arrows, Home and End move, Enter or Space chooses. Chosen type is never picked by the arrows alone.
   - "Create and add another" keeps the chosen type (and Matter, Project, Priority and Pod); the type can still be changed with the chip.
2. **Neutral colour.** Icons are drawn in the surrounding text colour (`currentColor`). There is no per-type colour.
3. **Tabler Icons outline (MIT)**, a curated subset bundled as our own data with the licence notice
   (`frontend/src/app/shared/icons/TABLER-ICONS-LICENSE.txt`). No CDN, no runtime dependency, strict CSP unchanged (the icons are inline SVG shapes).
4. **No custom uploads.** The icon is always one key of the library.
5. **The icon is required.** Every Task Type has one, default `file-text` (Document). Several types may share an icon.

## Where the icon appears

`mf-task-type-icon` is the only component that draws it (decorative: `aria-hidden`, the name is always next to it; sizes `sm` 16px, `md` 20px, `lg` 28px).

| Place | Notes |
| --- | --- |
| Create Task chooser and the type chip | `lg` on the card, `md` on the chip |
| Admin Task Types list | before the name |
| Admin Task Type create/edit | the picker (below) |
| Task Queue, My Work, Pod Work, matter/project task lists | `sm`, before the title in the Title cell; the type name is its tooltip (the Task type column is hidden by default) |
| Task detail header | `lg`, before the task number (the type name is its tooltip and is also in the "Type:" item of the header meta line) |
| Dashboard "Open by task type" | before the label of each type row (not the combined "Other task types" row) |

## The admin picker

The edit page has a required **Icon** field. The button shows the current icon and its name; it opens a dialog with a search box
(label, key, keywords and category are searched, every word must match), the icons grouped by category, each with a visible
label. It is a radio group with one tab stop; arrows move by position, Enter or Space picks and closes. The current icon is checked.

## Categories and counts (300 icons)

| Category | Icons |
| --- | ---: |
| General | 29 |
| Identification | 21 |
| Preservation | 18 |
| Collection | 25 |
| Processing | 26 |
| Review | 31 |
| Analysis | 28 |
| Production | 23 |
| Presentation | 17 |
| Data & systems | 28 |
| Communication | 30 |
| Admin | 24 |

The eight EDRM stages come first (in the order Identification to Presentation), after General, then Data & systems, Communication and Admin.

## How it is built

- **Source of truth:** `tools/icons/catalog.mjs` (key, label, keywords per category). The key is a Tabler outline icon name and is also our persisted id.
- **Generator:** `tools/icons/generate.mjs` reads the Tabler SVGs (build-time only, `tools/icons/node_modules`, never shipped) and writes
  - `contracts/task-type-icons.json`: the shared contract (default key, categories, keys with label and category). Embedded into the API as the allow-list (`TaskTypeIcons`).
  - `frontend/src/app/shared/icons/task-type-icon-paths.generated.ts`: key to inner SVG markup.
  - `frontend/src/app/shared/icons/task-type-icon-catalog.generated.ts`: the searchable catalog for the picker.
  
  The generator refuses unknown Tabler names, duplicate or non-kebab-case keys and any SVG content other than plain shapes (no script, style or links).
- **Lazy loading:** both generated files are dynamic imports (`TaskTypeIconLibrary`), so they are separate chunks (about 67 kB and 34 kB raw) and not in the initial bundle. Until the markup chunk has loaded the icon is an empty box of the same size (no layout shift). The catalog loads only when a picker is on screen.
- **Backend:** `dbo.TaskType.IconKey VARCHAR(50) NOT NULL DEFAULT 'file-text'` (script `19-task-type-icon.sql`, with a CHECK for well-formed ids; the allow-list is an application rule so the library can grow without a script). Create may omit the key (default applies); update requires it. Anything not in the library is `400` (`UNKNOWN_ICON`, or `REQUIRED` when blank). Icon changes are audited as a normal field change (`IconKey`). `iconKey` is on task type list/lookup/detail, `taskType.iconKey` on a Task, `taskTypeIconKey` on task list and queue rows, `iconKey` on the dashboard task-type breakdown.
- **Seeds:** the 15 SME starter types have icons (`iconKey` in `docs/sme/seed-configuration.json`; script 19 also backfills them by name for databases that already had them).
- **Parity test:** a frontend unit test compares the generated catalog with `contracts/task-type-icons.json` (keys, labels, categories, default), and a backend unit test compares the embedded list with the file on disk.

## Adding or changing icons

1. Edit `tools/icons/catalog.mjs`: add `[key, label, keywords]` to a category. The key must be a name in the Tabler outline set. Never rename or remove a key that has shipped (it is stored on Task Types); to retire an icon, keep it.
2. `npm ci --prefix tools/icons && node tools/icons/generate.mjs` (prints the count per category).
3. Commit the three generated files together with the catalog. No database script is needed.
4. `cd frontend && npx ng test frontend --watch=false` and the backend unit tests check that both sides agree.

To move to a newer Tabler version change the pinned version in `tools/icons/package.json`, regenerate, and check the diff (icon drawings can change between versions) and the licence text.

## Related change

The task queue row now carries `assignedAtUtc` (script `20-task-assigned-at.sql`, maintained whenever the assigned user changes; backfilled from the audit trail, else the creation time). My Work's "New" marker (assigned since your last visit) uses it, falling back to `createdAtUtc` for rows without one.
