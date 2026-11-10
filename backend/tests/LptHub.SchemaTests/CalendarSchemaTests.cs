using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Dashboard Calendar (epic #1074, issue #1075; baseline, formerly scripts 58 to 60): absences, holiday calendars and their constraints.</summary>
[Collection(SqlServerCollection.Name)]
public class CalendarSchemaTests(SqlServerFixture sql)
{
    private static Task RunAsync(string cs, IMigrationScriptSource source) =>
        new SchemaMigrationRunner(cs, source, new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<int> CountAsync(string cs, string text) => Convert.ToInt32(await ScalarAsync(cs, text) ?? 0);

    private static async Task ExecAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task ShouldRejectAsync(string cs, string text, string expected)
    {
        var ex = await Should.ThrowAsync<SqlException>(() => ExecAsync(cs, text));
        ex.Message.ShouldContain(expected, Case.Insensitive, text);
    }

    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ExecAsync(cs, "INSERT dbo.AppUser (DisplayName) VALUES (N'Ann'), (N'Bob');");
        return cs;
    }

    [Fact]
    public async Task A_clean_database_has_the_absence_table_with_its_constraints_and_indexes()
    {
        var cs = await MigratedAsync();

        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence")).ShouldBe(0);
        (await CountAsync(cs, "SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.UserAbsence') AND name IN ('IX_UserAbsence_User', 'IX_UserAbsence_Dates')")).ShouldBe(2);

        await ExecAsync(cs, "INSERT dbo.UserAbsence (UserId, AbsenceType, StartDate, EndDate) VALUES (1, 'VACATION', '2027-07-05', '2027-07-16'), (1, 'SICK', '2027-08-01', NULL), (1, 'OTHER', '2027-09-01', '2027-09-01');");
        await ShouldRejectAsync(cs, "INSERT dbo.UserAbsence (UserId, AbsenceType, StartDate) VALUES (1, 'HOLIDAY', '2027-07-05');", "CK_UserAbsence_Type");
        await ShouldRejectAsync(cs, "INSERT dbo.UserAbsence (UserId, AbsenceType, StartDate, EndDate) VALUES (1, 'VACATION', '2027-07-05', '2027-07-04');", "CK_UserAbsence_Range");
        await ShouldRejectAsync(cs, "INSERT dbo.UserAbsence (UserId, AbsenceType, StartDate) VALUES (999, 'VACATION', '2027-07-05');", "FK_UserAbsence_User");
        await ShouldRejectAsync(cs, "INSERT dbo.UserAbsence (UserId, AbsenceType, StartDate) VALUES (1, 'VACATION', NULL);", "StartDate");
        await ShouldRejectAsync(cs, $"INSERT dbo.UserAbsence (UserId, AbsenceType, StartDate, Note) VALUES (1, 'VACATION', '2027-07-05', N'{new string('x', 201)}');", "truncated");
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence WHERE RowVersion IS NOT NULL")).ShouldBe(3);
    }

    [Fact]
    public async Task Holiday_tables_hold_rules_and_check_their_fields()
    {
        var cs = await MigratedAsync();

        await ExecAsync(cs, "INSERT dbo.HolidayCalendar (Name, ColourKey, AppliesToEveryone) VALUES (N'US Holiday', 'indigo', 0), (N'Firm closure', 'green', 1);");
        await ShouldRejectAsync(cs, "INSERT dbo.HolidayCalendar (Name) VALUES (N'US Holiday');", "UQ_HolidayCalendar_Name");
        await ExecAsync(cs, @"
INSERT dbo.Holiday (CalendarId, Name, RuleKind, Month, Day, WeekendRule) VALUES (1, N'Christmas Day', 'FIXED', 12, 25, 'US');
INSERT dbo.Holiday (CalendarId, Name, RuleKind, Month, Nth, Weekday) VALUES (1, N'Thanksgiving', 'NTH_WEEKDAY', 11, 4, 4);
INSERT dbo.Holiday (CalendarId, Name, RuleKind, EasterOffset) VALUES (1, N'Good Friday', 'EASTER_OFFSET', -2);
INSERT dbo.Holiday (CalendarId, Name, RuleKind, OnceDate, Yearly) VALUES (1, N'Office move', 'ONCE', '2027-02-12', 0);
INSERT dbo.Holiday (CalendarId, Name, RuleKind, Month, Day, RangeEndMonth, RangeEndDay) VALUES (2, N'Year-end', 'RANGE', 12, 28, 12, 31);
INSERT dbo.Holiday (CalendarId, Name, RuleKind, OnceDate, RangeEndDate, Yearly) VALUES (2, N'Offsite', 'RANGE', '2026-12-30', '2027-01-02', 0);");

        await ShouldRejectAsync(cs, "INSERT dbo.Holiday (CalendarId, Name, RuleKind) VALUES (1, N'x', 'FIXED');", "CK_Holiday_Fields");
        await ShouldRejectAsync(cs, "INSERT dbo.Holiday (CalendarId, Name, RuleKind, Month, Day) VALUES (1, N'x', 'WEEKLY', 1, 1);", "CK_Holiday_RuleKind");
        await ShouldRejectAsync(cs, "INSERT dbo.Holiday (CalendarId, Name, RuleKind, Month, Day, WeekendRule) VALUES (1, N'x', 'FIXED', 1, 1, 'EU');", "CK_Holiday_WeekendRule");
        await ShouldRejectAsync(cs, "INSERT dbo.Holiday (CalendarId, Name, RuleKind, Month, Day) VALUES (1, N'x', 'FIXED', 13, 1);", "CK_Holiday_Month");
        await ShouldRejectAsync(cs, "INSERT dbo.Holiday (CalendarId, Name, RuleKind, Month, Nth, Weekday) VALUES (1, N'x', 'NTH_WEEKDAY', 5, 5, 1);", "CK_Holiday_Nth");
        await ShouldRejectAsync(cs, "INSERT dbo.Holiday (CalendarId, Name, RuleKind, OnceDate, RangeEndDate, Yearly) VALUES (1, N'x', 'RANGE', '2027-01-02', '2027-01-01', 0);", "CK_Holiday_OnceRange");
        await ShouldRejectAsync(cs, "INSERT dbo.Holiday (CalendarId, Name, RuleKind, Month, Day) VALUES (99, N'x', 'FIXED', 1, 1);", "FK_Holiday_Calendar");

        // The calendar columns of a person and a pod.
        await ExecAsync(cs, "INSERT dbo.Pod (Name) VALUES (N'Review'); UPDATE dbo.AppUser SET HolidayCalendarId = 1 WHERE UserId = 1; UPDATE dbo.Pod SET DefaultHolidayCalendarId = 2 WHERE Name = N'Review';");
        await ShouldRejectAsync(cs, "UPDATE dbo.AppUser SET HolidayCalendarId = 99 WHERE UserId = 1;", "FK_AppUser_HolidayCalendar");
        await ShouldRejectAsync(cs, "UPDATE dbo.Pod SET DefaultHolidayCalendarId = 99;", "FK_Pod_DefaultHolidayCalendar");
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.AppSetting")).ShouldBe(0); // no seed row: defaults live in code
    }
}
