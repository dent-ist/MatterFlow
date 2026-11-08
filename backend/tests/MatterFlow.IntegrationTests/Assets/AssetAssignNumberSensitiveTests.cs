using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>The assign-number action and the numbering counts under the sensitive-matter rule (epic #788, issue #1297).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetAssignNumberSensitiveTests(SqlServerFixture sql)
{
    [Fact]
    public async Task A_hidden_matters_asset_cannot_be_numbered_by_someone_who_may_not_see_it_and_the_counts_leave_it_out()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;
        var type = (await OkAsync(await admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Media" }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();
        async Task<JsonElement> AssetOn(int matter) => await OkAsync(await admin.PostAsJsonAsync("/api/v1/assets", new { matterId = matter, assetTypeId = type, displayName = "Disc " + matter }), HttpStatusCode.Created);
        var normal = await AssetOn(u.N1);
        var hidden = await AssetOn(u.S1);

        var current = await OkAsync(await admin.GetAsync($"/api/v1/asset-types/{type}"));
        await OkAsync(await admin.PutAsJsonAsync($"/api/v1/asset-types/{type}", new { name = "Media", isActive = true, sortOrder = 1, rowVersion = current.GetProperty("rowVersion").GetString(), numbering = new { enabled = true } }));
        var role = await u.H.Factory.CreateRoleAsync("Type reader", "AssetType.Manage");
        await u.H.Factory.GrantRoleAsync(@"KE\unrelated", role);

        // The unrelated persona (Asset.Edit, no access to S1): the hidden asset is a 404, byte for byte like a missing one, and nothing changes.
        var hiddenId = hidden.GetProperty("assetId").GetInt32();
        var denied = await u.UnrelatedClient.PostAsJsonAsync($"/api/v1/assets/{hiddenId}/assign-number", new { rowVersion = hidden.GetProperty("rowVersion").GetString() });
        await ProblemAsync(denied, HttpStatusCode.NotFound, "NOT_FOUND");
        var missing = await u.UnrelatedClient.PostAsJsonAsync("/api/v1/assets/999999/assign-number", new { rowVersion = hidden.GetProperty("rowVersion").GetString() });
        (await missing.Content.ReadAsStringAsync()).Replace("999999", "X").Length.ShouldBe((await denied.Content.ReadAsStringAsync()).Replace(hiddenId.ToString(), "X").Length);
        (await OkAsync(await admin.GetAsync($"/api/v1/assets/{hiddenId}"))).GetProperty("assetNumber").ValueKind.ShouldBe(JsonValueKind.Null);

        // Regression: a caller who is not "see all" really saves a plain change to an asset of a matter they see while the rule is on (the visible-matters filter used to return an untracked entity).
        var renamed = await OkAsync(await u.UnrelatedClient.PutAsJsonAsync($"/api/v1/assets/{normal.GetProperty("assetId").GetInt32()}", new { displayName = "Renamed by persona", rowVersion = normal.GetProperty("rowVersion").GetString() }));
        renamed.GetProperty("displayName").GetString().ShouldBe("Renamed by persona");
        normal = renamed;

        // Their own visible asset can be numbered; the counts and the counter list show only what they may see.
        var ok = await OkAsync(await u.UnrelatedClient.PostAsJsonAsync($"/api/v1/assets/{normal.GetProperty("assetId").GetInt32()}/assign-number", new { rowVersion = normal.GetProperty("rowVersion").GetString() }));
        ok.GetProperty("assetNumber").GetString().ShouldBe("00343-00012_001");
        var seen = (await OkAsync(await u.UnrelatedClient.GetAsync($"/api/v1/asset-types/{type}"))).GetProperty("numbering");
        seen.GetProperty("numberedAssetCount").GetInt32().ShouldBe(1);
        seen.GetProperty("unnumberedAssetCount").GetInt32().ShouldBe(0); // the hidden unnumbered asset is not counted
        seen.GetProperty("example").GetProperty("longestCmNumber").GetString()!.ShouldNotContain("00021");
        var all = (await OkAsync(await admin.GetAsync($"/api/v1/asset-types/{type}"))).GetProperty("numbering");
        all.GetProperty("unnumberedAssetCount").GetInt32().ShouldBe(1);
        var counters = await OkAsync(await u.UnrelatedClient.GetAsync($"/api/v1/asset-types/{type}/numbering/counters"));
        counters.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterRef").GetString()).ShouldBe(["00343-00012"]);

        // The person who may see the sensitive matter (primary manager) can number its asset.
        var viewer = await OkAsync(await u.ViewerClient.PostAsJsonAsync($"/api/v1/assets/{hiddenId}/assign-number", new { rowVersion = hidden.GetProperty("rowVersion").GetString() }));
        viewer.GetProperty("assetNumber").GetString().ShouldBe("00343-00021_001");
    }
}
