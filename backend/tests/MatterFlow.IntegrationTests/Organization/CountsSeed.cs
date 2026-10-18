using System.Globalization;
using System.Text;
using MatterFlow.IntegrationTests.Tasks;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>Seeds Tasks, Matters and Projects with set-based SQL for the Task count tests (the HTTP APIs would take minutes at this size).</summary>
internal static class CountsSeed
{
    /// <summary>One Task to insert. Dates are the stored values (DueDate floating, DueAtUtc the absolute instant when a time was chosen).</summary>
    internal sealed record Row(int MatterId, int? ProjectId, string Status, DateOnly? Due, DateTime? DueAt = null);

    private static string Instant(DateTime v) => "'" + v.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) + "'";

    /// <summary>Inserts the rows as Tasks (with their workflow instances) in batches.</summary>
    public static async Task InsertTasksAsync(TaskHarness h, TaskHarness.World world, int adminUserId, IReadOnlyList<Row> rows, DateTime now)
    {
        const int batch = 2000;
        for (var start = 0; start < rows.Count; start += batch)
        {
            var chunk = rows.Skip(start).Take(batch).ToList();
            var text = new StringBuilder("SET NOCOUNT ON;\n");
            text.Append(CultureInfo.InvariantCulture, $"DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {world.OrderedWorkflowId} AND Status = 'PUBLISHED');\n");
            text.Append("DECLARE @base BIGINT = ISNULL((SELECT MAX(WorkflowInstanceId) FROM dbo.WorkflowInstance), 0);\n");
            text.Append("CREATE TABLE #s (n INT NOT NULL PRIMARY KEY, MatterId INT NOT NULL, ProjectId INT NULL, St VARCHAR(20) NOT NULL, Due DATE NULL, DueAt DATETIME2(3) NULL);\n");
            for (var i = 0; i < chunk.Count; i += 500)
            {
                text.Append("INSERT #s (n, MatterId, ProjectId, St, Due, DueAt) VALUES ");
                text.AppendJoin(",\n", chunk.Skip(i).Take(500).Select((r, j) => string.Create(
                    CultureInfo.InvariantCulture,
                    $"({i + j + 1}, {r.MatterId}, {(r.ProjectId is { } p ? p.ToString(CultureInfo.InvariantCulture) : "NULL")}, '{r.Status}', {(r.Due is { } d ? "'" + d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'" : "NULL")}, {(r.DueAt is { } a ? Instant(a) : "NULL")})")));
                text.Append(";\n");
            }

            text.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) SELECT @v, 1 FROM #s ORDER BY n;\n");
            text.Append(CultureInfo.InvariantCulture, $"""
                INSERT dbo.Task (MatterId, ProjectId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, RequestorName, DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId)
                SELECT s.MatterId, s.ProjectId, {world.TaskTypeId}, i.WorkflowInstanceId, N'Count task ' + CAST(i.WorkflowInstanceId AS NVARCHAR(20)), (SELECT TOP 1 PriorityId FROM dbo.Priority ORDER BY SortOrder DESC), s.St, N'Requestor',
                       s.Due, s.DueAt, CASE WHEN s.Due IS NULL THEN NULL ELSE DATEADD(MILLISECOND, 86399999, CAST(s.Due AS DATETIME2(3))) END,
                       {Instant(now.AddDays(-2))}, CASE WHEN s.St = 'COMPLETED' THEN {Instant(now.AddDays(-2))} END, {Instant(now.AddDays(-3))}, {adminUserId}
                FROM #s s JOIN (SELECT WorkflowInstanceId, ROW_NUMBER() OVER (ORDER BY WorkflowInstanceId) AS rn FROM dbo.WorkflowInstance WHERE WorkflowInstanceId > @base) i ON i.rn = s.n;
                DROP TABLE #s;
                """);
            await h.ExecuteAsync(text.ToString());
        }
    }

    /// <summary>
    /// Set-based seed at scale: clients (numbers 01000 up), <paramref name="mattersPerClient"/> Matters each, two Projects on every second Matter, and
    /// <paramref name="tasks"/> Tasks spread over all Matters (a third of them on a Project when the Matter has one). The status and due mix is the
    /// Task Queue performance seed's: 10% completed, 10% on hold, 20% in progress, 20% ASAP, dues from 20 days back to 40 days ahead.
    /// </summary>
    public static string ScaleSql(TaskHarness.World w, int adminUserId, int clients, int mattersPerClient, int tasks) => string.Create(CultureInfo.InvariantCulture, $"""
        SET NOCOUNT ON;
        DECLARE @today DATE = CAST(SYSUTCDATETIME() AS DATE);
        DECLARE @clients INT = {clients}, @per INT = {mattersPerClient}, @n INT = {tasks};
        DECLARE @nums TABLE (n INT NOT NULL PRIMARY KEY);
        INSERT @nums SELECT TOP (CASE WHEN @n > @clients * @per THEN @n ELSE @clients * @per END) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) FROM sys.all_objects a CROSS JOIN sys.all_objects b;

        INSERT dbo.Client (ClientNumber, Name)
        SELECT RIGHT('00000' + CAST(1000 + n AS VARCHAR(5)), 5), N'Scale client ' + CAST(n AS NVARCHAR(10)) FROM @nums WHERE n <= @clients;

        INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name)
        SELECT c.ClientId, c.ClientNumber, RIGHT('00000' + CAST(m.n AS VARCHAR(5)), 5), N'Scale matter ' + c.ClientNumber + N'-' + CAST(m.n AS NVARCHAR(10))
        FROM dbo.Client c JOIN @nums m ON m.n <= @per WHERE c.ClientNumber >= '01001';

        DECLARE @matters TABLE (idx INT NOT NULL PRIMARY KEY, MatterId INT NOT NULL);
        INSERT @matters SELECT ROW_NUMBER() OVER (ORDER BY MatterId) - 1, MatterId FROM dbo.Matter WHERE ClientNumber >= '01001';
        DECLARE @mc INT = (SELECT COUNT(*) FROM @matters);

        INSERT dbo.Project (MatterId, Name)
        SELECT m.MatterId, N'Scale project ' + CAST(k.k AS NVARCHAR(3)) FROM @matters m JOIN (VALUES (1), (2)) k(k) ON 1 = 1 WHERE m.idx % 2 = 0;

        DECLARE @version INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = {w.OrderedWorkflowId} AND Status = 'PUBLISHED');
        DECLARE @base BIGINT = ISNULL((SELECT MAX(WorkflowInstanceId) FROM dbo.WorkflowInstance), 0);
        INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) SELECT @version, 1 FROM @nums WHERE n <= @n;

        DECLARE @projects TABLE (MatterId INT NOT NULL, k INT NOT NULL, ProjectId INT NOT NULL, PRIMARY KEY (MatterId, k));
        INSERT @projects SELECT MatterId, ROW_NUMBER() OVER (PARTITION BY MatterId ORDER BY ProjectId) - 1, ProjectId FROM dbo.Project WHERE Name LIKE N'Scale project%';

        INSERT dbo.Task (MatterId, ProjectId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, RequestorName, DueDate, DueAtUtc, DueSortKey, CompletedAt, CreatedAt, CreatedByUserId)
        SELECT m.MatterId, CASE WHEN i.rn % 3 = 0 THEN p.ProjectId END, {w.TaskTypeId}, i.WorkflowInstanceId, N'Scale task ' + CAST(i.rn AS NVARCHAR(10)), (SELECT TOP 1 PriorityId FROM dbo.Priority ORDER BY SortOrder),
               x.st, N'Requestor', x.due, NULL, CASE WHEN x.due IS NULL THEN NULL ELSE DATEADD(MILLISECOND, 86399999, CAST(x.due AS DATETIME2(3))) END,
               CASE WHEN x.st = 'COMPLETED' THEN SYSUTCDATETIME() END, DATEADD(MINUTE, -i.rn, SYSUTCDATETIME()), {adminUserId}
        FROM (SELECT WorkflowInstanceId, ROW_NUMBER() OVER (ORDER BY WorkflowInstanceId) AS rn FROM dbo.WorkflowInstance WHERE WorkflowInstanceId > @base) i
        CROSS APPLY (SELECT CASE i.rn % 10 WHEN 8 THEN 'COMPLETED' WHEN 9 THEN 'ON_HOLD' WHEN 6 THEN 'IN_PROGRESS' WHEN 7 THEN 'IN_PROGRESS' ELSE 'NEW' END AS st,
                            CASE WHEN i.rn % 5 = 0 THEN NULL ELSE DATEADD(DAY, (i.rn % 60) - 20, @today) END AS due) x
        JOIN @matters m ON m.idx = i.rn % @mc
        LEFT JOIN @projects p ON p.MatterId = m.MatterId AND p.k = (i.rn / @mc) % 2;
        """);
}
