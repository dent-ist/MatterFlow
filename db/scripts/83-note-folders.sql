-- 83-note-folders.sql
-- Purpose: nested folders for the notes of a matter (epic #1405, issue #1407; design docs/ux/notes-round-2/README.md section 3).
-- Owner: Notes (module LptHub.Notes).
-- Notes:
--   * dbo.NoteFolder: a folder belongs to ONE matter and has an optional parent folder of the same matter. The composite foreign key (ParentFolderId, MatterId) -> (NoteFolderId, MatterId)
--     is the (Id, MatterId) trick dbo.Note already uses (UQ_Note_IdMatter), so a folder cannot have a parent in another matter, whatever the application does. A NULL ParentFolderId skips
--     the foreign key: that is a top-level folder.
--   * dbo.Note.FolderId (NULL = "No Folder", the top level). FK_Note_Folder (FolderId, MatterId) -> NoteFolder (NoteFolderId, MatterId): a note can only be in a folder of its own matter.
--     No cascade anywhere: the service moves notes and subfolders first ("Move Contents Up and Delete"), and the database refuses to delete a folder that still holds a note or a subfolder.
--   * UQ_NoteFolder_Name (MatterId, ParentFolderId, Name): a name is unique inside one parent, also at the top level (SQL Server treats NULLs as equal in a unique index), under the database
--     collation (case-insensitive). The service trims the name first.
--   * Depth (5 levels), the number (200 per matter) and cycles are rules of the service (design 3.2), not of the schema.
--   * Existing notes stay at the top level: no backfill, no default folders (the application is not deployed).
--   * dbo.NoteFolder is classified DENY in db/report-access.json: the report login cannot read it.

CREATE TABLE dbo.NoteFolder (
  NoteFolderId     INT IDENTITY(1,1) NOT NULL,
  MatterId         INT NOT NULL,
  ParentFolderId   INT NULL,
  Name             NVARCHAR(100) NOT NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_NoteFolder_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_NoteFolder PRIMARY KEY (NoteFolderId),
  CONSTRAINT UQ_NoteFolder_IdMatter UNIQUE (NoteFolderId, MatterId),
  CONSTRAINT UQ_NoteFolder_Name UNIQUE (MatterId, ParentFolderId, Name),
  CONSTRAINT CK_NoteFolder_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0 AND Name NOT LIKE N'%[/\]%'),
  CONSTRAINT CK_NoteFolder_NotOwnParent CHECK (ParentFolderId IS NULL OR ParentFolderId <> NoteFolderId),
  CONSTRAINT FK_NoteFolder_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_NoteFolder_Parent FOREIGN KEY (ParentFolderId, MatterId) REFERENCES dbo.NoteFolder (NoteFolderId, MatterId),
  CONSTRAINT FK_NoteFolder_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_NoteFolder_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- The children of a folder, and the 200-per-matter count.
CREATE INDEX IX_NoteFolder_Parent ON dbo.NoteFolder (MatterId, ParentFolderId);
GO

ALTER TABLE dbo.Note ADD FolderId INT NULL;
GO

ALTER TABLE dbo.Note ADD CONSTRAINT FK_Note_Folder FOREIGN KEY (FolderId, MatterId) REFERENCES dbo.NoteFolder (NoteFolderId, MatterId);
GO

-- The notes of a folder (direct), and the counts per folder of a matter.
CREATE INDEX IX_Note_Folder ON dbo.Note (MatterId, FolderId);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteFolder TO lpt_app;
DENY ALTER ON dbo.NoteFolder TO lpt_app;
DENY SELECT, VIEW DEFINITION ON dbo.NoteFolder TO lpt_report_reader;
GO
