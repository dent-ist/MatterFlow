# Evidence for #1408: the folder tree of Matter > Notes (epic #1405)

Real stack (Playwright e2e `notes-folders`, Dev auth), Chromium, desktop sizes 1366x768 and 1920x1080, real SQL Server. Each file ends in the width. Data is made up (matter "Folder Matter", folders and notes as in the approved mockup `docs/ux/mockups/notes-round-2/`).
Only the "after" is shown. The "before" is the Notes tab without a tree: the list and the note only (no folders existed). Axe (WCAG 2.2 AA) is 0 on every state in the e2e spec; the screenshots are taken from the same states.

| File | What it shows |
| --- | --- |
| 1-tree-folder | Notes tab with the tree open: All Notes, No Folder, Custodians opened with its subfolders, direct counts; Executive Team selected, path bar "Custodians > Executive Team" with its count, a note open with its place in the header |
| 2-row-menu | The "..." menu of a folder row: New Subfolder, Rename, Move to Folder..., Copy Link, Delete Folder |
| 3-new-folder-error | New Folder in Custodians with a duplicate name: the sentence under the field |
| 4-move-folder | Move Folder: the picker with the folder itself, its subfolders and where it is greyed, each with a reason |
| 5-move-note | Move Note from the note's Actions menu |
| 6-delete-with-contents | Delete Folder for a folder with contents: refused as it is, "Move Contents Up and Delete" offered, no note is deleted |
| 7-rail | The tree folded to its rail (Show Folders, All Notes, the current folder) |
| 8-drag (1366 only) | A note dragged onto IT and Records: drop target outline, the label near the pointer, the folders that cannot take it greyed |

Not in the screenshots (covered by the e2e spec and axe): first use "No folders yet.", empty folder, empty No Folder, read-only person, locked note moved, search inside a folder with Search All Notes, delete of an empty folder, a folder name with a slash, Undo toasts.
Not checked: a real browser drag on a real machine (the e2e drag is Playwright's simulated HTML5 drag), dark mode, other window sizes.
