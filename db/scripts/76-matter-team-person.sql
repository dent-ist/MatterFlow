-- 76-matter-team-person.sql
-- Purpose: People (epic #1373, issue #1376). A person on a matter's team now points at the shared People list (dbo.Person) instead of carrying a typed-in
--   name and e-mail: dbo.MatterTeamMember gets PersonId, and its Name and Email columns (and the per-matter e-mail unique key) go.
-- Owner: Organization (the team table); the people rows belong to Identity.
-- Notes:
--   * Nothing is deployed and the existing team rows are demo or test data (owner, 2026-10-24), so the old columns are dropped in this one script
--     instead of the two-release expand-then-contract. The first real deployment starts from this history.
--   * Backfill, only so the demo rows survive: a row whose e-mail already belongs to a person points at that person (the lowest PersonId when several share
--     the address); every other e-mail becomes ONE new External person (the old Team held outside contacts), named from the first row that used it, with the
--     name split at its last space like script 72. No row is lost: Name and Email were required.
--   * A person is on a matter's team at most once (UQ_MatterTeamMember_MatterPerson); this replaces the e-mail rule, and the same e-mail on one matter
--     was already impossible, so the backfill cannot collide.
--   * A person is never deleted (People are deactivated), so no cascade. The title on this matter (TeamTitleId) stays on the row; the person's own Title or
--     Role is a separate field of People.
--   * No new table: the report-access classification (MatterTeamMember: deny) and the grants are unchanged. Team changes stay audited by the explicit
--     MATTER_TEAM_MEMBER_* events (the old and new values now read "Person name (Title)").

ALTER TABLE dbo.MatterTeamMember ADD PersonId INT NULL;
GO

-- One new External person per e-mail that no person has yet (named from the first team row with that address).
INSERT INTO dbo.Person (FirstName, LastName, PersonType, Email, IsActive)
SELECT
  CASE WHEN CHARINDEX(N' ', f.Name) = 0 THEN f.Name ELSE RTRIM(LEFT(f.Name, LEN(f.Name) - CHARINDEX(N' ', REVERSE(f.Name)))) END,
  CASE WHEN CHARINDEX(N' ', f.Name) = 0 THEN N'' ELSE RIGHT(f.Name, CHARINDEX(N' ', REVERSE(f.Name)) - 1) END,
  'EXTERNAL',
  f.Email,
  1
FROM (
  SELECT LTRIM(RTRIM(t.Name)) AS Name,
         t.Email COLLATE DATABASE_DEFAULT AS Email,
         ROW_NUMBER() OVER (PARTITION BY t.Email ORDER BY t.MatterTeamMemberId) AS rn
  FROM dbo.MatterTeamMember AS t
  WHERE NOT EXISTS (SELECT 1 FROM dbo.Person AS p WHERE p.Email = t.Email COLLATE DATABASE_DEFAULT)
) AS f
WHERE f.rn = 1;
GO

UPDATE t
SET PersonId = (SELECT MIN(p.PersonId) FROM dbo.Person AS p WHERE p.Email = t.Email COLLATE DATABASE_DEFAULT)
FROM dbo.MatterTeamMember AS t;
GO

ALTER TABLE dbo.MatterTeamMember ALTER COLUMN PersonId INT NOT NULL;
GO

ALTER TABLE dbo.MatterTeamMember ADD CONSTRAINT FK_MatterTeamMember_Person FOREIGN KEY (PersonId) REFERENCES dbo.Person (PersonId);
GO

ALTER TABLE dbo.MatterTeamMember DROP CONSTRAINT UQ_MatterTeamMember_MatterEmail;
ALTER TABLE dbo.MatterTeamMember DROP CONSTRAINT CK_MatterTeamMember_Name;
ALTER TABLE dbo.MatterTeamMember DROP CONSTRAINT CK_MatterTeamMember_Email;
GO

ALTER TABLE dbo.MatterTeamMember DROP COLUMN Name;
ALTER TABLE dbo.MatterTeamMember DROP COLUMN Email;
GO

ALTER TABLE dbo.MatterTeamMember ADD CONSTRAINT UQ_MatterTeamMember_MatterPerson UNIQUE (MatterId, PersonId);
GO

CREATE INDEX IX_MatterTeamMember_Person ON dbo.MatterTeamMember (PersonId);
GO
