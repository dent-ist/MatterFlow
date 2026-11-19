# Evidence for #1410: pasted images in the note editor (epic #1405)

Real stack (Playwright e2e `notes-images`, Dev auth), Chromium, desktop sizes 1366x768 and 1920x1080, real SQL Server. Each file ends in the width. Data is made up (matter "Image Matter", a drawn spreadsheet screenshot "Privilege Log - Batch 3.xlsx", as in the approved mockup `docs/ux/mockups/notes-round-2/`). The "before" is a note editor that could not take a picture (a picture-only paste inserted nothing). Axe (WCAG 2.2 AA) is 0 on every state in the e2e spec; the screenshots are taken from the same states. At most 15 images (the e2e spec writes 28; the rest are the other size of a state shown here).

| File | What it shows |
| --- | --- |
| 1-uploading (1366) | A screenshot was pasted: the placeholder "Adding image..." with the file name, size and the sliding progress bar; Save is off and the sentence under the text says why |
| 2-selected | The pasted image inserted at 720 px (natural 1200 px), selected: outline, four corner handles, the size readout "720 x 450 px · 60% of original" and the image bar (Large pressed). At 1366 the text box is short, so the bar floats over the visible part of the image |
| 3-resize-drag (1366) | Dragging the south east corner: ratio locked, live readout "480 x 300 px · 40% of original" |
| 4-image-details | Image Details: thumbnail, Alt Text (counter 25 / 200), the five size buttons, Width (px) with "Height follows: 375 px. Original is 1200 x 750 px.", Remove Image far left |
| 5-failed-retry | The upload did not finish: the red block "Couldn't add the image." with the reason, Retry and Remove; no toast; Save off with its sentence |
| 6-failed-too-large (1366) | A photo that is still over 2 MB after shrinking: the reason and Retry, Remove |
| 7-read-mode | The saved note after a reload: the image at its stored size (shrunk to the column, ratio kept), no handles, no bar |
| 8-missing-image (1366) | The image bytes answer 404 (removed by another save): "This image is no longer available." in the failure colours with Remove in edit mode; the text stays |
| 9-read-only (1920) | A person with Matter Note View only: the image without handles, "Read only" |
| 10-locked-note (1366) | A locked note: read mode for everybody, the image without handles |
| 11-save-as-template (1920) | Save as Template: "1 image will be left out of the template." |

Not in the screenshots (covered by the e2e spec and axe): the wrong-type refusal, the 20-image limit, the inactive-matter refusal, Cancel deleting an unsaved upload, Undo, a picture pasted from another matter's note (copied, id swapped), pictures inside Word text (still left out with the toast), the other size of each state.
Not checked: a real OS clipboard (the e2e paste is a dispatched ClipboardEvent with a PNG drawn in the page), Edge or Firefox, a screen reader, dark mode, other window sizes.
