using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.Api.Seeding;
using LptHub.IntegrationTests.Fixtures;
using LptHub.IntegrationTests.Tasks;
using LptHub.Reports.Application.Starters;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Shouldly;

namespace LptHub.IntegrationTests.Reports;

/// <summary>
/// The starter reports (issue #724) on a real API, SQL Server and the real read-only report login: every starter is seeded active and previewed, runs with its
/// default parameter values within the limits and returns the columns its manifest declares (a schema change that breaks a starter fails here), the matter-name
/// starters leave sensitive matters out by default, and the seeder is idempotent and never overwrites an administrator's edits.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportStarterTests(SqlServerFixture sql)
{
    private static readonly StarterReportManifest Manifest = StarterReportManifest.LoadEmbedded();

    private static readonly string[] PmStarters = [.. Manifest.Reports.Where(r => r.Roles.Contains("Project Manager")).Select(r => r.Key)];

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static Task<int> CountAsync(ReportTestHarness h, string sqlText) => CountAsync(h.AppConnection, sqlText);

    private static async Task<int> CountAsync(string connection, string sqlText) =>
        Convert.ToInt32(await SqlServerFixture.ScalarAsync(connection, sqlText), System.Globalization.CultureInfo.InvariantCulture);

    private static async Task<Dictionary<string, int>> ReportIdsAsync(ReportTestHarness h)
    {
        var rows = JsonDocument.Parse(await QueryJsonAsync(h, "SELECT ReportId, Name FROM dbo.ReportDefinition FOR JSON PATH")).RootElement;
        return rows.EnumerateArray().ToDictionary(r => r.GetProperty("Name").GetString()!, r => r.GetProperty("ReportId").GetInt32());
    }

    private static async Task<string> QueryJsonAsync(ReportTestHarness h, string sqlText)
    {
        await using var connection = new Microsoft.Data.SqlClient.SqlConnection(h.AppConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sqlText;
        return await ReportTestHarness.ReadJsonAsync(command);
    }

    private static Task<HttpResponseMessage> RunAsync(HttpClient client, int reportId, object? parameters = null) =>
        client.PostAsync($"/api/v1/reports/{reportId}/runs", ReportTestHarness.Parameters(parameters ?? new { }));

    /// <summary>Runs a starter and returns the rows of the result as column name to value, after checking the run itself.</summary>
    private static async Task<List<Dictionary<string, JsonElement>>> RunRowsAsync(HttpClient client, StarterReport starter, int reportId, object? parameters = null)
    {
        var response = await RunAsync(client, reportId, parameters);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, $"{starter.Key}: {await response.Content.ReadAsStringAsync()}");
        var run = await ReadAsync(response);
        run.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("name").GetString()).ShouldBe(starter.Columns, starter.Key);
        run.GetProperty("truncated").GetBoolean().ShouldBeFalse(starter.Key);

        var page = await ReadAsync(await client.GetAsync($"/api/v1/reports/runs/{run.GetProperty("runId").GetString()}/rows?pageSize=250"));
        var names = page.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("name").GetString()!).ToList();
        names.ShouldBe(starter.Columns, starter.Key);
        var rows = page.GetProperty("rows").EnumerateArray().Select(r => names.Select((n, i) => (n, v: r[i].Clone())).ToDictionary(x => x.n, x => x.v)).ToList();
        rows.Count.ShouldBe(run.GetProperty("rowCount").GetInt32(), starter.Key);
        return rows;
    }

    private static string S(Dictionary<string, JsonElement> row, string column) => row[column].GetString()!;

    private static int N(Dictionary<string, JsonElement> row, string column) => row[column].GetInt32();

    [Fact]
    public async Task Every_starter_is_seeded_and_runs_through_the_report_login_with_its_default_values()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Seed:StarterReports:Enabled", "true"));

        // Seeded at startup: one active, previewed report with a first version per starter, the categories, a marker each, and no role assignment except the two
        // Project Manager starters (#784), which go to the starter role "Project Manager" (the one starter role that holds Report.Run, owner decision 8).
        var ids = await ReportIdsAsync(h);
        ids.Keys.Order().ShouldBe(Manifest.Reports.Select(r => r.Name).Order());
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.ReportDefinition d JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId WHERE d.IsActive = 1 AND d.LastPreviewOkVersionId = d.CurrentVersionId AND v.VersionNo = 1 AND v.ChangeNote = N'Starter report'")).ShouldBe(Manifest.Reports.Count);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.ReportCategory WHERE IsActive = 1")).ShouldBe(Manifest.Categories.Count);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.SeedMarker WHERE Name LIKE 'reports.starter.%'")).ShouldBe(Manifest.Reports.Count);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.RoleReport")).ShouldBe(PmStarters.Length);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.RoleReport rr JOIN dbo.Role r ON r.RoleId = rr.RoleId JOIN dbo.ReportDefinition d ON d.ReportId = rr.ReportId WHERE r.Name = N'Project Manager' AND d.Name IN (N'Open and overdue tasks by matter', N'Tasks completed this month')")).ShouldBe(2);

        // Data that every starter has something to say about.
        var w = await h.Tasks.CreateWorldAsync();
        var sensitiveMatter = await h.Tasks.CreateMatterAsync("343", "13");
        var t1 = TaskHarness.TaskId(await h.Tasks.CreateTaskAsync(w));
        await h.Tasks.ReachAsync(w, "COMPLETED");
        var t3 = TaskHarness.TaskId(await h.Tasks.CreateTaskAsync(w with { MatterId = sensitiveMatter }));
        await h.Tasks.UserWithAsync(@"KE\worker", "Task.View");
        await h.Tasks.UserWithAsync(@"KE\ghost", "Task.View");
        await h.Tasks.UserWithAsync(@"KE\nopod", "Task.View");
        var worker = await h.Tasks.UserIdAsync(@"KE\worker");
        var ghost = await h.Tasks.UserIdAsync(@"KE\ghost");
        var pod = await h.Tasks.CreatePodAsync("Alpha Pod", worker);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"""
            UPDATE dbo.Matter SET IsSensitive = 1 WHERE MatterId = {sensitiveMatter};
            UPDATE dbo.Task SET IsMatterSensitive = 1 WHERE MatterId = {sensitiveMatter};
            UPDATE dbo.Task SET AssignedPodId = {pod}, AssignedUserId = {worker}, DueDate = CAST(DATEADD(day, -3, SYSUTCDATETIME()) AS date), DueSortKey = DATEADD(day, -3, SYSUTCDATETIME()) WHERE TaskId = {t1};
            UPDATE dbo.Task SET AssignedUserId = {worker} WHERE StatusCode = 'COMPLETED';
            UPDATE dbo.Task SET AssignedUserId = {ghost}, DueDate = CAST(DATEADD(day, -3, SYSUTCDATETIME()) AS date), DueSortKey = DATEADD(day, -3, SYSUTCDATETIME()) WHERE TaskId = {t3};
            UPDATE dbo.AppUser SET IsActive = 0 WHERE UserId = {ghost};
            INSERT dbo.AssetType (Name) VALUES (N'Laptop');
            DECLARE @type int = SCOPE_IDENTITY();
            INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES ({w.MatterId}, @type, N'Visible laptop');
            INSERT dbo.TaskAsset (TaskId, AssetId, MatterId) SELECT {t1}, AssetId, MatterId FROM dbo.Asset WHERE DisplayName = N'Visible laptop';
            INSERT dbo.Asset (MatterId, AssetTypeId, DisplayName) VALUES ({sensitiveMatter}, @type, N'Hidden laptop');
            INSERT dbo.TaskAsset (TaskId, AssetId, MatterId) SELECT {t3}, AssetId, MatterId FROM dbo.Asset WHERE DisplayName = N'Hidden laptop';
            """);

        // A test role that holds Report.Run and every starter.
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.RoleReport (RoleId, ReportId) SELECT {role}, ReportId FROM dbo.ReportDefinition");

        var rows = new Dictionary<string, List<Dictionary<string, JsonElement>>>();
        foreach (var starter in Manifest.Reports)
            rows[starter.Key] = await RunRowsAsync(runner, starter, ids[starter.Name]);

        // Every run was a real run through the report login that finished inside its limits.
        foreach (var starter in Manifest.Reports)
        {
            var log = (await h.RunLogAsync(ids[starter.Name])).EnumerateArray().Single(e => e.GetProperty("Kind").GetString() == "Run");
            log.GetProperty("Status").GetString().ShouldBe("Succeeded", starter.Key);
            log.GetProperty("Truncated").GetBoolean().ShouldBeFalse(starter.Key);
        }

        // Content, with default values.
        rows["overdue-tasks-by-pod"].Select(r => (S(r, "Pod"), N(r, "Overdue tasks"))).ShouldBe([("(No pod)", 1), ("Alpha Pod", 1)], ignoreOrder: true);
        var perMatterRow = rows["tasks-per-matter"].ShouldHaveSingleItem();
        (N(perMatterRow, "Open tasks"), N(perMatterRow, "Completed tasks"), N(perMatterRow, "All tasks")).ShouldBe((1, 1, 2));
        rows["open-tasks-by-assignee"].Sum(r => N(r, "Open tasks")).ShouldBe(2);
        var completed = rows["tasks-completed-per-person"].ShouldHaveSingleItem();
        (N(completed, "Completed tasks"), S(completed, "Task type")).ShouldBe((1, "Data Processing"));
        rows["aging-of-open-tasks"].Sum(r => N(r, "0 to 7 days")).ShouldBe(2);
        rows["tasks-created-per-week"].Sum(r => N(r, "Tasks created")).ShouldBe(3);
        rows["users-with-no-pod-or-inactive-assignees"].Select(r => S(r, "Issue")).ShouldContain("Active user with no pod");
        rows["users-with-no-pod-or-inactive-assignees"].Count(r => S(r, "Issue") == "Inactive user with open tasks" && N(r, "Open tasks assigned") == 1).ShouldBe(1);
        var asset = rows["assets-linked-to-open-tasks"].ShouldHaveSingleItem();
        (S(asset, "Asset"), S(asset, "Disposition"), S(asset, "Task status")).ShouldBe(("Visible laptop", "Active", "New"));

        // The starters that list matter names leave the sensitive matter out by default and include it only when asked.
        var perMatter = Manifest.Reports.Single(r => r.Key == "tasks-per-matter");
        (await RunRowsAsync(runner, perMatter, ids[perMatter.Name], new { INCLUDE_SENSITIVE = true })).Count.ShouldBe(2);
        (await RunRowsAsync(runner, perMatter, ids[perMatter.Name], new { INCLUDE_SENSITIVE = false })).Count.ShouldBe(1);
        var assets = Manifest.Reports.Single(r => r.Key == "assets-linked-to-open-tasks");
        (await RunRowsAsync(runner, assets, ids[assets.Name], new { INCLUDE_SENSITIVE = true })).Select(r => S(r, "Asset")).ShouldBe(["Hidden laptop", "Visible laptop"], ignoreOrder: true);

        // The asset type choice list (a SELECT through the same engine and login) works for the person who runs the report.
        var choices = await ReadAsync(await runner.PostAsync($"/api/v1/reports/{ids[assets.Name]}/choices/ASSET_TYPES", null));
        choices.GetProperty("options").EnumerateArray().Select(o => o.GetProperty("label").GetString()).ShouldBe(["Laptop"]);

        // A person with Report.Run who is not given a starter does not see it (assignment, not role, decides).
        var (outsider, _) = await h.PersonAsync(@"KE\outsider", "Report.Run");
        (await RunAsync(outsider, ids[perMatter.Name])).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_project_manager_runs_the_two_PM_starters_and_sees_only_the_matters_they_manage_never_a_sensitive_one_they_do_not()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Seed:StarterReports:Enabled", "true"));
        var ids = await ReportIdsAsync(h);
        var overdue = Manifest.Reports.Single(r => r.Key == "open-and-overdue-tasks-by-matter");
        var completed = Manifest.Reports.Single(r => r.Key == "tasks-completed-this-month");

        // The starter role "Project Manager" holds Report.Run (script 65 / StarterRoles) and gets exactly the two PM starters; Director and the others hold neither.
        var pmRole = await CountAsync(h, "SELECT RoleId FROM dbo.Role WHERE Name = N'Project Manager'");
        (await CountAsync(h, $"SELECT COUNT(*) FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE rp.RoleId = {pmRole} AND p.Code = 'Report.Run'")).ShouldBe(1);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId JOIN dbo.Role r ON r.RoleId = rp.RoleId WHERE p.Code = 'Report.Run' AND r.Name <> N'Project Manager'")).ShouldBe(0);

        var pm = await h.Tasks.UserWithAsync(@"KE\pm", "Task.View");
        var pmId = await h.Tasks.UserIdAsync(@"KE\pm");
        await h.Factory.GrantRoleAsync(@"KE\pm", pmRole);
        var other = await h.Tasks.UserWithAsync(@"KE\othermanager", "Task.View");
        var otherId = await h.Tasks.UserIdAsync(@"KE\othermanager");
        // A person who holds Report.Run and the reports but not Matter.AssignManagers (a custom role).
        var (noAssign, noAssignRole) = await h.PersonAsync(@"KE\noassign", "Report.Run", "Task.View");
        var noAssignId = await h.Tasks.UserIdAsync(@"KE\noassign");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.RoleReport (RoleId, ReportId) SELECT {noAssignRole}, ReportId FROM dbo.ReportDefinition WHERE Name IN (N'{overdue.Name}', N'{completed.Name}')");

        // M1 managed as primary, M2 as secondary, M3 by nobody, M4 sensitive and managed by somebody else, M5 sensitive and managed by the manager.
        var w = await h.Tasks.CreateWorldAsync();
        var m1 = w.MatterId;
        var m2 = await h.Tasks.CreateMatterAsync("343", "22");
        var m3 = await h.Tasks.CreateMatterAsync("343", "23");
        var m4 = await h.Tasks.CreateMatterAsync("343", "24");
        var m5 = await h.Tasks.CreateMatterAsync("343", "25");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"""
            UPDATE dbo.Matter SET PrimaryManagerId = {pmId}, SecondaryManagerId = {otherId} WHERE MatterId = {m1};
            UPDATE dbo.Matter SET PrimaryManagerId = {otherId}, SecondaryManagerId = {pmId} WHERE MatterId = {m2};
            UPDATE dbo.Matter SET IsSensitive = 1, Name = N'Hidden four', PrimaryManagerId = {otherId} WHERE MatterId = {m4};
            UPDATE dbo.Matter SET IsSensitive = 1, Name = N'Own secret five', PrimaryManagerId = {pmId} WHERE MatterId = {m5};
            """);

        async Task<long> OverdueTaskAsync(int matter, int daysLate)
        {
            var id = TaskHarness.TaskId(await h.Tasks.CreateTaskAsync(w with { MatterId = matter }));
            await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.Task SET DueDate = CAST(DATEADD(day, -{daysLate}, SYSUTCDATETIME()) AS date), DueSortKey = DATEADD(day, -{daysLate}, SYSUTCDATETIME()) WHERE TaskId = {id}");
            return id;
        }

        await OverdueTaskAsync(m1, 5);
        _ = TaskHarness.TaskId(await h.Tasks.CreateTaskAsync(w with { MatterId = m1 })); // open, not overdue
        await OverdueTaskAsync(m2, 2);
        await OverdueTaskAsync(m3, 9);
        await OverdueTaskAsync(m4, 7);
        await OverdueTaskAsync(m5, 3);
        foreach (var matter in new[] { m1, m4, m5 })
        {
            var done = await h.Tasks.ReachAsync(w with { MatterId = matter }, "COMPLETED");
            await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.Task SET AssignedUserId = {noAssignId} WHERE TaskId = {TaskHarness.TaskId(done)}");
        }

        await SqlServerFixture.ExecuteAsync(h.AppConnection, "UPDATE dbo.Task SET IsMatterSensitive = 1 WHERE MatterId IN (SELECT MatterId FROM dbo.Matter WHERE IsSensitive = 1)");

        // The manager lists exactly the two PM starters, and no other.
        var list = await ReadAsync(await pm.GetAsync("/api/v1/reports"));
        list.GetProperty("categories").EnumerateArray().SelectMany(c => c.GetProperty("reports").EnumerateArray()).Select(r => r.GetProperty("name").GetString()).Order()
            .ShouldBe(["Open and overdue tasks by matter", "Tasks completed this month"]);
        var definition = await ReadAsync(await pm.GetAsync($"/api/v1/reports/{ids[overdue.Name]}"));
        definition.GetProperty("parameters").EnumerateArray().Select(p => p.GetProperty("name").GetString()).ShouldBe(["SCOPE"]);
        definition.GetProperty("parameters")[0].GetProperty("default").GetString().ShouldBe("mine");
        (await RunAsync(pm, ids["Overdue tasks by pod"])).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        string Matter(Dictionary<string, JsonElement> row) => S(row, "Matter number");
        string Ref(int matter) => SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT MatterRef FROM dbo.Matter WHERE MatterId = {matter}").GetAwaiter().GetResult()!.ToString()!;

        // My matters (the default): M1, M2 and the sensitive M5 they manage; never M3 (nobody) or M4 (sensitive, somebody else's).
        var mine = await RunRowsAsync(pm, overdue, ids[overdue.Name]);
        mine.Select(Matter).ShouldBe([Ref(m1), Ref(m2), Ref(m5)], ignoreOrder: true);
        var first = mine.Single(r => Matter(r) == Ref(m1));
        (N(first, "Open tasks"), N(first, "Overdue tasks"), N(first, "Oldest overdue (days)")).ShouldBe((2, 1, 5));
        S(first, "Primary manager").ShouldNotBeNullOrEmpty();
        JsonSerializer.Serialize(mine).ShouldNotContain("Hidden four");

        // All matters: the manager may assign managers, so M3 appears too, but a sensitive matter they do not manage still never does.
        var all = await RunRowsAsync(pm, overdue, ids[overdue.Name], new { SCOPE = "all" });
        all.Select(Matter).ShouldBe([Ref(m1), Ref(m2), Ref(m3), Ref(m5)], ignoreOrder: true);
        JsonSerializer.Serialize(all).ShouldNotContain("Hidden four");

        // Without Matter.AssignManagers "All" shows what "My matters" shows (the built-in value is 0), and the other manager sees their own side only.
        (await RunRowsAsync(noAssign, overdue, ids[overdue.Name], new { SCOPE = "all" })).ShouldBeEmpty();
        var otherRole = await h.Factory.CreateRoleAsync("Other manager role", "Report.Run", "Matter.AssignManagers");
        await h.Factory.GrantRoleAsync(@"KE\othermanager", otherRole);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.RoleReport (RoleId, ReportId) VALUES ({otherRole}, {ids[overdue.Name]})");
        var theirs = await RunRowsAsync(other, overdue, ids[overdue.Name]);
        theirs.Select(Matter).ShouldBe([Ref(m1), Ref(m2), Ref(m4)], ignoreOrder: true);
        JsonSerializer.Serialize(theirs).ShouldNotContain("Own secret five");

        // Tasks completed this month: counts per matter and person, same scope rules, a sensitive matter only for its own manager.
        var finished = await RunRowsAsync(pm, completed, ids[completed.Name]);
        finished.Select(Matter).ShouldBe([Ref(m1), Ref(m5)], ignoreOrder: true);
        finished.ShouldAllBe(r => N(r, "Completed tasks") == 1);
        var doneAll = await RunRowsAsync(pm, completed, ids[completed.Name], new { SCOPE = "all" });
        doneAll.Select(Matter).ShouldBe([Ref(m1), Ref(m5)], ignoreOrder: true);
        JsonSerializer.Serialize(doneAll).ShouldNotContain("Hidden four");
    }

    [Fact]
    public async Task The_seeder_is_idempotent_never_overwrites_edits_and_a_dry_run_writes_nothing()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Seed:StarterReports:Enabled", "false")); // seeding is off in the test host
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.ReportDefinition")).ShouldBe(0);

        async Task<StarterReportSeedReport> SeedAsync(bool dryRun)
        {
            await using var scope = h.Factory.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<ReportStarterSeeder>().SeedAsync(dryRun);
        }

        // An administrator already has a report with the name of one starter: it is left exactly as it is.
        var own = await h.AddReportAsync("SELECT 1 AS mine");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportDefinition SET Name = N'Overdue tasks by pod' WHERE ReportId = {own}");

        var dry = await SeedAsync(true);
        dry.Actions.ShouldAllBe(a => a.Outcome == StarterSeedOutcome.WouldCreate);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.ReportDefinition")).ShouldBe(1);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.ReportCategory")).ShouldBe(1); // only the 'Test' category of the administrator's own report
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.SeedMarker WHERE Name LIKE 'reports.starter.%'")).ShouldBe(0);

        var first = await SeedAsync(false);
        first.HasFailures.ShouldBeFalse(string.Join("; ", first.Actions.Where(a => a.Outcome == StarterSeedOutcome.Failed).Select(a => a.Key + " " + a.Detail)));
        first.Count(StarterSeedOutcome.Created).ShouldBe(Manifest.Reports.Count - 1);
        first.Actions.Single(a => a.Outcome == StarterSeedOutcome.Existing).Key.ShouldBe("overdue-tasks-by-pod");
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.ReportDefinition")).ShouldBe(Manifest.Reports.Count);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.SeedMarker WHERE Name LIKE 'reports.starter.%'")).ShouldBe(Manifest.Reports.Count);
        (await CountAsync(h, $"SELECT COUNT(*) FROM dbo.ReportVersion WHERE ReportId = {own} AND SqlText = N'SELECT 1 AS mine'")).ShouldBe(1);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.RoleReport")).ShouldBe(PmStarters.Length);
        (await h.AuditAsync(objectType: "Report")).Count.ShouldBeGreaterThan(0);

        // Edits by an administrator survive: rename, new description, deactivation.
        await SqlServerFixture.ExecuteAsync(h.AppConnection, "UPDATE dbo.ReportDefinition SET Name = N'My pod report', Description = N'edited', IsActive = 0 WHERE Name = N'Aging of open tasks'");
        var second = await SeedAsync(false);
        second.Actions.ShouldAllBe(a => a.Outcome == StarterSeedOutcome.Existing);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.ReportDefinition")).ShouldBe(Manifest.Reports.Count);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.ReportDefinition WHERE Name = N'My pod report' AND Description = N'edited' AND IsActive = 0")).ShouldBe(1);
        (await CountAsync(h, "SELECT COUNT(*) FROM dbo.ReportDefinition WHERE Name = N'Aging of open tasks'")).ShouldBe(0);

        // Administrators handle a starter like any report: deactivate and activate again through the admin API (it counts as previewed).
        var starter = (await ReportIdsAsync(h))["Tasks created per week"];
        (await h.Tasks.Admin.PostAsync($"/api/v1/report-admin/reports/{starter}/deactivate", null)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await CountAsync(h, $"SELECT COUNT(*) FROM dbo.ReportDefinition WHERE ReportId = {starter} AND IsActive = 0")).ShouldBe(1);
        var activate = await h.Tasks.Admin.PostAsync($"/api/v1/report-admin/reports/{starter}/activate", null);
        activate.StatusCode.ShouldBe(HttpStatusCode.OK, await activate.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("Development", null, true)]
    [InlineData("Production", null, false)]
    [InlineData("Staging", null, false)]
    [InlineData("Production", "true", true)]
    [InlineData("Development", "false", false)]
    public void The_seed_is_on_in_Development_and_off_elsewhere_unless_configured(string environment, string? enabled, bool expected)
    {
        var settings = new Dictionary<string, string?> { ["Seed:StarterReports:Enabled"] = enabled };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

        StarterReportsOptions.From(configuration, new FakeEnvironment(environment)).Enabled.ShouldBe(expected);
        StarterReportsOptions.From(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Seed:StarterReports:DryRun"] = "true" }).Build(), new FakeEnvironment(environment)).DryRun.ShouldBeTrue();
    }

    private sealed class FakeEnvironment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;

        public string ApplicationName { get; set; } = "LptHub.Api";

        public string ContentRootPath { get; set; } = "";

        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
