using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Assets.AssetTestKit;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// The explicit "assign number" action (issue #1297): the only way an old or unnumbered asset gets a number. Atomic with the shared counter, refused when numbered or when the type numbers nothing,
/// audited, permissioned and sensitive-matter safe; plus the counts and flags the screens read (numbered and unnumbered counts, the type flag on assets, the longest CM Number).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetAssignNumberTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private AssetTestKit _kit = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _kit = new AssetTestKit(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<int> TypeAsync(bool numbered, string name = "Media")
    {
        var type = await OkAsync(await _kit.As().PostAsJsonAsync("/api/v1/asset-types", new { name, numbering = new { enabled = numbered } }), HttpStatusCode.Created);
        return type.GetProperty("assetTypeId").GetInt32();
    }

    private async Task SetNumberingAsync(HttpClient admin, int typeId, bool enabled)
    {
        var current = await OkAsync(await admin.GetAsync($"/api/v1/asset-types/{typeId}"));
        await OkAsync(await admin.PutAsJsonAsync($"/api/v1/asset-types/{typeId}", new { name = current.GetProperty("name").GetString(), isActive = true, sortOrder = 10, rowVersion = current.GetProperty("rowVersion").GetString(), numbering = new { enabled } }));
    }

    private static Task<HttpResponseMessage> AssignAsync(HttpClient client, int assetId, string rowVersion) =>
        client.PostAsJsonAsync($"/api/v1/assets/{assetId}/assign-number", new { rowVersion });

    [Fact]
    public async Task An_unnumbered_asset_gets_the_next_number_only_through_the_explicit_action()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var type = await TypeAsync(numbered: false);
        var old = await _kit.CreateAssetAsync(matter, type, "Old disc");
        await SetNumberingAsync(_kit.As(), type, true);

        (await _kit.GetAssetAsync(old.GetProperty("assetId").GetInt32())).GetProperty("assetNumber").ValueKind.ShouldBe(JsonValueKind.Null);
        var read = await _kit.GetAssetAsync(old.GetProperty("assetId").GetInt32());
        read.GetProperty("assetTypeNumberingEnabled").GetBoolean().ShouldBeTrue();

        var assigned = await OkAsync(await AssignAsync(_kit.As(), old.GetProperty("assetId").GetInt32(), read.GetProperty("rowVersion").GetString()!));
        assigned.GetProperty("assetNumber").GetString().ShouldBe("90003-80008_001");
        assigned.GetProperty("rowVersion").GetString().ShouldNotBe(read.GetProperty("rowVersion").GetString());

        // The counter moved: the next new asset continues, and the number is read-only from now on.
        (await _kit.CreateAssetAsync(matter, type, "New disc")).GetProperty("assetNumber").GetString().ShouldBe("90003-80008_002");
        var again = await AssignAsync(_kit.As(), old.GetProperty("assetId").GetInt32(), assigned.GetProperty("rowVersion").GetString()!);
        await ProblemAsync(again, HttpStatusCode.Conflict, "ASSET_ALREADY_NUMBERED");
        var changed = await _kit.As().PutAsync($"/api/v1/assets/{old.GetProperty("assetId").GetInt32()}", Json($$"""{"displayName":"Old disc","assetNumber":"X","rowVersion":"{{assigned.GetProperty("rowVersion").GetString()}}"}"""));
        await ProblemAsync(changed, HttpStatusCode.Conflict, "IMMUTABLE_FIELD");

        var list = await OkAsync(await _kit.As().GetAsync($"/api/v1/assets?matterId={matter}"));
        list.GetProperty("items").EnumerateArray().ShouldAllBe(i => i.GetProperty("assetTypeNumberingEnabled").GetBoolean());
    }

    [Fact]
    public async Task The_action_is_refused_when_the_type_numbers_nothing_the_version_is_stale_or_the_asset_is_missing()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var type = await TypeAsync(numbered: false);
        var asset = await _kit.CreateAssetAsync(matter, type, "Disc");
        var id = asset.GetProperty("assetId").GetInt32();
        var rowVersion = asset.GetProperty("rowVersion").GetString()!;

        await ProblemAsync(await AssignAsync(_kit.As(), id, rowVersion), HttpStatusCode.Conflict, "ASSET_TYPE_NUMBERING_OFF");
        (await _kit.GetAssetAsync(id)).GetProperty("assetTypeNumberingEnabled").GetBoolean().ShouldBeFalse();

        await SetNumberingAsync(_kit.As(), type, true);
        await ProblemAsync(await AssignAsync(_kit.As(), id, "AAAAAAAAB9E="), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
        (await AssignAsync(_kit.As(), 999999, rowVersion)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _kit.As().PostAsync($"/api/v1/assets/{id}/assign-number", Json("{}"))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _kit.GetAssetAsync(id)).GetProperty("assetNumber").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Assigning_needs_Asset_Edit_and_the_database_refuses_to_change_an_assigned_number()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var type = await TypeAsync(numbered: false);
        var asset = await _kit.CreateAssetAsync(matter, type, "Disc");
        var id = asset.GetProperty("assetId").GetInt32();
        await SetNumberingAsync(_kit.As(), type, true);

        var viewer = await _kit.UserWithAsync(@"KE\viewer", "Asset.View", "Matter.View");
        var creator = await _kit.UserWithAsync(@"KE\creator", "Asset.View", "Asset.Create", "Matter.View");
        (await AssignAsync(viewer, id, asset.GetProperty("rowVersion").GetString()!)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await AssignAsync(creator, id, asset.GetProperty("rowVersion").GetString()!)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var editor = await _kit.UserWithAsync(@"KE\editor", "Asset.View", "Asset.Edit", "Matter.View");
        var assigned = await OkAsync(await AssignAsync(editor, id, asset.GetProperty("rowVersion").GetString()!));
        assigned.GetProperty("assetNumber").GetString().ShouldBe("90003-80008_001");

        var ex = await Should.ThrowAsync<Exception>(() => _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($"UPDATE dbo.Asset SET AssetNumber = NULL, AssetNumberSeq = NULL WHERE AssetId = {id}")));
        ex.ToString().ShouldContain("assigned once");
    }

    [Fact]
    public async Task Concurrent_assigns_and_creates_share_one_counter_without_duplicates_or_gaps()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var type = await TypeAsync(numbered: false);
        var old = new List<JsonElement>();
        for (var i = 0; i < 20; i++)
            old.Add(await _kit.CreateAssetAsync(matter, type, $"Old {i}"));
        await SetNumberingAsync(_kit.As(), type, true);
        var admin = _kit.As();

        var assigns = old.Select(a => AssignAsync(admin, a.GetProperty("assetId").GetInt32(), a.GetProperty("rowVersion").GetString()!));
        var creates = Enumerable.Range(0, 20).Select(i => admin.PostAsJsonAsync("/api/v1/assets", new { matterId = matter, assetTypeId = type, displayName = $"New {i}" }));
        var responses = await Task.WhenAll(assigns.Concat(creates));

        var numbers = new List<string>();
        foreach (var response in responses)
        {
            var text = await response.Content.ReadAsStringAsync();
            ((int)response.StatusCode).ShouldBeInRange(200, 201, text);
            numbers.Add(JsonDocument.Parse(text).RootElement.GetProperty("assetNumber").GetString()!);
        }

        numbers.Distinct().Count().ShouldBe(40);
        numbers.Order(StringComparer.Ordinal).ShouldBe(Enumerable.Range(1, 40).Select(n => $"90003-80008_{n:D3}"));
        var counter = await OkAsync(await admin.GetAsync($"/api/v1/asset-types/{type}/numbering/counters/{matter}"));
        counter.GetProperty("nextNumber").GetInt32().ShouldBe(41);
        counter.GetProperty("numberedAssetCount").GetInt32().ShouldBe(40);
    }

    [Fact]
    public async Task The_assignment_and_the_creation_are_audited_with_the_matter()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var type = await TypeAsync(numbered: false);
        var old = await _kit.CreateAssetAsync(matter, type, "Old");
        await SetNumberingAsync(_kit.As(), type, true);
        await _kit.CreateAssetAsync(matter, type, "Fresh");
        await OkAsync(await AssignAsync(_kit.As(), old.GetProperty("assetId").GetInt32(), old.GetProperty("rowVersion").GetString()!));

        var events = await _factory.WithDbAsync(db => db.Set<MatterFlow.Audit.Domain.AuditEvent>().AsNoTracking().Where(e => e.EventType == "ASSET_NUMBER_ASSIGNED").OrderBy(e => e.Id).ToListAsync());
        events.Count.ShouldBe(2);
        events.ShouldAllBe(e => e.ObjectType == "Asset" && e.MatterId == matter && e.FieldKey == "assetNumber" && e.ActorUserId != null);
        events[0].NewValue.ShouldBe("90003-80008_001");
        events[0].Summary!.ShouldContain("at creation");
        events[1].ObjectId.ShouldBe(old.GetProperty("assetId").GetInt32().ToString());
        events[1].NewValue.ShouldBe("90003-80008_002");
        events[1].Summary!.ShouldContain("existing asset");
    }

    [Fact]
    public async Task The_screens_get_numbered_and_unnumbered_counts_per_type_and_per_matter_and_the_longest_cm_number()
    {
        var a = await _kit.CreateMatterAsync("90003", "80008");
        var b = await _kit.CreateMatterAsync("90003", "80009");
        var type = await TypeAsync(numbered: false);
        await _kit.CreateAssetAsync(a, type, "Old 1");
        await _kit.CreateAssetAsync(a, type, "Old 2");
        await _kit.CreateAssetAsync(b, type, "Old 3");

        var before = (await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{type}"))).GetProperty("numbering");
        before.GetProperty("numberedAssetCount").GetInt32().ShouldBe(0);
        before.GetProperty("unnumberedAssetCount").GetInt32().ShouldBe(3);
        before.GetProperty("example").GetProperty("longestCmNumber").GetString()!.Length.ShouldBe(11);

        await SetNumberingAsync(_kit.As(), type, true);
        await _kit.CreateAssetAsync(a, type, "New 1");
        await _kit.CreateAssetAsync(a, type, "New 2");
        await _kit.CreateAssetAsync(b, type, "New 3");

        var after = (await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{type}"))).GetProperty("numbering");
        after.GetProperty("numberedAssetCount").GetInt32().ShouldBe(3);
        after.GetProperty("unnumberedAssetCount").GetInt32().ShouldBe(3);
        var list = await OkAsync(await _kit.As().GetAsync("/api/v1/asset-types?pageSize=100"));
        list.GetProperty("items")[0].GetProperty("numbering").GetProperty("numberedAssetCount").GetInt32().ShouldBe(3);

        var counters = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{type}/numbering/counters"));
        counters.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("matterRef").GetString()!, i => i.GetProperty("numberedAssetCount").GetInt32())
            .ShouldBe(new Dictionary<string, int> { ["90003-80008"] = 2, ["90003-80009"] = 1 });
        (await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{type}/numbering/counters/{a}"))).GetProperty("numberedAssetCount").GetInt32().ShouldBe(2);

        // Without Asset.View the counts are null, not a made-up 0.
        var manager = await _kit.UserWithAsync(@"KE\manager", "AssetType.Manage");
        var seen = (await OkAsync(await manager.GetAsync($"/api/v1/asset-types/{type}"))).GetProperty("numbering");
        seen.GetProperty("numberedAssetCount").ValueKind.ShouldBe(JsonValueKind.Null);
        seen.GetProperty("unnumberedAssetCount").ValueKind.ShouldBe(JsonValueKind.Null);
    }
}
