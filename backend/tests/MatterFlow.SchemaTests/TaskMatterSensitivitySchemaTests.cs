using System.Text.RegularExpressions;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>
/// 37-task-matter-sensitivity.sql (epic #788, issue #810): <c>dbo.Task.IsMatterSensitive</c> is the database's own copy of the matter's flag. It is filled for the rows that existed,
/// follows a change of <c>Matter.IsSensitive</c> and is right for every new task, however it is inserted, so the sensitive-matter rule can test it instead of joining the matter.
/// </summary>
[Collection(SqlServerCollection.Name)]
public class TaskMatterSensitivitySchemaTests(SqlServerFixture sql)
{
    private sealed class ScriptsBefore(int number) : IMigrationScriptSource
    {
        public IReadOnlyList<(string Name, string Content)> ReadAll() =>
            [.. new EmbeddedMigrationScriptSource().ReadAll().Where(s => int.Parse(Regex.Match(s.Name, @"^\d+").Value) < number)];
    }

    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private static async Task<int> ScalarAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        return Convert.ToInt32(await cmd.ExecuteScalarAsync() ?? 0);
    }

    private const string Fixtures = """
        INSERT dbo.AppUser (DisplayName) VALUES (N'Author');
        INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client');
        INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name, IsSensitive) VALUES (1, '00001', '00001', N'Open matter', 0), (1, '00001', '00002', N'Sensitive matter', 1);
        INSERT dbo.TaskType (Name) VALUES (N'Type A');
        INSERT dbo.WorkflowDefinition (Name) VALUES (N'W');
        INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status, PublishedAt) VALUES (1, 1, 'PUBLISHED', SYSUTCDATETIME());
        INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (1, 1), (1, 1), (1, 1), (1, 1), (1, 1);
        INSERT dbo.Priority (Label, SortOrder) VALUES (N'Normal', 3);
        """;

    private static string InsertTask(int matter, int instance, string flag = "") =>
        $"INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName{(flag.Length > 0 ? ", IsMatterSensitive" : "")}) VALUES ({matter}, 1, {instance}, N'T{instance}', 1, N'R'{(flag.Length > 0 ? ", " + flag : "")});";

    private static Task<int> MismatchesAsync(string cs) =>
        ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Task t JOIN dbo.Matter m ON m.MatterId = t.MatterId WHERE t.IsMatterSensitive <> m.IsSensitive");

    [Fact]
    public async Task Existing_tasks_are_filled_from_their_matter_when_the_script_runs()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(37));
        await ScalarAsync(cs, Fixtures + InsertTask(1, 1) + InsertTask(2, 2) + InsertTask(2, 3) + "SELECT 0");

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Task WHERE IsMatterSensitive = 1")).ShouldBe(2);
        (await MismatchesAsync(cs)).ShouldBe(0);
    }

    [Fact]
    public async Task A_new_task_gets_its_matters_flag_whatever_the_insert_says()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ScalarAsync(cs, Fixtures + "SELECT 0");

        await ScalarAsync(cs, InsertTask(2, 1) + InsertTask(1, 2, "1") + InsertTask(2, 3, "0") + InsertTask(1, 4, "0") + "SELECT 0");
        // One statement with several rows, as the bulk seeds write them.
        await ScalarAsync(cs, "INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName) VALUES (1, 1, 5, N'T5', 1, N'R'); SELECT 0");

        (await MismatchesAsync(cs)).ShouldBe(0);
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Task WHERE IsMatterSensitive = 1")).ShouldBe(2); // tasks 1 and 3 sit on the sensitive matter
    }

    [Fact]
    public async Task Marking_and_unmarking_a_matter_changes_the_flag_of_its_tasks_only()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ScalarAsync(cs, Fixtures + InsertTask(1, 1) + InsertTask(1, 2) + InsertTask(2, 3) + "SELECT 0");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Task WHERE IsMatterSensitive = 1")).ShouldBe(1);

        await ScalarAsync(cs, "UPDATE dbo.Matter SET IsSensitive = 1 WHERE MatterId = 1; SELECT 0");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Task WHERE IsMatterSensitive = 1")).ShouldBe(3);

        await ScalarAsync(cs, "UPDATE dbo.Matter SET IsSensitive = 0 WHERE MatterId = 2; SELECT 0");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Task WHERE IsMatterSensitive = 1")).ShouldBe(2);

        // A change of any other column of the matter leaves the tasks (and their row versions) alone.
        var before = await ScalarAsync(cs, "SELECT CAST(CHECKSUM_AGG(CHECKSUM(CAST(RowVersion AS BIGINT))) AS INT) FROM dbo.Task");
        await ScalarAsync(cs, "UPDATE dbo.Matter SET Name = N'Renamed' WHERE MatterId = 1; SELECT 0");
        (await ScalarAsync(cs, "SELECT CAST(CHECKSUM_AGG(CHECKSUM(CAST(RowVersion AS BIGINT))) AS INT) FROM dbo.Task")).ShouldBe(before);
        (await MismatchesAsync(cs)).ShouldBe(0);
    }

    [Fact]
    public async Task The_indexes_the_task_readers_use_carry_the_flag()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        foreach (var index in new[] { "IX_Task_Queue", "IX_Task_AssignedUser", "IX_Task_Pod", "IX_Task_StatusChanged", "IX_Task_Creator", "IX_Task_CreatedAt", "IX_Task_CompletedCoverage" })
        {
            (await ScalarAsync(cs, $"""
                SELECT COUNT(*) FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                WHERE ic.object_id = OBJECT_ID('dbo.Task') AND ic.index_id = (SELECT index_id FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Task') AND name = '{index}')
                  AND c.name IN ('IsMatterSensitive', 'MatterId') AND ic.is_included_column = 1
                """)).ShouldBe(2, index);
        }

        (await ScalarAsync(cs, "SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Task') AND name = 'IX_Task_AssignedSensitive' AND has_filter = 1")).ShouldBe(1);
    }
}
