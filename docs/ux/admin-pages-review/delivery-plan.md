# Admin pages (Audit Logs, Labels, Asset Types, Custom Fields, Asset link roles): delivery plan

Owner approval: "I like all of your recommendations, so please don't wait for me. create epics / issues and continue working" (2026-10-20), with product decisions delegated to the PM ("you can make decisions for me"). Decisions are recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-20, base `origin/dev` (Clients epic #245, Task Detail epic #288 and Task Types epic #352 built; their shared components are on dev). Source review: `README.md` in this folder (45 findings, BUG-1 to BUG-10, 9 work packages, 109 agent-hours, 88 screenshots in `screenshots/`, two mocks in `mocks/`).

Binding owner decisions: (1) **no new or changed keyboard shortcuts in this phase** (Phase 2 backlog #420): skip links, focus management, roving tabindex and buttons are in scope, the three shortcut ideas of review section 8 stay in the backlog; (2) shortcuts that already shipped stay as they are.

Structure on GitHub: one epic **#518** (labels `epic` + `phase-10`) and 58 sub-issues (#519 to #663 are the numbers created between the first and the last; other planning agents create issues in parallel, so the numbers are not contiguous: the table lists every one). None is decided "not now". Issues blocked on an owner decision: **none**. The eight questions of review section 7 are decided by the PM with the reviewer's defaults: (1) asset types become a record page with the form-page pattern, after a one-hour-class patch of the inline form in the first release; (2) sidebar and H1 "Asset Types", tabs "Asset Types (n)" and "Link Roles (n)"; (3) the API counts are added (priority open tasks, status tasks, link-role links, asset-type fields and assets); (4) Delete only for unused Priorities and Link roles, only in the overflow, Deactivate otherwise, with the impact line; (5) audit object links by permission, configuration objects named by the API; (6) the Audit filter row is open by default from 640 px; (7) Custom Fields stays a list of three objects with counts, the designer one click away; (8) Labels stays one page with two tabs.

Effort is in **AI-agent hours** (one developer agent, including unit, integration, e2e, axe and screenshots). The review estimated 109 hours; the plan is **128**: the kit is built as separate issues from its applications (23 h), the first release carries about 3 hours of patches that the rebuilds later delete (#530, #537, part of #533), the six backend items are separate (14 h), and the docs and final verification are explicit. The first release is **12 hours** (review: about 12).

Folded IDs (named in the host issue, nothing dropped): BUG-1 in #519/#523; BUG-2 and BUG-4 in #530 (replaced by #635); BUG-3 in #533; BUG-5 in #541; BUG-6 in #657, #638, #645, #651; BUG-7 in #537, #618, #641; BUG-8 in #579 and the cards of every list; BUG-9 in #588; BUG-10 in #634/#575; X1 in the kit; X2 #545; X3 #583/#658; X4 #542; X5 #544; X6 #575/#541; X7 #657; X8 #544/#659; X9 #588; X10 #526/#661; LB1 #593; LB2 #605/#609/#614; LB3 #618; LB4 #609/#614; LB5 #622; LB6 #583; LB7 #575; LB8 #593; AT1 #530/#635; AT2 #635/#636; AT3 #634; AT4 #627/#631; AT5 #633; AT6 #637; AT7 #638; AT8 #635; LR1 #640; LR2 #639/#641; LR3, LR4 #642; CF1 #644; CF2 #643; CF3 #644; CF4 #645; CF5 #662; AU1 #646; AU2 #647; AU3 #533/#648/#649; AU4 #650; AU5 #651; AU6 #652; AU7 #653; AU8 #654; AU9 #655; AU10 #656. "What works" items are regression tests only.

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package | Lane |
|---|---|---|---|---|---|---|
| #519 | BUG-1 (API), X10 | API: Priority.Manage and StatusLabel.Manage can read what they manage (BUG-1) (R1 backend) | 2 | - | WP-AD1 | D |
| #523 | BUG-1 (UI), LB1 (part) | Labels pages follow the permission: no refused requests, no toasts, menu opens the first allowed tab (... (R1) | 2 | #593, #519, #416 | WP-AD1 | D |
| #526 | X10 | Permission matrix covers the Labels and Audit roles (extends AdminReadPermissionsApiTests and ty-permi... (R1) | 1.5 | #519, #523, #417 | WP-AD1 | D |
| #530 | BUG-2, BUG-4, AT1 (patch) | Inline asset type form is fully visible, focuses the first invalid field and guards unsaved text (BUG-... (R1) | 2 | - | WP-AD1 | C |
| #533 | BUG-3, AU3 (1) | Audit object links exist only when the person can open the target (BUG-3) (R1) | 2 | #245 | WP-AD1 | D |
| #537 | BUG-7 | A refused delete is reported once, with one wording (Priorities and Link roles) (BUG-7) (R1) | 1 | - | WP-AD1 | B |
| #541 | BUG-5, X6 (RecordKind part) | Designer 404 reads "We couldn't find that asset type / object" with the header kept (BUG-5) (R1) | 1.5 | #635, #353 | WP-AD1 | C |
| #542 | X4 | Dialog wording for asset type, priority and link role: deactivate, delete-unused, set default (dialog-... | 1 | #636, #614, #618, #641, #362 | WP-AD2 | A |
| #543 | X1 (stylesheet), X3, BUG-8 (part) | One admin table stylesheet: the 44 px grid contract with cell patterns and column-drop rule (retires .... | 3 | #355, #356, #269 | WP-AD2 | A |
| #544 | X1 (header), X5, X8 (skip link), AU1/LB1/AT5 (chrome) | Admin list shell: crumb, one-line description, Filters with count, primary action, strip slot and "Ski... | 3.5 | #365, #354, #370 | WP-AD2 | A |
| #545 | X2, LB1, AT5 | Counted route tabs for admin pages: AdminTab model, AdminTabCounts and the first-allowed-tab menu target | 2 | #544, #364, #279, #347 | WP-AD2 | A |
| #554 | X1 (row menu), X3, LB3 (visible reasons) | Row overflow convention for admin lists: Actions for <name>, danger items, visible reasons instead of ... | 2 | #355 | WP-AD2 | A |
| #564 | LB2 (dialog), LB4, LR1 (dialog), LB5, X3 | Lookup dialog: one short form in a dialog with live preview slot, counters, validation summary and uns... | 3 | #361, #362, #386 | WP-AD2 | A |
| #575 | X6, LB7, BUG-10 (kit part) | Grid-body states on the real columns: skeleton, error with reference, empty, no-match, "n inactive hid... | 2 | #543, #370, #369, #251 | WP-AD2 | A |
| #579 | X1 (cards), BUG-8, AU2, LB2, AT3, LR1 | Phone cards below 640 px and the 768 column-drop order for admin lists (AdminCardSpec for mf-record-ca... | 3 | #543, #554, #374, #375, #275 | WP-AD2 | A |
| #581 | X1 (strip), AT3, X2 | Health strip helper for admin lists: client-side counts with chips or single-select segments | 1 | #544, #367, #368, #260 | WP-AD2 | A |
| #583 | X3, LB6, LR4 | Control kit rule: one input class, one button component, counters, no red text links in rows | 1 | #361 | WP-AD2 | A |
| #588 | BUG-9, X9 | Document titles and breadcrumbs name the record on all nine admin routes of the five areas (BUG-9) | 1.5 | #638, #645, #544, #359, #360 | WP-AD2 | A |
| #593 | LB1, LB8, X2, X5 | Labels page on the kit shell: crumb, counted tabs Priorities (n) / Status labels (n), one-line descrip... | 2 | #544, #545, #523 | WP-AD3 | B |
| #599 | LB2 (Open tasks), LB3, LB5 (API) | API (additive): openTaskCount on priorities and taskCount on status labels (backend) | 2.5 | #372 | WP-AD3 | B |
| #605 | LB2 (grid), LB8, BUG-8 (priorities) | Priorities list on the grid contract: Order, Priority badge + Default badge, Color, Open tasks, Status... | 3.5 | #543, #554, #575, #579, #593, #599, #264, #266 | WP-AD3 | B |
| #609 | LB2 (dialog), LB4 (color), LB6 | Edit priority / New priority dialog with live badge preview and the contrast check; instant color save... | 3 | #564, #605 | WP-AD3 | B |
| #614 | LB2 (actions), LB4 | Priority row actions in the overflow: Move up/down, Set as default (one-line confirm), Deactivate/Acti... | 2 | #542, #554, #609 | WP-AD3 | B |
| #618 | LB3, BUG-7 (follow-up) | Delete exists only for an unused priority; used priorities offer Deactivate with the impact line (LB3) | 2 | #542, #614, #599 | WP-AD3 | B |
| #622 | LB5, LB4 (rename), LB6, BUG-8 (status labels) | Status labels on the grid contract: badge name, code as tooltip, Tasks count, Rename dialog, phone cards | 3 | #564, #543, #579, #593, #599 | WP-AD3 | B |
| #627 | AT3 (counts), AT4 (API), AT2 (Fields tab) | API (additive): published field count, published date, draft version and asset count on the asset type... (backend) | 2 | #643, #599, #639, #649 | WP-AD4 | C |
| #631 | AT4 (UI) | Shared FormStatusCell: badge Published vN / Draft vN, "8 fields", "Updated Oct 12" | 1 | #627 | WP-AD4 | C |
| #633 | AT5, X9, X2, AT3 (chrome) | Asset Types page on the kit shell: names, counted tabs Asset Types (n) / Link Roles (n), Filters and N... | 2.5 | #544, #545, #588 | WP-AD4 | C |
| #634 | AT3, BUG-8 (asset types), BUG-10, AT4 | Asset Types list on the grid contract: strip, 44 px rows, name link, Fields and Assets cells, overflow... | 4 | #633, #627, #631, #581, #543, #554, #575, #579 | WP-AD4 | C |
| #635 | AT2 (header, Overview), AT1, AT8, BUG-2, BUG-4 | Asset type record page: /admin/asset-types/new and /:id with record header, 720 px form card, validati... | 4.5 | #634, #541, #253, #256, #380 | WP-AD4 | C |
| #636 | AT2 (tabs, overflow), AT4 | Asset type record tabs Overview / Fields (n) / Assets (n), Activity and the Deactivate dialog with its... | 3 | #627, #635, #542, #384, #362 | WP-AD4 | C |
| #637 | AT6 | Order number box replaced by Move up / Move down in the row overflow | 2 | #634, #635, #554 | WP-AD4 | C |
| #638 | AT7, BUG-6 (asset type Back) | Designer entry: Edit fields from the record header, crumb Administration > Asset Types > <name> > Fiel... | 1.5 | #635, #588, #354, #412 | WP-AD4 | C |
| #639 | LR2 (API) | API (additive): linkCount on asset link roles (backend) | 1.5 | #627, #643, #599, #649 | WP-AD5 | B |
| #640 | LR1, BUG-8 (link roles), LB6 | Link Roles tab on the same chrome as Asset Types: New link role dialog, status badge, overflow (Rename... | 4 | #633, #564, #545, #543, #554, #575, #579, #639 | WP-AD5 | A |
| #641 | LR2 (UI), BUG-7 (link roles) | Links column; Delete only for an unused role, otherwise Deactivate with "14 links keep this role" | 1.5 | #542, #640, #639 | WP-AD5 | A |
| #642 | LR3, LR4 | One-line tab description, clamped names with tooltip and counters (LR3, LR4) | 1 | #640 | WP-AD5 | A |
| #643 | CF2, CF1 (API), AT4 | API: a read endpoint for the three objects with form summary; no provisioning on view (CF2) (backend) | 3 | #627, #599, #639, #649 | WP-AD6 | C |
| #644 | CF1, CF3, CF2 (UI), AT4, BUG-8 (custom fields) | Custom Fields list with substance: Object link, Fields and required count, Published version and date,... | 3.5 | #631, #643, #544, #543, #554, #575, #579 | WP-AD6 | C |
| #645 | CF4, BUG-6 (custom fields Back), CF5 (UAT note to docs) | Designer entry: crumb Administration > Custom Fields > Matter, title and H1 "Matter custom fields", Ba... | 1.5 | #644, #541, #588 | WP-AD6 | C |
| #646 | AU1 | Audit Logs chrome on the kit shell: crumb, header Filters + Clear, filter row open from 640 px, one-li... | 3 | #544, #588 | WP-AD7 | D |
| #647 | AU2, BUG-8 (audit) | Audit grid on phone and tablet: cards below 640 px, Who joins When at 768, five columns from 1100 px | 4.5 | #543, #575, #579, #533, #646 | WP-AD7 | D |
| #648 | AU3 (2) | Admin objects link to their admin page when the viewer holds the matching *.Manage permission | 1.5 | #635, #593, #640, #533 | WP-AD7 | D |
| #649 | AU3 (3) | API: object.label for AssetType, Priority, StatusLabel, AssetLinkRole, Role and FormDefinition (backend) | 3 | #627, #643, #599, #639 | WP-AD7 | B |
| #650 | AU4 | Friendly Event type and Object type filter options (code stays the value) | 1.5 | - | WP-AD7 | B |
| #651 | AU5 | Simpler row anatomy: object clamped at two lines, "Show only this operation" in the details and row ov... | 1.5 | #554, #646 | WP-AD7 | D |
| #652 | AU6 | Readable event details: accessible name by sentence, Old -> New pair, Technical details disclosure, Sh... | 3 | #646, #649 | WP-AD7 | D |
| #653 | AU7 | "150 events loaded" counter and a hint after 1,000 events | 1 | #646 | WP-AD7 | D |
| #654 | AU8 | Quick view chips: Today, Last 7 days, Configuration changes, Access changes | 2 | #646 | WP-AD7 | B |
| #655 | AU9 | Day dividers ("Today", "Oct 19") and time-only When column | 2 | #646, #647 | WP-AD7 | B |
| #656 | AU10 | Who filter without User.View: type-ahead over names present in the loaded events | 1 | #646 | WP-AD7 | D |
| #657 | BUG-6, X7 | Dialog and menu focus rules on Labels, Link roles and Asset Types: first invalid field, return to the ... | 1.5 | #636, #637, #614, #622, #640 | WP-AD8 | B |
| #658 | X3 (cleanup) | Delete legacy table and input styles (.grid, .pg-table, .au-table, .text, .pg-input, .pg-link) and the... | 1 | #634, #644, #622, #640, #647 | WP-AD8 | A |
| #659 | X8, section 6 | Tab-stop record and keyboard-only flows for the five areas (recorded, not gated) | 2 | - | WP-AD8 | A |
| #660 | section 6, X6 | Axe and reflow audit of the new pages at 375/768/1366/1920 with every overlay open | 2 | #657, #659 | WP-AD8 | D |
| #661 | X10 (final) | Final permission matrix for the five areas: no dead links, toasts or 403s | 1 | #526, #417 | WP-AD9 | D |
| #662 | all (docs), CF5 | ux-spec S17 to S19, decisions-addendum section Y, copy deck, UAT rows, e2e catalogue | 3 | - | WP-AD9 | A |
| #663 | verification | Final verification pass for the Administration pages (Audit, Labels, Asset Types, Link Roles, Custom F... | 4 | - | WP-AD9 | A |

Total: **128 agent-hours** (58 issues). R1 = first release. Backend = additive API.

## 2. Decisions (PM) in one place

- **Shared admin list kit (WP-AD2) is owned by this epic.** The Users, Assets and Search epics depend on these issues instead of duplicating them. Public surface, stable: #544 `mf-admin-list-shell` (heading, icon, crumbs, one-line description, tabs, counts, filters/controls, `tableId` for the skip link; slots `mfPrimary`, `mfStrip`); #545 `AdminTab`, `AdminTabCounts.count/refresh`, `adminMenuTarget` (first allowed tab); #581 `stripItems(list, defs, mode chips|segments)`; #543 the 44 px grid stylesheet (`mf-grid`, `mf-cell-name|num|badge|date|muted|actions`, column-drop attribute, 640 px phone threshold); #554 `rowActions()` for the row overflow (Actions for <name>, danger items, visible reasons); #575 `AdminListState` and `mf-grid-body` states on the real columns (skeleton, error with reference, empty, no-match, hidden-count line with Show all); #579 `AdminCardSpec` and `columnDropOrder` for phone cards below 640 px; #583 the control rule (`.mf-control`, p-button, `mf-char-counter`, no red text links in rows); #542 dialog wording and `impactLine` kinds; #564 `mf-lookup-dialog` (short form in a dialog with preview slot, validation focus, unsaved guard, focus return); #588 titles and crumbs; #631 `FormStatusCell`. Needs of the sibling epics that the kit covers: Users (WP U-2 header Filters/Clear, crumb, status segments and tab counts -> #544, #545, #581; U-3 grid, 44 px, clamp, name link, row overflow -> #543, #554, #575; U-5 phone cards -> #579; U-6 dialogs -> #564; U-7 skip to table -> #544), Assets (A-2 list contract and chrome -> #544, #543, #575; A-4 cards -> #579; A-5 forms -> the form-page pattern #361 and #564 where a dialog fits; A-6 skip link -> #544), Search (Q-3 counted tabs -> #545; Q-4 hit cards -> #579; Q-6 skip to results -> #544). The kit lands in lane A in the order of section 3; consumers outside this epic start after #579 is merged.
- **Permissions.** Every `*.Manage` permission reads what it manages (TY-P rule); the Labels endpoints are widened (#519); the menu item opens the first allowed tab; links exist only when their target opens (audit objects). Counts are `null` without `Task.View` / `Asset.View`: the column is hidden, Delete is not offered, the deactivate sentence loses its number (a number the API did not return is never shown).
- **Lifecycle.** Deactivate / Activate everywhere; Delete only for Priorities and Link roles, only when unused, only in the overflow, always through `dialog-copy` with the impact line. The default priority can be neither deactivated nor deleted and says why in a visible sentence.
- **Reorder.** Existing pointer drag on Priorities and Link roles stays; Move up / Move down in the overflow on Priorities, Link roles and Asset Types (the Order number goes); no drag handle and no keyboard shortcut is added (owner decision 1).
- **Forms.** Short forms (priority, link role, status label rename) are a dialog (`mf-lookup-dialog`); the asset type is a record page on the form-page pattern (#361): 720 px card, validation summary, focus to the first invalid field, sticky footer only when dirty, unsaved guard.
- **Audit.** Chrome like Task Types (open filter row from 640, Filters/Clear in the header, cards below 640, day dividers, quick views, counter), friendly filter options, readable details with a Technical details disclosure; configuration objects named by the API and linked by `*.Manage`. No virtualization (measured fine at 3,000 events).
- **Custom Fields.** A list of three objects (name is the link) with field count, required count, published version and date, a form badge and an overflow; a read endpoint replaces the three POSTs on view; provisioning happens on the first Edit fields. No strip for three rows.
- **Names.** Sidebar and H1 "Asset Types", tabs "Asset Types (n)" and "Link Roles (n)", crumb `Administration > ...` on every admin page, titles name the record. Counts show active records.
- **Additive API (all backend).** #519 policy widening; #599 `openTaskCount` on priorities and `taskCount` on status labels; #627 `fieldCount`, `publishedAtUtc`, `draftVersionNo`, `assetCount` on asset types; #639 `linkCount` on link roles; #643 custom-field forms summary endpoint; #649 `object.label` on six audit object types. Task Queue address parameters for the Open tasks links are confirmed inside #605 and #622.
- **Out of scope.** Keyboard shortcuts (the three ideas of review section 8 stay in #420), drag handles, virtualization of the audit list, per-pod counts, a strip on Custom Fields, tabs for the three custom-field objects, exports, saved views, dark theme, real screen-reader and forced-colours testing, the form designer layout (done in the Task Types epic, #407 to #412), the Users, Assets and Search screens.

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes and never hand-merge them, run unit + integration + e2e + axe (0 violations at 1366, 1920, 768 and 375, with menus, dialogs and drawers open) and assert no page-level horizontal scroll, attach screenshots in `docs/ux/admin-pages-review/fixes/<package>/` (`ad1-first-release`, `ad2-list-kit`, `ad3-labels`, `ad4-asset-types`, `ad5-link-roles`, `ad6-custom-fields`, `ad7-audit`, `ad8-states-focus`, `ad9-docs`, `final`), keep the initial bundle at its current size (about 647 kB of 700 kB), do not add rules to `task-table.scss` or component styles that the kit covers, add no keyboard shortcut. Shared files (`record-state.ts`, `record-skeleton.ts`, `record-header.ts`, `page-header.ts`, `drill.ts`, `list-return.ts`, `grid-body.ts`, `action-menu.ts`, `record-card-list.ts`, `work-strip.ts`, `confirm-dialog.ts`, `task-type-form-page.*`) serve other pages: their specs are regression tests and changes are additive. **SQL scripts:** the next free number is **28** (latest `27-dashboard-unassigned.sql`); **none planned**; if a count query needs an index it is script 28 and is recorded on the issue (the likely candidates are #599 and #639). **Backend work:** #519, #599, #627, #639, #643, #649 (14 h): services, DTOs, `contracts/openapi/v1.json`, TS client; merge order #519, #599, #627, #639, #643, #649, regenerating the client after each rebase.

| Rank | WP | Issues | Main files / areas | Agent-h | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP-AD1 First release and permissions | #519, #523, #526, #530, #533, #537, #541 | `audit-links.ts`, `priorities-page.*`, `status-labels-page.*`, `asset-types-page.ts`, `record-state.ts`, permission policies, e2e matrix | 12 | WP-AD2 (kit start), all lanes | - | **#519 backend** (additive, no SQL) |
| 2 | WP-AD2 Admin list kit | #542, #543, #544, #545, #554, #564, #575, #579, #581, #583, #588 | `shared/ui` (new `admin-list-shell`, `admin-tabs`, `row-actions`, `lookup-dialog`, `admin-card-spec`, `strip-items`, `admin-list-state`), `styles/_admin-lists.scss`, `dialog-copy.ts`, `admin.routes.ts` | 23 | WP-AD1, WP-AD7 (first items) | - | Frontend only |
| 3 | WP-AD3 Labels (Priorities, Status labels) | #593, #599, #605, #609, #614, #618, #622 | `priorities-page.*`, `status-labels-page.*`, new labels shell, `admin-lookup.scss` | 18 | WP-AD4, WP-AD5, WP-AD7 | WP-AD2 kit (#544, #545, #543, #554, #575, #579, #564) and #599 | **#599 backend** (additive, no SQL) |
| 4 | WP-AD4 Asset Types | #627, #631, #633, #634, #635, #636, #637, #638 | `asset-admin-page.ts`, `asset-types-page.ts`, new `asset-type-record-page.*`, `record-header.ts` (kind), designer route | 20.5 | WP-AD3, WP-AD6, WP-AD7 | WP-AD2 (#544, #545, #581, #543-#579), #627 | **#627 backend** (additive, no SQL) |
| 5 | WP-AD5 Link Roles | #639, #640, #641, #642 | `asset-link-roles-page.*` | 8 | WP-AD3, WP-AD4 | WP-AD2, #639, #633 | **#639 backend** (additive, no SQL) |
| 6 | WP-AD6 Custom Fields | #643, #644, #645 | `custom-fields-page.ts`, designer route | 8 | WP-AD4, WP-AD7 | WP-AD2, #643 | **#643 backend** (additive, no SQL) |
| 7 | WP-AD7 Audit Logs | #646, #647, #648, #649, #650, #651, #652, #653, #654, #655, #656 | `audit-page.*`, `audit-links.ts`, `audit-format.ts` | 24 | WP-AD3 to WP-AD6 (chrome after the kit) | #544, #579 for chrome and cards; #533 first | **#649 backend** (additive, no SQL) |
| 8 | WP-AD8 States, focus and keyboard | #657, #658, #659, #660 | e2e specs, `admin-lookup.scss`, `audit-page.scss` (deletions) | 6.5 | none (late) | WP-AD3 to WP-AD7 | Frontend only |
| 9 | WP-AD9 Docs and final verification | #661, #662, #663 | `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `docs/qa/e2e.md`, `docs/architecture.md`, e2e | 8 | none (late) | all code | Frontend only |

Total: about **128 agent-hours**.

### First release (do these first, about 12 hours)

The defects that hurt a person today, as 7 issues, all independent of the rebuilds and safe to ship alone: #519 + #523 BUG-1 Labels permissions (2 + 2 h), #526 permission matrix for Labels and Audit roles (1.5 h), #530 BUG-2 and BUG-4 asset type form patch (2 h), #533 BUG-3 audit links by permission (2 h), #537 BUG-7 one message for a refused delete (1 h), #541 BUG-5 designer 404 wording (1.5 h). Four lanes run in parallel: lane D #519 -> #523 -> #526 and #533 (7.5 h), lane C #530, #541 (3.5 h, then its backend items), lane B #537 (1 h, then its backend items). Wall-clock of the release is about 7.5 hours.

### Waves for 3 to 4 parallel developer agents

Lanes are file owners, not people: one agent owns one lane's files for the whole epic, which is what removes merge conflicts. Lane A owns the kit, the Link Roles page and the closing issues; lane B owns the Labels pages, the Audit API labels and two Audit slices; lane C owns Asset Types and Custom Fields; lane D owns the permission work and the Audit page.

- **Wave 1 (first release, backend items, kit start)**
  - Lane A (11.5 h): #542, #543, #544, #554, #545
  - Lane B (8 h): #537, #599, #639, #649
  - Lane C (8.5 h): #530, #541, #627, #643
  - Lane D (7.5 h): #519, #523, #526, #533
- **Wave 2 (kit completes, pages on the kit)**
  - Lane A (11.5 h): #575, #579, #564, #581, #583, #588
  - Lane B (17 h): #650, #593, #605, #609, #614, #618, #622
  - Lane C (12 h): #631, #633, #634, #635
  - Lane D (10 h): #646, #647, #651, #653
- **Wave 3 (remaining pages)**
  - Lane A (6.5 h): #640, #641, #642
  - Lane B (4 h): #654, #655
  - Lane C (11.5 h): #636, #637, #638, #644, #645
  - Lane D (5.5 h): #648, #652, #656
- **Wave 4 (late, serial)**
  - Lane A (3 h): #658, #659
  - Lane B (1.5 h): #657
  - Lane D (3 h): #660, #661
- **Wave 5 (docs)**
  - Lane A (3 h): #662
- **Wave 6 (verification)**
  - Lane A (4 h): #663

Lane totals: A 39.5 h, B 30.5 h, C 32 h, D 26 h. With four agents the wall-clock is about **42 hours** (lane A is the longest and ends with the docs and the final pass); one agent alone needs 128. Three agents: fold lane D into B and C and the wall-clock is about 55 hours.

Dependency rules between lanes: lane B's Labels grid (#605) needs #543, #554, #575, #579 (lane A) and #599 (lane B, wave 1); #609 and #622 need #564; lane C's #633 needs #544, #545 and #588's title rules (can follow), #634 needs #581, #575, #579, #627, #631; lane A's Link Roles (#640) needs #639 (B), #633 (C) and #564; lane D's #646 needs #544, #647 needs #579; #648 needs #635 (C) and #593 (B); #658 waits for every page migration; #662 and #663 wait for all code.

### Exact first wave

1. Lane D: #519, #523, #526, #533 (serial, 7.5 h). 2. Lane C: #530, #541, then the backend items #627 and #643. 3. Lane B: #537, then the backend items #599, #639, #649 (serial, OpenAPI order above). 4. Lane A: #542, #543, #544, #554, #545 (the kit core the others wait for).

### Critical path

Lane A: #542 1, #543 3, #544 3.5, #554 2, #545 2, #575 2, #579 3 (kit core done after 16.5 h), #564 3, #581, #583, #588 3.5, then #640, #641, #642 6.5, #658 1, #659 2, #662 3, #663 4 = 39.5 hours. Lane B waits on the kit core (about 3 hours of slack after its backend items) and ends with #622 and #657 at about 31 hours; lanes C and D have 8 to 12 hours of slack.

### Hot spots (merge-conflict watch)

- **`src/styles/_admin-lists.scss`, `admin-lookup.scss`, `shared/ui/*` kit files** (#544 to #564): lane A only, in the order above; other lanes consume, they do not edit (additive requests go to lane A).
- **`priorities-page.*`, `status-labels-page.*`**: #523 (lane D, small, lands first), #537, then #593, #605, #609, #614, #618, #622 in order, lane B.
- **`asset-types-page.ts`, `asset-admin-page.ts`**: #530, #633, #634, #635 (record page), #637, lane C; #640 (lane A) edits only the link roles page; the tab host `asset-admin-page.ts` is touched by #633 first, then #640 rebases.
- **`audit-page.*`, `audit-links.ts`, `audit-format.ts`**: #533, #650, #646, #647, #651, #648, #652, #653, #654, #655, #656; lane D owns the file, lane B's #650, #654, #655 rebase on it and land in the stated order.
- **`task-type-form-page.*`** (designer of four owners): #541 touches the 404 branch only; keep the Task Types designer specs green.
- **`shared/ui/record-header.ts`, `record-state.ts`, `record-skeleton.ts`**: additive kinds only (#541, #635).
- **`admin.routes.ts`, menu definition, `denial.ts`**: #523, #588, #633, #635.
- **`dialog-copy.ts`**: #542 first, then consumers.
- **OpenAPI and the TS client**: the six backend issues each regenerate the same two files; merge order above.
- **Tests**: older e2e (`admin-menu`, `ux-round-4`, `column-filters-admin*`, `dashboard-audit`, `admin-form-designer-pages`, `ty-permissions-matrix`, `ty8-designer-owners`, `ty-record-states`, `ty-titles-crumbs`) select the old text links, checkboxes, tab names and headings; the package that changes the behaviour updates them.

### Extension points (for the packages that follow)

- **List kit (WP-AD2):** the Users, Assets and Search epics build on the shell, tabs with counts, strip helper, grid contract, row actions, states and card adapter; later admin lists need no new chrome.
- **Lookup dialog (WP-AD2):** any short admin form (Roles, Pods, tags) can reuse `mf-lookup-dialog`.
- **Dialog copy (WP-AD2):** `dialog-copy.ts` and `impactLine()` stay the only place dialog text lives.
- **Record kinds (WP-AD1, WP-AD4):** `RecordKind` gains `assetType` and `customField`; header actions are data.

### Definition of done per package

Issues closed, tests green twice (including permission variants), axe clean at four sizes with overlays open, no page-level horizontal scroll, screenshots in `fixes/<package>/`, bundle and style budgets kept, API changes additive with regenerated OpenAPI and client, no keyboard shortcut added or changed, the docs named in the issue noted for WP-AD9, the epic #518 tasklist ticked, and the line below added to the Status section.

### Docs package (WP-AD9, #662)

`ux-spec.md` S17 to S19 rewritten to the code (tabs, record page, lists, audit, copy deck, UAT rows; UAT-S18-4 lists three objects), section **Y** of the decisions addendum (every Decision (PM) above; the other epics use Z, AA and AB; rebase against them), `docs/qa/e2e.md`, `architecture.md` for the additive fields and the Labels read permissions, a banner in the review README. Where the code differs from the issues, the docs follow the code and say so.

### Final verification package (WP-AD9, #663)

Contract e2e over the seeded data of the review at four sizes (axe 0 including `target-size`, no sideways scroll, 44 px rows, no nested scroller), the state matrix (loading, 404, 403, 5xx, offline, reduced motion), the permission matrix (#661), regression subsets for every shared file touched (Task Types, Clients, Task Detail and, once merged, Users, Assets and Search lists that use the kit), the before/after table of the review's measurements, bundle report, screenshots in `fixes/final/`, and a comment on the epic with the open items. It uses its own e2e stack and ports and never stops processes or containers of another agent's run.

## 4. Status

(One line per work package; keep other packages' lines when merging. Format: `WP name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Owner decision (2026-10-20): no new or changed keyboard shortcuts in this phase (#420); existing shortcuts stay as they are.
- Planning (2026-10-20): epic #518 and 58 issues created and linked as sub-issues; PM requirements review comments posted on every issue; no issue is blocked on the owner; SQL script 28 is free and none is planned.
- WP-AD2 Admin list kit, core (2026-10-20, lane A, AD-A, `git log --grep "AD-A"`): #542, #543, #544, #554, #545 done; second batch below. Surface documented in `fixes/ad2-kit/README.md`: `dialogCopy.<kind>()` and seven new `impactLine` kinds; `mf-grid` / `mf-cell-*` / `data-drop` / `mf-cell-actions` in `_admin-lists.scss` (rows 44 px, column drop at 640/768/900/1100/1280); `mf-admin-list-shell` (heading, icon, crumbs, description, tabs, counts, filters, controls, tableId; slots mfPrimary, mfStrip; skip link through the #586 SkipTarget contract); `rowActions()`; `AdminTab`, `AdminTabCounts` (`AdminCounts` of Task Types extends it), `adminTabItems`, `resolveAdminTab`, `adminMenuTarget`. Proof of use: the Task Types administration runs on the shell and the tab model (one allowed tab now renders no tab strip: `task-types-tabs`, `ty2-strips`, `task-types-admin-page.spec` adapted). Tests: unit shared and admin folders pass except `nav-error.spec` (fails alone on origin/dev, not this lane) and a `record-header` flake that passed alone; e2e `ad2-kit-grid`, `ad2-kit-shell` (axe at 375/768/1024/1366/1920 incl. row menu and sheet open) and regressions ty1/ty2/ty3, task-types-tabs, ty-permissions-matrix, ty-titles-crumbs, column-filters-admin, fixed-header, wp8, wp12, clients-keyboard, assets-screen, ty9-keyboard green. Initial bundle 598 kB after the toast changes (the kit's CSS adds about 2 kB). Screenshots `fixes/ad2-kit/`. Known limits: the sidebar item target (`adminMenuTarget`) is not wired into `nav-items.ts` (app shell files; #523/#593 call it); the shell's own skip link is covered by unit specs only (the Task Types lists keep their own target); `rowActions` is used by specs and fixtures, the pages adopt it in their own issues.
- WP-AD2 Admin list kit, second batch (2026-10-20, lane A, AD-A2, `git log --grep "AD-A2"`): #575, #579, #581, #583, #564, #588, #631 done (with #590's stale `nav-error.spec` repaired first: the code was right, the spec still listened to PrimeNG's MessageService). New surface, documented in `fixes/ad2-kit/README.md` sections 6 to 12: `adminListState()` / `AdminColumn` and grid-body `columnSpec`, `errorRef`, card-list `filters`, `errorRef` (#575); `mf-admin-card-list`, `AdminCardSpec`, `columnDropOrder` (#579); `stripItems`, `stripActiveKey`, `stripPick`, `mf-work-strip [segments]` (#581); the control rule in the `_admin-lists.scss` header, `mf-text-field [counter]`, `ADMIN_FIELD_LIMITS`, `.mf-control--fill` (#583); `mf-lookup-dialog` (#564); titles and crumbs on all admin routes, `formCrumbLabel`, sidebar item "Asset Types" (#588); `mf-form-status-cell` (#631). Proof of use: Task Types (states, skeleton columns, strip chips), Workflow Steps (cards), Status labels (rename dialog), Step form (counters); segments and the form status cell are proven by their specs until Users (U-2) and Asset Types / Custom Fields (#634, #644) adopt them. Tests: unit shared, core and admin folders pass (1793; the full suite is flaky under load, `record-header` and a Task Types tag-filter test passed alone when they failed in a loaded run); e2e `ad2-kit-lists`, `ad2-kit-lookup`, `ad2-kit-titles` (axe at 375/768/1024/1366/1920 with the dialog open, no sideways scroll, keyboard, permission variants) and regressions ad2-kit-*, ty1/ty2/ty3, task-types-tabs, ty-record-states, ty-permissions-matrix, column-filters-admin, fixed-header, wp12, assets-screen, admin-menu, ux-round-4, ty-titles-crumbs, ty-form-pattern, ty4 green (the two `*-screens` capture specs fail at 375 px when E2E_SCREENSHOTS is set, an old limit of those specs). Initial bundle 598 kB. Screenshots `fixes/ad2-kit/`. Known limits: asset type description limit is 500 (the API), not 1000 as the issue text says; the asset-type record crumb is plain text until the record page (#635); the Priorities and Link Roles pages adopt the dialog in #609 and #640; a `StatusLabel.Manage`-only person still needs `Task.View` to read the labels until #519.
- WP-AD1 First release and permissions (2026-10-20, lane D, AD-D, `git log --grep "AD-D"`): #519, #523, #526, #533 done; #530, #537, #541 (other lanes) open. #519: `GET /priorities` is `Task.View|Priority.Manage` and `GET /status-labels` is `Task.View|StatusLabel.Manage` (writes unchanged, no contract change, no SQL). #523: `LookupStore` asks only for the lists the person may read; `labelsTabGuard` (in `features/admin/labels-tabs.ts`, on `AdminTab` and `adminMenuTarget`/`resolveAdminTab`) sends the other tab's address, and so the Labels menu item, to the first allowed tab; the tab strip is shown only with both tabs. #533: `auditObjectRoute(item, can)`, plain text without the View permission of the target. #526: the AD-D block of `ty-permissions-matrix.spec.ts` (8 roles, uses the personas helper; axe at 375/768/1366/1920, no sideways scroll, menu item, tab strip, audit links). Tests: backend `AdminReadPermissionsApiTests` (10), unit 1614 + architecture 35 green, frontend unit for lookups, priorities, status-labels, labels-tabs, admin-tabs, audit, denial green; e2e AD-D matrix and the Task Types matrix (12 roles) green, plus admin-menu, permissions, column-filters-admin, sh-403-in-place, ty9-audit, shell-axe-guard, ux-round-4, review-round-5, nav-phone (138 passed, 1 skipped). Initial bundle 598 kB. Screenshots `fixes/ad1-first-release/`. Known limits: the sidebar item keeps the static path `/admin/priorities` (app shell files); the route guard redirects to the first allowed tab, so the end state is the same; the Labels pages keep their current chrome until WP-AD3.
- WP-AD3 Labels: not started.
- WP-AD4 Asset Types: not started.
- WP-AD5 Link Roles: not started.
- WP-AD6 Custom Fields: not started.
- WP-AD7 Audit Logs: not started.
- WP-AD8 States, focus and keyboard: not started.
- WP-AD9 Docs and final verification: not started.
