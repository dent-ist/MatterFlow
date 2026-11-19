# Work with Note Images

[[_TOC_]]

**What this page is for.** How images pasted into a matter's notes work in the backend (epic #1405, issue #1409): where the bytes live, the limits, the endpoints, the error codes, how an image is cleaned up, and what the editor (issue #1410) must do. The decision is `docs/adr/030-note-images.md`; the design is `docs/ux/notes-round-2/README.md` section 4. The screen is issue #1410 (rule D-46d in `docs/ux/design-guidelines.md`); it is described under "The screen" below.

## The rules

| Rule | How it is kept |
|---|---|
| The bytes are in the database, in `dbo.NoteImage`, owned by the matter, never in the note body | Script 84; ADR 030 narrows decision 027 |
| The body holds only `<img data-image-id alt width height>`: no `src`, no URL, no data URI, no other attribute | The `Note` profile of `RichHtml` (SharedKernel); the other profiles still drop every image |
| Alt text is plain text, up to 200 characters, never empty ("Pasted image" by default) | `RichHtml` |
| PNG and JPEG only, found by the bytes, never by the declared type or the file name; 2 MB; 8,000 px on a side | `NoteImageInspector` (no image library), checked again by the table constraints |
| 20 distinct images per note; no per-matter limit; at most 50 unsaved uploads per person (a technical guard) | `NoteContent`, `NoteImageService` |
| An image no saved note uses is deleted in the same transaction as the save that dropped its last reference; no retention | `NoteService` with `NoteImageService.DeleteUnusedAsync` |
| Cancel and Discard delete an unsaved upload: only the uploader, only while no saved note uses it | `DELETE /note-images/{id}` |
| Deleting a note deletes its images | `NoteService.DeleteAsync` |
| An image is never shared: a note that names an image another note already uses gets its own copy (the body gets the new id); another matter gets a copy through `/copy` | `NoteImageService.SeparateSharedAsync` |
| A template carries no images | `NoteContent.StripReferences`; the answer has `imagesLeftOut` |
| A quiet nightly sweep removes unreferenced uploads older than 48 hours (a crash net, 02:20 UTC, batches of 100, counts logged, no audit) | `NoteImageSweeper` |
| A hidden matter's image is a 404, identical to a missing id; a save that names one gets `IMAGE_NOT_FOUND`, the same as for a missing image | `NoteAccess`, `NoteImageService.VerifyAsync` |
| Search finds a note by the alt text of its images (appended to `BodyText`); the title and the snippet never use it; pixels are not searched | `NoteContent` |

## Endpoints

| Call | Permission | Notes |
|---|---|---|
| `POST /api/v1/matters/{matterId}/note-images` | `MatterNote.Edit` | `multipart/form-data`, field `file`; the matter must be active; 201 `{ noteImageId, matterId, width, height, contentType, byteSize }`; audited |
| `GET /api/v1/notes/images/{noteImageId}` | `MatterNote.View` | The bytes. `Content-Type` from the stored bytes, `nosniff`, `Content-Disposition: inline`, a sandbox CSP, `Cache-Control: private, no-cache`, `ETag` (SHA-256), 304 on `If-None-Match`. Readable for an inactive matter |
| `DELETE /api/v1/note-images/{noteImageId}` | `MatterNote.Edit` | Cancel and Discard; 204; not audited |
| `POST /api/v1/note-images/{noteImageId}/copy` | `MatterNote.Edit` | `{ targetMatterId }`; a separate copy in another matter (both visible, target active); 201 |
| `POST /api/v1/notes`, `PUT /api/v1/notes/{id}` | `MatterNote.Edit` | The body may name images of the note's matter |
| `POST` and `PUT /api/v1/note-templates` | `MatterNote.Edit` | Images are stripped; `imagesLeftOut` in the answer |

## Error codes

- Upload: 413 `IMAGE_TOO_LARGE` (over 2 MB or 8,000 px; `meta.maxBytes`, `meta.maxPixels`; a request body above 2 MB plus the multipart envelope is refused before it is read), 415 `IMAGE_TYPE_UNSUPPORTED`, 400 `IMAGE_CORRUPT`, 400 `IMAGE_REQUIRED`, 409 `MATTER_INACTIVE`, 409 `TOO_MANY_PENDING_IMAGES` (`meta.limit`), 404 for a hidden or missing matter.
- Delete: 403 `NOT_IMAGE_UPLOADER`, 409 `IMAGE_IN_USE`, 404 when it is already gone.
- Note save: 400 with `errors.bodyHtml`: `TOO_MANY_IMAGES` (20), `IMAGE_NOT_FOUND` (`meta.imageIds`), `IMAGE_NOT_IN_MATTER` (an image of another matter you can see; `meta.imageIds`).

## Audit events

`NOTE_IMAGE_ADDED` (object type `NoteImage`, the matter, a summary such as "PNG, 1200 x 800 px, 84 KB"; never the content), written at upload and at a copy. An edit that only changes images or alt text is a `NOTE_EDITED`. Deleting an image, the sweep and reads are not audited.

## What the editor (issue #1410) must do

1. **Show the image by fetching it through the API client** and using a blob URL (`URL.createObjectURL`), with a small in-memory cache per id. Why: in Development and Test the Dev provider names the user by the `X-Dev-User` header (and an impersonating admin has the same need), which a plain `<img>` cannot send, and the client can show a clean "removed" or "no access" state on a 404. In production (Windows authentication, same origin) a plain `<img src="/api/v1/notes/images/{id}">` would also work because the browser sends the credentials and a GET needs no custom header, but one code path that works everywhere is safer.
2. **CSP.** The application policy now allows `img-src 'self' data: blob:` (`SecurityHeadersMiddleware`, set by the backend; `deploy/web.config` deliberately adds no security headers and there is no nginx in the repository). Nothing else to change in IIS.
3. **Upload** with `multipart/form-data` field `file` through the generated client (`uploadNoteImage(matterId, { data, fileName })`); the state-changing header is added by the existing interceptor. Re-draw to at most 1,600 px and strip metadata before upload; the server rejects anything else by content.
4. **Cancel and Discard** call `deleteNoteImage` for every image uploaded in the session and not saved; ignore 404 and 409 (`IMAGE_IN_USE`).
5. **Save answers to handle:** `IMAGE_NOT_FOUND` with `meta.imageIds` (drop those nodes, keep the text, save again: the "image is no longer available" state), `TOO_MANY_IMAGES`, and 409 `CONCURRENCY_CONFLICT` as today. After a save, use the returned `bodyHtml`: if a note named an image another note already uses, the server copied it and the body carries the new id.
6. **Copying text between matters:** call `copyNoteImage(id, { targetMatterId })` for each image of the pasted text and swap the id; an image of another matter fails the save with `IMAGE_NOT_IN_MATTER`.
7. **Template save:** read `imagesLeftOut` and say "N images were left out of the template."
8. `references` of a note never lists images; read the images from the body.

## The screen

Matter > Notes: a person pastes a screenshot or a copied image into the note editor (there is no Insert Image button and no file drop; no keyboard shortcut). The seven points above are done like this:

| Part | What it does | Where |
|---|---|---|
| Paste | A picture-only clipboard (and a clipboard whose text is gone after clean-up, such as Edge's Copy Image) uploads the picture files; a clipboard with text or a table keeps the text (Excel); pictures inside pasted Word or Outlook text are still dropped with the toast of D-46b. Nothing is pasted in a template (no matter) | `notes/note-editor.ts` (`handlePaste`, `imageFilesOf`), `note-paste.ts` |
| Re-draw | The browser draws the image on a canvas: long side at most 1,600 px, PNG; over 2 MB a JPEG at 0.85 on white; still over: `size`; not decodable: `type`. Metadata is gone | `note-image-prepare.ts` |
| Upload | Placeholder in the text (plugin state, not in the document), two uploads at a time, inserted in pasted order, in ONE transaction with the removal of the placeholder (one Undo). Failure block with Retry and Remove; reasons in `IMAGE_COPY`; `failureOf` maps the API codes; Save stays off while a placeholder exists or a copy runs (`imagesBusy` output, `NotesTab.imagesBusy`) | `note-image-uploader.ts`, `note-image-upload.ts`, `note-image-copy.ts` |
| Show | Fetched through `getNoteImage` and shown as a blob URL, cache of 80 ids (a failure is not cached); a 404 or 403 is the "missing image" block | `note-image-store.ts`, `note-image-node.ts` |
| Resize | Corner handles (aspect locked, 48 px to the natural width and the room), live readout, the image bar presets, Image Details (alt text up to 200 characters, exact width). Sums in `note-image-size.ts`. Stored as `width` and `height` | `note-image-node.ts`, `note-editor.ts` (Image Details), `note-image-size.ts` |
| Cancel and Discard | `NoteImageStore` remembers the images uploaded or copied in the editing session; `discardSession` calls `deleteNoteImage` for each (404 and 409 ignored); a save calls `keepSession` and shows the returned `bodyHtml` | `notes-tab.ts` (`restore`, `proceedDiscard`, `save`) |
| Save answers | `IMAGE_NOT_FOUND` and `IMAGE_NOT_IN_MATTER` (`meta.imageIds`): the nodes go, the text stays, the save is repeated once, an info toast says how many; `TOO_MANY_IMAGES` is said under the editor | `notes-tab.ts` (`save`), `NoteEditor.dropImages` |
| Between matters | A pasted note's own pictures (`<img data-image-id>` with no address) are copied with `copyNoteImage` into this matter and the ids swapped (a failure takes the picture out and says so) | `note-paste.ts` (`imageIds`), `note-editor.ts` (`adoptImages`) |
| Templates | The Save as Template dialog says "N images will be left out of the template."; the toast reads `imagesLeftOut` | `notes-tab.ts` |
| History | `noteHistoryText` words NOTE_MOVED and NOTE_IMAGE_ADDED; the audit browser shows "Note image added" and the object type "Note image" | `note-ui.ts`, `shared/ui/audit-format.ts` |

Tests: unit `notes/note-image-size.spec.ts`, `note-image-prepare.spec.ts`, `note-image-store.spec.ts`, `note-image-copy.spec.ts`, `note-editor-images.spec.ts`, `note-paste.spec.ts`; e2e `frontend/e2e/tests/notes-images.spec.ts` (both desktop sizes, axe).

## Where things are

- Script: `db/scripts/84-note-images.sql`; report login: `db/report-access.json` (deny).
- Code: `backend/src/Modules/LptHub.Notes` (`Application/NoteImageService.cs`, `NoteImageInspector.cs`, `NoteContent.cs`, `Infrastructure/NoteImageSweeper.cs`, `Api/NoteControllers.cs`, `Api/NoteImagesOpenApi.cs`), `backend/src/LptHub.SharedKernel/Text/RichHtml.cs`, `backend/src/LptHub.Api/Http/SecurityHeadersMiddleware.cs`.
- Tests: `UnitTests/Notes/NoteImageSanitiserTests`, `NoteImageInspectorTests`; `IntegrationTests/Notes/NoteImagesApiTests`; `SchemaTests/NoteImagesSchemaTests`; the two endpoint catalogues in `IntegrationTests/Security`.

## Related pages

- [Work with Note Folders](Work-with-Note-Folders.md)
- [Module Guide](../Backend/Module-Guide.md)
- [Table Reference](../Database/Table-Reference.md)
- [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)

Last verified against commit 0acb7794.
