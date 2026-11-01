# Visual sweep (TH-14, issue #996)

Method: real stack on a fresh database (`seed:demo --aged --seed 7`), administrator `ke\kekim`; PM `KE\testuser03` for My Matters and technician `KE\testuser01` for the technician Dashboard and My Work. Every route below was opened at 1366x768, 1920x1080, 768x1024 and 375x812: one screenshot each (`docs/ux/theme-rollout/after/route-<name>-<size>.png`) and one axe run (WCAG 2 A and AA, 2.1 AA, 2.2 AA and best-practice). The review compared each page with My Matters: title size and spacing, header, filter and pager alignment, heading rows, states, dropdown and chip style, form cards, tiles, focus ring, coloured edges, contrast.

Result of the final run (after the fixes): **204 page and size combinations, 0 violations** on the pages listed (the heading-order findings of the first run are fixed and the Swimlane re-checked at 1366x768 and 375x812). The first run found only `heading-order` on the Swimlane and the technician Dashboard.

Dialogs and popovers opened by script at 1366x768 and 375x812 (Edit task, New priority, bell, menus): axe 0, dialog title 16 px / 600; the Edit task dialog footer order was wrong and is fixed.

Other fixes of this issue: the Pod Work pod select, the Search filters, the time zone select and the phone sort sheet are `mf-dropdown` (specs migrated with the dropdown helper); the Matters list filter row now fits from 1500 px; `docs/ux/theme-guide.md` section 7.5 holds the lessons.

| Route | Sizes checked | Axe (final run) | Issues found, fixed or filed |
| --- | --- | --- | --- |
| `access-forbidden` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Own centred card, unlike record states. Filed as #1000. |
| `access-pending` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Opens My Work for an administrator (a person with access); the real pending page needs a user without access: checked by e2e. |
| `admin-asset-type-record` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-asset-types` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Status strip chips (TH-17). OK. |
| `admin-audit` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-custom-fields` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-labels` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-pods` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-priorities` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-reports` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-roles` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-settings` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-status-labels` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-steps` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Strip chips (TH-17). OK. |
| `admin-task-type-record` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-task-types` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Summary strip was boxed work-strip items; now filter chips like Users, Asset types, Workflows, Steps. Fixed. |
| `admin-users` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Status strip chips (TH-17). OK. |
| `admin-workflow-record` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `admin-workflows` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Strip chips (TH-17). OK. |
| `asset-new` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `asset-record` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `asset-reports` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `assets` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `client-new` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `client-record` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `clients` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `dashboard-breakdowns` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `dashboard-summary` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `dashboard-swimlane` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | axe: heading-order | axe heading-order (lane and card headings jumped from h1 to h3/h4); set aria-level 2 and 3. Card priority bar and Users card edge gone earlier (TH-01). Fixed. |
| `dashboard-tech` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | axe heading-order (list headings h3 under h1); aria-level 2. Fixed. |
| `dashboard-trends` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `dashboard-users` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `error` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Same as 403. Filed as #1000. |
| `matter-new` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `matter-record` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `matters` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Filter row fell back to the sheet at 768 and 1600 px (pre-existing since TH-05): Status and Sensitive pair floor 16 rem to 15 rem; at 768 the sheet is by design (spec updated). Fixed. |
| `my-matters` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `my-work` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Count strip is chips; pager dropdown. OK. |
| `my-work-tech` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Same grid as My Work for a technician. OK. |
| `not-found` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Same as 403. Filed as #1000. |
| `notifications` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `pod-work` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Pod select converted to mf-dropdown (own list opens upward not needed). Fixed. |
| `profile` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Time zone select converted to mf-dropdown. Fixed. |
| `project-new` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `project-record` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `projects` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `search` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Asset type, Status, Sensitive filters converted to mf-dropdown. Fixed. |
| `search-tasks` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Same as search. Fixed. |
| `task-new` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | No inconsistency found. |
| `task-page` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Edit task dialog had Save on the left and Cancel on the right: swapped (secondary left, primary right). Fixed. |
| `task-queue` | 4 (1366x768, 1920x1080, 768x1024, 375x812) | 0 violations | Native selects in the filter row and pager now mf-dropdown (TH-17). Fixed. |

Open items: #1000 (error pages). Not in the sweep: dialogs that need data states (hold, cancel, complete with a form), Reports run output, form-engine designer canvases (covered by their own specs).
