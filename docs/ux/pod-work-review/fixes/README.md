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

## pw2-scope (#557, #558, #559)

- `context-line-<size>.png`, `context-line-long-name-<size>.png`: W2, the one muted context line under the title (`<pod> . 23 members . you are a member`), for the busy pod and the 76-character pod at the four sizes; the line is one row and its whole text is the tooltip.
- `pod-list-<size>.png`, `pod-list-director-1366x768.png`, `pod-list-observer-1366x768.png`, `pod-list-noPod-1366x768.png`: W3, the list of pods (Your pods / Other pods, counts) for a person with no pod and no remembered pod, at the four sizes and for the three kinds of person.
- `no-pods-manage-1366x768.png`, `no-pods-read-1366x768.png`: W3, "There are no pods yet." with "Create a pod" (`Pod.Manage`) and with "Ask an administrator to create one." (the pod list answered empty by a route stub).

## pw3-strip (#561, #562, #563)

- `strip-<size>.png`, `strip-overdue-<size>.png`: W5, the strip (Overdue, Due today, ASAP, On hold) and the Overdue item pressed (All open, the filter chip in the grid), at the four sizes.
- `strip-chip-row-375x812.png`: W11, one scrolling row of 44 px chips on a phone.
- `tabs-<size>.png`: W6, the three tabs (`Unassigned (n)`, `By member (people)`, `All open (n)`).

## pw4-members (#566, #568, #569; #553 and #555 are the two `empty-pod` pictures)

- `members-1366x768.png`, `members-unfolded-1366x768.png`, `members-sorted-1366x768.png`: W1, the workload table: the Unassigned row, the seven people with work in view, the folded idle members (`Show 16 members with no open work`), unfolded, and sorted by a heading.
- `members-1920x1080.png`: the table stays about 60 rem wide, so View tasks is near the name.
- `members-table-<size>.png` (1366, 1920, 768): the table with the idle members unfolded; `members-768x1024.png`: the table at 768 px.
- `members-cards-375x812.png`: W1 (h), below 640 px each person is a card (name, the three numbers on one line, a 44 px View tasks).
- The "Off hours" chips in the pictures are the time of day of the test run (the people are Off hours at 03:00 New York); the table shows a chip only while a person is out of office.

## pw5-narrow (#570)

- `first-screen-<tab>-375x812.png`: W10, the first screen of a phone (the first card starts about 194 px under the title; it was 330 px, the "before" is `screenshots/pod-work-queue-375x812.png`); `first-screen-<size>.png`: the other sizes keep their layout.

## pw6-assign (#571, with #572's `picker-members-only-<size>.png`)

- `toast-<size>.png`: W8, the Undo toast after Assign to me on Pod Work at the four sizes: "Assigned to you." and one short line, the shared toast host (bottom right, tinted, polite live region), not covering the pager. The App shell epic's toast system had already made it so; #571 is the verification (`pw6-toast.spec.ts`).

## pw7-access (#573, #574)

- `tab-stops.json`: Tab presses from the top of the page to the first grid row at 1366x768 per tab (recorded, not gated; most of them are the shell's rail and header), and the two controls per member row.
- `walk-<size>.png`: the page at the end of the axe walk at four sizes (every tab and state audited, assignee menu open).
- `permissions.md`: the permission matrix.
