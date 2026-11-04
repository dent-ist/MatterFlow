# UI update 2: inventory of every page, tab, dialog, drawer, popover, menu, toast and state

Author: Agent U (UI designer). Branch `ui-update-2` (from `dev` f26c324). Phase 1, built from the route tree (`frontend/src/app/app.routes.ts` and every `*.routes.ts`), the navigation (`shared/layout/nav-items.ts`), the code under `frontend/src/app` and the screenshots that already exist in the repo. Nothing was run; the live crawl is phase 2 and will add `docs/ux/ui-update/screenshots/<page>/` and replace the "existing screenshots" column with fresh ones.

How to read it
- "Roles" are the personas the QA and demo seed use: **Dir** Director, **PL** Pod Lead, **Tech** Technician, **PM** Project Manager (holds `Matter.BeManager`), **Admin** System Admin. A page needs the permission in the second column; the starter roles that hold it are an approximation, the permission catalog (`contracts/permissions.json`) is the truth.
- "Existing screenshots": `TR` = `docs/ux/theme-rollout/after/` (route sweep, structure only; sizes include phone and tablet, ignore those; taken 2026-11-01, so they pre-date the Matter detail, grid-consistency, Dashboard v4/Users/Calendar changes: use them for structure only), `GC` = `docs/ux/grid-consistency/shots/`, `MD` = `docs/ux/matter-detail/`, `DU` = `docs/ux/dashboard-users/screenshots/`, `DV4` = `docs/ux/dashboard-v4/screenshots/`, `CAL` = `docs/ux/calendar/screenshots/`, `UU` = `docs/ux/ui-update/after/` (My Matters). File names end with the size; only `-1366x768` and `-1920x1080` matter (the app is desktop-only, owner decision; the phone and tablet shots are ignored). The phase-2 crawl is desktop only, 1366x768 and 1920x1080, for the Director, Pod Lead and Technician roles.
- Epic = the page group that will get one GitHub epic in phase 2 (`Epic: UI update - <page>`). The list of epics is at the end.

## 1. Outside the shell (no navigation, no search)

| Page | Route | Roles | Sub-views and states | Dialogs, drawers, menus | Existing screenshots |
| --- | --- | --- | --- | --- | --- |
| Access pending / account disabled | `/access-pending` | a user with no effective permission | two variants (pending, disabled), `h1` with lock icon | none | `TR/access-pending-*`, `TR/route-access-pending-*` |
| Error | `/error` | everyone | one calm card, error reference id | none | `TR/error-*`, `TR/route-error-*` |

## 2. Inside the shell

The shell (`shared/layout/app-shell`): full-height navy navigation (full 220 px), white top bar with the global search, the "Create task" primary, the notification bell and the user menu. Shell popovers: user menu (`user-menu.ts`: availability, "Set out of office", sign out, dev persona switch in Development), notification bell panel (`notifications/notification-panel.ts`), global search results (`shared/search/global-search.ts`), dev auth banner (`dev-auth-banner.ts`), impersonation banner. Screenshots: `docs/ux/shell-review/`, `GC/sh01-*`, `docs/ux/impersonation/`.

| Page | Route | Roles (permission) | Tabs / sub-views | Dialogs, drawers, popovers | Existing screenshots | Epic |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard > Summary | `/dashboard?tab=summary` | Dir, PL (`Dashboard.ViewSummary`); Tech sees only the "Unassigned work" queue | needs-attention cards, task grid, capacity battery, unassigned gauge | People dialog (`dash-people`), info popover, assign-picker menu, Columns menu, Filters, scope dropdown | `DV4/after-summary-*`, `TR/route-dashboard-summary-*`, `TR/route-dashboard-tech-*` | Dashboard |
| Dashboard > Breakdowns | `?tab=breakdowns` | `Dashboard.View` + tab perm | Priority, Status, Age, Task Type cards; Bars/Pie/Table switch | none | `DV4/after-breakdowns-*`, `TR/route-dashboard-breakdowns-*` | Dashboard |
| Dashboard > Trends | `?tab=trends` | same | chart + legend, measure and period controls | chart panel | `DV4/after-trends-*`, `TR/route-dashboard-trends-*` | Dashboard |
| Dashboard > Swimlane | `?tab=swimlane` | same | lanes of task cards, lane switcher | swimlane drawer (`swimlane-drawer`, 32rem), toolbar (native selects) | `docs/ux/dashboard-swimlane/`, `TR/route-dashboard-swimlane-*` | Dashboard |
| Dashboard > Users | `?tab=users` | Dir, PL (`Dashboard.ViewUsers`) | Workload (cards / table), Coverage (By task type / Matrix), Skills | person drawer (`users-drawer`, 36rem, tabs Overview / Task types / Trend), unassigned-tasks drawer (`users-unassigned`), coverage drawer (`coverage-drawer`, 34rem), assign dialog (`users-assign`, 40rem), State multi-select dropdown, Filters/Display popover, "Who is counted" info popover | `DU/*` (187 files: us11, us12, us13), `TR/route-dashboard-users-*` | Dashboard |
| Dashboard > Calendar | `?tab=calendar` | Dir, PL (`Dashboard.ViewCalendar`) | Month, Week | day panel (docked / slide-over / bottom sheet), insights, Role dropdown | `CAL/director-*`, `CAL/podLead-*`, `CAL/cal11-*`, `CAL/technician-calendar-denied-*` | Dashboard |
| My Matters | `/my-matters` | PM (`Matter.BeManager` + `Matter.View` + `Task.View`) | Overview, Calendar, Assets, Metrics, Activity; client/matter tree | Add event dialog (`event-dialog`, 34rem), "+ New" menu (`new-menu`), tree panel / Scope sheet, asset panel, column filters | `UU/my-matters-*` (desktop sizes x 5 tabs), `UU/my-matters-event-dialog-*`, `UU/my-matters-new-menu-*`, `docs/ux/my-matters-calm/` | My Matters |
| My Work | `/my-work` | everyone with `Task.View` | views Active, Due soon, Closed, Created by me (`mf-work-tabs`) | bulk dialog (`bulk-tasks-dialog`), Columns chooser, column menu, inline edit menus, quick views | `TR/route-my-work-*`, `docs/ux/my-work/`, `docs/ux/my-work-review/` | Tasks |
| Pod Work | `/pods/work` | Dir, PL (`Pod.View` + `Task.View`) | views Unassigned, By member, All open, ... | same as My Work, Pod dropdown | `TR/route-pod-work-*`, `docs/ux/pod-work-review/` | Tasks |
| Task Queue | `/tasks` | `Task.View` | quick-view chips, standard task grid | bulk dialog, Columns chooser, views menu, export menu | `TR/route-task-queue-*`, `docs/ux/task-queue-review/` | Tasks |
| Create task | `/tasks/new` | `Task.Create` | one column form (type cards, request, due, assignee, assets) | email-intake panel, user picker, asset picker, "Create and add another" | `TR/route-task-new-*`, `docs/ux/create-task-review/` | Task page |
| Task page | `/tasks/:id` | `Task.View` | facts strip, Details panel, tabs Workflow, Assets, Comments (`mf-tabs`), Activity feed | Edit task dialog (720 px), action dialogs (complete, hold, reopen, skip step ... in `task-action-dialogs`), assign menu, due-edit popover, add-comment dialog, asset-link panel, rich-text editor link/table popovers | `TR/route-task-page-*`, `TR/task-page-*`, `docs/ux/task-detail-v3/` | Task page |
| Clients list | `/clients` | `Client.View` | list (grid) | New client (`/clients/new` page) | `TR/route-clients-*`, `docs/ux/clients-review/` | Clients |
| Client record | `/clients/:id` | `Client.View` | overview with matter list; header actions Edit, Activity, New Matter | Edit page `/clients/:id/edit`, activity drawer | `TR/route-client-record-*`, `TR/client-record-*` | Clients |
| Client new / edit | `/clients/new`, `/clients/:id/edit` | `Client.Create` / `Client.Edit` | full-page form | unsaved-changes dialog | `TR/route-client-new-*` | Clients |
| Matters list | `/matters` | `Matter.View` | list | New matter dialog (`matter-form-dialog`), Columns menu, "..." menu | `TR/route-matters-*`, `GC/*` | Matters |
| Matter record | `/matters/:id` | `Matter.View` | Summary, Tasks, Projects, Assets, Productions (and Specs), Notes (By tag / Latest / Templates), Activities | Edit matter dialog, managers dialog (`matter-managers-dialog`), event panel, project side panel (`project-panel`), project tasks panel, production panel, spec dialogs, note editor (link, table, colour menus, AI panel "coming soon"), confirm dialogs (inactive, sensitive) | `MD/*` (62), `docs/ux/matter-detail/tab-controls/*`, `TR/route-matter-record-*` | Matters |
| Matter edit (old page) | `/matters/:id/edit`, `/matters/new` | `Matter.Edit` | routed form kept for now | | `TR/route-matter-new-*` | Matters |
| Projects list | `/projects` | `Project.View` | list | project panel (create/edit side panel), tasks panel | `TR/route-projects-*` | Projects |
| Project record | `/projects/:id` | `Project.View` | details and tasks; header actions Edit, Activity, Create Task | Edit page, activity drawer, link/unlink | `TR/route-project-record-*` | Projects |
| Project new / edit | `/projects/new`, `/projects/:id/edit` | `Project.Create` / `Edit` | full-page form | | `TR/route-project-new-*` | Projects |
| Assets list | `/assets` | `Asset.View` | list | disposition dialog (`asset-disposition-dialog`) | `TR/route-assets-*`, `docs/ux/assets-screen/`, `docs/ux/assets-review/` | Assets |
| Asset record | `/assets/:id` | `Asset.View` | summary tiles (Open, Overdue, Linked, Disposition, Size, Created, Modified), Details, Linked tasks; header actions Edit, Activity, Change Disposition | disposition dialog, link dialog, activity drawer | `TR/route-asset-record-*` | Assets |
| Asset new / edit | `/assets/new`, `/assets/:id/edit` | `Asset.Create` / `Edit` | full-page form | | `TR/route-asset-new-*` | Assets |
| Asset reports | `/assets/reports` | `Asset.View` | saved reports list, builder | rename/delete confirms | `TR/route-asset-reports-*` | Assets |
| Notifications | `/notifications` | `Task.View` | list, filter, mark all as read | | `TR/route-notifications-*`, `docs/ux/notifications-review/` | Search, notifications, profile |
| Search results | `/search`, `/search/advanced` | any search permission | type tabs (Tasks, Matters, Clients, Assets ...), filters | hit cards | `TR/route-search-*`, `docs/ux/search-review/` | Search, notifications, profile |
| My profile | `/profile` | `Task.View` | Availability, Work hours, Account, Notifications, Out of office list | Add/Edit out of office dialog (`absence-dialog`), overlap warning, set out of office (`set-out-of-office-dialog`, 30rem) | `TR/route-profile-*`, `CAL/director-profile-*`, `CAL/profile-*`, `docs/ux/profile-review/` | Search, notifications, profile |
| 403 No access | `/403` | everyone | | | `TR/route-access-forbidden-*`, `TR/forbidden-*` | System pages |
| 404 Page not found | `/404`, `**` | everyone | | | `TR/route-not-found-*` | System pages |

## 3. Administration (`/admin/*`; left navigation section ADMINISTRATION)

| Page | Route | Permission | Tabs / sub-views | Dialogs, drawers | Existing screenshots | Epic |
| --- | --- | --- | --- | --- | --- | --- |
| Users | `/admin/users` | `User.View`/`User.Manage` | Users, Roles, Pods (`alsoActive`) | user drawer (`user-drawer`, 480 px), pods cell editor, deactivate confirm | `TR/route-admin-users-*`, `TR/admin-user-drawer-*`, `docs/ux/users-review/`, `docs/ux/users-pods/` | Admin: Users, Roles, Pods |
| Roles (tab) | `/admin/users?tab=roles` (also `/admin/roles`) | `Role.Manage` | master list, role editor with permission matrix | delete confirm | `TR/route-admin-roles-*` | Admin: Users, Roles, Pods |
| Pods (tab) | `/admin/users?tab=pods` | `Pod.Manage` | list, member editor | deactivate confirm | `TR/route-admin-pods-*` | Admin: Users, Roles, Pods |
| Task Types | `/admin/task-types` | `TaskType.Manage` / `Workflow.Manage` | Task Types, Workflows, Workflow Steps | | `TR/route-admin-task-types-*`, `docs/ux/task-types-review/`, `docs/ux/task-types-tabs/` | Admin: Task types and workflows |
| Task type record | `/admin/task-types/:id`, `/new` | `TaskType.Manage` | Overview, Workflows, Form (designer) | form designer (`/:ownerId/form`), icon picker dialog (`task-type-icon-picker`) | `TR/route-admin-task-type-record-*`, `TR/admin-task-type-form-*` | Admin: Task types and workflows |
| Workflows list / record / version | `/admin/task-types?tab=workflows`, `/admin/workflows/:id`, `/versions/:vid` | `Workflow.Manage` | Overview, Steps, Task types, Versions | mode control, publish/retire/discard confirms, step library | `TR/route-admin-workflows-*`, `TR/route-admin-workflow-record-*`, `TR/admin-workflow-version-*` | Admin: Task types and workflows |
| Workflow steps | `/admin/task-types?tab=steps`, `/admin/steps/:id`, `/steps/new` | `Workflow.Manage` | Details, Inputs, Used by | form designer | `TR/route-admin-steps-*`, `TR/admin-step-new-*` | Admin: Task types and workflows |
| Labels | `/admin/priorities` (+ `/status-labels`, `/on-hold-reasons`, `/note-tags`) | per tab | Priorities, Status labels, On-hold reasons, Note tags | priority dialog (`priority-dialog`), lookup dialogs (`lookup-dialog`) | `TR/route-admin-priorities-*`, `TR/route-admin-status-labels-*`, `TR/admin-labels-*`, `docs/ux/tab-strips-review.md` | Admin: Lookups |
| Asset types | `/admin/asset-types` (+ Link Roles tab `/asset-link-roles`) | `AssetType.Manage` | Asset Types, Link Roles | record page with Overview / Fields tabs, form designer | `TR/route-admin-asset-types-*`, `TR/route-admin-asset-type-record-*`, `docs/ux/assets-review/` | Admin: Lookups |
| Custom Fields | `/admin/custom-fields` | `CustomField.Manage` | per object list, form designer | | `TR/route-admin-custom-fields-*`, `TR/admin-custom-fields-form-*` | Admin: Lookups |
| Reports (admin) | `/admin/reports` | `Report.Manage` | Reports, Categories, Run log, Assignments, Settings; editor page with SQL editor, schema browser, versions, preview | | `TR/route-admin-reports-*`, `TR/admin-reports-*`, `docs/ux/reports-review/` | Admin: Reports, Audit, Settings |
| Audit Logs | `/admin/audit` | audit permission | filterable event grid | | `TR/route-admin-audit-*` | Admin: Reports, Audit, Settings |
| Settings | `/admin/settings` | `Settings.Manage` | Branding, Dashboard (gauge form + capacity form), Holidays (calendars, import, thresholds) | calendar dialog, holiday dialog, import dialog | `TR/route-admin-settings-*`, `docs/ux/app-settings/`, `CAL/admin-*` | Admin: Reports, Audit, Settings |

## 4. Shared pop-ups, menus and states (to be crawled once, then governed by the shared-components epic)

| Family | Components (code) | Notes |
| --- | --- | --- |
| Form dialog | `mf-form-dialog` (11 uses), plus 12+ hand-built `p-dialog` (Edit task, event, set out of office, assign, bulk, absence, availability, matter managers, priority, holiday, calendar, import) | widths in code: 26/36/48 rem, 30 rem, 32 rem, 34 rem, 40 rem, 720 px: see finding F-08 |
| Confirm dialog | `mf-confirm-dialog` (43 uses), `lookup-dialog` | 32 rem, "Keep ..." vs "Cancel" wording varies, finding F-09 |
| Drawers / slide panels | `mf-slide-panel` (30 / 37.5 rem), person drawer 36 rem, coverage 34 rem, swimlane 32 rem, admin user drawer 480 px, activity drawer 36 rem, unassigned drawer 36 rem | finding F-08 |
| Popovers and menus | user menu, bell panel, global search, "..." options menu, Columns menu (`grid-columns`) and Columns chooser (`column-chooser`), views menu, export menu, `mf-dropdown` (single and multi), filter popover, assignee picker, inline edit menus, row action menu, tooltips `[mfTip]` | |
| Toasts | `NotificationService` (PrimeNG toast), `UndoService` ("Not undone" info) | wording split, finding F-11 |
| Empty, loading, error | `mf-record-state`, `admin-list-state`, `mf-dash-state`, `still-loading`, `record-skeleton`, grid empty rows, Retry buttons (14 uses), 403/404/error pages | finding F-10 |
| Inline editors | `row-edit` (status, due, assignee, priority), tag input, entity/asset pickers, rich-text editor (toolbar, link and table popovers) | |

## 5. Epics planned for phase 2 (one per page group, plus the shared one and the top one)

1. Epic: UI update - shared components (applies everywhere: buttons, controls, chips, links, tabs, dialogs, drawers, toasts, states, tokens, formats)
2. Epic: UI update - Dashboard (Summary, Breakdowns, Trends, Swimlane, Users, Calendar)
3. Epic: UI update - My Matters
4. Epic: UI update - Tasks (Task Queue, My Work, Pod Work)
5. Epic: UI update - Task page and Create task
6. Epic: UI update - Matters (list, record, all seven tabs)
7. Epic: UI update - Clients
8. Epic: UI update - Projects
9. Epic: UI update - Assets
10. Epic: UI update - Search, Notifications, Profile
11. Epic: UI update - System pages (Access pending, 403, 404, Error) and shell (navigation, top bar, menus)
12. Epic: UI update - Admin: Users, Roles, Pods
13. Epic: UI update - Admin: Task types, Workflows, Steps
14. Epic: UI update - Admin: Lookups (Labels, Asset types, Custom Fields)
15. Epic: UI update - Admin: Reports, Audit Logs, Settings
16. Top epic: Epic: UI update 2 (branch ui-update-2)

The owner asked for "one epic per page". Groups above keep a page's tabs and dialogs together; the Dashboard has six tabs of very different make-up, so phase 2 may split Calendar and Users into their own epics if the issue count passes 8. Decision recorded as D-00 in the spec.
