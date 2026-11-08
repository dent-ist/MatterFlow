-- 06-forms.sql
-- Purpose: dynamic forms and custom fields (docs/erd.md section 6, docs/architecture.md section 7):
--   FormDefinition, FormVersion, FormField, FormFieldOption, FormValueSet, CustomFieldIndex,
--   plus the immutability triggers for published/retired versions (defense in depth behind the application service).
-- Owner: Forms (Configuration module).
-- Notes:
--   * FormDefinition owner keys (TaskTypeId, StepDefinitionId, AssetTypeId) are plain INT columns for now: the owner tables
--     arrive in later scripts, which add the FOREIGN KEY constraints (FK_FormDef_TaskType, FK_FormDef_Step, FK_FormDef_AssetType).
--   * FormValueSet stores the submitted values of any owner together with the FormVersionId they were captured under, until the
--     owner rows carry their own JSON columns. CustomFieldIndex is the derived typed filter index (rewritten in the same transaction).

CREATE TABLE dbo.FormDefinition (
  FormDefinitionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FormDefinition PRIMARY KEY,
  Scope            VARCHAR(20) NOT NULL,
  TaskTypeId       INT         NULL,
  StepDefinitionId INT         NULL,
  AssetTypeId      INT         NULL,
  IsActive         BIT         NOT NULL CONSTRAINT DF_FormDefinition_IsActive DEFAULT 1,
  CreatedAt        DATETIME2   NOT NULL CONSTRAINT DF_FormDefinition_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT         NULL,
  ModifiedAt       DATETIME2   NULL,
  ModifiedByUserId INT         NULL,
  RowVersion       ROWVERSION  NOT NULL,
  CONSTRAINT FK_FormDefinition_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_FormDefinition_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_FormDefinition_Scope CHECK (Scope IN ('TASK_TYPE', 'STEP', 'ASSET_TYPE', 'CLIENT', 'MATTER', 'PROJECT')),
  CONSTRAINT CK_FormDefinition_Owner CHECK (
       (Scope = 'TASK_TYPE'  AND TaskTypeId IS NOT NULL AND StepDefinitionId IS NULL AND AssetTypeId IS NULL)
    OR (Scope = 'STEP'       AND StepDefinitionId IS NOT NULL AND TaskTypeId IS NULL AND AssetTypeId IS NULL)
    OR (Scope = 'ASSET_TYPE' AND AssetTypeId IS NOT NULL AND TaskTypeId IS NULL AND StepDefinitionId IS NULL)
    OR (Scope IN ('CLIENT', 'MATTER', 'PROJECT') AND TaskTypeId IS NULL AND StepDefinitionId IS NULL AND AssetTypeId IS NULL))
);
GO

CREATE UNIQUE INDEX UQ_FormDef_TaskType ON dbo.FormDefinition (TaskTypeId) WHERE TaskTypeId IS NOT NULL;
GO

CREATE UNIQUE INDEX UQ_FormDef_Step ON dbo.FormDefinition (StepDefinitionId) WHERE StepDefinitionId IS NOT NULL;
GO

CREATE UNIQUE INDEX UQ_FormDef_AssetType ON dbo.FormDefinition (AssetTypeId) WHERE AssetTypeId IS NOT NULL;
GO

CREATE UNIQUE INDEX UQ_FormDef_Singleton ON dbo.FormDefinition (Scope) WHERE Scope IN ('CLIENT', 'MATTER', 'PROJECT');
GO

CREATE TABLE dbo.FormVersion (
  FormVersionId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FormVersion PRIMARY KEY,
  FormDefinitionId    INT           NOT NULL,
  VersionNo           INT           NOT NULL,
  Status              VARCHAR(12)   NOT NULL,
  ClonedFromVersionId INT           NULL,
  PublishedAt         DATETIME2     NULL,
  PublishedByUserId   INT           NULL,
  Notes               NVARCHAR(500) NULL,
  CreatedAt           DATETIME2     NOT NULL CONSTRAINT DF_FormVersion_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId     INT           NULL,
  ModifiedAt          DATETIME2     NULL,
  ModifiedByUserId    INT           NULL,
  RowVersion          ROWVERSION    NOT NULL,
  CONSTRAINT FK_FormVersion_Definition FOREIGN KEY (FormDefinitionId) REFERENCES dbo.FormDefinition (FormDefinitionId),
  CONSTRAINT FK_FormVersion_ClonedFrom FOREIGN KEY (ClonedFromVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT FK_FormVersion_PublishedBy FOREIGN KEY (PublishedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_FormVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_FormVersion_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_FormVersion_No UNIQUE (FormDefinitionId, VersionNo),
  CONSTRAINT CK_FormVersion_Status CHECK (Status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  CONSTRAINT CK_FormVersion_PublishedAt CHECK (Status = 'DRAFT' OR PublishedAt IS NOT NULL)
);
GO

CREATE UNIQUE INDEX UQ_FormVersion_Published ON dbo.FormVersion (FormDefinitionId) WHERE Status = 'PUBLISHED';
GO

CREATE UNIQUE INDEX UQ_FormVersion_Draft ON dbo.FormVersion (FormDefinitionId) WHERE Status = 'DRAFT';
GO

CREATE INDEX IX_FormVersion_ClonedFrom ON dbo.FormVersion (ClonedFromVersionId) WHERE ClonedFromVersionId IS NOT NULL;
GO

CREATE TABLE dbo.FormField (
  FormFieldId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FormField PRIMARY KEY,
  FormVersionId     INT            NOT NULL,
  FieldKey          VARCHAR(64)    NOT NULL,
  Label             NVARCHAR(200)  NOT NULL,
  ControlType       VARCHAR(20)    NOT NULL,
  HelpText          NVARCHAR(1000) NULL,
  SortOrder         INT            NOT NULL,
  SectionKey        VARCHAR(64)    NULL,
  IsRequired        BIT            NOT NULL CONSTRAINT DF_FormField_IsRequired DEFAULT 0,
  DefaultValueJson  NVARCHAR(MAX)  NULL,
  ValidationJson    NVARCHAR(MAX)  NULL,
  ShowWhenJson      NVARCHAR(MAX)  NULL,
  RequiredWhenJson  NVARCHAR(MAX)  NULL,
  IsFilterable      BIT            NOT NULL CONSTRAINT DF_FormField_IsFilterable DEFAULT 0,
  CONSTRAINT FK_FormField_Version FOREIGN KEY (FormVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT UQ_FormField_Key UNIQUE (FormVersionId, FieldKey),
  CONSTRAINT UQ_FormField_Order UNIQUE (FormVersionId, SortOrder),
  -- Binary collation so [a-z] means lowercase ASCII only.
  CONSTRAINT CK_FormField_Key CHECK (
    FieldKey COLLATE Latin1_General_100_BIN2 LIKE '[a-z]%'
    AND FieldKey COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^a-z0-9_]%'),
  CONSTRAINT CK_FormField_Control CHECK (ControlType IN (
    'TEXT', 'TEXTAREA', 'NUMBER', 'CHECKBOX', 'SELECT', 'RADIO', 'MULTISELECT', 'DATE', 'DATETIME', 'URL',
    'ASSET_REF', 'USER_REF', 'SECTION_HEADING', 'HELP_TEXT')),
  -- A default may be any JSON value (including a bare string or number), so it is wrapped before testing.
  CONSTRAINT CK_FormField_DefaultJson CHECK (DefaultValueJson IS NULL OR ISJSON('[' + DefaultValueJson + ']') = 1),
  CONSTRAINT CK_FormField_ValidationJson CHECK (ValidationJson IS NULL OR ISJSON(ValidationJson) = 1),
  CONSTRAINT CK_FormField_ShowWhenJson CHECK (ShowWhenJson IS NULL OR ISJSON(ShowWhenJson) = 1),
  CONSTRAINT CK_FormField_RequiredWhenJson CHECK (RequiredWhenJson IS NULL OR ISJSON(RequiredWhenJson) = 1)
);
GO

CREATE TABLE dbo.FormFieldOption (
  FormFieldOptionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FormFieldOption PRIMARY KEY,
  FormFieldId       INT           NOT NULL,
  OptionKey         VARCHAR(64)   NOT NULL,
  Label             NVARCHAR(200) NOT NULL,
  SortOrder         INT           NOT NULL,
  AvailableWhenJson NVARCHAR(MAX) NULL,
  CONSTRAINT FK_FormFieldOption_Field FOREIGN KEY (FormFieldId) REFERENCES dbo.FormField (FormFieldId),
  CONSTRAINT UQ_FormFieldOption_Key UNIQUE (FormFieldId, OptionKey),
  CONSTRAINT UQ_FormFieldOption_Order UNIQUE (FormFieldId, SortOrder),
  CONSTRAINT CK_FormFieldOption_AvailableWhen CHECK (AvailableWhenJson IS NULL OR ISJSON(AvailableWhenJson) = 1)
);
GO

-- Values submitted for one owner (a Task, a Step Instance, a Client, ...) and the form version they were captured under.
CREATE TABLE dbo.FormValueSet (
  FormValueSetId   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FormValueSet PRIMARY KEY,
  OwnerKind        VARCHAR(16)   NOT NULL,
  OwnerId          BIGINT        NOT NULL,
  FormDefinitionId INT           NOT NULL,
  FormVersionId    INT           NOT NULL,
  ValuesJson       NVARCHAR(MAX) NOT NULL,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_FormValueSet_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT FK_FormValueSet_Definition FOREIGN KEY (FormDefinitionId) REFERENCES dbo.FormDefinition (FormDefinitionId),
  CONSTRAINT FK_FormValueSet_Version FOREIGN KEY (FormVersionId) REFERENCES dbo.FormVersion (FormVersionId),
  CONSTRAINT FK_FormValueSet_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_FormValueSet_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_FormValueSet_Owner UNIQUE (OwnerKind, OwnerId, FormDefinitionId),
  CONSTRAINT CK_FormValueSet_OwnerKind CHECK (OwnerKind IN ('TASK', 'STEP_INSTANCE', 'CLIENT', 'MATTER', 'PROJECT', 'ASSET')),
  CONSTRAINT CK_FormValueSet_Json CHECK (ISJSON(ValuesJson) = 1)
);
GO

CREATE INDEX IX_FormValueSet_Version ON dbo.FormValueSet (FormVersionId);
GO

-- Derived, rebuildable typed copies of filterable values. Polymorphic owner, no FK by design.
CREATE TABLE dbo.CustomFieldIndex (
  CustomFieldIndexId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomFieldIndex PRIMARY KEY,
  OwnerKind          VARCHAR(12)   NOT NULL,
  OwnerId            BIGINT        NOT NULL,
  FormDefinitionId   INT           NOT NULL,
  FieldKey           VARCHAR(64)   NOT NULL,
  ValueText          NVARCHAR(450) NULL,
  ValueNumber        DECIMAL(19,4) NULL,
  ValueDate          DATE          NULL,
  ValueDateTime      DATETIME2     NULL,
  ValueBool          BIT           NULL,
  CONSTRAINT FK_CFI_Definition FOREIGN KEY (FormDefinitionId) REFERENCES dbo.FormDefinition (FormDefinitionId),
  CONSTRAINT CK_CFI_OwnerKind CHECK (OwnerKind IN ('TASK', 'CLIENT', 'MATTER', 'PROJECT', 'ASSET')),
  CONSTRAINT CK_CFI_OneValue CHECK (
    (CASE WHEN ValueText IS NULL THEN 0 ELSE 1 END
   + CASE WHEN ValueNumber IS NULL THEN 0 ELSE 1 END
   + CASE WHEN ValueDate IS NULL THEN 0 ELSE 1 END
   + CASE WHEN ValueDateTime IS NULL THEN 0 ELSE 1 END
   + CASE WHEN ValueBool IS NULL THEN 0 ELSE 1 END) = 1)
);
GO

CREATE INDEX IX_CFI_Text ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueText) INCLUDE (OwnerId) WHERE ValueText IS NOT NULL;
GO

CREATE INDEX IX_CFI_Number ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueNumber) INCLUDE (OwnerId) WHERE ValueNumber IS NOT NULL;
GO

CREATE INDEX IX_CFI_Date ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueDate) INCLUDE (OwnerId) WHERE ValueDate IS NOT NULL;
GO

CREATE INDEX IX_CFI_DateTime ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueDateTime) INCLUDE (OwnerId) WHERE ValueDateTime IS NOT NULL;
GO

CREATE INDEX IX_CFI_Bool ON dbo.CustomFieldIndex (OwnerKind, FormDefinitionId, FieldKey, ValueBool) INCLUDE (OwnerId) WHERE ValueBool IS NOT NULL;
GO

CREATE INDEX IX_CFI_Owner ON dbo.CustomFieldIndex (OwnerKind, OwnerId);
GO

-- Immutability (architecture 7.2). A version may change freely while DRAFT. Once PUBLISHED it can only become RETIRED (the
-- other columns stay equal; audit stamps and the rowversion may move), and it is never deleted. Retired is final.
CREATE TRIGGER dbo.TR_FormVersion_Immutable ON dbo.FormVersion
AFTER UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (SELECT 1 FROM deleted d WHERE d.Status <> 'DRAFT')
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM inserted)
      THROW 51001, 'A published or retired form version is immutable and cannot be deleted.', 1;

    -- Every pre-update row that was not a draft must be a PUBLISHED row becoming RETIRED ...
    IF EXISTS (
      SELECT 1 FROM deleted d JOIN inserted i ON i.FormVersionId = d.FormVersionId
      WHERE d.Status <> 'DRAFT' AND NOT (d.Status = 'PUBLISHED' AND i.Status = 'RETIRED'))
      THROW 51002, 'A published or retired form version is immutable (only PUBLISHED to RETIRED is allowed).', 1;

    -- ... and nothing else about it may change.
    IF EXISTS (
      SELECT d.FormVersionId, d.FormDefinitionId, d.VersionNo, d.ClonedFromVersionId, d.PublishedAt, d.PublishedByUserId, d.Notes, d.CreatedAt, d.CreatedByUserId
      FROM deleted d WHERE d.Status <> 'DRAFT'
      EXCEPT
      SELECT i.FormVersionId, i.FormDefinitionId, i.VersionNo, i.ClonedFromVersionId, i.PublishedAt, i.PublishedByUserId, i.Notes, i.CreatedAt, i.CreatedByUserId
      FROM inserted i)
      THROW 51003, 'A published or retired form version is immutable (only its status may change to RETIRED).', 1;
  END
END;
GO

CREATE TRIGGER dbo.TR_FormField_Immutable ON dbo.FormField
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM (SELECT FormVersionId FROM inserted UNION SELECT FormVersionId FROM deleted) x
    JOIN dbo.FormVersion v ON v.FormVersionId = x.FormVersionId
    WHERE v.Status <> 'DRAFT')
    THROW 51004, 'Fields of a published or retired form version are immutable.', 1;
END;
GO

CREATE TRIGGER dbo.TR_FormFieldOption_Immutable ON dbo.FormFieldOption
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM (SELECT FormFieldId FROM inserted UNION SELECT FormFieldId FROM deleted) x
    JOIN dbo.FormField f ON f.FormFieldId = x.FormFieldId
    JOIN dbo.FormVersion v ON v.FormVersionId = f.FormVersionId
    WHERE v.Status <> 'DRAFT')
    THROW 51005, 'Options of a published or retired form version are immutable.', 1;
END;
GO
