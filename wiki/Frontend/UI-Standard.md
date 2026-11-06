# UI Standard

[[_TOC_]]

**What this page is for.** A pointer and a summary of the UI standard. The standard itself is `docs/ux/design-guidelines.md` (rules D-xx). Every UI change must follow it. This page does not replace it: read the file.

## The rule

The owner's rule (`CLAUDE.md`): the app must look and read the same everywhere. For every screen, dialog, drawer, menu, button, chip, link, icon, grid, form, message, date, number or label you create or touch, use the one consistent style from `docs/ux/design-guidelines.md`. Do not interpret it and do not invent a new look. A new pattern must be added to the guidelines in the same change; a look that is not in the guidelines is a defect. The UI designer role owns the file; a new pattern or a reason to break a rule goes to the designer.

## Where things are

| Document | What it is |
|---|---|
| `docs/ux/design-guidelines.md` | The standard: 15 rules that matter most (section 1), component rules (2), the component catalogue (3), wording and formats (4), the checklist (5), automated guards (6), how to change the standard (7), known exceptions (8) |
| `docs/ux/theme-guide.md` | Tokens in three layers, how to adopt them in a page, contrast table, per-screen rules (Dashboard, grids, tabs) |
| `docs/ux/tokens.css` | The design tokens (colours, sizes, radii, shadows) as CSS variables |
| `docs/ux/ui-update/ui-spec.md` | The history of the UI update 2 standard |
| `docs/ux/ui-update/stack-howto.md` | How to start the demo stack for screenshots and crawls |

## The 15 rules in short

1. Use the shared component for the job; no private chip, link, button, dialog, drawer, menu or card.
2. Colours, sizes, radii and shadows come from tokens; no literals.
3. Controls are 36 px high (32 px inside a grid cell or filter row); text buttons stay 24 px.
4. Click it or name it is Title Case; text you read is sentence case.
5. The primary action is the last (rightmost) button; dialog footer `[Cancel] ........ [Primary]`.
6. A page header is `mf-page-header`; a record page `mf-record-header`.
7. Create and edit use the shared dialog (576 px default); a right drawer (520 px) is for reading.
8. Dates are `MM/DD hh:mm AM/PM` (year added when not this year); the long form only in tooltips and sentences.
9. One link style; actions are text buttons.
10. Chips are one of four kinds (status, count, filter, tag); status chips always have icon and word.
11. Every list uses the grid anatomy (rows 44, 36 compact; header 40; pager 25/50/100; identifier first, row action last; no column dropped at a narrow window).
12. Empty, error, loading and missing record use the shared state components and the fixed sentences.
13. A toast names the thing: "Role saved", "Priority added" with a detail line; no toast for what the user can see change.
14. Tabs: `mf-tabs`, 40 px, an icon on every tab.
15. Screenshots at 1366x768 and 1920x1080 for every changed screen, axe 0, guard specs green, the guidelines file updated (its checklist is section 5).

(Section 1 of the guidelines is the authority; this list may lag.)

## Rules added by the UI update 2 reviews

Later decisions sit in section 2 of the guidelines. These are the ones that change what code you write; the component names are in the [Shared Components Catalogue](Shared-Components-Catalogue.md).

| Rule | What to do |
|---|---|
| D-82 Desktop only | 1366x768 and 1920x1080 are the only layouts. A test of a phone or tablet layout (375, 390, 414 px, 768x1024) is deleted with the feature, not skipped. Desktop behaviour checked at a desktop size stays |
| D-10a and D-53a Banner | One notice bar, the `.pg-banner` class (info, danger, success and `--full` variants), always with its icon |
| D-12 Chips | Four kinds only. A task or disposition status is `mf-status-chip`; toggles are `mf-filter-chips` (the `pressed` item option for a multiple choice) |
| D-44f Details card | A record page's fields are one `mf-details-card`; a second group (custom fields) is a second card with a count chip |
| D-44m Record names | A name that opens a drawer or dialog is `mf-btn mf-btn--text mf-btn--name`; a grid row key is the record id, never a name |
| D-44r Form dropdowns | A dropdown inside a form, dialog or record page is `mf-dropdown` with `field` (white). The blue fill is for filter rows and toolbars |
| D-44v Chip buttons and toasts | A pill that opens a dialog is `mf-btn mf-btn--text mf-btn--chip` with the aria-label "Edit <name>". A failed action shows one error toast; give it the `copy` option for a "Copy Reference" button |
| D-42 and D-43 Grid anatomy | A list is `mf-record-grid`; group headers, row classes, clickable rows, the empty sentence and the filters are its options, not a hand-built table (a guard spec fails on a hand-built `pg-table`) |

## Checks before you push UI work (from `CLAUDE.md`)

`npm run lint` (includes the theme colour, contrast, icon-size and off-scale scripts), the guard specs, `tsc` for app, spec and e2e, the Angular template type check, the unit tests, and the build with the initial bundle under 700 kB. Run an accessibility check (axe) on the pages you changed. Say in your report what you did not check. Desktop only (1366x768 and 1920x1080).

## Commit messages for UI changes

First line `<ID> <short what changed>`, a blank line, one bullet per main navigation page (and tab or component) that changed, in the app's own menu and tab names: `- Dashboard > Users: toolbar buttons are taller`. See [Branching and Workflow](../Getting-Started/Branching-and-Workflow.md).

## Related pages

- [Shared Components Catalogue](Shared-Components-Catalogue.md)
- [Testing the Frontend](Testing-the-Frontend.md)
- [How to Add a Page](How-to-Add-a-Page.md)

Last verified against commit 78f445a.
