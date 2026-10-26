-- Asset report dataset (epic #851, issue #873): N assets (default 100,000) of one asset type in 100 new matters of one new client, and for each asset
-- two rows of the typed index (a number "size_gb" and a select "platform"), so the engine measures at the size the issue names (100,000 assets
-- plus 100,000 index rows; this loads 200,000 index rows, twice that). The matters have the person named by $(Manager) as Primary manager, so the
-- "mine" scope sees all of them. Run with sqlcmd -I -b -v Assets=100000 TypeId=<id> FieldDefinitionId=<id> Manager="ke\kekim" -i seed-asset-report-data.sql
-- against a throwaway database (asset-report-timings.mjs does all of it). Set-based, a few seconds. Data is deterministic.
:ON ERROR EXIT
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

DECLARE @now DATETIME2 = SYSUTCDATETIME();
DECLARE @n INT = $(Assets);
DECLARE @type INT = $(TypeId);
DECLARE @fd INT = $(FieldDefinitionId);
DECLARE @manager INT = (SELECT TOP 1 UserId FROM dbo.UserIdentity WHERE Username = N'$(Manager)');
IF @manager IS NULL THROW 50000, 'The manager account does not exist.', 1;

DECLARE @clientNumber CHAR(5) = RIGHT('00000' + CAST(90000 + ABS(CHECKSUM(NEWID())) % 9000 AS VARCHAR(5)), 5);
INSERT dbo.Client (ClientNumber, Name, IsActive, CreatedAt, CreatedByUserId) VALUES (@clientNumber, N'Asset report perf client ' + @clientNumber, 1, @now, @manager);
DECLARE @client INT = SCOPE_IDENTITY();

INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, IsActive, IsSensitive, PrimaryManagerId, CreatedAt, CreatedByUserId)
SELECT @client, @clientNumber, RIGHT('00000' + CAST(k.value AS VARCHAR(5)), 5), N'Asset report perf matter ' + CAST(k.value AS NVARCHAR(10)), 1, 0, @manager, @now, @manager
FROM GENERATE_SERIES(1, 100) k;

DECLARE @base INT = (SELECT ISNULL(MAX(AssetId), 0) FROM dbo.Asset);
INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName, IsActive, DispositionCode, CreatedAt, CreatedByUserId)
SELECT m.MatterId, @type, N'Perf asset ' + CAST(g.value AS NVARCHAR(10)),
  CASE WHEN g.value % 50 < 45 THEN 1 ELSE 0 END,
  CASE g.value % 50 WHEN 45 THEN 'INACTIVE' WHEN 46 THEN 'INACTIVE' WHEN 47 THEN 'PENDING_DISPOSITION' WHEN 48 THEN 'PENDING_DISPOSITION' WHEN 49 THEN 'DISPOSED' ELSE 'ACTIVE' END,
  DATEADD(DAY, -(g.value % 300), @now), @manager
FROM GENERATE_SERIES(1, @n) g
JOIN (SELECT MatterId, ROW_NUMBER() OVER (ORDER BY MatterId) - 1 AS pos FROM dbo.Matter WHERE ClientId = @client) m ON m.pos = g.value % 100;

INSERT dbo.CustomFieldIndex (OwnerKind, OwnerId, FormDefinitionId, FieldKey, ValueNumber)
SELECT 'ASSET', AssetId, @fd, 'size_gb', CAST((AssetId % 500) + 1 AS DECIMAL(19, 4)) FROM dbo.Asset WHERE AssetId > @base;
INSERT dbo.CustomFieldIndex (OwnerKind, OwnerId, FormDefinitionId, FieldKey, ValueText)
SELECT 'ASSET', AssetId, @fd, 'platform', CASE AssetId % 5 WHEN 0 THEN N'prod' WHEN 1 THEN N'test' WHEN 2 THEN N'dev' WHEN 3 THEN N'archive' ELSE N'staging' END FROM dbo.Asset WHERE AssetId > @base;

SELECT (SELECT COUNT(*) FROM dbo.Asset WHERE AssetId > @base) AS AssetsLoaded,
       (SELECT COUNT(*) FROM dbo.CustomFieldIndex WHERE OwnerKind = 'ASSET' AND FormDefinitionId = @fd) AS IndexRows;
GO
