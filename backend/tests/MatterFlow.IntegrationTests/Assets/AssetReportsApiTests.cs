using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Assets.AssetTestKit;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>Saved asset reports (epic #851, issue #872): personal definitions, validation, ownership, limits.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetReportsApiTests(SqlServerFixture sql) : IAsyncLifetime
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
        Field("volume_gb", "NUMBER"),
        Field("pages", "NUMBER"),
        Field("notes", "TEXT"),
    ];

    private async Task<int> TypeWithFormAsync(string name = "Document Set", string? sizeKey = "volume_gb", string unit = "GB")
    {
        var type = await _kit.CreateTypeAsync(name);
        var id = type.GetProperty("assetTypeId").GetInt32();
        await _kit.PublishFormAsync(id, Fields);
        if (sizeKey is not null)
        {
            var current = await OkAsync(await _kit.As().GetAsync($"/api/v1/asset-types/{id}"));
            await OkAsync(await _kit.As().PutAsJsonAsync($"/api/v1/asset-types/{id}/size-field", new { sizeFieldKey = sizeKey, sizeUnit = unit, rowVersion = current.GetProperty("rowVersion").GetString() }));
        }

        return id;
    }

    private static object Definition(int? typeId, string measure = "count", string groupBy = "disposition", string? numberField = null, string? numberUnit = null, string scope = "mine") =>
        new Dictionary<string, object?>
        {
            ["v"] = 1,
            ["assetTypeId"] = typeId,
            ["measure"] = measure,
            ["numberField"] = numberField,
            ["numberUnit"] = numberUnit,
            ["groupBy"] = groupBy,
            ["scope"] = scope,
        };

    private static Task<HttpResponseMessage> CreateAsync(HttpClient client, string name, object definition) =>
        client.PostAsJsonAsync("/api/v1/asset-reports", new { name, definition });

    private async Task<HttpClient> PmAsync(string user = @"ke\pmone") => await _kit.UserWithAsync(user, "Asset.View");

    [Fact]
    public async Task A_report_is_saved_listed_read_renamed_and_deleted_by_its_owner()
    {
        var typeId = await TypeWithFormAsync();
        var pm = await PmAsync();

        var created = await OkAsync(await CreateAsync(pm, " Data by disposition ", Definition(typeId, "sum", "disposition")), HttpStatusCode.Created);
        var id = created.GetProperty("assetReportId").GetInt32();
        created.GetProperty("name").GetString().ShouldBe("Data by disposition");
        created.GetProperty("isSupported").GetBoolean().ShouldBeTrue();
        var definition = created.GetProperty("definition");
        definition.GetProperty("v").GetInt32().ShouldBe(1);
        definition.GetProperty("measure").GetString().ShouldBe("sum");
        definition.GetProperty("numberField").ValueKind.ShouldBe(JsonValueKind.Null); // the type's default size field is used

        var list = await OkAsync(await pm.GetAsync("/api/v1/asset-reports"));
        list.GetArrayLength().ShouldBe(1);

        var read = await OkAsync(await pm.GetAsync($"/api/v1/asset-reports/{id}"));
        read.GetProperty("name").GetString().ShouldBe("Data by disposition");

        var updated = await OkAsync(await pm.PutAsJsonAsync($"/api/v1/asset-reports/{id}", new
        {
            name = "Volume by matter",
            definition = Definition(typeId, "average", "matter", "pages", "Items"),
            rowVersion = created.GetProperty("rowVersion").GetString(),
        }));
        updated.GetProperty("name").GetString().ShouldBe("Volume by matter");
        updated.GetProperty("definition").GetProperty("numberUnit").GetString().ShouldBe("Items");

        (await pm.DeleteAsync($"/api/v1/asset-reports/{id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await pm.GetAsync($"/api/v1/asset-reports/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await OkAsync(await pm.GetAsync("/api/v1/asset-reports"))).GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task Another_persons_report_is_a_404_for_read_update_and_delete_and_never_listed()
    {
        var typeId = await TypeWithFormAsync();
        var owner = await PmAsync(@"ke\owner");
        var other = await PmAsync(@"ke\other");
        var created = await OkAsync(await CreateAsync(owner, "Mine", Definition(typeId)), HttpStatusCode.Created);
        var id = created.GetProperty("assetReportId").GetInt32();

        (await other.GetAsync($"/api/v1/asset-reports/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await other.PutAsJsonAsync($"/api/v1/asset-reports/{id}", new { name = "Taken", definition = Definition(typeId), rowVersion = created.GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await other.DeleteAsync($"/api/v1/asset-reports/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await OkAsync(await other.GetAsync("/api/v1/asset-reports"))).GetArrayLength().ShouldBe(0);

        // The same name is free for another person.
        await OkAsync(await CreateAsync(other, "Mine", Definition(typeId)), HttpStatusCode.Created);
        (await owner.GetAsync($"/api/v1/asset-reports/{id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Without_Asset_View_every_report_endpoint_is_forbidden()
    {
        var typeId = await TypeWithFormAsync();
        var nobody = await _kit.UserWithAsync(@"ke\nobody", "Task.View");
        (await nobody.GetAsync("/api/v1/asset-reports")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.GetAsync("/api/v1/asset-reports/fields")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await CreateAsync(nobody, "X", Definition(typeId))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_definition_is_validated_and_unknown_versions_are_rejected()
    {
        var typeId = await TypeWithFormAsync();
        var noSizeType = await TypeWithFormAsync("No size", sizeKey: null);
        var pm = await PmAsync();

        var version = new Dictionary<string, object?> { ["v"] = 2, ["measure"] = "count", ["groupBy"] = "disposition", ["scope"] = "mine" };
        await ProblemAsync(await CreateAsync(pm, "V2", version), HttpStatusCode.BadRequest);

        await ProblemAsync(await CreateAsync(pm, "Measure", Definition(typeId, "median")), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Scope", Definition(typeId, scope: "everyone")), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Group", Definition(typeId, groupBy: "colour")), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Group text field", Definition(typeId, groupBy: "field:notes")), HttpStatusCode.BadRequest); // TEXT, not SELECT
        await ProblemAsync(await CreateAsync(pm, "Group field of all types", Definition(null, groupBy: "field:format")), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Unknown type", Definition(99999)), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Count with field", Definition(typeId, "count", numberField: "pages")), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Sum of text", Definition(typeId, "sum", numberField: "notes", numberUnit: "GB")), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Sum without unit", Definition(typeId, "sum", numberField: "pages")), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Sum without default", Definition(noSizeType, "sum")), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "All types with field", Definition(null, "sum", numberField: "pages", numberUnit: "Items")), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Bad chart", new Dictionary<string, object?> { ["v"] = 1, ["measure"] = "count", ["groupBy"] = "matter", ["scope"] = "mine", ["chart"] = "radar" }), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Bad disposition", new Dictionary<string, object?> { ["v"] = 1, ["measure"] = "count", ["groupBy"] = "matter", ["scope"] = "mine", ["dispositions"] = new[] { "GONE" } }), HttpStatusCode.BadRequest);
        await ProblemAsync(await CreateAsync(pm, "Unknown matter", new Dictionary<string, object?> { ["v"] = 1, ["measure"] = "count", ["groupBy"] = "matter", ["scope"] = "mine", ["matterIds"] = new[] { 99999 } }), HttpStatusCode.BadRequest);

        // Legal ones: a select field, the default size field by name (its unit is the type's), an override with its own unit, all types with Count.
        var bySelect = await OkAsync(await CreateAsync(pm, "By format", Definition(typeId, groupBy: "field:format")), HttpStatusCode.Created);
        bySelect.GetProperty("definition").GetProperty("groupBy").GetString().ShouldBe("field:format");
        var byDefault = await OkAsync(await CreateAsync(pm, "Default named", Definition(typeId, "sum", numberField: "volume_gb", numberUnit: "MB")), HttpStatusCode.Created);
        byDefault.GetProperty("definition").GetProperty("numberUnit").ValueKind.ShouldBe(JsonValueKind.Null);
        await OkAsync(await CreateAsync(pm, "All types", Definition(null)), HttpStatusCode.Created);
        await OkAsync(await CreateAsync(pm, "All types sum", Definition(null, "sum", "assetType")), HttpStatusCode.Created);
    }

    [Fact]
    public async Task Names_are_unique_per_person_and_a_person_keeps_at_most_fifty_reports()
    {
        var typeId = await TypeWithFormAsync();
        var pm = await PmAsync();
        var first = await OkAsync(await CreateAsync(pm, "Report", Definition(typeId)), HttpStatusCode.Created);
        var duplicate = await ProblemAsync(await CreateAsync(pm, " report ", Definition(typeId)), HttpStatusCode.Conflict, "DUPLICATE_NAME");
        duplicate.GetProperty("meta").GetProperty("existingId").GetInt32().ShouldBe(first.GetProperty("assetReportId").GetInt32());

        for (var i = 2; i <= 50; i++)
            await OkAsync(await CreateAsync(pm, $"Report {i}", Definition(typeId)), HttpStatusCode.Created);

        await ProblemAsync(await CreateAsync(pm, "One too many", Definition(typeId)), HttpStatusCode.Conflict, "REPORT_LIMIT_REACHED");
        (await OkAsync(await pm.GetAsync("/api/v1/asset-reports"))).GetArrayLength().ShouldBe(50);
    }

    [Fact]
    public async Task A_stale_row_version_is_a_conflict_and_renaming_to_an_existing_name_is_refused()
    {
        var typeId = await TypeWithFormAsync();
        var pm = await PmAsync();
        var a = await OkAsync(await CreateAsync(pm, "A", Definition(typeId)), HttpStatusCode.Created);
        await OkAsync(await CreateAsync(pm, "B", Definition(typeId)), HttpStatusCode.Created);
        var id = a.GetProperty("assetReportId").GetInt32();

        await ProblemAsync(await pm.PutAsJsonAsync($"/api/v1/asset-reports/{id}", new { name = "B", definition = Definition(typeId), rowVersion = a.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "DUPLICATE_NAME");
        var renamed = await OkAsync(await pm.PutAsJsonAsync($"/api/v1/asset-reports/{id}", new { name = "A2", definition = Definition(typeId), rowVersion = a.GetProperty("rowVersion").GetString() }));
        renamed.GetProperty("rowVersion").GetString().ShouldNotBe(a.GetProperty("rowVersion").GetString());
        await ProblemAsync(await pm.PutAsJsonAsync($"/api/v1/asset-reports/{id}", new { name = "A3", definition = Definition(typeId), rowVersion = a.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
    }

    [Fact]
    public async Task The_fields_endpoint_offers_number_fields_group_by_choices_and_the_default_size()
    {
        var typeId = await TypeWithFormAsync();
        var pm = await PmAsync();

        var fields = await OkAsync(await pm.GetAsync($"/api/v1/asset-reports/fields?assetTypeId={typeId}"));
        fields.GetProperty("defaultSizeFieldKey").GetString().ShouldBe("volume_gb");
        fields.GetProperty("defaultSizeUnit").GetString().ShouldBe("GB");
        var numbers = fields.GetProperty("numberFields").EnumerateArray().ToDictionary(f => f.GetProperty("key").GetString()!);
        numbers.Keys.ShouldBe(["volume_gb", "pages"], ignoreOrder: true);
        numbers["volume_gb"].GetProperty("isDefaultSize").GetBoolean().ShouldBeTrue();
        numbers["volume_gb"].GetProperty("unit").GetString().ShouldBe("GB");
        numbers["pages"].GetProperty("unit").ValueKind.ShouldBe(JsonValueKind.Null);
        fields.GetProperty("groupBy").EnumerateArray().Select(g => g.GetProperty("key").GetString())
            .ShouldBe(["disposition", "matter", "client", "assetType", "field:format"]);

        var all = await OkAsync(await pm.GetAsync("/api/v1/asset-reports/fields"));
        all.GetProperty("numberFields").GetArrayLength().ShouldBe(0);
        all.GetProperty("groupBy").GetArrayLength().ShouldBe(4);
        (await pm.GetAsync("/api/v1/asset-reports/fields?assetTypeId=99999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await pm.GetAsync("/api/v1/asset-reports/fields?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
