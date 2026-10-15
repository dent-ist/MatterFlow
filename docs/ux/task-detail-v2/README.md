# Task detail v2: Workflow, Comments | Assets and a resizable Details panel

Product-owner request: technicians spend most of their time on the Task page and paste long emails (with tables) into the task. Details needs more width, Workflow and Comments less. This replaces the layout described in [../task-detail](../task-detail/README.md) (the single page, the header, the Activity drawer and the old `?tab=` / `?step=` links are unchanged).

## Layout (from 1100 px)

```
+--------------------------------------+-+------------------------------+
| Workflow (60 %)                      |#| Details (40 %, sticky,       |
|   steps, Complete task               |#|  own scroll when taller than |
+------------------+-------------------+#|  the window)                 |
| Comments (30 %)  | Assets (30 %)     |#|  description, requestor,     |
|  composer, sort, | own scroll area   |#|  dates, pod, project, request|
|  search, Show    | (max 60vh)        |#|  form values, Edit details,  |
|  latest 3/5/10/All|                  |#|  Reset layout                |
+------------------+-------------------+#+------------------------------+
                                         # = splitter (role="separator")
```

| Part | Behaviour |
|---|---|
| Splitter | `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max` (left column share, 35 to 70, default 60), `aria-label="Resize Details panel"`. Drag with mouse, pen or touch; Left/Right = 2 %, Shift = 10 %, Home/End = min/max, Enter or double click = 60 / 40. Hover and focus states, `cursor: col-resize`, text selection off while dragging (body `user-select` restored), stays beside the sticky Details panel. Stored per user in `localStorage` (`mf.task-detail.split.<userId>`, try/catch), read before the first render so nothing jumps. "Reset layout" appears in the Details heading when the width is not 60 / 40. |
| Comments | Composer, sort, search and a "Show latest" select (3 / 5 / 10 / All, default 3, remembered per user in `mf.task-comments.limit.<userId>`). The window is the most recent N by date; the sort only orders inside it. "Showing the latest 3 of 12 comments. Show all". A search covers every loaded comment (limit ignored, match count shown). Cancel / On Hold reasons count like other comments; a new comment is the latest and stays visible. The list is a focusable region "Comments list, scrollable" (max 60vh). The server list is now always requested newest first, so the latest comments are in the first page of even a very long thread. |
| Assets | The list is a focusable region "Linked assets, scrollable" (max 60vh), with change role, remove link, Link asset and the no-permission note unchanged. |
| Bottom panels | Side by side while the left column is at least 36 rem wide (container query, so it follows the splitter), otherwise stacked. |
| Step rows | Container queries: below 36 rem of column width the date and status move under the title instead of a fixed right column. |
| Rich text | Class `mf-rich` (`styles/_rich-text.scss`) on comment bodies and the description: tables are their own horizontal scroll box (`display: block; overflow-x: auto; max-width: 100%` on the table, so it works without a wrapper), visible borders, header row tint, zebra rows, 0.875em font, wrapping cells. |
| Below 1100 px | One column: Details (collapsible, collapsed on phones), Workflow, Comments, Assets, "Jump to" row; no splitter; Comments flow; Assets keeps its 60vh scroll area from 600 px up only. |

## Important finding

Neither the task description nor the comment sanitizer keeps tables today: the description is stored and shown as plain text, and `CommentHtml` allows only `p br strong b em i u ul ol li a`. The table styles are in place and verified (e2e puts a 12 column table into the container), but real tables will only appear once the backend allows them (and the description becomes rich text). The sanitizer was deliberately not changed here. In the screenshots the pasted email carries a pipe-separated "table" as plain text, which now wraps inside the 40 % panel.

## Screenshots

Real stack (SQL Server in Docker, API with Dev auth, Chromium), one task with a long pasted email, 6 steps (3rd current), 12 comments, 8 assets. `<width>-before.png` is `dev` before the change, `-after.png` after; `-fold` is the first screen only. `1366-split-40-after.png` and `1366-split-65-after.png` show the splitter dragged to 40 % and 65 %.

Widths: 1920, 1366, 1024, 375. Axe (wcag2a, wcag2aa, wcag21aa, best-practice defaults of axe-core) reports no violations on any of them, before or after.
