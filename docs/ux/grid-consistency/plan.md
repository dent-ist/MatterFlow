# Consistent lists and shell polish, phase 1: plan (epic #1037)

Branch `matter-detail` (same branch as the Matter detail epic #1001). Progress: `progress.md` in this folder. Decision: `docs/requirements/decisions-addendum.md` section AR. Review, inventory, screenshots and the anatomy mockup are on branch `grid-consistency-review` (`docs/ux/grid-consistency/`: `review.md`, `inventory.md`, `conversion-plan.md`, `anatomy-mockup.html`). This file is the phase 1 part of `conversion-plan.md`, changed by the owner decisions of 2026-11-02.

## 1. Goal

A person finds Search, Filters, Columns, sort and "+ New" in the same place, with the same names, on the pages they use most; tasks and assets show the same columns in the same order everywhere; the app shell is softer and the dark navigation panel runs the full height with the logo. The two Columns menus are NOT merged in phase 1 (same place, same name). The owner decides what comes after phase 1.

## 2. Issues and hours (agent-hours)

| Issue | Code | Title | Hours | Agent |
| --- | --- | --- | --- | --- |
| #1038 | LC-01 | Shared list page toolbar and title row component | 6.0 | E |
| #1039 | LC-02 | Adopt it on Task Queue, My Work, Pod Work, Matter Tasks, Clients, Matters, Projects, Assets | 7.0 | E |
| #1040 | LC-03 | Standard task and asset column order and names (CM Number, Progress, Disposition) | 3.0 | E |
| #1041 | LC-04 | Matter Tasks as cards on a phone | 2.0 | F |
| #1042 | LC-05 | Page size 50, Sorted by line and Reset sort, First/Last in Notifications | 1.5 | E |
| #1043 | LC-06 | "Filters", "+ New Task", admin New buttons into the header, Title Case sweep | 1.0 | E |
| #1044 | SH-01 | App shell: smaller selection radius, full-height dark navigation panel with logo | 4.0 | F |
| #1045 | LC-07 | Verify and fix: Admin Users Pods chip overlap, Matter Projects New Project button | 1.0 | E |
| (this commit) | LC-00 | Epic, issues, plan, decision AR | 2.0 | PM |
| | | **Total** | **27.5** | |

Agent E 19.5 h, Agent F 6.0 h. The review's phase 1 was 20.5 h (rows 1 to 6 of its section 4); this plan is that, plus SH-01 (4 h), LC-07 (1 h), LC-00 (2 h), minus nothing: LC-01 6 + LC-02 7 + LC-03 3 + LC-04 2 + LC-05 1.5 + LC-06 1 = 20.5.

## 3. The standard (owner decisions, short)

List page anatomy (review section 5.1), top to bottom:

```
Row 1  [icon] Title  (count chip)                              [+ New Thing]
Row 2  [Search]  [Filters (n)]  [View / quick views]  ......  [Columns] [... menu]
Row 3  active filter chips  Clear filters            Sorted by X, direction   Reset sort
Row 4  the grid (sort by header click)    (bulk bar replaces row 2 while rows are selected)
Foot   Rows per page [50]  Showing a-b of n  Page n of m  First Previous Next Last
```

- Search always visible, first in row 2 (not the global search). Filters directly after it; the word is always "Filters". Columns at the right end; Views and Export in the "..." menu.
- Sort by header click; the line "Sorted by X" with Reset sort; a Sort dropdown only on phone cards and Notes.
- Page size 25/50/100, default 50. No "Load more" on phase 1 lists.
- Task columns: Ref, Type, Title, [CM Number, Matter Name on global lists only], Project, Priority, Assignee, Due, Status, Progress.
- Asset columns: Type, Name, (CM Number on global lists), Size, Linked Tasks, External Reference, Disposition.
- Buttons from the shared theme only (guide section 9); "+ New Task", "+ New Client", "+ New Matter", "+ New Project", "+ New Asset" in Title Case in the title row.
- Phone (under 640 px): cards, Search plus Filters plus Sort, Columns hidden.

## 4. Parallel split and file ownership

Two agents, each in its own worktree under `/home/user/wt/`, each pushing only to `matter-detail` (`git pull --no-rebase origin matter-detail` before `git push origin HEAD:matter-detail`; no rebase, no force; never `dev` or `main`).

**Agent E (lists), in this order:** LC-01, LC-02, LC-03, LC-05, LC-06, LC-07.

**Agent F (shell, then phone cards):** SH-01, then LC-04.

File ownership (nobody edits a file owned by the other agent without a note in `progress.md` and a pull first):

| Owner | Files and folders |
| --- | --- |
| Agent E | `frontend/src/app/shared/ui/` new list toolbar/title/pager files (LC-01), `grid-prefs.ts`, `grid-columns.ts`, `list-query.ts`; list pages under `features/tasks`, `features/my-work`, `features/pods`, `features/clients`, `features/matters/pages/matters-list-page.ts`, `features/projects`, `features/assets`; `shared/work-queue/` (task table, `TASK_COLUMNS` registry, scoped tasks list part); `features/notifications`; admin pages for New buttons (LC-06); `docs/ux/theme-guide.md` section 11 (list anatomy) |
| Agent F | `frontend/src/app/shared/layout/` (all: `app-shell.*`, nav files and their specs), `core/branding/`, logo assets, `docs/ux/theme-guide.md` section 7 logo note, `docs/ux/app-settings`; LC-04: a new card component file for the Matter Tasks tab, plus the phone branch of `shared/work-queue/scoped-tasks.ts` only after Agent E has pushed LC-02's Matter Tasks change |
| Shared | `docs/ux/grid-consistency/progress.md` (append-only, one section per agent), e2e specs (each agent edits only the specs for its own pages; header/shell specs belong to F) |

Conflict points: (1) `scoped-tasks.ts` (LC-02 then LC-04): E pushes the Matter Tasks adoption first, F pulls before starting LC-04; F can prepare the card as a separate component meanwhile. (2) `theme-guide.md`: E edits section 11 only, F edits section 7 only. (3) e2e specs that look at the header (F) and at list buttons (E) are different files; if a spec touches both, F does the shell part after E's push.

Testing: cheap checks while building (lint, tsc, targeted unit tests, one browser check of the changed page). One full QA run (unit, e2e, axe at 1366x768, 1920x1080, 768x1024, 375x812, bundle gate) at the end for the whole package, then the owner decides on merging and on later phases.

## 5. Work per issue (short)

- **LC-01** shared `mf-list-title` and `mf-list-toolbar` (Search, Filters (n), quick-view slot, Columns slot, "..." slot, active filter chips with Clear filters, "Sorted by" line with Reset sort, bulk-bar slot, pager footer 25/50/100 with First/Previous/Next/Last and "Showing a-b of n"), phone layout, specs, theme guide.
- **LC-02** adopt on Task Queue, My Work, Pod Work, Matter Tasks, Clients, Matters, Projects, Assets. Search out of the filter row, Filters before Columns, Views/Export into "..." , title count, "+ New X". Both Columns menus stay.
- **LC-03** `TASK_COLUMNS` registry and asset column order, CM Number, Progress, Disposition; defaults only, Columns menu groups, specs/e2e.
- **LC-04** cards for Matter Tasks under 640 px.
- **LC-05** page size 50 in `list-query.ts`, "Sorted by" line and Reset sort, Notifications First/Last.
- **LC-06** "Filters" wording, "+ New Task", admin New buttons into the header (Roles, Pods, six lookups), Title Case sweep.
- **SH-01** selection radius about 6 px with 8 px side margins; panel full height with logo and app name; top bar to the right with its search aligned to the page content; phone drawer with the logo in the top bar; logo light variant.
- **LC-07** verify first (Users Pods chip over Availability at 1366 px; Matter Projects "+ New Project" for admin), fix if real.

## 6. Logo on the dark panel (decision for SH-01)

The application name is configurable in Settings and the logo is uploadable. An arbitrary uploaded image cannot be recoloured reliably, so:

1. The bundled default logo gets a white-on-navy variant (made from `docs/branding/lpt-hub-logo-a.svg`; light SVG shipped next to the dark one) and is used on the navy panel and in the collapsed panel.
2. An uploaded logo is always shown on a light tile (surface token, 6 px radius, 4 px padding) so any image stays readable, with the application name in white text next to it.
3. On a phone the logo and name stay in the white top bar and use the normal (dark) logo, so no variant is needed there.
4. The rule is written in theme guide section 7 and in `docs/ux/app-settings`; no colour literals (tokens only).

## 7. What is not in phase 1

List date format (accepted for a later phase); Audit Logs and Activities pager instead of "Load more"; retiring the older Columns chooser and merging prefs; the My Matters filter dropdown row and Urgency button; Search results, Asset reports, My Matters lists, Dashboard lists, Productions, Notes alignment; admin lists other than the New button; `mf-data-grid`. Estimated about 85 further agent-hours (conversion plan sections 2 to 4), to be decided by the owner after phase 1.

## 8. Risks

See epic #1037. In short: heavily tested pages (update e2e together with the change), two agents touching the Matter Tasks tab, the shell touching every page (short windows, print, branding specs), uploaded logos of odd shapes, two Columns menus living side by side until phase 2.
