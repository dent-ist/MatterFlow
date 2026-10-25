# App shell and system pages: independent UX review

> **Status (2026-10-25): the findings of this review are built.** The review text below is the **before** state (2026-10-20) and is kept as written. What was built, in order, is `delivery-plan.md` section 5 (Status); the decisions are section **AE** of `../../requirements/decisions-addendum.md`; the current rules are `../ux-spec.md` 2.2 (landing), 5.1 (shell), 5.6 and S22 (system pages, session and connection); screenshots of every fix are in `fixes/` (`sh1-critical` to `sh7-brand`, `sh9-docs`), the re-measured numbers and the final screenshots are in `fixes/final/`. Where the code differs from a recommendation below, the docs follow the code.

Scope: the **app shell** (header with logo, global search box, Create task button and user menu; the navigation rail with its Administration section; the phone menu and overlay; skip links), the **landing redirect**, the **system pages** (403 "No access", 404 "Page not found", the generic error page, Access Pending and the disabled-account page), **session, offline and slow-network behaviour**, **page-title and favicon conventions**, **toasts, dialogs and drawers**, **breadcrumbs**, and the **visual consistency of page headers across the whole app** (Dashboard, My Work, Task Queue, Pod Work, Clients, Matters, Projects, Assets, the Task page, Create task, Search, My profile and the Administration pages). Reviewed as a senior UX designer and front-end reviewer on `origin/dev` at `48aa4aa`. **No application code was changed.** Everything below was observed in the real stack (published API with Dev auth, SQL Server 2022, the production Angular build) driven with Playwright Chromium, plus a read of `shared/layout/*`, `shared/ui/page-header.ts`, `features/system`, `features/access-pending`, `core/http/interceptors.ts`, `core/title`, `core/notify` and the earlier UX documents (UX spec 2, 5.1, S21, S22; decisions addendum sections U, V, W).

Screenshots are in `screenshots/` (`<name>-<width>x<height>.png`; 1366x768 unless the name says otherwise; 1920x1080, 1024x768, 768x1024 and 375x812 where it matters). Before/after mocks are in `mocks/`. The pages Users, Assets, Search, Audit Logs, Labels, Asset Types, Custom Fields and Asset link roles are **not reviewed** (other reviews cover them); where I saw an inconsistency in them it is listed as an observation only.

**Test data.** `npm run seed:demo` (50 users, 4 pods, 200 tasks), plus personas created through the API: Director, Read-Only Observer, Compliance Auditor, Configuration Admin, Intake Coordinator, a pending user, a disabled user, users with custom roles (Client.View only; User.Manage only; Pod.View without Task.View), a user with a 66-character display name. Failures were simulated with Playwright routes (`/me` 500, API 401, 500 on a list and a record, offline, 6-second delays). Browser time zone America/New_York.

Ranking key: **severity** blocker / major / minor / nit; **effort** in AI-agent hours (S is 1 to 3, M is 4 to 8, L is 9 or more).

**Owner decision applied:** no keyboard-shortcut recommendations (the header search hint "(Ctrl+K)", the shortcuts menu entry and the go-to shortcuts are left exactly as they are); the Phase 2 note is at the end.

---

## 1. Inventory

| # | Surface | Route / place | Purpose | Permission |
|---|---|---|---|---|
| 1 | Header | every page in the shell | Logo (home), global search, Create task, user menu | search: any of Client/Matter/Task/Asset view; Create task: `Task.Create` |
| 2 | Navigation rail | left, every page | 8 work items + Administration section (6 items) | each item hidden without its View permission |
| 3 | Phone menu and overlay | below 640 px | The rail as an overlay panel with backdrop, focus trap and Esc | same as the rail |
| 4 | Skip links | first Tab stops | "Skip to task list" (work pages), "Skip to main content" | all |
| 5 | Landing redirect | `/` | First page the person can use | all |
| 6 | 403 "No access" | `/403`, any guard denial | Tells the person they lack permission; link to a page they can open | all |
| 7 | 404 "Page not found" | any unknown URL; record 404s (client, matter, project, task) | Not found, search box, landing link | all |
| 8 | Error page | `/error` (outside the shell) | `/me` could not load | all |
| 9 | Access Pending / disabled | `/access-pending` (outside the shell) | Zero permissions, or disabled account | pending-only |
| 10 | Session and failure states | whole app | 401, 403 after role change, 5xx, offline, slow | n/a |
| 11 | Page title and favicon | browser tab | Document title per route, favicon | n/a |
| 12 | Toasts | bottom corners | Success, error and Undo messages | n/a |
| 13 | Dialogs and drawers | on demand | Confirm, form dialogs, Activity drawer, phone filter sheet | n/a |
| 14 | Breadcrumbs | page headers | Where you are on record and admin pages | n/a |
| 15 | Page headers | 29 routes measured | Title, icon, description, actions | n/a |

Fifteen surfaces; 29 routes measured for the header comparison (sections 8 and 9).

---

## 2. Summary

The shell is **solid where it counts**: a sticky 57 px header, a rail that collapses to icons at 1100 px and to an overlay below 640 px, a phone menu with focus trap, Esc and backdrop (`phone-menu-open-375x812`), `aria-current` on the active item, Administration hidden without permissions, a pending-users badge, skip links that fill the header when focused (`skip-link-focus-task-queue-1366x768`), a clean landing rule with a permission-aware 403 link, an Access Pending page that follows the spec (calm, one purpose, focus on the heading, Copy and Check again), and grid pages that show the same skeleton in every slow case. Axe (WCAG 2.2 AA plus best-practice) is clean on 23 of the 29 routes and on both 403/404 pages.

What lets it down is **drift and the unhappy paths**:

1. **Page headers are not one thing.** Across 29 routes the H1 is 20, 22 or 28 px, its top edge sits at 12, 14, 18, 19, 24, 32 to 34 or 47 px, actions live in the header, in the toolbar or in the list card, and on a phone the list pages use a **28 px** title while record pages use 18 px. Clicking through the rail makes the title jump on every click (`header-comparison-1-work-pages`). (S20)
2. **There is no offline or connection state.** Offline, a click on a menu item to an unvisited page does nothing at all (no toast, no banner); on a loaded page the list says "Couldn't load tasks." and one toast says "Something went wrong"; nothing recovers when the network returns. UX spec S22 specifies "Connection lost. Retrying...". (S13)
3. **System pages look like three different products**: a 28 px unframed "We couldn't find that." with a truncated search box, a 22 px record 404 with a breadcrumb, and an error page with no brand and no Reference. The 403 replaces the URL, so the address the person should quote to an administrator is gone. (S9 to S11)
4. **Two toast systems** (PrimeNG toast bottom right, Undo toast bottom left, different looks), identical error toasts stacked two and three deep, success toasts announced as assertive alerts. (S16)
5. **Four axe findings that earlier reviews did not report**: the "Skip to task list" link targets `#mf-list`, which exists nowhere (axe `skip-link` and `region`, moderate, on six list pages), and the phone search button's `aria-controls="mf-search-row"` points at nothing (`aria-valid-attr-value`, **critical**, while the search row is open). (BUG-1, BUG-2)

### Top recommendations, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | Fix the shell bugs: skip-link target, `aria-controls`, duplicate toasts, silent offline navigation, case-sensitive name/account | BUG-1 to BUG-6 | 4 h | BUG-1..6 |
| 2 | One page-header contract: H1 22 px / 700 on desktop and 18 px on a phone, same top offset, icon, context line, actions right in a fixed order, one breadcrumb rule for Administration, document titles `<Page>: <Tab> - MatterFlow` | measured table in section 8; `mocks/mock-page-header.png` | 10 h | S20..S23 |
| 3 | One system-page pattern (403, 404, error, record not found): the shared state card, the requested path shown, Reference with Copy, focus on the heading | `sys-*` screenshots; `mocks/mock-nav-and-system.png` | 6 h | S9..S12 |
| 4 | An online/offline layer: banner "You're offline", automatic retry when the connection returns, a message when a page chunk cannot load, one banner for a failed sign-in instead of repeated toasts | `offline-*`, `fail-401-list` | 8 h | S13, S14 |
| 5 | One toast: one host, position, look, a polite live region for success, de-duplication, the Undo toast in the same style | `assign-to-me-toast` (Pod Work review), `fail-401-list`, `toast-success-profile-save` | 6 h | S16 |
| 6 | Navigation polish: Work / Records group labels, admin "Assets" renamed "Asset types", 18 px rail icons with a focus tooltip, a route announcement | `tablet-rail-admin-768x1024`, `mocks/mock-nav-and-system.png` | 5 h | S5..S8 |
| 7 | Product decision: landing for Director, Observer, Auditor and Intake roles (Dashboard instead of Task Queue) | landing table, section 4 | 1 h | S4a |

Total of all work packages: **about 45 agent-hours** (section 12).

---

## 3. Header (logo, search, Create task, user menu)

Screens: `shell-my-work-1920x1080`, `shell-my-work-1366x768`, `shell-1024-long-name-1024x768`, `shell-my-work-768x1024`, `shell-my-work-375x812`, `search-focus-empty-1366x768`, `search-results-dropdown-1366x768`, `phone-search-open-375x812`, `phone-search-results-375x812`, `user-menu-open-*` (profile review).

### What works

- 57 px bar, sticky, white with a 1 px line; contents measured at every width (logo 24 px from the left, search 640 px wide from 1100 px, Create task 120 px, user button right-aligned). Nothing changes at 1920 except the empty space, which is right.
- **Create task** is hidden on `/tasks/new` and for people without `Task.Create` (checked with the Observer); on a phone it is an icon-only plus with an accessible name.
- The search box is offered only to people who may view at least one searchable type; on a phone it becomes an icon that opens a row under the header (focus moves into it, Esc closes it, the dropdown fits 375 px). Search results themselves are another review.
- The user menu pattern is complete (see the Profile review).

### Issues and recommendations

**S1 (minor, S): two "Create task" buttons on Matter and Project pages.** The header has one and the record header has another (`Create task` at x=1177 in the Matter and Project record headers); both open `/tasks/new`, only the record one prefills the matter or project. Two identical blue buttons on one screen is a small trap (the global one loses the context). Recommendation: hide the global button on pages whose record header has its own Create task, exactly as it is already hidden on `/tasks/new` (`onCreateTaskPage`). The Client record has "New matter" as its primary action and keeps the global button.

**S2 (nit, S): brand.** The logo is the text "MatterFlow" in the primary colour and the favicon is the **default Angular logo** (`public/favicon.ico`, 48 px, the red and purple "A"). Both ship as-is. Recommendation: a simple mark (a rounded square with an M, or two flowing lines) in the logo and the favicon set (ico and a 32 px png), 2 hours including the title colour. The owner decides the mark; the review only flags that the Angular logo is what people see in their tab list next to other work tabs.

**S3 (minor, S): the header and long names.** At 768 a 66-character name wraps and the header grows from 57 to 66 px (Profile review, BUG-2). The user button needs `max-width` and ellipsis at every width.

**S4 (nit, S): the account menu at 375 px shows no identity.** See Profile review P4/P5.

---

## 4. Landing redirect

I signed in as each persona and opened `/`:

| Person | Lands on | Nav items | Comment |
|---|---|---|---|
| Technician in a pod (Tariq) | `/my-work` | 8 | per UX spec 2.2 |
| Technician, no pod, no work | `/tasks` | 8 | per spec |
| Pod Lead | `/my-work` | 8 + Users | per spec |
| **Director** | `/tasks` | 8 + Users, Audit | spec literal; the persona's job is the Dashboard |
| **Read-Only Observer** | `/tasks` | 8 | has Dashboard summary, breakdowns, trends |
| **Intake Coordinator** | `/tasks` | 8 | has Dashboard.ViewUnassigned |
| **Compliance Auditor** | `/tasks` | 8 + Users, Audit | has Dashboard summary and trends |
| Configuration Admin (no Dashboard) | `/tasks` | 7 + 5 admin | per spec |
| Client.View only | `/clients` | Clients, Matters | the first page they can open |
| User.Manage only | `/admin/users` | Users | the first page they can open |
| Pod.View + Dashboard, no Task.View | `/dashboard` | Dashboard, **Pod Work** | Pod Work is a dead page for them (Pod Work review, BUG-2) |
| Pending | `/access-pending` | none | per spec |

**S4a (minor, S, product decision): roles whose job is oversight land on a 141-row list.** UX spec 2.2 says "My Work if the user has any Pod membership or assignment, else Task Queue, else Dashboard". For Marcus (Director), the spec's own persona table says "Department overview" and "Drill from a count into the filtered queue": the Dashboard. Recommendation: insert a rule between the second and third: a person who has a Dashboard tab beyond Unassigned (any of Summary, Breakdowns, Trends, Swimlane, Users) and no pod membership and no assignments lands on the Dashboard. This changes four of the twelve personas above and nobody else. Needs the owner's yes because it amends the spec.

---

## 5. Navigation rail, phone menu and skip links

Screens: `page-*-1366x768` (rail on every page), `tablet-rail-admin-768x1024`, `tablet-rail-hover-768x1024`, `phone-menu-open-375x812`, `skip-link-focus-*`, `mocks/mock-nav-and-system.png`.

### What works

- Order and permission rules as specified; items hidden, never disabled; the active item is a tinted pill (`#E3ECFA`, primary text, 600) with `aria-current="page"`; a task opened from a list keeps that list's item lit and its crumb says where you came from (`from=my-work`, `from=pod-work`: verified).
- The Administration section has a small-caps heading wired to the list (`aria-labelledby`), a divider, one item per area (Users covers Users, Roles and Pods; Task Types covers three tabs; Labels two; Assets two), and the only badge in the app: the pending-users count, with an accessible name ("Users, 1 users waiting for access").
- Rail breakpoints: 220 px from 1100 px; 56 px icon rail from 640 to 1099; overlay below 640 px (measured at 639, 640, 1023, 1024, 1099, 1100).
- Phone menu: Menu button with `aria-expanded`/`aria-controls`, panel 252 px with a "Close menu" button first, current item focused on open, Tab trapped inside, Esc closes and returns focus to the Menu button, backdrop click closes, choosing an item closes it. Axe clean in the open state apart from BUG-1.
- Skip links: "Skip to task list" (work pages and record lists) then "Skip to main content" are the first Tab stops; when focused each fills the header strip with an inside focus ring (`skip-link-focus-task-queue-1366x768`). 14 Tab stops (20 for an administrator) lie between the header and the page content, so the skip links matter; they work (verified on Task Queue, Clients, Pod Work and the Task page).

### Issues and recommendations

**S5 (minor, S): two items named "Assets".** The record list (database icon) and the administrator's Asset Types and Link Roles (tag icon) are both "Assets"; in the icon rail at 640 to 1099 px they cannot be told apart except by icon and a native tooltip, and the admin page has three names (nav "Assets", breadcrumb "Administration > Assets", H1 "Asset Types & Link Roles"). Recommendation: nav label **Asset types**, breadcrumb and H1 "Asset types and link roles" as the spec says.

**S6 (minor, S): no grouping.** Eight work and record items in one list, then Administration. Recommendation (`mocks/mock-nav-and-system.png`): two small group labels, **Work** (Dashboard, My Work, Task Queue, Pod Work) and **Records** (Clients, Matters, Projects, Assets), in the same small-caps style as Administration. In the 56 px rail they are the dividers. No counts or badges besides the existing pending-users one: a count on My Work or Task Queue would add a polling request and duplicates the strip on My Work; the "no notification bell" rule (addendum F) argues against it. I considered and **do not recommend** it.

**S7 (minor, S): the icon rail is hard to use.** Icons are 14 px in a 56 px rail, names come only from the native `title` tooltip (not shown on keyboard focus or touch), the Administration heading disappears, and the pending badge overlaps its icon (`tablet-rail-admin-768x1024`). Recommendation: 18 px icons, a tooltip that also opens on keyboard focus, the divider kept, the badge moved to the icon's top right corner as a dot.

**S8 (nit, S): icon collisions.** My Work uses `pi-user`, the same glyph as the header user button; My profile uses `pi-user-edit`. Give My Work a different glyph (for example a check-square) and keep the user button as it is. Page icons come from one table (`section-icons.ts`) and match the rail, which is right.

**S9a (minor, S): route changes are silent.** After a click on a rail item focus stays on that link and nothing is announced except, on grid pages, the live region "141 tasks, page 1 of 3" (Task Queue, Pod Work); Dashboard and Clients announce nothing. A screen-reader user learns that the page changed only by reading the document title. Recommendation: a visually hidden polite live region in the shell that says the document title after each navigation that was not a Back (do not move focus: the Back rules from decision V keep returning it to the row). Needs no change to focus handling.

---

## 6. System pages

Screens: `sys-403-1366x768`, `sys-403-375x812`, `sys-404-1366x768`, `sys-404-375x812`, `sys-404-record-1366x768`, `sys-404-task-1366x768`, `sys-error-1366x768`, `sys-error-375x812`, `sys-access-pending-1366x768`, `sys-access-pending-768x1024`, `sys-access-pending-375x812`, `sys-disabled-1366x768`, `mocks/mock-nav-and-system.png`.

### What works

- **403:** "You don't have permission to view this." plus "Ask an administrator if you think you should have access." plus a link to **a page the person can open** ("Go to Clients" for a Client.View-only user, "Go to Administration" for a User.Manage-only user: the landing rule), never "Go to My Work" for someone without My Work (decision W). Title "No access - MatterFlow". Axe clean.
- **404:** "We couldn't find that." with a search box and the landing link; record 404s (`/clients/99999`, `/tasks/99999`) keep the section's breadcrumb, say what was missing ("We couldn't find that client.") and link back to the list. The nav item of the section stays lit.
- **Access Pending:** a calm card, the user's name and account, registration time, "What to do next" with Copy and Check again, focus on the H1, no nav, no search, no data (UAT-S21). The disabled account has its own H1.
- All system pages are axe clean at 1366 and 375.

### Issues and recommendations

**S9 (major, S): the 403 page throws away the address.** A guard denial navigates to `/403`; the URL the person typed or followed is gone, a reload cannot retry (for example after an administrator grants the role), and the person asked to "ask an administrator" has nothing to quote. Recommendation: render the 403 in place (the guard keeps the URL by `skipLocationChange`, or the route renders the page from the guard's state) and say what was asked: "You asked for `/tasks`." plus **Copy link**. Reload then retries, Back goes where the person came from.

**S10 (minor, S): three looks for "not found".** The generic 404 and the 403 are an unframed **28 px** H1 with a 14 px icon at 100 px from the top, a search input that truncates its own placeholder ("Search clients, matters, tasks, a") and a text link; the record 404 is a **22 px** H1 under a breadcrumb; the error page is a 28 px H1 and a primary button with no brand. Recommendation: one state-page pattern (the record-state card, `mocks/mock-nav-and-system.png`): centred card, 22 px title, one sentence of reason, the path asked for in monospace, primary "Go to ..." and a secondary action (Search, Copy link, Try again), the search box only on 404, the same card inside the shell and, with the brand line of Access Pending, outside it.

**S11 (minor, S): the error page has no Reference and no way back.** UX spec S22 asks for "the error page with correlation id and Copy". `/error` shows "Something went wrong. Try again." and Retry; the trace id (`Reference: 00-abc123`) exists only in a toast that disappears after 8 seconds, so support cannot be given a number. Retry reloads `/`, losing the page the person was on. Recommendation: Reference with the shared Copy button on the page (the Clients list error already shows it), Retry reloads the current URL, brand line on top.

**S12 (minor, S): focus lands on `<body>` on 403 and 404.** Access Pending and the error page focus the heading; 403/404 inside the shell do not, so a keyboard or screen-reader user arrives at the top of the document with the skip link as the only cue. Recommendation: focus the H1 (`tabindex="-1"`) on these pages, as Access Pending does.

**S12a (nit, S): the disabled page repeats itself.** H1 "Your account is disabled" is followed by the sentence "Your account is disabled. Contact the administrator." Say "Contact the administrator to have it enabled again." once. Name and account show twice with different case (Profile review BUG-3).

---

## 7. Session, offline and slow-network behaviour

Screens: `offline-nav-click-1366x768`, `offline-my-work-tab-1366x768`, `fail-401-list-1366x768`, `fail-500-clients-1366x768`, `fail-500-client-record-1366x768`, `slow-task-queue-1366x768`, `slow-clients-1366x768`, `slow-task-page-1366x768`, `sys-error-1366x768`.

| Situation | What the person sees | Verdict |
|---|---|---|
| `/me` fails (500) | Error page "Something went wrong. Try again." with Retry; Reference only in a toast | works, see S11 |
| Role removed mid-session (403 PERMISSION_DENIED) | Permissions refresh, redirect to Access Pending (code, `refreshAfterDenied`) | good, not reproduced |
| 401 on API calls | List state "Couldn't load tasks." plus **two identical toasts** "We couldn't verify your sign-in. Reload the page to try again." | S14 |
| 500 on a list | Inline "Couldn't load clients." with Reference, Copy, Retry **and** a toast "Something went wrong. Try again. Reference: ..." | S15 |
| 500 on a record | Record error state (inline) | good |
| Offline, click a rail item for a page not visited yet | **Nothing happens**: URL, page and focus unchanged, no toast, no banner | S13, BUG-3 |
| Offline on a loaded page (change a tab) | "Couldn't load tasks." with Retry, one toast "Something went wrong. Try again." | S13 |
| Network returns | Nothing refreshes; the person must press Retry | S13 |
| Slow API (6 s) | Grid skeleton with final column widths, record skeleton with the final header height; no text, no "still loading" | good; S17 |

**S13 (major, M): no connection state.** UX spec S22 lists "session/connection lost banner: Connection lost. Retrying...". It does not exist: there is no `online`/`offline` handling and no global banner (no `online` or `offline` listener and no `navigator.onLine` anywhere in `src/app`, and no "Connection lost" text). The worst case is the silent navigation failure: the lazy chunk of an unvisited page cannot load, the router rejects, and the click appears dead. Recommendation, one shell component: (a) a slim banner under the header while `navigator.onLine` is false or two consecutive requests fail with a network error: "You're offline. Pages you have open still work; changes can't be saved." with a Retry button; (b) when the connection returns, retry the failed list or record automatically once and say "Back online."; (c) a navigation error handler: toast "Couldn't open Task Queue. Check your connection and try again." and keep focus on the link; (d) no new toast per failed request while the banner is up.

**S14 (minor, S): a failed sign-in is a pile of toasts.** Each failing call adds the same toast (two in my test, three for a 403 on Pod Work for a user without `Task.View`); the toast tells the person to reload but has no Reload button; UX spec S22 also names a "Browser sign-in problem page for failed Windows authentication", which does not exist (Dev auth cannot show it; flag for the production rollout). Recommendation: one banner "We couldn't verify your sign-in. [Reload page]" that replaces the toasts, de-duplicate identical toasts within 5 seconds.

**S15 (minor, S): the same failure is shown twice and in two styles.** On a list the inline state and the toast say the same thing; the inline state differs by page: Clients shows "Couldn't load clients." with Reference and Copy, the work grids show "Couldn't load tasks." with Retry only. Recommendation: the inline state is the message (with Reference and Copy everywhere, Retry), the toast is suppressed for a load that has an inline state; toasts stay for actions (save, assign).

**S17 (nit, S): nothing after 6 seconds.** Skeletons are right for the first seconds; after about 8 seconds add a line "Still loading... Retry" under the skeleton so a stuck request is not an endless grey screen.

---

## 8. Page headers across the whole app (consistency audit)

Measured at 1366x768 as System Admin (`hdr` table; the sheets `header-comparison-1-work-pages` and `header-comparison-2-records-admin-other` show the same crops side by side).

| Page | H1 size / weight | Title top (px) | Where the actions are | Breadcrumb | Description |
|---|---|---|---|---|---|
| Dashboard | **20 / 600** | 19 | tabs, Scope select and Refresh in the title row | no | none |
| My Work | 22 / 700 | 12 | none in the header (toolbar below) | no | none |
| Task Queue | 22 / 700 | 12 | none (quick-view chips and toolbar below) | no | none |
| Pod Work | 22 / 700 | **18** | Pod select in the header | no | none |
| Clients, Matters, Projects | 22 / 700 | **14** | **Filters** and **New ...** in the header | no | none |
| Assets (observation) | 22 / 700 | 14 | New asset; **Filters wraps to a second row** | no | none |
| Client, Matter, Project records | 22 / 700 | 32 to 33 | Edit, Activity, primary, More | yes | context line |
| Asset record (observation) | 22 / 700 | 14 | **list header** ("Assets" and New asset) on `/assets/1` | **no** | none |
| Task page | 22 / 700 | 47 | Edit, Activity, Complete task, More | yes (3 steps) | context line |
| Create task | 22 / 700 | 48 | none | yes | one sentence |
| Users, Labels, Custom Fields, Audit Logs (observation) | 22 / 700 | 12 | none in the header | **no** | Labels and Audit: a sentence **next to** the title |
| Task Types, Workflows, Steps | 22 / 700 | 34 to 42 | Filters, New ... | yes ("Administration >") | a sentence next to the title |
| Asset Types (observation) | 22 / 700 | 32 | none | yes | none |
| **Search, Advanced search, My profile** | **28 / 700** | **24** | none | no | one sentence |
| **At 375 px:** My Work, Task Queue, Pod Work, Clients, Matters, Projects, Assets, Users, Labels, Search, My profile | **28** | 16 | n/a | n/a | n/a |
| At 375 px: Client and Task records | **18** | 60 | n/a | n/a | n/a |
| At 375 px: Dashboard | 20 | 16 | n/a | n/a | n/a |

### Inconsistencies, listed

1. **Title size.** 20 px (Dashboard), 22 px (almost everything), 28 px (Search, Advanced search, My profile, 403, 404, error). The 28 px headers are the pages that did not get the compact header.
2. **Title top edge.** 12, 14, 18, 19, 24 px on one level of pages: clicking My Work, Task Queue, Pod Work, Clients in the rail moves the title by 0, 6 and 2 px each time (Pod Work is 6 px lower because its select is 40 px tall).
3. **A phone makes it worse.** At 375 px list pages use **28 px**, larger than at desktop, while record pages use 18 px. A phone title should be the smallest, not the largest (the record header rule is 18 px below 640).
4. **Action placement.** "Filters" is a header action on Clients, Matters, Projects and the Task Types tab, a toolbar button on Task Queue, My Work and Pod Work, a button inside the list card on Users, and a wrapped second row on Assets. The primary "New ..." is always right-aligned (good), but on Assets the Filters button sits under it.
5. **Selectors as actions.** Pod Work's Pod select and the Dashboard's Scope select occupy the actions slot; Pod Work's is 560 px wide and breaks the header at 768 (Pod Work review).
6. **Descriptions.** Admin pages and Search put a sentence **beside** the title (Labels, Audit Logs, Task Types), My profile and Create task put it **under** it, records put a context line under it, lists have none. Pick one place: under the title, 13 px, muted, one line.
7. **Breadcrumbs.** Present on records, Create task, Task Types, Workflows, Steps and Asset Types; absent on Users, Labels, Custom Fields, Audit Logs and on the Asset record. Rule: every Administration page shows "Administration > Page" (plain text first step: there is no admin landing page); list pages and Search have none.
8. **Icons.** Present on every H1 and equal to the rail (good); three small collisions: My Work and the user button, the two "Assets" (S5), and the Task page which uses the task type's icon (intended).
9. **Header height changes with content.** A record header is 32 px of crumb plus the title; an admin page with a breadcrumb adds 20 px; Dashboard has tabs inside the title row; only the grid pages keep the title at 12 px. The four shapes in `mocks/mock-page-header.png` keep the title at one distance from the crumb and one H1 size.
10. **Create / New.** "Create task" is only ever a task (global button, Matter and Project records, the page); everything else is "New <noun>". Consistent, no change.

**S20 (major, M): one page-header contract.** Four shapes, one set of numbers (mock `mocks/mock-page-header.png`):
- **A. List page** (Clients, Matters, Projects, Assets, Task Queue, admin lists): icon + H1 22 px / 700 (18 px below 640), 12 px from the top, actions right in the order `[secondary] [Filters] [primary]`.
- **B. Workspace page** (Dashboard, My Work, Pod Work): shape A plus an optional muted context line under the title, a strip of chips, then tabs; a scope control (Pod, Scope) sits at the right of the title row, capped at 22 rem, never wrapping the title.
- **C. Record page** (Client, Matter, Project, Asset, Task): the shared record header, unchanged; the Asset record joins it (with the Assets review).
- **D. Administration page**: shape A or B with the breadcrumb "Administration > Page" above the title on **every** admin page.
Implementation notes: Dashboard to 22 / 700 (the tab strip moves under the title as on My Work); Search, Advanced search and My profile to the compact header; the phone title is 18 px everywhere; a sentence next to a title becomes the context line; Filters goes to the header for every list that has a Filters button (Task Queue, My Work and Pod Work keep it in the toolbar: it also hosts Columns and Other filters, so this is the one exception and is written down).

**S21 (minor, S): document titles do not follow one rule.**

| Route | Document title | Note |
|---|---|---|
| Dashboard, Clients, Matters, Projects, Assets, Task Queue | `Dashboard - MatterFlow` | no tab or view |
| My Work, Pod Work | `My Work: Active - MatterFlow` | colon, tab name |
| Client, Matter records | `90001 Name: Overview - MatterFlow` | colon, tab name |
| Task page | `TSK-10 Data Load / Overlay - 1 - MatterFlow` | no tab |
| Admin Roles, Pods | `Users - Roles - MatterFlow` | **hyphen** between page and tab |
| Admin Priorities | `Labels - Priorities - MatterFlow` | hyphen |
| Admin Asset Types | `Asset Types & Link Roles - Asset Types - MatterFlow` | hyphen, repeats |
| `/admin/workflows/new` | `New workflow - MatterFlow` | **section lost** |
| 404, 403, error, pending | `Page not found`, `No access`, `Error`, `Access pending` | fine |
| `/clients/99999` | `Client - MatterFlow` | the Task 404 says `Task not found` |

Rule: `<Page or record>: <Tab or view> - MatterFlow`; a create or edit page keeps its section first (`Task Types: New workflow - MatterFlow`). Not-found titles say "not found" on records as on tasks. The existing helpers (`documentTitle`, `recordTitle`, `PageTitle.pin`) already do it; the admin routes use the `title` field of the route instead.

**S22 (nit, S): the favicon and brand** see S2.

**S23 (nit, S): breadcrumbs** see inconsistency 7; the crumb separator (`>` from CSS), the 40-character cut on the last step with the full text as tooltip and the 24 px link target are right and shared.

---

## 9. Toasts, dialogs and drawers

Screens: `toast-success-profile-save-1366x768`, `fail-401-list-1366x768`, `fail-500-clients-1366x768`, `dialog-cancel-task-1366x768`, `drawer-activity-1366x768`, `overflow-menu-1366x768`, `task-overflow-1366x768`, `phone-filters-sheet-375x812`, plus the Undo toast in the Pod Work review.

### Toasts

| Toast | Position | Look | Duration | Role |
|---|---|---|---|---|
| PrimeNG success / info / error (`NotificationService`) | bottom right | tinted (green, red), icon, close X | 4 s, errors 8 s | `role="alert" aria-live="assertive"` on **success** too |
| Undo toast (`mf-undo-toast`) | **bottom left** (decision T #158: "above the pager") | white box, 1 px border, black text, "Undo" link, close X | with Undo | not checked |

**S16 (minor, M): two toast systems.** Success and error toasts are tinted, bottom right; the Undo toast is white, bottom left, up to four lines and covers the pager (`assign-to-me-toast-1366x768`, Pod Work review). A person who does one thing and then another sees messages from two corners in two styles. A success toast announced as an **assertive alert** interrupts a screen reader; `role="status"` is right for success and info, `alert` for errors. Identical error toasts stack: two for a 401, three for a 403 (BUG-4).
Recommendation: one host, one position (bottom left, as decision T #158 says, which keeps the right edge free for the grid's scroll bar and the 1920 px layout), one look (the tinted style, Undo as a link in it), the sentence trimmed to two lines, success and info as `role="status"`, de-duplication by summary within 5 seconds, a maximum of three visible. Keep durations (4 s, 8 s, Undo 8 s).

### Dialogs and drawers

What is consistent: PrimeNG dialog, 8 px radius, a 16 px / 600 title left and a blue X right, content, footer buttons right-aligned with the **secondary left and the primary right** (`Keep task` / `Cancel task`, `Cancel` / `Set out of office`, `Stay` / `Leave`), a destructive primary in red (Cancel task), required reasons marked "(required)", Esc and X close, focus moves into the dialog and returns to the trigger. Axe clean on every dialog tried.
Small differences worth one rule each: dialog titles are 16 px, the Activity drawer title is 18 px; the drawer (right, 500 px, no radius, grey backdrop) and the phone filter sheet (bottom, full width) have different close buttons (X right, X in a bordered box); button wording alternates between "Cancel" and a named alternative ("Keep task"): both are fine, the named one is better when "Cancel" would be ambiguous (cancelling a task).
**S18 (nit, S): write the rule down.** Title 16 px / 600 in dialogs and drawers; one close button style; the footer order; "Cancel" unless it would read as the action itself. No visual change beyond the drawer title.

---

## 10. Accessibility (axe, WCAG 2.2 AA plus best-practice)

29 routes at 1366x768 and 375x812 as System Admin (plus states): **0 violations on 23 routes**; on Task Queue, My Work, Clients, Matters, Projects and the Project record: `skip-link` (moderate) and `region` (moderate) for `a[href="#mf-list"]` (BUG-1). On a phone with the search row open: `aria-valid-attr-value` (critical) for `.mf-search-btn` (BUG-2). Pod Work shows the same two when the user has a pod (as a Pod-less administrator it shows none). Everything else I tried was clean: 403, 404 (generic and record), error, Access Pending, disabled, phone menu open, search open (apart from BUG-2), dialogs, the drawer, toasts.
Keyboard: first Tab stops are the skip links; the user menu, phone menu and search row follow the ARIA patterns; dialogs trap and restore focus; 14 (administrator: 20) Tab stops precede the page content, which the skip link removes; the rail has no roving focus (a design choice, not a defect).
Not verified: a real screen reader (NVDA, JAWS, VoiceOver); 200 and 400 percent zoom; high-contrast mode; reduced motion beyond the token file's `prefers-reduced-motion` rule.

---

## 11. Bugs found (with repro)

| ID | Severity | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | minor (axe moderate x2) | **The "Skip to task list" link points at `#mf-list`, which no element has.** It works through the click handler only; axe reports `skip-link` and `region` on My Work, Task Queue, Pod Work, Clients, Matters, Projects and the Project record, at every width. The My Work review reported 0 axe violations; this run includes the best-practice tag and finds these two, so either the tag set differed or the link changed since. | Open any of those pages, run axe with the best-practice tag; `app-shell.html` line 2. | The link's `href` is the id of the element that receives focus (or the link is created only when that element exists); keep the handler. |
| BUG-2 | **major (axe critical)** | **`aria-controls="mf-search-row"` on the phone search button names an id that does not exist.** Reported as `aria-valid-attr-value` while the row is open. | 375 px, open the search icon, run axe (`app-shell.html` line 31). | Give the search row that id, or drop `aria-controls`. |
| BUG-3 | major | **Offline, a click on a rail item whose page has not been loaded does nothing.** No toast, no banner, no focus change; the click appears dead. | Load My Work, go offline (`context.setOffline(true)`), click Task Queue (`offline-nav-click-1366x768`). | A message and the link keeps focus (S13). |
| BUG-4 | minor | **Identical error toasts stack**: two for a 401 on a list, three "You don't have permission to do that." for the Pod Work page of a user without `Task.View`. | `fail-401-list-1366x768`; Pod Work review BUG-2. | De-duplicate (S16). |
| BUG-5 | minor | **A user with `Pod.View` but not `Task.View` is offered Pod Work, then gets errors and toasts** (Pod Work review, BUG-2). The rail item and the route need `Task.View` as the spec says. | Sign in as that role, click Pod Work. | Item hidden, 403 on the URL. |
| BUG-6 | minor | **Name and account shown twice** when they differ only by case (`KE\kekim` over `ke\kekim`; Access Pending `ke\pending (KE\pending)`) (Profile review, BUG-3). | Dev account without a display name. | Case-insensitive comparison. |
| BUG-7 | minor | **A long display name wraps the header** at 768 px and the header grows from 57 to 66 px (Profile review, BUG-2). | 66-character display name, 768x1024. | One line, ellipsis. |
| BUG-8 | nit | **Record 404 title says `Client - MatterFlow`**, not "Client not found"; Task 404 says "Task not found". | `/clients/99999`. | Same wording for all four records. |

Checked and **no bug**: Create task hidden where it should be; Administration hidden without permissions; the 403 link never points to a page the person cannot open; Access Pending focus and Check again; the phone menu focus trap, Esc and backdrop; focus return from dialogs and the drawer; the skip links work; no horizontal page scroll at 375 or 768 on any page measured except Pod Work (Pod Work review, BUG-4).

---

## 12. Proposed work packages and order

Estimates are AI-agent hours including unit tests, an e2e update and screenshots.

| WP | Content | Findings | Effort | Depends on |
|---|---|---|---|---|
| WP-S1 | **Bugs and accessibility quick wins**: skip-link target, `aria-controls`, toast de-duplication, case-insensitive name/account, user button clamp, record 404 titles, an axe best-practice run added to the e2e a11y test | BUG-1..BUG-8 | 4 h | none; do first |
| WP-S2 | **Page-header contract**: Dashboard 22 / 700; Search, Advanced search, My profile compact; phone 18 px; same top offset; the context line replaces sentences beside titles; Administration breadcrumbs on every admin page; the Filters rule written down; document-title rule applied to admin routes | S20, S21, S23 | 10 h | WP-S1; coordinate with the Users, Assets and small-admin reviews' work |
| WP-S3 | **System pages**: one state-page pattern for 403, 404, error and record not found; 403 keeps the URL and offers Copy link; Reference and Copy and brand line on the error page; focus on the heading; disabled-page copy | S9..S12a | 6 h | WP-S1 |
| WP-S4 | **Connection and session**: offline banner and auto-retry, chunk-load failure message, one sign-in banner instead of toasts, inline-only load errors with Reference and Copy everywhere, "Still loading" line | S13..S15, S17 | 8 h | WP-S3 (shares the banner and state components) |
| WP-S5 | **One toast**: single host and position, success as polite status, Undo in the same style, de-duplication and cap, trimmed copy; dialog and drawer rule | S16, S18 | 6 h | WP-S1; the Pod Work review (W8) uses it |
| WP-S6 | **Navigation polish**: Work / Records group labels, "Asset types", 18 px rail icons with a focus tooltip, route announcement, My Work icon, global Create task hidden where the record has its own | S1, S5..S8, S9a | 5 h | none |
| WP-S7 | **Brand and landing**: favicon and logo mark (owner supplies or approves the mark), the Dashboard landing rule for oversight roles (owner's yes), spec update | S2, S4a | 3 h | owner decisions |
| WP-S8 | **Verification and docs**: Playwright screenshots and axe at 375, 768, 1366, 1920 for the pages in section 8, update UX spec 5.1, S21, S22 and the UAT lists | all | 3 h | all |

**Total: 45 agent-hours.** Suggested order: WP-S1; then WP-S2, WP-S3 and WP-S6 in parallel (no shared files beyond tokens); WP-S4 and WP-S5 together (banner and toast share a host); WP-S7 whenever the owner has decided; WP-S8 last. If only two things are done: WP-S1 and WP-S2 (14 h) remove the two critical and moderate axe findings and the visible drift people notice on every click.

**Product decisions needed:** (1) landing for oversight roles (S4a); (2) the toast position (bottom left per decision T #158, or bottom right as the PrimeNG host does today; I recommend left); (3) the logo mark (S2); (4) whether the Filters button of Task Queue, My Work and Pod Work stays in the toolbar (my recommendation: yes, it hosts Columns and Other filters); (5) whether to build the "browser sign-in problem" page (S14) now or at the production rollout.

---

## 13. Already decided or shipped (not re-recommended)

- The rail and its breakpoints, the phone overlay, Administration visibility, the pending badge, skip links and their focus style, "Skip to task list" on work pages, the landing rule (apart from S4a), the 403 link to a page the person can open, record 404/403 states, drill-in and Back focus, the record header and its action rule, the grid contract, toasts bottom left (decision T #158, My Work; S16 asks only that the whole app follow it).
- No notification bell, no approvals inbox (addendum F); no dark theme, no saved views (Out of scope, W).
- Keyboard shortcuts and the shortcut list (owner decision).

## 14. Phase 2 backlog (owner decision: no keyboard-shortcut recommendations now)

Not recommended and not in any work package: shortcuts for the account menu, for the navigation items or for dismissing toasts; a shortcut hint in the search placeholder beyond what exists; a roving-focus mode for the rail.

## 15. What I did NOT verify

- A real screen reader; browsers other than Chromium; 200 and 400 percent zoom; Windows high-contrast mode; touch on a real phone (375 and 768 are emulated).
- Windows authentication failures (Dev auth only): the "browser sign-in problem" page and what a real 401 from IIS looks like.
- A real offline device (Playwright's offline switch only), flaky mobile networks, and the service worker (there is none).
- The Dev-auth banner (the stack ran with the Dev provider; no banner was shown in any screenshot, so I could not review it).
- Users, Assets, Search, Audit Logs, Labels, Asset Types, Custom Fields, Asset link roles: only their header shape was measured, as the task asked.
