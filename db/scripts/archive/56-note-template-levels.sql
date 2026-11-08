-- 56-note-template-levels.sql
-- Purpose: Matter detail redesign (epic #1001, issue MD-39 #1055). Note templates get three levels: System Level (every matter; was "firm-wide"), Client Level (every matter of one
--   client; new) and Matter Level (one matter; was "this matter"). Adds dbo.NoteTemplate.ClientId and re-writes the scope check, the values and the name indexes.
-- Owner: Notes (module MatterFlow.Notes). Fix-forward of script 55 (immutable).
-- Notes:
--   * ScopeCode becomes SYSTEM (ClientId and MatterId NULL), CLIENT (ClientId set, MatterId NULL) or MATTER (MatterId set, ClientId NULL). Existing FIRM rows become SYSTEM; MATTER rows stay.
--   * Names stay unique inside their level: among System templates, per client among that client's templates, per matter among that matter's templates.
--   * No new table and no new grant: dbo.NoteTemplate keeps the grants and the report-login deny of script 55.

ALTER TABLE dbo.NoteTemplate ADD ClientId INT NULL;
GO

ALTER TABLE dbo.NoteTemplate ADD CONSTRAINT FK_NoteTemplate_Client FOREIGN KEY (ClientId) REFERENCES dbo.Client (ClientId);
GO

ALTER TABLE dbo.NoteTemplate DROP CONSTRAINT CK_NoteTemplate_Scope;
DROP INDEX UQ_NoteTemplate_FirmName ON dbo.NoteTemplate;
GO

UPDATE dbo.NoteTemplate SET ScopeCode = 'SYSTEM' WHERE ScopeCode = 'FIRM';
GO

ALTER TABLE dbo.NoteTemplate ADD CONSTRAINT CK_NoteTemplate_Level CHECK (
     (ScopeCode = 'SYSTEM' AND ClientId IS NULL AND MatterId IS NULL)
  OR (ScopeCode = 'CLIENT' AND ClientId IS NOT NULL AND MatterId IS NULL)
  OR (ScopeCode = 'MATTER' AND MatterId IS NOT NULL AND ClientId IS NULL));
GO

CREATE UNIQUE INDEX UQ_NoteTemplate_SystemName ON dbo.NoteTemplate (Name) WHERE ScopeCode = 'SYSTEM';
CREATE UNIQUE INDEX UQ_NoteTemplate_ClientName ON dbo.NoteTemplate (ClientId, Name) WHERE ClientId IS NOT NULL;
GO
