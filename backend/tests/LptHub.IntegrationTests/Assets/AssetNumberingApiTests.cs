using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Assets.AssetTestKit;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// Automatic asset numbering (issue #1297) through the HTTP API on a real SQL Server: the first number, the restart per matter, interleaved matters, other asset types, numbering off and on,
/// widening, 50 parallel creates, read-only after create, the snapshot, the next-number control, permissions, the audit event and the numbered read models.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetNumberingApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private AssetTestKit _kit = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _kit = new AssetTestKit(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<int> NumberedTypeAsync(string name = "Media", string? pattern = null, bool enabled = true)
    {
        var numbering = pattern is null ? (object)new { enabled } : new { enabled, pattern };
        var type = await OkAsync(await _kit.As().PostAsJsonAsync("/api/v1/asset-types", new { name, numbering }), HttpStatusCode.Created);
        return type.GetProperty("assetTypeId").GetInt32();
    }

    private async Task<string?> NewAssetNumberAsync(int matterId, int typeId, string name = "Disc")
    {
        var asset = await _kit.CreateAssetAsync(matterId, typeId, name);
        return asset.GetProperty("assetNumber").ValueKind == JsonValueKind.Null ? null : asset.GetProperty("assetNumber").GetString();
    }

    private async Task<JsonElement> CounterAsync(int typeId, int matterId) =>
        await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{typeId}/numbering/counters/{matterId}"));

    [Fact]
    public async Task The_first_asset_of_a_numbered_type_gets_001_and_the_next_ones_count_up()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();

        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_001");
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_002");
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_003");

        var counter = await CounterAsync(media, matter);
        counter.GetProperty("highestAssigned").GetInt32().ShouldBe(3);
        counter.GetProperty("nextNumber").GetInt32().ShouldBe(4);
        counter.GetProperty("nextAssetNumber").GetString().ShouldBe("90003-80008_004");
        counter.GetProperty("matterRef").GetString().ShouldBe("90003-80008");
    }

    [Fact]
    public async Task The_counter_restarts_for_each_matter_and_interleaved_creates_do_not_mix_them()
    {
        var a = await _kit.CreateMatterAsync("90003", "80008");
        var b = await _kit.CreateMatterAsync("90003", "80009");
        var media = await NumberedTypeAsync();

        (await NewAssetNumberAsync(a, media)).ShouldBe("90003-80008_001");
        (await NewAssetNumberAsync(b, media)).ShouldBe("90003-80009_001");
        (await NewAssetNumberAsync(a, media)).ShouldBe("90003-80008_002");
        (await NewAssetNumberAsync(b, media)).ShouldBe("90003-80009_002");
        (await NewAssetNumberAsync(b, media)).ShouldBe("90003-80009_003");
        (await NewAssetNumberAsync(a, media)).ShouldBe("90003-80008_003");
    }

    [Fact]
    public async Task Another_asset_type_is_unaffected_and_a_type_with_numbering_off_gets_no_number()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        var other = await NumberedTypeAsync("Hard Drive");
        var plain = await NumberedTypeAsync("Document Set", enabled: false);

        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_001");
        (await NewAssetNumberAsync(matter, other)).ShouldBe("90003-80008_001"); // its own counter
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_002");
        (await NewAssetNumberAsync(matter, plain)).ShouldBeNull();

        var type = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{plain}"));
        type.GetProperty("numbering").GetProperty("enabled").GetBoolean().ShouldBeFalse();
        type.GetProperty("numbering").GetProperty("example").GetProperty("isSample").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task Turning_numbering_on_numbers_no_old_asset_and_turning_it_off_keeps_the_numbers_and_the_counter()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var type = await NumberedTypeAsync("Media", enabled: false);
        var before = await _kit.CreateAssetAsync(matter, type, "Old disc");
        before.GetProperty("assetNumber").ValueKind.ShouldBe(JsonValueKind.Null);

        var current = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{type}"));
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{type}", new { name = "Media", isActive = true, sortOrder = 10, rowVersion = current.GetProperty("rowVersion").GetString(), numbering = new { enabled = true } }));
        (await _kit.GetAssetAsync(before.GetProperty("assetId").GetInt32())).GetProperty("assetNumber").ValueKind.ShouldBe(JsonValueKind.Null);
        (await NewAssetNumberAsync(matter, type)).ShouldBe("90003-80008_001");

        current = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{type}"));
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{type}", new { name = "Media", isActive = true, sortOrder = 10, rowVersion = current.GetProperty("rowVersion").GetString(), numbering = new { enabled = false } }));
        (await NewAssetNumberAsync(matter, type)).ShouldBeNull();

        current = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{type}"));
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{type}", new { name = "Media", isActive = true, sortOrder = 10, rowVersion = current.GetProperty("rowVersion").GetString(), numbering = new { enabled = true } }));
        (await NewAssetNumberAsync(matter, type)).ShouldBe("90003-80008_002"); // the counter was kept, the unnumbered assets used none
    }

    [Fact]
    public async Task A_custom_tail_with_text_before_the_counter_is_used()
    {
        var matter = await _kit.CreateMatterAsync("12345", "12344");
        var type = await NumberedTypeAsync("Media", "-M-{###}");
        (await NewAssetNumberAsync(matter, type)).ShouldBe("12345-12344-M-001");
    }

    [Fact]
    public async Task The_counter_widens_past_its_width_instead_of_failing_and_never_goes_back()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 999 }));

        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_999");
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_1000");
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_1001");
    }

    [Fact]
    public async Task Fifty_parallel_creates_for_one_type_and_matter_get_fifty_distinct_consecutive_numbers()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        var admin = _kit.As();

        var responses = await Task.WhenAll(Enumerable.Range(1, 50).Select(async i =>
            await admin.PostAsJsonAsync("/api/v1/assets", new { matterId = matter, assetTypeId = media, displayName = $"Parallel {i}" })));

        foreach (var response in responses)
            response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        var numbers = new List<string>();
        foreach (var response in responses)
            numbers.Add(JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("assetNumber").GetString()!);

        numbers.Distinct().Count().ShouldBe(50);
        numbers.Order(StringComparer.Ordinal).ShouldBe(Enumerable.Range(1, 50).Select(n => $"90003-80008_{n:D3}"));
        var counter = await CounterAsync(media, matter);
        counter.GetProperty("highestAssigned").GetInt32().ShouldBe(50);
        counter.GetProperty("nextNumber").GetInt32().ShouldBe(51);
    }

    [Fact]
    public async Task Parallel_first_creates_in_several_matters_each_start_at_one()
    {
        var matters = new[] { await _kit.CreateMatterAsync("90003", "80008"), await _kit.CreateMatterAsync("90003", "80009"), await _kit.CreateMatterAsync("90003", "80010") };
        var media = await NumberedTypeAsync();
        var admin = _kit.As();

        var responses = await Task.WhenAll(Enumerable.Range(0, 30).Select(async i =>
            (Matter: matters[i % 3], Response: await admin.PostAsJsonAsync("/api/v1/assets", new { matterId = matters[i % 3], assetTypeId = media, displayName = $"Mixed {i}" }))));

        foreach (var (matter, response) in responses)
            response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        foreach (var matter in matters)
        {
            var counter = await CounterAsync(media, matter);
            counter.GetProperty("highestAssigned").GetInt32().ShouldBe(10);
            counter.GetProperty("nextNumber").GetInt32().ShouldBe(11);
        }
    }

    [Fact]
    public async Task A_failed_create_gives_its_number_back_so_there_is_no_gap()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_001");

        // Values for a type without a published form are refused after the number was taken: the whole transaction rolls back.
        var bad = await _kit.As().PostAsync("/api/v1/assets", Json($$$"""{"matterId":{{{matter}}},"assetTypeId":{{{media}}},"displayName":"Bad","formValues":{"nope":"x"}}"""));
        ((int)bad.StatusCode).ShouldBeGreaterThanOrEqualTo(400);

        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_002");
    }

    [Fact]
    public async Task The_asset_number_is_read_only_after_create()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        var asset = await _kit.CreateAssetAsync(matter, media, "Disc");
        var id = asset.GetProperty("assetId").GetInt32();
        var rowVersion = asset.GetProperty("rowVersion").GetString();

        var changed = await _kit.As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"Disc","assetNumber":"90003-80008_099","rowVersion":"{{rowVersion}}"}"""));
        await ProblemAsync(changed, HttpStatusCode.Conflict, "IMMUTABLE_FIELD");

        // Sending the same number back, or none, is fine; the number never changes.
        var same = await OkAsync(await _kit.As().PutAsync($"/api/v1/assets/{id}", Json($$"""{"displayName":"Renamed","assetNumber":"90003-80008_001","rowVersion":"{{rowVersion}}"}""")));
        same.GetProperty("assetNumber").GetString().ShouldBe("90003-80008_001");
        var none = await OkAsync(await _kit.As().PutAsync($"/api/v1/assets/{id}", Json("{\"displayName\":\"Renamed again\",\"rowVersion\":\"" + same.GetProperty("rowVersion").GetString() + "\"}")));
        none.GetProperty("assetNumber").GetString().ShouldBe("90003-80008_001");

        // A client that sends a number on create does not choose it.
        var created = await OkAsync(await _kit.As().PostAsync("/api/v1/assets", Json($$"""{"matterId":{{matter}},"assetTypeId":{{media}},"displayName":"Sneaky","assetNumber":"X-1"}""")), HttpStatusCode.Created);
        created.GetProperty("assetNumber").GetString().ShouldBe("90003-80008_002");
    }

    [Fact]
    public async Task The_number_is_a_snapshot_a_changed_cm_number_or_pattern_changes_nothing_already_assigned()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        var first = await _kit.CreateAssetAsync(matter, media, "Disc");

        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($"UPDATE dbo.Matter SET MatterNumber = '80099' WHERE MatterId = {matter}"));
        (await _kit.GetAssetAsync(first.GetProperty("assetId").GetInt32())).GetProperty("assetNumber").GetString().ShouldBe("90003-80008_001");

        // The next asset of the matter continues the counter under the new CM Number.
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80099_002");

        var current = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{media}"));
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}", new { name = "Media", isActive = true, sortOrder = 10, rowVersion = current.GetProperty("rowVersion").GetString(), numbering = new { pattern = "-M-{####}" } }));
        (await _kit.GetAssetAsync(first.GetProperty("assetId").GetInt32())).GetProperty("assetNumber").GetString().ShouldBe("90003-80008_001");
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80099-M-0003");
    }

    [Fact]
    public async Task A_deactivated_or_disposed_asset_keeps_its_number_and_a_new_asset_never_reuses_it()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        var first = await _kit.CreateAssetAsync(matter, media, "Disc");
        var id = first.GetProperty("assetId").GetInt32();
        await OkAsync(await _kit.As().PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = false, rowVersion = first.GetProperty("rowVersion").GetString() }));

        (await _kit.GetAssetAsync(id)).GetProperty("assetNumber").GetString().ShouldBe("90003-80008_001");
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_002");
    }

    [Fact]
    public async Task The_next_number_can_only_be_raised_to_continue_after_existing_folders_never_lowered()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();

        // A matter with folders 001 to 037 already on the share: set the start before the first asset.
        var set = await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 38 }));
        set.GetProperty("nextNumber").GetInt32().ShouldBe(38);
        set.GetProperty("hasCounter").GetBoolean().ShouldBeTrue();
        set.GetProperty("nextAssetNumber").GetString().ShouldBe("90003-80008_038");
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_038");
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_039");

        // Not below the current next number (40), which is also above the highest assigned number.
        var low = await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 39 });
        var problem = await ProblemAsync(low, HttpStatusCode.BadRequest);
        problem.GetProperty("errors").GetProperty("nextNumber")[0].GetProperty("code").GetString().ShouldBe("NEXT_NUMBER_TOO_LOW");
        (await CounterAsync(media, matter)).GetProperty("nextNumber").GetInt32().ShouldBe(40);

        // Raising is fine; once raised it cannot be lowered again, not even to highest + 1 (nothing between was assigned, but the owner rule is raise only).
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 100 }));
        var lowered = await ProblemAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 40 }), HttpStatusCode.BadRequest);
        lowered.GetProperty("errors").GetProperty("nextNumber")[0].GetProperty("code").GetString().ShouldBe("NEXT_NUMBER_TOO_LOW");
        lowered.GetProperty("errors").GetProperty("nextNumber")[0].GetProperty("message").GetString()!.ShouldContain("only be raised");
        (await CounterAsync(media, matter)).GetProperty("nextNumber").GetInt32().ShouldBe(100);
        (await NewAssetNumberAsync(matter, media)).ShouldBe("90003-80008_100");

        // The same number as the current next number (101 after the asset above) is accepted and changes nothing: no audit event.
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 101 }));
        (await _factory.WithDbAsync(db => db.Set<MatterFlow.Audit.Domain.AuditEvent>().AsNoTracking().Where(e => e.EventType == "ASSET_NEXT_NUMBER_SET").CountAsync())).ShouldBe(2); // 38 and 100 only

        (await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 0 })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Setting_the_next_number_creates_the_counter_row_and_is_audited_with_who_matter_old_and_new()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        var before = await CounterAsync(media, matter);
        before.GetProperty("hasCounter").GetBoolean().ShouldBeFalse();
        before.GetProperty("nextNumber").GetInt32().ShouldBe(1);

        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 12 }));
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 12 })); // unchanged: no second event

        var events = await _factory.WithDbAsync(db => db.Set<MatterFlow.Audit.Domain.AuditEvent>().AsNoTracking().Where(e => e.EventType == "ASSET_NEXT_NUMBER_SET").ToListAsync());
        var e = events.ShouldHaveSingleItem();
        e.ObjectType.ShouldBe("AssetType");
        e.ObjectId.ShouldBe(media.ToString());
        e.MatterId.ShouldBe(matter);
        e.OldValue.ShouldBe("1");
        e.NewValue.ShouldBe("12");
        e.ActorUserId.ShouldNotBeNull();
        e.Summary!.ShouldContain("90003-80008");

        var list = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{media}/numbering/counters"));
        list.GetProperty("total").GetInt32().ShouldBe(1);
        list.GetProperty("items")[0].GetProperty("nextNumber").GetInt32().ShouldBe(12);
    }

    [Fact]
    public async Task The_counter_list_pages_sorts_and_searches_by_cm_number()
    {
        var m1 = await _kit.CreateMatterAsync("90003", "80001");
        var m2 = await _kit.CreateMatterAsync("90003", "80002");
        var m3 = await _kit.CreateMatterAsync("00343", "00012");
        var media = await NumberedTypeAsync();
        foreach (var (matter, next) in new[] { (m2, 5), (m1, 9), (m3, 2) })
            await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = next }));

        var all = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{media}/numbering/counters"));
        all.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterRef").GetString()).ShouldBe(["00343-00012", "90003-80001", "90003-80002"]);
        var byNext = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{media}/numbering/counters?sort=-nextNumber&pageSize=2"));
        byNext.GetProperty("total").GetInt32().ShouldBe(3);
        byNext.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("nextNumber").GetInt32()).ShouldBe([9, 5]);
        var search = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{media}/numbering/counters?q=80002"));
        search.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterRef").GetString()).ShouldBe(["90003-80002"]);
        (await _kit.As().GetAsync($"/api/v1/asset-types/{media}/numbering/counters?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _kit.As().GetAsync("/api/v1/asset-types/999999/numbering/counters")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await _kit.As().GetAsync($"/api/v1/asset-types/{media}/numbering/counters/999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_numbering_admin_endpoints_need_AssetType_Manage_and_creating_assets_stays_as_it_was()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        var viewer = await _kit.UserWithAsync(@"KE\viewer", "Asset.View", "Matter.View");
        var creator = await _kit.UserWithAsync(@"KE\creator", "Asset.View", "Asset.Create", "Matter.View");
        var manager = await _kit.UserWithAsync(@"KE\manager", "AssetType.Manage", "Matter.View");

        foreach (var client in new[] { viewer, creator })
        {
            (await client.GetAsync($"/api/v1/asset-types/{media}/numbering/counters")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.GetAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 5 })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        }

        // Creating an asset needs only Asset.Create and numbers it.
        var created = await OkAsync(await creator.PostAsJsonAsync("/api/v1/assets", new { matterId = matter, assetTypeId = media, displayName = "By creator" }), HttpStatusCode.Created);
        created.GetProperty("assetNumber").GetString().ShouldBe("90003-80008_001");
        // Changing the settings needs AssetType.Manage.
        (await creator.PostAsJsonAsync("/api/v1/asset-types", new { name = "Nope", numbering = new { enabled = true } })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        await OkAsync(await manager.PutAsJsonAsync($"/api/v1/asset-types/{media}/numbering/counters/{matter}", new { nextNumber = 7 }));
    }

    [Theory]
    [InlineData("_", "PATTERN_NO_COUNTER")]
    [InlineData("_{###}_{#}", "PATTERN_TWO_COUNTERS")]
    [InlineData("_{client number}{###}", "PATTERN_UNKNOWN_TOKEN")]
    [InlineData("_{##########}", "PATTERN_COUNTER_WIDTH")]
    [InlineData("a|b{###}", "PATTERN_FORBIDDEN_CHAR")]
    [InlineData(" _{###}", "PATTERN_EDGE_SPACE")]
    [InlineData("_{###}.", "PATTERN_TRAILING_DOT")]
    public async Task An_invalid_pattern_is_a_400_with_its_stable_code_on_create_and_update(string pattern, string code)
    {
        var create = await _kit.As().PostAsJsonAsync("/api/v1/asset-types", new { name = "Media", numbering = new { enabled = true, pattern } });
        var problem = await ProblemAsync(create, HttpStatusCode.BadRequest);
        problem.GetProperty("errors").GetProperty("numbering.pattern")[0].GetProperty("code").GetString().ShouldBe(code);

        var type = await _kit.CreateTypeAsync("Valid");
        var update = await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{type.GetProperty("assetTypeId").GetInt32()}", new { name = "Valid", isActive = true, sortOrder = 1, rowVersion = type.GetProperty("rowVersion").GetString(), numbering = new { pattern } });
        problem = await ProblemAsync(update, HttpStatusCode.BadRequest);
        problem.GetProperty("errors").GetProperty("numbering.pattern")[0].GetProperty("code").GetString().ShouldBe(code);
    }

    [Fact]
    public async Task A_client_that_does_not_know_the_numbering_settings_never_changes_them()
    {
        var media = await NumberedTypeAsync("Media", "-M-{###}");
        var current = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{media}"));
        var updated = await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}", new { name = "Media 2", isActive = true, sortOrder = 5, rowVersion = current.GetProperty("rowVersion").GetString() }));
        updated.GetProperty("numbering").GetProperty("enabled").GetBoolean().ShouldBeTrue();
        updated.GetProperty("numbering").GetProperty("pattern").GetString().ShouldBe("-M-{###}");
        updated.GetProperty("numbering").GetProperty("scope").GetString().ShouldBe("MATTER");

        var bad = await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{media}", new { name = "Media 2", isActive = true, sortOrder = 5, rowVersion = updated.GetProperty("rowVersion").GetString(), numbering = new { scope = "CLIENT" } });
        await ProblemAsync(bad, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task The_asset_type_shows_a_real_example_once_a_matter_was_numbered_and_the_sample_before()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();

        var sample = (await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{media}"))).GetProperty("numbering").GetProperty("example");
        sample.GetProperty("isSample").GetBoolean().ShouldBeTrue();
        sample.GetProperty("cmNumber").GetString().ShouldBe("90003-80008");
        sample.GetProperty("nextCounter").GetInt32().ShouldBe(1);
        sample.GetProperty("text").GetString().ShouldBe("90003-80008_001");

        await _kit.CreateMatterAsync("00343", "00012");
        await NewAssetNumberAsync(matter, media);
        await NewAssetNumberAsync(matter, media);
        var real = (await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{media}"))).GetProperty("numbering").GetProperty("example");
        real.GetProperty("isSample").GetBoolean().ShouldBeFalse();
        real.GetProperty("cmNumber").GetString().ShouldBe("90003-80008");
        real.GetProperty("nextCounter").GetInt32().ShouldBe(3);
        real.GetProperty("text").GetString().ShouldBe("90003-80008_003");
    }

    [Fact]
    public async Task The_number_is_in_the_asset_list_filter_sort_lookup_and_search()
    {
        var a = await _kit.CreateMatterAsync("90003", "80008");
        var b = await _kit.CreateMatterAsync("90003", "80009");
        var media = await NumberedTypeAsync();
        var plain = await NumberedTypeAsync("Document Set", enabled: false);
        await _kit.CreateAssetAsync(a, media, "Alpha disc");
        await _kit.CreateAssetAsync(b, media, "Beta disc");
        await _kit.CreateAssetAsync(a, media, "Gamma disc");
        await _kit.CreateAssetAsync(a, plain, "Delta set");

        var filtered = await OkAsync(await _kit.As().GetAsync("/api/v1/assets?assetNumber=80008_00"));
        filtered.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("assetNumber").GetString()).Order().ShouldBe(["90003-80008_001", "90003-80008_002"]);
        var sorted = await OkAsync(await _kit.As().GetAsync("/api/v1/assets?assetTypeId=" + media + "&sort=-assetNumber"));
        sorted.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("assetNumber").GetString()).ShouldBe(["90003-80009_001", "90003-80008_002", "90003-80008_001"]);
        var q = await OkAsync(await _kit.As().GetAsync("/api/v1/assets?q=80009_001"));
        q.GetProperty("total").GetInt32().ShouldBe(1);
        var lookup = await OkAsync(await _kit.As().GetAsync($"/api/v1/assets/lookup?matterId={b}"));
        lookup[0].GetProperty("assetNumber").GetString().ShouldBe("90003-80009_001");
        var mine = await OkAsync(await _kit.As().GetAsync("/api/v1/my-matters/assets?scope=all&assetNumber=80009_001"));
        mine.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("assetNumber").GetString()).ShouldBe(["90003-80009_001"]);
        var search = await OkAsync(await _kit.As().GetAsync("/api/v1/search?q=80009_001"));
        search.ToString().ShouldContain("90003-80009_001");
        (await _kit.As().GetAsync("/api/v1/assets?sort=nonsense")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task The_database_refuses_to_change_an_assigned_number_even_for_a_direct_write()
    {
        var matter = await _kit.CreateMatterAsync("90003", "80008");
        var media = await NumberedTypeAsync();
        var asset = await _kit.CreateAssetAsync(matter, media, "Disc");

        var ex = await Should.ThrowAsync<Exception>(() => _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($"UPDATE dbo.Asset SET AssetNumber = N'X' WHERE AssetId = {asset.GetProperty("assetId").GetInt32()}")));
        ex.ToString().ShouldContain("assigned once");
    }
}
