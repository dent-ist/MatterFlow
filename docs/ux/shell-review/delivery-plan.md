# App shell and system pages review: delivery plan

Owner approval: "I like all of your recommendations, so please don't wait for me. create epics / issues and continue working" (2026-10-20), with product decisions delegated to the PM ("you can make decisions for me"). Decisions are recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-20, base `origin/dev` (Task Types epic #352, Clients #245 and Task Detail #288 built; the Users, Assets, Search, Admin pages, Profile and Pod Work epics are being planned in parallel). Source review: `README.md` in this folder (25 findings S1 to S23 with sub-letters, 8 bugs BUG-1 to BUG-8, 8 work packages, 45 agent-hours, screenshots in `screenshots/`, mocks in `mocks/`).

Structure on GitHub: one epic **#585** (labels `epic` + `phase-16`) and **32 open sub-issues** (label `phase-16`), numbers #586 to #632 (the numbers are interleaved with the issues of the other planning agents, so they are not consecutive; the table below is the list). The first eight issues in the table are the **first release**, plus the Profile epic's #522 and #524 (BUG-2/BUG-3 of that review = BUG-7 and BUG-6 here, about 1 h), which lane A takes in wave 1. Two issues this plan first contained were closed as duplicates of earlier Profile issues (one owner per overlap, section 3): the account menu P4/P5 (#629, duplicate of #580 and #578) and the header name rules BUG-6/BUG-7/S3 (#592, duplicate of #522 and #524). Nothing is decided "not now". Folded IDs: S12a into the S12 issue; S13a, S13b, S13d in the offline banner; S13c is BUG-3; S16 is three issues (BUG-4 interim fix, the host, the callers); S7 and S8 together; S2 and S22 together; S21 and S23 together; BUG-5 (Pod Work without Task.View) is not an issue here: Pod Work epic #549 owns it; BUG-6 and BUG-7 are Profile's #524 and #522.

Issues blocked on an owner decision: **none**. The five questions the review put to the owner (section 12 of the review) are decided by the PM (section 2). The owner binding decision for this phase: **no new or changed keyboard shortcuts** (Phase 2 backlog #420); accessibility mechanisms are in scope.

Effort is in **AI-agent hours** (wall-clock of one developer agent, including unit, e2e, axe and screenshots). The review estimated 45 hours; the plan is **62.5** because the review's WP-S1 (4 h) did not include the e2e personas helper and the axe guard, the offline banner, the sign-in banner and the shared inline-error behaviour were split into issues that carry their own tests, and the final verification is 4 hours (review: 3 h for docs and verification together). The first release is **11.5 hours** (plus about 1 hour for #522 and #524).

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package |
|---|---|---|---|---|---|
| #586 | BUG-1 | BUG-1: The "Skip to task list" link points at #mf-list, which no element has (axe skip-link and region on... | 1.5 | -. First release. | WP-SH1 (R1) |
| #587 | BUG-2 | BUG-2: aria-controls="mf-search-row" on the phone search button names an id that does not exist (axe critical) | 0.5 | -. First release. | WP-SH1 (R1) |
| #590 | BUG-3, S13c | BUG-3 / S13c: Offline, a click on a rail item whose page is not loaded yet does nothing: say so and keep... | 2 | -. First release. | WP-SH1 (R1) |
| #591 | BUG-4, S16 (first part) | BUG-4: Identical error toasts stack: de-duplicate within 5 seconds and let a new message with the same key... | 1.5 | -. First release. | WP-SH1 (R1) |
| #594 | BUG-8 | BUG-8: Record 404 document titles say "Client - MatterFlow"; all four records say "<Record> not found" | 1 | -. First release. | WP-SH1 (R1) |
| #596 | Support | E2E support: shell personas, the 29-route table and failure/offline helpers | 1 | -. First release. | WP-SH1 (R1) |
| #597 | Section 10 | Axe guard: run the best-practice rule set on every shell route and state in the e2e accessibility test | 1.5 | #586, #587, #596. First release. | WP-SH1 (R1) |
| #598 | S9 | S9: The 403 page renders in place and keeps the address, with "You asked for /path" and Copy link | 2.5 | -. First release. | WP-SH3 (R1) |
| #600 | S20 (contract) | S20: One page-header contract in the shared page header (H1 22 px / 700, 18 px on a phone, 12 px top... | 3.5 | -. | WP-SH2 |
| #602 | S20 (adoption) | S20: Shell-owned pages adopt the header contract (Task Queue, My Work, Clients, Matters, Projects: top... | 2 | #600. | WP-SH2 |
| #603 | S20 (Dashboard) | S20: Dashboard header to 22 px / 700 with the tab strip under the title and the scope control capped | 1.5 | #600. | WP-SH2 |
| #604 | S20 (Search, My profile) | S20: Search, Advanced search and My profile headers use the compact header (22 px, context line under the... | 1 | #600. | WP-SH2 |
| #606 | S21, S23 | S21 / S23: One document-title rule `<Page or record>: <Tab or view> - MatterFlow` and the crumb rule... | 2.5 | -. | WP-SH2 |
| #607 | S10 | S10: One state-page pattern for 403 and 404 (centred card, path asked for, primary and secondary action,... | 3 | #598. | WP-SH3 |
| #608 | S11 | S11: The error page shows the Reference with Copy, the brand line, and Retry reloads the page the person... | 1.5 | #607. | WP-SH3 |
| #610 | S12, S12a | S12 / S12a: Focus the heading on 403 and 404; the disabled-account page says things once | 1 | #607, #524. | WP-SH3 |
| #611 | S13a, S13b, S13d | S13: Offline banner under the header with automatic retry and "Back online." | 4 | #590, #616. | WP-SH4 |
| #612 | S14 | S14: A failed sign-in is one banner with a Reload page button, not a pile of toasts | 2 | #591, #611. | WP-SH4 |
| #613 | S15 | S15: A failed list load is shown once, inline, with Reference, Copy and Retry everywhere; no toast for a... | 2.5 | #612. | WP-SH4 |
| #615 | S17 | S17: After about 8 seconds a skeleton adds "Still loading... Retry" | 1 | #613. | WP-SH4 |
| #616 | S16 (host) | S16: One toast system: single host bottom right, tinted look, success announced politely, errors... | 4 | #591. | WP-SH5 |
| #617 | S16 (callers) | S16: Toast copy rule (two lines, a trimmed sentence) and move every caller to the one host | 1.5 | #616. | WP-SH5 |
| #619 | S18 | S18: Write the dialog and drawer rule down and apply it (16 px / 600 titles, one close style, footer order) | 1 | #616. | WP-SH5 |
| #620 | S5 | S5: Rename the administrator's "Assets" rail item to "Asset types" | 0.5 | -. | WP-SH6 |
| #621 | S6 | S6: Rail group labels Work and Records | 1.5 | #620. | WP-SH6 |
| #623 | S7, S8 | S7 / S8: Icon rail usable (18 px icons, names on keyboard focus and touch, badge dot) and My Work gets its... | 2.5 | #621. | WP-SH6 |
| #624 | S9a | S9a: Announce the page title after each navigation (polite live region in the shell, no focus move) | 1.5 | #606. | WP-SH6 |
| #625 | S1 | S1: Hide the global "Create task" button on pages whose record header has its own | 1.5 | #621. | WP-SH6 |
| #626 | S2, S22 | S2 / S22: MatterFlow mark for the logo and the favicon (replace the default Angular icon) | 2.5 | -. | WP-SH7 |
| #628 | S4a | S4a: Landing for oversight roles: Dashboard when the person holds a Dashboard tab permission, else the... | 2.5 | -. | WP-SH7 |
| #630 | Docs | Docs: ux-spec 5.1, S21, S22, section AE of the decisions addendum, UAT rows and the e2e catalogue | 2.5 | -. | WP-SH9 |
| #632 | Verification | Final verification pass for the app shell and system pages | 4 | #630. | WP-SH9 |

Total: **62.5 agent-hours** (32 issues). R1 = first release. Review ID to issue: BUG-1 #586; BUG-2 #587; BUG-3, S13c #590; BUG-4, S16 (first part) #591; BUG-8 #594; Support #596; Section 10 #597; S20 (contract) #600; S20 (adoption) #602; S20 (Dashboard) #603; S20 (Search, My profile) #604; S21, S23 #606; S9 #598; S10 #607; S11 #608; S12, S12a #610; S13a, S13b, S13d #611; S14 #612; S15 #613; S17 #615; S16 (host) #616; S16 (callers) #617; S18 #619; S5 #620; S6 #621; S7, S8 #623; S9a #624; S1 #625; S2, S22 #626; S4a #628; Docs #630; Verification #632.

## 2. Decisions (PM) in one place

- **Landing for oversight roles (S4a).** My Work if the person has any pod membership or assignment; else the Dashboard if they hold any Dashboard tab permission (Summary, Breakdowns, Trends, Swimlane, Users or Unassigned); else Task Queue; else the first page they can open; else Access Pending. Directors, Read-Only Observers, Compliance Auditors and Intake Coordinators land on the Dashboard; technicians and pod leads are unchanged. One function (`landingFor`) serves the landing redirect, the 403 link and the logo link. UX spec 2.2 is amended in the docs package.
- **One toast system (S16).** One host, **bottom right**, tinted (green, red, blue, amber) with icon and close button; success and info are polite status messages, warnings and errors assertive alerts; Undo is a link inside the same toast; duplicates are folded with a count; replace-by-key; at most three visible; durations unchanged (4 s, 8 s, Undo 8 s). This reverses the bottom-left Undo placement of decision T #158; the grid pager and scroll bar must stay usable (acceptance test in the host issue).
- **Logo mark and favicon (S2).** A rounded-square mark in the primary colour with an M-shaped flow line, white on primary, as one inline SVG plus favicon.svg, 32 px PNG, `.ico` and an apple-touch icon; the text logo stays beside the mark. The default Angular icon is removed.
- **Filters placement.** Header actions for every list that has a Filters button (as on the reworked lists); Task Queue, My Work and Pod Work keep Filters in the toolbar because it also hosts Columns and Other filters. Written in the page-header contract.
- **Navigation names.** The administrator's rail item is **Asset types** (the data list stays **Assets**); the admin page's own H1, tabs, crumb and title are the Admin pages epic's. Rail group labels **Work** and **Records**; no counts or badges besides the pending-users badge.
- **Page-header contract (S20).** Icon + H1 22 px / 700 from 640 px, **18 px below 640 px for every page** (phone included), title top 12 px, one muted context line under the title (13 px, one line; a sentence beside a title is not allowed), actions right in the order `[secondary] [Filters] [primary]`, a selector in the actions slot capped at 22 rem and never wrapping the title, four shapes (list, workspace, record, administration). No new token.
- **Document titles (S21).** `<Page or record>: <Tab or view> - MatterFlow`; create/edit pages keep the section first; not-found titles say "not found".
- **System pages.** One state-page card for 403, 404 and the error page; the 403 renders in place keeping the address with "You asked for /path" and Copy link; the error page shows Reference with Copy and Retry reloads the current URL; the heading takes focus.
- **Connection and session.** One offline banner with one automatic retry ("Back online."), one sign-in banner with Reload page instead of repeated toasts; a failed list load is shown once, inline, with Reference, Copy and Retry (toast only for actions); "Still loading... Retry" after about 8 seconds. **The Windows-authentication "browser sign-in problem" page is not built now**: it cannot be reproduced with Dev auth; it is recorded for the production rollout (Needs owner / later, below).
- **Route announcement (S9a).** A polite live region in the shell announces the document title after each non-Back navigation; focus handling is unchanged.
- **Header user menu.** Owned by the Profile epic, because it created its issues first: the identity row #580 (P5), the phone dot #578 (P4), the name clamp #522 and the case-insensitive name rule #524. Shell lane A schedules #522 and #524 in the first release.
- **Backend.** None. **SQL:** the next free script number is **28** (latest `27-dashboard-unassigned.sql`); none planned.
- **Out of scope.** Keyboard shortcuts of any kind (Phase 2, #420), a notification bell or counts on rail items, a roving-focus rail, a dark theme, saved views, a service worker or request queue, the Windows-authentication problem page (rollout), the Users/Assets/Search/Admin/Profile/Pod Work pages' own bodies, real screen-reader testing.

## 3. Cross-epic ownership (one owner per overlap)

| Overlap | Owner issue | Other epics |
|---|---|---|
| "Skip to ..." link target contract (`SkipTargetDef.id`, link only when the element exists) | #586 | Users U14 #452, Admin kit "Skip to table" #544, Search S9 #478, Pod Work BUG-5 #553, Assets A9 use it and depend on it |
| Phone search `aria-controls` | #587 | Search epic owns the box, not the button |
| Page-header contract (sizes, offsets, phone 18 px, context line, action order) | #600 | Admin kit #544, Users #431, Assets list chrome, Pod Work W2 #557 / BUG-1 #548 adopt it; Search and Profile header blocks: #604 |
| One toast system (host, position, roles, dedupe, replace-by-key) | #616 (with #591) | Pod Work W8 #571, Users #442 (Undo), Profile availability toasts, Admin BUG-7 #537 use it |
| Header long-name clamp (shell BUG-7, S3), case-insensitive name/account (shell BUG-6) | Profile #522 and #524 | #592 closed as duplicate; lane A takes both in the first release |
| Account menu identity row and phone out-of-office dot | Profile #580, #578 | duplicate #629 closed |
| Access Pending copy and stray space | Users #428 | the disabled page and heading focus: #610 |
| Pod Work visible only with Task.View (nav item and URL) | Pod Work #549 | shell BUG-5 |
| Admin crumbs, descriptions, per-page admin titles, admin page names | Admin pages epic (X9, X5) | this epic: the title helper and rule #606 and the rail label #620 |
| 403/404/failure/record states | #598, #607, #608 | record states of Assets #541 etc. reuse `mf-record-state` |
| Landing, 403 link, logo link | #628 | Pod Work BUG-2: no dead Pod Work landing |
| Offline banner, sign-in banner, quiet loads | #611, #612, #613 | Admin kit grid-body states #575 reuse the shared pieces |
| Favicon and logo | #626 | none |

## 4. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, run unit + e2e + axe (0 violations at 1366, 1920, 768 and 375, with menus, dialogs, drawers and banners open) and assert no page-level horizontal scroll, attach screenshots in `docs/ux/shell-review/fixes/<package>/` (`sh1-critical`, `sh2-page-header`, `sh3-system-pages`, `sh4-connection`, `sh5-toast`, `sh6-navigation`, `sh7-brand-landing`, `sh9-docs`, `final`), keep the initial bundle at its current size (about 647 kB of 700 kB), do not add rules to `task-table.scss`, add no keyboard shortcut. Shared files (`app-shell.*`, `page-header.ts`, `notification.service.ts`, `interceptors.ts`, `skip-target.ts`, `grid-body.ts`, `record-state.ts`, `user-menu.ts`) serve every page: changes are additive and their specs are the regression tests. **SQL scripts:** next free number **28**; none planned. **Backend work:** none.

| Rank | WP | Issues | Main files / areas | Agent-h | Backend / SQL |
|---|---|---|---|---|---|
| 1 | WP-SH1 Critical accessibility bugs and defects (first release) | #586, #587, #590, #591, #594, #596, #597 | `shared/layout/app-shell.*`, `skip-target.ts`, `user-menu.*`, `core/notify/*`, `core/title`, record pages' state branch, e2e support | 9 | see waves | Frontend only |
| 2 | WP-SH2 Page-header contract | #600, #602, #603, #604, #606 | `shared/ui/page-header.ts`, `page.scss`, list/work page headers, Dashboard page, Search and Profile header blocks, `core/title`, `app.routes.ts` | 10.5 | see waves | Frontend only |
| 3 | WP-SH3 System pages (403, 404, error, Access pending, disabled) | #598, #607, #608, #610 | `core/auth` guards, `features/system/*`, new `shared/ui/state-page.ts`, `record-state.ts` (type scale), `core/http/interceptors.ts` (trace id), `features/access-pending` | 8 | see waves | Frontend only |
| 4 | WP-SH4 Connection and session states | #611, #612, #613, #615 | `core/http/interceptors.ts`, new connectivity service and banners, `app-shell.html` (one line each), `shared/ui/grid-body.ts`, `data-table.ts`, `record-skeleton.ts` | 9.5 | see waves | Frontend only |
| 5 | WP-SH5 One toast system and the dialog rule | #616, #617, #619 | `core/notify/*`, new `toast-host.ts`, `app-shell.html`, all `notify.*` callers (one-line edits), activity drawer, filter sheet | 6.5 | see waves | Frontend only |
| 6 | WP-SH6 Navigation rail polish | #620, #621, #623, #624, #625 | `shared/layout/app-shell.*`, `nav-items.ts`, `section-icons.ts`, new route announcer, matters and projects routes (data flag) | 7.5 | see waves | Frontend only |
| 7 | WP-SH7 Brand mark and landing for oversight roles | #626, #628 | `frontend/public/*`, `index.html`, logo in `app-shell`, `core/auth` landing function, no-access page link | 5 | see waves | Frontend only |
| 8 | WP-SH9 Docs and final verification | #630, #632 | `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `docs/qa/e2e.md`, `frontend/e2e/*` | 6.5 | see waves | Frontend only |

Total: about **62.5 agent-hours**.

### First release (do these first, 11.5 hours)

The critical accessibility bugs and the defects that hurt today, eight issues: #586 BUG-1 skip-link target (axe moderate on six list pages), #587 BUG-2 phone search `aria-controls` (axe critical), #590 BUG-3 dead click when offline, #591 BUG-4 stacked toasts, #594 BUG-8 record 404 titles, #598 S9 the 403 page that loses the address, plus the Profile epic's #522 (the long-name header wraps at 768) and #524 (name and account twice), taken by lane A, and the two supports #596 (personas and failure helpers) and #597 (axe best-practice guard on all shell routes). Three lanes in parallel: lane A #586, #587, #522, #524, #590, #597 (5.5 h + about 1 h); lane B #591 (1.5 h) then the toast host #616; lane C #596, #594, #598 (4.5 h) then the header contract #600. Wall-clock of the release is about 6.5 hours.

### Waves for up to 3 parallel developer agents

Lanes are file owners, not people: lane A owns `app-shell.*`, `nav-items.ts`, `skip-target.ts`, `user-menu.ts`, the brand files and the docs; lane B owns `core/notify`, `core/http/interceptors.ts`, the banners and the shared grid states; lane C owns `page-header.ts`, the system pages, the guards, the titles and the landing function.

- **Wave 1 (first release plus the two foundations)**
  - Lane A (5.5 h): #586, #587, #590, #597
  - Lane B (5.5 h): #591, #616
  - Lane C (8 h): #596, #594, #598, #600
- **Wave 2**
  - Lane A (6 h): #620, #621, #623, #625
  - Lane B (8.5 h): #617, #619, #611, #612
  - Lane C (9 h): #607, #608, #610, #602, #603
- **Wave 3**
  - Lane A (4 h): #626, #624
  - Lane B (3.5 h): #613, #615
  - Lane C (6 h): #606, #604, #628
- **Wave 4 (docs, then verification; one agent, after the other epics' shell-touching work is on dev)**
  - Lane A (6.5 h): #630, #632

Lane totals: A 22 h, B 17.5 h, C 23 h. With three agents the wall-clock is about **30 hours** (lane C is the longest before the docs and verification wave, 23 h, then 6.5 h); one agent alone needs 62.5; two agents (fold lane B into A and C) need about 40 hours.

Dependency rules between lanes: #597 (lane A) needs #586, #587 (same lane) and #596 (lane C, 1 h, done first); #616 needs #591 (lane B); #611 needs #590 (lane A) and #616; #610 needs #607 and #524 (lane A, wave 1); #624 needs #606 (lane C, wave 3); #623, #625 follow #621 (same lane); #602, #603, #604 need #600.

### Exact first wave

1. Lane A: #586, #587, #522, #524, #590, #597 (serial, 5.5 h + about 1 h). 2. Lane B: #591, then #616 (5.5 h). 3. Lane C: #596, #594, #598, #600 (8 h).

### Critical path

#596 + #594 + #598 + #600 (8 h, lane C wave 1) then #607, #608, #610, #602, #603 (9 h) then #606, #604, #628 (6 h) = 23 h, followed by #630 (2.5 h) and #632 (4 h) = 29.5 h. Lane A has about 4 hours of slack before the docs wave, lane B about 8 hours.

### Hot spots (merge-conflict watch) and who must rebase

This epic edits files that **every page** depends on. All other epics (Admin pages phase-10, Users phase-11, Assets phase-12, Search phase-13, Profile phase-14, Pod Work phase-15, Task Types and Column filters follow-ups) **must rebase** on dev when these land and must not re-implement them:

- **`shared/layout/app-shell.html/.ts/.scss`**: #586, #587, #590 (wave 1, lane A), then #620, #621, #623, #625 (wave 2), #626, #624. The banners and toast host of lane B add one line each (#616, #611, #612): tell lane A to rebase after each. After #586/#587 land, every epic that registers a skip target (Users, Assets, Admin, Search, Pod Work) rebases on the new `SkipTargetDef.id`.
- **`shared/ui/page-header.ts`, `page.scss`**: #600 (additive inputs; every existing page-header spec is the regression test), then #602, #603, #604. Admin kit #544, Users #431, Assets list chrome and Pod Work header issues must wait for #600 or rebase on it.
- **`core/notify/notification.service.ts`, `undo.service.ts`**: #591 (wave 1) then #616, #617; callers across features change by one line each in #617: one small pull request, announced. Pod Work #571 and Users #442 use it.
- **`core/http/interceptors.ts`**: #608 (trace id only), #611, #612, #613: serial in lane B; lane C only stores the trace id.
- **`core/auth` guards and landing**: #598 (wave 1) and #628 (wave 3): every epic's permission matrix (Task Types `ty-permissions-matrix`, Users, Pod Work) is a regression test; they need no change but must be green.
- **`shared/layout/user-menu.ts`**: #522 and #524 first (lane A, wave 1), then the Profile epic's #578 and #580 rebase on them.
- **`app.routes.ts`, `admin.routes.ts`**: #606 touches titles only; land it late, in one commit, and tell the Admin and Users epics.
- **`shared/ui/grid-body.ts`, `data-table.ts`, `record-skeleton.ts`**: #613, #615 add behaviour (inline error with Reference, "Still loading"); the Admin kit #575 uses them.
- **Tests**: older e2e that select the old "Skip to task list" markup, the toast host, the 403 URL (`/403`) or the "Assets" rail label are adapted by the package that changes the behaviour, not weakened.

### Extension points (for the packages that follow)

- **Skip target (BUG-1):** `SkipTarget.register({label, id, focus})` is the only API for page skip links.
- **Page header (S20):** shapes A to D and the context-line input are the only places header layout lives.
- **Toasts (S16):** `NotificationService` with `key`, dedupe and `undo`; one host.
- **State page (S10):** `mf-state-page` for route-level states; `mf-record-state` for records.
- **Banners (S13, S14):** one banner slot under the header with priority order sign-in, offline.
- **Landing (S4a):** `landingFor(permissions)`.

### Definition of done per package

Issues closed, tests green twice (including permission variants), axe clean at four sizes with overlays and banners open, no page-level horizontal scroll, screenshots in `fixes/<package>/`, bundle and style budgets kept, no keyboard shortcut added or changed, API unchanged (no backend in this epic), the docs named in the issue noted for WP-SH9, the epic #585 checklist ticked, and the line below added to the Status section.

### Docs package (WP-SH9, #630)

`ux-spec.md` 2.2 (landing), 5.1 (shell), S21 and S22 (system pages, session and connection) rewritten to the code, section **AE** of the decisions addendum (every Decision (PM) above, including the reversal of the toast position of decision T #158; the last section on dev when this was written is X, other epics take their own letters, this epic takes AE), `docs/qa/e2e.md`, UAT rows (oversight landing, offline banner, 403 keeps the address, one toast), a banner in the review README. Where the code differs from the issues, the docs follow the code and say so.

### Final verification package (WP-SH9, #632)

Contract e2e over the 29 routes of the review at four sizes (axe 0 including `target-size` and best-practice, no sideways scroll, header contract numbers, skip links, toast roles, offline and sign-in banners, 403 keeps the address, landing for twelve personas, logo and favicon), regression subsets of the other epics' specs that touch the shell, the before/after table of the review's section 8, bundle report, screenshots in `fixes/final/`, and a comment on the epic with the open items. It uses its own e2e stack and ports and never stops processes or containers of another agent's verification run.

### Needs owner / later

Nothing blocks. For the production rollout (not this phase): the "browser sign-in problem" page for failed Windows authentication (UX spec S22) needs a real IIS 401 to design against.

## 5. Status

(One line per work package; keep other packages' lines when merging. Format: `WP name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Owner decision (2026-10-20): no new or changed keyboard shortcuts in this phase (Phase 2 backlog #420); existing shortcuts stay exactly as they are; accessibility mechanisms (skip links, aria, focus management, live regions) are in scope.
- Planning (2026-10-20): epic #585 and 32 sub-issues created and linked; PM requirements review comments posted on every issue; no issue is blocked on the owner; SQL script 28 is free and none is planned; no backend work.
- WP-SH1 Critical accessibility bugs and defects (first release): not started.
- WP-SH2 Page-header contract: not started.
- WP-SH3 System pages: not started.
- WP-SH4 Connection and session: not started.
- WP-SH5 One toast system: not started.
- WP-SH6 Navigation rail polish: not started.
- WP-SH7 Brand mark and landing: not started.
- WP-SH9 Docs and final verification: not started.
