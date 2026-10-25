# Search UX review: delivery plan

Owner approval: "I like all of your recommendations, so please don't wait for me. create epics / issues and continue working" (2026-10-20), with product decisions delegated to the PM ("you can make decisions for me"). Decisions are recorded as "Decision (PM)" in each issue's "PM requirements review" comment and summarised below. Date of this plan: 2026-10-20, base `origin/dev` (Task Types epic #352 largely built; Clients #245 and Task Detail #288 done; the shared components are on dev). Source review: `README.md` in this folder (10 findings, 6 bugs BUG-1 to BUG-6, 6 work packages Q-1 to Q-6, 52 agent-hours, 40 screenshots in `screenshots/`, one mock in `mocks/`).

Structure on GitHub: one epic **#421** (labels `epic` + `phase-13`) and 28 sub-issues, label `phase-13`: #455, #456, #458, #459, #461, #462, #463, #464, #465, #466, #467, #468, #469, #470, #471, #472, #473, #474, #475, #476, #477, #478, #479, #480, #481, #482, #483, #484. The numbers are not contiguous because three other planning agents (Users, Assets, Admin pages) created issues in the same period; the order of creation is the order of the table below (the 5 first-release issues first, then the packages in order). None is decided "not now". Folded IDs (named in the host issue title, nothing dropped): BUG-3 (sticky footer) is #459 and its count part is in #463; BUG-4 (counts) is in #466, panel part #463; BUG-5 in #473; S4 is split between #456 (panel) and #469 (grid); S5 in #466; S7 in #470 (the panel keeps its one-line loading); S8 is split between #465 (box) and #471 (page); S10 (short input, empty) in #470 and #471 as regression plus copy; S9 in #478 and #479; review section 8 "not verified" items in #461 and #482. "Verified good" items (combobox ARIA, debounce, stale guard, number normalisation, error and empty states, state in the URL, 44 px rows, 0 axe on results and Advanced at 1366) are regression tests only.

Effort is in **AI-agent hours** (wall-clock of one developer agent, including unit, integration, e2e, axe and screenshots). The review estimated 52 hours; the plan is **82.5** because the review's packages exclude what the Task Types plan also adds: the API issue with its profile (4.5 h), the link-permission verification (3 h), the permission matrix (2.5 h), a keyboard and axe audit (2 h), announcements (1.5 h), the redirect and parity work for Advanced search, and the docs and final verification package (8.0 h). Issues blocked on an owner decision: **none**. The three questions the review put to the owner (section 6) are decided by the PM: (a) additive totals per group in `GET /search`: **yes**; (b) Advanced search is **retired and folded** into the results page, the route stays as a redirect; (c) **3 suggestions per group**.

## 1. Issue list

| # | ID | Title (short) | Agent-h | Depends on | Package |
|---|---|---|---|---|---|
| #455 | BUG-1 | BUG-1: The suggestion panel has no axe violation (scrollable region is a named, focusable region) | 1.5 | First release. Uses #358. | WP-SR1 (R1) |
| #456 | BUG-2, S4 (panel) | BUG-2 / S4: Asset suggestions show Type and Matter Number on the second line, never a URL on the first | 1.5 | After #455 (lane A). First release. | WP-SR1 (R1) |
| #458 | BUG-6 | BUG-6: Sensitive marker once per option and no requestor name in task suggestions | 1.5 | After #456. First release. | WP-SR1 (R1) |
| #459 | BUG-3 (S1 footer) | BUG-3: "View all results" is a sticky footer, always visible and one ArrowDown from the input | 2.5 | After #458. First release. | WP-SR1 (R1) |
| #461 | Review section 8 (not verified), cross-cutting 4 | Hit links lead only where the person may go (narrow-permission users never meet a 403 from search) | 3 | First release. Shares OpenAPI with #462. | WP-SR1 (R1) |
| #462 | S1 (API), S2 (API), decision (a) | API (additive): true totals per group and the searched types in GET /search | 4.5 | None. Lane B first. | WP-SR2 |
| #463 | S1, BUG-4 (panel) | S1: Panel shows 3 hits per group, group headings with true counts and a footer with the total | 4 | #462, #459, #455 | WP-SR2 |
| #464 | S1 (phone) | S1 (phone): Suggestion panel at 375 fits the visible viewport with the footer in view | 2.5 | #463; App-shell epic #585 (#587) | WP-SR2 |
| #465 | S8 (box) | S8 (box): Placeholder and footer name the types that are searched | 1.5 | #462, #463 | WP-SR2 |
| #466 | S2, S5, BUG-4 | S2 (shell): Results page as a fixed-height page with counted tabs and the type and page in the URL | 5 | #462 merged | WP-SR3 |
| #467 | S2 | S2 (All tab): All shows 5 hits per type with "See all N" links | 3 | #466, #468 | WP-SR3 |
| #468 | S2 | S2 (type tabs): Each type tab is a paged grid with the list conventions (44 px rows, name is the link, pager, page size) | 6 | #466; Admin list kit #543-#545, #575 | WP-SR3 |
| #469 | S4 (grid) | S4: One reference column that means one thing (assets show Type and Matter number) | 2 | #468 | WP-SR3 |
| #470 | S7, S10 | S7: Results states use the grid-body contract (skeleton rows, error with reference, empty, short input) | 2.5 | #468 | WP-SR3 |
| #471 | S8 (page), S10, cross-cutting 6 | S8 (page) / S10: "Searched in" line, search echo kept, one verb for more results | 1.5 | #466, #462 | WP-SR3 |
| #472 | S3 | S3 (card): One hit card for all five types on mf-record-card-list | 3.5 | None (new file) | WP-SR4 |
| #473 | S3, BUG-5 | S3 / BUG-5: Phone cards on the results page below 640 px (no table cut at Status) | 4.5 | #472, #468, #469 | WP-SR4 |
| #474 | S6 | S6 (shell): Filters panel on the type tabs (button, chips, Clear filters), applied live, filters in the URL | 4 | #466, slot from #468; epic #75, kit #544 | WP-SR5 |
| #475 | S6 | S6 (Clients, Matters, Projects): Filter definitions and entity pickers for the three record types | 3 | #474 | WP-SR5 |
| #476 | S6 | S6 (Tasks, Assets): Filter definitions for Tasks and Assets including status, requestor and asset type | 4 | #475 | WP-SR5 |
| #477 | S6 | S6: /search/advanced redirects to the results page with type, q and filters; the old page is removed | 2.5 | #474 to #476, #468 | WP-SR5 |
| #478 | S9 | S9: Skip to results, one Tab stop per result and a heading structure that matches the tabs | 2 | #468, #467 | WP-SR6 |
| #479 | Review section 5, cross-cutting 3 | Back from any hit returns to the row: from=search for matters, clients, projects and assets | 2.5 | #468, #477 | WP-SR6 |
| #480 | Review section 5 (announcements) | Announcements for the panel and the results page (counts, tab and page changes) | 1.5 | #463, #466, #474 | WP-SR6 |
| #481 | Audit | Keyboard-only flows and axe audit of the search area at four widths with Tab-stop evidence | 2 | All code issues of WP-SR2 to WP-SR5 | WP-SR6 |
| #482 | Review section 8, cross-cutting 4 | Permission matrix for the search area: narrow users, no dead links, counts and tabs per permission set | 2.5 | All code issues | WP-SR7 |
| #483 | Docs | Docs: ux-spec S11 rewrite, decisions-addendum section AB, UAT rows, e2e catalogue | 3.5 | All code issues | WP-SR8 |
| #484 | Verification | Final verification pass for the search area | 4.5 | All issues | WP-SR8 |

Total: **82.5 agent-hours** (28 issues). R1 = first release. Review ID to issue: BUG-1 #455, BUG-2 #456, BUG-3 #459, BUG-4 #466 and #463, BUG-5 #473, BUG-6 #458; S1 #463, #464 and #462 (API); S2 #466, #467, #468; S3 #472 and #473; S4 #456 and #469; S5 #466; S6 #474 to #477; S7 #470; S8 #465 and #471; S9 #478 and #479; S10 #470 and #471.

## 2. Decisions (PM) in one place

- **Owner decision 1 (binding).** No new or changed keyboard shortcuts in this phase; they are the Phase 2 backlog (#420). The header box keeps its existing Ctrl+K and its text "(Ctrl+K)" exactly. Accessibility mechanisms (a skip link, names, announcements, buttons) are in scope. A test in #478 and #481 compares the key bindings of the search files against the baseline. Shortcut ideas of the review (jump between result groups; Open in Task Queue from a task result) go to #420 as a comment (#483).
- **Owner decision 2 (binding).** Search shows true counts and counted tabs where the API can supply them. They can: Advanced search already counts per type. #462 adds `Total`, `TotalCapped` per group and `SearchedTypes` (additive, no SQL). Exact counts up to a cap (default 1,000, shown "1,000+"). The issue profiles first (100,000 assets, 20,000 tasks); an index or script only if the profile proves it, and then in its own issue with script number 28 (last used 27; 28 free).
- **Suggestion panel (#459, #463, #464, #465).** 3 hits per group, headings with true counts and a "See all N" link, one sticky footer "View all N results" that is an option of the combobox, panel at most 70% of the viewport, phone panel fills the visible viewport with the footer in view. The scroll area is a named region (#455).
- **Results page (#466 to #471).** Fixed-height page, `mf-tabs` `All | Matters | Clients | Tasks | Projects | Assets` with counts for the types the person may view (a zero tab stays), type and page in the URL; All is an overview of 5 per type with "See all N"; each type tab is a paged grid on the Advanced endpoint on the record-list conventions (44 px rows, name is the only link, pager, no column sort, relevance order); "Show more" and the cap of 50 are retired; skeleton rows; "Searched in:" line says what was searched, never what was hidden.
- **Inactive records.** Search includes inactive records by default (Status filter Any), unlike the lists whose default is Active; inactive hits carry the Inactive badge. Deliberate deviation from the #75 list standard, recorded in section AB.
- **Sensitivity and privacy (#458).** Matter options keep the Sensitive badge (addendum O); other options show a lock icon with the name "Sensitive matter" instead of a repeated badge; the requestor is removed from suggestions.
- **Assets (#456, #469).** The reference column is a business number or nothing; the URL reference is tooltip data; assets show Type and Matter number.
- **Phone (#472, #473).** One card for all five hit types on `mf-record-card-list` below 640 px; narrow-window column drop between 640 and 900.
- **Advanced search (#474 to #477).** A Filters panel per type tab on the column-filter standard (live, chips, one Clear, URL keys named like the Advanced API parameters); parity with the old page, no new filters; `/search/advanced` stays as a redirect for good, the page and its radio group are removed.
- **Permissions (#461, #482).** Derived links (matter on a task or asset row) are links only when the person holds that type's View permission; a 403 reached from search is a defect. No new permission, no masking beyond the existing sensitive-matter badge.
- **Return and focus (#479).** Every hit type returns to the row on Back through `list-return.ts` / `drill.ts` (additive `from` kind `search`).
- **Out of scope.** Column sorting of results, saved searches, recent searches, export, custom-field search, screen-reader testing, forced colours, dark theme, print, new filters beyond Advanced parity, any shortcut, header search box placement (App-shell epic), removing the Advanced API endpoint.

## 3. Work packages (ranked)

Rules for developer agents: branch from `origin/dev`, rebase before each push, touch only the files of your package unless the issue says otherwise, regenerate OpenAPI and the client (nswag) when the API changes and never hand-merge them, run unit + integration + e2e + axe (0 violations at 1366, 1920, 768 and 375, with the panel, menus, sheets and filter panel open) and assert no page-level horizontal scroll, attach screenshots in `docs/ux/search-review/fixes/<package>/` (`sr1-bugs`, `sr2-panel`, `sr3-results`, `sr4-phone`, `sr5-filters`, `sr6-a11y`, `sr7-permissions`, `final`), keep the initial bundle at its current size, do not add rules to `task-table.scss`, update the docs named in the issue (WP-SR8). Shared files (`scroll-region.ts`, `record-card-list.ts`, `grid-body.ts`, `pager.ts`, `fixed-page.ts`, `column-filters.ts`, `drill.ts`, `list-return.ts`, `search-meta.ts`) serve other pages: their specs are regression tests, changes additive. Permission variants are mandatory wherever links, tabs, counts or data change: System Admin; `Task.View` only; `Client.View` + `Matter.View`; `Asset.View` only; no View permission (403 page).

| Rank | WP | Issues | Main files / areas | Agent-h | Parallel with | Waits for | Backend / SQL |
|---|---|---|---|---|---|---|---|
| 1 | WP-SR1 Bugs and trust (first release) | #455, #456, #458, #459, #461 | `shared/search/global-search.ts`, `search/hit-table.ts` (link cells), tests | 10.0 | everything | none | none (h1 may add one additive flag) |
| 2 | WP-SR2 Suggestion panel | #462, #463, #464, #465 | `global-search.ts`, `search-meta.ts`, `SearchService.cs`, `SearchDtos.cs`, OpenAPI | 12.5 | WP-SR3 (after the API), WP-SR5 | #462 for the counts | **#462 backend**, additive, no SQL unless profiled |
| 3 | WP-SR3 Results tabs | #466, #467, #468, #469, #470, #471 | `search-results-page.ts` (rewrite), new `search-tabs.ts`, `search-overview.ts`, `hit-table.ts`, `search.routes.ts` | 20.0 | WP-SR2, WP-SR5 filters shell | #462 | frontend only |
| 4 | WP-SR4 Phone cards | #472, #473 | new `search-hit-card.ts`, results page | 8.0 | WP-SR2, WP-SR5 | #472 none; #473 after WP-SR3 | frontend only |
| 5 | WP-SR5 Advanced search into results | #474, #475, #476, #477 | new `search-filters.ts`, `search-filter-defs.ts`, `search.routes.ts`, delete `advanced-search-page.ts` | 13.5 | WP-SR2, WP-SR3 | WP-SR3 slot (#468) | frontend only (optional additive parameter) |
| 6 | WP-SR6 Keyboard, focus and a11y | #478, #479, #480, #481 | results page, `drill.ts`, e2e | 8.0 | none (late) | WP-SR3 to WP-SR5 | none |
| 7 | WP-SR7 Permissions | #482 | e2e, `GlobalSearchApiTests` | 2.5 | none (late) | all code | none |
| 8 | WP-SR8 Docs and final verification | #483, #484 | `docs/ux/*`, `docs/requirements/decisions-addendum.md`, `docs/qa/e2e.md`, e2e | 8.0 | none | all code | none |

Total: about **82.5 agent-hours**.

### First release (do these first, about 10.0 hours)

The defects that hurt today, as 5 issues, all independent of the redesign and safe to ship alone: #455 BUG-1 the axe serious violation on the suggestion panel (1.5 h), #456 BUG-2 no URL as the first line of an asset suggestion (1.5 h), #458 BUG-6 one sensitive marker and no requestor in task suggestions (1.5 h), #459 BUG-3 the sticky "View all results" footer (2.5 h), #461 verification and fix of hit links that would end on a 403 for narrow-permission users (3 h). Lane A takes the four box issues in order (same file); lane B takes #461 after the API issue.

### Waves for 3 to 4 parallel developer agents

Lanes are file owners, not people: one agent owns one lane's files for the whole epic, which is what removes merge conflicts. Lane A owns the header box (`global-search.ts`) and later the keyboard and card wiring on the page after lane C releases it; lane B owns the backend (`SearchService.cs`, OpenAPI), the new filter files and the late tests and docs; lane C owns the results page (`search-results-page.ts`, `hit-table.ts`) and the card component.

- **Wave 1 (first release plus the API and the shell of the page)**
  - Lane A (7.0 h): #455, #456, #458, #459
  - Lane B (7.5 h): #462, #461
  - Lane C (8.5 h): #472, #466
- **Wave 2 (panel redesign, grids, filters shell)**
  - Lane A (8.0 h): #463, #464, #465
  - Lane B (7 h): #474, #475
  - Lane C (11 h): #467, #468, #469
- **Wave 3 (states, copy, skip link, announcements, filter definitions)**
  - Lane A (3.5 h): #480, #478
  - Lane B (4 h): #476
  - Lane C (4.0 h): #470, #471
- **Wave 4 (cards on the page, redirect, return mechanism, matrix, audit)**
  - Lane A (9.0 h): #473, #479, #481
  - Lane B (2.5 h): #482
  - Lane C (2.5 h): #477
- **Wave 5 (docs)**
  - Lane B (3.5 h): #483
- **Wave 6 (verification)**
  - Lane B (4.5 h): #484

Lane totals: A 27.5 h, B 29.0 h (including docs and final), C 26.0 h. Wall-clock with three agents is about **29.0 hours**; one agent alone needs 82.5. A fourth agent can take lane B's filter work (#474 to #476, 11 h) from wave 2, which leaves lane B about 18 hours and the wall-clock at about 28 hours (lane A).

Dependency rules between lanes: lane C's #466 needs #462 merged (lane B does it first, about 4.5 h in; until then lane C builds #472); lane A's wave 2 needs #462; lane B's #474 needs the slot from #468; #477 (lane C) needs #476; lane A's #473 and #479 start only when lane C has released `search-results-page.ts` and `hit-table.ts` (end of wave 3).

### Exact first wave

1. Lane A: #455, #456, #458, #459 (serial, 7 h). 2. Lane B: #462 (4.5 h), then #461 (3 h). 3. Lane C: #472 (3.5 h), then #466 as soon as #462 has merged (5 h). 4. Optional fourth agent: starts #474 at the beginning of wave 2 against the slot contract in #466.

### Critical path

#462 4.5, #466 5, #468 6, #476 4 (parallel), #477 2.5, #473 4.5, #479 2.5, #481 2, then #483 3.5 and #484 4.5: roughly 27 to 30 hours of wall-clock with three or four agents.

### Hot spots (merge-conflict watch)

- **`shared/search/global-search.ts`** (and its spec): #455, #456, #458, #459, #463, #464, #465, #480 in lane order; one agent. The App-shell epic (#585) edits the header (`app-shell.html/.ts`): #587 (the phone search button's `aria-controls`) and the placement of the box must land or be rebased with #464; this epic touches the panel only.
- **`features/search/search-results-page.ts`**: #466, #467, #468, #469, #470, #471 (lane C, in that order), then #478, #473, #479 (lane A) and #477 (lane C); the App-shell issue #604 (compact page header for the Search pages) edits the same header block: coordinate with #466 (the H1 and echo line).
- **`features/search/hit-table.ts`**: #461 (link cells, wave 1), then #468 and #469 (lane C), then #479.
- **`SearchService.cs`, `SearchDtos.cs`, OpenAPI and the TS client**: #462 first; #461 and #476 only if an additive field is needed. Other epics (Users, Assets, Admin pages) also regenerate OpenAPI: rebase, never hand-merge.
- **Admin pages list kit (epic #518)**: #543 table stylesheet, #544 list shell, #545 counted tabs, #575 grid-body states, #579 phone cards and column drop, #554 row overflow. #466, #468, #474, #473 reuse them where they fit; if the kit is not yet on dev when a lane arrives, build on the Clients and Task Types components and adopt the kit in the follow-up of the kit's own issue (no duplicate component).
- **`drill.ts`, `list-return.ts`**: #479 adds a kind; Clients, Matters and Task Types specs are the regression tests.
- **Tests**: older e2e of the Advanced search page and of the stacked sections select the old text, buttons and headings; the package that changes the behaviour updates them (#468 the sections, #477 Advanced search).

### Extension points (for the packages that follow)

- **Hit field map (#472):** one per-type table shared by the grid columns and the card; a new searchable type adds one entry.
- **Filter definitions (#475, #476):** data, shared later with the lists.
- **Search copy deck (`search-meta.ts`, #471):** the only place search wording lives.
- **Totals contract (#462):** `Total`, `TotalCapped`, `SearchedTypes` serve the box and the tabs; a future type adds a group.

### Definition of done per package

Issues closed, tests green twice (including permission variants), axe clean at four sizes with overlays open, no page-level horizontal scroll, screenshots in `fixes/<package>/`, bundle and style budgets kept, API changes additive with regenerated OpenAPI and client, no keyboard binding added or changed, the docs named in the issue noted for WP-SR8, the epic #421 tasklist ticked, and the line below added to the Status section.

### Docs package (WP-SR8, #483)

`ux-spec.md` S11 rewritten to the code (box, panel, tabs, grids, cards, filters, redirect, states, copy deck, UAT rows), section **AB** of the decisions addendum (every Decision (PM) above; the last section on dev today is X; the sibling epics (Task Types, Users, Assets, Admin pages, App shell) take the letters in between by their own plans, this epic takes AB), `docs/qa/e2e.md`, `architecture.md` for the additive fields and the permission note, a banner in the review README, a comment on #420 with the search shortcut ideas. Where the code differs from the issues, the docs follow the code and say so.

### Final verification package (WP-SR8, #484)

Contract e2e over the seeded data of the review at four sizes (axe 0 including `target-size`, no sideways scroll, 44 px rows, counted tabs equal the API totals, footer visible, no scroll region without a name), the state matrix (loading, error, offline, empty, short, reduced motion), the permission matrix of #482, regression subsets for every shared file touched (Clients, Matters, Task Types lists, Task Detail drill-in, column filters), the before/after table of the review's measurements (page height 2,517 px, panel 448 px and footer position, axe violations, Tab stops), bundle report, the profile of #462, screenshots in `fixes/final/`, and a closing comment on the epic.

## 4. Status

(One line per work package; keep other packages' lines when merging. Format: `WP name (date, commit): issues done / open; tests; bundle size; screenshots folder; known limits.`)

- Owner decision (2026-10-20): no new or changed keyboard shortcuts in this phase (Phase 2 backlog #420); Ctrl+K on the header box is unchanged.
- Planning (2026-10-20): epic #421 and issues #455, #456, #458, #459, #461, #462, #463, #464, #465, #466, #467, #468, #469, #470, #471, #472, #473, #474, #475, #476, #477, #478, #479, #480, #481, #482, #483, #484 created and linked as sub-issues; PM requirements review comments posted on every issue; no issue is blocked on the owner; SQL script 28 is free and none is planned (an index only if #462's profile proves it).
- Coordination (2026-10-20): Admin pages epic #518 owns the list kit (#543, #544, #545, #575, #579, #554); App-shell epic #585 owns the header and the box placement (#587, #604 touch Search); Users #422 and Assets #485 regenerate OpenAPI too.
- First release (#455, #456, #458, #459, #461): done (see WP-SR1 lines).
- WP-SR1 lane B (2026-10-21): #461 done (no dead link found; table in `fixes/sr1-bugs/link-permissions.md`, e2e `sr1-link-permissions`, server test `GlobalSearchLinkPermissionsTests`); WP-SR1 complete.
- WP-SR1 lane A (2026-10-20): #455, #456, #458, #459 done (header suggestion panel: named single scroller, asset lines without the URL, one named lock and no requestor, sticky footer as a combobox option); #461 open (lane B); unit and e2e green, axe 0 at four sizes with the panel open; bundle unchanged; screenshots `fixes/sr1-bugs/`; known limit: the footer shows no count until #463.
- WP-SR2 Suggestion panel (2026-10-21, lane B): #462 done (additive `Total`, `TotalCapped` per group and `SearchedTypes`, cap 1,000, no SQL, script 28 still free; profile in `fixes/sr2-panel/profile.md`); #463 to #465 open; backend integration tests green (85 search tests), OpenAPI and client regenerated.
- WP-SR3 Results tabs (2026-10-21, lane C): #466 done (fixed-height page on the admin list shell, counted tabs from the totals, `type`, `page`, `pageSize` in the URL, All = 5 per type, type tab = paged Advanced endpoint with the old hit table); #467 to #471 open (`Show more` and the cap of 50 are gone; the sections still use the old table until #468); e2e `sr3-results-tabs` green twice, axe 0 at four widths; screenshots `fixes/sr3-results/`.
- WP-SR4 Phone cards (2026-10-21, lane C): #472 done (`search-hit-card.ts`, stand-alone, unit-tested for five types and axe on the unit DOM; not wired into the page, so no e2e or screenshots until #473); #473 open.
- WP-SR2 Suggestion panel (2026-10-25, b763b78): #463, #464, #465 done (3 hits per group with true counts and See all, footer total, searched types, phone sheet); e2e `sr2-panel`; screenshots `fixes/sr2-panel/`; bundle 626 kB; known limit: no 320 px minimum height.
- WP-SR3/SR4 Results grids and cards (2026-10-25, 14add21, ac2a76e): #467 to #471, #473 done (`search-grid.ts` replaces the hit table; cards below 640 px; grid-body states; Searched in line); e2e `sr3-grids`; screenshots `fixes/sr3-results/`.
- WP-SR5 Advanced search into results (2026-10-25, a75de9a): #474 to #477 done (`search-filters.ts`, `search-filter-defs.ts`, redirect, old page removed); e2e `sr5-filters`; screenshots `fixes/sr5-filters/`; known limits: inline panel at every width, no Project filter on tasks.
- WP-SR6 Keyboard, focus and a11y (2026-10-25, 60c3d0b): #478, #480, #481 done, #479 partly (row focus on browser Back for every type; no "Back to search results" crumb on the record pages); e2e `sr6-a11y`; evidence `fixes/sr6-a11y/tab-stops.md`.
- WP-SR7 Permissions (2026-10-25): #482 done (e2e `sr7-permissions`).
- WP-SR8 Docs and final verification (2026-10-25): #483 done (ux-spec S11, addendum AB, UAT rows, e2e catalogue); #484: see its comment.
