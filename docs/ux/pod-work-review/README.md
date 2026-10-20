# Pod Work as a page: independent UX review (`/pods/work`)

Scope: **Pod Work** as a page: header, pod picker and pod scope, summary strip, the four tabs, the By member workload presentation, the assign flows, empty / no-pod / choose-pod states, multi-pod users, phone, tablet and wide screens. The shared grid itself (columns, filters, density, inline menus, cards) was reviewed with the Task Queue and is **not** re-reviewed; where the page-specific use of it matters (Assign to me, default columns at 768 px) it is said so. Reviewed as a senior UX designer and front-end reviewer on `origin/dev` at `48aa4aa`. **No application code was changed.** Everything below was observed in the real stack (published API with Dev auth, SQL Server 2022, the production Angular build) driven with Playwright Chromium, plus a read of `features/pod-work`, `shared/work-queue/*`, the Pod Work API response and UX spec S04.

Screenshots are in `screenshots/` (`<name>-<width>x<height>.png`; 1366x768 unless the name says otherwise; 1920x1080, 768x1024 and 375x812 where it matters). Before/after mocks are in `mocks/` (HTML plus PNG).

**Test data.** `npm run seed:demo` (50 test users, 4 pods of 11 to 23 members, 200 tasks), plus: an empty pod ("Demo Empty Pod"), a pod with a 76-character name, a user in five pods (primary set), a technician in two pods, a user in no pod, a Director, a Read-Only Observer, an Intake Coordinator and a user with `Pod.View` but without `Task.View`. The busiest pod has 4 unassigned, 20 assigned, 4 overdue and 6 on-hold tasks and 23 members of whom 16 have no open work.

Ranking key: **severity** blocker / major / minor / nit; **effort** in AI-agent hours (S is 1 to 3, M is 4 to 8, L is 9 or more).

**Owner decision applied:** no keyboard-shortcut recommendations; the Phase 2 note is at the end.

---

## 1. Page inventory

| # | Surface | Route or place | Purpose | Permission |
|---|---|---|---|---|
| 1 | Pod Work page | `/pods/work?podId=&view=&...` | One pod's open work: who holds what, what nobody holds | route guard `Pod.View`; UX spec S04 says `Task.View` and `Pod.View` (see BUG-2) |
| 2 | Pod picker | header, right | Choose the pod (Your pods first, then Other pods; last choice remembered) | `Pod.View` |
| 3 | Summary strip | under the header | Unassigned, Assigned, Overdue, On Hold of the pod | `Pod.View` |
| 4 | Tab: Unassigned | `view` omitted | Open tasks in the pod that no person holds; **Assign to me** in the cell | `Task.Assign` for the link |
| 5 | Tab: By member | `view=members` | Open work per person plus the grid below it filtered by "Show tasks" | `Pod.View` |
| 6 | Tab: Overdue and on hold | `view=attention` | Overdue or on-hold tasks of the pod | `Pod.View` |
| 7 | Tab: All pod tasks | `view=all` | All open tasks of the pod | `Pod.View` |
| 8 | Assignee menu / picker | in the grid | Assign to me, pick a member (with open counts and availability), remove | `Task.Assign` / `Task.Reassign` |
| 9 | States | page | No pod, choose a pod, empty pod, empty tab, loading, error | n/a |

One page, four tabs, four supporting surfaces. Everything else on the page is the shared grid.

---

## 2. Summary

Pod Work is **the page where the shared grid is strongest and the page itself is weakest.** What works: the grid, the URL (`podId`, `view`, filters), the remembered pod, the "Assign to me" link in the cell with a 4-second grace before the row leaves and the tab counts refresh, Undo, the read-only rendering for people without `Task.Assign` (italic "Unassigned", no links: `pod-work-observer-readonly`), the document title ("Pod Work: By member"), drill-in and Back (focus returns to the row you left, the crumb says "Pod Work", the nav stays on Pod Work; verified), and a picker that already shows availability ("Out of office until Oct 26").

What does not work is everything the page adds on top of the grid:

1. **By member is the page's reason to exist and it is a stub.** It is an alphabetical list of all 23 members, 16 of them `0 / 0 / 0`, in a 230 px scroll box above the grid: 4 rows visible at 1366x768; no availability, no sort, no bar, no "unassigned" row, and the tab count "By member (16)" is a number of **tasks**, not people. (W1)
2. **The header breaks at 768 px**: the title wraps letter by letter ("Po / d / Wo / rk") because the pod select takes the width, and "Assign to me" is clipped off the table. At 375 the select runs past the screen edge. (BUG-1, BUG-4)
3. **People who most need an overview get a dead start.** Directors, Project Managers and Observers (no pod) open an empty page that says "Choose a Pod to see its work." (W3)
4. **The strip is inert, repeats the tabs and goes stale**: four numbers that the tabs show again, not clickable (unlike My Work's), and it keeps the old numbers after an assignment while the tabs update. (W5, BUG-3)
5. **A person with `Pod.View` but not `Task.View` sees Pod Work in the menu, then "Couldn't load tasks." and three stacked "You don't have permission" toasts.** (BUG-2)

### Top recommendations, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | Fix the seven bugs (768 header, permission guard, stale strip, phone overflow, skip target on By member, empty-pod double message, strip arithmetic) | BUG-1 to BUG-7 | 6 h | BUG-1..7 |
| 2 | Make By member a real workload table: members with work first, idle ones folded, availability chip, neutral bar, Unassigned row, sortable, no nested scroll box, tab counts people with work | `pod-work-members-1366x768`, `mocks/mock-by-member.png` | 10 h | W1 |
| 3 | Pod scope in the header: a context line (name, members, your membership), a capped picker, the pod in the document title, a pod list instead of a dead "Choose a Pod" | `pod-work-as-director-1366x768` | 6 h | W2, W3, W6 |
| 4 | One strip vocabulary across My Work and Pod Work (Overdue, Due today, ASAP, On hold), each a link, no duplicates of the tabs | section 7 (comparison table) | 5 h | W5 |
| 5 | Tablet and phone: keep Assign to me visible at 640 to 1099 px, By member as cards below 640 | `pod-work-unassigned-768x1024`, `pod-work-members-2-375x812` | 6 h | W9, W10 |
| 6 | Shorter Undo toast in the shared toast style | `assign-to-me-toast-1366x768` | 3 h | W8 |

Total of all work packages: **about 39 agent-hours** (section 8).

---

## 3. Header, pod scope, strip and tabs

Screens: `pod-work-unassigned-1366x768`, `pod-work-unassigned-1920x1080`, `pod-work-unassigned-768x1024`, `pod-work-unassigned-375x812`, `pod-work-queue-375x812`, `multi-pod-picker-closed-1366x768`, `pod-long-name-queue-1366x768`, `pod-long-name-members-1366x768`, `pod-work-attention-1366x768`, `pod-work-all-1366x768`, `pod-work-as-director-1366x768`, `pod-work-as-testuser11-1366x768`.

### What works

- Title row (icon, 22 px bold H1) is the shared page header; the pod picker sits where the actions go. The picker groups "Your pods" (primary marked "(primary)") and "Other pods"; the last choice is remembered per user and the URL carries `podId`.
- Tabs with counts use the shared `mf-work-tabs`; the label of the open tab is in the table caption and the document title.
- The Unassigned tab disables the Assignee filter and writes "Unassigned" into the cell (no empty grey box, as decided in section X).
- Wide screens: at 1920 the grid uses the width; the page header and picker stay aligned to the right edge.

### Issues and recommendations

**W2 (major, S): the pod scope is only a native select, and it sizes the header.** The select is as wide as its longest option: 560 px at 1366 with a 76-character pod name in the list, which is why the title collapses at 768 (BUG-1) and the control overflows at 375 (BUG-4). Nothing on the page says which pod it is except the selected option; the document title does not name it ("Pod Work: By member - MatterFlow"); the table caption does ("Pod Work: Unassigned (Demo Processing Pod)").
Recommendation: keep the select (it is accessible and the right control for 4 to 12 pods), but cap it (`max-width: 22rem`, ellipsis, full name as tooltip and accessible name) and never let it shrink the title (the title does not wrap; the select wraps under it when it cannot fit). Add one muted context line under the title, as the record headers do: **"Demo Processing Pod . 23 members . you are a member (primary)"**, and put the pod in the document title (`Pod Work: Demo Processing Pod: By member`). Mock: `mocks/mock-header-tablet.png`.

**W3 (major, S): the dead start for people without a pod.** The Director, an Observer or any user with `Pod.View` and no membership and no remembered pod opens "Choose a Pod to see its work." with a native select as the only control (`pod-work-as-director-1366x768`). The code opens the primary pod, or the only pod, and nothing else (UXR-30), so the first look of the page for the oversight roles is empty. Also, **the "You aren't in a pod yet. Ask an administrator." hint can only appear when the system has no pods at all**: the API returns every pod to anyone with `Pod.View`, so a user in no pod gets "Choose a Pod" instead (read from `pod-work-page.ts`, `data-empty="no-pod"`; I could not remove all pods from the seed to show it). The sentence is also the wrong advice for that case.
Recommendation: when no pod is chosen, show the pods as a list of buttons in the page body, grouped Your pods / Other pods, with the pod name only (the API does not return counts; adding `memberCount` and unassigned counts is a small extension if wanted), and keep the select for later switching. Replace the no-pod hint by "There are no pods yet." with, for people with `Pod.Manage`, a link "Create a pod" to Administration > Users > Pods; everyone else sees "Ask an administrator to create one."

**W4 (nit, S): the title sits lower than on its sibling pages.** The H1 top is 18 px on Pod Work and 12 px on My Work and Task Queue because the 40 px select makes the title row taller; clicking through the nav moves the title by 6 px. Recommendation: align the row to the title baseline (the select is `align-self: center` with a 32 px height, the shared `mf-control` compact size), same 12 px top as the other work pages.

**W5 (major, M): the summary strip is inert, repeats the tabs and cannot be added up.** Four plain-text numbers, `Unassigned 4 / Assigned 20 / Overdue 4 / On Hold 6`, none a link (`mf-work-strip` is clickable on My Work and Task Queue, decision T says "Pod Work shows its summary with the same component"). The tabs directly under it repeat three of them: `Unassigned (4)`, `By member (20)`, `Overdue and on hold (9)`. Overdue 4 + On Hold 6 is 10, the tab says 9 (a task can be both), which looks like an arithmetic error to a Pod Lead. And the numbers are stale after an assignment (BUG-3).
Recommendation: make the strip the pod's **needs-attention line with the same four items as My Work, Overdue, Due today, ASAP, On hold**, each a link that applies the filter on the All tab and toggles off (the My Work behaviour); the tabs keep Unassigned and Assigned. The API summary needs `dueToday` and `asap` (two counts, same query shape as My Work). People see one vocabulary on both pages and no number twice. Counts follow the pod only, never the grid filters (as My Work). Mock: `mocks/mock-by-member.png`.

**W6 (minor, S): tab names.** "All pod tasks (21)" lists **open** tasks only (Pod Work lists open work, the Status filter is limited to open statuses). Task Queue calls the same thing "All open". Rename to **All open**. "By member (16)": see W1.

**W7 (minor, S): the empty pod says two things.** On a pod with no members the By member tab shows "No members yet." and, below it, the grid with "Nobody in Demo Empty Pod has open work." (`pod-empty-members-1366x768`). Recommendation: one state: "No members yet." plus, with `Pod.ManageMembers`, the link "Add members" (Administration > Users > Pods, `?pod=<id>`), and no grid. On the other tabs of an empty pod the existing "Nothing waiting in Demo Empty Pod." / "No open tasks in ..." is right.

**W11 (nit, S): the strip on a phone is a 2x2 grid of boxes, on a laptop plain text.** Three looks for one component across widths (`pod-work-queue-375x812` against `pod-work-unassigned-1366x768`). With W5 the strip becomes the chip row used on My Work; below 640 px it scrolls horizontally in one line instead of taking 100 px.

---

## 4. By member: the workload presentation

Screens: `pod-work-members-1366x768`, `pod-work-members-1920x1080`, `pod-work-members-2-768x1024`, `pod-work-members-2-375x812`, `members-show-tasks-1366x768`, `pod-long-name-members-1366x768`, `pod-long-name-members-375x812`, `pod-empty-members-1366x768`.

### What works

- The caption states the rule: "Open work per person. These are workload facts, not a ranking." (UX principle 12: no people-scoring.)
- "Show tasks" per member filters the grid by that person, is a real toggle (`aria-pressed`) and the filter appears as the Assignee filter chip; the URL carries `assignee=<id>`.
- Inactive members are marked "(inactive)"; headers are real `th scope`; the table is a labelled scroll region.

### Issues and recommendations

**W1 (major, M): By member is a list of names, not a workload view.** For the busiest pod (23 members): (a) alphabetical, **16 of 23 rows are `0 / 0 / 0`**, so the 7 people who hold work are scattered; (b) a **230 px nested scroll box** shows 4 rows at 1366x768 and a second scroll area sits right under it, the grid; (c) **no availability**: Test User 05 is out of office until Oct 26 and looks like the most available person, although "who is free?" is the question the tab answers (the assignee picker already shows the chip); (d) the spec's "Unassigned 6" row is missing; (e) the **tab count counts tasks** ("By member (21)" for 23 members of whom 7 hold work); (f) at 1920 the rows stretch to 1650 px, so "Show tasks" sits 1000 px from the name; (g) no sort; (h) at 375 and 768 the table is cut (`Show tasks` clipped) and the page is 611 px wide at 375 (BUG-4).
Recommendation (mock `mocks/mock-by-member.png`): a **workload table** that grows with the page:
- Rows: first "Not assigned to a person" (the Unassigned count, link to that tab), then members with open work, then one folded row "Show 16 members with no open work" (idle members are who you assign to, so they stay one click away).
- Columns: Member (name, availability chip, "(inactive)" if so), **Open** (number plus a neutral bar scaled to the largest load: no red, no green, no rank numbers), Overdue, On hold, and one link per row: **View tasks** (the existing toggle).
- Default order alphabetical among members with work; column headers are sort buttons (the viewer decides; there is no default "most loaded first", which keeps UX principle 12 and the spec line "no ranking" intact. If the owner wants load-first by default, that is a one-line change and a product decision).
- Tab label counts **people with open work** ("By member (7)"). Needs `availability` (the same DTO the picker uses) and `unassigned` on `memberLoads`: one extra join.
- Below 640 px each member is a card: name and chip, then `5 open . 0 overdue . 1 on hold`, then View tasks. The grid below keeps its own place.
- The grid under the table stays as is (it is what "View tasks" filters) but starts below the table without a nested scroll box; "Skip to task list" on this tab lands on the first member row, not on the grid (BUG-5).

**W12 (nit, S): "Show tasks" repeated 23 times.** Each button has an accessible name ("Show tasks of Test User 41") so screen readers are fine; sighted keyboard users see 23 identical labels. In the new table "View tasks" stays always visible (a hover-only action would be invisible to touch and keyboard users); the member name is the same link ("name is the link" as in the grids), so the name alone is enough to open the member's tasks.

---

## 5. Assign flows and the shared toast

Screens: `assignee-menu-open-1366x768`, `assign-to-me-toast-1366x768`, `after-assign-row-left-1366x768`, `assignee-picker-availability-1366x768`, `assignee-picker-cross-pod-search-1366x768`.

### What works

- **Assign to me** is the first item of the Assignee menu and a link in the cell (one line, 216 px column). Result: "Assigned to you." with Undo, the status moves from New to In Progress, the row stays 4 seconds showing the new assignee and status, then leaves; the tab counts refresh.
- The menu lists the pod's members with **open counts and availability** ("Test User 05, Out of office until Oct 26, 0 open") and a type-ahead; Esc closes it and returns focus.
- People without `Task.Assign` see no link and no menu (read-only rendering).

### Issues and recommendations

**W8 (minor, S): the Undo toast is a different toast.** It is a white bordered box, bottom left, four lines of 330 px ("Assigned to you. Task moved to In Progress. Undo puts the assignee back; the status stays.") and covers the pager; every other toast in the app is a tinted PrimeNG toast, bottom right (see the Shell review, section on toasts). The rule it explains (Undo restores the assignee, not the status) is right but belongs in a tooltip on Undo.
Recommendation: "Assigned to you. Moved to In Progress. [Undo]" on two lines in the shared toast style and position, the long sentence as the tooltip.

**W13 (minor, S): the picker shows open counts only.** Counts of overdue and on hold, which the member table has, are not in the picker, and the picker lists this pod's members only (typing "Test User 3" returned 32 and 36, the only members of that pod in the range). UAT-S04-4 says cross-pod assignment is allowed and non-membership only informational. Please confirm whether the picker is meant to search all active users; I did not find another way to reach a non-member from this page. If yes, list "Other people" below the members, with the informational line "Not a member of this pod".

**W14 (nit, S): the Assignee column is the page's job but the first to leave at 768 px.** See W9.

---

## 6. Tablet, phone and wide

Screens: `pod-work-unassigned-768x1024`, `pod-work-members-2-768x1024`, `pod-work-unassigned-375x812`, `pod-work-queue-375x812`, `pod-work-members-2-375x812`, `pod-long-name-members-375x812`, `pod-work-unassigned-1920x1080`, `pod-work-members-1920x1080`.

**W9 (major, S): at 640 to 1099 px "Assign to me" is not on screen.** The rail takes 56 px, the grid box is 664 px at 768, the default columns (Ref, Title, Matter Number, Priority, Assignee, Due, Status) are wider than that, and the Assignee cell with its link is the fifth column: it shows "As" at the right edge (`pod-work-unassigned-768x1024`). The hint "Scroll sideways to see every column." is shown, so it is not broken, but on the Unassigned tab the one thing a person comes to do is off screen. Recommendation (page-specific, grid owner to implement): on Pod Work's Unassigned tab the default column order puts Assignee after Title below 900 px, and Matter Number leaves the defaults below 900 px (it is in the card and the subline). From 640 to 899 px the Assignee cell shows the link only ("Assign to me"), the menu stays on its chevron.

**W10 (minor, S): phone.** Cards work (`pod-work-queue-375x812`: title, client and matter, priority, due, status, Unassigned with Assign to me, ref); the header does not: the page title row, the pod select (overflowing the screen), the 2x2 strip and the tab row take 330 px before the first card, and the third tab is cut off. With W2 (capped select under the title), W11 (one chip row) the header is about 150 px. By member as cards: see W1.

**1920 px:** the grid scales, the header and picker align right (good), the member table stretches (W1 f). Nothing else specific.

---

## 7. Cross-cutting: Pod Work against the reworked pages

| Convention | Reworked pages (Dashboard, My Work, Task Queue, Records, Task page) | Pod Work |
|---|---|---|
| Header | Title, optional context line, actions right in the action-rule order | Title and a select in the actions slot; no context line |
| Strip | `mf-work-strip`: clickable items, My Work's vocabulary | Same component, **inert**, different numbers, repeats the tabs |
| Tabs | `mf-tabs` with counts that mean what the label says | Counts: tasks under a people label ("By member") |
| States | Shared `record-state` / `grid-body` for loading, error, empty | Grid states shared (good); page-level states are plain text blocks ("Choose a Pod...", "No members yet.") |
| Permissions | Hidden, never dead (no dead links or toasts) | A user without `Task.View` gets errors and toasts (BUG-2) |
| Keyboard and focus | Skip link to the list; Back returns focus to the row | Back returns focus (good); skip link lands below the member table on By member |
| Phone | Cards below 640 px | Cards (good); header and member table are not phone-ready |
| Tokens | `--mf-*` | `--mf-*` (good); the strip on phone uses boxes not used elsewhere |
| Axe | 0 | **2 moderate** on every grid page, including this one (shell BUG: the skip link targets `#mf-list`, which does not exist) |

---

## 8. Bugs found (with repro)

| ID | Severity | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | major | **At 768 px the title "Pod Work" wraps letter by letter and "Assign to me" is clipped.** The pod select takes its width from the longest option and squeezes the title to one character per line; the Unassigned grid shows "As" at its right edge. | Open `/pods/work` at 768x1024 as any user with a pod (`pod-work-unassigned-768x1024`). | The title never wraps; the picker truncates or wraps below; Assign to me visible (W2, W9). |
| BUG-2 | major | **`Pod.View` without `Task.View`: the page opens, shows "Couldn't load tasks." and three red toasts "You don't have permission to do that."** The nav item and the route need only `Pod.View`; UX spec S04 says `Task.View` and `Pod.View`; permission-aware hiding (no dead links, no toasts) is violated. | Sign in as a user whose role has Pod.View, Dashboard.View but not Task.View, click Pod Work (`pod-work-as-podnotask-1366x768`). | The item is hidden and `/pods/work` answers the 403 page (or the Matters-tab pattern: a sentence "You don't have permission to view tasks." and no request). |
| BUG-3 | minor | **The summary strip keeps the old numbers after Assign to me.** The tab counts update (Unassigned 4 to 3, By member 20 to 21), the strip stays at `Unassigned 4 / Assigned 20` until a reload; UAT-S04-9 says the counts refresh. | Pod Work as a technician, Assign to me on the first row, wait 6 s (measured: strip `4 / 20`, tabs `3 / 21`; after reload `3 / 21`). | `mergeCounts` also updates the strip (it copies `summary`; check that the strip reads the merged value). |
| BUG-4 | minor | **At 375 px the page is 611 px wide.** The pod select runs past the right edge on every tab and the By member table is cut ("Show" instead of "Show tasks"). | Pod Work at 375x812, By member (`pod-work-members-2-375x812`); `document.documentElement.scrollWidth` is 611. | No horizontal page scroll (the grid scrolls inside its own box). |
| BUG-5 | minor | **Skip link on By member lands under the member table**, on the first grid row, so a keyboard user skips the tab's main content (23 member rows). | `/pods/work?view=members`, Tab, Enter on "Skip to task list". | Focus the first member row on this tab. |
| BUG-6 | nit | **Empty pod shows two messages** ("No members yet." and "Nobody in Demo Empty Pod has open work.") (W7). | Pod Work for a pod with no members, By member. | One state with an action. |
| BUG-7 | nit | **"Overdue 4 + On Hold 6" against "Overdue and on hold (9)"** reads as an arithmetic error (W5). | Any busy pod. | Resolved by W5, or a tooltip "tasks that are both are counted once". |

Shared-shell bug that shows here: the "Skip to task list" link points to `#mf-list` and nothing has that id, which axe reports as `skip-link` and `region` (moderate) on this page as on Task Queue, My Work, Clients, Matters and Projects (see the Shell review, BUG-1). Checked and **no bug**: tab counts equal the grid totals; "Show tasks" filters correctly; read-only users get no menus; drill-in and Back keep filters, scroll and focus; the remembered pod is applied once when the URL names none; axe is otherwise clean on the Unassigned, By member and empty states.

---

## 9. Proposed work packages and order

Estimates are AI-agent hours including unit tests, an e2e update and screenshots.

| WP | Content | Findings | Effort | Depends on |
|---|---|---|---|---|
| WP-W1 | **Bugs**: title never wraps and the select is capped; permission guard and nav item need `Task.View` too; strip follows assignments; no horizontal overflow at 375; one empty-pod message; skip target on By member | BUG-1..BUG-7 | 6 h | none; do first |
| WP-W2 | **Pod scope in the header**: context line, pod in the document title, pod list for "no pod chosen", honest no-pods hint | W2, W3, W6, W7 | 6 h | WP-W1 |
| WP-W3 | **Strip**: same four items as My Work, clickable, API fields `dueToday` and `asap`, no duplicates of the tabs; one chip row on a phone | W5, W11 | 5 h | WP-W1; shares the component with the My Work strip |
| WP-W4 | **By member workload table**: API `availability` and `unassigned` on member loads, folded idle members, bar, sort, people count in the tab, cards below 640 px | W1, W12 | 10 h | WP-W2 |
| WP-W5 | **Tablet and phone columns**: Assign to me visible at 640 to 899 px, Matter Number out of the defaults below 900 px, assign link only at that width | W9, W10, W14 | 5 h | grid owner; WP-W1 |
| WP-W6 | **Assign flow polish**: shorter Undo toast in the shared style (with the Shell WP for toasts), overdue and on-hold counts and "Other people" in the picker (if confirmed) | W8, W13 | 4 h | Shell WP "toasts"; product answer on cross-pod |
| WP-W7 | **Verification**: Playwright screenshots and axe at 375, 768, 1366 and 1920 for the four tabs and the states; update UX spec S04 and UAT-S04-6/-9 | all | 3 h | all |

**Total: 39 agent-hours.** Suggested order: WP-W1 first (it removes two major bugs and the 768 breakage); then WP-W2 and WP-W3 in parallel; WP-W4 next (largest value for Pod Leads); WP-W5 and WP-W6 last; WP-W7 closes. If only two things are done: WP-W1 and WP-W4 (16 h).

**Product decisions needed:** (1) the strip vocabulary (W5: my recommendation is Overdue, Due today, ASAP, On hold on both pages); (2) the By member default order (alphabetical, my recommendation, against load-first; principle 12); (3) whether the tab counts people (W1 e); (4) whether the picker may assign across pods (W13, UAT-S04-4); (5) the default pod for people with no membership (W3: none, a list; or the pod with most unassigned work).

---

## 10. Already decided or shipped (not re-recommended)

- The grid contract (44 px rows, name is the link, filter row open by default from 640 px, cards below 640 px), column prefs per tab, Columns and density, inline Priority and Status menus, Closed-column rules.
- "Assign to me" in the cell and as the first menu item; no Actions column (decision U, #194, #199); read-only rendering for people without `Task.Assign`.
- Workload facts, not a ranking; no people-scoring (UX principle 12).
- Pod Work lists open tasks only; the pod is a scope, not a filter; the last pod is remembered; the URL carries `podId` and `view`.
- Phone cards owner (#192, #238); drill-in focus and the `from=pod-work` origin (decision V/W).

## 11. Phase 2 backlog (owner decision: no keyboard-shortcut recommendations now)

Not recommended and not in any work package: a shortcut to switch pod; shortcuts for Assign to me or View tasks on a member row.

## 12. What I did NOT verify

- A real screen reader; browsers other than Chromium; touch on a real phone; 200 and 400 percent zoom; Windows high-contrast mode.
- The no-pod hint ("You aren't in a pod yet") on screen: it needs a system with no pods; the claim in W3 is from the code.
- Cross-pod assignment through any other path than the Pod Work picker and the Task Queue picker (W13).
- Pods of more than 23 members (the member table at 100 rows), and 5 000 tasks in one pod.
- Concurrency: two Pod Leads assigning the same row (the existing conflict handling).
