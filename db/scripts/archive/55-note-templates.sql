-- 55-note-templates.sql
-- Purpose: Matter detail redesign (epic #1001, issue MD-12 #1013). Adds dbo.NoteTemplate (a starting text for a note: firm-wide, or for one matter) and
--   dbo.NoteTemplateTag (the tags a template offers). Served by /api/v1/note-templates.
-- Owner: Notes (module MatterFlow.Notes). Mockup: docs/ux/mockups/notes-mockup-r3.html (Templates view).
-- Notes:
--   * ScopeCode FIRM (MatterId NULL; created and changed by administrators only) or MATTER (MatterId set; anyone with MatterNote.Edit on that matter). Using a template copies it:
--     no link is kept to the note; UsedCount is only incremented. TitleTemplate and BodyHtml may contain the placeholders {{date}}, {{time}}, {{matter}}, {{author}}
--     (filled in by the client) and any other {{name}} (left for the person). BodyHtml is sanitised by the application like a note body.
--   * Names are unique among the firm templates, and per matter among that matter's templates.
--   * Real DELETE (audited by the application). The report login is denied (db/report-access.json). No permission is added: templates use MatterNote.Edit.

CREATE TABLE dbo.NoteTemplate (
  NoteTemplateId   INT            NOT NULL IDENTITY(1,1) CONSTRAINT PK_NoteTemplate PRIMARY KEY,
  ScopeCode        VARCHAR(6)     NOT NULL,
  MatterId         INT            NULL,
  Name             NVARCHAR(100)  NOT NULL,
  Description      NVARCHAR(160)  NULL,
  TitleTemplate    NVARCHAR(300)  NULL,
  BodyHtml         NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_NoteTemplate_BodyHtml DEFAULT N'',
  UsedCount        INT            NOT NULL CONSTRAINT DF_NoteTemplate_UsedCount DEFAULT 0,
  CreatedAt        DATETIME2      NOT NULL CONSTRAINT DF_NoteTemplate_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT            NULL,
  ModifiedAt       DATETIME2      NULL,
  ModifiedByUserId INT            NULL,
  RowVersion       ROWVERSION     NOT NULL,
  CONSTRAINT FK_NoteTemplate_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_NoteTemplate_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_NoteTemplate_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_NoteTemplate_Scope CHECK ((ScopeCode = 'FIRM' AND MatterId IS NULL) OR (ScopeCode = 'MATTER' AND MatterId IS NOT NULL)),
  CONSTRAINT CK_NoteTemplate_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_NoteTemplate_Used CHECK (UsedCount >= 0)
);
GO

CREATE UNIQUE INDEX UQ_NoteTemplate_FirmName ON dbo.NoteTemplate (Name) WHERE ScopeCode = 'FIRM';
CREATE UNIQUE INDEX UQ_NoteTemplate_MatterName ON dbo.NoteTemplate (MatterId, Name) WHERE MatterId IS NOT NULL;
GO

CREATE TABLE dbo.NoteTemplateTag (
  NoteTemplateId INT NOT NULL,
  NoteTagId      INT NOT NULL,
  CONSTRAINT PK_NoteTemplateTag PRIMARY KEY (NoteTemplateId, NoteTagId),
  CONSTRAINT FK_NoteTemplateTag_Template FOREIGN KEY (NoteTemplateId) REFERENCES dbo.NoteTemplate (NoteTemplateId) ON DELETE CASCADE,
  CONSTRAINT FK_NoteTemplateTag_Tag FOREIGN KEY (NoteTagId) REFERENCES dbo.NoteTag (NoteTagId)
);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteTemplate TO mf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.NoteTemplateTag TO mf_app;
DENY ALTER ON dbo.NoteTemplate TO mf_app;
DENY ALTER ON dbo.NoteTemplateTag TO mf_app;
GO

DENY SELECT, VIEW DEFINITION ON dbo.NoteTemplate TO mf_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.NoteTemplateTag TO mf_report_reader;
GO
