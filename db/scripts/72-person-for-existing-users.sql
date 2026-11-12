-- 72-person-for-existing-users.sql
-- Purpose: People (epic #1373, issue #1374). One-time backfill: a linked person (Internal) for every user that exists when script 71 is applied.
--   From now on the application creates the person together with the user and keeps name and email in step.
-- Owner: Identity.
-- Notes:
--   * The display name is split at its LAST space: "Mary Ann Smith" -> first "Mary Ann", last "Smith"; a single word is the first name and the last name stays empty.
--     This is the same rule as the application (PersonNameSplitter); surrounding blanks are trimmed.
--   * Deactivated users get a person too (a person is kept when its user is deactivated). Creator and modifier stay empty: it is a system action.
--   * A database without users (a fresh install) gets nothing here; users that sign in later get theirs from the application.

INSERT INTO dbo.Person (FirstName, LastName, PersonType, Email, UserId, IsActive)
SELECT
  CASE WHEN CHARINDEX(N' ', n.Name) = 0 THEN n.Name ELSE RTRIM(LEFT(n.Name, LEN(n.Name) - CHARINDEX(N' ', REVERSE(n.Name)))) END,
  CASE WHEN CHARINDEX(N' ', n.Name) = 0 THEN N'' ELSE RIGHT(n.Name, CHARINDEX(N' ', REVERSE(n.Name)) - 1) END,
  'INTERNAL',
  NULLIF(LTRIM(RTRIM(n.Email)), N''),
  n.UserId,
  1
FROM (SELECT u.UserId, u.Email, LTRIM(RTRIM(u.DisplayName)) AS Name FROM dbo.AppUser AS u) AS n
WHERE LEN(n.Name) > 0
  AND NOT EXISTS (SELECT 1 FROM dbo.Person AS p WHERE p.UserId = n.UserId);
GO
