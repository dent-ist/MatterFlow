-- 03-audit.sql
-- Purpose: append-only AuditEvent table (architecture section 9, ERD section 8).
-- Owner: Audit.
--
-- ActorUserId is a plain nullable int with NO foreign key on purpose: the AppUser table arrives with 02-identity-authz.sql
-- and a later script adds the FK. MatterId/TaskId are denormalized scope columns and never get FKs (audit outlives its subjects).
-- Append-only is enforced twice: DENY UPDATE/DELETE for the application role (when it exists) and an INSTEAD OF trigger that
-- rejects UPDATE/DELETE for everybody, including sysadmin logins that bypass DENY.

CREATE TABLE dbo.AuditEvent (
    AuditEventId  BIGINT IDENTITY(1,1) NOT NULL,
    OccurredAtUtc DATETIME2(3)         NOT NULL CONSTRAINT DF_AuditEvent_OccurredAtUtc DEFAULT SYSUTCDATETIME(),
    ActorUserId   INT                  NULL,
    EventType     VARCHAR(64)          NOT NULL,
    ObjectType    VARCHAR(40)          NOT NULL,
    ObjectId      VARCHAR(40)          NOT NULL,
    MatterId      INT                  NULL,
    TaskId        BIGINT               NULL,
    FieldKey      VARCHAR(100)         NULL,
    OldValue      NVARCHAR(MAX)        NULL,
    NewValue      NVARCHAR(MAX)        NULL,
    Summary       NVARCHAR(500)        NULL,
    CorrelationId UNIQUEIDENTIFIER     NOT NULL,
    CONSTRAINT PK_AuditEvent PRIMARY KEY CLUSTERED (AuditEventId),
    CONSTRAINT CK_AuditEvent_EventType CHECK (LEN(EventType) > 0)
);
GO

CREATE INDEX IX_Audit_Object  ON dbo.AuditEvent (ObjectType, ObjectId, AuditEventId);
CREATE INDEX IX_Audit_Time    ON dbo.AuditEvent (OccurredAtUtc);
CREATE INDEX IX_Audit_Task    ON dbo.AuditEvent (TaskId, AuditEventId) WHERE TaskId IS NOT NULL;
CREATE INDEX IX_Audit_Matter  ON dbo.AuditEvent (MatterId, AuditEventId) WHERE MatterId IS NOT NULL;
CREATE INDEX IX_Audit_Actor   ON dbo.AuditEvent (ActorUserId, AuditEventId) WHERE ActorUserId IS NOT NULL;
CREATE INDEX IX_Audit_Correlation ON dbo.AuditEvent (CorrelationId);
GO

CREATE TRIGGER dbo.TR_AuditEvent_AppendOnly ON dbo.AuditEvent
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 51000, 'AuditEvent is append-only: UPDATE and DELETE are not allowed.', 1;
END;
GO

IF DATABASE_PRINCIPAL_ID('mf_app') IS NOT NULL
BEGIN
    GRANT INSERT, SELECT ON dbo.AuditEvent TO mf_app;
    DENY UPDATE, DELETE ON dbo.AuditEvent TO mf_app;
END;
GO
