using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// Task counts on the Client, Matter and Project lists, their sort keys and the three summary endpoints (#258, #259). Every number is checked three
/// ways in three time zones at a fixed clock (2026-10-14 16:00 UTC): against an independent reference computed from the seeded rows, against the
/// totals of the scoped Task Queue queries (the Dashboard vocabulary) and, unscoped, against the Dashboard tiles.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskCountsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Day = new(2026, 10, 14);
    private const string OpenStatuses = "status=NEW&status=IN_PROGRESS&status=ON_HOLD";

    // The task shapes every target cycles through: status, due day offset from 2026-10-14 (null = ASAP), hour of a timed due instant (UTC).
    private static readonly (string Status, int? Offset, int? Hour)[] Shapes =
    [
        ("NEW", -3, null), ("IN_PROGRESS", 0, null), ("NEW", null, null), ("ON_HOLD", 1, null), ("NEW", 2, null), ("NEW", 3, null), ("COMPLETED", -5, null),
        ("CANCELLED", -1, null), ("NEW", 0, 15), ("NEW", 0, 23), ("ON_HOLD", null, null), ("IN_PROGRESS", -1, null), ("NEW", 40, null), ("COMPLETED", null, null),
    ];

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private readonly List<CountsSeed.Row> _rows = [];
    private readonly Dictionary<int, int> _clientOfMatter = [];
    private readonly Dictionary<string, int> _ids = [];
    private HttpClient _reader = null!;
    private HttpClient _taskOnly = null!;
    private HttpClient _noClient = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);

        _ids["m1"] = world.MatterId;
        _ids["p1"] = world.ProjectId;
        _ids["p2"] = await _h.CreateProjectAsync(world.MatterId, "Archived work");
        _ids["m2"] = await _h.CreateMatterAsync("343", "13");
        _ids["p3"] = await _h.CreateProjectAsync(_ids["m2"], "Second phase");
        _ids["m3"] = await _h.CreateMatterAsync("343", "14");
        _ids["m4"] = await _h.CreateMatterAsync("500", "7");
        _ids["m5"] = await _h.CreateMatterAsync("800", "1");
        await _h.ExecuteAsync(
            "INSERT dbo.Client (ClientNumber, Name) VALUES ('00600', N'Client without matters'); "
            + "INSERT dbo.Client (ClientNumber, Name) VALUES ('00900', N'Big client'); "
            + "DECLARE @c INT = (SELECT ClientId FROM dbo.Client WHERE ClientNumber = '00900'); "
            + "INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) SELECT TOP 63 @c, '00900', RIGHT('00000' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(5)), 5), N'Big matter ' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS NVARCHAR(5)) FROM sys.all_objects; "
            + $"INSERT dbo.Project (MatterId, Name) SELECT TOP 40 {_ids["m5"]}, N'Proj ' + RIGHT('00' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(3)), 2) FROM sys.all_objects;");
        _ids["client600"] = await _h.ScalarAsync("SELECT ClientId AS [Value] FROM dbo.Client WHERE ClientNumber = '00600'");
        _ids["client900"] = await _h.ScalarAsync("SELECT ClientId AS [Value] FROM dbo.Client WHERE ClientNumber = '00900'");
        _ids["client343"] = await _h.ScalarAsync("SELECT ClientId AS [Value] FROM dbo.Client WHERE ClientNumber = '00343'");
        _ids["client500"] = await _h.ScalarAsync("SELECT ClientId AS [Value] FROM dbo.Client WHERE ClientNumber = '00500'");
        _ids["client800"] = await _h.ScalarAsync("SELECT ClientId AS [Value] FROM dbo.Client WHERE ClientNumber = '00800'");

        var big = await Pages("/api/v1/matters?clientId=" + _ids["client900"], _h.Admin);
        big.Count.ShouldBe(63);
        var bigIds = big.OrderBy(m => m.GetProperty("matterRef").GetString(), StringComparer.Ordinal).Select(m => m.GetProperty("matterId").GetInt32()).ToList();
        var projects5 = (await Pages("/api/v1/projects?matterId=" + _ids["m5"], _h.Admin)).OrderBy(p => p.GetProperty("name").GetString(), StringComparer.Ordinal).Select(p => p.GetProperty("projectId").GetInt32()).ToList();
        projects5.Count.ShouldBe(40);

        foreach (var (key, client) in new[] { ("m1", "client343"), ("m2", "client343"), ("m3", "client343"), ("m4", "client500"), ("m5", "client800") })
            _clientOfMatter[_ids[key]] = _ids[client];
        foreach (var id in bigIds)
            _clientOfMatter[id] = _ids["client900"];

        // Tasks: (matter, project, how many, which shape to start at).
        void Add(int matter, int? project, int count, int start)
        {
            for (var i = 0; i < count; i++)
            {
                var (status, offset, hour) = Shapes[(start + i) % Shapes.Length];
                var due = offset is { } o ? Day.AddDays(o) : (DateOnly?)null;
                var dueAt = hour is { } h && due is { } d ? d.ToDateTime(new TimeOnly(h, 0), DateTimeKind.Utc) : (DateTime?)null;
                _rows.Add(new CountsSeed.Row(matter, project, status, due, dueAt));
            }
        }

        Add(_ids["m1"], null, 6, 0);
        Add(_ids["m1"], _ids["p1"], 9, 3);
        Add(_ids["m1"], _ids["p2"], 4, 7);
        Add(_ids["m2"], null, 3, 2);
        Add(_ids["m2"], _ids["p3"], 14, 0);
        Add(_ids["m3"], null, 5, 1);
        Add(_ids["m4"], null, 8, 5);
        for (var k = 0; k < bigIds.Count; k++)
            Add(bigIds[k], null, (k * 7 + 3) % 11, k % Shapes.Length);
        for (var j = 0; j < projects5.Count; j++)
            Add(_ids["m5"], projects5[j], (j * 3) % 5, j);
        Add(_ids["m5"], null, 4, 9);
        await CountsSeed.InsertTasksAsync(_h, world, admin, _rows, Now);

        // An inactive Matter with open Tasks and an archived Project still count (their Tasks are real work).
        await _h.ExecuteAsync($"UPDATE dbo.Matter SET IsActive = 0 WHERE MatterId IN ({_ids["m3"]}, {bigIds[0]})");
        await _h.SetProjectActiveAsync(_ids["p2"], false);
        _ids["bigFirst"] = bigIds[0];

        _reader = await _h.UserWithAsync(@"KE\reader", "Client.View", "Matter.View", "Project.View");
        _taskOnly = await _h.UserWithAsync(@"KE\taskonly", "Client.View", "Project.View", "Task.View");
        _noClient = await _h.UserWithAsync(@"KE\noclient", "Task.View");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private sealed record Counts(int Open, int Overdue, int Asap, int OnHold, int DueSoon);

    private static DateOnly TodayIn(string zone) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(Now, TimeZoneInfo.FindSystemTimeZoneById(zone)));

    /// <summary>The reference: the counts worked out from the seeded rows with the definitions written out (addendum M: a timed due is an instant, a date-only due floats).</summary>
    private static Counts Reference(IEnumerable<CountsSeed.Row> rows, string zone)
    {
        var today = TodayIn(zone);
        var open = rows.Where(r => r.Status is "NEW" or "IN_PROGRESS" or "ON_HOLD").ToList();
        bool Overdue(CountsSeed.Row r) => r.DueAt is { } at ? at < Now : r.Due is { } d && d < today;
        return new Counts(
            open.Count,
            open.Count(Overdue),
            open.Count(r => r.Due is null),
            open.Count(r => r.Status == "ON_HOLD"),
            open.Count(r => r.Due is { } d && d <= today.AddDays(2) && !Overdue(r)));
    }

    private IEnumerable<CountsSeed.Row> ClientRows(int clientId) => _rows.Where(r => _clientOfMatter[r.MatterId] == clientId);

    private static async Task<JsonElement> GetAsync(HttpClient client, string path, string zone = "America/New_York", HttpStatusCode expected = HttpStatusCode.OK)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("X-Time-Zone", zone);
        return await OkAsync(await client.SendAsync(request), expected);
    }

    private static async Task<List<JsonElement>> Pages(string path, HttpClient client, string zone = "America/New_York")
    {
        var items = new List<JsonElement>();
        for (var page = 1; ; page++)
        {
            var body = await GetAsync(client, $"{path}{(path.Contains('?') ? '&' : '?')}pageSize=100&page={page}", zone);
            items.AddRange(body.GetProperty("items").EnumerateArray().Select(i => i.Clone()));
            if (items.Count >= body.GetProperty("total").GetInt32())
                return items;
        }
    }

    private static int? Int(JsonElement e, string name) => e.GetProperty(name).ValueKind == JsonValueKind.Null ? null : e.GetProperty(name).GetInt32();

    private static void ShouldMatch(JsonElement item, Counts expected, string what)
    {
        Int(item, "openTaskCount").ShouldBe(expected.Open, what + " openTaskCount");
        Int(item, "overdueTaskCount").ShouldBe(expected.Overdue, what + " overdueTaskCount");
    }

    private static void SummaryShouldMatch(JsonElement s, Counts expected, string what)
    {
        Int(s, "openTasks").ShouldBe(expected.Open, what + " openTasks");
        Int(s, "overdue").ShouldBe(expected.Overdue, what + " overdue");
        Int(s, "asap").ShouldBe(expected.Asap, what + " asap");
        Int(s, "onHold").ShouldBe(expected.OnHold, what + " onHold");
        Int(s, "dueSoon").ShouldBe(expected.DueSoon, what + " dueSoon");
    }

    private async Task<int> TotalAsync(string zone, string query) =>
        (await GetAsync(_h.Admin, "/api/v1/task-queue?pageSize=1&" + query, zone)).GetProperty("total").GetInt32();

    /// <summary>The scoped Task Queue totals of the five views: the same queries the Dashboard tiles drill through to, narrowed to the record.</summary>
    private async Task<Counts> QueueAsync(string zone, string scope, string dueSoonQuery) => new(
        await TotalAsync(zone, $"{OpenStatuses}&{scope}"),
        await TotalAsync(zone, $"{OpenStatuses}&overdue=true&{scope}"),
        await TotalAsync(zone, $"{OpenStatuses}&asap=true&{scope}"),
        await TotalAsync(zone, $"status=ON_HOLD&{scope}"),
        await TotalAsync(zone, $"{dueSoonQuery}&{scope}"));

    [Theory]
    [InlineData("America/New_York")]
    [InlineData("Pacific/Auckland")]
    [InlineData("America/Los_Angeles")]
    public async Task Counts_on_the_lists_gets_and_summaries_equal_the_reference_the_task_queue_and_the_dashboard(string zone)
    {
        var dashboard = await GetAsync(_h.Admin, "/api/v1/dashboard?fresh=true", zone);
        var dueSoonQuery = dashboard.GetProperty("dueSoon").GetProperty("query").GetString()!;

        // Unscoped: the Dashboard tiles are the sum over every Client.
        var clients = await Pages("/api/v1/clients", _h.Admin, zone);
        clients.Count.ShouldBe(5);
        var all = Reference(_rows, zone);
        dashboard.GetProperty("open").GetProperty("count").GetInt32().ShouldBe(all.Open);
        dashboard.GetProperty("overdue").GetProperty("count").GetInt32().ShouldBe(all.Overdue);
        dashboard.GetProperty("asapOpen").GetProperty("count").GetInt32().ShouldBe(all.Asap);
        dashboard.GetProperty("onHold").GetProperty("count").GetInt32().ShouldBe(all.OnHold);
        dashboard.GetProperty("dueSoon").GetProperty("count").GetInt32().ShouldBe(all.DueSoon);
        clients.Sum(c => Int(c, "openTaskCount")!.Value).ShouldBe(all.Open);
        clients.Sum(c => Int(c, "overdueTaskCount")!.Value).ShouldBe(all.Overdue);

        foreach (var client in clients)
        {
            var id = client.GetProperty("clientId").GetInt32();
            var expected = Reference(ClientRows(id), zone);
            ShouldMatch(client, expected, $"{zone} client list {id}");
            ShouldMatch(await GetAsync(_h.Admin, $"/api/v1/clients/{id}", zone), expected, $"{zone} client get {id}");
            var summary = await GetAsync(_h.Admin, $"/api/v1/clients/{id}/summary", zone);
            SummaryShouldMatch(summary, expected, $"{zone} client summary {id}");
            (await QueueAsync(zone, "client=" + id, dueSoonQuery)).ShouldBe(expected, $"{zone} client {id} vs the Task Queue");
        }

        var matters = await Pages("/api/v1/matters", _h.Admin, zone);
        matters.Count.ShouldBe(63 + 5);
        var queueMatters = new[] { _ids["m1"], _ids["m2"], _ids["m3"], _ids["m4"], _ids["m5"], _ids["bigFirst"] };
        foreach (var matter in matters)
        {
            var id = matter.GetProperty("matterId").GetInt32();
            var expected = Reference(_rows.Where(r => r.MatterId == id), zone);
            ShouldMatch(matter, expected, $"{zone} matter list {id}");
            if (!queueMatters.Contains(id) && id % 9 != 0)
                continue;

            ShouldMatch(await GetAsync(_h.Admin, $"/api/v1/matters/{id}", zone), expected, $"{zone} matter get {id}");
            SummaryShouldMatch(await GetAsync(_h.Admin, $"/api/v1/matters/{id}/summary", zone), expected, $"{zone} matter summary {id}");
            (await QueueAsync(zone, "matter=" + id, dueSoonQuery)).ShouldBe(expected, $"{zone} matter {id} vs the Task Queue");
        }

        var projects = await Pages("/api/v1/projects", _h.Admin, zone);
        projects.Count.ShouldBe(3 + 40);
        foreach (var project in projects)
        {
            var id = project.GetProperty("projectId").GetInt32();
            var expected = Reference(_rows.Where(r => r.ProjectId == id), zone);
            ShouldMatch(project, expected, $"{zone} project list {id}");
            ShouldMatch(await GetAsync(_h.Admin, $"/api/v1/projects/{id}", zone), expected, $"{zone} project get {id}");
            SummaryShouldMatch(await GetAsync(_h.Admin, $"/api/v1/projects/{id}/summary", zone), expected, $"{zone} project summary {id}");
            if (id % 4 == 0 || id == _ids["p2"])
                (await QueueAsync(zone, "project=" + id, dueSoonQuery)).ShouldBe(expected, $"{zone} project {id} vs the Task Queue");
        }
    }

    [Fact]
    public async Task The_zone_changes_the_overdue_and_due_soon_numbers_but_not_the_open_count()
    {
        var newYork = Reference(_rows, "America/New_York");
        var auckland = Reference(_rows, "Pacific/Auckland");
        auckland.Overdue.ShouldBeGreaterThan(newYork.Overdue);
        auckland.Open.ShouldBe(newYork.Open);
        var total = await GetAsync(_h.Admin, $"/api/v1/clients/{_ids["client343"]}/summary", "Pacific/Auckland");
        Int(total, "overdue").ShouldBe(Reference(ClientRows(_ids["client343"]), "Pacific/Auckland").Overdue);
        // A client with no matters has zero counts (not null) and an empty top list.
        var empty = await GetAsync(_h.Admin, $"/api/v1/clients/{_ids["client600"]}/summary");
        SummaryShouldMatch(empty, new Counts(0, 0, 0, 0, 0), "client without matters");
        empty.GetProperty("matterCount").GetInt32().ShouldBe(0);
        empty.GetProperty("topMatters").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task The_client_summary_lists_the_five_matters_with_the_most_open_tasks_and_counts_matters()
    {
        const string zone = "America/New_York";
        var big = _ids["client900"];
        var summary = await GetAsync(_h.Admin, $"/api/v1/clients/{big}/summary", zone);
        summary.GetProperty("matterCount").GetInt32().ShouldBe(63);
        summary.GetProperty("activeMatterCount").GetInt32().ShouldBe(62, "one of the 63 matters is inactive, and its tasks still count");

        var refs = (await Pages("/api/v1/matters?clientId=" + big, _h.Admin, zone)).ToDictionary(m => m.GetProperty("matterId").GetInt32(), m => (Ref: m.GetProperty("matterRef").GetString()!, Name: m.GetProperty("name").GetString()!, Active: m.GetProperty("isActive").GetBoolean()));
        var expected = refs
            .Select(m => (Id: m.Key, m.Value.Ref, Counts: Reference(_rows.Where(r => r.MatterId == m.Key), zone)))
            .Where(m => m.Counts.Open > 0)
            .OrderByDescending(m => m.Counts.Open).ThenByDescending(m => m.Counts.Overdue).ThenBy(m => m.Ref, StringComparer.Ordinal)
            .Take(5)
            .ToList();
        var top = summary.GetProperty("topMatters").EnumerateArray().ToList();
        top.Count.ShouldBe(5);
        top.Select(t => t.GetProperty("matterId").GetInt32()).ShouldBe(expected.Select(e => e.Id));
        for (var i = 0; i < 5; i++)
        {
            top[i].GetProperty("reference").GetString().ShouldBe(expected[i].Ref);
            top[i].GetProperty("name").GetString().ShouldBe(refs[expected[i].Id].Name);
            top[i].GetProperty("isActive").GetBoolean().ShouldBe(refs[expected[i].Id].Active);
            top[i].GetProperty("openTasks").GetInt32().ShouldBe(expected[i].Counts.Open);
            top[i].GetProperty("overdue").GetInt32().ShouldBe(expected[i].Counts.Overdue);
        }

        // The ordering has real ties to break: two of the top matters share the open count.
        top.Select(t => t.GetProperty("openTasks").GetInt32()).Distinct().Count().ShouldBeLessThan(5);
    }

    [Fact]
    public async Task The_matter_summary_counts_projects_and_assets()
    {
        var summary = await GetAsync(_h.Admin, $"/api/v1/matters/{_ids["m5"]}/summary");
        summary.GetProperty("projectCount").GetInt32().ShouldBe(40);
        summary.GetProperty("assetCount").GetInt32().ShouldBe(0);

        var type = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created);
        var typeId = type.GetProperty("assetTypeId").GetInt32();
        foreach (var name in new[] { "Laptop one", "Laptop two" })
            await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = _ids["m5"], assetTypeId = typeId, displayName = name }), HttpStatusCode.Created);

        (await GetAsync(_h.Admin, $"/api/v1/matters/{_ids["m5"]}/summary")).GetProperty("assetCount").GetInt32().ShouldBe(2);
        (await GetAsync(_h.Admin, $"/api/v1/matters/{_ids["m1"]}/summary")).GetProperty("assetCount").GetInt32().ShouldBe(0);
        (await GetAsync(_h.Admin, $"/api/v1/matters/{_ids["m1"]}/summary")).GetProperty("projectCount").GetInt32().ShouldBe(2, "archived projects count");
    }

    [Fact]
    public async Task The_project_list_carries_the_client_number_and_name()
    {
        var project = (await GetAsync(_h.Admin, $"/api/v1/projects/{_ids["p3"]}"));
        project.GetProperty("clientNumber").GetString().ShouldBe("00343");
        project.GetProperty("clientName").GetString().ShouldBe("Acme Corp 343");
        project.GetProperty("matterRef").GetString().ShouldBe("00343-00013");
        var list = (await Pages("/api/v1/projects?matterId=" + _ids["m5"], _h.Admin)).First();
        list.GetProperty("clientNumber").GetString().ShouldBe("00800");
        list.GetProperty("clientName").GetString().ShouldBe("Acme Corp 800");
    }

    // ---- sort

    private static readonly string[] CountSorts = ["openTasks", "-openTasks", "overdue", "-overdue"];

    private static List<T> Ordered<T>(IEnumerable<T> items, Func<T, int> open, Func<T, int> overdue, Func<T, string> tie, string sort)
    {
        var descending = sort.StartsWith('-');
        var key = sort.TrimStart('-') == "openTasks" ? open : overdue;
        var ordered = descending ? items.OrderByDescending(key) : items.OrderBy(key);
        return [.. ordered.ThenBy(tie, StringComparer.OrdinalIgnoreCase)];
    }

    [Theory]
    [InlineData("openTasks")]
    [InlineData("-openTasks")]
    [InlineData("overdue")]
    [InlineData("-overdue")]
    public async Task Sorting_by_the_counts_orders_every_list_with_ties_in_the_default_order_and_pages_stably(string sort)
    {
        const string zone = "America/New_York";

        var clients = (await Pages("/api/v1/clients", _h.Admin, zone)).Select(c => (Id: c.GetProperty("clientId").GetInt32(), Tie: c.GetProperty("clientNumber").GetString()!)).ToList();
        var expectedClients = Ordered(clients, c => Reference(ClientRows(c.Id), zone).Open, c => Reference(ClientRows(c.Id), zone).Overdue, c => c.Tie, sort).Select(c => c.Id).ToList();
        (await Pages($"/api/v1/clients?sort={sort}", _h.Admin, zone)).Select(c => c.GetProperty("clientId").GetInt32()).ShouldBe(expectedClients, "clients " + sort);

        var matters = (await Pages("/api/v1/matters", _h.Admin, zone)).Select(m => (Id: m.GetProperty("matterId").GetInt32(), Tie: m.GetProperty("matterRef").GetString()!)).ToList();
        var expectedMatters = Ordered(matters, m => Reference(_rows.Where(r => r.MatterId == m.Id), zone).Open, m => Reference(_rows.Where(r => r.MatterId == m.Id), zone).Overdue, m => m.Tie, sort).Select(m => m.Id).ToList();
        (await Pages($"/api/v1/matters?sort={sort}", _h.Admin, zone)).Select(m => m.GetProperty("matterId").GetInt32()).ShouldBe(expectedMatters, "matters " + sort);

        var projects = (await Pages("/api/v1/projects", _h.Admin, zone)).Select(p => (Id: p.GetProperty("projectId").GetInt32(), Tie: p.GetProperty("name").GetString()!)).ToList();
        var expectedProjects = Ordered(projects, p => Reference(_rows.Where(r => r.ProjectId == p.Id), zone).Open, p => Reference(_rows.Where(r => r.ProjectId == p.Id), zone).Overdue, p => p.Tie, sort).Select(p => p.Id).ToList();
        (await Pages($"/api/v1/projects?sort={sort}", _h.Admin, zone)).Select(p => p.GetProperty("projectId").GetInt32()).ShouldBe(expectedProjects, "projects " + sort);

        // Paging is stable: small pages walked in order are the full ordering (no row twice, none lost).
        var walked = new List<int>();
        for (var page = 1; page <= 14; page++)
        {
            var body = await GetAsync(_h.Admin, $"/api/v1/matters?sort={sort}&pageSize=5&page={page}", zone);
            walked.AddRange(body.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()));
        }

        walked.ShouldBe(expectedMatters);
    }

    [Fact]
    public async Task A_count_sort_can_be_combined_with_another_key_and_with_filters()
    {
        const string zone = "America/New_York";
        var body = await GetAsync(_h.Admin, $"/api/v1/matters?clientId={_ids["client343"]}&sort=-openTasks,name&pageSize=100", zone);
        var ids = body.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()).ToList();
        ids.ShouldBe([.. new[] { _ids["m1"], _ids["m2"], _ids["m3"] }.OrderByDescending(m => Reference(_rows.Where(r => r.MatterId == m), zone).Open).ThenBy(m => m)]);
        body.GetProperty("total").GetInt32().ShouldBe(3);

        var active = await GetAsync(_h.Admin, $"/api/v1/clients?isActive=true&sort=-overdue&pageSize=2&page=2", zone);
        active.GetProperty("total").GetInt32().ShouldBe(5);
        active.GetProperty("items").GetArrayLength().ShouldBe(2);
    }

    [Theory]
    [InlineData("/api/v1/clients?sort=open")]
    [InlineData("/api/v1/matters?sort=-openTask")]
    [InlineData("/api/v1/projects?sort=overdue,bogus")]
    public async Task An_unknown_sort_value_is_still_a_400_that_names_the_allowed_keys(string url)
    {
        var problem = await ProblemAsync(await _h.Admin.GetAsync(url), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        var error = problem.GetProperty("errors").GetProperty("sort")[0];
        error.GetProperty("code").GetString().ShouldBe("UNKNOWN_SORT");
        error.GetProperty("message").GetString()!.ShouldContain("openTasks");
    }

    // ---- permissions

    [Fact]
    public async Task Without_Task_View_the_counts_are_null_and_the_lists_summaries_and_count_sorts_still_work()
    {
        const string zone = "America/New_York";
        var clients = await Pages("/api/v1/clients", _reader, zone);
        clients.Count.ShouldBe(5);
        clients.ShouldAllBe(c => c.GetProperty("openTaskCount").ValueKind == JsonValueKind.Null && c.GetProperty("overdueTaskCount").ValueKind == JsonValueKind.Null);
        clients.ShouldAllBe(c => c.GetProperty("matterCount").ValueKind == JsonValueKind.Number);
        foreach (var kind in new[] { "matters", "projects" })
        {
            var items = await Pages($"/api/v1/{kind}", _reader, zone);
            items.ShouldAllBe(i => i.GetProperty("openTaskCount").ValueKind == JsonValueKind.Null && i.GetProperty("overdueTaskCount").ValueKind == JsonValueKind.Null);
        }

        // Never a 403, and the count sort neither leaks nor reorders: it falls back to the default order.
        var plain = (await Pages("/api/v1/clients", _reader, zone)).Select(c => c.GetProperty("clientId").GetInt32()).ToList();
        (await Pages("/api/v1/clients?sort=-openTasks", _reader, zone)).Select(c => c.GetProperty("clientId").GetInt32()).ShouldBe(plain);
        var plainMatters = (await Pages("/api/v1/matters", _reader, zone)).Select(c => c.GetProperty("matterId").GetInt32()).ToList();
        (await Pages("/api/v1/matters?sort=overdue", _reader, zone)).Select(c => c.GetProperty("matterId").GetInt32()).ShouldBe(plainMatters);
        (await _reader.GetAsync("/api/v1/projects?sort=-overdue")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var get = await GetAsync(_reader, $"/api/v1/matters/{_ids["m1"]}", zone);
        get.GetProperty("openTaskCount").ValueKind.ShouldBe(JsonValueKind.Null);
        (await GetAsync(_reader, $"/api/v1/clients/{_ids["client343"]}", zone)).GetProperty("overdueTaskCount").ValueKind.ShouldBe(JsonValueKind.Null);
        (await GetAsync(_reader, $"/api/v1/projects/{_ids["p1"]}", zone)).GetProperty("openTaskCount").ValueKind.ShouldBe(JsonValueKind.Null);

        var client = await GetAsync(_reader, $"/api/v1/clients/{_ids["client900"]}/summary", zone);
        foreach (var name in new[] { "openTasks", "overdue", "asap", "onHold", "dueSoon", "topMatters" })
            client.GetProperty(name).ValueKind.ShouldBe(JsonValueKind.Null, name);
        client.GetProperty("matterCount").GetInt32().ShouldBe(63);
        client.GetProperty("activeMatterCount").GetInt32().ShouldBe(62);

        var matter = await GetAsync(_reader, $"/api/v1/matters/{_ids["m5"]}/summary", zone);
        matter.GetProperty("openTasks").ValueKind.ShouldBe(JsonValueKind.Null);
        matter.GetProperty("projectCount").GetInt32().ShouldBe(40);
        var project = await GetAsync(_reader, $"/api/v1/projects/{_ids["p1"]}/summary", zone);
        foreach (var name in new[] { "openTasks", "overdue", "asap", "onHold", "dueSoon" })
            project.GetProperty(name).ValueKind.ShouldBe(JsonValueKind.Null, name);
    }

    [Fact]
    public async Task Without_Matter_View_the_top_matters_are_omitted_but_the_counts_are_shown()
    {
        var summary = await GetAsync(_taskOnly, $"/api/v1/clients/{_ids["client900"]}/summary");
        summary.GetProperty("topMatters").ValueKind.ShouldBe(JsonValueKind.Null);
        Int(summary, "openTasks").ShouldBe(Reference(ClientRows(_ids["client900"]), "America/New_York").Open);
        (await _taskOnly.GetAsync("/api/v1/matters")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Each_summary_needs_the_view_permission_of_its_record_and_unknown_ids_are_404()
    {
        foreach (var path in new[] { "clients/" + _ids["client343"], "matters/" + _ids["m1"], "projects/" + _ids["p1"] })
        {
            await ProblemAsync(await _noClient.GetAsync($"/api/v1/{path}/summary"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
            (await _h.Admin.GetAsync($"/api/v1/{path}/summary")).StatusCode.ShouldBe(HttpStatusCode.OK);
        }

        foreach (var kind in new[] { "clients", "matters", "projects" })
            await ProblemAsync(await _h.Admin.GetAsync($"/api/v1/{kind}/999999/summary"), HttpStatusCode.NotFound, "NOT_FOUND");
    }
}
