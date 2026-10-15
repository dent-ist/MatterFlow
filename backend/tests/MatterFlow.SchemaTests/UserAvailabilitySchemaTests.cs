using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Constraints of 22-user-availability.sql (docs/erd.md, epic #68).</summary>
[Collection(SqlServerCollection.Name)]
public class UserAvailabilitySchemaTests(SqlServerFixture sql)
{
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
    public async Task Objects_exist_and_a_default_row_is_available_with_default_hours()
    {
        var cs = await MigratedAsync();

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.tables WHERE name IN ('UserAvailability','UserWorkHour')")).ShouldBe(2);
        await ExecAsync(cs, "INSERT dbo.UserAvailability (UserId) VALUES (1);");
        (await ExecAsync(cs, "SELECT COUNT(*) FROM dbo.UserAvailability WHERE UserId = 1 AND Status = 'AVAILABLE' AND HasCustomWorkHours = 0")).ShouldBe(1);
    }

    [Fact]
    public async Task Status_and_date_range_are_checked()
    {
        var cs = await MigratedAsync();

        await ShouldRejectAsync(cs, "INSERT dbo.UserAvailability (UserId, Status) VALUES (1, 'AWAY');", "CK_UserAvailability_Status");
        await ShouldRejectAsync(cs, "INSERT dbo.UserAvailability (UserId, Status, OutOfOfficeFromDate, OutOfOfficeUntilDate) VALUES (1, 'OUT_OF_OFFICE', '2026-10-20', '2026-10-19');", "CK_UserAvailability_Range");
        await ExecAsync(cs, "INSERT dbo.UserAvailability (UserId, Status, OutOfOfficeFromDate, OutOfOfficeUntilDate) VALUES (1, 'OUT_OF_OFFICE', '2026-10-20', '2026-10-20');");
        await ExecAsync(cs, "INSERT dbo.UserAvailability (UserId, Status, OutOfOfficeUntilDate) VALUES (2, 'OUT_OF_OFFICE', '2026-10-20');");
    }

    [Fact]
    public async Task One_row_per_user_and_a_real_user()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, "INSERT dbo.UserAvailability (UserId) VALUES (1);");

        await ShouldRejectAsync(cs, "INSERT dbo.UserAvailability (UserId) VALUES (1);", "PK_UserAvailability");
        await ShouldRejectAsync(cs, "INSERT dbo.UserAvailability (UserId) VALUES (999);", "FK_UserAvailability_User");
    }

    [Fact]
    public async Task Work_hours_need_a_valid_weekday_a_positive_range_and_one_row_per_day()
    {
        var cs = await MigratedAsync();

        await ExecAsync(cs, "INSERT dbo.UserWorkHour (UserId, DayOfWeek, StartTime, EndTime) VALUES (1, 1, '09:00', '17:00'), (1, 7, '10:00', '12:00');");
        await ShouldRejectAsync(cs, "INSERT dbo.UserWorkHour (UserId, DayOfWeek, StartTime, EndTime) VALUES (1, 1, '08:00', '09:00');", "PK_UserWorkHour");
        await ShouldRejectAsync(cs, "INSERT dbo.UserWorkHour (UserId, DayOfWeek, StartTime, EndTime) VALUES (2, 0, '09:00', '17:00');", "CK_UserWorkHour_Day");
        await ShouldRejectAsync(cs, "INSERT dbo.UserWorkHour (UserId, DayOfWeek, StartTime, EndTime) VALUES (2, 8, '09:00', '17:00');", "CK_UserWorkHour_Day");
        await ShouldRejectAsync(cs, "INSERT dbo.UserWorkHour (UserId, DayOfWeek, StartTime, EndTime) VALUES (2, 2, '17:00', '09:00');", "CK_UserWorkHour_Range");
        await ShouldRejectAsync(cs, "INSERT dbo.UserWorkHour (UserId, DayOfWeek, StartTime, EndTime) VALUES (2, 2, '09:00', '09:00');", "CK_UserWorkHour_Range");
        await ShouldRejectAsync(cs, "INSERT dbo.UserWorkHour (UserId, DayOfWeek, StartTime, EndTime) VALUES (99, 2, '09:00', '17:00');", "FK_UserWorkHour_User");
    }
}
