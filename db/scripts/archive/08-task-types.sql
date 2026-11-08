-- 08-task-types.sql
-- Purpose: Task Types (docs/erd.md "TaskType", baseline 8.1, architecture 5-7): dbo.TaskType (name, description, active flag, optional
--   default workflow) and dbo.TaskTypeWorkflowEligibility (which Workflow definitions a Task Type may use for new Tasks).
-- Owner: Configuration.
-- Notes:
--   * A Task Type is never deleted (deactivate only). Its request form is the FormDefinition with Scope TASK_TYPE and TaskTypeId = this
--     (created by the application together with the Task Type); FormDefinition.TaskTypeId stays a plain INT here.
--   * WorkflowDefinitionId (and DefaultWorkflowDefinitionId) are plain INT columns with NO foreign key yet: the workflow tables arrive in
--     another script, which adds FK_TaskTypeWorkflowEligibility_Workflow and FK_TaskType_DefaultWorkflow.
--   * "The default workflow is one of the eligible workflows" is an application rule (erd.md), not a constraint.

CREATE TABLE dbo.TaskType (
  TaskTypeId                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TaskType PRIMARY KEY,
  Name                        NVARCHAR(100)  NOT NULL,
  Description                 NVARCHAR(1000) NULL,
  IsActive                    BIT            NOT NULL CONSTRAINT DF_TaskType_IsActive DEFAULT 1,
  DefaultWorkflowDefinitionId INT            NULL,
  CreatedAt                   DATETIME2      NOT NULL CONSTRAINT DF_TaskType_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId             INT            NULL,
  ModifiedAt                  DATETIME2      NULL,
  ModifiedByUserId            INT            NULL,
  RowVersion                  ROWVERSION     NOT NULL,
  CONSTRAINT FK_TaskType_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_TaskType_ModifiedBy FOREIGN KEY (ModifiedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT UQ_TaskType_Name UNIQUE (Name),
  CONSTRAINT CK_TaskType_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0)
);
GO

CREATE TABLE dbo.TaskTypeWorkflowEligibility (
  TaskTypeId         INT       NOT NULL,
  WorkflowDefinitionId INT     NOT NULL,
  CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_TaskTypeWorkflowEligibility_CreatedAt DEFAULT SYSUTCDATETIME(),
  CreatedByUserId    INT       NULL,
  CONSTRAINT PK_TaskTypeWorkflowEligibility PRIMARY KEY (TaskTypeId, WorkflowDefinitionId),
  CONSTRAINT FK_TaskTypeWorkflowEligibility_TaskType FOREIGN KEY (TaskTypeId) REFERENCES dbo.TaskType (TaskTypeId),
  CONSTRAINT FK_TaskTypeWorkflowEligibility_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT CK_TaskTypeWorkflowEligibility_Workflow CHECK (WorkflowDefinitionId > 0)
);
GO

-- Which Task Types may use a Workflow (impact lists on the workflow screens).
CREATE INDEX IX_TaskTypeWorkflowEligibility_Workflow ON dbo.TaskTypeWorkflowEligibility (WorkflowDefinitionId);
GO
