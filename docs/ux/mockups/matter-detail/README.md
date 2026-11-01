# Matter detail page redesign: mockups (WPx)

Clickable, self-contained HTML mockups. Mock data, no build, no network, no product code. Open by double-clicking.

| File | What |
| --- | --- |
| `index.html` | The redesign. **Recommended layout**: 8 tabs; production specs are a "Specs" sub-view inside Productions |
| `alt-specs-own-tab.html` | The same page with **Specs as its own (9th) tab**, full control like Assets |
| `productions-research.md` | Short research note: how law firms manage productions, what the spec holds, what the mockup models |
| `screenshots/NN-name-1366.png`, `-375.png` | Every tab and demo at 1366x768 and the 375x812 phone check (54 images) |
| `screenshots.cjs`, `contrast-check.cjs` | The one-launch Playwright screenshot script and the contrast check (derived from `../notes-mockup-r3-contrast.js`) |

Deep links: `index.html#tab=notes`, `#tab=prods&pv=specs`, `#tab=notes&ai=no` (AI disabled), `#tab=notes&ai=company&warn=1` (AI warning on save). The same `#tab=` works in the alternative file (`#tab=specs`).

## What to click

The small dashed **Mockup** button in the top bar switches: *AI allowed* (No / On-prem AI only / Company-approved AI services), *Has Matter.Edit* (shows or hides the pencils), and *Preview AI warning on save*.

1. **Summary**: pencil on any field (side panel with that one field), **Edit all** (side panel with every field), the tiles under "Assets by type" (open Assets filtered by type). Header **More actions > Set inactive** shows the centred confirmation (blocked here because of open tasks, as in today's app).
2. **Tasks**: the six view chips (Open, Overdue, Due soon, ASAP, Unassigned, On hold), the dropdowns, tick two tasks and press **Link to project**, or click the **Project** cell of a row to link one task.
3. **Projects**: **New project** (side panel, the page does not change, optional "link existing tasks"), click a row for the project panel, **Link tasks**.
4. **Calendar**: month grid, **Shows** dropdown, a day opens a small list, **Add event** (side panel).
5. **Assets**: type chips, search, disposition dropdown, a row opens the asset panel, **New asset**.
6. **Productions**: direction chips, status dropdown, a row opens the production panel (Details, Comments, History), **New production** (live Bates preview), the **Specs** sub-view (list, New spec, edit, duplicate, retire/delete). In `alt-specs-own-tab.html` Specs is the next tab.
7. **Notes**: **Try the slash menu** (or type `/` in the note): `/asset`, `/assets`, `/mention`, `/project`, `/matter`, `/note` (pick a note and it appears inline in a blue frame). `@` and `#` also work. Side rail: Tags, Details and history, AI. The AI button in the list ("Find") and in the editor ("Write with AI") open the "coming soon" panel; with AI = No they say "AI can't be used on this matter". **Save** with the AI warning preview on shows the confirmation dialog (Edit / Save anyway).
8. **Activities**: kind chips, "new since your last visit", numeric dates.

## Decisions I made, and why

Defaults confirmed by the owner (2026-11-01): Summary editing = per-field pencil plus **Edit all**, both in the standard right side panel; side panel for all create and edit, **centred dialog only for confirmations**; the AI setting is editable by `Matter.Edit` holders, default **No**; **Specs live under Productions** (the alternative is mocked for comparison).

**AI check on save (owner decision, replaces my earlier banner idea).** When the AI check finds a conflict with company policy or the matter's specs, a **centred confirmation dialog** lists the reasons and offers two choices: **Edit** (back to the note) and **Save anyway**. The user decides. The check itself is "coming soon" in release 1, so the dialog is a preview you trigger with the mockup toggle. Audit implication: when a user saves after a warning, the note History and the audit log record "Saved after an AI warning (user chose Save anyway)", with the reasons shown. When AI allowed = No, no check runs and no dialog appears. A quiet "AI policy check on save: coming soon" label sits under the editor in release 1.

Other decisions:

- **Side panel is the app-wide pattern.** One shared panel: header with title and close, scrolling body, footer with **Cancel on the left and the primary action on the right** (matches the dialog rule in the theme guide), Esc and the scrim close it, focus goes to the first field and returns to the trigger, Tab stays inside. The page behind never changes (this is what the Projects "New project" requirement asks for). Width 480 px, 600 px for the larger forms (production, spec, edit all), full width on a phone. Centred dialogs remain only for confirmations (set inactive, retire spec, AI warning).
- **Title line.** `{Client} > {Matter name}` as the page title (22 px, record-page size), and the matter name once more below it as a second line. I kept it because the title can be cut on a phone and the second line holds the full name. See open question 1.
- **Summary.** One list of fields in a grid of equal tiles: client, matter number, name, status, sensitive, both managers, **AI allowed**, then every custom field, then created and last changed. No "Custom fields" heading. Locked fields (client, number, created, changed) show a small lock and no pencil. Status is changed only through Set inactive / Set active because of the open-task rule. The right column keeps the useful context: project managers (Change), the next four calendar events, the last four activities. The six task buttons are gone from Summary; they live on the Tasks tab as view chips. One overdue indicator stays next to the matter title (it opens the Tasks tab on Overdue); say if you want it removed too (question 5).
- **Assets by type.** Tiles with a count per asset type plus a total; each tile opens Assets filtered to the type. In the build the types are the admin's Asset types, not the six invented here.
- **Tasks.** My Matters grid frame (header, chips, filters and pager stay put, only the rows scroll), task-type icon chips, status chip with steps, numeric due dates, the **Project column is a dropdown** so linking one task takes two clicks. Bulk selection adds **Link to project**.
- **One project per task** is enforced in the UI wording: linking a task that is in another project says "Moves from ...". The task already has an optional project in today's app (the Tasks grid has a Project column and filter), so this is mostly UI plus a bulk endpoint (see below).
- **Calendar** reuses the My Matters month grid, event types, legend and "Shows" dropdown, scoped to this matter. Add event uses the side panel (My Matters uses a dialog today; it should follow the new standard when touched).
- **Productions.** One grid (production with volume, direction and party, Bates range, docs and pages, spec, status, delivered or due date). The detail panel has Details, Comments and History; Edit swaps to the form in the same panel. Status set (Draft, In QC, Ready to deliver, Delivered, Acknowledged, Received, Clawback requested) is my proposal.
- **Specs under Productions (recommended).** A matter has few specs (1 to 4) and a spec is only meaningful with the productions that use it, so a sub-view keeps the tab bar at 8 tabs (at 1366 px a ninth tab already scrolls, see `screenshots/24-alt-specs-tab-1366.png`), lets "New production" offer the spec picker with "create a new spec" in context, and keeps spec permissions close to production permissions. The sub-view still has full list, create, edit, duplicate, retire/delete, used-by and status chips, so nothing is lost. **Choose the own tab instead if** specs will be numerous or independently owned (several protocols per case, an approval workflow, a different team editing specs), because then they need their own filters, counts and permission story.
- **Notes.** Title is the first line of the content: large heading with the placeholder "Untitled note" and a small "TITLE" hint above it. Tags moved into a side rail panel (Tags, Details and history, AI) so the writing area has the full height. `/note` embeds the chosen note inline in a blue frame with an "Open note" button, so it is visibly a linked note.
- **AI.** A field on the matter (No / On-prem AI only / Company-approved AI services); the system picks the tool from it. The AI button is violet with a "soon" tag when allowed, grey and `aria-disabled` when No; pressing it shows "AI can't be used on this matter". In release 1 the panel only says "AI assistant is coming soon". The matter header shows the current value as a chip.
- **Activities.** The My Matters feed grid with kind chips (adds Productions, Notes, Matter edits), "new since your last visit", who/what/object columns and icons.
- **Dates** follow the My Matters rule: `MM/DD`, `MM/DD hh:mm AM/PM`, `MM/DD/YYYY` for another year. Mock "today" is 11/01/2026.

### Rules from the theme guide, and how the mockup follows them

- Tokens only: the page reuses the approved My Matters CSS (copied inline so it opens standalone); no new colours, no thick coloured left borders; colour is never the only signal (icons and words on every chip).
- **Dropdowns:** every choice or filter control (Project, Priority, Assignee, Status, Disposition, tag, Shows, row Project) is the `mf-dropdown` look. Data-entry selects inside forms stay native, as section 7.5 says.
- **Fixed page:** header, tabs, filters and pager stay put; only the rows scroll (grid in a frame that reaches the bottom gutter). Below 768 x 561 the page scrolls and rows become cards (see the 375 screenshots).
- **No new shortcuts (#420).** `/`, `@`, `#` are typing triggers inside the editor, and arrow keys, Enter and Esc inside a menu are widget keys, not application shortcuts. Nothing is added to `shortcut-registry.ts`.
- Contrast: `contrast-check.cjs`, 27 states at 1366x768 and at 375x812 (54 combinations), **0 failures** at 4.5:1 (3:1 large text).

## Existing functions kept (from `matter-detail-page.ts`, `scoped-tasks.ts`, `matter-projects.ts`, `matter-assets.ts`)

- Header: matter number with copy button, Active and Sensitive badges, client link, project manager line with Change / Add, inactive and client-inactive banners (still to be drawn in the build; unchanged), **Edit**, **Create task**, **New project**, **New asset**, **Bulk re-assign / re-prioritise**, **Add comment**, **Open the matter's tasks**, **Set inactive / Set active** with the open-task block and its "View open tasks" action, Activity (now a tab instead of a drawer; the `?tab=activity` link keeps working by mapping to the tab).
- Summary: custom fields rendered from the matter's form version (all of them, no separate block), created and last-changed dates, the managers, links from counts to lists.
- Tasks: Title or Ref search, Project, Priority, Assignee, Due and Status column filters (Status starts on the open statuses), the six summary views, paging, selection mode with bulk actions, Columns menu, Create task prefilled with the matter, the narrow-screen filter sheet.
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
| Summary | 10 to 12 | Field grid, per-field and Edit all panels, AiAllowed field and API, assets-by-type endpoint |
| Tasks | 8 to 10 | Restyle on My Matters grid, chips moved from Summary, project dropdown, bulk link |
| Projects | 8 to 10 | Side panel create, project panel, link tasks endpoint and UI |
| Calendar | 4 to 5 | Reuse the My Matters component scoped to a matter, side panel for Add event |
| Assets | 6 to 8 | Restyle, type chips, asset panel and form in the side panel |
| Productions (without specs) | 28 to 34 | New module, 4 tables, API, grid, detail panel with comments and history, form with Bates preview and overlap check |
| Specs (under Productions) | 14 to 18 | Entity, API, grid, big form, duplicate, retire rule, snapshot at delivery. The own-tab alternative adds 3 to 4 hours |
| Notes | 28 to 36 | Note module, rich text editor with slash, mention and link chips, inline linked notes, tag rail, list, history, AI button states and the "coming soon" panel, save-time warning dialog stub |
| Activities | 5 to 6 | New kinds, grid, unread state |
| Cross-cutting: permissions, OpenAPI, nswag, a11y and e2e, docs | 10 to 12 | |
| **Total** | **about 130 to 160** | Productions plus Notes are about half |

Estimate for this mockup round: about 7 agent-hours (research, one shared source built into two files, screenshots, contrast check, review fixes).

## Open questions for the owner

1. **Title and matter name.** I show `Client > Matter name` as the title and the matter name again on the second line. Did you mean the second line to show something else (matter number and name, a description), or should the title drop the matter name?
2. **Slash commands `/asset` and `/assets`.** I read `/asset` as "link one asset" (same as `#`) and `/assets` as "insert a list of several assets you pick". Is that what you meant, or should `/assets` insert the matter's assets by type?
3. **Specs placement.** Recommended: under Productions. Open `alt-specs-own-tab.html` to compare. Will specs ever be shared across matters or owned by a different team?
4. **Production statuses and QC items** are proposals. Which statuses does the firm actually use? Should Bates ranges be checked for overlap (recommended)?
5. **Overdue indicator in the header.** Kept as one small red chip that opens Tasks on Overdue. Remove it for a pure "no task numbers outside Tasks" Summary?
6. **Matter status in the edit panel.** Shown read-only with a pointer to Set inactive, because of the open-task rule. OK?
7. **AI "No" and existing notes.** Notes stay readable and editable without AI; only the AI buttons and the save check are off. Confirm.
8. **Received productions** have no spec ("not applicable"). Do you want a free-text "format received" instead?
9. **Calendar Add event** moves to the side panel; My Matters still uses a dialog. Convert My Matters too when it is next touched?
10. **Notes in the list** are sorted by last updated; is a "by tag" grouping (as in the earlier Notes mockup) still wanted?

## Notes for the reviewer

- `index.html` and `alt-specs-own-tab.html` are generated from one source (the alternative only changes the tab list and where the Specs list is shown); each file is self-contained.
- Mock data is invented (Northwind Logistics, Harbor Freight, Atlas Cloud, names). No real client data.
- The `Mockup` button and the dashed pill are review tools, not product UI.
