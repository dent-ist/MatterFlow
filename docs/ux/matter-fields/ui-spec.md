# Matter fields: UI design spec (#1299, epic #1298)

Designer spec for five new Matter fields: **Team**, **Matter Type**, **Current State**, **DMS Path**, **DFS Path**, and the three admin pick lists behind them. Follows `docs/ux/design-guidelines.md` (rules cited as D-xx). Desktop only, 1366x768 and 1920x1080 (D-82). **No new or changed keyboard shortcut** (#420): everything here is reachable with Tab, Enter, Space, Esc and the arrow keys of a focused widget; `shortcut-registry.ts` is not touched.

No screenshots were made (this is a spec, not a build). Wireframes below are ASCII; measured values are computed from the current code at 1366 (grid frame about 1098 px) and 1920 (about 1668 px).

## 0. Owner decisions this spec builds on (final, not reopened)

| Topic | Decision (epic #1298) |
| --- | --- |
| Team | Several people per matter. Row = Name, Email, Title. Title comes from an admin-managed list. Members are typed-in contacts (anyone, not linked to accounts); an optional "pick from existing users" shortcut only fills Name and Email. No size limit. The same email cannot appear twice on one matter. |
| Matter Type, Current State | Optional. Admin-managed, ordered lists. Current State shows the current value only; every change is audited; no history card. Lists and filters need "Not set". Both are list columns, filters and searchable values. |
| DMS Path, DFS Path | UNC (`\\server\share\...`) or `http://` / `https://` only, format-checked. Copy button on both; clickable link for web addresses only. Drive-letter paths refused. Matter page only. |
| Where | Team, DMS Path and DFS Path are on the matter page only (not list columns; Team not searchable). |

## 1. Summary of the design decisions

1. **Summary tab > Details card** gets Matter Type, Current State, DMS Path and DFS Path (shared `mf-details-card`, D-44f). No new card there.
2. **Team is a new Matter tab, "Team (n)"**, with a record grid, an Add/Edit Team Member dialog and a remove confirm. A tab (not a Summary card) because the team has no size limit and the Summary page cannot give a grid room at 1366x768 without squeezing the Details card to a few rows.
3. **Create/Edit Matter dialog** gets Matter Type, Current State, DMS Path, DFS Path. Team is not in the dialog (a dialog must not open a dialog, D-31); a new matter's team is added on the Team tab.
4. **Matters list** gets two columns and two filters. **Owner decision (2026-11-08): Matter Type and Current State are ON by default.** To keep the default set inside the 1366 frame, **Primary PM, Open Tasks and Overdue become off by default** (still one click away in Columns, still filterable). Default set: CM Number, Matter Name, Client, Matter Type, Current State, Status (section 6.1).
5. **One new Administration item, "Matter Lists"**, with three tabs: Matter Types, Current States, Team Titles. Same kit as On-Hold Reasons (reorder list, D-44o). New permission `MatterList.Manage`.

## 2. Matter page > Summary tab > Details card

### 2.1 Field order and placement

The card stays one `mf-details-card` titled "Details" with `threeColumns` (3 columns when the card is 1100 px or wider, so 2 columns at 1366 and 3 at 1920) and its inner scroll. The Summary tab never scrolls as a page (D-03); the card scrolls inside when it is taller than the room.

New order (existing fields keep their labels and behaviour):

| # | Label | Width | Value |
| --- | --- | --- | --- |
| 1 | CM Number | 1 col | unchanged |
| 2 | Client | 1 col | unchanged |
| 3 | Matter Number | 1 col | unchanged |
| 4 | Matter Name | 1 col | unchanged |
| 5 | **Matter Type** | 1 col | name as stored, or muted "Not set" |
| 6 | **Current State** | 1 col | name as stored, or muted "Not set" |
| 7 | **DMS Path** | wide (full card width, all columns) | path or link + Copy, or muted "Not set" |
| 8 | **DFS Path** | wide | same |
| 9 | Status | 1 col | unchanged (moved down) |
| 10 | Sensitive (only when sensitive) | 1 col | unchanged |
| 11 | Primary PM, Secondary PM, AI Allowed, Created, Last Updated | 1 col each | unchanged |
| 12 | Custom fields | as today | unchanged |

Why this order: the two path fields are what a person opens the matter for. Placed after Matter Name they are inside the first 335 px of the card at 1366 (five rows: CM/Client, Number/Name, Type/State, DMS, DFS), so they are visible without scrolling the card. Placed last they would sit under the fold of the inner scroll. Status moves from the third row to the fourth block; it is also in the Matters list and the header, so nothing is lost. At 1920 (3 columns) the rows are: CM / Client / Matter Number, Matter Name / Matter Type / Current State, DMS (wide), DFS (wide), Status / Primary PM / Secondary PM, and so on.

`wide` must span **all** columns (`grid-column: 1 / -1`), not only two; the current `wide` input of `mf-details-card` is written for two columns, so the implementation checks that at 1920.

```
Details
CM Number                       Client
[ 1234-0056 ]                   1234 Acme Corp
Matter Number                   Matter Name
0056                            Acme v. Beta, document review
Matter Type                     Current State
Securities Litigation           Start of Discovery
DMS Path
\\fs01\dms\Matters\1234\0056\Acme v. Beta                            [Copy]
DFS Path
https://dfs.example.com/matters/1234/0056                            [Copy]
Status                          Sensitive ...
```

### 2.2 Matter Type and Current State values

- Plain text 14 px, the stored name (admin-edited names are shown as stored, D-20). **No chip**: chips are status words with icons (D-12) and these are free labels.
- One line, ellipsis, tooltip with the full name (D-45). Names are at most 100 characters; a column is about 520 px at 1366, so about 65 characters show before the ellipsis.
- Not set: muted `--mf-text-muted` "Not set" (class `ms__none`, same look as "None" for a missing PM). No "Add" button; Edit in the header is the one way to change it.
- An inactive pick-list item still shows its name on matters that carry it, with the muted suffix " (inactive)" in the tooltip only (the cell shows the plain name).

### 2.3 DMS Path and DFS Path values

Value row = value at the left, `mf-copy-button` at the right (`showText`, caption "Copy", done caption "Copied", `label` "DMS Path" so the accessible name is "Copy DMS Path"; copies the exact stored text, not a shortened one).

| Stored value | Shown as | Copy |
| --- | --- | --- |
| `https://` or `http://` address | `a.mf-link` in `--mf-font-mono`, underlined (D-13), `href` = the stored value, `target="_blank"`, `rel="noopener noreferrer"`, with a visually hidden " (opens in a new tab)". A 12 px `pi-external-link` icon follows the text (decorative). | yes |
| UNC path `\\server\share\...` | plain text in `--mf-font-mono`, selectable, **not a link** (browsers do not open `file:` or UNC links from a web page). | yes |
| empty | muted "Not set" | no button |

- The Copy button is a text button (24 px, D-02, D-13) and never shrinks or wraps; the value takes the rest of the row.
- A success "Copied" appears inside the button for 2 seconds and is announced politely (existing `mf-copy-button` behaviour). **No toast** (the person sees it change, D-52).
- Visible label "DMS Path" / "DFS Path" (acronyms stay capitals; glossary below).

### 2.4 Long values (paths)

A path has no spaces to wrap on, so it wraps anywhere (`overflow-wrap: anywhere`), **clamped to two lines** with an ellipsis (D-45, descriptions), the full text in the tooltip (`[mfTip]`, max 280 px wide, wraps) and always in Copy.

| Width | Wide field width | Copy button | Value width | About 14 px mono characters per line |
| --- | --- | --- | --- | --- |
| 1366x768 (card about 1098 px, padding 16) | about 1066 px | about 72 px with gap | about 990 px | 118, so 2 lines show about 236 characters |
| 1920x1080 (card about 1668 px) | about 1636 px | about 72 px | about 1560 px | 185, so about 370 characters |

The longest allowed path (1000 characters, section 3.3) is cut with an ellipsis after two lines at both sizes; it still opens and copies in full. The field never grows past two lines, so the Details card keeps its height rules.

## 3. Create / Edit Matter dialog (`mf-form-dialog`, 576 px default, unchanged size)

> **Epic #1368 (Matter Category, Matter Types multi-select, full-page New Matter).** The field set below is the matter form (`frontend/src/app/features/matters/ui/matter-form.ts`). **Creating** and **editing** a matter are now full pages, `/matters/new` and `/matters/:id/edit` (`MatterFormPage`, #1371 and #1381: page header with the crumbs Matters > New or Matters > the matter name, the same form in the standard form card, Cancel left and Create Matter or Save Changes right in the sticky action bar; `?clientId=` preselects the client of a new matter; Cancel and a successful Edit return to the page the person came from, the matter page or the Matters list when the page was opened directly; leaving with typed values asks "Unsaved Changes" first). The Edit button on the Matter page opens the Edit page; the pop-up is gone. **Matter Type** became **Matter Types**, a multi-select (`mf-dropdown` multi, no "Not Set" row: nothing chosen is Not Set, the button shows the first type and "+n", a chip line under it names every chosen type); **Matter Category** (new, a single choice with "Not Set" first, list maintained under Administration > Lists > Matter Categories) sits right after it, before Current State. The Summary shows both (`Matter Types` as one line "A, B", `Matter Category`), the Matters list column, filter and sort read "Matter Types" (a matter matches a type filter when any of its types is chosen). The audit log records `MATTER_TYPE_CHANGED` (old and new set as names in list order) and `MATTER_CATEGORY_CHANGED`.

Order after the change (new fields in bold, placed after AI Allowed and before the custom fields):

Client, Matter Number, CM Number (read-only), Matter Name, Sensitive matter, AI Allowed, **Matter Type**, **Current State**, **DMS Path**, **DFS Path**, custom fields.

The dialog body already scrolls inside (max 90% of the window, D-31); four more fields make it scroll earlier at 768 px high. That is accepted: a wider two-column dialog was rejected because the existing fields are single-column with long help lines.

| Field | Control | Details |
| --- | --- | --- |
| Matter Type | `mf-dropdown` with `field` (white, D-44r), 36 px, `buttonId="matter-type"`, label "Matter Type" (no "(required)": optional fields carry no mark, D-35) | First option **"Not Set"** (the default for a new matter, selected; value empty). Then the **active** types in admin order. More than 10 options adds the search field (D-14). Help: "Optional. What kind of matter this is." |
| Current State | same | First option "Not Set", then active states in admin order. Help: "Optional. Where the matter stands now. Each change is recorded in the audit log." |
| DMS Path | `mf-text-field`, 480 px, max 1000 characters with counter | Help: "A network path (\\server\share\...) or a web address (https://...). Optional." Error under the field (section 3.3). |
| DFS Path | same | same |

- On edit, a matter whose current type or state was deactivated since shows it as the selected value with the suffix " (inactive)" and the item stays in the list only as that selected entry; choosing another value (or Not Set) removes it for good. It is never offered to a matter that does not have it.
- If the pick list is empty (no active items), the dropdown still opens and shows only "Not Set"; no error, no message (the field is optional).
- Values are trimmed on save. Validation runs when the person leaves the field and again on Save, never per keystroke. A failed Save puts the messages in the existing "Fix the following to save:" summary and under each field (`role="alert"`, `pi-exclamation-circle`, D-35); the first invalid field takes focus.
- Dirty close asks the standard "You have unsaved changes. Discard them?" `[Keep Editing] [Discard Changes]`.
- Current State is audited (section 8); changing it needs no extra confirm.

### 3.3 Path validation (shared by the dialog and the API; the backend enforces the same rule)

Whitespace at both ends is trimmed first. An empty value is valid (fields are optional) and is stored as "not set".

**Accepted**

- UNC: starts with exactly two backslashes, then a server name (letters, digits, `.`, `-`, `_`; no spaces), a backslash, a share name, then optional `\folder` parts and an optional trailing backslash. Share and folder names may contain spaces and any character except `\ / : * ? " < > |` and control characters. Example: `\\fs01\matters\1234\Acme v. Beta\`.
- Web: scheme `http` or `https` (any letter case), then `://`, a host, optional port, path, query and fragment; no spaces or control characters; no `user:password@` part.
- At most 1000 characters.

**Refused** (with the message that is shown)

| Example | Message (exact) |
| --- | --- |
| `C:\Matters\1234`, `z:\share`, `D:/x` | Drive-letter paths such as C:\ are not accepted. Use a network path (\\server\share\...) or a web address (https://...). |
| `https://user:pw@host/x` | Remove the user name and password from the web address. |
| `\\fs01` (no share), `//fs01/share`, `\fs01\share`, `ftp://host/x`, `file:///x`, `www.example.com`, `https://` (no host), `javascript:alert(1)`, `\\?\C:\x`, a value with a space in the server name or a line break | Enter a network path (\\server\share\...) or a web address starting with http:// or https://. |

The drive-letter check comes first (a pattern of one letter and a colon at the start), because it is the mistake people actually make. The messages are sentences with a full stop (D-51). No message for "too long": the counter stops typing at 1000 and shows it (D-35).

## 4. Matter page > Team tab (new)

### 4.1 Tab

`MATTER_TABS` gets `{ key: 'team', label: 'Team', icon: 'pi-address-book', counted: true }`. Position: the daily-work tabs keep their order and Team, which is reference information, goes **after Notes and before Activities**: Summary, Tasks, Projects, Assets, Productions, Notes, **Team**, Activities. Visible to everyone who can see the matter (no permission); count in brackets "Team (3)", "(--)" while loading. `?tab=team` opens it. The icon is registered as `team` in `tab-icons.ts` (one icon per concept, D-17).

### 4.2 Layout

Same frame as the other record-grid tabs (Projects, Assets): a control row, then `mf-grid-frame`, then `mf-pager`.

```
[ Sorted by Name ]  ...spring...                              [ + Add Member ]
+ NAME ^ ---------------------+ EMAIL ------------------+ TITLE ---------+ ----+
| Ann Lee                     | ann.lee@firm.com         | Attorney       | [x] |
| Ben Ortiz                   | ben@vendor.example       | Paralegal      | [x] |
+------------------------------------------------------------------------------+
Rows per page 50 ...
```

- Control row: "Sorted by Name" (`mf-sorted-line`), spring, primary **Add Member** (`pi-plus`, 36 px, last, D-41). **No search, no Filters button, no Columns chooser**: three fixed columns, and the owner did not ask for team search. (An in-tab search can be added later without a layout change.) "Add Member" is shown with `Matter.Edit` (the same permission and conditions as the matter header's Edit button) and hidden otherwise.
- `mf-record-grid`, id `matter-team`, rows 44 px, header 40 px, pager 25 / 50 / 100 (default 50): there is no team size limit, so the pager is required (D-42). Default sort Name A to Z; Name, Email and Title headings are sortable.
- Columns:

| Column | Width | Rule |
| --- | --- | --- |
| Name | spring, min 200 | `mf-btn mf-btn--text mf-btn--name` that opens **Edit Team Member** (D-44m); one line, ellipsis, tooltip. Without `Matter.Edit` it is plain bold text. |
| Email | 320 | plain text, one line, ellipsis, tooltip. Not a link (a `mailto:` link adds nothing the owner asked for). |
| Title | 176 | plain text, one line, ellipsis, tooltip. An inactive title shows its name plus the tooltip "This title is no longer offered." |
| (actions) | 48 (`--mf-col-actions-w`) | one action, so **one icon-only button** `pi-trash`, 36 target, muted at rest, accessible name and tooltip "Remove <Name>" (D-36, D-44). Hidden without `Matter.Edit`. |

- Sum at 1366: 320 + 176 + 48 = 544; Name gets about 554 px of the 1098 px frame. At 1920 Name gets about 1124 px. Nothing is cut mid-word (D-43).
- Why no "..." menu: Edit is the name button and Remove is the single other action; D-36 says one action is an icon button, and D-44g keeps Edit out of row menus.
- Row key is the member id, never the email (emails can be edited).
- Print (the existing `@media print` of grids): the grid prints as a list; the Remove column is hidden.

### 4.3 Add / Edit Team Member dialog (`mf-form-dialog`, 576 px default)

- Title "Add Team Member" / "Edit Team Member"; subtitle = the CM Number (as Edit Matter does). Primary "Add Member" / "Save Changes"; `[Cancel] ........ [Primary]` (D-30). Dirty close asks the unsaved-changes question. Enter in a text field submits.
- Fields, in this order:

| # | Field | Control and rules |
| --- | --- | --- |
| 1 | **Fill from a User** (optional) | `mf-entity-picker` (an inline search box, not a second dialog, D-31), placeholder "Search users by name", `inputId="member-pick"`. Help: "Optional. Fills Name and Email from a user. You can still change them." Searches active users. Shown only to people who may search users (the permission the Primary PM picker already needs); otherwise it is not rendered and the form is just fields 2 to 4. |
| 2 | Name (required) | `mf-text-field`, max 200, counter. |
| 3 | Email (required) | `mf-text-field` type email, max 254, counter. Trimmed; compared without letter case. |
| 4 | Title (required) | `mf-dropdown field`, active titles in admin order. Prompt (no value) "Choose a title". More than 10 titles adds the search field. |

- **Picking a user fills Name (the display name, D-62) and Email, then the picker clears** so it never looks like a link: nothing about the user is stored with the member, and Team does not touch My Matters or permissions. Under the picker a muted line says "Filled from Ann Lee." The fields stay editable. Picking overwrites what was typed in Name and Email (the person chose to). If the user has no email on file, Name is filled, Email is left empty and the picker line says "Ann Lee has no email on file. Enter one."
- Edit opens with the three values; the picker is shown (a person may re-fill); the dropdown shows the member's current title even if it was deactivated since, as "Paralegal (inactive)", kept only as the selected entry.
- **No active titles** (the list is empty or all inactive): the Title dropdown is disabled (grey), help line: "No team titles yet. An administrator adds them under Administration > Matter Lists.", and Add Member stays disabled until a title exists. (Title is required because every row is Name, Email, Title; see open question 2.)
- Saving: busy button "Saving...". Success: dialog closes, toast "Team member added" with detail "Ann Lee is on the team." (or "Team member updated", detail "Ann Lee."), the grid keeps its sort and shows the row; focus returns to the opener (Add Member button, or the member's name button).

**Validation messages (exact; shown under the field on leaving it and on Save, `role="alert"`):**

| Field | Condition | Message |
| --- | --- | --- |
| Name | empty or spaces | Enter a name. |
| Email | empty | Enter an email address. |
| Email | not an address (needs text, `@`, a domain with a dot, no spaces) | Enter a valid email address. |
| Email | already on this matter (any other row, letter case ignored; checked in the dialog from the loaded rows and again by the API) | This email is already on the team. |
| Title | none chosen | Choose a title. |
| Save | API failure | the dialog's error line "Couldn't save the team member." + the reason; a stale or duplicate answer from the API is mapped to the field message above |

The same email on a different matter is fine (owner decision). Editing a row to its own email is not a duplicate.

### 4.4 Remove confirmation (`mf-confirm-dialog`, small 416 px, D-34)

- Title: **Remove Team Member**. Body (one sentence): "Ann Lee will be removed from this matter's team. You can add them again later."
- Buttons `[Cancel] ........ [Remove Team Member]`, the confirm is the solid red danger button. Busy: "Removing...".
- Success toast: "Team member removed" with detail "Ann Lee is no longer on the team." No Undo (a confirm already asked, D-34).
- If the member is already gone (someone else removed them): the dialog closes and the toast reads "Team member removed" without an error.

### 4.5 States

| State | Display |
| --- | --- |
| Loading | grid skeleton rows with the final columns; tab count "(--)" (D-50). |
| Empty, first use, can edit | `mf-state-block`: "No team members yet." + button "Add Member". |
| Empty, read only | "No team members." (no button). |
| Error | "Couldn't load the team." + reason + "Retry"; no toast (D-51). |
| Matter inactive | same as the matter header's Edit: if Edit Matter is available on an inactive matter, so are Add, Edit and Remove; otherwise the Add button and the Remove buttons are hidden and names are plain text. The spec does not add a new rule. |
| One page of rows | "Rows per page", "Showing 1-50 of 143" as in every list. |

## 5. Wording (glossary additions, D-20)

| Concept | Word | Never |
| --- | --- | --- |
| The people on a matter | Team, "Team Member" (singular noun) | Staff, Contacts, Members alone as a heading |
| A team member's role | Title | Role (a Role is a permission set), Position |
| Kind of matter | Matter Type | Category |
| Where a matter stands | Current State | Phase, Stage, Status (Status is Active/Inactive) |
| Document system path | DMS Path | DMS Link, DMS Location |
| File share path | DFS Path | Network Path |
| No value | "Not set" in a cell or field (sentence case, read text); **"Not Set"** as a dropdown or filter option (Title Case, D-14) | None, N/A, "-" |
| Admin menu item | Matter Lists | Matter Fields |

## 6. Matters list

### 6.1 Columns

The list keeps `mf-record-grid` id `matters`. New columns come after the people columns and before the counts (D-43: people, status words, counts):

| Order | Column | Width | Default | Sort | Cell |
| --- | --- | --- | --- | --- | --- |
| 1 | CM Number | min 180 (11.25rem) | on | yes | unchanged |
| 2 | Matter Name | 36%, min 200 | on | yes | unchanged |
| 3 | Client | 22%, min 140 | on | yes | unchanged |
| 4 | Primary PM | 136 | **off (was on)** | yes | unchanged |
| 5 | Secondary PM | 136 | off | yes | unchanged |
| 6 | **Matter Type** | **160** (`--mf-col-matter-type-w`) | **on** | yes (list order of the type, then name) | plain text, ellipsis, tooltip; empty = muted "Not set" |
| 7 | **Current State** | **160** (`--mf-col-current-state-w`) | **on** | yes (list order) | same |
| 8 | Open Tasks | 96 | **off (was on)** | yes | unchanged |
| 9 | Overdue | 96 | **off (was on)** | yes | unchanged |
| 10 | Status | 160 | on | no | unchanged |
| 11 | (actions) | 48 | on | | unchanged |

Headings equal the field labels ("Matter Type", "Current State").

**Fit (D-43a).** The old default set used 180 + 200 + 140 + 136 + 96 + 96 + 160 + 48 = 1056 px of the 1098 px frame at 1366 (42 px free). Two 160 px columns need 320 px, so 278 px must go. Shrinking is not possible within the guidelines: CM Number holds 11 mono characters plus the copy button (180), Matter Name has its 200 px minimum (D-43), Client its 140 px token, Status is 160 px because the filter row stacks two filters in it (D-44w, #1276), and the actions column is fixed at 48 (D-42). "Start of Discovery" needs about 140 px with padding, so 160 is already tight. So columns leave the default set.

**New default set, 1366:** 180 + 200 + 140 + 160 + 160 + 160 + 48 = **1048 px of 1098** (the sum of the declared minimums, which is what `default-columns-fit.spec.ts` guards; as drawn, measured in #1312, the table gives CM Number 158, Matter Name 246, Client 164, Matter Type 160, Current State 160, Status 161 and Actions 48 = 1097 px, and 165 / 594 / 363 at 1920: the 11 mono characters and the copy button need about 130 px, so nothing is clipped, and `matter-fields-form-list.spec.ts` measures it: no sideways scroll, CM Number at least 140 px and not clipped) (50 px spare; Matter Name and Client share it through the springs, Name about 230 px, Client about 160 px). **1920:** the same six columns; the frame is about 1668 px, so Matter Name gets about 580 px and Client about 360 px. Columns do not drop by window width (D-42), so one default set serves both sizes.

**Which columns leave, and why.**
- **Primary PM (136):** the PMs are reachable through the "Mine" quick filter and the Primary PM and Secondary PM filters; the Matters list is mostly used to find a matter and tell what kind it is and where it stands, which the new columns now show.
- **Open Tasks (96) and Overdue (96):** counts need Task.View anyway, the same numbers are on My Matters and the Dashboard, and they are the least useful for finding a matter.
- Kept: CM Number and Matter Name (identity, locked), Client, Status (also carries the Active and Sensitive filters), and the two new columns. Client stays because the CM Number holds only the client's number, not its name.
- Considered and rejected: hiding Client and Primary PM instead (1100 px, 2 px over); keeping Open Tasks and Overdue and dropping Client and Primary PM (loses the only column that names the client).

**Adding columns back.** At 1366, turning on all three (Primary PM, Open Tasks, Overdue) gives 1048 + 328 = 1376 px of minimums, so the frame scrolls sideways inside itself with CM Number pinned (LC-09, as for any added column; the 160 px guarantee covers the default set only, D-43a, #1295). At 1920 all of them fit without scrolling (1376 of 1668). Guard: a Matters list case in `default-columns-fit.spec.ts` (sum of default widths plus minimums at most 1098).

**What a person with saved column choices sees** (the existing grid-preferences mechanism, `shared/ui/grid-prefs.ts`; this spec changes no mechanism):
- A column is shown when the person's stored `visible` list contains it, or, when no `visible` list is stored, when its definition is not `defaultHidden`.
- **Never changed which columns are shown** (nothing stored, or only widths or order stored): the person gets the **new default set** at once: Matter Type and Current State appear, Primary PM, Open Tasks and Overdue disappear. This is the on-screen change for most people.
- **Has used the Columns menu to show or hide columns** (a `visible` list is stored): their choice is kept untouched. **Matter Type and Current State are not in their list, so they are hidden for them** until turned on in Columns; Primary PM, Open Tasks and Overdue stay if they had them. Their stored order is kept; new columns slot in after the column that precedes them in the definitions.
- Stored widths are never touched. "Reset to Default" gives anybody the new default set.
- No migration or one-time reset is added: MatterFlow has not been deployed and all data is demo (CLAUDE.md, owner 2026-10-24).

### 6.2 Filters

| Filter | Control (`mf-column-multiselect-filter`, 32 px in the filter row) | Options |
| --- | --- | --- |
| Matter Type | multi-select, column "Matter Type", row placeholder word "Matter Type" (D-44d) | "All" first (trigger "All"), then **"Not Set"** (the flag option: matters with no type; travels as its own boolean parameter like "No pod", never mixed with ids), then every type in admin order. Inactive types that matters still use are listed with the suffix " (inactive)". More than 8 options adds the find box. |
| Current State | same, column "Current State" | same pattern |

- Several values and "Not Set" can be ticked together (a match on any). Trigger texts: "All", the value, "Not Set", "3 selected". Chip text: one removable chip per ticked value, as in every list (the shared filter chips, #1312): "Matter Type: Not Set" and "Matter Type: Litigation"; each has the remove button "Remove filter Matter Type: Not Set". The trigger carries the count ("2 selected"); there is no "+1" chip.
- A filter lives in the filter row **only while its column is shown**. Matter Type and Current State are shown by default, so their filters are in the row; if a person hides a column, its filter moves to the "Other filters" menu of the Filters bar (the existing hidden-column behaviour). The filters of Primary PM and Secondary PM move there too now that those columns are off by default; Open Tasks and Overdue have no filter. A filter on a hidden column still shows as a chip with "(hidden column)" and "Show column".
- They are `FilterDef`s like Status: URL is the source of truth, saved views and "Clear Filters" work unchanged. Parameter names are the backend's choice (suggested `matterTypeId` repeatable plus `matterTypeNone=true`, `currentStateId` plus `currentStateNone=true`).
- Print line: "Filters: Matter Type Not Set".
- Empty result: the standard "No matters match these filters." + "Clear Filters".

### 6.3 Search

The search box (`searchLabel` stays "Search matters") now also matches the **names of Matter Type and Current State**, in addition to number, name and client. No text change in the box. A row found only through a hidden column shows no explanation; that is accepted (the same as a client-name match on a narrow list). Team names, emails, DMS and DFS are **not** searched (owner decision). The global search (Ctrl+K) is not changed.

### 6.4 Not on the list

Team, DMS Path and DFS Path are not columns, filters or search targets (owner decision). The Columns chooser lists only the two new entries.

## 7. Administration > Matter Lists (three pick-list pages)

### 7.1 Place and shell

- **New item "Matter Lists"** in the Administration navigation, after Custom Fields and before Reports (data-model settings stay together). Icon `pi-sliders-h` (page icon key `matter-lists`). Path `/admin/matter-types` (first tab), `alsoActive: ['/admin/current-states', '/admin/team-titles']`. Permission `MatterList.Manage` (new entry in `contracts/permissions.json`: "Manage matter types, current states and team titles"; granted to the Administrator role in the seed; backend and frontend in step).
- One `mf-admin-list-shell`: heading "Matter Lists", breadcrumb Administration > Matter Lists, description (one line, 90 characters at most): "The choices offered for Matter Type, Current State and Team Title." Tabs (D-15, `adminTabItems`, counts of ACTIVE items "(5)"):

| Tab | Route | Icon | `countKey` |
| --- | --- | --- | --- |
| Matter Types | `/admin/matter-types` | `pi-briefcase` | `matter-types` |
| Current States | `/admin/current-states` | `pi-map-marker` | `current-states` |
| Team Titles | `/admin/team-titles` | `pi-address-book` | `team-titles` |

  Tab icons are registered in `tab-icons.ts`. A person with the permission sees all three tabs (one permission for the page). Header action: "New Matter Type" / "New State" / "New Title" (`pi-plus`, primary, last; D-41 and the existing admin lists), with `MatterList.Manage`.

### 7.2 List (the On-Hold Reasons kit, D-44o)

A reorder list on the kit table, looking like a record grid: frame 12 px radius, rows 44, header 40 (12/700 uppercase muted), 48 px actions column, a visible 16 px grip (`pi-bars`) before the order number, pager 25 / 50 / 100.

| Column | Width | Matter Types / Current States | Team Titles |
| --- | --- | --- | --- |
| Order | content (measured 67) | grip + number; drag to reorder | same |
| Name (heading "Matter Type" / "Current State" / "Title") | spring, min 200 | name as `mf-btn--name` button that opens Rename (D-44m); one line, ellipsis, tooltip; without permission plain text | same |
| In Use | content (measured 85), right aligned | heading "Matters": number of matters with the value; a number above zero is `mf-link` to the Matters list filtered by it (`/matters?matterTypeId=<id>`), zero is "0" (not a dash, D-43) | heading "Team Members": count of team rows with the title, plain number |
| Status | content (measured 99) | `mf-active-badge` (Active, Inactive) | same |
| (actions) | 48 | `mf-action-menu` "..." | same |

Row menu (D-36, more than one action): **Rename**, **Move Up**, **Move Down** (the keyboard path for reordering; disabled at the ends), **Deactivate** or **Activate**, and **Delete** (see below). Inactive rows are muted (`rowClass`, shared inactive look). Reordering changes the order of the dropdowns and filter options everywhere (that is the "ordered list" decision).

**In-use items deactivate, they are not deleted.** The menu offers **Delete only on a row whose In Use count is 0** (a typo or a test entry); a row that is in use has Deactivate only. Deleting is checked again by the API.

### 7.3 Dialogs (`mf-lookup-dialog`, like On-Hold Reasons)

| Action | Dialog |
| --- | --- |
| New | title "New Matter Type" / "New Current State" / "New Title"; one field "Name" (required, max 100, counter); `[Cancel] ... [Add Matter Type]` / `[Add State]` / `[Add Title]`. New items go to the end of the order and are active. |
| Rename | title "Rename Matter Type" etc.; field "Name"; primary "Save Name". Renaming changes the name on every matter that carries it; the dialog shows no extra warning (the audit log records matter changes, not renames of the list). |
| Deactivate | `mf-confirm-dialog` (D-34), title "Deactivate Matter Type" / "Deactivate Current State" / "Deactivate Title"; body: "12 matters keep this type. It won't be offered for new or changed matters. You can activate it again." (states: "...keep this state...", titles: "4 team members keep this title. It won't be offered for new or changed team members. You can activate it again."; zero in use: "No matters use this type. It won't be offered for new or changed matters. You can activate it again."); `[Cancel] ... [Deactivate Matter Type]` red. |
| Activate | no confirm (reversible); toast "Matter type activated". |
| Delete (unused only) | confirm, title "Delete Matter Type" etc.; body: "This permanently removes the type. It cannot be undone."; red "Delete Matter Type". |

Name validation messages (exact): empty "Enter a name."; duplicate (case ignored, among all items, active or not) "A matter type named 'X' already exists." / "A current state named 'X' already exists." / "A team title named 'X' already exists."; when the duplicate is inactive: add " It is inactive; activate it instead." Toasts (sentence case, no full stop, D-52): "Matter type added" (detail: the name), "Matter type renamed", "Matter type deactivated", "Matter type activated", "Matter type deleted", and the same with "Current state" and "Team title". Reorder: a polite live-region message "Moved Securities Litigation to position 2." and no toast (the person sees the row move).

### 7.4 States

| State | Display |
| --- | --- |
| Empty, first use | "No matter types yet." / "No current states yet." / "No team titles yet." + "New Matter Type" / "New State" / "New Title" (with `MatterList.Manage`, else the sentence only) |
| Error | "Couldn't load matter types." + Retry (inline banner, no toast) |
| Loading | kit skeleton rows with the final columns |

Suggested starting content is the backend's seed decision, not this spec (examples from the epic: states "Startup", "Start of Discovery"; titles "Attorney", "Paralegal").

## 8. Activity and audit wording (Matter > Activities)

The owner wants Current State changes audited and the feed to read well. Suggested one-line texts (sentence case, names as stored):

- "Current State set to Start of Discovery." (was not set)
- "Current State changed from Startup to Start of Discovery."
- "Current State cleared (was Startup)."
- Matter Type and the two paths: the existing "Matter edited" style entry lists the field names; Team: "Team member added: Ann Lee (Paralegal).", "Team member updated: Ann Lee.", "Team member removed: Ann Lee." Audit events carry the typed values; emails are in the event detail, not in the line.

## 9. Behaviour and accessibility checklist

- Fields: label above (13/600), 36 px controls, 16 px apart, help 13 muted, error 13 `--mf-danger` with `pi-exclamation-circle`, 1 px danger border (D-05, D-35). Dropdowns inside forms are white (D-44r); a disabled one is grey (D-44t).
- Focus: the dialog's first field gets focus (for Edit Team Member: Name); after an invalid Save the first invalid field; after close the opener (D-31).
- Screen readers: Team grid has the caption "Team members of <CM Number>"; remove button "Remove <Name>"; path value row reads "DMS Path, <value>, link, opens in a new tab" for a web address and "DMS Path, <value>" for UNC, followed by the "Copy DMS Path" button; the picker is a combobox with a polite result count.
- Keyboard: Tab order is toolbar (Add Member), then the grid (name button, remove button per row); reorder in admin is Move Up / Move Down. No custom key handling beyond the shared widgets (D-44b untouched).
- Time and dates: none of the new fields shows a date.
- Permissions: view = same as the matter (Team tab, fields); edit Team, Matter Type, Current State, DMS, DFS = `Matter.Edit` (create: `Matter.Create`); lists = `MatterList.Manage`. No new permission for Team.
- Team does not appear in My Matters, permissions or the Matters list.

## 10. Standard and code touch points for the implementer

Changing the guidelines is part of the implementation PR (design-guidelines section 7), not this spec:

1. `design-guidelines.md`: D-80 admin item list (add "Matter Lists"), D-43 Matters columns sentence (add Matter Type and Current State as optional, not default), D-44f (the Matter Summary fields and the wide path field with Copy), a new D-44y "Team tab and path values" with sections 2.3 and 4 in two sentences.
2. `docs/ux/design-guidelines.md` D-43 and D-43a also change as in section 6.1: the Matters line of D-43 ("Matters: CM Number, Matter Name, Client, Primary PM, Secondary PM, Open Tasks, Overdue, Status") becomes the new column order with the default set marked (CM Number, Matter Name, Client, Matter Type, Current State, Status on by default; Primary PM, Secondary PM, Open Tasks, Overdue optional), and D-43a gets one sentence naming the Matters list default set (1048 of 1098 px) and its guard. The Client > Matters tab is not changed.
3. `docs/ux/tokens.css`: `--mf-col-matter-type-w: 160px`, `--mf-col-current-state-w: 160px`.
4. `tab-icons.ts` (`team`, `matter-lists`, `matter-types`, `current-states`, `team-titles`), `nav-items.ts`, `admin.routes.ts`, `matter-tabs.ts`, `matter-summary.ts`, `matter-form-dialog.ts`, `matters-list-page.ts` (`defaultHidden` on `primaryManager`, `openTasks`, `overdue`; none on the two new columns), `matters-list-page.spec.ts` and the Matters e2e specs that assume the old default columns, `field-limits.ts` (`matterTypeName`, `currentStateName`, `teamTitleName` = 100), `contracts/permissions.json`.
5. Guards: capitalisation (every new label is Title Case as written), `private-classes.spec.ts` (no private link or chip), `record-grid-guard.spec.ts` (Team is `mf-record-grid`), default-columns fit for the Matters list (section 6.1), axe 0 at both sizes.

## 11. Decisions made by the designer where the owner's text left room (change on request)

1. Team is a tab, not a Summary card (section 1).
2. Superseded by the owner (2026-11-08): Matter Type and Current State are on by default; Primary PM, Open Tasks and Overdue go off by default (section 6.1).
3. All three team fields, including Title, are required (every row is Name, Email, Title).
4. Delete exists for unused pick-list items only; the existing label lists never delete.
5. A new admin item "Matter Lists" with one permission, rather than three more tabs on Labels (that page is for task labels and already has four tabs).
6. Path value is clamped to two lines (wrap anywhere), not one line with an ellipsis.
7. Email is plain text, not a `mailto:` link.
