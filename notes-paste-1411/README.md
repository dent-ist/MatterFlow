# Evidence for #1411: formatted paste into a matter note (epic #1405)

Real stack (Playwright e2e `notes-paste`, Dev auth), Chromium, desktop sizes 1366x768 and 1920x1080, real SQL Server. Each file ends in the width.
The paste events are simulated (dispatched ClipboardEvent with a hand-written Word-like clipboard); no real Word clipboard was used.
Only the "after" is shown; the "before" (plain text only: one flat run, typed bullets, tab-separated rows, no link) is the middle panel of the approved mockup `docs/ux/mockups/notes-round-2/?scene=paste`.

| File | What it shows |
| --- | --- |
| 01-word-after | Word text pasted into a new note: heading, bold, italic, nested list, table, link; red, highlight and strikethrough gone; the hidden paragraph gone; the chip "Pasted with formatting" under the text; the info toast "Pasted without 2 images" |
| 02-options-menu | The chip's menu: Keep Formatting (checked), Paste as Plain Text, the Ctrl + Shift + V tip |
| 03-as-plain-text-after | After Paste as Plain Text: the same paste as paragraphs, no chip |
| 04-tracked-toast | Tracked changes: inserted text kept, deleted text dropped, toast "Pasted without tracked deletions" |
| 05-too-many-cells | A 1,240-cell table: nothing inserted, inline message above the text |
| 06-saved-read-mode | The note after Save and a reload, read mode: the server sanitiser kept what the client kept |

Not checked: a real Word, Outlook, Excel or Google Docs clipboard on a real machine; dark mode; the page at other sizes.
