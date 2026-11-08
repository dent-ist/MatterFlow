-- 05-organization.sql
-- Purpose: Organization tables (docs/erd.md section 3, decisions addendum B and O): Client, Matter, Project.
-- Owner: Organization.
--
-- Numbers are stored zero-padded (char(5)); 343 is saved as 00343 and uniqueness is enforced on that.
-- Matter.ClientNumber is a denormalized copy kept in step with the Client by a composite foreign key (ON UPDATE CASCADE),
-- so MatterRef (the combined 00343-00012 display value) can be a persisted computed column and never an entered value.
-- CustomFieldsJson is only the extension point for custom-field values; the forms engine owns its contents.
-- Tasks later reference (MatterId, ProjectId) through UQ_Project_IdMatter so a Task's Project must belong to the Task's Matter.

CREATE TABLE dbo.Client (
  ClientId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Client PRIMARY KEY,
  ClientNumber     CHAR(5)       NOT NULL,
  Name             NVARCHAR(200) NOT NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_Client_IsActive DEFAULT 1,
  CustomFieldsJson NVARCHAR(MAX) NULL,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_Client_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT UQ_Client_Number UNIQUE (ClientNumber),
  CONSTRAINT UQ_Client_IdNumber UNIQUE (ClientId, ClientNumber),
  CONSTRAINT CK_Client_Number CHECK (ClientNumber NOT LIKE '%[^0-9]%' AND LEN(ClientNumber) = 5 AND ClientNumber <> '00000'),
  CONSTRAINT CK_Client_CustomFieldsJson CHECK (CustomFieldsJson IS NULL OR ISJSON(CustomFieldsJson) = 1),
  CONSTRAINT FK_Client_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Client_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Client_Name ON dbo.Client (Name);
GO

CREATE TABLE dbo.Matter (
  MatterId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Matter PRIMARY KEY,
  ClientId         INT           NOT NULL,
  ClientNumber     CHAR(5)       NOT NULL,
  MatterNumber     CHAR(5)       NOT NULL,
  MatterRef        AS (CONVERT(CHAR(11), ClientNumber + '-' + MatterNumber)) PERSISTED NOT NULL,
  Name             NVARCHAR(300) NOT NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_Matter_IsActive DEFAULT 1,
  IsSensitive      BIT           NOT NULL CONSTRAINT DF_Matter_IsSensitive DEFAULT 0,
  CustomFieldsJson NVARCHAR(MAX) NULL,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_Matter_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT UQ_Matter_ClientMatterNumber UNIQUE (ClientId, MatterNumber),
  CONSTRAINT UQ_Matter_Ref UNIQUE (MatterRef),
  CONSTRAINT CK_Matter_Number CHECK (MatterNumber NOT LIKE '%[^0-9]%' AND LEN(MatterNumber) = 5 AND MatterNumber <> '00000'),
  CONSTRAINT CK_Matter_CustomFieldsJson CHECK (CustomFieldsJson IS NULL OR ISJSON(CustomFieldsJson) = 1),
  CONSTRAINT FK_Matter_Client FOREIGN KEY (ClientId, ClientNumber) REFERENCES dbo.Client (ClientId, ClientNumber) ON UPDATE CASCADE,
  CONSTRAINT FK_Matter_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Matter_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Matter_Client ON dbo.Matter (ClientId, IsActive);
GO

CREATE INDEX IX_Matter_Name ON dbo.Matter (Name);
GO

CREATE INDEX IX_Matter_Number ON dbo.Matter (MatterNumber);
GO

CREATE TABLE dbo.Project (
  ProjectId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Project PRIMARY KEY,
  MatterId         INT            NOT NULL,
  Name             NVARCHAR(200)  NOT NULL,
  Description      NVARCHAR(2000) NULL,
  IsActive         BIT            NOT NULL CONSTRAINT DF_Project_IsActive DEFAULT 1,
  CustomFieldsJson NVARCHAR(MAX)  NULL,
  CreatedAt        DATETIME2      NOT NULL CONSTRAINT DF_Project_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT            NULL,
  ModifiedAt       DATETIME2      NULL,
  ModifiedByUserId INT            NULL,
  RowVersion       ROWVERSION     NOT NULL,
  CONSTRAINT UQ_Project_MatterName UNIQUE (MatterId, Name),
  -- Target of the Task composite FK (MatterId, ProjectId), which keeps a Task's Project inside the Task's Matter.
  CONSTRAINT UQ_Project_IdMatter UNIQUE (ProjectId, MatterId),
  CONSTRAINT CK_Project_CustomFieldsJson CHECK (CustomFieldsJson IS NULL OR ISJSON(CustomFieldsJson) = 1),
  CONSTRAINT FK_Project_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_Project_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Project_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Project_Matter ON dbo.Project (MatterId, IsActive);
GO

CREATE INDEX IX_Project_Name ON dbo.Project (Name);
GO
