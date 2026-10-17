# WP9b: Swimlane phone layout and big-screen verification (#125, #126; #93 closed here)

Frontend only. No API, OpenAPI or SQL change. Screenshots in this folder were taken by `frontend/e2e/tests/swimlane-phone.spec.ts` (`E2E_SCREENSHOTS=<this folder>`).

## Lane switcher below 900 px (#125, W4)

- Below 900 px (`LANE_SWITCHER_QUERY`, `(max-width: 899.98px)`) the four lanes are replaced by a `role="tablist"` named "Swimlane lanes" (the Dashboard tab list is "Dashboard views") with four tabs, lane name over its count (`New 64`, `In Progress 44`, `On Hold 21`, `Completed 21`; plain text, not links) and ONE lane at a time in a `role="tabpanel"` labelled by its tab. The lane header inside the panel keeps the #123 count link to the Task Queue. Four equal columns, so all four tabs fit the 271 px that the shell leaves at 375 px.
- Keyboard (WAI-ARIA tabs, automatic activation): the selected tab is the only tab stop (roving tabindex), Left and Right move and wrap, Home and End jump, focus stays on the tab while the lane changes.
- Selected lane: In Progress by default. The address carries `lane=new|hold|done` only when it is not the default (`lane=progress` is removed, P9); the last choice is also kept in `sessionStorage` for the session (a plain Swimlane link then opens on it and writes `lane=` once). An address with `lane=` wins.
- Height. Phone, short window (under 768 px wide or 561 px high): the page scrolls and the lane has its natural height (no scroll box of its own, lane header not sticky, no "Skip lane" button, lane arrows between lanes are off). The switcher is sticky (0 px under 600 px wide, 44 px under the tab row from 600 px) unless the window is under 400 px high, where it scrolls away. Fixed-height page (768 x 561 and up, so 768 to 899 px wide): the switcher is pinned and the one lane fills the rest of the window and scrolls inside itself (one scroll region, no nesting), as every other tab of the fixed-height Dashboard.
- Toolbar below 900 px: Search, Filters and "..." only. Group and Sort move into the Filters panel (the button counts a non-default Group or Sort, so a hidden setting is never invisible). Two rows at 375 px, one row at 768 px.
- 40 cards per page with "Show 40 more", the grouped tree and its shared collapse state work in the single lane. From 900 px nothing changes (the four-lane board).

## Dashboard tab row on a phone

At 375 px the five tabs (271 px wide strip) cannot all be shown. The strip keeps `role="tablist"`, roving tabindex and Home/End/arrows, scrolls sideways, and now shows a fade and a chevron at each edge that has more tabs (`data-more-start`, `data-more-end`, from scroll position and a `ResizeObserver` on the strip). A selected tab, or one reached by keyboard, is scrolled fully into view. The hints disappear when everything fits.

## Big screens (#126 W5, #93 P5), measured

Measured (bounding boxes, e2e and a probe), 1920 x 1080, 4 lanes:

- Board: x 244 to 1896 (1652 px wide: the right gutter is 24 px), y 159.5 to 1072 (912 px high): it ends at the bottom of the window and the document does not scroll. Its left edge is the left edge of the header row. Each lane body is 866 px high.
- Compact cards (44 px): 17 whole cards per lane (target 14: met).
- Comfortable cards (154 px, 162 with the gap): 5 whole cards per lane and a third of the sixth (target 6: NOT met). The chrome above the lane bodies is 213 px (app bar 56, page header row, toolbar, lane header); six comfortable cards need 972 px of the 866. It cannot be closed with CSS alone without changing the WP9a card; the gap is reported on #87.
- 2560 x 1440: lanes are at most 480 px wide (`@media (min-width: 2200px)`: `repeat(4, minmax(17rem, 480px))`), the board stays left aligned and the rest is blank space, board height = window minus chrome.

Width cap (#93), measured at 1366, 1600 and 2560: Summary and Breakdowns stop at 1360 px; Swimlane, Users (Workload and Coverage) and Trends use the whole content area from 1600 px; the left edge of the page container is the same on every tab. Layout shift (PerformanceObserver, 1920 x 1080) after each tab switch Summary to Users to Summary to Swimlane to Summary to Trends to Summary: 0.0000 every time (limit 0.02); the left edge of the page container does not move by more than 1 px.

## Screenshots

`switcher-375`, `switcher-sticky-375`, `lane-<lane>-375`, `lane-<lane>-768`, `toolbar-375`, `toolbar-filters-375`, `tabs-375-summary`, `tabs-375-users`, `board-1024`, `board-1920-comfortable`, `board-1920-compact`, `board-2560`, and per tab `summary|breakdowns|trends|swimlane|users|coverage` at 1366, 1600 and 2560.
