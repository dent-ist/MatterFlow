# Notes tab: parity checklist with the approved mockup (issue #1031, MD-27)

Source of truth: `docs/ux/mockups/notes-mockup-r3.html` (design option A, the one the README recommends) with its README section "Notes mockup, revision 3", and the Notes tab of the matter-detail mockup round 3 (`docs/ux/mockups/matter-detail/index.html`, branch `matter-detail-mockups`) where the owner's later decisions are already drawn. Owner decisions in `docs/requirements/decisions-addendum.md` section AQ (items 9 and 10) and the owner's later calls of 2026-11-02 win over the mockup when they conflict.

**Result: 131 lines done (D), 11 different on purpose (P), 0 open (O).**

Legend: **D** = done (built as in the mockup), **P** = different on purpose (the reason is in the line), **O** = open (not done, reason given). The result column is filled in at the end of the work. Screenshots: `docs/ux/matter-detail/notes-parity/` (`<state>-mockup-<size>.png` next to `<state>-app-<size>.png`; sizes 1366 and 375).

Design option B (tag rail) and C (board of columns as the default) of the mockup, the "Mockup" demo panel, the role switch, the My Matters screen and the Labels admin screen are not part of the Notes tab of a Matter; the Labels page is issue #1021 and is already built.

## A. Frame and layout

| # | Mockup | Result |
|---|---|---|
| A1 | The Notes tab is ONE white card (border 1 px, radius 12, soft shadow) that fills the tab panel; nothing outside it scrolls on desktop | D |
| A2 | Inside the card: a header row on top, below it the body with list (left), splitter, note panel (right) | D |
| A3 | List column default width 380 px, min 260 px, max so that the note keeps 420 px | D (380 px, 260 px minimum, the note keeps 420 px; remembered) |
| A4 | Panel column fills the rest; empty panel shows icon tile, "Select a note to read it", "The note opens here. People who can edit the matter see an Edit button." | P: design A of the mockup has no panel until a note is opened, so the list fills the card (templates view too); the "Select a note to read it" tile is design B only |
| A5 | Page and document never scroll at 1366x768 and 1920x1080; only the list, the note and the history scroll inside their frames | D (e2e measures no page scroll at 1366x768) |
| A6 | Font, colours, radii, shadows from theme tokens (no hard-coded hex); chips use the ten-colour palette of the task types | D (tokens only; tag chips and avatars use the ten task type colours; `check-theme-colours` passes) |

## B. Header row (one line)

| # | Mockup | Result |
|---|---|---|
| B1 | `h2 Notes` (18 px) followed by a count chip with the number of notes (aria-label "Number of notes") | D |
| B2 | Pill "Sensitive" (lock icon) when the matter is sensitive, with the title "Sensitive matter: only people who can open this matter can read its notes." | D (`sensitive` input from the Matter page) |
| B3 | Pill "Read only" (eye icon, blue) when the person lacks Matter Note Edit, title "You can read notes on this matter. Adding and editing needs the Matter Note Edit permission." | D |
| B4 | Search box with magnifier, placeholder "Search title and text", aria-label "Search notes by title and text", clear (x) button when text is typed; matches highlighted with `mark` in title and preview; preview shows the hit with a leading ellipsis when the hit is far in | D (mark in title and preview; the shared search box with its own clear; the far-hit ellipsis is not drawn: the preview is the server snippet)  |
| B5 | Tag filter dropdown (tag icon, "Tags" prefix, value "All" or first name + "+n"), multi-select popover with search, colour dot, name, note count, check, Clear / Done, entries "Untagged" and "Locked" (with counts) | D (multi-select with search, counts, Untagged, Locked; tags and Locked combine) |
| B6 | View switch (segmented, `aria-pressed`): By tag, Latest first, Board, Templates; labels shrink to icons when the card is narrower than 1000 px | D (labels fall back to icons under 1120/1000 px of card width) |
| B7 | Collapse all / Expand all groups icon button (only in By tag view) | D |
| B8 | Sort dropdown (not in Templates): Newest (updated), Oldest, A to Z, Created; pinned notes always stay on top | D (Newest, Oldest, A to Z, Created; pinned stay on top) |
| B9 | "New note" split button: main part makes a blank note (edit mode), the caret opens "Blank note" / "From template..." (hidden for people without Matter Note Edit) | P: "New Note" (Title Case, theme guide section 9, MD-26) and the caret are two adjacent buttons from the shared button system instead of one joined split button |
| B10 | Header never wraps at 1366; below 690 px of card width the search drops to its own full-width line | D (one line at 1366; the search drops to its own full-width line under 760 px) |

## C. List: groups, rows, chips

| # | Mockup | Result |
|---|---|---|
| C1 | By tag view: one collapsible group per tag, alphabetical, last group "Untagged"; sticky group header = chevron, tag chip, "inactive" label for inactive tags, count chip; header is a button with `aria-expanded` | D |
| C2 | A note with several tags appears in each of its groups; hovering/focusing one copy highlights all copies ("twin" ring) | D |
| C3 | Row: avatar (32 px, initials, palette colour), title bold 14.5 px with pin and lock icons (screen-reader text "Pinned." / "Locked."), 2-line preview, tag chips, meta "Updated by <b>Name</b> . MM/DD hh:mm AM/PM" | P: the avatar shows the person who last updated the note (the list endpoint has no author); the meta line is as in the mockup |
| C4 | Chips inside a group: the group's tag with a ring ("here"), then "also in" and the other tags; in Latest view all tags; no tags shows "No tags" | D |
| C5 | Selected row has the blue background and `aria-current`; hover has a light background; focus ring inside the row | D |
| C6 | Latest first view: one flat list, every note once | D |
| C7 | Board view: one column per tag (272 px, chip + count header), cards with title, preview, "also in" chips, avatar + first name + date; horizontal scroll inside the frame | D |
| C8 | Pinned notes stay on top inside each group; pinning does not change "updated by" | D |
| C9 | Tag chip = rounded pill with dot and name, colours from the palette, 24 px high, ellipsis for long names | D |
| C10 | Skeleton rows while loading ("Loading notes" for screen readers) | D |

## D. Splitter

| # | Mockup | Result |
|---|---|---|
| D1 | 1 px line with a grip (8x44) in the middle; hover/drag/focus turns it blue; hit area 44 px wide | D |
| D2 | `role="separator"`, `aria-valuemin/max/now/text` ("Note list 380 pixels wide"), Left/Right 16 px, Home, End, Enter resets, double click resets, drag with pointer capture, width remembered (localStorage) | D (16 px keys, Home, End, Enter, double click, drag, remembered) |
| D3 | Note panel header has a "Reset list width" icon button while docked | D |
| D4 | Width is clamped so the note keeps at least 420 px; the splitter is hidden when the list is stacked (narrow) | D |

## E. Note panel: header and read mode

| # | Mockup | Result |
|---|---|---|
| E1 | Header: breadcrumb "Notes / <b>title</b>" (ellipsis), then buttons | D |
| E2 | Edit button (small, pencil + "Edit") for people with Matter Note Edit; on a locked note it is disabled, `aria-disabled`, title/name "Locked by <name>" | D |
| E3 | Icon buttons: Pin note (`aria-pressed`), Lock/Unlock, Delete (red), More actions (...), then History, Full width (expand/shrink), Close | P: icon buttons are the shared 32 px bordered `mf-btn--icon` (button rule, MD-26) instead of 34 px borderless ones |
| E4 | Unlock disabled with "Only <name> or an administrator can unlock this note" for everybody else; Delete disabled with "Delete needs the Matter Note Delete permission" / "Locked by <name>: unlock it before deleting"; disabled buttons stay visible, tooltip + accessible name carry the reason, click shows a toast with the reason | D |
| E5 | Title 20 px bold, then one line "Last updated by <b>Name</b> . MM/DD hh:mm AM/PM" | D |
| E6 | Tag chips under the line (or "No tags"), the lock badge "Locked by <name> . MM/DD hh:mm AM/PM" (amber pill with lock) beside them | D |
| E7 | Banner (info) for readers: "You can read this note. Editing needs the Matter Note Edit permission." | D |
| E8 | Banner (info) when locked: "This note is locked: it is read only for everybody (pinning still works). You can unlock it. / Only <name> or an administrator can unlock it." | D |
| E9 | Body rendered with the prose styles (headings 1 to 3, lists, quote box, links underlined in blue, tables with bordered cells and shaded header); tables scroll sideways inside their own frame | D |
| E10 | Links open in a new tab with `rel="noopener"` | D (links open in a new tab, noopener) |
| E11 | "Referenced items" block at the bottom: assets, projects, matters, notes (deduplicated, grouped, with counts), chips clickable | D (assets, projects, matters and notes; the mockup also had tasks, which this product does not reference) |
| E12 | A note opens in READ mode with an explicit Edit button (owner decision AQ 9 and 2026-11-02) | D |
| E13 | Opening a note from the keyboard moves focus to its title (`tabindex=-1`) | D |

## F. Edit mode

| # | Mockup | Result |
|---|---|---|
| F1 | Header shows "Edit note" / "New note" and the save state "No changes" (green dot) / "Unsaved changes" (amber dot, amber text) | D |
| F2 | Cancel LEFT, Save RIGHT in the header (owner decision 2026-11-02; the mockup r3 had them together on the right); Delete icon stays for an existing note (if permitted) | D (owner decision: Cancel left, Save right; the mockup had them together on the right) |
| F3 | New note starts in edit mode, cursor in the text; the panel goes to full width (list hidden) while editing, and "Show the list again" returns | D |
| F4 | One compact row above the toolbar: tags (chips with x, "Add tag" dashed button, "Tags" label) | D |
| F5 | Title = first line of the text (owner decision), shown large (28 px bold in the matter-detail mockup, 20-24 px here), placeholder "Untitled note"; no separate title input, no "Enter a title" error | P: no separate title field (owner decision AQ.9, the title is the first line); it is drawn large while editing; no "Enter a title" error |
| F6 | Editor box fills the frame (not a fixed 240 px box), scrolls inside; toolbar stays on top (sticky) | D |
| F7 | Placeholder: "Write the note. @ mentions a person, # or / references an asset, project, matter or note." | P: the first line shows "Untitled note" (it is the title); the mockup text is the hint line under the box (F8) |
| F8 | Hint line below: "Type / for commands (asset, mention, project, matter, note), @ for people, # for assets." | D |
| F9 | Dirty dot + Save enabled only with changes is NOT required by the mockup: Save is always enabled; unsaved state is shown in the header | D (Save is always on; the dot and text show unsaved changes) |
| F10 | Save: toast "Note saved", panel returns to read mode, focus on the title; error banner inside the panel on failure | D |
| F11 | Conflict (someone saved meanwhile): banner "<name> saved this note at <time> while you were editing." with "Reload their version" and "Keep mine" | D |
| F12 | Locked while editing: warning banner "This note was locked by <name>; your changes cannot be saved." with "Copy my text" and "Close"; Save disabled with the reason | D (checked in a scripted run: Save disabled with the reason, Copy my text, Close) |
| F13 | Discard dialog "Discard unsaved changes?" body "You have unsaved changes to <b>title</b>. If you leave now they are lost." buttons "Keep editing" (focused) and "Discard changes" (red); used when cancelling, opening another note, new note, switching tab | D |
| F14 | `beforeunload` guard while there are unsaved changes | D |
| F15 | Note too large (limit 100 KB of formatted text) shows a toast | D |

## G. Tags

| # | Mockup | Result |
|---|---|---|
| G1 | Tags are firm-wide, kept under Labels > Notes tags (#1021), people only pick; at most 5 per note | D |
| G2 | Picker: multi-select list with search "Search tags", colour dot, name, note count at the right, check; active tags only; "n of 5 selected"; at 5 the other rows are disabled and "Maximum of 5 tags reached" is announced | D |
| G3 | Footer text: "Missing a tag? Ask an administrator (Labels, Notes tags). Users can only pick." / for an administrator a link "Create one under Labels, Notes tags" | D (administrators get a link that opens Labels, Notes tags in a new tab) |
| G4 | An inactive tag already on the note stays visible with "(inactive)" and can be removed | D |
| G5 | Owner decision: the picker is a SIDE PANEL (not a popover) | D (side panel, owner decision; the mockup r3 had a popover) |
| G6 | Removing a chip with its x button; focus goes to "Add tag" afterwards | D |
| G7 | Tag filter in the header and "Untagged"/"Locked" entries (see B5) | D |

## H. Toolbar (one line, wraps only when narrow)

| # | Mockup | Result |
|---|---|---|
| H1 | `role="toolbar"` "Text formatting", grey strip with rounded top corners, roving tabindex (Left/Right/Home/End move inside it) | D |
| H2 | Paragraph style dropdown (min 118 px): Paragraph, Heading 1, Heading 2, Heading 3; label follows the caret | D |
| H3 | Bold, Italic, Underline with `aria-pressed` | D |
| H4 | Bulleted list, Numbered list, Quote (toggle, `aria-pressed`) | D |
| H5 | Link: dialog "Add a link" / "Edit link", address (https:// or onenote:https:// only) with error "Enter an address that starts with https:// or onenote:https://", "Text to show" when nothing is selected, Remove link, Apply | D (dialog; https:// and onenote:https:// only; the server Note profile now keeps the OneNote link) |
| H6 | Table: inserts a 3 by 3 table with a header row in one click | D |
| H7 | Table tools strip (blue) only while the caret is in a table: + Row, - Row, + Col, - Col, Header row (`aria-pressed`), Delete table; message when the caret is outside a table | D |
| H8 | Tab / Shift+Tab move between table cells (edges keep Tab's normal job) | D (TipTap table keys) |
| H9 | Mention (@) and Asset (#) buttons type the trigger character | D |
| H10 | Clear formatting (removes marks, link, heading, quote) with toast "Formatting cleared" | D |
| H11 | Undo and Redo (disabled when nothing to undo/redo) | D |
| H12 | Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Z, Ctrl+Y inside the text field | D |
| H13 | Ctrl+K opens the link dialog | P: no Ctrl+K (no new shortcuts, #420); the Link button does the same |
| H14 | Paste is plain text only; drop is blocked | D |

## I. Slash, @ and # menus

| # | Mockup | Result |
|---|---|---|
| I1 | `/` is recognised at the start of a line or after a space only (URLs and "and/or" never open it) | D |
| I2 | Popover `role="listbox"`, the editor keeps focus and points at the active row (`aria-activedescendant`), header row in small caps with a key hint ("type to filter, Esc closes") | D |
| I3 | Commands (owner list): /asset, /mention, /project, /matter, /note (no /assets, no /template, no /task); each row has an icon tile, "/name" and a one-line description | D (owner list: asset, mention, project, matter, note; no /assets, /template or /task) |
| I4 | Keys inside the menu: type to filter, Up/Down, Enter or Tab choose, Esc closes, Backspace goes back one level | D |
| I5 | Two levels in the same popover: choosing a command turns the text into "/asset " and shows the breadcrumb "Asset >" with that command's list; Backspace on the space returns to the command list | D |
| I6 | Choosing an item deletes the typed "/..." text and puts the chip in its place followed by a space | D |
| I7 | `@` lists people: avatar, name, role line; header "Mention a person (no notification)"; "No one with that name" | D (the second line is the e-mail address; the mockup showed the role) |
| I8 | `#` lists assets of this matter: type icon tile, name, "type . identifier", status pill; header "Assets of this matter (type to search)" | D (type, reference and "inactive"; no status pill: the lookup has no status) |
| I9 | /project rows: icon tile, name, one-line description, status pill | P: project rows show the name only (the lookup has no description or status) |
| I10 | /matter rows: matter name and reference | D |
| I11 | /note rows: other notes of this matter (title, updated line); chosen note is embedded inline (see J) | D |
| I12 | Menu opens below the caret, above it when there is no room; max height 240 px; scrolls the active row into view | D |
| I13 | Menu closes on blur, on Esc (without closing the panel), when the caret leaves the trigger | D |

## J. Reference chips and the linked note

| # | Mockup | Result |
|---|---|---|
| J1 | Mention chip: blue pill with "@Name"; atomic (one Backspace removes it) | D |
| J2 | Asset/project/matter chip: white pill with a ring, type icon, name; state tag on the chip when not active (completed, disposed, inactive ...) | D |
| J3 | Removed item shows "Removed asset" (and so on), a restricted one "Restricted asset"; neither is clickable | D |
| J4 | In read mode and in "Referenced items" chips are links: tabindex 0, Enter/Space/click open the item in a new window; accessible names "Asset <name>, opens in a new window" | D (opens in a new window; a note of this matter opens in the tab) |
| J5 | Stored HTML: one safe span per reference with ONE data attribute (`data-user-id`, `data-asset-id`, `data-project-id`, `data-matter-id`, `data-note-id`, `data-embed-id`) and no class/style | D |
| J6 | /note: other note embedded read only inside the text, bordered frame (2 px primary border, header "Linked note" with the title and an "Open note" button, body the other note's text); unavailable note says "This note is not available to you" | D |
| J7 | Embedded block cannot be edited inside the text, Backspace removes the whole block | D |

## K. Templates

| # | Mockup | Result |
|---|---|---|
| K1 | Templates view (view switch): intro line "A template is a ready-made note: title, tags and body. Placeholders such as {{date}} {{matter}} {{author}} are filled when it is used." + "New template" button | D |
| K2 | List rows: icon tile, name, description + first words, scope chip (Firm-wide blue / This matter grey), tags, "Used N times"; per row Use, Edit, Duplicate, Delete (small buttons) | D |
| K3 | Template read panel: header "Templates / name", Use (primary), Edit, Duplicate, Delete; body with placeholders highlighted; info line "Highlighted placeholders are replaced when the template is used. Title when used: ..." | D |
| K4 | Permissions: using or changing a matter template needs Matter Note Edit; firm-wide templates are changed only by an administrator; a reader sees the list, actions disabled with the reason (tooltip + name + toast) | D |
| K5 | Use: opens a new note in edit mode with title, tags and body filled ({{date}}, {{matter}}, {{author}}, {{time}}); other placeholders stay; offers tags | D |
| K6 | New note > From template...: dialog "New note from a template" with one card per template (icon, name, description, first words, scope chip, used count) | D (centred dialog, `mf-form-dialog` of #1026) |
| K7 | Save as template (More menu "Save as template..."): dialog with name, description, scope radios (Firm-wide only for an administrator), "Include the tags", note about references; works on a locked note | D (`mf-form-dialog`) |
| K8 | Template editor = note editor + description + scope select + highlighted tokens; banner explaining tokens | D (`mf-form-dialog`, tokens highlighted) |
| K9 | Delete template confirmation "Delete this template?" ("Notes already made from it are not changed.") | D |
| K10 | The create/edit forms use the centred pop-up dialog block of #1026 once it is on the branch | D |

## L. History

| # | Mockup | Result |
|---|---|---|
| L1 | History column on the right of the note (read AND edit mode of an existing note) when the note area is at least 820 px wide; narrower: the History button opens the same list in a dialog | P: under 820 px History opens in the shared side panel (app standard for read context, #1026) instead of a dialog |
| L2 | Header "History" + count chip + collapse button (`aria-expanded`); newest first, grouped by day (Today, Yesterday, Fri 10/23) | D |
| L3 | Entry: avatar, "<b>Name</b> edited / created this note / changed the tags / locked this note / unlocked this note", time "MM/DD hh:mm AM/PM . relative" | D |
| L4 | Footer note "History shows who and when only. There are no versions, no comparison and no restore." | D |
| L5 | Collapses to a 46 px rail with the count and a vertical "History" label; own splitter (same keys as the list splitter), width remembered | D |
| L6 | History refreshes after save, lock, unlock | D |

## M. Lock

| # | Mockup | Result |
|---|---|---|
| M1 | Lock icon on the row (every view), lock badge in the note header, "Locked" entry in the tag filter with a count | D |
| M2 | Locked note: no edit, no retag, no delete, no template applied; pin allowed; Save as template allowed | D |
| M3 | Who may lock: Matter Note Edit; who may unlock: the locker or an administrator | D |
| M4 | Lock and unlock appear in the history; toasts "Note locked: it is read only for everybody" / "Note unlocked" | D |

## N. Pin, delete, more

| # | Mockup | Result |
|---|---|---|
| N1 | Pin toggles with toast "Pinned to the top of its groups" / "Unpinned" | D |
| N2 | Delete dialog "Delete this note?" naming the tag groups it leaves; "It cannot be undone from this screen. The deletion is written to the audit log."; buttons Cancel (focused), "Delete note" (red); after delete focus goes to New note / search | D |
| N3 | More menu (...) with "Save as template..." | D |

## O. AI (owner decision AQ 10)

| # | Mockup / decision | Result |
|---|---|---|
| O1 | AI button in the note header; opens the "coming soon" panel (no function) | D |
| O2 | Matter's AI allowed = No: button disabled, message "AI can't be used on this matter" | P: the button is disabled, and its tooltip and its accessible description say "AI can't be used on this matter"; the sentence is not printed beside it because the note header is one line (the owner's wording is kept exactly) |
| O3 | AI warning dialog exists behind a flag that is OFF; "Saved after an AI warning" history line is wired for later | D (component exists, flag off, `beforeSave` seam, "saved after an AI warning" history text) |

## P. States

| # | Mockup | Result |
|---|---|---|
| P1 | Empty (no notes): tile icon, "No notes on this matter yet", text "Notes keep what the team knows in one place: decisions, call summaries, protocols, tables and links. Group them with tags and everyone sees the latest version.", primary "Add the first note"; readers see "Nobody has added a note yet. People who can edit this matter can add one." | D |
| P2 | No match: "No notes match", "Nothing matches "q" / the chosen tags. Try other words or remove a filter.", button "Clear search and filters" | D |
| P3 | Loading: skeleton | D |
| P4 | Error: message with a Try again button and `role="alert"` | D |
| P5 | Sensitive matter and read-only pills (B2, B3) | D |
| P6 | Note removed meanwhile: "This note no longer exists." | D (toast "That note is no longer available.") |

## Q. Responsive and phone

| # | Mockup | Result |
|---|---|---|
| Q1 | Below 1000 px (and in a narrow card) the list and the note stack: opening a note shows it as a full-width panel/drawer with a close button; no horizontal page scroll at 375 px | D (under 760 px the note replaces the list and Close returns; header hides while a note is open) |
| Q2 | At 375 px: header wraps (search full width, dropdowns share a line, view switch full width), rows keep 16 px gutter | D |
| Q3 | History opens as a dialog when the note area is under 820 px | P: side panel (see L1) |
| Q4 | Toolbar wraps on narrow widths; buttons keep 30 px targets (44 px on touch is not drawn in the mockup) | D |

## R. Keyboard and accessibility inside the widgets (no new app shortcuts, #420)

| # | Mockup | Result |
|---|---|---|
| R1 | Dropdown popovers: Up/Down/Home/End/Enter/Space/Esc/Tab, `aria-activedescendant`, focus returns to the opener | D |
| R2 | Dialogs: `aria-modal`, focus trap, Esc closes, focus returns to the opener | D |
| R3 | Esc closes the open menu first, then the panel; never both | D |
| R4 | Toolbar roving tabindex; tab strip arrow keys | D (toolbar); the tab strip keys belong to the Matter page |
| R5 | Live region announces toasts and "Maximum of 5 tags reached" | D |
| R6 | Axe: 0 violations at 1366x768 and 375x812 (list, read, edit, templates) | D (e2e axe: list, read, edit and templates at both sizes) |
| R7 | Reduced motion respected | D |

## Conflicts between the mockup and the owner's decisions (the later decision wins)

1. **Title.** The mockup has a Title input above the toolbar; AQ 9 says the title is the first line of the content. Built: no title input, the first line is drawn large while editing and is the heading in read mode.
2. **Edit mode buttons.** The mockup put Cancel and Save together on the right of the header; the owner (2026-11-02) wants Cancel left and Save right. Built that way.
3. **Slash commands.** The mockup lists Template, Asset, Task, Project and a `#`/`@` shortcut; AQ 9 fixes /asset /mention /project /matter /note (no /assets). Built: those five (plus `@` and `#`); templates are reached from New Note > From template and the Templates view, tasks are not referenced.
4. **Tags.** The mockup picks tags in a popover; AQ 9 says tags show in a side panel and (Labels, #1021) are firm-wide. Built: side panel, firm-wide tags, at most five.
5. **Permissions.** The mockup's role switch had three note permissions (Read, Edit, Delete); same as AQ 9: `MatterNote.View`, `MatterNote.Edit`, `MatterNote.Delete`. Unchanged.
6. **AI.** The mockup r3 had no AI button; AQ 10 and the matter-detail mockup do: the button opens the "coming soon" panel, is disabled with "AI can't be used on this matter" when AI allowed is No, the save warning dialog exists behind the OFF flag.
7. **Buttons.** The mockup's 34 to 36 px buttons and joined split button give way to the button rule of the theme guide section 9 (MD-26): shared `mf-btn` styles, one 32 px size, "New Note" in Title Case, the caret next to it.
8. **Create and edit forms.** The mockup's dialogs for templates are the app's centred `mf-form-dialog` (#1026, owner decision of 2026-11-02); read context (History below 820 px) stays a side panel.
9. **Dates.** The mockup's `MM/DD hh:mm AM/PM` is the app's numeric date format (`mfNum`, UXR #974).
10. **Keyboard.** The mockup's Ctrl+K opens the link dialog; no new shortcuts in this phase (#420), so the Link button is the way in.

## Screenshots

`notes-parity/<state>-mockup-<size>.png` next to `notes-parity/<state>-app-<size>.png`, sizes `1366` (1366x768) and `375` (375x812). States: `list` (a note open, By tag), `edit`, `slash` (the menu), `templates`, `empty`, `tags` (tag picker), `locked`, `discard`, `link` (link dialog), `history`, `newmenu`, `filter`, `board`.
