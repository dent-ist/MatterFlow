# Pod Work fixes: evidence and test data

Evidence for the Pod Work epic #546, one folder per work package (`pw1-bugs`, `pw2-scope`, ... `final`). Screenshots are written by the e2e specs when `E2E_SCREENSHOTS_PW` points at the folder.

## Test fixtures (#547)

`frontend/e2e/support/pod-work-fixtures.ts` builds the data of the review through the published API (no SQL, the demo seed is unchanged). Every Pod Work spec imports `podWorkFixtures(seed, personas)`; none builds its own pods. The helper runs once per worker (a second call returns the same object and creates nothing), every record is new and its name carries a per-worker token, so parallel workers never collide and nothing needs cleaning up. `pw1-fixtures.spec.ts` signs in as each person and asserts what is listed here.

| Name in the review | Fixture | What it is |
|---|---|---|
| busy demo pod | `fx.busy` | "Demo Processing Pod": 23 members (the lead, the read-only person and 21 technicians; 16 without open work, the last one out of office), 4 unassigned, 20 assigned, 4 overdue (assigned), 6 on hold (assigned) open tasks; `busy.counts` has the numbers, `busy.unassignedNumbers` the task numbers of the unassigned tasks |
| empty pod | `fx.empty` | a pod with no members |
| 76-character pod | `fx.longName` | a pod whose name is exactly 76 characters; the lead is a member |
| pw-lead | `fx.lead` | Pod Lead role (`Pod.View`, `Task.View`, `Task.Assign`, `Pod.ManageMembers`, `Pod.Manage`); member of the busy pod |
| pw-readonly | `fx.readonly` | `Pod.View`, `Task.View`, `Matter.View`, `Client.View`, no `Task.Assign`; member of the busy pod |
| pw-podnotask | `fx.podNoTask` | `Pod.View`, `Dashboard.View`, `Dashboard.ViewSummary` (so the Dashboard is a page the person can open), no `Task.View` |
| pw-director, pw-observer | `fx.director`, `fx.observer` | the Director and Read-Only Observer roles, in no pod |
| pw-multi | `fx.multi` | technician in five pods, the second is primary (`multi.pods`, `multi.primary`) |
| pw-two | `fx.two` | technician in two pods |
| pw-nopod | `fx.noPod` | technician in no pod |

Deviation from the issue text: `pw-podnotask` also holds `Dashboard.ViewSummary`; with `Dashboard.View` alone the Dashboard has no tab and the person would land on the 403 page.

## pw1-bugs (first release: #548, #549, #550, #551, #552)

- `bug1-long-pod-name-<size>.png`: BUG-1, the 76-character pod name at the four sizes: the title is one line, the Pod select is capped at 22rem and cut with an ellipsis, its full name is the tooltip.
- `bug2-403-1366x768.png`: BUG-2, `/pods/work` as a person with `Pod.View` but without `Task.View`: the 403 page, no request, no toast.
- `w9-assign-link-768x1024.png`: W9, "Assign to me" in the first view of the Unassigned grid (Matter Number is left out of the defaults from 640 to 899 px, the Assignee cell is the link and the menu's chevron).
- `bug4-members-<size>.png`: BUG-4, the By member tab without page-level sideways scroll (the table scrolls inside its own named region).
