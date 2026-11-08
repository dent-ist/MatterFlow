-- 48-app-settings.sql
-- Purpose: Application settings (epic #850, issue #843, package BR-01; design docs/ux/app-settings/README.md, decisions addendum section AM).
--   Adds the permission Settings.Manage ("change application settings (name and icon)") and dbo.AppSetting, a small generic key/value store for
--   administrator-maintained settings. Today it holds the application name (Branding.AppName, text) and icon (Branding.Icon, binary).
-- Owner: Configuration (table, settings service) and Identity (permission catalog contracts/permissions.json).
-- Notes:
--   * Defaults live in code (name "MatterFlow", no custom icon). There is NO seed row: a missing row is the normal, valid state of a fresh
--     database and after "Reset to default" (which deletes the row). Nothing is backfilled (nobody uses the application yet).
--   * Typing is in code (the SettingDefinition registry), not in SQL: the table is a thin store. Unknown keys are ignored by the application.
--   * ContentSha256 is the SHA-256 of ValueBinary; it is the source of the ETag/version of the public branding endpoints.
--   * The icon limit of 256 KB is repeated here as a CHECK so no code path can store a larger value.
--   * RowVersion is the optimistic-concurrency token of one setting; two administrators editing different settings do not conflict.
--   * The permission row is inserted here as well as by the startup catalog sync (same text as contracts/permissions.json), same pattern as
--     34-matter-view-sensitive.sql. The built-in System Admin role holds every permission implicitly; no other role gets it by default
--     (it can be assigned on the Roles screen), so there is no RolePermission insert.
--   * Grants: mf_app reads, inserts, updates and deletes (Reset deletes the row). Application settings are not report data: the report login is denied
--     (db/report-access.json, access = deny), so a later setting that carries a secret cannot leak to reports by accident.

INSERT dbo.Permission (Code, GroupName, Description, IsActive)
SELECT v.Code, 'Administration', v.Description, 1
FROM (VALUES
  ('Settings.Manage', N'Change application settings (name and icon)')
) AS v (Code, Description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Permission p WHERE p.Code = v.Code);
GO

CREATE TABLE dbo.AppSetting (
  SettingKey      VARCHAR(100)   NOT NULL CONSTRAINT PK_AppSetting PRIMARY KEY,
  ValueText       NVARCHAR(1000) NULL,
  ValueBinary     VARBINARY(MAX) NULL,
  ContentType     VARCHAR(100)   NULL,
  ContentSha256   BINARY(32)     NULL,
  UpdatedAtUtc    DATETIME2(3)   NOT NULL CONSTRAINT DF_AppSetting_UpdatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedByUserId INT            NOT NULL,
  RowVersion      ROWVERSION     NOT NULL,
  CONSTRAINT CK_AppSetting_Key CHECK (LEN(LTRIM(RTRIM(SettingKey))) > 0),
  CONSTRAINT CK_AppSetting_Size CHECK (DATALENGTH(ValueBinary) <= 262144),
  CONSTRAINT CK_AppSetting_Binary CHECK ((ValueBinary IS NULL AND ContentType IS NULL AND ContentSha256 IS NULL)
                                       OR (ValueBinary IS NOT NULL AND ContentType IS NOT NULL AND ContentSha256 IS NOT NULL)),
  CONSTRAINT FK_AppSetting_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.AppSetting TO mf_app;
DENY ALTER ON dbo.AppSetting TO mf_app;
GO

DENY SELECT, VIEW DEFINITION ON dbo.AppSetting TO mf_report_reader;
GO
