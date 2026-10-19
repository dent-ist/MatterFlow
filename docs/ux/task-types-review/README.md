# Task Types, Workflows and Workflow Steps: independent UX review

Scope: the **Administration > Task Types** menu item and everything reached from it: the Task Types page with its three tabs (Task Types, Workflows, Workflow Steps), the Task Type create/edit page, the request-form designer (for a task type and for a step), the Workflow create/edit page with its version history, the Workflow version page (draft editor and read-only view of published and retired versions), and the Step create/edit page. Reviewed as a System Administrator would see them, with real navigation, on `origin/dev` at `ec67fcf`, the production Angular build, the published API with Dev auth, SQL Server, Playwright Chromium. Labels and Custom Fields are not reached from Task Types and are not reviewed. **The Task page and the work lists (#347, #348) are not reviewed. No application code was changed and no issues were created.**

Evidence: `screenshots/` (114 PNGs, `<name>-<width>x<height>.png`, 1366x768 unless the name says otherwise; 1920x1080, 768x1024 and 375x812 where it matters; `...-full-` files are full-page captures), `mocks/` (two before/after HTML mocks with PNGs). Every measurement quoted below (row heights, scroll widths, positions, Tab stops, axe results) was taken in the browser on the seeded data; the seed script is described in section 8.

How to read the severity words: **major** = an administrator loses time or cannot do the task at some width; **minor** = friction or inconsistency; **nit** = polish. Effort is in AI-agent hours (implementation, unit tests and the e2e update, not review time).

---

## 0. Page inventory

| # | Route | Purpose | Permission |
|---|---|---|---|
| 1 | `/admin/task-types` | Task Types tab: list of types with request-form status, eligible workflows, status | `TaskType.Manage` |
| 2 | `/admin/workflows` | Workflows tab: list with latest published version, draft, task types, status | `Workflow.Manage` |
| 3 | `/admin/steps` | Workflow Steps tab: reusable step library with tags and "Used in" | `Workflow.Manage` |
| 4 | `/admin/task-types/new` | Create a task type (name, icon, description, active, eligible workflows, default) | `TaskType.Manage` |
| 5 | `/admin/task-types/:id` | Edit a task type; link to its form; usability reasons | `TaskType.Manage` |
| 6 | `/admin/task-types/:id/form` | Request-form designer: palette, fields, properties, validation, preview, versions, publish/retire | `TaskType.Manage` |
| 7 | `/admin/workflows/new` | Create a workflow (name, description, execution mode) | `Workflow.Manage` |
| 8 | `/admin/workflows/:id` | Edit a workflow; version history; open draft; new draft from a published version | `Workflow.Manage` |
| 9 | `/admin/workflows/:id/versions/:versionId` | Version page: draft editor (library, steps, skip rules, publish, discard) or read-only view (retire, new draft) | `Workflow.Manage` |
| 10 | `/admin/steps/new` | Create a step | `Workflow.Manage` |
| 11 | `/admin/steps/:id` | Edit a step; tags; usage; deactivate | `Workflow.Manage` |
| 12 | `/admin/steps/:id/form` | Step inputs in the same form designer | `Workflow.Manage` |

Also reached from these pages and reviewed with them: three filtered views of the lists (`/admin/task-types?workflow=`, `/admin/workflows?taskType=`, `/admin/workflows?step=`, the "Filtered by" chip), the shared dialogs (deactivate, publish, retire, discard, leave without saving, change mode), the 403 page and the redirect rules between tabs. **12 pages, 3 filtered views, 8 dialogs.** The three tabs are one component (`TaskTypesAdminPage`, route matcher `task-types|workflows|steps`); a person with only `Workflow.Manage` lands on Workflows and sees two tabs, a person with only `TaskType.Manage` sees one tab (`screenshots/20-` to `24-perm-`).

Not in the app, although `docs/ux/ux-spec.md` S14 to S16 describe them: the Task Type editor **tabs** (General, Form, Workflows, Versions), the **Open tasks** column of the list, the workflow **Validate** button, the per-step **settings drawer**, the "Eligible Task Types" list and "Used by N open tasks" on the workflow page, the **version list with task counts**, and drag handles. Where this review recommends one of them it says so.

---

## 1. Summary

The administration pages are **functionally complete and accessible** (0 axe violations on the three lists, the edit pages and the designer at 1920, 1366, 768 and 375, with the exceptions in the bug list; Alt+Arrow reordering with a spoken position; dirty-state guards; conflict banners; a publish diff). What is missing is the **look and the structure the rest of the product now has**. They were built before the record-page and grid conventions of decisions T to W and have not been touched by them:

- **Not record pages.** A Task Type, a Workflow and a Step open as a breadcrumb, an H1 and a form. There is no `mf-record-header`, no status badge next to the name, no overflow, no tabs, no counts, no summary strip. The facts an administrator needs (is this type usable, which workflows, how many open tasks, which task types use this workflow, which workflows use this step) are either spread over the page or **not shown even though the API returns them** (`GET /workflows/{id}` already returns `taskTypes`; the page never shows them).
- **The lists are not on the grid contract.** Row heights of 47 to 725 px (the work grids and the record lists are exactly 44), a closed filter row (decision V: open by default from 640 px), two table stylesheets (`.grid` in Task Types, `.pg-table` in the other two), raw text links as row actions, no phone cards, and at 768 the **Actions column is off screen** with no cue.
- **The version page and the form designer are page-scrolling stacks.** The Publish button leaves the screen after 300 px; 13 steps are 1,776 px tall; below 1100 px the 50-item step library comes first and the steps you are editing start at y = 1,100. The fixed-height tab pattern used on the Dashboard fits both pages.
- **States and wording are five different things.** A 404 reads "We couldn't load that workflow version." with Retry and a toast "We couldn't find that."; the same for step, workflow and task type, with five different wordings and, on the version page, no header at all.
- **Dialogs lack impact.** Retire, deactivate and publish never say which task types stop being usable or how many open tasks are affected, although the page has the data.

**Counts: 59 numbered findings (3 more are marked "verified good"), 10 cross-cutting points, 9 bugs (BUG-1 to BUG-9), 11 work packages, 141 agent-hours.**

### Top 10 findings, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | **Version editor on the fixed-height pattern**: sticky action bar (Publish, Save draft, overflow), steps first, library as a drawer below 1280 px and a second pane above, 44 px step rows with one rule badge and an overflow, Alt+Arrow and buttons kept. Fixes the lost Publish button, the 1,776 px list and the 1,100 px scroll to the steps. | `50-ver-draft-editor-1366x768`, `50b-...-full`, `50-...-375x812`, `mocks/mock-workflow-version.png` | L, 22 h | VP1 to VP5 |
| 2 | **Task Type, Workflow and Step become record pages**: `mf-record-header` (name, status badge, Edit/Activity rule, one primary action, overflow with Deactivate), tabs with counts, summary strip, "Used by" lists that link. | `30-tt-edit-general-1366x768`, `40-wf-edit-with-draft-1366x768`, `70-step-edit-1366x768` | L, 38 h for the three | TE1, WE1, WE2, SE1 to SE4 |
| 3 | **The three lists on the grid contract**: exactly 44 px rows, name is the link, number columns plain, one row overflow instead of two text links, clamps with tooltips, Actions never off screen, phone cards below 640 px. | `01-task-types-1366x768` (rows 67 to 97), `02-workflows-768x1024` (a 725 px row), `01-task-types-768x1024` (Actions off screen) | L, 22 h incl. API | TT1 to TT3, WL1 to WL3, SL1 to SL3, BUG-2 |
| 4 | **Tabs with counts, a health strip and the filter row open by default.** "Task Types (69) / Workflows (31) / Workflow Steps (67)", a strip that filters (Not usable, Form in draft, Inactive; Draft in progress; Not used). | `01-task-types-1366x768`, `mocks/mock-task-types-list.png` | M, 10 h | P2 to P4, TT4, TT5 |
| 5 | **Honest states**: 404 / 403 / failure with the shared record state (extend `RecordKind`), header skeleton, error reference, no duplicate toast. | `38-tt-edit-404`, `45-wf-edit-404`, `62-ver-404`, `76-step-404`, `10-task-types-error` | M, 8 h | BUG-1, BUG-6, TT8 |
| 6 | **Eligible-workflows picker** instead of 31 flat checkboxes: selected rows with a Default radio, a searchable "Add workflow" list of published workflows only, and the "not usable" reason at the top of the page. | `30b-tt-edit-general-full-1366x768` (1,000 px of checkboxes) | M, 8 h | TE2, TE3 |
| 7 | **Dialogs that state impact**: deactivate and retire name the task types and open tasks that are affected; the publish diff folds "Moved" into one line and adds the impact line. | `56-ver-publish-dialog`, `59-ver-retire-dialog`, `08-task-types-deactivate-dialog` | M, 8 h (API counts 3 h) | VP6, VP7, TT7, SE4 |
| 8 | **Form designer as three fixed panes** (palette, canvas, properties) with Preview and Validation as tabs, sticky Save draft and Publish, phone order canvas first. | `85b-designer-field-selected-full-1366x768`, `82b-tt-form-draft-full-375x812` | L, 16 h (shared with Asset Types and Custom Fields) | FD1 to FD5 |
| 9 | **One form stack for the three edit pages**: one input width and card, one validation rule (summary plus inline with the icon, focus to the first error), one button system, counters on limited fields, no hidden "uncheck Active and Save" deactivation. | `34-tt-new-validation` vs `74-step-new-validation` | M, 8 h | TE5 to TE7, SE4, section 3 item 3 |
| 10 | **Keyboard, focus and a11y**: focus returns to the row on Back (today it lands on `<body>`), the breadcrumb keeps the list state, 150 Tab stops per list page cut to about 55, the publish-dialog scroll region made focusable, crumb target size at 375. | Section 2.2 TT9 and BUG-3 | S-M, 6 h | BUG-3, BUG-4, BUG-5, TT9 |

---

## 2. Findings by page

### 2.1 The Task Types page shell (title, description, tabs, toolbar; shared by tabs 1 to 3)

Screens: `00-admin-landing`, `01-task-types`, `02-workflows`, `03-steps` at four widths, `04-task-types-filters-open`, `20-` to `24-perm-*`.

**What works.** One menu item and one page for the model Task Type, eligible Workflows, Steps; route-based tabs with the arrow-key tab pattern (verified: Right moves to Workflows and the URL follows); the tab strip scrolls on a phone with a chevron cue; only permitted tabs are offered and a link to a forbidden tab lands on the first allowed one; document titles name the tab ("Task Types - Workflows"); the primary action changes per tab ("New task type", "New workflow", "New step"); filters live in the address.

**P1 (minor, S, 1 h): the H1 and the description.** The H1 is "Task Types" on all three tabs and the page icon is the same; fine as a page name (it is the menu item), but the description is a 130-character sentence that is cut to "...Types are de..." at 1366 (`01-task-types-1366x768`), wraps to three lines at 375, and is the only explanation on the page. Recommendation: keep the H1 and the single page, shorten each tab's sentence to at most 90 characters so it fits one line at 1366 ("What people can request: a request form and its eligible workflows."), and keep the tooltip.

**P2 (major, M, 4 h): tabs have no counts.** The three tabs read "Task Types / Workflows / Workflow Steps" while the Matter page shows "Tasks (n) / Projects (n)". The administrator cannot tell how big each set is or whether any step is unused. Recommendation: `mf-tabs` already accepts `count`; show the Active count of each ("Task Types (61)", "Workflows (30)", "Workflow Steps (66)", zero muted, `--` while loading) from the same list endpoints with `size=1` (the Task Types list loads whole, so its count is free), loaded lazily once the page opens and refreshed after a create or deactivate. Decision to take: counts show the **default filter (Active)**, as the lists do.

**P3 (minor, S, 1 h): the filter row is closed by default** behind a right-aligned "Filters" button on its own 52 px row (`01-task-types-1366x768`) at every width. Decision V: the filter row is open by default from 640 px, remembered per list and user, and the Filters button lives in the page header row. Recommendation: apply the same rule to the three tabs (the `mf-filters-bar` is already shared), keep it closed below 640 px, and put the button in the header actions on a phone. Gives back 52 px at 1366x768.

**P4 (minor, M, 6 h): no summary strip.** The health of the configuration is the administrator's first question: how many types cannot be used for new tasks, how many forms are still drafts, which workflows have an unpublished draft, which steps are unused. Today this is only visible by scanning red chips in 25 rows. Recommendation: a strip above the grid with the strip look of My Work (counts as toggle chips that apply the filter and are announced): Task Types: **Active, Not usable, Form in draft, Inactive**; Workflows: **Published, Draft in progress, Not published, Inactive**; Steps: **Active, Not used, Inputs in draft, Inactive**. The Task Types strip is computed client-side (the list loads whole and `usabilityIssues` and `formStatus` are on each row); Workflows and Steps need additive counts in the list responses (3 h of the 6).

**P5 (nit, S, 1 h): two button systems in the header.** "New task type" is an `<a class="mf-btn mf-btn--primary">`, "New workflow" and "New step" are PrimeNG `p-button`; the widths and the corner radius differ by a pixel or two when you change tab. Use one component (see section 3 item 3).

**P6 (verified good): permissions.** Workflow-only: two tabs, landing on Workflows, the task-type chips in the Workflows tab are plain text (no dead links); Task Type-only: one tab; neither: the shared 403 page ("You don't have permission to view this." with a link to the Task Queue). One inconsistency: a Task Type-only administrator who types `/admin/workflows` is **silently redirected** to Task Types, while a Workflow-only administrator who types `/admin/task-types/new` gets the 403 page (BUG-8).

### 2.2 Task Types tab (`/admin/task-types`)

Screens: `01-task-types` (4 widths), `04-task-types-filters-open`, `04b-`, `05-task-types-no-match`, `06-task-types-all-100-sorted`, `07-task-types-long-name-row`, `08-task-types-deactivate-dialog`, `09-task-types-loading`, `10-task-types-error`, `11-task-types-empty`, `19-task-types-filters-open-375x812`.

**What works.** The workflow chips are links, the default workflow has a star and the word "default", three chips and then "+n more", a "Workflows (n)" link into the filtered Workflows tab, "No workflow" as a warning; inline column filters (name, request form status, status; Active by default) with chips in the address; a deactivate confirm that says what happens to existing tasks; 69 types and 74 with inactive load in one request and the page stays responsive at `size=100`; icons show in the Name column; 0 axe violations at four widths.

**TT1 (major, M, 6 h): row heights 67 to 151 px, not 44.** Measured at 1366: 67, 67, 78, 67, 67, 97 px; at 768: 97, 67, 151, 127. Each row stacks the name, a red warning box, up to three workflow chips and a "Workflows (n)" link. The record lists (decision V) and the work grids use exactly 44 px. Recommendation: replace the chips column by **Default workflow** (one name, "+2" when there are more, tooltip with the list) and a number column **Workflows**; the full chip list moves to the Task Type page. Rows become 44 px and 25 rows fit in one screen at 1920.

**TT2 (major, L, 8 h incl. cards): the Actions column leaves the screen and there is no phone layout.** At 768 the table is 853 px wide in a 664 px box: Request form and Workflows are visible, Status is at the edge and **Edit form / Deactivate are off screen** (`01-task-types-768x1024`); at 375 only Name and Request form are visible and "Deactivate" is unreachable from the list (`01-task-types-375x812`; the Workflows column starts at x = 300). The shared record lists use `mf-record-card-list` below 640 px. Recommendation: cards below 640 px (line 1 icon and name, line 2 `Published v1 - Quick Request +1`, badge top right, overflow button), the table from 640 px with Name, Default workflow, Request form, Workflows, Open tasks, Status and the overflow, and at 768 the optional columns drop out in a fixed order (the decision U "narrow windows" rule) so the overflow never leaves the screen.

**TT3 (minor, M, 6 h incl. API): the list does not say what a type is doing.** Columns: Name, Request form, Workflows, Status. Spec S14 lists **Open tasks**; the API does not return it. Without it the administrator cannot judge the effect of a deactivation, and cannot tell a type nobody uses from the main one. Recommendation: additive `openTaskCount` (and `lastUsedAt` if cheap) on the list and Get responses, sortable, the number a link to the Task Queue filtered to the type (the Task Queue has a Task type column filter; the address parameter name is to be confirmed in the work package).

**TT4 (minor, S, 2 h): the "not usable" state is a red outlined box.** "No eligible published workflow: users can't create tasks of this type." in danger red doubles the row height, and red means overdue everywhere else (decision T colour language). The same fact is also shown as "No workflow" in the next column. Recommendation: a neutral **Not usable** badge in the Status column with the reason as tooltip and `aria-describedby` (not colour-only), plus the strip filter (P4); the reason text moves to the top of the Task Type page (TE3).

**TT5 (minor, S, 2 h): the default status filter hides rows without saying so.** Active is the default; 8 inactive types are invisible and the pager says "Showing 1-25 of 69" (the clients review L5). Recommendation: a muted pager line "61 active, 8 inactive hidden" with a link, or the Inactive chip in the strip. Status is not sortable; make it so.

**TT6 (minor, S, 1 h): two ways in.** The name opens the edit page; "Edit form" (a second text link per row) opens the designer. Recommendation: the name is the only link (decision V rule); "Edit form" and "Deactivate/Activate" go into the row overflow menu (`mf-action-menu`), which also cuts the Tab stops (TT9).

**TT7 (minor, S, 2 h): the deactivate confirm does not say how many tasks.** "Access Request will no longer be offered when people create tasks. Existing tasks keep this type..." (`08-`). With TT3's count: "14 open tasks keep this type. New tasks cannot be created with it." Also name the workflows that lose their last task type. Dialog stays a `mf-confirm-dialog` with the danger primary.

**TT8 (minor, S, 2 h): load states.** The skeleton rows (`09-`) are laid out with different column positions than the loaded table (Name header at x = 256, "Request form" at 460 in the skeleton and 545 loaded), so the grid jumps on load; the error state (`10-`) shows "Couldn't load task types." and Retry but **no error reference** (the Task Queue and the record pages show one) plus a toast "Something went wrong. Try again." that repeats it (BUG-6); the empty state offers a second "New task type" button directly under the header's "New task type" (`11-`). Use the shared `grid-body` contract: skeleton with the real column widths, the reference, one message, and hide the empty-state button when the header already has the action.

**TT9 (minor, M, 3 h): Tab stops.** From the page top to the first row: 22 stops (the shell, tabs, Filters, the scroll region, three sort buttons). Then **6 to 7 stops per row** (name, up to three workflow chips, "Workflows (n)", Edit form, Deactivate): a 25-row page is about 150 stops. With TT1 and TT6 a row has two (name, overflow) and the filtered Workflows link is in the Default workflow cell: about 55 per page. The Task Queue lesson (#236) applies: record the number, do not gate on it.

**TT10 (verified good).** Axe clean; sort buttons are real buttons with `aria-sort`; the filter chip for `?workflow=` is removable; icons are decorative (`aria-hidden`) and the name carries the meaning; the deactivate confirm returns focus.

### 2.3 Workflows tab (`/admin/workflows`)

Screens: `02-workflows` (4 widths), `12-workflows-filters-open`, `13-workflows-all-status`, `14-workflows-filtered-by-task-type`.

**What works.** Server-paged, filters in the address, the "Filtered by task type / step" chip with a count, Published and Draft shown with badges that carry an icon and a word, a long name wraps instead of overflowing, workflows with a published version **and** a draft are visible at a glance (`Large Production Workflow`: Published v2 (15 steps), Draft v3), 0 axe violations.

**WL1 (major, S, 3 h): rows are unbounded.** Row heights 47 to 167 px at 1366; at 768 the 150-character name plus a 240-character description make **one row 725 px tall** (`02-workflows-768x1024`). The long name is the link and wraps to 4 lines, the description is not clamped. Recommendation: the grid contract: name two lines clamped with the full text as tooltip, description one muted line (clamped), exactly 44 px.

**WL2 (minor, M, 4 h): three cells for one idea.** "Latest published", "Draft" and "Status" are three columns with a badge and "v2 (15 steps)" stacked under it; the Draft cell shows a badge above "v1". Recommendation: **Versions** cell on one line `v2 published - v3 draft` with the two badges as small icons+words, **Steps** (number, plain), **Task types** (number, link to the filtered Task Types tab) and Status. Add a **Last published** date (a sortable column; additive `publishedAtUtc` on the summary).

**WL3 (minor, S, 2 h): the task-type chips** repeat the unbounded growth of TT1 (one chip per line up to three, 91 px rows). Replace with the count (WL2) and show the chips on the Workflow page (WE2).

**WL4 (minor, S, 2 h): a workflow with a draft hides its draft.** The draft v3 is only reachable by opening the workflow and pressing "Open draft v3". Make the Draft badge a link to the draft (the version page), the one thing an administrator does next.

**WL5 (minor, S, 1 h): a workflow that is "Not published"** (draft only, `Brand new workflow (draft only)`, or all versions retired) says "Not published" in grey with no consequence. A task type whose only workflow it is becomes not usable (TT4). Count it in the strip (P4) and give it the neutral Not published badge.

**WL6 (minor, M, 4 h): phone and tablet.** Same as TT2: at 375 only the Name column (115 px) is visible, Status is off screen. Cards below 640 px; at 768 drop Last published and Task types.

### 2.4 Workflow Steps tab (`/admin/steps`)

Screens: `03-steps` (4 widths), `15-steps-filters-open`, `16-steps-all-status`, `17-steps-long-title-row`, `18-steps-filters-open-375x812`.

**What works.** Tags as chips with "+n", a tag filter with match-all/any, "Used in n workflows" as a link into the filtered Workflows tab, "Not used" muted, inactive steps filterable, rows are close to 44 px, 0 axe violations.

**SL1 (major, S, 2 h): the Title is not the spring.** At 1366 Title is 207 px (names such as "Analytics setup - custodian data 16" wrap to two lines) while **Description is 400 px and empty for 60 of 67 steps** (`03-steps-1366x768`). The grid contract of decision U: one spring column, defaults and minimums per column. Recommendation: Title takes the spare width (minimum 240 px), Description is optional (hidden below 1200 px, one clamped line with tooltip), Tags 2 chips and "+n".

**SL2 (minor, S, 1 h): long titles and descriptions are not clamped** (`17-steps-long-title-row`: a 170-character title takes 4 lines). Same clamp as WL1.

**SL3 (minor, S, 1 h): "Used in 5 workflows" wraps** in 129 px at 1366 and in 96 px at 768. Show the number as the link ("5") with a header "Used in", `white-space: nowrap`.

**SL4 (minor, M, 4 h): a step's readiness is not visible.** A step whose inputs are in draft cannot be published in a workflow (`step-edit-page.ts`: "Publish them before this step can be published in a workflow"), but the list does not show inputs at all. Add an **Inputs** column (`none`, `n fields`, `draft`) and the strip filter "Inputs in draft" (P4). API: `publishedFormVersionId` and `draftFormFieldCount` are already on the detail; add them to the list response.

**SL5 (minor, S, 2 h): no row actions.** Deactivate is only on the edit page; consistent with the other tabs after TT6 (row overflow: Edit inputs, Deactivate/Activate).

### 2.5 Task Type page (`/admin/task-types/new`, `/admin/task-types/:id`)

Screens: `30-tt-edit-general` (4 widths), `30b-...-full`, `31-tt-edit-long-name`, `32-tt-edit-unusable`, `33-tt-new`, `34-tt-new-validation`, `35-tt-icon-picker-open`, `36-tt-unsaved-guard`, `37-tt-deactivate-confirm`, `38-tt-edit-404`, `39-tt-edit-error`.

**What works.** The icon picker (a named button "Data at risk / Change icon" opening a list), Save disabled until something changes, a conflict banner with "Reload the latest version", the unsaved-changes dialog with Stay (default) and Leave, the default workflow drops out automatically when its workflow is unticked with a spoken announcement, the Request form section says "Save the task type first" on create and "Save your changes before opening the designer" when dirty, 0 axe violations at four widths, the confirm before deactivation.

**TE1 (major, L, 14 h): it is a form, not a record page.** The page is a breadcrumb, an H1 and a 640 px card on a 1,100 px area (`30-tt-edit-general-1366x768`, right 40% empty); the document is 2,013 px tall; Save and Cancel are in a sticky footer that covers the "Eligible workflows" heading at 768; there is no status badge, no counts, no Activity, no way to see which tasks use the type. Recommendation (decision to take): **Option A (recommended)**: keep inline editing, but build the page like Client and Matter: `mf-record-header` (icon and name, **Active / Inactive / Not usable** badge, header actions in the order Edit, Activity, primary **Edit form**, overflow with Deactivate or Activate), a summary strip (**Form**, **Workflows**, **Default workflow**, **Open tasks** as a link, Status) and tabs **Overview** (name, icon, description) | **Workflows (n)** (TE2) | **Request form** (summary, fields count, last published, button) | the activity drawer from the header for the audit trail. Each tab saves on its own with the existing guard. Option B: read-only Overview with an Edit dialog as on Client and Matter. Option A is smaller and keeps the single Save the administrator expects for configuration; B is closer to the records. A is costed here.

**TE2 (major, M, 8 h): Eligible workflows is 33 flat checkboxes** (`30b-tt-edit-general-full-1366x768`: 1,000 px of labels like "Workflow 07 - Hold (published v1)"), unsearchable, with the **Default workflow** a separate select below them, and with workflows that make the type unusable ("not published yet") offered like any other. Recommendation: a table of the chosen workflows (name, published version, steps, **Default** radio, Remove) and an "Add workflow" combobox with search that lists **published and active** workflows only (draft-only and inactive ones listed disabled with their reason). Keyboard model: the radio group is one Tab stop; Remove has an accessible name. The first added workflow becomes the default.

**TE3 (minor, S, 2 h): the "Not usable for new tasks yet" panel is at the bottom,** after the list of workflows (`32-tt-edit-unusable`, below the fold at 1366). Move it to a neutral status note under the header (decision W: grey, never warning colours; one note) that names each reason with the fix as a link ("The request form isn't published. Open the form").

**TE4 (minor, S, 2 h): the Request form section** is a line of text and a link. Show `Published v1 - 4 fields - last published Oct 19` and a secondary button "Edit form" (the same action as the header primary); retire the "Open the form designer" link wording.

**TE5 (minor, S, 2 h): limits are invisible.** Name 100 characters (the field silently stops at 100), Description 1,000, no counters; a 100-character name makes the H1 wrap to 3 lines at 375 and the breadcrumb repeats it in full (decision V cuts the last crumb at 40 characters with a tooltip). Add the "n / 100" counter that the Task edit dialog has, apply `CRUMB_MAX`, clamp the H1 at two lines.

**TE6 (minor, S, 2 h): validation differs from the Step and Workflow pages.** The Task Type page shows only the inline text "Enter a name." (no icon, no summary, `34-tt-new-validation`); Step and Workflow show a red summary at the top plus an inline message with the icon (`74-step-new-validation`). One rule: summary and inline, focus moves to the first invalid field, the message starts with the field name.

**TE7 (minor, S, 2 h): deactivation hides behind a checkbox.** To deactivate on this page an administrator unticks "Active (offered for new tasks)" and presses Save, which then opens the confirm (`37-`). The list has a visible Deactivate. Put Deactivate/Activate in the header overflow (TE1) and remove the checkbox on an existing type (keep it on create, where it is the initial state).

**TE8 (see BUG-1).** A 404 reads "Couldn't load this task type." with "Try again" (`38-tt-edit-404`).

**TE9 (nit, S, 1 h): "New task type"** shows "Save the task type first, then design its request form" in the middle of the form; with TE1 the Request form tab is disabled with that reason on create (the design system's "disabled with a reason" case).

### 2.6 Request-form designer (`/admin/task-types/:id/form`, `/admin/steps/:id/form`)

Screens: `80-step-form-designer`, `81-tt-form-designer` (4 widths), `81b-`, `82-tt-form-draft` (1366 and 375), `82b-tt-form-draft-full-375x812`, `83-tt-form-none`, `85-designer-field-selected`, `85b-...-full`, `86-designer-publish-errors`. The same designer serves Asset Types and Custom Fields: **recommendations here change those pages too** and must be built once.

**What works.** A complete palette (the 14 controls of the spec, no file upload), key locked after the first save with the reason shown ("Locked once saved, so existing answers keep working"), type locked, Always/Conditional visibility and required rules, live preview with "Test submit" and "Server re-validates on submission", a validation panel, a publish dialog that lists what was added, changed, removed with a version note, Retire version, Create new draft, a version table, the empty state ("This task type has no form yet" with Create new draft), 0 axe violations.

**FD1 (major, L, 10 h): the designer is a page-scrolling stack.** At 1366x768 the three panes occupy the first 560 px; **Validation and Preview are below the fold**; with a field selected the Properties pane is 770 px tall (`85b-`), the page 1,640 px; **Save draft and Publish scroll away** with the page header. Recommendation: the fixed-height pattern: header with sticky Save draft / Publish, then three panes (Add a field 180 px, Fields, Properties) each scrolling inside itself, and **Preview and Validation as two tabs** of the Properties column (or a bottom drawer) with the error count on the Validation tab ("Validation (2)"). Below 1100 px: Fields first, Add field as a menu button, Properties as a bottom sheet.

**FD2 (minor, S, 2 h): the read-only (published) layout wastes the screen.** Fields (170 px) and Properties (370 px) hug the left, the right 55% is empty, Preview is below (`81-tt-form-designer-1366x768`). In read-only mode show the Fields list and the Preview side by side.

**FD3 (minor, S, 1 h): the version status is bold plain text** ("Published v1", "Draft v1") under the title with an 18 px gap, while the workflow version page puts an `mf-badge` next to the title. Use the badge in the title, "(published: v3)" as muted text when a draft exists.

**FD4 (minor, M, 4 h): phone.** On a draft the palette (14 full-width buttons, 565 px) comes before the fields; the first field appears at y = 810 (`82b-tt-form-draft-full-375x812`). Fields first, "Add field" as one button opening the palette.

**FD5 (minor, S, 2 h): keyboard and removal.** Fields have Up/Down/Remove buttons (good, there is no drag, which the spec lists; the buttons are the accessible alternative and enough), but **Alt+Arrow**, which the workflow version page has with a spoken position, is not supported here, and Remove deletes at once without an Undo (the shared `undo-toast` exists). One keyboard model for both pages.

**FD6 (minor, S, 1 h): titles.** The document title is the static "Task type form" or "Step form" (BUG-7); the H1 "Form: Data Processing Extended" is right, use it.

### 2.7 Workflow page (`/admin/workflows/new`, `/admin/workflows/:id`)

Screens: `40-wf-edit-with-draft` (4 widths), `41-wf-edit-four-versions`, `42-wf-edit-long-name`, `43-wf-new`, `44-wf-new-validation`, `45-wf-edit-404`, `46-wf-unsaved-guard`.

**What works.** The three status badges under the title (Active, Published v2, Draft v3 in progress) with icons and words; "Open draft v3" top right; the version history with Draft / Published / Retired badges, "Current", the mode and the step count of each version; "Create new draft from v2" disabled while a draft exists with the reason under the table; execution mode is chosen on create and explained ("You can change this later while the version is a draft"); validation summary plus inline messages; guard on leaving.

**WE1 (major, L, 14 h): not a record page.** Same as TE1: a form card, then a version table below it; no header actions beyond "Open draft v3". Recommendation: `mf-record-header` (name, badges, primary **Open draft v3** or **Create new draft**, overflow with Deactivate), summary strip (**Published**, **Draft**, **Steps**, **Task types**, **Open tasks on the published version**), tabs **Overview** (name, description, status) | **Versions (n)** | **Task types (n)**.

**WE2 (major, S, 3 h): "Used by" is missing although the data is there.** `GET /workflows/{id}` returns `taskTypes` (id, name, isActive, isDefault); the page never shows it. An administrator about to retire v2 cannot see which task types depend on it. Spec S16 asks for "Eligible Task Types (read-only list here)". The Task types tab lists them with the default marker, links with `TaskType.Manage` and plain text without (permission-aware hiding).

**WE3 (minor, S, 2 h): the Active checkbox** deactivates a workflow with only a confirm that does not mention that task types lose it. Overflow action with the impact sentence "Used by 3 task types; Billing request 02 has no other workflow".

**WE4 (minor, M, 4 h): the version table** has no creation or author columns, and no count of tasks per version (spec S16: "with counts of tasks using each"); "Create new draft from v2" as a full-width secondary button in each Published row is the only action. Add Created, By, Tasks (the API count is the dependency), the version number as the link and an overflow per row (Open, Create draft from this version, Retire).

**WE5 (nit, S, 1 h): long name.** 150 characters wrap to 3 lines in the H1 and 2 in the crumb (`42-wf-edit-long-name`). Same as TE5.

### 2.8 Workflow version page (`/admin/workflows/:id/versions/:versionId`)

Screens: `50-ver-draft-editor` (4 widths), `50b-...-full`, `51-ver-published-readonly` (4 widths), `52-ver-retired-readonly`, `53-ver-draft-only-first`, `54-ver-unordered-published`, `55-ver-preview-inputs`, `56-ver-publish-dialog`, `57-ver-discard-dialog`, `58-ver-mode-switch`, `59-ver-retire-dialog`, `60-ver-dirty`, `61-ver-unsaved-guard`, `62-ver-404`, `63-ver-scrolled-actions-offscreen`, `64-ver-after-move`.

**What works.** Everything an administrator needs exists and is reachable by keyboard: Up/Down buttons with names ("Move X up"), **Alt+Arrow with a live announcement** ("Moved Search term report - custodian data 19 to position 2 of 13." verified), Required / Skippable / "Comment on skip" badges with icon and word, a deactivated library step flagged on the row with the fix, a library with search and the shared tag filter, "Showing the first 50 of 67 steps", the "Unsaved changes" badge, an "Ordered numbering will be hidden" confirm before changing mode, a publish diff against the previous published version ("First published version" on v1), read-only versions with "Create new draft", Retire with a consequence line, Discard draft with a confirm.

**VP1 (major, M, 6 h): the page scrolls and the actions leave.** At 1366x768 the document is 2,117 px; after one wheel scroll the **Publish and Save draft buttons are at y = -1,097** (`63-ver-scrolled-actions-offscreen`). Draft with 13 steps; a real production workflow has more. Recommendation: the fixed-height pattern of the Dashboard and Task Queue: the header and an action bar stay, the steps pane scrolls inside; at minimum a sticky action bar. The action bar shows Publish... (primary), Save draft, the overflow (Discard draft) and the "Unsaved changes" badge.

**VP2 (major, M, 8 h): the step row is 94 to 118 px (315 px for the 170-character title).** 13 steps are 1,776 px (`50b-ver-draft-editor-full-1366x768`). Each row carries a number, the title, a badge, the description, two checkboxes (one permanently disabled unless Skippable), Up, Down, Preview inputs and Remove. Recommendation (see `mocks/mock-workflow-version.png`): a 44 px row: optional drag handle (a pointer shortcut only: the buttons and Alt+Arrow remain the accessible model, WCAG 2.5.7), the number, **one-line title** with tooltip and a two-line clamp, one **rule badge** (Required, Skippable, Skippable - comment), an overflow with Move up, Move down, **Skip rules...** (a popover with the two checkboxes), Preview inputs, Remove. Thirteen steps then need about 600 px. Remove gets the shared Undo toast (today it deletes the row, with its skip rules, at once).

**VP3 (major, M, 6 h): the library comes before the steps.** Below 1100 px the library (736 px) is first in the DOM and on screen; the steps you are editing start at **y = 1,096 at 768 and y = 1,118 at 375**, and the page is 3,483 px and 4,603 px tall (`50-ver-draft-editor-375x812`). A phone administrator scrolls past 50 library items to reach the steps. Recommendation: steps first at every width; "Add step" opens the library as a **drawer** below 1280 px (search, tag filter, Add buttons that stay open for several adds, a count "3 added") and as a left pane above it (both panes scroll inside the fixed-height page). Keep the DOM order = reading order.

**VP4 (minor, S, 2 h): Execution mode takes a full card** (130 px) on every visit although it changes rarely. Show it as an inline control in the action bar ("Ordered v") with the explanation in the popover; read-only versions show it as a badge in the meta line.

**VP5 (minor, M, 4 h): no tabs.** Steps, Settings (name is on the workflow page), Versions, Used by are all one scroll. With WE1's tabs: Steps (n) | Versions (n) | Used by (n); the version page stays its own URL because publish and discard are version actions.

**VP6 (minor, S, 3 h): read-only states.** (a) The note "This version is published and cannot be edited" is an **amber warning box** for a normal state (`51-`); decision W: one neutral note, never warning colours. (b) "Create new draft from v2" is disabled (greyed, no tooltip) while a draft exists, and the link to the draft is in the note; replace the button by **Open draft v3** in that case. (c) **Retire version** says "New tasks will no longer use this version" but not that, with no other published version, the workflow stops being usable and the task types that depend on it become "Not usable" (`59-ver-retire-dialog`). With WE2's data: "Billing request 02 and 3 other task types have no other published workflow."

**VP7 (minor, M, 4 h): the publish dialog.** (a) Every step is marked **Moved** when two earlier steps were removed (13 rows of "Moved" in `56-ver-publish-dialog`); fold the pure position shifts into one line "13 steps moved" and list only added, removed, skip-rule and mode changes. (b) A long step title wraps below its badge and breaks the layout of the row. (c) The impact line the spec asks for is missing: "Tasks already running keep v2 (14 open). New tasks use v3." (d) **BUG-4:** the dialog content is a scrollable region that cannot be reached by keyboard (axe `scrollable-region-focusable`, serious, 2 nodes).

**VP8 (minor, S, 2 h): leaving.** The guard offers Stay or Leave (red). Add **Save draft and leave** as the primary, which is what an administrator who pressed a breadcrumb by mistake wants.

**VP9 (nit, S, 1 h): titles and 404.** The document title is the static "Workflow version" (BUG-7) and a missing version shows no header or crumb at all (BUG-1).

**VP10 (verified good).** Axe is clean at 1920, 1366 and 768 and at 375 apart from BUG-5; the preview of a step's inputs opens inline with "Hide inputs" and `aria-expanded`; `[data-live]` announces the move; unordered workflows hide the numbers and say the order is display only.

### 2.9 Step page (`/admin/steps/new`, `/admin/steps/:id`)

Screens: `70-step-edit` (4 widths), `70b-`, `71-step-edit-long-title`, `72-step-edit-inactive`, `73-step-new`, `74-step-new-validation`, `75-step-url-invalid`, `76-step-404`, `77-step-unsaved`, `78-step-deactivate-dialog`.

**What works.** The best-organised of the three edit pages: Title, Description, **Tags with chips and suggestions**, Instructions (20,000 characters), Documentation URL (validated, `ftp://` is refused with a clear message), Data inputs with their state in words ("The inputs are in draft. Publish them before this step can be published in a workflow."), a "Used by" list, a summary of errors plus inline messages, a guard.

**SE1 (minor, S, 2 h): the permanent amber banner.** "Editing this step doesn't change workflows that are already published..." is shown on every visit in warning colours (`70-`) and pushes the form down 56 px. It is a fact, not a warning: a muted sentence at the top of "Used by" (and shown in full only when the step is used).

**SE2 (minor, S, 2 h): "Used by" is plain text** ("Standard Processing v1 (published)") with no links. Each line links to the workflow version page (the page is `Workflow.Manage` like this one), with the status badge; and "Used in 5 workflows" in the header meta.

**SE3 (minor, M, 4 h): Data inputs** are a sentence and a link. Show the field list (label, type, required) read-only with the status badge and the primary "Edit inputs" button.

**SE4 (minor, S, 2 h): Deactivate sits beside Save and Cancel** in the footer (`70-`). A danger action next to the primary; move it to the header overflow (as on the other record pages) and make the confirm say how many **draft** versions still contain the step ("2 drafts contain this step; they keep it").

**SE5 (nit, S, 1 h): the H1 is "Edit step"** for every step (the crumb has the title); the Task Type page uses the name. Use the title as the H1 with the Active/Inactive badge, and "New step" on create.

### 2.10 Dialogs (all eight)

Deactivate (task type, workflow, step), Retire (workflow version, form version), Publish (workflow version, form version), Discard draft, Leave without saving, Change execution mode. **Good:** every one has a verb in the primary ("Deactivate task type", "Publish v3", "Retire"), a "keep" or "back" cancel ("Keep active", "Back to draft", "Stay"), the destructive ones are red, Escape closes, focus returns. **Gaps:** none states impact (TT7, WE3, VP6, VP7, SE4); the form retire and publish copy differs from the workflow's ("Retire version" vs "Retire"); the form publish dialog takes focus into the optional "Version note" box (the primary action is two Tabs away). Decision: one wording and one impact line for all three families (published things are retired, records are deactivated, drafts are discarded).

---

## 3. Cross-cutting consistency

1. **Record header and tabs.** The recently reworked pages share `mf-record-header` (Edit, Activity, primary action, overflow), `mf-tabs` with counts and a summary strip. The twelve pages here use `mf-page-header` with ad-hoc buttons, no counts, no strip. Recommendation: reuse the Clients component with a different data set, as the Task page did (decision W): add the kinds `taskType`, `workflow`, `workflowVersion` and `step` to `RecordKind` (list label, link, permission, wording of the 404/403/failure states).
2. **Header action rule.** Today: Task Type none (Save/Cancel in a footer), Workflow "Open draft vN", Version page Discard / Save / Publish (or Retire / Create draft), Step none. The rule for these pages: **Edit, Activity, primary action, overflow**. Task Type: primary Edit form; overflow Deactivate/Activate. Workflow: primary Open draft vN or Create new draft; overflow Deactivate. Version (draft): primary Publish..., Save draft, overflow Discard draft; (published): primary Create new draft or Open draft, overflow Retire. Step: primary Edit inputs; overflow Deactivate. Edit stays on the page (Option A of TE1).
3. **Two form stacks and two button systems.** Task Type: own `.edit` grid, `.text`/`.select` classes, `<a class="mf-btn">`; Workflow and Step: `pg-form`, `mf-text-field`, `p-button`; the designer: `ttf__*` classes. Three card widths (640 px, 720-ish, full), three validation looks (TE6). One form page pattern, one width rule, one validation rule, one button component.
4. **Two table stylesheets and four row heights.** Task Types uses `.grid` (`admin-lookup.scss`), Workflows and Steps use `.pg-table` (44 px target but rows grow), the form-version table `ttf__table`, the workflow-version table `pg-table` again. Rows: 67 to 151 (types), 47 to 725 (workflows), 44 to 113 (steps). One grid contract (decision V: 44 px rows, clamps with tooltips, name is the link, the number plain, row overflow).
5. **State vocabulary.** Records are **Active / Inactive** ("Deactivate" and "Activate"); versions are **Draft / Published / Retired** ("Publish", "Retire", "Discard"); nothing is deleted, nothing is "Archived" (the request wording "archive" maps to Retire for versions and Deactivate for records). The pages already follow this; the dialogs and buttons should say it the same way everywhere (section 2.10). The "Not usable" state of a task type (derived) should be a badge of its own, neutral, not a red box.
6. **Colour language.** Red is danger/overdue, amber is High priority and warnings (decision T). Today red is also used for the "not usable" chip (TT4) and amber for ordinary read-only notes (VP6, SE1). Use the neutral note and the neutral Not usable badge.
7. **States.** Lists: skeleton, error with Retry, empty, no-match. Pages: five different not-found texts (BUG-1). One shared record state with the reference.
8. **Focus and drill.** The Matter and Client pages return focus to the row on Back (`drill.ts`); here it lands on `<body>` (BUG-3).
9. **Fixed-height tab pattern.** Fits the Version page, the form designer and the three lists (grid scrolls inside); does **not** fit the Task Type, Workflow and Step Overview tabs (short forms): those scroll normally under the header.
10. **Documentation.** `ux-spec.md` S14 to S16 describe features that were never built (tabs, Open tasks, Validate, settings drawer, drag) and the code has features the spec does not mention (Alt+Arrow, tag filter, row-level badges). After the work, update S14 to S16 and add a decisions section X (see work package 11).

---

## 4. Bug list (with repro)

Environment: `origin/dev` `ec67fcf`, Playwright Chromium 1366x768, Dev auth, `America/New_York`, 69 task types, 31 workflows, 67 steps.

| ID | Sev | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | major | **Every not-found reads as a load failure** ("Couldn't load this task type." / "We couldn't load that workflow." / "that step" / "that workflow version" with Retry and a toast "We couldn't find that."); five wordings ("Task type not found.", "Step 99999 does not exist." with the raw id, a second identical toast on the step form); the **version page shows no header or breadcrumb**; Retry can never succeed on a 404. | `/admin/task-types/99999`, `/admin/workflows/99999`, `/admin/steps/99999`, `/admin/task-types/99999/form`, `/admin/steps/99999/form`, `/admin/workflows/10/versions/99999` (`38-`, `45-`, `62-`, `76-`) | 404: "We couldn't find that task type." with the link back; 403: "You don't have access to this..."; 5xx or offline: "Couldn't load this task type." with the error reference and Retry; header kept (decision V microcopy). |
| BUG-2 | major | **At 768 the Actions column (Edit form, Deactivate) is cut off with no visible cue; at 375 Workflows, Status and Actions are cut off** (table 853 px in a 664 or 343 px box); Deactivate cannot be reached from the list on a phone. The Workflows list loses Status the same way. | `/admin/task-types` at 768x1024 and 375x812 (`01-task-types-768x1024`) | Overflow always visible, cards below 640 (TT2, WL6). |
| BUG-3 | minor | **Focus is lost on return, and the breadcrumb drops the list state.** After opening a row and pressing browser Back, the URL (page, size, filters) is restored but `document.activeElement` is `<body>`; via the "Task Types", "Workflows" or "Workflow Steps" crumb the list opens on **page 1 with default filters** and the focus is also `<body>` (measured on all three lists, `?page=2&size=10`). | Open the 4th row of `/admin/task-types?page=2&size=10`, then Back, or the crumb. | Focus on the name link of the row left, list state restored by the crumb (decision V Keyboard and focus; `drill.ts`). |
| BUG-4 | major (a11y) | **The publish dialog's scrollable content is not keyboard reachable.** axe `scrollable-region-focusable` (serious, 2 nodes) on the dialog content when the diff is longer than the window. | `/admin/workflows/10/versions/12`, Publish... (`56-`) | Region focusable with a name, or the dialog body not scrolling on its own. |
| BUG-5 | minor (a11y) | **Target size:** the wrapped breadcrumb link "Task Types" fails WCAG 2.5.8 at 375 (axe `target-size`, serious) on the version page and the form designer pages. | `/admin/workflows/10/versions/12` and `/admin/task-types/16/form` at 375x812 | 24 px target or spacing, as the record pages manage. |
| BUG-6 | minor | **Failure shows twice:** the inline "Couldn't load task types." with Retry and a toast "Something went wrong. Try again."; 404s add "We couldn't find that." | Fail `GET /task-types` (`10-`) | One message, with the error reference. |
| BUG-7 | nit | **Static document titles** on the pages that have a record: "Workflow version", "Task type form", "Step form", "New workflow" (while the edit pages name the record). | Page titles checked on all 12 routes | "Large Production Workflow v3 (Draft) - MatterFlow", "Form: Data Processing Extended". |
| BUG-8 | nit | **Inconsistent denial:** a Task Type-only administrator who opens `/admin/workflows` is silently redirected to Task Types; a Workflow-only one who opens `/admin/task-types/new` gets the 403 page. | Users `tt-ttonly`, `tt-wfonly` (`23-`, `24-`) | One rule: a tab URL falls back to the first allowed tab, a create/edit URL shows the 403 page; both are acceptable, pick one and say so. |
| BUG-9 | nit | **Skeleton rows do not match the table:** the columns of the loading state are spaced differently from the header and from the loaded rows, so the grid jumps. | `09-task-types-loading-1366x768` | Skeleton uses the grid's column widths. |

Not bugs (checked): Alt+Arrow reorder works and announces; the unsaved-changes guards work on all four edit pages; the version conflict banners exist; 0 axe violations on the lists at 4 widths and on the three edit pages at 1920, 1366 and 768.

---

## 5. Keyboard, focus and accessibility basics

- **Tab model.** Tabs: one stop, Left/Right/Home/End, automatic activation (verified: Right moves Task Types to Workflows and the URL follows). Lists: 22 stops before the first row, 6 to 7 per row (TT9). Version page: per step Up, Down, Preview inputs, Remove, two checkboxes: 6 stops times 13 steps; with VP2 two or three.
- **Reordering.** Buttons with step names, **Alt+Arrow with a live region**, no drag (the spec's drag handle is optional; if added it must keep both alternatives, WCAG 2.5.7). The designer has buttons only (FD5).
- **Dialogs.** Escape closes, focus enters and returns; the form publish dialog starts in the Version note field; BUG-4.
- **Focus after actions.** After deactivate, publish or retire the shared dialog returns to the opener; after Publish the page should move focus to the status badge or the page heading and announce "Published v3" (not verified, set as an acceptance criterion).
- **Colour.** Status is always badge text plus icon (Published, Draft, Required, Skippable); the red "not usable" box is text, fine for contrast, wrong for the colour language (TT4).
- **Axe (wcag2a, 2aa, 21aa, 22aa).** Zero violations: lists at four widths (with the filter row open and a dialog open), Task Type page (idle, icon picker open), Workflow page, Version page (idle), Step page, form designer (idle, field selected). Violations: BUG-4, BUG-5.
- **Zoom and reflow.** No horizontal page scroll at 375 on any page (`scrollW` equals the viewport); the lists scroll inside their box (BUG-2 is about the missing cue, not the page).
- **Not verified:** a real screen-reader pass, forced colours, 200% zoom on the designer, drag and drop (none exists).

---

## 6. Proposed work packages and order

All effort is in AI-agent hours (implementation + unit tests + e2e update). "API" marks additive backend changes.

| WP | Package | Findings | Effort | Depends on |
|---|---|---|---|---|
| **WP1** | **Shared foundations**: add `taskType`, `workflow`, `workflowVersion`, `step` to `RecordKind` and the record state (404/403/5xx with reference, header skeleton); admin list return helper using `drill.ts` (focus on the row, crumb carries list state); document titles from the record; one wording table for the dialogs; one `mf-form-page` pattern (width 720, card, validation summary + inline, button component). | BUG-1, BUG-3, BUG-6, BUG-7, TE6, section 3 item 3 | 12 h | none |
| **WP2** | **Page shell**: tabs with counts, shorter descriptions, filter row open by default from 640 with the button in the header, health strip per tab (client-side for Task Types; API counts for Workflows and Steps), loading skeleton with real widths. | P1 to P5, TT5, TT8, BUG-9 | 12 h (API 3 h) | WP1 (partly) |
| **WP3** | **Lists on the grid contract**: one stylesheet, 44 px rows, name link, number columns, Default workflow / Versions / Inputs columns, clamps with tooltips, row overflow menu, Open tasks (API), Last published (API), phone cards below 640, narrow-window column drop at 768, Tab stops. | TT1 to TT4, TT6, TT7, TT9, WL1 to WL6, SL1 to SL5, BUG-2 | 24 h (API 6 h) | WP2 |
| **WP4** | **Task Type record page**: record header, strip, tabs Overview / Workflows / Request form, eligible-workflow picker with Default radio, status note, deactivate in overflow with impact, counters, crumb clamp. | TE1 to TE9 | 16 h | WP1 |
| **WP5** | **Workflow record page**: record header, strip, tabs Overview / Versions / Task types, "Used by" with permission-aware links, version table with Created/By/Tasks (API), per-row overflow, deactivate with impact. | WE1 to WE5 | 14 h (API 2 h) | WP1 |
| **WP6** | **Version editor on the fixed-height pattern**: sticky action bar, steps first, 44 px rows with rule badge and overflow, library drawer / pane, inline execution-mode control, tabs, neutral read-only note, "Open draft" in place of the disabled button, retire and publish dialogs with impact and the folded diff, Undo on Remove, Save draft and leave, a11y fixes of the dialog. | VP1 to VP10, BUG-4, BUG-5 | 22 h | WP5 (header and data), WP1 |
| **WP7** | **Step record page**: header, strip, tabs Details / Inputs / Used by with links, deactivate in overflow with draft usage, neutral note instead of the banner, H1 = title. | SE1 to SE5 | 8 h | WP1 |
| **WP8** | **Form designer layout**: three fixed panes, Preview and Validation tabs, sticky actions, read-only side-by-side, phone order, badge in the title, Alt+Arrow and Undo, static titles. Built once for Task Types, Steps, Asset Types and Custom Fields. | FD1 to FD6 | 16 h | none (needs a check with the Asset Types and Custom Fields owners) |
| **WP9** | **Keyboard, focus and a11y audit**: Tab-stop record per page, focus after publish/retire/deactivate, axe at four widths for the new pages, `tab-stops.json` evidence. | BUG-3 follow-up, BUG-5, section 5 | 6 h | WP3 to WP8 |
| **WP10** | **Permissions and denial rule**: one rule for tab URLs and create/edit URLs, links only when reachable, hidden not disabled, tests with the three Dev users used in this review. | BUG-8, P6 | 3 h | WP2 |
| **WP11** | **Docs and e2e**: update `ux-spec.md` S14 to S16 and the tokens note, add decisions section X to `decisions-addendum.md`, extend `task-types-tabs`, `workflow-version`, `workflow-steps`, `form-designer`, `task-type-icons` specs, evidence in `fixes/`. | all | 8 h | runs per package, closes last |

**Total: 141 h** (about 125 h without the API items, which are small: counts on four list responses and one per-version task count).

### Order and parallel work

1. **Start**: WP1 and WP8 in parallel (WP8 shares nothing with WP1; coordinate with Asset Types and Custom Fields because the designer is shared).
2. **Then** WP2 and WP10 (small), WP4, WP5 and WP7 in parallel (three disjoint pages, all on WP1).
3. **Then** WP3 (needs WP2's strip and chrome) and WP6 (needs WP5's header and data) in parallel.
4. **Last** WP9 and the remaining WP11 (docs and the final verification).

Cheapest wins if the owner wants a first release before the epic: BUG-1 and BUG-3 (WP1 slice, 6 h), WL1/SL1/TT1 clamps and the Actions overflow (the visible 80% of WP3, 8 h), VP1 sticky action bar (2 h), BUG-4 (1 h): about 17 h.

### Decisions I am asking the owner to take (defaults in bold)

1. Task Type, Workflow and Step edit: **Option A inline editing under a record header** or Option B read-only Overview plus an Edit dialog (TE1).
2. Tab counts show **active records** (the default filter) (P2).
3. Open tasks per task type and per workflow version: **add the API counts** (TT3, WE4) or leave them out.
4. Drag handle on steps and fields: **no** (buttons and Alt+Arrow are enough, fewer failure modes) or yes as a pointer shortcut (VP2, FD5).
5. Library on the version page: **drawer below 1280 px, pane above** (VP3).

---

## 7. What I did NOT verify

- A real screen reader, forced-colours mode, 200% zoom on the designer.
- The **Asset Types** and **Custom Fields** pages that use the same designer (the designer recommendations affect them; they were not walked through).
- Behaviour with live tasks running on a version (no tasks were seeded): the "open tasks" and "Used by N open tasks" numbers are proposals, the API for them does not exist.
- Concurrency between two administrators beyond the banners in the code (no second session was driven).
- The Task Queue address parameter for a task-type filter (TT3 links to it; to confirm in WP3).
- Dark theme (not shipped), printing, exports.
- Label and Custom Field screens are not reached from Task Types and were left out as asked.

## 8. How the evidence was produced

Stack: published API (`artifacts/e2e-publish`, linux-x64) on port 5197 with Dev auth, SQL Server 2022 in a private container, starter configuration (15 task types, 8 workflows) plus a seed through the public API: 52 extra task types (icons, no-workflow, no-form, draft form, published form, inactive, a 100-character name with a 1,000-character description), 24 extra workflows (a published-with-draft 15-step workflow, a 12-step unordered workflow, a 150-character name with a long description, a draft-only workflow, a workflow with 3 retired versions, an inactive workflow, 16 numbered ones), 60 steps (a 170-character title and description, tags, steps with published inputs, inactive steps), and three users: `tt-wfonly` (Workflow.Manage), `tt-ttonly` (TaskType.Manage), `tt-viewer` (Task.View only). Totals: 74 task types (69 active), 32 workflows (31 active), 67 active steps. Screens by Playwright Chromium at 1366x768, 1920x1080, 768x1024 and 375x812; axe-core with wcag2a, wcag2aa, wcag21aa and wcag22aa; DOM measurements by script.
