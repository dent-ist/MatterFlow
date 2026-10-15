# Dashboard > Swimlane tab (issue #72, epic #68)

The fourth Dashboard tab shows every open task, plus the tasks completed or cancelled in the last 7, 14 or 30 days, as cards in four lanes. It is for leads and directors (`Dashboard.ViewDepartment`) and is an operational view only: no per-person completion figures, speed or ranking. Specification: `docs/ux/ux-spec.md`, section S01b. Backend: `GET /api/v1/dashboard/swimlane` (`docs/architecture.md` 8.5).

Screenshots were taken by `frontend/e2e/tests/swimlane-screens.spec.ts` against the real stack (SQL Server in Docker, the published API with Dev auth serving the production Angular build, Chromium) after seeding 160 tasks: 4 clients with 3 matters each, all priorities, New, In Progress, On Hold, Completed and Cancelled tasks, 4 assignees (one of them out of office) and unassigned tasks. Reproduce with:

```bash
E2E_SCREENSHOTS=docs/ux/dashboard-swimlane frontend/e2e/run-local.sh -g "swimlane screenshots"
```

## What the screens show

| File | What it shows |
|---|---|
| `01-board-1366.png`, `-1024`, `-375` | The board, no grouping, sorted by priority. 1366: four lanes. 1024: the lanes keep a readable width and the board scrolls sideways inside itself. 375: the lanes stack, each with its own scroll. |
| `02-group-priority-*` | Grouped by priority: coloured group headers in rank order with counts. |
| `03-group-assignee-*` | Grouped by assignee: avatar, name, Out of office chip, count; Unassigned last. |
| `04-client-matter-tree-*` | Grouped by client / matter: client (level 1), matter (level 2, indented), cards (level 3, indented further), a count on every node. |
| `05-compact-1366.png` | Compact density. |
| `06-filters-1366.png` | The filter panel (the Filters button shows the number of filters on). |
| `07-inline-menu-1366.png` | An inline status menu on a card. |
| `08-drawer-1366.png`, `12-drawer-375.png` | The drawer peek: summary, quick actions, steps, latest comments, "Open full task". |
| `09-loading-1366.png` | Skeleton cards while the board loads. |
| `10-capped-lane-1366.png` | The "Showing N of M. Open the Task Queue" note of a capped lane (the lane count is patched to 230 in this run). |
| `11-error-1366.png` | The error state with reference and Retry. |

## Decisions

- **Lanes are columns, tall as the screen.** The board is the viewport height minus the page above it; every lane scrolls by itself under a sticky header with the exact count and "oldest 5d" (age of the oldest loaded card). Below 900 px the lanes stack, each limited to a scrolling box. A lane draws 40 cards and offers "Show 40 more" so 800 cards stay quick; the server caps a lane at 200.
- **Priority is never colour alone.** A left bar in the priority colour (same tokens as the priority badge), the level-bar icon and the priority text on every card.
- **No drag and drop.** Status changes use the inline Status menu with the existing rules and dialogs (Hold, Cancel, Complete, Reopen); a card that changes status moves to its new lane and the board is read again a moment later. Priority and Assignee are inline menus with Undo.
- **Tree semantics.** In client / matter mode every lane is a `role="tree"`; clients, matters and cards are `treeitem`s with `aria-level` 1, 2 and 3 and `aria-expanded` on the nodes. Arrow keys follow the APG tree pattern; Shift with Left or Right moves between lanes. The collapse state is shared by the lanes, and Expand all / Collapse all work on the whole board.
- **Keyboard.** One tab stop per lane (roving), Up, Down, Home and End inside it, Left and Right between lanes, Enter opens the drawer, `m` opens the status menu, and a "Skip lane" button. The cards' own links and menus stay reachable with Tab.
- **Drawer peek.** A modal right-side drawer like the Activity drawer: focus trapped, Esc or Close returns focus to the card, "Open full task" navigates.
- **Remembered and shareable.** Group, sort, window and density are remembered per user in the browser (guarded `localStorage`); every choice that changes the data is in the address (`?tab=swimlane&group=...`) and is dropped when another tab is chosen. The data filters are not remembered, so a plain link never opens a silently filtered board.
- **Refresh.** Every 5 minutes while the tab is visible, skipped while a menu, dialog or the drawer is open, and it never moves focus. A failed background read keeps the board and shows a banner with Retry.
- **Dark mode.** Only `--mf-*` tokens are used (no literal colours), so the board follows the theme.

## Checks

- Unit specs: `swimlane-model.spec.ts` (view and address, tree and group layout, card edits, queue link), `swimlane-prefs.spec.ts`, `dash-swimlane-tab.spec.ts` (lanes, cards, toolbar, address and remembered choices, truncation, tree roles and keyboard, inline menus and Undo, drawer focus, error and refresh behaviour), `dashboard-page.spec.ts` (tabs).
- End to end: `frontend/e2e/tests/swimlane.spec.ts` (20 tests, see `docs/qa/e2e.md`).
- axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa): 0 violations on the board, the tree, the assignee groups, the compact board and the open drawer.
