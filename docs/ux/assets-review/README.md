# Assets (user-facing): independent UX review

> **Status (2026-10-26): built.** Every finding of this review was planned and delivered by epic #485 (plan and status lines: `delivery-plan.md`; decisions: addendum section AA; spec: `docs/ux/ux-spec.md` S08). Below is the review as written at `48aa4aa`; "the panel", "`?selected=`" and "Retired" describe the screen before the epic. Screenshots of the result are in `fixes/`.

Scope: **Assets** at `/assets` (list with inline filters, the asset details panel with its Details, Linked Tasks and History tabs, Set inactive / Set active), **New asset** (`/assets/new`) and **Edit asset** (`/assets/:id/edit`), and how an asset links to its Matter and to Tasks (linking itself is made from the Task page, reviewed in the Task Detail review). `/assets/:id` redirects to `/assets?selected=:id`. The admin Asset Types pages are not in scope. Reviewed at `origin/dev` `48aa4aa` as a user would see it (System Admin, plus three narrower roles): production build, published API with Dev auth, SQL Server, Playwright Chromium. **No application code was changed and no issues were created.**

In flight and not reviewed: Task Types epic, column-filters re-review (#75), keyboard audit. Overlaps with shared components are named. **No keyboard-shortcut recommendations** (owner decision).

Evidence: `screenshots/` (35 PNGs, `<name>-<width>x<height>.png`, 1366x768 unless named otherwise; `mock-assets-list` is a mock, source in `mocks/`).

**Test data.** 1,205 assets (1,054 active, 151 inactive) over 12 matters, all 7 asset types with their required type fields; one heavy matter with 389 assets; a 300-character name; a 1,000-character URL reference; a 1,500-character description; assets with no reference; 19 tasks linked to one asset; users with `Asset.View` only, `Asset.View + Matter.View + Client.View + Task.View`, and without `Asset.View`. Dark theme: none.

Severity: **major / minor / nit**; effort in AI-agent hours (h).

---

## 0. Page inventory

| # | Route | Purpose | Permission |
|---|---|---|---|
| 1 | `/assets` | List with inline filters (Name, Type, Matter, External reference, Status), paging, selection | `Asset.View` |
| 2 | `/assets?selected=:id` (panel under the grid) | Details (matter, type, reference, description, type fields), Linked Tasks, History, Set inactive/active, Edit | `Asset.View`; Edit `Asset.Edit`; History `Audit.View` |
| 3 | `/assets/new` | Create: matter, type, name, reference, description, type fields | `Asset.Create` |
| 4 | `/assets/:id/edit` | Edit (matter and type locked) | `Asset.Edit` |
| 5 | Set inactive / Reactivate dialog | Confirm with consequence text | `Asset.Edit` |
| 6 | `/403` | No `Asset.View` | n/a |

**6 surfaces, 1 dialog, 3 tabs in the panel.** `ux-spec.md` S08 describes a **Linked tasks** column in the list and a detail **header with type badge, Matter link, external ref**, which the panel has; the **column is missing** and so is the open/overdue view of the linked work.

---

## 1. Summary

What works: server-side filters, sort, page and selection in the URL; "Showing 1-25 of 1054 active - 151 inactive hidden  Show all" (the shared hint, already correct); a selection bar and bold name (not colour alone); Esc closes the panel; a clear inactive banner and a consequence sentence in the dialog; type-specific values shown read-only with the form version; "You don't have permission to view tasks." for a person without `Task.View`; long values do not break the page; 0 axe violations on the list, filters, panel, new asset page (and Edit) at 1366.

What lets it down:

- **Master-detail leaves neither half usable at laptop size.** With an asset selected at 1366x768 the grid is 277 px tall (**3.5 rows**) and the panel 276 px with 672 px of content (`asset-selected-1366x768`). On a phone the page is 3,048 px: 25 rows, then the panel at y 2,172. It is not the record page the Clients, Matters and Task pages now have.
- **The list is the old table.** Rows are 55 or 77 px (not 44), the name is a `button` styled as a link, the matter cell is two lines with a copy button, a long reference wraps over four lines of monospace, the filter row is closed and its button sits alone below the title, no phone cards, no loading skeleton, no count of the work an asset serves.
- **Dead links.** A person with `Asset.View` but not `Matter.View` gets 26 matter links on the first page and 27 for a viewer, and each leads to the 403 page (`asset-matter-link-403-1366x768`). The rule of decision V (a link exists only if its target opens) is not applied here.
- **Keyboard**: 77 Tab stops from the first row to the panel (three per row) and no skip link.

### Top 10 findings, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | **Asset record page**: `/assets/:id` stops redirecting; the shared record header (crumb, title, badges, Edit, Activity, primary action, overflow), `mf-tabs` `Details | Linked tasks (n) | History`, the list keeps its full height and returns with focus. | `asset-selected-1366x768`, `asset-selected-375x812`, `mock-assets-list` | L, 14 h | A1, A7 |
| 2 | **Matter links only with `Matter.View`** (list and panel) and no schema request that is certain to 403. | `asset-matter-link-403-1366x768` | S, 2 h | BUG-1 |
| 3 | **List rows to the contract**: 44 px, name is the (real) link, matter number plain text, matter name second line only in Comfortable tooltip, one-line reference with copy, Linked tasks column. | `assets-list-1366x768`, `asset-long-values-1366x768` | M, 10 h (incl. API count) | A2 |
| 4 | **Phone cards** (the shared renderer) and the page no longer 3,000 px tall. | `assets-list-375x812` | M, 6 h | A4 |
| 5 | **List chrome** like Clients: filter row open from 640 px, Filters and Clear in the page header, shared skeleton and state rows. | `assets-list-1366x768`, `assets-loading-1366x768` | S, 3 h | A3, A5 |
| 6 | **Honest detail errors**: 404 vs 403 vs 5xx wording with the reference (today every failure says "We couldn't find that asset."). | `asset-detail-error-1366x768`, `asset-detail-404-1366x768` | S, 2 h | BUG-2 |
| 7 | **Linked tasks tab uses the shared cells**: Due cell, Assignee, matter-free, Role; tab count. | `asset-linked-tasks-1366x768` | M, 5 h | A8 |
| 8 | **Keyboard**: skip to table, one stop per row, copy by right arrow (the Matters pattern). | tab-stop run | S, 3 h | A9 |
| 9 | **New/Edit asset form**: record-header crumb, the Create-task section pattern, type fields in their own section with a count. | `asset-new-1366x768`, `asset-edit-1366x768` | M, 5 h | A10 |
| 10 | **Long text clamp** (description 1,500 characters, reference 1,000) with Show more. | `asset-long-values-1366x768` | S, 2 h | A12 |

---

## 2. Findings by page

### 2.1 Assets list (`/assets`)

Screens: `assets-list` (4 widths), `assets-filters-open`, `assets-filtered-empty`, `assets-inactive`, `assets-physical-media`, `assets-loading`, `assets-error`, `assets-403`, `assets-viewer`, `assets-only`.

**What works.** 25 rows per page with a page-size select; the hidden-inactive hint with Show all; Name and Type sort; filtered-empty with "inactive hidden" and Clear filters; error with reference and Retry; 403 for a person without `Asset.View`; no horizontal scroll at 1366 and above.

**A2 (major, M): rows and cells.** Row heights 55 and 77 px (a reference wraps to 3 to 4 lines, `asset-long-values-1366x768`), not 44. The Name cell is a `button` that looks like a link (`as-name`), so it is not in the link list of a screen reader and "open in new tab" does not work; the Matter cell has a link, a copy button and a second line; no column says what the asset is used for. Recommend: Name (real link, 2-line clamp, tooltip), Type, Matter Number (plain monospace, link with `Matter.View`, the same cell as the Task Queue), Linked tasks (number, plain text at 0), Status (badge only for Inactive; the status control is the hint). External reference leaves the grid (it is in the panel and the filter finds it) or shows on one line with an ellipsis. 10 h with the count in the list API (additive `linkedTaskCount`, like `openTaskCount` on matters).

**A3 (minor, S): chrome.** Filter row closed by default and the Filters button on its own row under the title; Clients, Matters and Projects open it from 640 px with Filters and Clear in the header (decision V). Assets is on the #75 list of surfaces, so this is an alignment to the standard, not a new rule. 3 h with A5.

**A4 (major, M): phone.** At 375 the table shows Name and Type; Matter, Reference and Status are off screen (`assets-list-375x812`); clicking a row scrolls the page 1,517 px to the panel (`asset-click-result-375x812`), after which Back is a scroll. Cards: name (2-line clamp), `Relativity Workspace - 90001-80011`, status badge. 6 h.

**A5 (minor, S): states.** Loading is the text "Loading assets..." (no skeleton, a layout jump, `assets-loading-1366x768`); the other lists use the shared skeleton and state rows. Error and filtered-empty are good. 2 h.

**A11 (verified good): many rows.** 1,205 assets: 25 per page (43 pages), size select to 100, the hint counts correct, sort on Name and Type only. Sorting by Matter would help in the 389-asset matter (nit, S, 1 h).

**A13 (minor, S): a deep link changes the filters.** `/assets?selected=1204` (from search or a matter) applies Matter = 90001-80001 and Status = All with a Clear filters button and no explanation, so the list becomes 389 rows (`asset-long-values-1366x768`). With A1 this disappears: the link opens the record page and Back returns to the previous list.

### 2.2 Asset details panel (Details, Linked Tasks, History)

Screens: `asset-selected` (4 widths), `asset-linked-tasks`, `asset-history`, `asset-long-values`, `asset-detail-error`, `asset-detail-404`, `asset-linked-tasks-no-task-view`.

**What works.** Type badge and status next to the title, Set inactive / Edit buttons only with `Asset.Edit` (Edit hidden when inactive), banners for inactive asset and inactive type, a copy button for the reference, link when the reference is a URL, type fields with their version.

**A1 (major, L): the panel is neither page nor drawer.** Grid 277 px, panel 276 px at 1366x768; Details content needs 672 px, so Matter, Type, Reference, Description, Created and the type fields scroll inside the lower pane (`asset-selected-1366x768`). At 768 the list shows 5 rows and the panel is cut at "Workspace Artifact ID" (`asset-click-result-768x1024`). At 375 the panel is below 25 rows. The Matter and Client records already moved to the record page with tabs; assets are matter-owned references and are opened from search, matters and tasks, always as a destination. Recommend: a record page (header, tabs, strip), the list unchanged above it in history. **This reverses the earlier master-detail design (`docs/ux/assets-screen`): owner decision needed.**

**A7 (minor, M): tab pattern.** The panel uses its own `pg-tabs` (not `mf-tabs`): no counts, no arrow keys documented, no URL key. The header actions are Set inactive then Edit, the opposite of the rule (Edit, Activity, primary, overflow). Under A1: `Details`, `Linked tasks (19)`, `History`; Edit, Activity (opens History), overflow `Set inactive / Set active`; primary action "Link to task" is not offered here (linking is made from the Task, S08). 4 h inside A1.

**A8 (minor, M): Linked Tasks has Ref, Title, Status, Role** only (`asset-linked-tasks-1366x768`). The reader's question is "which of these tasks is late": add the shared Due cell and Assignee, sort by due, a strip above (Open, Overdue) and the tab count. For a person without `Task.View` the sentence "You don't have permission to view tasks." is the designed answer (verified). 5 h.

**A12 (minor, S): long values.** A 1,500-character description is shown in full as one unbroken block and a 1,000-character URL as eight lines (`asset-long-values-1366x768`). Clamp at 6 lines with Show more; the URL as one line with an ellipsis, the whole value as tooltip, and the copy button. The heading handles a 300-character name (three lines) but should clamp at two with a tooltip like the record header. 2 h.

### 2.3 New asset and Edit asset

Screens: `asset-new` (2 widths), `asset-new-validation`, `asset-edit`, `asset-edit-long`.

**What works.** A required-field marking in words, matter typeahead with help text ("can't be moved later"), type then type-specific fields, locked matter and type on Edit, Create asset / Cancel, 0 axe violations, a leave guard.

**A10 (minor, M): form layout.** The page is a crumb and a plain H1 (not `mf-record-header`); the Edit page shows no status, type badge or matter link; the type-specific fields (8 to 19 of them) follow the base fields with no section break or count, in a 420 px column beside an empty right half (`asset-edit-1366x768`); the matter placeholder "343-12 or matter name" shows an old number shape (references are `90001-80011`). Use the Create task form pattern from decision W (record header, one input width, sections `Asset` and `<Type> fields (n)`), the real format in the placeholder. 5 h.

---

## 3. Cross-cutting consistency

1. **Record page.** Assets are the only record type without one, and the only one whose edit lives in a lower pane.
2. **List contract.** 44 px rows, name is the link, number is text, phone cards, open filter row from 640 px, skeleton: none of these apply yet.
3. **Permissions.** `Asset.View` alone is a valid role. For it, the list shows matter links that 403, and the panel requests the form schema that 403s (the page survives, the type fields silently disappear). Rule to apply: a link exists only if its target opens.
4. **Drawer/panel.** Users has an inline aside, Assets a bottom pane, Activity a drawer: one pattern (see the Users review).
5. **Vocabulary.** "Inactive" is used for assets (correct) while `ux-spec.md` S08 says "Retired"; the type form has its own "Status" select (Active, Planned, Archived) next to the record's Active flag, which reads as two statuses (nit, product decision: rename the type-form field "Lifecycle" or document it).
6. **Links from other pages.** The Matter's Assets tab and the Task page's Assets tab open `/assets?selected=` and inherit the A13 filter jump.

---

## 4. Bug list (with repro)

Environment: `origin/dev` `48aa4aa`, Chromium, Dev auth.

| ID | Sev | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | major | **Dead links for `Asset.View` without `Matter.View`:** every Matter reference in the list (26 on page 1) and the panel links to `/matters/:id`, which shows the 403 page; the panel also requests `/forms/versions/:id/schema` which answers 403. | Sign in as a role with only `Asset.View`, open `/assets?selected=51`, click a matter reference (`asset-matter-link-403-1366x768`). | Plain text without `Matter.View`; no request that must fail (decision V). |
| BUG-2 | minor | **Every detail load failure reads "We couldn't find that asset."** including a 500, with Retry; a real 404 also gets Retry. | Fail `GET /assets/51` with 500 (`asset-detail-error-1366x768`) or open `?selected=99999`. | 404: "We couldn't find that asset."; 5xx: "Couldn't load this asset." with the reference and Retry. |
| BUG-3 | minor | **Name is a `button`, not a link**: no context-menu "open in new tab", not in the links list of assistive technology. | Inspect `[data-asset-name]`. | `a` with the record URL (A1). |
| BUG-4 | minor | **Focus after selecting an asset** is not in the panel (`document.activeElement` is `body` on the first selection, the panel heading has `tabindex=-1` but is not focused). | Click a name at 1366. | Focus to the panel heading or the record page heading. |
| BUG-5 | nit | **Reference wraps mid-URL in monospace** to 3 to 4 lines and makes the row 77 px (A2). | `assets-physical-media`-style data with URLs. | One line with ellipsis. |
| BUG-6 | nit | **One `POST /assets` returned 500 INTERNAL_ERROR** once among 1,150 sequential creates while another seeder ran against the same database (not reproduced; likely a deadlock victim). | Seed script. | Recorded for the team; 409 CONCURRENCY_CONFLICT would be the contract. |

Verified and no defect: total counts equal the API (1,054 + 151 = 1,205), the hidden-inactive count and Show all, URL state survives reload, Esc closes the panel, a required field blocks Create with a message, 0 axe violations on list, filters, panel and new page, no page-level horizontal scroll at 375.

---

## 5. Keyboard, focus and accessibility basics

- **77 Tab stops** from the first row to the panel's Set inactive: name, matter link and copy button per row (three), then the page size, Show all and the pager. No "Skip to table" (Clients, Matters and Projects have it). A9 (minor, S): name is the stop, the copy button is reached by the right arrow, a skip link; 3 h. This is the decision V pattern, not a new shortcut.
- **Esc** closes the panel (good). Focus returns to the row? On close it does not (verify with A1 where the list return focuses the row via `list-return.ts`).
- The panel heading is focusable (`tabindex=-1`) but not focused on selection (BUG-4).
- Selection is shown by a bar and a bold name plus `aria-current`; names are not colour-only. Badges have text and icons.
- Axe: 0 violations (list, filters open, panel, new page).
- Print: not verified.

---

## 6. Proposed work packages and order

| WP | Package | Contents | Findings | Est. |
|---|---|---|---|---|
| A-1 | **Permissions, errors, bugs** | matter links by permission, no failing schema call, 404/5xx wording, focus, real link for the name | BUG-1 to 4, A5 | 7 h |
| A-2 | **List contract** | 44 px rows, cells, Linked tasks column (API), chrome (open row, header buttons), skeleton, sort by Matter | A2, A3, A5, A11 | 14 h |
| A-3 | **Asset record page** | `/assets/:id`, record header, tabs with counts, Linked tasks with shared cells, long-text clamp, return focus; removes A13 | A1, A7, A8, A12, A13 | 22 h |
| A-4 | **Phone cards** | shared renderer for Assets, record page at 375 | A4 | 6 h |
| A-5 | **Forms** | New/Edit under the Create task pattern, placeholder, sections | A10 | 5 h |
| A-6 | **Keyboard/a11y** | skip link, one stop per row, axe at four widths, e2e | A9 | 4 h |

**Total: 58 agent-hours.** Order: A-1, A-2, then A-3 (needs the A-2 cells), A-4, A-5, A-6. Cut line: A-1 and A-3 (29 h) fix what is broken and the layout; A-2/A-4 are polish and phone.

Decisions needed: (a) reverse the master-detail design for a record page (A-3), (b) additive `linkedTaskCount` on the asset list, (c) rename the type form's "Status" field (product), (d) S08's "Retired" vs shipped "Inactive".

## 7. Phase 2 backlog (shortcuts)

None proposed. (Existing `Esc` to close the panel stays.)

## 8. What I did NOT verify

The Asset Type form designer (Admin), assets with ASSET_REF fields pointing at inactive assets, a `Task.View`-less person opening the matter's Assets tab, linking from the Task page (Task Detail review), a screen reader, 200% and 400% zoom, print, dark theme (none), slow networks other than the held request, more than 1,205 assets.
