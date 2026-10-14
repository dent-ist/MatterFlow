using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Constraints, indexes, triggers and defaults of 12-tasks.sql (docs/erd.md section 5, decisions addendum A, M).</summary>
[Collection(SqlServerCollection.Name)]
public class TaskSchemaTests(SqlServerFixture sql)
{
    private const string Columns = "(MatterId, ProjectId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName";

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
            INSERT dbo.Project (MatterId, Name) VALUES (1, N'P1'), (2, N'P2');
            INSERT dbo.TaskType (Name) VALUES (N'Type A'), (N'Type B');
            INSERT dbo.WorkflowDefinition (Name) VALUES (N'W');
            INSERT dbo.WorkflowVersion (WorkflowDefinitionId, VersionNo, Status, PublishedAt) VALUES (1, 1, 'PUBLISHED', SYSUTCDATETIME());
            INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (1, 1), (1, 1), (1, 1), (1, 1);
            INSERT dbo.Priority (Label, SortOrder) VALUES (N'Normal', 3);
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

    private static Task InsertTaskAsync(string cs, string columnsAndValues) => ExecAsync(cs, $"INSERT dbo.Task {columnsAndValues}");

    private static string Minimal(int instance, string extraColumns = "", string extraValues = "") =>
        $"{Columns}{extraColumns}) VALUES (1, NULL, 1, {instance}, N'Title', 1, N'Requestor'{extraValues})";

    [Fact]
    public async Task Task_objects_exist()
    {
        var cs = await MigratedWithFixturesAsync();

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.tables WHERE name IN ('Task','TaskComment')")).ShouldBe(2);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.triggers WHERE name IN ('TR_Task_Immutable','TR_Task_NoDelete','TR_TaskComment_Guard','TR_TaskComment_NoDelete') AND is_disabled = 0")).ShouldBe(4);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.foreign_keys WHERE name IN ('FK_Task_Project_SameMatter','FK_Task_WorkflowInstance','FK_Task_Priority','FK_Task_Status')")).ShouldBe(4);
        (await ExecAsync(
            cs,
            "SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Task') AND name IN ('IX_Task_Queue','IX_Task_AssignedUser','IX_Task_Pod','IX_Task_Matter','IX_Task_Project','IX_Task_Creator','IX_Task_Type','IX_Task_Completed','UQ_Task_Number','UQ_Task_IdMatter','UQ_Task_WorkflowInstance')"))
            .ShouldBe(11);
    }

    [Fact]
    public async Task A_new_task_gets_a_number_from_the_sequence_the_new_status_and_a_status_time()
    {
        var cs = await MigratedWithFixturesAsync();

        await InsertTaskAsync(cs, Minimal(1));
        await InsertTaskAsync(cs, Minimal(2));

        (await ExecAsync(cs, "SELECT COUNT(*) FROM dbo.Task WHERE TaskNumber IN ('TSK-1','TSK-2') AND StatusCode = 'NEW' AND StatusChangedAt IS NOT NULL")).ShouldBe(2);
    }

    [Fact]
    public async Task A_project_must_belong_to_the_tasks_matter()
    {
        var cs = await MigratedWithFixturesAsync();

        await InsertTaskAsync(cs, "(MatterId, ProjectId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName) VALUES (1, 1, 1, 1, N'ok', 1, N'r')");
        await ShouldRejectAsync(cs, "INSERT dbo.Task (MatterId, ProjectId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName) VALUES (1, 2, 1, 2, N'x', 1, N'r')", "FK_Task_Project_SameMatter");
        await InsertTaskAsync(cs, Minimal(3)); // no project: valid
        await ShouldRejectAsync(cs, "UPDATE dbo.Task SET ProjectId = 2 WHERE WorkflowInstanceId = 3", "FK_Task_Project_SameMatter");
        await ExecAsync(cs, "UPDATE dbo.Task SET ProjectId = 1 WHERE WorkflowInstanceId = 3"); // the project may change within the matter
    }

    [Fact]
    public async Task One_workflow_instance_belongs_to_one_task_and_the_status_is_a_known_code()
    {
        var cs = await MigratedWithFixturesAsync();
        await InsertTaskAsync(cs, Minimal(1));

        await ShouldRejectAsync(cs, $"INSERT dbo.Task {Minimal(1)}", "UQ_Task_WorkflowInstance");
        await ShouldRejectAsync(cs, $"INSERT dbo.Task {Minimal(2, ", StatusCode", ", 'DONE'")}", "CK_Task_StatusCode");
        await ShouldRejectAsync(cs, "INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName) VALUES (1, 1, 99, N't', 1, N'r')", "FK_Task_WorkflowInstance");
    }

    [Fact]
    public async Task Text_checks_and_the_requestor_rules_hold()
    {
        var cs = await MigratedWithFixturesAsync();

        await ShouldRejectAsync(cs, "INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName) VALUES (1, 1, 1, N'   ', 1, N'r')", "CK_Task_Title");
        await ShouldRejectAsync(cs, "INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName) VALUES (1, 1, 1, N't', 1, N'  ')", "CK_Task_RequestorName");
        await ShouldRejectAsync(cs, "INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, RequestorName) VALUES (1, 1, 1, N't', 1, NULL)", "RequestorName");
        await ShouldRejectAsync(cs, $"INSERT dbo.Task {Minimal(1, ", RequestorEmail", ", N'no-at-sign'")}", "CK_Task_RequestorEmail");
        await InsertTaskAsync(cs, Minimal(1, ", RequestorEmail", ", N'a@b.example'"));
    }

    [Fact]
    public async Task Due_columns_follow_the_asap_rules()
    {
        var cs = await MigratedWithFixturesAsync();

        await InsertTaskAsync(cs, Minimal(1)); // ASAP: no due values at all
        await ShouldRejectAsync(cs, $"INSERT dbo.Task {Minimal(2, ", DueAtUtc", ", '2030-01-01T10:00:00'")}", "CK_Task_DueAt");
        await ShouldRejectAsync(cs, $"INSERT dbo.Task {Minimal(2, ", DueDate", ", '2030-01-01'")}", "CK_Task_DueSortKey");
        await ShouldRejectAsync(cs, $"INSERT dbo.Task {Minimal(2, ", DueSortKey", ", '2030-01-01T10:00:00'")}", "CK_Task_DueSortKey");
        await InsertTaskAsync(cs, Minimal(2, ", DueDate, DueSortKey", ", '2030-01-01', '2030-01-01T23:59:59'"));
        await InsertTaskAsync(cs, Minimal(3, ", DueDate, DueAtUtc, DueSortKey", ", '2030-01-01', '2030-01-01T15:30:00', '2030-01-01T15:30:00'"));
    }

    [Fact]
    public async Task Completed_at_is_set_exactly_when_the_task_is_completed()
    {
        var cs = await MigratedWithFixturesAsync();
        await InsertTaskAsync(cs, Minimal(1));

        await ShouldRejectAsync(cs, "UPDATE dbo.Task SET StatusCode = 'COMPLETED' WHERE WorkflowInstanceId = 1", "CK_Task_CompletedAt");
        await ShouldRejectAsync(cs, "UPDATE dbo.Task SET CompletedAt = SYSUTCDATETIME() WHERE WorkflowInstanceId = 1", "CK_Task_CompletedAt");
        await ExecAsync(cs, "UPDATE dbo.Task SET StatusCode = 'COMPLETED', CompletedAt = SYSUTCDATETIME() WHERE WorkflowInstanceId = 1");
        await ExecAsync(cs, "UPDATE dbo.Task SET StatusCode = 'CANCELLED', CompletedAt = NULL WHERE WorkflowInstanceId = 1");
    }

    [Fact]
    public async Task Matter_type_workflow_form_version_and_number_are_immutable_and_tasks_are_never_deleted()
    {
        var cs = await MigratedWithFixturesAsync();
        await InsertTaskAsync(cs, Minimal(1));

        await ShouldRejectAsync(cs, "UPDATE dbo.Task SET MatterId = 2", "cannot be changed after creation");
        await ShouldRejectAsync(cs, "UPDATE dbo.Task SET TaskTypeId = 2", "cannot be changed after creation");
        await ShouldRejectAsync(cs, "UPDATE dbo.Task SET WorkflowInstanceId = 2", "cannot be changed after creation");
        await ShouldRejectAsync(cs, "UPDATE dbo.Task SET TaskNumber = 'TSK-77'", "cannot be changed after creation");
        await ExecAsync(cs, "UPDATE dbo.Task SET Title = N'Renamed', PriorityId = 1, AssignedUserId = 1 WHERE WorkflowInstanceId = 1");
        await ShouldRejectAsync(cs, "DELETE FROM dbo.Task", "cannot be deleted");
    }

    [Fact]
    public async Task Comments_default_to_normal_and_reasons_cannot_be_deleted_changed_or_removed()
    {
        var cs = await MigratedWithFixturesAsync();
        await InsertTaskAsync(cs, Minimal(1));

        await ExecAsync(cs, "INSERT dbo.TaskComment (TaskId, AuthorUserId, BodyHtml) VALUES (1, 1, N'<p>hello</p>')");
        await ExecAsync(cs, "INSERT dbo.TaskComment (TaskId, AuthorUserId, Purpose, BodyHtml) VALUES (1, 1, 'CANCEL', N'<p>why</p>'), (1, 1, 'ON_HOLD', N'<p>wait</p>')");
        (await ExecAsync(cs, "SELECT COUNT(*) FROM dbo.TaskComment WHERE Purpose = 'NORMAL'")).ShouldBe(1);

        await ShouldRejectAsync(cs, "INSERT dbo.TaskComment (TaskId, AuthorUserId, Purpose, BodyHtml) VALUES (1, 1, 'SPAM', N'x')", "CK_TaskComment_Purpose");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskComment (TaskId, AuthorUserId, BodyHtml) VALUES (1, 1, N'  ')", "CK_TaskComment_Body");
        await ShouldRejectAsync(cs, "INSERT dbo.TaskComment (TaskId, AuthorUserId, BodyHtml) VALUES (99, 1, N'x')", "FK_TaskComment_Task");
        await ShouldRejectAsync(cs, "UPDATE dbo.TaskComment SET IsDeleted = 1, DeletedAt = SYSUTCDATETIME() WHERE Purpose = 'CANCEL'", "CK_TaskComment_ReasonNotDeletable");
        await ShouldRejectAsync(cs, "UPDATE dbo.TaskComment SET IsDeleted = 1, DeletedAt = SYSUTCDATETIME() WHERE Purpose = 'ON_HOLD'", "CK_TaskComment_ReasonNotDeletable");
        await ShouldRejectAsync(cs, "UPDATE dbo.TaskComment SET IsDeleted = 1 WHERE Purpose = 'NORMAL'", "CK_TaskComment_Deleted");
        await ShouldRejectAsync(cs, "UPDATE dbo.TaskComment SET Purpose = 'NORMAL' WHERE Purpose = 'CANCEL'", "cannot change");
        await ShouldRejectAsync(cs, "DELETE FROM dbo.TaskComment", "cannot be deleted");

        // An ordinary comment may be soft-deleted and edited.
        await ExecAsync(cs, "UPDATE dbo.TaskComment SET BodyHtml = N'<p>edited</p>', EditedAt = SYSUTCDATETIME() WHERE Purpose = 'NORMAL'");
        await ExecAsync(cs, "UPDATE dbo.TaskComment SET IsDeleted = 1, DeletedAt = SYSUTCDATETIME(), DeletedByUserId = 1 WHERE Purpose = 'NORMAL'");
    }
}
