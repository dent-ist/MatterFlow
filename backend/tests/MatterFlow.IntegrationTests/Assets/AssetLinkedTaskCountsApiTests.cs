using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// <c>linkedTaskCount</c> and <c>openLinkedTaskCount</c> on the Asset list and detail, and the sorts <c>matter</c> and <c>linkedTaskCount</c> (#496):
/// the numbers agree with the linked-tasks list, are null (not 0) without <c>Task.View</c>, and cost one grouped statement whatever the page size.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetLinkedTaskCountsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private WebApplicationFactory<Program> _logged = null!;
    private readonly CommandLog _commands = new();
    private TaskHarness _h = null!;
    private World _w = null!;
    private int _typeId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        var type = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created);
        _typeId = type.GetProperty("assetTypeId").GetInt32();
        _logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(_commands);
        })));
    }

    public async Task DisposeAsync()
    {
        await _logged.DisposeAsync();
        await _factory.DisposeAsync();
    }

    private async Task<(int Id, string RowVersion)> CreateAssetAsync(int matterId, string name)
    {
        var asset = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId, assetTypeId = _typeId, displayName = name }),
            HttpStatusCode.Created);
        return (asset.GetProperty("assetId").GetInt32(), asset.GetProperty("rowVersion").GetString()!);
    }

    private async Task LinkAsync(JsonElement task, int assetId) =>
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assets", new { assetId }), HttpStatusCode.Created);

    private async Task CancelAsync(JsonElement task) =>
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/cancel", new { rowVersion = RowVersion(task), comment = "Closed for the count test" }));

    private static (int? Linked, int? Open) Counts(JsonElement item) =>
        (IntOrNull(item, "linkedTaskCount"), IntOrNull(item, "openLinkedTaskCount"));

    private static int? IntOrNull(JsonElement item, string name) =>
        item.GetProperty(name).ValueKind == JsonValueKind.Null ? null : item.GetProperty(name).GetInt32();

    private async Task<JsonElement[]> ListAsync(string query, HttpClient? client = null)
    {
        var page = await OkAsync(await (client ?? _h.Admin).GetAsync("/api/v1/assets?" + query));
        return [.. page.GetProperty("items").EnumerateArray()];
    }

    [Fact]
    public async Task The_list_and_the_detail_count_linked_tasks_and_open_ones_and_agree_with_the_linked_tasks_list()
    {
        var busy = await CreateAssetAsync(_w.MatterId, "Busy drive");
        var idle = await CreateAssetAsync(_w.MatterId, "Idle drive");
        var open1 = await _h.CreateTaskAsync(_w);
        var open2 = await _h.CreateTaskAsync(_w);
        var closed = await _h.CreateTaskAsync(_w);
        foreach (var task in new[] { open1, open2, closed })
            await LinkAsync(task, busy.Id);
        await CancelAsync(closed);

        var items = await ListAsync("name=drive&sort=displayName");
        items.Select(i => i.GetProperty("displayName").GetString()).ShouldBe(["Busy drive", "Idle drive"]);
        Counts(items[0]).ShouldBe((3, 2));
        Counts(items[1]).ShouldBe((0, 0)); // a real zero, not null

        var detail = await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/{busy.Id}"));
        Counts(detail).ShouldBe((3, 2));
        Counts(await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/{idle.Id}"))).ShouldBe((0, 0));

        var linked = await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/{busy.Id}/linked-tasks"));
        var rows = linked.GetProperty("items").EnumerateArray().ToArray();
        rows.Length.ShouldBe(3);
        rows.Count(r => r.GetProperty("statusCode").GetString() is "NEW" or "IN_PROGRESS" or "ON_HOLD").ShouldBe(2);

        // The creation and the edit responses carry the counts as well (the same read as the detail).
        var created = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = _w.MatterId, assetTypeId = _typeId, displayName = "Fresh drive" }),
            HttpStatusCode.Created);
        Counts(created).ShouldBe((0, 0));
    }

    [Fact]
    public async Task The_counts_are_null_without_Task_View_and_present_with_it()
    {
        var asset = await CreateAssetAsync(_w.MatterId, "Shared drive");
        await LinkAsync(await _h.CreateTaskAsync(_w), asset.Id);

        var assetOnly = await _h.UserWithAsync(@"KE\assetonly", "Asset.View");
        Counts((await ListAsync("name=Shared", assetOnly)).Single()).ShouldBe((null, null));
        Counts(await OkAsync(await assetOnly.GetAsync($"/api/v1/assets/{asset.Id}"))).ShouldBe((null, null));

        var both = await _h.UserWithAsync(@"KE\assetandtask", "Asset.View", "Task.View", "Matter.View");
        Counts((await ListAsync("name=Shared", both)).Single()).ShouldBe((1, 1));
        Counts(await OkAsync(await both.GetAsync($"/api/v1/assets/{asset.Id}"))).ShouldBe((1, 1));

        (await _h.Admin.GetAsync("/api/v1/assets/999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_list_sorts_by_matter_then_name_and_by_linked_task_count_and_refuses_unknown_sorts()
    {
        var second = await _h.CreateMatterAsync("343", "13");
        var inFirst = await CreateAssetAsync(_w.MatterId, "Zulu");
        var alsoFirst = await CreateAssetAsync(_w.MatterId, "Alpha");
        var inSecond = await CreateAssetAsync(second, "Beta");
        await LinkAsync(await _h.CreateTaskAsync(_w), inFirst.Id);
        await LinkAsync(await _h.CreateTaskAsync(_w), inFirst.Id);
        await LinkAsync(await _h.CreateTaskAsync(_w), alsoFirst.Id);

        string[] Names(JsonElement[] items) => [.. items.Select(i => i.GetProperty("displayName").GetString()!)];

        Names(await ListAsync("sort=matter&pageSize=10")).ShouldBe(["Alpha", "Zulu", "Beta"]); // 00343-00012 (by name) then 00343-00013
        Names(await ListAsync("sort=-matter&pageSize=10")).ShouldBe(["Beta", "Alpha", "Zulu"]); // the reference descends, the name inside it still ascends
        Names(await ListAsync("sort=-linkedTaskCount&pageSize=10")).ShouldBe(["Zulu", "Alpha", "Beta"]);
        Names(await ListAsync("sort=linkedTaskCount&pageSize=10")).ShouldBe(["Beta", "Alpha", "Zulu"]);
        Names(await ListAsync("sort=matter,-linkedTaskCount&pageSize=10")).ShouldBe(["Zulu", "Alpha", "Beta"]);

        // Without Task.View the count sort is a constant: accepted, and the order falls back to the tie-break (the id).
        var assetOnly = await _h.UserWithAsync(@"KE\sortonly", "Asset.View");
        (await ListAsync("sort=-linkedTaskCount&pageSize=10", assetOnly)).Length.ShouldBe(3);

        foreach (var bad in new[] { "sort=nope", "sort=openLinkedTaskCount", "sort=-matterName" })
        {
            var response = await _h.Admin.GetAsync("/api/v1/assets?" + bad);
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, bad);
        }

        inSecond.Id.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task One_asset_with_nineteen_links_reports_nineteen()
    {
        var asset = await CreateAssetAsync(_w.MatterId, "Nineteen");
        for (var i = 0; i < 19; i++)
            await LinkAsync(await _h.CreateTaskAsync(_w), asset.Id);

        Counts((await ListAsync("name=Nineteen")).Single()).ShouldBe((19, 19));
        Counts(await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/{asset.Id}"))).ShouldBe((19, 19));
    }

    [Fact]
    public async Task The_counts_cost_one_grouped_statement_whatever_the_page_size()
    {
        var first = await CreateAssetAsync(_w.MatterId, "Scale 000");
        for (var i = 1; i < 100; i++)
            await CreateAssetAsync(_w.MatterId, $"Scale {i:000}");
        await LinkAsync(await _h.CreateTaskAsync(_w), first.Id);

        var http = _logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        async Task<(int Statements, int Grouped)> MeasureAsync(string url)
        {
            await OkAsync(await http.GetAsync(url)); // warm up
            _commands.Clear();
            var page = await OkAsync(await http.GetAsync(url));
            page.GetProperty("items").GetArrayLength().ShouldBeGreaterThan(0);
            var statements = _commands.Snapshot();
            return (statements.Count, statements.Count(c => c.Contains("GROUP BY", StringComparison.OrdinalIgnoreCase) && c.Contains("[AssetId]", StringComparison.Ordinal)));
        }

        var small = await MeasureAsync("/api/v1/assets?name=Scale&pageSize=25&sort=displayName");
        var large = await MeasureAsync("/api/v1/assets?name=Scale&pageSize=100&sort=displayName");
        var bySort = await MeasureAsync("/api/v1/assets?name=Scale&pageSize=100&sort=-linkedTaskCount");

        small.Grouped.ShouldBe(1);
        large.Grouped.ShouldBe(1);
        large.Statements.ShouldBe(small.Statements, "the same number of statements for 25 and for 100 rows");
        bySort.Grouped.ShouldBe(1); // the count sort joins the grouped counts into the page statement instead of asking again
        bySort.Statements.ShouldBeLessThanOrEqualTo(small.Statements + 1);
    }

    private sealed class CommandLog : ILoggerProvider
    {
        private readonly object _gate = new();
        private readonly List<string> _statements = [];

        public ILogger CreateLogger(string categoryName) => categoryName == "Microsoft.EntityFrameworkCore.Database.Command" ? new Capture(this) : new Silent();

        public void Clear()
        {
            lock (_gate)
                _statements.Clear();
        }

        public List<string> Snapshot()
        {
            lock (_gate)
                return [.. _statements];
        }

        public void Dispose()
        {
        }

        private void Add(string message)
        {
            lock (_gate)
                _statements.Add(message);
        }

        private sealed class Capture(CommandLog owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => logLevel == LogLevel.Information;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                var message = formatter(state, exception);
                if (message.StartsWith("Executed DbCommand", StringComparison.Ordinal))
                    owner.Add(message);
            }
        }

        private sealed class Silent : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => false;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
            }
        }
    }
}
