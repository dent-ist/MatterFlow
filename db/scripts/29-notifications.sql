-- 29-notifications.sql
-- Purpose: the in-app notification store (epic #753, issue #729; docs/ux/notifications-review/README.md section 7):
--   dbo.Notification (one row per recipient and event, written by the server in the same transaction as the action) and
--   dbo.NotificationPreference (the "Notifications" switches on My profile, stored sparsely).
-- Owner: Notifications.
--
-- Notes:
--   * Id is the poll cursor (the client asks for rows with Id > sinceId); the list pages order by Id DESC.
--   * EventType is the event code (README section 3). The two stages of the scheduled events (due-soon / overdue, unassigned / on-hold) live in
--     DedupeKey, not in EventType, because the profile has one switch per event type. TaskMention is reserved (mentions are deferred).
--   * ObjectKind + ObjectId point at the task (BIGINT TaskId) or matter (INT MatterId, widened to BIGINT). There is deliberately no foreign key on
--     ObjectId (polymorphic); MatterId is the matter of the object and is used for the visibility join and for cleanup.
--   * Message is a snapshot of the wording at creation time (at most 300 characters, no HTML). It must only ever be returned to the recipient
--     while the recipient may still view the object (the check happens on every read, not here).
--   * UX_Notification_Dedupe makes scheduled inserts idempotent: (RecipientUserId, EventType, ObjectId, DedupeKey).
--   * NotificationPreference holds ONLY rows that differ from the default (default = on). A missing row means on, so a new event type is on for
--     everybody without a data migration. UpdatedUtc feeds the preferences version of the poll ETag.
--   * Grants: mf_app gets INSERT, SELECT and DELETE on both tables, and UPDATE only on ReadUtc (Notification) and on Enabled / UpdatedUtc
--     (NotificationPreference): the column-level DENY below wins over the schema-level GRANT of 13-security-hardening.sql.
--     Notification rows are derived data and are not audited (the action that caused one already has its audit row).

CREATE TABLE dbo.Notification (
  Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Notification PRIMARY KEY,
  RecipientUserId INT           NOT NULL,
  EventType       VARCHAR(40)   NOT NULL,
  ObjectKind      VARCHAR(20)   NOT NULL,
  ObjectId        BIGINT        NOT NULL,
  MatterId        INT           NULL,
  ActorUserId     INT           NULL,
  Message         NVARCHAR(300) NOT NULL,
  DedupeKey       NVARCHAR(80)  NOT NULL,
  CreatedUtc      DATETIME2(3)  NOT NULL CONSTRAINT DF_Notification_CreatedUtc DEFAULT SYSUTCDATETIME(),
  ReadUtc         DATETIME2(3)  NULL,
  CONSTRAINT FK_Notification_Recipient FOREIGN KEY (RecipientUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Notification_Actor FOREIGN KEY (ActorUserId) REFERENCES dbo.AppUser (UserId),
  CONSTRAINT FK_Notification_Matter FOREIGN KEY (MatterId) REFERENCES dbo.Matter (MatterId),
  CONSTRAINT CK_Notification_EventType CHECK (EventType IN ('TaskAssigned', 'TaskDue', 'TaskComment', 'TaskMention', 'MatterTaskOverdue',
                                                            'MatterTaskCreated', 'MatterTaskStalled', 'MatterManagerSet', 'PodTaskUnassigned')),
  CONSTRAINT CK_Notification_ObjectKind CHECK (ObjectKind IN ('Task', 'Matter')),
  CONSTRAINT CK_Notification_Message CHECK (LEN(LTRIM(RTRIM(Message))) > 0),
  CONSTRAINT CK_Notification_DedupeKey CHECK (LEN(DedupeKey) > 0),
  CONSTRAINT CK_Notification_ReadAfterCreate CHECK (ReadUtc IS NULL OR ReadUtc >= CreatedUtc)
);
GO

-- Idempotency of scheduled inserts (and a guard against a double publish).
CREATE UNIQUE INDEX UX_Notification_Dedupe ON dbo.Notification (RecipientUserId, EventType, ObjectId, DedupeKey);
-- Unread count and poll: index-only seek of the newest unread rows of one person.
CREATE INDEX IX_Notification_Unread ON dbo.Notification (RecipientUserId, Id DESC) INCLUDE (ObjectKind, ObjectId, MatterId) WHERE ReadUtc IS NULL;
-- The list (page and panel) and the poll cursor.
CREATE INDEX IX_Notification_Recipient ON dbo.Notification (RecipientUserId, Id DESC);
-- Retention (delete read rows older than 90 days).
CREATE INDEX IX_Notification_Read ON dbo.Notification (ReadUtc) WHERE ReadUtc IS NOT NULL;
-- Retention hard limit for unread rows and cleanup by matter.
CREATE INDEX IX_Notification_Created ON dbo.Notification (CreatedUtc);
GO

CREATE TABLE dbo.NotificationPreference (
  UserId     INT          NOT NULL,
  EventType  VARCHAR(40)  NOT NULL,
  Enabled    BIT          NOT NULL,
  UpdatedUtc DATETIME2(3) NOT NULL CONSTRAINT DF_NotificationPreference_UpdatedUtc DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_NotificationPreference PRIMARY KEY (UserId, EventType),
  CONSTRAINT FK_NotificationPreference_User FOREIGN KEY (UserId) REFERENCES dbo.AppUser (UserId),
  -- One switch per event type; the mention notification follows the TaskComment switch, so it has no row of its own.
  CONSTRAINT CK_NotificationPreference_EventType CHECK (EventType IN ('TaskAssigned', 'TaskDue', 'TaskComment', 'MatterTaskOverdue',
                                                                       'MatterTaskCreated', 'MatterTaskStalled', 'MatterManagerSet', 'PodTaskUnassigned'))
);
GO

-- Application identity: read, insert, delete; update only the mutable columns. A DENY beats the schema-level GRANT of script 13.
GRANT SELECT, INSERT, DELETE ON dbo.Notification TO mf_app;
GRANT SELECT, INSERT, DELETE ON dbo.NotificationPreference TO mf_app;
DENY UPDATE (RecipientUserId, EventType, ObjectKind, ObjectId, MatterId, ActorUserId, Message, DedupeKey, CreatedUtc) ON dbo.Notification TO mf_app;
DENY UPDATE (UserId, EventType) ON dbo.NotificationPreference TO mf_app;
DENY ALTER ON dbo.Notification TO mf_app;
DENY ALTER ON dbo.NotificationPreference TO mf_app;
GO
