using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Identity.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>The assignee lookup (Create Task) through the full HTTP pipeline: active users only, id and name only, Task.Assign required.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class UsersLookupApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<int> ProvisionAsync(string account) =>
        (await JsonAsync(await As(account).GetAsync("/api/v1/me"))).GetProperty("userId").GetInt32();

    [Fact]
    public async Task Lookup_returns_active_users_by_name_without_account_details()
    {
        await ProvisionAsync(@"KE\tariq");
        var leaver = await ProvisionAsync(@"KE\leaver");
        // Only users who hold a role are offered (Access Pending users cannot open Tasks; SEC2-14).
        var assignable = await _factory.CreateRoleAsync("Assignable", "Task.View");
        await _factory.GrantRoleAsync(@"KE\tariq", assignable);
        await _factory.GrantRoleAsync(@"KE\leaver", assignable);
        await _factory.WithDbAsync(async db =>
        {
            (await db.Set<AppUser>().SingleAsync(u => u.Id == leaver)).IsActive = false;
            await db.SaveChangesAsync();
        });

        var found = await JsonAsync(await As(@"KE\scientist").GetAsync("/api/v1/users/lookup?q=tariq"));
        var item = found.EnumerateArray().Single();
        item.GetProperty("displayName").GetString().ShouldBe(@"KE\tariq");
        item.EnumerateObject().Select(p => p.Name).Order().ShouldBe(["availability", "displayName", "lastAssignedUtc", "openTaskCount", "reason", "suggested", "userId"]); // no email, account name or roles

        (await JsonAsync(await As(@"KE\scientist").GetAsync("/api/v1/users/lookup")))
            .EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ShouldNotContain(leaver);
    }

    [Fact]
    public async Task Sec2_14_access_pending_users_are_not_offered_as_assignees()
    {
        var pending = await ProvisionAsync(@"KE\pendingperson");
        var withRole = await ProvisionAsync(@"KE\roleperson");
        var roleId = await _factory.CreateRoleAsync("Lookup role", "Task.View");
        await _factory.GrantRoleAsync(@"KE\roleperson", roleId);

        var ids = (await JsonAsync(await As(@"KE\scientist").GetAsync("/api/v1/users/lookup?limit=50")))
            .EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ToArray();
        ids.ShouldContain(withRole);
        ids.ShouldNotContain(pending);
    }

    [Fact]
    public async Task Lookup_needs_Task_Assign()
    {
        var denied = await As(@"KE\nobody").GetAsync("/api/v1/users/lookup");
        denied.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await As(@"KE\scientist").GetAsync("/api/v1/users/lookup?limit=0")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
