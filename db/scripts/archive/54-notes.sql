-- 54-notes.sql
-- Purpose: Matter detail redesign (epic #1001, issue MD-12 #1013). Adds the Notes tables dbo.Note (a rich-text note of a matter), dbo.NoteTag (the firm-wide list of
--   tags an administrator manages), dbo.NoteTagLink (which tags a note carries) and dbo.NoteLink (what a note refers to: asset, project, matter, note, person; rebuilt from
--   the saved body), and the permissions MatterNote.View, MatterNote.Edit and MatterNote.Delete (shown as Matter Note Read, Edit and Delete).
--   Served by /api/v1/notes, /api/v1/note-tags and POST /api/v1/notes/resolve-references.
-- Owner: Notes (new module MatterFlow.Notes). Decision: docs/requirements/decisions-addendum.md section AQ items 9 and 10; mockup docs/ux/mockups/notes-mockup-r3.html.
-- Notes:
--   * BodyHtml is the SANITISED html the application stores (allow-list: paragraphs, headings, lists, quote, tables, links and one span per reference with a single
--     data-ref="kind:id" attribute). BodyText is its plain text for search; Title and Snippet are derived by the application (the title is the first line). No attachments.
--   * A note belongs to one matter (fixed at create). Lock: LockedByUserId and LockedAt are both set or both null; a locked note is read only for everybody and cannot be
--     deleted (enforced by the application). Pinning still works on a locked note. ContentUpdatedAt/By is "last updated" (content, title and tags), not the pin or the lock.
--   * Tags are firm-wide and managed by administrators (Labels, Notes tags); a note carries at most five (application rule). A tag is deactivated, not deleted, once used.
--     ColourKey is a name of the ten-colour palette of contracts/task-type-colours.json.
--   * NoteLink rows are derived data (deleted and re-inserted whenever the body is saved), so a link to a record that is later removed simply stops resolving.
--   * History (created, edited, tags changed, locked, unlocked, saved after an AI warning, pinned) is the audit trail (object type Note); no history table.
--   * Real DELETE for notes (needs MatterNote.Delete, audited). Nothing is backfilled (nobody uses the application yet). RowVersion is the concurrency token.
--   * Grants: mf_app reads, inserts, updates and deletes. The report login is denied for all four tables (db/report-access.json): notes are matter work product.
--   * Permission rows and role grants for existing roles are inserted here for the same reason as in 46-asset-dispose-permission.sql: MatterNote.View and MatterNote.Edit
--     go to Director, Project Manager, Pod Lead, Data Technician and Data Scientist; MatterNote.Delete to Director, Project Manager and Pod Lead.

CREATE TABLE dbo.NoteTag (
  NoteTagId        INT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_NoteTag PRIMARY KEY,
  Name             NVARCHAR(60)  NOT NULL,
  ColourKey        VARCHAR(20)   NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_NoteTag_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_NoteTag_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_NoteTag_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_NoteTag_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_NoteTag_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

CREATE UNIQUE INDEX UQ_NoteTag_Name ON dbo.NoteTag (Name);
GO

CREATE TABLE dbo.Note (
  NoteId               INT            NOT NULL IDENTITY(1,1) CONSTRAINT PK_Note PRIMARY KEY,
  MatterId             INT            NOT NULL,
  Title                NVARCHAR(300)  NOT NULL CONSTRAINT DF_Note_Title DEFAULT N'',
  Snippet              NVARCHAR(300)  NOT NULL CONSTRAINT DF_Note_Snippet DEFAULT N'',
  BodyHtml             NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_Note_BodyHtml DEFAULT N'',
  BodyText             NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_Note_BodyText DEFAULT N'',
  IsPinned             BIT            NOT NULL CONSTRAINT DF_Note_IsPinned DEFAULT 0,
  LockedByUserId       INT            NULL,
  LockedAt             DATETIME2      NULL,
  ContentUpdatedAt     DATETIME2      NOT NULL CONSTRAINT DF_Note_ContentUpdatedAt DEFAULT SYSUTCDATETIME(),
  ContentUpdatedByUserId INT          NULL,
  CreatedAt            DATETIME2      NOT NULL CONSTRAINT DF_Note_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId      INT            NULL,
  ModifiedAt           DATETIME2      NULL,
  ModifiedByUserId     INT            NULL,
  RowVersion           ROWVERSION     NOT NULL,
  CONSTRAINT FK_Note_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Note_LockedBy FOREIGN KEY (LockedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Note_ContentUpdatedBy FOREIGN KEY (ContentUpdatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Note_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Note_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_Note_IdMatter UNIQUE (NoteId, MatterId),
  CONSTRAINT CK_Note_Lock CHECK ((LockedByUserId IS NULL AND LockedAt IS NULL) OR (LockedByUserId IS NOT NULL AND LockedAt IS NOT NULL))
);
GO

-- The list: pinned first, then last updated, per matter.
CREATE INDEX IX_Note_Matter ON dbo.Note (MatterId, IsPinned DESC, ContentUpdatedAt DESC) INCLUDE (LockedByUserId);
GO

CREATE TABLE dbo.NoteTagLink (
  NoteId    INT NOT NULL,
  NoteTagId INT NOT NULL,
  CONSTRAINT PK_NoteTagLink PRIMARY KEY (NoteId, NoteTagId),
  CONSTRAINT FK_NoteTagLink_Note FOREIGN KEY (NoteId) REFERENCES dbo.Note (NoteId) ON DELETE CASCADE,
  CONSTRAINT FK_NoteTagLink_Tag FOREIGN KEY (NoteTagId) REFERENCES dbo.NoteTag (NoteTagId)
);
GO

CREATE INDEX IX_NoteTagLink_Tag ON dbo.NoteTagLink (NoteTagId, NoteId);
GO

CREATE TABLE dbo.NoteLink (
  NoteId     INT         NOT NULL,
  TargetType VARCHAR(10) NOT NULL,
  TargetId   INT         NOT NULL,
  CONSTRAINT PK_NoteLink PRIMARY KEY (NoteId, TargetType, TargetId),
  CONSTRAINT FK_NoteLink_Note FOREIGN KEY (NoteId) REFERENCES dbo.Note (NoteId) ON DELETE CASCADE,
  CONSTRAINT CK_NoteLink_Type CHECK (TargetType IN ('ASSET', 'PROJECT', 'MATTER', 'NOTE', 'USER'))
);
GO

-- Which notes refer to a record.
CREATE INDEX IX_NoteLink_Target ON dbo.NoteLink (TargetType, TargetId, NoteId);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteTag TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Note TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteTagLink TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteLink TO mf_app;
DENY ALTER ON dbo.NoteTag TO mf_app;
DENY ALTER ON dbo.Note TO mf_app;
DENY ALTER ON dbo.NoteTagLink TO mf_app;
DENY ALTER ON dbo.NoteLink TO mf_app;
GO

DENY SELECT, VIEW DEFINITION ON dbo.NoteTag TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.Note TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NoteTagLink TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NoteLink TO mf_report_reader;
GO

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, 'Notes', v.Description, 1
FROM (VALUES
  ('MatterNote.View', N'Matter Note Read'),
  ('MatterNote.Edit', N'Matter Note Edit'),
  ('MatterNote.Delete', N'Matter Note Delete')
) AS v (Code, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
JOIN dbo.Permission p ON p.Code IN ('MatterNote.View', 'MatterNote.Edit')
WHERE r.Name IN (N'Director', N'Project Manager', N'Pod Lead', N'Data Technician', N'Data Scientist') AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);

INSERT dbo.RolePermission (RoleId, PermissionId)
SELECT r.RoleId, p.PermissionId
FROM dbo.Role r
JOIN dbo.Permission p ON p.Code = 'MatterNote.Delete'
WHERE r.Name IN (N'Director', N'Project Manager', N'Pod Lead') AND r.IsSystemAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermission x WHERE x.RoleId = r.RoleId AND x.PermissionId = p.PermissionId);
GO
