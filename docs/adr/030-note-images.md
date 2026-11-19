# ADR 030: Images in notes are stored in the database

- Status: **Accepted** (owner decision 2026-11-18, epic #1405, issue #1409; design `docs/ux/notes-round-2/README.md` section 4 and decisions 1, 12, 13 and 15)
- Amends: decision 027 ("No attachments, no file storage anywhere in the system")

## Context

People paste screenshots into notes (a privilege log, an org chart, a custodian list). Notes had no way to keep a picture, and decision 027 says there is no file storage. Three places could hold the bytes: the note body (base64), files on a share, or the database.

## Decision

1. **Decision 027 is narrowed, not dropped.** There are still no attachments and no file storage. The only stored binaries are the application icon (`AppSetting`) and **small, matter-owned images of notes** (`dbo.NoteImage`, script 84).
2. **The bytes live in SQL Server**, in a new table outside the note body: one backup, one transaction with the note, one authorisation rule (the note's matter), no file share to secure and move to the corporate network. Base64 in `BodyHtml` was rejected (200,000-character limit, every list and history call would carry it, the sanitiser would have to accept `data:` URLs). Files on a share and a blob service were rejected (ACLs, backups out of step, orphan files, a new deployment dependency).
3. **The note body holds only a reference:** `<img data-image-id alt width height>`. No `src`, no URL, no data URI: the server never stores or follows a URL, so a pasted page cannot track readers or point the server anywhere. `RichHtmlProfile.Note` allows `img` with exactly those four attributes; the default alt text is "Pasted image", never empty.
4. **Limits.** PNG and JPEG only, found by the bytes (magic bytes, chunk and marker structure, CRC for PNG), never by the declared type or file name; 2 MB per file; 8,000 px on a side (the browser re-draws images to at most 1,600 px and strips metadata, the server verifies anyway); 20 images per note; **no per-matter limit and no quota**; a technical guard of 50 unsaved uploads per person. No image library on the server: the header is read by about 150 lines of code (design risk R4; ImageSharp needs a commercial licence for a firm of this kind, SkiaSharp would be an option if server re-encoding is ever wanted).
5. **Delete as soon as nothing uses an image, no retention.** An image no saved note uses is deleted in the same transaction as the save that dropped its last reference; Cancel and Discard call `DELETE /note-images/{id}` (only the uploader); deleting a note deletes its images; a quiet nightly sweep (`NoteImageSweeper`, 02:20 UTC) removes unreferenced uploads older than 48 hours, as a crash safety net only. There is no 7-day wait.
6. **An image is never shared.** A copy of a note, a note pasted into another note, and a note pasted into another matter each get their own server-side copy of the image (`POST /note-images/{id}/copy` for another matter needs `MatterNote.Edit` on the target). Deleting a note therefore deletes exactly its images.
7. **Access follows the note's matter.** Read needs `MatterNote.View`, upload, copy and Cancel need `MatterNote.Edit`; a hidden matter answers 404, the same as a missing image (also on a save that names such an image). The bytes are served only through `GET /api/v1/notes/images/{id}` (`nosniff`, `inline`, a sandbox CSP, `Cache-Control: private, no-cache`, SHA-256 `ETag`). No permission is added.
8. **Templates carry no images** (a template is not tied to one matter); saving one strips them and reports how many were left out.
9. **The report login cannot read the table** (`db/report-access.json`: deny), like the other Notes tables.

## Consequences

- The database grows with the pictures people keep. Only images in saved notes stay, so the size is bounded by what people actually write; the DBA should plan headroom (a screenshot is typically 100 to 500 KB; a matter with 50 notes and two images each is about 40 MB).
- The Content Security Policy of the application gains `blob:` in `img-src` (an editor that fetches an image through the API client shows it from a blob URL its own script made). A plain `<img src="/api/v1/notes/images/{id}">` works under Windows authentication and `'self'` without that change.
- A save that drops an image while another tab or an unsaved "Copy My Text" still points at it is accepted: the image is gone, the save of that text answers 400 `IMAGE_NOT_FOUND` with the ids, and the editor drops the node and keeps the text (design R18).
- Image pixels are not searched (no OCR); only the alt text is part of the note's search text. AI features must treat note images as not readable until a policy exists (design R7).
