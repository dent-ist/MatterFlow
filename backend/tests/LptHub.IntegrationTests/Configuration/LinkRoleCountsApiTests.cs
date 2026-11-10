using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Configuration;

/// <summary>
/// <c>linkCount</c> on the asset link roles (#639): the number of task-asset links that use each role, so the page can offer Delete only for a role
/// nobody uses; null (not 0) without <c>Task.View</c> or <c>Asset.View</c>; the same number of statements for 4 and 80 roles; reads and writes keep
/// their permissions.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class LinkRoleCountsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private Dictionary<string, int> _roles = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var type = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created);
        var typeId = type.GetProperty("assetTypeId").GetInt32();
        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/asset-link-roles"));
        _roles = list.EnumerateArray().ToDictionary(r => r.GetProperty("name").GetString()!, r => r.GetProperty("id").GetInt32());

        // Source: 2 links (two tasks), Destination: 1, the others: none.
        var assets = new List<int>();
        for (var i = 0; i < 3; i++)
        {
            var asset = await OkAsync(
                await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = world.MatterId, assetTypeId = typeId, displayName = $"Laptop {i}" }),
                HttpStatusCode.Created);
            assets.Add(asset.GetProperty("assetId").GetInt32());
        }

        var t1 = TaskId(await _h.CreateTaskAsync(world));
        var t2 = TaskId(await _h.CreateTaskAsync(world));
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{t1}/assets", new { assetId = assets[0], assetLinkRoleId = _roles["Source"] }), HttpStatusCode.Created);
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{t2}/assets", new { assetId = assets[0], assetLinkRoleId = _roles["Source"] }), HttpStatusCode.Created);
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{t1}/assets", new { assetId = assets[1], assetLinkRoleId = _roles["Destination"] }), HttpStatusCode.Created);
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{t1}/assets", new { assetId = assets[2] }), HttpStatusCode.Created); // no role at all
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static int? Count(JsonElement item) => item.GetProperty("linkCount").ValueKind == JsonValueKind.Null ? null : item.GetProperty("linkCount").GetInt32();

    private static JsonElement ByName(JsonElement list, string name) => list.EnumerateArray().Single(r => r.GetProperty("name").GetString() == name);

    private async Task<HttpClient> UserWithAsync(string user, params string[] permissions)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Role " + user, permissions));
        return client;
    }

    [Fact]
    public async Task Each_role_carries_the_number_of_links_that_use_it()
    {
        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/asset-link-roles"));

        Count(ByName(list, "Source")).ShouldBe(2);
        Count(ByName(list, "Destination")).ShouldBe(1);
        Count(ByName(list, "Subject")).ShouldBe(0);
        Count(ByName(list, "Result")).ShouldBe(0);
    }

    [Fact]
    public async Task Create_update_and_reorder_responses_carry_the_count_too()
    {
        var created = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = "Evidence" }), HttpStatusCode.Created);
        Count(created).ShouldBe(0);

        var source = ByName(await OkAsync(await _h.Admin.GetAsync("/api/v1/asset-link-roles")), "Source");
        var renamed = await OkAsync(await _h.Admin.PutAsJsonAsync(
            $"/api/v1/asset-link-roles/{_roles["Source"]}",
            new { name = "Origin", isActive = true, rowVersion = source.GetProperty("rowVersion").GetString() }));
        Count(renamed).ShouldBe(2);

        var all = (await OkAsync(await _h.Admin.GetAsync("/api/v1/asset-link-roles"))).EnumerateArray().Select(r => r.GetProperty("id").GetInt32()).Reverse().ToArray();
        var reordered = await OkAsync(await _h.Admin.PutAsJsonAsync("/api/v1/asset-link-roles/order", new { ids = all }));
        Count(ByName(reordered, "Origin")).ShouldBe(2);
    }

    [Fact]
    public async Task The_count_is_null_not_zero_without_Task_View_or_Asset_View()
    {
        var manageOnly = await UserWithAsync(@"KE\linkmanager", "AssetType.Manage");
        var noAssets = await UserWithAsync(@"KE\linktasks", "AssetType.Manage", "Task.View");
        var noTasks = await UserWithAsync(@"KE\linkassets", "AssetType.Manage", "Asset.View");
        var both = await UserWithAsync(@"KE\linkboth", "AssetType.Manage", "Task.View", "Asset.View");

        foreach (var client in new[] { manageOnly, noAssets, noTasks })
        {
            var list = await OkAsync(await client.GetAsync("/api/v1/asset-link-roles"));
            list.EnumerateArray().ShouldAllBe(r => r.GetProperty("linkCount").ValueKind == JsonValueKind.Null);
        }

        Count(ByName(await OkAsync(await both.GetAsync("/api/v1/asset-link-roles")), "Source")).ShouldBe(2);
        // Task.View and Asset.View together read the list and the numbers (the picker of a task needs the roles); Asset.View alone reads nothing.
        var viewer = await UserWithAsync(@"KE\linkviewer", "Task.View", "Asset.View");
        Count(ByName(await OkAsync(await viewer.GetAsync("/api/v1/asset-link-roles")), "Destination")).ShouldBe(1);
        var assetsOnly = await UserWithAsync(@"KE\linkassetsonly", "Asset.View");
        (await assetsOnly.GetAsync("/api/v1/asset-link-roles")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_number_of_statements_does_not_grow_with_the_number_of_roles()
    {
        var commands = new CommandLog();
        using var logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(commands);
        })));
        var http = logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        async Task<(int Statements, int Grouped, int Rows)> MeasureAsync()
        {
            await OkAsync(await http.GetAsync("/api/v1/asset-link-roles"));
            commands.Clear();
            var list = await OkAsync(await http.GetAsync("/api/v1/asset-link-roles"));
            var statements = commands.Snapshot();
            return (statements.Count, statements.Count(c => c.Contains("GROUP BY", StringComparison.OrdinalIgnoreCase) && c.Contains("[AssetLinkRoleId]", StringComparison.Ordinal)), list.GetArrayLength());
        }

        var few = await MeasureAsync();
        for (var i = 0; i < 76; i++)
            await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = $"Bulk {i:D2}" }), HttpStatusCode.Created);
        var many = await MeasureAsync();

        few.Rows.ShouldBe(4);
        many.Rows.ShouldBe(80);
        many.Statements.ShouldBe(few.Statements, "a fixed number of statements, none per role");
        many.Grouped.ShouldBe(1);
        few.Grouped.ShouldBe(1);
    }
}
