# Administration pages (Audit Logs, Labels, Assets, Custom Fields): independent UX review, batch 3

> **Status (2026-10-23).** This review is the starting point of epic #518 and has been built (`delivery-plan.md`, section 4 has one status line per package). Decisions: section **Y** of `docs/requirements/decisions-addendum.md`; the pages are specified in `docs/ux/ux-spec.md` S17 to S19. The numbers and screenshots below are the "before" state of 2026-10-20. Where the code differs from this text (three custom-field objects, not four; Move up and Move down, no drag handle), the docs follow the code.

Scope: the small Administration pages, reviewed as a System Administrator and, for permissions, as five administrators who each hold exactly one `*.Manage` / `Audit.View` permission: **Audit Logs** (`/admin/audit`), **Labels** (`/admin/priorities` and `/admin/status-labels`; there is no `/admin/labels` route), **Assets** (`/admin/asset-types`: the Asset Types tab, the Asset Link Roles tab, and the way into the shared form designer for an asset type) and **Custom Fields** (`/admin/custom-fields` and the way into the designer for Client, Matter and Project). The shared form designer was reviewed with Task Types and is not repeated; only how these pages reach it is. Users, Assets (data), Search, Profile, Pod Work and the app shell belong to two other reviews; the Task Types epic, the column-filters re-review (#75) and the keyboard audit are running and are only referenced. Reviewed on `origin/dev` at `48aa4aa`, production Angular build, published API with Dev auth, SQL Server 2022, Playwright Chromium. **No application code was changed and no issues were created.**

Evidence: `screenshots/` (88 PNGs, `<name>-<width>x<height>.png`; 1366x768 unless the name says otherwise, 1920x1080, 768x1024 and 375x812 where it matters; the `r*` files are the reworked Task Types and Clients pages used as the yardstick) and `mocks/` (two before/after HTML mocks with PNGs). Every measurement below (row heights, scroll widths, Tab stops, axe results, load times) was taken in the browser on the seeded data (section 9).

Severity: **major** = an administrator loses time, loses work or cannot do the task at some width or with some permission; **minor** = friction or inconsistency; **nit** = polish. Effort is in AI-agent hours (implementation, unit tests, e2e update; not review time). Bugs (defects against the existing specs and decisions) are listed separately in section 5 as BUG-n; recommendations are the numbered findings.

**Owner decision respected: no keyboard-shortcut recommendations in this review.** The three shortcut ideas that came up are in section 8 (Phase 2 backlog) and nowhere else.

---

## 0. Page inventory

| # | Route | Purpose | Permission |
|---|---|---|---|
| 1 | `/admin/audit` | Audit Logs: every recorded change, newest first; filters, grouping by operation, expandable old/new values, cursor paging | `Audit.View` |
| 2 | `/admin/priorities` | Labels > Priorities: order, label, color, active, default, delete | `Priority.Manage` |
| 3 | `/admin/status-labels` | Labels > Status labels: five fixed statuses, editable display label | `StatusLabel.Manage` |
| 4 | `/admin/asset-types` | Assets > Asset Types: list, inline create/edit form, deactivate, entry to the fields designer | `AssetType.Manage` |
| 5 | `/admin/asset-types?tab=link-roles` | Assets > Asset Link Roles: list, inline rename, add form, reorder, delete | `AssetType.Manage` |
| 6 | `/admin/asset-link-roles` | Redirect to 5 (old address) | `AssetType.Manage` |
| 7 | `/admin/asset-types/:id/form` | Asset type fields: the shared form designer on the type's form | `AssetType.Manage` |
| 8 | `/admin/custom-fields` | Custom Fields: the three objects that carry custom fields and the state of each form | `CustomField.Manage` |
| 9 | `/admin/custom-fields/:object/form` (`client`, `matter`, `project`) | The shared form designer on the object's singleton form | `CustomField.Manage` |

Also reviewed with them: the **two inline forms** (asset type create/edit above the list; link role add form under the list), **four dialogs** (deactivate asset type, delete priority, delete link role, leave without saving) and the phone **Filters sheet** of the Audit page. **9 routes (8 screens and 1 redirect), 2 inline forms, 4 dialogs, 1 sheet.**

Navigation names, as the person sees them: sidebar `Labels` (goes to `/admin/priorities`), `Assets` (goes to `/admin/asset-types`; the page H1 is "Asset Types & Link Roles", the crumb is "Administration > Assets", the tabs are "Asset Types" and "Asset Link Roles"), `Custom Fields`, `Audit Logs`. Spec: S17, S18, S19 of `docs/ux/ux-spec.md`. Existing e2e coverage of these pages is thin and indirect: menu names and the redirect (`admin-menu`), page titles (`ux-round-4`), column filters (`column-filters-admin*`), the audit list and one auditor (`dashboard-audit`), "designer opens without error" (`admin-form-designer-pages`), permissions for Asset Types and Custom Fields only (`ty-permissions-matrix`). **There is no e2e spec for Priorities, Status labels or Asset Link Roles beyond their titles.**

---

## 1. Summary

The five areas are **functionally complete and accessible**: 0 axe violations on all eight screens at 1920, 1366, 768 and 375 (idle) and with every dialog, the inline forms, the filter row and the phone filter sheet open; dirty-state guards on the lookup pages; a duplicate-name message that is clear; deactivating an asset type says how many assets keep it; the audit page groups the events of one operation, reads like sentences, filters live in the address and held 3,000 events in one page without trouble. What is missing is **everything the Dashboard, Clients and Task Types pages gained in the last weeks**. These pages are the last ones on the old look:

- **Not on the list chrome.** Labels, Assets and Audit have no Filters/New in the page header, no tabs with counts, no strip, no 44 px rows (rows are 49 to 136 px; one asset type row is **815 px tall at 375**), no name-is-the-link, text links "Rename / Delete / Edit / Deactivate" instead of the row overflow menu, no phone cards, no "n inactive hidden, Show all", no skip link. Three table stylesheets (`.grid`, `.pg-table`, `.au-table`) and two input styles live in these five pages.
- **Wide tables silently cut off.** At 768 the Priorities table loses Active, Default and Delete (939 px in a 664 px box); at 375 the Audit page shows only When and Who; no cue.
- **Two permission defects.** A person who only holds `Priority.Manage` or `StatusLabel.Manage` gets a broken page and three "You don't have permission" toasts (the read widening of TY-P never reached Labels), and the Audit page links to pages the auditor cannot open.
- **A real layout bug.** The asset type inline form is clipped by its own sticky action bar: at 1366x768 only the Name field is visible; at 1920x1080 Order is cut in half.
- **Thin pages.** Custom Fields is three rows that say nothing about the fields (count, version date, where they show); Status labels show raw codes (`IN_PROGRESS`); Priorities and Link roles do not say how many tasks or links use them, so "Delete" is discovered to be impossible only after the dialog.
- **Focus.** Focus is lost to `<body>` on Back from a designer, when an inline rename starts or is cancelled, and after "Show only this operation"; none of the forms moves focus to the first invalid field (the #361 pattern).

**Counts: 45 numbered findings (35 on the pages: AU1 to AU10, LB1 to LB8, AT1 to AT8, LR1 to LR4, CF1 to CF5; and 10 cross-page points X1 to X10), each page also has a "what works" block, 10 bugs (BUG-1 to BUG-10), 9 work packages, 109 agent-hours.**

### Top 10 findings, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | **Fix the read permissions of Labels**: widen `GET /priorities` and `GET /status-labels` to `Priority.Manage` / `StatusLabel.Manage`, stop the Priorities page from loading status labels, point the "Labels" menu item at the first tab the person may open. Today a Labels-only administrator sees "Couldn't load priorities" and three toasts; a StatusLabel-only one is sent to a 403 page by the menu. | `70-perm-priority-only`, `71-perm-statuslabel-only`, `72-perm-statuslabel-on-priorities` | S, 5 h (API 2 h) | BUG-1, LB1 |
| 2 | **Asset types on the one form-page pattern (#361)** and a small record page: 720 px card, validation summary, focus on the first invalid field, unsaved-changes guard; the inline form that is clipped by its sticky bar and pushes the list down goes away. Header Edit fields (primary), Activity, overflow Deactivate. | `41-asset-type-new-validation-1366x768`, `97-asset-type-new-1920x1080`, `mocks/mock-asset-types.png` | L, 16 h | BUG-2, BUG-4, AT1 to AT3, AT6 |
| 3 | **Lists on the Task Types chrome**: Filters and the primary action in the header, `mf-tabs` with counts (Priorities (8) / Status labels (5); Asset Types (9) / Link Roles (5)), exactly 44 px rows, name is the link, one row overflow, long text clamped with tooltip, "n inactive hidden - Show all", phone cards below 640 px. | `10-asset-types-1366x768` (rows 59 to 113 px), `10-priorities-768x1024`, `mocks/mock-asset-types.png`, `mocks/mock-labels.png` | L, 20 h shared kit | X1 to X5, LB1, LB2, AT3, LR1 |
| 4 | **Phone and tablet that do not cut off**: cards below 640 px for Audit, Priorities, Asset Types, Link Roles; fixed column drop order at 768. | `10-audit-375x812` (what happened and object off screen), `10-priorities-375x812`, `95-priorities-768x1024` | M, in WP2 | BUG-8, AU2 |
| 5 | **Audit links that work for the person who reads them** and config events that name what changed: link only with the View permission of the target, link admin objects to their admin page, API labels for asset type, priority, status label, role; "History" row action on admin records opens the Activity drawer / filtered Audit. | `75-audit-link-403`, `30-audit-config-events` ("Asset type #6") | M, 9 h (API 3 h) | BUG-3, AU3 |
| 6 | **Priorities and Link roles that say what uses them**: an Open tasks / Links count, Delete shown only when unused (otherwise Deactivate with an impact line), one rename/color dialog with live preview and the contrast check, instant-save checkboxes gone. | `34-priorities-delete-refused`, `30-priorities-rename`, `mocks/mock-labels.png` | L, 14 h (API 3 h) | LB2 to LB4, LR1, LR2, BUG-7 |
| 7 | **Custom Fields with substance**: field count, required count, published version and date, draft badge, name is the link to the designer, no POST on view. | `10-custom-fields-1366x768`, `80-custom-field-designer-matter` | M, 8 h (API 3 h) | CF1, CF2 |
| 8 | **Focus and keyboard**: focus to the rename input and back to the row, to the first invalid field, back from a designer to the row, after "Show only this operation"; "Skip to table"; one message per failure. | section 6 | M, 8 h | BUG-6, BUG-7, X7, X8 |
| 9 | **Honest states**: 404 for the asset type and custom field designers ("We couldn't find that asset type."), the Labels error with a reference, the loading skeleton on the real columns, one toast or one inline message. | `51-asset-type-designer-404`, `81-custom-field-designer-unknown`, `100-priorities-loading` | S, in WP8 | BUG-5, X6 |
| 10 | **Names that agree**: menu "Asset Types", H1 "Asset Types", tabs "Asset Types (n)" and "Link Roles (n)" (the Task Types pattern), crumbs "Administration > ..." on every admin page, titles that name the record. | sidebar of any screenshot (two items called "Assets") | S, 3 h | AT5, X9 |

---

## 2. Findings by page

### 2.1 Audit Logs (`/admin/audit`)

Screens: `10-audit-*` (4 widths), `20-` to `30-audit-*`, `73-`, `74-`, `75-`, `96-audit-768x1024`.

**What works.** One line per operation ("Step 'Quality Control Check' completed and 10 related changes (11 events in one operation)") with the field-level changes folded behind "View n field changes"; events read as sentences; Who filter lists people with inactive ones flagged; every filter is in the address and shown as a removable chip; "Show only this operation" is a shareable address; the error state has a reference and Retry (`27-audit-error`); the loading state is a skeleton; read only, by decision (addendum F), and the page says so. Measured scale: 60 clicks of Load more loaded 3,000 events (315 grouped rows, 3,050 ungrouped rows) in 8.2 s with 4,122 DOM nodes and the page stayed responsive; no end was reached. Axe: 0 violations at four widths, with the filter row, a detail and the phone sheet open.

**AU1 (major, M, 5 h): list chrome is not the Task Types chrome.** The filter row is closed by default at every width (`10-audit-1366x768`) and the Filters button sits on a row of its own next to the "Group events of one operation" checkbox; the description is cut at 1366 ("The log is read only and can..."); there is no crumb; the Clear filters link appears in a third place (`24-audit-one-operation`). Decision V: the filter row is open by default from 640 px with Filters and Clear in the page header. Recommendation: header = Audit Logs + crumb `Administration > Audit Logs`, header actions Filters (with the count) and Clear filters, filter row open by default from 640 px (remembered per user), the grouping checkbox becomes a small toolbar toggle right-aligned above the grid, the description shortened to what fits one line at 1366 ("Every recorded change, newest first. Read only.") and the time-zone sentence moved to the When column's tooltip and the date filter's helper line.

**AU2 (major, M, 6 h): tablet and phone.** At 768 every row is 117 to 136 px (the Object link wraps to three lines); at 375 only the details toggle, When and Who are visible and the table scrolls sideways to reach **What happened and Object with no cue**, each row 136 px of mostly white (`10-audit-375x812`, `96-audit-768x1024`). Recommendation: `mf-record-card-list` below 640 px: line 1 what happened (two lines, clamped), line 2 `Test User 50 - Oct 20, 12:27 AM`, line 3 the object link, the chevron opens the same details; at 768 Who joins the When cell (two lines) so What happened and Object stay on screen; the table keeps all five columns from 1100 px.

**AU3 (major, M, 6 h incl. API 3 h): Object links ignore permissions, and configuration events do not name what changed.** (BUG-3.) Every Task, Matter, Client, Asset and Project object is a link; a person with only `Audit.View` clicking "Task: TSK-197..." lands on the 403 page (`75-audit-link-403`); `User` objects link to `/admin/users` whatever the permission. The decision of epic #245 says a link exists only when its target opens. In the other direction the objects an administrator most wants to open from the log, the configuration, are plain text and unnamed: an asset type edit reads `Description set to Updated description` with object **"Asset type #6"**, a status label rename reads `Status label ON_HOLD`, priorities read `Priority #8` (`30-audit-config-events`). Recommendation: (1) `auditObjectRoute` takes the viewer's permissions and returns null (plain text) without `Task.View`, `Matter.View`, `Client.View`, `Asset.View`, `Project.View` or `User.View`; (2) admin objects link to their admin page with the matching `*.Manage` permission (asset type to its record, priority and status label to the Labels tab, role to Roles, task type, workflow and step to theirs); (3) the API fills `object.label` for AssetType, Priority, StatusLabel, AssetLinkRole, Role, FormDefinition (today it is null for them), so the row reads "Asset type: Relativity Workspace".

**AU4 (minor, S, 2 h): the filters speak codes, the grid speaks sentences.** The Event type select lists `COMMENT_ADDED`, `FIELD_CHANGED`, `TASK_TYPE_WORKFLOWS_CHANGED`; the Object type select lists `AssetLinkRole`, `FormDefinition`, `StepDefinition`, `FormValueSet` (`20-audit-filters-open`). `audit-format.ts` already has `objectTypeLabel`. Recommendation: friendly option labels ("Comment added", "Asset link role", "Workflow step", "Form answers"), the code stays as the option value and as the muted second text in the details.

**AU5 (minor, S, 2 h): row anatomy.** The Object link wraps to three lines (`Task comment on TSK-197 Review Setup and Batching - 14`); each grouped row repeats the text button "Show only this operation" and the details repeat it again; viewing one operation shows a chip, a banner "Showing the events of one operation. Show all events", a Clear filters link and the filter row (`24-audit-one-operation`), four ways to undo one filter, which contradicts the "one Clear filters at a time" decision (addendum X, 1). Recommendation: clamp the object at two lines with the full text as tooltip, "Show only this operation" moves to the details and to a row overflow, and the banner goes (the chip and the header Clear are enough).

**AU6 (minor, M, 4 h): details.** The inline accordion shows `Event COMMENT_ADDED`, `Field Purpose (purpose)`, `Old value (empty)`, `New value NORMAL` and a GUID for a "Comment added" row (`21-audit-detail-open`): internal vocabulary, and the comment itself is not shown. The toggle's accessible name is "Show details of event 10062", an internal id. Recommendation: accessible name "Show details: Comment added by Test User 50"; the details lead with a readable sentence and an `Old -> New` pair for field changes; Event code, Operation GUID and Field key move under a "Technical details" disclosure; "Show full" for values that are truncated (S19 asks for it; the current text says "(shortened)" without a way to see the rest).

**AU7 (minor, S, 2 h): scale.** 50 events per click, no count of what is loaded and no hint when the list gets long. 1,000 events means 20 clicks; there is no way to reach "last Friday" except the When filter, which is fine but not suggested. Recommendation: a muted line next to the button, "150 events loaded", announced politely; after 1,000 loaded events the line adds "Narrow the date range to find older events" with the When control focused on click. No virtualization needed at the measured size.

**AU8 (minor, S, 3 h): quick views.** The When presets (Today, Last 7 days, Last 30 days, This month) hide inside the date popover. Recommendation: four quick-view chips above the grid, the Task Queue quick-view pattern: Today, Last 7 days, Configuration changes (object types of the admin areas), Access changes (user, role, pod events). They are filters, not counts, so no API.

**AU9 (nit, M, 3 h): repeated date and time.** `Oct 20, 2026, 12:27 AM EDT` is printed on every row and takes 190 px. Recommendation: a day divider row ("Today", "Oct 19") and the time only in the When column (`12:27 AM`), the full date and zone as tooltip; the width goes to What happened.

**AU10 (nit, S, 1 h): the Who filter without User.View** shows "Who (user id)" and a number box; administrators do not know ids. With `Audit.View` alone the better behaviour is to type-ahead over the names present in the loaded events. Low priority; recorded.

### 2.2 Labels: Priorities (`/admin/priorities`) and Status labels (`/admin/status-labels`)

Screens: `10-priorities-*`, `10-status-labels-*`, `30-` to `37-`, `70-` to `72-`, `95-`, `98-`, `100-priorities-loading`, `101-`, `102-`.

**What works.** One page, two tabs, the right permission on each tab; the live badge preview and the 4.5:1 contrast check on Add (`32-priorities-contrast`); exactly one default, and the default cannot be deactivated or deleted; the unsaved-changes guard asks before leaving with a half-typed label or an open rename (verified); reorder with real buttons that name the row ("Move Critical down"); the delete dialog is a danger dialog with a "Keep priority" cancel; duplicate names are refused; status labels are read-only for the code and the badge previews the typed label live (`37-status-label-long-preview`). 0 axe violations.

**LB1 (major, M, 4 h): the page identity.** Hand-made anchor tabs (`nav.tabs`, its own CSS in `admin-lookup.scss`) instead of `mf-tabs`: no arrow-key tab pattern, no counts, a different look from Users, Task Types and Assets; no crumb (Task Types and Assets have `Administration > ...`); the sidebar item is "Labels" and goes to Priorities even for a person who may only open Status labels (BUG-1). Recommendation: `mf-tabs` as route tabs, `Priorities (8)` and `Status labels (5)`, crumb `Administration > Labels`, title `Labels - Priorities`, the first tab the person may open, the menu item points at it.

**LB2 (major, L, 8 h): the Priorities row is seven controls.** Order handle, up, down, a Rename link, a color select (plus a native color input for Custom), an Active checkbox, a Default radio, a red Delete link: **six Tab stops per row** (about 45 for the 8 seeded rows); the word is shown twice (the badge and the Label cell); the table is 939 px wide in a 664 px box at 768, so **Active, Default and Delete are off screen with no cue** (`95-priorities-768x1024`); at 375 only Order and Priority are visible; the table lives in a nested scroll region (391 px for 442 px of rows) that clips the eighth row at 1366x768 while the Add form sits below it (`10-priorities-1366x768`). Rows are 49 px, not 44. Recommendation (`mocks/mock-labels.png`): grid contract with **Order** (number), **Priority** (the badge; a neutral "Default" badge next to it), **Color** (swatch and name), **Open tasks** (a link to the Task Queue filtered by the priority; API), **Status** and the row overflow (Rename, Change color, Move up, Move down, Set as default, Deactivate, Delete when unused). Rename and color are one "Edit priority" dialog with the live badge and the contrast message (the existing validator); "New priority" in the header opens the same dialog; the Add form under the table goes. Cards below 640 px.

**LB3 (major, S + API, 5 h): "Delete" is offered next to a priority that cannot be deleted.** Deleting High (used by tasks) opens a danger dialog "Delete priority? ... A priority that tasks use can't be deleted; deactivate it instead", the person confirms, and the page answers **twice with different words**, an inline red line "Tasks use High, so it can't be deleted. Deactivate it instead." and a toast "Tasks use this priority, so it cannot be deleted. Deactivate it instead." (`34-priorities-delete-refused`; BUG-7). The disabled Delete of the default row explains itself only through a `title` attribute, which keyboard users never see. Recommendation: with the Open tasks count the page knows: **Delete appears in the overflow only for an unused priority**; otherwise the action is Deactivate with the shared impact line ("31 open tasks keep this priority. It won't be offered for new or changed tasks. You can activate it again."), through `dialog-copy` like the Task Types dialogs; the default row's overflow says why Delete and Deactivate are missing in a visible sentence in the dialog or the header note, not in a `title`.

**LB4 (minor, S, 2 h): instant saves without undo.** The color select, the Active checkbox and the Default radio save the moment they change (a slip on "Critical red" recolors Critical for everyone in the firm), while every other admin edit has Save and Cancel and an unsaved guard. Recommendation: the dialog of LB2 saves color; Active becomes Activate/Deactivate in the overflow with the impact line; Set as default is an overflow action with a one-line confirmation ("Normal is the default priority. New tasks start with it.").

**LB5 (minor, M, 3 h, API 1 h): Status labels say little.** Columns Internal code (`NEW`, `IN_PROGRESS`, `ON_HOLD`), Preview, Display label with a Rename text link; 49 px rows (`10-status-labels-1366x768`). The raw enum is exposed to an administrator who does not need it, and nothing says where a label appears or how many tasks carry the status. Recommendation: Name = the badge with the display label; the default name muted when renamed ("Waiting - was On Hold"); the internal code as a tooltip and in the rename dialog; **Open tasks** as a link to the Task Queue filtered by the status (the Task Queue has a Status filter; the address parameter is to be confirmed in WP3); Rename in the row overflow; 44 px rows; cards on a phone. A renamed status should also say in one line where it shows ("Task Queue, My Work, Dashboard, task pages").

**LB6 (minor, S, 1 h): two input styles and two button systems on one page.** The inline rename input is `.text` (own class), the Add form's is `.mf-control`; Save and Cancel are small PrimeNG `p-button`s, the row actions are `.mf-btn--text`. One input class and one button component (cross-page X3).

**LB7 (minor, S, 1 h): loading and failure states.** The Priorities loading state replaces the whole table, header row included, with six equal skeleton columns that look nothing like the loaded table (`100-priorities-loading-1366x768`); `mf-list-state` has no reference id on failure. Use the shared grid-body skeleton on the real columns and the error reference (X6).

**LB8 (nit, S, 1 h): hint text.** Two paragraphs ("Drag a row or use the arrows to reorder. Exactly one priority is the default." above the table; "Existing tasks keep a deactivated priority..." below it) stand in for the page description. Move them into the header description and the dialogs where the rule applies.

### 2.3 Assets: Asset Types (`/admin/asset-types`)

Screens: `10-asset-types-*`, `40-` to `46-`, `50-`, `51-`, `90-` to `94-`, `97-`, `100-asset-types-loading`, `101-`.

**What works.** Server filters (Name, Status) in the address with chips; the deactivate dialog says how many existing assets keep the type ("The 12 existing assets keep this type") and that it can be activated again; the grid-body states (skeleton, no-match with Clear filters, error); versioned fields explained in one sentence; Edit fields is one click from the row and the designer loads the published form with Retire / Create new draft; duplicates are refused with a clear message; a type with `AssetType.Manage` alone opens the list and the designer (TY-P). 0 axe violations including the open form and the dialog.

**AT1 (major, S, 3 h, BUG-2): the inline form is clipped by its own sticky action bar.** The create/edit form sits above the list in a box of about 200 px with `mf-form-actions--sticky` inside it: at 1366x768 **only the Name field is visible**, Description and Order are scrolled inside the card behind the Save bar; with a validation error the summary, the Name label and the second copy of "Enter a name." (under the bar) are all squeezed into the same 200 px (`41-asset-type-new-validation-1366x768`, `42-asset-type-edit-1366x768`); at 1920x1080 Order is still cut in half (`97-asset-type-new-1920x1080`). Focus stays on the button that opened the form, and after a failed submit on the submit button instead of the Name field (#361). The form also pushes the list 200 to 400 px down and the Edit button of the row you clicked is below it. Folded into AT2; if the owner wants a quick patch first it is a one-hour CSS fix.

**AT2 (major, L, 10 h): asset types need the one form-page pattern, and a small record page.** Recommendation: `/admin/asset-types/new` and `/admin/asset-types/:id` (the clients pattern, `docs/ux/ux-spec.md` 5.9): `mf-record-header` with the name, the Active badge, **Edit, Activity, Edit fields (primary)** and an overflow (Deactivate / Activate); tabs **Overview** (the 720 px form card: Name with counter, Description with counter, Active; validation summary; focus on the first invalid field; sticky Save and Cancel; unsaved-changes guard), **Fields (n)** (a read-only summary of the published version and the draft with the primary action to the designer) and **Assets (n)** (link to the Assets list for this type when that filter exists; to confirm). Activity is the existing Activity drawer filtered to the type (Audit.View). New asset type is the same page with a plain header. This also answers AT6 and BUG-4.

**AT3 (major, M, 6 h): the list is not on the grid contract.** Rows are 59 px at 1366 (113 px for the long-name type), 95 to 293 px at 768 and **239 to 815 px at 375** because the description is not clamped and the narrow table wraps every word (`101-asset-types-long-name-375x812`); the name is bold text, not the link; the Fields cell carries two lines and a link; **Edit** and **Deactivate** are text buttons with long `aria-label`s (3 Tab stops per row, 30 for ten types); the Filters button has its own 52 px row; there is no strip; the default Status filter hides "Legacy Archive Tape" without saying so (decision V, addendum X 2); the list is fixed at 100 rows and has no pager (fine until the 101st type). Recommendation (`mocks/mock-asset-types.png`): Filters and **New asset type** in the header; strip **Active, No published fields, Inactive** (client side, the list loads whole); exactly 44 px rows; **Name** (the link, clamped at two lines with tooltip; the description moves to the record page), **Fields** (`v1 - 8 fields`, or a warning badge "No published fields"), **Assets** (a number, link when the Assets list can filter by type), **Status**, overflow (Edit fields, History, Deactivate); the pager line "9 active - 1 inactive hidden - Show all"; cards below 640 px.

**AT4 (minor, S + API, 3 h): the Fields cell and the Custom Fields page describe the same thing differently.** Asset Types: `Published v1` + link; Custom Fields: a badge `Published v1` and "(draft in progress)"; neither gives a field count, a date or the draft. Recommendation: one `FormStatusCell` for both lists (badge Published v1 / Draft v2, "8 fields", "Updated Oct 12"), the count and date as additive fields on the asset type response and on the custom-field forms summary (CF2).

**AT5 (minor, S, 1 h): names.** Sidebar "Assets" (a second one, under Administration, next to the first "Assets" data list: both appear in every screenshot), crumb "Assets", H1 "Asset Types & Link Roles", tab "Asset Link Roles", title "Asset Types & Link Roles - Asset Types", button "New asset type". Recommendation, the Task Types pattern: sidebar **Asset Types**, H1 **Asset Types**, tabs **Asset Types (9)** and **Link Roles (5)**, crumb `Administration > Asset Types`, titles `Asset Types` and `Asset Types - Link Roles`. The two "Assets" items stop being confusable.

**AT6 (minor, M, 3 h): Order is a number box.** "Order 90" with a spinner, while Priorities and Link roles order with Move up/down and drag. Recommendation: remove the number; Move up and Move down in the row overflow (the API orders by `sortOrder`; the client swaps the two values, or an additive reorder endpoint takes the list).

**AT7 (minor, S, 2 h): the way into the designer.** Today the "Edit fields" link lives in the Fields cell. The designer opens without `Administration` in the crumb (`Asset Types & Link Roles > Relativity Workspace > Form`, the middle crumb is not a link), the title is the static "Asset type fields", the H1 "Form: Relativity Workspace" speaks of a form while the list says fields, and **Back returns with focus on `<body>`** (BUG-6). Recommendation: with AT2 the primary action Edit fields on the record header, crumb `Administration > Asset Types > Relativity Workspace > Fields`, title "Relativity Workspace: Fields", Back returns to the record with focus on its primary action (the `drill.ts` rule).

**AT8 (nit, S, 1 h): inline create in a fixed-height page.** Even after the fix, a form above a scrolling table is the one place in the admin area that mixes form and list; it disappears with AT2.

### 2.4 Assets: Asset Link Roles (`/admin/asset-types?tab=link-roles`)

Screens: `10-link-roles-*`, `60-` to `63-`, `92-link-roles-phone`.

**What works.** Source, Destination, Subject, Result are there; add, rename, reorder (buttons and drag), activate/deactivate, delete; the duplicate-name error has an icon and the message ("A link role named 'Source' exists."); the leave-without-saving dialog appears when a rename is open and the tab is switched (`63-link-role-leave-dialog`); the old address redirects. 0 axe violations.

**LR1 (major, M, 5 h): a different page from its sibling tab.** The Link Roles tab has an Order column with handle and arrows, Name with inline rename, an Active **checkbox**, Rename and a red **Delete**, and an Add form under the table; the sibling Asset Types tab has Edit and **Deactivate**, a Filters button and an inline form above the table. Two lifecycle verbs (a checkbox and Delete here, Deactivate there), two form positions, one tab with filters and one without, 49 px rows. Recommendation: same chrome as Asset Types and Priorities: header action **New link role** opening a one-field dialog (the dialog rule of 5.4: a short form is a dialog), rename in the same dialog, status badge, overflow (Rename, Move up, Move down, Deactivate / Activate, Delete when unused), 44 px rows, cards below 640 px.

**LR2 (minor, S + API, 3 h): usage is invisible.** "Delete" is offered on every row; the dialog says "A role that links use can't be deleted; deactivate it instead" and the refusal arrives after the click. Recommendation: a **Links** count (the number of task-asset links using the role; additive field), Delete only when 0, else Deactivate with the impact line ("14 links keep this role. It won't be offered for new links.").

**LR3 (minor, S, 1 h): two intro paragraphs, 102 px rows at 375.** "How an Asset relates to a Task..." and "Drag a row or use the arrows..." above the table; at 375 a long name wraps the Name cell to 102 px. Fold the first into the tab description and the second into the overflow wording; clamp the name.

**LR4 (nit, S, 0.5 h): the name field allows 50 characters**, the Asset Types name 100; fine, but the Add form has no counter while the Task Types forms do (X3).

### 2.5 Custom Fields (`/admin/custom-fields`) and its designer entry

Screens: `10-custom-fields-*`, `80-custom-field-designer-client|matter|project`, `81-custom-field-designer-unknown`, `82-custom-fields-error`, `100-custom-fields-loading`.

**What works.** The three objects are listed with the state of each form: `Published v1`, `Published v1 (draft in progress)`, `No custom fields`; the row is a clean 44 px; Edit fields opens the shared designer; the error state has a reference and Retry; a person with only `CustomField.Manage` opens the list and all three designers; 0 axe violations on the list and the designers.

**CF1 (major, M, 6 h incl. API 3 h): three rows that say nothing about the fields.** An administrator cannot see how many fields exist, how many are required (addendum P: a required field blocks saving old records), when the form was last published, by whom, or where the fields appear (Client Overview, Matter Overview, Project Details and the create/edit screens). The name is not the link; the only action is a text link "Edit fields" at the far right (`10-custom-fields-1366x768`). Recommendation: columns **Object** (the link to the designer; the object icon of Clients, Matters, Projects), **Fields** (`8 fields, 2 required`), **Published** (`v1 - Oct 12`), **Form** badge (Published v1 / Draft v2 in progress / No fields yet) and the row overflow (Edit fields, History); the description says where fields show in one sentence. A strip adds nothing for three rows and is not recommended.

**CF2 (minor, S + API, 4 h): the list writes on read.** `CustomFieldsPage.load()` calls `ensureFormDefinition` (a POST to `/forms`) three times on every visit ("Idempotent: provisions the singleton definition the first time an admin looks at it"). The first visit creates three `FORM_DEFINITION_CREATED` audit events caused by looking, and one failed call turns the whole page into "We couldn't load the custom field forms." (`82-custom-fields-error`). Recommendation: a read endpoint that returns the three objects with their form summary (field count, required count, published version and date, draft id) and `none` for an object without a definition; provisioning happens on the first Edit fields. This also delivers the counts of CF1 and AT4.

**CF3 (minor, S, 1 h): description.** 150 characters, cut at 1366 ("...and existing r..."), three lines at 375. "Extra fields on Clients, Matters and Projects. Publishing a new version never changes saved values." fits one line; the rest goes in a tooltip.

**CF4 (minor, S, 2 h): the designer entry.** Crumb `Custom Fields > Matter custom fields > Form` (no `Administration`, middle crumb plain), static title "Custom Fields form", H1 "Form: Matter custom fields" with `Draft v2 (published: v1)` (the verb of the list is "Edit fields"), **Back returns with focus on `<body>`**, and an unknown object (`/admin/custom-fields/nothing/form`) shows "Something went wrong. Try again." with Retry instead of a not-found state (BUG-5, `81-custom-field-designer-unknown`). Recommendation: crumb `Administration > Custom Fields > Matter`, title "Matter custom fields", H1 "Matter custom fields" with the version badge, 404 "We couldn't find that object.", focus back to the row (X7).

**CF5 (nit, S, 0.5 h): spec drift.** S18 and UAT-S18-4 name four objects (Client, Matter, Project, Asset); the app has three, and asset-specific fields live with the asset type (that is what S18 says in its last sentence). Update the UAT line.

### 2.6 The way into the designers (Asset Types and Custom Fields)

Both pages reach the shared designer through a text link; the designer then lands on the same shell as Task Types. Covered under AT7 and CF4. One cross-cutting point: the designer pages use `data.heading` and `sectionPath` instead of the record crumbs, which is why they lack `Administration` (X9).

---

## 3. Cross-page consistency

The yardstick is the reworked Task Types area (`r1-task-types-1366x768`, `r4-task-type-record-1366x768`, `r3-task-type-new-1366x768`) and the Clients records (`r2-clients-1366x768`).

| Aspect | Task Types / Clients (reworked) | Audit | Priorities | Status labels | Asset Types | Link Roles | Custom Fields |
|---|---|---|---|---|---|---|---|
| Crumb `Administration > X` | yes | no | no | no | yes | yes (shared) | no |
| Header actions (Filters, New) | in the header | Filters beside a checkbox | New is the Add form below | none | `New asset type` on the intro row, Filters on its own row | Add form below | none |
| Tabs | `mf-tabs` with counts | none | hand-made links | hand-made links | `mf-tabs`, no counts | `mf-tabs`, no counts | none |
| Summary strip | `mf-work-strip` | none | none | none | none | none | none |
| Filter row open from 640 px | yes | closed | no filters | no filters | closed | no filters | no filters |
| Row height | 44 px | 49 to 136 | 49 | 49 | 44 to 113 (815 at 375) | 49 | 44 |
| Name is the link | yes | n/a | no | no | no | no | no |
| Row actions | overflow `...` | details toggle + text buttons | 6 controls | Rename link | Edit, Deactivate, Edit fields (3 stops) | Rename, Delete, checkbox | Edit fields text link |
| "n inactive hidden - Show all" | yes | n/a | n/a | n/a | missing | n/a | n/a |
| Phone cards below 640 px | yes | no (cut off) | no (cut off) | scrolls | no (cut off) | scrolls | scrolls |
| Form | form page, 720 px card (#361) | n/a | inline row + Add form | inline row | **inline form, clipped** | inline row + Add form | n/a |
| Lifecycle word | Deactivate / Activate | n/a | Active box + Delete | n/a | Deactivate | Active box + Delete | n/a |
| Impact line in the confirm | yes (task types) | n/a | no | n/a | yes (asset count) | no | n/a |
| Skip link | yes (record lists) | no | no | no | no | no | no |
| Back focus | row | n/a | n/a | n/a | `<body>` | n/a | `<body>` |
| 404 / failure state | shared record state | grid-body with reference | `mf-list-state`, no reference | same | designer: "Something went wrong" | same | designer: same |
| Document title | page and tab | "Audit Logs" | "Labels - Priorities" | "Labels - Status labels" | "Asset Types & Link Roles - Asset Types" | "... - Link Roles" | "Custom Fields" |
| Permission read rule (TY-P) | yes | yes | **no** | **no** | yes | yes | yes |

**X1 (major, L, 18 h): one admin list kit.** Extract from the Task Types shell the pieces that the five pages need and use them everywhere: header with crumb, Filters (with count) and the primary action; route `mf-tabs` with counts; the optional strip; one table stylesheet on the 44 px grid contract (retire `.grid`, `.pg-table`, `.au-table`); `mf-grid-body` states; `mf-record-card-list` below 640 px; the row overflow `mf-action-menu`; the "n inactive hidden - Show all" pager line; "Skip to table". The Task Types page is the template; this is the cheapest way to make four pages look right at once, and it is WP2.

**X2 (minor, S): tabs with counts.** `Priorities (8) | Status labels (5)` and `Asset Types (9) | Link Roles (5)`; Active counts (the default filter), `--` while loading, muted zero. The Task Types decision of P2 applies.

**X3 (minor, M, in WP2): one control kit.** In this batch: inputs `.text`, `.select`, `.mf-control`, `.pg-input`; buttons `p-button` and `.mf-btn`; links `.pg-link`, `.mf-btn--text`; danger red text links "Delete" / "Deactivate" in the grid, which the Task Types and Clients lists no longer have. One input class, one button component, no red text links in rows (the overflow's Deactivate / Delete item carries the danger look). Dead rules in `audit-page.scss` (`.au-filters`, `.au-field`, `.au-suggest`, `.au-buttons`, `.au-bar`, `.au-error`, `.au-alert`) belong to the pre-#75 filter form and can go.

**X4 (minor, S): one lifecycle vocabulary.** The product says Active / Inactive and Deactivate / Activate for records (Task Types review, section 3 item 5). Priorities and Link roles use an Active checkbox plus a hard **Delete** that only works for unused rows; Asset Types uses Deactivate. Rule for these pages: **Deactivate / Activate everywhere; Delete exists only for Priorities and Link roles, only when unused, only in the overflow**, always through `dialog-copy` with `impactLine` (the table of wording lives in `features/admin/shared/dialog-copy.ts`, which today covers Task Types only; add `deactivateAssetType`, `deactivatePriority`, `deleteLinkRole`, `deleteUnusedPriority`).

**X5 (minor, S): description lines.** The H1 description is one sentence that fits one line at 1366 (Audit and Custom Fields are cut, Labels says two different things on its two tabs; that one is fine), the helper paragraphs above and below the tables go into the description, tooltips or dialogs.

**X6 (minor, M, in WP8): states.** Lists: skeleton on the real columns (Priorities, Status labels and Link roles use `mf-list-state` that swaps the whole table including its header for six equal bones), error with reference (Labels have none), empty, no-match with Clear filters (only Asset Types and Audit have it). Pages: the designers' 404 reads "Something went wrong. Try again." (extend `RecordKind` with `assetType` and `customField`, as the Task Types epic did for `taskType`, `workflow`, `step`). One message per failure: a refused delete currently writes an inline line and a toast with different words.

**X7 (minor, M, in WP8): focus.** Rename start, rename cancel, Back from a designer, "Show only this operation" and the open of the asset type form all leave focus on `<body>` or on the button that is no longer relevant; failed submits do not focus the first invalid field. The helpers exist (`list-return.ts`, `drill.ts`, `focusById`); the lookup pages do not use them.

**X8 (minor, S, in WP8): skip links.** None of the five pages has "Skip to table"; Tab stops before the first row are 22 (Audit with the filter row closed; 27 open), 22 (Priorities, Status labels), 23 (Asset Types) and 21 (Link roles), then 6, 1, 3 and 5 stops per row; with the overflow, Priorities falls from 6 to 2 per row. Recorded, not gated (the lesson of section U).

**X9 (minor, S, 3 h): names, crumbs, titles, icons.** Two sidebar items called "Assets" (data list, admin set-up); Labels and Custom Fields and Audit Logs have no crumb; designer crumbs and titles are static. Icons are consistent (flag, tags, sliders, history, the same in the H1), keep. See AT5.

**X10 (minor, M, in WP1): the permission rule TY-P stops at four permissions.** `permissions.md` of the Task Types epic widens reads for `TaskType.Manage`, `Workflow.Manage`, `AssetType.Manage`, `CustomField.Manage`. `Priority.Manage` and `StatusLabel.Manage` were left out and fail (BUG-1); `Audit.View` is fine for the list but its links are not (BUG-3). Extend the table, the integration test `AdminReadPermissionsApiTests` and `ty-permissions-matrix.spec.ts` to the Labels and Audit roles.

---

## 4. Per-page what changes, in one view

- **Audit**: Task Types chrome (AU1), cards and 768 columns (AU2), permission-aware links and named config events (AU3), friendly filter options (AU4), simpler rows (AU5), readable details (AU6), counter and hint (AU7), quick views (AU8), day dividers (AU9).
- **Labels**: `mf-tabs` with counts and crumb (LB1), grid contract with Open tasks and overflow (LB2), delete only when unused with impact line (LB3), edit dialog, no instant saves (LB4), Status labels with usage (LB5).
- **Asset Types**: form page and record page (AT1, AT2), grid contract and strip (AT3), field count and draft (AT4), names (AT5), reorder via overflow (AT6), the designer entry (AT7).
- **Link Roles**: same chrome and dialog as Asset Types (LR1), usage count (LR2).
- **Custom Fields**: counts, dates, name as link (CF1), no POST on view (CF2), designer entry (CF4).

---

## 5. Bug list (with repro)

Environment: `origin/dev` `48aa4aa`, Playwright Chromium 1366x768, Dev auth, `America/New_York`, seed in section 9.

| ID | Sev | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | major | **A person with only `Priority.Manage` or only `StatusLabel.Manage` cannot use Labels.** `GET /priorities` (and, from the Priorities page, `GET /status-labels`) answer 403; the page shows "Couldn't load priorities." with Retry and **three** "You don't have permission to do that." toasts. With only `StatusLabel.Manage` the Labels menu item points at `/admin/priorities`, which shows the 403 page; the Status labels tab is reachable only by typing the address, where it fails the same way (`GET /status-labels` 403). | Users `ke\ar-priority`, `ke\ar-statuslabel` (one custom role each): `/admin/priorities`, `/admin/status-labels` (`70-`, `71-`, `72-`) | Rule 1 of `permissions.md`: each `*.Manage` permission is enough to read what it manages; no refused request on a page the person may use; the menu item opens the first tab allowed. |
| BUG-2 | major | **The asset type create/edit form is clipped by its sticky action bar.** 1366x768: only Name is visible and the error summary, the Name label and a second "Enter a name." under the buttons share about 200 px; 1920x1080: Order is cut in half; focus stays on the opener (and on the submit button after a failed submit). | `/admin/asset-types` > New asset type > Create asset type (`41-`, `42-`, `97-`) | Whole form visible, summary at the top, focus on the first invalid field (#361). |
| BUG-3 | major | **Audit object links ignore permissions.** Task, Matter, Client, Asset, Project and User objects always link; an `Audit.View`-only person lands on the 403 page. Admin configuration objects (asset type, priority, status label, link role, role) have no link and no name ("Asset type #6"). | `ke\ar-audonly`: `/admin/audit` > first Task link (`75-`); `30-audit-config-events` | A link only when the target opens (addendum V); admin objects link to their admin page; names from the API. |
| BUG-4 | minor | **A half-typed asset type is lost silently.** Open New asset type, type a name, switch to the Asset Link Roles tab or navigate away and Back: no "Leave without saving?" (Priorities and Link roles have it). | `/admin/asset-types`, New asset type, type "Half typed", click the Link Roles tab | The same guard as the other lookup pages. |
| BUG-5 | minor | **Designer 404 reads as a load failure.** `/admin/asset-types/99999/form` and `/admin/custom-fields/nothing/form` show "Something went wrong. Try again." with Retry and no crumb or header; Retry can never succeed. Same family as BUG-1 of the Task Types review. | the two addresses (`51-`, `81-`) | "We couldn't find that asset type." / "...that object." with the link back, header kept. |
| BUG-6 | minor | **Focus is lost.** After Back from an asset type or custom field designer focus is `<body>` (not the row left); starting or cancelling an inline rename on Priorities, Status labels and Link roles leaves focus on `<body>` (the input is not focused, Escape does not return it); "Show only this operation" leaves `<body>`; opening New / Edit asset type leaves focus on the opener. | measured with `document.activeElement` | Focus to the rename input and back to the row's Rename button; to the row on Back; to the filter chip or the grid after "Show only this operation" (decision V keyboard rules). |
| BUG-7 | minor | **A refused delete is reported twice with different words:** inline "Tasks use High, so it can't be deleted. Deactivate it instead." plus a toast "Tasks use this priority, so it cannot be deleted...". Link roles do the same. | Priorities > Delete High > Delete priority (`34-`) | One message. |
| BUG-8 | minor | **Tables are cut off with no cue:** Priorities at 768 (939 px in a 664 px box: Active, Default, Delete off screen) and at 375 (only Order and Priority visible); Audit at 375 (What happened and Object off screen, rows 136 px); Asset Types at 375 (Status and actions off screen, a row of 815 px); Asset Types at 768 (rows up to 293 px). | `10-*-375x812`, `95-priorities-768x1024` | Cards below 640 px, never an invisible action (same defect as BUG-2 of the Task Types review). |
| BUG-9 | nit | **Static or wrong titles and crumbs:** the designers' titles ("Asset type fields", "Custom Fields form") do not name the record; their crumbs lack `Administration`; Labels, Custom Fields and Audit have no crumb at all. | page titles read on all 9 routes | `Relativity Workspace: Fields - MatterFlow`; `Administration > ...` on every admin page. |
| BUG-10 | nit | **The default Status filter hides rows without saying so on Asset Types** ("Legacy Archive Tape" is inactive and invisible; no "1 inactive hidden - Show all"), unlike Clients and Task Types (addendum V and X 2). | `/admin/asset-types` with one inactive type | The pager line and Show all. |

Not bugs (checked): the unsaved-changes guards of Priorities, Status labels and Link roles work; duplicate-name errors are clear; the default priority cannot be deleted or deactivated; deactivating an asset type names the number of assets; the redirect `/admin/asset-link-roles` works; no horizontal page scroll at 375 on any page (the tables scroll inside their box); 0 axe violations in all measured states.

---

## 6. Keyboard, focus and accessibility basics

- **Tab model.** Tab stops before the first row at 1366: Audit 22 (filter row closed) or 27 (open), Priorities and Status labels 22, Asset Types 23, Link roles 21. Per row: Audit 2 to 3 (details toggle, object link, "Show only this operation"), Priorities 6, Status labels 1, Asset Types 3, Link roles 5, Custom Fields 1. With the overflow and name-is-the-link: 2 per row on Priorities, Asset Types, Link roles. Recorded, not gated.
- **Skip links.** None of the five pages offers "Skip to table" (decision V puts one on the record lists).
- **Dialogs.** Escape closes; focus enters on the safe button ("Keep active", "Keep priority") and returns to the opener (verified for the asset type and the priority dialog). The delete dialog of Priorities and Link roles does not use `dialog-copy`.
- **Focus after actions.** Rename start and cancel: `<body>` (BUG-6). After a successful rename the row re-renders; the Rename button should regain focus. After Load more the focus stays on the button, which is right; the 50 new rows are announced by the polite region ("Showing n audit events").
- **Reordering.** Real buttons named after the row, plus HTML5 drag as a pointer shortcut. A keyboard shortcut for reordering is in the Phase 2 backlog (section 8).
- **Disabled controls.** The disabled Delete of the default priority and the disabled Active of the default row explain themselves through `title`/tooltips only (LB3).
- **Colour.** Status is badge text plus icon (Active, Published, Draft), never colour alone. Delete and Deactivate are red text links in the grid, which the reworked lists no longer have; the destructive look belongs to the overflow item and the dialog's primary button.
- **Axe (wcag2a, 2aa, 21aa, 22aa).** 0 violations: the eight screens at 1920, 1366, 768 and 375; Asset Types with the form open, with the validation summary, with the Filters row and with the deactivate dialog; Priorities with a rename open and with the delete dialog; Link roles with the delete dialog; Audit with a detail open, the filter row open and (375) the Filters sheet; both designers at 1366 and 375.
- **Zoom and reflow.** No page-level horizontal scroll at 375; the tables scroll inside their box and give no cue (BUG-8).
- **Not verified:** a real screen reader pass, forced colours, 200% zoom, drag and drop with a pointer, dark theme (not shipped).

---

## 7. Proposed work packages and order

All effort is AI-agent hours (implementation + unit tests + e2e update). "API" marks additive backend changes. Nothing here changes a keyboard shortcut.

| WP | Package | Findings | Effort | Depends on |
|---|---|---|---|---|
| **WP1** | **Permissions and menu**: widen `GET /priorities` and `GET /status-labels` to `Priority.Manage` / `StatusLabel.Manage` (any-of policies), the Priorities page no longer loads status labels, the Labels menu item and the tab links follow the permission, extend `permissions.md`, `AdminReadPermissionsApiTests` and `ty-permissions-matrix.spec.ts` to the Labels and Audit roles, one denial rule for tab addresses. | BUG-1, X10, LB1 (part) | 5 h (API 2 h) | none |
| **WP2** | **Admin list kit and shells**: header (crumb, Filters + count, primary action), `mf-tabs` with counts for Labels and Assets, optional strip, one table stylesheet on the 44 px contract, grid-body states with the real columns, record-card-list below 640 px, row overflow, "n inactive hidden - Show all", "Skip to table", one input and button kit, delete dead CSS. Applied to Asset Types, Link Roles, Priorities, Status labels, Custom Fields. | X1 to X5, X9, LB1, LB6 to LB8, AT3, AT5, AT8 (part), BUG-8, BUG-9 (part), BUG-10 | 20 h | WP1 (tabs and menu) |
| **WP3** | **Labels**: Priorities edit/new dialog with live preview and the contrast check, color swatch, Default badge, Open tasks (API), Delete only when unused with the impact line, no instant saves; Status labels with usage and the code as tooltip; dialog-copy entries. | LB2 to LB5, BUG-7 | 14 h (API 3 h) | WP2 |
| **WP4** | **Asset Types record and form pages (#361)**: routes `new` and `:id`, record header, tabs Overview / Fields / Assets, form card, validation summary and focus, unsaved guard, Activity, Order through overflow Move up/down, Fields and date on the response (API), the designer entry and back focus. | AT1, AT2, AT4, AT6, AT7, BUG-2, BUG-4 | 16 h (API 1 h) | WP2 |
| **WP5** | **Link Roles**: same chrome and one-field dialog, Links count (API), Deactivate / Delete rule, overflow. | LR1 to LR4 | 7 h (API 2 h) | WP2, WP3 (dialog-copy) |
| **WP6** | **Custom Fields**: the read endpoint with field count, required count, published version and date, no POST on view, name as the link, overflow, designer entry (crumb, title, 404, back focus), spec drift. | CF1 to CF5, BUG-5 (custom fields part) | 9 h (API 3 h) | WP2 |
| **WP7** | **Audit**: chrome (open filter row, header Filters/Clear, short description), cards and 768 columns, permission-aware object links and API labels for config objects, friendly filter options, simpler rows, readable details with a technical disclosure, loaded counter and hint, quick views, day dividers. | AU1 to AU10, BUG-3 | 22 h (API 3 h) | WP2 (chrome), WP1 |
| **WP8** | **States, focus and keyboard**: `RecordKind` `assetType` and `customField` (404 / 403 / failure with reference), one message per failure, focus helpers on rename / Back / show-only-operation / first invalid field, Tab-stop record per page (`tab-stops.json`), axe at four widths for the new pages. | BUG-5 (asset types part), BUG-6, BUG-7 (link roles), X6 to X8 | 8 h | WP2 to WP7 (runs per package, closes last) |
| **WP9** | **Docs and e2e**: update `ux-spec.md` S17 to S19 and the copy deck, add decisions section Y to `decisions-addendum.md`, new e2e specs for Priorities, Status labels, Link roles and the Audit permission links, evidence in `fixes/`. | all | 8 h | per package, closes last |

**Total: 109 h** (about 97 h without the API items, which are small and additive: two policy widenings, usage counts on three lists, the custom-field forms summary, labels on four audit object types, a field count on the asset type).

### Order and parallel work

1. **Start** with WP1 (small, unblocks the Labels-only administrators today; it can ship alone) and the **WP2 kit** in parallel.
2. **Then** WP3, WP4, WP6 and WP7 in parallel (four disjoint pages on the kit); WP5 after WP3's dialog copy.
3. **Last** WP8 and WP9 (they close each package).

Cheapest wins if the owner wants a first release before the epic: **BUG-1** (5 h), the **BUG-2 CSS patch** of the asset type form (1 h), **BUG-3 permission-aware audit links** without the API labels (2 h), **BUG-7** double message (0.5 h), **BUG-4** guard (1 h), **BUG-5** 404 wording (2 h): about 12 h for the six defects that hurt a person today.

### Decisions I am asking the owner to take (defaults in bold)

1. Asset types: **a record page with the form-page pattern (AT2)**, or only the CSS patch for the inline form.
2. Names: **sidebar and H1 "Asset Types", tabs "Asset Types (n)" and "Link Roles (n)"** (AT5), or keep "Assets".
3. Counts of tasks per priority and per status and of links per role: **add the API counts** and show Open tasks / Links; or leave them out and keep the refusal-after-confirm behaviour.
4. Priorities and Link roles: **Delete only for unused rows, only in the overflow; Deactivate otherwise** (X4), or keep Delete visible with a disabled reason.
5. Audit: **object links by permission, config objects named by the API** (AU3), or leave the labels as numbers.
6. Audit filter row: **open by default from 640 px** (AU1) as decided for the record lists.
7. Custom Fields: **a list of three objects with counts, the designer one click away** (CF1), or Client | Matter | Project as tabs with the designer inline (more work, more drift from Task Types).
8. Labels stays **one page with two tabs**, or splits into two menu items.

---

## 8. Phase 2 backlog (keyboard shortcuts; owner froze shortcuts, nothing here is recommended for this phase)

- Alt+Arrow to move a row up or down on Priorities and Link roles, as on workflow steps (today buttons and pointer drag only).
- A single key to focus the Audit filter row or the Summary or field box.
- Enter/Space on an Audit row to open its details (today the toggle button only).

---

## 9. What I did NOT verify, and how the evidence was produced

**Not verified.** A real screen reader, forced-colours mode, 200% zoom, pointer drag-and-drop of rows, dark theme (not shipped), printing, exports (none exist by decision, addendum F), concurrency between two administrators beyond the banners and conflict messages in the code, Windows authentication, more than 100 asset types or more than about 3,000 audit events on one page, the Assets list filter by asset type (the target of the proposed Assets (n) link in AT2).

**Evidence.** Stack: fresh `deploy/publish.sh` publish of `origin/dev` `48aa4aa` (linux-x64), API on port 5233 with Dev auth and `Seed__StarterConfiguration__Enabled=true`, SQL Server 2022 in a private container; the demo seed (`tools/seed-demo`: 50 users, 5 clients, 12 matters, 4 projects, 60 assets, 200 tasks with comments, steps and form answers, producing well over 3,000 audit events) plus an extra seed through the public API: 4 priorities (one 46 characters, one custom pastel color that fails the contrast check), asset types (a 90-character name with a 490-character description, one inactive, the starter set), a fifth link role, a published Client form and a Matter form with an open draft (Project left empty), status label and asset type edits to create configuration audit events, and seven Dev-auth users with one custom role each: `ar-audonly` (`Audit.View`), `ar-priority` (`Priority.Manage`), `ar-statuslabel` (`StatusLabel.Manage`), `ar-assettype` (`AssetType.Manage`), `ar-customfield` (`CustomField.Manage`), `ar-labels` (both Labels permissions), `ar-viewer` (`Task.View`). Screens by Playwright Chromium at 1366x768, 1920x1080, 768x1024 and 375x812; axe-core 4.10.2 with wcag2a, wcag2aa, wcag21aa and wcag22aa; row heights, scroll widths, Tab stops, focus targets and load timings by script (`document.activeElement`, `getBoundingClientRect`, 60 Load more clicks timed). Two before/after mocks: `mocks/mock-asset-types.html` and `mocks/mock-labels.html` (each with its PNG; the CSS is the one of the Task Types review's mocks plus three rules).
