# Matter detail page redesign: mockups (WPx)

Clickable, self-contained HTML mockups. Mock data, no build, no network, no product code. Open by double-clicking.

| File | What |
| --- | --- |
| `index.html` | The redesign (round 2). **Recommended layout**: 7 tabs; production specs are a "Specs" sub-view inside Productions |
| `alt-specs-own-tab.html` | The same page with **Specs as its own (8th) tab**, full control like Assets |
| `productions-research.md` | Short research note: how law firms manage productions, what the spec holds, what the mockup models |
| `screenshots/NN-name-1366.png`, `-375.png` | Every tab and demo at 1366x768 and the 375x812 phone check (66 images) |
| `screenshots.cjs`, `contrast-check.cjs` | The one-launch Playwright screenshot script and the contrast check (derived from `../notes-mockup-r3-contrast.js`) |

## Round 2 (owner feedback, applied)

1. **Summary**: no boxes per field and no pencils. Assets by type is at the top (six tiles), then "Matter details" as a plain two-column list (label and value, hairline rows), with one **Edit** button that opens the standard side panel with the full form.
2. **Fixed screen**: on desktop the page itself never scrolls (verified: the content area is exactly the window height on every tab). Scrolling happens inside the component: the Summary content area, the grid body, the notes list and the note editor. Below 768 x 561 the page scrolls and rows become cards.
3. **Tasks**: one **View** dropdown (Open, Overdue, Due soon, ASAP, Unassigned, On hold, each with its count) replaces the six chips; one tidy filter row (search, View, Project, Priority, Assignee, Status).
4. **Calendar tab removed** (it duplicated My Matters), so there are **seven tabs**. Summary keeps a "Next on the calendar" panel with **Add event** (side panel) and **Open in My Matters calendar** (preselects this matter). See the dependency note below.
5. **Assets**: a **Type** dropdown with counts in the options replaces the chips.
6. **Productions**: **Direction** and **Status** dropdowns replace the chips; the Productions / Specs switch stays.
7. **Notes**: a resizable **splitter** between list and editor, and the **full toolbar** of the earlier Notes mockup (Paragraph style dropdown, Bold, Italic, Underline, bullets, numbers, quote, link, table, @, #, clear formatting, undo, redo) with a table picker and a table tools bar.
8. PM review fixes: shorter header (matter number in the breadcrumb, no repeated name line, case number and court as a subtle subtitle, no Create task button in the header, no overdue chip); Tasks without clipped Status and with a two-line Due; Projects open a side panel with their linked tasks (**Add task**, **Unlink**); Productions with direction and party in one cell with an icon and no clipped columns at 1366; Notes title hint only while the title is empty, tags as chips under the title plus the side panel, and the slash-menu button only in the Mockup toolbox; Activities with one What cell (object link at the end) and newest first.

**Calendar dependency (issue #976).** The "Open in My Matters calendar" link only works for people who can open My Matters. Users who can see a matter but cannot open My Matters (issue #976) would get a dead link. Suggested handling for the build: hide the link for them (the Next on the calendar list and Add event still work), or let that link open a read-only calendar of this matter. Please decide when #976 is planned.

Deep links: `index.html#tab=notes`, `#tab=prods&pv=specs`, `#tab=notes&ai=no` (AI disabled), `#tab=notes&ai=company&warn=1` (AI warning on save). The same `#tab=` works in the alternative file (`#tab=specs`).

## What to click

The small dashed **Mockup** button in the top bar switches: *AI allowed* (No / On-prem AI only / Company-approved AI services), *Has Matter.Edit* (shows or hides the Edit button), *Preview AI warning on save*, and has **Open the slash menu in the note**.

1. **Summary**: **Edit** (side panel, full form), the asset tiles (open Assets filtered by type), **Add event** (side panel), **Open in My Matters calendar** (toast in the mockup). More actions > Set inactive shows the centred confirmation (blocked here because of open tasks, as in today's app).
2. **Tasks**: the **View** dropdown, the other filters, tick two tasks and press **Link to project**, or click the **Project** cell of a row.
3. **Projects**: **New project** (side panel, page unchanged, optional "link existing tasks"); click a project row for the panel with its linked tasks (**Add task**, **Unlink**).
4. **Assets**: **Type** dropdown, search, **Disposition**, a row opens the asset panel, **New asset**.
5. **Productions**: **Direction** and **Status** dropdowns, a row opens the production panel (Details, Comments, History), **New production** (live Bates preview), the **Specs** sub-view (list, New spec, edit, duplicate, retire/delete). In `alt-specs-own-tab.html` Specs is the next tab.
6. **Notes**: drag the splitter, or focus it and use the arrow keys (Shift for bigger steps, Home and End for the limits); the width is remembered. The table button opens a rows-by-columns picker; click inside a table to get the Table bar (+ Row, - Row, + Col, - Col, Header row, Delete table). Type `/` (or use the Mockup toolbox): `/asset`, `/assets`, `/mention`, `/project`, `/matter`, `/note`; `@` and `#` also work. Side rail: Tags, Details and history, AI. AI buttons open the "coming soon" panel, or say "AI can't be used on this matter" when AI is No. **Save** with the AI warning preview on shows the confirmation dialog (Edit / Save anyway).
7. **Activities**: the Kind dropdown, "new since your last visit", numeric dates, newest first.

## Decisions I made, and why

Defaults confirmed by the owner (2026-11-01): Summary editing = one **Edit** button opening the standard right side panel with the full form (round 2 replaced the per-field pencils); side panel for all create and edit, **centred dialog only for confirmations**; the AI setting is editable by `Matter.Edit` holders, default **No**; **Specs live under Productions** (the alternative is mocked for comparison).

**AI check on save (owner decision, replaces my earlier banner idea).** When the AI check finds a conflict with company policy or the matter's specs, a **centred confirmation dialog** lists the reasons and offers two choices: **Edit** (back to the note) and **Save anyway**. The user decides. The check itself is "coming soon" in release 1, so the dialog is a preview you trigger with the mockup toggle. Audit implication: when a user saves after a warning, the note History and the audit log record "Saved after an AI warning (user chose Save anyway)", with the reasons shown. When AI allowed = No, no check runs and no dialog appears. A quiet "AI policy check on save: coming soon" label sits under the editor in release 1.

Other decisions:

- **Side panel is the app-wide pattern.** One shared panel: header with title and close, scrolling body, footer with **Cancel on the left and the primary action on the right** (matches the dialog rule in the theme guide), Esc and the scrim close it, focus goes to the first field and returns to the trigger, Tab stays inside. The page behind never changes (this is what the Projects "New project" requirement asks for). Width 480 px, 600 px for the larger forms (production, spec, edit all), full width on a phone. Centred dialogs remain only for confirmations (set inactive, retire spec, AI warning).
- **Header.** Breadcrumb `Matters > M-2026-0147` (with the copy button), the title `{Client} > {Matter name}`, and one subtle line under it with the case number and court plus the Active, Sensitive and AI chips. The only buttons are **New** (menu: Task, Project, Asset, Production, Spec, Note, Event) and More actions. There is no number of tasks anywhere outside the Tasks tab.
- **Summary.** Assets by type first, then the details as one plain list in the order: client, matter number, name, status, sensitive, both managers, **AI allowed**, every custom field, created, last changed. No heading for custom fields. One **Edit** button opens the full form in the side panel (client, number, created and last changed are not editable; status is changed only through Set inactive / Set active because of the open-task rule). The right column has the project managers (Change opens the same Edit panel), Next on the calendar with Add event, and Recent activity.
- **Assets by type.** Six tiles with a count per asset type at the top of Summary; each tile opens Assets filtered to the type. In the build the types are the admin's Asset types, not the six invented here.
- **Tasks.** My Matters grid frame (header, filters and pager stay put, only the rows scroll), coloured task-type chips with the ref under the title, status chip with steps (not clipped at 1366), a two-line Due (words such as "3 days overdue" or "Tomorrow" above the numeric date and time), and the **Project column as a dropdown** so linking one task takes two clicks. Bulk selection adds **Link to project**.
- **One project per task** is enforced in the UI wording: linking a task that is in another project says "Moves from ...". The task already has an optional project in today's app (the Tasks grid has a Project column and filter), so this is mostly UI plus a bulk endpoint (see below).
- **Calendar** is no longer a tab (it duplicated My Matters). Summary keeps the next four events, an **Add event** button (side panel) and the link into My Matters.
- **Productions.** One grid (production with volume, direction and party, Bates range, docs and pages, spec, status, delivered or due date). The detail panel has Details, Comments and History; Edit swaps to the form in the same panel. Status set (Draft, In QC, Ready to deliver, Delivered, Acknowledged, Received, Clawback requested) is my proposal.
- **Specs under Productions (recommended).** A matter has few specs (1 to 4) and a spec is only meaningful with the productions that use it, so a sub-view keeps the tab bar at 7 tabs (an eighth tab still fits at 1366 px, see `screenshots/30-alt-specs-tab-1366.png`, but the tab bar gets crowded on a tablet and a phone), lets "New production" offer the spec picker with "create a new spec" in context, and keeps spec permissions close to production permissions. The sub-view still has full list, create, edit, duplicate, retire/delete, used-by and status chips, so nothing is lost. **Choose the own tab instead if** specs will be numerous or independently owned (several protocols per case, an approval workflow, a different team editing specs), because then they need their own filters, counts and permission story.
- **Notes.** Title is the first line of the content: large heading; the placeholder "Untitled note" and a small "TITLE" hint show only while the title line is empty. Tags show as chips under the title and are edited in the side rail panel (Tags, Details and history, AI), so the writing area has the full height. The list/editor **splitter** (220 to 520 px, default 340) works with mouse, touch and keyboard (`role=separator`, `aria-valuenow`). The toolbar has every control of the earlier Notes mockup; the table button opens a 6 x 8 picker (header-row option) and a Table bar appears when the caret is in a table. `/note` embeds the chosen note inline in a blue frame with an "Open note" button, so it is visibly a linked note.
- **AI.** A field on the matter (No / On-prem AI only / Company-approved AI services); the system picks the tool from it. The AI button is violet with a "soon" tag when allowed, grey and `aria-disabled` when No; pressing it shows "AI can't be used on this matter". In release 1 the panel only says "AI assistant is coming soon". The matter header shows the current value as a chip.
- **Activities.** The My Matters feed grid: When, Who and one What cell (kind chip, text, object link at the end), a Kind dropdown (adds Productions, Notes, Matter edits), "new since your last visit", newest first.
- **Dates** follow the My Matters rule: `MM/DD`, `MM/DD hh:mm AM/PM`, `MM/DD/YYYY` for another year. Mock "today" is 11/01/2026.

### Rules from the theme guide, and how the mockup follows them

- Tokens only: the page reuses the approved My Matters CSS (copied inline so it opens standalone); no new colours, no thick coloured left borders; colour is never the only signal (icons and words on every chip).
- **Dropdowns:** every choice or filter control (View, Project, Priority, Assignee, Status, Type, Disposition, Direction, Kind, tag, paragraph style, row Project) is the `mf-dropdown` look. Data-entry selects inside forms stay native, as section 7.5 says.
- **Fixed page:** the page never scrolls on desktop (`main` is `overflow:hidden` from 768 x 561 up); header, tabs, filters and pager stay put and only the Summary content area, the grid rows, the notes list and the note editor scroll. Below 768 x 561 the page scrolls and rows become cards (see the 375 screenshots).
- **No new shortcuts (#420).** `/`, `@`, `#` are typing triggers inside the editor, and arrow keys, Enter and Esc inside a menu are widget keys, not application shortcuts. Nothing is added to `shortcut-registry.ts`.
- Contrast: `contrast-check.cjs`, 33 states at 1366x768 and at 375x812 (66 combinations), **0 failures** at 4.5:1 (3:1 large text).

## Existing functions kept (from `matter-detail-page.ts`, `scoped-tasks.ts`, `matter-projects.ts`, `matter-assets.ts`)

- Header: matter number with copy button (now in the breadcrumb), Active and Sensitive badges, client link, project manager line with Change / Add, inactive and client-inactive banners (still to be drawn in the build; unchanged), **Edit** (now on Summary), **Create task** (now under New and on the Tasks tab), **New project**, **New asset**, **Bulk re-assign / re-prioritise**, **Add comment**, **Open the matter's tasks**, **Set inactive / Set active** with the open-task block and its "View open tasks" action, Activity (now a tab instead of a drawer; the `?tab=activity` link keeps working by mapping to the tab).
- Summary: custom fields rendered from the matter's form version (all of them, no separate block), created and last-changed dates, the managers, links from counts to lists.
- Tasks: Title or Ref search, Project, Priority, Assignee and Status filters (Status starts on the open statuses; the Due column filter is still to be drawn, it stays as today), the six summary views (now the View dropdown), paging, selection mode with bulk actions, Columns menu, Create task prefilled with the matter, the narrow-screen filter sheet.
- Projects: name and description, open and overdue counts, Active and Archived status, the collapsed Archived group, New project.
- Assets: name, type, external reference, size, disposition, linked-task count, filters by name, type, external reference and disposition, New asset.
- Permission gating stays: Projects and Assets tabs only with their View permission, Task.View for the Tasks tab, the sensitive-matter rule for every list and count.

## Backend and data model implications (for the later build)

New entities and fields. SQL scripts are numbered and immutable once merged, so each item below is a new script (fix forward); all data is demo data, so no backfill is needed.

| Item | Notes |
| --- | --- |
| `Matter.AiAllowed` | Small int, 0 = No (default), 1 = On-prem only, 2 = Company-approved. Constraint on values. Add to Matter DTOs, OpenAPI and the nswag client. Changing it writes an audit entry. Existing rows default to No. |
| `ProductionSpec` | `Id, MatterId, Name, Status (Draft/Approved/Retired), Source, ImageFormat, Colour, TextMode, NativesRule, LoadFile, MetadataFields (child table or JSON list), RedactionRule, PrivilegeRule, DedupRule, DateTimeRule, NumberingRule, EncryptionRule, RowVersion, audit columns`. Not deletable while used (Retire instead). Per matter, as requested. |
| `Production` | `Id, MatterId, Name, VolumeNo, Direction (Out/In), ProducedByType (Our company/Our client/Opposing party/Other company), ProducedByName, ProducedTo, ProductionSpecId (nullable), BatesPrefix, BatesDigits, BatesFirst, BatesLast, DocCount, PageCount, NativeCount, RedactedCount, WithheldCount, PrivilegeLogRef, Custodians, DateRangeFrom/To, Status, DueAtUtc, DeliveredAtUtc, DeliveryMethod, AcknowledgedAtUtc/By, ClawbackNote, RowVersion`. Unique and **non-overlapping** Bates range per (MatterId, BatesPrefix). Keep a **snapshot of the spec settings at delivery** (JSON column) so editing a spec later does not rewrite history. |
| `ProductionQcItem` | `ProductionId, ItemKey, IsDone, DoneBy, DoneAtUtc` (five fixed keys to start with). |
| `ProductionComment` | `Id, ProductionId, BodyText, CreatedBy, CreatedAtUtc`. |
| `ProductionHistory` | Either a table (`ProductionId, Event, Detail, By, AtUtc`) or reuse the existing audit log with a Production object type. Prefer the audit log plus a query, so History and Activities share one source. |
| Notes | `Note` (matter-owned, rich text body with the title as the first line; keep a derived `Title` column for lists), `NoteTag` link, and `NoteLink (NoteId, TargetType: Asset/Project/Matter/Note/User, TargetId)` filled from the editor chips and `/note` blocks so "linked from" and delete checks work. Note history rows include "saved after an AI warning". |
| `Task.ProjectId` | Already exists (Project column and filter today). Needed: a **bulk link endpoint** (`POST /projects/{id}/tasks` with task ids, and "set project" in the bulk dialog), a rule that the project must belong to the same matter and be active, and an audit row per task. A task belongs to at most one project, which the column already guarantees. |
| Asset counts by type | A `GET /matters/{id}/overview` addition or a small `asset-counts` endpoint (counts by type id, honouring the sensitive-matter rule). |
| AI check on save (later) | `POST /notes/check` returning a list of reasons; the client shows the dialog and sends `ackWarnings: [ids]` on save so the server can write the audit entry. Out of release 1. |
| Events | Production due dates can optionally create a calendar event of the existing "Production" type. |

Suggested permissions (for `contracts/permissions.json`, backend and frontend together): `Production.View`, `Production.Create`, `Production.Edit`, `Production.Comment`, `Production.SetStatus` (delivery, acknowledgement, clawback), `Production.Archive`; `ProductionSpec.View`, `ProductionSpec.Create`, `ProductionSpec.Edit`, `ProductionSpec.Retire`; `Note.View`, `Note.Create`, `Note.Edit`, `Note.Delete` (align with the Notes work already designed); `Matter.Edit` covers the AI setting by the owner's default (a separate `Matter.EditAi` is the alternative if only some people may change it). Tasks use `Task.Edit` and `Project.Edit` for linking. Every new list and count must follow the sensitive-matter rule.

Module boundaries: Productions and Specs should be a new module (`MatterFlow.Productions` with `.Contracts`), Notes another (`MatterFlow.Notes`), registered in `ModuleComposition.cs`; they reference only SharedKernel and other modules' Contracts (matter id, project id, asset id lookups through Contracts).

## Effort for the later build (agent-hours, rough; one agent, includes tests, OpenAPI and client regeneration, e2e smoke, a11y check)

| Tab or part | Hours | What drives it |
| --- | --- | --- |
| Shared: side panel component and standard (focus, Esc, footer rule), 9-tab strip, header | 8 to 10 | Reused by every tab; also needed to convert existing create/edit dialogs later |
| Summary | 10 to 12 | Assets-by-type tiles and endpoint, plain details list, one Edit panel, AiAllowed field and API, next-events panel with Add event |
| Tasks | 8 to 10 | Restyle on My Matters grid, View dropdown replaces the chips, project dropdown, bulk link |
| Projects | 8 to 10 | Side panel create, project panel, link tasks endpoint and UI |
| Calendar tab | 0 | Removed. The My Matters link takes a matter preselection parameter (about 1 hour, counted in Summary) |
| Assets | 6 to 8 | Restyle, Type dropdown, asset panel and form in the side panel |
| Productions (without specs) | 28 to 34 | New module, 4 tables, API, grid, detail panel with comments and history, form with Bates preview and overlap check |
| Specs (under Productions) | 14 to 18 | Entity, API, grid, big form, duplicate, retire rule, snapshot at delivery. The own-tab alternative adds 3 to 4 hours |
| Notes | 32 to 42 | Note module, rich text editor with the full toolbar and tables (insert, rows, columns, header), slash, mention and link chips, inline linked notes, splitter, tag rail and tag chips, list, history, AI button states and the "coming soon" panel, save-time warning dialog stub |
| Activities | 5 to 6 | New kinds, grid, unread state |
| Cross-cutting: permissions, OpenAPI, nswag, a11y and e2e, docs | 10 to 12 | |
| **Total** | **about 130 to 165** | Productions plus Notes are about half |

Mockup effort: about 7 agent-hours for round 1 and about 6 for round 2.

## Open questions for the owner

1. **Header subtitle.** Under the title I show the case number and court. Is that the right subtle line, or do you prefer something else (client number, practice area)?
2. **Slash commands `/asset` and `/assets`.** I read `/asset` as "link one asset" (same as `#`) and `/assets` as "insert a list of several assets you pick". Is that what you meant, or should `/assets` insert the matter's assets by type?
3. **Specs placement.** Recommended: under Productions. Open `alt-specs-own-tab.html` to compare. Will specs ever be shared across matters or owned by a different team?
4. **Production statuses and QC items** are proposals. Which statuses does the firm actually use? Should Bates ranges be checked for overlap (recommended)?
5. **Calendar link for people without My Matters access** (issue #976): hide the link, or open a read-only matter calendar?
6. **Matter status in the edit panel.** Shown read-only with a pointer to Set inactive, because of the open-task rule. OK?
7. **AI "No" and existing notes.** Notes stay readable and editable without AI; only the AI buttons and the save check are off. Confirm.
8. **Received productions** have no spec ("not applicable"). Do you want a free-text "format received" instead?
9. **Add event** uses the side panel (on Summary); My Matters still uses a dialog. Convert My Matters too when it is next touched?
10. **Notes in the list** are sorted by last updated; is a "by tag" grouping (as in the earlier Notes mockup) still wanted?

## Notes for the reviewer

- `index.html` and `alt-specs-own-tab.html` are generated from one source (the alternative only changes the tab list and where the Specs list is shown); each file is self-contained.
- Mock data is invented (Northwind Logistics, Harbor Freight, Atlas Cloud, names). No real client data.
- The `Mockup` button and the dashed pill are review tools, not product UI.
