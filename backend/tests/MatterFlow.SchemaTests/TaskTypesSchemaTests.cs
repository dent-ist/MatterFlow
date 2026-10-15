using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Constraints of 08-task-types.sql (docs/erd.md "TaskType").</summary>
[Collection(SqlServerCollection.Name)]
public class TaskTypesSchemaTests(SqlServerFixture sql)
{
    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        return cs;
    }

    private static async Task<int> ExecAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        return Convert.ToInt32(await cmd.ExecuteScalarAsync() ?? 0);
    }

    private static async Task ShouldRejectAsync(string cs, string sqlText, string expected)
    {
        var ex = await Should.ThrowAsync<SqlException>(() => ExecAsync(cs, sqlText));
        ex.Message.ShouldContain(expected, Case.Insensitive, sqlText);
    }

    [Fact]
    public async Task Names_are_unique_and_not_blank_and_eligibility_is_keyed_by_type_and_workflow()
    {
        var cs = await MigratedAsync();

        await ExecAsync(cs, "INSERT dbo.TaskType (Name) VALUES (N'Data Processing')");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskType (Name) VALUES (N'Data Processing')", "UQ_TaskType_Name");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskType (Name) VALUES (N'   ')", "CK_TaskType_Name");

        await ExecAsync(cs, "INSERT dbo.TaskTypeWorkflowEligibility (TaskTypeId, WorkflowDefinitionId) VALUES (1, 7)");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskTypeWorkflowEligibility (TaskTypeId, WorkflowDefinitionId) VALUES (1, 7)", "PK_TaskTypeWorkflowEligibility");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskTypeWorkflowEligibility (TaskTypeId, WorkflowDefinitionId) VALUES (1, 0)", "CK_TaskTypeWorkflowEligibility_Workflow");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskTypeWorkflowEligibility (TaskTypeId, WorkflowDefinitionId) VALUES (99, 7)", "FK_TaskTypeWorkflowEligibility_TaskType");
        // A Task Type that has eligibility rows can never be deleted (deactivate instead).
        await ShouldRejectAsync(cs, "DELETE dbo.TaskType WHERE TaskTypeId = 1", "FK_TaskTypeWorkflowEligibility_TaskType");
    }

    [Fact]
    public async Task Icon_key_is_required_defaults_to_file_text_and_only_takes_well_formed_ids()
    {
        var cs = await MigratedAsync();

        await ExecAsync(cs, "INSERT dbo.TaskType (Name) VALUES (N'No icon given')");
        (await ExecAsync(cs, "SELECT COUNT(*) FROM dbo.TaskType WHERE Name = N'No icon given' AND IconKey = 'file-text'")).ShouldBe(1);

        await ExecAsync(cs, "INSERT dbo.TaskType (Name, IconKey) VALUES (N'Mail', 'mail')");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskType (Name, IconKey) VALUES (N'Null icon', NULL)", "IconKey");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskType (Name, IconKey) VALUES (N'Empty icon', '')", "CK_TaskType_IconKey");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskType (Name, IconKey) VALUES (N'Bad icon', 'Not An Icon')", "CK_TaskType_IconKey");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskType (Name, IconKey) VALUES (N'Long icon', '" + new string('a', 51) + "')", "truncated");
    }

    [Fact]
    public async Task Task_assigned_at_exists_and_is_empty_for_unassigned_tasks()
    {
        var cs = await MigratedAsync();
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Task') AND name = 'AssignedAt' AND is_nullable = 1")).ShouldBe(1);
    }
}
