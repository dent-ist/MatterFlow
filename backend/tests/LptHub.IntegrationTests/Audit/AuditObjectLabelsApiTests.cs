using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;

namespace MatterFlow.IntegrationTests.Audit;

/// <summary>
/// <c>object.label</c> for the Administration records (#649): asset types, priorities, status labels, link roles, roles and form definitions read
/// "Relativity Workspace", not "#6". A renamed record shows its new name, a deleted one keeps the last name its events stored, and the number of
/// statements does not grow with the number of events on the page.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AuditObjectLabelsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private HttpClient _admin = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _admin = Client(DatabaseApiFactory.AdminAccount);
        (await _admin.GetAsync("/api/v1/me")).EnsureSuccessStatusCode();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient Client(string user, Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>? factory = null)
    {
        var client = (factory ?? _factory).CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return body.Length == 0 ? default : JsonDocument.Parse(body).RootElement;
    }

    private async Task<string?> LabelOfAsync(HttpClient client, string type, string id)
    {
        var page = await OkAsync(await client.GetAsync($"/api/v1/audit/search?objectType={type}&objectId={id}&pageSize=200"));
        var items = page.GetProperty("items").EnumerateArray().ToList();
        items.ShouldNotBeEmpty($"{type} {id} has events");
        var labels = items.Select(i => i.GetProperty("object").GetProperty("label")).Select(l => l.ValueKind == JsonValueKind.Null ? null : l.GetString()).Distinct().ToList();
        labels.Count.ShouldBe(1, "every event of one object carries the same label");
        return labels[0];
    }

    [Fact]
    public async Task Each_administration_record_reads_by_its_name_and_a_rename_shows_the_new_name()
    {
        var typeId = (await OkAsync(await _admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Relativity Workspace" }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();
        var priority = await OkAsync(await _admin.PostAsJsonAsync("/api/v1/priorities", new { label = "Rush", color = "high" }), HttpStatusCode.Created);
        var priorityId = priority.GetProperty("id").GetInt32();
        var role = await OkAsync(await _admin.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = "Source copy" }), HttpStatusCode.Created);
        var roleId = role.GetProperty("id").GetInt32();
        var appRole = await OkAsync(await _admin.PostAsJsonAsync("/api/v1/roles", new { name = "Auditors", permissionCodes = new[] { "Audit.View" } }), HttpStatusCode.Created);
        var appRoleId = appRole.GetProperty("roleId").GetInt32();
        var definition = await OkAsync(await _admin.GetAsync($"/api/v1/forms/by-owner?ownerKind=AssetType&ownerId={typeId}"));
        var definitionId = definition.GetProperty("formDefinitionId").GetInt32();
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(
            "INSERT INTO dbo.AuditEvent (OccurredAtUtc, EventType, ObjectType, ObjectId, Summary, CorrelationId) VALUES (SYSUTCDATETIME(), 'FORM_PUBLISHED', 'FormDefinition', {0}, 'v1', NEWID())",
            definitionId.ToString(System.Globalization.CultureInfo.InvariantCulture)));

        (await LabelOfAsync(_admin, "AssetType", typeId.ToString())).ShouldBe("Relativity Workspace");
        (await LabelOfAsync(_admin, "Priority", priorityId.ToString())).ShouldBe("Rush");
        (await LabelOfAsync(_admin, "AssetLinkRole", roleId.ToString())).ShouldBe("Source copy");
        (await LabelOfAsync(_admin, "Role", appRoleId.ToString())).ShouldBe("Auditors");
        (await LabelOfAsync(_admin, "FormDefinition", definitionId.ToString())).ShouldBe("Relativity Workspace fields");
        var statuses = await OkAsync(await _admin.GetAsync("/api/v1/status-labels"));
        var onHold = statuses.EnumerateArray().Single(l => l.GetProperty("code").GetString() == "ON_HOLD");
        await OkAsync(await _admin.PutAsJsonAsync("/api/v1/status-labels/ON_HOLD", new { displayLabel = "Paused", rowVersion = onHold.GetProperty("rowVersion").GetString() }));
        (await LabelOfAsync(_admin, "StatusLabel", "ON_HOLD")).ShouldBe("Paused");

        // A rename: the events of the object, old and new, read by the current name.
        var type = await OkAsync(await _admin.GetAsync($"/api/v1/asset-types/{typeId}"));
        await OkAsync(await _admin.PutAsJsonAsync($"/api/v1/asset-types/{typeId}", new
        {
            name = "Relativity Workspace v2",
            description = (string?)null,
            sortOrder = type.GetProperty("sortOrder").GetInt32(),
            isActive = true,
            rowVersion = type.GetProperty("rowVersion").GetString(),
        }));
        (await LabelOfAsync(_admin, "AssetType", typeId.ToString())).ShouldBe("Relativity Workspace v2");
        (await LabelOfAsync(_admin, "FormDefinition", definitionId.ToString())).ShouldBe("Relativity Workspace v2 fields");
    }

    [Fact]
    public async Task A_deleted_record_keeps_the_name_its_events_stored()
    {
        var priority = await OkAsync(await _admin.PostAsJsonAsync("/api/v1/priorities", new { label = "Temporary", color = "low" }), HttpStatusCode.Created);
        var id = priority.GetProperty("id").GetInt32();
        var role = await OkAsync(await _admin.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = "Scratch role" }), HttpStatusCode.Created);
        var roleId = role.GetProperty("id").GetInt32();

        (await _admin.DeleteAsync($"/api/v1/priorities/{id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await _admin.DeleteAsync($"/api/v1/asset-link-roles/{roleId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await LabelOfAsync(_admin, "Priority", id.ToString())).ShouldBe("Temporary");
        (await LabelOfAsync(_admin, "AssetLinkRole", roleId.ToString())).ShouldBe("Scratch role");
    }

    [Fact]
    public async Task The_number_of_statements_does_not_grow_with_the_number_of_events()
    {
        var commands = new CommandLog();
        using var logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(commands);
        })));
        var http = Client(DatabaseApiFactory.AdminAccount, logged);

        async Task Insert(int count) => await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO dbo.AuditEvent (OccurredAtUtc, EventType, ObjectType, ObjectId, FieldKey, OldValue, NewValue, CorrelationId)
            SELECT TOP ({0}) DATEADD(SECOND, -n, SYSUTCDATETIME()), 'FIELD_CHANGED',
                   CASE n % 5 WHEN 0 THEN 'AssetType' WHEN 1 THEN 'Priority' WHEN 2 THEN 'AssetLinkRole' WHEN 3 THEN 'Role' ELSE 'FormDefinition' END,
                   CAST(n AS VARCHAR(10)), 'Name', 'old', 'name ' + CAST(n AS VARCHAR(10)), NEWID()
            FROM (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_columns) x
            """,
            count));

        async Task<int> MeasureAsync(int size)
        {
            await OkAsync(await http.GetAsync($"/api/v1/audit/search?pageSize={size}"));
            commands.Clear();
            var page = await OkAsync(await http.GetAsync($"/api/v1/audit/search?pageSize={size}"));
            page.GetProperty("items").GetArrayLength().ShouldBe(size);
            return commands.Snapshot().Count;
        }

        await Insert(50);
        var few = await MeasureAsync(50);
        await Insert(200);
        var many = await MeasureAsync(200);
        many.ShouldBe(few, "a fixed number of statements, none per event");
    }
}
