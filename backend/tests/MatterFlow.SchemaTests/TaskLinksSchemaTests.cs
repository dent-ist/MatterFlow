using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Constraints and triggers of 14-task-links.sql (docs/erd.md invariants I-4 and I-20).</summary>
[Collection(SqlServerCollection.Name)]
public class TaskLinksSchemaTests(SqlServerFixture sql)
{
    private async Task<string> MigratedWithFixturesAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        await ExecAsync(
            cs,
            """
            INSERT dbo.AppUser (DisplayName) VALUES (N'Author');
            INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client');
            INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES (1, '00001', '00001', N'M1'), (1, '00001', '00002', N'M2');
            INSERT dbo.TaskType (Name) VALUES (N'Type A');
            INSERT dbo.WorkflowDefinition (Name) VALUES (N'W');
            INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status, PublishedAt) VALUES (1, 1, 'PUBLISHED', SYSUTCDATETIME());
            INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (1, 1);
            INSERT dbo.Priority (Label, SortOrder) VALUES (N'Normal', 3);
            INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName) VALUES (1, 1, 1, N'T', 1, N'R');
            INSERT dbo.AssetType (Name) VALUES (N'Laptop');
            INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES (1, 1, N'A1'), (1, 1, N'A2'), (2, 1, N'B1');
            INSERT dbo.AssetLinkRole (Name, SortOrder) VALUES (N'Source', 1);
            INSERT dbo.TaskComment (TaskId, AuthorUserId, BodyHtml) VALUES (1, 1, N'<p>v1</p>');
            """);
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
    public async Task Objects_exist()
    {
        var cs = await MigratedWithFixturesAsync();

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.tables WHERE name IN ('TaskAsset','TaskCommentRevision')")).ShouldBe(2);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.foreign_keys WHERE name IN ('FK_TaskAsset_Task','FK_TaskAsset_Asset','FK_TaskAsset_Role','FK_TaskCommentRevision_Comment')")).ShouldBe(4);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.indexes WHERE name IN ('IX_TaskAsset_Asset','IX_TaskAsset_Role','IX_TaskCommentRevision_Comment')")).ShouldBe(3);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.triggers WHERE name = 'TR_TaskCommentRevision_AppendOnly' AND is_disabled = 0")).ShouldBe(1);
    }

    [Fact]
    public async Task A_link_must_stay_inside_one_matter_and_is_unique_per_task_and_asset()
    {
        var cs = await MigratedWithFixturesAsync();

        await ExecAsync(cs, "INSERT dbo.TaskAsset (TaskId, AssetId, MatterId, AssetLinkRoleId) VALUES (1, 1, 1, 1), (1, 2, 1, NULL)");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskAsset (TaskId, AssetId, MatterId) VALUES (1, 3, 1)", "FK_TaskAsset_Asset");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskAsset (TaskId, AssetId, MatterId) VALUES (1, 3, 2)", "FK_TaskAsset_Task");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskAsset (TaskId, AssetId, MatterId) VALUES (1, 1, 1)", "PK_TaskAsset");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskAsset (TaskId, AssetId, MatterId, AssetLinkRoleId) VALUES (1, 3, 2, 99)", "FK_TaskAsset");
        await ShouldRejectAsync(cs, "UPDATE dbo.TaskAsset SET AssetLinkRoleId = 99", "FK_TaskAsset_Role");

        // Unlinking removes the row.
        (await ExecAsync(cs, "DELETE FROM dbo.TaskAsset WHERE AssetId = 2; SELECT COUNT(*) FROM dbo.TaskAsset")).ShouldBe(1);
    }

    [Fact]
    public async Task Comment_revisions_are_append_only_with_a_known_reason()
    {
        var cs = await MigratedWithFixturesAsync();

        await ExecAsync(cs, "INSERT dbo.TaskCommentRevision (TaskCommentId, BodyHtml, Reason, RevisedByUserId) VALUES (1, N'<p>v1</p>', 'EDIT', 1), (1, N'<p>v2</p>', 'DELETE', 1)");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskCommentRevision (TaskCommentId, BodyHtml, Reason) VALUES (1, N'x', 'PURGE')", "CK_TaskCommentRevision_Reason");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskCommentRevision (TaskCommentId, BodyHtml, Reason) VALUES (99, N'x', 'EDIT')", "FK_TaskCommentRevision_Comment");
        await ShouldRejectAsync(cs, "UPDATE dbo.TaskCommentRevision SET BodyHtml = N'tampered'", "append-only");
        await ShouldRejectAsync(cs, "DELETE FROM dbo.TaskCommentRevision", "append-only");
        (await ExecAsync(cs, "SELECT COUNT(*) FROM dbo.TaskCommentRevision")).ShouldBe(2);
    }
}
