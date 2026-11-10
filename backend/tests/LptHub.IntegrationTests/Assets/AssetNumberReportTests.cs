using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Assets.AssetTestKit;

namespace LptHub.IntegrationTests.Assets;

/// <summary>The Asset Number in the asset reports (issue #1297): the group-by "assetNumber", the builder's choices, saved reports and the unchanged old ones.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetNumberReportTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private AssetTestKit _kit = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _kit = new AssetTestKit(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<int> MediaTypeAsync(bool numbered)
    {
        var type = await OkAsync(await _kit.As().PostAsJsonAsync("/api/v1/asset-types", new { name = "Media", numbering = new { enabled = numbered } }), HttpStatusCode.Created);
        var id = type.GetProperty("assetTypeId").GetInt32();
        await _kit.PublishFormAsync(id, Field("size_gb", "NUMBER", """ "validation":{"min":0}"""));
        var current = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{id}"));
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{id}/size-field", new { sizeFieldKey = "size_gb", sizeUnit = "GB", rowVersion = current.GetProperty("rowVersion").GetString() }));
        return id;
    }

    private static object Def(int typeId, string measure, string groupBy) =>
        new { v = 1, assetTypeId = typeId, measure, groupBy, scope = "all" };

    [Fact]
    public async Task Group_by_asset_number_gives_one_row_per_number_and_a_none_row_for_unnumbered_assets()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var other = await _kit.CreateMatterAsync("90003", "80009");
        var media = await MediaTypeAsync(numbered: false);
        await _kit.CreateAssetAsync(matter, media, "Old disc", """{"size_gb":5}""");

        var current = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{media}"));
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}", new { name = "Media", isActive = true, sortOrder = 10, rowVersion = current.GetProperty("rowVersion").GetString(), numbering = new { enabled = true } }));
        await _kit.CreateAssetAsync(matter, media, "Disc one", """{"size_gb":10}""");
        await _kit.CreateAssetAsync(matter, media, "Disc two", """{"size_gb":30}""");
        await _kit.CreateAssetAsync(other, media, "Disc three", """{"size_gb":20}""");

        var count = await OkAsync(await _kit.As().PostAsJsonAsync("/api/v1/asset-reports/run", Def(media, "count", "assetNumber")));
        count.GetProperty("groupByLabel").GetString().ShouldBe("Asset number");
        count.GetProperty("assets").GetInt32().ShouldBe(4);
        var rows = count.GetProperty("rows").EnumerateArray().ToDictionary(r => r.GetProperty("label").GetString()!, r => r.GetProperty("cells")[0].GetDecimal());
        rows.Keys.Order().ShouldBe(["(none)", "90003-80008_001", "90003-80008_002", "90003-80009_001"]);
        rows.Values.ShouldAllBe(v => v == 1m);

        var sum = await OkAsync(await _kit.As().PostAsJsonAsync("/api/v1/asset-reports/run", Def(media, "sum", "assetNumber")));
        sum.GetProperty("rows")[0].GetProperty("label").GetString().ShouldBe("90003-80008_002"); // largest first: 30 GB
        sum.GetProperty("rows")[0].GetProperty("cells")[1].GetDecimal().ShouldBe(30m);
        sum.GetProperty("totals").GetProperty("cells")[1].GetDecimal().ShouldBe(65m);
    }

    [Fact]
    public async Task The_builder_offers_the_choice_a_saved_report_keeps_it_and_old_saved_reports_are_unchanged()
    {
        var media = await MediaTypeAsync(numbered: true);
        var fields = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-reports/fields?assetTypeId={media}"));
        var group = fields.GetProperty("groupBy").EnumerateArray().Single(g => g.GetProperty("key").GetString() == "assetNumber");
        group.GetProperty("label").GetString().ShouldBe("Asset number");

        // An older saved report (grouped by disposition) is not touched by the new choice.
        var old = await OkAsync(await _kit.As().PostAsJsonAsync("/api/v1/asset-reports", new { name = "Old", definition = new { v = 1, assetTypeId = media, measure = "count", groupBy = "disposition", scope = "all" } }), HttpStatusCode.Created);
        old.GetProperty("definition").GetProperty("groupBy").GetString().ShouldBe("disposition");

        var saved = await OkAsync(await _kit.As().PostAsJsonAsync("/api/v1/asset-reports", new { name = "By number", definition = new { v = 1, assetTypeId = media, measure = "count", groupBy = "assetNumber", scope = "all" } }), HttpStatusCode.Created);
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        await _kit.CreateAssetAsync(matter, media, "Disc");
        var run = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-reports/{saved.GetProperty("assetReportId").GetInt32()}/run"));
        run.GetProperty("rows")[0].GetProperty("label").GetString().ShouldBe("90003-80008_001");
        var oldRun = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-reports/{old.GetProperty("assetReportId").GetInt32()}/run"));
        oldRun.GetProperty("groupBy").GetString().ShouldBe("disposition");

        var bad = await _kit.As().PostAsJsonAsync("/api/v1/asset-reports/run", Def(media, "count", "assetNumbers"));
        bad.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
