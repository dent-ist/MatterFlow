using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>Data volume over time (epic #851, issue #871): cumulative size by the month an asset was created, disposed assets leaving, scope, units and parity with the Data tab.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetVolumeApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private PmScopeFixture _fx = null!;
    private AssetTestKit _kit = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _fx = await PmScopeFixture.BuildAsync(_factory);
        _kit = new AssetTestKit(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<JsonElement> VolumeAsync(HttpClient client, string query = "") => await OkAsync(await client.GetAsync("/api/v1/my-matters/data/volume" + query));

    private static decimal Held(JsonElement point, string unit = "GB") =>
        point.GetProperty("held").EnumerateArray().Single(u => u.GetProperty("unit").GetString() == unit).GetProperty("value").GetDecimal();

    private async Task SetSizeAsync(int typeId, string key, string unit)
    {
        var current = await OkAsync(await _fx.Admin.GetAsync($"/api/v1/asset-types/{typeId}"));
        await OkAsync(await _fx.Admin.PutAsJsonAsync($"/api/v1/asset-types/{typeId}/size-field", new { sizeFieldKey = key, sizeUnit = unit, rowVersion = current.GetProperty("rowVersion").GetString() }));
    }

    private Task MoveCreatedAsync(string name, int monthsBack) =>
        _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("UPDATE dbo.Asset SET CreatedAt = DATEADD(month, -{0}, CreatedAt) WHERE DisplayName = {1}", monthsBack, name));

    [Fact]
    public async Task Cumulative_size_by_creation_month_disposed_assets_leave_and_the_last_month_agrees_with_the_data_tab()
    {
        var type = (await _kit.CreateTypeAsync("Workspace")).GetProperty("assetTypeId").GetInt32();
        await _kit.PublishFormAsync(type, AssetTestKit.Field("size_gb", "NUMBER"));
        await SetSizeAsync(type, "size_gb", "GB");
        var m1 = _fx.Matters["few1"];
        var m2 = _fx.Matters["few2"];
        await _kit.CreateAssetAsync(m1, type, "Old", """{"size_gb":10}""");
        await _kit.CreateAssetAsync(m1, type, "Middle", """{"size_gb":5}""");
        var gone = await _kit.CreateAssetAsync(m2, type, "Gone", """{"size_gb":3}""");
        await _kit.CreateAssetAsync(m2, type, "New", """{"size_gb":2}""");
        await MoveCreatedAsync("Old", 2);
        await MoveCreatedAsync("Middle", 1);
        await MoveCreatedAsync("Gone", 1);

        var before = await VolumeAsync(_fx.PmFew, "?months=3");
        var points = before.GetProperty("points").EnumerateArray().ToList();
        points.Count.ShouldBe(3);
        points.Select(p => Held(p)).ShouldBe([10m, 18m, 20m]);
        var assetsBefore = (await OkAsync(await _fx.PmFew.GetAsync("/api/v1/my-matters/data"))).GetProperty("totals").GetProperty("assets").GetInt32();
        points.Select(p => p.GetProperty("assets").GetInt32()).Take(2).ShouldBe([1, 3]);
        points[2].GetProperty("assets").GetInt32().ShouldBe(assetsBefore); // every asset of the scope is held in the current month
        before.GetProperty("limitation").GetString().ShouldNotBeNullOrWhiteSpace();
        before.GetProperty("unitsWarning").ValueKind.ShouldBe(JsonValueKind.Null);

        // Disposing removes the asset from the line in the month of the change; held + disposed = the Data tab's total.
        var current = await OkAsync(await _fx.Admin.GetAsync($"/api/v1/assets/{gone.GetProperty("assetId").GetInt32()}"));
        await OkAsync(await _fx.Admin.PutAsJsonAsync($"/api/v1/assets/{gone.GetProperty("assetId").GetInt32()}/disposition", new { dispositionCode = "DISPOSED", note = "Destroyed", rowVersion = current.GetProperty("rowVersion").GetString() }));
        var after = (await VolumeAsync(_fx.PmFew, "?months=3")).GetProperty("points").EnumerateArray().ToList();
        after.Select(p => Held(p)).ShouldBe([10m, 18m, 17m]);
        var removed = after[2].GetProperty("removed").EnumerateArray().Single().GetProperty("value").GetDecimal();
        removed.ShouldBe(3m);
        after[2].GetProperty("assets").GetInt32().ShouldBe(assetsBefore - 1);
        var data = await OkAsync(await _fx.PmFew.GetAsync("/api/v1/my-matters/data"));
        (Held(after[2]) + removed).ShouldBe(data.GetProperty("totals").GetProperty("size").EnumerateArray().Single().GetProperty("value").GetDecimal());

        // A window shorter than the history carries the earlier months into its first point; one matter narrows the line.
        (await VolumeAsync(_fx.PmFew, "?months=1")).GetProperty("points").EnumerateArray().Select(p => Held(p)).ShouldBe([17m]);
        (await VolumeAsync(_fx.PmFew, $"?months=1&matterId={m1}")).GetProperty("points").EnumerateArray().Select(p => Held(p)).ShouldBe([15m]);
        (await VolumeAsync(_fx.PmFew, "?months=3&assetTypeId=" + type)).GetProperty("points").GetArrayLength().ShouldBe(3);
    }

    [Fact]
    public async Task Units_scope_and_bad_parameters()
    {
        var gbType = (await _kit.CreateTypeAsync("Workspace")).GetProperty("assetTypeId").GetInt32();
        var itemType = (await _kit.CreateTypeAsync("Production")).GetProperty("assetTypeId").GetInt32();
        await _kit.PublishFormAsync(gbType, AssetTestKit.Field("size_gb", "NUMBER"));
        await _kit.PublishFormAsync(itemType, AssetTestKit.Field("pages", "NUMBER"));
        await SetSizeAsync(gbType, "size_gb", "GB");
        await SetSizeAsync(itemType, "pages", "Items");
        await _kit.CreateAssetAsync(_fx.Matters["few1"], gbType, "WS", """{"size_gb":4}""");
        await _kit.CreateAssetAsync(_fx.Matters["few1"], itemType, "Prod", """{"pages":900}""");

        var both = await VolumeAsync(_fx.PmFew, "?months=2");
        both.GetProperty("units").EnumerateArray().Select(u => u.GetString()).ShouldBe(["GB", "Items"]);
        both.GetProperty("unitsWarning").GetString().ShouldNotBeNullOrWhiteSpace();
        var last = both.GetProperty("points").EnumerateArray().Last();
        Held(last).ShouldBe(4m);
        Held(last, "Items").ShouldBe(900m);

        // PmNone manages nothing: zero-filled months, not an error. Scope all needs AssignManagers.
        var none = await VolumeAsync(_fx.PmNone, "?months=2");
        none.GetProperty("points").GetArrayLength().ShouldBe(2);
        none.GetProperty("points")[1].GetProperty("assets").GetInt32().ShouldBe(0);
        (await _fx.PmFew.GetAsync("/api/v1/my-matters/data/volume?scope=all")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _fx.PmFew.GetAsync("/api/v1/my-matters/data/volume?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _fx.PmFew.GetAsync("/api/v1/my-matters/data/volume?months=0")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _fx.PmFew.GetAsync("/api/v1/my-matters/data/volume?months=61")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _fx.PmFew.GetAsync("/api/v1/my-matters/data/volume?sizeField=size_gb")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _fx.PmNoTaskView.GetAsync("/api/v1/my-matters/data/volume")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
