# Matter detail redesign: progress (epic #1001)

Protocol: one section per agent below, append-only, newest entry last; rebase before every push. Weight = hours / 164.0 (rounded to one decimal; the column sums to 99.9). Percent done is set by the agent at hand-back; total = sum of weight x percent.

| Issue | Code | Title | Hours | Weight % | Done % | Weighted % |
| --- | --- | --- | --- | --- | --- | --- |
| (this commit) | MD-00 | Epic, issues, plan, branch | 3.0 | 1.8 | 100 | 1.8 |
| #1002 | MD-01 | Side panel standard, tab shell, header, fixed layout | 10.0 | 6.1 | 98 | 6.0 |
| #1003 | MD-02 | Matter AI allowed | 4.0 | 2.4 | 100 | 2.4 |
| #1004 | MD-03 | Summary tab | 10.0 | 6.1 | 98 | 6.0 |
| #1005 | MD-04 | Tasks tab | 8.0 | 4.9 | 95 | 4.7 |
| #1006 | MD-05 | Projects | 11.0 | 6.7 | 100 | 6.7 |
| #1007 | MD-06 | Assets tab | 6.0 | 3.7 | 85 | 3.1 |
| #1008 | MD-07 | Activities tab | 6.0 | 3.7 | 95 | 3.5 |
| #1009 | MD-08 | Next events and My Matters link | 5.0 | 3.0 | 100 | 3.0 |
| #1010 | MD-09 | Production spec backend | 7.0 | 4.3 | 100 | 4.3 |
| #1011 | MD-10 | Productions backend | 9.0 | 5.5 | 100 | 5.5 |
| #1012 | MD-11 | Productions tab UI and Specs | 12.0 | 7.3 | 90 | 6.6 |
| #1013 | MD-12 | Notes backend | 12.0 | 7.3 | 100 | 7.3 |
| #1014 | MD-13 | Notes tab UI | 12.0 | 7.3 | 90 | 6.6 |
| #1015 | MD-14 | Slash commands, @, #, embed | 10.0 | 6.1 | 80 | 4.9 |
| #1016 | MD-15 | Templates, history, lock | 10.0 | 6.1 | 90 | 5.5 |
| #1017 | MD-16 | AI placeholder and warning dialog | 5.0 | 3.0 | 85 | 2.5 |
| #1018 | MD-17 | Cross-cutting | 10.0 | 6.1 | 0 | 0.0 |
| #1019 | MD-18 | Final QA and merge | 14.0 | 8.5 | 0 | 0.0 |
| | | **Total** | **164.0** | **99.9** | | **80.4** |

## PM (MD-00)

- 2026-11-01 Epic #1001 and issues #1002 to #1019 created; branch `matter-detail` created from `origin/theme-all-pages`; plan, progress table and addendum AQ written.

## Agent A (see the entries at the end of the file)

### Agent A entries

- 2026-11-01 MD-01 (A): `mf-slide-panel` (shared/ui/slide-panel.ts) is on the branch: use it for every create/edit panel (inputs title, subtitle, size, primaryLabel, busy, error, dirty, canSubmit; `[(visible)]`, `(submitted)`). Example: features/projects/ui/project-panel.ts. Tab registry: features/matters/ui/matter-tabs.ts (add a tab permission there, then a `@case` in matter-detail-page.ts replacing the placeholder). Productions tab needs `Production.View` and Notes `MatterNote.View` in contracts/permissions.json (Agent B adds them; the tabs show only for holders). New menu entries for Production/Spec/Note/Event: Agent B adds them to `newItems` in matter-detail-page.ts when the feature exists.
- 2026-11-01 MD-02 (A): script 51 `Matter.AiAllowed` (tinyint, default 0, CHECK 0..2); API enum `MatterAiAllowed` (`No`, `OnPremOnly`, `CompanyApproved`) in Organization.Contracts, on MatterResponse, CreateMatterRequest and UpdateMatterRequest (nullable = unchanged).

### Questions (Agent A)

- None yet.

- 2026-11-01 MD-03/04/05/08/16 (A): Summary (`matter-summary.ts`, `matter-edit-panel.ts`), asset counts by type (Assets module `GET /assets/counts-by-type?matterId=`), View dropdown in the Tasks tab (`SummaryStrip variant="dropdown"`), project panels (`projects/ui/project-panel.ts`, `project-tasks-panel.ts`), bulk link/unlink (`POST /matters/{id}/tasks/project`, WorkManagement), Next events + Add event panel (shown with `Matter.BeManager`), AI components (`shared/ui/ai/`: `mf-ai-button`, `mf-ai-coming-soon`, `mf-ai-warning-dialog`, `AI_FLAGS.aiPolicyCheck` = false). Agent B: the Notes toolbar uses `<mf-ai-button [allowed]="matter.aiAllowed" (pressed)=...>` and `<mf-ai-coming-soon>`; on a "Save anyway" write the note history line "Saved after an AI warning".
- E2E todo for MD-17 (not updated yet, they still target the old header/Overview): wp3-record-header, wp7-matter-overview, wp10-matter-tabs, detail-layout, detail-page-states, px5-matter, pm4-bulk-tasks, sensitive-ui and the `openMatterDetails` helper in e2e/support/matter-details.ts (the Details toggle is gone; the details list is always visible).

## Agent B

Questions for the owner are listed at the end of this section; each has a recommended default that is already built.

- 2026-11-01 Worktree `/home/user/wt/mdb`, local branch `md-b-work` tracks `matter-detail`. Order: MD-09, MD-10, MD-12 backends, then the UIs on Agent A's shell.
- Backend design decisions (all three backends): new modules `MatterFlow.Productions` (productions, comments, specs) and `MatterFlow.Notes` (notes, tags, templates), each with a `.Contracts` marker project; scripts 52 (specs), 53 (productions and comments), 54 (notes, tags, links), 55 (templates); script 56 is not used.
- History uses the Audit module for productions, specs and notes (object types `Production`, `ProductionSpec`, `Note`). Audit.Contracts got one new read method, `IAuditReader.ListAllForObjectAsync` (every event type of one object, newest first, with a cursor), because the existing one filtered by a single event type. Entities are NOT marked `[Audited]` (that would write one event per field on create); the services write one `FIELD_CHANGED` per changed field and one semantic event per state change, always with the matter, so the sensitive-matter rule restricts the history.
- Permission grants: the scripts insert the permission rows and grant them to the existing starter roles by name (same pattern as script 46); `StarterRoles.cs` has the same matrix for fresh databases. Everyone gets Production.View/Edit/Comment, ProductionSpec.View, MatterNote.View/Edit; Director, Project Manager and Pod Lead also get ProductionSpec.Edit and MatterNote.Delete.
- Note body: the shared sanitiser `RichHtml` got a second profile (`RichHtmlProfile.Note`: headings 1 to 3, quote, and a reference span with exactly one of `data-asset-id`, `data-project-id`, `data-matter-id`, `data-note-id`, `data-user-id`, `data-embed-id`; `data-embed-id` is a linked note shown inline). The Basic profile is unchanged.
- API shape for the UI (all under `/api/v1`): `production-specs` (list by matterId, get, create, update, duplicate, retire, unretire, history), `productions` (list, get, create, update, delete, history, comments, summary at `matters/{id}/productions/summary`), `production-comments/{id}` (update, delete), `notes` (list, get, create, update, delete, pinned, lock, unlock, history, resolve-references, summary at `matters/{id}/notes/summary`), `note-tags`, `note-templates` (list, get, create, update, duplicate, delete, use).

### Questions (owner)

1. **Note tags: firm-wide or per matter?** The issue text (#1013, #1014) says per matter and "create/rename/delete tags needs Edit". The approved Notes mockup r3 (and addendum AQ item 9, which wins) shows tags managed by administrators under Labels, "Notes tags", with people only picking them (max 5 per note, ten-colour palette, active flag). Built as in the mockup: firm-wide `NoteTag`, managed with the existing permission `StatusLabel.Manage` (no fourth note permission). The admin tab itself ("Labels > Notes tags") is not in any issue estimate; recommended default: build it in MD-13 if time allows, otherwise administrators use the API.
2. **Spec statuses.** Mockup r2 had Draft/Approved/Retired; the issue and AQ say list, create, edit, duplicate, retire. Built Active/Retired only (a retired spec can be reinstated), no delete.
3. **Delete of an unused spec.** The mockup offers delete for an unused spec, the issue says "no delete in v1". Built without delete.

- 2026-11-02 Hand-back of Agent B (MD-09 to MD-15), done percentages above: backends 100 (integration tests run in MD-18); the UIs are written, type-checked, linted and unit tested for their pure logic but were NOT opened in a browser and have no e2e spec yet (cheap checks only, by the rule), so MD-11 85, MD-13 80, MD-14 70, MD-15 70. Open items for QA or a follow-up: the admin tab "Labels > Notes tags" (the API is there: `/note-tags`, permission `StatusLabel.Manage`), e2e smoke specs and axe at four sizes for both tabs, the bundle gate (`ng build`), Activities kinds for productions, specs and notes (MD-07 reads the Audit module by object type `Production`, `ProductionSpec`, `Note`), mobile/stacked layout check, the AI warning dialog is not wired because no check exists (`NotesTab.beforeSave` is the seam).

- 2026-11-02 Agent B, round 2: MD-15 gaps closed (history column with its own splitter at 820 px and wider, rail when collapsed, side panel when narrower; New note split button with Blank note / From template; template create and edit form), new issue #1021 (MD-19) "Notes tags" tab under Labels (`StatusLabel.Manage`, `/admin/note-tags`), tab counts for Productions and Notes in the tab strip (`refreshTabCounts` on the page, `(changed)` output of both tabs), audit labels for `Production`, `ProductionSpec` and `Note` (`IProductionLabels`, `INoteLabels`; "Restricted record" for hidden matters), so Activities (MD-07) can show names. Specs stay Active/Retired with no delete.
- 2026-11-02 Browser self-check (real stack, one Playwright script, not the runner; screenshots at 1366x768, 375x812 and 1920x1080): created a spec and a production with a comment, read the history, new note, typed, `/` menu, table, saved, `#` menu, lock and unlock, history column and rail, save as template, template edit form, Notes tags admin tab: all passed, 0 console errors. Found and fixed: doubled AI button, doubled Close buttons in the History and Templates panels, comment action spacing. OPEN for Agent A / shell: at 1366x600 EVERY tab (Summary and Tasks too) has `scrollHeight` 737 against a 600 window; the fixed page has a minimum height of about 737 px, so the page scrolls on a 600 px high window. At 1366x768 and 1920x1080 it does not scroll on Productions and Notes. The cause is in the shell or fixed-page rule, not in the two new tabs.

- 2026-11-02 Agent B to Agent A: dev (theme rollout, a14dd0d) is merged into `matter-detail` (normal merge, no conflicts). Page height at 1366x600: every Matter tab needs about 737 px (shell issue, known on dev as #980); I am only measuring it (nav height against shell height) and will not touch `matter-detail-page.ts` or the shell without telling you here first. The Notes editor's Paragraph style is now the shared dropdown (#1022).

- 2026-11-02 (A) round 2: Overview/health-strip/data-block removed; Activities tab is `matter-activities.ts` (audit trail of the matter as a grid, Kind dropdown, "new since your last visit" banner kept in localStorage only). Agent B: when your Production and Note audit events exist for the matter, add their labels to `KIND_LABELS` in that file and make sure the audit rows carry `MatterId`/object type `Matter` or extend the fetch. Change matter number is in the Edit panel. Project cell in a task row is a dropdown (needs `Task.Edit`). Integration tests added: `MatterTasksProjectTests`, `AssetCountsByTypeApiTests`; catalog entries for both endpoints. E2E specs updated: detail-layout, px5-matter (Overview describe removed), wp10, matter-client-details-tab, detail-page-states, wp3; deleted wp7-matter-overview and pv-matter-overview (features removed). New `md-fixed-page.spec.ts` measures that the page never scrolls.

- 2026-11-02 (A) round 3: Activities now lists all events of the matter (`GET /audit/search?matterId=`, kinds Matter, Tasks, Comments, Assets, Projects, Productions, Specs, Notes, objects as links; a Production/Note link opens the tab, not the single record). The matter loading skeleton has the new header. wp3-record-header lost its Matter cases; `md-matter-header.spec.ts`, `md-tasks-look.spec.ts` and `md-fixed-page.spec.ts` cover the Matter page. Tasks tab: View dropdown sits in the toolbar row, the workflow progress is shown under the status ("1 of 3 steps"), the Project cell is a dropdown. Open for QA/B: the Sensitive endpoint catalog test lists 41 unclassified Notes and Productions endpoints (`SensitiveAccessCatalog.cs`, Agent B). px5-matter line 59 (Matters list row menu) is flaky: identical code on dev; it passed once and failed twice here. 1366x600: the shell menu makes the document taller than the window (owner decision pending).

- 2026-11-02 Agent B: the sensitive-access catalog now classifies all 41 Productions, ProductionSpec, Notes, note-tags and note-templates endpoints (matter-scoped reads Gated and walked with a spec, production and note per matter; writes Write; firm-wide tag administration Neutral; tag list Aggregate), the persona universe holds the new permissions, and `MatterContentApiTests` covers create, 409 on a stale row version, the retire rule, 404 on a hidden matter for reads and writes, sanitiser, references and the lock rules. The tests found a real bug: a non-administrator's changes to a note, spec, production or comment were silently not saved (the visibility query reads untracked rows); fixed with `FindTrackedAsync`.


## Agent C (round 2: MD-21 to MD-26, owner requests of 2026-11-02, issues #1025 to #1030)

- 2026-11-02 Agent C, worktree `/home/user/wt/mdetail`. **Create and edit are a centred pop-up dialog now** (`mf-form-dialog`, `shared/ui/form-dialog.ts`, same inputs and `data-panel-*` hooks as `mf-slide-panel`, sizes `small`/`default`/`large`, full screen on a phone). Side panels (`mf-slide-panel`) stay for read/detail context only. Converted: New matter (Matters list; `/matters/new?clientId=` now redirects to `/matters?newMatter=1&newClient=` which opens the dialog), Edit matter, New/Edit project, New/Edit production and spec, Add event, note tag form (admin). Left as side panels: project tasks, production and spec details, the AI "coming soon" panel.
- **Agent D (Notes):** `features/notes/notes-tab.ts` still has `mf-slide-panel` for the Tags picker (it is a picker, kept), the history and the templates panels; the template create/edit form (`New template` / `Edit template`, around line 801) is a create/edit form, so switch it to `<mf-form-dialog>` (import `FormDialog` from `shared/ui/form-dialog`; same inputs). I changed one line of your file: the toolbar button label is `New Note` (Title Case). The button guard `shared/ui/button-rule.spec.ts` lists `notes-tab.ts`; it is exempt from the `size="small"` check until you drop `size="small"` from your `p-button`s (in this theme it is the same size as the default; theme guide section 9) and then remove it from `SIZE_PENDING` in the spec.
- MD-21 shared column resize: `shared/ui/resizable-columns.ts`, directive `mfResizable="<grid name>"` on a `<table>` (opt a header cell out with `data-no-resize`, name it with `data-col`). Other lists can adopt it with one attribute. The older work-table resize (`shared/work-queue/column-resize.ts`) stays for the task grids.
- MD-23: Summary has Primary PM and Secondary PM rows, no Next events. The header New menu keeps "Calendar event" (it still adds an event shown in My Matters; only `Matter.BeManager` holders see it); its form is the pop-up.
- MD-24: Matter and Project task grids have a Type chip column (`typeChip`, 32 px My Matters chip) and a Progress column (`steps`, thin bar, `role=progressbar`, tooltip "n of m steps" on hover and focus); Status shows the chip only. Definitions in `shared/work-queue/column-prefs.ts`, default widths in `scoped-tasks.ts`.
- MD-25/26: labels `+ New Project`, `New Asset`, `New Note`, `New Spec`, `New Production`; Assets columns Type then Name; button rule in theme guide section 9 with the guard spec.


## Agent D (MD-27, #1031: Notes tab parity with the approved mockup)

- 2026-11-02 Agent D, worktree `/home/user/wt/mdb`. The Notes tab is rebuilt after `notes-mockup-r3.html` (design A) and the owner's later decisions. The checklist is `docs/ux/matter-detail/notes-parity.md` (131 lines done, 11 different on purpose with the reason, 0 open; the conflicts list is at its end) and the mockup-vs-app pictures are in `docs/ux/matter-detail/notes-parity/`.
- What changed in code: `features/notes/notes-tab.ts` (+ four style files `notes-tab*.scss`, split only to stay under the 8 kB component style budget), `note-editor.ts` (+ `note-editor*.scss`), new `note-tag-chip.ts` (`mf-note-tag`), new pure helpers and specs in `note-ui.ts`. One card with the header row, notes grouped by tag, Latest, Board and Templates views, the splitter, the note panel (read mode with Edit; edit mode with Cancel left and Save right), the history column and rail, the Referenced items block, the lock, conflict and discard states, the tags side panel, the link dialog (https:// and `onenote:https://`), a 3 by 3 table with tools, the slash menu with two levels.
- For other agents: `mf-ai-button` got an input `showNote` (default true; Notes passes false and keeps the message as tooltip and description); the Matter page passes `[sensitive]="m.isSensitive"` to `mf-notes-tab`; the template forms and "New note from a template" are `mf-form-dialog` (#1026); `button-rule.spec.ts` has no pending file any more. Backend: the shared sanitiser keeps a link `onenote:https://...` in the Note profile only (RichHtml.cs, tests in `RichHtmlNoteLinkTests`); no schema, API or permission change, so no new SQL script, no OpenAPI or client change.
- Not done here (outside the Notes tab): the unsaved-changes prompt when the person switches to another tab of the Matter page (the tab strip belongs to the page; the Notes tab itself asks on cancel, on opening another note, on New Note, on a view change and when the browser page is left).
