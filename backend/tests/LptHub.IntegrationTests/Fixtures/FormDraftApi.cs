using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>
/// Saves and publishes form drafts the way the UI does: the draft's row version is mandatory (security review SEC-09), so the helper
/// reads the current one, sends it back and returns the raw response.
/// </summary>
public static class FormDraftApi
{
    public static async Task<string> RowVersionAsync(HttpClient client, int definitionId, int versionId)
    {
        var versions = await client.GetFromJsonAsync<JsonElement>($"/api/v1/forms/{definitionId}/versions");
        return versions.EnumerateArray()
            .Single(v => v.GetProperty("formVersionId").GetInt32() == versionId)
            .GetProperty("rowVersion").GetString()!;
    }

    /// <summary>PUTs the draft body (<c>{"fields":[...]}</c>) with the given row version, or the current one when none is given.</summary>
    public static async Task<HttpResponseMessage> SaveAsync(HttpClient client, int definitionId, int versionId, string bodyJson, string? rowVersion = null)
    {
        var body = JsonNode.Parse(bodyJson)!.AsObject();
        body["rowVersion"] = rowVersion ?? await RowVersionAsync(client, definitionId, versionId);
        return await client.PutAsync($"/api/v1/forms/{definitionId}/versions/{versionId}", new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"));
    }

    /// <summary>Publishes the draft with its current row version.</summary>
    public static async Task<HttpResponseMessage> PublishAsync(HttpClient client, int definitionId, int versionId, string? rowVersion = null) =>
        await client.PostAsync(
            $"/api/v1/forms/{definitionId}/versions/{versionId}/publish?rowVersion={Uri.EscapeDataString(rowVersion ?? await RowVersionAsync(client, definitionId, versionId))}",
            null);
}
