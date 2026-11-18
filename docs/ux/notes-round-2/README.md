# Notes round 2: folders, pasted images, formatted paste (design note)

Issue #1406, epic #1405. **Design only.** No application code, no schema script and no OpenAPI change are in this branch. Mockup: `docs/ux/mockups/notes-round-2/` (open `index.html`). Screenshots: branch `design-evidence`, folder `notes-round-2-1406`.

Written 2026-11-18 for the owner and the UI designer; updated the same day with the owner's decisions. Where a rule here differs from `docs/ux/design-guidelines.md`, the guideline wins until the designer approves the change (section 14 lists the new patterns).

## 0. The short version

The owner asked for three things on the Notes tab of a Matter.

1. **Folders for notes**, nested like a file explorer, per Matter. Tags stay.
2. **Copy and paste an image into a note, and resize it.**
3. **Keep the formatting when formatted text is pasted.**

What this note proposes:

| Request | Proposal in one paragraph |
| --- | --- |
| Folders | A folder tree on the left of the Notes tab (All Notes, No Folder, then the folders). A note is in one folder or in none. Folders belong to one matter, nest up to 5 levels, have unique names inside a parent, and are created, renamed, moved and deleted by people who can edit notes (delete: who can delete notes). A folder can be deleted only when empty, or with "Move Contents Up and Delete". Notes move by the "Move to Folder" menu item or by drag. Tags, pinning, lock, search and the three views keep working inside the selected folder. No new permission. |
| Images | A pasted image is uploaded at once, stored in a new SQL Server table (outside the note body), and the body keeps only a small reference (`<img data-image-id alt width height>`, no URL). PNG or JPEG, at most 2 MB, at most 20 per note. Resize by corner handles with a live size readout, by presets, or by an exact width in "Image Details". An image no saved note uses any more is deleted when the note is saved; an image uploaded but never saved is deleted when the editor is cancelled; deleting a note deletes its images. No per-matter size or count limit. **This amends architecture decision 027 ("no file storage"); the owner has decided yes (question 1).** |
| Formatted paste | The client stops flattening paste to plain text. It cleans Word, Outlook, Google Docs, Excel and web HTML, keeps what the note can already hold (headings, bold, italic, underline, lists, tables, links, quotes) and drops the rest (colours, fonts, highlight, strikethrough, page layout). After a paste a "Paste Options" chip offers "Keep Formatting" and "Paste as Plain Text". The server sanitiser needs almost no change for this; it does need to drop hidden text. |

**All 20 open questions were decided by the owner on 2026-11-18** (section 15). The design below follows those decisions.

**No keyboard shortcut is added or changed** (owner decision 2026-11-10, #420). Every action in this design has a button or a menu item. The keys that appear (arrows in the folder tree, Esc, Enter, Tab) are the keys of a widget while it has focus, like the splitter's keys; no F2, no Delete key, no Ctrl+Shift+N. Ctrl+Shift+V is the browser's own "paste as plain text"; the design only makes sure it keeps working (section 5.5).

## 1. What exists today (facts checked in the code)

| Topic | Fact | Where |
| --- | --- | --- |
| Layout | One white card. List on the left (default 380 px, resizable), the open note on the right. Views By Tag, Latest, Templates; View Options holds sort, tag filter and Collapse all. | `frontend/src/app/features/notes/notes-tab.ts` (`views` at 1816, template from 100) |
| List loading | The client loads **all** notes of the matter (up to 10 pages of 100) with the text search done by the server, and filters by tag and Locked in the browser. | `notes-tab.ts` `loadList` 2530, `items` 1854 |
| Paste | `handlePaste` inserts `text/plain` only. Drop is blocked (`handleDrop: () => true`). Comment in the code: "no foreign markup". | `note-editor.ts` 1261 |
| Editor schema | TipTap StarterKit: paragraphs, headings 1 to 3, bold, italic, underline, bullet and numbered lists, quote, links, tables, a colour mark (`span[data-color]`, 8 palette keys), reference chips, embedded notes. Strike, code, code block, horizontal rule are switched off. No image node. | `note-editor.ts` 188 |
| Sanitiser | `RichHtml` with `RichHtmlProfile.Note`: allow-list of tags and attributes, no `style`, no `class`, no `img`, links only http, https, mailto, onenote. The result must be a fixpoint. Limits for notes: 400,000 input characters, 200,000 stored, 20,000 tags, depth 20, 1,000 table cells. | `backend/src/LptHub.SharedKernel/Text/RichHtml.cs`, `RichHtmlGuard.cs` (`RichHtmlLimits.Note`) |
| Note rules | Title is the first line, snippet the text after it, `BodyText` is the search text. `NoteLink` is rebuilt from the saved body (types ASSET, PROJECT, MATTER, NOTE, USER; check constraint `CK_NoteLink_Type`). At most 200 references. | `backend/src/Modules/LptHub.Notes/Application/NoteContent.cs` |
| Notes table | `dbo.Note` (MatterId, Title, Snippet, BodyHtml, BodyText, IsPinned, lock columns, ContentUpdated, audit columns, RowVersion) and `UQ_Note_IdMatter (NoteId, MatterId)`. `NoteTag`, `NoteTagLink`, `NoteLink`, `NoteTemplate`, `NoteTemplateTag`. | `db/scripts/00-baseline.sql` 1575 to 1680 |
| Access | Every endpoint applies the sensitive-matter rule: a hidden matter is a 404. Permissions `MatterNote.View`, `.Edit`, `.Delete`. Tags are firm-wide. | `NoteAccess.cs`, `NoteControllers.cs`, `contracts/permissions.json` |
| Lock | A locked note is read only for everybody (409 `NOTE_LOCKED` on save and delete). Pin still works on a locked note. Only the locker or an administrator unlocks. | `NoteService.cs` 212 to 393 |
| History | The audit trail, object type `Note`; events NOTE_CREATED, EDITED, TAGS_CHANGED, LOCKED, UNLOCKED, PINNED, UNPINNED, SAVED_AFTER_AI_WARNING, DELETED. | `NoteService.cs` 28 to 37, `note-ui.ts` `noteHistoryText` |
| Templates | Three levels (System, Client, Matter). A template is not tied to a matter at System and Client level, so reference spans are stripped when it is saved. Using one copies its text. | `NoteTemplateService.cs` 264, `NoteContent.StripReferences` |
| Files | **There is no file store.** Decision 027: "No attachments, no file storage anywhere in the system." Binary exceptions: the branding icon (256 KB, in `dbo.AppSetting.ValueBinary`) and intake e-mail parsing in memory. | `docs/architecture.md` decision 027, `00-baseline.sql` `AppSetting`, `BrandingControllers.cs` |
| Request limits | Default request body limit 2 MB (`RequestBodyLimitMiddleware`); an upload route raises it itself (branding does). State-changing calls need `X-LptHub-Client: web` and a JSON or multipart body. | `backend/src/LptHub.Api/Http/` |
| Security headers | CSP has `img-src 'self' data:`, so same-origin images load and remote images do not. | `SecurityHeadersMiddleware.cs` |
| Background jobs | `BackgroundService` classes exist (report result sweeper, run retention, notification scheduler): the pattern for a clean-up job. | `LptHub.Reports/Infrastructure/ReportResultSweeper.cs` |
| AI seam | `beforeSave(html)` on the Notes tab lets a future AI policy check the text before a save. Images are invisible to it. | `notes-tab.ts` 1803 |
| Search | The Notes tab searches title and text of one matter (`q`, SQL `LIKE`). I found no Notes code in the global search module. | `NoteService.ListAsync` 51 |
| Matter page | The one-page Matter has a compact Notes section with "Open Full View" (`?tab=notes`). | `features/matters/pages/matter-detail-page.ts`, `matters/ui/matter-notes-section.ts` |

## 2. Scope and non-goals

In scope: the three requests, for the Notes tab (full view) of a Matter, desktop only (1366x768, 1920x1080).

Not in this round, on purpose: files other than images; drag and drop of files into a note (drop stays blocked); an "Insert Image" file button (decided, question 17); shared folders across matters; folder templates (decided, question 19: follow-up issue); "Duplicate Note"; sorting folders by hand; folder-level permissions; images in note templates; OCR of images; Word RTF picture extraction; mobile layouts.

## 3. Folders

### 3.1 Model

- A **folder** belongs to one matter and has a name and an optional parent. A **note** is in zero or one folder. "No folder" is a place of its own (the top level), not a folder row.
- Two virtual entries on top of the tree: **All Notes** (every note of the matter, in any folder, count = all notes) and **No Folder** (notes at the top level). Counts are **direct**: a folder's number is the notes in it, not in its subfolders. The numbers add up: the folder counts plus No Folder equal All Notes. A parent shows no rolled-up number, so clicking "(5)" never shows a different number of notes.
- Existing notes stay at the top level ("No Folder"). No backfill, no default folders (status: LPT Hub is not deployed).
- Folders are **not** tags. A note keeps its tags whatever folder it is in. Tags stay firm-wide and administrator managed. A tag is a label across folders; a folder is a place.

### 3.2 Rules

| Rule | Decision |
| --- | --- |
| Scope | One matter. A folder, its parent and its notes are always in the same matter; the database enforces it with composite foreign keys (3.3). A note cannot be moved to another matter's folder. |
| Depth | Top-level folders are level 1. At most **5 levels** (decided, question 2). Create, move and "Move Contents Up" check it, including the height of the moved subtree. Error `FOLDER_TOO_DEEP`: "Folders can be nested up to 5 levels." |
| Number | At most **200 folders per matter** (`FOLDER_LIMIT`). The tree is not virtualised, so a cap keeps it fast. |
| Name | 1 to 100 characters after trimming, no `/` or `\`, no control characters. **Unique inside the same parent**, case-insensitive (the database collation), also at the top level. Error `FOLDER_NAME_TAKEN` with the sentence "A folder named "Finance" already exists in Custodians." shown under the field. Two different parents may both have "Finance". |
| Order | Alphabetical, natural order ("Volume 2" before "Volume 10"). No manual order. |
| Create | Needs `MatterNote.Edit` and a matter that is active (same as New Note: an inactive matter is 409 `MATTER_INACTIVE`). The new folder is created in the selected folder (toolbar "New Folder") or in the folder whose menu you used ("New Subfolder"). The dialog asks for the name only: it says where the folder will be created, and does not open a second dialog to choose a parent (D-31). |
| Rename | `MatterNote.Edit`. Same name rules. Notes and subfolders are untouched. |
| Move a folder | `MatterNote.Edit`. Into any folder of the same matter or to the top level, except itself and its own subfolders (`FOLDER_CYCLE`) and except where the 5-level limit would break. The "Move Folder" dialog lists the whole tree with the impossible targets greyed and a reason ("This folder", "Inside it", "Too deep") so the person never gets an error after the click. A name clash in the target is `FOLDER_NAME_TAKEN`. |
| Delete | `MatterNote.Delete`. A folder holding notes or subfolders cannot be deleted as it is (`FOLDER_NOT_EMPTY`, with the counts in `meta`). The dialog then offers **"Move Contents Up and Delete"**: notes and subfolders go to the parent (or the top level), then the empty folder is deleted. If a moved subfolder's name clashes with a folder already in the parent, the action is refused naming the clash (`FOLDER_NAME_TAKEN`); nothing is renamed automatically. **Notes are never deleted by deleting a folder.** An empty folder gets the plain confirm "Volume 002 is empty. This can't be undone." with a solid red "Delete Folder" (D-34). Locked notes inside move like any note (a locked note can be moved, 3.5). |
| Move a note | By "Move to Folder..." in the note's More menu, by the same item in a list row menu, or by dragging the row onto a folder. `MatterNote.Edit`. Does not change Last Updated, tags, pin, lock or the body. Audited. Offers **Undo** in the toast (D-34: a reversible action does not ask). |
| Concurrency | Every folder carries a `RowVersion`; rename, move and delete send it (409 `CONCURRENCY_CONFLICT`, "This folder was changed by someone else." + "Reload Latest"). Folder structure changes in one matter are serialised with an application lock (`sp_getapplock` on the matter) so two people cannot create a cycle by moving A into B and B into A at the same moment. |
| Who sees what | Folders are visible to everybody who can see the matter and read notes (`MatterNote.View`). A hidden (sensitive) matter has no folders for the caller: 404, same as notes. A folder has no access list of its own. |

### 3.3 Data (for the build; a numbered script, not the baseline)

Recommendation: **script 83** (additive, fix-forward), not an edit of `00-baseline.sql`, so no demo or test database has to be rebuilt. Nothing needs backfilling.

```
dbo.NoteFolder
  NoteFolderId  INT IDENTITY PK
  MatterId      INT NOT NULL  -> Matter
  ParentFolderId INT NULL
  Name          NVARCHAR(100) NOT NULL   CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
  CreatedAt/CreatedByUserId/ModifiedAt/ModifiedByUserId, RowVersion   (like Note)
  UQ_NoteFolder_IdMatter  UNIQUE (NoteFolderId, MatterId)
  FK_NoteFolder_Parent    (ParentFolderId, MatterId) -> NoteFolder (NoteFolderId, MatterId)
  UQ_NoteFolder_Name      UNIQUE (MatterId, ParentFolderId, Name)

dbo.Note  ADD FolderId INT NULL
  FK_Note_Folder (FolderId, MatterId) -> NoteFolder (NoteFolderId, MatterId)   (no cascade)
  IX_Note_Folder (MatterId, FolderId)
```

Notes on this design: the composite foreign keys use the same `(Id, MatterId)` trick `Note` already has (`UQ_Note_IdMatter`), so "same matter" cannot be broken by a bug. SQL Server treats NULLs as equal in a unique index, so the name rule also covers the top level; a NULL `ParentFolderId` skips the parent foreign key, as wanted. The foreign keys do not cascade: the service deletes in the right order and the database is the safety net against deleting a folder that still holds notes. Depth, the 200 limit and cycles are checked in the service (recursive query on `ParentFolderId`), with a test for each.

The new table is DENY for the report login: add `NoteFolder` (and `NoteImage`, section 4) to `db/report-access.json` with the same reason text as the other Notes tables.

### 3.4 Screen

Mockup scenes: `main`, `new-folder`, `rename`, `move-folder`, `move-note`, `delete`, `delete-empty`, `drag`, `empty-folder`, `empty-tree`, `locked`.

- **Tree column** left of the list, 232 px default, resizable by the same splitter pattern as the list, **folds to a 44 px rail** (icon buttons for All Notes and the current folder; "Show Folders" to open it). Header row: "Folders", "New Folder" icon button, "Hide Folders" icon button. Rows are 32 px: chevron, folder icon (`pi-folder`, `pi-folder-open` when expanded), name with ellipsis (tooltip with the full name), direct count; the count gives way to a "..." button on hover and on the selected row. The selected row uses the selected background and a 3 px primary bar at the left, like the list.
- **Width at 1366x768.** The card is about 1,114 px wide. Tree 232 + list 388 + note 494 leaves the note above its 420 px minimum. The list keeps its splitter and the note keeps 420 px, so the tree gives way first (it folds) when the card is narrower, and the existing "stacked" mode still applies below 760 px. The mockup `image` scenes show the rail.
- **Row menu** ("..." on a folder row): New Subfolder, Rename, Move to Folder..., Copy Link, Delete Folder (red, far down; disabled with a tooltip for a person without `MatterNote.Delete`). The tree is **not** a navigation menu: clicking a name selects the folder and shows its notes.
- **List**: a path bar under the controls ("Custodians > Executive Team" with the direct count) shows the scope; the list rows are unchanged. In **All Notes** and in a search, each row gets one more muted line with its folder path (folder icon, "Custodians > Finance") so a note's place is never a guess.
- **Note panel**: the header's left side is the note's place as a text button ("Custodians > Executive Team"; clicking selects that folder in the tree). A note at the top level shows "No Folder".
- **New Note** creates the note in the selected folder (All Notes and No Folder create it at the top level). "Use a template" (`/template`) does the same.
- **View Options** gets no folder item. A folder shows **only the notes directly in it**, like a file explorer; there is no "Include Subfolders" switch (owner decision 5). The tag filter counts follow the current scope. The tag and Locked filter chips stay as they are; the folder is shown by the path bar, not a chip.
- **Templates view** has no folders (templates are not in folders), so the tree hides while Templates is selected and returns when By Tag or Latest is chosen.
- **The one-page Matter** keeps its compact Notes section as it is (latest notes, any folder); "Open Full View" is where folders live. `?tab=notes&folder=<id>` opens a folder (and `&note=` a note); the address is replaced, never pushed, as for D-03e. The selected folder is **not** stored in browser storage (nothing about a matter is stored there). Whether the tree is open or folded **is** remembered per person (a preference like the list width, key `mf.notes.tree`, no matter data in it). Expanded or collapsed tree nodes are kept in memory only; the path to the selected folder is always expanded.
- **Drag and drop.** A note row can be dragged onto a tree row; a folder can be dragged onto another folder or onto "No Folder" to move it to the top level. While dragging, the valid target under the pointer gets the selected background and a 2 px primary outline, a small label near the pointer says what will happen ("Move to Custodians > IT and Records"), a folder that cannot take the item is dimmed with the reason in its tooltip. A hover of 600 ms opens a collapsed folder. Dropping in the note body does nothing (the editor's drop stays blocked). **Drag is a shortcut for "Move to Folder..." which does the same and is the keyboard way.** Pointer-only drag is never the only way (WCAG 2.5.7).
- **Tree keyboard** (ARIA tree pattern, keys of the widget): Up and Down move, Right and Left open and close or go to the parent, Home and End, Enter selects. `role="tree"`, `treeitem`, `aria-level`, `aria-expanded`, `aria-selected`. Rename, move and delete are on the row menu, not on keys.
- **States.** First use: in the tree, a one-line muted "No folders yet." with a "New Folder" text button (D-44x: small area, not a full state block); the "No Folder" row is hidden while there are no folders. Empty folder: the list shows the shared state block "No notes in this folder yet." with "New Note". Search with no match inside a folder: `No results for "tablet" in Executive Team.` with a "Search All Notes" text button. Read-only person (no `MatterNote.Edit`): the "New Folder" button and the row-menu items that change things are absent or disabled with the sentence "You don't have permission to change folders." The "Read only" badge already on the tab covers the rest.

### 3.5 How folders meet the other note features

| Feature | Behaviour |
| --- | --- |
| **Tags** | Unchanged and independent. By Tag groups the notes of the selected scope; a note with several tags still shows once per tag. Tag filter and Locked filter combine with the folder scope (AND). Tag counts follow the scope. Deleting or deactivating a tag does nothing to folders. |
| **Search** | The text search (title and text, server side, whole matter) is applied, then the list is narrowed to the selected folder **and its subfolders** (the file-explorer rule). With All Notes selected it is the whole matter. A hit outside the selected folder is offered with "Search All Notes". No folder-name search in round 2. |
| **Pinning** | A pin is per note and works in any folder (also on a locked note, as today). Pinned notes come first inside the shown list. There is no pinned folder. |
| **Lock** | A locked note can be **moved** (organisation, like pin, not content); it cannot be edited or deleted. Moving does not change Last Updated and shows in History as "moved this note to ...". A folder cannot be locked. Deleting a folder with locked notes inside is only possible through "Move Contents Up and Delete". Decided (question 6). |
| **Templates** | A template has no folder. Using a template creates the note in the selected folder. "Save as template" copies the text, not the folder. |
| **Copy of a note** | There is no "Duplicate Note" today and none is added. "Copy Link" gives `?tab=notes&note=<id>`; it survives a move because it uses the id. If a duplicate is added later, the copy lands in the same folder and its images are copied as new rows (4.6). Copying text between notes of one matter is plain paste (5). |
| **References and embeds** | `@`, `#` and note references and embedded notes use ids, so a move never breaks them. The References panel is unchanged. |
| **History and audit** | See section 7. |
| **Counts on the Matter page** | The tab's number stays the number of notes. |

### 3.6 Folder API (proposal; the build writes the OpenAPI)

All under the sensitive-matter rule (hidden matter = 404) and with the permissions in section 9.

| Call | Purpose |
| --- | --- |
| `GET /api/v1/matters/{matterId}/note-folders` | The whole folder list of the matter (flat: id, parentId, name, direct note count, rowVersion) plus the top-level count. The client builds the tree; at most 200 rows. `MatterNote.View`. |
| `POST /api/v1/note-folders` | `{ matterId, parentFolderId?, name }`. 409 `FOLDER_NAME_TAKEN`, `FOLDER_TOO_DEEP`, `FOLDER_LIMIT`, `MATTER_INACTIVE`. |
| `PUT /api/v1/note-folders/{id}` | Rename, with `rowVersion`. |
| `PUT /api/v1/note-folders/{id}/parent` | Move: `{ parentFolderId \| null, rowVersion }`. `FOLDER_CYCLE`, `FOLDER_TOO_DEEP`, `FOLDER_NAME_TAKEN`. |
| `DELETE /api/v1/note-folders/{id}?rowVersion=&moveContentsUp=` | 409 `FOLDER_NOT_EMPTY` (counts in `meta`) unless `moveContentsUp=true`. |
| `PUT /api/v1/notes/{id}/folder` | `{ folderId \| null, rowVersion }` moves a note. Allowed on a locked note. |
| `POST /api/v1/notes` | `CreateNoteRequest` gains an optional `folderId`. |
| `GET /api/v1/notes`, `GET /api/v1/notes/{id}` | `NoteListItem` and `NoteResponse` gain `folderId`. An optional `folderId` / `includeSubfolders` filter is cheap to add but not needed while the client filters (it does today for tags). |

A move changes the note's `RowVersion` (as a pin does). Someone editing the same note then gets the existing conflict flow on Save. To avoid a conflict for nothing, the client may re-read on a 409, and when the server body is unchanged (same Last Updated) take the new row version and save again once. That also fixes the same effect for pin today. Build detail, not a decision.

## 4. Images in notes

### 4.1 Model

- The image is **not** in the note body. The body holds a reference: `<img data-image-id="581" alt="..." width="480" height="300">`. **No `src`, no URL, no data URI.** The client shows the image by id. The server never stores or follows a URL, so a pasted web page can neither track readers (no remote image) nor point the server anywhere.
- The bytes live in a new table **`dbo.NoteImage`** (below), one row per uploaded image, owned by the **matter**, not by one note. Which notes use an image is the existing `NoteLink` table with a new target type `IMAGE`, rebuilt from the saved body like every other reference.
- Upload is at paste time, before the note is saved, so a new unsaved note can hold images. Such an image is "pending" until a saved body refers to it.
- **Why not base64 in the body:** the body would blow the 200,000-character stored limit and the 2 MB request limit, every list and history call would carry it, the sanitiser would have to accept `data:` URLs (today it refuses them on purpose), and a note with five screenshots would be tens of MB of `nvarchar(max)`. Storing outside the body keeps `BodyHtml`, `BodyText`, list queries and the sanitiser small.

### 4.2 Storage, and why in SQL Server

Decision 027 says there is no file storage. Options:

| Option | For | Against |
| --- | --- | --- |
| **A. A `NoteImage` table in the database** (varbinary) | One backup, transactional with the note, authorised in the same query as the matter, no file share to secure and move (the repo will move to the corporate network), fits the IIS deployment, precedent in `AppSetting` (branding icon) | Database grows; never select `Content` in list queries |
| B. Files on disk or a share | Cheap storage | ACLs, backup in step with the database, orphan files, new deployment dependency, decision 027 fully reversed |
| C. Azure Blob or similar | Scales | New service, network rules, not in this stack |

**Recommendation: A**, with an ADR and a change to decision 027 in the build issue ("No attachments; the only stored binaries are small, matter-owned images of notes and the branding icon"). Decided (question 1): yes.

```
dbo.NoteImage
  NoteImageId        INT IDENTITY PK
  MatterId           INT NOT NULL -> Matter
  ContentType        VARCHAR(20) NOT NULL  CHECK IN ('image/png','image/jpeg')
  Width, Height      SMALLINT NOT NULL     CHECK 1..8000
  ByteSize           INT NOT NULL          CHECK <= 2097152
  ContentSha256      BINARY(32) NOT NULL   (ETag)
  Content            VARBINARY(MAX) NOT NULL
  UploadedAt, UploadedByUserId             (UploadedBy -> AppUser)
  IX_NoteImage_Matter (MatterId); IX_NoteImage_Uploaded (UploadedAt)   (for the safety sweep)
dbo.NoteLink  CK_NoteLink_Type gains 'IMAGE'
```

Size planning (no matter limit, so the DBA should confirm headroom): a screenshot is typically 100 to 500 KB. At 2 images per note and 400 KB, a matter with 50 notes adds about 40 MB; 2,000 active matters is about 80 GB as an upper bound, usually far less. Because images are deleted as soon as nothing uses them, only images that are in saved notes count.

### 4.3 Limits

| Limit | Value (decided, questions 12 and 13) | Why |
| --- | --- | --- |
| Types the server accepts | PNG, JPEG (checked by the first bytes and a header decode, never by the client's type or the file name) | Safe, universal. SVG is refused (script risk). Animated GIF, WebP, BMP, HEIC, TIFF are not stored; the client converts what the browser can decode (WebP, GIF first frame, BMP) to PNG before upload, the rest fails with the "type" message. |
| Size per image | 2 MB after the client's shrink | Fits one upload request (the route raises the 2 MB default a little, as branding does) |
| Pixels | Long side shrunk to 1,600 px by the client; the server accepts up to 8,000 px on either side | A 4K screenshot is shrunk before it travels |
| Per note | 20 images | Keeps notes readable and the body small |
| Per matter | **No limit** on count or total size (owner decision 13) | Growth is bounded only by the per-note cap and by images being deleted as soon as nothing uses them |
| Pending per person and matter | 50 unreferenced images | A technical guard against runaway retries only, not a product limit; it clears when the editor is closed |
| Metadata | Removed: the client always re-draws the image on a canvas and exports PNG or JPEG, which drops EXIF and GPS data | Privacy for photos pasted from a phone folder |

### 4.4 Read and upload paths

- **Upload:** `POST /api/v1/matters/{matterId}/note-images` (multipart `file`, the same pattern and OpenAPI treatment as the branding icon and `parse-email`). Needs `MatterNote.Edit`, a matter the caller can see and that is active. Answers `{ noteImageId, width, height, contentType, byteSize }`. Failures: 413 or 422 `IMAGE_TOO_LARGE`, 422 `IMAGE_TYPE_UNSUPPORTED`, 422 `IMAGE_CORRUPT`, 409 `MATTER_INACTIVE`, 404 hidden matter. Audited (7). A second call, `DELETE /api/v1/note-images/{id}`, lets the editor delete an image the same person uploaded and no saved note uses (used on Cancel and Discard).
- **Read:** `GET /api/v1/notes/images/{noteImageId}` needs `MatterNote.View` and the matter's visibility (hidden = 404, the same answer as a missing image, so ids leak nothing). Headers: the stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, a restrictive CSP with `sandbox` on this route (the branding icon route is the precedent), `Cache-Control: private, no-cache` with the SHA-256 as `ETag`, so every use re-checks access and answers 304 when unchanged. An image of an inactive matter is still readable.
- **How the browser gets it.** Recommendation: the editor loads the bytes through the API client as a blob and shows them as a blob URL (with a small in-memory cache per id), **not** as a plain `<img src="/api/...">`. A plain `<img>` cannot send the headers the app relies on in Development and Test (`X-Dev-User`) or during impersonation, and cannot show a clean "removed" or "no access" state. In production Windows authentication would work with a plain `<img>`, but one code path that works everywhere is safer. The current CSP is `img-src 'self' data:`, which most likely **refuses `blob:` images**. The build either adds `blob:` to `img-src` (a small change reviewed with the security headers; blob URLs are made only by our own script) or draws the bytes onto a canvas. See risk R6.
- **Another matter's image** (a note copied from matter A into matter B): the body would refer to an image that is not B's. The save would fail (`IMAGE_NOT_IN_MATTER`). To avoid that the editor, on paste, calls `POST /api/v1/note-images/{id}/copy` `{ targetMatterId }` (the caller must see both matters and hold `MatterNote.Edit` on the target) and swaps the id. Decided (decided, question 15): a separate server-side copy, never shared; needs `MatterNote.Edit` on the target.

### 4.5 Paste, upload and the failure states

Flow in the editor (mockup scene `image-fail`):

1. The paste handler finds an image file on the clipboard (5.3 says when an image beats text). It shrinks and re-encodes it on a canvas (long side 1,600; PNG; if over 2 MB, JPEG at 0.85 on a white background; if still over, fail).
2. A **placeholder block** appears at the cursor: a bordered panel with a spinner, "Adding image...", the file name or "pasted image" and size, and a progress bar. It is not part of the stored document; undo and redo skip it.
3. On success it becomes the image: inserted at **min(natural width, 720 px, editor width)**, aspect ratio kept, alt text "Pasted image", selected so the image bar shows.
4. On failure it turns into a red block (the shared error colours, not a dashed box): "Couldn't add the image." plus the reason and two text buttons, **Retry** and **Remove**. Retry resends the already prepared bytes. No toast: the failure shows inline where the image would be (D-51), and the polite live region announces it.
5. **Save is off** while any placeholder is uploading or failed; the footer says "Save is off until the image is added or removed." (a failed image that silently disappeared on Save would lose the person's work).
6. Cancel or leaving the note discards the draft; images already uploaded stay as pending until the clean-up (4.7).
7. Several images are uploaded two at a time, in the order pasted.

Reasons, in the words of the interface:

| Situation | Reason text under "Couldn't add the image." | Retry? |
| --- | --- | --- |
| Over 2 MB after shrinking | It is larger than 2 MB even after shrinking. Crop it or take a smaller screenshot. | yes |
| Not PNG or JPEG and the browser cannot convert it | This image type isn't supported. Paste a PNG or JPEG, or take a screenshot. | no |
| 20 images in the note | A note can hold up to 20 images. Remove one first. | no |
| Connection lost, server error | The upload didn't finish. Check your connection and try again. | yes |
| No `MatterNote.Edit` (changed while editing) | You don't have permission to add images to this matter's notes. | no |
| Note locked by someone while editing | This note was locked by Tomas Berg while you were editing. | no |
| Matter became inactive | This matter is inactive; notes can't get new images. | no |

### 4.6 Resize, alt text, read-only

- **Selecting** an image (click or arrow onto it) shows an outline, **four corner handles** and a floating **image bar** above it: `Small | Medium | Large | Original | Fit to Width`, `Alt Text`, `Remove`. Small 240 px, Medium 480, Large 720, Original = natural width (never above 1,600), Fit to Width = the editor's current content width.
- **Dragging a corner** resizes with the **aspect ratio locked** (always; no free stretch). A dark readout near the image shows the size while dragging and while selected: "480 x 300 px · 50% of original". Minimum width 48 px. **Maximum: the natural width and the editor's content width** (no upscaling past the original, no overflow). The stored size is `width` and `height` in CSS pixels; both are stored so the layout does not jump while the image loads. The reader's pane may be narrower than the stored width: the image then shrinks with `max-width: 100%`, keeping its ratio.
- **Without a mouse.** The image bar's size buttons, and **"Image Details"** (a normal form dialog: alt text up to 200 characters with a counter, a size row, an exact **Width (px)** field, "Height follows: 300 px. Original is 960 x 600 px.", "Remove Image" far left, `[Cancel] [Save Changes]`). Opened by "Alt Text" on the bar, or by Enter on a selected image. Dragging is therefore never the only way. The arrow keys are not used for resizing (they move the text cursor off a selected image).
- **Alt text.** Default "Pasted image" (never empty, so screen readers announce something); the person improves it in Image Details. The server keeps up to 200 plain characters. It is also part of the note's search text (section 8).
- **Read mode and locked notes.** The image shows at its stored size, no handles, no bar. Hover shows a subtle outline and the tooltip "Open full size". Click or Enter on the focused image opens the original in a new tab (a blob of the same bytes; the tab shows only the image). A locked note is read mode for everybody.
- **Remove.** From the bar or Image Details: takes the image out of the text. While the editor is open the image is kept, so undo works; the save deletes it if no saved note uses it any more (4.7).
- **Where an image can sit.** Between paragraphs, inside a list item and inside a table cell. It is a block, not a character in a line (no text wrapping, no float, no alignment options in round 2).

### 4.7 Clean-up of orphans

| Case | Rule |
| --- | --- |
| Uploaded, never saved into a note (cancelled draft, discard, closed tab) | Cancel and Discard call `DELETE /note-images/{id}` for every image uploaded in that editing session and not saved. Editing, removing and undoing inside the open editor still work, because nothing is deleted before Save or Cancel. |
| Removed from a note by a save | The save recomputes the note's `NoteLink` rows (as it does today). An image with no remaining reference in any note is **deleted in the same transaction**. No retention period. |
| A crash or a closed browser left an image behind | Only a quiet nightly safety sweep: it deletes images with no reference whose upload is older than 48 hours (a long-open draft is the only thing that can get that old). No user action, no audit. |
| Note deleted | The delete transaction removes the images that **no other note** refers to, at once (a note is deleted "for good"; its images follow). |
| Image used by two notes (cross-note copy in one matter) | Stays while one reference remains. |
| The job | `NoteImageSweeper : BackgroundService`, once a night, batches of 100, logs the counts, never audits per image. Same pattern as `ReportResultSweeper`. It is a crash safety net, not a retention rule. |

### 4.8 Images and the other note features

| Feature | Behaviour |
| --- | --- |
| Templates | **No images.** A template can be System or Client level, not tied to a matter, so its text cannot point at a matter's image. Save as Template drops the images and says "2 images were left out of the template." in the dialog. Using a template never inserts images. (Same reason `StripReferences` exists.) |
| Embedded notes (`data-embed-id`) | The embedded note's images show through the same read path (same matter, same rule). |
| Lock | See 4.6. |
| Sensitive matter | The read and upload routes use the matter rule; a hidden matter's image id answers 404. |
| AI | The `beforeSave(html)` seam sees `<img>` tags but not their content. A future AI check must not read note images without a policy for them (risk R7). |
| Export, print | No client export and no note print exist today; nothing to change. |

## 5. Formatted paste

### 5.1 What changes

Today `handlePaste` takes `text/plain` and inserts it as text, so bold, lists, tables and links from Word or Outlook arrive as a flat run with typed bullets and tab-separated rows (mockup `paste`, middle panel). Round 2:

1. Read the clipboard's `text/html` (and files, and `text/plain`) in the paste handler.
2. If the clipboard carries only an image, run the image flow (4.5). Rule for a mix: **an image wins only when the HTML has no visible text** (Edge's "Copy Image" gives an `<img>` plus an image file; Excel gives a table **and** a picture of the cells, and the table must win).
3. Otherwise **clean the HTML** (5.4) in an inert document (`DOMParser`, never the live editor), then let ProseMirror parse it with the note's own schema, so only what the note can hold gets in. Unknown tags are unwrapped, their text stays.
4. Plain text only: paste it as paragraphs (one per line, as the browser editor does) instead of one text run with raw line breaks.
5. After an HTML paste that differs from its plain text, show **Paste Options** (5.5).
6. **The server stays the authority.** Client clean-up is for quality, not security. The server sanitiser (section 6) re-checks everything on save.

### 5.2 Keep and drop

| Source formatting | In the note | Notes |
| --- | --- | --- |
| Paragraphs, line breaks | **Kept** | Empty paragraphs (Word `&nbsp;` lines) collapse: runs of empties become one, leading and trailing empties go |
| Bold, italic, underline | **Kept** | The editor's own rules already read `<b>`, `font-weight`, `font-style`, `text-decoration` |
| Headings 1 to 3 | **Kept** | Heading 4 to 6 become heading 3. Word "Title" becomes heading 1 |
| Bulleted and numbered lists, nesting | **Kept** | Word's list paragraphs (`mso-list`, typed bullet characters) are rebuilt as real lists with their levels. A numbered list's start number is not kept (starts at 1). To-do or check lists become bullets |
| Tables | **Kept**: rows, cells, header row, merged cells (colspan, rowspan up to 100) | Widths, borders, shading, alignment and vertical alignment dropped. Nested tables up to depth 3 (the server's limit), deeper ones flatten to paragraphs. Excel's first row stays a normal row (use the table tools to mark a header) |
| Links | **Kept** when http, https, mailto or `onenote:https:` | Others (`javascript:`, `file:`, relative) keep the text only. Outlook Safe Links (`...safelinks.protection.outlook.com/?url=...`) are **unwrapped** to the real address (decided, question 16; the wrapper also carries the reader's address) |
| Quotes | **Kept** as quote (blockquote) | |
| Text colour | **Dropped** (decided, question 9) | The note has 8 colours of its own, picked on purpose from the toolbar; a Word red is not one of them |
| Highlight, background colour | **Dropped** | |
| Strikethrough | Mark **dropped**, text kept | The note has no strikethrough mark. |
| Subscript, superscript | Mark **dropped**, text kept | A footnote "2" becomes a plain digit |
| Font family, size, line height, spacing, indents, alignment, page layout | **Dropped** | One look for every note |
| Code, monospace, preformatted | Text kept as paragraphs | The note has no code block |
| Horizontal rule, page break | **Dropped** | |
| Images in the pasted text | **Not kept in round 2** (5.3) | An info toast says how many were left out |
| Comments, footnotes, endnotes (Word) | **Dropped** | |
| **Tracked changes** | Inserted text **kept**, deleted text **dropped** | Pasting a redline would otherwise give a garbled run of both. The toast says "Pasted without tracked deletions" when it happened (decided, question 10) |
| **Hidden text** (`display:none`, `hidden`, `mso-hide`, zero-size or invisible text) | **Dropped** | See the privacy note in 5.4 |
| Scripts, styles, forms, iframes, objects, `<o:p>`, XML islands, conditional comments | **Dropped** with their content | Also dropped by the server |
| @mentions from Outlook or Teams | Stay as plain text or `mailto:` links | They do not become the note's own `@` person chips |
| Emoji, non-breaking spaces | Emoji kept; non-breaking spaces become normal spaces | |

### 5.3 Images in pasted text, and in the clipboard

Browsers do not give a page the pictures inside copied Word or Outlook text: the HTML carries `file:///...` or `cid:` addresses that cannot be read, and the pictures sit in an RTF flavour. Remote web images (`https://...`) cannot be fetched by the page (CSP) and **must not** be fetched by the server (it would follow a URL someone else wrote). So in round 2:

- An image **on its own** (screenshot, Snipping Tool, "Copy Image", a picture copied in Word or Outlook) is uploaded (4.5).
- An image **inside** copied text is dropped and the toast says "Pasted without 2 images" + "Images inside copied text can't be kept. Paste an image on its own, or take a screenshot." (mockup `paste`).
- `data:image/png;base64,...` images inside HTML (some web and mail clients) **can** be read; they are turned into uploads like a file, within the limits, and a failure is the same inline block. Question 11 asks whether the owner wants Word and Outlook pictures later (that needs reading the RTF flavour: a separate issue).

### 5.4 Sources and their clean-up

| Source | What the clipboard looks like | What the clean-up does |
| --- | --- | --- |
| Word, Outlook classic (the Word engine) | HTML with `MsoNormal` classes, inline `mso-` styles, `<o:p>`, conditional comments, lists as paragraphs with typed bullets, tables with `MsoTableGrid` | Drop comments and namespaces; rebuild lists from `mso-list` levels; read heading levels from tags and `MsoHeading` classes; unwrap Safe Links; drop `del`; drop hidden text |
| Outlook on the web, new Outlook | Clean HTML, `<div>` per line, real lists and tables | Divs become paragraphs (the parser does it); same link and hidden-text rules |
| Google Docs | A wrapper `<b style="font-weight:normal" id="docs-internal-guid-...">`, spans with `font-weight:700` | The editor's bold rule already ignores the "normal" wrapper and reads 700; remove the wrapper's id noise |
| Excel | Table of `<td class="xl65">`, hidden columns still present | Table kept; `display:none` cells and rows dropped (hidden text rule); a 1,000 cell limit warning before insert |
| Web page (Edge, Chrome) | HTML with computed inline styles | Strip styles and classes; remote images dropped; `<div>` soup becomes paragraphs |
| Teams chat | Blocks with author and time lines | Kept as copied text, no special handling |
| PDF viewer, Notepad | Plain text only (a PDF's hard line breaks stay) | Plain path |

Clean-up is one pure function (`note-paste.ts`) tested against **captured clipboards** (Word 365, Outlook classic, new Outlook, Google Docs, Excel 365, Edge page, Teams chat, plain text), stored as small anonymised fixtures next to the spec (no client data in a fixture).

**Privacy note on hidden text.** A pasted Word or web fragment can hold text the author could not see. The server keeps the *text* of an element whose `style` it strips, so a `display:none` paragraph would become visible text in a matter's note. Dropping hidden elements on the client **and** on the server (section 6) closes it. The same applies to deleted tracked text.

### 5.5 Paste Options and Paste as Plain Text

- After a paste whose HTML carried formatting, a small chip appears under the end of the pasted text: **"Pasted with formatting"** with a caret. Its menu (`role="menu"`, radio items): **Keep Formatting** (checked) and **Paste as Plain Text** ("Replaces this paste with its text only, no layout."), and a one-line tip: "In the browser, Ctrl + Shift + V pastes as plain text from the start." (mockup `plain`).
- **Paste as Plain Text** undoes that paste step and inserts the plain version kept in memory from that same paste event: **no clipboard permission prompt** (reading the clipboard from a button would trigger the browser's "allow this site to see the clipboard" prompt in Edge, so there is deliberately no toolbar button; question 14).
- The chip stays until the next edit or click elsewhere. **No timer** (a vanishing control fails people who need time). It sits right after the text in the page order, so Tab from the text reaches it; a polite live region says "Pasted. Paste options available."
- **Ctrl+Shift+V** is handled by the browser and gives the editor a clipboard with plain text only; the paste handler treats that as the plain path. It is not an app shortcut and is not registered anywhere. A unit test pastes a text-only clipboard.
- Undo (the toolbar's or the editor's) removes the whole paste in one step.
- A note that is locked or read only never pastes.

### 5.6 Limits and failures

| Case | Result |
| --- | --- |
| Pasted HTML over the server's 400,000 characters or 20,000 tags | The client cleans first (usually far smaller). If still over, an inline message above the text: "That's too much to paste at once. Paste it in parts." |
| More than 1,000 table cells | "That table has 1,240 cells; a note holds at most 1,000." (the server says the same on save) |
| Nothing left after clean-up | Nothing is inserted; the toast "Nothing to paste" is not needed: the plain path is used |
| A clean-up error | Falls back to the plain path; never blocks the paste |

## 6. Server sanitiser impact (`RichHtmlProfile.Note`)

`RichHtml.cs` is shared with comments, descriptions and e-mail intake. **All changes below are limited to the Note profile**, so no other screen changes behaviour.

| Change | Detail | Why |
| --- | --- | --- |
| Allow `img` (Note only) | Only `data-image-id` (digits, 1 to 10, positive), `alt` (plain text, up to 200 characters, control characters removed), `width` and `height` (digits, 1 to 4,000; both or neither). **No `src`, `srcset`, `style`, `class`, `loading`, `title`, event handler.** An `img` without a valid `data-image-id` is removed with no text. Attribute order is fixed (`data-image-id`, `alt`, `width`, `height`) so the output stays a fixpoint. | The only image form the server will ever store |
| References | `NoteContent.ExtractReferences` also finds `<img data-image-id>` as target `IMAGE`; `NoteLink` stores it (script 83 widens `CK_NoteLink_Type`). `CheckReferences` requires every image to exist **in the note's matter** (`IMAGE_NOT_FOUND`, `IMAGE_NOT_IN_MATTER`). Cap 20 per note (`TOO_MANY_IMAGES`), separate from the 200 reference cap. The References side panel does not list images. | Ownership and clean-up |
| Plain text | `ToPlainText` ignores `img` for the title and the snippet (so a note that starts with a picture is not titled by its alt text) and `BodyText` gets the alt texts appended on their own lines for search. | Search (section 8) |
| Templates | `NoteContent.StripReferences` (used by `NoteTemplateService`) also removes `<img>` | 4.8 |
| Hidden text | Before styles are stripped, drop elements with the `hidden` attribute or an inline style of `display:none`, `visibility:hidden`, `mso-hide:all`, `font-size:0` or `opacity:0`, with their content (Note profile only) | 5.4 privacy note |
| Tracked deletions | Drop `del` (and `ins` unwrapped as today) with the content, for the Note profile | Same as the client; our editor never writes `del` |
| Limits | Unchanged. Images are no longer in the body, so `RichHtmlLimits.Note` (400,000 in, 200,000 stored, 20,000 tags) stays; a pasted table of 1,000 cells is still the largest case | |
| Everything else | Unchanged: no `style`, no `class`, no `svg`, no `data:` or `javascript:` URLs, links http, https, mailto, onenote, the fixpoint rule and the re-parse test | |

Tests the build must add: an `img` with every forbidden attribute and a `javascript:` or `data:` `src` comes out as `<img data-image-id=... alt=...>` or nothing; mXSS style round-trips stay fixpoints; the editor's `getHTML()` for an image node equals what the server returns for it (so a save does not look like a change); hidden text and `del` fixtures; a table of 1,001 cells; an image in a list item and a table cell.

## 7. Audit

All through `IAuditWriter` with the matter id, as the Notes service does now.

| Event | Object | Old, new, summary |
| --- | --- | --- |
| `NOTE_FOLDER_CREATED` | NoteFolder | summary: the path ("Custodians > Finance") |
| `NOTE_FOLDER_RENAMED` | NoteFolder | old and new name |
| `NOTE_FOLDER_MOVED` | NoteFolder | old and new path |
| `NOTE_FOLDER_DELETED` | NoteFolder | path; summary "3 notes and 1 subfolder moved up" when "Move Contents Up" was used |
| `NOTE_MOVED` | Note | old and new folder path ("No Folder" for none). One per note moved, also by "Move Contents Up", so each note's History stays honest. Appears in the note's History as "moved this note to Custodians > Finance" |
| `NOTE_IMAGE_ADDED` | Note (matter scoped) | type, size, dimensions; **no content**. Written at upload (a person put data into the matter even if the note is never saved) |
| `NOTE_EDITED` | Note | unchanged; an edit that only changes images or alt text is an edit |

Not audited: reads, the safety sweep (no person acted; the job logs counts), resizing (it is an edit of the body).

Build items: add `NoteFolder` to `AuditDisplayLookup.cs` (the Audit Logs page names objects through it; `INoteLabels` gets a folder lookup), add the new event types to `shared/ui/audit-format.ts` and `event-type.ts`, and `noteHistoryText` for `NOTE_MOVED`. Folders have no History panel of their own; their events are in Audit Logs.

## 8. Search

- The Notes tab search stays SQL `LIKE` over title and `BodyText` (decision 019). `BodyText` now includes image alt texts, so "privilege log screenshot" finds the note.
- Inside a folder the search covers the folder and its subfolders; All Notes covers the matter (3.5).
- Image content (the pixels) is never searched. There is no OCR.
- The global search is not changed. Folder names are not searchable there.

## 9. Permissions

| Action | Permission | Notes |
| --- | --- | --- |
| See folders and images | `MatterNote.View` + the matter's visibility | Same as reading a note |
| Create, rename, move folders; move a note; upload or copy an image | `MatterNote.Edit` | Whoever may rewrite any note in the matter may also reorganise its folders |
| Delete a folder | `MatterNote.Delete` | Deleting is the stronger right; "Move Contents Up and Delete" needs it too |
| Resize, alt text | `MatterNote.Edit` (it is editing the body) | |
| Paste | `MatterNote.Edit` | A read-only person has no editor |

**Recommendation: reuse `MatterNote.View|Edit|Delete`; add no permission** (decided, question 4). A new `MatterNote.ManageFolders` would need `contracts/permissions.json`, the generated C# and TypeScript, the role editor, a seed migration for every role that holds Edit today, and a decision about who gets it; the owner's wording (a file explorer for notes) does not ask for a stricter right than editing the notes themselves. If the owner wants only managers to restructure folders, add the permission later; the endpoint policy is one constant (`NotePolicies`).

A person who cannot see the matter gets 404 for folders and images. A person with View but not Edit sees the tree and the images, with the change controls absent or disabled with a sentence.

## 10. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R1 | Decision 027 reversed in part; the database grows | Owner decided yes (question 1); ADR; no per-matter limit by decision, so DBA sizing; 20 per note and 2 MB each; list queries never select `Content`; images deleted at once when unused |
| R2 | Images are a new place for privileged content: no DLP or AI policy sees pixels | Same visibility and permissions as the text; documented; the AI seam must not read images (R7) |
| R3 | Sanitiser change opens an injection or tracking hole | Note profile only; no URL attributes at all; fixpoint tests; the mXSS suite re-run; image bytes served with `nosniff`, a sandbox CSP and a type taken from the stored magic bytes, never from the client |
| R4 | Malformed or malicious image (decompression bomb, polyglot) | Header decode with a pixel cap (8,000 x 8,000 stops at about 64 megapixels), size cap before decode, no server-side image processing library in round 2 (the client re-draws every image; the server only validates the header). If server re-encoding is wanted later, check the library's licence (ImageSharp needs a commercial licence for a firm of this kind; SkiaSharp is MIT) and add the package in `Directory.Packages.props` only. |
| R5 | Pasting hidden text or tracked deletions from Word puts unseen text in a matter | Dropped on client and server (5.4, 6) |
| R6 | The CSP `img-src 'self' data:` most likely refuses blob URLs | First build step: add `blob:` to `img-src` (reviewed with `SecurityHeadersMiddleware`) or draw the image onto a canvas from `createImageBitmap`; a browser test proves the choice |
| R7 | A future AI feature could send note images to a model | The `beforeSave(html)` seam and any AI reading of notes must treat `<img>` as "not readable"; add a line to the AI policy design |
| R8 | A second person edits while a note is moved: spurious conflict | Existing conflict flow; the silent rebase in 3.6 |
| R9 | Two people restructure folders at once (cycle, duplicate names) | App lock per matter, unique index, tests |
| R10 | The folder tree cramps the list at 1366 | Tree folds to a rail; the note keeps 420 px; measured in the mockup |
| R11 | Drag and drop is not accessible alone | Menu items do the same; tested with the keyboard |
| R12 | Formatting rules disappoint (a colour the owner wanted) | Question 9 before build; the clean-up is one function with fixtures, easy to extend |
| R13 | Pasted Word lists or tables clean up badly | Captured fixtures from real Word and Outlook output, a manual pass by the owner on the first build |
| R14 | An image pasted into a note in an inactive or locked state | Server refuses (`MATTER_INACTIVE`, 409 `NOTE_LOCKED` on save); the editor shows the inline reasons in 4.5 |
| R15 | An image is left behind after a crash | Nightly safety sweep (48 hours); counts logged; a test inserts old rows and proves they go |
| R18 | An image is deleted on save while someone else's unsaved copy still points at it (second tab, "Copy My Text" after a conflict) | Accepted by the owner's rule (no retention); the editor shows the inline "image is no longer available" state for a missing image and the text stays; documented |
| R16 | Cross-matter copy of an image moves privileged material between matters | It is the same person with access to both and the same as copying text; audited at the target; the endpoint checks both matters |
| R17 | Wiki and docs drift | Section 13 lists what the build must update in the same change |

## 11. Read-path and write-path inventory

Legend. **Change**: what the build does. Tests: **P** persona walk (sensitive matter), **X** special test, **U** unit.

### 11.1 Read paths

| ID | Path | Where | Change | Test |
| --- | --- | --- | --- | --- |
| R1 | `GET /notes` (list) | `NotesController.List`, `NoteService.ListAsync` (:51), `NoteListItem` | Add `folderId` to the item. Optional filter later | P, X |
| R2 | `GET /notes/{id}` | `NoteService.GetAsync` (:128), `NoteResponse` | Add `folderId` | P |
| R3 | `GET /matters/{id}/notes/summary` | `NoteService.SummaryAsync` (:119) | None (the tab number) | |
| R4 | **new** `GET /matters/{id}/note-folders` | new `NoteFolderService` | New; visible-matter rule; flat list with direct counts | P, X |
| R5 | **new** `GET /notes/images/{id}` | new `NoteImageService` | New; matter rule; 404 equals missing; `nosniff`, sandbox CSP, `ETag` | P, X |
| R6 | `GET /notes/{id}/history` | `NoteService.HistoryAsync` (:134), `note-ui.ts` `noteHistoryText` | New event types NOTE_MOVED, NOTE_IMAGE_ADDED | U |
| R7 | `POST /notes/resolve-references` | `NoteService.ResolveReferencesAsync` (:395) | Embedded bodies may contain images (served by R5); no new kind | |
| R8 | Audit Logs page names | `LptHub.Api/Http/AuditDisplayLookup.cs` (:109), `Notes.Contracts/INoteLabels.cs`, `NoteLabels.cs` | Add NoteFolder labels | U |
| R9 | One-page Matter Notes section | `matters/ui/matter-notes-section.ts` | None (latest notes, any folder) | |
| R10 | Note templates read | `NoteTemplateService` | None (bodies hold no images) | |
| R11 | Report login | `db/report-access.json`, script 83 `DENY` | `NoteFolder`, `NoteImage` denied like the other Notes tables | X |
| R12 | Global search | Search module | None (no Notes code found there) | |
| R13 | Sensitive-matter tests | `tests/.../Security/SensitiveAccessCatalog.cs`, `PersonaWalk.cs`, `MatterContentApiTests.cs`, `LostWriteContentTests.cs` | Add the folder and image endpoints to the catalogue | P |
| R14 | Notes tab loading | `notes-tab.ts` `loadList` (:2530) | Also load the folder list; scope the list by folder | U, E |
| R15 | Wiki, OpenAPI, generated client | `contracts/openapi`, `frontend/src/app/api/generated`, wiki pages | See section 13 | CI drift |

### 11.2 Write paths

| ID | Action | Where | Change | Test |
| --- | --- | --- | --- | --- |
| W1 | Create note | `NoteService.CreateAsync` (:155) | Optional `folderId`, checked in the same matter | X |
| W2 | Save note | `NoteService.UpdateAsync` (:212) | Body may contain images: links, existence in the matter, cap 20; images no note uses any more are deleted in the same transaction | X |
| W3 | **new** Move note | `PUT /notes/{id}/folder` | New; allowed when locked; `NOTE_MOVED`; no Last Updated change | P, X |
| W4 | Delete note | `NoteService.DeleteAsync` (:373) | Same transaction deletes images no other note uses | X |
| W5 | Pin, lock, unlock | `NoteService` (:303, :328, :348) | None (row version effect, 3.6) | |
| W6 | **new** Create folder | `POST /note-folders` | Name, depth, limit, matter active, app lock, audit | P, X |
| W7 | **new** Rename folder | `PUT /note-folders/{id}` | Row version, unique name, audit | P, X |
| W8 | **new** Move folder | `PUT /note-folders/{id}/parent` | Cycle, depth, name clash, app lock, audit | P, X |
| W9 | **new** Delete folder | `DELETE /note-folders/{id}` | Empty rule, `moveContentsUp`, `NOTE_MOVED` per note, audit | P, X |
| W10 | **new** Upload image | `POST /matters/{id}/note-images` | Magic bytes, size, pixels, pending guard, audit; plus `DELETE /note-images/{id}` for Cancel | P, X |
| W11 | **new** Copy image to another matter | `POST /note-images/{id}/copy` | Both matters visible, Edit on the target | P, X |
| W12 | **new** Safety sweep | `NoteImageSweeper : BackgroundService` | Nightly: delete unreferenced rows uploaded more than 48 hours ago | X |
| W13 | Templates create, update, duplicate, use | `NoteTemplateService` (:264 `StripReferences`) | Strip images; "N images left out" count returned | U |
| W14 | Sanitiser and content rules | `RichHtml.cs`, `RichHtmlGuard.cs`, `NoteContent.cs` | Section 6 | U |
| W15 | Matter deactivate or reactivate | Organization | Folder create refused while inactive (as New Note); no data change | X |
| W16 | Frontend editor | `note-editor.ts` (paste, image node), new `note-paste.ts`, `note-image.ts`, `note-folder-tree.ts`, `note-folder-dialogs.ts` | New files (the two big files stay under control); keep `noteHistoryText` and shared audit formats in step | U, E |

Totals: 15 read paths, 16 write paths. **Not changed:** tags and tag administration, the permission catalogue, roles, the Labels page, the global search, exports (none exist), notifications (none involved).

## 12. Test plan

- **Backend unit:** name, depth, limit, cycle rules; sanitiser fixtures (images, hidden text, `del`, 1,001 cells, fixpoint); paste-related server cases.
- **Backend integration (Docker):** every new endpoint in the sensitive-matter persona walk (hidden matter: 404 identical to missing); cross-matter move and image reference refused; composite foreign key violations; concurrent folder moves (cycle); delete rules and "Move Contents Up" with a clashing name; image upload types and sizes; ETag 304; image deleted on save when unused, on Cancel, and with its note; the 48-hour safety sweep; lost-write checks for folder rename and move.
- **Schema tests:** script 83 applies on a fresh database and on one with the baseline; `report-access.json` lists the new tables.
- **Frontend unit:** `note-paste` against the captured clipboards; the tree (keyboard, counts, disabled targets); the image node (resize maths: ratio, min 48, max natural, stored values); Paste Options (undo and replace with plain); text-only clipboard (Ctrl+Shift+V).
- **E2E (Playwright, 1366x768 and 1920x1080):** create, rename, move, delete a folder; drag a note; paste a PNG; resize; remove; paste failure and Retry; paste formatted HTML from a fixture; Paste as Plain Text; read-only person; locked note. axe on the tree, the dialogs and the editor with an image.
- **Real stack:** one manual pass with Word and Outlook on the owner's machine (the only way to see real clipboards) before the issue is closed.

## 13. Build split, order and documents to update

Suggested children of epic #1405 (rough size S, M, L):

| # | Issue | Size | Depends on |
| --- | --- | --- | --- |
| A | Folders: script 83 (`NoteFolder`, `Note.FolderId`), service, endpoints, audit, tests | M | |
| B | Folders UI: tree, scoped list, dialogs, drag, deep link, states | L | A |
| C | Images: `NoteImage`, upload and read endpoints, sanitiser, `NoteLink` IMAGE, delete-on-save, safety sweep, tests, ADR | L | decided (question 1) |
| D | Images UI: paste upload, placeholder, image node, resize, Image Details, read mode | L | C |
| E | Formatted paste: `note-paste.ts`, fixtures, Paste Options, hidden-text and `del` rules in the sanitiser | M | none (can go first) |

**Order:** E first (the owner's request 3 and the quickest win; needs no schema), then A and B, then C and D (waits for the owner's answer on storage).

Documents the build updates in the same change (CLAUDE.md rules):

- `docs/architecture.md`: decision 027, the Notes paragraph (folders, images, new endpoints, events).
- `docs/adr/`: a new ADR for image storage.
- `docs/ux/design-guidelines.md` and the theme guide: the new patterns of section 14. `docs/ux/tokens.css` only if the designer wants a token (none is needed in the mockup).
- Wiki: `Database/Table-Reference.md`, `Database/ER-Diagrams.md`, `Database/Schema-Script-History.md` (script 83), `Architecture/Backend-Modules.md` and `Backend/Module-Guide.md` (Notes), `Architecture/API-Contracts.md`, `Architecture/Frontend-Architecture.md`, and a new how-to page for folders and images.
- `contracts/openapi` and the generated client (nswag); `db/report-access.json`.

## 14. New UI patterns that need the designer

None of these exists in `docs/ux/design-guidelines.md`; I used the shared parts and tokens only (no colour literal, no private chip or button), but the patterns themselves are new and are the designer's to approve:

1. **Folder tree** (`role="tree"` rows, 32 px, chevron, count, row menu, selected bar) and its **fold to a rail**.
2. **Drag a row onto a tree row**: drop-target look, the label near the pointer, dimmed invalid targets. (D-44o allows drag only for reorder lists.)
3. **Image in the editor**: selection outline, corner handles, the floating image bar, the size readout.
4. **Inline upload placeholder and error block** inside the text (progress bar; red block with Retry and Remove).
5. **Paste Options chip** and its menu.
6. **Move Folder / Move Note picker**: a tree of radio rows with greyed targets and reason labels.

Words used (Title Case for things you click, sentence case for text, per D-20): New Folder, New Subfolder, Rename, Move to Folder..., Copy Link, Delete Folder, Show Folders, Hide Folders, All Notes, No Folder, Move Folder, Move Note, Move Contents Up and Delete, Alt Text, Image Details, Remove Image, Fit to Width, Keep Formatting, Paste as Plain Text, Retry, Remove, Search All Notes. Toasts: "Folder created", "Folder renamed", "Folder deleted", "Note moved" (with Undo), "Folder moved" (with Undo), "Pasted without 2 images", "Pasted without tracked deletions". States: "No folders yet.", "No notes in this folder yet.", `No results for "tablet" in Executive Team.`, "Couldn't add the image.".

Where the mockup is not the guideline (for the designer): the mockup's tree and list share one card (as the existing list and note do); the image bar uses 28 px buttons (a dense floating toolbar, like the table tools; the guideline's 36 px control height is for page controls); the folder rows are 32 px (dense list rows, D-02).

## 15. Decisions (owner, 2026-11-18)

All 20 questions are decided. The design above follows these decisions.

1. **Images stored in the database.** Yes: a `NoteImage` table, with an ADR amending decision 027 ("no file storage").
2. **Folder depth and number.** 5 levels, 200 folders per matter.
3. **Delete Folder.** A folder with notes is refused as it is, and "Move Contents Up and Delete" is offered. An empty folder deletes without asking. Notes are never deleted with a folder.
4. **Permissions.** Reuse `MatterNote.Edit` (create, rename, move) and `MatterNote.Delete` (delete a folder). No new permission.
5. **What a folder shows.** Only its direct notes, like a file explorer. **There is no "Include Subfolders" switch.** Counts are direct and add up to All Notes. Search covers the selected folder and its subfolders.
6. **Locked notes.** A locked note may be moved.
7. **New Note and templates.** They go into the selected folder (top level in All Notes and No Folder).
8. **The tree.** Open by default, folds to an icon strip, the choice is remembered per person, hidden in the Templates view, absent from the compact Notes section of the one-page Matter.
9. **Pasted formatting kept.** Headings, bold, italic, underline, lists, tables, links, quotes. Dropped: colours, fonts, highlight, strikethrough, layout.
10. **Tracked changes.** Inserted text kept, deleted text dropped, and a toast says so.
11. **Pictures inside pasted Word or Outlook text.** Not kept in round 2; a toast says so.
12. **Image format.** PNG and JPEG only, 2 MB per file, long side shrunk to 1,600 px, metadata stripped.
13. **Image limits and clean-up.** **No per-matter size or count limit.** 20 images per note. An image no saved note uses any more is deleted **when the note is saved** (editing and undo before saving still work). An image uploaded but never saved is deleted when the editor is cancelled or discarded. Deleting a note deletes its images. Only a quiet nightly safety sweep remains, for crashes. **No 7-day retention.**
14. **Paste as plain text.** The Paste Options chip plus the browser's own Ctrl+Shift+V. No toolbar button, no app shortcut.
15. **Image copied between matters.** A separate server-side copy, never shared; needs `MatterNote.Edit` on the target matter.
16. **Outlook Safe Links.** Unwrapped on paste.
17. **Insert Image button and file drop.** Neither in round 2.
18. **Undo after a move.** Yes, in the toast.
19. **Standard folders for new matters.** A follow-up issue only.
20. **Default alt text.** "Pasted image", never empty.

## 16. What this note did not check

- No application, schema or OpenAPI file was changed or built; no test was run (design only). The mockup was opened and photographed only in Chrome (headless) at 1366x768 and 1920x1080; no other browser, no Edge, no keyboard walk-through, no screen reader, no axe run.
- The dialogs and scenes were photographed at 1366x768 only (the two sizes are shown for the main screen, the image resize and the paste comparison). The other scenes were not looked at at 1920x1080 as pictures; their layout is CSS that does not depend on the width, but it is not proven.
- I did not capture real Word, Outlook, Excel or Teams clipboards, so every statement about what those applications put on the clipboard (conditional comments, `mso-list`, `file:///` pictures, the RTF flavour, Excel giving a table and a picture) is from knowledge of those formats and must be confirmed with real captures (section 5.4 fixtures; the manual pass in section 12).
- Whether a blob URL is refused by the current CSP (risk R6, read from `SecurityHeadersMiddleware.cs`, not tested) and whether a plain `<img>` would work under Windows authentication were not tested.
- The size and licence remarks on image libraries (R4) are from memory and need checking before any package is chosen.
- I did not run the existing sanitiser against the proposed `img` rule; the fixpoint behaviour of a bare `<img>` between block elements needs the round-trip test named in section 6.
- I looked for Notes code in the global search module and found none, but did not run the search.
- I did not read all of `docs/ux/design-guidelines.md` line by line; I read the sections on dialogs, confirms, empty states, toasts, buttons, wording and the Notes sections, and the tokens. A rule elsewhere in that file may apply.
- Sizes of work (S, M, L) are rough guesses, not estimates.

## 17. Mockup and evidence

- Mockup: `docs/ux/mockups/notes-round-2/index.html` (static HTML, CSS and JS, no build, no network; `assets/tokens.css` is a copy of `docs/ux/tokens.css`). Its guide (bottom left "Mockup Guide") lists the scenes; `README.md` next to it has the URL options.
- Screenshots: branch `design-evidence`, folder `notes-round-2-1406` (15 JPG, README with the index).
