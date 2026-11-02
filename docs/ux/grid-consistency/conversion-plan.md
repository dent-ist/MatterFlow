# Conversion plan: one list anatomy

Estimates are agent-hours (one agent, including unit specs, targeted e2e and a browser check, no GitHub issues created). They assume the recommendations of `review.md` section 5 are accepted. Risk: L low, M medium, H high (regression in a heavily tested screen).

## 1. Dependency order

1. **Shared pieces first** (everything else depends on them).
2. **Work lists** (Task Queue, My Work, Pod Work, Matter Tasks, My Matters tasks, Dashboard lists): most used, most differences.
3. **Record lists** (Matters, Clients, Projects, Assets, Matter tabs, My Matters assets, Search).
4. **Admin lists and lookups.**
5. **Logs and feeds** (Audit, Activities, Notifications).

## 2. Work needed per piece

### Step 1: shared pieces

| Piece | Work | Hours | Risk |
|---|---|---|---|
| `mf-list-toolbar` (row 2 slots in fixed order: search, filters, view, sort status, columns, more; row 3 chips + sorted-by + reset) and `mf-list-title` (icon, H1, count chip, primary slot) in `shared/ui` | one component pair used inside `mf-grid-frame` / `mf-page-header`, phone layout, specs | 6 | M |
| Search box slot: `mf-search-box` as the list search, moves the Name/Title text filter out of `mfColumnFilterRow` | 2 | L |
| One chips component: merge the two `mf-filter-chips` names (rename the count chips `mf-count-chips`), My Matters `achip` replaced by the shared removable chips | 3 | M |
| One Columns menu: extend `mf-grid-columns` with density, group headings, widths panel; drive the work lists from `grid-prefs` (migrate `mf.work-columns.v2` on first read); retire `column-chooser.ts` | 10 (guide estimate) | H |
| One resize store (task-table `column-resize.ts` into `resizable-columns.ts`) | included above | |
| Task column registry: one `TASK_COLUMNS` with the standard order and names used by every task grid (Queue, Matter Tasks, My Matters, Dashboard, Search, panels); asset, matter, client registries the same way | 5 | M |
| Standard create button helper (label rule "New <Noun>", Title Case) and page-size default 50 in `list-query.ts` | 1 | L |
| **Subtotal** | | **27** | |

### Step 2: work lists

| Page | Work | Hours | Risk |
|---|---|---|---|
| Task Queue | adopt toolbar (Search out of filter row, Filters before Columns, Views/Export into the "..." menu), title count, "+ New Task" | 3 | M |
| My Work | same, tabs unchanged, column default (Progress rename) | 2 | M |
| Pod Work | same | 1.5 | L |
| Matter Tasks tab | toolbar order (Search, Filters, View, Columns, Select into bulk), phone cards instead of sideways scroll, status default order | 4 | M |
| My Matters tasks | replace the local Filter/Urgency/Show with toolbar; dropdown row becomes the inline filter row; use the task column registry (Ref, Title, Priority, Assignee, Due, Status); date format | 6 | H |
| Dashboard summary lists | standard column order, optional header, "View all" kept | 2 | L |
| Project tasks panel, Pod members | standard mini table with the task columns | 2 | L |
| **Subtotal** | | **20.5** | |

### Step 3: record lists

| Page | Work | Hours | Risk |
|---|---|---|---|
| Matters | toolbar order (Filters out of the header into row 2), title count; the kit is already there | 2 | L |
| Clients | toolbar, Columns, resize, reorder, sort status line (guide estimate 2.5) | 3 | L |
| Projects | same | 3 | L |
| Assets | same, plus column order and names | 3.5 | L |
| Matter Assets tab | column order (Name, Type), toolbar, Columns | 2.5 | L |
| Matter Projects tab | toolbar, sort, standard columns, create button visible | 2 | L |
| Productions and Specs | Filters button with Direction/Status inside, search stays, pager | 2.5 | M |
| Notes list | align Search/Sort/Tags slots with the toolbar (cards, so mostly labels) | 1.5 | L |
| My Matters Assets | toolbar, Search/Filters, columns (Name, Type, Matter Number, Created, Updated, Disposition) | 3 | M |
| Search results | search per tab, columns from the registries, titles | 2 | L |
| Asset reports result and saved list | create button, toolbar | 1.5 | L |
| **Subtotal** | | **26.5** | |

### Step 4: admin

| Page | Work | Hours | Risk |
|---|---|---|---|
| Users | move/add primary action, toolbar, fix Pods/Availability overlap, Columns | 3 | L |
| Roles, Pods | New button into the header, toolbar | 2.5 | L |
| Task Types, Workflows, Steps, Asset Types, Reports | toolbar (search out of filter row), title count | 5 (1 each) | L |
| Lookups (Priorities, Status labels, On-hold, Notes tags, Link roles, Custom fields) | New button into the header on every tab, nothing else | 2 | L |
| **Subtotal** | | **12.5** | |

### Step 5: logs and feeds

| Page | Work | Hours | Risk |
|---|---|---|---|
| Audit Logs | pager instead of Load more (server paging by cursor may need an API change: +2), toolbar | 4 | M |
| Matter Activities, My Matters Activity | pager, date format, toolbar | 3 | L |
| Notifications | First/Last, toolbar | 1 | L |
| **Subtotal** | | **8** | |

### Totals

Step 1: 27, Step 2: 20.5, Step 3: 26.5, Step 4: 12.5, Step 5: 8 = **94.5**. Cross-cutting: update the theme guide section 11 and add a "list anatomy" spec that checks every list page for the zones (3), e2e updates for moved buttons (about 8). **Whole programme about 105 agent-hours**, of which the screens are 67.5 and the shared pieces and checks 37.5 (the epic list below adds up to 104.5 because the create-button helper, 1 hour, sits in Step 1).

## 3. Suggested epics and issues (not created)

**Epic: One list anatomy (consistency).**

1. LA-01 Shared list toolbar and title (6) 
2. LA-02 List search slot, move Name/Title text filter (2)
3. LA-03 One chips component (3)
4. LA-04 One Columns menu and resize store, migrate work-list prefs (10)
5. LA-05 Column registries for tasks, assets, matters, clients (5)
6. LA-06 Work lists adopt the toolbar: Task Queue, My Work, Pod Work, Dashboard lists, panels (10.5)
7. LA-07 Matter Tasks tab: toolbar and phone cards (4)
8. LA-08 My Matters lists adopt the toolbar and registries (9)
9. LA-09 Record lists: Matters, Clients, Projects, Assets (11.5)
10. LA-10 Matter tabs (Assets, Projects, Productions, Notes) (8.5)
11. LA-11 Search and reports lists (3.5)
12. LA-12 Admin lists and lookups (12.5)
13. LA-13 Logs and feeds paging (8)
14. LA-14 Guide update, anatomy spec, e2e (11)

## 4. Phase 1: cheap, biggest gain (about 20 agent-hours)

Goal: a user finds Search, Filters, Columns and New in the same place on the pages they use most, and tasks look the same everywhere, without rebuilding the Columns menu or the My Matters grid.

| # | Change | Hours |
|---|---|---|
| 1 | Shared `mf-list-toolbar` and `mf-list-title` (zones in fixed order, phone layout), without migrating prefs | 6 |
| 2 | Adopt it on Task Queue, My Work, Pod Work, Matter Tasks, Clients, Matters, Projects, Assets (Filters directly after Search, Columns at the right end, title count, create button Title Case and in the title row, one "Filters" name) | 7 |
| 3 | Standard task column order and names (`TASK_COLUMNS`): Task Queue/Pod/My Work/Matter Tasks defaults, "Progress" rename, Status last; Matter Assets and Assets order/names ("Name, Type", "Disposition") | 3 |
| 4 | Matter Tasks tab on a phone: cards | 2 |
| 5 | Page size 50 default everywhere, "Sorted by ..." line and Reset sort on every sortable list, Notifications First/Last | 1.5 |
| 6 | Rename "Filter" to "Filters", add "+ New Task", admin New buttons into the header (Roles, Pods, lookups) | 1 |
| | **Total** | **20.5** |

What phase 1 deliberately leaves: the two Columns menus (kept side by side, the button is in the same place and has the same name), My Matters' own filter dropdown row and Urgency toggle (renamed Filters but not rebuilt), Audit/Activities "Load more", date format, admin lookups beyond the button. Those are phase 2 (about 85 more hours).

Risk control: change only layout and labels on existing, tested components; e2e specs that click the old button positions are updated in the same change (they are listed by `grep -rn "Other filters\|Filters" frontend/e2e`).
