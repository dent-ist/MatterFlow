# Work with Note Folders

[[_TOC_]]

**What this page is for.** How the folders of a matter's notes work in the backend (epic #1405, issue #1407): the rules, the endpoints, the error codes, the audit events and where the code and the tests are. The screen is issue #1408 (rule D-46b in `docs/ux/design-guidelines.md`, design `docs/ux/notes-round-2/README.md` section 3); it is described under "The screen" below.

## The rules

| Rule | How it is kept |
|---|---|
| A folder belongs to one matter; a note is in one folder or none (`Note.FolderId` null = No Folder) | Composite foreign keys on `(Id, MatterId)` in script 83 (`FK_NoteFolder_Parent`, `FK_Note_Folder`) |
| Up to 5 levels, up to 200 folders per matter | `NoteFolderService` (rules in `NoteFolderRules` and `NoteFolderTree`, unit tested) |
| A name is unique inside its parent, also at the top level, ignoring case; it is trimmed, 1 to 100 characters, no `/` or `\`, no control characters | The service, with the unique index `UQ_NoteFolder_Name` behind it |
| A folder shows only its direct notes; the counts are direct counts | `GET /matters/{id}/note-folders` returns the counts; `GET /notes?folderId=` filters |
| A text search inside a folder covers the folder and its subfolders | `GET /notes?folderId=&q=` |
| Folder structure changes of one matter run one at a time | An application lock per matter (`sp_getapplock`, `NoteFolderLock`) inside the transaction |
| A hidden (sensitive) matter has no folders for the caller | 404, as for notes (`NoteAccess`) |

## Endpoints

| Call | Permission | Notes |
|---|---|---|
| `GET /api/v1/matters/{matterId}/note-folders` | `MatterNote.View` | Flat list (id, parentFolderId, name, noteCount, subfolderCount, rowVersion), plus `noFolderNoteCount` and `totalNoteCount` |
| `POST /api/v1/note-folders` | `MatterNote.Edit` | `{ matterId, parentFolderId?, name }`; the matter must be active |
| `PUT /api/v1/note-folders/{id}` | `MatterNote.Edit` | Rename, with `rowVersion` |
| `PUT /api/v1/note-folders/{id}/parent` | `MatterNote.Edit` | Move, `{ parentFolderId \| null, rowVersion }` |
| `DELETE /api/v1/note-folders/{id}?rowVersion=&moveContentsUp=` | `MatterNote.Delete` | An empty folder deletes; a folder with notes or subfolders is refused unless `moveContentsUp=true` |
| `PUT /api/v1/notes/{id}/folder` | `MatterNote.Edit` | `{ folderId \| null, rowVersion }`; allowed on a locked note; does not change Last Updated |
| `POST /api/v1/notes` | `MatterNote.Edit` | `folderId` is optional; the folder must be one of the matter |
| `GET /api/v1/notes` | `MatterNote.View` | New filters `folderId` and `noFolder=true` (not together) |

## Error codes

409: `FOLDER_NAME_TAKEN` (also when "Move Contents Up and Delete" would make two subfolders with one name), `FOLDER_TOO_DEEP`, `FOLDER_LIMIT`, `FOLDER_CYCLE`, `FOLDER_NOT_EMPTY` (`meta.noteCount`, `meta.subfolderCount`), `MATTER_INACTIVE`, `CONCURRENCY_CONFLICT`. 400 `NOT_FOUND` on `folderId` or `parentFolderId` when that folder is not one of the matter. 404 for a hidden matter or a missing record.

## Audit events

`NOTE_FOLDER_CREATED`, `NOTE_FOLDER_RENAMED`, `NOTE_FOLDER_MOVED`, `NOTE_FOLDER_DELETED` (object type `NoteFolder`) and `NOTE_MOVED` (object type `Note`, old and new folder path, "No Folder" for none; one per note, also for each note moved by "Move Contents Up"). The Audit Logs page names a folder through `INoteLabels.FoldersAsync`.

## Where things are

- Script: `db/scripts/83-note-folders.sql`; report login: `db/report-access.json` (deny).
- Code: `backend/src/Modules/LptHub.Notes` (`Domain/NoteFolderRules.cs`, `Application/NoteFolderService.cs`, `Api/NoteControllers.cs`).
- Tests: `UnitTests/Notes/NoteFolderRulesTests`, `IntegrationTests/Notes/NoteFoldersApiTests`, the two endpoint catalogues in `IntegrationTests/Security`.

## The screen

Matter > Notes shows the folders as a tree on the left of the Notes tab (not in the Templates view, and not in the compact Notes section of the one-page Matter).

| Part | What it does | Where |
|---|---|---|
| Tree | All Notes, No Folder, then the folders in natural order with direct counts; a folder shows only its own notes; the "..." menu has New Subfolder, Rename, Move to Folder..., Copy Link, Delete Folder | `notes/note-folder-tree.ts`, styles `note-folder-tree.scss` |
| Fold | Hide Folders folds it to a 44 px rail; the choice is kept per person in browser storage `mf.notes.tree` (`folded`; absent = open). The card shows the rail by itself under 912 px | `note-folder-store.ts`, `note-folders.ts` (`readTreeOpen`, `writeTreeOpen`) |
| Selection | `?tab=notes&folder=<id>` (or `folder=none`); the address is replaced, never pushed; a folder that is gone falls back to All Notes | `notes-tab.ts` (`onFolderSelected`), `NoteFolderStore.select` |
| List | `GET /notes?folderId=` or `noFolder=true`; a search covers the folder and its subfolders (server side). In All Notes and in a search each row names its folder | `notes-tab.ts` (`loadList`) |
| New Note | Saved into the selected folder; none from All Notes and No Folder (`CreateNoteRequest.folderId`) | `notes-tab.ts` (`newFolder`) |
| Move | "Move to Folder..." in the note's Actions menu or the folder's menu (picker with impossible targets greyed and a reason), or drag a note or a folder onto a row; the toast has Undo; a locked note can be moved | `note-folder-dialogs.ts`, `note-folder-picker.ts`, `NoteFolderStore.moveNote`, `moveFolder` |
| Delete | An empty folder: plain confirm. A folder with contents: refused as it is, the dialog offers "Move Contents Up and Delete" (`moveContentsUp=true`); notes are never deleted | `NoteFolderStore.remove` |
| Permissions | `MatterNote.Edit` for New Folder, Rename and Move; `MatterNote.Delete` for Delete Folder; a reader sees the tree and the counts, items that change things are disabled with a reason | `note-folder-tree.ts` |
| Errors | `FOLDER_NAME_TAKEN` is said under the name field, `FOLDER_TOO_DEEP`, `FOLDER_LIMIT`, `FOLDER_CYCLE` in the dialog, `FOLDER_NOT_EMPTY` reopens the delete question with the real counts, `CONCURRENCY_CONFLICT` shows a toast with Reload Latest | `note-folders.ts` (`folderErrorText`), `note-folder-store.ts` |

Tests: unit `notes/note-folders.spec.ts`, `note-folder-store.spec.ts`, `note-folder-tree.spec.ts`, `note-folder-dialogs.spec.ts`, `notes-tab-folders.spec.ts`; e2e `frontend/e2e/tests/notes-folders.spec.ts` (both desktop sizes, axe).

## Related pages

- [Module Guide](../Backend/Module-Guide.md)
- [Table Reference](../Database/Table-Reference.md)
- [UI Standard](../Frontend/UI-Standard.md)
- [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)

Last verified against commit 8cc0b293.
