# Search: independent UX review

Scope: the **global search box** in the app header (suggestions, groups, states, phone), the **results page** `/search?q=` and **Advanced search** `/search/advanced`. Reviewed at `origin/dev` `48aa4aa` as a System Administrator would see it, with seeded data (1,205 assets, 170 tasks, 12 matters, 5 clients, 4 projects): production build, published API with Dev auth, SQL Server, Playwright Chromium. **No application code was changed and no issues were created.**

In flight and not reviewed: Task Types epic, column-filters re-review (#75), keyboard audit. **No keyboard-shortcut recommendations** (owner decision); `Ctrl+K` already exists and is untouched.

Evidence: `screenshots/` (40 PNGs, `<name>-<width>x<height>.png`, 1366x768 unless named otherwise; `gs-*` is the header box, `results-*` the results page, `advanced-*` Advanced search; `mock-search-suggest` is a mock, source in `mocks/`).

Severity: **major / minor / nit**; effort in AI-agent hours (h).

---

## 0. Page inventory

| # | Route / surface | Purpose | Permission |
|---|---|---|---|
| 1 | Header search box (every page) | Typeahead: up to 5 hits per type, grouped Matters, Clients, Tasks, Projects, Assets; "View all results" | at least one searchable type's View permission |
| 2 | `/search?q=` | Sections per type, 10 first, "Show more" to 50 | same |
| 3 | `/search/advanced` | Type chooser, type-specific filters, paged results (25) | same |
| 4 | Phone search (375) | the box opens full width from a search button | same |

**4 surfaces; 5 searchable types.** Not present although `ux-spec.md` S11 describes them: **tabs by object (All, Clients, Matters, Projects, Tasks, Assets) with counts** on the results page; the results page shows stacked sections whose count reads `(10+)`.

---

## 1. Summary

What works: a proper ARIA combobox (`aria-activedescendant`, Up/Down, Enter, grouped listbox, live announcement), 250 ms debounce, number-aware matching (`90001-80006` and `9000180006` both resolve), match highlight, a clear empty ("No results for 'zzzzqqq'. Try a client or matter number, a task title, or an asset name." plus "View all results"), an honest error with reference and Try again, a stale-response guard, results table rows of exactly 44 px, the sensitive-matter badge, drill-in `from=search` with focus return to the task link, 0 axe violations on the results page and Advanced search at 1366.

What lets it down:

- **The suggestion panel hides most of what it fetches.** It is 448 px tall for up to 25 options: for `demo` the Matters and Clients groups fill it and **Tasks, Projects, Assets and the "View all results" footer are below the fold**; the panel is a scroll region with no focusable content, which axe reports as **serious** (`scrollable-region-focusable`). The footer is not sticky.
- **The results page does not say how many results there are.** Sections read `Matters (10+)`; asset search for `review` has **116 results**, reachable only through four "Show more" clicks to a cap of 50 and then "Refine in advanced search" (page 2,950 px tall). The spec's tabs with counts are not built.
- **Two result pages, two designs.** Results (stacked sections, scrolling page, no filters) and Advanced search (a radio group and a form, also a scrolling page) are not the list grids of Clients/Matters/Assets, and a person who has found a type of record cannot filter it the way the list does.
- **Phone**: tables are cut at the Status column (`results-demo-375x812`), no cards.

### Top 10 findings, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | **Suggestion panel redesign**: 3 hits per group, group headings with true counts, a sticky "View all N results" footer, panel height up to 70% of the viewport; no scroll region without a focusable child. | `gs-suggest-demo-1366x768`, `gs-suggest-review-1366x768`, `mock-search-suggest` | M, 8 h (API totals) | S1, BUG-1 |
| 2 | **Results page with counted tabs** `All 140 | Matters | Clients | Tasks | Projects | Assets` (`mf-tabs`), each a paged grid; All shows 5 per type with "See all". | `results-review-expanded-1366x768`, `results-demo-1366x768` | L, 14 h (API counts) | S2 |
| 3 | **Fix the axe violation** (serious) on the suggestion panel. | axe run, `gs-suggest-demo-1366x768` | S, 1 h | BUG-1 |
| 4 | **Phone cards for results** (shared card renderer) and a results page that is not the Status-cut table. | `results-demo-375x812`, `results-demo-full-375x812` | M, 8 h | S3 |
| 5 | **Fold Advanced search into the results page** as a Filters panel per tab (the list filter definitions already exist), keep `/search/advanced` as a redirect with `type` and `q`. | `advanced-assets-1366x768`, `advanced-empty-1366x768` | L, 12 h | S6 |
| 6 | **One reference column that means one thing**: assets show Type and Matter Number, not the external URL as a second link; the suggestion option never puts a 1,000-character URL on its own first line. | `advanced-assets-1366x768`, `gs-suggest-review-1366x768` | S, 2 h | S4, BUG-2 |
| 7 | **Loading as skeleton rows** (the shared record-state/grid-body) not the text "Searching...". | `results-loading-1366x768`, `gs-loading-1366x768` | S, 2 h | S7 |
| 8 | **Search echo and recent**: "Showing results for 00343-00012 (you typed 343-12)" kept; add a one-line "Searched in: Matters, Clients, Tasks, Projects, Assets" so a person without a permission knows a type is missing. | `results-number-1366x768` | S, 2 h | S8 |
| 9 | **Page chrome**: crumb-less H1 stays, but use the fixed-height page and the grid pager, so the page does not scroll 2,500 px. | `results-demo-full-1366x768` | M, 5 h | S2, S5 |
| 10 | **Tab stops and names**: skip to results after the box, each result row one stop (the reference link is already out of the order), group headings as `h2`. | tab run, section 5 | S, 3 h | S9 |

---

## 2. Findings by surface

### 2.1 Global search box (header)

Screens: `gs-focus-empty`, `gs-one-char`, `gs-suggest-demo` (1366, 768), `gs-suggest-number`, `gs-suggest-number-raw`, `gs-no-results`, `gs-suggest-review`, `gs-keyboard-active`, `gs-loading`, `gs-error`, `gs-phone-header`, `gs-phone-open`, `gs-phone-suggest`.

**What works.** The box is 640 px, always visible, with a clear button and the placeholder naming the types and the existing shortcut; one character shows the hint; numbers resolve in both shapes; every option has the reference first (monospace), the label with the highlight, a muted second line (client, requestor); the Sensitive badge; Enter on "View all results" opens `/search?q=`; the live region says "Searching".

**S1 (major, M): the panel truncates its own answer.** `[data-search-panel]` is 640 x 448 px with 25 options for `demo`; the first screen shows Matters (5) and the first four clients; Tasks, Projects and Assets need scrolling, and **"View all results" is the last item of the scroll** (`gs-suggest-demo-1366x768`). With ArrowDown the list scrolls under the pointer and the footer is reached after 25 presses. For `90001-80006` the Tasks group pushes in the requestor text `[demo DRD1L]` (seed data, but real requestor names would show there too) and each task repeats a Sensitive badge (`gs-suggest-number-1366x768`). Recommend: 3 hits per group (spec says max 5), the group headings carry the true count `TASKS (24)`, a **sticky footer** "View all 140 results for "review"" and, when a group has more, "24 tasks" as the header link; panel max height 70vh. At 375 the panel covers the page below the box (`gs-phone-suggest-375x812`); there the footer and counts matter more. 8 h with the API totals (one additive `total` per group).

**BUG-1 (major, S): axe `scrollable-region-focusable` (serious)** on `.mf-gs__panel` when it scrolls (1 node). The listbox is operated by `aria-activedescendant`, so a scrollable container with no focusable child is flagged. Make the panel `overflow: hidden` with the list as the scrolling element and give the scroller `tabindex="-1"` only if needed, or remove the scroll by S1. 1 h.

**S4/BUG-2 (nit, S): asset options.** An asset with a URL reference prints the URL as the first line of its option (`gs-suggest-review-1366x768`: `https://relativity.example-firm.test/Relativity/workspace/1000020` above the name), so it reads as belonging to the option above; the reference column is a monospace code for matters and tasks. Show Type and Matter Number for assets and keep the URL for the results table. 1 h.

**S7 (minor, S): loading** is the text "Searching..." (no layout), fine for a 250 ms request, but on a held request the panel is a single line (`gs-loading-1366x768`). Keep the line; the results page should use skeleton rows (see 2.2).

**S8 (nit, S): permission silence.** The box searches the types the person may view and says nothing about the others; for a role with `Task.View` only, the placeholder still says "clients, matters, tasks, assets". Name the searched types in the placeholder or the footer. 2 h. (Not verified with narrow roles; the code builds the type list from permissions.)

**Phone (verified).** The search button opens a full-width box that works (`gs-phone-open-375x812`); the suggestion panel is the same list, 520 px tall, with no footer visible.

### 2.2 Results page (`/search?q=`)

Screens: `results-demo` (4 widths), `results-demo-full`, `results-review` (4 widths), `results-review-expanded`, `results-number`, `results-empty`, `results-short`, `results-noquery`, `results-loading`, `results-error`.

**What works.** The echo line `Showing results for 00343-00012 (you typed "343-12")`; five sections in the spec order; rows 44 px with match highlight; Show more with a busy state and an error that keeps what is on screen; "Showing the first 50. Refine in advanced search"; an empty state with "Try advanced search"; the query in the URL.

**S2 (major, L): no counts, no tabs, and a long page.** The headings say `Matters (10+)`, `Clients (5)`, `Tasks (10+)`, `Projects (4)`, `Assets (10+)` (the "+" covers "at least 10"). For `review` the real totals are 24 tasks and 112 assets; a person reads 10+ and does not know whether it is 11 or 11,000. The page is 2,517 px at 1366 for `demo` and 2,950 px after expanding assets to the cap of 50 (`results-review-expanded-1366x768`), and Show more re-requests the whole group each time (10, 25, 40, 50). Recommend the spec's tabs: `mf-tabs` `All 140 | Matters 0 | Clients 0 | Tasks 24 | Projects 4 | Assets 112` with counts, `All` = 5 per type with "See all 112 assets", every other tab a normal paged grid (pager, page size, the same columns as the list) inside the fixed-height page; the tab and page are in the URL (`type=`, `page=`); focus returns to the row on Back (the drill-in exists for tasks). 14 h with additive group totals in `GET /search`.

**S3 (major, M): phone.** At 375 the Matters table is 372 px wide with Status cut off, the Tasks table cuts Matter (`results-demo-full-375x812`). Use the shared cards: reference and name, client or matter line, status badge. 8 h.

**S5 (minor, S): chrome.** The page is a normal scrolling page with the H1 "Search results" and a lone "Advanced search" button; it does not follow the fixed-height page with its own grid scroll. With S2 it does.

**S7 (minor, S): states.** Loading is "Searching..." text (`results-loading-1366x768`), a 40 px block that becomes 2,500 px; use skeleton rows with the final widths. The error ("Search is unavailable. Try again.", reference, Try again) is good.

**S9 (minor, S): keyboard** (section 5).

**S10 (verified good): short and empty inputs.** `a` shows "Type at least 2 characters (or a number)"; `/search` with no query the same; the empty result says what to try.

### 2.3 Advanced search (`/search/advanced`)

Screens: `advanced-empty` (3 widths), `advanced-assets` (3 widths), `advanced-tasks`, `advanced-empty-result`.

**What works.** A fieldset "Search for" with one radio per type the person may view, only the filters the API accepts for that type, entity pickers for Client and Matter, task status checkboxes, Search and Reset, `116 results` as an H2, the whole search in the URL, 25 per page with the shared pager, 0 axe violations.

**S6 (minor, L): a second list design.** The same filters exist as inline column filters on Clients, Matters, Projects and Assets, with chips, a hidden-inactive hint and one Clear filters; Advanced search has its own Status select ("Any, Active, Inactive", not the Active default) and a Search button (filters do not apply live). Results are the mixed hit table, 1,598 px tall at 1366. Recommend folding it into S2 as a Filters panel per tab; the route stays as a redirect (`/search/advanced?type=asset&q=review` -> `/search?type=asset&q=review&filters=open`). Touches the #75 standard for the filter control: coordinate. 12 h.

**S4 (minor, S): reference column.** For assets the first column ("Reference") is the external reference, a long URL in monospace that is also a link, in front of the Name link to the same record (`advanced-assets-1366x768`); rows of assets with no reference have an empty first cell. The column for assets should be Type then Matter Number; reference moves to a tooltip or the record.

---

## 3. Cross-cutting consistency

1. **Counted tabs.** Every reworked page counts its tabs; search is the one place where a number would change behaviour.
2. **List contract.** Results and Advanced search tables have 44 px rows (good) but no phone cards, no pager on results, no skeleton.
3. **Hit semantics.** One link per row (the reference link is out of the tab order and hidden from assistive technology: good), name link with `from=search` for tasks only; matter, client, project and asset links do not carry `from`, so Back from a matter returns to the page via history only.
4. **Permissions.** Types without View are not searched and not shown. Not verified: whether a matter or asset hit links to a page the person cannot open (the hit table links names by path; see section 8).
5. **Shortcut surface.** The placeholder prints "(Ctrl+K)"; frozen, unchanged.
6. **Microcopy.** Empty, error and short messages are the spec's. "Show more" vs "See all": one verb.

---

## 4. Bug list (with repro)

Environment: `origin/dev` `48aa4aa`, Chromium 1366x768, Dev auth.

| ID | Sev | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | major | **axe `scrollable-region-focusable` (serious)** on the suggestion panel. | Type `demo` in the header box and run axe. | 0 violations. |
| BUG-2 | nit | **A URL reference is the first line of an asset suggestion**, reading as part of the option above. | Type `review`, scroll to Assets (`gs-suggest-review-1366x768`). | Type and Matter Number as the second line. |
| BUG-3 | minor | **"View all results" is only reachable at the end of 25 options** (below the fold, not sticky). | `demo` then ArrowDown (`gs-suggest-demo-1366x768`). | Sticky footer (S1). |
| BUG-4 | minor | **Group heading counts read "(10+)" for exactly-known small sets and hide the real total for large ones.** | `/search?q=review` (112 assets). | True counts (S2). |
| BUG-5 | minor | **Result tables are cut at 375** (Status or Matter off screen) with no scroll cue. | `/search?q=demo` at 375. | Cards (S3). |
| BUG-6 | nit | **Task suggestions repeat the Sensitive badge on every row and show the requestor in brackets** (`[demo DRD1L]`) which is seeded data but would be the real requestor name. | `90001-80006`. | One badge per matter group or only on matters; decide whether the requestor belongs in a suggestion. |

Verified and **no defect found**: debounce and stale response guard (a second query replaces the first), number normalization in both shapes, error and empty states, state in the URL, the 50 cap message, Show more error keeps the rows, 0 axe violations on results and Advanced search, no page-level horizontal scroll.

---

## 5. Keyboard, focus and accessibility basics

- **Combobox.** `role=combobox`, `aria-expanded`, `aria-controls`, `aria-activedescendant` verified (`mf-gs-task-66` after two ArrowDown). Enter opens the active option. Esc closes (existing behaviour, not changed).
- **Results page.** No skip link to the results; the Tab order is Advanced search, then every row's name link (one stop per row; the reference link is correctly out of the order). Back from a task result focuses the link left (T9, #324); from a matter, client, project or asset the focus is not restored (minor, S, 2 h: `from=search` for all types, the way Clients/Matters use `list-return.ts`).
- **Group headings** in results are `h2` (good); in the suggestion list they are `presentation` spans with `aria-labelledby` groups (good).
- **Colour**: highlight is bold and underline, not colour only.
- **Announcements**: one polite message per result set ("24 results for review").
- Print: not verified.

---

## 6. Proposed work packages and order

| WP | Package | Contents | Findings | Est. |
|---|---|---|---|---|
| Q-1 | **Bugs and states** | axe violation, asset option line, one badge, skeleton loading, copy | BUG-1, 2, 6, S7 | 5 h |
| Q-2 | **Suggestion panel** | 3 per group, counts, sticky footer, max height, phone panel | S1, BUG-3 | 8 h (incl. 2 h API totals) |
| Q-3 | **Results tabs** | counted `mf-tabs`, paged grids, All overview, URL keys, fixed-height page | S2, S5, BUG-4 | 14 h |
| Q-4 | **Phone cards** | shared renderer for hits | S3, BUG-5 | 8 h |
| Q-5 | **Advanced into results** | filters panel per tab, redirect, shared filter definitions | S6, S4 | 12 h |
| Q-6 | **Keyboard and focus** | skip to results, `from=search` for all types, focus return, axe at four widths | S9 | 5 h |

**Total: 52 agent-hours.** Order: Q-1, Q-2 (independent of the page), Q-3 (needs the API totals from Q-2), Q-4, Q-5, Q-6. Cut line: Q-1 and Q-2 (13 h) repair the box people use every day; Q-3 is the largest change in value.

Decisions needed: (a) additive `total` per group in `GET /search`; (b) whether Advanced search stays a separate page (Q-5 retires it); (c) 3 or 5 suggestions per group (spec says 5).

## 7. Phase 2 backlog (keyboard shortcuts, not recommended now)

Owner decision: none changed. For later only: a shortcut to jump between result groups, and a shortcut for "Open in Task Queue" from a task result.

## 8. What I did NOT verify

Roles with fewer searchable types (the type list is built from permissions; a person without `Matter.View` was not walked, so whether matter hits link to a 403 page is open), performance beyond 1,205 assets and 170 tasks (the API answered each query within the debounce window on this stack; no timing harness was run), Windows high contrast, a screen reader, 200% and 400% zoom, print, dark theme (none), custom-field search (none flagged searchable), sensitive-matter masking beyond the badge.
