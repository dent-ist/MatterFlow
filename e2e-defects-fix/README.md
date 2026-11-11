Evidence for the fixes of #1364, #1365 and #1366 (branch e2e-defects-fix), Chromium, 1366x768 and 1920x1080.
"after" images are the fixed build. "before ... simulated" images are the same fixed page with the old behaviour put back in the browser (min-height/min-width off, the role removed, the option text lowercased), not a build of the old commit.
- 1364: link sizes after 35.3x24, 27.5x24 (dashed outline drawn for the picture only); before (simulated) height 22.
- 1365: axe aria-prohibited-attr after: 0 violations, 0 incomplete; with the role removed: 1 incomplete. The picture does not change (the fix is not visible).
- 1366: menu "7 Days / 14 Days / 30 Days" after; "7 days ..." before.
