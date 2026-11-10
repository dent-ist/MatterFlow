using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>
/// Baseline 6.4 acceptance scenarios 1, 2 and 4 and SCN-019 against a real SQL Server, through the full HTTP pipeline with the Dev provider.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class IdentityApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        _connectionString = await sql.CreateDatabaseAsync();
        _factory = new DatabaseApiFactory(_connectionString);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string? user)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        if (user is not null)
            client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static string[] Strings(JsonElement array) => array.EnumerateArray().Select(e => e.GetString()!).ToArray();

    // ---- Scenario 1: first sign-in creates one zero-role profile

    [Fact]
    public async Task First_login_provisions_one_zero_role_user_in_access_pending()
    {
        var response = await As(@"KE\newhire").GetAsync("/api/v1/me");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var me = await JsonAsync(response);
        me.GetProperty("status").GetString().ShouldBe("ACCESS_PENDING");
        me.GetProperty("isPending").GetBoolean().ShouldBeTrue();
        me.GetProperty("displayName").GetString().ShouldBe(@"KE\newhire");
        me.GetProperty("windowsAccount").GetString().ShouldBe(@"KE\newhire");
        me.GetProperty("roles").GetArrayLength().ShouldBe(0);
        me.GetProperty("permissions").GetArrayLength().ShouldBe(0);
        me.GetProperty("isSystemAdmin").GetBoolean().ShouldBeFalse();
        me.GetProperty("registeredAtUtc").GetDateTime().ShouldBeGreaterThan(DateTime.UtcNow.AddMinutes(-5));

        await _factory.WithDbAsync(async db =>
        {
            var identity = await db.Set<UserIdentity>().Include(i => i.User).SingleAsync(i => i.Username == @"KE\newhire");
            identity.Provider.ShouldBe("Dev");
            identity.User.IsActive.ShouldBeTrue();
            (await db.Set<UserRole>().CountAsync(r => r.UserId == identity.UserId)).ShouldBe(0);
        });
    }

    // ---- Scenario 2: Access Pending users are denied everywhere except /me

    [Theory]
    [InlineData("/api/v1/test/tasks")]
    [InlineData("/api/v1/test/clients")]
    [InlineData("/api/v1/test/task-types")]
    [InlineData("/api/v1/test/no-policy")]
    public async Task Pending_user_gets_403_access_pending_on_every_other_endpoint(string path)
    {
        var client = As(@"KE\pending");
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var response = await client.GetAsync(path);

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        (await JsonAsync(response)).GetProperty("code").GetString().ShouldBe("ACCESS_PENDING");
    }

    [Fact]
    public async Task Anonymous_requests_are_rejected_with_401_except_the_allow_listed_ping()
    {
        (await As(null).GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await As(null).GetAsync("/api/v1/test/tasks")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await As(null).GetAsync("/api/v1/system/ping")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await As(null).GetAsync("/health/live")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Dev_user_can_also_be_chosen_by_query_parameter()
    {
        var response = await As(null).GetAsync(@"/api/v1/me?devUser=KE%5Cqueryuser");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(response)).GetProperty("windowsAccount").GetString().ShouldBe(@"KE\queryuser");
    }

    // ---- Scenario 4: repeated and concurrent sign-in never duplicates the user

    [Fact]
    public async Task Repeated_sign_in_resolves_to_the_same_user()
    {
        var first = await JsonAsync(await As(@"KE\repeat").GetAsync("/api/v1/me"));
        _factory.InvalidateAll(); // force the next call through the database rather than the cache
        var second = await JsonAsync(await As(@"KE\repeat").GetAsync("/api/v1/me"));
        var third = await JsonAsync(await As(@"ke\REPEAT").GetAsync("/api/v1/me"));

        second.GetProperty("userId").GetInt32().ShouldBe(first.GetProperty("userId").GetInt32());
        third.GetProperty("userId").GetInt32().ShouldBe(first.GetProperty("userId").GetInt32());
        (await _factory.WithDbAsync(db => db.Set<UserIdentity>().CountAsync(i => i.Username.ToLower() == @"ke\repeat"))).ShouldBe(1);
    }

    [Fact]
    public async Task Concurrent_first_requests_create_exactly_one_user()
    {
        var calls = Enumerable.Range(0, 12).Select(_ => As(@"KE\racer").GetAsync("/api/v1/me")).ToArray();
        var responses = await Task.WhenAll(calls);

        responses.ShouldAllBe(r => r.StatusCode == HttpStatusCode.OK);
        var ids = new HashSet<int>();
        foreach (var r in responses)
            ids.Add((await JsonAsync(r)).GetProperty("userId").GetInt32());
        ids.Count.ShouldBe(1);
        (await _factory.WithDbAsync(db => db.Set<UserIdentity>().CountAsync(i => i.Username == @"KE\racer"))).ShouldBe(1);
    }

    // ---- SCN-019: management endpoints require the management permissions

    [Fact]
    public async Task Role_without_management_permissions_cannot_call_management_endpoints()
    {
        var roleId = await _factory.CreateRoleAsync("Reader", Permissions.Task.View, Permissions.Client.View);
        await As(@"KE\reader").GetAsync("/api/v1/me");
        await _factory.GrantRoleAsync(@"KE\reader", roleId);
        var client = As(@"KE\reader");

        (await client.GetAsync("/api/v1/test/tasks")).StatusCode.ShouldBe(HttpStatusCode.OK);

        foreach (var (method, path, missing) in new[]
        {
            (HttpMethod.Get, "/api/v1/test/task-types", Permissions.TaskType.Manage),
            (HttpMethod.Post, "/api/v1/test/task-types", Permissions.TaskType.Manage),
            (HttpMethod.Get, "/api/v1/test/workflows", Permissions.Workflow.Manage),
            (HttpMethod.Put, "/api/v1/test/workflows", Permissions.Workflow.Manage),
        })
        {
            using var request = new HttpRequestMessage(method, path);
            if (method != HttpMethod.Get)
                request.Content = JsonContent.Create(new { });
            var response = await client.SendAsync(request);

            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden, $"{method} {path}");
            var problem = await JsonAsync(response);
            problem.GetProperty("code").GetString().ShouldBe("PERMISSION_DENIED");
            problem.GetProperty("meta").GetProperty("permission").GetString().ShouldBe(missing);
        }
    }

    [Fact]
    public async Task Permissions_come_from_roles_and_take_effect_immediately_when_roles_change()
    {
        var pending = As(@"KE\grantee");
        (await pending.GetAsync("/api/v1/test/task-types")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var roleId = await _factory.CreateRoleAsync("Type Manager", Permissions.TaskType.Manage);
        await _factory.GrantRoleAsync(@"KE\grantee", roleId); // invalidates the per-user cache

        var response = await pending.GetAsync("/api/v1/test/task-types");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var me = await JsonAsync(await pending.GetAsync("/api/v1/me"));
        me.GetProperty("status").GetString().ShouldBe("ACTIVE");
        Strings(me.GetProperty("roles")).ShouldBe(["Type Manager"]);
        Strings(me.GetProperty("permissions")).ShouldBe([Permissions.TaskType.Manage]);
    }

    // ---- Bootstrap, System Admin, disabled users

    [Fact]
    public async Task Bootstrap_admin_is_granted_system_admin_once_case_insensitively()
    {
        var me = await JsonAsync(await As(@"KE\KeKim").GetAsync("/api/v1/me"));

        me.GetProperty("isSystemAdmin").GetBoolean().ShouldBeTrue();
        Strings(me.GetProperty("roles")).ShouldBe(["System Admin"]);
        Strings(me.GetProperty("permissions")).Order().ShouldBe(Permissions.All.Order());
        (await As(@"KE\KeKim").GetAsync("/api/v1/test/task-types")).StatusCode.ShouldBe(HttpStatusCode.OK);

        // An admin revokes the role; the bootstrap does not re-grant on the next login.
        await _factory.WithDbAsync(async db =>
        {
            var userId = await db.Set<UserIdentity>().Where(i => i.Username == @"KE\KeKim").Select(i => i.UserId).SingleAsync();
            (await db.Set<AppUser>().SingleAsync(u => u.Id == userId)).BootstrapAppliedAt.ShouldNotBeNull();
            db.Set<UserRole>().RemoveRange(db.Set<UserRole>().Where(r => r.UserId == userId));
            await db.SaveChangesAsync();
        });
        _factory.InvalidateAll();

        var after = await JsonAsync(await As(@"KE\kekim").GetAsync("/api/v1/me"));
        after.GetProperty("status").GetString().ShouldBe("ACCESS_PENDING");
        after.GetProperty("isSystemAdmin").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Non_listed_user_is_never_bootstrapped()
    {
        var me = await JsonAsync(await As(@"KE\kekim2").GetAsync("/api/v1/me"));
        me.GetProperty("isSystemAdmin").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task System_admin_role_is_locked_in_the_schema_and_has_no_explicit_grants()
    {
        await _factory.WithDbAsync(async db =>
        {
            var admin = await db.Set<Role>().Include(r => r.Permissions).SingleAsync(r => r.IsSystemAdmin);
            admin.Name.ShouldBe("System Admin");
            admin.Permissions.ShouldBeEmpty();
            // Only one System Admin role can exist (filtered unique index).
            await Should.ThrowAsync<DbUpdateException>(async () =>
            {
                db.Set<Role>().Add(new Role { Name = "Second Admin", IsSystemAdmin = true });
                await db.SaveChangesAsync();
            });
        });
    }

    [Fact]
    public async Task Disabled_user_is_denied_everywhere_including_me()
    {
        var roleId = await _factory.CreateRoleAsync("Viewer", Permissions.Task.View);
        await As(@"KE\leaver").GetAsync("/api/v1/me");
        await _factory.GrantRoleAsync(@"KE\leaver", roleId);
        (await As(@"KE\leaver").GetAsync("/api/v1/test/tasks")).StatusCode.ShouldBe(HttpStatusCode.OK);

        await _factory.WithDbAsync(async db =>
        {
            var user = await db.Set<AppUser>().SingleAsync(u => u.Identities.Any(i => i.Username == @"KE\leaver"));
            user.IsActive = false;
            await db.SaveChangesAsync();
        });
        _factory.InvalidateAll();

        foreach (var path in new[] { "/api/v1/me", "/api/v1/test/tasks", "/api/v1/test/no-policy" })
        {
            var response = await As(@"KE\leaver").GetAsync(path);
            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden, path);
            (await JsonAsync(response)).GetProperty("code").GetString().ShouldBe("ACCOUNT_DISABLED");
        }
    }

    [Fact]
    public async Task Dev_users_from_configuration_get_their_roles_and_starter_roles_carry_the_default_matrix()
    {
        var director = await JsonAsync(await As(@"KE\director").GetAsync("/api/v1/me"));
        director.GetProperty("displayName").GetString().ShouldBe("Dana Director");
        Strings(director.GetProperty("roles")).ShouldBe(["Director"]);
        var directorPermissions = Strings(director.GetProperty("permissions"));
        directorPermissions.ShouldContain(Permissions.Audit.View);
        directorPermissions.ShouldContain(Permissions.User.View);
        directorPermissions.ShouldNotContain(Permissions.User.Manage);
        directorPermissions.ShouldNotContain(Permissions.TaskType.Manage);

        var scientist = Strings((await JsonAsync(await As(@"KE\scientist").GetAsync("/api/v1/me"))).GetProperty("permissions"));
        scientist.ShouldContain(Permissions.Task.Complete);
        scientist.ShouldNotContain(Permissions.Project.Create);
        scientist.ShouldNotContain(Permissions.Audit.View);

        (await As(@"KE\director").GetAsync("/api/v1/test/task-types")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---- Seeding is idempotent and never overwrites admin edits

    [Fact]
    public async Task Seeding_is_idempotent_syncs_the_catalog_and_preserves_admin_edits()
    {
        (await _factory.CountAsync<Permission>()).ShouldBe(Permissions.All.Count);
        (await _factory.CountAsync<Role>()).ShouldBe(6); // System Admin + five starter roles

        // Admin edit: remove a grant from Data Scientist and deactivate a permission that is still in the catalog.
        await _factory.WithDbAsync(async db =>
        {
            var role = await db.Set<Role>().Include(r => r.Permissions).ThenInclude(rp => rp.Permission).SingleAsync(r => r.Name == "Data Scientist");
            db.Set<RolePermission>().RemoveRange(role.Permissions.Where(p => p.Permission.Code == Permissions.Pod.View));
            await db.SaveChangesAsync();
        });

        // A second app instance starts against the same database and runs the seed again.
        await using var second = new DatabaseApiFactory(_connectionString);
        using (second.CreateClient())
        {
        }

        (await _factory.CountAsync<Permission>()).ShouldBe(Permissions.All.Count);
        (await _factory.CountAsync<Role>()).ShouldBe(6);
        await _factory.WithDbAsync(async db =>
        {
            var granted = await db.Set<RolePermission>()
                .Where(rp => rp.Role.Name == "Data Scientist")
                .Select(rp => rp.Permission.Code)
                .ToListAsync();
            granted.ShouldNotContain(Permissions.Pod.View);
            granted.ShouldContain(Permissions.Task.View);
        });
    }

    [Fact]
    public async Task Catalog_sync_marks_removed_codes_inactive_and_reactivates_returning_codes()
    {
        await _factory.WithDbAsync(async db =>
        {
            db.Set<Permission>().Add(new Permission { Code = "Legacy.Thing", GroupName = "Legacy", Description = "Removed from catalog", IsActive = true });
            var view = await db.Set<Permission>().SingleAsync(p => p.Code == Permissions.Task.View);
            view.IsActive = false;
            await db.SaveChangesAsync();
        });

        await using var second = new DatabaseApiFactory(_connectionString);
        using (second.CreateClient())
        {
        }

        await _factory.WithDbAsync(async db =>
        {
            (await db.Set<Permission>().SingleAsync(p => p.Code == "Legacy.Thing")).IsActive.ShouldBeFalse();
            (await db.Set<Permission>().SingleAsync(p => p.Code == Permissions.Task.View)).IsActive.ShouldBeTrue();
        });
    }
}
