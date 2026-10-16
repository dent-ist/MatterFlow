# Rich text Task description with safe tables (issue #80, decision R)

Technicians paste long email instructions, often with tables, into the Task description. The description (and comments) are rich text now: bold, italic, bulleted and numbered lists, links and **tables**, nothing else. Everything is sanitized on the server by one allow-list (see `docs/requirements/decisions-addendum.md` section R and `docs/qa/security-review-2-resolutions.md` Addendum 3). Screenshots are taken with `frontend/e2e/tests/rich-description-screens.spec.ts` at 1366x768 and 375x812 (a real Chromium against a real stack), with axe (wcag2a, wcag2aa, wcag21aa, wcag22aa) run on the description area of every shot: no violations.

```
E2E_SCREENSHOTS=$PWD/docs/ux/rich-description E2E_AXE_PATH=/path/to/axe.min.js frontend/e2e/run-local.sh -g "rich description screenshots"
```

## What was built

| Where | Behaviour |
|---|---|
| Create task, Edit dialog | The Description is the rich text editor (`mf-rich-text-editor`) with an **Insert table** button (Rows 1-8, Columns 1-8, Header row). With the caret in a table a second toolbar offers Row above / below, Delete row, Column left / right, Delete column, Delete table (merged cells are stretched or shrunk, never duplicated). |
| Paste and drop | HTML from Outlook, Word or a web page is rebuilt from the allow-list before it is inserted: tables with merged cells and header scopes, bold, italic, underline, lists, links; styles, classes, `mso-*`, `o:p`, conditional comments, fonts, images, forms and scripts are gone. A table over 200 cells is pasted as text with a notice. A drop is handled like a paste; dropped files are refused. |
| Keyboard | Tab and Shift+Tab move between cells and, at the first and last cell, leave the editor (no keyboard trap). Every table action is announced in a polite live region ("Row added below. Now row 3 of 3, column 2 of 2."). The table buttons are ordinary buttons in the tab order. |
| Details panel (read view) | A saved table sits in its own named, focusable scrolling box (`role=region`, `aria-label="Table"`), so a wide table scrolls sideways inside the panel (also with the arrow keys) instead of widening the page. Header cells are tinted, rows zebra-striped, text a little smaller, words are not broken in the middle. A description saved as plain text before this change is shown escaped with its line breaks. |
| Email intake | An `.eml`/`.msg` file keeps its HTML body (tables included) as the description; so does a pasted email when the browser has its HTML (the header lines are dropped, their values fill the fields). Over a limit, the plain text is used with a warning. The privilege reminder stays. |
| Limits | 200 table cells, nesting depth 3, 20,000 visible characters, 100,000 characters of HTML; clear field errors `TABLE_TOO_LARGE`, `HTML_TOO_LARGE`, `TOO_LONG`, `TOO_COMPLEX`. |

## Screens

| File | Shows |
|---|---|
| `create-editor-1366.png`, `create-editor-375.png` | Create task: an Outlook table pasted into the Description, the caret in a cell, the table toolbar showing. |
| `create-insert-table-1366.png`, `create-insert-table-375.png` | The Insert table form. |
| `details-1366.png`, `details-375.png` | The saved task: the table in the Details panel (at 375 the panel is opened with its disclosure button and the table scrolls). |
| `edit-dialog-1366.png`, `edit-dialog-375.png` | Edit task details: the same table in the editor. |
| `email-intake-review-1366.png` | An `.eml` with an HTML table in the review step of Quick fill from email. |

## Accessibility

- axe on the description (read view, editor in Create and in the Edit dialog, email review) at both sizes: no violations. Whole-page axe of the Task page is not asserted by this feature; it has violations of its own that this change does not touch.
- The scrolling table box is focusable and named (axe `scrollable-region-focusable`), found and fixed during this work.
- Keyboard: insert a table, fill it, move with Tab, add a row with the table toolbar and save, all without a mouse (`rich-description.spec.ts`).

## Not done (deferred)

- No cell merge or split command in the toolbar (merged cells that arrive by paste are kept and edited correctly).
- Column widths, alignment and cell colours are not kept (no styling is allowed by design).
- Undo does not restore a row or column removed with the table buttons (browser undo covers typing and pastes).
