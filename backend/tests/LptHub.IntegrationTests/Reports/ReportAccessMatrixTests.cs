using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LptHub.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using static LptHub.IntegrationTests.Reports.ReportSecurityKit;

namespace LptHub.IntegrationTests.Reports;

/// <summary>
/// Access to Reports (issue #725, spec 16.3 h and j, threat 7.5 and 7.7): one walk over every Reports route the host exposes (so a new endpoint cannot ship
/// without a permission) for no login, no Report permission and each single permission; and one walk over every endpoint a runner uses, for each reason a
/// report can stop being available to a person, which must look the same as a report that never existed.
/// </summary>
[Collection(SqlServerCollection.Name)]
[Trait("Suite", "ReportsSecurity")]
public sealed partial class ReportAccessMatrixTests(SqlServerFixture sql)
{
    [GeneratedRegex(@"\{[A-Za-z]+(:[a-z]+)?\}")]
    private static partial Regex RouteParameter();

    private sealed record Route(string Method, string Pattern, string Path, string Permission);

    private static List<Route> RoutesOf(ReportTestHarness h)
    {
        var source = h.Factory.Services.GetRequiredService<EndpointDataSource>();
        var routes = new List<Route>();
        foreach (var endpoint in source.Endpoints.OfType<RouteEndpoint>().Where(e => e.RoutePattern.RawText!.StartsWith("api/v1/report", StringComparison.Ordinal)))
        {
            var policies = endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Select(a => a.Policy).Where(p => p is not null).ToList();
            policies.Count.ShouldBe(1, $"{endpoint.RoutePattern.RawText} must name exactly one permission policy");
            endpoint.Metadata.GetMetadata<IAllowAnonymous>().ShouldBeNull(endpoint.RoutePattern.RawText);
            var pattern = endpoint.RoutePattern.RawText!;
            var path = RouteParameter().Replace(pattern, m => m.Value.Contains(":guid", StringComparison.Ordinal) ? "6f1c2a9e-0000-4000-8000-000000000001" : m.Value.Contains("{table}", StringComparison.Ordinal) ? "Task" : m.Value.Contains("{parameter}", StringComparison.Ordinal) ? "x" : "1");
            foreach (var method in endpoint.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods)
                routes.Add(new Route(method, pattern, "/" + path, policies[0]!.Replace("Perm:", "", StringComparison.Ordinal)));
        }

        return routes;
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, Route route)
    {
        var request = new HttpRequestMessage(new HttpMethod(route.Method), route.Path);
        if (route.Method is "POST" or "PUT")
            request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
        request.Headers.TryAddWithoutValidation("If-Match", "\"AAAAAAAAB9E=\"");
        request.Headers.TryAddWithoutValidation("X-LptHub-Client", "web"); // without it a write is refused as a bad request before anyone is asked who they are
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task Every_reports_endpoint_is_401_without_a_login_403_without_its_permission_and_reachable_with_it()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var routes = RoutesOf(h);
        routes.Count.ShouldBeGreaterThanOrEqualTo(40);
        routes.Select(r => r.Permission).Distinct().Order().ShouldBe(["Report.Assign", "Report.Manage", "Report.Run"]);
        var people = new Dictionary<string, HttpClient>
        {
            ["none"] = (await h.PersonAsync(@"KE\none", "Matter.View", "Audit.View")).Client,
            ["Report.Run"] = (await h.PersonAsync(@"KE\run", "Report.Run")).Client,
            ["Report.Manage"] = (await h.PersonAsync(@"KE\manage", "Report.Manage")).Client,
            ["Report.Assign"] = (await h.PersonAsync(@"KE\assign", "Report.Assign")).Client,
        };
        using var anonymous = h.Factory.CreateClient();
        var problems = new List<string>();

        foreach (var route in routes)
        {
            var login = await SendAsync(anonymous, route);
            if (login.StatusCode != HttpStatusCode.Unauthorized)
                problems.Add($"{route.Method} {route.Pattern}: no login -> {(int)login.StatusCode}");

            foreach (var (name, client) in people)
            {
                var response = await SendAsync(client, route);
                var status = (int)response.StatusCode;
                if (name == route.Permission)
                {
                    // Reachable: whatever it says about the made-up ids, it is not a refusal of the person and not a crash.
                    if (status is 401 or 403 or >= 500 and not 503)
                        problems.Add($"{route.Method} {route.Pattern}: holder of {name} -> {status}");
                }
                else if (status != 403)
                {
                    problems.Add($"{route.Method} {route.Pattern}: person with {name} only -> {status} (wanted 403)");
                }
            }
        }

        problems.ShouldBeEmpty(string.Join(Environment.NewLine, problems));
    }

    // ---- a report that stops being available looks like a report that never existed ----

    private sealed record Probe(string Name, Func<HttpClient, int, Guid, Task<HttpResponseMessage>> Send);

    private static readonly Probe[] Probes =
    [
        new("definition", (c, id, _) => c.GetAsync($"/api/v1/reports/{id}")),
        new("run", (c, id, _) => c.PostAsync(RunUrl(id), ReportTestHarness.Parameters(new { }))),
        new("choices", (c, id, _) => c.PostAsync($"/api/v1/reports/{id}/choices/KIND", null)),
        new("lookup", (c, id, _) => c.GetAsync($"/api/v1/reports/{id}/lookups/MATTER")),
        new("views list", (c, id, _) => c.GetAsync($"/api/v1/reports/{id}/views")),
        new("views create", (c, id, _) => c.PostAsync($"/api/v1/reports/{id}/views", ReportTestHarness.Json(new { name = "x", layout = new { columns = Array.Empty<object>(), sort = Array.Empty<object>(), filters = Array.Empty<object>(), pageSize = 50 }, isDefault = false }))),
        new("views update", (c, id, _) => c.PutAsync($"/api/v1/reports/{id}/views/1", ReportTestHarness.Json(new { name = "y" }))),
        new("views delete", (c, id, _) => c.DeleteAsync($"/api/v1/reports/{id}/views/1")),
        new("views default", (c, id, _) => c.PostAsync($"/api/v1/reports/{id}/views/1/default", null)),
        new("favourite add", (c, id, _) => c.PutAsync($"/api/v1/reports/{id}/favourite", null)),
        new("favourite remove", (c, id, _) => c.DeleteAsync($"/api/v1/reports/{id}/favourite")),
    ];

    private static readonly Probe[] ResultProbes =
    [
        new("rows", (c, _, run) => c.GetAsync(Rows(run))),
        new("export", (c, _, run) => c.GetAsync(Export(run))),
    ];

    private static async Task<string> NormalizedAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        var root = JsonDocument.Parse(text).RootElement;
        return $"{(int)response.StatusCode} {root.GetProperty("code").GetString()} {root.GetProperty("detail").GetString()}";
    }

    [Fact]
    public async Task Every_reason_a_report_stops_being_available_gives_the_runner_the_same_404_on_every_endpoint_as_an_unknown_id()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, _) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var assignedRole = await h.Factory.CreateRoleAsync("Assigned to reports");
        await h.Factory.GrantRoleAsync(@"KE\runner", assignedRole);
        var report = await h.AddReportAsync("SELECT 1 AS one", roleIds: assignedRole);
        var run = await RunOkAsync(runner, report);
        var userId = await h.Tasks.UserIdAsync(@"KE\runner");

        // The same questions about an id that never existed give the reference answers.
        var reference = new Dictionary<string, string>();
        foreach (var probe in Probes)
            reference[probe.Name] = await NormalizedAsync(await probe.Send(runner, 987_654, run));
        reference.Values.ShouldAllBe(v => v.StartsWith("404 NOT_FOUND This report does not exist or is not available to you.", StringComparison.Ordinal), string.Join(" | ", reference.Values));
        foreach (var probe in ResultProbes)
            (await probe.Send(runner, report, Guid.NewGuid())).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var states = new (string Name, string Break, string Restore)[]
        {
            ("report inactive", $"UPDATE dbo.ReportDefinition SET IsActive = 0 WHERE ReportId = {report}", $"UPDATE dbo.ReportDefinition SET IsActive = 1 WHERE ReportId = {report}"),
            ("category inactive", "UPDATE dbo.ReportCategory SET IsActive = 0", "UPDATE dbo.ReportCategory SET IsActive = 1"),
            ("assignment removed", $"DELETE dbo.RoleReport WHERE ReportId = {report}", $"INSERT dbo.RoleReport (RoleId, ReportId) VALUES ({assignedRole}, {report})"),
            ("role inactive", $"UPDATE dbo.Role SET IsActive = 0 WHERE RoleId = {assignedRole}", $"UPDATE dbo.Role SET IsActive = 1 WHERE RoleId = {assignedRole}"),
            ("person left the role", $"DELETE dbo.UserRole WHERE UserId = {userId} AND RoleId = {assignedRole}", $"INSERT dbo.UserRole (UserId, RoleId) VALUES ({userId}, {assignedRole})"),
            (
                "new version saved but not previewed (report deactivated)",
                $"INSERT dbo.ReportVersion (ReportId, VersionNo, SqlText, SqlHash) SELECT {report}, 2, N'SELECT 2 AS two', 0x00; UPDATE dbo.ReportDefinition SET IsActive = 0, CurrentVersionId = (SELECT ReportVersionId FROM dbo.ReportVersion WHERE ReportId = {report} AND VersionNo = 2) WHERE ReportId = {report}",
                $"UPDATE dbo.ReportDefinition SET IsActive = 1, CurrentVersionId = (SELECT ReportVersionId FROM dbo.ReportVersion WHERE ReportId = {report} AND VersionNo = 1) WHERE ReportId = {report}"
            ),
        };

        foreach (var (name, breakIt, restore) in states)
        {
            await SqlServerFixture.ExecuteAsync(h.AppConnection, breakIt);
            h.Factory.InvalidateAll();

            foreach (var probe in Probes)
                (await NormalizedAsync(await probe.Send(runner, report, run))).ShouldBe(reference[probe.Name], $"{name}: {probe.Name}");
            foreach (var probe in ResultProbes)
            {
                var response = await probe.Send(runner, report, run);
                response.StatusCode.ShouldBe(HttpStatusCode.NotFound, $"{name}: {probe.Name} of a result made before");
                (await NormalizedAsync(response)).ShouldContain("not available to you", Case.Sensitive, $"{name}: {probe.Name}");
            }

            var list = await ReadAsync(await runner.GetAsync("/api/v1/reports"));
            list.GetProperty("totalReports").GetInt32().ShouldBe(0, $"{name}: the list");
            (await h.RunLogAsync(report)).EnumerateArray().Count(r => r.GetProperty("Kind").GetString() == "Run").ShouldBe(1, $"{name}: a refused run leaves no run");

            await SqlServerFixture.ExecuteAsync(h.AppConnection, restore);
            h.Factory.InvalidateAll();
            (await runner.GetAsync($"/api/v1/reports/{report}")).StatusCode.ShouldBe(HttpStatusCode.OK, $"{name}: restored");
            (await runner.GetAsync(Rows(run))).StatusCode.ShouldBe(HttpStatusCode.OK, $"{name}: the result comes back with the access");
        }
    }

    [Fact]
    public async Task A_report_given_to_the_Technician_role_only_is_not_available_to_the_Project_Manager_who_holds_Report_Run()
    {
        // Per-report access (#808): Report.Run says "may run reports", the assignment says "which". Both starter roles are the real ones from the seed.
        await using var h = await ReportTestHarness.StartAsync(sql);
        int RoleId(string name) => Convert.ToInt32(SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT RoleId FROM dbo.Role WHERE Name = N'{name}'").GetAwaiter().GetResult(), System.Globalization.CultureInfo.InvariantCulture);
        var pmRole = RoleId("Project Manager");
        var technicianRole = RoleId("Data Technician");
        // The Technician starter role has no Report.Run; an administrator gives it in the role editor (simulated), the same permission the Project Manager holds.
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.RolePermission (RoleId, PermissionId) SELECT {technicianRole}, PermissionId FROM dbo.Permission WHERE Code = 'Report.Run'");
        var technician = await h.Tasks.UserWithAsync(@"KE\technician", "Task.View");
        var manager = await h.Tasks.UserWithAsync(@"KE\manager", "Task.View");
        await h.Factory.GrantRoleAsync(@"KE\technician", technicianRole);
        await h.Factory.GrantRoleAsync(@"KE\manager", pmRole);
        const string parameters = """[{"name":"KIND","type":"lookup","label":"Matter","lookupKind":"matter"}]""";
        var abc = await h.AddReportAsync("SELECT :KIND AS k", parameters, roleIds: [pmRole, technicianRole]);
        var other = await h.AddReportAsync("SELECT 2 AS two", roleIds: pmRole);

        // Assigned to both: the manager runs it and has a result and a view.
        var managerRun = await RunOkAsync(manager, abc);
        (await manager.GetAsync($"/api/v1/reports/{abc}/lookups/KIND")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await manager.GetAsync(Export(managerRun))).StatusCode.ShouldBe(HttpStatusCode.OK);

        // The administrator takes the Project Manager role off: "ABC for the Technician role only".
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"DELETE dbo.RoleReport WHERE ReportId = {abc} AND RoleId = {pmRole}");
        h.Factory.InvalidateAll();

        // The Technician lists, opens and runs it, and uses its lookups, views and export.
        Names(await ReadAsync(await technician.GetAsync("/api/v1/reports"))).ShouldBe(["Report 1"]);
        (await technician.GetAsync($"/api/v1/reports/{abc}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var technicianRun = await RunOkAsync(technician, abc);
        (await technician.GetAsync(Rows(technicianRun))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await technician.GetAsync(Export(technicianRun))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await technician.GetAsync($"/api/v1/reports/{abc}/views")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await technician.GetAsync($"/api/v1/reports/{abc}/lookups/KIND")).StatusCode.ShouldBe(HttpStatusCode.OK);

        // The Project Manager still holds Report.Run (the other report works) but ABC is gone for them on every endpoint, with the answer of an id that never existed.
        (await manager.GetAsync($"/api/v1/reports/{other}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        Names(await ReadAsync(await manager.GetAsync("/api/v1/reports"))).ShouldBe(["Report 2"]);
        var reference = new Dictionary<string, string>();
        foreach (var probe in Probes)
        {
            reference[probe.Name] = await NormalizedAsync(await probe.Send(manager, 987_654, managerRun));
            (await NormalizedAsync(await probe.Send(manager, abc, managerRun))).ShouldBe(reference[probe.Name], probe.Name);
        }

        // Their own earlier result of ABC is gone with the access; the Technician's result is not theirs in any case.
        foreach (var probe in ResultProbes)
        {
            (await probe.Send(manager, abc, managerRun)).StatusCode.ShouldBe(HttpStatusCode.NotFound, probe.Name + " of their earlier result");
            (await probe.Send(manager, abc, technicianRun)).StatusCode.ShouldBe(HttpStatusCode.NotFound, probe.Name + " of the Technician's result");
        }
    }

    private static string[] Names(JsonElement list) =>
        list.GetProperty("categories").EnumerateArray().SelectMany(c => c.GetProperty("reports").EnumerateArray()).Select(r => r.GetProperty("name").GetString()!).ToArray();

    [Fact]
    public async Task The_runner_always_gets_the_current_version_never_a_newer_unreviewed_one_nor_an_older_one()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync("SELECT 1 AS one", roleIds: role);
        var hash = Convert.ToHexString(LptHub.Reports.Domain.SqlValidator.Hash("SELECT 2 AS two"));

        async Task<(string Column, int VersionNo)> RunAndDefinitionAsync()
        {
            var run = await ReadAsync(await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { })));
            var definition = await ReadAsync(await runner.GetAsync($"/api/v1/reports/{report}"));
            return (run.GetProperty("columns")[0].GetProperty("name").GetString()!, definition.GetProperty("versionNo").GetInt32());
        }

        (await RunAndDefinitionAsync()).ShouldBe(("one", 1));
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.ReportVersion (ReportId, VersionNo, SqlText, SqlHash) VALUES ({report}, 2, N'SELECT 2 AS two', 0x{hash})");
        (await RunAndDefinitionAsync()).ShouldBe(("one", 1)); // saved, not current: nobody runs it
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportDefinition SET CurrentVersionId = (SELECT ReportVersionId FROM dbo.ReportVersion WHERE ReportId = {report} AND VersionNo = 2) WHERE ReportId = {report}");
        (await RunAndDefinitionAsync()).ShouldBe(("two", 2));
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportDefinition SET CurrentVersionId = (SELECT ReportVersionId FROM dbo.ReportVersion WHERE ReportId = {report} AND VersionNo = 1) WHERE ReportId = {report}");
        (await RunAndDefinitionAsync()).ShouldBe(("one", 1));
        (await h.RunLogAsync(report)).EnumerateArray().Select(r => r.GetProperty("Status").GetString()).ShouldAllBe(s => s == "Succeeded");
    }
}
