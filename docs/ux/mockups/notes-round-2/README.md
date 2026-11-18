# Notes round 2 mockup (#1406, epic #1405)

Mockup only: static HTML, CSS and JS, no build, no network, nothing saves, no app code changed. Open `index.html` in a browser (double-click). Sizes: 1366x768 and 1920x1080 (desktop only). `assets/tokens.css` is a copy of `docs/ux/tokens.css`; icons are PrimeIcons (`assets/primeicons.*`); `base.css` is the shared base block of the integrations and one-page Matter mockups; `notes.css` holds the Notes pieces. All data is invented (the matter, people and documents are made up). "Today" is 11/18/2026. No keyboard shortcut is added or changed (#420).

The design note is `docs/ux/notes-round-2/README.md`; section 15 there holds the owner's decisions (a folder shows only its direct notes, so the mockup has no Include Subfolders switch; the tree open or folded choice is remembered per person; images have no per-matter limit and are deleted on save). Screenshots (branch `design-evidence`, folder `notes-round-2-1406`) are listed in its README.

## Scenes

Open with `index.html?scene=<name>`. The small **Mockup Guide** pill (bottom left) lists them.

| Scene | What it shows |
| --- | --- |
| `main` | Matter > Notes: folder tree, list scoped to Custodians > Executive Team, a note open with its folder in the header |
| `new-folder` (`&err=dup\|empty\|long`) | New Folder dialog; the duplicate-name error is shown by default in the screenshot |
| `rename` (`&err=`) | Rename Folder dialog |
| `move-folder`, `move-note` | Move dialogs with the tree of targets; impossible targets greyed with a reason |
| `delete`, `delete-empty` | Delete Folder for a folder with notes (Move Contents Up and Delete) and for an empty folder |
| `drag` | A note dragged onto IT and Records: drop target, label near the pointer |
| `empty-folder`, `empty-tree` | An empty folder; a matter with no folders yet |
| `locked` | A locked note in a folder (Edit disabled, chip) |
| `image` | Image in a note: handles, image bar, size readout (`&rail=0` shows the tree open) |
| `image-details` | Image Details dialog: alt text, presets, exact width, Remove Image far left |
| `image-read` | The image in read mode: no handles, "open full size" |
| `image-fail` (`&reason=size\|type\|count\|offline\|access\|locked`) | One image failed and one uploading; Save off |
| `paste` | Copied from Word, today (plain text only) and round 2 (formatting kept) side by side, with the info toast |
| `plain` | Paste Options menu open: Keep Formatting, Paste as Plain Text |

Other options: `&rail=1` folds the folder tree to its rail; `&chrome=0` hides the guide; `&guide=1` opens it.

## What is not real

The tree, the drag and the dialogs are drawn, not wired: clicking does not change the screen except the Mockup Guide. The screenshot in `image` is a drawn spreadsheet, not a real image. The folder counts and notes are invented and add up (43 notes: the folder counts plus No Folder).
