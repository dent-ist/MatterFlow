# PM experience: Tab-stop evidence (epic #758, #785)

Generated from `frontend/e2e/tests/px6-matrix.spec.ts` (run with `E2E_TABSTOPS_OUT=<folder>`), PM Alpha of the PM fixtures, existing keys only (Tab, Shift+Tab, Enter, Space, arrows, Home, End, Esc; no shortcut is new or changed, #420). For every stop the test asserts: it has an accessible name, it shows a visible focus indicator (an outline or box shadow, or on a stretched card link the ring on its `::after`), and the keyboard leaves the region (or, in the phone menu overlay, wraps inside it, as a modal should).

Behaviour also asserted there: the My matters / All switch is two adjacent stops and keeps focus after Enter or Space; More in the menu is a button (Enter and Space open and close it, focus stays on it); the My Matters tab strip is one Tab stop with Left/Right/Home/End moving between tabs and Back restoring the selected tab; the matter header's More actions menu opens with Enter and Esc returns focus to its button; with reduced motion no new view starts a finite animation; at 683 px (200 percent zoom of 1366) nothing scrolls sideways and axe finds nothing.

Reading the lists: the order follows the page top to bottom, left to right. Long lists are counted, not repeated in full.

## Matters list, scoped, 1366 px (Tab from the page title)

40 stops. First stops: `button: Filters`, `button: My matters`, `button: All`, `button: Select`, `button: New matter`, `region: Matters list, scrollable`, `button: Matter reference`, `button: Name`, `button: Client`, `button: Project manager`, `button: Open tasks`, `button: Overdue`, `input: Filter by Matter reference`, `input: Filter by Name`, ...

## Matters list, scoped, 375 px (cards)

30 stops. First stops: `button: Filters`, `button: My matters`, `button: All`, `button: New matter`, `a: Alpha primary 1AX1D`, `button: More actions for 38041-00002 Alpha primary 1AX1D`, `a: E2E Client 1ayeb392`, `a: 1 open task in Alpha primary 1AX1D`, `a: Alpha secondary 1AX1D`, `button: More actions for 38041-00003 Alpha secondary 1AX1D`, `a: E2E Client 1ayeb392`, `a: Alpha both 1AX1D`, `button: More actions for 38041-00004 Alpha both 1AX1D`, `a: E2E Client 1ayeb392`, ...

## Main menu, desktop rail, More open

8 stops. First stops: `a: My Matters`, `a: Matters`, `a: Tasks`, `a: Assets`, `button: More`, `a: Clients`, `a: Projects`, `a: My Work`

## Main menu, phone overlay, More open (focus stays inside the overlay)

9 stops. First stops: `button: Close menu`, `a: My Matters`, `a: Matters`, `a: Tasks`, `a: Assets`, `button: More`, `a: Clients`, `a: Projects`, `a: My Work`

## My Matters, Overview tab, 1366 px

60 stops (the count is capped at 60). First stops: `button: My matters`, `button: All matters`, `combobox: Client`, `select: Role`, `select: Dates`, `a: Matters I manage 7`, `a: Open tasks 5`, `a: Overdue 1`, `a: Due in 3 days 0`, `a: Due in 7 days 0`, `a: Unassigned 5`, `a: On hold, oldest 10 d 1`, `tab: Overview`, `a: TSK-105 E2E Task 1d06uoo24`, ...

## Matter record, Overview tab, 1366 px

28 stops. First stops: `button: Copy matter number`, `button: Edit`, `button: Create task`, `button: More actions`, `a: 38041 E2E Client 1ayeb392`, `button: Change`, `a: Open 1`, `a: Overdue 0`, `a: Unassigned 1`, `a: On hold 0`, `tab: Overview`, `region: Matter overview, scrollable`, `a: Open 1`, `a: Overdue 0`, ...

## Observations for the review (#787)

- My Matters (Overview) has more than 60 Tab stops between the title and the end of the page (the test stops counting at 60); the counts of the strip, every panel link and every sort button are stops. Nothing is wrong (order is reading order, nothing traps), but a keyboard user crosses the whole page to reach Recent activity. A "skip to panel" list is a follow-up candidate (no new shortcut is needed: links, not keys).
- The matter Overview has 28 stops; each status count and each section is its own link, which is what makes every count open the list it counts.
