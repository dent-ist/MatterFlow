# Task Detail: independent UX review

> **Status banner (2026-10-19).** This is the review as it was written, against `dev` before the epic. Its 46 findings and BUG-1 to BUG-9 were planned and built as epic #288 (issues #289 to #331), with the decisions and reversals recorded in the plan (for example Assets first and full width on the owner's request, `from=` for four more origins, no buttons in the status note); the findings below describe the **old** screen, so statements such as the old closed banner, the Details pencil, the two-column Comments/Assets row, the "Jump to" row, the Complete block in the Workflow and the always-open Request details are **no longer true**. Read next: the delivery plan [`delivery-plan.md`](delivery-plan.md) (decisions, packages and, in section 4, what each package shipped and where it deviated), the evidence of each package in [`fixes/`](fixes/) (`fixes/t1` to `fixes/t10`, the final verification goes to `fixes/final/`), and the specification that now holds the behaviour: `docs/ux/ux-spec.md` S10 and S09 and the decisions in `docs/requirements/decisions-addendum.md` section W.

Scope: the **Task Detail page** (`/tasks/:id`, opened from Task Queue, My Work, the Dashboard or a Matter's Tasks tab) and everything on it: the header (title, ref, status, priority, due, assignee, matter, hold note, actions), the single-page layout (`mf-detail-layout`: Workflow and Comments and Assets in the main column, Details in the side panel, Activity in a drawer), inline editing, the status, priority and assignee menus, the Hold, Complete, Cancel and Reopen dialogs, the Edit dialog, the request-form values, and the **Create task** page. Shipped on `origin/dev` at `a99570e` (after Clients WP8 and WP11; Clients WP3, the record header, is **not** merged yet). Reviewed as a user would see it: real navigation, the production Angular build, the published API with Dev auth, SQL Server, Playwright Chromium. **No application code was changed and no issues were created.**

Screenshots: `screenshots/` (79 PNGs, `<name>-<width>x<height>.png`; 1366x768 unless the name says otherwise; 1920x1080, 768x1024 and 375x812 where it matters; `-full` is a full-page capture). `mock-task-*.png` are before/after mock-ups of recommendations (sources in `mocks/`); everything else is the shipped UI.

**Test data** (`npm run seed:demo`, 120 tasks, 15 test users, 5 clients, 12 matters, 4 projects, 60 assets, plus my own edge fixtures through the API):
- TSK-123: **200-character title** (the maximum), 6-paragraph description with a list, UNC paths and a 150-character unbroken URL, 45-character requestor name and a 100-character email, on a **sensitive matter with a 105-character client and a 205-character matter name**, High, **overdue**, assigned, 3 workflow steps (2 done), **48 comments** (one with a 70-character unbroken word, some with links), **about 70 activity entries** (6 priority changes, 5 assignment changes, 3 hold/resume cycles, 3 due-date edits, step completions).
- TSK-124 overdue 6 days with a time, TSK-125 ASAP and Critical, TSK-126 unassigned with no Pod, TSK-127 On Hold with a 3-sentence reason, TSK-128 Completed, TSK-129 Cancelled with a reason, TSK-130 New with a project, TSK-131 a one-word title on the sensitive matter. Task types from 6 families (Search and Culling, Export, Analytics, Collection Receipt, Access Request, General), each with its own request form (5 to 14 fields).
- Users: System Admin, a Data Technician (assignee and a different technician), a user with **Task.View only** (no edit rights, no Asset.View), a user with **no Task.View** and a user with **no roles**.

Ranking key: **severity** blocker / major / minor / nit; **effort** in AI-agent hours (h), including unit, e2e, axe and screenshots.

---

## 1. Summary

The Task page is functionally strong. One page instead of tabs (decided, UAT-S10-2), the stepper with a single expanded current step, an inline status / priority / assignee editor that only offers valid transitions, reasons that are mandatory and echoed, an Activity drawer, comments that load lazily, a request form that is editable against its own version, closed tasks that only offer Reopen (decision U), a View-only line, `?from=` Back links, a skip link and focus that returns to the row you left. **0 axe violations** (WCAG 2.2 AA plus best-practice) on 27 of 32 scans (6 task states at 4 widths, plus drawer, comments, a View-only user, Create task at 3 widths and its form at 2); the other five are one real defect (BUG-2). No page-level sideways scroll at 375, 768, 1366 or 1920. API calls answer in well under 100 ms.

What lets it down is that it is **the old half of the product**: it was built before the work lists got their language (sections T and U) and before the Clients epic got its header. It looks like a different app next to Dashboard, My Work, Task Queue and the reworked records:

- **The header costs too much and says everything twice.** The title is 28 px with a 28 px mono ref (the token for a page title is 22 px, Matter and Task Queue use it), the full breadcrumb repeats the matter name, and Type, Pod, Workflow, Due and Matter are in the header **and** again in the Details panel (Type three times, Pod twice). Typical task: the Workflow heading starts at y 235 of 768 at 1366 (header 223 px); the 200-character task: **y 519, 68 percent of the screen**; on a phone 609 to 1230 px.
- **Tablets and narrow windows put the least-used content first.** Below 1100 px the whole Details panel (about 1100 px of request-form values) sits above the Workflow: at **768x1024 the Workflow starts at y 1519 of a 2669 px page** (2335 of 3499 for the long task). Details starts open on tablets (only phones start collapsed).
- **Banners pile up** before the work: a Cancelled task shows three amber boxes (closed, reason, workflow) = 190 px; an On Hold task says "This task is On Hold. Resume it" twice and the reason in a 115 px block; a Completed task has no completion date or person on the page.
- **The primary action is in the wrong place.** "Complete task" is inside the Workflow section (with two lines of helper text), "Cancel" and "Complete" are neighbours in the status menu, and Complete often only leads to "Steps need information first" (the same dead end My Work A6 found).
- **Scale is not handled where it matters.** 48 comments are "Show latest 3"; Comments and Assets sit 1500 px down at 1366 with no way to jump from 1100 px up; the Details side panel has its own scrollbar (674 px of 1110) next to the page scroll; the Activity timeline prints "Comment added" 48 times with no excerpt, ISO dates ("2026-10-14") and a 5-line drawer title; the Edit dialog is **2489 px tall with Save at the very bottom** and a single-line title input for 200 characters.
- **States and permissions are rougher than the lists.** Bare dashed "Loading the task..." (Clients BUG-2), a Task.View-only user gets a red toast "You don't have permission to do that." on every open (BUG-1), the 403 page offers "Go to my work" to a person who cannot open it (BUG-4), the Edit dialog scrolls sideways at 375 (BUG-3).

### Top 10 findings, ranked by impact over effort

| # | Recommendation | Evidence | Effort | Findings |
|---|---|---|---|---|
| 1 | **Reuse the Clients record header** (`mf-record-header`, #253/#255/#254): crumb with truncated last-but-one crumb, `ref  name` on one line at the 22 px token, name clamped to 2 lines with a tooltip, action rule Edit, Activity, **primary action** and overflow. Reclaims 60 to 230 px at 1366, 500 px on a phone. | `task-long-1366x768` (Workflow at y 519), `task-long-full-375x812` (y 1230), `mock-task-header` | 6 h (on top of #253) | H1, H3, H5, H6 |
| 2 | **Say each fact once:** a one-row facts strip (Status, Priority, Due, Assignee, Pod, Workflow progress) replaces the 3-line meta block; Type and Pod leave the Details panel; Matter and Client become one muted context line. | Type shown 3 times, Pod 2 times, Due 2 times on `task-overdue-1366x768` | 4 h | H2 |
| 3 | **Narrow layout: Workflow first, Details as a closed disclosure with a one-line summary** (tablets as well as phones), and a visible "Jump to" row at every width. | 768: Workflow at y 1519 of 2669 (`task-overdue-full-768x1024`), `mock-task-tablet` | 6 h | L1, L3 |
| 4 | **One status note instead of three banners**, with who and when (Completed on, Hold reason with the shared hold-note, Cancelled by). | `task-cancelled-1366x768` (190 px of banners), `task-onhold-full-1366x768`, `task-completed-1366x768` | 4 h | B1, B2 |
| 5 | **Complete only when it can succeed, and as the header primary action**; Cancel separated and last in the menu; dialog wording ("Keep task" vs "Cancel"); "Assign to me" in the assignee menu. | `status-menu-in-progress`, `dialog-complete-blocked`, `assignee-menu` | 6.5 h | M1 to M4, H3 |
| 6 | **Edit dialog: sticky Save footer, title as a growing textarea with a counter, no sideways scroll at 375.** | `edit-dialog-bottom-1366x768` (Save at y 2544), `edit-dialog-long-375x812` | 4 h | E1, BUG-3 |
| 7 | **Honest states and permissions:** skeleton for the page (reuse #247), the shared 404/403/5xx wording (reuse #246), no toast for a Task.View-only user, no dead-end link. | `state-loading`, `state-403-no-task-view`, `role-view-only` | 5 h | S1 to S3, BUG-1, BUG-4 |
| 8 | **Activity and Comments at scale:** excerpt in "Comment added", Month-day dates, clamped drawer title, grouped runs ("48 comments added"), composer first on long threads. | `activity-drawer-long-1366x768`, `comments-open-48-1366x768` | 6 h | A1, A2, C1 |
| 9 | **Side panel without the nested scroller:** Request details becomes a collapsible section, long Description clamps with "Show more", the Details heading row loses its empty pencil line. | `scrolled-600-1366x768` (page and panel scroll separately), `task-long-full-1366x768` | 5 h | L2, D1 to D3 |
| 10 | **Drill-in and keyboard:** `from=` for Matter, Project, Dashboard and Search, document title truncated, the target-size defect on the wrapped crumb, tab order Details after Assets (49 stops), a Complete/Hold/Assign shortcut decision. | `drill-from-matter-1366x768`, axe `target-size` | 5 h | X1 to X3, K1 to K3, BUG-2 |

Total proposed: **72 agent-hours in 10 work packages** (section 6), 37 of them independent of the Clients epic.

---

## 2. Findings by section

### 2.1 Header (title, ref, status, priority, due, assignee, matter, actions)

Screens: `task-overdue-1366x768`, `task-long-1366x768`, `task-long-1920x1080`, `task-long-375x812`, `task-asap-1366x768`, `task-unassigned-1366x768`, `task-short-1366x768`, `mock-task-header`.

**What works.** Status, priority and assignee are one click away and are the same inline menus as in the work grids (`mf-row-edit`), with accessible names ("In Progress, change status of TSK-124"); non-colour cues (icon plus word) for status, priority, ASAP and overdue; the due text is the shared eight-state `mf-due-cell`; the task type icon is present; the matter ref links only with `Matter.View` and has a copy button; the View-only line explains why nothing is editable; `Back to <list>` and a crumb that names the list the person came from (Task Queue, My Work, Pod Work).

**H1 (major, S, 3 h on top of #253): the title and crumb are not the shared header.** The H1 is 28 px (token `--mf-fs-h1`) with a 28 px mono ref on its own line when long; Matter and Task Queue use 22 px (measured: 28/35 px vs 22/28.6 px). The breadcrumb shows the full matter name: for the 205-character matter it is 3 lines (y 89 to 137) and the title 3 more, so the header is **452 px at 1366, 367 at 1920, 605 at 768 and 1016 at 375** (typical task: 223, 208, 365, 484). The Workflow, the actual work, starts at y 519 (long task) and 235 (typical) at 1366.
Recommendation: build the header on `mf-record-header` from Clients WP3 (#253): crumb last-but-one segment truncated to one line with the full text in `title`, `TSK-123  title` at 22 px with a 2-line clamp and the full title as tooltip, no separate mono line. **This is the one place the Task page must reuse the Clients component rather than copy it**; WP-T2 starts when #253 is merged. See `mock-task-header` (after: about 175 px for the 200-character case).

**H2 (major, M, 4 h): the same facts are shown two or three times.** The header meta block has Type, Due, Pod, Assignee, Matter, Workflow (3 rows at 1366, wrapping unpredictably); Details repeats Type ("Task type"), Pod, Due (twice: the cell plus a full timestamp); the Workflow section repeats the workflow name and version. `Search and Culling` appears 3 times and `Demo Processing Pod` twice on one screen.
Recommendation: a single-row **facts strip** under the title, same visual family as `mf-work-strip` (tile, label above, value below): Status (menu), Priority (menu), Due, Assignee (menu), Pod, Workflow progress "2 of 3". The context line (muted, one line, clamps) carries `Matter ref name . Client number name . Type . Workflow name vX (ordered)` with links gated by `Matter.View` / `Client.View` (the same rule as #253). Remove Type and Pod from Details (keep Project, Requestor, Created). At 768 the strip wraps to two rows of three; at 375 it is a 2x3 grid. Clients decided the Overview strip is `mf-work-strip` in link mode (#260); this strip is **not** counts, so extend the same CSS, not the component, and keep one tile look.

**H3 (major, S, 3 h): the primary action is not in the header.** The Clients PM decision is: header = Edit, Activity, the primary action and an overflow. Here "Complete task" lives inside the Workflow section with a 2-line helper ("1 step is not completed. You will be asked..."), "Cancel task" and "Complete" are in the status menu, "Reopen task" is in a banner and the Edit/Activity buttons sit alone at the right.
Recommendation: header actions = **Edit**, **Activity**, primary **Complete task** (open tasks; **Reopen** primary on a closed task), overflow `...` with Put on hold / Resume, Cancel task (danger, last), Copy link. The status chip keeps its menu for transitions. The helper text becomes the button's tooltip and the first line of the Complete dialog. Closed tasks with no edit rights show Activity only (as today).

**H4 (minor, S): context.** The page header has no **Client** at all (only the matter); a user working a matter named "Second Request Response" cannot tell the client without opening the matter. Covered by H2's context line.

**H5 (minor, S, 1 h): long values.** The matter name is not clamped in the meta block (2 lines at 1366, 11 lines at 375: `task-long-375x812`); the 200-character title takes 3 lines at 28 px at 1366 and 8 at 375. Covered by H1 and H2 (clamp 2 lines each, tooltips).

**H6 (nit, S, 0.5 h): the sensitive banner** (44 px, full width) follows Clients #256: a single 32 px line; reuse it.

**H7 (nit, S, 0.5 h): alignment.** With a two-line Due the chips and labels sit 5 px apart (`task-overdue` y 165 vs `task-asap` y 160 for the same row), and "Assignee:" touches its menu button when open (`assignee-menu-1366x768`). Fixed by the strip.

### 2.2 Status, priority and assignee menus; Hold, Complete, Cancel, Reopen dialogs

Screens: `status-menu-in-progress`, `status-menu-completed`, `priority-menu`, `assignee-menu`, `dialog-hold`, `dialog-hold-empty-error`, `dialog-cancel`, `dialog-complete-blocked`, `dialog-complete-task-button`, `dialog-reopen`.

**What works.** The menu lists only valid transitions; the Hold and Cancel dialogs require a reason and say what happens ("Workflow steps can't be changed while it is on hold", "You can reopen it later"); the inline error is linked with `aria-describedby`; Cancel task is the red button; Keep task is the safe label; the assignee menu is searchable, marks the current person and shows "Out of office until Oct 24"; Esc closes and returns focus (verified).

**M1 (minor, S, 1.5 h): the status menu.** Each item has a second, grey label that repeats the first ("Put on hold  On Hold", "Complete  Completed", "Cancel task  Cancelled"), Cancel sits directly under Complete with no separation, and the same Complete exists as a button in the Workflow. Recommendation: one label each ("Put on hold", "Complete", "Reopen"), a divider and the danger style before "Cancel task", at the end. Status labels are tenant-renamable, so keep the target status as the tooltip.

**M2 (major, M, 2.5 h): Complete is offered when it cannot work.** On TSK-124 every step needs inputs, so Complete (menu or button) opens "Steps need information first" (`dialog-complete-blocked`). The dialog is clear and links to each step, but it is a dead end by design for most starter workflows. Same finding as My Work A6.
Recommendation: when the readiness check (already computed for the dialog, `blocked()` in `task-action-dialogs.ts`) says not ready, the primary button reads **Complete task** with a tooltip and `aria-describedby` "3 steps need information", and clicking opens the dialog as today; additionally, the first blocked step gets the "Current step" focus. If ready, one click to the confirm dialog. No API change; the data is in the task.

**M3 (minor, S, 1 h): dialog wording.** The Hold dialog's buttons are "Cancel" and "Put on hold" while the page also has a "Cancel task" action: say "Keep working" or "Close". The Cancel dialog's comment label is "Comment (required)" but the audit and the banner call it a reason: use "Reason" in both (My Work's hold dialog already says Reason). The Complete confirmation says "Mark all completed and finish task" (long, 6 words): "Complete all steps and finish". The Reopen dialog says "No reason is needed" correctly.

**M4 (minor, S, 1.5 h): "Assign to me".** Decision U gave every work list "Assign to me" as the first item of the Assignee menu; the Task page menu (same `mf-row-edit`) has no such item and the person has to search for their own name (`assignee-menu-1366x768`). Add it (permission-gated as in the lists) and show the Pod's open-load hint the spec (`mf-assignee-picker`) asks for.

### 2.3 Banners and closed, On Hold, Cancelled and overdue tasks

Screens: `task-onhold-full-1366x768`, `task-cancelled-1366x768`, `task-completed-1366x768`, `task-completed-full-1366x768`, `task-asap-1366x768`.

**What works.** A closed task is read-only with a clear reopen path; the Hold and Cancel reasons are shown with the author; the matter-inactive case disables Reopen with the reason; overdue is red text plus an icon plus a word; ASAP has the bolt.

**B1 (major, S, 3 h): three banners say one thing.**
- Cancelled (`task-cancelled`): "This task is Cancelled. Reopen it to edit. Reopen task" (45 px), "Cancelled by KE\kekim: Duplicate of..." (85 px), then inside the Workflow "This task is Cancelled. Reopen the task to work on its steps." (45 px): **about 190 px of amber before the first step**.
- Completed: two banners with the same first sentence.
- On Hold (`task-onhold-full`): the reason banner is 140 px for a 3-sentence reason, then "This task is On Hold. Resume it before working on its steps." in the Workflow, then again at the foot of step 1.
Recommendation: **one status note** under the header, 1 or 2 lines: `Cancelled by KE\kekim, Oct 18, 4:03 PM: Duplicate of an earlier request.  [Reopen task]` / `On hold since Oct 18 by KE\kekim: Waiting for the custodian... [Resume]`. Long reasons clamp to 2 lines with "Show more" (reuse `shared/work-queue/hold-note.ts`, the work lists' hold note) and are always complete in the tooltip and in Activity. Delete the two Workflow banners and the step footer line, keep one disabled-state sentence on the step buttons' tooltip. Saves 100 to 140 px.

**B2 (minor, S, 1 h): closed tasks do not say when they were closed.** Details shows Created and Last updated only; `completedAtUtc` and `statusChangedAtUtc` exist on the task. A Completed task shows "Due: -" in the header with no date of completion (the Task Queue's Closed column shows it). Show "Completed Oct 18, 4:03 PM by Test User 01" in the status note (B1), and for a closed task keep the original due as "Was due Oct 14" instead of "-" when there was one.

### 2.4 Layout: `mf-detail-layout`, side panel, sections

Screens: `task-overdue-full-1366x768`, `task-overdue-full-768x1024`, `task-long-full-375x812`, `scrolled-600-1366x768`, `comments-open-48-1366x768`, `task-overdue-1920x1080`, `mock-task-tablet`.

**What works.** From 1100 px the two columns work, the splitter is keyboard-operable (`role=separator`, remembered per user, reset by double click), the page scrolls without a trap in the main column, and at 1920 the layout fills well (`task-overdue-1920x1080`). Section state (Comments, Assets open or closed) is remembered. No horizontal page scroll at any width. The page is a normal scrolling page (979 to 1600 px at 1366), not the Clients fixed-height tab pattern; that is right for a long stepper, so **I do not recommend moving the Task page to the fixed-height pattern** and the single page (no tabs, UAT-S10-2) stays.

**L1 (major, M, 3 h): below 1100 px the least-used content is first.** The Details panel renders above the Workflow and starts open on tablets: at 768x1024 the Workflow heading is at y 1519 (page 2669; `task-overdue-full-768x1024`), at 768 with the long task y 2335; at 375 the panel starts collapsed and the Workflow is at y 609 (typical) to 1230 (long). On a tablet the person scrolls 1.5 screens to reach the thing they came for.
Recommendation (mock: `mock-task-tablet`): below 1100 px the order is header, facts strip, **Workflow**, Comments, Assets, **Details** (or Details directly under the facts strip but **closed**, with a one-line summary `Requestor Dana W-M. . 14 request fields`). Make the disclosure start closed at every width below 1100, not only on phones. This also removes the need for a Jump-to row to reach the Workflow.

**L2 (minor, M, 2.5 h): a second scrollbar.** The aside is `position: sticky` with its own scroll (client 674 px of 1110 at 1366): wheel over it scrolls the panel and not the page, and the bottom of the request form is hidden behind it (`scrolled-600-1366x768`, `task-long-full-1366x768`: "Custodian 5" is cut off). Nothing says there is more. Recommendation: keep it sticky but cap by content, not by scroll: Request details becomes a collapsible section (D2), Description clamps (D3), so the panel fits in the window in the common case; when it still does not, show the bottom fade used by `mf-tabs` (WP11) as the scroll cue.

**L3 (major, M, 3 h): Comments and Assets are far away and invisible from 1100 px.** "Jump to" is hidden from 1100 px ("everything is in view"). At 1366 with the first step expanded Comments starts at y 1509 of 2269 (`comments-open-48`); a person with 48 comments has no hint and no shortcut. Recommendation: show the section row at all widths as a small sticky nav in the main column: `Workflow 2/3 . Comments 48 . Assets 0` with counts, active section highlighted (scroll-spy); it is the same information the collapsed section headers show ("Comments (48) Latest: KE\kekim ..."), so keep those headers too. This is the tab pattern's affordance without turning the page into tabs.

**L4 (minor, S): splitter and widths.** The splitter works but has no visible affordance (a 4 px grey handle at y 560 to 600); at 1920 the Details panel stays 40 percent (about 650 px) with a lot of empty space inside; acceptable. No change recommended beyond using the same handle style the Clients records use if one is introduced.

### 2.5 Workflow section (stepper)

Screens: `task-overdue-full-1366x768`, `task-long-full-1366x768`, `task-onhold-full-1366x768`.

**What works.** Only the current step is expanded and the others are one-line summaries; "Current step" and "Required" tags; completed steps are green with the date; locked steps say why ("Locked. Complete or skip step 1 first."); the instructions block, inputs and four step buttons are clear; required inputs are marked in text.

**W1 (minor, S, 2 h): the section head is tall.** Heading, workflow name and version, mode sentence, "Resolved 2 of 3" with a bar, the Complete button with 2 lines of helper text, and a Show All/Unresolved filter take 130 to 160 px before step 1. After H2 and H3 the name, mode and progress are in the strip and the Complete button is in the header, so this becomes: heading, mode sentence (one line), Show filter on the right. For workflows with 3 steps the filter is noise: show it only from 6 steps.

**W2 (nit, S, 0.5 h): the step title wraps under the number** when the row is narrow and the step is completed (`task-long-full-1366x768`: "2." alone on a line, the title below, date and badge on the right). See BUG-7.

### 2.6 Details panel and the request form

Screens: `task-overdue-1366x768`, `task-overdue-full-768x1024`, `task-long-full-1366x768`, `role-view-only-1366x768`.

**What works.** Read view is a clean description list; email is a mailto link; the request form is rendered read-only under its own version caption; Asset references link when the viewer may see them and say "(not available)" when not; the edit pencil is an icon button with a name and tooltip.

**D1 (minor, S, 1 h): the head of the panel.** "Details" is a heading on one row and the edit pencil is alone on the next row (50 px of nothing at 1366: `task-overdue-1366x768`, y 260 to 320). Put the pencil on the heading's row. "Request details" is outdented by 12 px relative to the other sub-headings (BUG-6).

**D2 (minor, S, 2 h): the request form is up to 14 values long** and is the reason the panel needs its own scroll. Make it a collapsible section "Request details (Search and Culling, form 1) 14 fields", open by default only when it has 6 or fewer fields, state remembered per task type and person (the `section-state` helper exists for Comments/Assets).

**D3 (minor, S, 2 h): long descriptions are unclamped.** The 6-paragraph description with a list fills the panel (`task-long-full-1366x768`, 700 px). Clamp to about 12 lines with "Show more" (rich text is sanitized, so clamping by height is safe); the full text stays one click away.

### 2.7 Comments and Assets

Screens: `comments-open-48-1366x768`, `comments-open-48-full-1366x768`, `assets-open-1366x768`, `assets-link-dialog-1366x768`, `task-long-full-375x812`.

**What works.** Collapsed headers carry a count and the latest comment ("Comments (48) Latest: KE\kekim, just now: Upda..."), an "Add comment" action in the header, search, sort, Show latest N, edit/delete only for your own, the 70-character unbroken word wraps inside the card, asset links respect the matter and the viewer's rights.

**C1 (minor, S, 1.5 h): long threads.** With 48 comments the default is "Oldest first" with "Show latest 3" (the latest three in oldest-first order, so the newest is at the bottom, correct), but the composer is **below** the list, so on a thread you open to reply you scroll past the list and the "Show all" link. Put the composer first when there are more than 5 comments (or sticky at the bottom of the panel), and make the "Show latest" control a text ("Showing latest 3 of 48. Show all") rather than a select next to a second select. Comment timestamps all say "Oct 18, 2026, 4:03 PM EDT" with the zone: correct by addendum M for comments.

**C2 (nit): Assets.** Fine; "Link asset" opens a picker restricted to the matter's assets. No change.

### 2.8 Activity drawer

Screens: `activity-drawer-long-1366x768`, `activity-drawer-long-375x812`, `state-offline-activity-1366x768`.

**What works.** A right-side drawer that traps and returns focus, category filters (All, Status, Assignment, Fields, Workflow, Comments, Assets), "View changes" for before and after, Esc closes, `?tab=activity` opens it.

**A1 (major, M, 4 h incl. 1 h API): the timeline does not scale and does not inform.** After 48 comments the first 40 rows are "Comment added" with no text (`activity-drawer-long`), so the real events (priority, assignment, hold) are 50 rows down. Recommendation: (1) show a one-line excerpt of the comment (first 80 characters) with a link that scrolls to it; the audit event already has the comment id; (2) fold consecutive identical events from one person into "KE\kekim added 12 comments (4:03 to 4:05 PM) . Show"; (3) "Load more" stays.

**A2 (minor, S, 1 h): dates and title.** Summaries print ISO dates ("Due date changed from 2026-10-15 to 2026-10-14", BUG-5) while the rest of the app uses "Oct 14, 2026"; the drawer title repeats the whole 200-character title (5 lines at 1366, 5 at 375, 108 px). Clamp the title to 2 lines with a tooltip (`TSK-123 Process and load the supplemental...`).

### 2.9 Edit dialog

Screens: `edit-dialog-long-1366x768`, `edit-dialog-bottom-1366x768`, `edit-dialog-long-768x1024`, `edit-dialog-long-375x812`.

**What works.** Header Edit and the panel pencil open the same dialog; focus returns to the opener; Esc is ignored with unsaved changes; server errors map to fields; immutable fields are shown with a lock and the reason; the request form is edited against the form version of the task; the rich-text editor handles tables.

**E1 (major, M, 3.5 h): the dialog is a very long form with Save at the end.** Content height 2489 px in a 626 px viewport (TSK-124, 14 form fields); **Save changes is at y 2544**, reachable only after scrolling everything; a validation error in the middle leaves the Save button off screen. The Title is a one-line input: a 200-character title shows only its tail (`edit-dialog-long-1366x768`: "...Slack exports, shared network drives and the legacy archive restore"), with no counter for the 200 limit. Recommendation: footer (Save changes, Cancel) fixed at the bottom of the dialog; title as an auto-growing textarea (2 lines, grows to 4) with "142 / 200"; group the form as the page does (Task, Request details, Assignment) with the same collapsible request section as D2 so the dialog opens short.

**E2 (minor, S): at 375 the dialog fills the width but scrolls sideways** (BUG-3).

### 2.10 Create task (`/tasks/new`)

Screens: `create-task-full-1366x768`, `create-task-form-full-1366x768`, `create-task-errors-full-1366x768`, `create-task-full-375x812`, `create-task-form-full-375x812`.

**What works.** A two-step flow (choose a task type from searchable cards, then the form) with "Change type", a "Fill from email" quick path, an error summary at the top plus field errors, "Create and add another", a sticky action bar, a Summary card that names what cannot change later, 0 axe violations at 1366, 768 and 375.

**CT1 (minor, M, 4 h): it does not share the Task page's layout or tokens.** It does not use `mf-detail-layout` or the header: the H1 is a "+ Create task" 28 px line with a bare 2-item crumb (no Matter context), the form is a 475 px column in a 1100 px page with inputs of five different widths (316 to 370 px), the Summary is a separate floating card and the cards of the task-type chooser clamp descriptions mid-word ("Add 6..."). Recommendation: the form column at the page's reading width (about 720 px) and one input width rule, the **record header** (#253) with title `Create task` and the chosen type as the context line, the Summary as the same facts strip shape (Matter, Type, Workflow), chooser cards at 3 per row on 1366 (they are 5 per row and clamp text). The Create page was **not** mentioned in the Clients epic: it is in scope here only for the header and layout, not for the form engine.

### 2.11 Empty, loading, error, 403, 404 states

Screens: `state-loading`, `state-404`, `state-bad-id`, `state-500`, `state-403-no-task-view`, `state-offline-activity`.

**What works.** 404 has its own message and a way out; 5xx has a reference and a Retry; the 500 state keeps the nav; the sections have empty texts ("No comments yet", "No linked assets").

**S1 (minor, S, 1.5 h): the loading state is a dashed box** with "Loading the task..." and no header (`state-loading`), then the whole page appears: the same defect as Clients BUG-2, which #247 solves for client, matter and project with `mf-record-skeleton`. Add `kind: task` (crumb from the route, title bar, strip, two columns). Reuse #247.

**S2 (minor, S, 1 h): wording.** 404 "We couldn't find that task. It may have been removed, or the link may be wrong." is fine; `/tasks/abc` shows the same text (fine). The failure message and the 403 should be the same shared component as #246 (record state: 404, 403, 5xx with reference), so a fix to the wording happens once. The browser title stays "Task - MatterFlow" on every error (BUG-9, nit).

**S3 (minor, S, 1.5 h): 403.** A user with no `Task.View` hits the route guard's generic page "You don't have permission to view this task" (`state-403-no-task-view`) with "Go to my work", but the same user's navigation has only Clients and Matters (BUG-4). Link to the first page the person can open (the landing rule).

**S4 (nit): offline.** Opening Activity offline shows both an inline "Something went wrong. Try again." with Retry and an identical toast (BUG-8).

### 2.12 Responsive: phone (375), tablet (768), 1366, 1920

| Width | Typical task (TSK-124) | Long task (TSK-123) | Notes |
|---|---|---|---|
| 1920x1080 | header 208 px, Workflow at y 220, page 1231 | header 367, Workflow y 434, page 1481 | layout fine; Details 40 percent |
| 1366x768 | header 223, Workflow y 235, page 1301 | header 452, Workflow y 519 | header is 29 to 59 percent of the screen |
| 768x1024 | header 365, **Workflow y 1519**, page 2669 | header 605, **Workflow y 2335**, page 3499 | Details above the Workflow (L1) |
| 375x812 | header 484, Workflow y 609, page 2105 | header 1016, Workflow y 1230, page 2709 | nav bar, 8-line title, matter name 11 lines |

No page-level horizontal scroll at any of the four sizes; targets are at least 24 px except BUG-2. Phone specifics: the facts block is a stack of 6 lines (`task-long-full-375x812`); Edit and Activity are a pair at the right with no primary action; the 56 px nav rail is already a Menu button (My Work #164). After H1 to H3 and L1 the phone header is crumb "Back to Task Queue", title (2 lines), one primary button and the overflow, then a 2x3 facts grid; target about 300 px and Workflow at y 360. The Edit dialog scrolls sideways (BUG-3).

### 2.13 Drill-in, entry points and keyboard on the page

Screens: `drill-from-queue`, `drill-from-mywork`, `drill-from-dashboard`, `drill-from-matter`, `kb-focus-sample`, `kb-question-mark`.

**What works.** From Task Queue and My Work the address carries `?from=` and the page shows "Back to Task Queue / My Work", the crumb names the list, the navigation keeps the list lit and Back restores focus to the row's link.

**X1 (minor, S, 2 h): the other entry points lose the context.** From a Matter's Tasks tab (`/tasks/121`), a Project's Tasks tab, the Dashboard lists and Search the task opens with no `from`: the crumb is "Tasks", there is no Back link and Task Queue is highlighted. Add `from=matter`, `from=project`, `from=dashboard`, `from=search` to the whitelist (`shared/work-queue/drill.ts`) with the exact return URL in history state. Decision T said the Dashboard lists were "unchanged"; this reverses that for the Task page only and needs the PM's nod.

**X2 (nit, S, 1 h): two ways back.** "Back to Task Queue" and the first crumb "Task Queue" are the same link on two lines. With the record header (#253/#254 phones: crumb becomes "Back to ...") keep one.

**X3 (minor, S, 1 h): the document title** is `TSK-n <full title> - MatterFlow` (BUG-9); use the first 60 characters and the section when a drawer is open.

---

## 3. Cross-cutting consistency

1. **Header.** Three shapes now exist: Task (28 px, full crumb, meta block), Matter/Client/Project (22 px, one-line title coming in #253) and lists (22 px page title). The Task header must be `mf-record-header` with a different data set, not a fourth component. **Flagged dependency: WP-T2 reuses Clients #253, #255, #254 and #256.**
2. **Action rule.** Clients: Edit, Activity, primary, overflow. Task today: Edit, Activity in the header, primary in the Workflow, destructive in a menu. Apply the same rule (H3). Create actions: the Task page has none (Create task is global in the top bar).
3. **Summary strip.** Clients/My Work/Pod Work use `mf-work-strip` (counts that filter). A task has facts, not counts, so use the same tile and spacing tokens in a sibling look (H2); do not extend the component's API (it is being changed in #260).
4. **Tokens.** The Task header uses `--mf-fs-h1` where records use `--mf-fs-h2`; spacing and radius are tokens; no new tokens are needed (the facts strip reuses `--mf-border`, `--mf-radius-lg`, `--mf-s*`).
5. **Colour language** (decision T): left stripe means overdue in grids, On Hold is grey with a pause icon (verified in the header chip, `task-onhold`), ASAP is the only blue. The Task page follows it. The Hold banner is amber while the chip is grey, which is the one mismatch; the unified status note (B1) uses neutral surface plus the grey pause icon.
6. **Due cell.** Header and Details use the shared `mf-due-cell` (two-line layout): the Details panel repeats it plus a full timestamp; keep the timestamp only in the tooltip.
7. **Drill-in.** `from=` exists for Task Queue, My Work and Pod Work, with focus restored on Back (verified: focus lands on the row's link). Matter Tasks tab, Project Tasks tab, Dashboard lists and Search open the task without `from` (`drill-from-matter`, `drill-from-dashboard`): crumb "Tasks", no Back link, Task Queue lit in the navigation. See X1.
8. **Copy.** "Put on hold" / "Cancel task" / "Reopen task" / "Complete task" are the same words as the lists. Fix: "Cancel" in the Hold dialog (M3), "Comment" vs "Reason".
9. **States.** Reuse #246/#247 for record states and skeleton.
10. **Theme.** None (no dark theme exists), so nothing to review.

---

## 4. Bug list (with repro)

Environment: `origin/dev` `a99570e`, Playwright Chromium, Dev auth, `America/New_York`. IDs refer to the seed above.

| ID | Sev | Bug | Repro | Expected |
|---|---|---|---|---|
| BUG-1 | major | **A user with Task.View but no Asset.View gets a red toast "You don't have permission to do that." every time a task with an Asset reference in its request form opens** (`GET /api/v1/assets/1` returns 403 and the global handler toasts). The panel itself shows "Asset 1 (not available)" correctly. | `KE\viewonly` opens `/tasks/124` (`role-view-only-1366x768`). | No toast for a lookup the UI already handles; or do not call the endpoint without `Asset.View`. |
| BUG-2 | major | **axe `target-size` (serious, WCAG 2.5.8 AA): the "Tasks" crumb is smaller than 24x24 CSS px when the crumb wraps** (long matter name; the link is inline in a wrapped line). 0 violations on the other scans, so it only shows with long matter names. | `/tasks/123` at 1366, 768 or 375, run axe. Also on the Activity drawer and Comments scans of the same task. | Crumb links keep the 24 px target (inline-flex with min-height, as the `.jump` links do) and truncate to one line (H1). |
| BUG-3 | major | **The Edit dialog scrolls sideways at 375:** the dialog body is wider than the dialog (scrollWidth 420 to 436 px in 354), the first labels are cut off ("(required)", "ption") and the Description toolbar loses its Bold button. | `/tasks/123` or `/tasks/124` at 375x812, Edit (`edit-dialog-long-375x812`). | `min-width: 0` on the form column; no horizontal scroll inside the dialog. |
| BUG-4 | minor | **The 403 page offers "Go to my work" to a person who has no My Work.** | `KE\notask` opens `/tasks/124`; the nav has only Clients and Matters (`state-403-no-task-view`). | Link to the first page the person can open (landing rule), or no link. |
| BUG-5 | minor | **Activity summaries print ISO dates** ("Due date changed from 2026-10-15 to 2026-10-14"); every other date is "Oct 14, 2026" (addendum M). | Activity drawer of TSK-123 (`activity-drawer-long-1366x768`). | Local-format dates in summaries (server summary or client formatting). |
| BUG-6 | nit | **"Request details" heading is 12 px left of the rest of the panel** (x 913 vs 925 at 1366, 63 vs 72 at 768). | Any task with a request form (`task-overdue-1366x768`). | Same left edge as the other sub-headings. |
| BUG-7 | nit | **A completed step's number wraps on its own line** ("2." then the title below) at 1366 with the 60/40 split. | TSK-123, step 2 (`task-long-full-1366x768`). | Number and title on one line; date and badge wrap instead. |
| BUG-8 | nit | **Failed Activity load shows the same message twice** (inline with Retry and a toast). | Go offline, open Activity (`state-offline-activity-1366x768`). | One message. |
| BUG-9 | nit | **Document title is the full 200-character title plus the app name; error states keep "Task - MatterFlow".** | `/tasks/123` browser tab; `/tasks/99999`. | Truncate at about 60 characters; "Task not found". |

Verified and **no defect found**: all tabbing, Esc and focus-return of menus and dialogs; the Hold and Cancel dialogs refuse an empty reason; Reopen needs no reason; inline priority change stays on the page; the page never scrolls sideways at 375, 768, 1366 or 1920; Back to Task Queue and My Work restores focus to the row; `?tab=activity`, `?tab=comments` and `?step=` links work; the Complete dialog lists the blocked steps; View-only hides every edit control.

---

## 5. Keyboard, focus and accessibility basics

- **Axe:** 0 violations (WCAG 2.2 AA plus best-practice) on 27 of 32 scans: TSK-124, 123, 127, 128, 126, 129 at 1366, 1920, 768, 375 (24 scans), Activity drawer, Comments open, a View-only user, Create task chooser at 1366, 768, 375 and the Create form at 1366 and 375. The five failures are all BUG-2 (long task at 1366, 768, 375, plus its drawer and comments scans). The Edit dialog scan did not run (a locator error in my script; the dialog was inspected by hand).
- **Tab order.** Skip link first (works), then 19 stops of the shell (top bar 5, navigation 14 for a System Admin), then the crumb (20), Edit, Activity, the three inline menus, the matter link and copy button, Complete task, the step controls, Comments, Assets, the splitter (48), the **Details pencil (49)** and the request form links (50, 51). Details are last in the DOM from 1100 px: someone who tabs to edit the requestor passes the whole stepper first. With the facts strip and header primary action: Edit, Activity, Complete, overflow, three menus, matter link; Details pencil moves into the header's Edit (already the same dialog), so the pencil can be dropped from the panel on narrow widths (K1).
- **Focus ring:** the 2 px amber ring is visible on buttons, menus, the splitter and the title input in the dialog.
- **Names and roles:** status, priority and assignee buttons name the task; the splitter is `role=separator` with `aria-valuenow`; dialogs have titles; steps are disclosure buttons with `aria-expanded`; the sections have headings. Not verified with a real screen reader.
- **Shortcuts.** The global list opens with `?` (Ctrl+K search, G then M/T/P, Esc, arrows, Home/End in tabs; per-user on/off switch, WCAG 2.1.4). **There are no Task-page shortcuts**: no status change, assign to me or comment. **K2 (decision for the PM, 2 h):** `C` focuses the comment composer, `A` opens the assignee menu, `S` opens the status menu, only when focus is not in a field, covered by the same on/off switch and the same help list. Recommended, behind the existing switch, but optional.
- **K3 (minor, 1 h):** after Complete, Hold or Reopen the focus returns to the status chip (verified for dialogs); after the page's "Reopen task" banner button disappears, focus is lost to `<body>`: move it to the status chip or the Complete button.
- **Document title and live regions:** the title changes with the task; the success toasts (assigned, priority changed) are `role=status`; the "Resolved n of m" count has no live region when a step is completed (the stepper moves focus to the next step, which is the right cue).

---

## 6. Proposed epic, work packages and order

Proposed epic: **Task Detail UX** (label `epic` + `phase-8`), 10 packages, 72 agent-hours. Estimates include tests, axe at four widths and screenshots.

| WP | Package | Contents | Findings | Est. | Depends on |
|---|---|---|---|---|---|
| WP-T1 | **Bugs and states** | view-only toast, 403 link, ISO dates, heading outdent, step wrap, duplicate offline message, document title; page skeleton (`kind: task`), shared 404/403/5xx component | BUG-1, 4 to 9, S1 to S4 | 8 h | Clients #246, #247 (reuse components; if not merged, build the Task variant first and swap) |
| WP-T2 | **Record header and facts strip** | `mf-record-header` for Task (crumb, 22 px title, 2-line clamp, context line with Matter and Client, Sensitive one-liner), facts strip, primary action Complete or Reopen, overflow (Hold/Resume, Cancel, Copy link), phone header | H1 to H7, H3, BUG-2 | 12 h | **Clients #253, #255, #254, #256 (WP3)** |
| WP-T3 | **One status note** | closed, hold and cancel banners merged, shared hold-note, completed on/by, "was due" | B1, B2 | 4 h | WP-T2 (placement); can start before |
| WP-T4 | **Menus and dialogs** | status menu labels and order, Complete readiness hint, dialog wording, "Assign to me" and load hint in the assignee menu | M1 to M4 | 6.5 h | - |
| WP-T5 | **Layout** | narrow order (Workflow first, Details closed disclosure), sticky section nav with counts at every width, panel scroll cue | L1 to L3 | 8.5 h | #279 `mf-tabs` cue pattern (done, WP11) |
| WP-T6 | **Workflow head and Details panel** | section head after H2/H3, Show filter threshold, Details heading row, Request details collapsible, Description clamp | W1, W2, D1 to D3 | 7 h | WP-T2 (strip), WP-T3 |
| WP-T7 | **Comments, Assets and Activity at scale** | composer first on long threads, "Showing latest 3 of 48", excerpt and grouping in Activity (API: excerpt in the event), clamped drawer title | C1, A1, A2 | 6 h | - (API field additive) |
| WP-T8 | **Edit dialog and Create page** | sticky footer, title textarea with counter, grouped sections, sideways fix, Create page header and layout | E1, E2, BUG-3, CT1 | 7.5 h | WP-T2 (header), #253 |
| WP-T9 | **Drill-in and keyboard** | `from=` for Matter, Project, Dashboard, Search; Details pencil dropped where the header Edit exists; focus after Reopen; optional Task shortcuts | X1 to X3, K1 to K3 | 5 h | Clients #281 (focus on Back) done in parallel |
| WP-T10 | **Docs and final verification** | ux-spec S10 and UAT rows, decisions addendum (next section letter after Clients' V), e2e for the above, axe at four widths on six task states, screenshots | all | 7 h | all code |

Total **72 h**. Independent of the Clients epic (can start now): WP-T1 (8, the components can be built first), WP-T4 (6.5), WP-T5 (8.5), WP-T7 (6), WP-T9 (5), WP-T10 part (3): about 37 h. Dependent on Clients WP3: WP-T2 (12), WP-T3 (4), WP-T6 (7), WP-T8 (7.5).

**Suggested order.** (1) WP-T1 and WP-T4 and WP-T7 in parallel (separate files). (2) WP-T5 (layout, `task-detail-page.ts`, `detail-layout.ts`) while Clients WP3 lands. (3) WP-T2 immediately after #253/#255 merge, then WP-T3 and WP-T6 (both touch the header and the Workflow head). (4) WP-T8, then WP-T9, then WP-T10. Critical path with one Task agent: T1, T5, T2, T3, T6, T8, T10 = about 54 h; with two agents about 38 h wall-clock.

**Cuts, if the owner wants fewer.** The 30-hour core is WP-T2, WP-T3, WP-T5 and WP-T1 (it fixes the header, the banners, the tablet order and the bugs); WP-T4 and WP-T7 are the working-day value; WP-T8 and WP-T9 are polish.

**Conflicts with in-flight Clients work to watch.**
- `shared/ui/page-header.ts` (`mf-record-title`) and the new `mf-record-header`: Task uses them, does not edit them. The Task header currently overrides the `mfTitle` slot and the `.th__*` styles; remove those after #253.
- `shared/ui/detail-layout.ts`: Clients WP4 (#257) removes the Project side panel and **keeps `mf-detail-layout` for the Task page** (PM decision d). WP-T5 changes only the narrow-width order and the aside cap, so it must land after #257 or coordinate on `detail-layout.ts`.
- `work-strip.ts`: Clients #260 adds a link mode. The facts strip does **not** use the component, only the CSS tokens, so there is no conflict.
- `docs/ux/ux-spec.md` S10 and the addendum: the Clients WP14 (#286) writes section V; Task Detail would write the next letter.

**Product decisions needed before issues (my recommendations in brackets).**
a) Keep one page with no tabs, UAT-S10-2 [yes; add the section nav instead. Reversed later by #347: the page now has the tabs Workflow, Assets and Comments].
b) Complete task as the header's primary action, with Reopen replacing it on closed tasks [yes].
c) Comment excerpts and grouping in Activity [yes; additive API field].
d) Task-page single-key shortcuts [optional, behind the existing switch].
e) Create task adopts the record header and the 720 px form width [yes, header and width only].

---

## 7. What I did NOT verify

- A real screen reader, Windows high contrast, 200 % and 400 % zoom, print, browsers other than Chromium, a real phone or tablet (375 and 768 were emulated), dark theme (none exists).
- The Edit dialog under axe (a script error); the Resume dialog and the Reopen-step flow beyond a screenshot; attachments (none exist: addendum C); linking and removing assets beyond opening the picker.
- Concurrent edits and the conflict banner ("This task was changed by someone else"); the matter-inactive reopen block; a task whose workflow has more than 6 steps (no fixture) so the Show filter threshold in W1 is a judgement; 100+ comments; tasks with attachments to email intake (Fill from email) beyond the chooser screen.
- Timezone variants (the page was checked in `America/New_York` only; the Due cell is covered by its own spec).
- The Create task submission end to end (I only exercised the validation summary); custom form-engine controls beyond what the seeded task types use.
- Real firm data and real usage: priorities are the reviewer's judgement from the documented personas.
