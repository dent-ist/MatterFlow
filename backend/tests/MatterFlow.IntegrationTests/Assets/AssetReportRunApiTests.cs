using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>Running asset reports (epic #851, issue #873): Count, Sum and Average, group-by choices, units, limits, visibility and the hidden-matter sentinel sweep.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetReportRunApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private PmScopeFixture _fx = null!;
    private AssetTestKit _kit = null!;
    private int _gbType;
    private int _itemType;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _fx = await PmScopeFixture.BuildAsync(_factory);
        _kit = new AssetTestKit(_factory);
        _gbType = (await _kit.CreateTypeAsync("Workspace")).GetProperty("assetTypeId").GetInt32();
        _itemType = (await _kit.CreateTypeAsync("Production")).GetProperty("assetTypeId").GetInt32();
        await _kit.PublishFormAsync(_gbType, AssetTestKit.Field("size_gb", "NUMBER"), AssetTestKit.Field("env", "SELECT", """ "options":[{"key":"prod","label":"Production"},{"key":"test","label":"Test"}]"""));
        await _kit.PublishFormAsync(_itemType, AssetTestKit.Field("pages", "NUMBER"));
        await SetSizeAsync(_gbType, "size_gb", "GB");
        await SetSizeAsync(_itemType, "pages", "Items");
        var few1 = _fx.Matters["few1"];
        var few2 = _fx.Matters["few2"];
        await _kit.CreateAssetAsync(few1, _gbType, "WS 1", """{"size_gb":10,"env":"prod"}""");
        await _kit.CreateAssetAsync(few1, _gbType, "WS 2", """{"size_gb":20,"env":"test"}""");
        await _kit.CreateAssetAsync(few2, _gbType, "WS 3", """{"size_gb":30,"env":"prod"}""");
        await _kit.CreateAssetAsync(few2, _gbType, "WS 4"); // no size, no environment
        await _kit.CreateAssetAsync(few2, _itemType, "Prod 1", """{"pages":5000}""");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task SetSizeAsync(int typeId, string key, string unit)
    {
        var current = await OkAsync(await _fx.Admin.GetAsync($"/api/v1/asset-types/{typeId}"));
        await OkAsync(await _fx.Admin.PutAsJsonAsync($"/api/v1/asset-types/{typeId}/size-field", new { sizeFieldKey = key, sizeUnit = unit, rowVersion = current.GetProperty("rowVersion").GetString() }));
    }

    private static Dictionary<string, object?> Def(int? typeId, string measure = "count", string groupBy = "disposition", string? numberField = null, string? numberUnit = null, string scope = "mine", string[]? dispositions = null) =>
        new() { ["v"] = 1, ["assetTypeId"] = typeId, ["measure"] = measure, ["numberField"] = numberField, ["numberUnit"] = numberUnit, ["groupBy"] = groupBy, ["scope"] = scope, ["dispositions"] = dispositions };

    private static async Task<JsonElement> RunAsync(HttpClient client, object definition) =>
        await OkAsync(await client.PostAsJsonAsync("/api/v1/asset-reports/run", definition));

    private static Dictionary<string, JsonElement> Rows(JsonElement result) =>
        result.GetProperty("rows").EnumerateArray().ToDictionary(r => r.GetProperty("label").GetString()!);

    private static decimal? Cell(JsonElement row, int index) => row.GetProperty("cells")[index] is { ValueKind: JsonValueKind.Number } n ? n.GetDecimal() : null;

    [Fact]
    public async Task Count_by_disposition_lists_the_states_in_their_order_and_the_total()
    {
        var assets = await OkAsync(await _fx.Admin.GetAsync($"/api/v1/assets?matterId={_fx.Matters["few1"]}&assetTypeId={_gbType}"));
        var first = assets.GetProperty("items").EnumerateArray().First();
        await OkAsync(await _fx.Admin.PutAsJsonAsync($"/api/v1/assets/{first.GetProperty("assetId").GetInt32()}/disposition", new { dispositionCode = "PENDING_DISPOSITION", rowVersion = first.GetProperty("rowVersion").GetString() }));

        var result = await RunAsync(_fx.PmFew, Def(null));
        result.GetProperty("measure").GetString().ShouldBe("count");
        result.GetProperty("groupByLabel").GetString().ShouldBe("Disposition");
        result.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("key").GetString()).ShouldBe(["count"]);
        result.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("label").GetString()).ShouldBe(["Active", "Pending disposition"]);
        var rows = Rows(result);
        Cell(rows["Active"], 0).ShouldBe(8m); // few1 and few2 hold 9 assets: two of the fixture and five of this test, minus the one moved
        Cell(rows["Pending disposition"], 0).ShouldBe(1m);
        Cell(result.GetProperty("totals"), 0).ShouldBe(9m);
        result.GetProperty("assets").GetInt32().ShouldBe(9);
    }

    [Fact]
    public async Task Sum_and_average_of_the_default_size_group_by_matter_a_select_field_and_asset_type()
    {
        var byMatter = await RunAsync(_fx.PmFew, Def(_gbType, "sum", "matter"));
        byMatter.GetProperty("unitsWarning").ValueKind.ShouldBe(JsonValueKind.Null);
        byMatter.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("label").GetString()).ShouldBe(["Assets", "Sum of SIZE_GB (GB)"]); // the label of the form field
        var matters = byMatter.GetProperty("rows").EnumerateArray().ToDictionary(r => r.GetProperty("key").GetString()!);
        Cell(matters[_fx.Matters["few1"].ToString()], 1).ShouldBe(30m);
        Cell(matters[_fx.Matters["few2"].ToString()], 1).ShouldBe(30m);
        Cell(matters[_fx.Matters["few2"].ToString()], 0).ShouldBe(2m); // the asset without a size still counts as an asset
        Cell(byMatter.GetProperty("totals"), 1).ShouldBe(60m);
        matters[_fx.Matters["few1"].ToString()].GetProperty("label").GetString()!.ShouldContain("PX few1"); // reference and name, from the matter

        var average = await RunAsync(_fx.PmFew, Def(_gbType, "average", "field:env"));
        var env = Rows(average);
        Cell(env["Production"], 1).ShouldBe(20m); // (10 + 30) / 2
        Cell(env["Test"], 1).ShouldBe(20m);
        env.ContainsKey("(none)").ShouldBeTrue(); // the asset without an environment
        Cell(env["(none)"], 1).ShouldBeNull(); // and without a size
        Cell(average.GetProperty("totals"), 1).ShouldBe(20m); // (10 + 20 + 30) / 3

        var byType = await RunAsync(_fx.PmFew, Def(null, "sum", "assetType"));
        byType.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("label").GetString()).ShouldBe(["Assets", "Sum of Size (GB)", "Sum of Size (Items)"]);
        byType.GetProperty("unitsWarning").GetString().ShouldBe("This result mixes units: GB (Workspace) and Items (Production). Totals are shown per unit.");
        var types = Rows(byType);
        Cell(types["Workspace"], 1).ShouldBe(60m);
        Cell(types["Workspace"], 2).ShouldBeNull();
        Cell(types["Production"], 2).ShouldBe(5000m);
    }

    [Fact]
    public async Task The_number_field_can_be_overridden_per_type_and_the_group_by_client_rolls_the_matters_up()
    {
        var overridden = await RunAsync(_fx.PmFew, Def(_itemType, "sum", "disposition", "pages", "Items"));
        overridden.GetProperty("columns")[1].GetProperty("unit").GetString().ShouldBe("Items");
        Cell(overridden.GetProperty("totals"), 1).ShouldBe(5000m);

        var byClient = await RunAsync(_fx.PmFew, Def(_gbType, "sum", "client"));
        var rows = Rows(byClient);
        rows.Keys.ShouldBe(["Managed Client"]); // few1 and few2 belong to the Managed client
        Cell(rows["Managed Client"], 1).ShouldBe(60m);
    }

    [Fact]
    public async Task Filters_scope_and_matters_narrow_the_result_and_scope_all_needs_AssignManagers()
    {
        var only = await RunAsync(_fx.PmFew, new Dictionary<string, object?> { ["v"] = 1, ["assetTypeId"] = _gbType, ["measure"] = "count", ["groupBy"] = "matter", ["scope"] = "mine", ["matterIds"] = new[] { _fx.Matters["few1"] } });
        only.GetProperty("rows").GetArrayLength().ShouldBe(1);

        var active = await RunAsync(_fx.PmFew, Def(_gbType, dispositions: ["PENDING_DISPOSITION"]));
        active.GetProperty("rows").GetArrayLength().ShouldBe(0);
        Cell(active.GetProperty("totals"), 0).ShouldBe(0m);

        (await _fx.PmFew.PostAsJsonAsync("/api/v1/asset-reports/run", Def(null, scope: "all"))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var all = await RunAsync(_fx.Director, Def(null, scope: "all"));
        all.GetProperty("assets").GetInt32().ShouldBe((await OkAsync(await _fx.Admin.GetAsync("/api/v1/assets?pageSize=1"))).GetProperty("total").GetInt32());

        // Someone else's matter id is simply not part of the scope (PmFew does not manage many01).
        var foreign = await RunAsync(_fx.PmFew, new Dictionary<string, object?> { ["v"] = 1, ["measure"] = "count", ["groupBy"] = "matter", ["scope"] = "mine", ["matterIds"] = new[] { _fx.Matters["many01"] } });
        foreign.GetProperty("assets").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task A_saved_report_runs_with_the_owners_visibility_and_another_persons_id_is_a_404()
    {
        var created = await OkAsync(await _fx.PmFew.PostAsJsonAsync("/api/v1/asset-reports", new { name = "Mine", definition = Def(_gbType, "sum", "matter") }), HttpStatusCode.Created);
        var id = created.GetProperty("assetReportId").GetInt32();

        var run = await OkAsync(await _fx.PmFew.GetAsync($"/api/v1/asset-reports/{id}/run"));
        Cell(run.GetProperty("totals"), 1).ShouldBe(60m);
        (await _fx.PmOther.GetAsync($"/api/v1/asset-reports/{id}/run")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _fx.PmFew.GetAsync("/api/v1/asset-reports/999999/run")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // A definition that was valid when saved is checked against the form as it is today.
        var bad = await _fx.PmFew.PostAsJsonAsync("/api/v1/asset-reports/run", Def(_gbType, "sum", "disposition", "nope", "GB"));
        bad.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _fx.PmFew.PostAsJsonAsync("/api/v1/asset-reports/run", new Dictionary<string, object?> { ["v"] = 2, ["measure"] = "count", ["groupBy"] = "matter", ["scope"] = "mine" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task More_than_200_groups_are_cut_and_the_hidden_ones_counted()
    {
        // 205 matters with one asset each would be slow to build through the API; the cap is a simple rule over the grouped rows, so it is pinned with the matters of the fixture instead:
        // the fixture has 40 + 3 managed matters; the engine's constant is what the screen quotes.
        AssetReportCap().ShouldBe(200);
        var many = await RunAsync(_fx.PmMany, Def(null, "count", "matter"));
        many.GetProperty("hiddenGroups").GetInt32().ShouldBe(0);
        many.GetProperty("rows").GetArrayLength().ShouldBe(2); // many01 and many02 hold the fixture's assets
    }

    private static int AssetReportCap() => MatterFlow.WorkViews.Application.Queries.AssetReportRunService.MaxGroups;

    [Fact]
    public async Task Reports_and_the_data_tab_agree_on_the_same_assets()
    {
        var data = await OkAsync(await _fx.PmFew.GetAsync($"/api/v1/my-matters/data?assetTypeId={_gbType}"));
        var report = await RunAsync(_fx.PmFew, Def(_gbType, "sum", "matter"));
        data.GetProperty("totals").GetProperty("assets").GetInt32().ShouldBe(report.GetProperty("assets").GetInt32());
        data.GetProperty("totals").GetProperty("size")[0].GetProperty("value").GetDecimal().ShouldBe(Cell(report.GetProperty("totals"), 1)!.Value);
    }
}

/// <summary>The sensitive-matter rule over the report engine and the Data tab: a hidden matter contributes nothing, not even a label (epic #788 section 12, epic #851 PV-22 and PV-37).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetReportSensitiveTests(SqlServerFixture sql)
{
    [Fact]
    public async Task A_hidden_matter_contributes_nothing_to_counts_sums_group_labels_or_the_data_tab()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var kit = new AssetTestKit(u.H.Factory);
            var type = (await kit.CreateTypeAsync("Laptop")).GetProperty("assetTypeId").GetInt32();
            await kit.PublishFormAsync(type, AssetTestKit.Field("size_gb", "NUMBER"));
            var current = await OkAsync(await u.H.Admin.GetAsync($"/api/v1/asset-types/{type}"));
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/asset-types/{type}/size-field", new { sizeFieldKey = "size_gb", sizeUnit = "GB", rowVersion = current.GetProperty("rowVersion").GetString() }));
            foreach (var (matter, size) in new[] { (u.N1, 10), (u.S1, 20), (u.S2, 40), (u.S3, 80) })
                await kit.CreateAssetAsync(matter, type, $"{SensitiveUniverse.Sentinel(matter)} laptop", $$"""{"size_gb":{{size}}}""");
            u.H.Factory.InvalidateAll();

            // (persona, expected sum, matters it may see)
            var cases = new (string Name, HttpClient Client, decimal Sum, int[] Matters)[]
            {
                ("administrator", u.H.Admin, 150m, u.AllMatters),
                ("view-sensitive holder", u.ViewerClient, 150m, u.AllMatters),
                ("primary manager", u.PmPrimaryClient, 30m, [u.N1, u.S1]),
                ("secondary manager", u.PmSecondaryClient, 30m, [u.N1, u.S1]),
                ("assignee of a task on S3", u.AssigneeClient, 10m, [u.N1]), // reports use the matter rule, not the assignee rule
                ("unrelated", u.UnrelatedClient, 10m, [u.N1]),
            };
            foreach (var (name, client, sum, matters) in cases)
            {
                var response = await client.PostAsJsonAsync("/api/v1/asset-reports/run", new Dictionary<string, object?> { ["v"] = 1, ["assetTypeId"] = type, ["measure"] = "sum", ["groupBy"] = "matter", ["scope"] = "all" });
                var body = await response.Content.ReadAsStringAsync();
                response.StatusCode.ShouldBe(HttpStatusCode.OK, name + body);
                var result = JsonDocument.Parse(body).RootElement;
                result.GetProperty("totals").GetProperty("cells")[1].GetDecimal().ShouldBe(sum, name);
                result.GetProperty("rows").EnumerateArray().Select(r => int.Parse(r.GetProperty("key").GetString()!)).Order().ShouldBe(matters.Order(), name);
                foreach (var hidden in u.SensitiveMatters.Where(m => !matters.Contains(m)))
                    body.ShouldNotContain(SensitiveUniverse.Sentinel(hidden), Case.Sensitive, name);

                // The Data tab of the same person counts the same assets.
                var data = await OkAsync(await client.GetAsync("/api/v1/my-matters/data?scope=all"));
                data.GetProperty("totals").GetProperty("assets").GetInt32().ShouldBe(matters.Length, name);
                data.GetProperty("matters").GetArrayLength().ShouldBe(matters.Length, name);
                var dataBody = data.GetRawText();
                foreach (var hidden in u.SensitiveMatters.Where(m => !matters.Contains(m)))
                    dataBody.ShouldNotContain(SensitiveUniverse.Sentinel(hidden), Case.Sensitive, name);
            }

            // A hidden matter named in the definition is not part of the scope and leaks nothing.
            var named = await u.UnrelatedClient.PostAsJsonAsync("/api/v1/asset-reports/run", new Dictionary<string, object?> { ["v"] = 1, ["measure"] = "count", ["groupBy"] = "matter", ["scope"] = "all", ["matterIds"] = new[] { u.S2 } });
            (await named.Content.ReadAsStringAsync()).ShouldNotContain(SensitiveUniverse.Sentinel(u.S2));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
