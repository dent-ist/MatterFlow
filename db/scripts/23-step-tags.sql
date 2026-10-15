-- 23-step-tags.sql
-- Purpose: free-form tags on library steps (dbo.StepDefinition), so steps can be found by tag in the Workflow Steps list and in the
--   workflow designer's step picker. Two normalised tables:
--     dbo.StepTag            one row per distinct tag: TagKey (the normalised, lower-cased text; case-insensitive unique, the lookup key)
--                            and Name (the display spelling of the first time the tag was entered), so "relativity" and "Relativity" are
--                            the same tag across steps.
--     dbo.StepDefinitionTag  which steps carry which tags (a step has a tag at most once), with the order the admin entered them in.
-- Owner: WorkflowEngine (step library).
-- Notes:
--   * Tags are metadata of the LIBRARY step only. dbo.WorkflowVersionStep (the published copy) has no tag columns, so editing tags never
--     changes a published workflow version and the immutability triggers of 09-workflow-config.sql are not involved.
--   * The application normalises (trim, collapse inner whitespace, max 40 characters, max 20 per step, no control characters); the checks
--     here are the last line of defence. A tag no step carries any more is deleted by the application.
--   * TagKey is declared with an explicit case-insensitive collation so uniqueness does not depend on the database default.

CREATE TABLE dbo.StepTag (
  StepTagId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StepTag PRIMARY KEY,
  TagKey    NVARCHAR(40) COLLATE Latin1_General_100_CI_AS NOT NULL,
  Name      NVARCHAR(40) NOT NULL,
  CreatedAt DATETIME2    NOT NULL CONSTRAINT DF_StepTag_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_StepTag_Key UNIQUE (TagKey),
  CONSTRAINT CK_StepTag_Key CHECK (LEN(LTRIM(RTRIM(TagKey))) > 0),
  CONSTRAINT CK_StepTag_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

CREATE TABLE dbo.StepDefinitionTag (
  StepDefinitionId INT NOT NULL,
  StepTagId        INT NOT NULL,
  SortOrder        INT NOT NULL CONSTRAINT DF_StepDefinitionTag_SortOrder DEFAULT 0,
  CONSTRAINT PK_StepDefinitionTag PRIMARY KEY (StepDefinitionId, StepTagId),
  CONSTRAINT FK_StepDefinitionTag_Step FOREIGN KEY (StepDefinitionId) REFERENCES dbo.StepDefinition (StepDefinitionId),
  CONSTRAINT FK_StepDefinitionTag_Tag FOREIGN KEY (StepTagId) REFERENCES dbo.StepTag (StepTagId),
  CONSTRAINT CK_StepDefinitionTag_SortOrder CHECK (SortOrder >= 0)
);
GO

-- Steps that carry a tag (the tag filter and the usage counts); the primary key already serves "tags of a step".
CREATE INDEX IX_StepDefinitionTag_Tag ON dbo.StepDefinitionTag (StepTagId, StepDefinitionId);
GO
