using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>Favourites (PUT/DELETE /api/v1/reports/{id}/favourite, <c>isFavourite</c> in the list) and the Recent line (GET /api/v1/reports/recent), issue #723.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportFavouritesApiTests(SqlServerFixture sql)
{
    private const string Query = "SELECT 1 AS one";
    private const string SecretSql = "SELECT 424242 AS secret_marker_column";
    private const string NotAvailable = "This report does not exist or is not available to you.";

    private static string Fav(int report) => $"/api/v1/reports/{report}/favourite";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<Dictionary<int, bool>> FlagsAsync(HttpClient client)
    {
        var list = await ReadAsync(await client.GetAsync("/api/v1/reports"));
        return list.GetProperty("categories").EnumerateArray()
            .SelectMany(c => c.GetProperty("reports").EnumerateArray())
            .ToDictionary(r => r.GetProperty("reportId").GetInt32(), r => r.GetProperty("isFavourite").GetBoolean());
    }

    private static async Task<int[]> RecentIdsAsync(HttpClient client, string query = "")
    {
        var response = await client.GetAsync("/api/v1/reports/recent" + query);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await ReadAsync(response)).GetProperty("reports").EnumerateArray().Select(r => r.GetProperty("reportId").GetInt32()).ToArray();
    }

    private static async Task<int> UserOfAsync(ReportTestHarness h, int roleId) =>
        Convert.ToInt32(await SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT TOP (1) UserId FROM dbo.UserRole WHERE RoleId = {roleId}"), CultureInfo.InvariantCulture);

    /// <summary>A run log row with a chosen time, kind and status (the app cannot update StartedAt afterwards, so the order is set here).</summary>
    private static Task AddRunAsync(ReportTestHarness h, int report, int userId, DateTime startedUtc, string status = "Succeeded", string kind = "Run") =>
        SqlServerFixture.ExecuteAsync(
            h.AppConnection,
            $"""
            INSERT dbo.ReportRun (ReportId, ReportVersionId, UserId, StartedAt, FinishedAt, Status, Kind, CorrelationId)
            SELECT {report}, CurrentVersionId, {userId}, '{startedUtc:yyyy-MM-ddTHH:mm:ss}', '{startedUtc:yyyy-MM-ddTHH:mm:ss}', '{status}', '{kind}', NEWID()
            FROM dbo.ReportDefinition WHERE ReportId = {report}
            """);

    private static async Task<long> FavouriteRowsAsync(ReportTestHarness h) =>
        Convert.ToInt64(await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportFavourite"), CultureInfo.InvariantCulture);

    [Fact]
    public async Task Persona_cases_decide_who_may_set_a_favourite_and_read_the_recent_line()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (assigned, role) = await h.PersonAsync(@"KE\assigned", "Report.Run");
        var (unassigned, _) = await h.PersonAsync(@"KE\unassigned", "Report.Run");
        var (manager, managerRole) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var (assigner, assignerRole) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (nobody, nobodyRole) = await h.PersonAsync(@"KE\nobody", "Matter.View");
        var report = await h.AddReportAsync(Query, roleIds: [role, managerRole, assignerRole, nobodyRole]);

        (await assigned.PutAsync(Fav(report), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        var refused = await unassigned.PutAsync(Fav(report), null);
        refused.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ReadAsync(refused)).GetProperty("detail").GetString().ShouldBe(NotAvailable);
        (await unassigned.DeleteAsync(Fav(report))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await unassigned.GetAsync("/api/v1/reports/recent")).StatusCode.ShouldBe(HttpStatusCode.OK);

        // Report.Manage and Report.Assign do not imply Report.Run; a person without any Report permission is refused as well, assigned or not.
        foreach (var client in new[] { manager, assigner, nobody })
        {
            (await client.PutAsync(Fav(report), null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.DeleteAsync(Fav(report))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.GetAsync("/api/v1/reports/recent")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        }

        var anonymous = h.Factory.CreateClient(); // not signed in; the CSRF header is there so the answer is the sign-in one
        anonymous.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        (await anonymous.PutAsync(Fav(report), null)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await anonymous.DeleteAsync(Fav(report))).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await anonymous.GetAsync("/api/v1/reports/recent")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await FavouriteRowsAsync(h)).ShouldBe(1);
    }

    [Fact]
    public async Task A_report_that_is_unknown_inactive_or_in_a_deactivated_category_is_the_same_404()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var inactive = await h.AddReportAsync(Query, active: false, roleIds: role);
        var hiddenCategory = await h.AddReportAsync(Query, roleIds: role);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE c SET IsActive = 0 FROM dbo.ReportCategory c JOIN dbo.ReportDefinition d ON d.ReportCategoryId = c.ReportCategoryId WHERE d.ReportId = {hiddenCategory}");

        foreach (var id in new[] { inactive, hiddenCategory, 99999 })
        {
            var response = await ann.PutAsync(Fav(id), null);
            response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await ReadAsync(response)).GetProperty("detail").GetString().ShouldBe(NotAvailable);
        }

        (await FavouriteRowsAsync(h)).ShouldBe(0);
    }

    [Fact]
    public async Task Adding_and_removing_are_idempotent_and_the_list_shows_only_the_callers_own_marks()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, boRole) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var first = await h.AddReportAsync(Query, roleIds: [role, boRole]);
        var second = await h.AddReportAsync(Query, roleIds: [role, boRole]);

        (await FlagsAsync(ann)).ShouldBe(new Dictionary<int, bool> { [first] = false, [second] = false });
        (await ann.DeleteAsync(Fav(first))).StatusCode.ShouldBe(HttpStatusCode.NoContent); // nothing to remove is fine
        (await ann.PutAsync(Fav(first), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await ann.PutAsync(Fav(first), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent); // twice is the same as once
        (await FavouriteRowsAsync(h)).ShouldBe(1);

        (await FlagsAsync(ann)).ShouldBe(new Dictionary<int, bool> { [first] = true, [second] = false });
        // Bo sees nothing of Ann's mark, and Bo's own removal does not touch it.
        (await FlagsAsync(bo)).ShouldBe(new Dictionary<int, bool> { [first] = false, [second] = false });
        (await bo.DeleteAsync(Fav(first))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await FlagsAsync(ann))[first].ShouldBeTrue();
        (await bo.PutAsync(Fav(first), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await FavouriteRowsAsync(h)).ShouldBe(2);

        (await ann.DeleteAsync(Fav(first))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await ann.DeleteAsync(Fav(first))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await FlagsAsync(ann))[first].ShouldBeFalse();
        (await FlagsAsync(bo))[first].ShouldBeTrue();
        (await FavouriteRowsAsync(h)).ShouldBe(1);
    }

    [Fact]
    public async Task A_person_keeps_at_most_the_configured_number_of_favourites_and_marks_of_unusable_reports_do_not_count()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:MaxFavouritesPerUser", "2"));
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, boRole) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var ids = new List<int>();
        for (var i = 0; i < 4; i++)
            ids.Add(await h.AddReportAsync(Query, roleIds: [role, boRole]));

        (await ann.PutAsync(Fav(ids[0]), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await ann.PutAsync(Fav(ids[1]), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        var over = await ann.PutAsync(Fav(ids[2]), null);
        over.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        var problem = await ReadAsync(over);
        problem.GetProperty("code").GetString().ShouldBe("FAVOURITE_LIMIT_REACHED");
        problem.GetProperty("detail").GetString().ShouldBe("You can have up to 2 favourite reports.");
        (await FavouriteRowsAsync(h)).ShouldBe(2);

        // A report that is already a favourite can be added again at the limit; the limit is per person.
        (await ann.PutAsync(Fav(ids[0]), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await bo.PutAsync(Fav(ids[2]), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        // Removing one frees a place.
        await ann.DeleteAsync(Fav(ids[0]));
        (await ann.PutAsync(Fav(ids[2]), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        // A report that is unassigned stops counting (its mark is kept but hidden), so it never blocks a new one.
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"DELETE dbo.RoleReport WHERE RoleId = {role} AND ReportId = {ids[1]}");
        (await ann.PutAsync(Fav(ids[3]), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await ann.PutAsync(Fav(ids[0]), null)).StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task A_report_that_stops_being_runnable_disappears_from_favourites_and_recent_without_error_and_returns_when_it_is_runnable_again()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var annId = await UserOfAsync(h, role);
        var kept = await h.AddReportAsync(Query, roleIds: role);
        var unassigned = await h.AddReportAsync(Query, roleIds: role);
        var deactivated = await h.AddReportAsync(Query, roleIds: role);
        var hiddenCategory = await h.AddReportAsync(Query, roleIds: role);
        var keptToo = await h.AddReportAsync(Query, roleIds: role);
        var start = new DateTime(2026, 11, 1, 8, 0, 0, DateTimeKind.Utc);
        var all = new[] { kept, unassigned, deactivated, hiddenCategory, keptToo };
        for (var i = 0; i < all.Length; i++)
        {
            (await ann.PutAsync(Fav(all[i]), null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            await AddRunAsync(h, all[i], annId, start.AddMinutes(i));
        }

        (await FlagsAsync(ann)).Values.ShouldAllBe(v => v);
        (await RecentIdsAsync(ann)).ShouldBe([keptToo, hiddenCategory, deactivated, unassigned, kept]);

        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"DELETE dbo.RoleReport WHERE ReportId = {unassigned}");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportDefinition SET IsActive = 0 WHERE ReportId = {deactivated}");
        await SqlServerFixture.ExecuteAsync(
            h.AppConnection,
            $"""
            INSERT dbo.ReportCategory (Name, IsActive) VALUES (N'Switched off', 0);
            UPDATE dbo.ReportDefinition SET ReportCategoryId = (SELECT ReportCategoryId FROM dbo.ReportCategory WHERE Name = N'Switched off') WHERE ReportId = {hiddenCategory};
            """);

        // A role that is switched off takes every report of the person with it, and brings them back when it is switched on.
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.Role SET IsActive = 0 WHERE RoleId = {role}");
        (await ann.GetAsync("/api/v1/reports")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await RecentIdsAsync(ann)).ShouldBeEmpty();
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.Role SET IsActive = 1 WHERE RoleId = {role}");

        // Only the report that is still runnable shows, in the list and in the line; nothing errors and the marks are kept.
        (await FlagsAsync(ann)).ShouldBe(new Dictionary<int, bool> { [kept] = true, [keptToo] = true });
        (await RecentIdsAsync(ann)).ShouldBe([keptToo, kept]);
        (await FavouriteRowsAsync(h)).ShouldBe(5);
        (await ann.PutAsync(Fav(unassigned), null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // Assigned again: the report returns with its mark and its place in the line.
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.RoleReport (RoleId, ReportId) VALUES ({role}, {unassigned})");
        (await FlagsAsync(ann))[unassigned].ShouldBeTrue();
        (await RecentIdsAsync(ann)).ShouldBe([keptToo, unassigned, kept]);
    }

    [Fact]
    public async Task The_recent_line_holds_distinct_reports_by_successful_run_newest_first_for_the_caller_only()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, boRole) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var annId = await UserOfAsync(h, role);
        var boId = await UserOfAsync(h, boRole);
        var a = await h.AddReportAsync(Query, roleIds: [role, boRole]);
        var b = await h.AddReportAsync(Query, roleIds: [role, boRole]);
        var c = await h.AddReportAsync(Query, roleIds: [role, boRole]);
        var d = await h.AddReportAsync(Query, roleIds: [role, boRole]);
        var t = new DateTime(2026, 11, 2, 9, 0, 0, DateTimeKind.Utc);

        (await RecentIdsAsync(ann)).ShouldBeEmpty();
        await AddRunAsync(h, a, annId, t);
        await AddRunAsync(h, b, annId, t.AddMinutes(1));
        await AddRunAsync(h, a, annId, t.AddMinutes(2)); // a again: it moves to the front, once
        await AddRunAsync(h, c, annId, t.AddMinutes(3), status: "Truncated");
        // Not successful runs, not runs, and Bo's runs do not count for Ann.
        await AddRunAsync(h, d, annId, t.AddMinutes(4), status: "Failed");
        await AddRunAsync(h, d, annId, t.AddMinutes(5), status: "Cancelled");
        await AddRunAsync(h, d, annId, t.AddMinutes(6), status: "TimedOut");
        await AddRunAsync(h, d, annId, t.AddMinutes(7), status: "Rejected");
        await AddRunAsync(h, d, annId, t.AddMinutes(8), kind: "Preview");
        await AddRunAsync(h, d, annId, t.AddMinutes(9), kind: "Export");
        await AddRunAsync(h, d, boId, t.AddMinutes(10));

        (await RecentIdsAsync(ann)).ShouldBe([c, a, b]);
        (await RecentIdsAsync(bo)).ShouldBe([d]);
        var body = await ReadAsync(await ann.GetAsync("/api/v1/reports/recent"));
        var first = body.GetProperty("reports")[0];
        first.GetProperty("name").GetString().ShouldStartWith("Report ");
        first.GetProperty("categoryName").GetString().ShouldBe("Test");
        first.GetProperty("lastRunAtUtc").GetDateTime().ShouldBe(t.AddMinutes(3));
    }

    [Fact]
    public async Task A_real_run_enters_the_recent_line_and_a_failed_run_does_not()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var good = await h.AddReportAsync(Query, roleIds: role);
        var bad = await h.AddReportAsync("SELECT CAST('x' AS int) AS broken", roleIds: role);

        (await ann.PostAsync($"/api/v1/reports/{bad}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldNotBe(HttpStatusCode.OK);
        (await RecentIdsAsync(ann)).ShouldBeEmpty();
        (await ann.PostAsync($"/api/v1/reports/{good}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await RecentIdsAsync(ann)).ShouldBe([good]);
        var list = await ReadAsync(await ann.GetAsync("/api/v1/reports"));
        var lastRun = list.GetProperty("categories")[0].GetProperty("reports")[0].GetProperty("lastRunAtUtc").GetDateTime();
        (await ReadAsync(await ann.GetAsync("/api/v1/reports/recent"))).GetProperty("reports")[0].GetProperty("lastRunAtUtc").GetDateTime().ShouldBe(lastRun);
    }

    [Fact]
    public async Task Top_defaults_to_five_and_is_held_between_one_and_ten()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var annId = await UserOfAsync(h, role);
        var t = new DateTime(2026, 11, 3, 9, 0, 0, DateTimeKind.Utc);
        var ids = new List<int>();
        for (var i = 0; i < 12; i++)
        {
            var id = await h.AddReportAsync(Query, roleIds: role);
            ids.Add(id);
            await AddRunAsync(h, id, annId, t.AddMinutes(i));
        }

        (await RecentIdsAsync(ann)).Length.ShouldBe(5);
        (await RecentIdsAsync(ann, "?top=3")).ShouldBe(ids.AsEnumerable().Reverse().Take(3));
        (await RecentIdsAsync(ann, "?top=0")).Length.ShouldBe(1);
        (await RecentIdsAsync(ann, "?top=-5")).Length.ShouldBe(1);
        (await RecentIdsAsync(ann, "?top=99")).Length.ShouldBe(10);
        (await ann.GetAsync("/api/v1/reports/recent?top=abc")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task No_response_of_favourites_or_recent_contains_sql_or_a_report_the_caller_may_not_run()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var annId = await UserOfAsync(h, role);
        var mine = await h.AddReportAsync(SecretSql, roleIds: role);
        var foreign = await h.AddReportAsync("SELECT 515151 AS foreign_marker_column");
        await ann.PutAsync(Fav(mine), null);
        await AddRunAsync(h, mine, annId, new DateTime(2026, 11, 4, 9, 0, 0, DateTimeKind.Utc));
        await AddRunAsync(h, foreign, annId, new DateTime(2026, 11, 4, 9, 5, 0, DateTimeKind.Utc));

        var recent = await (await ann.GetAsync("/api/v1/reports/recent")).Content.ReadAsStringAsync();
        var list = await (await ann.GetAsync("/api/v1/reports")).Content.ReadAsStringAsync();

        foreach (var body in new[] { recent, list })
        {
            body.ShouldNotContain("424242");
            body.ShouldNotContain("secret_marker_column");
            body.ShouldNotContain("515151");
            body.ShouldNotContain("foreign_marker_column");
            body.ShouldNotContain("sqlText", Case.Insensitive);
        }

        (await RecentIdsAsync(ann)).ShouldBe([mine]);
        list.ShouldNotContain($"\"reportId\":{foreign},");
    }
}
