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

**D-01 Scales.** Type 12 / 13 / 14 (body and controls) / 16 (card, dialog and menu titles) / 18 / 22 (page title) px (`--mf-fs-xs`..`--mf-fs-h2`); figures 24 and 32 px (`--mf-fs-figure`, `--mf-fs-figure-lg`). Weights 400, 600, 700. Spacing 4, 8, 12, 16, 24, 32, 48 (`--mf-s1`..`--mf-s7`): inside a control 0 12, between controls 8, header to toolbar 12, card padding 16, dialog body 16, between fields 16, label to field 4, between sections 24, page gutter 16. Radius: 4 controls (`--mf-radius`), 8 menus, popovers, tooltips and inner boxes (`--mf-radius-lg`), 12 cards, grid frames and dialogs (`--mf-radius-xl`), 6 only the navigation pill (`--mf-nav-item-radius`; the `--mf-radius-md` token is retired, #1229), pill for chips, 50% for avatars. Shadow: `--mf-shadow-card` on cards, `--mf-shadow-pop` on menus, popovers and dialogs. Don't: other values, weight 500 or 800, a colour literal, a thick coloured edge, a font size in rem or em, a size token that does not exist (`--mf-fs-body`, `--mf-fs-xl`, `--mf-radius-sm`). Guards: `check-theme-colours`, `check-off-scale` (radius, font size, weight, capitals and undefined size tokens; #1155), `size-tokens.spec`.

**D-02 Control height [OWNER, owner approved 36 px].** Button, segmented switch, dropdown trigger, search, input, textarea row, date and time field, icon button: 36 px (`--mf-ctl-h`; icon buttons 36 x 36). Inside a table cell or the inline filter row: 32 px (`--mf-ctl-h-sm`). Text buttons: 24 px **[OWNER]** (`--mf-target-min`). Targets are never below 24 px. Ref: Dashboard > Users toolbar.

**D-03 Layout frame.** Fixed-page layout **[OWNER]**: at 768 x 561 and larger the page never scrolls, only inner regions. Main-area gutter 16 px, header 12 px below the top, grid frame fills to the bottom gutter. Forms 480 px per field (`--mf-field-max`).

**D-04 Colour meaning.** Red = overdue, failed, destructive; amber = at risk, warning; blue = information, link, in progress; teal = healthy, completed; violet = needs a person; deep orange = critical; slate = neutral, on hold, sensitive (`--mf-sem-<meaning>-*`). Every coloured signal also has an icon or a word. **No hatching or diagonal stripes anywhere [OWNER]** (an overdue part of a bar is solid red next to an "N overdue" chip). In the Dashboard Calendar the date of every Saturday, Sunday and holiday is red text (`--mf-danger`, #1225), with the flag chip or column as the second signal; the weekday heading is the shared grid heading and closed days use `--mf-cal-off-bg`, a different tint.

**D-05 States.** Default / hover / focus / active / disabled / selected / error are the same for every control: focus = 2 px `--mf-focus` ring, 2 px offset (never removed; the page heading that receives focus programmatically shows no ring); hover = `--mf-primary-hover` (primary) or `--mf-surface-alt` (secondary), rows and clickable cards `--mf-row-hover`; disabled = `--mf-surface-alt` fill and `--mf-text-disabled` text (no opacity); selected row `--mf-selected-bg`, selected card 2 px inset `--mf-primary`, selected tab 2 px `--mf-primary` underline, selected chip solid `--mf-primary`; error = 1 px `--mf-danger` border and a message below.

### 2.2 Components

**D-10 Card.** `--mf-surface`, 1 px `--mf-border-soft`, radius 12, `--mf-shadow-card`, padding 16; title 16/600 (12 below); clickable card hover `--mf-row-hover`; no coloured edge, no nested cards. Figure card: figure 24/700, label 13 muted.

**D-10a Banner (#1196).** One bar for every notice: `.pg-banner` (`styles/_banners.scss`; the sensitive bars of the record headers use it too), one line, 36 px (taller only when the text must wrap), radius 4, 1 px `-line` border and no thick edge, leading icon 16, text 14, one secondary 32 px action at the right ("Retry", "Reload Page"). Amber (`--mf-sem-risk-*`) warns, blue (`--mf-sem-info-*`, `pg-banner--info`) informs; `--danger` and `--success` exist for a failed sign-in and "Back online". The global ones (offline, sign-in, Dev auth) add `pg-banner--full`: full width at the top of the main area, no radius, a bottom line only.

**D-11 Section heading** inside a page or card: 16/600, 24 above, 8 below, optional count chip.

**D-11a Sub-heading inside a card (decided after review 15, #1172).** A group inside a card (Task page Details: Description, Task Information) is 14/700, 16 px above, 4 px below, no count chip; the card's own title stays D-11 (16/600).

**D-12 Chips (four kinds).** Status/state (`mf-status-chip`, `mf-badge`): 26 px, pill, 12/600, icon 16 + word, tint from `--mf-status-*` or `--mf-sem-*`. Count (`mf-count-chip`): 22 px, `--mf-surface-alt`; with `overlay` (and `alert` for the alarm colour) it sits over the corner of an icon button: 18 px, `--mf-primary` (`--mf-danger` for alert), white text, 2 px ring in `--mf-surface`. Filter/toggle (`mf-filter-chips`): 26 px, selected solid `--mf-primary` with a tick, `aria-pressed`. Tag/scope (`mf-tag-chip`): removable, 26 px, remove button with accessible name "Remove <name>"; with `colour` (slate, blue, teal, green, amber, orange, red, rose, violet, indigo) it is filled with `--mf-tag-<colour>-bg` and its text and icon take `--mf-tag-<colour>-fg`, and `icon` adds a 16 px PrimeIcons icon (holiday categories use `pi-flag`). A badge tone is neutral, info, success, warning, critical (orange, the coverage level Low) or danger; the Dashboard > Calendar legend words use them. A count chip on a `--mf-surface-alt` panel (the Swimlane lane header) takes `--mf-cc-bg: var(--mf-surface)` so it stays visible. Priority: `mf-priority-flag` (pill for Critical and High, plain words for Normal and Low). Task type: `mf-task-type-chip` (32 px tile, solid `--mf-tt-<colour>`, white glyph; 24 px small). Remaining private chips and their shared home (#1238): colour tag and holiday chip = tag chip with `colour`; counts over an icon = count chip `overlay`; filter-like chips = `mf-filter-chips`; the soft task type badge is retired. Don't: a private `.chip/.badge/.pill/.tag` (guard: `private-classes.spec.ts`), a chip without an icon (status), a repeated "Available" chip, chips taller than 28. An icon of your own (an SVG state icon) goes into `mf-badge` as `<svg mfBadgeIcon>` with `[ownIcon]="true"`; a removable chip that tests need to find takes `[removeKey]` (its remove button gets `data-remove`). Done in #1238: note tags and holiday labels use the tag chip with `colour`; the bell, Notes History / Referenced Items and the side-panel rail counts use the count chip `overlay`; the Search active-filter chips (press to remove, accessible name "Remove filter <label>") and the Out of Office presets (single choice, "Pick a Date" is an action) use `mf-filter-chips`; the soft task type badge (`mf-task-type-badge`) is deleted: a list shows `mf-task-type-cell` (chip and name; 128 px in grids, the full width of the Name column in the Administration > Task Types list), and the Task Queue title cell no longer draws a type icon when the Type column is hidden. The only private chip class left is the loading skeleton `.tc-sk--chips` (guard `private-classes.spec.ts`).

**D-13 Links.** A link navigates: `--mf-link`, underlined (offset 2 px), hover `--mf-primary-hover`, no visited colour; identifier links (Ref, CM Number) in `--mf-font-mono`. Navigation links (nav, tabs, breadcrumb, pager) are not underlined. Anything that acts (Edit, Delete, Change, Add, Assign) is a text button `mf-btn mf-btn--text`. Don't: `.lnk`, `.link`, `.linkbtn`, `.pg-link`, "click here" (guard: `private-classes.spec.ts`). An anchor is `class="mf-link"`; "Retry", "Clear Filters", "Show All Pods" and a name that opens a drawer are `mf-btn mf-btn--text`.

**D-14 Dropdowns.** Choices in a toolbar, filter bar, card header or filter row are `mf-dropdown`: trigger 36 px (32 in a cell), radius 4, `--mf-border-strong`, optional muted prefix ("State:"), chevron; fixed width (widest option, max 22 rem); list radius 8, item 36 px, selected = check + 600; more than 10 options adds a search field; multi-select has checkboxes, "All <Things>" first, trigger "State: Idle +1". Data-entry selects inside a form may be native in the shared input style. Option text and the value a trigger shows are **Title Case** when they are fixed UI words ("All Pods", "Any Date", "Last 30 Days"); data (names, admin-edited labels) is shown as stored.

**D-15 Tabs.** `mf-tabs` only: 40 px (`--mf-tab-h`), icon `--mf-icon-lg` on every tab (`shared/ui/tab-icons.ts`), label 14/400 (selected 14/600 `--mf-primary` + 2 px underline), count in brackets "(12)". Order on a page: title row, one-line description, tab strip, 12 px, toolbar and content. Labels Title Case.

**D-16 Segmented switch.** `.mf-seg` with `mfSegmented`: 36 px, radius 4 on the outer corners, equal segments, selected solid `--mf-primary` with white 600 text and no tick, icons 20 px; 2 to 4 options. A choice with five or more options is a dropdown: the Dashboard > Trends measure control (five measures in the flows panel) is `mf-dropdown` with the prefix "Measure:" in both panels (#1159). Collapsed to icons only (card narrower than 25 rem) every segment is 36 x 36 with the label as `aria-label` and tooltip.

**D-17 Icons.** Scale: xs 12 (tiny marks), sm 16 (chips, text), md 18 (buttons, rows), lg 20 (tabs, switches, page tile glyph), xl 24 (`--mf-icon-xl`, only the icon of an empty, error or system-page state block). Navigation `--mf-nav-icon`. One icon per concept in one registry (`shared/ui/tab-icons.ts`, `shared/layout/nav-items.ts`, `shared/layout/section-icons.ts`; the page tile icon equals the navigation icon). `pi-home` is Dashboard and record Summary tabs; Dashboard Summary tab uses its own icon. Icon-only controls have an accessible name and `[mfTip]`.

**D-18 Tooltips.** `[mfTip]` only (hover after 300 ms and keyboard focus), dark `--mf-tip-bg`, 13 px, radius 8, max 280 px, never the only place for essential information.

**D-20 Capitalisation.** *Click it or name it = Title Case; read it = sentence case.* Title Case: page titles, navigation, tabs, buttons, menu items, text buttons, column headings, field labels, card and dialog titles, fixed chip words ("Out of Office", "On Hold"), dropdown options, route and browser-tab titles. Sentence case: help and description lines, placeholders, tooltips that are sentences, toasts, empty and error messages, dialog questions, "Rows per page", "Showing 1-50 of 143", "Sorted by Name". **Minor words stay lowercase except as first word:** a, an, and, as, at, but, by, for, from, in, into, of, on, or, per, the, to, via, vs, with ("Produced by Us", "Created by Me", "Open Work by Task Type"; "By Member" keeps its capital as the first word). Admin-edited names are shown as stored.

**D-21 Page header.** `mf-page-header` (`shared/ui/page-header.ts`): breadcrumb row on non-top-level pages (13 px muted, cut at 40 characters), title row 36 px: icon tile 32 x 32 (radius 8, `--mf-primary`, white icon 20, `--mf-tile-size`), H1 22/700, count chip (lists), actions right `[secondary] [Filters] [primary]`; optional one-line description (13 muted). Record pages: `mf-record-header` (`shared/ui/record-header.ts`): same tile with the record-type icon, bold title, actions `[Edit] [Activity] [primary] [...]`. Scope and period selectors in the actions are capped at 22 rem. The top-bar "New Task" button is hidden where the page has its own (route data `hidesGlobalCreateTask`: Matter and Project records, Task Queue, My Work, Pod Work; #1167).

**D-22 Vocabulary** (section 4.4).

**D-42a Header rule (decided after review 5).** ONE look for every data grid header: 12/700 uppercase `--mf-text-muted` on `--mf-surface-alt`, 40 px. Calendars are date grids, not data grids: their weekday row is the exception (13/600 normal case, "Sun", red on Sunday and Saturday, `--mf-cal-off-bg` tint for non-working cells). Existing data grids do not change; the Calendar Week table header goes from 45 to 40 px.

**D-04a No stripes (done in #1158).** Dashboard > Breakdowns: the overdue part of a bar, of the Age bar and of a pie slice is a solid `--mf-sem-overdue-solid` fill next to the "N overdue" words; the Low priority bar and slice have a solid 2 px outline (not dashed) and a lighter fill. Dashboard > Summary: the Unassigned Wait gauge segments up to the level are solid `--mf-wait-*` tints with the number inside (white on the dark tints, dark text on the light amber segment 1; segments not reached are `--mf-surface-alt` with a muted number); the battery's neutral states and the legend sample "Out of Office" are solid slate tints. Guard: `features/dashboard/ui/no-stripes.spec.ts` (no `repeating-linear-gradient`, SVG `<pattern>` or hatch token under `features/dashboard`). The optional report patterns of `mf-pie-chart` are gone (#1211): the pie and its legend swatches are solid, every slice carries its number, and the guard also covers `shared/charts`.

**D-23 Uppercase** only for grid column headings (12/700 muted) and the navigation section label "ADMINISTRATION"; tile captions, group headings ("Data Technician"), menu group labels and calendar weekdays ("Sun") are normal case, 13/600 for a group heading (#1155). `scripts/check-off-scale.mjs` lists the files that may use capitals.

**D-30 Action order.** Primary last. Dialog or drawer with a form: footer `[Cancel] ........ [Primary]` (space between). Routed page form: sticky bar at the bottom, right aligned `[Cancel] [Create and Add Another] [Primary]`, Delete far left. Profile and Settings forms: `[Cancel] [Save Changes]` right, "No unsaved changes" left, primary disabled until dirty. A dialog with no primary action has one `[Close]` right aligned.

**D-31 Dialogs.** Create, edit and forms: `mf-form-dialog` (`shared/ui/form-dialog.ts`); yes/no with consequence: `mf-confirm-dialog`; pickers: `lookup-dialog`. Header 56 px: title 16/600 Title Case (verb and thing: "New Project"), optional subtitle 13 muted, close icon button 36 x 36. Body padding 16, scrolls inside, max 90% of the window. Footer top line 1 px `--mf-border-soft`. Radius 12, `--mf-shadow-pop`. Esc and scrim click close, Tab stays inside, focus returns to the opener; a dirty close asks "You have unsaved changes. Discard them?" with `[Keep Editing] [Discard Changes]`; the same question, titled "Unsaved Changes", is asked when a page form or an editor is left (`mf-leave-confirm-host`, the notes editor, the Administration pages; #1246). No "Stay" or "Leave" buttons. Don't: raw `p-dialog`, a dialog that opens another dialog.

**D-32 Dialog sizes.** Small 416 px (confirm, one to three fields), default 576 px (most forms), large 768 px (Edit Task, two-column forms); tokens `--mf-dialog-w-sm`, `--mf-dialog-w`, `--mf-dialog-w-lg`, set only by the `size` input.

**D-33 Drawers.** `mf-slide-panel` (`shared/ui/slide-panel.ts`): 520 px (`--mf-drawer-w`), `size="large"` 720 px for a grid; reading and detail context only. Header 56 px: title 16/600, icon actions (18 px icon, 36 target), close; tab strip under the header; body scrolls; a footer only when it edits (D-30). The list stays visible behind it.

**D-34 Confirm dialogs.** Title = verb and thing without a question mark ("Deactivate Priority"); body one sentence saying what happens and whether it can be undone; `[Cancel] ... [<Verb> <Thing>]`, danger confirms use the solid red `mf-btn--solid`. Cancel is always "Cancel" except the unsaved-changes dialog. A reversible action does not ask: it acts and offers Undo in a toast.

**D-35 Forms.** Label above the field (13/600, 4 px gap); field 36 px (textarea min 4 lines); help below (13 muted); error below (13 `--mf-danger` with `pi-exclamation-circle`, `role="alert"`); fields 16 px apart; one column to 480 px, two columns (16 gap) only in a large dialog or a page at 1100 px and wider; required fields end the label with the muted word "(required)" **[decided: kept from the existing app]**, optional fields carry no mark; read-only values are plain text; native date and time fields with `lang="en-US"` (shows MM/DD/YYYY). Don't: placeholder as label, "(optional)".

**D-36 Menus and popovers.** The row menus of the work grids (Priority, Assignee, Status: `mf-inline-menu`), the Columns chooser panel, the views and export entries and the filter popover entries (and the fields of a chosen filter, 36 px) all use it (#1169); a status entry carries its status icon from `STATUS_CHIPS`. Radius 8, 1 px `--mf-border-soft`, `--mf-shadow-pop`, padding 4; item 36 px, 14 px, icon 18 + 8 gap (an item without an icon reserves the slot), hover `--mf-row-hover`, danger item `--mf-danger`, separator 1 px; width 200 to 360 (filter popover 320). A "..." menu holds two or more secondary actions; one action is its own icon button. Group headings in sentence-style Title Case 13/600 (not uppercase).

**D-36a Menu entry with a description (decided after review 15, #1163).** Only the header "New" menu (My Matters, the entries differ by what they create) may carry a second line: label 14 plus a 13 px muted description, one line, item height 50 px. No other menu has descriptions; row, status and filter menus stay 36 px single-line.

**D-40 Buttons.** Five kinds: primary (one per bar, form or dialog), secondary (white outline), danger (outlined; solid only in a confirm), text (`mf-btn--text`), icon only (`mf-btn--icon`, 36 x 36). Label 14/600, padding 0 12, gap 8, icon 18, Title Case verb or "+ New <Thing>" with `pi-plus`. A busy button shows "Saving...". Don't: local button CSS, `size="small"`, two primaries in a bar, a trailing "..." in a label.

**D-41 Where the "+ New" button sits.** In the page header (last action); on a tab without an H1 at the right end of the control row. The empty body of a list repeats it (D-51).

**D-42 Grid anatomy.** A list of records is `mf-record-grid` (`shared/ui/record-grid.ts`, #1241): one component for the frame, sortable headings, drag to resize (width stored per person and grid id), drag to reorder, the Columns chooser (`mf-record-columns`: show, hide, move, "Reset to Default", "Reset Width"), the loading, empty and error body and the optional selection and row-action columns; the page gives a `RecordGridState` and one `mfCell` template per column. Extension points (#1245): `groupBy` (a 36 px group header row with the label and count, "Archived (3)", a text button with `aria-expanded`, Enter and Space toggle it; `collapsedGroups` lists the groups that start closed), `rowClass(row)` (inactive or selected style of the page), `rowClickable` with `(rowClick)` (a click on the row, Enter and Space on the focused row; a row that has its own link stays opened through the link), the `actions` column and the `mfEmptyAction` slot. **The row-action column is always 48 px** (`--mf-col-actions-w`) and ignores any stored width. **Every column gives a `width` or `minWidth`** (tokens `--mf-col-*-w`; counts `--mf-col-count-w` 96) except the one spring, so the headings do not move between loading, empty, error and rows. **Keyboard:** one Tab stop per heading (its sort button, or the heading cell itself); the resize handle is not a Tab stop; with the heading focused, Shift + Left or Right resizes by 16 px (Ctrl + Shift: 64 px) and Shift + Home sets the minimum. **No hand-built `<table class="pg-table">` or `<table class="mf-grid">` for a record list** (guard `record-grid-guard.spec.ts`; the Administration lists, Assets, Projects and the record tabs are on its allowed list until they migrate). Task lists use `mf-task-table`. The grid is `mf-grid-frame` + the list toolbar (`mf-list-toolbar`): row 44 comfortable / 36 compact (`--mf-grid-row-h*`), header 40 (12/700 uppercase muted on `--mf-surface-alt`), row line `--mf-border-soft`, hover `--mf-row-hover`, no zebra, cells 14/400 padding 0 12, frame radius 12 with card shadow; sideways scroll inside the frame, identifier pinned; `mf-pager` 25 / 50 / 100 (default 50) on every list; zero in Overdue, Due Soon and On Hold columns is a muted dash (`mf-zero-dash`), other zeros stay "0". Toolbar order: Search, Filters (n), view control, spring, "Sorted by ..." (`mf-sorted-line`), Columns, "...", primary last. Search is 18 rem and gives room back down to 11 rem before the row wraps. The three work lists: header, view strip (tabs, where the page has views), summary chips (My Work: "Needs attention" row under the tabs), toolbar; on Pod Work the four summary chips (Overdue, Due Today, ASAP, On Hold) are the toolbar's view control, like the Task Queue quick views; the quick views and the summary chips are the same filter chip (26 px, 12 / 600, #1167).

**D-43 Column order and width.** Order: identifier (mono, pinned) - name or title (spring, min 200) - relations (Client, Matter, Project) - people - status words (Priority, Type) - counts (right aligned) - dates - Status chip - Progress - row action. Widths (px): identifier 100-142 (Ref 100, #1240; the Ref cell keeps 8 px at the left and none at the right so the hold marker plus a four-digit number, "|| TSK-1234" 87 px in the mono font, fits without clipping, #1244), relation 140-160, person 136-150, Type 128 (chip 32 + 8 gap + name with ellipsis and tooltip; min 96, max 260; #1237), count 96, date 152 (Due: "11/04 05:00 PM +1d" has 8 px each side, #1239; min 120, max 200), status chip 140, progress 120, row action 48 (tokens `--mf-col-*`). Task grids: Ref, Type, Title, CM Number, Matter Name, Project, Priority, Assignee, Due, Status, Progress. Assets: Type, Name, CM Number, Size, Linked Tasks, External Reference, Disposition. Asset record > Linked Tasks tab (the task grid order, #1235): Ref 100, Type 128 (chip and name, the colour key of the task type with the colour-from-id fallback when the type has none), Title, Priority 112, Assignee 136, Due 152, Status 140 = 768 px plus a Title of at least 120 px, so it fits the 1098 px of 1366 without sideways scroll; the link role is no longer a table column: it is the tooltip of the Title link ("Linked as <role>") and part of the row's accessible name (#1240). Matters: CM Number, Matter Name, Client, Primary PM, Secondary PM, Open Tasks, Overdue, Status. Admin lists: Name, Description, counts, Status, row action (no toolbar, no search, no sort; "+ New" in the header). A column heading equals the field label of the same field. The Title is the spring (fills the free room) until the person drags its divider; then it keeps that width (96 to 1600 px, saved per person and grid), free room stays empty at the right, and "Reset Width" brings the spring back, the same rule and wording in the task grids as in the record grid: the Title header menu has "Reset Width" and "Fit to Content" (both enabled only while a Title width is stored), the Columns panel > Column Widths has a Title row with the stepper and its own "Reset Width", "Reset Columns" and "Reset All Widths" remove the stored Title width, and a double-click on the Title divider does the same (#1231, #1243). Nothing is cut mid-word at 1366: chips are whole, names get ellipsis and a tooltip.

**D-43a Default columns fit at 1366 (decided after review 6, adjusted by the owner in #1232).** The default columns of every task grid (Task Queue, My Work, Pod Work, Dashboard Summary) must fit the visible frame at 1366 (about 1098 px): sum of default widths plus the Title minimum (120 px) <= 1098. Type is the coloured chip AND the type name (`mf-task-type-cell`, 128 px: the name ellipsizes and its tooltip is the full name; **[OWNER]** no icon-only Type; the tile alone only appears if a person drags the column under about 100 px of cell). At 1366 the Title keeps at least 160 px on every global task grid (Pod Work 162, Task Queue 186, My Work 322 measured at 1366 after the Due column grew to 152 px (#1239) and the Ref column went to 100 px (#1240)). Project, Matter Name and Progress are off by default on global lists (one click away in Columns); CM Number stays, except on the Dashboard Summary grid. **Dashboard Summary grid (#1236, PM correction):** default columns Type (128, chip and name at every width), Title (at least 120), Priority, Assignee (136), Due; Ref and Status are NOT default (one click away in Columns; the Needs Attention cards already carry Overdue, Unassigned and On Hold). That is 528 px (Due 152, #1239) plus the 120 px Title minimum (648) against the 718 px grid with the right panel shown, so there is no sideways scroll; with the panel hidden (#1233) the grid has the full width and the same default set. While the Unassigned card is on, "Unassigned for" (152) takes the place of Due; saved column choices are never touched. My Work > Created by Me shows Age only from Columns. Pod Work Assignee is 160 px and holds the Assign icon button. Guard: `shared/work-queue/default-columns-fit.spec.ts`. Saved column choices are never touched. Fixed in #1230, #1232, #1236, #1237, #1239 and #1235 (the Dashboard rows of the Summary, the Users unassigned panel, the person drawer and the Assign Work list pass the task type colour key to the Type cell, so the same type has the same colour as in the grids).

**D-44 Row actions.** One icon-only "..." (36 target, no border, muted at rest, full on row hover or focus), two or more actions in its menu; one obvious action is its own icon button; the whole row opens the record. **The Clients list has no row action column** (decision of 2026-11-06, #1246): Edit and Activity are in the record header and the row opens the record; the Matters list keeps its "..." menu.

**D-44a Record grid (decided after review 13, #1245).** Clients, Matters, Projects, Assets, the Matter and Client tabs and the Administration lists use the shared `RecordGrid`, never a hand-built table. The row action column is the token `--mf-col-actions-w` (48 px), never resized, never stored. The headings are the same words and widths while loading, empty, failed and with rows (no jump). Options: `groupBy` is for a list that really has groups the person asks about (a group row is a plain bold label with the count, no stripes, no colour fill); `rowClass` only for a state that carries meaning and uses a shared token class (a status edge or the muted look of an inactive row, never a private colour); `rowClick` only where the row's one main link or button already exists, so the row click repeats it and the link stays the keyboard Tab stop. A list that needs anything else (inline editing, expandable rows, a second row line) is a new component for the owner to approve, not a grid option.

**D-44b Keyboard resize (decided after review 13).** With the focus on a column heading, Shift+Left / Shift+Right change the width by 16 px, Ctrl+Shift+Left / Right by 64 px and Shift+Home returns to the minimum; with the focus on the divider handle the plain arrows (Shift = 64 px), Home and Enter work. These are keys of one focused widget (like arrows in a slider), not application shortcuts, and stay out of `shortcut-registry.ts`, so #420 is not touched. They must not act when the focus is elsewhere and must not clash with a registry key. The divider handles are not Tab stops. Any further key of this kind, or any key that works while the focus is outside the widget, is a shortcut and waits for #420.

**D-44c Ref cell (decided after review 13, #1244).** The Ref cell is 100 px with 8 px left and 0 px right padding, because "|| TSK-1234" (On Hold marker and a four-digit ref) needs 87 px. It is the one cell with asymmetric padding; every other cell is 8 px each side. A new marker in the Ref cell needs a wider-column decision, not more padding trimming.

**D-44d Filter row and list pages (decided after review 13).** A filter-row input placeholder is the short heading word ("Number", "Name"), in Title Case, never a different word (not "Matter" for a CM Number). A filter row has one background across all cells, the sticky first cell included. A cursor-paged list without a total (Matter > Activities, audit search) keeps "Show More" and shows no page numbers and no "of N"; a numbered pager only where the API returns a total.

**D-44e Leave question (decided after review 13).** The extra button of the unsaved-changes question is Title Case: "Save and Leave" (the verb Save is the primary), next to "Keep Editing" and "Discard Changes".

**D-44f Details tab card (decided after review 14, #1183).** Every record Details tab (Matter Summary is the model, Project, Asset, Task type pages) is one white card (`mf-card`, 12 px radius, 1 px border) with the title "Details" (16/700) and the fields in two columns, label above the value (13 px muted label, 14 px value), 16 px row gap, 24 px column gap, labels Title Case, long text spanning both columns. A second group (custom fields) is a second card titled with its name plus a count chip. Build it with the shared `mf-details-card` (#1249, #1250), never a page-private list. No bare label-left lists and no unframed sections on a record page.

**D-44g Row menu content and short lists (decided after review 14).** A record-grid row menu holds quick actions on that row, not Edit (Edit is on the record page and the name link opens it): Matters has New Task, Bulk Update, Add Comment, Open Task List; Projects New Task and Open Task List; Assets Change Disposition only. A short personal list in a side card (Saved Reports, 280 px) is not a table: 44 px rows, the name as a text button, and one icon-only "..." menu per row (Rename, Delete), never two text buttons per row. A dialog with a choice list and a note may use the 576 px width; the primary label names the action, not the chosen option ("Change Disposition", bulk "Change N Assets").

**D-44h Columns panel reset (decided after review 14, #1248).** The Columns panel has two resets: "Reset Width" (one button for every stored width of that grid, the Title included) and "Reset to Default" (visible columns and order, and the Title width). A per-column "Reset Width" row exists only where the panel lists widths per column (Task Queue); do not add a Title-only row to a panel that has the single button. A record grid loads with fixed column widths in every state (loading, empty, error, rows); skeleton rows never size the columns.

**D-44i Task grids with a step bar (decided after review 15, #1164).** A Status cell that holds the chip and the step bar is 176 px (token `--mf-col-status-steps-w`); a Status cell with the chip only stays 140 px. Due is 152 px everywhere (D-43a), never 136. My Matters Overview, Task Queue and My Work use the same task columns; the Assignee column hides only when the side panel is open and the frame is under 900 px, and the Type cell then shows its tile only (name in the tooltip). My Matters starts with the side panel collapsed below 1500 px viewport width (the person's choice is stored per user as on Dashboard > Summary, D-46); the Ref in the Task cell is never truncated (100 px), and the At Risk chip becomes the clock icon with its tooltip when the Task cell is under 260 px.

**D-44j Crumb of a directly opened Task page (decided after review 15, #1171).** The first crumb is "Task Queue" (the page name in the navigation), like Create Task; from another list the crumb names that list ("My Work", "Pod Work"). Update the specs in the same commit. Create Task fields are 480 px including Title (D-35); the page does not stretch fields to the card.

**D-44k Assets list columns and Details cards (decided after review 16, #1249, #1250, #1188).** Assets default columns at 1366: select 24, Type 128, Name at least 200, CM Number 123, Size 105, Linked Tasks 137, External Reference 168 (the heading is 143 px and stays on one line), Disposition 162, actions 48 = 1096. The select column is 24 px with the 16 px header checkbox exactly above the row checkboxes (same x). The second Details card is titled "<Type Name> Fields" with the count chip ("Relativity Workspace Fields" was the example for that type). The shared `mf-details-card` (`shared/ui/details-card.ts`) is the only Details card; Matter Summary moves to it in a follow-up. A saved report row shows the name only; its tooltip is the full name and "Last Updated MM/DD hh:mm AM/PM".

**D-44l Administration lists (decided after review 19, #1197 to #1204).** Users, Roles, Pods, Task Types, Workflows and Steps lists use the shared record grid (D-44a). Accepted shapes: the Roles tab keeps its master-detail layout (320 px list, editor pane) because it is an editor, not a grid case; no new component. "Grant Access" sits in the Roles cell of a person who is waiting (the cell is empty otherwise). The Pods cell is an Apply and Cancel popover on the shared menu surface (the primary pod needs a confirm step; the primary can never be left empty). The user drawer keeps the role checklist (ten roles with descriptions and counts) in one scroll with section headings, no tab strip. Pods has Name, Members and Status only: Pod Lead is a role, not a pod flag, and Open Tasks per pod needs an API field that is not worth building now. No row action on Pods and Roles: the name is the link to Edit (D-44g). The chip "Built-in, Locked" is Title Case (D-20).

**D-44m Record names and row keys (decided after review 19).** A record name that opens a drawer is a text button `mf-btn mf-btn--text mf-btn--name` (underlined at rest, offset 2 px, like every name link in a grid); one shared modifier, no `.us-open`. A record grid row key is the record id, never a name or title (names change; step titles are unique among active steps only).

**D-44n Admin record pages (decided after review 19).** When the Overview or Details tab is the edit form (Task Type, Workflow, Step), it stays an edit form with its own Cancel and Save Changes and the header has no "Edit"; header buttons are Activity, the primary action and "...". The form designer uses `mf-record-header` (tile, H1 "<Type> Form", version status chip, `[Retire Version] [Create New Draft]` primary last, "Versions (n)" in the "..." menu opening a drawer), then the `.pg-banner`, then the two panes; the Properties, Preview and Validation strip uses the shared tabs (40 px) and is the only tab strip.

**D-44o Reorder lists (decided after review 20, #1205, #1207).** Lists whose rows are reordered by dragging (Priorities, ordered Status Labels, On-Hold Reasons, Link Roles) stay on the kit table; no row-drag option is added to the record grid. They must look like a record grid: same frame, 44 px rows, 12/700 uppercase headings, 48 px actions column, a visible 16 px grip icon before the order number, "Move Up" and "Move Down" in the row menu as the keyboard path. A priority is shown with `mf-priority-flag` (as in every task grid); `mf-priority-badge` is only for choosing a priority color. UI spelling is US: "Color".

**D-44p Administration pages that are not record lists (decided after review 20).** The Holidays table of a calendar (inside the calendar pane, ten rows, no sorting or resizing) stays a kit table with a "..." menu per row; Audit Logs keeps its own table because the API is cursor-paged without a total: no Columns chooser (five fixed columns), no numbered pager, "Show More" and "N events loaded." (D-44d). No new audit component. The Branding button is "Upload Icon" because the field is the "Application Icon". Working Days are seven filter chips.

**D-44q Report editor actions (decided after review 20, #1212).** Actions stay in the page header, no bottom bar. Clean: Activity and "...". Changed: `[Discard Changes] [Save Changes]`; when the query or parameters changed the primary reads "Save as New Version" and a `.pg-banner` says saving creates version N+1 without activating it. "Activate" is a text button per version row on the History tab with a confirm dialog.

**D-44r Form dropdowns and the narrow rules (decided after review 21, #1251, #1252).** A dropdown inside a form, dialog or record page is a white field whether or not it has a value (the blue fill means an active filter and exists only in filter rows, popovers and toolbars); `mf-dropdown` has a `field` input for it. The Assignee column of the My Matters Overview hides only while a panel the person opened (the side panel or the Task Queue tree) leaves the frame under 900 px; the window alone never hides it. In the Overview Task cell the Ref is the small mono line above the title and keeps its natural width (never cut); the Task Type tile on Create Task puts "Change Type" under the name when the strip is narrow so the name stays on one line. A banner icon is 18 px, on the first line of the banner. The Calendar day panel names each role once per section: the group header (name, count, chevron) is the only place; no chip row repeats it.

**D-44s Report versions and priority cells (decided after review 22, #1260, #1261).** Report editor: the banner under the tabs says the exact sentence only when the report is inactive or "Keep the report active" is off; when an ACTIVE report keeps running, it says the new query is previewed first and the report stays active only if the preview passes. "Activate" is offered only for the current version (the API cannot activate an older one); older versions offer "Restore", which creates a new version from it. The "..." menu stays in the changed state (Run Preview, Deactivate) so unsaved SQL can be previewed. No backend change. A Normal or Low priority is the plain word (the flag's plain look), not a pill; the word is a name button (`mf-btn--name`, underlined) when it opens a dialog. Status Labels is not a reorder list and has no grip.

**D-44t At Risk icon and toolbar dropdowns (decided after review 23, #1264).** In the My Matters Overview the At Risk pill is the 26 px clock-icon circle (18 px icon inside, pill colors, tooltip and accessible name "At Risk") whenever the Task cell, the whole cell, is narrower than 460 px, and the pill with its word at 460 px and wider; a container query on the Task cell, never a measurement of the title room (the title room changes per row). This replaces the "under 260 px" wording of D-44i and D-44r. Controls that sit in a toolbar or filter band (the Asset Reports builder criteria, the My Matters Metrics Unit and Period pickers, the Comments sort, the Note editor text style, the Calendar Scope and Role) are toolbar controls, never blue-filled; only a filter dropdown that holds a non-default value is blue (filter rows, filter popovers, the Active status filter). A form dropdown that is disabled is grey, not white.

**D-45 Truncation.** Names one line with ellipsis plus tooltip; descriptions two lines; toolbar text fits at 1366 ("Sorted by Load", "Search by name"). Normal and Low priority are plain 14 px words like every other cell (only a closed task's priority is muted; #1168). A chip or a fixed word (Status, Priority, a count) is never cut: its column is wide enough (Status 140, Priority 112; a cell with an inline editor keeps 4 px side padding). The Type column of every task grid is the shared `mf-task-type-cell`: chip, name beside it on one line, ellipsis when narrow, tooltip with the full name; the column is 128 px by default (#1237) and the tile shows alone only below about 100 px of cell. The Progress cell is the thin bar plus the short "2 of 5" (step name in the tooltip); every global task list hides Matter Name, Project and Progress by default (D-43a) and the Pod Work Assignee column is 160 px with the "Assign to me" icon button at the right end (#1227). A Matter or Project Tasks tab hides Progress by default (Columns menu) so Status and Priority are whole at 1366 (#1154).

**D-46 Dashboard > Summary layout, right panel (#1233, owner correction).** Under the tabs: the Needs Attention cards, then the task grid on the left and the right column (Team Capacity and Unassigned Wait, 340 px) on the right. ONE icon button, **Hide Panel** / **Show Panel** (chevron right / left, 36 px button, 18 px icon, shared icon-button style, tooltip and accessible name change with the state, `aria-expanded`, `aria-controls` the column), sits at the far right end of the row of the three cards, directly above the column, and never moves: same x and y in both states, no second button inside the column. Pressing it hides the column and the grid takes the full width. Hidden state: on that same row, to the LEFT of the button, right aligned, centred with the cards: the **compact battery** (about 112 x 36 px: remaining % and the bolt inside, same colour steps and neutral words as the full battery, then "50 free slots" and a red "7 over" only above zero; its tooltip is the whole Team Capacity summary; not a button) and the **compact gauge** (64 x 40 px half circle with the level number, the level chip with icon and words in the full gauge's colour kinds, the oldest wait; a click or Enter selects the Unassigned card longest waiting first; tooltip is the full description; `aria-live="polite"` only when the level changes). In a narrower row the gauge chip words go first, then the battery's "free slots" text (container query on the row); the row never wraps or overflows. Permissions: battery needs Dashboard.ViewUsers, gauge Dashboard.ViewSummary; a person who sees neither (Technician) gets no button. The choice is remembered per user in the Dashboard preference entry (`mf.dashboard.v2.<user>`, `panelCollapsed`); default is shown. Under 768 px the page is one column and the panel is always shown. No keyboard shortcut (#420).

**D-48a Dashboard > Calendar day panel people lists (#1242).** Under the section title "Available NN" (text button "Collapse All" / "Expand All" in the same row) one jump chip per role with its count (`mf-filter-chips`, 26 px, none pressed); a click expands a collapsed role, scrolls its band to the top and moves the focus to it. Each role is a header band (`--mf-surface-alt`, 1 px `--mf-border-soft` above and below, role name 14/700, count chip, chevron that turns right when collapsed): one `button` in an `h4` with `aria-expanded` and `aria-controls`, `position: sticky; top: 0` inside the scrolling panel body, 8 px above each group. The collapsed roles are remembered per user (`mf.dashboard.v2.<user>`, `calendarCollapsed`) and apply to both lists. A row is 44 px: a 28 px circle with the shared `mf-user-state-icon` (load 0 Idle, 1 Light, 2 Normal, 3 or more Heavy; Out of Office and Off Hours for the Not Available list), the name (a text button that opens the Add Out of Office dialog with `User.ManageAvailability`, else plain bold text) and the pods on one muted 12 px line with an ellipsis (an absence type, only with `Dashboard.ViewAbsenceReasons`, in front; the full pods in the tooltip), at the right the open-task count (bold) with three capacity dots; a 3 px left edge in the level colour (owner-approved exception to the no-coloured-edge rule: the icon shape and the number carry the state). There is no status chip; the state is the icon tooltip and the accessible name of the row ("Test User 12, 1 open task, Light, Available"). The "Not Available NN" section has the same bands in muted text and a reason chip instead of the load: "Back MM/DD" (amber; the API gives the return day, not the last day out), "No end date", "Holiday" or "Off Hours" (neutral).

**D-48 Count tiles (#1234).** A small count tile (the Dashboard > Calendar day panel: Available, Out of Office, Off Hours) has one height in its row, the label at the top (it may wrap to two lines) and the number pinned to the bottom, so all numbers in a row share one baseline whatever the labels wrap to; the tile padding does not change and there is no extra row. Each tile has a tooltip with one sentence that says what the state means, and the same text is its accessible description. The day panel has THREE tiles: people off for a holiday are counted in Off Hours (the day endpoint's `offHours` plus `onHoliday`), the holiday itself stays in the panel header and the calendar cell.

**D-47 Record not found.** The state-page card (D-53) in the shell with the breadcrumb above and one `Go to <List>` button.

**D-50 Loading.** First load: a skeleton with the final layout (`mf-record-skeleton`, grid skeleton rows); a refresh keeps the old content; a busy button "Saving..."; live text "Loading <thing>".

**D-51 Empty and error** (`mf-state-block` for areas, `mf-record-state` for records, `AdminListState` / `adminListView` for admin lists). One block: icon at `--mf-icon-xl`, one sentence with a full stop, optional Title Case button. First use: "No tasks yet." + "+ New Task" (with permission; admin lists too). Filtered: "No tasks match these filters." + "Clear Filters". Search: "No results for "<text>"." Read-only: "No tasks." Error: warning icon in `--mf-sem-overdue-solid`, "Couldn't load tasks.", optional reason, `Retry`; **no toast for a failure the page shows inline** (action failures keep their toast). Stale save: "This <thing> was changed by someone else." + `Reload Latest`. No access: "You don't have access to <thing>." **One count-chip rule for every list page** (Task Queue, My Work, Pod Work, Matters, Clients, Projects, Assets; the Administration lists have no count chip): while the list loads and after an error the chip shows "-" (accessible text "Total: not available"), never a stale or a zero number, so the title row does not jump when the number arrives (`mf-page-header` `[countPending]`, #1170, #1244).

**D-52 Toasts** (`core/notify/notification.service.ts`: `success|info|warn|error(summary, detail?, options?)`). Summary sentence case "<Thing> <past participle>", no full stop ("Role saved", "Production deleted", "Link copied"); optional detail (a sentence with a full stop, or the name). Errors "Couldn't save the role." + reason. Timing: success 4 s, info 6 s, warning 8 s, error until closed; at most three visible; `key` replaces a repeat. Undo toast "Pods of Ann Lee restored." with Undo; "Not undone: ..." when it cannot.

**D-53 System pages.** Access Pending, 403, 404, Error, not-found: one `mf-state-page` card (480 px, radius 12, tile, H1 22/700 on one line, one sentence, one button, error reference with a copy button). The tile is 48 px (`--mf-s7`, radius 8, icon `--mf-icon-xl`), the card is centred text, the H1 takes focus on arrival and shows no ring, the 403 title is "You don't have access.", the address that was asked for (403, 404) and the error reference are one muted mono line with a copy button, and Access Pending (pending and disabled) is the same card with "Check Again" as its one button (#1193).

**D-53a Banners (decided after review 17, #1196).** One pattern `.pg-banner` (`styles/_banners.scss`): 36 px, 4 px radius, 18 px icon at the left, one sentence, optional text button at the right. Variants: information, warning (offline, sensitive, inactive), danger (failed sign-in, red) and success ("Back online.", green, leaves after 4 s). Every banner has its icon; the banner-anatomy spec fails without one. Banners are `role="status"`, danger `role="alert"`. There is no impersonation banner (no such feature).

**D-53b System page content (decided after review 17).** One sentence and one button: no search box on 404, no Copy link on 403 (the address line keeps its small copy icon). The Error page keeps a text button after a failed Retry named like the 404 button ("Go to My Work" or "Go to Dashboard"), never "Go to Home". Access Pending has the sentence, the account and registered lines (muted) and "Check Again"; no "What to Do Next" list. The H1 may take two lines at 22 px; beyond two it is clamped with the full text in the tooltip. A record name is never put in the H1 of a 403 or not-found page. "See All N" links are Title Case ("See All 12", "See All 12 Matters").

**D-13a Section-footer navigation (decided after review 18, #1189).** A link that is a call to action at the end of a section ("See All 12 Matters") is an `<a>` styled as the text button (`mf-btn mf-btn--text`, blue, no underline, 24 px): it navigates, so it is a real link for assistive tools and the context menu, and looks like the other text buttons. Links inside a sentence or a table cell stay underlined (D-13).

**D-54 Status chip tones for people (decided after review 18, #1191).** Absence types use the existing six status tones plus neutral: Vacation information, Training success, Conference neutral. There is no seventh "person" tone; do not add a colour for one chip. Notification and activity times are relative today and yesterday ("5 m ago", "yesterday") and numeric `MM/DD` from two days ago (D-60).

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
| Details card (record page fields) | `mf-details-card` with `div[mfDetailField]` fields (`label`, `wide`), optional `count` chip; `mf-custom-fields-view [card]` for the second card | `shared/ui/details-card.ts`, `custom-fields.ts` | D-44f |
| Grid | `mf-record-grid`, `mf-record-columns`, `mf-grid-frame`, `mf-task-table`, `mf-pager`, `mf-zero-dash`, `mf-grid-columns` | `shared/ui/record-grid.ts`, `grid-frame.ts`, `pager.ts`, `zero-dash.ts`, `grid-columns.ts`; `shared/work-queue/task-table.ts`; `styles/_tables.scss`, `_admin-lists.scss` | D-42, D-43; column tokens `--mf-col-*` |
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
- [ ] Screenshots at 1366x768 and 1920x1080 of every changed screen, dialog, drawer and menu, with real or realistic data; axe 0 violations. Commit them to the `design-evidence` branch only (at most 15 per issue, about 150 KB each), never to dev, main or the feature branch, and link them from the issue comment.
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
| Link style | `shared/ui/link-style.spec.ts` | wrong link CSS in the global style |
| Chip kinds | `shared/ui/chip-kinds.spec.ts` | a shared chip losing its icon, count or remove button |
| Private chip and link classes | `shared/ui/private-classes.spec.ts` (scan from the shell: `node docs/ux/ui-update/crawl/scan-private-classes.mjs --list`) | a new `.chip`, `.badge`, `.pill`, `.tag` class that paints a fill or pill in a component, a new `.lnk`, `.link`, `.linkbtn`, `.link-btn`, `.lnk-btn`, `.pg-link` class or template use; the few chips still private are in its `ALLOWED_CHIPS` list with the reason |
| Card style | `shared/ui/card-style.spec.ts` | card radius, border, shadow, padding drift |
| Page header | `shared/ui/page-header-rule.spec.ts` | a page drawing its own header |
| Grid anatomy | `shared/ui/grid-anatomy.spec.ts` | row, header and frame values |
| Record grid | `shared/ui/record-grid-guard.spec.ts` | a new hand-built `<table class="pg-table">` record list outside its allowed list (#1241) |
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
| Printed lines ("Printed November 6, 2026, 10:23 AM"; the hour keeps its leading zero, "01:10 AM"; Task Queue, My Work, Pod Work, Matter Tasks and Project Tasks print it) use the full month and the time, no zone | a sentence on paper |
| Calendar weekday row is normal case 13/600, red on weekends | date grid, not a data grid (D-42a) |
| Chart axes use the same `MM/DD` as cells | consistency; month names only in tooltips |
| Profile account field and Audit Logs show `KE\account` | raw account is the data there |
