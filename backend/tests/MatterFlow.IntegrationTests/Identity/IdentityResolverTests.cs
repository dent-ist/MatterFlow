using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Identity.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>Security review SEC-06 (bootstrap), SEC-07 (audit of provisioning, bootstrap and renames), SEC-13 (self-edit after cache expiry).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class IdentityResolverTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static HttpClient Client(WebApplicationFactoryLike factory, string user)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private HttpClient As(string user) => Client(new WebApplicationFactoryLike(_factory.CreateClient), user);

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<int> UserIdAsync(string account) =>
        (await JsonAsync(await As(account).GetAsync("/api/v1/me"))).GetProperty("userId").GetInt32();

    private Task<int> AuditCountAsync(string eventType, int userId) =>
        _factory.WithDbAsync(db => db.Database.SqlQuery<int>(
            $"SELECT COUNT(*) AS [Value] FROM dbo.AuditEvent WHERE EventType = {eventType} AND ObjectType = 'User' AND ObjectId = {userId.ToString()}").SingleAsync());

    [Fact]
    public async Task Provisioning_and_bootstrap_leave_audit_events()
    {
        var admin = await UserIdAsync(@"KE\KeKim");
        var other = await UserIdAsync(@"KE\newhire");

        (await AuditCountAsync("USER_PROVISIONED", admin)).ShouldBe(1);
        (await AuditCountAsync("USER_PROVISIONED", other)).ShouldBe(1);
        (await AuditCountAsync("ADMIN_BOOTSTRAPPED", admin)).ShouldBe(1);
        (await AuditCountAsync("ADMIN_BOOTSTRAPPED", other)).ShouldBe(0);

        // Repeated sign-ins do not repeat the events.
        _factory.InvalidateAll();
        await UserIdAsync(@"KE\KeKim");
        (await AuditCountAsync("USER_PROVISIONED", admin)).ShouldBe(1);
        (await AuditCountAsync("ADMIN_BOOTSTRAPPED", admin)).ShouldBe(1);
    }

    [Fact]
    public async Task Concurrent_first_requests_write_exactly_one_provisioning_event_for_the_right_user()
    {
        var responses = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => As(@"KE\racer").GetAsync("/api/v1/me")));
        responses.ShouldAllBe(r => r.StatusCode == HttpStatusCode.OK);
        var userId = (await JsonAsync(responses[0])).GetProperty("userId").GetInt32();

        (await AuditCountAsync("USER_PROVISIONED", userId)).ShouldBe(1);
        (await _factory.WithDbAsync(db => db.Database.SqlQuery<int>($"SELECT COUNT(*) AS [Value] FROM dbo.AuditEvent WHERE EventType = 'USER_PROVISIONED'").SingleAsync()))
            .ShouldBe(1);
    }

    [Fact]
    public async Task A_renamed_account_is_recorded()
    {
        var userId = await UserIdAsync(@"KE\Alice");
        _factory.InvalidateAll();

        // Same Dev subject (lower-cased name), different spelling: the directory rename case.
        await UserIdAsync(@"ke\ALICE");

        (await AuditCountAsync("USER_IDENTITY_RENAMED", userId)).ShouldBe(1);
        (await _factory.WithDbAsync(db => db.Set<UserIdentity>().Where(i => i.UserId == userId).Select(i => i.Username).SingleAsync())).ShouldBe(@"ke\ALICE");
    }

    [Fact]
    public async Task Bootstrap_is_not_applied_to_a_listed_name_while_an_active_system_admin_exists()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        await using var twoListed = factory.WithWebHostBuilder(b => b.UseSetting("Bootstrap:SystemAdmins:1", @"KE\second"));
        HttpClient Listed(string user) => Client(new WebApplicationFactoryLike(twoListed.CreateClient), user);

        var first = await JsonAsync(await Listed(@"KE\kekim").GetAsync("/api/v1/me"));
        first.GetProperty("isSystemAdmin").GetBoolean().ShouldBeTrue();

        var second = await JsonAsync(await Listed(@"KE\second").GetAsync("/api/v1/me"));
        second.GetProperty("isSystemAdmin").GetBoolean().ShouldBeFalse();
        second.GetProperty("isPending").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task A_recycled_account_name_does_not_inherit_system_admin()
    {
        var original = await UserIdAsync(@"KE\kekim");

        // The directory account was deleted and its name reused by another person: a new identity (new subject) with the same name.
        await _factory.WithDbAsync(async db =>
        {
            var identity = await db.Set<UserIdentity>().SingleAsync(i => i.UserId == original);
            identity.ProviderSubject = "an-old-sid";
            await db.SaveChangesAsync();
        });
        _factory.InvalidateAll();

        var impostor = await JsonAsync(await As(@"KE\kekim").GetAsync("/api/v1/me"));

        impostor.GetProperty("userId").GetInt32().ShouldNotBe(original);
        impostor.GetProperty("isSystemAdmin").GetBoolean().ShouldBeFalse();
        impostor.GetProperty("isPending").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task An_admin_editing_their_own_profile_right_after_the_cache_expired_succeeds()
    {
        var admin = As(@"KE\kekim");
        var userId = (await JsonAsync(await admin.GetAsync("/api/v1/me"))).GetProperty("userId").GetInt32();
        var detail = await JsonAsync(await admin.GetAsync($"/api/v1/users/{userId}"));
        var rowVersion = detail.GetProperty("rowVersion").GetString();

        // Cache expiry with a stale last-login stamp: the resolver does its bookkeeping inside the very request that edits the user.
        await _factory.WithDbAsync(async db =>
            await db.Set<UserIdentity>().Where(i => i.UserId == userId).ExecuteUpdateAsync(s => s.SetProperty(i => i.LastLoginAt, DateTime.UtcNow.AddHours(-3))));
        _factory.InvalidateAll();

        var edit = await admin.PutAsJsonAsync($"/api/v1/users/{userId}", new { displayName = "Kim Admin", email = "kim@firm.test", rowVersion });

        edit.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(edit)).GetProperty("displayName").GetString().ShouldBe("Kim Admin");
        (await _factory.WithDbAsync(db => db.Set<UserIdentity>().Where(i => i.UserId == userId).Select(i => i.LastLoginAt!.Value).SingleAsync()))
            .ShouldBeGreaterThan(DateTime.UtcNow.AddMinutes(-5)); // the bookkeeping did happen
    }

    /// <summary>Tiny adapter so the helper can take the clients of two different factories.</summary>
    private sealed class WebApplicationFactoryLike(Func<HttpClient> create)
    {
        public HttpClient CreateClient() => create();
    }
}
