-- 02-identity-authz.sql
-- Purpose: identity and authorization tables (docs/erd.md section 4, docs/architecture.md section 6):
--   AppUser, UserIdentity, Role, Permission, RolePermission, UserRole, plus the built-in System Admin role row.
-- Owner: Identity.
-- Not in this script: Pod/PodMember/UserPreference (own ticket), the permission catalog and starter roles
-- (synchronized by the app after migrations from contracts/permissions.json, architecture 4.6).

CREATE TABLE dbo.AppUser (
  UserId             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AppUser PRIMARY KEY,
  DisplayName        NVARCHAR(200) NOT NULL,
  Email              NVARCHAR(320) NULL,
  IsActive           BIT           NOT NULL CONSTRAINT DF_AppUser_IsActive DEFAULT 1,
  BootstrapAppliedAt DATETIME2     NULL,
  LastLoginAt        DATETIME2     NULL,
  CreatedAt          DATETIME2     NOT NULL CONSTRAINT DF_AppUser_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT           NULL,
  ModifiedAt         DATETIME2     NULL,
  ModifiedByUserId   INT           NULL,
  RowVersion         ROWVERSION    NOT NULL,
  CONSTRAINT FK_AppUser_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_AppUser_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_AppUser_Display ON dbo.AppUser (DisplayName);
GO

CREATE TABLE dbo.UserIdentity (
  UserIdentityId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_UserIdentity PRIMARY KEY,
  UserId           INT           NOT NULL,
  Provider         VARCHAR(20)   NOT NULL,
  TenantId         VARCHAR(64)   NOT NULL CONSTRAINT DF_UserIdentity_TenantId DEFAULT '',
  ProviderSubject  NVARCHAR(200) NOT NULL,
  Username         NVARCHAR(256) NOT NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_UserIdentity_IsActive DEFAULT 1,
  VerifiedAt       DATETIME2     NULL,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_UserIdentity_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_UserIdentity_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserIdentity_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserIdentity_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_UserIdentity_Provider CHECK (Provider IN ('Windows', 'Dev', 'Entra')),
  -- The unique index makes concurrent first logins safe: the loser gets a duplicate-key error and re-reads.
  CONSTRAINT UQ_UserIdentity_Provider UNIQUE (Provider, TenantId, ProviderSubject)
);
GO

CREATE INDEX IX_UserIdentity_User ON dbo.UserIdentity (UserId);
GO

CREATE INDEX IX_UserIdentity_Username ON dbo.UserIdentity (Username);
GO

CREATE TABLE dbo.Role (
  RoleId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Role PRIMARY KEY,
  Name             NVARCHAR(100) NOT NULL,
  Description      NVARCHAR(500) NULL,
  IsSystemAdmin    BIT           NOT NULL CONSTRAINT DF_Role_IsSystemAdmin DEFAULT 0,
  IsActive         BIT           NOT NULL CONSTRAINT DF_Role_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_Role_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT UQ_Role_Name UNIQUE (Name),
  CONSTRAINT FK_Role_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Role_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

-- At most one built-in System Admin role.
CREATE UNIQUE INDEX UQ_Role_SystemAdmin ON dbo.Role (IsSystemAdmin) WHERE IsSystemAdmin = 1;
GO

CREATE TABLE dbo.Permission (
  PermissionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Permission PRIMARY KEY,
  Code         VARCHAR(64)   NOT NULL,
  GroupName    VARCHAR(40)   NOT NULL,
  Description  NVARCHAR(300) NOT NULL,
  IsActive     BIT           NOT NULL CONSTRAINT DF_Permission_IsActive DEFAULT 1,
  CONSTRAINT UQ_Permission_Code UNIQUE (Code)
);
GO

CREATE TABLE dbo.RolePermission (
  RoleId       INT NOT NULL,
  PermissionId INT NOT NULL,
  CONSTRAINT PK_RolePermission PRIMARY KEY (RoleId, PermissionId),
  CONSTRAINT FK_RolePermission_Role FOREIGN KEY (RoleId) REFERENCES dbo.Role (RoleId),
  CONSTRAINT FK_RolePermission_Permission FOREIGN KEY (PermissionId) REFERENCES dbo.Permission (PermissionId)
);
GO

CREATE INDEX IX_RolePermission_Permission ON dbo.RolePermission (PermissionId);
GO

CREATE TABLE dbo.UserRole (
  UserId          INT       NOT NULL,
  RoleId          INT       NOT NULL,
  GrantedAt       DATETIME2 NOT NULL CONSTRAINT DF_UserRole_GrantedAt DEFAULT SYSUTCDATETIME(),
  GrantedByUserId INT       NULL,
  CONSTRAINT PK_UserRole PRIMARY KEY (UserId, RoleId),
  CONSTRAINT FK_UserRole_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_UserRole_Role FOREIGN KEY (RoleId) REFERENCES dbo.Role (RoleId),
  CONSTRAINT FK_UserRole_GrantedBy FOREIGN KEY (GrantedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_UserRole_Role ON dbo.UserRole (RoleId);
GO

-- Structural seed needed by logic: the built-in, locked System Admin role (implicitly holds every permission).
INSERT INTO dbo.Role (Name, Description, IsSystemAdmin, IsActive)
VALUES (N'System Admin', N'Built-in administrator role. Holds every permission and cannot be edited or deleted.', 1, 1);
GO
