# MatterFlow UI standard, round 2 (DRAFT, phase 1)

Owner: Agent U (UI designer). Branch `ui-update-2`. The owner approved all recommendations in advance, so every rule below is a decision, not a question; the rules the owner may care about are listed in section 0.3. Phase 2 (live crawl) turns this draft into the final spec and into the issues.

Base documents, unchanged and not reopened: `docs/ux/theme-guide.md` and `docs/ux/tokens.css`; dialogs guide section 6; buttons section 9; grid and list anatomy 11.x; icon sizes 11.9; fixed-page layout (the page never scrolls on desktop, only inner regions); decisions AQ to AV; no new or changed keyboard shortcuts (#420); no diagonal stripes; no repeated "Available" chips; tabs need icons; the owner prefers bigger icons and a simple UI; buttons come only from the shared theme.

## 0. How to read this

### 0.1 Format of a rule

Every rule is **D-nn Name**, then **Do** (exact values), **Don't**, **Reference** (the page or component that already does it right; the dev agent opens it and copies). Issues cite rules by id ("applies D-12, D-13").

### 0.2 Units

All sizes below are px at the default zoom. The app root font is 14 px, so `1rem` is 14 px (the guide's px figures for dialogs were never true in code: 36 rem is 504 px, not 576). New control geometry is written in px or in a token; rem stays only where a component already scales with text zoom (the work grid). A dev agent never converts by eye: use the token.

### 0.3 Decisions the owner may want to look at

| ID | Decision | Changes what is on screen today |
| --- | --- | --- |
| D-02 | One control height, 36 px, for buttons, segmented switches, dropdowns, search, inputs and icon buttons; 32 px dense inside grid cells and filter rows. Form inputs go from 40 to 36, buttons from 32 to 36 (the guide section 9 says 32; with 18 px icons 36 reads bigger and matches the Dashboard toolbars) | every page, slightly taller buttons, slightly shorter fields |
| D-20 | Capitalisation: "Click it or name it = Title Case; read it = sentence case" (details in D-20) | buttons, tabs, navigation ("Asset Types"), column and field labels, chips |
| D-30 | Page forms (routed) get the dialog order: Cancel, then the primary at the right end; today they put the primary first | about 10 pages |
| D-32 / D-33 | Dialogs 416 / 576 / 768 px, drawers 520 px (and 720 px wide) | seven dialog and seven drawer widths collapse to three and two |
| D-60 | One date format everywhere: `MM/DD hh:mm AM/PM` (year added when it is not this year), the long form only in tooltips and sentences | the 42 files that print "Oct 12, 2026, 10:23 PM EDT" |
| D-21 | Every page has the same header: 32 px solid-blue icon tile (the Dashboard look), H1 22 px / 700 | all pages except Dashboard get the tile; fixed pages lose the 19 px title |
| D-10 | Cards 12 px radius, soft border and card shadow everywhere (8 px cards go to 12) | Profile, tiles, record cards |
| D-17 | Dashboard > Summary tab gets its own icon so it stops repeating the Dashboard tile icon | one tab |
| D-00 | One epic per page group (15 epics plus the shared one and the top one), not per tab | planning |

### 0.4 Proposed changes to `docs/ux/tokens.css` (dev agents implement; nobody else edits that file)

```css
/* control heights (D-02) */
--mf-ctl-h: 36px;            /* unchanged value; now used by EVERY control */
--mf-ctl-h-sm: 32px;         /* was 30; dense: filter row, cell editors */
--mf-target-min: 24px;       /* remove the 32px override in styles.scss; one value */
--mf-row-h: 36px;            /* menu items, picker options (was 40); tables use --mf-grid-row-h */
--mf-tab-h: 40px;
/* type (D-01) */
--mf-fs-h1-compact: var(--mf-fs-h2);   /* delete --mf-fs-title (19px): fixed pages use 22px */
--mf-fs-figure: 24px;        /* big number in a card or tile */
--mf-fs-figure-lg: 32px;     /* big number in a drawer tile or KPI */
/* radius (D-01) */  /* --mf-radius 4 controls; --mf-radius-lg 8 menus and popovers; --mf-radius-xl 12 cards, dialogs, frames; --mf-radius-md 6 only the nav pill */
/* dialogs and drawers (D-32, D-33) */
--mf-dialog-w-sm: 416px;  --mf-dialog-w: 576px;  --mf-dialog-w-lg: 768px;
--mf-drawer-w: 520px;     --mf-drawer-w-wide: 720px;
/* page title tile (D-21) */
--mf-tile-size: 32px;
```

## 1. Foundations

**D-01 Scales.** Do: use only these values.
- Type (px / token): 12 `--mf-fs-xs`, 13 `--mf-fs-sm`, 14 `--mf-fs-md` (body and controls), 16 `--mf-fs-lg` (card and dialog titles, menu headings), 18 `--mf-fs-h3` (section titles), 22 `--mf-fs-h2` (page title on every page), 24 and 32 figures only. Weights 400, 600, 700 only. Line height `--mf-lh` 1.45; single-line controls 1.2.
- Spacing: `--mf-s1`..`--mf-s7` (4, 8, 12, 16, 24, 32, 48). Inside a control 0 12; between controls in a row 8; between rows of a toolbar 8; header to toolbar 12; card padding 16; dialog body padding 16; between form fields 16; label to field 4; between sections 24; page gutter 16 (`--mf-gutter`).
- Radius: 4 `--mf-radius` all controls (button, input, search, dropdown trigger, segmented outer, checkbox); 8 `--mf-radius-lg` menus, popovers, tooltips, inner boxes; 12 `--mf-radius-xl` cards, grid frames, dialogs; 6 `--mf-radius-md` only the navigation pill; `--mf-radius-pill` chips and tags; 50% avatars and dots.
- Shadow: `--mf-shadow-card` cards, `--mf-shadow-pop` menus, popovers and dialogs, none elsewhere.
- Colour: only `--mf-*` tokens by role (text `--mf-text`, secondary `--mf-text-muted`, border `--mf-border-soft` inside cards, `--mf-border` frame edge, `--mf-border-strong` input edge, link and primary `--mf-primary`/`--mf-link`, selected `--mf-selected-bg`, row hover `--mf-row-hover`, page `--mf-bg`, card `--mf-surface`).
Don't: 2, 3, 5, 7, 9, 10 px radius; 10, 11, 11.5, 12.5, 13.5, 15, 17, 19, 26 px or 0.7 rem type; weight 500 or 800; a colour literal; a thick coloured left edge. Reference: `grid-frame.ts`, `page-header.ts`. Evidence: 18 `3px` radii, 9 `10px`, about 60 off-scale font sizes.

**D-02 Control height.** Do: every interactive control in a toolbar, form, dialog or card header is 36 px high (`--mf-ctl-h`): `.mf-btn`, `p-button`, `.mf-seg` buttons, `mf-dropdown` trigger, `mf-search-box`, text input, native select, date and time input, `mf-filters-toggle`, icon buttons (36 x 36). Controls inside a table cell or the inline filter row are 32 px (`--mf-ctl-h-sm`). Targets are never below 24 px. Don't: 28, 30, 34, 38, 40 px controls; `min-height: 28px` on buttons. Reference: Dashboard > Users toolbar. Evidence: 32 / 36 / 40 mix; tokens.css says target 24, `styles.scss` overrides to 32.

**D-03 Layout frame.** Do: fixed pages as the guide (page never scrolls at 768 x 561 and larger); main area gutter 16; header 12 below the top; grid frame fills to the bottom gutter; below 768 x 561 the page scrolls. Content max width: forms 480 px per field (`--mf-field-max`), reading text 72 characters. Don't: a second vertical scroll bar on the page. Reference: Matters list.

**D-04 Colour meaning.** Do: Overdue / error = `--mf-sem-overdue-*` (red); At risk / due soon / warning = `risk` (amber); In progress / info / links = `info` (blue); Completed / healthy = `healthy` (teal); Unassigned / needs a person = `person` (violet); Critical priority = `critical` (deep orange); Neutral / on hold / cancelled / sensitive = `neutral` (slate). Every coloured signal also has an icon or a word. Don't: new hues, hatching, diagonal stripes, red for anything that is not overdue, failed or destructive. Reference: theme guide section 2.

**D-05 States (one table for all interactive things).**

| State | Button (primary) | Button (secondary) | Input / dropdown / search | Row / card (clickable) | Chip (toggle) | Tab |
| --- | --- | --- | --- | --- | --- | --- |
| Default | `--mf-primary` fill, white text | white, 1 px `--mf-btn-secondary-border`, text `--mf-text` | white, 1 px `--mf-border-strong` | `--mf-surface` | white, 1 px `--mf-border-mid` | muted text |
| Hover | `--mf-primary-hover` | `--mf-surface-alt` | border `--mf-text-muted` | row `--mf-row-hover`; card `--mf-row-hover` | `--mf-surface-alt` | `--mf-surface-alt` background |
| Focus | 2 px `--mf-focus` ring, 2 px offset (global `:focus-visible`), never removed; nav uses `--mf-nav-focus` | same | same ring | same ring (inset in a grid cell) | same | same |
| Active (pressed) | `--mf-primary-hover` | `--mf-selected-bg` | | | | |
| Disabled | 40% opacity is NOT used; fill `--mf-surface-alt`, text `--mf-text-disabled`, `aria-disabled`, no pointer | same | `--mf-surface-alt`, text `--mf-text-disabled` | | | |
| Selected | n/a | n/a | n/a | row `--mf-selected-bg` plus checkbox; card 2 px inset `--mf-primary` | `--mf-primary` fill, white text, `aria-pressed` | 2 px `--mf-primary` underline, text `--mf-primary`, weight 600 |
| Error | | | 1 px `--mf-danger` border, 2 px inset `--mf-danger` on focus, message below with icon | | | |

Don't: opacity-only disabled, colour-only selection, a focus style that differs per page. Reference: `_buttons.scss`, `_forms.scss`.

## 2. Components

**D-10 Card.** Do: `--mf-surface`, 1 px `--mf-border-soft`, radius 12, `--mf-shadow-card`, padding 16. Header row: title 16 / 600 (`h2` or `h3` with correct level), optional icon 20 left of it, actions at the right (controls 36 px); 12 gap to the body. A card that opens something is one button with hover `--mf-row-hover`; selected is a 2 px inset `--mf-primary` ring. Figure cards: figure 24 / 700, label 13 muted. Don't: 8 px cards, a coloured edge, nested cards, shadows on inner boxes. Reference: Breakdowns card, `mf-grid-frame`. Evidence: radius 12 on 54 uses, 8 on 83.

**D-11 Section heading inside a page or card.** Do: 16 / 600 `--mf-text`; 24 above, 8 below; with an optional count chip. Don't: 20 px bold headings (Profile), uppercase headings.

**D-12 Chips, badges, pills (four kinds, nothing else).** Do:
1. Status / state chip (`mf-status-chip`, `mf-badge`): height `--mf-chip-h` 26, padding 0 8, radius pill, 12 / 600, icon 16 (`--mf-icon-sm`) always plus the word, tint `-bg` with `-fg` text and `-line` border from the semantic or `--mf-status-*` tokens. Words are in section 8 (vocabulary of status).
2. Count chip (page title count, tab badge): height 22, min width 22, padding 0 6, `--mf-surface-alt` bg, `--mf-text` 12 / 600, no icon.
3. Filter chip / toggle (`mf-filter-chips`): height 26, same shape as kind 1; selected = `--mf-primary` fill, white text, tick icon; `aria-pressed`; the count is bold at the end.
4. Tag / scope chip (removable): height 26, pill, `--mf-surface` with `--mf-border-mid`, text 13, remove button 16 x 16 with `pi-times` at `--mf-icon-xs`, accessible name "Remove <name>".
Priority: `mf-priority-flag` (pill only for Critical and High, plain words for Normal and Low). Don't: a private `.chip`, `.badge`, `.tag`, `.pill` class in a component (about 60 exist); chips without an icon in kind 1; chips taller than 28; chip text that wraps; two chips that say the same thing on one row (no repeated "Available"). Reference: `status-chip.ts`, `filter-chips.ts`. Evidence: `.chip` 15 families, `.hchip`, `.tc-chip`, `.upc-chip`...

**D-13 Links.** Do: a link navigates; colour `--mf-link`, 1 px underline always on (offset 2 px) in text and in grid cells; hover: colour `--mf-primary-hover`; focus: global ring; no visited colour. Identifier links (Ref, CM Number, matter number) use `--mf-font-mono`, same underline. Navigation links (nav, tabs, breadcrumb, pager) have no underline; the breadcrumb underlines on hover. A link target is at least 24 px high (padding-block 4, margin-block -4). Anything that acts (saves, opens a dialog, toggles) is a text button `mf-btn mf-btn--text` (link colour, no underline, underline on hover), never a link. Don't: `.lnk`, `.link`, `.linkbtn`, `.link-btn`, `.lnk-btn` private classes (17 exist), links that look like text, coloured text that is not clickable, "click here". Reference: global `a:not([class])` rule extended in `styles.scss`, `mf-btn--text`. Implement: one global `.mf-link` class plus the `a:not([class])` rule.

**D-14 Dropdowns and selects.** Do: every choice in a toolbar, filter bar, card header or filter row is `mf-dropdown`. Trigger 36 px (32 in a cell), radius 4, 1 px `--mf-border-strong`, optional prefix label in muted text ("State:") then value 600, chevron `pi-chevron-down` 16 at the right; the trigger never changes width when the value changes (width = widest option, max 22 rem, ellipsis). List: radius 8, `--mf-shadow-pop`, 1 px `--mf-border-soft`, max height 20 rem then scroll, item 36 px, selected item has a check and 600 weight on `--mf-selected-bg`; opens up when near the bottom; search field in the list when there are more than 10 options. Multi-select: checkbox per item, "All <things>" first and clears the others, trigger text "State: Idle +1". Empty list: "No matches." Data-entry selects inside a form field may stay native but take `_forms.scss` (36 px, 4 px radius, same chevron). Don't: a native `<select>` in a toolbar (Swimlane toolbar, Dashboard trend measure, My Matters data period and size, Notes, Asset reports, Reports run log), a dropdown that changes width, a 30 px dropdown. Reference: Users State dropdown.

**D-15 Tabs.** Do: only `mf-tabs`. Height 40 (`--mf-tab-h`); padding 0 16; icon `--mf-icon-lg` 20 before the label, 8 gap; label 14 / 400 muted, selected 14 / 600 `--mf-primary` with a 2 px `--mf-primary` underline; hover `--mf-surface-alt`; count in brackets "(12)" regular muted after the label, a number badge only for "things waiting"; strip has a 1 px `--mf-border` bottom line. Position: title row, then the one-line description (if any), then the strip, then 12 gap, then the toolbar and content; the strip is the same in drawers (inside the drawer under the header). Tab labels are Title Case ("Status Labels", "On-Hold Reasons", "Note Tags", "Run Log", "Link Roles", "Workflow Steps"). Sub-switches inside a tab are the segmented control (D-16), never a second strip. Don't: a different height in the Task type editor, Reports editor or Settings; a strip above the description. Reference: Matter detail strip. Evidence: 2.75 rem and 2.5 rem heights; Labels and Roles order differs.

**D-16 Segmented switch.** Do: only `.mf-seg` with `mfSegmented`; 36 px, radius 4 on the outer corners only, 1 px `--mf-border-strong`, segments equal in width inside one switch (width of the widest label, min 112 px), 14 / 400; selected segment solid `--mf-primary` with white text and weight 600, no check mark; icons 20 (`--mf-icon-lg`) in front of the label; below 17 rem icons only with the labels visually hidden (still the accessible names); one Tab stop, arrows move. 2 to 4 options. Don't: the outlined-selected look (Calendar Month / Week), fixed 8.75 rem for some switches only, five or more segments (use a dropdown). Reference: Users Workload | Coverage | Skills (after US-11).

**D-17 Icons.** Do: sizes `--mf-icon-xs` 12 tiny marks, `-sm` 16 chips and text, `-md` 18 buttons and rows, `-lg` 20 tabs, switches, the page tile glyph; navigation `--mf-nav-icon`. One registry per concept, the same icon wherever the concept shows (`tab-icons.ts` extended to hold nav and page icons too: the page tile icon equals the navigation icon of that page). The Dashboard Summary tab gets `pi-objects-column` (verify it exists in the installed PrimeIcons, otherwise `pi-th-large`) so it no longer repeats the Dashboard `pi-home` tile; `pi-home` stays for Dashboard and for Matter / Client / record "Summary" and "Overview" tabs. Custom outline icons (person states, task types) keep the same four sizes and a 1.5 px stroke in `currentColor`. Icon-only controls have an accessible name and a tooltip. Don't: a px or rem icon size in feature styles (about 60 remain), a decorative icon without `aria-hidden`, two icons for one concept, filled and outline icons next to each other. Reference: `tab-icons.ts`, `scripts/check-icon-sizes.mjs`.

**D-18 Tooltips.** Do: `[mfTip]` only (0 uses of `pTooltip` remain, keep it that way); appears on hover after 300 ms and on keyboard focus; dark `--mf-tip-bg`, 13 px, radius 8, max width 280, sentence case, no full stop for a fragment; Esc closes. Don't: a tooltip as the only place for essential information on a touch device. Reference: `[mfTip]`.

**D-19 Avatars and initials.** Do: circle 28 (list) or 36 (drawer header), `--mf-surface-alt` with `--mf-text` initials 12 / 600; person state icon (Users) 28 in a soft circle. Don't: coloured random avatars.

## 3. Language

**D-20 Capitalisation (one rule).** "Click it or name it = Title Case. Read it = sentence case."
- Title Case (minor words "a, an, and, as, at, for, in, of, on, or, the, to" lowercase except the first and last): page titles, the navigation, tab labels, buttons, menu items, text buttons, column headings, form field labels, card titles, dialog titles, chips and badges that are fixed words ("Out of Office", "Off Hours", "On Hold"), the names of things ("CM Number", "Primary PM").
- Sentence case: help and description lines, placeholders, tooltips that are sentences, toasts, empty and error messages, dialog questions and explanations, "Rows per page", "Showing 1-50 of 143", "Sorted by Name, A to Z".
- Examples that change: "New client" becomes "New Client"; "New asset type" becomes "New Asset Type"; "Create Task" in the project header becomes "New Task"; "Clear filters" button becomes "Clear Filters"; "Reset sort" becomes "Reset Sort"; "Asset types" nav item becomes "Asset Types"; "Status labels" tab becomes "Status Labels"; "On-hold reasons" becomes "On-Hold Reasons"; "Notes tags" becomes "Note Tags"; route titles "Access pending" becomes "Access Pending", "My profile" becomes "My Profile", "New step" becomes "New Step".
Don't: Title Case in a sentence; sentence case on a button. Reference: `NAV_ITEMS`, guide section 9.

**D-21 Page header (every page).** Do (exactly the `mf-page-header` contract plus the tile): row 1 breadcrumb, only on non-top-level pages (13 px muted, real links, last item plain; cut at 40 characters with tooltip). Row 2, 36 px high: icon tile 32 x 32, radius 8, `--mf-primary` fill, white icon 20, then the H1 22 / 700 , then the count chip (D-12 kind 2, list pages only), actions at the right `[secondary] [Filters] [primary]`, primary last. Row 3, optional: one line of description, 13 muted. The first row sits 12 below the top of the main area on every page. The tile icon is the page's navigation icon. Record pages show the record-type icon in the same tile and the record's own H1. Scope or period selectors in the actions are capped at 22 rem. Don't: a page that draws its own `<h1>` (My Matters, Dashboard), a plain glyph without the tile, a 19 or 28 px title, a sentence beside the title, a second primary button in the header. Reference: `page-header.ts`, Dashboard tile. Evidence: My Matters and Dashboard own `<h1>`; `--mf-fs-title` 19 px.

**D-22 Vocabulary (the word list).**
| Concept | Word | Never |
| --- | --- | --- |
| Matter number | CM Number | Matter reference, Matter number (as a column) |
| Time of last edit | Last Updated (grids, fields); "Updated" only in a feed line ("Updated 3 h ago") | Modified, Last changed, Last modified |
| Time of creation | Created | Added on |
| Workflow position | Progress | Workflow progress |
| Managers | Primary PM, Secondary PM | Project manager |
| Person on a task | Assignee | Assigned to, Owner |
| Create a record | "+ New <Thing>" opens the create flow; "Create <Thing>" is only the submit of that flow | "Create task" on a header button, "Add <thing>" for a new record |
| Edit submit | Save Changes | Update, Apply, OK |
| Add to a list | Add <Thing> (Add Role, Add Event, Add Comment) | |
| Abandon | Cancel (dialogs and pages); "Keep Editing" and "Discard Changes" only in the unsaved-changes dialog | Close on a form, Back to draft |
| Run a failed action again | Retry | Try again, Reload |
| Refresh stale data | Reload Latest | Reload |
| Remove a filter | Clear Filters | Reset filters |
| Remove a sort | Reset Sort | |
Reference: decisions AR.5 to AR.8.

**D-23 Uppercase.** Do: `text-transform: uppercase` only for grid column headings (12 / 700, `--mf-text-muted`, letter spacing 0.04em) and the navigation section label "ADMINISTRATION". Don't: uppercase tile captions ("OPEN"), group headings ("DATA TECHNICIAN"), calendar weekdays (use "Sun", "Mon"). Evidence: 33 rules in 27 files.

## 4. Buttons, forms, dialogs, drawers, menus

**D-40 Buttons.** Do (guide section 9 stays, with the height of D-02): five kinds only: primary (one per bar, form or dialog), secondary (white outline), danger (outlined; solid only inside a confirm dialog), text (`mf-btn--text`), icon only (`mf-btn--icon`, 36 x 36, icon 18, accessible name and tooltip). Label 14 / 600 (400 for text buttons), padding 0 12, gap 8 between icon and label, icon 18, label Title Case verb or "+ New Thing" with `pi-plus`. A busy button shows "Saving..." (three dots) and ignores clicks. No `size="small"`. Don't: a local `.p-button` or `.mf-btn` style, the ellipsis in a label ("Set out of office..." becomes "Set Out of Office"; the dots are only for a busy label), two primaries in one bar, a text-only danger without confirm. Reference: `_buttons.scss`, `button-rule.spec.ts`.

**D-30 Order and alignment of actions.** Do: everywhere the primary action is the LAST (rightmost) button, the secondary before it, a destructive action far left and separated.
- Dialog (`mf-form-dialog`): footer `[Cancel] ........ [Primary]` (space-between), as built.
- Drawer with an edit form: same footer as a dialog.
- Routed page form and inline card form: a sticky action bar at the bottom of the form, right aligned, `[Delete] (left, danger outline) ... [Cancel] [Create and Add Another] [Primary]`. The primary is last.
- Profile and Settings forms: `[Cancel] [Save Changes]` right aligned in the sticky bar, primary disabled until the form is dirty, message "No unsaved changes" at the left.
Don't: the primary first (about 10 pages today), "Discard changes" as a button label outside the unsaved-changes dialog. Reference: `mf-form-dialog`.

**D-31 Dialog anatomy.** Do: only `mf-form-dialog` (create, edit, forms), `mf-confirm-dialog` (yes/no with consequence), and the lookup dialog for pickers. The 12 hand-built `p-dialog` (Edit task, Add event, Set out of office, assign, bulk tasks, absence, availability, matter managers, priority, holiday, calendar, import) move to `mf-form-dialog`. Header 56 px: title 16 / 600 (Title Case, the verb and the thing: "New Project", "Edit Task"), optional subtitle 13 muted (CM number), close icon button 36 x 36 at the right. Body padding 16, scrolls inside, never taller than 90% of the window, fields per D-35. Footer: top border 1 px `--mf-border-soft`, padding 12 16, `[Cancel] ... [Primary]`; an error message sits above the footer buttons as an alert with icon. Radius 12, `--mf-shadow-pop`, scrim `--mf-scrim`. Esc and a click on the scrim close it; Tab stays inside; focus goes to the first field and returns to the opener; dirty close asks "You have unsaved changes. Discard them?" with `[Keep Editing] [Discard Changes]`. Don't: a dialog that opens another dialog (use a confirm popover or a second step inside), a dialog without Esc. Reference: `matter-form-dialog.ts`, `project-panel.ts`.

**D-32 Dialog sizes.** Do: Small 416 px (confirm, one to three fields, set out of office), Default 576 px (most forms, Add event, assign), Large 768 px (Edit task, two-column forms); `max-width: calc(100vw - 32px)`. Set by the `size` input of `mf-form-dialog` and `mf-confirm-dialog` only. Don't: `style="{width: '34rem'}"` in a feature. Evidence: 26, 30, 32, 34, 36, 40, 48 rem and 720 px.

**D-33 Drawers (right side panels, read and detail context only).** Do: `mf-slide-panel` only. Width 520 px (`--mf-drawer-w`), wide 720 px for a drawer that holds a grid  Header 56 px: title 16 / 600 with an optional subtitle, then the icon actions (18 px icon, 36 target, tooltip and name) then the close button; a tab strip (D-15) sits under the header; the body scrolls; a footer only when the drawer edits (D-30). The list stays visible behind it; Esc and close return focus to the opener. Don't: a per-feature width (448, 476, 480, 504, 525 px exist), a second header style, a drawer that creates or edits (those are dialogs, section 6). Reference: Dashboard Users person drawer.

**D-34 Confirm dialogs.** Do: title = the question's verb and thing ("Delete Note"), body = one sentence saying what happens and whether it can be undone ("This note and its history are removed. This cannot be undone."), `[Cancel] ... [Delete Note]` where the confirm button repeats the verb and the thing in Title Case; danger confirms use the solid red `mf-btn--solid` button. The cancel button is always "Cancel", except the unsaved-changes dialog. A reversible action does not ask: it acts and shows a toast with Undo. Don't: "Keep active", "Stay", "Keep it as it is", "Yes" and "No". Evidence: 12 different cancel labels.

**D-35 Forms.** Do: label above the field, 13 / 600 `--mf-text`, 4 gap; field 36 high (textarea min 4 lines); help text below, 13 muted, 4 gap; error text below, 13 `--mf-danger` with `pi-exclamation-circle` 16 and `role="alert"`, border per D-05; fields 16 apart; one column up to 480 px per field; two columns (16 gap) only in a Large dialog or a page at 1100 px and wider; section headings per D-11; required fields end the label with a red `*` (`aria-hidden`, input has `aria-required`), and a form with more than five fields starts with the line "* Required"; optional is never written; checkbox and radio 18 px with a 36 px row; read-only values are plain text, not disabled inputs; date and time fields are native inputs with `lang="en-US"` on `html` so they show MM/DD/YYYY and 12-hour time; character counter bottom right, 12 muted. Don't: placeholder as a label, "(required)", a label to the left of the field (except the segmented "Sort" row), inline editing that looks like text without a hover cue. Reference: Create Task page, `_forms.scss`.

**D-36 Menus and popovers.** Do: radius 8, 1 px `--mf-border-soft`, `--mf-shadow-pop`, padding 4; item 36 high, 14 px, icon 18 + 8 gap, hover `--mf-row-hover`, focus ring inset, danger item in `--mf-danger`, separator 1 px `--mf-border-soft`; width min 200, max 360; filter popover 320. A "..." menu holds two or more secondary actions; one action is its own icon button. Opens below, flips up near the bottom, closes on Esc, outside click and selection, focus returns to the trigger. Don't: a popover with a scrollbar in the popover itself taller than 70% of the window (scroll inside the list), a menu that moves the page.

## 5. Grids and lists

**D-42 Grid anatomy.** The list anatomy of guide 11.1 stands. Additional exact values: row 44 comfortable / 36 compact (`--mf-grid-row-h*`) for every grid including admin lists; header 40, 12 / 700 uppercase `--mf-text-muted` on `--mf-surface-alt`, sort arrow `--mf-icon-sm` (button inside `th[aria-sort]`); row line 1 px `--mf-border-soft`; hover `--mf-row-hover`; selected `--mf-selected-bg`; no zebra; cells 14 / 400, padding 0 12; frame `--mf-radius-xl` with `--mf-shadow-card`; the frame scrolls sideways when columns do not fit (LC-09), the identifier column stays pinned; the pager is `mf-pager` with 25 / 50 / 100 (default 50) on every list including admin lists; zero in Overdue, Due Soon and On Hold columns is a muted dash "–" (accessible text "0"), other zeros stay "0". Don't: a row height of 40 or 48 (Users and Skills move to 44), "Load more", a column dropped at a narrow window. Reference: Task Queue, Matters.

**D-43 Column order and width by grid type.** Order rule for any grid: (1) identifier, mono, pinned; (2) name or title, the spring (no width, min 200); (3) relations (Client, Matter, Project); (4) people (Assignee, PM); (5) status words (Priority, Type); (6) numbers (counts, right aligned, header right aligned too); (7) dates; (8) Status chip; (9) Progress; (10) the row action column. Widths in px at default zoom:

| Column kind | Width | Min | Max | Align |
| --- | --- | --- | --- | --- |
| Identifier (Ref, CM Number) | 112 to 142 (task tokens) | 80 | 320 | left, mono |
| Name / Title | spring | 200 | none | left, one line with ellipsis and tooltip; Title cell may use two lines (work grid) |
| Relation (Client, Matter Name, Project) | 140 to 160 | 96 | 360 | left |
| Person (Assignee, Primary PM, Creator) | 136 to 150 | 112 | 280 | left, name only (account without domain) |
| Type | 112 (icon + name) | 96 | 260 | left |
| Count | 96 | 72 | 120 | right |
| Date / Due | 136 | 120 | 200 | left, D-60 |
| Status chip | 140 | 112 | 200 | left |
| Progress | 120 | 120 | 320 | left |
| Row action | 48 | 48 | 48 | right, icon only |

Grid types and their order (confirm in the crawl; use the existing `WORK_COLUMNS` and `grid-prefs` definitions as the single source):
- Tasks (Task Queue, My Work, Pod Work, Dashboard grid, Matter and Project Tasks): Ref, Type, Title, CM Number, Matter Name, Project, Priority, Assignee, Due, Status, Progress (guide 11.1; scoped lists drop the obvious columns).
- Assets: Type, Name, CM Number, Size, Linked Tasks, External Reference, Disposition.
- Matters: CM Number, Matter Name, Client, Primary PM, Secondary PM, Open Tasks, Overdue, Status.
- Clients, Projects: identifier, Name, relation, Open Tasks, Overdue, Status (as built; align names to this order).
- Admin lists (Roles, Pods, Users, Priorities, Status Labels, On-Hold Reasons, Task Types, Workflows, Steps, Asset Types, Link Roles, Custom Fields, Note Tags, Reports): Name (spring), then Description (spring, one line, ellipsis + tooltip, max 40 characters wide on 1366), then counts, then Status chip, then the row action. Order or colour columns come right after Name. No toolbar, no search, no sort (AR.13); the primary "+ New <Thing>" is in the page header.
- Audit Logs and Activity: When (date and time, D-60), Who, What, Target, Details.
Don't: Status first, an action column wider than 48, a column header that differs from the form field label of the same field.

**D-44 Row actions.** Do: one icon-only "..." button (36 target, icon 18, no border) at the end of the row, visible at 60% emphasis (`--mf-text-muted`) and full on row hover or focus; two or more actions go in its menu; a single obvious action (Assign) is its own icon button with tooltip "Assign work to <name>"; a row click opens the record (the whole row is the target, the cell links stay links). Don't: an outlined square "..." on every row, a chevron as the row affordance (Roles), a text link such as "Assign to me" repeated per row. Reference: Dashboard Users table.

**D-45 Truncation.** Do: names and titles one line with ellipsis and the full text as tooltip and accessible name; descriptions wrap to two lines max; toolbar text fits at 1366 px (placeholder "Search by name", sort line shortens to "Sorted by Load" with the full text as tooltip); the breadcrumb cuts at 40 characters. Don't: a cut placeholder or a cut label at 1366 x 768. Evidence: "Search by na", "Sorted by Availability an...".

**D-46 Toolbar placement.** Do: the order of guide 11.1 and 11.2: Search, Filters (n), view switch or dropdown, spring, Sorted by, Columns, "...", primary last when the page has no H1 row; one 36 px row, wraps by group, the primary stays at the right end. Don't: a segmented switch to the right of the Sorted by text on one page and left on another.

## 6. States and messages

**D-50 Loading.** Do: first load of a page or grid shows a skeleton that has the final layout (`mf-record-skeleton`, grid skeleton rows, `--mf-surface-alt` blocks, no shimmer under reduced motion); a refresh keeps the old content and shows nothing or a 16 px spinner in the header; a button shows "Saving..." / "Loading..."; the live region text is "Loading <thing>" with a noun. Don't: "Loading..." alone on a blank page, a full-page spinner, content jumping when data arrives.

**D-51 Empty and error.** Do: one calm block centred in the empty area: icon 24 in `--mf-text-muted`, one sentence, an optional action (Title Case button).
- First use: "No tasks yet." + `+ New Task` (only with permission).
- Filtered: "No tasks match these filters." + `Clear Filters`.
- Search: "No results for "<text>"."
- Read-only: "No tasks." Always a full stop; "yet" only when the user can create one.
- Error: `pi-exclamation-triangle` in `--mf-sem-overdue-solid`, "Couldn't load tasks." (never "Could not"), an optional second line with the reason or reference, and a secondary `Retry` button; a failed refresh keeps the old data and shows the stale banner "Couldn't refresh. Showing earlier data." with `Retry`.
- No access: "You don't have access to <thing>." with the 403 page for whole pages.
- Stale save: "This <thing> was changed by someone else." with `Reload Latest`.
Don't: "Something went wrong. Try again." as the only text (19 uses: name the thing), a card full of zeros, a red empty state. Reference: `mf-record-state`, `mf-dash-state`.

**D-52 Toasts.** Do: `NotificationService` only. Title in sentence case, "<Thing> <past participle>" without a full stop: "Role saved", "Production deleted", "Task TSK-12 created", "Link copied"; optional detail line (a sentence with a full stop, or the name of the thing). Errors: "Couldn't save the role." + the reason as detail. Severity colours from `--mf-toast-*` with the icon. Success 4 s, info 6 s, warning 8 s, error stays until closed; at most three visible; a `key` replaces a repeat. Undo toast: "Pods of Ann Lee restored." then Undo button, wording "Not undone: ..." when it can't. Don't: "Saved." (12 admin pages say it), a name-less "Saved", emojis, a toast for something the user can see change. Reference: `roles-page` ("Role saved").

**D-53 System pages.** Do: Access Pending, 403, 404 and Error are one `state-page` layout: centred card 480 px wide, radius 12, icon tile 48, H1 22 / 700 (the same title rule), one sentence, one primary or secondary action ("Go to Dashboard", "Retry"), the error reference in muted mono text with a copy button. Don't: separate layouts. Reference: `state-page.ts`.

## 7. Data formats

**D-60 Dates and times.** Do: one canonical format, the `NUMERIC_DATE` pattern (`shared/ui/numeric-date.ts`, pipe `mfNum`): date `MM/DD` in the current year and `MM/DD/YYYY` in another; time 12-hour `hh:mm AM/PM` with a leading zero; both `MM/DD hh:mm AM/PM`; the person's time zone decides day and clock; calendar dates are floating days. It is used in grids, record fields, chips, drawers, feeds, toasts and the audit log. The long readable form "October 26, 2026, 4:00 PM EDT" is used only in tooltips, accessible names, the month heading of a calendar and in sentences. Relative words ("Today", "Tomorrow", "3 h ago", "Due in 2 d") only where they exist today (due cell, feeds). Native date inputs show the browser locale; `html lang="en-US"` makes that MM/DD/YYYY. Don't: `mfDate` ("Oct 12, 2026, 10:23 PM EDT") in a cell or a field (42 files use it), ISO `2026-10-15` in user-visible text, a date with the zone in a cell, `d MMM y`. Retire `mfDate` for display; keep it for the long form only. Reference: My Matters, Dashboard Summary due cell. Evidence: `mfDate` 42 files, `mfNum` 12.

**D-61 Numbers.** Do: integers with a thousands comma ("1,234"); percentages without a space ("37%"); durations "2 h 48 m"; sizes "1.2 MB" (one decimal, KB, MB, GB, base 1024); ranges "1-50 of 143"; counts in tab labels in brackets "(372)", in chips bare; no decimals for counts; tabular figures (`font-variant-numeric: tabular-nums`) in grid number columns and figure cards. Don't: "1234", "37 %", "2h48".

**D-62 Names of people.** Do: display name; when none, the account without the domain (`shortAccountName`); never `KE\kekim` in a grid or card (still shown in the profile account field and the audit log's raw field). Reference: `person-name.ts`. Evidence: "ke\kekim" in the top bar and several lists.

## 8. Vocabulary of status (the words and the chips)

| Domain | Words (Title Case) | Chip colour source | Icon |
| --- | --- | --- | --- |
| Task status | New, In Progress, On Hold, Completed, Cancelled | `--mf-status-*` | plus-circle, play-circle, pause-circle, check-circle, ban |
| Priority | Critical, High, Normal, Low | `--mf-pr-*` | arrow icons per guide 11.5 |
| Due | Overdue, Due Soon, ASAP (the `+9d` suffix keeps its form) | `--mf-sem-overdue` / `risk` / `info` | clock |
| Matter | Active, Inactive, Sensitive | healthy / neutral / neutral | check, minus, lock |
| Asset disposition | Active, Inactive, Pending Disposition, Disposed | per theme guide table | as built |
| Person state | Idle, Light, Normal, Heavy, Out of Office, Off Hours | Users tokens | state icons (Tabler outline) |
| Coverage | Good, Watch, Low, Critical, Closed, Non-Working | `--mf-cov-*` | as built |
| Record | Active / Inactive for every admin record (never "Enabled", "Retired" except workflow versions: Draft, Published, Retired) | healthy / neutral | check, minus |
Rules: one word per meaning; the "Available" word is spoken, never a chip (owner); no chip repeats the information of the cell next to it; a chip never wraps; status text and chips always agree with the Status Labels admin list (admin-edited names are shown as stored).

## 9. Navigation and shell

**D-80 Navigation.** Do: the shell stays as built (full-height navy panel 220 px; selected = white pill 6 px radius, bold; hover `--mf-nav-hover-bg`; item 36 px high, icon `--mf-nav-icon`). Labels Title Case: Dashboard, My Matters, My Work, Clients, Matters (Projects and Assets indented), Pod Work, Task Queue; ADMINISTRATION: Users, Task Types, Labels, Asset Types, Custom Fields, Reports, Audit Logs, Settings. The top bar: logo area, global search (placeholder "Search clients, matters, tasks, assets...", the Ctrl+K hint stays as it is), the global primary "+ New Task" (hidden where the page has its own), the bell, the user menu. No sub-navigation in the panel other than the two indented items. Don't: a second navigation inside a page except tabs (D-15), a page opened only from a dashboard card without a back path. Reference: `app-shell`.

**D-81 Breadcrumbs.** Do: only on non-top-level pages (records, forms, admin pages: "Administration > Users"), `>` separators, 13 px muted, links underline on hover, current page plain.

## 10. Scope: desktop only

Owner decision: the app is desktop-only. There are no phone or tablet rules in this spec and none are tested. Design and check at 1366 x 768 and 1920 x 1080 only (the fixed-page layout, guide 7.1 item 3, stays). Existing narrow-window behaviour in the code is left as it is and is not reviewed.

## 11. Per-family checklist (what "done" means)

Every issue's acceptance list is built from: tokens only (no hex, no px outside this spec), shared component, heights per D-02, wording per D-20 and D-22, states per D-05, axe 0 violations, no new shortcut, screenshots at 1366 x 768 and 1920 x 1080. See `issue-template.md`.

## 12. Open points for phase 2 (to measure in the crawl, then freeze)

1. Real heights of every control, tab and row (`getBoundingClientRect`), to size the issues.
2. Toast position and duration actually in use (spec fixes only the wording and timing).
3. Grid column orders of Clients, Projects and the admin lists, to complete D-43.
4. Whether `pi-objects-column` exists in the installed PrimeIcons.
5. The Calendar switch and tab look after the latest merges.
6. Which hand-built dialogs have a dirty guard to preserve when they move to `mf-form-dialog`.
