using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Constraints, indexes and grants of 29-notifications.sql (epic #753, issue #729).</summary>
[Collection(SqlServerCollection.Name)]
public class NotificationsSchemaTests(SqlServerFixture sql)
{
    private const string Insert = "INSERT dbo.Notification (RecipientUserId, EventType, ObjectKind, ObjectId, Message, DedupeKey) VALUES ";

    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        await ExecAsync(cs, "INSERT dbo.AppUser (DisplayName) VALUES (N'Ann'), (N'Bob');");
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
    public async Task Tables_and_indexes_exist()
    {
        var cs = await MigratedAsync();

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.tables WHERE name IN ('Notification','NotificationPreference')")).ShouldBe(2);
        foreach (var index in new[] { "UX_Notification_Dedupe", "IX_Notification_Unread", "IX_Notification_Recipient", "IX_Notification_Read" })
            (await ExecAsync(cs, $"SELECT COUNT(*) FROM sys.indexes WHERE name = '{index}' AND object_id = OBJECT_ID('dbo.Notification')")).ShouldBe(1, index);

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.indexes WHERE name = 'IX_Notification_Unread' AND has_filter = 1 AND filter_definition LIKE '%ReadUtc%IS NULL%'")).ShouldBe(1);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.indexes WHERE name = 'UX_Notification_Dedupe' AND is_unique = 1")).ShouldBe(1);
    }

    [Fact]
    public async Task Event_type_object_kind_and_text_are_checked()
    {
        var cs = await MigratedAsync();

        await ExecAsync(cs, Insert + "(1, 'TaskAssigned', 'Task', 5, N'hello', 'k1');");
        await ShouldRejectAsync(cs, Insert + "(1, 'Nope', 'Task', 5, N'hello', 'k2');", "CK_Notification_EventType");
        await ShouldRejectAsync(cs, Insert + "(1, 'TaskAssigned', 'Asset', 5, N'hello', 'k3');", "CK_Notification_ObjectKind");
        await ShouldRejectAsync(cs, Insert + "(1, 'TaskAssigned', 'Task', 5, N'   ', 'k4');", "CK_Notification_Message");
        await ShouldRejectAsync(cs, Insert + "(1, 'TaskAssigned', 'Task', 5, N'hello', '');", "CK_Notification_DedupeKey");
        await ShouldRejectAsync(cs, Insert + "(99, 'TaskAssigned', 'Task', 5, N'hello', 'k5');", "FK_Notification_Recipient");
        await ShouldRejectAsync(cs, "INSERT dbo.Notification (RecipientUserId, EventType, ObjectKind, ObjectId, MatterId, Message, DedupeKey) VALUES (1, 'TaskAssigned', 'Task', 5, 999, N'x', 'k6');", "FK_Notification_Matter");
    }

    [Fact]
    public async Task The_dedupe_key_is_unique_per_recipient_event_and_object()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, Insert + "(1, 'TaskDue', 'Task', 5, N'a', 'soon:2026-10-23');");

        await ShouldRejectAsync(cs, Insert + "(1, 'TaskDue', 'Task', 5, N'b', 'soon:2026-10-23');", "UX_Notification_Dedupe");
        await ExecAsync(cs, Insert + "(2, 'TaskDue', 'Task', 5, N'other recipient', 'soon:2026-10-23');");
        await ExecAsync(cs, Insert + "(1, 'TaskDue', 'Task', 6, N'other object', 'soon:2026-10-23');");
        await ExecAsync(cs, Insert + "(1, 'TaskDue', 'Task', 5, N'new due date re-arms', 'soon:2026-10-24');");
        await ExecAsync(cs, Insert + "(1, 'TaskDue', 'Task', 5, N'other stage', 'overdue:2026-10-23');");
    }

    [Fact]
    public async Task Preferences_are_one_per_user_and_type_with_known_types_only()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, "INSERT dbo.NotificationPreference (UserId, EventType, Enabled) VALUES (1, 'TaskAssigned', 0);");

        await ShouldRejectAsync(cs, "INSERT dbo.NotificationPreference (UserId, EventType, Enabled) VALUES (1, 'TaskAssigned', 0);", "PK_NotificationPreference");
        await ShouldRejectAsync(cs, "INSERT dbo.NotificationPreference (UserId, EventType, Enabled) VALUES (1, 'TaskMention', 0);", "CK_NotificationPreference_EventType");
        await ShouldRejectAsync(cs, "INSERT dbo.NotificationPreference (UserId, EventType, Enabled) VALUES (99, 'TaskDue', 0);", "FK_NotificationPreference_User");
    }

    [Fact]
    public async Task The_application_role_may_only_update_the_mutable_columns_and_cannot_alter_the_tables()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, Insert + "(1, 'TaskAssigned', 'Task', 5, N'hello', 'k1');");
        await ExecAsync(cs, "INSERT dbo.NotificationPreference (UserId, EventType, Enabled) VALUES (1, 'TaskDue', 0);");
        await ExecAsync(cs, "CREATE USER nt_app WITHOUT LOGIN; ALTER ROLE mf_app ADD MEMBER nt_app;");

        // Allowed as mf_app: read, insert, mark read, delete.
        await ExecAsync(cs, "EXECUTE AS USER = 'nt_app'; SELECT COUNT(*) FROM dbo.Notification; REVERT;");
        await ExecAsync(cs, "EXECUTE AS USER = 'nt_app'; UPDATE dbo.Notification SET ReadUtc = SYSUTCDATETIME() WHERE Id = 1; REVERT;");
        await ExecAsync(cs, "EXECUTE AS USER = 'nt_app'; UPDATE dbo.NotificationPreference SET Enabled = 1 WHERE UserId = 1; REVERT;");
        await ExecAsync(cs, "EXECUTE AS USER = 'nt_app'; DELETE dbo.Notification WHERE Id = 1; REVERT;");

        // Refused as mf_app: rewriting the text, the recipient, the key of a preference, altering the table.
        await ExecAsync(cs, Insert + "(1, 'TaskAssigned', 'Task', 5, N'hello', 'k2');");
        await ShouldRejectAsync(cs, "EXECUTE AS USER = 'nt_app'; UPDATE dbo.Notification SET Message = N'rewritten'; REVERT;", "permission was denied");
        await ShouldRejectAsync(cs, "EXECUTE AS USER = 'nt_app'; UPDATE dbo.Notification SET RecipientUserId = 2; REVERT;", "permission was denied");
        await ShouldRejectAsync(cs, "EXECUTE AS USER = 'nt_app'; UPDATE dbo.NotificationPreference SET EventType = 'TaskAssigned'; REVERT;", "permission was denied");
        await ShouldRejectAsync(cs, "EXECUTE AS USER = 'nt_app'; ALTER TABLE dbo.Notification ADD Extra INT NULL; REVERT;", "permission");
    }
}
