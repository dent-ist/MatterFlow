using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// The asset type list and record carry the numbers the Asset Types page shows (#627): <c>fieldCount</c> and <c>publishedAtUtc</c> of the published
/// form, <c>draftVersionNo</c> of the open draft and <c>assetCount</c>, which is null (not 0) for a person without <c>Asset.View</c>. The list uses a
/// fixed number of statements however many types it shows.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetTypeSummaryApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user = DatabaseApiFactory.AdminAccount)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private async Task<HttpClient> UserWithAsync(string user, params string[] permissions)
    {
        var client = As(user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK); // JIT-provisions the user
        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Role " + user, permissions));
        return client;
    }

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return JsonDocument.Parse(body).RootElement;
    }

    private static int? Number(JsonElement item, string name) => item.GetProperty(name).ValueKind == JsonValueKind.Null ? null : item.GetProperty(name).GetInt32();

    private static string Field(string key, bool required = false) =>
        $$"""{"key":"{{key}}","label":"{{key.ToUpperInvariant()}}","control":"TEXT"{{(required ? ",\"required\":true" : string.Empty)}}}""";

    private async Task<int> CreateTypeAsync(string name) =>
        (await OkAsync(await As().PostAsJsonAsync("/api/v1/asset-types", new { name }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();

    private async Task<int> DefinitionOfAsync(int typeId) =>
        (await OkAsync(await As().GetAsync($"/api/v1/forms/by-owner?ownerKind=AssetType&ownerId={typeId}"))).GetProperty("formDefinitionId").GetInt32();

    private async Task<int> NewDraftAsync(int definitionId) =>
        (await OkAsync(await As().PostAsync($"/api/v1/forms/{definitionId}/versions", new StringContent("{}", Encoding.UTF8, "application/json")), HttpStatusCode.Created))
            .GetProperty("version").GetProperty("formVersionId").GetInt32();

    private async Task PublishAsync(int typeId, params string[] fields)
    {
        var admin = As();
        var definitionId = await DefinitionOfAsync(typeId);
        var versionId = await NewDraftAsync(definitionId);
        await OkAsync(await FormDraftApi.SaveAsync(admin, definitionId, versionId, $$"""{"fields":[{{string.Join(",", fields)}}]}"""));
        await OkAsync(await FormDraftApi.PublishAsync(admin, definitionId, versionId));
    }

    private static JsonElement Named(JsonElement page, string name) =>
        page.GetProperty("items").EnumerateArray().Single(t => t.GetProperty("name").GetString() == name);

    [Fact]
    public async Task The_list_and_the_record_carry_the_form_summary_of_each_type()
    {
        var before = DateTime.UtcNow.AddMinutes(-1);
        await CreateTypeAsync("No form yet");
        var published = await CreateTypeAsync("Published only");
        await PublishAsync(published, Field("a", true), Field("b"), Field("c"));
        var both = await CreateTypeAsync("Published and draft");
        await PublishAsync(both, Field("a"), Field("b"));
        await NewDraftAsync(await DefinitionOfAsync(both));
        var draftOnly = await CreateTypeAsync("Draft only");
        await NewDraftAsync(await DefinitionOfAsync(draftOnly));

        var page = await OkAsync(await As().GetAsync("/api/v1/asset-types"));

        var none = Named(page, "No form yet");
        Number(none, "fieldCount").ShouldBeNull("nothing is published");
        none.GetProperty("publishedAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        Number(none, "draftVersionNo").ShouldBeNull();
        Number(none, "publishedFormVersionNo").ShouldBeNull();

        var one = Named(page, "Published only");
        Number(one, "fieldCount").ShouldBe(3);
        Number(one, "publishedFormVersionNo").ShouldBe(1);
        one.GetProperty("publishedAtUtc").GetDateTime().ShouldBeGreaterThan(before);
        one.GetProperty("publishedAtUtc").GetDateTime().Kind.ShouldBe(DateTimeKind.Utc);
        Number(one, "draftVersionNo").ShouldBeNull();

        var two = Named(page, "Published and draft");
        Number(two, "fieldCount").ShouldBe(2, "the numbers are the published version's, not the draft's");
        Number(two, "draftVersionNo").ShouldBe(2);

        var draft = Named(page, "Draft only");
        Number(draft, "fieldCount").ShouldBeNull();
        Number(draft, "draftVersionNo").ShouldBe(1);

        // The record carries the same numbers as its row.
        var record = await OkAsync(await As().GetAsync($"/api/v1/asset-types/{both}"));
        Number(record, "fieldCount").ShouldBe(2);
        Number(record, "draftVersionNo").ShouldBe(2);
        record.GetProperty("publishedAtUtc").GetDateTime().ShouldBe(Named(page, "Published and draft").GetProperty("publishedAtUtc").GetDateTime());
        Number(await OkAsync(await As().GetAsync($"/api/v1/asset-types/{draftOnly}")), "fieldCount").ShouldBeNull();
    }

    [Fact]
    public async Task The_asset_count_is_null_without_Asset_View_and_a_number_with_it()
    {
        var typeId = await CreateTypeAsync("Counted");

        // A type manager reads the list (TY-P) but may not see Assets: null, never a made-up 0.
        var manager = await UserWithAsync(@"KE\typemanager", "AssetType.Manage");
        var seen = await OkAsync(await manager.GetAsync("/api/v1/asset-types"));
        Number(Named(seen, "Counted"), "assetCount").ShouldBeNull();
        Number(await OkAsync(await manager.GetAsync($"/api/v1/asset-types/{typeId}")), "assetCount").ShouldBeNull();
        var created = await OkAsync(await manager.PostAsJsonAsync("/api/v1/asset-types", new { name = "Made by manager" }), HttpStatusCode.Created);
        created.GetProperty("assetCount").ValueKind.ShouldBe(JsonValueKind.Null);

        // Asset.View alone reads with the number; the administrator too.
        var viewer = await UserWithAsync(@"KE\assetviewer", "Asset.View");
        Number(Named(await OkAsync(await viewer.GetAsync("/api/v1/asset-types")), "Counted"), "assetCount").ShouldBe(0);
        Number(Named(await OkAsync(await As().GetAsync("/api/v1/asset-types")), "Counted"), "assetCount").ShouldBe(0);

        // Neither permission: refused, as before.
        var nobody = await UserWithAsync(@"KE\nobody", "Client.View");
        (await nobody.GetAsync("/api/v1/asset-types")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PostAsJsonAsync("/api/v1/asset-types", new { name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_number_of_statements_does_not_grow_with_the_number_of_types()
    {
        var commands = new CommandLog();
        using var logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(commands);
        })));
        var http = logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        async Task<(int Statements, int Rows)> MeasureAsync()
        {
            await OkAsync(await http.GetAsync("/api/v1/asset-types"));
            commands.Clear();
            var page = await OkAsync(await http.GetAsync("/api/v1/asset-types"));
            return (commands.Snapshot().Count, page.GetProperty("items").GetArrayLength());
        }

        await PublishAsync(await CreateTypeAsync("First"), Field("a"));
        var few = await MeasureAsync();
        for (var i = 0; i < 14; i++)
        {
            var id = await CreateTypeAsync($"Bulk {i:D2}");
            if (i % 3 == 0)
                await PublishAsync(id, Field("a"), Field("b"));
        }

        var many = await MeasureAsync();
        few.Rows.ShouldBe(1);
        many.Rows.ShouldBe(15);
        many.Statements.ShouldBe(few.Statements, "a fixed number of statements, none per type");
    }
}
