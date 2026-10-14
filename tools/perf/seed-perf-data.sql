-- MatterFlow performance dataset (ticket 64). Run with sqlcmd -b -v Scale=1 -i seed-perf-data.sql against a throwaway database that
-- the API has already migrated and seeded with the starter configuration (see README.md in this folder).
--
-- Scale=1 produces about: 300 users with roles, 40 Pods, 200 Clients, 1,000 Matters, 3,000 Projects, 52,500 Assets (250 each in 50 Matters),
-- 25,000 Tasks with workflow instances and step instances (about 4.7 steps each), request and step form values, 60,000 comments,
-- 100,000 Task-Asset links and about 500,000 audit events. Scale=0.1 gives a ten times smaller set for a quick check.
-- Data is random (NEWID based) so two runs differ in content but not in volume. Refuses to run twice (dbo.SeedMarker 'perf-seed-v1').
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF EXISTS (SELECT 1 FROM dbo.SeedMarker WHERE Name = 'perf-seed-v1') THROW 50000, 'The performance dataset is already loaded.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.Priority) OR NOT EXISTS (SELECT 1 FROM dbo.TaskType) OR NOT EXISTS (SELECT 1 FROM dbo.Role WHERE Name = N'Data Technician')
    THROW 50000, 'Start the API once with Seed:StarterConfiguration:Enabled=true first (roles, priorities, task types and workflows are needed).', 1;
IF EXISTS (SELECT 1 FROM dbo.Task) OR EXISTS (SELECT 1 FROM dbo.Client) THROW 50000, 'Use an empty database: Tasks or Clients already exist.', 1;

CREATE TABLE #cfg (Name VARCHAR(40) NOT NULL PRIMARY KEY, Val BIGINT NOT NULL);
DECLARE @s FLOAT = $(Scale);
INSERT #cfg VALUES
  ('Clients', CASE WHEN 200 * @s < 10 THEN 10 ELSE CAST(200 * @s AS INT) END),
  ('Tasks', CAST(25000 * @s AS INT)),
  ('Comments', CAST(60000 * @s AS INT)),
  ('SpreadAssets', CAST(40000 * @s AS INT)),
  ('AuditFieldChangesPerTask', 4);
INSERT #cfg VALUES ('Matters', (SELECT Val * 5 FROM #cfg WHERE Name = 'Clients'));
GO

CREATE TABLE #first (i INT NOT NULL PRIMARY KEY, v NVARCHAR(40) NOT NULL);
INSERT #first VALUES (0,N'Avery'),(1,N'Jordan'),(2,N'Taylor'),(3,N'Morgan'),(4,N'Riley'),(5,N'Casey'),(6,N'Quinn'),(7,N'Harper'),(8,N'Rowan'),(9,N'Skyler'),
  (10,N'Alex'),(11,N'Sam'),(12,N'Jamie'),(13,N'Dana'),(14,N'Robin'),(15,N'Kelly'),(16,N'Drew'),(17,N'Cameron'),(18,N'Devon'),(19,N'Emerson'),
  (20,N'Priya'),(21,N'Marcus'),(22,N'Elena'),(23,N'Tomas'),(24,N'Aisha'),(25,N'Noah'),(26,N'Mei'),(27,N'Omar'),(28,N'Sofia'),(29,N'Liam'),
  (30,N'Hannah'),(31,N'Diego'),(32,N'Grace'),(33,N'Victor'),(34,N'Naomi'),(35,N'Ethan'),(36,N'Isla'),(37,N'Felix'),(38,N'Maya'),(39,N'Owen');
CREATE TABLE #last (i INT NOT NULL PRIMARY KEY, v NVARCHAR(40) NOT NULL);
INSERT #last VALUES (0,N'Nguyen'),(1,N'Patel'),(2,N'Garcia'),(3,N'Kim'),(4,N'Okafor'),(5,N'Rossi'),(6,N'Silva'),(7,N'Haddad'),(8,N'Novak'),(9,N'Larsen'),
  (10,N'Mitchell'),(11,N'Brooks'),(12,N'Sullivan'),(13,N'Reyes'),(14,N'Fischer'),(15,N'Tanaka'),(16,N'Cohen'),(17,N'Walsh'),(18,N'Ortiz'),(19,N'Lindqvist'),
  (20,N'Bianchi'),(21,N'Adeyemi'),(22,N'Kowalski'),(23,N'Hughes'),(24,N'Moreau'),(25,N'Chandra'),(26,N'Bennett'),(27,N'Vargas'),(28,N'Schmidt'),(29,N'Yamamoto'),
  (30,N'Dubois'),(31,N'Murphy'),(32,N'Rahman'),(33,N'Castillo'),(34,N'Andersen'),(35,N'Petrov'),(36,N'Gallagher'),(37,N'Mensah'),(38,N'Park'),(39,N'Romero'),
  (40,N'Whitfield'),(41,N'Sandoval'),(42,N'Hoffman'),(43,N'Iyer'),(44,N'Brennan'),(45,N'Zhou'),(46,N'Delgado'),(47,N'Fraser'),(48,N'Lombardi'),(49,N'Oyelaran'),
  (50,N'Keller'),(51,N'Sato'),(52,N'Pruitt'),(53,N'Alvarez'),(54,N'Montgomery'),(55,N'Bhatt'),(56,N'Eriksen'),(57,N'Duarte'),(58,N'Holloway'),(59,N'Tran');
CREATE TABLE #word (i INT NOT NULL PRIMARY KEY, v NVARCHAR(40) NOT NULL);
INSERT #word VALUES (0,N'Falcon'),(1,N'Harbor'),(2,N'Summit'),(3,N'Meridian'),(4,N'Cobalt'),(5,N'Juniper'),(6,N'Granite'),(7,N'Beacon'),(8,N'Atlas'),(9,N'Sterling'),
  (10,N'Orchard'),(11,N'Pinnacle'),(12,N'Redwood'),(13,N'Lantern'),(14,N'Cascade'),(15,N'Ironwood'),(16,N'Zenith'),(17,N'Crescent'),(18,N'Northwind'),(19,N'Vanguard'),
  (20,N'Evergreen'),(21,N'Bridgewater'),(22,N'Silverline'),(23,N'Oakridge'),(24,N'Ember'),(25,N'Tidewater'),(26,N'Keystone'),(27,N'Aurora'),(28,N'Blackstone'),(29,N'Clearwater');
GO

-- ---------------------------------------------------------------- users, roles, pods
DECLARE @now DATETIME2 = SYSUTCDATETIME();
DECLARE @uBase INT = ISNULL((SELECT MAX(UserId) FROM dbo.AppUser), 0);

INSERT dbo.AppUser (DisplayName, Email, IsActive, CreatedAt)
SELECT f.v + N' ' + l.v, LOWER(f.v + N'.' + l.v) + CAST(g.value AS NVARCHAR(4)) + N'@perf.example', 1, DATEADD(DAY, -300, @now)
FROM GENERATE_SERIES(1, 300) g
JOIN #first f ON f.i = (g.value * 7) % 40
JOIN #last l ON l.i = (g.value * 11 + g.value / 40) % 60
ORDER BY g.value;

CREATE TABLE #U (i INT NOT NULL PRIMARY KEY, UserId INT NOT NULL, Username NVARCHAR(256) NOT NULL, RoleName NVARCHAR(100) NOT NULL);
INSERT #U (i, UserId, Username, RoleName)
SELECT g.value, @uBase + g.value, N'perf.user' + RIGHT('000' + CAST(g.value AS VARCHAR(3)), 3),
  CASE WHEN g.value <= 5 THEN N'Director' WHEN g.value <= 15 THEN N'Project Manager' WHEN g.value <= 30 THEN N'Pod Lead'
       WHEN g.value <= 185 THEN N'Data Technician' WHEN g.value <= 245 THEN N'Data Scientist' WHEN g.value <= 270 THEN N'Intake Coordinator'
       WHEN g.value <= 290 THEN N'Read-Only Observer' WHEN g.value <= 295 THEN N'Configuration Admin' ELSE N'Compliance Auditor' END
FROM GENERATE_SERIES(1, 300) g;

INSERT dbo.UserIdentity (UserId, Provider, TenantId, ProviderSubject, Username, IsActive, VerifiedAt, CreatedAt, LastLoginAt)
SELECT UserId, 'Dev', '', LOWER(Username), Username, 1, DATEADD(DAY, -299, @now), DATEADD(DAY, -300, @now), DATEADD(DAY, -1, @now) FROM #U;

INSERT dbo.UserRole (UserId, RoleId, GrantedAt)
SELECT u.UserId, r.RoleId, DATEADD(DAY, -299, @now) FROM #U u JOIN dbo.Role r ON r.Name = u.RoleName;

DECLARE @pBase INT = ISNULL((SELECT MAX(PodId) FROM dbo.Pod), 0);
INSERT dbo.Pod (Name, Description, IsActive, CreatedAt)
SELECT N'Pod ' + RIGHT('0' + CAST(g.value AS VARCHAR(3)), 2) + N' ' + w.v, N'Performance dataset pod', 1, DATEADD(DAY, -300, @now)
FROM GENERATE_SERIES(1, 40) g JOIN #word w ON w.i = g.value % 30 ORDER BY g.value;
CREATE TABLE #P (pi INT NOT NULL PRIMARY KEY, PodId INT NOT NULL);
INSERT #P SELECT g.value, @pBase + g.value FROM GENERATE_SERIES(1, 40) g;

-- everybody who works Tasks (users 6..270) has a primary Pod; a third of the Pod Leads/Technicians/Scientists also belong to a second one
INSERT dbo.PodMember (PodId, UserId, IsPrimary)
SELECT p.PodId, u.UserId, 1 FROM #U u JOIN #P p ON p.pi = ((u.i - 6) % 40) + 1 WHERE u.i BETWEEN 6 AND 270;
INSERT dbo.PodMember (PodId, UserId, IsPrimary)
SELECT p2.PodId, u.UserId, 0
FROM #U u JOIN #P p2 ON p2.pi = ((u.i * 5) % 40) + 1
WHERE u.i BETWEEN 16 AND 245 AND u.i % 3 = 0 AND ((u.i * 5) % 40) <> ((u.i - 6) % 40);

-- the users that tasks get assigned to: technicians and scientists, with their primary Pod
CREATE TABLE #Asg (k INT NOT NULL PRIMARY KEY, UserId INT NOT NULL, PodId INT NOT NULL);
INSERT #Asg SELECT u.i - 30, u.UserId, p.PodId FROM #U u JOIN #P p ON p.pi = ((u.i - 6) % 40) + 1 WHERE u.i BETWEEN 31 AND 245;
PRINT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' users, roles, pods done';
GO

-- ---------------------------------------------------------------- clients, matters, projects
DECLARE @now DATETIME2 = SYSUTCDATETIME();
DECLARE @nClients INT = (SELECT Val FROM #cfg WHERE Name = 'Clients');
DECLARE @cBase INT = ISNULL((SELECT MAX(ClientId) FROM dbo.Client), 0);
DECLARE @mBase INT = ISNULL((SELECT MAX(MatterId) FROM dbo.Matter), 0);
DECLARE @creator INT = (SELECT UserId FROM #U WHERE i = 7);

INSERT dbo.Client (ClientNumber, Name, IsActive, CreatedAt, CreatedByUserId)
SELECT RIGHT('00000' + CAST(10000 + g.value AS VARCHAR(10)), 5),
  w1.v + N' ' + w2.v + CASE g.value % 4 WHEN 0 THEN N' Holdings LLP' WHEN 1 THEN N' Industries Inc.' WHEN 2 THEN N' Partners' ELSE N' Group' END,
  CASE WHEN g.value % 25 = 0 THEN 0 ELSE 1 END, DATEADD(DAY, -(250 + g.value % 40), @now), @creator
FROM GENERATE_SERIES(1, @nClients) g JOIN #word w1 ON w1.i = g.value % 30 JOIN #word w2 ON w2.i = (g.value * 7 + 3) % 30
ORDER BY g.value;

INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, IsActive, IsSensitive, CreatedAt, CreatedByUserId)
SELECT c.ClientId, c.ClientNumber, RIGHT('00000' + CAST(k.value AS VARCHAR(5)), 5),
  CASE (c.ClientId + k.value) % 5 WHEN 0 THEN N'Investigation ' WHEN 1 THEN N'Litigation ' WHEN 2 THEN N'Merger Review ' WHEN 3 THEN N'Regulatory Inquiry ' ELSE N'Arbitration ' END
    + w.v + N' ' + CAST(c.ClientId * 10 + k.value AS NVARCHAR(10)),
  CASE WHEN (c.ClientId * 5 + k.value) % 20 = 3 THEN 0 ELSE 1 END,
  CASE WHEN (c.ClientId * 5 + k.value) % 50 = 7 THEN 1 ELSE 0 END,
  DATEADD(DAY, -(200 + (c.ClientId + k.value) % 40), @now), @creator
FROM dbo.Client c CROSS JOIN GENERATE_SERIES(1, 5) k JOIN #word w ON w.i = (c.ClientId * 3 + k.value) % 30
WHERE c.ClientId > @cBase ORDER BY c.ClientId, k.value;

-- mi = running index of the dataset's Matters; every 20th is a "big" Matter (250 Assets, a large share of the Tasks)
CREATE TABLE #M (mi INT NOT NULL PRIMARY KEY, MatterId INT NOT NULL, IsBig BIT NOT NULL);
INSERT #M SELECT ROW_NUMBER() OVER (ORDER BY MatterId), MatterId, CASE WHEN ROW_NUMBER() OVER (ORDER BY MatterId) % 20 = 0 THEN 1 ELSE 0 END
FROM dbo.Matter WHERE MatterId > @mBase;

DECLARE @pjBase INT = ISNULL((SELECT MAX(ProjectId) FROM dbo.Project), 0);
INSERT dbo.Project (MatterId, Name, Description, IsActive, CreatedAt, CreatedByUserId)
SELECT m.MatterId, CASE k.value WHEN 1 THEN N'Phase 1 - Collection' WHEN 2 THEN N'Phase 2 - Review' ELSE N'Phase 3 - Production' END,
  N'Performance dataset project', CASE WHEN (m.mi + k.value) % 30 = 0 THEN 0 ELSE 1 END, DATEADD(DAY, -150, @now), @creator
FROM #M m CROSS JOIN GENERATE_SERIES(1, 3) k ORDER BY m.mi, k.value;
CREATE TABLE #Pj (MatterId INT NOT NULL, k INT NOT NULL, ProjectId INT NOT NULL, PRIMARY KEY (MatterId, k));
INSERT #Pj SELECT MatterId, ROW_NUMBER() OVER (PARTITION BY MatterId ORDER BY ProjectId), ProjectId FROM dbo.Project WHERE ProjectId > @pjBase;
PRINT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' clients, matters, projects done';
GO

-- ---------------------------------------------------------------- assets
DECLARE @now DATETIME2 = SYSUTCDATETIME();
DECLARE @spread INT = (SELECT Val FROM #cfg WHERE Name = 'SpreadAssets');
DECLARE @nSmall INT = (SELECT COUNT(*) FROM #M WHERE IsBig = 0);
DECLARE @aBase INT = ISNULL((SELECT MAX(AssetId) FROM dbo.Asset), 0);
DECLARE @creator INT = (SELECT UserId FROM #U WHERE i = 40);

CREATE TABLE #AT (k INT NOT NULL PRIMARY KEY, AssetTypeId INT NOT NULL, Name NVARCHAR(100) NOT NULL);
INSERT #AT SELECT ROW_NUMBER() OVER (ORDER BY AssetTypeId) - 1, AssetTypeId, Name FROM dbo.AssetType;
DECLARE @nTypes INT = (SELECT COUNT(*) FROM #AT);

CREATE TABLE #AM (MatterId INT NOT NULL PRIMARY KEY, cnt INT NOT NULL);
-- non-big Matters hold between 1 and 2x the average so the spread adds up to about @spread
INSERT #AM SELECT MatterId, CASE WHEN IsBig = 1 THEN 250 ELSE 1 + ABS(CHECKSUM(NEWID())) % (CASE WHEN @nSmall = 0 THEN 1 ELSE (2 * @spread / @nSmall) END) END FROM #M;

INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, ExternalReference, Description, IsActive, CreatedAt, CreatedByUserId)
SELECT a.MatterId, t.AssetTypeId,
  t.Name + N' ' + RIGHT('0000' + CAST(g.value AS VARCHAR(5)), 4) + N' ' + w.v,
  CASE WHEN g.value % 5 < 3 THEN N'EXT-' + CAST(a.MatterId AS NVARCHAR(10)) + N'-' + CAST(g.value AS NVARCHAR(10)) END,
  CASE WHEN g.value % 3 = 0 THEN N'Registered for the matter during intake; see the linked tasks for handling history.' END,
  CASE WHEN g.value % 40 = 0 THEN 0 ELSE 1 END, DATEADD(DAY, -(g.value % 200), @now), @creator
FROM #AM a CROSS APPLY GENERATE_SERIES(1, a.cnt) g
JOIN #AT t ON t.k = (g.value + a.MatterId) % @nTypes
JOIN #word w ON w.i = (g.value * 7 + a.MatterId) % 30
ORDER BY a.MatterId, g.value;

CREATE TABLE #A (AssetId INT NOT NULL PRIMARY KEY, MatterId INT NOT NULL, ord INT NOT NULL, cnt INT NOT NULL);
INSERT #A SELECT AssetId, MatterId, ROW_NUMBER() OVER (PARTITION BY MatterId ORDER BY AssetId), COUNT(*) OVER (PARTITION BY MatterId) FROM dbo.Asset WHERE AssetId > @aBase;
CREATE INDEX IX_A ON #A (MatterId, ord);
SELECT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' assets done: ' + CAST((SELECT COUNT(*) FROM #A) AS VARCHAR(10)) AS Progress;
GO

-- ---------------------------------------------------------------- tasks: random draws
DECLARE @n INT = (SELECT Val FROM #cfg WHERE Name = 'Tasks');
CREATE TABLE #R (n INT NOT NULL PRIMARY KEY, r1 INT, r2 INT, r3 INT, r4 INT, r5 INT, r6 INT, r7 INT, r8 INT, r9 INT, r10 INT, r11 INT, r12 INT, r13 INT, r14 INT, r15 INT, r16 INT, r17 INT, r18 INT, r19 INT);
INSERT #R
SELECT g.value, ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())),
  ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())),
  ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID()))
FROM GENERATE_SERIES(1, @n) g;

CREATE TABLE #Prio (idx INT NOT NULL PRIMARY KEY, PriorityId INT NOT NULL);
INSERT #Prio SELECT ROW_NUMBER() OVER (ORDER BY SortOrder), PriorityId FROM dbo.Priority;
CREATE TABLE #Elig (TaskTypeId INT NOT NULL, k INT NOT NULL, WorkflowDefinitionId INT NOT NULL, cnt INT NOT NULL, PRIMARY KEY (TaskTypeId, k));
INSERT #Elig SELECT TaskTypeId, ROW_NUMBER() OVER (PARTITION BY TaskTypeId ORDER BY WorkflowDefinitionId), WorkflowDefinitionId, COUNT(*) OVER (PARTITION BY TaskTypeId) FROM dbo.TaskTypeWorkflowEligibility;
CREATE TABLE #WV (WorkflowDefinitionId INT NOT NULL PRIMARY KEY, WorkflowVersionId INT NOT NULL, IsOrdered BIT NOT NULL, Steps INT NOT NULL);
INSERT #WV SELECT v.WorkflowDefinitionId, v.WorkflowVersionId, v.IsOrdered, (SELECT COUNT(*) FROM dbo.WorkflowVersionStep s WHERE s.WorkflowVersionId = v.WorkflowVersionId)
FROM dbo.WorkflowVersion v WHERE v.Status = 'PUBLISHED';
CREATE TABLE #TTForm (TaskTypeId INT NOT NULL PRIMARY KEY, FormDefinitionId INT NOT NULL, FormVersionId INT NOT NULL);
INSERT #TTForm SELECT d.TaskTypeId, d.FormDefinitionId, v.FormVersionId FROM dbo.FormDefinition d JOIN dbo.FormVersion v ON v.FormDefinitionId = d.FormDefinitionId AND v.Status = 'PUBLISHED' WHERE d.Scope = 'TASK_TYPE';
CREATE TABLE #TT (k INT NOT NULL PRIMARY KEY, TaskTypeId INT NOT NULL);
INSERT #TT SELECT ROW_NUMBER() OVER (ORDER BY TaskTypeId), TaskTypeId FROM dbo.TaskType WHERE IsActive = 1;
PRINT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' random draws done';
GO

-- ---------------------------------------------------------------- tasks: staging
DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
DECLARE @today DATE = CAST(@now AS DATE);
DECLARE @nm INT = (SELECT COUNT(*) FROM #M);
DECLARE @nb INT = (SELECT COUNT(*) FROM #M WHERE IsBig = 1);
DECLARE @nTT INT = (SELECT COUNT(*) FROM #TT);
DECLARE @nAsg INT = (SELECT COUNT(*) FROM #Asg);

CREATE TABLE #T (
  n INT NOT NULL PRIMARY KEY, MatterId INT NOT NULL, ProjectId INT NULL, TaskTypeId INT NOT NULL, WfDefId INT NOT NULL, WfVersionId INT NOT NULL, IsOrdered BIT NOT NULL,
  Steps INT NOT NULL, StepsDone INT NOT NULL, StatusCode VARCHAR(20) NOT NULL, PriorityId INT NOT NULL, PodId INT NULL, UserId INT NULL, CreatorId INT NOT NULL,
  ReqFirst INT NOT NULL, ReqLast INT NOT NULL, TitleIdx INT NOT NULL, CreatedAt DATETIME2(3) NOT NULL, DueDate DATE NULL, DueAt DATETIME2(3) NULL, DueKey DATETIME2(3) NULL,
  StatusChangedAt DATETIME2(3) NOT NULL, CompletedAt DATETIME2(3) NULL, WorkflowInstanceId BIGINT NULL, HasEmail BIT NOT NULL, FormVersionId INT NULL);

;WITH s1 AS (
  SELECT r.*,
    CASE WHEN r.r1 % 100 < 25 THEN 'NEW' WHEN r.r1 % 100 < 50 THEN 'IN_PROGRESS' WHEN r.r1 % 100 < 55 THEN 'ON_HOLD' WHEN r.r1 % 100 < 95 THEN 'COMPLETED' ELSE 'CANCELLED' END AS st,
    CASE WHEN r.r2 % 100 < 40 THEN ((r.r3 % @nb) + 1) * 20 ELSE (r.r3 % @nm) + 1 END AS mi,
    CASE WHEN r.r7 % 100 < 18 THEN 2 WHEN r.r7 % 100 < 32 THEN 4 WHEN r.r7 % 100 < 46 THEN 8 WHEN r.r7 % 100 < 56 THEN 9 ELSE ((r.r6 % @nTT) + 1) END AS ttk
  FROM #R r),
s2 AS (
  SELECT s1.*, m.MatterId, tt.TaskTypeId,
    CASE WHEN s1.r4 % 100 < 60 THEN (s1.r5 % 3) + 1 END AS pk,
    CASE WHEN s1.r8 % 100 < 8 THEN 1 WHEN s1.r8 % 100 < 30 THEN 2 WHEN s1.r8 % 100 < 85 THEN 3 ELSE 4 END AS pr,
    CASE WHEN s1.st IN ('NEW', 'IN_PROGRESS', 'ON_HOLD') THEN DATEADD(SECOND, -(s1.r9 % 5184000), @now) ELSE DATEADD(SECOND, -(172800 + s1.r9 % 15379200), @now) END AS created
  FROM s1 JOIN #M m ON m.mi = s1.mi JOIN #TT tt ON tt.k = s1.ttk),
s3 AS (
  SELECT s2.*, e.WorkflowDefinitionId AS wfd, wv.WorkflowVersionId AS wfv, wv.IsOrdered, wv.Steps,
    CASE WHEN s2.st <> 'NEW' AND s2.r10 % 100 < 90 THEN (s2.r11 % @nAsg) + 1 END AS ak
  FROM s2 JOIN #Elig e ON e.TaskTypeId = s2.TaskTypeId AND e.k = ((s2.r14 / 7) % (SELECT cnt FROM #Elig x WHERE x.TaskTypeId = s2.TaskTypeId AND x.k = 1)) + 1
  JOIN #WV wv ON wv.WorkflowDefinitionId = e.WorkflowDefinitionId)
INSERT #T (n, MatterId, ProjectId, TaskTypeId, WfDefId, WfVersionId, IsOrdered, Steps, StepsDone, StatusCode, PriorityId, PodId, UserId, CreatorId, ReqFirst, ReqLast, TitleIdx,
           CreatedAt, DueDate, DueAt, DueKey, StatusChangedAt, CompletedAt, HasEmail)
SELECT s3.n, s3.MatterId, pj.ProjectId, s3.TaskTypeId, s3.wfd, s3.wfv, s3.IsOrdered, s3.Steps,
  CASE s3.st WHEN 'NEW' THEN 0 WHEN 'COMPLETED' THEN s3.Steps ELSE s3.r13 % s3.Steps END, s3.st, p.PriorityId,
  CASE WHEN a.UserId IS NOT NULL AND s3.r14 % 100 < 85 THEN a.PodId WHEN a.UserId IS NULL AND s3.r14 % 100 < 55 THEN pd.PodId END,
  a.UserId, cu.UserId, s3.r15 % 40, s3.r16 % 60, s3.r17 % 30, s3.created,
  due.d, CASE WHEN due.d IS NOT NULL AND s3.r19 % 100 < 15 THEN DATEADD(MINUTE, 13 * 60 + s3.r19 % 300, CAST(due.d AS DATETIME2(3))) END,
  CASE WHEN due.d IS NULL THEN NULL WHEN s3.r19 % 100 < 15 THEN DATEADD(MINUTE, 13 * 60 + s3.r19 % 300, CAST(due.d AS DATETIME2(3)))
       ELSE DATEADD(MILLISECOND, 86399999, CAST(due.d AS DATETIME2(3))) END,
  sc.v, CASE WHEN s3.st = 'COMPLETED' THEN sc.v END, CASE WHEN s3.r18 % 10 < 7 THEN 1 ELSE 0 END
FROM s3
JOIN #Prio p ON p.idx = s3.pr
LEFT JOIN #Pj pj ON pj.MatterId = s3.MatterId AND pj.k = s3.pk
LEFT JOIN #Asg a ON a.k = s3.ak
LEFT JOIN #P pd ON pd.pi = (s3.r13 % 40) + 1
JOIN #U cu ON cu.i = (s3.r18 % 270) + 1
CROSS APPLY (SELECT CASE WHEN s3.r12 % 100 < 25 THEN NULL
                         WHEN s3.st IN ('NEW', 'IN_PROGRESS', 'ON_HOLD') THEN DATEADD(DAY, (s3.r19 % 50) - 15, @today)
                         ELSE CAST(DATEADD(DAY, s3.r19 % 20, s3.created) AS DATE) END AS d) due
CROSS APPLY (SELECT CASE WHEN s3.st = 'NEW' THEN s3.created
                         ELSE DATEADD(SECOND, s3.r16 % (DATEDIFF(SECOND, s3.created, @now) + 1), s3.created) END AS v) sc;

UPDATE t SET FormVersionId = f.FormVersionId FROM #T t JOIN #TTForm f ON f.TaskTypeId = t.TaskTypeId;
SELECT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' task staging done: ' + CAST((SELECT COUNT(*) FROM #T) AS VARCHAR(10)) + ' rows, avg steps ' + CAST((SELECT AVG(CAST(Steps AS FLOAT)) FROM #T) AS VARCHAR(10)) AS Progress;
GO

-- ---------------------------------------------------------------- workflow instances, step instances, tasks
DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
DECLARE @wBase BIGINT = ISNULL((SELECT MAX(WorkflowInstanceId) FROM dbo.WorkflowInstance), 0);

INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered, CreatedAt, CreatedByUserId)
SELECT WfVersionId, IsOrdered, CreatedAt, CreatorId FROM #T ORDER BY n;
UPDATE #T SET WorkflowInstanceId = @wBase + n;

INSERT dbo.StepInstance (WorkflowInstanceId, WorkflowVersionStepId, SequenceNo, Title, Description, Instructions, DocumentationUrl, IsSkippable, SkipCommentRequired,
                         InputFormVersionId, InputFormDefinitionId, Status, FirstResolvedAt, ResolvedAt, ResolvedByUserId, CreatedAt, CreatedByUserId)
SELECT t.WorkflowInstanceId, vs.WorkflowVersionStepId, vs.SequenceNo, vs.Title, vs.Description, vs.Instructions, vs.DocumentationUrl, vs.IsSkippable, vs.SkipCommentRequired,
  fv.FormVersionId, fv.FormDefinitionId, x.Status,
  CASE WHEN x.Status IN ('COMPLETED', 'SKIPPED') THEN x.ResolvedAt END, CASE WHEN x.Status IN ('COMPLETED', 'SKIPPED') THEN x.ResolvedAt END,
  CASE WHEN x.Status IN ('COMPLETED', 'SKIPPED') THEN ISNULL(t.UserId, t.CreatorId) END, t.CreatedAt, t.CreatorId
FROM #T t
JOIN dbo.WorkflowVersionStep vs ON vs.WorkflowVersionId = t.WfVersionId
LEFT JOIN dbo.FormVersion fv ON fv.FormVersionId = vs.StepFormVersionId
CROSS APPLY (SELECT CASE WHEN t.StatusCode = 'NEW' THEN 'PENDING'
                         WHEN t.StatusCode = 'COMPLETED' THEN 'COMPLETED'
                         WHEN vs.SequenceNo <= t.StepsDone THEN 'COMPLETED'
                         WHEN vs.SequenceNo = t.StepsDone + 1 AND t.StatusCode = 'IN_PROGRESS' THEN 'IN_PROGRESS'
                         ELSE 'PENDING' END AS Status,
                    DATEADD(SECOND, DATEDIFF(SECOND, t.CreatedAt, t.StatusChangedAt) * vs.SequenceNo / (t.Steps + 1), t.CreatedAt) AS ResolvedAt) x
ORDER BY t.n, vs.SequenceNo;
SELECT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' workflow and step instances done: ' + CAST((SELECT COUNT(*) FROM dbo.StepInstance) AS VARCHAR(10)) AS Progress;

INSERT dbo.Task (MatterId, ProjectId, TaskTypeId, FormVersionId, WorkflowInstanceId, Title, Description, PriorityId, StatusCode, AssignedPodId, AssignedUserId,
                 RequestorName, RequestorEmail, RequestedAt, DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId)
SELECT t.MatterId, t.ProjectId, t.TaskTypeId, t.FormVersionId, t.WorkflowInstanceId,
  CASE t.TitleIdx % 15
    WHEN 0 THEN N'Process custodian data batch ' WHEN 1 THEN N'Load production volume ' WHEN 2 THEN N'Create Relativity workspace for ' WHEN 3 THEN N'Search and cull data set '
    WHEN 4 THEN N'Prepare review batches for ' WHEN 5 THEN N'Export responsive documents ' WHEN 6 THEN N'Receipt of collection media ' WHEN 7 THEN N'Overlay metadata for set '
    WHEN 8 THEN N'Grant reviewer access for ' WHEN 9 THEN N'Archive workspace ' WHEN 10 THEN N'Deliver outgoing production ' WHEN 11 THEN N'TAR model validation '
    WHEN 12 THEN N'Harvey vault request ' WHEN 13 THEN N'Incoming production intake ' ELSE N'Ad hoc data question ' END + CAST(t.n AS NVARCHAR(10)),
  CASE WHEN t.n % 3 = 0 THEN N'Please handle per the standing instructions for this matter and confirm when complete.' END,
  t.PriorityId, t.StatusCode, t.PodId, t.UserId,
  f.v + N' ' + l.v, CASE WHEN t.HasEmail = 1 THEN LOWER(f.v + N'.' + l.v) + N'@client.example' END, DATEADD(MINUTE, -30, t.CreatedAt),
  t.DueDate, t.DueAt, t.DueKey, t.StatusChangedAt, t.CompletedAt, t.CreatedAt, t.CreatorId
FROM #T t JOIN #first f ON f.i = t.ReqFirst JOIN #last l ON l.i = t.ReqLast
ORDER BY t.n;
SELECT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' tasks done: ' + CAST((SELECT COUNT(*) FROM dbo.Task) AS VARCHAR(10)) AS Progress;

CREATE TABLE #TK (n INT NOT NULL PRIMARY KEY, TaskId BIGINT NOT NULL, MatterId INT NOT NULL, CreatedAt DATETIME2(3) NOT NULL, StatusChangedAt DATETIME2(3) NOT NULL,
                  StatusCode VARCHAR(20) NOT NULL, CreatorId INT NOT NULL, UserId INT NULL, TaskTypeId INT NOT NULL, FormVersionId INT NULL, Title NVARCHAR(300) NOT NULL, TaskNumber VARCHAR(20) NOT NULL);
INSERT #TK SELECT t.n, k.TaskId, k.MatterId, t.CreatedAt, t.StatusChangedAt, t.StatusCode, t.CreatorId, t.UserId, t.TaskTypeId, t.FormVersionId, k.Title, k.TaskNumber
FROM #T t JOIN dbo.Task k ON k.WorkflowInstanceId = t.WorkflowInstanceId;
GO

-- ---------------------------------------------------------------- form values (request form per Task, step form per resolved step)
CREATE TABLE #FJ (FormVersionId INT NOT NULL PRIMARY KEY, Json NVARCHAR(MAX) NOT NULL);
INSERT #FJ
SELECT f.FormVersionId, N'{' + STRING_AGG(CAST(N'"' + f.FieldKey + N'":' + x.v AS NVARCHAR(MAX)), N',') + N'}'
FROM dbo.FormField f
CROSS APPLY (SELECT CASE f.ControlType
    WHEN 'TEXT' THEN N'"Seeded value {n}"'
    WHEN 'TEXTAREA' THEN N'"Seeded details for item {n}. Please review the attached assets and confirm the handling instructions."'
    WHEN 'NUMBER' THEN N'5' WHEN 'CHECKBOX' THEN N'true' WHEN 'DATE' THEN N'"2026-03-01"' WHEN 'URL' THEN N'"https://example.com/ref/{n}"'
    WHEN 'SELECT' THEN (SELECT TOP 1 N'"' + o.OptionKey + N'"' FROM dbo.FormFieldOption o WHERE o.FormFieldId = f.FormFieldId ORDER BY o.SortOrder)
    WHEN 'RADIO' THEN (SELECT TOP 1 N'"' + o.OptionKey + N'"' FROM dbo.FormFieldOption o WHERE o.FormFieldId = f.FormFieldId ORDER BY o.SortOrder)
    WHEN 'MULTISELECT' THEN (SELECT TOP 1 N'["' + o.OptionKey + N'"]' FROM dbo.FormFieldOption o WHERE o.FormFieldId = f.FormFieldId ORDER BY o.SortOrder)
    END AS v) x
WHERE x.v IS NOT NULL
GROUP BY f.FormVersionId;

INSERT dbo.FormValueSet (OwnerKind, OwnerId, FormDefinitionId, FormVersionId, ValuesJson, CreatedAt, CreatedByUserId)
SELECT 'TASK', k.TaskId, v.FormDefinitionId, k.FormVersionId, REPLACE(j.Json, N'{n}', CAST(k.n AS NVARCHAR(10))), k.CreatedAt, k.CreatorId
FROM #TK k JOIN dbo.FormVersion v ON v.FormVersionId = k.FormVersionId JOIN #FJ j ON j.FormVersionId = k.FormVersionId
ORDER BY k.n;
PRINT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' task form values done';

INSERT dbo.FormValueSet (OwnerKind, OwnerId, FormDefinitionId, FormVersionId, ValuesJson, CreatedAt, CreatedByUserId)
SELECT 'STEP_INSTANCE', si.StepInstanceId, si.InputFormDefinitionId, si.InputFormVersionId, REPLACE(j.Json, N'{n}', CAST(si.StepInstanceId AS NVARCHAR(10))), si.CreatedAt, si.CreatedByUserId
FROM dbo.StepInstance si JOIN #FJ j ON j.FormVersionId = si.InputFormVersionId
WHERE si.Status IN ('COMPLETED', 'IN_PROGRESS') AND si.InputFormVersionId IS NOT NULL;
SELECT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' step form values done: ' + CAST((SELECT COUNT(*) FROM dbo.FormValueSet) AS VARCHAR(10)) AS Progress;
GO

-- ---------------------------------------------------------------- comments (skewed: a few Tasks get very long threads)
DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
DECLARE @nc INT = (SELECT Val FROM #cfg WHERE Name = 'Comments');
DECLARE @nt INT = (SELECT COUNT(*) FROM #TK);

CREATE TABLE #C (c INT NOT NULL PRIMARY KEY, tn INT NOT NULL, au INT NOT NULL, r1 INT NOT NULL, r2 INT NOT NULL);
INSERT #C
SELECT g.value,
  -- u*u skews toward the first Tasks: Task 1 ends up with several hundred comments, most Tasks with none
  1 + CAST(FLOOR(@nt * POWER(ABS(CHECKSUM(NEWID())) / 2147483648.0, 2.0)) AS INT),
  (ABS(CHECKSUM(NEWID())) % 270) + 1, ABS(CHECKSUM(NEWID())), ABS(CHECKSUM(NEWID()))
FROM GENERATE_SERIES(1, @nc) g;

INSERT dbo.TaskComment (TaskId, AuthorUserId, Purpose, BodyHtml, EditedAt, IsDeleted, DeletedAt, DeletedByUserId, CreatedAt, CreatedByUserId)
SELECT k.TaskId, u.UserId, 'NORMAL',
  CASE c.r1 % 6
    WHEN 0 THEN N'<p>Received the media today. Checksums match the transfer log; moving on to processing.</p>'
    WHEN 1 THEN N'<p>Waiting on the client for the custodian list. Following up <strong>tomorrow morning</strong>.</p>'
    WHEN 2 THEN N'<p>Loaded <em>' + CAST(c.c AS NVARCHAR(10)) + N'</em> documents into the workspace. See <a href="https://wiki.firm.example/runbooks/load">the load runbook</a> for the settings used.</p>'
    WHEN 3 THEN N'<p>QC found a handful of exceptions:</p><ul><li>Corrupt container in volume 3</li><li>Password protected files, list attached to the asset</li></ul><p>Re-running those now.</p>'
    WHEN 4 THEN N'<p>Delivery confirmed by the requestor. Closing the remaining steps.</p>'
    ELSE N'<p>Adjusted the due date after speaking with the case team; priority unchanged.</p><p>Please review when you have a moment.</p>' END,
  CASE WHEN c.r2 % 100 < 3 THEN DATEADD(MINUTE, 10, d.created) END,
  CASE WHEN c.r2 % 100 BETWEEN 3 AND 4 THEN 1 ELSE 0 END,
  CASE WHEN c.r2 % 100 BETWEEN 3 AND 4 THEN DATEADD(HOUR, 1, d.created) END,
  CASE WHEN c.r2 % 100 BETWEEN 3 AND 4 THEN u.UserId END,
  d.created, u.UserId
FROM #C c JOIN #TK k ON k.n = c.tn JOIN #U u ON u.i = c.au
CROSS APPLY (SELECT CASE WHEN DATEADD(SECOND, c.r1 % 1000000, k.CreatedAt) > @now THEN DATEADD(SECOND, -(c.r1 % 3600), @now) ELSE DATEADD(SECOND, c.r1 % 1000000, k.CreatedAt) END AS created) d
ORDER BY c.c;
SELECT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' comments done: ' + CAST((SELECT COUNT(*) FROM dbo.TaskComment) AS VARCHAR(10)) AS Progress;
GO

-- ---------------------------------------------------------------- task-asset links (same Matter as the Task)
DECLARE @nl INT = CAST(100000.0 * (SELECT Val FROM #cfg WHERE Name = 'Tasks') / 25000 AS INT);
DECLARE @nt INT = (SELECT COUNT(*) FROM #TK);
-- 2..6 links per Task (about 4 on average): a pseudo-random Asset of the Task's own Matter per link, duplicates collapse on the key
CREATE TABLE #L (TaskId BIGINT NOT NULL, AssetId INT NOT NULL, MatterId INT NOT NULL, rr INT NOT NULL, PRIMARY KEY (TaskId, AssetId));
INSERT #L
SELECT q.TaskId, q.AssetId, q.MatterId, MIN(q.rr) FROM (
  SELECT k.TaskId, a.AssetId, k.MatterId, ABS(CHECKSUM(a.AssetId * 7919 + g.value * 104729 + k.n)) AS rr
  FROM #TK k CROSS APPLY GENERATE_SERIES(1, 2 + (k.n % 5)) g
  CROSS APPLY (SELECT TOP 1 x.AssetId FROM #A x WHERE x.MatterId = k.MatterId ORDER BY ABS(CHECKSUM(x.AssetId * 31 + g.value * 104729 + k.n * 17)) ) a
) q GROUP BY q.TaskId, q.AssetId, q.MatterId;
-- top up with one more link on random Tasks until the target is reached (duplicates and Matters with few Assets leave a gap)
WHILE (SELECT COUNT(*) FROM #L) < @nl
BEGIN
  DECLARE @need INT = @nl - (SELECT COUNT(*) FROM #L);
  INSERT #L
  SELECT k.TaskId, a.AssetId, k.MatterId, ABS(CHECKSUM(NEWID()))
  FROM (SELECT TOP (@need) n FROM #TK ORDER BY NEWID()) s
  JOIN #TK k ON k.n = s.n
  CROSS APPLY (SELECT TOP 1 x.AssetId FROM #A x WHERE x.MatterId = k.MatterId ORDER BY NEWID()) a
  WHERE NOT EXISTS (SELECT 1 FROM #L l WHERE l.TaskId = k.TaskId AND l.AssetId = a.AssetId);
END;

DECLARE @now DATETIME2 = SYSUTCDATETIME();
INSERT dbo.TaskAsset (TaskId, AssetId, MatterId, AssetLinkRoleId, CreatedAt, CreatedByUserId)
SELECT l.TaskId, l.AssetId, l.MatterId, CASE WHEN l.rr % 10 < 3 THEN NULL ELSE (l.rr % 4) + 1 END, k.CreatedAt, k.CreatorId
FROM #L l JOIN #TK k ON k.TaskId = l.TaskId;
SELECT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' task assets done: ' + CAST((SELECT COUNT(*) FROM dbo.TaskAsset) AS VARCHAR(10)) AS Progress;
GO

-- ---------------------------------------------------------------- audit events (append-only table; plain inserts are allowed)
DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
DECLARE @fieldsPerTask INT = (SELECT Val FROM #cfg WHERE Name = 'AuditFieldChangesPerTask');

-- Task created
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, Summary, CorrelationId)
SELECT k.CreatedAt, k.CreatorId, 'TASK_CREATED', 'Task', CAST(k.TaskId AS VARCHAR(40)), k.MatterId, k.TaskId, k.TaskNumber + N' created: ' + k.Title, NEWID() FROM #TK k;

-- status changes
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, FieldKey, OldValue, NewValue, Summary, CorrelationId)
SELECT k.StatusChangedAt, ISNULL(k.UserId, k.CreatorId), 'TASK_STATUS_CHANGED', 'Task', CAST(k.TaskId AS VARCHAR(40)), k.MatterId, k.TaskId, 'StatusCode', N'NEW', k.StatusCode,
  k.TaskNumber + N' status changed from New to ' + k.StatusCode, NEWID()
FROM #TK k WHERE k.StatusCode <> 'NEW';

-- comments
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, Summary, CorrelationId)
SELECT cm.CreatedAt, cm.AuthorUserId, 'COMMENT_ADDED', 'TaskComment', CAST(cm.TaskCommentId AS VARCHAR(40)), k.MatterId, k.TaskId, N'Comment added to ' + k.TaskNumber, NEWID()
FROM dbo.TaskComment cm JOIN #TK k ON k.TaskId = cm.TaskId;

-- asset links
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, FieldKey, NewValue, Summary, CorrelationId)
SELECT ta.CreatedAt, ta.CreatedByUserId, 'TASK_ASSET_LINKED', 'Task', CAST(ta.TaskId AS VARCHAR(40)), ta.MatterId, ta.TaskId, 'AssetId', CAST(ta.AssetId AS NVARCHAR(40)),
  N'Asset ' + CAST(ta.AssetId AS NVARCHAR(10)) + N' linked', NEWID()
FROM dbo.TaskAsset ta;
PRINT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' audit: tasks, status, comments, links done';

-- steps started and completed
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, Summary, CorrelationId)
SELECT DATEADD(MINUTE, -5, si.ResolvedAt), si.ResolvedByUserId, 'STEP_STARTED', 'StepInstance', CAST(si.StepInstanceId AS VARCHAR(40)), k.MatterId, k.TaskId, N'Step ' + si.Title + N' started', NEWID()
FROM dbo.StepInstance si JOIN #T t ON t.WorkflowInstanceId = si.WorkflowInstanceId JOIN #TK k ON k.n = t.n WHERE si.Status = 'COMPLETED';
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, Summary, CorrelationId)
SELECT si.ResolvedAt, si.ResolvedByUserId, 'STEP_COMPLETED', 'StepInstance', CAST(si.StepInstanceId AS VARCHAR(40)), k.MatterId, k.TaskId, N'Step ' + si.Title + N' completed', NEWID()
FROM dbo.StepInstance si JOIN #T t ON t.WorkflowInstanceId = si.WorkflowInstanceId JOIN #TK k ON k.n = t.n WHERE si.Status = 'COMPLETED';
PRINT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' audit: steps done';

-- field edits on tasks (priority, assignee, due date, title, description)
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, FieldKey, OldValue, NewValue, Summary, CorrelationId)
SELECT DATEADD(SECOND, ABS(CHECKSUM(NEWID())) % (DATEDIFF(SECOND, k.CreatedAt, @now) + 1), k.CreatedAt), (ABS(CHECKSUM(NEWID())) % 270) + 1 + (SELECT MIN(UserId) - 1 FROM #U),
  'FIELD_CHANGED', 'Task', CAST(k.TaskId AS VARCHAR(40)), k.MatterId, k.TaskId,
  CASE g.value % 5 WHEN 0 THEN 'PriorityId' WHEN 1 THEN 'AssignedUserId' WHEN 2 THEN 'DueDate' WHEN 3 THEN 'Title' ELSE 'AssignedPodId' END,
  CAST(1 + k.n % 4 AS NVARCHAR(20)), CAST(1 + (k.n + g.value) % 4 AS NVARCHAR(20)), NULL, NEWID()
FROM #TK k CROSS APPLY GENERATE_SERIES(1, @fieldsPerTask) g;
PRINT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' audit: field edits done';

-- asset, client, matter, project and user events
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, FieldKey, NewValue, CorrelationId)
SELECT a.CreatedAt, a.CreatedByUserId, 'FIELD_CHANGED', 'Asset', CAST(a.AssetId AS VARCHAR(40)), a.MatterId, 'DisplayName', a.DisplayName, NEWID() FROM dbo.Asset a;
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, Summary, CorrelationId)
SELECT c.CreatedAt, c.CreatedByUserId, 'CLIENT_CREATED', 'Client', CAST(c.ClientId AS VARCHAR(40)), N'Client ' + c.ClientNumber + N' created.', NEWID() FROM dbo.Client c;
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, Summary, CorrelationId)
SELECT m.CreatedAt, m.CreatedByUserId, 'MATTER_CREATED', 'Matter', CAST(m.MatterId AS VARCHAR(40)), m.MatterId, N'Matter ' + m.MatterRef + N' created.', NEWID() FROM dbo.Matter m;
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, Summary, CorrelationId)
SELECT p.CreatedAt, p.CreatedByUserId, 'FIELD_CHANGED', 'Project', CAST(p.ProjectId AS VARCHAR(40)), p.MatterId, N'Project ' + p.Name + N' created.', NEWID() FROM dbo.Project p;
INSERT dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, NewValue, Summary, CorrelationId)
SELECT u.CreatedAt, NULL, 'USER_PROVISIONED', 'User', CAST(u.UserId AS VARCHAR(40)), i.Username, N'User provisioned at first sign-in (Dev) with no roles', NEWID()
FROM dbo.AppUser u JOIN dbo.UserIdentity i ON i.UserId = u.UserId;
SELECT CONVERT(VARCHAR(30), SYSDATETIME(), 121) + ' audit done: ' + CAST((SELECT COUNT(*) FROM dbo.AuditEvent) AS VARCHAR(12)) AS Progress;
GO

-- ---------------------------------------------------------------- statistics, marker, summary
UPDATE STATISTICS dbo.Task WITH FULLSCAN;
UPDATE STATISTICS dbo.StepInstance WITH FULLSCAN;
UPDATE STATISTICS dbo.TaskComment WITH FULLSCAN;
UPDATE STATISTICS dbo.TaskAsset WITH FULLSCAN;
UPDATE STATISTICS dbo.Asset WITH FULLSCAN;
UPDATE STATISTICS dbo.AuditEvent WITH FULLSCAN;
UPDATE STATISTICS dbo.FormValueSet WITH FULLSCAN;
INSERT dbo.SeedMarker (Name) VALUES ('perf-seed-v1');
GO
SELECT 'Users' AS [Table], COUNT(*) AS [Rows] FROM dbo.AppUser UNION ALL SELECT 'Pods', COUNT(*) FROM dbo.Pod UNION ALL SELECT 'Clients', COUNT(*) FROM dbo.Client
UNION ALL SELECT 'Matters', COUNT(*) FROM dbo.Matter UNION ALL SELECT 'Projects', COUNT(*) FROM dbo.Project UNION ALL SELECT 'Assets', COUNT(*) FROM dbo.Asset
UNION ALL SELECT 'Tasks', COUNT(*) FROM dbo.Task UNION ALL SELECT 'StepInstances', COUNT(*) FROM dbo.StepInstance UNION ALL SELECT 'FormValueSets', COUNT(*) FROM dbo.FormValueSet
UNION ALL SELECT 'Comments', COUNT(*) FROM dbo.TaskComment UNION ALL SELECT 'TaskAssets', COUNT(*) FROM dbo.TaskAsset UNION ALL SELECT 'AuditEvents', COUNT(*) FROM dbo.AuditEvent;
GO
