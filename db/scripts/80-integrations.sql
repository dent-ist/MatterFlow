-- 80-integrations.sql
-- Purpose: Integrations #1395 (epic #1389). Administration > Settings > Integrations: ONE Microsoft Entra ID connection (Tenant ID, Client ID, Client Secret) that every external API shares,
--   and one row per integration (Matter Lookup, Ethical Wall, any number of Other) with its Base URL and its own scope. LPT Hub asks Entra ID for a different scope per API
--   (OAuth2 client credentials) using the one connection.
-- Owner: Integrations (module LptHub.Integrations).
-- Notes:
--   * dbo.EntraConnection holds exactly ONE row (CK_EntraConnection_Single, EntraConnectionId = 1), seeded empty here. The client secret is stored ENCRYPTED (ASP.NET Core Data Protection, base64 text)
--     in ClientSecretProtected; the key ring is NOT in the database (docs/runbook.md section on Data Protection keys). The application never returns, logs or audits the secret.
--   * dbo.EntraConnection and dbo.Integration are classified DENY in db/report-access.json: the report login can read neither table.
--   * dbo.Integration: at most one Matter Lookup and one Ethical Wall (filtered unique index UQ_Integration_FixedType); any number of Other. A Base URL must start with https://.
--   * Seeded: the Matter Lookup and Ethical Wall rows, enabled but without Base URL and Scope, so they read "Not Set Up" until an administrator enters them. No data backfill is needed.
--   * The last test result (when, by whom, outcome code, token lifetime) is stored so the page shows it after a reload; no token and no secret is ever stored in it.

CREATE TABLE dbo.EntraConnection (
  EntraConnectionId       INT NOT NULL CONSTRAINT DF_EntraConnection_Id DEFAULT 1,
  TenantId                NVARCHAR(100) NULL,
  ClientId                NVARCHAR(100) NULL,
  ClientSecretProtected   NVARCHAR(4000) NULL,
  SecretExpiresOn         DATE NULL,
  SecretUpdatedAtUtc      DATETIME2 NULL,
  SecretUpdatedByUserId   INT NULL,
  LastTestAtUtc           DATETIME2 NULL,
  LastTestByUserId        INT NULL,
  LastTestOutcome         VARCHAR(30) NULL,
  LastTestTokenSeconds    INT NULL,
  CreatedAt               DATETIME2 NOT NULL CONSTRAINT DF_EntraConnection_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId         INT NULL,
  ModifiedAt              DATETIME2 NULL,
  ModifiedByUserId        INT NULL,
  RowVersion              ROWVERSION NOT NULL,
  CONSTRAINT PK_EntraConnection PRIMARY KEY (EntraConnectionId),
  CONSTRAINT CK_EntraConnection_Single CHECK (EntraConnectionId = 1),
  CONSTRAINT CK_EntraConnection_Outcome CHECK (LastTestOutcome IS NULL OR LastTestOutcome IN ('OK', 'NOT_SET_UP', 'ENTRA_UNREACHABLE', 'CREDENTIALS_REFUSED', 'SECRET_EXPIRED', 'SCOPE_REFUSED', 'API_UNREACHABLE', 'API_REFUSED')),
  CONSTRAINT FK_EntraConnection_SecretUpdatedBy FOREIGN KEY (SecretUpdatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_EntraConnection_LastTestBy FOREIGN KEY (LastTestByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_EntraConnection_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_EntraConnection_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

INSERT dbo.EntraConnection (EntraConnectionId) VALUES (1);
GO

CREATE TABLE dbo.Integration (
  IntegrationId        INT IDENTITY(1,1) NOT NULL,
  Name                 NVARCHAR(100) NOT NULL,
  TypeCode             VARCHAR(20) NOT NULL,
  BaseUrl              NVARCHAR(500) NULL,
  Scope                NVARCHAR(300) NULL,
  IsEnabled            BIT NOT NULL CONSTRAINT DF_Integration_IsEnabled DEFAULT 1,
  LastTestAtUtc        DATETIME2 NULL,
  LastTestByUserId     INT NULL,
  LastTestOutcome      VARCHAR(30) NULL,
  LastTestTokenSeconds INT NULL,
  CreatedAt            DATETIME2 NOT NULL CONSTRAINT DF_Integration_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId      INT NULL,
  ModifiedAt           DATETIME2 NULL,
  ModifiedByUserId     INT NULL,
  RowVersion           ROWVERSION NOT NULL,
  CONSTRAINT PK_Integration PRIMARY KEY (IntegrationId),
  CONSTRAINT UQ_Integration_Name UNIQUE (Name),
  CONSTRAINT CK_Integration_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_Integration_Type CHECK (TypeCode IN ('MATTER_LOOKUP', 'ETHICAL_WALL', 'OTHER')),
  CONSTRAINT CK_Integration_BaseUrl CHECK (BaseUrl IS NULL OR BaseUrl LIKE 'https://_%'),
  CONSTRAINT CK_Integration_Scope CHECK (Scope IS NULL OR LEN(LTRIM(RTRIM(Scope))) BETWEEN 3 AND 300),
  CONSTRAINT CK_Integration_Outcome CHECK (LastTestOutcome IS NULL OR LastTestOutcome IN ('OK', 'NOT_SET_UP', 'ENTRA_UNREACHABLE', 'CREDENTIALS_REFUSED', 'SECRET_EXPIRED', 'SCOPE_REFUSED', 'API_UNREACHABLE', 'API_REFUSED')),
  CONSTRAINT FK_Integration_LastTestBy FOREIGN KEY (LastTestByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Integration_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Integration_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- One Matter Lookup and one Ethical Wall at most; Other is unlimited.
CREATE UNIQUE INDEX UQ_Integration_FixedType ON dbo.Integration (TypeCode) WHERE TypeCode <> 'OTHER';
GO

INSERT dbo.Integration (Name, TypeCode, IsEnabled)
VALUES (N'Matter Lookup', 'MATTER_LOOKUP', 1), (N'Ethical Wall', 'ETHICAL_WALL', 1);
GO

-- The connection is one seeded row: the application reads and updates it, never inserts or deletes it.
GRANT SELECT, UPDATE ON dbo.EntraConnection TO lpt_app;
DENY INSERT, DELETE, ALTER ON dbo.EntraConnection TO lpt_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Integration TO lpt_app;
DENY ALTER ON dbo.Integration TO lpt_app;
DENY SELECT, VIEW DEFINITION ON dbo.EntraConnection TO lpt_report_reader;
DENY SELECT, VIEW DEFINITION ON dbo.Integration TO lpt_report_reader;
GO
