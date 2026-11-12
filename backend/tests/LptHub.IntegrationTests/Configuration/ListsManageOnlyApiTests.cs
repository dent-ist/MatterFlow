using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.Identity.Contracts;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;

namespace LptHub.IntegrationTests.Configuration;

/// <summary>
/// Administration > Lists (epic #1314, backend check #1316 gap 1): a person who holds ONLY one list's Manage permission can load that list, and
/// gets 403 <c>PERMISSION_DENIED</c> on the lists they do not hold. The catalogue is driven by the Manage permissions alone, so each of these
/// personas must be able to open its lists without <c>Task.View</c>, <c>Matter.View</c> or <c>MatterNote.View</c>:
/// <c>MatterList.Manage</c> (Matter Types, Matter Categories, Current States, Team Titles), <c>OnHoldReason.Manage</c> (On-Hold Reasons) and
/// <c>StatusLabel.Manage</c> (Status Labels and, by the owner decision, Note Tags with <c>includeInactive=true</c>) and
/// <c>Vendor.Manage</c> (Vendor Services and Vendor Areas, epic #1373).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class ListsManageOnlyApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly string[] AllLists =
    [
        "/api/v1/matter-types",
        "/api/v1/matter-categories",
        "/api/v1/current-states",
        "/api/v1/team-titles",
        "/api/v1/priorities",
        "/api/v1/status-labels",
        "/api/v1/on-hold-reasons",
        "/api/v1/note-tags?includeInactive=true",
        "/api/v1/asset-link-roles",
        "/api/v1/vendor-services",
        "/api/v1/vendor-areas",
    ];

    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<HttpClient> UserWithAsync(string user, string permission)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-LptHub-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Role " + user, [permission]));
        return client;
    }

    private static async Task ShouldLoadAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, $"{url}: {await response.Content.ReadAsStringAsync()}");
        (await response.Content.ReadFromJsonAsync<JsonElement>()).ValueKind.ShouldBe(JsonValueKind.Array, url);
    }

    private static async Task ShouldBeDeniedAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden, $"{url}: {await response.Content.ReadAsStringAsync()}");
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().ShouldBe("PERMISSION_DENIED", url);
    }

    private static async Task AssertOnlyAsync(HttpClient person, params string[] allowed)
    {
        foreach (var url in AllLists)
        {
            if (allowed.Contains(url))
                await ShouldLoadAsync(person, url);
            else
                await ShouldBeDeniedAsync(person, url);
        }
    }

    [Fact]
    public async Task MatterList_Manage_alone_loads_the_four_matter_lists_and_nothing_else()
    {
        var person = await UserWithAsync(@"KE\mlonly", Permissions.MatterList.Manage);
        await AssertOnlyAsync(person, "/api/v1/matter-types", "/api/v1/matter-categories", "/api/v1/current-states", "/api/v1/team-titles");
    }

    [Fact]
    public async Task OnHoldReason_Manage_alone_loads_on_hold_reasons_and_nothing_else()
    {
        var person = await UserWithAsync(@"KE\ohonly", Permissions.OnHoldReason.Manage);
        await AssertOnlyAsync(person, "/api/v1/on-hold-reasons");
    }

    [Fact]
    public async Task StatusLabel_Manage_alone_loads_status_labels_and_note_tags_and_nothing_else()
    {
        var person = await UserWithAsync(@"KE\slonly", Permissions.StatusLabel.Manage);
        await AssertOnlyAsync(person, "/api/v1/status-labels", "/api/v1/note-tags?includeInactive=true");
    }

    [Fact]
    public async Task Vendor_Manage_alone_loads_the_services_and_areas_lists_and_nothing_else()
    {
        var person = await UserWithAsync(@"KE\vmonly", Permissions.Vendor.Manage);
        await AssertOnlyAsync(person, "/api/v1/vendor-services", "/api/v1/vendor-areas");
    }

    [Fact]
    public async Task Vendor_View_alone_loads_the_services_and_areas_lists_for_the_vendor_form()
    {
        var person = await UserWithAsync(@"KE\vvonly", Permissions.Vendor.View);
        await AssertOnlyAsync(person, "/api/v1/vendor-services", "/api/v1/vendor-areas");
    }
}
