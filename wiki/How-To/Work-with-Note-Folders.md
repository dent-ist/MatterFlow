# Work with Note Folders

[[_TOC_]]

**What this page is for.** How the folders of a matter's notes work in the backend (epic #1405, issue #1407): the rules, the endpoints, the error codes, the audit events and where the code and the tests are. The screen is a separate issue (#1408); the design is `docs/ux/notes-round-2/README.md` section 3.

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

## Related pages

- [Module Guide](../Backend/Module-Guide.md)
- [Table Reference](../Database/Table-Reference.md)
- [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)

Last verified against commit 7c6dbd18.
