using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using static MatterFlow.IntegrationTests.Assets.AssetTestKit;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>Asset size (epic #851, issue #867): the designated size field and unit of a type, the always-indexed NUMBER and SELECT fields and the reindex.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetSizeApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private AssetTestKit _kit = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _kit = new AssetTestKit(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static readonly string[] Fields =
    [
        Field("format", "SELECT", """ "options":[{"key":"pdf","label":"PDF"},{"key":"docx","label":"Word"}]"""),
        Field("volume_gb", "NUMBER", """ "validation":{"min":0}"""),
        Field("pages", "NUMBER", """ "isFilterable":true"""),
        Field("notes", "TEXT"),
    ];

    private async Task<(int MatterId, int TypeId, string RowVersion)> SetUpAsync()
    {
        var matterId = await _kit.CreateMatterAsync();
        var type = await _kit.CreateTypeAsync();
        var typeId = type.GetProperty("assetTypeId").GetInt32();
        await _kit.PublishFormAsync(typeId, Fields);
        var current = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{typeId}"));
        return (matterId, typeId, current.GetProperty("rowVersion").GetString()!);
    }

    private Task<HttpResponseMessage> SetSizeAsync(int typeId, string rowVersion, string? key, string? unit) =>
        _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{typeId}/size-field", new { sizeFieldKey = key, sizeUnit = unit, rowVersion });

    [Fact]
    public async Task The_size_field_must_be_a_published_number_field_with_a_known_unit_and_both_are_set_together()
    {
        var (_, typeId, rowVersion) = await SetUpAsync();

        await ProblemAsync(await SetSizeAsync(typeId, rowVersion, "format", "GB"), HttpStatusCode.BadRequest); // a SELECT
        await ProblemAsync(await SetSizeAsync(typeId, rowVersion, "missing", "GB"), HttpStatusCode.BadRequest);
        await ProblemAsync(await SetSizeAsync(typeId, rowVersion, "volume_gb", "Litres"), HttpStatusCode.BadRequest);
        await ProblemAsync(await SetSizeAsync(typeId, rowVersion, "volume_gb", null), HttpStatusCode.BadRequest);
        await ProblemAsync(await SetSizeAsync(typeId, rowVersion, null, "GB"), HttpStatusCode.BadRequest);

        var set = await OkAsync(await SetSizeAsync(typeId, rowVersion, "volume_gb", "GB"));
        set.GetProperty("sizeFieldKey").GetString().ShouldBe("volume_gb");
        set.GetProperty("sizeUnit").GetString().ShouldBe("GB");

        // The stale row version of the first read is a conflict now.
        await ProblemAsync(await SetSizeAsync(typeId, rowVersion, "pages", "Items"), HttpStatusCode.Conflict);

        var cleared = await OkAsync(await SetSizeAsync(typeId, set.GetProperty("rowVersion").GetString()!, null, null));
        cleared.GetProperty("sizeFieldKey").ValueKind.ShouldBe(JsonValueKind.Null);
        cleared.GetProperty("sizeUnit").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Changing_the_size_field_is_audited_and_needs_AssetType_Manage()
    {
        var (_, typeId, rowVersion) = await SetUpAsync();
        var viewer = await _kit.UserWithAsync(@"ke\sizeviewer", "Asset.View");
        (await viewer.PutAsJsonAsync($"/api/v1/asset-types/{typeId}/size-field", new { sizeFieldKey = "volume_gb", sizeUnit = "GB", rowVersion })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PostAsync($"/api/v1/asset-types/{typeId}/reindex", null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        await OkAsync(await SetSizeAsync(typeId, rowVersion, "volume_gb", "GB"));
        var events = await OkAsync(await _kit.As().GetAsync($"/api/v1/audit/events?objectType=AssetType&objectId={typeId}&pageSize=100"));
        events.GetProperty("items").EnumerateArray().Select(e => e.TryGetProperty("fieldKey", out var f) ? f.GetString() : null)
            .ShouldContain("SizeFieldKey");
    }

    [Fact]
    public async Task Number_and_select_fields_of_an_asset_are_always_indexed_other_fields_only_when_filterable()
    {
        var (matterId, typeId, _) = await SetUpAsync();

        var asset = await _kit.CreateAssetAsync(matterId, typeId, "Set A", """{"format":"pdf","volume_gb":12.5,"pages":300,"notes":"hello"}""");
        var id = asset.GetProperty("assetId").GetInt32();

        var keys = await _factory.WithDbAsync(db => db.Database
            .SqlQuery<string>($"SELECT FieldKey AS Value FROM dbo.CustomFieldIndex WHERE OwnerKind = 'ASSET' AND OwnerId = {id} ORDER BY FieldKey")
            .ToListAsync());
        keys.ShouldBe(["format", "pages", "volume_gb"]); // notes is a TEXT field that is not filterable
        var volume = await _factory.WithDbAsync(db => db.Database
            .SqlQuery<decimal>($"SELECT ValueNumber AS Value FROM dbo.CustomFieldIndex WHERE OwnerKind = 'ASSET' AND OwnerId = {id} AND FieldKey = 'volume_gb'")
            .SingleAsync());
        volume.ShouldBe(12.5m);
    }

    [Fact]
    public async Task Reindex_restores_missing_rows_and_is_idempotent_and_the_startup_pass_fills_what_is_missing()
    {
        var (matterId, typeId, _) = await SetUpAsync();
        var a = (await _kit.CreateAssetAsync(matterId, typeId, "Set A", """{"volume_gb":10,"format":"docx"}""")).GetProperty("assetId").GetInt32();
        var b = (await _kit.CreateAssetAsync(matterId, typeId, "Set B", """{"volume_gb":20}""")).GetProperty("assetId").GetInt32();
        (await _kit.IndexRowsAsync(a)).ShouldBe(2);

        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($"DELETE FROM dbo.CustomFieldIndex WHERE OwnerKind = 'ASSET'"));
        (await _kit.IndexRowsAsync(a)).ShouldBe(0);

        var result = await OkAsync(await _kit.As().PostAsync($"/api/v1/asset-types/{typeId}/reindex", null));
        result.GetProperty("assetsProcessed").GetInt32().ShouldBe(2);
        (await _kit.IndexRowsAsync(a)).ShouldBe(2);
        (await _kit.IndexRowsAsync(b)).ShouldBe(1);

        // Idempotent: a second run leaves the same rows.
        await OkAsync(await _kit.As().PostAsync($"/api/v1/asset-types/{typeId}/reindex", null));
        (await _kit.IndexRowsAsync(a)).ShouldBe(2);

        // The startup pass only touches value sets that have no index row at all.
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($"DELETE FROM dbo.CustomFieldIndex WHERE OwnerKind = 'ASSET' AND OwnerId = {b}"));
        using var scope = _factory.Services.CreateScope();
        var processed = await scope.ServiceProvider.GetRequiredService<IFormIndexMaintenance>().ReindexMissingAsync(FormValueOwnerKind.Asset);
        processed.ShouldBe(1);
        (await _kit.IndexRowsAsync(b)).ShouldBe(1);
    }

    [Fact]
    public async Task The_asset_and_the_list_expose_the_size_with_bytes_for_the_size_family_only()
    {
        var (matterId, typeId, rowVersion) = await SetUpAsync();
        var gb = (await _kit.CreateAssetAsync(matterId, typeId, "Big", """{"volume_gb":2}""")).GetProperty("assetId").GetInt32();
        var none = (await _kit.CreateAssetAsync(matterId, typeId, "Empty")).GetProperty("assetId").GetInt32();

        (await _kit.GetAssetAsync(gb)).GetProperty("sizeValue").ValueKind.ShouldBe(JsonValueKind.Null); // no size field designated yet

        var set = await OkAsync(await SetSizeAsync(typeId, rowVersion, "volume_gb", "GB"));
        var detail = await _kit.GetAssetAsync(gb);
        detail.GetProperty("sizeValue").GetDecimal().ShouldBe(2m);
        detail.GetProperty("sizeUnit").GetString().ShouldBe("GB");
        detail.GetProperty("sizeBytes").GetInt64().ShouldBe(2L * 1024 * 1024 * 1024);
        (await _kit.GetAssetAsync(none)).GetProperty("sizeValue").ValueKind.ShouldBe(JsonValueKind.Null);

        var list = await OkAsync(await _kit.As().GetAsync($"/api/v1/assets?matterId={matterId}"));
        var big = list.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("assetId").GetInt32() == gb);
        big.GetProperty("sizeValue").GetDecimal().ShouldBe(2m);
        big.GetProperty("sizeBytes").GetInt64().ShouldBe(2L * 1024 * 1024 * 1024);

        // Items never become bytes.
        await OkAsync(await SetSizeAsync(typeId, set.GetProperty("rowVersion").GetString()!, "pages", "Items"));
        var items = await _kit.GetAssetAsync(gb);
        items.GetProperty("sizeValue").ValueKind.ShouldBe(JsonValueKind.Null); // pages was not entered
        await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/assets/{gb}", new { displayName = "Big", rowVersion = items.GetProperty("rowVersion").GetString(), formValues = new { pages = 40 } }));
        var withPages = await _kit.GetAssetAsync(gb);
        withPages.GetProperty("sizeValue").GetDecimal().ShouldBe(40m);
        withPages.GetProperty("sizeUnit").GetString().ShouldBe("Items");
        withPages.GetProperty("sizeBytes").ValueKind.ShouldBe(JsonValueKind.Null);
    }
}
