using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>Assigning reports to roles from both sides, the diff, the audit and the rule that assignment never reveals SQL (epic #671, issue #716).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportAssignmentApiTests(SqlServerFixture sql)
{
    private const string Base = "/api/v1/report-admin";
    private const string Secret = "SELECT 'secret_marker' AS s";

    private static StringContent Body(object value) => ReportTestHarness.Json(value);

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<int[]> AssignedRolesAsync(ReportTestHarness h, int reportId)
    {
        var rows = await SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT STRING_AGG(CAST(RoleId AS varchar(10)), ',') WITHIN GROUP (ORDER BY RoleId) FROM dbo.RoleReport WHERE ReportId = {reportId}");
        return rows is string text && text.Length > 0 ? text.Split(',').Select(int.Parse).ToArray() : [];
    }

    [Fact]
    public async Task Roles_of_a_report_are_listed_and_replaced_with_a_diff_and_an_audit_event()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (assigner, _) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (_, leadRole) = await h.PersonAsync(@"KE\lead", "Report.Run");
        var (_, directorRole) = await h.PersonAsync(@"KE\director", "Report.Run");
        var id = await h.AddReportAsync(Secret, roleIds: leadRole);

        var roles = await ReadAsync(await assigner.GetAsync($"{Base}/reports/{id}/roles"));
        roles.EnumerateArray().Single(r => r.GetProperty("roleId").GetInt32() == leadRole).GetProperty("assigned").GetBoolean().ShouldBeTrue();
        var director = roles.EnumerateArray().Single(r => r.GetProperty("roleId").GetInt32() == directorRole);
        director.GetProperty("assigned").GetBoolean().ShouldBeFalse();
        director.GetProperty("memberCount").GetInt32().ShouldBe(1);
        roles.ToString().ShouldNotContain("secret_marker");

        var diff = await ReadAsync(await assigner.PutAsync($"{Base}/reports/{id}/roles", Body(new { roleIds = new[] { directorRole } })));

        diff.GetProperty("added").EnumerateArray().Select(n => n.GetProperty("name").GetString()).ShouldBe([@"Role KE\director"]);
        diff.GetProperty("removed").EnumerateArray().Select(n => n.GetProperty("name").GetString()).ShouldBe([@"Role KE\lead"]);
        diff.GetProperty("assignedCount").GetInt32().ShouldBe(1);
        (await AssignedRolesAsync(h, id)).ShouldBe([directorRole]);
        var events = await h.AuditAsync(id);
        var assigned = events.Single(e => e.GetProperty("EventType").GetString() == "REPORT_ROLES_ASSIGNED");
        assigned.GetProperty("NewValue").GetString().ShouldBe(@"Role KE\director");
        assigned.GetProperty("OldValue").GetString().ShouldBe(@"Role KE\lead");

        var again = await ReadAsync(await assigner.PutAsync($"{Base}/reports/{id}/roles", Body(new { roleIds = new[] { directorRole } })));
        again.GetProperty("added").GetArrayLength().ShouldBe(0);
        (await h.AuditAsync(id)).Count(e => e.GetProperty("EventType").GetString() == "REPORT_ROLES_ASSIGNED").ShouldBe(1);
    }

    [Fact]
    public async Task Reports_of_a_role_are_replaced_from_the_other_side_with_one_audit_event_per_report_and_both_sides_agree()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (assigner, _) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (_, role) = await h.PersonAsync(@"KE\lead", "Report.Run");
        var a = await h.AddReportAsync(Secret, roleIds: role);
        var b = await h.AddReportAsync("SELECT 2 AS two");
        var c = await h.AddReportAsync("SELECT 3 AS three", active: false);

        var list = await ReadAsync(await assigner.GetAsync($"{Base}/roles/{role}/reports"));
        list.EnumerateArray().Select(r => (r.GetProperty("reportId").GetInt32(), r.GetProperty("assigned").GetBoolean(), r.GetProperty("isActive").GetBoolean())).ShouldBe([(a, true, true), (b, false, true), (c, false, false)]);
        list.ToString().ShouldNotContain("secret_marker");

        var diff = await ReadAsync(await assigner.PutAsync($"{Base}/roles/{role}/reports", Body(new { reportIds = new[] { b, c } })));

        diff.GetProperty("added").EnumerateArray().Select(n => n.GetProperty("id").GetInt32()).ShouldBe([b, c]);
        diff.GetProperty("removed").EnumerateArray().Select(n => n.GetProperty("id").GetInt32()).ShouldBe([a]);
        diff.GetProperty("assignedCount").GetInt32().ShouldBe(2);
        (await AssignedRolesAsync(h, a)).ShouldBe([]);
        (await AssignedRolesAsync(h, b)).ShouldBe([role]);
        var fromReport = await ReadAsync(await assigner.GetAsync($"{Base}/reports/{b}/roles"));
        fromReport.EnumerateArray().Single(r => r.GetProperty("roleId").GetInt32() == role).GetProperty("assigned").GetBoolean().ShouldBeTrue();
        foreach (var (reportId, type) in new[] { (a, "removed"), (b, "added"), (c, "added") })
        {
            var events = (await h.AuditAsync(reportId)).Where(e => e.GetProperty("EventType").GetString() == "REPORT_ROLES_ASSIGNED").ToList();
            events.Count.ShouldBe(a == reportId ? 1 : 1, $"report {reportId}");
            var field = events[^1].GetProperty(type == "added" ? "NewValue" : "OldValue").GetString();
            field.ShouldBe(@"Role KE\lead");
        }

        var matrix = await ReadAsync(await assigner.GetAsync($"{Base}/assignment-matrix"));
        matrix.GetProperty("cells").EnumerateArray().Select(x => (x.GetProperty("roleId").GetInt32(), x.GetProperty("reportId").GetInt32())).ShouldBe([(role, b), (role, c)], ignoreOrder: true);
        matrix.ToString().ShouldNotContain("secret_marker");
    }

    [Fact]
    public async Task Unknown_ids_are_refused_without_changing_anything_and_a_missing_list_is_a_bad_request()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (assigner, _) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (_, role) = await h.PersonAsync(@"KE\lead", "Report.Run");
        var id = await h.AddReportAsync(Secret, roleIds: role);

        var unknownRole = await assigner.PutAsync($"{Base}/reports/{id}/roles", Body(new { roleIds = new[] { role, 9999 } }));
        unknownRole.StatusCode.ShouldBe((HttpStatusCode)422);
        (await ReadAsync(unknownRole)).GetProperty("code").GetString().ShouldBe("ROLE_NOT_FOUND");
        var unknownReport = await assigner.PutAsync($"{Base}/roles/{role}/reports", Body(new { reportIds = new[] { id, 9999 } }));
        unknownReport.StatusCode.ShouldBe((HttpStatusCode)422);
        (await ReadAsync(unknownReport)).GetProperty("code").GetString().ShouldBe("REPORT_NOT_FOUND");
        (await assigner.PutAsync($"{Base}/reports/9999/roles", Body(new { roleIds = Array.Empty<int>() }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await assigner.PutAsync($"{Base}/roles/9999/reports", Body(new { reportIds = Array.Empty<int>() }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await assigner.GetAsync($"{Base}/roles/9999/reports")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await assigner.PutAsync($"{Base}/reports/{id}/roles", Body(new { }))).StatusCode.ShouldBe((HttpStatusCode)422);
        (await AssignedRolesAsync(h, id)).ShouldBe([role]);

        var cleared = await ReadAsync(await assigner.PutAsync($"{Base}/reports/{id}/roles", Body(new { roleIds = Array.Empty<int>() })));
        cleared.GetProperty("assignedCount").GetInt32().ShouldBe(0);
        (await AssignedRolesAsync(h, id)).ShouldBe([]);
    }

    [Fact]
    public async Task Assign_without_Manage_cannot_read_SQL_and_Manage_without_Assign_cannot_assign()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (assigner, _) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var id = await h.AddReportAsync(Secret);

        foreach (var url in new[] { $"{Base}/reports/{id}", $"{Base}/reports/{id}/versions", $"{Base}/reports/{id}/versions/1", $"{Base}/reports", $"{Base}/schema" })
            (await assigner.GetAsync(url)).StatusCode.ShouldBe(HttpStatusCode.Forbidden, url);

        (await manager.GetAsync($"{Base}/reports/{id}/roles")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await manager.PutAsync($"{Base}/reports/{id}/roles", Body(new { roleIds = Array.Empty<int>() }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await manager.GetAsync($"{Base}/roles/1/reports")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await manager.PutAsync($"{Base}/roles/1/reports", Body(new { reportIds = Array.Empty<int>() }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await manager.GetAsync($"{Base}/assignment-matrix")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    public static TheoryData<string, string, string?> Endpoints => new()
    {
        { "GET", "/reports/1/roles", null },
        { "PUT", "/reports/1/roles", "{\"roleIds\":[]}" },
        { "GET", "/roles/1/reports", null },
        { "PUT", "/roles/1/reports", "{\"reportIds\":[]}" },
        { "GET", "/assignment-matrix", null },
    };

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Every_assignment_endpoint_refuses_people_without_Report_Assign(string method, string path, string? body)
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var people = new[]
        {
            (await h.PersonAsync(@"KE\run", "Report.Run")).Client,
            (await h.PersonAsync(@"KE\manage", "Report.Manage")).Client,
            (await h.PersonAsync(@"KE\runmanage", "Report.Run", "Report.Manage")).Client,
            (await h.PersonAsync(@"KE\none", "Matter.View")).Client,
        };

        foreach (var person in people)
        {
            var request = new HttpRequestMessage(new HttpMethod(method), Base + path) { Content = body is null ? null : new StringContent(body, Encoding.UTF8, "application/json") };
            (await person.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.Forbidden, $"{method} {path}");
        }
    }

    [Fact]
    public async Task An_assigned_report_becomes_runnable_for_the_role_and_stops_when_it_is_removed()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (assigner, _) = await h.PersonAsync(@"KE\assigner", "Report.Assign");
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT 1 AS one");

        (await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await assigner.PutAsync($"{Base}/reports/{id}/roles", Body(new { roleIds = new[] { role } }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await assigner.PutAsync($"{Base}/roles/{role}/reports", Body(new { reportIds = Array.Empty<int>() }))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await runner.PostAsync($"/api/v1/reports/{id}/runs", ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
