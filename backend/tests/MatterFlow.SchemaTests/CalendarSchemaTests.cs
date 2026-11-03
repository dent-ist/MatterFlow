using System.Text.RegularExpressions;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Scripts 58 to 60 (Dashboard Calendar, epic #1074, issue #1075): absences and the copy of the single Out of office value, holiday calendars, permissions and grants.</summary>
[Collection(SqlServerCollection.Name)]
public class CalendarSchemaTests(SqlServerFixture sql)
{
    private sealed class ScriptsBefore(int number) : IMigrationScriptSource
    {
        public IReadOnlyList<(string Name, string Content)> ReadAll() =>
            [.. new EmbeddedMigrationScriptSource().ReadAll().Where(s => int.Parse(Regex.Match(s.Name, @"^\d+").Value) < number)];
    }

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

    private static async Task RunScriptAgainAsync(string cs, string name)
    {
        var script = new EmbeddedMigrationScriptSource().ReadAll().Single(s => s.Name.StartsWith(name, StringComparison.Ordinal));
        foreach (var batch in SqlBatchSplitter.Split(script.Content))
            await ExecAsync(cs, batch);
    }

    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new EmbeddedMigrationScriptSource());
        await ExecAsync(cs, "INSERT dbo.AppUser (DisplayName) VALUES (N'Ann'), (N'Bob');");
        return cs;
    }

    [Fact]
    public async Task The_existing_single_out_of_office_value_becomes_the_first_entry_and_the_script_is_idempotent()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(58));
        await ExecAsync(cs, "INSERT dbo.AppUser (DisplayName) VALUES (N'Ann'), (N'Bob'), (N'Cy'), (N'Di'), (N'Ed');");
        await ExecAsync(cs, @"
INSERT dbo.UserAvailability (UserId, Status, OutOfOfficeFromDate, OutOfOfficeUntilDate, Note, UpdatedAtUtc, UpdatedByUserId) VALUES
  (1, 'OUT_OF_OFFICE', '2026-10-20', '2026-10-24', N'Conference', '2026-10-01', 2),
  (2, 'OUT_OF_OFFICE', NULL, '2026-10-24', NULL, '2026-10-02', NULL),
  (3, 'OUT_OF_OFFICE', NULL, NULL, N'Until back', '2026-10-03', 1),
  (4, 'AVAILABLE', '2026-10-20', '2026-10-24', N'stale', '2026-10-04', NULL),
  (5, 'OUT_OF_OFFICE', NULL, '2026-09-01', NULL, '2026-10-05', NULL);");

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence")).ShouldBe(4); // one per Out of office row, none for the AVAILABLE row
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence WHERE AbsenceType = 'OTHER'")).ShouldBe(4);
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence WHERE UserId = 1 AND StartDate = '2026-10-20' AND EndDate = '2026-10-24' AND Note = N'Conference' AND CreatedByUserId = 2 AND UpdatedByUserId = 2")).ShouldBe(1);
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence WHERE UserId = 2 AND StartDate = '2026-10-02' AND EndDate = '2026-10-24'")).ShouldBe(1); // no from date: the update date
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence WHERE UserId = 3 AND StartDate = '2026-10-03' AND EndDate IS NULL AND Note = N'Until back'")).ShouldBe(1); // open-ended stays open-ended
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence WHERE UserId = 5 AND StartDate = '2026-09-01' AND EndDate = '2026-09-01'")).ShouldBe(1); // never after its own end date
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence WHERE UserId = 4")).ShouldBe(0);

        // The old columns stay in place.
        (await CountAsync(cs, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserAvailability') AND name IN ('Status', 'OutOfOfficeFromDate', 'OutOfOfficeUntilDate', 'Note')")).ShouldBe(4);

        // Running the script again adds nothing and fails on nothing.
        await RunScriptAgainAsync(cs, "58-");
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.UserAbsence")).ShouldBe(4);
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

        await RunScriptAgainAsync(cs, "59-");
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.HolidayCalendar")).ShouldBe(2);
    }

    [Fact]
    public async Task The_three_permissions_exist_and_go_to_director_and_pod_lead_only()
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs, new ScriptsBefore(60));
        await ExecAsync(cs, @"
INSERT dbo.Role (Name, Description, IsActive, IsSystemAdmin)
SELECT v.Name, N'x', 1, 0 FROM (VALUES (N'Director'), (N'Pod Lead'), (N'Data Technician')) AS v (Name) WHERE NOT EXISTS (SELECT 1 FROM dbo.Role r WHERE r.Name = v.Name);");

        await RunAsync(cs, new EmbeddedMigrationScriptSource());

        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.Permission WHERE Code IN ('Dashboard.ViewCalendar', 'Dashboard.ViewAbsenceReasons', 'User.ManageAvailability') AND IsActive = 1")).ShouldBe(3);
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE r.Name = N'Director' AND p.Code IN ('Dashboard.ViewCalendar', 'Dashboard.ViewAbsenceReasons', 'User.ManageAvailability')")).ShouldBe(3);
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.RolePermission rp JOIN dbo.Role r ON r.RoleId = rp.RoleId JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE r.Name = N'Pod Lead' AND p.Code IN ('Dashboard.ViewCalendar', 'Dashboard.ViewAbsenceReasons', 'User.ManageAvailability')")).ShouldBe(3);
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE p.Code IN ('Dashboard.ViewCalendar', 'Dashboard.ViewAbsenceReasons', 'User.ManageAvailability')")).ShouldBe(6); // nobody else, System Admin holds them implicitly

        await RunScriptAgainAsync(cs, "60-");
        (await CountAsync(cs, "SELECT COUNT(*) FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE p.Code LIKE 'User.ManageAvailability'")).ShouldBe(2);
    }
}
