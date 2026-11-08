-- 67-role-landing-page.sql
-- Purpose: Landing page per role (epic #1330, issue #1332). dbo.Role.LandingPage holds the stable page key (contracts/landing-pages.json: dashboard, my-matters,
--   my-work, clients, matters, projects, assets, pod-work, task-queue, reports, administration) of the page a person with this role lands on after sign-in. NULL = no
--   role default: the application applies the landing rule that existed before (My Matters for a project manager, My Work for a person with work, the Dashboard, ...).
-- Owner: Identity (roles, landing pages).
-- Notes:
--   * Stored as a key, never a URL, so a renamed route does not break a saved value. The set of valid keys is owned by the application (the catalogue file, checked on
--     every write); the database only guarantees the shape (lower-case letters, digits and hyphens, 1 to 40 characters), so adding a page needs no new script.
--   * The person's own choice is NOT stored here: it lives in dbo.UserView (script 41 / baseline) as the remembered state of the surface "landing-page", so it neither
--     bumps the row version of the user an administrator may be editing nor adds an audit event per click. No new table: db/report-access.json is unchanged.
--   * The column is audited by the existing field-level audit of the Role entity (FIELD_CHANGED, FieldKey LandingPage).
--   * Starter roles: a fresh database gets the defaults from the starter role seeder (StarterRoles.cs) after the scripts ran. For a database that already holds the
--     starter roles, the two statements below set the same values, but ONLY while the role is still the starter role (same name and the description the seeder wrote)
--     and has no landing page yet, the same sign of "still the starter role" that earlier role scripts used. Director: dashboard. Project Manager: my-matters (what the
--     landing rule gave them before). Pod Lead, Data Technician and Data Scientist stay NULL: the old rule for them depends on whether the person has work (My Work)
--     or not (Dashboard, Task Queue), which no fixed page reproduces.
--   * Idempotent for the data statements; the ALTER runs once like every script.

ALTER TABLE dbo.Role ADD LandingPage VARCHAR(40) NULL;
GO

ALTER TABLE dbo.Role ADD CONSTRAINT CK_Role_LandingPage
  CHECK (LandingPage IS NULL OR (LEN(LandingPage) > 0 AND LandingPage COLLATE Latin1_General_BIN2 NOT LIKE '%[^a-z0-9-]%'));
GO

UPDATE dbo.Role SET LandingPage = 'dashboard'
WHERE Name = N'Director' AND IsSystemAdmin = 0 AND LandingPage IS NULL
  AND Description = N'Department head: full operational access plus oversight.';

UPDATE dbo.Role SET LandingPage = 'my-matters'
WHERE Name = N'Project Manager' AND IsSystemAdmin = 0 AND LandingPage IS NULL
  AND Description = N'Manages clients, matters and projects, can be named as a matter''s project manager; works from My Matters.';
GO
