using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// Shared setup of the PM v2 asset tests (epic #851): users, clients, matters, asset types with a published form and assets, all through the HTTP API
/// against a real SQL Server.
/// </summary>
internal sealed class AssetTestKit(DatabaseApiFactory factory)
{
    public DatabaseApiFactory Factory { get; } = factory;

    public HttpClient As(string user = DatabaseApiFactory.AdminAccount)
    {
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    public async Task<HttpClient> UserWithAsync(string user, params string[] permissions)
    {
        var client = As(user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK); // JIT-provisions the user
        var roleId = await Factory.CreateRoleAsync("Role " + user, permissions);
        await Factory.GrantRoleAsync(user, roleId);
        return client;
    }

    public static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    public static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return JsonDocument.Parse(body).RootElement;
    }

    public static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string? code = null)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(status, body);
        var problem = JsonDocument.Parse(body).RootElement;
        if (code is not null)
            problem.GetProperty("code").GetString().ShouldBe(code);
        return problem;
    }

    public async Task<int> CreateClientAsync(string clientNumber = "343", string name = "Acme Corp")
    {
        var admin = As();
        var clients = await OkAsync(await admin.GetAsync($"/api/v1/clients?q={clientNumber}"));
        if (clients.GetProperty("total").GetInt32() > 0)
            return clients.GetProperty("items")[0].GetProperty("clientId").GetInt32();

        return (await OkAsync(await admin.PostAsJsonAsync("/api/v1/clients", new { clientNumber, name }), HttpStatusCode.Created)).GetProperty("clientId").GetInt32();
    }

    public async Task<int> CreateMatterAsync(string clientNumber = "343", string matterNumber = "12", string name = "Merger Review", int? primaryManagerUserId = null)
    {
        var clientId = await CreateClientAsync(clientNumber);
        var matter = await OkAsync(
            await As().PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber, name, primaryManagerUserId }),
            HttpStatusCode.Created);
        return matter.GetProperty("matterId").GetInt32();
    }

    public async Task<JsonElement> CreateTypeAsync(string name = "Document Set") =>
        await OkAsync(await As().PostAsJsonAsync("/api/v1/asset-types", new { name }), HttpStatusCode.Created);

    public static string Field(string key, string control, string extra = "") =>
        $$"""{"key":"{{key}}","label":"{{key.ToUpperInvariant()}}","control":"{{control}}"{{(extra.Length == 0 ? string.Empty : "," + extra)}}}""";

    /// <summary>Publishes a form for the Asset Type through the forms API; returns the published version id.</summary>
    public async Task<int> PublishFormAsync(int assetTypeId, params string[] fields)
    {
        var admin = As();
        var definition = await OkAsync(await admin.GetAsync($"/api/v1/forms/by-owner?ownerKind=AssetType&ownerId={assetTypeId}"));
        var definitionId = definition.GetProperty("formDefinitionId").GetInt32();
        var draft = await OkAsync(await admin.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}")), HttpStatusCode.Created);
        var versionId = draft.GetProperty("version").GetProperty("formVersionId").GetInt32();
        await OkAsync(await FormDraftApi.SaveAsync(admin, definitionId, versionId, $$"""{"fields":[{{string.Join(",", fields)}}]}"""));
        await OkAsync(await FormDraftApi.PublishAsync(admin, definitionId, versionId));
        return versionId;
    }

    public async Task<JsonElement> CreateAssetAsync(int matterId, int typeId, string name, string? formValues = null)
    {
        var values = formValues is null ? string.Empty : $$""","formValues":{{formValues}}""";
        var body = $$"""{"matterId":{{matterId}},"assetTypeId":{{typeId}},"displayName":"{{name}}"{{values}}}""";
        return await OkAsync(await As().PostAsync("/api/v1/assets", Json(body)), HttpStatusCode.Created);
    }

    public async Task<JsonElement> GetAssetAsync(int assetId) => await OkAsync(await As().GetAsync($"/api/v1/assets/{assetId}"));

    public async Task<int> IndexRowsAsync(int assetId) =>
        await Factory.WithDbAsync(db => db.Database
            .SqlQuery<int>($"SELECT COUNT(*) AS Value FROM dbo.CustomFieldIndex WHERE OwnerKind = 'ASSET' AND OwnerId = {assetId}")
            .SingleAsync());
}
