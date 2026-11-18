-- 84-note-images.sql
-- Purpose: pasted images in notes (epic #1405, issue #1409; design docs/ux/notes-round-2/README.md section 4; ADR 030 amends decision 027).
-- Owner: Notes (module LptHub.Notes).
-- Notes:
--   * dbo.NoteImage: the bytes of one image of ONE matter (not of one note), stored in the database next to the note, outside the note body. The body only holds <img data-image-id="..."> (no URL).
--     Only PNG and JPEG (CK_NoteImage_Type), at most 2 MB (CK_NoteImage_Size) and 8,000 px on a side (CK_NoteImage_Dimensions); the service checks the bytes (magic bytes, header, size) before it inserts,
--     the constraints are the second line. ContentSha256 is the ETag of the read endpoint. Content is never selected by list queries.
--   * Which notes use an image is dbo.NoteLink with the new target type IMAGE, rebuilt from the saved body like every other reference. There is no foreign key from NoteLink to NoteImage (TargetId
--     is generic); the service deletes an image in the same transaction as the save that removes its last reference.
--   * Images are deleted at once when nothing uses them (a save, a cancel, a note delete). The only job is a quiet nightly sweep of unreferenced images uploaded more than 48 hours ago (a crash net).
--   * UploadedByUserId has an index: the technical guard of 50 pending (unsaved) uploads per person counts them.
--   * No backfill (no old rows) and no cascade from Matter (matters are never deleted).
--   * dbo.NoteImage is classified DENY in db/report-access.json: the report login cannot read it.

ALTER TABLE dbo.NoteLink DROP CONSTRAINT CK_NoteLink_Type;
GO

ALTER TABLE dbo.NoteLink ADD CONSTRAINT CK_NoteLink_Type CHECK (TargetType IN ('ASSET', 'PROJECT', 'MATTER', 'NOTE', 'USER', 'IMAGE'));
GO

CREATE TABLE dbo.NoteImage (
  NoteImageId      INT IDENTITY(1,1) NOT NULL,
  MatterId         INT NOT NULL,
  ContentType      VARCHAR(20) NOT NULL,
  Width            SMALLINT NOT NULL,
  Height           SMALLINT NOT NULL,
  ByteSize         INT NOT NULL,
  ContentSha256    BINARY(32) NOT NULL,
  Content          VARBINARY(MAX) NOT NULL,
  UploadedAt       DATETIME2 NOT NULL CONSTRAINT DF_NoteImage_UploadedAt DEFAULT SYSUTCDATETIME(),
  UploadedByUserId INT NULL,
  CONSTRAINT PK_NoteImage PRIMARY KEY (NoteImageId),
  CONSTRAINT CK_NoteImage_Type CHECK (ContentType IN ('image/png', 'image/jpeg')),
  CONSTRAINT CK_NoteImage_Dimensions CHECK (Width BETWEEN 1 AND 8000 AND Height BETWEEN 1 AND 8000),
  CONSTRAINT CK_NoteImage_Size CHECK (ByteSize BETWEEN 1 AND 2097152 AND DATALENGTH(Content) = ByteSize),
  CONSTRAINT FK_NoteImage_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_NoteImage_UploadedBy FOREIGN KEY (UploadedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- The images of a matter, the safety sweep (oldest uploads first) and the pending count of one person.
CREATE INDEX IX_NoteImage_Matter ON dbo.NoteImage (MatterId);
CREATE INDEX IX_NoteImage_Uploaded ON dbo.NoteImage (UploadedAt);
CREATE INDEX IX_NoteImage_UploadedBy ON dbo.NoteImage (UploadedByUserId);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteImage TO lpt_app;
DENY ALTER ON dbo.NoteImage TO lpt_app;
DENY SELECT, VIEW DEFINITION ON dbo.NoteImage TO lpt_report_reader;
GO
