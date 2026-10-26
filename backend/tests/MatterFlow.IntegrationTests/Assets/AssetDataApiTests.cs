using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>The Data tab (epic #851, issue #869): counts by disposition, sizes per unit, warnings, scope and parity with the Assets list.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetDataApiTests(SqlServerFixture sql) : IAsyncLifetime
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

    private static JsonElement Counts(JsonElement e) => e.GetProperty("counts");

    private async Task<JsonElement> DataAsync(HttpClient client, string query = "") => await OkAsync(await client.GetAsync("/api/v1/my-matters/data" + query));

    private async Task SetAsync(int assetId, string code, string? note = null)
    {
        var current = await OkAsync(await _fx.Admin.GetAsync($"/api/v1/assets/{assetId}"));
        await OkAsync(await _fx.Admin.PutAsJsonAsync($"/api/v1/assets/{assetId}/disposition", new { dispositionCode = code, note, rowVersion = current.GetProperty("rowVersion").GetString() }));
    }

    private static async Task<int> TotalAsync(HttpClient client, string query) =>
        (await OkAsync(await client.GetAsync("/api/v1/assets?pageSize=100&" + query))).GetProperty("total").GetInt32();

    private static async Task<int[]> IdsAsync(HttpClient client, string query) =>
        [.. (await OkAsync(await client.GetAsync("/api/v1/assets?pageSize=100&" + query))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("assetId").GetInt32()).Order()];

    [Fact]
    public async Task Counts_by_disposition_per_matter_and_type_the_warnings_and_parity_with_the_assets_list()
    {
        var few1 = _fx.Assets["few1"];
        var few2 = _fx.Assets["few2"];
        await SetAsync(few1[0], "PENDING_DISPOSITION", "Matter wrapped up");
        await SetAsync(few2[0], "DISPOSED", "Destroyed");
        await OkAsync(await _fx.Admin.PostAsJsonAsync($"/api/v1/tasks/{_fx.Tasks["few1"]}/assets", new { assetId = few1[1] }), HttpStatusCode.Created);
        await SetAsync(few1[1], "INACTIVE"); // not Active, still linked to the open task of few1

        var data = await DataAsync(_fx.PmFew);
        var totals = data.GetProperty("totals");
        totals.GetProperty("assets").GetInt32().ShouldBe(4);
        totals.GetProperty("active").GetInt32().ShouldBe(1);
        totals.GetProperty("inactive").GetInt32().ShouldBe(1);
        totals.GetProperty("pendingDisposition").GetInt32().ShouldBe(1);
        totals.GetProperty("disposed").GetInt32().ShouldBe(1);

        var rows = data.GetProperty("matters").EnumerateArray().ToDictionary(m => m.GetProperty("matterId").GetInt32());
        rows.Keys.Order().ShouldBe(new[] { _fx.Matters["few1"], _fx.Matters["few2"] }.Order()); // few3 has no assets: no row
        Counts(rows[_fx.Matters["few1"]]).GetProperty("pendingDisposition").GetInt32().ShouldBe(1);
        Counts(rows[_fx.Matters["few1"]]).GetProperty("inactive").GetInt32().ShouldBe(1);
        Counts(rows[_fx.Matters["few2"]]).GetProperty("disposed").GetInt32().ShouldBe(1);
        rows[_fx.Matters["few1"]].GetProperty("query").GetString().ShouldBe($"matterId={_fx.Matters["few1"]}");
        data.GetProperty("types").GetArrayLength().ShouldBe(1);

        var warnings = data.GetProperty("warnings");
        var inactiveLinked = warnings.GetProperty("inactiveLinked");
        inactiveLinked.GetProperty("assets").GetInt32().ShouldBe(1);
        var awaiting = warnings.GetProperty("awaitingDisposition");
        awaiting.GetProperty("assets").GetInt32().ShouldBe(1);
        awaiting.GetProperty("oldestDays").GetInt32().ShouldBe(0);

        // Parity: the totals equal the Assets list of the same scope, and each warning's query lists exactly the assets counted.
        var scopeQuery = data.GetProperty("scopeQuery").GetString()!;
        scopeQuery.ShouldBe("matterManagedByMe=true");
        (await TotalAsync(_fx.PmFew, scopeQuery)).ShouldBe(totals.GetProperty("assets").GetInt32());
        (await IdsAsync(_fx.PmFew, inactiveLinked.GetProperty("query").GetString()!)).ShouldBe([few1[1]]);
        (await IdsAsync(_fx.PmFew, awaiting.GetProperty("query").GetString()!)).ShouldBe([few1[0]]);
        (await TotalAsync(_fx.PmFew, rows[_fx.Matters["few1"]].GetProperty("query").GetString()!)).ShouldBe(Counts(rows[_fx.Matters["few1"]]).GetProperty("assets").GetInt32());
        var typeQuery = data.GetProperty("types")[0].GetProperty("query").GetString()!;
        (await TotalAsync(_fx.PmFew, typeQuery)).ShouldBe(4);
    }

    [Fact]
    public async Task A_closed_matters_assets_are_counted_and_another_persons_matters_are_not()
    {
        var few2 = _fx.Assets["few2"];
        await _fx.Harness.SetMatterActiveAsync(_fx.Matters["few2"], false);

        var data = await DataAsync(_fx.PmFew);
        var row = data.GetProperty("matters").EnumerateArray().Single(m => m.GetProperty("matterId").GetInt32() == _fx.Matters["few2"]);
        row.GetProperty("matterIsActive").GetBoolean().ShouldBeFalse();
        Counts(row).GetProperty("assets").GetInt32().ShouldBe(few2.Count);

        // PmNone manages nothing: an empty scope, not an error.
        var none = await DataAsync(_fx.PmNone);
        none.GetProperty("totals").GetProperty("assets").GetInt32().ShouldBe(0);
        none.GetProperty("matters").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task Scope_all_needs_AssignManagers_and_covers_every_visible_matter_and_unknown_parameters_are_refused()
    {
        (await _fx.PmFew.GetAsync("/api/v1/my-matters/data?scope=all")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _fx.PmFew.GetAsync("/api/v1/my-matters/data?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _fx.PmFew.GetAsync("/api/v1/my-matters/data?scope=everyone")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _fx.PmNoTaskView.GetAsync("/api/v1/my-matters/data")).StatusCode.ShouldBe(HttpStatusCode.Forbidden); // Task.View is part of every My Matters page

        var all = await DataAsync(_fx.Director, "?scope=all");
        var total = (await OkAsync(await _fx.Admin.GetAsync("/api/v1/assets?pageSize=1"))).GetProperty("total").GetInt32();
        all.GetProperty("totals").GetProperty("assets").GetInt32().ShouldBe(total);
        all.GetProperty("scopeQuery").GetString().ShouldBe(string.Empty);
    }

    [Fact]
    public async Task Sizes_come_from_each_types_default_field_with_the_units_warning_when_gb_and_items_meet_and_an_override_per_type()
    {
        var gbType = (await _kit.CreateTypeAsync("Workspace")).GetProperty("assetTypeId").GetInt32();
        var itemType = (await _kit.CreateTypeAsync("Production")).GetProperty("assetTypeId").GetInt32();
        await _kit.PublishFormAsync(gbType, AssetTestKit.Field("size_gb", "NUMBER"), AssetTestKit.Field("other_mb", "NUMBER"));
        await _kit.PublishFormAsync(itemType, AssetTestKit.Field("pages", "NUMBER"));
        await SetSizeAsync(gbType, "size_gb", "GB");
        await SetSizeAsync(itemType, "pages", "Items");

        var m1 = _fx.Matters["few1"];
        var m2 = _fx.Matters["few2"];
        await _kit.CreateAssetAsync(m1, gbType, "WS 1", """{"size_gb":10,"other_mb":2048}""");
        await _kit.CreateAssetAsync(m1, gbType, "WS 2", """{"size_gb":5.5}""");
        await _kit.CreateAssetAsync(m2, gbType, "WS 3", """{"size_gb":4}""");
        await _kit.CreateAssetAsync(m2, itemType, "Prod 1", """{"pages":12000}""");
        await _kit.CreateAssetAsync(m2, gbType, "WS without size");

        // Only GB: a single unit stays as it is and there is no warning.
        var gbOnly = await DataAsync(_fx.PmFew, $"?assetTypeId={gbType}");
        gbOnly.GetProperty("unitsWarning").ValueKind.ShouldBe(JsonValueKind.Null);
        var gbTotal = gbOnly.GetProperty("totals").GetProperty("size").EnumerateArray().Single();
        gbTotal.GetProperty("unit").GetString().ShouldBe("GB");
        gbTotal.GetProperty("value").GetDecimal().ShouldBe(19.5m);
        gbTotal.GetProperty("assets").GetInt32().ShouldBe(3); // the asset without a value does not count

        // Both types: per unit, with the warning that names the types.
        var both = await DataAsync(_fx.PmFew);
        both.GetProperty("unitsWarning").GetString().ShouldBe("This result mixes units: GB (Workspace) and Items (Production). Totals are shown per unit.");
        var sizes = both.GetProperty("totals").GetProperty("size").EnumerateArray().ToDictionary(s => s.GetProperty("unit").GetString()!, s => s.GetProperty("value").GetDecimal());
        sizes["GB"].ShouldBe(19.5m);
        sizes["Items"].ShouldBe(12000m);
        var types = both.GetProperty("types").EnumerateArray().ToDictionary(t => t.GetProperty("name").GetString()!);
        types["Workspace"].GetProperty("sizeFieldKey").GetString().ShouldBe("size_gb");
        types["Workspace"].GetProperty("counts").GetProperty("assets").GetInt32().ShouldBe(4);

        // The PM overrides the size field of one type in the view: MB field of the same type.
        var overridden = await DataAsync(_fx.PmFew, $"?assetTypeId={gbType}&sizeField=other_mb&sizeUnit=MB");
        var mb = overridden.GetProperty("totals").GetProperty("size").EnumerateArray().Single();
        mb.GetProperty("unit").GetString().ShouldBe("MB");
        mb.GetProperty("value").GetDecimal().ShouldBe(2048m);

        (await _fx.PmFew.GetAsync("/api/v1/my-matters/data?sizeField=size_gb")).StatusCode.ShouldBe(HttpStatusCode.BadRequest); // needs the type
        (await _fx.PmFew.GetAsync($"/api/v1/my-matters/data?assetTypeId={gbType}&sizeField=nope&sizeUnit=GB")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _fx.PmFew.GetAsync($"/api/v1/my-matters/data?assetTypeId={gbType}&sizeField=other_mb")).StatusCode.ShouldBe(HttpStatusCode.BadRequest); // unit missing
    }

    private async Task SetSizeAsync(int typeId, string key, string unit)
    {
        var current = await OkAsync(await _fx.Admin.GetAsync($"/api/v1/asset-types/{typeId}"));
        await OkAsync(await _fx.Admin.PutAsJsonAsync($"/api/v1/asset-types/{typeId}/size-field", new { sizeFieldKey = key, sizeUnit = unit, rowVersion = current.GetProperty("rowVersion").GetString() }));
    }
}
