# Dashboard v4: compact tiles, Needs attention with ASAP, balanced Summary

Screenshots (`screenshots/`): `before-<tab>-<width>.png` is `dev` at ece194b, `after-<tab>-<width>.png` is this change; tabs summary, breakdowns, trends; widths 1920, 1280, 1024, 768, 375. Same seeded data (e2e stack, real API). The app has no dark theme, so there are no dark shots (tokens are used throughout, so a theme will carry over).

What changed
- Page content stops at 1360 px, left-aligned. Tiles are a fixed-width grid (170 to 220 px, `auto-fill`), never stretched.
- Tile: small neutral icon chip, label, big number, one-line helper (ellipsis + title); arrow shows it is a link; the link text stays in the accessible name.
- Summary: Needs attention (Overdue, Unassigned, On hold, ASAP open) and Overview (Open, Due soon, Completed, Created) as 2x2 tile groups on the left, the Unassigned queue beside them (from 1180 px), Overdue and Due soon in a two-column row below ("Deadlines"). Single lists do not stretch.
- ASAP open moved from Overview to Needs attention as the quiet blue outlined tile (no coloured edge or tint, smaller number than Overdue). DASH3-01.
- Also: DASH3-02 (tab change pushes history), DASH3-03 (no remembered tab; plain /dashboard opens Summary), DASH3-04 (focus returns to Refresh after a successful Retry), DASH3-05 (empty assignee note outside role="menu"), DASH3-06 partly (label "Completed and created in"), DASH3-07 copy, DASH3-08 (tabs share the width at 480 px and below, focused tab scrolled into view).
