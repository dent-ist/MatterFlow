# Asset numbering: screen specification

Status: proposal for owner sign-off, 2026-11-08 (revised the same day for the owner's decision: a free-text Pattern with tokens), base `origin/asset-numbering` (5557792). Author: UI designer. Issue: #1297 (owner approved the direction: Media folder `{CM Number}_{###}`, the counter restarts per matter). Standard: `docs/ux/design-guidelines.md` (D-numbers below), tokens `docs/ux/tokens.css`. Desktop only, 1366x768 and 1920x1080 (D-82). **No new or changed keyboard shortcuts (#420).**

Contents: 0 Decisions, 1 Asset Type editor (Numbering tab), 2 Next numbers per matter, 3 The number on assets (form, record page, lists, other places), 4 States and widening, 5 Wording table, 6 Components, 7 What the backend must supply, 8 Acceptance, 9 Owner decisions.

---

## 0. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The field is called **Asset Number**. | "Folder Name" is true only for Media today; the value is an identifier like "CM Number" and "Ref". The help line says what it is for ("Use it as the folder name on the share."). |
| 2 | The setting is a **free-text Pattern** (owner decision, 2026-11-07) with tokens `{client number}`, `{matter number}` and the counter `{###}`; everything outside braces is literal text. The editor helps with **token buttons** that insert at the caret, a **live Example** and **inline validation** that mirrors the backend rules (stable codes, section 1.4). | The owner wants prefix and suffix text (`MED-{client number}-{matter number}_{###}-A`). The guardrails below replace the dropdowns: the same rules run in the browser and on the server (shared vectors, section 7), so a pattern the editor accepts is never refused on Save for a rule the person could have seen. |
| 3 | Counter scope is shown as a **read-only line** "Counter restarts for each matter." Per client and global are **not offered now**. | One real case (YAGNI). The API and table keep a `scope` value so a later scope is a new option in one place, not a redesign. |
| 4 | Everything about numbering lives on a new **Numbering** tab of the asset type record (after Fields, before Assets). | The Overview tab already holds Details and Size; settings with their own Save, a grid of counters and a confirm flow fit a tab, not a card. The tab is always there (to turn numbering on) and is read by `AssetType.Manage` only, like the page. |
| 5 | Turning numbering **on** does not number old assets. Turning it **off** keeps assigned numbers. | #1297. An old asset of a numbered type shows "Not assigned" and has one explicit **Assign Number** button (no number is ever created silently by an edit). |
| 6 | The **next number can only be raised**, never lowered. | Numbers are never reused; a lowered counter could collide with a folder that exists on the share. |
| 7 | The Assets list gets an **Asset Number** column, default visible only when at least one active asset type has numbering on; External Reference then moves to "off by default". | D-43a and D-44k: the default columns must fit the 1098 px frame; the current 1096 px has no room for 152 px more. |

---

## 1. Asset Type editor: the Numbering tab (`/admin/asset-types/:id`)

### 1.1 Tab

`mf-tabs` label "Numbering", icon `pi-hashtag` registered in `shared/ui/tab-icons.ts` (D-15), key `numbering`, route state like the other tabs (`?tab=numbering`). Order: Overview, Fields, **Numbering**, Assets. Not shown while the type is new (before the first save), exactly like Fields and Assets. Page title of the tab: `<Type Name>: Numbering` (D-60 title helper `recordTitle`).

### 1.2 Card "Automatic Numbering" (`mf-details-card`, title "Automatic Numbering")

Layout (D-35): one column, labels above, 16 px between fields, fields 36 px, 480 px at most (the shared field width). Top to bottom:

1. A shared **checkbox** (the one of the Columns chooser) labelled **Number Assets Automatically**. Help under it (13 muted): "Each new asset of this type gets a number when it is saved. The number can't be changed afterwards."
2. Shown only while the checkbox is on, as an inner group with 16 px top margin:
   - **Pattern (required)**: `mf-text-field`, mono font (`--mf-font-mono` 14 px), 480 px wide, `maxlength` 100 (the field stops typing at 100; the TOO_LONG message still exists for a paste, which is cut and flagged), `spellcheck="false"`, `autocomplete="off"`. A new numbered type starts with `{client number}-{matter number}_{###}`. Help under the field (13 muted): "Text outside braces is used as written. Use one counter, for example {###} for 001, 002, and {client number} or {matter number} so each matter gets its own names."
   - **Insert** row (directly under the field, 8 px gap): the muted label "Insert" and three small secondary buttons, each `mf-btn` (36 px, D-02) with a Title Case label and the token as tooltip: **Client Number** (inserts `{client number}`), **Matter Number** (inserts `{matter number}`), **Counter** (inserts `{###}`). Decision: plain secondary buttons, **not** filter chips (chips are a filter or toggle look, D-12; these are actions). Accessible names "Insert Client Number" and so on; tooltips "Insert {client number}". Behaviour: the token goes in at the caret, replacing any selection; the field keeps focus and the caret is placed right after the inserted token; in a field that never had focus the token goes at the end. **Counter** is disabled while the pattern already has a counter, with the tooltip "The pattern already has a counter." The other two stay enabled (a client number may appear twice). No keyboard shortcut; the buttons are normal Tab stops after the field.
   - **Counter** (read-only text, label "Counter"): "Restarts at 1 for each matter. The number of # characters is the minimum width: {###} gives 001, {####} gives 0001."
   - **Example** (read-only, label "Example", mono 14 px, `--mf-text`, wraps with `overflow-wrap: anywhere`): the pattern rendered with a matter and a counter: `MED-90003-80008_001-A`. **Which matter:** the sample matter **client number 90003, matter number 80008, counter 1** when the type has no numbered asset yet; the **real** latest numbered matter of the type with its real next counter when it has (the API sends `example`, section 7). A muted caption under it says which: "Sample matter 90003-80008." or "Based on matter 90003-80008 (its next number)." While the pattern is invalid the Example shows the muted text "Fix the pattern to see an example." (never a stale value). It is a polite status (`role="status"`, not announced on every keystroke: it updates 300 ms after typing stops).
3. A muted line when numbering is on and old assets exist: "12 existing assets of this type have no number. They stay without one until you open them and choose Assign Number." Singular "1 existing asset ...". Hidden at 0.
4. When numbered assets already exist, a muted line under the Example: "Assets that already have a number keep it. A new pattern applies to new assets only."
5. Footer of the card: right aligned `Save Numbering` (primary, D-30), **disabled while the pattern is invalid** or the card is not dirty.

### 1.2a Validation of the Pattern (client side, same rules as the server)

The rules, in the order they are checked (the first failing one is shown; one message at a time, below the field, `--mf-danger` with the exclamation icon and `role="alert"`, the field border red, `aria-invalid`, `aria-describedby` to the message): the field validates on every change after the first blur or the first insert, and always on Save. Messages are keyed by the backend's stable codes, so a server refusal shows the same sentence (a code the browser does not know falls back to "Couldn't save numbering." plus the server text).

| Code | Rule | Message |
|---|---|---|
| PATTERN_FORBIDDEN_CHAR | literal text contains `\ / : * ? " < > \|` or a control character | The pattern can't contain \ / : * ? " < > \| or control characters. |
| PATTERN_UNKNOWN_TOKEN | a `{...}` that is not `{client number}`, `{matter number}` or a counter (also a lone `{` or `}`) | "<text>" isn't a token. Use {client number}, {matter number} or {###}. (the offending text, cut at 30 characters) |
| PATTERN_EDGE_SPACE | starts or ends with a space, or ends with a dot (counted on the pattern text) | The pattern can't start or end with a space, or end with a dot. |
| PATTERN_TOO_LONG | more than 100 characters | The pattern must be 100 characters or fewer. |
| PATTERN_NO_COUNTER | no counter token (an empty pattern is this case) | Add a counter, for example {###}. |
| PATTERN_TWO_COUNTERS | more than one counter token | Use only one counter. |
| PATTERN_COUNTER_WIDTH | a counter with 0 or more than 9 `#` characters (`{}` or ten `#`) | The counter must have 1 to 9 # characters. |
| PATTERN_NO_MATTER_OR_CLIENT | neither `{client number}` nor `{matter number}` | Add {client number} or {matter number}. Otherwise two matters get the same name. |

The browser builds the Example and runs these rules from one pure function `renderPattern(pattern, clientNumber, matterNumber, counter)` / `validatePattern(pattern)` tested against `contracts/asset-numbering/pattern-vectors.json`; the vectors are the single source of truth for what is valid and what the output is (counter padded to the minimum width and never cut, "1000" stays "1000").

### 1.3 Turning off

Unchecking the box and pressing `Save Numbering` opens a confirm dialog (D-34): title **Turn Off Numbering**, body "New assets of <Type Name> will no longer get a number. Numbers already assigned stay and are never used again, also if you turn numbering back on." Buttons `[Cancel] ... [Turn Off Numbering]` (danger solid). Turning on needs no confirm (it is reversible and changes no existing asset).

### 1.4 Behaviour and errors

- The save sends enabled, pattern, scope (`matter`). Concurrency uses the type's existing row version: "This asset type was changed by someone else." with `Reload Latest` (the existing stale banner of the page).
- Failure toast "Couldn't save numbering." + reason; no inline duplicate.
- Success toast "Numbering saved" (turned off: "Numbering turned off").
- A type without `AssetType.Manage` never reaches this page. A retired (inactive) type shows the card read-only with the muted line "Reactivate this asset type to change numbering." (controls disabled, grey not white, D-44t).

---

## 2. Next numbers per matter (second card of the Numbering tab)

Shown only while numbering is on (and on a type that has ever been numbered: if it was turned off, the card stays visible read-only so the history is not lost). Card title **Next Numbers** with the count chip of matters; description (muted): "Use this to continue after folders that already exist on the share. A next number can be raised, never lowered."

### 2.1 Grid

Shared `mf-record-grid`, id `asset-type-numbers`, server paged with `mf-pager` (25, 50, 100), search above (`mf-list-toolbar` with a search field "Search matters...", 320 px, by CM Number or matter name, 300 ms debounce) and a secondary button **Set for a Matter** at the right end (opens 2.3). No Columns chooser, no filters, no sort arrows except the default order (CM Number ascending).

| Column | 1366 | 1920 | Content |
|---|---|---|---|
| CM Number | 141 | 141 | `mf-matter-ref` with link to the matter |
| Matter Name | spring, min 200 | spring | one line, ellipsis + tooltip |
| Numbered Assets | 120 | 120 | count, right aligned, `mfInt` |
| Highest Used | 176 | 176 | the full number, mono, e.g. `MED-90003-80008_007-A`, one line, ellipsis with the full text as tooltip; "None" muted when the counter was raised on a matter with no assets |
| Next Number | 176 | 176 | the full next number in mono, e.g. `MED-90003-80008_008-A`, one line, ellipsis with tooltip |
| Actions | 48 | 48 | one icon-only button (pencil, tooltip and accessible name "Set Next Number for 90003-80008"), D-44: one action is a button, not a menu. Hidden when the card is read-only. |

Sum at 1366: 141 + 200 + 120 + 176 + 176 + 48 = 861, fits the 1098 px frame without sideways scroll; at 1920 the spring takes the rest.

### 2.2 Dialog "Set Next Number" (`mf-form-dialog`, 480 px)

Opened from the row button (matter fixed, shown read-only) or from Set for a Matter (matter picked).
- Title **Set Next Number**; subtitle the matter ("90003-80008 Matter Name") when opened from a row.
- Field **Matter (required)** (`mf-entity-picker` for matters, only when opened from the button; the picker uses the person's Matter.View: a manager without it sees the standard "You don't have access to matters." line, state wording).
- Field **Next Number (required)** (`mf-text-field`, numeric, 160 px, mono, right aligned): the **counter only** (`8`), not the whole name; prefilled with the current next counter for that matter (1 when the matter has none).
- Read-only **Example** under it: the type's pattern rendered with this matter's client number and matter number and the typed counter, e.g. `MED-90003-80008_008-A`, updating while typing (mono, wraps with `overflow-wrap: anywhere`, `role="status"`, updated 300 ms after typing stops). Same `renderPattern` function as the Numbering tab.
- Muted consequence line, shown when the value is above the current next counter: "Numbers 008 to 119 will never be used." (the range with the type's width). When equal: nothing.
- Rule: the value must be **at least the current next number** (which already is at least the highest used + 1) and at most 999,999. Messages: empty "Enter the next number."; not a whole number "Next Number must be a whole number."; below "The next number can't be lower than 8, the number the next asset gets now."; above "Enter 999999 or less."; server conflict (someone created an asset meanwhile and the minimum rose) "The next number is now 9 or more. Enter a higher number." (the field keeps its text, the example updates).
- Footer `[Cancel] ... [Set Next Number]` (D-30). When the value raises the counter, pressing the primary opens a confirm dialog (D-34): title **Set Next Number**, body "The next asset of <Type Name> in <CM Number> will be numbered <90003-80008_120>. The numbers in between are never used. This can't be undone." Buttons `[Cancel] ... [Set Next Number]` (primary, not danger: nothing is lost). When the value equals the current next number the dialog just closes with no call and no toast.
- Toast "Next number set" with detail the full number ("MED-90003-80008_120-A").
- Errors: failure toast "Couldn't set the next number." + reason; the dialog stays open.

### 2.3 Set for a Matter

Same dialog, matter picker first. Choosing a matter loads its counter (current next) and prefills the field; while loading the field is disabled with the placeholder "Loading...". A matter that has no counter yet shows 1.

---

## 3. The number on assets

### 3.1 New Asset form (`/assets/new`, matter page "New Asset")

Only when the chosen Asset Type is numbered. Directly under Asset Type and above Display Name:
- Label **Asset Number**, read-only plain text: the muted word "Assigned on save" (no input, no border, D-35).
- Help (13 muted): "Format: MED-90003-80008_###-A. Use it as the folder name on the share." It is the type's pattern with the chosen matter's client number and matter number filled in and the counter shown as its `#` characters (the minimum width). Before a matter is chosen the pattern is shown as written ("Format: MED-{client number}-{matter number}_###-A").
- Not shown for types without numbering (no empty row).
- After Save the asset opens on its record page; the toast "Asset created" gets the detail "Asset Number MED-90003-80008_004-A".

### 3.2 Edit Asset

Label **Asset Number**, read-only text in mono with the shared **Copy button** (`mf-copy-button`, label "asset number") beside it, help "Assigned when the asset was created. It can't be changed." An asset of a numbered type with no number shows the muted words "Not assigned" and a text button **Assign Number** (needs `Asset.Edit`); it calls the backend, then shows the number and the toast "Asset number assigned". Edit never changes an existing number; the asset type is locked on edit already (the number would not follow a type change).

### 3.3 Asset record page (`/assets/:id`)

Details card, first row, before Matter: `mfDetailField` label **Asset Number**: mono value + `mf-copy-button` (label "asset number", tooltip "Copy Asset Number", the shared check-mark state and the status line for screen readers). Not assigned: muted "Not assigned" and the `Assign Number` text button as above. Hidden entirely for a type without numbering. The page header (name, crumb) is unchanged; the number is not repeated there.

### 3.4 Assets list (`/assets`) and Matter > Assets tab

New column **Asset Number** after Name and before CM Number (key `assetNumber`, sort `assetNumber`, tooltip = the full text), mono 13 px, **168 px** at 1366 and 1920 (min 120, max 480 by resize; "Fit to Content" in the header menu works as everywhere), one line with ellipsis and the full number as tooltip (D-45). 168 px holds 18 mono characters (the default pattern's `90003-80008_001` is 15; `MED-90003-80008_001-A` is 21 and is cut with an ellipsis at the default width). A pattern is free text, so no fixed width can hold every output: the default is chosen for the common case, the tooltip carries the rest, and a person who needs the whole text widens the column once (the width is stored). No width is derived from the longest number (the heading and the columns must not move between loading and rows, D-42). Cell content: the number; muted "Not assigned" for an asset of a numbered type without a number; empty for a type without numbering. No Copy button in the list (the number is selectable text and a Copy sits on the record page).

Default visibility and fit (D-43a, D-44k): the column and its Columns chooser entry exist only when at least one active asset type has numbering on (known from the asset types the list already loads for its Type filter). When it exists it is in the default set and **External Reference becomes off by default** (still one click away in Columns). Default columns at 1366 then: select 24, Type 128, Name at least 200, Asset Number 168, CM Number 123, Size 105, Linked Tasks 137, Disposition 162, actions 48 = 1095 <= 1098, so the default still holds under D-43a with 3 px to spare (168 is the largest width that keeps it; 176 would overflow by 5 px and 152 is too narrow for common patterns). People with stored column choices keep them. Sorting by Asset Number orders by matter, then by the numeric counter (not by text: `_1000` after `_999`). A filter by Asset Number is the shared text filter (contains) in the filter row. The Matter > Assets tab uses the same column rule (no CM Number column there, so the column follows Name).

### 3.5 Other places

- **Task > Assets panel** (`task-asset-links.ts`): the meta line under the asset name becomes "<Type Name> - <Asset Number>" when the asset has a number (mono for the number).
- **Asset picker** (`asset-picker.ts`, `detail` text): "<Type Name> - <Asset Number>" when present.
- **Global search** (`search-meta.ts`): an asset hit's second line is type, then the asset number when present, then matter number and name; the box finds an asset by typing its number (backend: index the number).
- **Asset Reports** (builder and CSV): Asset Number is one more selectable field and column, plain text, empty when none.
- **Linked Tasks tab** on the asset record: the tab lists tasks, so it shows no number; the number is in the Details card above.
- **Types without numbering**: no Asset Number anywhere; nothing else changes.

---

## 4. States and widening

| Where | Situation | Look and wording |
|---|---|---|
| Numbering tab | loading | skeleton card |
| Numbering tab | error | `mf-state-block`: "Couldn't load numbering." + `Retry` |
| Next Numbers | loading | skeleton rows (shared record grid skeleton) |
| Next Numbers | no counters | "No matter has a counter yet." second line "Use Set for a Matter to continue after folders that already exist on the share." + `Set for a Matter` |
| Next Numbers | search finds nothing | "No results for "<text>"." + `Clear Search` |
| Next Numbers | error | "Couldn't load the numbers." + `Retry` |
| Next Numbers | numbering off, never on | card not shown |
| Asset form | numbering lookups fail | the field shows "Assigned on save" anyway (nothing is read to show it) |

**Widening.** The `#` count in the counter token is the minimum width: with `{###}` 999 is followed by 1000 and 1000 by 1001 (never cut, never an error). Example, Highest Used, Next Number, the column tooltip, the form hint and Copy always carry the full text. Sort and "Highest Used" use the numeric counter.

---

## 5. Wording table

| Place | Text |
|---|---|
| Tab | Numbering |
| Card titles | Automatic Numbering; Next Numbers |
| Switch | Number Assets Automatically |
| Switch help | Each new asset of this type gets a number when it is saved. The number can't be changed afterwards. |
| Fields | Pattern (required); Insert (Client Number, Matter Number, Counter); Counter; Example; Matter (required); Next Number (required) |
| Counter text | Restarts at 1 for each matter. The number of # characters is the minimum width: {###} gives 001, {####} gives 0001. |
| Pattern help | Text outside braces is used as written. Use one counter, for example {###} for 001, 002, and {client number} or {matter number} so each matter gets its own names. |
| Format change help | Assets that already have a number keep it. A new pattern applies to new assets only. |
| Example captions | Sample matter 90003-80008. / Based on matter 90003-80008 (its next number). / Fix the pattern to see an example. |
| Insert buttons | Insert (label), Client Number, Matter Number, Counter; tooltips "Insert {client number}", "Insert {matter number}", "Insert {###}", "The pattern already has a counter." |
| Pattern errors | PATTERN_FORBIDDEN_CHAR The pattern can't contain \ / : * ? " < > \| or control characters. / PATTERN_UNKNOWN_TOKEN "<text>" isn't a token. Use {client number}, {matter number} or {###}. / PATTERN_EDGE_SPACE The pattern can't start or end with a space, or end with a dot. / PATTERN_TOO_LONG The pattern must be 100 characters or fewer. / PATTERN_NO_COUNTER Add a counter, for example {###}. / PATTERN_TWO_COUNTERS Use only one counter. / PATTERN_COUNTER_WIDTH The counter must have 1 to 9 # characters. / PATTERN_NO_MATTER_OR_CLIENT Add {client number} or {matter number}. Otherwise two matters get the same name. |
| Old assets line | 12 existing assets of this type have no number. They stay without one until you open them and choose Assign Number. |
| Buttons | Save Numbering, Turn Off Numbering, Set for a Matter, Set Next Number, Assign Number, Cancel, Retry, Clear Search |
| Turn off | Turn Off Numbering / New assets of <Type Name> will no longer get a number. Numbers already assigned stay and are never used again, also if you turn numbering back on. |
| Set next number confirm | The next asset of <Type Name> in <CM Number> will be numbered <number>. The numbers in between are never used. This can't be undone. |
| Skipped range | Numbers 008 to 119 will never be used. |
| Validation | Enter the next number. / Next Number must be a whole number. / The next number can't be lower than 8, the number the next asset gets now. / Enter 999999 or less. / The next number is now 9 or more. Enter a higher number. |
| Toasts | Numbering saved; Numbering turned off; Next number set (detail the number); Asset number assigned; Asset created (detail "Asset Number MED-90003-80008_004-A"); failures "Couldn't save numbering." / "Couldn't set the next number." / "Couldn't assign a number." |
| Asset form | Asset Number / Assigned on save / Format: MED-90003-80008_###-A. Use it as the folder name on the share. |
| Edit and record | Asset Number / Assigned when the asset was created. It can't be changed. / Not assigned |
| Column | Asset Number |
| Copy | Copy Asset Number (tooltip), accessible name "Copy asset number" |
| Read-only type | Reactivate this asset type to change numbering. |
| Empty and errors | see section 4 |

---

## 6. Components

**Reused, unchanged:** `mf-tabs`, `mf-details-card`, `mf-dropdown` (`field`, `fill` where it should fill), shared checkbox, `mf-text-field`, `mf-entity-picker`, `mf-record-grid` + `RecordGridState`, `mf-pager`, `mf-list-toolbar` (search), `mf-matter-ref`, `mf-copy-button`, `mfDetailField`, `mf-form-dialog`, `mf-confirm-dialog`, `mf-state-block`, `.pg-banner`, `NotificationService` toasts, `mfInt`, `mf-btn--text`, the page's stale banner.

**New, feature folder only (`features/admin/asset-types`):** `asset-numbering-tab` (the two cards), `asset-pattern-field` (the Pattern text field with the three Insert buttons; caret insertion through the native `selectionStart`/`setRangeText`, no new shared component: if another form needs token buttons later it is promoted to `shared/ui`), `pattern-rules.ts` (pure functions `validatePattern` and `renderPattern`, tested against `contracts/asset-numbering/pattern-vectors.json`; also used by the Next Numbers dialog and the New Asset hint), `next-numbers-dialog`. One new tab icon entry (`numbering` in `tab-icons.ts`). **No new shared component, no new token.** The Insert buttons are the shared secondary `mf-btn`, not filter chips.

---

## 7. What the backend must supply

| Need | For |
|---|---|
| Asset type read/write: `numbering {enabled, pattern, scope: 'matter'}`, `numberedCount`, `unnumberedCount`, `example {clientNumber, matterNumber, nextCounter, isSample}` (the real latest numbered matter with its next counter, or the sample 90003 / 80008 / 1 with `isSample` true); errors as problem details with the stable codes `PATTERN_NO_COUNTER`, `PATTERN_TWO_COUNTERS`, `PATTERN_UNKNOWN_TOKEN` (the offending text in the detail), `PATTERN_FORBIDDEN_CHAR`, `PATTERN_EDGE_SPACE`, `PATTERN_TOO_LONG`, `PATTERN_COUNTER_WIDTH`, `PATTERN_NO_MATTER_OR_CLIENT`; `contracts/asset-numbering/pattern-vectors.json` shared by both sides | section 1 |
| Asset read model: `assetNumber` (text or null) and `assetNumberCounter` (int, for sorting); create returns it; list/search sort and filter by it; `GET` assets of a matter include it | sections 3, 4 |
| `GET /asset-types/{id}/numbering/counters?search&page&pageSize` -> rows `{matterId, matterRef, matterName, numberedAssets, highestUsed, nextNumber}` | section 2.1 |
| `GET /asset-types/{id}/numbering/counters/{matterId}` -> `{nextCounter}` (1 when none) | section 2.3 |
| `PUT /asset-types/{id}/numbering/counters/{matterId}` `{nextCounter}`; 422 `NEXT_NUMBER_TOO_LOW` with the current minimum; atomic with creates; never lowers | section 2.2 |
| `POST /assets/{id}/assign-number` (Asset.Edit; 409 when it already has one; 422 when the type has no numbering) | section 3.2 |
| Search index contains the asset number | section 3.5 |
| Permissions: AssetType.Manage for settings and counters, Asset.Edit for Assign Number, Asset.View to read the number; no new permission code | all |

OpenAPI contract and the generated client move in the same change (CI checks drift).

---

## 8. Acceptance

- The Numbering tab exists after Fields; turning numbering on shows Pattern (default `{client number}-{matter number}_{###}`), the three Insert buttons (insert at the caret, Counter disabled with one already), Counter and Example; the Example follows the pattern with a sample or the real matter and says which; every rule of section 1.2a shows its exact message one at a time and disables Save Numbering; the same results as the vectors file; turning off asks the confirm; success and failure toasts as in section 5.
- Next Numbers grid with the five columns at the widths of 2.1 at 1366 and 1920 (no sideways scroll), search, pager, row button, Set for a Matter; the dialog enforces the rule of 2.2 with the exact messages and the confirm when the counter is raised.
- New Asset shows "Assigned on save" and the format only for numbered types; Edit and the record page show the number read-only with Copy; unnumbered assets of a numbered type show "Not assigned" with Assign Number.
- The Assets list and Matter > Assets show the Asset Number column at 152 px when a numbered type exists, External Reference off by default then, the default set fits 1098 px; sort is numeric by counter.
- Task > Assets, the asset picker and search show the number; types without numbering show nothing new.
- 1000 follows 999 everywhere without cut text.
- No shortcut added; no native select; Title Case; desktop 1366 and 1920 checked.

---

## 9. Owner decisions needed

| # | Question | Recommendation |
|---|---|---|
| N1 | **Decided (2026-11-07): Asset Number.** | Done; the help text says it is the folder name. |
| N2 | An old asset of a numbered type gets its number only by the explicit **Assign Number** button (not silently when edited). | Yes. |
| N3 | The next number can only be raised, never lowered (the minimum is the current next number). | Yes. |
| N4 | In the Assets list the Asset Number column is default only when a numbered type exists, and External Reference then moves to "off by default". | Yes (the default set must fit 1366, D-43a). |
| N5 | Search finds assets by their number. | Yes (the number is what people paste from the share). |
| N6 | **Decided by the owner (2026-11-07):** a free-text Pattern with the three tokens and the guardrails of section 1.2a (no dropdowns). Per client or global counter scope stays out for now. | Done. |
| N7 | Column default: the Asset Number column is 168 px and clips longer patterns with a tooltip (a person widens it once). A fixed width cannot hold every pattern; 168 px is the most that keeps the default Assets columns inside 1366 (1095 of 1098 px). | Yes. |
