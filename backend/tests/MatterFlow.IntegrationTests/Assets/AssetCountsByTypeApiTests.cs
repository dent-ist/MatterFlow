using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>GET /assets/counts-by-type?matterId= (MD-03, #1004): the Summary tiles. Types with assets only, largest first, active and retired counted apart, a missing or hidden matter is a 404.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetCountsByTypeApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<int> TypeAsync(string name) =>
        (await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();

    private async Task<JsonElement> AssetAsync(int typeId, string name) =>
        await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = _w.MatterId, assetTypeId = typeId, displayName = name }), HttpStatusCode.Created);

    [Fact]
    public async Task Counts_each_type_largest_first_and_leaves_out_types_without_assets()
    {
        var laptop = await TypeAsync("Laptop");
        var phone = await TypeAsync("Phone");
        await TypeAsync("Unused");
        await AssetAsync(laptop, "L1");
        await AssetAsync(phone, "P1");
        await AssetAsync(phone, "P2");
        var retired = await AssetAsync(phone, "P3");
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/assets/{retired.GetProperty("assetId").GetInt32()}/active", new { isActive = false, rowVersion = retired.GetProperty("rowVersion").GetString() }));

        var body = await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/counts-by-type?matterId={_w.MatterId}"));
        var rows = body.EnumerateArray().ToList();
        rows.Select(r => r.GetProperty("assetTypeName").GetString()).ShouldBe(["Phone", "Laptop"]);
        (rows[0].GetProperty("count").GetInt32(), rows[0].GetProperty("retiredCount").GetInt32()).ShouldBe((2, 1));
        (rows[1].GetProperty("count").GetInt32(), rows[1].GetProperty("retiredCount").GetInt32()).ShouldBe((1, 0));
    }

    [Fact]
    public async Task A_matter_without_assets_gives_an_empty_list_and_an_unknown_matter_is_404()
    {
        (await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/counts-by-type?matterId={_w.MatterId}"))).GetArrayLength().ShouldBe(0);
        (await _h.Admin.GetAsync("/api/v1/assets/counts-by-type?matterId=9999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Without_Asset_View_the_request_is_forbidden()
    {
        var noAssets = await _h.UserWithAsync(@"KE\noassets", "Matter.View");
        (await noAssets.GetAsync($"/api/v1/assets/counts-by-type?matterId={_w.MatterId}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
