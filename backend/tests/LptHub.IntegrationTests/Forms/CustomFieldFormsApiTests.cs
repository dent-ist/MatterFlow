using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;

namespace MatterFlow.IntegrationTests.Forms;

/// <summary>
/// <c>GET /api/v1/forms/custom-fields</c> (#643): the Client, Matter and Project custom-field forms with their numbers, read-only. Looking creates no
/// form definition and writes no audit event (the Custom Fields page used to POST the ensure call three times on every visit); the first Edit fields
/// still provisions the definition; the numbers are the published version's; the permission is <c>CustomField.Manage</c>; a fixed number of statements.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class CustomFieldFormsApiTests(SqlServerFixture sql) : IAsyncLifetime
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

    private static string Field(string key, bool required = false) =>
        $$"""{"key":"{{key}}","label":"{{key.ToUpperInvariant()}}","control":"TEXT"{{(required ? ",\"required\":true" : string.Empty)}}}""";

    private static JsonElement Of(JsonElement list, string kind) => list.EnumerateArray().Single(o => o.GetProperty("ownerKind").GetString() == kind);

    private static int? Number(JsonElement item, string name) => item.GetProperty(name).ValueKind == JsonValueKind.Null ? null : item.GetProperty(name).GetInt32();

    private async Task<int> EnsureAsync(string kind) =>
        (await OkAsync(await As().PostAsJsonAsync("/api/v1/forms", new { ownerKind = kind }))).GetProperty("formDefinitionId").GetInt32();

    private async Task<int> NewDraftAsync(int definitionId) =>
        (await OkAsync(await As().PostAsync($"/api/v1/forms/{definitionId}/versions", new StringContent("{}", Encoding.UTF8, "application/json")), HttpStatusCode.Created))
            .GetProperty("version").GetProperty("formVersionId").GetInt32();

    private async Task PublishAsync(string kind, params string[] fields)
    {
        var admin = As();
        var definitionId = await EnsureAsync(kind);
        var versionId = await NewDraftAsync(definitionId);
        await OkAsync(await FormDraftApi.SaveAsync(admin, definitionId, versionId, $$"""{"fields":[{{string.Join(",", fields)}}]}"""));
        await OkAsync(await FormDraftApi.PublishAsync(admin, definitionId, versionId));
    }

    private async Task<int> DefinitionEventsAsync() =>
        (await OkAsync(await As().GetAsync("/api/v1/audit/search?eventType=FORM_DEFINITION_CREATED&pageSize=100"))).GetProperty("items").GetArrayLength();

    [Fact]
    public async Task Looking_at_the_three_objects_writes_nothing()
    {
        var definitions = await _factory.CountAsync<MatterFlow.Configuration.Domain.Forms.FormDefinition>();
        var events = await DefinitionEventsAsync();

        var list = await OkAsync(await As().GetAsync("/api/v1/forms/custom-fields"));
        for (var i = 0; i < 3; i++)
            await OkAsync(await As().GetAsync("/api/v1/forms/custom-fields"));

        list.GetArrayLength().ShouldBe(3);
        list.EnumerateArray().Select(o => o.GetProperty("ownerKind").GetString()).ShouldBe(["Client", "Matter", "Project"]);
        (await _factory.CountAsync<MatterFlow.Configuration.Domain.Forms.FormDefinition>()).ShouldBe(definitions, "viewing provisions nothing");
        (await DefinitionEventsAsync()).ShouldBe(events, "viewing writes no FORM_DEFINITION_CREATED event");

        // An object that never had custom fields is "none", with no form id and no numbers.
        var matter = Of(list, "Matter");
        matter.GetProperty("state").GetString().ShouldBe("None");
        matter.GetProperty("fieldCount").GetInt32().ShouldBe(0);
        matter.GetProperty("requiredCount").GetInt32().ShouldBe(0);
        Number(matter, "publishedVersion").ShouldBeNull();
        Number(matter, "draftVersion").ShouldBeNull();
    }

    [Fact]
    public async Task The_first_Edit_fields_still_provisions_the_definition()
    {
        var events = await DefinitionEventsAsync();
        var id = await EnsureAsync("Matter"); // what the designer route calls

        (await EnsureAsync("Matter")).ShouldBe(id, "idempotent");
        (await DefinitionEventsAsync()).ShouldBe(events + 1);
        var matter = Of(await OkAsync(await As().GetAsync("/api/v1/forms/custom-fields")), "Matter");
        Number(matter, "formId").ShouldBe(id);
        matter.GetProperty("state").GetString().ShouldBe("None", "a definition without a version is still no custom fields");
    }

    [Fact]
    public async Task The_summary_follows_none_draft_published_and_published_with_a_draft()
    {
        await PublishAsync("Client", Field("a", true), Field("b", true), Field("c"));
        await PublishAsync("Matter", Field("a"));
        await NewDraftAsync(await EnsureAsync("Matter"));
        var projectDefinition = await EnsureAsync("Project");
        var draftId = await NewDraftAsync(projectDefinition);
        await OkAsync(await FormDraftApi.SaveAsync(As(), projectDefinition, draftId, $$"""{"fields":[{{Field("x")}},{{Field("y")}}]}"""));

        var me = await OkAsync(await As().GetAsync("/api/v1/me"));
        var list = await OkAsync(await As().GetAsync("/api/v1/forms/custom-fields"));

        var client = Of(list, "Client");
        client.GetProperty("state").GetString().ShouldBe("Published");
        client.GetProperty("fieldCount").GetInt32().ShouldBe(3);
        client.GetProperty("requiredCount").GetInt32().ShouldBe(2);
        Number(client, "publishedVersion").ShouldBe(1);
        client.GetProperty("publishedAtUtc").GetDateTime().ShouldBeGreaterThan(DateTime.UtcNow.AddMinutes(-2));
        client.GetProperty("publishedByName").GetString().ShouldBe(me.GetProperty("displayName").GetString());
        Number(client, "draftVersion").ShouldBeNull();

        var matter = Of(list, "Matter");
        matter.GetProperty("state").GetString().ShouldBe("Published");
        matter.GetProperty("fieldCount").GetInt32().ShouldBe(1, "the published version's numbers, not the draft's");
        Number(matter, "draftVersion").ShouldBe(2);

        var project = Of(list, "Project");
        project.GetProperty("state").GetString().ShouldBe("Draft");
        project.GetProperty("fieldCount").GetInt32().ShouldBe(0);
        project.GetProperty("draftFieldCount").GetInt32().ShouldBe(2);
        Number(project, "draftVersion").ShouldBe(1);
        Number(project, "publishedVersion").ShouldBeNull();
        project.GetProperty("publishedByName").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Only_CustomField_Manage_may_read_the_summary()
    {
        var manager = await UserWithAsync(@"KE\cfmanager", "CustomField.Manage");
        (await manager.GetAsync("/api/v1/forms/custom-fields")).StatusCode.ShouldBe(HttpStatusCode.OK);

        foreach (var (user, permission) in new[] { (@"KE\taskviewer", "Task.View"), (@"KE\typemanager", "AssetType.Manage"), (@"KE\wfmanager", "Workflow.Manage") })
        {
            var other = await UserWithAsync(user, permission);
            (await other.GetAsync("/api/v1/forms/custom-fields")).StatusCode.ShouldBe(HttpStatusCode.Forbidden, permission);
        }
    }

    [Fact]
    public async Task The_number_of_statements_is_fixed_for_empty_and_published_objects()
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

        async Task<int> MeasureAsync()
        {
            await OkAsync(await http.GetAsync("/api/v1/forms/custom-fields"));
            commands.Clear();
            await OkAsync(await http.GetAsync("/api/v1/forms/custom-fields"));
            return commands.Snapshot().Count;
        }

        var empty = await MeasureAsync();
        await PublishAsync("Client", Field("a"), Field("b"));
        await PublishAsync("Matter", Field("a"));
        await PublishAsync("Project", Field("a"), Field("b"), Field("c"));
        var populated = await MeasureAsync();

        populated.ShouldBeLessThanOrEqualTo(empty + 1, "a fixed number of statements (the publisher name lookup is the only extra), none per field");
        populated.ShouldBeLessThanOrEqualTo(8);
    }
}
