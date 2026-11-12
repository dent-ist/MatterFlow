-- 73-vendor.sql
-- Purpose: Vendors (epic #1373, issue #1377). The vendor record and everything that hangs on it except its contacts and matter links (script 74):
--   dbo.Vendor (name, website, category Preferred or Blacklisted, note), the two admin-managed pick lists Services and Areas
--   (dbo.VendorServiceOption, dbo.VendorAreaOption, same shape as dbo.MatterType) and their multi-select choices on a vendor
--   (dbo.VendorServiceChoice, dbo.VendorAreaChoice), and the Tech AI list of a vendor (dbo.VendorTechAi, free-text names of the AI systems or services it uses).
-- Owner: Vendors.
-- Notes:
--   * CategoryCode is PREFERRED or BLACKLISTED (stable codes, the API shows the same). There is no third value and no default: the person picks one.
--   * A service or area that a vendor uses is deactivated, never deleted; the foreign key from the choice table is the backstop (the application refuses the delete with IN_USE).
--   * A vendor is deleted only while no matter is linked (script 74 makes that foreign key restrictive); its own choices, Tech AI rows and contacts go with it.
--   * Changes to vendor and list rows are audited by the generic interceptor (object types Vendor, VendorServiceOption, VendorAreaOption); changes to the choices and
--     the Tech AI list by explicit events written by the application.
--   * Every new table is classified in db/report-access.json (allow) and granted to lpt_app and lpt_report_reader below, like dbo.MatterType.

CREATE TABLE dbo.VendorServiceOption (
  VendorServiceOptionId INT IDENTITY(1,1) NOT NULL,
  Name                  NVARCHAR(100) NOT NULL,
  SortOrder             INT NOT NULL,
  IsActive              BIT NOT NULL CONSTRAINT DF_VendorServiceOption_IsActive DEFAULT 1,
  CreatedAt             DATETIME2 NOT NULL CONSTRAINT DF_VendorServiceOption_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId       INT NULL,
  ModifiedAt            DATETIME2 NULL,
  ModifiedByUserId      INT NULL,
  RowVersion            ROWVERSION NOT NULL,
  CONSTRAINT PK_VendorServiceOption PRIMARY KEY (VendorServiceOptionId),
  CONSTRAINT UQ_VendorServiceOption_Name UNIQUE (Name),
  CONSTRAINT CK_VendorServiceOption_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_VendorServiceOption_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_VendorServiceOption_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_VendorServiceOption_Sort ON dbo.VendorServiceOption (SortOrder);
GO

CREATE TABLE dbo.VendorAreaOption (
  VendorAreaOptionId INT IDENTITY(1,1) NOT NULL,
  Name               NVARCHAR(100) NOT NULL,
  SortOrder          INT NOT NULL,
  IsActive           BIT NOT NULL CONSTRAINT DF_VendorAreaOption_IsActive DEFAULT 1,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_VendorAreaOption_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT NULL,
  ModifiedAt         DATETIME2 NULL,
  ModifiedByUserId   INT NULL,
  RowVersion         ROWVERSION NOT NULL,
  CONSTRAINT PK_VendorAreaOption PRIMARY KEY (VendorAreaOptionId),
  CONSTRAINT UQ_VendorAreaOption_Name UNIQUE (Name),
  CONSTRAINT CK_VendorAreaOption_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_VendorAreaOption_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_VendorAreaOption_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_VendorAreaOption_Sort ON dbo.VendorAreaOption (SortOrder);
GO

CREATE TABLE dbo.Vendor (
  VendorId         INT IDENTITY(1,1) NOT NULL,
  Name             NVARCHAR(200) NOT NULL,
  Website          NVARCHAR(300) NULL,
  CategoryCode     VARCHAR(12) NOT NULL,
  Note             NVARCHAR(2000) NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_Vendor_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_Vendor PRIMARY KEY (VendorId),
  CONSTRAINT UQ_Vendor_Name UNIQUE (Name),
  CONSTRAINT CK_Vendor_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT CK_Vendor_Category CHECK (CategoryCode IN ('PREFERRED', 'BLACKLISTED')),
  CONSTRAINT FK_Vendor_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Vendor_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_Vendor_Category ON dbo.Vendor (CategoryCode);
GO

CREATE TABLE dbo.VendorServiceChoice (
  VendorId              INT NOT NULL,
  VendorServiceOptionId INT NOT NULL,
  CONSTRAINT PK_VendorServiceChoice PRIMARY KEY (VendorId, VendorServiceOptionId),
  CONSTRAINT FK_VendorServiceChoice_Vendor FOREIGN KEY (VendorId) REFERENCES dbo.Vendor (VendorId) ON DELETE CASCADE,
  CONSTRAINT FK_VendorServiceChoice_Option FOREIGN KEY (VendorServiceOptionId) REFERENCES dbo.VendorServiceOption (VendorServiceOptionId)
);
GO

CREATE INDEX IX_VendorServiceChoice_Option ON dbo.VendorServiceChoice (VendorServiceOptionId, VendorId);
GO

CREATE TABLE dbo.VendorAreaChoice (
  VendorId           INT NOT NULL,
  VendorAreaOptionId INT NOT NULL,
  CONSTRAINT PK_VendorAreaChoice PRIMARY KEY (VendorId, VendorAreaOptionId),
  CONSTRAINT FK_VendorAreaChoice_Vendor FOREIGN KEY (VendorId) REFERENCES dbo.Vendor (VendorId) ON DELETE CASCADE,
  CONSTRAINT FK_VendorAreaChoice_Option FOREIGN KEY (VendorAreaOptionId) REFERENCES dbo.VendorAreaOption (VendorAreaOptionId)
);
GO

CREATE INDEX IX_VendorAreaChoice_Option ON dbo.VendorAreaChoice (VendorAreaOptionId, VendorId);
GO

CREATE TABLE dbo.VendorTechAi (
  VendorTechAiId INT IDENTITY(1,1) NOT NULL,
  VendorId       INT NOT NULL,
  Name           NVARCHAR(200) NOT NULL,
  SortOrder      INT NOT NULL,
  CONSTRAINT PK_VendorTechAi PRIMARY KEY (VendorTechAiId),
  CONSTRAINT UQ_VendorTechAi_Name UNIQUE (VendorId, Name),
  CONSTRAINT CK_VendorTechAi_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
  CONSTRAINT FK_VendorTechAi_Vendor FOREIGN KEY (VendorId) REFERENCES dbo.Vendor (VendorId) ON DELETE CASCADE
);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.VendorServiceOption TO lpt_app;
DENY ALTER ON dbo.VendorServiceOption TO lpt_app;
GRANT SELECT ON dbo.VendorServiceOption TO lpt_report_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.VendorAreaOption TO lpt_app;
DENY ALTER ON dbo.VendorAreaOption TO lpt_app;
GRANT SELECT ON dbo.VendorAreaOption TO lpt_report_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Vendor TO lpt_app;
DENY ALTER ON dbo.Vendor TO lpt_app;
GRANT SELECT ON dbo.Vendor TO lpt_report_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.VendorServiceChoice TO lpt_app;
DENY ALTER ON dbo.VendorServiceChoice TO lpt_app;
GRANT SELECT ON dbo.VendorServiceChoice TO lpt_report_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.VendorAreaChoice TO lpt_app;
DENY ALTER ON dbo.VendorAreaChoice TO lpt_app;
GRANT SELECT ON dbo.VendorAreaChoice TO lpt_report_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.VendorTechAi TO lpt_app;
DENY ALTER ON dbo.VendorTechAi TO lpt_app;
GRANT SELECT ON dbo.VendorTechAi TO lpt_report_reader;
GO
