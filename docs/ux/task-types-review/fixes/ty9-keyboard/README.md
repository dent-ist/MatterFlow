# WP-TY9 Keyboard, focus and a11y: audit (#413, #414, #415)

Epic #352. Evidence: `tab-stops.json` (recorded, not gated, written by `e2e/tests/ty9-audit.spec.ts` and `ty9-keyboard.spec.ts`), screenshots in this folder, tests `ty9-keyboard.spec.ts` (list skip link and Tab stops, focus and announcement after actions, failure inside the dialog) and `ty9-audit.spec.ts` (Tab stops per page, and the route x width x open-overlay matrix with axe).

**Owner decision: no new or changed keyboard shortcut.** Everything below is a skip link, a roving stop inside a row, focus management, a live region or a named region. The existing arrow key from a row name (it already reached the Copy button on Clients) now also reaches the row's count links; Alt+Arrow on version steps is untouched.

## Tab stops before and after (1366 x 768, 25-row page, seeded names)

| List | Before: Tab presses to the first row | After: with the skip link | Before: stops in 25 rows | After: stops in 25 rows |
| --- | --- | --- | --- | --- |
| Task Types | 39 | Tab, Enter (2 presses) | 75 | 50 |
| Workflows | 39 | Tab, Enter (2 presses) | 75 | 50 |
| Workflow Steps | 38 | Tab, Enter (2 presses) | 55 | 50 |

Without the skip link the first row is one press later than before (the link itself). A phone card has 2 stops (name, menu). The target of #413 (about 55 per page) is met: 50 for the rows. The count links ("2 workflows", "5 open tasks", "Open draft v3", "Used in 3 workflows") are reached from the row name with the right arrow (left arrow and Shift+Tab come back; Tab skips them); they are one click away on the record pages as well.

## Page by page (1366 x 768; "page stops" excludes the 18 stops of the application header and menu)

| Page | Page stops | Findings | Fixes | Verified good |
| --- | --- | --- | --- | --- |
| Task Types list | 73 (25 rows) | no skip link; 3 to 4 stops per row; focus fell to `main` after a deactivate that removed the row | Skip to table; 2 stops per row; heading focus when the row is gone | sort buttons, filter row, strip chips, scroll region, row menu (Esc returns focus), Back restore |
| Workflows list | 72 | same; focus fell to the page body | same | Draft link now reached with the arrow; phone cards |
| Workflow Steps list | 72 | same | same | Tags popover, Filters sheet on a phone |
| Task Type: Overview / Workflows / Request form / new | 11 / 12 / 11 / 9 | focus stayed on "More actions" after Deactivate or Activate; a failed Deactivate closed the dialog | focus to the Active or Inactive badge, announced; failure stays in the dialog | tabs (one stop, arrows, Home, End), Activity drawer, deactivate dialog |
| Workflow: Overview / Versions / Task types / new | 12 / 14 / 10 / 8 | same; retire from the Versions tab left focus on the body | focus to the badge, the Published badge after a retire | version row menu, retire dialog |
| Version page: draft / published / used by | 70 / 13 / 12 | Publish, Discard draft and Create new draft moved focus to the application header or the body; a failed publish closed the dialog | focus to the Published badge of the workflow, the Draft badge of the new draft, the Retired badge; failure stays in the dialog | 2 stops per step row, skip rules popover (Esc to the badge), mode popover, library drawer, switcher menu, Alt+Arrow unchanged |
| Step: Details / Inputs / Used by / new | 13 / 9 / 8 / 7 | same as the Task Type | same | tabs, Activity drawer |
| Form designer: draft / published / step | 43 / 21 / 15 | Publish, Retire and Create new draft lost focus; a failed publish closed the dialog | focus to the title badge (Published v2, Retired v2, Draft v2); failure stays in the dialog (server problems still go to Validation, as decided in #408) | Preview/Validation tabs, Versions dialog, palette sheet on narrow widths |
| Activity drawer (three records) | n/a | a long history scrolled inside the drawer with no keyboard access (axe `scrollable-region-focusable`) | the history is a named, focusable region "Activity" while it overflows | focus lands on Close, Esc returns focus to Activity |
| Confirm dialog (shared) | n/a | the confirm button was disabled while the action ran, so the dialog's focus trap moved focus to Cancel | the button stays focusable and ignores clicks while busy ("Working..." is announced); `error` input shows a failure as an alert | Esc, focus return, Tab trapping |

Recorded and not changed (not defects): the draft version page (42 to 70 stops with a 13-step library) and the designer (43 stops with 6 fields: the 13 Add buttons and Up, Down, Delete per field) have many stops; a roving toolbar would cut them but is a larger redesign (listed for Phase 2). The summary strips are 4 to 5 button stops. A deactivate announces twice (the page's live region and the "Saved." toast), the same wording the Clients pages use.

## Rule after an action (#414)

After a successful publish, retire, discard, deactivate, activate or create draft, focus goes to the status badge in the page title (the Published badge of the workflow after Publish or Discard draft, which open the workflow; the heading when a list row has left the result); the polite live region or toast says what happened. A failure keeps the dialog open, puts the message inside it as an alert and keeps focus on its confirm button. A concurrency conflict closes the dialog (its question is stale) and shows the existing conflict message. In a list the row's menu button keeps focus when the row stays, the heading takes it when the row is gone.

## axe matrix (#415)

Every overlay (row menus, deactivate, retire, discard and publish dialogs, Activity drawers, version switcher, mode and skip rules popovers, library drawer, Tags filter, Versions dialog, palette sheet) at 1366, 1920, 768 and 375: axe 0 (WCAG 2.2 AA and best practice), no sideways page scroll, Escape closes, focus returns to the opener.

## Phase 2 backlog (not done, by owner decision or size)

- No shortcuts: nothing in these issues needed one. The designer Alt+Arrow and Undo (#411) stay on the Phase 2 list.
- Roving toolbar for the designer palette and the field row buttons; roving group for the strip chips.
- One announcement per action instead of live region plus toast.
