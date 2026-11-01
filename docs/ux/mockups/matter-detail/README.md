# Matter detail page redesign: mockups (WPx)

Clickable, self-contained HTML mockup. Mock data, no build, no network, no product code. Open by double-clicking.

| File | What |
| --- | --- |
| `index.html` | The redesign (round 3): 7 tabs; production specs are a "Specs" sub-view inside Productions (confirmed by the owner) |
| `productions-research.md` | Short research note: how law firms manage productions, what a spec holds, what the mockup models and leaves out |
| `screenshots/NN-name-1366.png`, `-375.png`, `01-summary-1366x600.png` | Every tab and demo at 1366x768, the 375x812 phone check, and Summary at 1366x600 |
| `screenshots.cjs`, `contrast-check.cjs` | The one-launch Playwright screenshot script and the contrast check (derived from `../notes-mockup-r3-contrast.js`) |

`alt-specs-own-tab.html` (Specs as its own tab) was not chosen and is deleted in round 3 (it stays in the git history of rounds 1 and 2).

Deep links: `index.html#tab=notes`, `#tab=prods&pv=specs`, `#tab=notes&ai=no` (AI disabled), `#tab=notes&ai=company&warn=1` (AI warning on save).

## Round 3 decision log (owner answers, applied)

1. **Summary never scrolls the page.** On desktop the document height equals the window height on every tab (measured: scrollHeight == window height for all 7 tabs and the Specs sub-view at 1366x768, 1366x600 and 1920x1080). On Summary, the assets tiles stay pinned at the top and three areas scroll inside themselves: the **details list**, **Next on the calendar** and **Recent activity**. Below 1100 px wide the Summary scrolls inside its own area; on a phone (below 768 x 561) the page scrolls with cards.
2. **No invented Matter fields.** The Summary shows what the app already has (from `MatterResponse`): **CM number** (client-matter number, kept prominent: first row, large mono type, highlighted, and the subtitle under the page title), client, matter number, matter name, status, sensitive, primary and secondary project manager, created, last changed; then the tenant's **custom fields** as equal rows; plus the one new field **AI allowed**. Case number, court, practice area, responsible partner, opposing party and opposing counsel are removed. The four rows "Billing code", "Legal hold issued", "Discovery cutoff" and "Data volume estimate" are only **samples of custom fields** (the real ones come from the matter's form version and may have other labels and types). The UI has no "custom fields" heading.
3. **Calendar is not a tab.** The Summary panel "Next on the calendar" (with **Add event**), the link **Open in My Matters calendar** and the **Calendar event** item of the New menu show **only for project managers who have My Matters access**; for anyone else they are hidden. The Mockup toolbox has the toggle "Can open My Matters (project manager)". This also answers the issue #976 dependency: people who can see a matter but cannot open My Matters never see a dead link.
4. **Slash commands**: `/assets` is removed. Final list: `/asset`, `/mention`, `/project`, `/matter`, `/note`, plus `@` (people) and `#` (assets).
5. **Specs stay inside Productions.** The own-tab alternative file is removed.
6. **Productions are a simple managed list**: no Bates overlap check, no QC items, no status workflow column. Fields: name, volume, direction (produced by us / received), party (produced by, produced to), spec, Bates begin, Bates end, documents, pages, delivered or due date, notes. Plus **comments** and **history** (history = who changed what; editing a production writes one line per changed field). The Activities demo rows now say things like "changed Documents on the production" and "added a comment on the production".
7. **Notes have Read and Edit modes.** A note opens in **read mode** (formatted view, no cursor, no toolbar) with an explicit **Edit** button. **Edit** switches to edit mode: the toolbar appears, **Cancel (left) and Save (right)** replace Edit, and tags can be changed. **New** starts in edit mode. Cancel with changes asks "Discard your changes?" in a centred confirmation (Keep editing / Discard changes); leaving for another note does the same. **Locked** notes show a lock in the list and a "Locked by ..." chip, and the Edit button is disabled (pressing it explains why). The **AI save-warning dialog still appears on Save** (Edit / Save anyway) and "Save anyway" is recorded in History.

## Earlier rounds (kept, still true)

- Round 1 defaults, confirmed: one **Edit** button opens the standard side panel (round 2 removed per-field pencils); side panel for all create and edit, **centred dialog only for confirmations**; the AI setting is editable by `Matter.Edit` holders and defaults to **No**; AI never blocks saving (the user decides in the dialog).
- Round 2: no boxes per field on Summary, Assets by type on top, filters as dropdowns (View, Type, Direction, Kind), Notes splitter and the full editor toolbar with table picker and table tools, shorter header, two-line Due, Projects open a side panel with their linked tasks (**Add task**, **Unlink**), Activities as one What cell and newest first.

## What to click

The dashed **Mockup** button in the top bar: *AI allowed* (No / On-prem AI only / Company-approved AI services), *Has Matter.Edit*, *Can open My Matters*, *Preview AI warning on save*, and **Open the slash menu in the note**.

1. **Summary**: scroll inside the details list; **Edit** (side panel, full form); asset tiles (open Assets filtered by type); **Add event**; toggle My Matters access and watch the calendar panel disappear. More actions > Set inactive shows the centred confirmation (blocked here because of open tasks, as in today's app).
2. **Tasks**: View dropdown, filters, tick two tasks and **Link to project**, or click the **Project** cell of a row.
3. **Projects**: **New project** (side panel, page unchanged); a row opens the panel with linked tasks (**Add task**, **Unlink**).
4. **Assets**: Type and Disposition dropdowns, a row opens the asset panel, **New asset**.
5. **Productions**: Direction dropdown; a row opens the panel (Details, Comments, History); **Edit** then **Save**, then look at History; **New production**; the **Specs** sub-view.
6. **Notes**: a note opens in read mode; **Edit**, change something, **Cancel** (discard prompt) or **Save**; open "Hold reminders" (locked); **New**; tags rail; splitter; table picker and Table bar; slash menu; AI buttons.
7. **Activities**: Kind dropdown, "new since your last visit", newest first.

## Decisions I made, and why

- **Side panel is the app-wide pattern.** One shared panel: header with title and close, scrolling body, footer with **Cancel on the left and the primary action on the right**, Esc and the scrim close it, focus goes to the first field and returns to the trigger, Tab stays inside. The page behind never changes. Width 480 px, 600 px for the larger forms, full width on a phone. Centred dialogs remain only for confirmations (set inactive, retire spec, discard changes, AI warning).
- **Header.** Breadcrumb `Matters > Client`, the title `{Client} > {Matter name}`, one subtitle line `CM 01042-00147` with a copy button and the Active, Sensitive and AI chips. Buttons: **New** (Task, Project, Asset, Production, Spec, Note, and Calendar event for PMs with My Matters access) and More actions. No task numbers outside the Tasks tab.
- **Matter status** is read-only in the edit panel with a pointer to Set inactive / Set active (open-task rule).
- **Tasks**: My Matters grid frame, coloured task-type chips with the ref under the title, status with steps, two-line Due, Project column as a dropdown, bulk **Link to project**. One project per task is stated in the wording ("Moves from ..."); today's Task already has an optional project.
- **Specs under Productions**: few per matter (1 to 4), only meaningful with the productions that use them, keeps the tab bar at 7 tabs. The sub-view has the full list, create, edit, duplicate, retire or delete (a used spec is retired, not deleted), "used by" and status chips.
- **AI**: a matter field (No / On-prem AI only / Company-approved AI services); the system picks the tool. The button is violet with "soon" when allowed, grey and `aria-disabled` when No ("AI can't be used on this matter"). In release 1 the panel only says "AI assistant is coming soon". **AI check on save (owner decision):** a conflict with company policy or matter specs opens a centred confirmation listing the reasons, with **Edit** and **Save anyway**; saving anyway writes "Saved after an AI warning" to the note History and the audit log. The check itself is "coming soon"; the dialog is a preview you switch on in the Mockup toolbox. When AI allowed is No no check runs.
- **Dates** follow My Matters: `MM/DD`, `MM/DD hh:mm AM/PM`, `MM/DD/YYYY` for another year. Mock "today" is 11/01/2026.

### Rules from the theme guide, and how the mockup follows them

- Tokens only (the approved My Matters CSS is copied inline so the file opens standalone); no thick coloured left borders; colour is never the only signal.
- **Dropdowns**: every choice or filter control is the `mf-dropdown` look; data-entry selects inside forms stay native (section 7.5).
- **Fixed page**: measured as described in the decision log; only the Summary panes, grid rows, notes list and note editor scroll.
- **No new shortcuts (#420)**: `/`, `@`, `#` are typing triggers inside the editor; arrow keys, Enter and Esc inside menus and the splitter are widget keys. Nothing is added to `shortcut-registry.ts`.
- Contrast: `contrast-check.cjs` runs every demo state at 1366x768, 1366x600 and 375x812: **0 failures** at 4.5:1 (3:1 for large text).

## Existing functions kept

- Header: copy of the number, Active and Sensitive badges, client link, project manager line with Change, **Edit** (now on Summary), **Create task** (under New and on the Tasks tab), **New project**, **New asset**, **Bulk re-assign / re-prioritise**, **Add comment**, **Open the matter's tasks**, **Set inactive / Set active** with the open-task block and "View open tasks"; Activity as a tab (the `?tab=activity` link maps to it). The inactive-matter and inactive-client banners are unchanged (not drawn).
- Summary: client, CM number, name, status, sensitivity, managers, custom fields, created and last changed.
- Tasks: Title or Ref search, Project, Priority, Assignee and Status filters (Status starts on the open statuses; the Due filter stays as today, not drawn), the six former summary views (now the View dropdown), paging, selection with bulk actions, Columns menu, Create task prefilled with the matter, the narrow-screen filter sheet.
- Projects: name and description, open and overdue counts, Active and Archived, collapsed Archived group, New project.
- Assets: name, type, external reference, size, disposition, linked-task count, filters, New asset.
- Permission gating stays: Projects and Assets tabs only with their View permission, Task.View for Tasks, the sensitive-matter rule for every list and count.

## Backend and data model implications (for the later build)

New entities and fields. SQL scripts are numbered and immutable once merged, so each item below is a new script (fix forward); all data is demo data, so no backfill is needed.

| Item | Notes |
| --- | --- |
| `Matter.AiAllowed` | Small int, 0 = No (default), 1 = On-prem only, 2 = Company-approved. Constraint on values. Add to Matter DTOs, OpenAPI and the nswag client. A change writes an audit entry. |
| `ProductionSpec` | `Id, MatterId, Name, Status (Draft/Approved/Retired), Source, ImageFormat, Colour, TextMode, NativesRule, LoadFile, MetadataFields (child table or JSON list), RedactionRule, PrivilegeRule, DedupRule, DateTimeRule, NumberingRule, EncryptionRule, RowVersion, audit columns`. Not deletable while used (Retire instead). Per matter. |
| `Production` | `Id, MatterId, Name, Volume, Direction (Out/In), ProducedBy, ProducedTo, ProductionSpecId (nullable), BatesBegin, BatesEnd, DocumentCount, PageCount, DateKind (Delivered/Due), EventDate, Notes, RowVersion, audit columns`. No status, no QC, no overlap rule for now. |
| `ProductionComment` | `Id, ProductionId, BodyText, CreatedBy, CreatedAtUtc`. |
| Production history | Reuse the audit log with a Production object type (who changed what, field by field), so History and Activities share one source. No separate history table needed. |
| Notes | `Note` (matter-owned, rich text body with the title as the first line, a derived `Title` column for lists, `LockedBy`/`LockedAtUtc` for the lock), `NoteTag` link, `NoteLink (NoteId, TargetType: Asset/Project/Matter/Note/User, TargetId)` filled from editor chips and `/note` blocks. History includes "saved after an AI warning". |
| `Task.ProjectId` | Already exists. Needed: a bulk link endpoint (`POST /projects/{id}/tasks`) and "set project" in the bulk dialog, the rule that the project belongs to the same matter and is active, and an audit row per task. |
| Asset counts by type | A `GET /matters/{id}/overview` addition or a small `asset-counts` endpoint (counts by type id, honouring the sensitive-matter rule). |
| My Matters access | The Summary calendar panel needs a flag from the API (does this user have My Matters access and is a PM here) so the client can hide it. The link to My Matters takes a matter preselection parameter. |
| AI check on save (later) | `POST /notes/check` returning reasons; the client shows the dialog and sends `ackWarnings` on save so the server can write the audit entry. Out of release 1. |

Suggested permissions (for `contracts/permissions.json`, backend and frontend together): `Production.View`, `Production.Create`, `Production.Edit`, `Production.Comment`, `Production.Archive`; `ProductionSpec.View`, `ProductionSpec.Create`, `ProductionSpec.Edit`, `ProductionSpec.Retire`; `Note.View`, `Note.Create`, `Note.Edit`, `Note.Delete`; `Matter.Edit` covers the AI setting by the owner's default (`Matter.EditAi` is the alternative). Tasks use `Task.Edit` and `Project.Edit` for linking. Every new list and count follows the sensitive-matter rule.

Module boundaries: Productions and Specs as a new module (`MatterFlow.Productions` with `.Contracts`), Notes as another (`MatterFlow.Notes`), registered in `ModuleComposition.cs`; they reference only SharedKernel and other modules' Contracts.

## Effort for the later build (agent-hours, rough; includes tests, OpenAPI and client regeneration, e2e smoke, a11y check)

| Tab or part | Hours | What drives it |
| --- | --- | --- |
| Shared: side panel component and standard, 7-tab strip, header | 8 to 10 | Reused by every tab |
| Summary | 10 to 12 | Pinned asset tiles, three internal scroll panes, details list with custom fields, one Edit panel, AiAllowed field and API, My Matters-gated calendar panel |
| Tasks | 8 to 10 | Restyle on the My Matters grid, View dropdown, project dropdown, bulk link |
| Projects | 8 to 10 | Side panel create, project panel, link and unlink endpoints and UI |
| Assets | 6 to 8 | Restyle, Type dropdown, asset panel and form |
| Productions (simple list, comments, history) | 14 to 18 | New module, 3 tables, API, grid, detail panel, form, audit-based history (was 28 to 34 with status, QC and overlap checks) |
| Specs (under Productions) | 14 to 18 | Entity, API, grid, big form, duplicate, retire rule |
| Notes | 36 to 46 | Note module, read and edit modes, lock, rich text editor with full toolbar and tables, slash, mention and link chips, inline linked notes, splitter, tag rail, history, AI button states and panel, save-time warning dialog stub, discard prompts |
| Activities | 5 to 6 | New kinds, grid, unread state |
| Cross-cutting: permissions, OpenAPI, nswag, a11y and e2e, docs | 10 to 12 | |
| **Total** | **about 120 to 150** | Notes, Specs and Productions are about half |

Mockup effort: about 7 agent-hours for round 1, about 6 for round 2, about 5 for round 3.

## Open questions for the owner

1. **Custom fields on Summary.** The real ones come from the matter's form version. Do you want them in the order of the form, and should long text fields be clamped with "show more"?
2. **CM number format.** I show `01042-00147` (client number and matter number). Confirm the display format you want (with or without leading zeros, `343-12` style).
3. **Locked notes.** Who sets a lock (the editor who has it open, auto-expiring, or an admin)? The mockup only shows the result.
4. **My Matters link for PMs.** Which flag decides it: "has Matter.BeManager on this matter and can open My Matters"?
5. **Production statuses, QC and Bates checks** are left out. Tell me when you want any of them back.
6. **`/asset` and `#`** do the same thing (link one asset). Keep both?
7. **Add event** uses the side panel (on Summary); My Matters still uses a dialog. Convert My Matters too when it is next touched?
8. **Received productions** have no spec. Do you want a free-text "format received" instead?

## Notes for the reviewer

- `index.html` is generated from one source and is self-contained.
- Mock data is invented (Northwind Logistics, Harbor Freight, Atlas Cloud, names). No real client data.
- The `Mockup` button is a review tool, not product UI.
