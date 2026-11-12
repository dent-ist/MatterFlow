-- 74-vendor-contact-and-matter-link.sql
-- Purpose: Vendors (epic #1373, issue #1377). The people at a vendor and the link of a vendor to a matter.
--   dbo.VendorContact: a person from the shared People list (dbo.Person) at a vendor, with one current flag (NONE, RECOMMENDED or DO_NOT_HIRE),
--   the date it was reported, who reported it and a note. dbo.VendorMatter: a vendor linked to a matter (who and when).
-- Owner: Vendors.
-- Notes:
--   * One current flag per contact, not a history: an earlier flag and note are in the audit trail (object type VendorContact).
--   * A contact without a flag (NONE) carries no reported date, reporter or note (checked); a flag is reported on a date by a user.
--   * A person is a contact of a vendor at most once. A contact is removed with its vendor; a person is never deleted (People are deactivated).
--   * A vendor linked to a matter cannot be deleted: the foreign key from dbo.VendorMatter to dbo.Vendor has no cascade (the application refuses first, with the count).
--   * Links to matters are audited by explicit VENDOR_LINKED / VENDOR_UNLINKED events that carry the matter (sensitive-matter rule); the application shows a link only to
--     people who may see the matter.
--   * Both new tables are classified in db/report-access.json (allow) and granted to lpt_report_reader below.

CREATE TABLE dbo.VendorContact (
  VendorContactId  INT IDENTITY(1,1) NOT NULL,
  VendorId         INT NOT NULL,
  PersonId         INT NOT NULL,
  FlagCode         VARCHAR(12) NOT NULL CONSTRAINT DF_VendorContact_FlagCode DEFAULT 'NONE',
  ReportedOn       DATE NULL,
  ReportedByUserId INT NULL,
  Note             NVARCHAR(2000) NULL,
  CreatedAt        DATETIME2 NOT NULL CONSTRAINT DF_VendorContact_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT NULL,
  ModifiedAt       DATETIME2 NULL,
  ModifiedByUserId INT NULL,
  RowVersion       ROWVERSION NOT NULL,
  CONSTRAINT PK_VendorContact PRIMARY KEY (VendorContactId),
  CONSTRAINT UQ_VendorContact_VendorPerson UNIQUE (VendorId, PersonId),
  CONSTRAINT CK_VendorContact_Flag CHECK (FlagCode IN ('NONE', 'RECOMMENDED', 'DO_NOT_HIRE')),
  CONSTRAINT CK_VendorContact_Report CHECK (FlagCode <> 'NONE' OR (ReportedOn IS NULL AND ReportedByUserId IS NULL AND Note IS NULL)),
  CONSTRAINT FK_VendorContact_Vendor FOREIGN KEY (VendorId) REFERENCES dbo.Vendor (VendorId) ON DELETE CASCADE,
  CONSTRAINT FK_VendorContact_Person FOREIGN KEY (PersonId) REFERENCES dbo.Person (PersonId),
  CONSTRAINT FK_VendorContact_ReportedBy FOREIGN KEY (ReportedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_VendorContact_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_VendorContact_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_VendorContact_Person ON dbo.VendorContact (PersonId);
GO

CREATE TABLE dbo.VendorMatter (
  VendorId       INT NOT NULL,
  MatterId       INT NOT NULL,
  LinkedAt       DATETIME2 NOT NULL CONSTRAINT DF_VendorMatter_LinkedAt DEFAULT SYSUTCDATETIME(),
  LinkedByUserId INT NULL,
  CONSTRAINT PK_VendorMatter PRIMARY KEY (VendorId, MatterId),
  CONSTRAINT FK_VendorMatter_Vendor FOREIGN KEY (VendorId) REFERENCES dbo.Vendor (VendorId),
  CONSTRAINT FK_VendorMatter_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT FK_VendorMatter_LinkedBy FOREIGN KEY (LinkedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_VendorMatter_Matter ON dbo.VendorMatter (MatterId, VendorId);
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.VendorContact TO lpt_app;
DENY ALTER ON dbo.VendorContact TO lpt_app;
GRANT SELECT ON dbo.VendorContact TO lpt_report_reader;
GRANT SELECT, INSERT, DELETE ON dbo.VendorMatter TO lpt_app;
DENY UPDATE, ALTER ON dbo.VendorMatter TO lpt_app;
GRANT SELECT ON dbo.VendorMatter TO lpt_report_reader;
GO
