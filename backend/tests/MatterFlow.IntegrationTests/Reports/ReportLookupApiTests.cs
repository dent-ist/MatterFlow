using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// GET /api/v1/reports/{id}/lookups/{parameter} (owner decision 13, 2026-11-07): the pickers of a report's lookup parameters for anybody who may run the report, without the
/// picker permissions, id and label only, and a directory that never contains a sensitive matter.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportLookupApiTests(SqlServerFixture sql)
{
    private const string Parameters = """
        [{"name":"MATTER","type":"lookup","label":"Matter","lookupKind":"matter","multi":true},
         {"name":"CLIENT","type":"lookup","label":"Client","lookupKind":"client"},
         {"name":"WHO","type":"lookup","label":"Person","lookupKind":"user"},
         {"name":"POD","type":"lookup","label":"Pod","lookupKind":"pod"},
         {"name":"ROLE","type":"lookup","label":"Role","lookupKind":"role"},
         {"name":"KIND","type":"lookup","label":"Task type","lookupKind":"taskType"},
         {"name":"SINCE","type":"date","label":"Since"}]
        """;

    private const string ReportSql = "SELECT :MATTER AS m, :CLIENT AS c, :WHO AS w, :POD AS p, :ROLE AS r, :KIND AS k, :SINCE AS s";

    private sealed record Setup(ReportTestHarness H, HttpClient Runner, int ReportId, int Normal, int Sensitive, int Client);

    private static async Task<Setup> StartAsync(ReportTestHarness h)
    {
        // A person who only holds Report.Run: no Client.View, Matter.View, User.View, Pod.View or Matter.ViewSensitive.
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var reportId = await h.AddReportAsync(ReportSql, Parameters, roleIds: role);
        var normal = await h.Tasks.CreateMatterAsync("10001", "00001");
        var sensitive = await h.Tasks.CreateMatterAsync("10001", "00002");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.Matter SET IsSensitive = 1, Name = N'ZZSECRET deal' WHERE MatterId = {sensitive}; UPDATE dbo.Matter SET Name = N'Open merger' WHERE MatterId = {normal};");
        var client = Convert.ToInt32(await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT ClientId FROM dbo.Client WHERE ClientNumber = '10001'"), System.Globalization.CultureInfo.InvariantCulture);
        return new Setup(h, runner, reportId, normal, sensitive, client);
    }

    private static async Task<JsonElement> GetOkAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(HttpStatusCode.OK, body);
        return JsonDocument.Parse(body).RootElement.Clone();
    }

    private static string[] Labels(JsonElement list) => list.EnumerateArray().Select(i => i.GetProperty("label").GetString()!).ToArray();

    [Fact]
    public async Task A_person_with_only_Report_Run_searches_and_gets_ids_and_labels_for_every_kind()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var s = await StartAsync(h);
        await h.Tasks.CreatePodAsync("Review pod");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, "INSERT dbo.TaskType (Name) VALUES (N'Processing');");
        var url = $"/api/v1/reports/{s.ReportId}/lookups";

        var matters = await GetOkAsync(s.Runner, $"{url}/MATTER");
        matters.GetArrayLength().ShouldBe(1);
        matters[0].GetProperty("id").GetInt32().ShouldBe(s.Normal);
        matters[0].GetProperty("label").GetString().ShouldBe("10001-00001 Open merger");
        Labels(await GetOkAsync(s.Runner, $"{url}/MATTER?q=merg")).ShouldBe(["10001-00001 Open merger"]);
        Labels(await GetOkAsync(s.Runner, $"{url}/MATTER?q=10001-0000")).ShouldBe(["10001-00001 Open merger"]);
        Labels(await GetOkAsync(s.Runner, $"{url}/matter?q=nothing-like-this")).ShouldBeEmpty();

        var clients = await GetOkAsync(s.Runner, $"{url}/CLIENT?q=acme");
        clients[0].GetProperty("id").GetInt32().ShouldBe(s.Client);
        clients[0].GetProperty("label").GetString().ShouldStartWith("10001 Acme");

        var people = Labels(await GetOkAsync(s.Runner, $"{url}/WHO"));
        people.ShouldContain("runner");
        people.ShouldAllBe(p => !p.Contains('\\') && !p.Contains('@'));
        Labels(await GetOkAsync(s.Runner, $"{url}/POD")).ShouldBe(["Review pod"]);
        Labels(await GetOkAsync(s.Runner, $"{url}/ROLE?q=runner")).ShouldBe([@"Role KE\runner"]);
        Labels(await GetOkAsync(s.Runner, $"{url}/KIND")).ShouldBe(["Processing"]);
    }

    [Fact]
    public async Task The_answer_has_an_id_and_a_label_and_nothing_else_and_never_sql_or_an_email()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var s = await StartAsync(h);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, "UPDATE dbo.AppUser SET Email = N'secret.person@example.test'");
        var url = $"/api/v1/reports/{s.ReportId}/lookups";

        foreach (var name in new[] { "MATTER", "CLIENT", "WHO", "POD", "ROLE", "KIND" })
        {
            var response = await s.Runner.GetAsync($"{url}/{name}");
            var body = await response.Content.ReadAsStringAsync();
            response.StatusCode.ShouldBe(HttpStatusCode.OK, body);
            foreach (var item in JsonDocument.Parse(body).RootElement.EnumerateArray())
                item.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray().ShouldBe(["id", "label"], customMessage: name);
            body.ShouldNotContain("secret.person@example.test");
            body.ShouldNotContain("SELECT", Case.Insensitive);
            body.ShouldNotContain("dbo.");
        }
    }

    [Fact]
    public async Task A_sensitive_matter_is_never_searched_or_resolved_for_anybody_even_with_Matter_ViewSensitive()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var s = await StartAsync(h);
        var (viewer, viewerRole) = await h.PersonAsync(@"KE\viewer", "Report.Run", "Matter.View", "Matter.ViewSensitive", "Client.View");
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.RoleReport (RoleId, ReportId) VALUES ({viewerRole}, {s.ReportId}); INSERT dbo.RoleReport (RoleId, ReportId) SELECT RoleId, {s.ReportId} FROM dbo.Role WHERE IsSystemAdmin = 1;");
        var url = $"/api/v1/reports/{s.ReportId}/lookups/MATTER";

        foreach (var caller in new[] { s.Runner, viewer, h.Tasks.Admin })
        {
            foreach (var query in new[] { "", "?q=ZZSECRET", "?q=00002", "?q=10001-00002", "?q=deal", $"?ids={s.Sensitive}", $"?ids={s.Normal}&ids={s.Sensitive}", "?take=50" })
            {
                var response = await caller.GetAsync(url + query);
                var body = await response.Content.ReadAsStringAsync();
                response.StatusCode.ShouldBe(HttpStatusCode.OK, query + body);
                body.ShouldNotContain("ZZSECRET", Case.Sensitive);
                body.ShouldNotContain("00002", Case.Sensitive);
                JsonDocument.Parse(body).RootElement.EnumerateArray().Select(i => i.GetProperty("id").GetInt32()).ShouldNotContain(s.Sensitive, query);
            }
        }

        // The resolve of a sensitive id answers exactly like an id that does not exist.
        var hidden = await s.Runner.GetStringAsync($"{url}?ids={s.Sensitive}");
        var missing = await s.Runner.GetStringAsync($"{url}?ids=987654");
        hidden.ShouldBe(missing);
        hidden.ShouldBe("[]");
        // The client row says nothing about its matters: one client whose only matters are sensitive looks like any other client.
        var clients = await GetOkAsync(s.Runner, $"/api/v1/reports/{s.ReportId}/lookups/CLIENT");
        clients.EnumerateArray().First().EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray().ShouldBe(["id", "label"]);
    }

    [Fact]
    public async Task Only_a_report_the_person_may_run_and_only_a_lookup_parameter_of_it_answers_and_the_refusals_look_alike()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var s = await StartAsync(h);
        var (_, otherRole) = await h.PersonAsync(@"KE\other", "Report.Run");
        var notMine = await h.AddReportAsync(ReportSql, Parameters, roleIds: otherRole);
        var inactive = await h.AddReportAsync(ReportSql, Parameters, active: false, roleIds: await RoleOf(h, @"KE\runner"));
        var (nobody, _) = await h.PersonAsync(@"KE\nobody", "Matter.View", "Client.View");

        async Task<(HttpStatusCode Status, string Body)> Ask(HttpClient c, string path)
        {
            var r = await c.GetAsync(path);
            return (r.StatusCode, Normalise(await r.Content.ReadAsStringAsync()));
        }

        var unknownReport = await Ask(s.Runner, "/api/v1/reports/987654/lookups/MATTER");
        unknownReport.Status.ShouldBe(HttpStatusCode.NotFound);
        (await Ask(s.Runner, $"/api/v1/reports/{notMine}/lookups/MATTER")).ShouldBe(unknownReport);
        (await Ask(s.Runner, $"/api/v1/reports/{inactive}/lookups/MATTER")).ShouldBe(unknownReport);

        // A parameter that is not a lookup (a date), and one the report does not have, answer alike; neither is a directory.
        var notLookup = await Ask(s.Runner, $"/api/v1/reports/{s.ReportId}/lookups/SINCE");
        notLookup.Status.ShouldBe(HttpStatusCode.NotFound);
        (await Ask(s.Runner, $"/api/v1/reports/{s.ReportId}/lookups/NOPE")).ShouldBe(notLookup);
        (await Ask(s.Runner, $"/api/v1/reports/{s.ReportId}/lookups/CURRENT_USER_ID")).ShouldBe(notLookup);

        // Matter.View and Client.View do not help without Report.Run; no sign-in is 401.
        (await nobody.GetAsync($"/api/v1/reports/{s.ReportId}/lookups/MATTER")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await h.Factory.CreateClient().GetAsync($"/api/v1/reports/{s.ReportId}/lookups/MATTER")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        // Taking the assignment away ends the access at once.
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"DELETE dbo.RoleReport WHERE ReportId = {s.ReportId}");
        (await Ask(s.Runner, $"/api/v1/reports/{s.ReportId}/lookups/MATTER")).ShouldBe(unknownReport);
    }

    [Fact]
    public async Task The_page_is_small_sorted_and_the_search_text_is_a_literal()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var s = await StartAsync(h);
        await SqlServerFixture.ExecuteAsync(
            h.AppConnection,
            """
            INSERT dbo.Pod (Name) SELECT TOP (80) N'Pod ' + RIGHT(N'000' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS nvarchar(5)), 3) FROM sys.all_objects;
            INSERT dbo.Pod (Name, IsActive) VALUES (N'Pod 50% done', 1), (N'Pod under_score', 1), (N'Pod [x]', 1), (N'Closed pod', 0);
            """);
        var url = $"/api/v1/reports/{s.ReportId}/lookups/POD";

        (await GetOkAsync(s.Runner, url)).GetArrayLength().ShouldBe(25);
        (await GetOkAsync(s.Runner, $"{url}?take=500")).GetArrayLength().ShouldBe(50);
        (await GetOkAsync(s.Runner, $"{url}?take=7")).GetArrayLength().ShouldBe(7);
        (await GetOkAsync(s.Runner, $"{url}?take=0")).GetArrayLength().ShouldBe(1);
        (await GetOkAsync(s.Runner, $"{url}?take=-4")).GetArrayLength().ShouldBe(1);
        var sorted = Labels(await GetOkAsync(s.Runner, $"{url}?take=50"));
        var numbered = sorted.Where(l => l.StartsWith("Pod 0", StringComparison.Ordinal)).ToArray();
        numbered.Length.ShouldBeGreaterThan(40);
        numbered.ShouldBe(numbered.Order(StringComparer.Ordinal).ToArray());

        // % _ [ are text, not wildcards; inactive records are not offered.
        Labels(await GetOkAsync(s.Runner, $"{url}?q=%25")).ShouldBe(["Pod 50% done"]);
        Labels(await GetOkAsync(s.Runner, $"{url}?q=_")).ShouldBe(["Pod under_score"]);
        Labels(await GetOkAsync(s.Runner, $"{url}?q=[x]")).ShouldBe(["Pod [x]"]);
        Labels(await GetOkAsync(s.Runner, $"{url}?q=Closed")).ShouldBeEmpty();
        Labels(await GetOkAsync(s.Runner, $"{url}?q=' OR 1=1 --")).ShouldBeEmpty();

        (await s.Runner.GetAsync($"{url}?q={new string('a', 101)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Ids_resolve_to_labels_including_inactive_records_and_unknown_ids_are_absent()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, withLogin: false);
        var s = await StartAsync(h);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, "INSERT dbo.Pod (Name, IsActive) VALUES (N'Old pod', 0), (N'Live pod', 1);");
        var ids = (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT STRING_AGG(PodId, ',') FROM dbo.Pod"))!.ToString()!.Split(',');
        var url = $"/api/v1/reports/{s.ReportId}/lookups/POD";

        var resolved = await GetOkAsync(s.Runner, $"{url}?ids={ids[0]}&ids={ids[1]}&ids=987654&q=ignored");
        Labels(resolved).ShouldBe(["Live pod", "Old pod"]);
        resolved.EnumerateArray().Select(i => i.GetProperty("id").GetInt32()).Order().ShouldBe(ids.Select(int.Parse).Order());

        var tooMany = string.Join('&', Enumerable.Range(1, 201).Select(i => "ids=" + i));
        (await s.Runner.GetAsync($"{url}?{tooMany}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await s.Runner.GetAsync($"{url}?ids=abc")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    private static async Task<int> RoleOf(ReportTestHarness h, string account) =>
        Convert.ToInt32(await SqlServerFixture.ScalarAsync(h.AppConnection, $"SELECT RoleId FROM dbo.Role WHERE Name = N'Role {account}'"), System.Globalization.CultureInfo.InvariantCulture);

    private static string Normalise(string body)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(body)!.AsObject();
        node.Remove("traceId");
        node.Remove("instance");
        return node.ToJsonString();
    }
}
