using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Constraints, indexes and triggers of 09-workflow-config.sql (docs/erd.md section 7).</summary>
[Collection(SqlServerCollection.Name)]
public class WorkflowSchemaTests(SqlServerFixture sql)
{
    private const string StepInsert = "INSERT dbo.WorkflowVersionStep (WorkflowVersionId, SequenceNo, SourceStepDefinitionId, Title, IsSkippable, SkipCommentRequired)";

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
    public async Task Workflow_objects_exist()
    {
        var cs = await MigratedAsync();

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.tables WHERE name IN ('StepDefinition','WorkflowDefinition','WorkflowVersion','WorkflowVersionStep')")).ShouldBe(4);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.triggers WHERE name IN ('TR_WorkflowVersion_Immutable','TR_WorkflowVersionStep_Immutable') AND is_disabled = 0")).ShouldBe(2);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.foreign_keys WHERE name = 'FK_FormDef_Step'")).ShouldBe(1);
    }

    [Fact]
    public async Task Step_titles_are_unique_among_active_steps_and_the_form_owner_must_exist()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, "INSERT dbo.StepDefinition (Title) VALUES (N'QC')");
        await ShouldRejectAsync(cs, "INSERT dbo.StepDefinition (Title) VALUES (N'QC')", "UQ_StepDefinition_Title");
        await ShouldRejectAsync(cs, "INSERT dbo.StepDefinition (Title) VALUES (N'  ')", "CK_StepDefinition_Title");
        await ExecAsync(cs, "INSERT dbo.StepDefinition (Title, IsActive) VALUES (N'QC', 0)");
        await ExecAsync(cs, "INSERT dbo.StepDefinition (Title, IsActive) VALUES (N'QC', 0)");

        await ExecAsync(cs, "INSERT dbo.FormDefinition (Scope, StepDefinitionId) VALUES ('STEP', 1)");
        await ShouldRejectAsync(cs, "INSERT dbo.FormDefinition (Scope, StepDefinitionId) VALUES ('STEP', 99)", "FK_FormDef_Step");
    }

    [Fact]
    public async Task Version_and_step_constraints()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, "INSERT dbo.StepDefinition (Title) VALUES (N'A'), (N'B'); INSERT dbo.WorkflowDefinition (Name) VALUES (N'W')");
        await ShouldRejectAsync(cs, "INSERT dbo.WorkflowDefinition (Name) VALUES (N'W')", "UQ_WorkflowDefinition_Name");
        await ExecAsync(cs, "INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status) VALUES (1, 1, 'DRAFT')");

        await ShouldRejectAsync(cs, "INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status) VALUES (1, 2, 'DRAFT')", "UQ_WorkflowVersion_Draft");
        await ShouldRejectAsync(cs, "INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status) VALUES (1, 1, 'RETIRED')", "UQ_WorkflowVersion_No");
        await ShouldRejectAsync(cs, "INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status) VALUES (1, 3, 'PUBLISHED')", "CK_WorkflowVersion_PublishedAt");
        await ShouldRejectAsync(cs, "INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status) VALUES (1, 3, 'ARCHIVED')", "CK_WorkflowVersion_Status");

        await ExecAsync(cs, StepInsert + " VALUES (1, 1, 1, N'A', 0, 0)");
        await ShouldRejectAsync(cs, StepInsert + " VALUES (1, 1, 2, N'B', 0, 0)", "UQ_WVS_Sequence");
        await ShouldRejectAsync(cs, StepInsert + " VALUES (1, 2, 1, N'A again', 0, 0)", "UQ_WVS_Source");
        await ShouldRejectAsync(cs, StepInsert + " VALUES (1, 2, 2, N'B', 0, 1)", "CK_WVS_SkipComment");
        await ShouldRejectAsync(cs, StepInsert + " VALUES (1, 0, 2, N'B', 0, 0)", "CK_WVS_Sequence");
        await ShouldRejectAsync(cs, StepInsert + " VALUES (1, 3, 77, N'C', 0, 0)", "FK_WVS_Source");
        await ShouldRejectAsync(cs, "INSERT dbo.WorkflowVersionStep (WorkflowVersionId, SequenceNo, SourceStepDefinitionId, Title, StepFormVersionId) VALUES (1, 5, 2, N'B', 42)", "FK_WVS_FormVersion");
    }

    [Fact]
    public async Task Only_a_draft_can_change_and_published_can_only_retire()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, "INSERT dbo.StepDefinition (Title) VALUES (N'A'); INSERT dbo.WorkflowDefinition (Name) VALUES (N'W')");
        await ExecAsync(cs, "INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status) VALUES (1, 1, 'DRAFT')");
        await ExecAsync(cs, "INSERT dbo.WorkflowVersionStep (WorkflowVersionId, SequenceNo, SourceStepDefinitionId, Title) VALUES (1, 1, 1, N'A')");

        // A draft is freely editable.
        await ExecAsync(cs, "UPDATE dbo.WorkflowVersionStep SET Title = N'A2' WHERE WorkflowVersionId = 1; UPDATE dbo.WorkflowVersion SET IsOrdered = 0 WHERE WorkflowVersionId = 1");
        await ExecAsync(cs, "UPDATE dbo.WorkflowVersion SET Status = 'PUBLISHED', PublishedAt = SYSUTCDATETIME() WHERE WorkflowVersionId = 1");

        await ShouldRejectAsync(cs, "UPDATE dbo.WorkflowVersionStep SET Title = N'x' WHERE WorkflowVersionId = 1", "immutable");
        await ShouldRejectAsync(cs, "DELETE dbo.WorkflowVersionStep WHERE WorkflowVersionId = 1", "immutable");
        await ShouldRejectAsync(cs, "UPDATE dbo.WorkflowVersion SET IsOrdered = 1 WHERE WorkflowVersionId = 1", "immutable");
        await ShouldRejectAsync(cs, "UPDATE dbo.WorkflowVersion SET Status = 'DRAFT' WHERE WorkflowVersionId = 1", "immutable");
        await ShouldRejectAsync(cs, "UPDATE dbo.WorkflowVersion SET PublishedAt = '2001-01-01' WHERE WorkflowVersionId = 1", "immutable");

        await ExecAsync(cs, "UPDATE dbo.WorkflowVersion SET Status = 'RETIRED' WHERE WorkflowVersionId = 1");
        await ShouldRejectAsync(cs, "UPDATE dbo.WorkflowVersion SET Status = 'PUBLISHED' WHERE WorkflowVersionId = 1", "immutable");
        await ShouldRejectAsync(cs, "UPDATE dbo.WorkflowVersionStep SET IsSkippable = 1 WHERE WorkflowVersionId = 1", "immutable");
    }

    [Fact]
    public async Task A_draft_version_without_steps_can_be_deleted_but_a_published_one_cannot()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, "INSERT dbo.WorkflowDefinition (Name) VALUES (N'W')");
        await ExecAsync(cs, "INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status) VALUES (1, 1, 'DRAFT')");
        await ExecAsync(cs, "DELETE dbo.WorkflowVersion WHERE WorkflowVersionId = 1");

        await ExecAsync(cs, "INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status, PublishedAt) VALUES (1, 2, 'PUBLISHED', SYSUTCDATETIME())");
        await ShouldRejectAsync(cs, "DELETE dbo.WorkflowVersion WHERE VersionNo = 2", "immutable");
    }
}
