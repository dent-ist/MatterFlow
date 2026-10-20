# Administration > Users: independent UX review

Scope: **Administration > Users** (`/admin/users`) with its three tabs **Users**, **Roles** and **Pods**, the user side panel (profile, status, roles, effective permissions, deactivation), the availability dialog, the inline pods editor, the Filters sheet, the role editor, the pod editor, and what a new person sees before an administrator grants access (**Access Pending**, "Pending access" approval flow). MatterFlow has no invitation or provisioning screen: a person appears as **Pending access** on first Windows sign-in, and an administrator grants roles. Reviewed at `origin/dev` `48aa4aa` as a System Administrator would see it: production Angular build, published API with Dev auth, SQL Server, Playwright Chromium. **No application code was changed and no issues were created.**

Not reviewed (in flight elsewhere): the Task Types epic, the column-filters re-review (#75) and the keyboard audit. Where a finding touches a shared component (filter row, `mf-tabs`, grid body, pager) it says so. **Keyboard shortcuts are frozen by the owner: this review recommends none** (see the short Phase 2 note in section 7).

Evidence: `screenshots/` (59 PNGs, `<name>-<width>x<height>.png`, 1366x768 unless named otherwise; 1920x1080, 768x1024 and 375x812 where it matters; `mock-*` is a mock of a recommendation, source in `mocks/`). Numbers quoted below were measured in the browser.

**Test data.** 1,072 users (62 at first, then 1,000 added through the API for the many-rows case): 50 demo users in four pods, 7 pending users (one with a 130-character name, three without email), 6 inactive, 6 out of office (one with a 130-character note), 2 long names, a 90-character role name, 3 empty roles, an empty pod, a 90-character pod name, an inactive pod, and a Task-View-only user for the 403 view. Dark theme: none exists.

Severity: **major** = an administrator loses time or cannot do the job at some width; **minor** = friction or inconsistency; **nit** = polish. Effort in AI-agent hours (h), including tests and screenshots.

---

## 0. Page inventory

| # | Route / surface | Purpose | Permission |
|---|---|---|---|
| 1 | `/admin/users` (Users tab) | Grid of all people: filters, status, pods, availability, row actions | `User.View` or `User.Manage` |
| 2 | User side panel (`?` none: it is local state) | Profile, status, roles, effective permissions, deactivate | `User.Manage` to edit, `User.View` read-only |
| 3 | Availability dialog | Out of office, work hours on behalf of a person | `User.Manage` |
| 4 | Pods cell popover (in the grid) | Add or remove pods, choose primary | `Pod.ManageMembers` |
| 5 | Filters sheet (below 1600 px) | The column filters as a sheet | same as 1 |
| 6 | `/admin/roles` (Roles tab) | Role list, role editor with the permission matrix | `Role.Manage` |
| 7 | `/admin/pods` (Pods tab), `?pod=` editor | Pod list, pod editor, members, primary pod | `Pod.Manage` or `Pod.ManageMembers` |
| 8 | `/access-pending` | What a person with no role sees; Check again | any signed-in person with no permission |
| 9 | `/403` | A signed-in person opens a tab they may not use | n/a |

**9 surfaces, 3 tabs, 1 dialog, 1 popover, 1 sheet.** Not present although `ux-spec.md` S12 describes them: **open assigned task count and "View their tasks" in the user panel and in the deactivation confirm** (BUG-4), an **effective permissions preview beside the role boxes** (it is a flat list below them), and tab counts. The Users tab has **no sortable header** (section 2.1).

---

## 1. Summary

What works: URL-driven filters and paging, a skeleton and a "Couldn't load users." state with a reference and Retry, an honest 403 page that links to a page the person can open, 0 axe violations on the Users, Roles and Pods tabs at 1366, 1920, 768 and 375 (12 scans) and on the availability dialog, the pods popover, the role editor and the Access Pending page, a calm Access Pending page with a Copy button, the role editor (grouped permissions, search, copy-from, locked System Admin, delete guard), and the availability dialog (plain statements, a preview sentence, a character count).

What lets it down is that the screen is **a nine-column table with a form bolted to its side**, not the record-and-list language of the reworked pages:

- **The grid does not fit, and rows are not 44 px.** At 1366 the table is 1,611 px in a 1,096 px box, so Pods, Availability, Status and the actions are off screen; rows measure 51 px, 87 px, 170 px and 204 px (a 130-character name takes eight lines). Phone: only the Name column and "Grant access" show (`users-all-375x812`).
- **The approval flow is hidden in a filter.** The most important job (grant access to the person who is waiting) is a value of a column filter whose default silently flips between Pending access and Active; on the Pending view the "7 waiting" cue disappears, so there is no sign that other people exist; tabs have no counts.
- **The user panel is a long form in a short box.** At 1366 it squeezes the grid to 700 px and is 994 px of content in a 611 px box: the Roles (the point of "Grant access") start below the fold, the deactivation confirmation appears 480 px down while the button still says "Save changes", Esc does not close it, and focus stays on the row. On a phone it is stacked under the grid and mostly off screen.
- **Keyboard cost.** 33 Tab stops to the first row, three stops per row (75 per page of 25), the panel after the grid, no "Skip to table" (Clients, Matters and Projects have one).

### Top 10 findings, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | **Pending access as a first-class status control**: Pending (n), Active, Inactive, All as counted segments in the page header; the default stays "Pending when any, else Active" but is visible and stable on reload. | `users-pending-1366x768`, `mock-users-list` | S, 5 h | U2 |
| 2 | **Rework the grid to the record-list contract**: 6 to 7 columns (name over account, roles, pods, availability, status, action), 44 px rows, name clamps at two lines with a tooltip and is the link, sortable Name and Last seen, phone cards below 640 px. | `users-all-1366x768`, `users-active-1366x768`, `users-all-375x812` | L, 20 h | U1, U5, U6, U7 |
| 3 | **User panel becomes a modal side drawer**: sections Access (roles first), Pods, Availability, Profile; sticky footer; focus moves in and returns, Esc closes; deactivation is a confirm dialog with the open-task count. | `user-drawer-pending-1366x768`, `user-drawer-deactivate-1366x768`, `user-drawer-pending-375x812` | L, 14 h (+3 h API) | U3, U4, BUG-3, BUG-4 |
| 4 | **Fix the clipped Pending badge and the "scroll sideways" hint on a one-column phone grid.** | `users-all-1920x1080`, `users-all-375x812` | S, 1 h | BUG-1, BUG-5 |
| 5 | **Tab counts and header chrome** like the record pages: `Users (62)`, `Roles (13)`, `Pods (7)`, Filters and Clear in the page header, breadcrumb `Administration > Users`. | `users-list-1366x768` | S, 3 h | U12 |
| 6 | **Offboarding aid**: open assigned tasks and "View their tasks" in the panel and in the deactivate confirm, as S12 specifies. | `user-drawer-deactivate-1366x768` | M, 4 h | U3, BUG-4 |
| 7 | **Keyboard**: "Skip to table", one Tab stop per row (the name link opens the panel, Edit availability and pods move to the overflow or the panel), Esc and focus return. | tab-stop run, section 5 | S-M, 4 h | U14 |
| 8 | **Roles tab polish**: role counts, permission count per role (`12 of 50`), select-all per group, description as a textarea. | `role-editor-1366x768`, `role-editor-scrolled-1366x768` | M, 6 h | U10 |
| 9 | **Pods tab to the same grammar**: one link per row, inactive hint "1 inactive hidden  Show all", record header in the pod editor. | `pods-list-1366x768`, `pod-editor-1366x768` | S-M, 5 h | U11 |
| 10 | **Availability only where it informs**: no "Off hours" chip on pending or inactive people, one muted line, OOO in the shared chip. | `users-all-1920x1080` | S, 2 h | U6 |

---

## 2. Findings by page

### 2.1 Users tab (`/admin/users`)

Screens: `users-list`, `users-pending`, `users-all`, `users-active`, `users-inactive`, `users-filters-open`, `users-filters-sheet`, `users-filtered-empty`, `users-loading`, `users-error`, `users-last-page`, `users-many`.

**What works.** Server-side filters in the URL; skeleton rows with the final widths; a filtered empty state with Clear filters; an error with reference and Retry; Seeded badge; a "7 waiting for access" cue and a nav badge; pods inline editing; First seen shows the day with the time as tooltip; no page-level horizontal scroll.

**U1 (major, L): the grid is wider than the screen and rows are not 44 px.** Nine columns need 1,611 px; the box at 1366 is 1,096 px (`users-active-1366x768`: Availability, Status and the actions are off screen, the hint "Scroll sideways to see every column" is on). Row heights on the first page: 170, 51, 51, 51, 51, 49, 51, 87, 51, 51, 204, 87. A long name wraps to 8 lines (`users-all-1366x768`). Decision X.3 (addendum) kept the nine columns and ruled a redesign "not planned"; this review **recommends reopening it**: Name and Windows account merge (name over account, 2 lines, the pattern of the Matter cell), Email and First seen move to the panel (the Email filter stays), Status is a badge only when not Active (the status control is the page-level segment, U2). Result: Name, Roles, Pods, Availability, Status, one action column; fits 1366 without sideways scroll (about 980 px), rows 44 px, name clamps at two lines with the full text as tooltip. 12 h.

**U2 (major, M): the approval flow is a filter value.** The default is "Pending access when someone is waiting, else Active", shown only in the Status cell. On Pending the cue "7 waiting for access" is hidden (`users-pending-1366x768`), on Active it is a yellow button that sets the filter; the Status filter lives in the closed filter row or the sheet; the nav shows `7` and the tab label shows nothing. An administrator coming back after lunch sees a different list than yesterday with no label. Recommend counted segments above the grid, in the page header row: **Pending access (7) | Active (55) | Inactive (6) | All** (the API already returns `counts`), "Pending access" tinted only while the count is above zero, the selected segment is the Status filter (still in the URL as `status`), and the empty state "No one is waiting for access." keeps its copy. The default rule stays (it matches the nav badge) but is now visible. 5 h.

**U3 (major, L): the user panel** (covered in 2.2).

**U5 (major, L): phone.** At 375 the grid shows Name and "Grant access" only; Windows account, Roles, Status are off screen with the hint above a one-column table (`users-all-375x812`, BUG-5). Use the work-list card (`mf-record-card-list`, 640 px): name (2-line clamp), account, status badge top right, `Data Technician - 2 pods - Out of office until Oct 25`, one 44 px action. 8 h.

**U6 (minor, S): availability is noise.** "Off hours" shows on every row, including Pending and Inactive people and the System Admin, so it carries no information (`users-all-1920x1080`). Show the chip only for Out of office and for Off hours when work hours are set; show nothing for pending and inactive. 2 h.

**U7 (minor, S): two text links per row and the name is not a link.** "Open" and "Edit availability" repeat 25 times, and decision V says the name is the one link. Name opens the panel; "Edit availability" moves to the panel and to a row overflow (`...`). 2 h (inside U1).

**U8 (minor, S): the inline pods editor clips its content.** Chips such as `Demo Workspace Support Pod  Primary` are cut by the cell edge, the popover truncates names ("Cross-Border Investigations and Re...", `users-pods-popover-1366x768`) and a user with two pods grows the row to 87 px. Show `Primary pod name +1` on one line (tooltip lists all) and keep the popover. 2 h.

**U15 (minor, M): no sorting, no page size, no Last seen.** Headers are plain `th` (no sort buttons); sorting by First seen or Last seen to find stale accounts is impossible, and with 1,072 users the pager is 43 pages of a fixed 25 (the Pods tab has "Rows per page", Users does not). Add sort on Name, First seen, Last seen (server key) and the shared page-size select. Last seen is more useful than First seen for offboarding. 4 h with API.

**U12 (minor, S): page chrome differs from the record pages.** Tabs have no counts (`Users (62)`, `Roles (13)`, `Pods (7)` are all known to the API or the lists), the H1 has no `Administration >` crumb, and Filters and Clear filters sit in a toolbar inside the card instead of the page header (decision V). 3 h with U2.

**U14 (minor, S-M): keyboard cost** (section 5).

**U16 (verified good): many rows.** 1,072 users: the first page loads in about 2.5 s on this stack (including shell); the pager and filters stay responsive; the last page renders (`users-last-page-1366x768`). No change beyond U15.

### 2.2 User panel and dialogs

Screens: `user-drawer-pending` (4 widths), `user-drawer-active`, `user-drawer-deactivate`, `user-drawer-scrolled-roles`, `user-drawer-scrolled-end`, `user-drawer-role-dirty`, `availability-dialog` (2 widths).

**What works.** Fieldsets with legends, disabled for a person without `User.Manage`, an Effective permissions section that says "Permissions update after you save", sticky Save, a deactivation sentence that states the consequence ("Their assigned tasks stay assigned until you reassign them one by one"), a very good availability dialog.

**U3 (major, L): the panel is a form in a short box.**
- At 1366 it is 380 px wide and the grid is squeezed to 700 px; the panel content is 994 px in 611 px, so **Roles start below the fold** (`user-drawer-pending-1366x768`: after Grant access the administrator sees Profile and Status, not the thing they came for).
- Choosing Inactive shows the confirmation **at the bottom** of the panel (content 1,084 px, box 609 px) while the button still reads "Save changes" and nothing moves into view (`user-drawer-deactivate-1366x768`; BUG-3).
- Focus stays on the row's "Grant access" button when the panel opens (BUG-2); Esc does not close it (Assets closes its panel on Esc); the panel is after the grid in the DOM, so a keyboard user passes 75 stops to reach it (U14).
- On a phone it is stacked under the grid with Save sticky; only the header is visible (`user-drawer-pending-375x812`).
- Missing per the spec: **open assigned tasks and "View their tasks"** (BUG-4); last seen is shown in a muted run-on with the zone.
Recommendation: one **modal side drawer** (480 px from 1024, full width below 640; `mf-drawer` as the Activity drawer), header = name (2-line clamp), status badge, availability chip, `Last seen`; sections in this order **Access** (roles with description and permission count, the `Permissions (25)` summary as a grouped chip list), **Pods**, **Availability** (current state, `Edit` opens the existing dialog), **Profile** (name, email, account read-only). Footer sticky: Save changes, Cancel. A first grant shows a one-line success toast with Undo, not a silent list change. Deactivation is a **confirm dialog** ("This user has 7 open tasks. They stay assigned until you reassign them one by one." [View their tasks] [Deactivate]). Focus moves to the drawer heading on open and returns to the row on close; Esc closes (with the unsaved-changes guard that Roles already uses). 14 h; the task count needs one additive field (3 h).

**U4 (minor, M): role boxes without help.** Twelve checkboxes in alphabetical order, no description, no member count, no permission count; "Regional Discovery Operations Manager (...)" wraps to three lines (`user-drawer-scrolled-roles-1366x768`). The effective permissions are 25 raw codes in an unsorted flat list. Show the role description under the name, group the effective permissions by the Roles tab's groups (`Task (9)`, `Asset (4)` ...), and mark System Admin with a warning line when ticked. 3 h (inside U3).

**Availability dialog (verified good).** `availability-dialog-1366x768`: status, From/Until with the date format hint, note with counter, a preview sentence, Save and Cancel; 0 axe violations. Nit: the From/Until hint appears twice (once under each field); one hint under the pair is enough.

### 2.3 Roles tab (`/admin/roles`)

Screens: `roles-list`, `role-editor` (2 widths), `role-editor-scrolled`, `role-editor-locked`.

**What works.** Two-line list rows with Built-in, locked badge and member counts, a master-detail editor with Search permissions, Copy from role, nine fieldset groups with code and description, a locked System Admin that explains itself, "Changes apply on each user's next request", Delete role only when allowed, 0 axe violations.

**U10 (minor, M): the matrix is 2,717 px long and has no summaries.** 50 permissions in nine groups, no group select-all, no "12 of 50" count, no way to see what changed from the saved role, Description is a one-line input that truncates a 500-character description (`role-editor-1366x768`). Add a count per group and per role, select-all/none per group (keeping the auto-checked prerequisites note), a "Changed (3)" chip row, and make Description a 2-row textarea. The list pane is 280 px: role names wrap to three lines for long names; give the list pane 320 px. 6 h.

### 2.4 Pods tab (`/admin/pods`)

Screens: `pods-list`, `pod-editor` (2 widths).

**What works.** Sort on Name and Members, Rows per page, Active status badges, an editor with members, roles, a primary-pod toggle with an accessible name, Reload on conflict, a polite live region.

**U11 (minor, S-M): different grammar from the rest.** Each row has the name as a link and a separate **Edit** link (two links, one destination); the status default hides inactive pods with no hint (7 pods exist, 6 listed, `pods-list-1366x768`: no "1 inactive hidden  Show all"); the Filters button sits alone on a row; the pod editor replaces the list with no crumb and no Back, only Cancel (`pod-editor-1366x768`). Recommend: name is the link, no Edit link; the shared hint and Show all; Filters and Clear in the page header; the editor under `Administration > Users > Pods > Demo Processing Pod` with the record header (name, Active badge, "..."). 5 h.

### 2.5 Access Pending and 403

Screens: `access-pending` (2 widths), `access-pending-checked`, `users-403`.

**What works.** One calm card, H1 focused on load, the account name with Copy, Check again with a live "Still pending ... Checked at 12:31:04 AM", 0 axe violations. The 403 page says what is wrong and links to a page the person can open (Task Queue).

**U13 (nit, S): small copy.** "(ke\pend01) ." has a space before the full stop; the "Need help? Contact" line is absent while the contact value is unset (the page should say who to ask: "Ask your Pod Lead or manager" is the only route); no hint that the administrator sees "7 waiting" so a person need not chase. Add one sentence ("An administrator is notified through the Users page: you do not need to resend this."). 1 h.

---

## 3. Cross-cutting consistency

1. **Record-list contract (decision V, U).** Users is the only list that is still wider than the screen, taller than 44 px, with no phone layout, without a "Skip to table" link and with two row links; Roles and Pods are different again (button rows, link plus Edit).
2. **Header.** The page has an H1 "Users" and `mf-tabs` without counts; Filters and Clear are inside the card, not in the page header (shared `mf-filters-bar`; touches #75).
3. **Status vocabulary.** "Pending access", "Active", "Inactive" appear as badges, filter values, chips and nav text; the segments (U2) make them one control. Pods call the inactive state "Disabled" in the member list and "Active/Inactive" elsewhere: pick Inactive.
4. **Drawer language.** Activity is a modal drawer; the user panel is an inline aside; Assets has a third panel (below the grid). One drawer component (see the Assets review A1).
5. **Permission-aware hiding.** Verified: a Task-View-only person gets the shared 403 page with a link they can open; tabs the person may not use are not offered; row actions absent without `User.Manage`. Not verified: a `User.View`-only person (read-only panel), `Pod.ManageMembers` without `Pod.Manage`.
6. **States.** Loading, error and filtered-empty are the shared ones and good; the Pending empty state is fine ("No one is waiting for access.").
7. **Shared-component overlap.** Filter row and sheet, pager, `mf-tabs`, grid body (#75 and the keyboard audit run on these); findings U1, U2, U12, U14 need them but do not change them.

---

## 4. Bug list (with repro)

Environment: `origin/dev` `48aa4aa`, Playwright Chromium, Dev auth, `America/New_York`.

| ID | Sev | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | minor | **"Pending access" badge is clipped at 1920** ("Pending acces") because the Status column is narrower than the badge. | `/admin/users?status=all` at 1920 (`users-all-1920x1080`). | Column wide enough or `white-space: nowrap` with the column sized to content. |
| BUG-2 | minor | **Focus does not move into the user panel** when it opens (stays on the row's button) and **Esc does not close it**. | Open any user, press Esc (panel stays); `document.activeElement` is the row button. | Focus to the panel heading, Esc closes, focus returns to the row (Assets already closes on Esc). |
| BUG-3 | major | **Deactivation confirmation is below the fold** of the panel and the button still says "Save changes". | Open a user, choose Inactive at 1366x768 (`user-drawer-deactivate-1366x768`). | Confirm dialog, or scroll the confirmation into view and rename the button. |
| BUG-4 | major | **No open task count and no "View their tasks"** in the panel or the deactivation text, which `ux-spec.md` S12 and addendum E require as the offboarding aid. | Deactivate a user with open tasks. | "This user has 7 open tasks" and a link to Task Queue filtered by assignee. |
| BUG-5 | minor | **"Scroll sideways to see every column" shows over a one-column table** at 375 (the grid shows only Name and the action). | `/admin/users?status=all` at 375. | Cards below 640 px (U5); no hint. |
| BUG-6 | nit | **Pods tab hides inactive pods with no hint** (7 pods, 6 listed). | `/admin/pods`. | `1 inactive hidden  Show all`. |
| BUG-7 | nit | **"(ke\pend01) ."**: stray space before the full stop on Access Pending. | `/access-pending`. | No space. |

Verified and **no defect found**: counts equal rows (1,072 of 1,072), filters survive reload, 0 axe violations in 12 scans plus dialogs, no page-level horizontal scroll at 375, 768, 1366, 1920, role editor locks System Admin, the 403 page links to an allowed page. Not exercised: "At least one active System Admin is required." (one admin only), concurrent edit conflicts.

---

## 5. Keyboard, focus and accessibility basics

- **Tab stops** before the first row at 1366: **33** (14 are the side navigation, 7 the filter controls, the cue, Clear, Filters and the scroll region). **3 stops per row** (pods button, Open, Edit availability): **75** to cross a page of 25 and reach the panel. No "Skip to table" (the first stop is "Skip to main content"). U14 (minor, S-M): add "Skip to table", make the name the one row stop, move the others behind the overflow and the panel: 25 row stops. 4 h.
- The grid scroll region is focusable ("Users list, scrollable"), which is correct for sideways scroll; it disappears with U1.
- Esc closes the filter popover and the availability dialog (verified); not the panel (BUG-2).
- Roving arrows inside `mf-tabs` work as on the record pages. Tab label counts are absent (U12).
- Names and roles: the panel is `aside aria-label="User details"`; row buttons are named `Open Test User 01`; the pods button is `Pods: none, change pods`. Good. Duplicate display names (two "Alex Abbott") give identical button names; add the account to the accessible name.
- Colour: pending is warning-yellow with an icon and text; not colour-only. Contrast verified by axe.
- Print: not verified (the grid is a scrolling region; Task Queue's print rules do not cover it).

---

## 6. Proposed work packages and order

| WP | Package | Contents | Findings | Est. |
|---|---|---|---|---|
| U-1 | **Bugs and small fixes** | clipped badge, hint on one column, Esc and focus, pods hint, copy fixes, duplicate hint in the dialog | BUG-1, 2, 5 to 7, U13 | 4 h |
| U-2 | **Status segments and header chrome** | Pending/Active/Inactive/All with counts, tab counts, Filters/Clear in the page header, crumb | U2, U12 | 8 h |
| U-3 | **Users grid to the list contract** | merged Name cell, 6 to 7 columns, 44 px, clamp, name link, row overflow, availability rule, pods one-liner, sortable headers, page size, Last seen | U1, U6 to U8, U15 | 18 h |
| U-4 | **User drawer** | modal side drawer, sections, sticky footer, deactivate dialog with open-task count and link, grouped permissions, focus and Esc | U3, U4, BUG-2 to 4 | 17 h (incl. 3 h API) |
| U-5 | **Phone cards** | card renderer for Users, drawer full width | U5 | 8 h |
| U-6 | **Roles and Pods polish** | role/permission counts, group select-all, changed chips, Description textarea, pods grammar and editor header | U10, U11 | 11 h |
| U-7 | **Keyboard and a11y pass** | skip to table, one stop per row, accessible names with account, axe at 4 widths, e2e | U14 | 5 h |

**Total: 71 agent-hours.** Order: U-1 (independent), U-2, then U-3 and U-4 in parallel (U-3 first if one agent), U-5 after U-3, U-6 any time, U-7 last. Cut line: U-1, U-2, U-4 (29 h) fix the approval flow and the panel; U-3 and U-5 are the visual and phone value.

Decisions needed before issues: (a) reopen decision X.3 (nine-column Users grid "not planned"): U-3 depends on it; (b) the drawer as modal (recommended) or stay inline; (c) whether Email and First seen may leave the grid; (d) an additive `openTaskCount` on the user response.

---

## 7. Phase 2 backlog (keyboard shortcuts, not recommended now)

Owner decision: no new or changed shortcuts. Noted only: a "next pending user" action inside the drawer after Grant access (button, not key) could be a Phase 2 convenience; `/` to focus the first filter already exists with the filter row.

## 8. What I did NOT verify

Windows authentication (Dev auth only), real AD lookup, a screen reader, 200% and 400% zoom, print, dark theme (none), the last-System-Admin guard, concurrent edits of the same user, a `User.View`-only administrator, a slow network other than the held request, more than 1,072 users, e-mail notifications (the product has none), first sign-in from a real Windows session.
