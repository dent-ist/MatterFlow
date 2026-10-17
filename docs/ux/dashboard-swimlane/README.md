# Dashboard > Swimlane tab (issue #72, epic #68)

The fourth Dashboard tab shows every open task, plus the tasks completed or cancelled in the last 7, 14 or 30 days, as cards in four lanes. It is for leads and directors (`Dashboard.View` + `Dashboard.ViewSwimlane`) and is an operational view only: no per-person completion figures, speed or ranking. Specification: `docs/ux/ux-spec.md`, section S01b. Backend: `GET /api/v1/dashboard/swimlane` (`docs/architecture.md` 8.5).

Screenshots were taken by `frontend/e2e/tests/swimlane-screens.spec.ts` against the real stack (SQL Server in Docker, the published API with Dev auth serving the production Angular build, Chromium) after seeding 160 tasks: 4 clients with 3 matters each, all priorities, New, In Progress, On Hold, Completed and Cancelled tasks, 4 assignees (one of them out of office) and unassigned tasks. Reproduce with:

```bash
E2E_SCREENSHOTS=docs/ux/dashboard-swimlane frontend/e2e/run-local.sh -g "swimlane screenshots"
```

## What the screens show

| File                                      | What it shows                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-board-1366.png`, `-1024`, `-375`      | The board, no grouping, sorted by priority. 1366: four lanes. 1024: the lanes keep a readable width and the board scrolls sideways inside itself. 375: the lanes stack, each with its own scroll. |
| `02-group-priority-*`                     | Grouped by priority: coloured group headers in rank order with counts.                                                                                                                            |
| `03-group-assignee-*`                     | Grouped by assignee: avatar, name, Out of office chip, count; Unassigned last.                                                                                                                    |
| `04-client-matter-tree-*`                 | Grouped by client / matter: client (level 1), matter (level 2, indented), cards (level 3, indented further), a count on every node.                                                               |
| `05-compact-1366.png`                     | Compact density.                                                                                                                                                                                  |
| `06-filters-1366.png`                     | The filter panel (the Filters button shows the number of filters on).                                                                                                                             |
| `07-inline-menu-1366.png`                 | An inline status menu on a card.                                                                                                                                                                  |
| `08-drawer-1366.png`, `12-drawer-375.png` | The drawer peek: summary, quick actions, steps, latest comments, "Open full task".                                                                                                                |
| `09-loading-1366.png`                     | Skeleton cards while the board loads.                                                                                                                                                             |
| `10-capped-lane-1366.png`                 | The "Showing N of M. Open the Task Queue" note of a capped lane (the lane count is patched to 230 in this run).                                                                                   |
| `11-error-1366.png`                       | The error state with reference and Retry.                                                                                                                                                         |

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

**Scope (P1, issue #89).** The Pod filter of the Filters panel is gone: the board shows the tasks of the page-wide Scope (`?pod=all|mine|<id>`, see ux-spec S01), and the lane "Open the Task Queue" links carry the scope's `pod` filter. An old `pod=<id>` link of this tab is the same scope value. The data filters in the panel are now Assignee, Task type, Priority and Overdue only.

## WP9a: one-line card, one-line toolbar, lane count links, no repeated client or matter (#122, #123, #124)

Screenshots: `docs/ux/dashboard-review-2/fixes/wp9a/` (1366, 1920 and 375; comfortable and compact; the "..." menu; the tree). Taken by `frontend/e2e/tests/swimlane-board.spec.ts` with `E2E_SCREENSHOTS=<folder>`.

- **Compact is a real one-line card (44 px).** Priority bar and level glyph, task type icon, task number link, title (one line, truncates), assignee initials with the Out of office flag, due chip. Client and matter, priority and assignee names are in the hover text of the title button; the Status, Priority and Assignee menus and the progress bar are in the drawer (the drawer has the same inline menus), and `m` opens the drawer on this card. At 1366x768 a lane shows at least 8 cards without scrolling (10 at 1920x1080). Comfortable is unchanged apart from W3. The default stays Comfortable; the remembered per-user choice applies on load.
- **Toolbar, one row (at most 56 px) from 1100 px, two lines at most below.** Search, Group, Sort, Filters (count), then a "..." menu button with Density, "Done in the last", Only mine and, when grouped, Expand all / Collapse all. It is the ARIA menu button pattern (`aria-haspopup="menu"`, `aria-expanded`, Enter/Space/Arrow Down open, arrows/Home/End, Esc closes and returns the focus, Tab closes). Settings that are not the defaults (Compact, a window other than 7 days, Only mine) are shown as text chips beside the button. The Filters sheet keeps Assignee (incl. Unassigned), Task type, Priority and Overdue only (the Pod is the page Scope).
- **Lane counts are links (W2).** The lane name is its own `h3`; the count is a link (24 px target, focus ring) with the accessible name "93 New tasks in the Task Queue". The link carries the lane status (Completed: `COMPLETED` and `CANCELLED` plus `completedFrom` = start of the Done window in the viewer's zone), the page scope (`pod`) and the filters the queue supports (assignee/unassigned/mine, task type, priority, overdue). It is not part of the lane's roving tab stop. With search text the link leaves the text out, the tooltip and the accessible name say "Search text is not included" and the count is drawn with a dashed outline (not an exact match). The Task Queue could express the text (the board and the queue share the filter), but the PM decision is to omit it. Without search text the e2e test compares each lane count with the queue total for the link.
- **Client and matter on cards (W3).** Not grouped, grouped by priority: one line "Client / Matter name" (the matter number and the sensitive mark: the number is in the hover text and in the drawer, where it is a link). Grouped by Client / matter the cards omit the line (a lock stays in the title row for a sensitive matter) and the tree labels wrap instead of ending in an ellipsis (the count stays on the right); grouped by Assignee the cards omit the assignee (and the Out of office flag, which the group header carries).
- **`aria-prohibited-attr`.** The nodes axe listed as "needs review" were `aria-label` on plain `span`s (the lane count and the group counts). The lane count is now a link, the group count has screen-reader text instead of a label; the e2e test `axe reports no aria-prohibited-attr, not even as needs review` runs the rule on four groupings and expects no violations and no incomplete nodes.
- **Escape in the drawer.** An inline menu trigger no longer swallows Escape while its menu is closed, so Esc closes the drawer from any control in it (shared `inline-menu.ts`).

## WP9b: lane switcher below 900 px, big screens (#125, #126)

Screenshots and measurements: `docs/ux/dashboard-review-2/fixes/wp9b/` (README there). Supersedes "Below 900 px the lanes stack" above.

- **Below 900 px one lane at a time.** A tablist "Swimlane lanes" (New, In Progress, On Hold, Completed, each with its count as plain text) replaces the four lanes; the selected lane is the tabpanel (In Progress by default). `lane=new|hold|done` is in the address only when it is not the default, and the choice is kept for the session. On a scrolling page (under 768 px wide or 561 px high) the lane has its natural height and the switcher is sticky; in the fixed-height page (768 to 899 px) the lane fills the window and scrolls inside itself. The toolbar is Search, Filters and "..." (Group and Sort move into the Filters panel). From 900 px nothing changes.
- **Big screens.** Above 2200 px a lane is at most 480 px wide and the board stays left aligned. At 1920 x 1080 the board fills the width and the height; a lane shows 17 whole compact cards (target 14) and 5 whole comfortable cards (target 6, not met, reported on #87).
