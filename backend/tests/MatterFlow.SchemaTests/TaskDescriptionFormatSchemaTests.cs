using System.Text.RegularExpressions;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>25-task-description-format.sql (decision R): existing descriptions stay TEXT, the format is TEXT or HTML, and a missing value defaults to TEXT.</summary>
[Collection(SqlServerCollection.Name)]
public class TaskDescriptionFormatSchemaTests(SqlServerFixture sql)
{
    private sealed class ScriptsBefore(int number) : IMigrationScriptSource
    {
        public IReadOnlyList<(string Name, string Content)> ReadAll() =>
            [.. new EmbeddedMigrationScriptSource().ReadAll().Where(s => int.Parse(Regex.Match(s.Name, @"^\d+").Value) < number)];
    }

    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private static async Task<object?> ScalarAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        return await cmd.ExecuteScalarAsync();
    }

    private const string Fixtures = """
        INSERT dbo.AppUser (DisplayName) VALUES (N'Author');
        INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client');
        INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES (1, '00001', '00001', N'M1');
        INSERT dbo.TaskType (Name) VALUES (N'Type A');
        INSERT dbo.WorkflowDefinition (Name) VALUES (N'W');
        INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status, PublishedAt) VALUES (1, 1, 'PUBLISHED', SYSUTCDATETIME());
        INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (1, 1), (1, 1), (1, 1);
        INSERT dbo.Priority (Label, SortOrder) VALUES (N'Normal', 3);
        """;

    private const string InsertTask = "INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName{0}) VALUES (1, 1, {1}, N'T', 1, N'R'{2});";

    [Fact]
    public async Task Descriptions_written_before_the_script_stay_text_and_new_rows_default_to_text()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(25));
        await ScalarAsync(cs, Fixtures);
        await ScalarAsync(cs, "INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, Description, PriorityId, RequestorName) VALUES (1, 1, 1, N'Old', N'Plain <b>text</b>', 1, N'R');");

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await ScalarAsync(cs, "SELECT DescriptionFormat FROM dbo.Task WHERE Title = N'Old'")).ShouldBe("TEXT");
        (await ScalarAsync(cs, "SELECT Description FROM dbo.Task WHERE Title = N'Old'")).ShouldBe("Plain <b>text</b>");
        await ScalarAsync(cs, string.Format(InsertTask, string.Empty, 2, string.Empty));
        (await ScalarAsync(cs, "SELECT DescriptionFormat FROM dbo.Task WHERE WorkflowInstanceId = 2")).ShouldBe("TEXT");
    }

    [Fact]
    public async Task The_format_is_text_or_html_and_never_null()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ScalarAsync(cs, Fixtures);

        await ScalarAsync(cs, string.Format(InsertTask, ", DescriptionFormat", 1, ", 'HTML'"));
        (await ScalarAsync(cs, "SELECT DescriptionFormat FROM dbo.Task WHERE WorkflowInstanceId = 1")).ShouldBe("HTML");

        var bad = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, string.Format(InsertTask, ", DescriptionFormat", 2, ", 'XML'")));
        bad.Message.ShouldContain("CK_Task_DescriptionFormat", Case.Insensitive);
        var nul = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, string.Format(InsertTask, ", DescriptionFormat", 3, ", NULL")));
        nul.Message.ShouldContain("DescriptionFormat", Case.Insensitive);
    }
}
