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
11. Every list uses the grid anatomy (rows 44, header 40, pager 25/50/100).
12. Empty, error, loading and missing record use the shared state components and fixed sentences.
13. A toast names the thing: "Role saved".
14. Tabs: `mf-tabs`, 40 px, an icon on every tab.
15. Screenshots at 1366x768 and 1920x1080, axe clean, guard specs green, guidelines updated.

(Section 1 of the guidelines is the authority; this list may lag.)

## Checks before you push UI work (from `CLAUDE.md`)

`npm run lint` (includes the theme colour, contrast, icon-size and off-scale scripts), the guard specs, `tsc` for app, spec and e2e, the Angular template type check, the unit tests, and the build with the initial bundle under 700 kB. Run an accessibility check (axe) on the pages you changed. Say in your report what you did not check. Desktop only (1366x768 and 1920x1080).

## Commit messages for UI changes

First line `<ID> <short what changed>`, a blank line, one bullet per main navigation page (and tab or component) that changed, in the app's own menu and tab names: `- Dashboard > Users: toolbar buttons are taller`. See [Branching and Workflow](../Getting-Started/Branching-and-Workflow.md).

## Related pages

- [Shared Components Catalogue](Shared-Components-Catalogue.md)
- [Testing the Frontend](Testing-the-Frontend.md)
- [How to Add a Page](How-to-Add-a-Page.md)

Last verified against commit 2e446f8.
