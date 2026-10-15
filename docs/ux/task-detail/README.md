# Task detail: one page (main column + side panel)

The Task page (`/tasks/:id`) no longer has tabs. It uses the shared `mf-detail-layout` of the Client, Matter and Project pages, with one extension: an optional `mfAfter` slot (a further panel section that sits inside the sticky side panel from 1100 px and below the main column on narrower screens).

| Part | Behaviour |
|---|---|
| Header | Breadcrumb, ref, title, inline Status / Priority / Assignee menus, due, Pod, Matter (ref + name), workflow line, Edit, Activity (history icon), view-only notice and the existing banners. The task type icon slot is a marked TODO in `task-header.ts` (`mf-task-type-icon` is not on `dev` yet). The header is no longer sticky (it would cover the sticky side panel). |
| Main column (fluid) | WORKFLOW first: only the current step is expanded; completed, skipped, locked and future steps are one-line summaries with their status and can be opened by hand. Resolving a step folds it (focus moves to its toggle) and the next current step opens. Then COMMENTS (composer and thread; loaded when scrolled within about one screen, or when asked for by a link; older comments load on request). |
| Side panel (340 px, `aside`, sticky, own scroll) | DETAILS (description, requestor, dates, due, project, Pod, task type, request-form values, "Edit details") then ASSETS (cards with relationship select and "Remove link", "Link asset"). Without `Asset.View` a note replaces the list. |
| Edit | Header "Edit" or the panel's "Edit details" open the same form in a dialog (focus returns to the button that opened it); saving returns to the same page. Esc is ignored while the form has unsaved changes; Cancel and the X discard as before. |
| Below 1100 px | One column: Details (disclosure, collapsed on phones), Workflow, Comments, Assets, and a "Jump to" row (Workflow, Comments, Assets) that scrolls and moves focus to the section heading. No horizontal page scroll at 768 or 375. |
| Activity | A right-side drawer ("Activity: TSK-n title") with the existing task timeline (filters, View changes, Load more). Esc closes and returns focus to the button. |
| Old links | `?tab=workflow|comments|assets` scroll to the section and focus its heading; `?tab=activity` opens the drawer (parameter removed on close); `?tab=details` shows the page; `?step=<stepInstanceId>` opens and focuses that step (the blocked-completion dialog links still work). |

Screenshots (real stack: SQL Server in Docker, API with Dev auth, Chromium), a task with six steps (step 3 current), three comments and two linked assets:

- `task-1280.png`, `task-1024.png`, `task-768.png`, `task-375.png` (full page); `task-375-details-open.png`
- `task-<width>-activity.png`: drawer open
- `completed-<width>.png`: completed task (closed banner, no actions)
- `view-only-<width>.png`: a user with Task.View only
- `edit-dialog-1280.png`, `edit-dialog-375.png`: the edit form
