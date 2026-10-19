# Task Detail: final verification screenshots (#331, T10b)

Taken by `frontend/e2e/tests/task-detail-final.spec.ts` (run with `E2E_SCREENSHOTS=docs/ux/task-detail-review/fixes/final`) on the final tree of the epic (#288), Dev auth, Chromium. Names are `<shot>-<width>x<height>.png`. The six task shapes of the review are seeded by the spec (the numbers are the review's TSK numbers; the real task numbers differ): each is shown at 375x812, 768x1024, 1024x768, 1366x768 and 1920x1080 (the four sizes of the epic's definition of done, plus 1024 where the layout switches to two columns), and every shot passed axe (WCAG 2.2 AA and best-practice, including `target-size`) with 0 violations and the no-page-level-horizontal-scroll check before it was taken.

| Shot | What it shows |
|---|---|
| `tsk123-long-*` | TSK-123: 200-character title, 205-character matter name, Sensitive matter, long description |
| `tsk124-overdue-*` | TSK-124: overdue, assigned |
| `tsk126-unassigned-*` | TSK-126: unassigned |
| `tsk127-onhold-*` | TSK-127: On Hold with its reason (status note, no primary button, Resume in the overflow) |
| `tsk128-completed-*` | TSK-128: Completed (Reopen task as the primary action) |
| `tsk129-cancelled-*` | TSK-129: Cancelled |
| `<shape>-overflow-*` | the same six with the header overflow menu open (Edit, Activity and the status items at the narrow sizes) |
| `tsk123-long-activity-*` | the Activity drawer of TSK-123 (clamped title) at the four sizes |
| `activity-folded-1366x768` | 48 comments and a hold: the first row of Activity is the status change, the 48 comments fold into groups |
| `edit-dialog-1366x768` | the Edit dialog: sticky footer, Save inside the window |
| `permissions-system-*`, `permissions-assignee-*`, `permissions-task.view-*`, `permissions-no-task-view-*` | System Admin, the assignee Data Technician, a person with `Task.View` only (no Asset.View, Matter.View, Client.View; overflow open where there is one), and a person without `Task.View` (the 403 page with "Go to Clients"), at the four sizes |
| `state-loading-1366x768`, `state-404-*`, `state-403-*`, `state-500-*`, `state-offline-activity-*`, `state-reduced-motion-*` | the state matrix |

## The review's measurements, before and after

Before: `docs/ux/task-detail-review/README.md` (section 1 table and the findings). After: the spec's printed table (annotation `before-after`), measured on the final tree.

| Measure | Review | Final |
|---|---|---|
| Workflow heading y, typical task (TSK-124), 1366 / 1920 | 235 / not measured | 269 / 269 (the facts strip and the section nav were added above it; the target is 300) |
| Workflow heading y, typical task, 768 / 375 | 1519 / 609 | 324 / 377 |
| Workflow heading y, long task (TSK-123), 1366 / 1920 | 519 / not measured | 294 / 294 |
| Workflow heading y, long task, 768 / 375 | 2335 / 1230 | 349 / 425 |
| Status note of a Cancelled task, 1366 / 375 | about 190 px of banners | 38 / 58 px (one note) |
| Edit dialog height at 1366x768 (Save position) | 2489 px, Save at y 2544 | 690 px, Save at y 708 to 712, inside the window |
| Activity rows before the first event that is not a comment (48 comments) | about 40 to 50 | 0 (the first page is 3 rows: the status change, the hold reason and one folded group of comments) |
