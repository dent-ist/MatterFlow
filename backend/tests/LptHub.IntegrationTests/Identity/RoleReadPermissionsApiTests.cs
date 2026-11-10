using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>
/// Users epic #453: each administration permission is enough to READ what it manages. There is no <c>Role.View</c>, so a person who holds
/// only <c>Role.Manage</c> reads the roles and the permission catalog (the Roles tab of the Users page); <c>User.View</c> keeps its reads
/// (the user drawer lists roles); a person with neither gets 403 <c>PERMISSION_DENIED</c>. Writing roles stays <c>Role.Manage</c> alone.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class RoleReadPermissionsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private int _roleId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var created = await As().PostAsJsonAsync("/api/v1/roles", new { name = "Readable role", description = (string?)null, permissionCodes = new[] { Permissions.Task.View } });
        created.StatusCode.ShouldBe(HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
        _roleId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("roleId").GetInt32();
    }

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
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Role " + user, permissions));
        return client;
    }

    private async Task ShouldBeAsync(HttpClient client, string url, HttpStatusCode expected)
    {
        var response = await client.GetAsync(url);
        response.StatusCode.ShouldBe(expected, $"{url}: {await response.Content.ReadAsStringAsync()}");
        if (expected == HttpStatusCode.Forbidden)
            (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString().ShouldBe("PERMISSION_DENIED", url);
    }

    [Fact]
    public async Task Role_Manage_alone_reads_the_roles_and_the_catalog_and_still_writes_them()
    {
        var manager = await UserWithAsync(@"KE\roleonly", Permissions.Role.Manage);
        await ShouldBeAsync(manager, "/api/v1/roles", HttpStatusCode.OK);
        await ShouldBeAsync(manager, $"/api/v1/roles/{_roleId}", HttpStatusCode.OK);
        await ShouldBeAsync(manager, "/api/v1/permissions", HttpStatusCode.OK);
        (await manager.PostAsJsonAsync("/api/v1/roles", new { name = "Made by a role manager", description = (string?)null, permissionCodes = new[] { Permissions.Role.Manage } }))
            .StatusCode.ShouldBe(HttpStatusCode.Created);
        // Writing stays Role.Manage (and the rule that nobody grants a permission they do not hold).
        // It does not open the users: that stays User.View.
        await ShouldBeAsync(manager, "/api/v1/users", HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task User_View_keeps_reading_roles_but_cannot_write_them()
    {
        var viewer = await UserWithAsync(@"KE\userview", Permissions.User.View);
        await ShouldBeAsync(viewer, "/api/v1/roles", HttpStatusCode.OK);
        await ShouldBeAsync(viewer, $"/api/v1/roles/{_roleId}", HttpStatusCode.OK);
        await ShouldBeAsync(viewer, "/api/v1/permissions", HttpStatusCode.OK);
        var write = await viewer.PostAsJsonAsync("/api/v1/roles", new { name = "Not allowed", description = (string?)null, permissionCodes = new[] { Permissions.Task.View } });
        write.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_person_with_neither_permission_gets_403()
    {
        var other = await UserWithAsync(@"KE\neither", Permissions.Task.View, Permissions.Pod.View);
        await ShouldBeAsync(other, "/api/v1/roles", HttpStatusCode.Forbidden);
        await ShouldBeAsync(other, $"/api/v1/roles/{_roleId}", HttpStatusCode.Forbidden);
        await ShouldBeAsync(other, "/api/v1/permissions", HttpStatusCode.Forbidden);
    }
}
