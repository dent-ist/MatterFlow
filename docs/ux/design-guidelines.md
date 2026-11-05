# MatterFlow design guidelines (the UI standard)

**Normative.** Every screen, dialog, drawer, menu, button, chip, link, icon, grid, form, message, date, number and label follows this file. It is the final form of the UI update 2 standard (`docs/ux/ui-update/ui-spec.md` is its history). Token values and CSS detail live in `docs/ux/tokens.css` and `docs/ux/theme-guide.md`; they link here. The UI designer role owns this file (section 8).

Scope: **desktop only** (owner decision 2026-11-04). Design and check at 1366x768 and 1920x1080. No phone or tablet layouts.

Marks: **[OWNER]** = decided by the owner, not to be reopened. All other rules are designer decisions the owner approved in advance.

Contents: 1 read-this-first, 2 rules, 3 component catalogue, 4 wording and formats, 5 checklist, 6 automated guards, 7 changing the standard, 8 exceptions.

---

## 1. Read this first (the 15 rules that matter most)

| # | Do | Don't | Rule |
| --- | --- | --- | --- |
| 1 | Use the shared component for the job (section 3). | Build a private chip, link, button, dialog, drawer, menu or card. | D-12, D-13, D-31 |
| 2 | Take every colour, size, radius and shadow from a token (`docs/ux/tokens.css`). | Write a colour literal, a px icon size or an off-scale radius or font size. | D-01 |
| 3 | Controls are 36 px high (32 px only inside a grid cell or filter row); text buttons stay 24 px **[OWNER]**. | 28, 30, 34, 40 px controls. | D-02 |
| 4 | **Click it or name it = Title Case. Read it = sentence case.** Short prepositions stay lowercase ("Produced by Us"). | "New client", "Clear filters" on a button. | D-20 |
| 5 | Primary action is the last (rightmost) button. Dialog footer: `[Cancel] ........ [Primary]`. | Primary first; "Discard changes" as a button except in the unsaved-changes dialog. | D-30 |
| 6 | A page header is `mf-page-header` (icon tile, 22/700 title, count chip, actions right); a record page uses `mf-record-header`. | A page that draws its own `<h1>`. | D-21 |
| 7 | Create and edit open in a shared dialog (576 px default); a right drawer is for reading and detail only (520 px). | A raw `p-dialog`, a drawer that edits, any other width. | D-31, D-32, D-33 |
| 8 | Dates are `MM/DD hh:mm AM/PM` (year added when not this year); the long form with the FULL month only in tooltips and sentences. | "Oct 12, 2026" in a cell, ISO `2026-10-15`, a zone in a cell. | D-60 |
| 9 | One link style: link colour, underlined. Actions are text buttons. | A coloured word that acts like a button; a private `.lnk` class. | D-13 |
| 10 | Chips are one of four kinds (status, count, filter, tag) and always icon + word for status. | A fifth chip look; colour as the only signal. | D-12 |
| 11 | Every list uses the grid anatomy: rows 44 (36 compact), header 40, pager 25/50/100, identifier first, row action last. | Load more, a 40 or 48 px row, a dropped column at a narrow window. | D-42, D-43 |
| 12 | Empty, error, loading and missing record use the shared state components and the fixed sentences. | "Something went wrong. Try again.", an error toast next to an inline error. | D-50, D-51, D-47 |
| 13 | A toast names the thing: "Role saved", "Priority added" + detail. | "Saved.", a toast for what the user can see change. | D-52 |
| 14 | Tabs: `mf-tabs`, 40 px, an icon on every tab, Title Case. A sub-switch is the segmented control. | A second strip of tabs, a tab without an icon. | D-15, D-16 |
| 15 | Screenshots at 1366x768 and 1920x1080 for every changed screen, axe 0, guard specs green, this file updated (section 5). | Pushing a new look that is not in this file. | section 5 |

---

## 2. Rules

Each rule: **Do** exactly this; **Don't** the listed things; **Ref** the page or component that already does it.

### 2.1 Foundations

**D-01 Scales.** Type 12 / 13 / 14 (body and controls) / 16 (card, dialog and menu titles) / 18 / 22 (page title) px (`--mf-fs-xs`..`--mf-fs-h2`); figures 24 and 32 px (`--mf-fs-figure`, `--mf-fs-figure-lg`). Weights 400, 600, 700. Spacing 4, 8, 12, 16, 24, 32, 48 (`--mf-s1`..`--mf-s7`): inside a control 0 12, between controls 8, header to toolbar 12, card padding 16, dialog body 16, between fields 16, label to field 4, between sections 24, page gutter 16. Radius: 4 controls (`--mf-radius`), 8 menus, popovers, tooltips and inner boxes (`--mf-radius-lg`), 12 cards, grid frames and dialogs (`--mf-radius-xl`), 6 only the navigation pill, pill for chips, 50% for avatars. Shadow: `--mf-shadow-card` on cards, `--mf-shadow-pop` on menus, popovers and dialogs. Don't: other values, weight 500 or 800, a colour literal, a thick coloured edge. Guards: `check-theme-colours`, `size-tokens.spec`.

**D-02 Control height [OWNER, owner approved 36 px].** Button, segmented switch, dropdown trigger, search, input, textarea row, date and time field, icon button: 36 px (`--mf-ctl-h`; icon buttons 36 x 36). Inside a table cell or the inline filter row: 32 px (`--mf-ctl-h-sm`). Text buttons: 24 px **[OWNER]** (`--mf-target-min`). Targets are never below 24 px. Ref: Dashboard > Users toolbar.

**D-03 Layout frame.** Fixed-page layout **[OWNER]**: at 768 x 561 and larger the page never scrolls, only inner regions. Main-area gutter 16 px, header 12 px below the top, grid frame fills to the bottom gutter. Forms 480 px per field (`--mf-field-max`).

**D-04 Colour meaning.** Red = overdue, failed, destructive; amber = at risk, warning; blue = information, link, in progress; teal = healthy, completed; violet = needs a person; deep orange = critical; slate = neutral, on hold, sensitive (`--mf-sem-<meaning>-*`). Every coloured signal also has an icon or a word. **No hatching or diagonal stripes anywhere [OWNER]** (an overdue part of a bar is solid red next to an "N overdue" chip). In the Dashboard Calendar the date of every Saturday, Sunday and holiday is red text (`--mf-danger`, #1225), with the flag chip or column as the second signal; the weekday heading is the shared grid heading and closed days use `--mf-cal-off-bg`, a different tint.

**D-05 States.** Default / hover / focus / active / disabled / selected / error are the same for every control: focus = 2 px `--mf-focus` ring, 2 px offset (never removed; the page heading that receives focus programmatically shows no ring); hover = `--mf-primary-hover` (primary) or `--mf-surface-alt` (secondary), rows and clickable cards `--mf-row-hover`; disabled = `--mf-surface-alt` fill and `--mf-text-disabled` text (no opacity); selected row `--mf-selected-bg`, selected card 2 px inset `--mf-primary`, selected tab 2 px `--mf-primary` underline, selected chip solid `--mf-primary`; error = 1 px `--mf-danger` border and a message below.

### 2.2 Components

**D-10 Card.** `--mf-surface`, 1 px `--mf-border-soft`, radius 12, `--mf-shadow-card`, padding 16; title 16/600 (12 below); clickable card hover `--mf-row-hover`; no coloured edge, no nested cards. Figure card: figure 24/700, label 13 muted.

**D-11 Section heading** inside a page or card: 16/600, 24 above, 8 below, optional count chip.

**D-12 Chips (four kinds).** Status/state (`mf-status-chip`, `mf-badge`): 26 px, pill, 12/600, icon 16 + word, tint from `--mf-status-*` or `--mf-sem-*`. Count (`mf-count-chip`): 22 px, `--mf-surface-alt`. Filter/toggle (`mf-filter-chips`): 26 px, selected solid `--mf-primary` with a tick, `aria-pressed`. Tag/scope (`mf-tag-chip`): removable, 26 px, remove button with accessible name "Remove <name>". Priority: `mf-priority-flag` (pill for Critical and High, plain words for Normal and Low). Task type: `mf-task-type-chip` (32 px tile, solid `--mf-tt-<colour>`, white glyph; 24 px small). Don't: a private `.chip/.badge/.pill/.tag`, a chip without an icon (status), a repeated "Available" chip, chips taller than 28.

**D-13 Links.** A link navigates: `--mf-link`, underlined (offset 2 px), hover `--mf-primary-hover`, no visited colour; identifier links (Ref, CM Number) in `--mf-font-mono`. Navigation links (nav, tabs, breadcrumb, pager) are not underlined. Anything that acts (Edit, Delete, Change, Add, Assign) is a text button `mf-btn mf-btn--text`. Don't: `.lnk`, `.link`, "click here".

**D-14 Dropdowns.** Choices in a toolbar, filter bar, card header or filter row are `mf-dropdown`: trigger 36 px (32 in a cell), radius 4, `--mf-border-strong`, optional muted prefix ("State:"), chevron; fixed width (widest option, max 22 rem); list radius 8, item 36 px, selected = check + 600; more than 10 options adds a search field; multi-select has checkboxes, "All <Things>" first, trigger "State: Idle +1". Data-entry selects inside a form may be native in the shared input style. Option text and the value a trigger shows are **Title Case** when they are fixed UI words ("All Pods", "Any Date", "Last 30 Days"); data (names, admin-edited labels) is shown as stored.

**D-15 Tabs.** `mf-tabs` only: 40 px (`--mf-tab-h`), icon `--mf-icon-lg` on every tab (`shared/ui/tab-icons.ts`), label 14/400 (selected 14/600 `--mf-primary` + 2 px underline), count in brackets "(12)". Order on a page: title row, one-line description, tab strip, 12 px, toolbar and content. Labels Title Case.

**D-16 Segmented switch.** `.mf-seg` with `mfSegmented`: 36 px, radius 4 on the outer corners, equal segments, selected solid `--mf-primary` with white 600 text and no tick, icons 20 px; 2 to 4 options. Collapsed to icons only (card narrower than 25 rem) every segment is 36 x 36 with the label as `aria-label` and tooltip.

**D-17 Icons.** Scale: xs 12 (tiny marks), sm 16 (chips, text), md 18 (buttons, rows), lg 20 (tabs, switches, page tile glyph), xl 24 (`--mf-icon-xl`, only the icon of an empty, error or system-page state block). Navigation `--mf-nav-icon`. One icon per concept in one registry (`shared/ui/tab-icons.ts`, `shared/layout/nav-items.ts`, `shared/layout/section-icons.ts`; the page tile icon equals the navigation icon). `pi-home` is Dashboard and record Summary tabs; Dashboard Summary tab uses its own icon. Icon-only controls have an accessible name and `[mfTip]`.

**D-18 Tooltips.** `[mfTip]` only (hover after 300 ms and keyboard focus), dark `--mf-tip-bg`, 13 px, radius 8, max 280 px, never the only place for essential information.

**D-20 Capitalisation.** *Click it or name it = Title Case; read it = sentence case.* Title Case: page titles, navigation, tabs, buttons, menu items, text buttons, column headings, field labels, card and dialog titles, fixed chip words ("Out of Office", "On Hold"), dropdown options, route and browser-tab titles. Sentence case: help and description lines, placeholders, tooltips that are sentences, toasts, empty and error messages, dialog questions, "Rows per page", "Showing 1-50 of 143", "Sorted by Name". **Minor words stay lowercase except as first word:** a, an, and, as, at, but, by, for, from, in, into, of, on, or, per, the, to, via, vs, with ("Produced by Us", "Created by Me", "Open Work by Task Type"; "By Member" keeps its capital as the first word). Admin-edited names are shown as stored.

**D-21 Page header.** `mf-page-header` (`shared/ui/page-header.ts`): breadcrumb row on non-top-level pages (13 px muted, cut at 40 characters), title row 36 px: icon tile 32 x 32 (radius 8, `--mf-primary`, white icon 20, `--mf-tile-size`), H1 22/700, count chip (lists), actions right `[secondary] [Filters] [primary]`; optional one-line description (13 muted). Record pages: `mf-record-header` (`shared/ui/record-header.ts`): same tile with the record-type icon, bold title, actions `[Edit] [Activity] [primary] [...]`. Scope and period selectors in the actions are capped at 22 rem. The top-bar "New Task" button is hidden where the page has its own.

**D-22 Vocabulary** (section 4.4).

**D-23 Uppercase** only for grid column headings (12/700 muted) and the navigation section label "ADMINISTRATION".

**D-30 Action order.** Primary last. Dialog or drawer with a form: footer `[Cancel] ........ [Primary]` (space between). Routed page form: sticky bar at the bottom, right aligned `[Cancel] [Create and Add Another] [Primary]`, Delete far left. Profile and Settings forms: `[Cancel] [Save Changes]` right, "No unsaved changes" left, primary disabled until dirty. A dialog with no primary action has one `[Close]` right aligned.

**D-31 Dialogs.** Create, edit and forms: `mf-form-dialog` (`shared/ui/form-dialog.ts`); yes/no with consequence: `mf-confirm-dialog`; pickers: `lookup-dialog`. Header 56 px: title 16/600 Title Case (verb and thing: "New Project"), optional subtitle 13 muted, close icon button 36 x 36. Body padding 16, scrolls inside, max 90% of the window. Footer top line 1 px `--mf-border-soft`. Radius 12, `--mf-shadow-pop`. Esc and scrim click close, Tab stays inside, focus returns to the opener; a dirty close asks "You have unsaved changes. Discard them?" with `[Keep Editing] [Discard Changes]`. Don't: raw `p-dialog`, a dialog that opens another dialog.

**D-32 Dialog sizes.** Small 416 px (confirm, one to three fields), default 576 px (most forms), large 768 px (Edit Task, two-column forms); tokens `--mf-dialog-w-sm`, `--mf-dialog-w`, `--mf-dialog-w-lg`, set only by the `size` input.

**D-33 Drawers.** `mf-slide-panel` (`shared/ui/slide-panel.ts`): 520 px (`--mf-drawer-w`), `size="large"` 720 px for a grid; reading and detail context only. Header 56 px: title 16/600, icon actions (18 px icon, 36 target), close; tab strip under the header; body scrolls; a footer only when it edits (D-30). The list stays visible behind it.

**D-34 Confirm dialogs.** Title = verb and thing without a question mark ("Deactivate Priority"); body one sentence saying what happens and whether it can be undone; `[Cancel] ... [<Verb> <Thing>]`, danger confirms use the solid red `mf-btn--solid`. Cancel is always "Cancel" except the unsaved-changes dialog. A reversible action does not ask: it acts and offers Undo in a toast.

**D-35 Forms.** Label above the field (13/600, 4 px gap); field 36 px (textarea min 4 lines); help below (13 muted); error below (13 `--mf-danger` with `pi-exclamation-circle`, `role="alert"`); fields 16 px apart; one column to 480 px, two columns (16 gap) only in a large dialog or a page at 1100 px and wider; required fields end the label with the muted word "(required)" **[decided: kept from the existing app]**, optional fields carry no mark; read-only values are plain text; native date and time fields with `lang="en-US"` (shows MM/DD/YYYY). Don't: placeholder as label, "(optional)".

**D-36 Menus and popovers.** Radius 8, 1 px `--mf-border-soft`, `--mf-shadow-pop`, padding 4; item 36 px, 14 px, icon 18 + 8 gap (an item without an icon reserves the slot), hover `--mf-row-hover`, danger item `--mf-danger`, separator 1 px; width 200 to 360 (filter popover 320). A "..." menu holds two or more secondary actions; one action is its own icon button. Group headings in sentence-style Title Case 13/600 (not uppercase).

**D-40 Buttons.** Five kinds: primary (one per bar, form or dialog), secondary (white outline), danger (outlined; solid only in a confirm), text (`mf-btn--text`), icon only (`mf-btn--icon`, 36 x 36). Label 14/600, padding 0 12, gap 8, icon 18, Title Case verb or "+ New <Thing>" with `pi-plus`. A busy button shows "Saving...". Don't: local button CSS, `size="small"`, two primaries in a bar, a trailing "..." in a label.

**D-41 Where the "+ New" button sits.** In the page header (last action); on a tab without an H1 at the right end of the control row. The empty body of a list repeats it (D-51).

**D-42 Grid anatomy.** `mf-grid-frame` + the list toolbar (`mf-list-toolbar`): row 44 comfortable / 36 compact (`--mf-grid-row-h*`), header 40 (12/700 uppercase muted on `--mf-surface-alt`), row line `--mf-border-soft`, hover `--mf-row-hover`, no zebra, cells 14/400 padding 0 12, frame radius 12 with card shadow; sideways scroll inside the frame, identifier pinned; `mf-pager` 25 / 50 / 100 (default 50) on every list; zero in Overdue, Due Soon and On Hold columns is a muted dash (`mf-zero-dash`), other zeros stay "0". Toolbar order: Search, Filters (n), view control, spring, "Sorted by ..." (`mf-sorted-line`), Columns, "...", primary last.

**D-43 Column order and width.** Order: identifier (mono, pinned) - name or title (spring, min 200) - relations (Client, Matter, Project) - people - status words (Priority, Type) - counts (right aligned) - dates - Status chip - Progress - row action. Widths (px): identifier 112-142, relation 140-160, person 136-150, Type 112, count 96, date 136, status chip 140, progress 120, row action 48 (tokens `--mf-col-*`). Task grids: Ref, Type, Title, CM Number, Matter Name, Project, Priority, Assignee, Due, Status, Progress. Assets: Type, Name, CM Number, Size, Linked Tasks, External Reference, Disposition. Matters: CM Number, Matter Name, Client, Primary PM, Secondary PM, Open Tasks, Overdue, Status. Admin lists: Name, Description, counts, Status, row action (no toolbar, no search, no sort; "+ New" in the header). A column heading equals the field label of the same field. Nothing is cut mid-word at 1366: chips are whole, names get ellipsis and a tooltip.

**D-44 Row actions.** One icon-only "..." (36 target, no border, muted at rest, full on row hover or focus), two or more actions in its menu; one obvious action is its own icon button; the whole row opens the record.

**D-45 Truncation.** Names one line with ellipsis plus tooltip; descriptions two lines; toolbar text fits at 1366 ("Sorted by Load", "Search by name").

**D-47 Record not found.** The state-page card (D-53) in the shell with the breadcrumb above and one `Go to <List>` button.

**D-50 Loading.** First load: a skeleton with the final layout (`mf-record-skeleton`, grid skeleton rows); a refresh keeps the old content; a busy button "Saving..."; live text "Loading <thing>".

**D-51 Empty and error** (`mf-state-block` for areas, `mf-record-state` for records, `AdminListState` / `adminListView` for admin lists). One block: icon at `--mf-icon-xl`, one sentence with a full stop, optional Title Case button. First use: "No tasks yet." + "+ New Task" (with permission; admin lists too). Filtered: "No tasks match these filters." + "Clear Filters". Search: "No results for "<text>"." Read-only: "No tasks." Error: warning icon in `--mf-sem-overdue-solid`, "Couldn't load tasks.", optional reason, `Retry`; **no toast for a failure the page shows inline** (action failures keep their toast). Stale save: "This <thing> was changed by someone else." + `Reload Latest`. No access: "You don't have access to <thing>."

**D-52 Toasts** (`core/notify/notification.service.ts`: `success|info|warn|error(summary, detail?, options?)`). Summary sentence case "<Thing> <past participle>", no full stop ("Role saved", "Production deleted", "Link copied"); optional detail (a sentence with a full stop, or the name). Errors "Couldn't save the role." + reason. Timing: success 4 s, info 6 s, warning 8 s, error until closed; at most three visible; `key` replaces a repeat. Undo toast "Pods of Ann Lee restored." with Undo; "Not undone: ..." when it cannot.

**D-53 System pages.** Access Pending, 403, 404, Error, not-found: one `mf-state-page` card (480 px, radius 12, tile, H1 22/700 on one line, one sentence, one button, error reference with a copy button).

**D-60 Dates [OWNER, owner approved the numeric form].** Data: `MM/DD` this year, `MM/DD/YYYY` otherwise; instants `MM/DD hh:mm AM/PM` (12-hour, leading zero, the person's time zone decides). Helpers: `shared/ui/numeric-date.ts` (`numericDate`, `numericDateAndTime`, `numericInstant`, pipe `mfNum`). Long form with the FULL month for tooltips, accessible names, calendar headings and sentences: "October 12, 2026, 10:23 PM EDT" (`readableDate`, `readableInstant`, pipe `mfDateLong` in `title`/`aria-label` only). Relative words ("Today", "3 h ago", "Due in 2 d") only where they exist. Don't: "Oct 12, 2026" in a cell, ISO text, a zone in a cell.

**D-61 Numbers** (`shared/ui/number-format.ts`, pipe `mfInt`): thousands comma "1,234"; percent "37%"; duration "2 h 48 m"; size "1.2 MB" (base 1024, one decimal); range "1-50 of 143"; counts in tab labels "(372)"; tabular figures in grids and figure cards.

**D-62 Names of people** (`shared/ui/person-name.ts`): display name, else the account without the domain (`shortAccountName`). Never `KE\account` in a grid, card, feed or detail (Profile account field and Audit Logs raw column keep it).

### 2.3 Navigation

**D-80 Navigation.** Dark navy panel 220 px (56 px rail 640 to 1099 px), selected item = white pill, 6 px radius, bold; items Title Case: Dashboard, My Matters, My Work, Clients, Matters (Projects, Assets), Pod Work, Task Queue; ADMINISTRATION: Users, Task Types, Labels, Asset Types, Custom Fields, Reports, Audit Logs, Settings. Top bar: logo, global search (placeholder "Search clients, matters, tasks, assets...", Ctrl+K hint unchanged), "+ New Task", bell, user menu. **No new or changed keyboard shortcut [OWNER, #420].**

**D-81 Breadcrumbs** only on non-top-level pages, 13 px muted, ">" separators, current page plain.

### 2.4 Status vocabulary

| Domain | Words | Source |
| --- | --- | --- |
| Task status | New, In Progress, On Hold, Completed, Cancelled | `--mf-status-*`, `mf-status-chip` |
| Priority | Critical, High, Normal, Low | `--mf-pr-*`, `mf-priority-flag` |
| Due | Overdue, Due Today, Due Soon, At Risk, ASAP, Tomorrow; suffix `+9d` | `shared/work-queue/due-cell.ts`, `due-suffix.ts` |
| Matter / record | Active, Inactive, Sensitive | `mf-active-badge`, `mf-sensitive-badge` |
| Asset disposition | Active, Inactive, Pending Disposition, Disposed | `mf-status-chip` (disposition kind) |
| Person state | Idle, Light, Normal, Heavy, Out of Office, Off Hours | `shared/icons/user-state-icon.ts` |
| Coverage | Good, Watch, Low, Critical, Closed, Non-Working | `--mf-cov-*` |
| Workflow version | Draft, Published, Retired | status chip |

One word per meaning; "Available" is spoken, never a chip **[OWNER]**; status names edited in Administration are shown as stored.

---

## 3. Component catalogue (use this, not something else)

Frontend root `frontend/src/app/`. Tokens: `docs/ux/tokens.css`. Global styles: `frontend/src/styles/`.

| Need | Use | Where | Exact values |
| --- | --- | --- | --- |
| Page header (list, workspace, admin) | `mf-page-header`, `mf-title-icon` | `shared/ui/page-header.ts` | D-21; tile 32 px, H1 22/700 |
| Record header | `mf-record-header` | `shared/ui/record-header.ts` (+ `.scss`) | D-21; actions Edit, Activity, primary, "..." |
| Tabs | `mf-tabs`, icons from `tab-icons.ts` | `shared/ui/tabs.ts`, `tab-icons.ts` | 40 px, icon 20, underline 2 px |
| Segmented switch | `[mfSegmented]` on `.mf-seg` | `shared/ui/segmented.ts`, `styles/_buttons.scss` | 36 px, solid selected |
| List toolbar | `mf-list-toolbar`, `mf-list-filters-button`, `mf-search-box`, `mf-sorted-line` | `shared/filters/list-toolbar.ts`, `shared/ui/search-box.ts`, `sorted-line.ts` | one 36 px row, order in D-42 |
| Filter chips (toggle) | `mf-filter-chips` | `shared/ui/filter-chips.ts` | 26 px, `aria-pressed` |
| Dropdown, multi-select | `mf-dropdown` | `shared/ui/dropdown.ts` | D-14 |
| Column filters in a grid | `mfColumnFilterRow` | `shared/filters/column-filter-row.ts` | 32 px controls |
| Buttons, text buttons, icon buttons | `p-button` (preset) or `mf-btn`, `mf-btn--primary/--danger/--text/--icon` | `styles/_buttons.scss`, `core/theme/mf-preset.ts` | D-40 |
| Chips and badges | `mf-status-chip`, `mf-badge`, `mf-count-chip`, `mf-tag-chip`, `mf-tile-chip`, `mf-priority-flag`, `mf-priority-pill`, `mf-task-type-chip` | `shared/ui/*.ts` | D-12 |
| Links | `a` (global rule) / `.mf-link`, `.mf-link--id` (identifiers); actions `mf-btn--text` | `styles.scss` | D-13 |
| Cards, stat tiles | `.mf-card`, `.mf-card__title`, `.mf-section-title`, `.mf-card--clickable`, `.mf-card--selected`; `mf-stat-tile` | `styles/_cards.scss`, `shared/ui/stat-tile.ts` | D-10 |
| Grid | `mf-grid-frame`, `mf-task-table`, `mf-pager`, `mf-zero-dash`, `mf-grid-columns` | `shared/ui/grid-frame.ts`, `pager.ts`, `zero-dash.ts`, `grid-columns.ts`; `shared/work-queue/task-table.ts`; `styles/_tables.scss`, `_admin-lists.scss` | D-42, D-43; column tokens `--mf-col-*` |
| Row actions | `mf-action-menu` (`am__trigger`), `mf-options-menu` | `shared/ui/action-menu.ts`, `options-menu.ts` | D-44 |
| Forms and fields | `mf-text-field`, form styles, `mf-char-counter` | `shared/ui/text-field.ts`, `styles/_forms.scss`, `_form-mixins.scss`, `shared/ui/form-field.scss` | D-35 |
| Create and edit dialog | `mf-form-dialog` (`size` small/default/large) | `shared/ui/form-dialog.ts`, `styles/_dialogs.scss` | 416 / 576 / 768 |
| Confirm dialog | `mf-confirm-dialog` | `shared/ui/confirm-dialog.ts` | D-34 |
| Picker dialog | `lookup-dialog`, `entity-picker`, `asset-picker` | `shared/ui/lookup-dialog.ts` | |
| Drawer | `mf-slide-panel` | `shared/ui/slide-panel.ts` | 520 / 720 |
| Menus and popovers | `mf-action-menu`, `mf-options-menu`, `views-menu`, `export-menu`, `filter-popover`, `styles/_menus.scss` | `shared/ui/`, `shared/filters/filter-popover.ts` | D-36 |
| Tooltips | `[mfTip]` | `shared/ui/tip.ts` | D-18 |
| Toasts | `NotificationService`, `UndoService` | `core/notify/` | D-52 |
| States | `mf-state-block`, `mf-record-state`, `AdminListState`, `mf-state-page`, `mf-record-skeleton` | `shared/ui/state-block.ts`, `record-state.ts`, `admin-list-state.ts`, `state-page.ts`, `record-skeleton.ts` | D-47, D-50, D-51, D-53 |
| Empty copy of work lists | `emptyCopy`, `queueEmpty` | `shared/work-queue/empty-copy.ts` | fixed sentences |
| Dates | `mfNum`, `numericDate*`, `readableDate/Instant`, `mfDateLong` | `shared/ui/numeric-date.ts`, `shared/pipes/mf-date-long.pipe.ts`, `core/time/time.ts` | D-60 |
| Due cell | `describeDueCell`, `mf-due-suffix-cell` | `shared/work-queue/due-cell.ts`, `due-suffix.ts`, `core/time/time.ts` | MM/DD + words / suffix |
| Numbers | `formatInt/Percent/Duration/Bytes/Range/Ago`, `mfInt` | `shared/ui/number-format.ts` | D-61 |
| Person names | `shortAccountName` | `shared/ui/person-name.ts` | D-62 |
| Icons | PrimeIcons by registry; task type icons; person-state icons | `shared/ui/tab-icons.ts`, `shared/layout/nav-items.ts`, `section-icons.ts`, `shared/icons/` | scale 12/16/18/20 (+24 state blocks) |
| Navigation, shell | `app-shell`, `NAV_ITEMS`, `user-menu`, `notification-bell`, `global-search` | `shared/layout/`, `shared/search/` | D-80 |
| Colours, radii, sizes | CSS variables | `docs/ux/tokens.css`, `docs/ux/theme-guide.md` | no literals |

If the need is not in the table: ask the designer (section 7), do not invent a component.

---

## 4. Wording and formats

### 4.1 Title Case or sentence case
Rule D-20. Check a new string: can I click it, or does it name a page, tab, column, field, card, dialog, chip, option? Title Case. Is it a sentence or status text? Sentence case. Minor words lowercase (list in D-20).

### 4.2 Button and menu label vocabulary
| Meaning | Label |
| --- | --- |
| Open a create flow | "+ New <Thing>" ("New Task", "New Asset Type") |
| Submit a create flow | "Create <Thing>"; "Create and Add Another" |
| Submit an edit | "Save Changes" |
| Add to a list | "Add <Thing>" ("Add Holiday", "Add Event") |
| Open an edit | "Edit" / "Edit <Thing>" |
| Abandon | "Cancel" (unsaved-changes dialog: "Keep Editing" / "Discard Changes") |
| Failed action again | "Retry" |
| Stale data | "Reload Latest" |
| Remove filters / sort | "Clear Filters" / "Reset Sort" |
| Destructive confirm | "<Verb> <Thing>" ("Delete Note", "Deactivate Priority") |
| Busy | "Saving...", "Loading..." |
| Column menu | "Sort Ascending", "Sort Descending", "Widen", "Narrow", "Fit to Content", "Reset Width", "Hide Column" |

### 4.3 Message patterns
| Kind | Pattern | Example |
| --- | --- | --- |
| Toast success | "<Thing> <past participle>" | "Role saved" + detail "Changes apply on each user's next request." |
| Toast error | "Couldn't <verb> the <thing>." + reason | "Couldn't save the role." |
| Empty first use | "No <things> yet." | "No tags yet." |
| Empty filtered | "No <things> match these filters." | |
| Error load | "Couldn't load <things>." | |
| Missing record | "We couldn't find that <thing>." | |
| Confirm body | one sentence, what happens, undoable or not | "21 open tasks keep this priority. It won't be offered for new or changed tasks. You can activate it again." |

### 4.4 Glossary (one word per concept)
| Concept | Word | Never |
| --- | --- | --- |
| Matter number | CM Number | Matter reference |
| Last edit | Last Updated (feeds: "Updated 3 h ago") | Modified, Last changed |
| Creation | Created | Added on |
| Workflow position | Progress | Workflow progress |
| Managers | Primary PM, Secondary PM | Project manager |
| Person on a task | Assignee | Assigned to, Owner |
| Work list | Task Queue | Tasks |
| Availability | Out of Office, Off Hours, Available (spoken only) | |
| Retry | Retry | Try again, Reload |

### 4.5 Formats
Dates and times D-60; numbers D-61; names D-62; time zone shown only in the long form.

---

## 5. New screen / change checklist (tick before you push)

- [ ] I read sections 1 and 2 and every rule that touches my change.
- [ ] Every element comes from the catalogue (section 3); no private chip, link, button, dialog, drawer, menu, card or state block.
- [ ] Tokens only: no colour literal, no px icon size, radius and font size from the scales (`npm run lint` passes).
- [ ] Heights per D-02, grid per D-42/D-43, dialog and drawer sizes per D-32/D-33 (measure in the browser, do not eyeball).
- [ ] Copy: Title Case rule, label vocabulary, toast and state sentences, dates, numbers, names, glossary (section 4).
- [ ] States: hover, focus ring, disabled, selected, error, empty, loading, error block, missing record.
- [ ] Nothing cut or wrapped at 1366x768 (chips whole, toolbars on one row), nothing overflowing at 1920x1080.
- [ ] Screenshots at 1366x768 and 1920x1080 of every changed screen, dialog, drawer and menu, with real or realistic data; axe 0 violations.
- [ ] No new or changed keyboard shortcut; initial bundle under 700 kB.
- [ ] Guard specs green (section 6); `tsc` for app, spec and e2e; `npm run format:check`; real `ng build`.
- [ ] If I added or changed a pattern, I updated this file, `docs/ux/theme-guide.md` and the guard in the same change.
- [ ] Commit message in the owner's format (first line `<ID> <short what changed>`, then bullets per main page and tab).

---

## 6. Automated guards

Run all: `cd frontend && npm run lint` (eslint + the three scripts) and `npm test` (unit specs). One spec: `npm run ng -- test frontend --watch=false --include=src/app/shared/ui/capitalisation-guard.spec.ts`.

| Guard | File | Catches |
| --- | --- | --- |
| Theme colours | `frontend/scripts/check-theme-colours.mjs` | any colour literal outside `tokens.css` (empty baseline) |
| Theme contrast | `frontend/scripts/check-theme-contrast.mjs` | a token pairing below 4.5:1 text / 3:1 graphics |
| Icon sizes | `frontend/scripts/check-icon-sizes.mjs` | a px or rem icon size in shared code |
| Size tokens | `core/theme/size-tokens.spec.ts` | tokens.css and styles contradicting (control height, tab, dialog, drawer) |
| Capitalisation | `shared/ui/capitalisation-guard.spec.ts` | a button, heading, dialog title or column text not in Title Case (D-20) |
| Button rule | `shared/ui/button-rule.spec.ts` | local button paint, `size="small"` |
| Link style | `shared/ui/link-style.spec.ts` | private link classes, wrong link CSS |
| Chip kinds | `shared/ui/chip-kinds.spec.ts` | a private chip look |
| Card style | `shared/ui/card-style.spec.ts` | card radius, border, shadow, padding drift |
| Page header | `shared/ui/page-header-rule.spec.ts` | a page drawing its own header |
| Grid anatomy | `shared/ui/grid-anatomy.spec.ts` | row, header and frame values |
| Form anatomy | `shared/ui/form-anatomy.spec.ts` | field height, label, help, error, action bar |
| Menu anatomy | `shared/ui/menu-anatomy.spec.ts` | menu surface and item values |
| Tab icons | `shared/ui/tab-icons.spec.ts` | tab without an icon, own `role="tab"` |
| Dialog and drawer | `shared/ui/form-dialog.spec.ts`, `slide-panel.spec.ts`, `lookup-dialog.spec.ts` | widths, footer order, focus |
| Icon xl | `shared/ui/icon-xl-use.spec.ts` | the 24 px icon outside state blocks |
| Long date | `shared/pipes/mf-date-long-use.spec.ts` | the long date form printed in a cell or field |
| Bundle | `shared/layout/initial-bundle.spec.ts` | initial bundle over 700 kB |
| Accessibility | `frontend/e2e/support/axe.ts` (e2e), `docs/ux/ui-update/crawl/axe.js` (page sweep) | axe violations |
| Visual and text probes | `docs/ux/ui-update/crawl/` (`crawl*.js`, `scan.js`, `caps.js`, `probe-dates.js`); stack: `docs/ux/ui-update/stack-howto.md` | measured heights, month-name dates, raw accounts, lowercase labels |

A guard that fails is fixed by changing the code, not the guard. A legitimate exception goes into the guard's `ALLOWED` list with its reason and into section 8.

---

## 7. How to change the standard

1. **Who decides:** the UI designer role (owner approves). Developers do not decide the look by themselves.
2. **Propose:** open an issue "UI standard: <what>" with a screenshot of the need, the rule it touches and the exact change proposed; or comment on the issue you work on and stop.
3. **Change together, in one pull request:** `docs/ux/tokens.css` (values), `docs/ux/theme-guide.md` (detail), this file (rule, catalogue, wording), the shared component, the guard spec and its `ALLOWED` list, and the screenshots at both sizes.
4. **Record:** the rule id stays stable (D-xx); add a line to section 8 if it is an exception; a decision by the owner is marked **[OWNER]**.
5. **A new pattern without this** is a defect.

---

## 8. Known exceptions (with reasons)

| Exception | Reason |
| --- | --- |
| Text buttons are 24 px, not 36 | owner decision; they sit inline like a link |
| Dashboard > Users, Admin Users pods popover keeps Apply / Cancel (`[Cancel] [Apply]`, primary last) | multi-choice popover that applies as one change; not a form dialog |
| Calendar day cells and swimlane cards are not 36 px controls | they are content cells |
| Assign Work dialog: `[Cancel] ... [Assign N selected] [Assign the next 3]` | two real actions; primary last |
| A dialog with no primary action has one right-aligned `[Close]` | nothing to cancel (icon picker, read-only picker) |
| Grid filter row and cell editors are 32 px | dense cells (D-02) |
| Navigation item radius 6 px | owner decision for the selected white pill |
| Chart axes use the same `MM/DD` as cells | consistency; month names only in tooltips |
| Profile account field and Audit Logs show `KE\account` | raw account is the data there |
| Brief known gaps: the 403 page is not yet the `mf-state-page` card; Task Queue, My Work and Pod Work still show the top-bar "New Task" beside the page's own | tracked in epics #1117 and #1110, remove when done |
