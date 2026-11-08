-- 04-pods.sql
-- Purpose: Pods and membership (docs/erd.md section 4, docs/architecture.md section 6; addendum E):
--   Pod, PodMember (a user can belong to many Pods; at most one primary Pod per user).
--   Pod Lead is a ROLE, so PodMember has no lead flag. Pods are deactivated, never deleted.
-- Owner: Identity.
-- Not in this script: UserPreference (separate ticket).

CREATE TABLE dbo.Pod (
  PodId            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Pod PRIMARY KEY,
  Name             NVARCHAR(100) NOT NULL,
  Description      NVARCHAR(500) NULL,
  IsActive         BIT           NOT NULL CONSTRAINT DF_Pod_IsActive DEFAULT 1,
  CreatedAt        DATETIME2     NOT NULL CONSTRAINT DF_Pod_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId  INT           NULL,
  ModifiedAt       DATETIME2     NULL,
  ModifiedByUserId INT           NULL,
  RowVersion       ROWVERSION    NOT NULL,
  CONSTRAINT UQ_Pod_Name UNIQUE (Name),
  CONSTRAINT FK_Pod_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Pod_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE TABLE dbo.PodMember (
  PodId     INT NOT NULL,
  UserId    INT NOT NULL,
  IsPrimary BIT NOT NULL CONSTRAINT DF_PodMember_IsPrimary DEFAULT 0,
  CONSTRAINT PK_PodMember PRIMARY KEY (PodId, UserId),
  CONSTRAINT FK_PodMember_Pod FOREIGN KEY (PodId) REFERENCES dbo.Pod (PodId),
  CONSTRAINT FK_PodMember_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId)
);
GO

CREATE INDEX IX_PodMember_User ON dbo.PodMember (UserId);
GO

-- At most one primary Pod per user.
CREATE UNIQUE INDEX UQ_PodMember_Primary ON dbo.PodMember (UserId) WHERE IsPrimary = 1;
GO
