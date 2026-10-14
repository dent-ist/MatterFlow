using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Identity.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>
/// Walking skeleton (#22) and users/roles administration (#23, #24) against a real SQL Server through the full HTTP pipeline:
/// unknown user -> Access Pending -> bootstrap admin grants a role -> the user sees permitted data -> deactivation denies.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class WalkingSkeletonTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Admin = DatabaseApiFactory.AdminAccount; // ke\kekim, from Bootstrap:SystemAdmins

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

    private static string Code(JsonElement problem) => problem.GetProperty("code").GetString()!;

    private async Task<int> UserIdAsync(string account)
    {
        var me = await JsonAsync(await As(account).GetAsync("/api/v1/me"));
        return me.GetProperty("userId").GetInt32();
    }

    private async Task<int> CreateRoleAsync(HttpClient admin, string name, params string[] permissions)
    {
        var response = await admin.PostAsJsonAsync("/api/v1/roles", new { name, description = "test role", permissionCodes = permissions });
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        return (await JsonAsync(response)).GetProperty("roleId").GetInt32();
    }

    private static Task<HttpResponseMessage> SetRolesAsync(HttpClient admin, int userId, params int[] roleIds) =>
        admin.PutAsJsonAsync($"/api/v1/users/{userId}/roles", new { roleIds });

    private static async Task<int> SystemAdminRoleIdAsync(HttpClient admin)
    {
        var roles = await JsonAsync(await admin.GetAsync("/api/v1/roles"));
        return roles.EnumerateArray().Single(r => r.GetProperty("isSystemAdmin").GetBoolean()).GetProperty("roleId").GetInt32();
    }

    [Fact]
    public async Task Unknown_user_is_pending_admin_grants_a_role_user_sees_data_and_deactivation_denies()
    {
        // Unknown user: /me works and says pending; everything else is 403 ACCESS_PENDING.
        var newhire = As(@"KE\newhire");
        var me = await JsonAsync(await newhire.GetAsync("/api/v1/me"));
        me.GetProperty("status").GetString().ShouldBe("ACCESS_PENDING");
        foreach (var path in new[] { "/api/v1/test/tasks", "/api/v1/users", "/api/v1/roles" })
        {
            var denied = await newhire.GetAsync(path);
            denied.StatusCode.ShouldBe(HttpStatusCode.Forbidden, path);
            Code(await JsonAsync(denied)).ShouldBe("ACCESS_PENDING");
        }

        // Bootstrap admin sees the user in the pending queue and grants a role.
        var admin = As(Admin);
        (await JsonAsync(await admin.GetAsync("/api/v1/me"))).GetProperty("isSystemAdmin").GetBoolean().ShouldBeTrue();
        var pending = await JsonAsync(await admin.GetAsync("/api/v1/users?status=pending"));
        var row = pending.GetProperty("items").EnumerateArray().Single(u => u.GetProperty("windowsAccount").GetString() == @"KE\newhire");
        row.GetProperty("isPending").GetBoolean().ShouldBeTrue();
        var userId = row.GetProperty("userId").GetInt32();
        (await JsonAsync(await admin.GetAsync("/api/v1/users/counts"))).GetProperty("pending").GetInt32().ShouldBe(1);

        var roleId = await CreateRoleAsync(admin, "Task Viewer", "Task.View");
        var granted = await SetRolesAsync(admin, userId, roleId);
        granted.StatusCode.ShouldBe(HttpStatusCode.OK);

        // The grant takes effect on the user's very next request (cache invalidated), and the queue empties.
        var after = await JsonAsync(await newhire.GetAsync("/api/v1/me"));
        after.GetProperty("status").GetString().ShouldBe("ACTIVE");
        after.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()).ShouldBe(["Task.View"]);
        (await newhire.GetAsync("/api/v1/test/tasks")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await newhire.GetAsync("/api/v1/test/clients")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await JsonAsync(await admin.GetAsync("/api/v1/users/counts"))).GetProperty("pending").GetInt32().ShouldBe(0);

        // Repeated sign-in resolves to the same user: no duplicates.
        for (var i = 0; i < 3; i++)
            (await newhire.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await _factory.WithDbAsync(db => db.Set<UserIdentity>().CountAsync(i => i.Username == @"KE\newhire"))).ShouldBe(1);
        (await _factory.WithDbAsync(db => db.Set<AppUser>().CountAsync(u => u.DisplayName == @"KE\newhire"))).ShouldBe(1);

        // Deactivated user is denied everywhere, including /me.
        (await admin.PutAsJsonAsync($"/api/v1/users/{userId}/status", new { isActive = false })).StatusCode.ShouldBe(HttpStatusCode.OK);
        foreach (var path in new[] { "/api/v1/me", "/api/v1/test/tasks" })
        {
            var denied = await newhire.GetAsync(path);
            denied.StatusCode.ShouldBe(HttpStatusCode.Forbidden, path);
            Code(await JsonAsync(denied)).ShouldBe("ACCOUNT_DISABLED");
        }

        // Reactivation restores access.
        (await admin.PutAsJsonAsync($"/api/v1/users/{userId}/status", new { isActive = true })).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await newhire.GetAsync("/api/v1/test/tasks")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Role_changes_are_audited_and_revoking_the_last_role_makes_the_user_pending_again()
    {
        var admin = As(Admin);
        var userId = await UserIdAsync(@"KE\worker");
        var roleId = await CreateRoleAsync(admin, "Task Viewer", "Task.View");
        (await SetRolesAsync(admin, userId, roleId)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await SetRolesAsync(admin, userId)).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await JsonAsync(await As(@"KE\worker").GetAsync("/api/v1/me"))).GetProperty("status").GetString().ShouldBe("ACCESS_PENDING");

        var events = await JsonAsync(await admin.GetAsync($"/api/v1/audit/events?objectType=User&objectId={userId}"));
        var types = events.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("eventType").GetString()).ToList();
        types.ShouldContain("USER_ROLE_GRANTED");
        types.ShouldContain("USER_ROLE_REVOKED");
    }

    [Fact]
    public async Task Admin_cannot_deactivate_self_or_remove_the_last_system_admin()
    {
        var admin = As(Admin);
        var adminId = await UserIdAsync(Admin);
        var systemAdminRole = await SystemAdminRoleIdAsync(admin);

        var self = await admin.PutAsJsonAsync($"/api/v1/users/{adminId}/status", new { isActive = false });
        self.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await JsonAsync(self)).GetProperty("errors").GetProperty("isActive")[0].GetProperty("code").GetString().ShouldBe("SELF_DEACTIVATION");

        // Sole admin: removing the System Admin role is refused.
        var demote = await SetRolesAsync(admin, adminId);
        demote.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(demote)).ShouldBe("LAST_ADMIN");

        // With a second admin, the first can step down; the second is then the last one and is protected.
        var otherId = await UserIdAsync(@"KE\second");
        (await SetRolesAsync(admin, otherId, systemAdminRole)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await SetRolesAsync(admin, adminId)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var demoteLast = await SetRolesAsync(As(@"KE\second"), otherId);
        demoteLast.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(demoteLast)).ShouldBe("LAST_ADMIN");
    }

    [Fact]
    public async Task Deactivating_another_user_who_is_the_last_admin_is_refused()
    {
        // KE\second is the only System Admin besides the actor; the actor then loses the role so second is last.
        var admin = As(Admin);
        var systemAdminRole = await SystemAdminRoleIdAsync(admin);
        var otherId = await UserIdAsync(@"KE\second");
        (await SetRolesAsync(admin, otherId, systemAdminRole)).StatusCode.ShouldBe(HttpStatusCode.OK);

        // A User.Manage holder who is not an admin tries to deactivate the last admins one by one.
        var managerRole = await CreateRoleAsync(admin, "User Manager", "User.View", "User.Manage");
        var managerId = await UserIdAsync(@"KE\manager");
        (await SetRolesAsync(admin, managerId, managerRole)).StatusCode.ShouldBe(HttpStatusCode.OK);
        var manager = As(@"KE\manager");

        var adminId = await UserIdAsync(Admin);
        (await manager.PutAsJsonAsync($"/api/v1/users/{adminId}/status", new { isActive = false })).StatusCode.ShouldBe(HttpStatusCode.OK);
        var last = await manager.PutAsJsonAsync($"/api/v1/users/{otherId}/status", new { isActive = false });
        last.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(last)).ShouldBe("LAST_ADMIN");
    }

    [Fact]
    public async Task Roles_crud_guards_system_admin_name_uniqueness_and_roles_in_use()
    {
        var admin = As(Admin);
        var systemAdminRole = await SystemAdminRoleIdAsync(admin);

        var detail = await JsonAsync(await admin.GetAsync($"/api/v1/roles/{systemAdminRole}"));
        detail.GetProperty("permissionCodes").GetArrayLength().ShouldBeGreaterThan(20);

        var edit = await admin.PutAsJsonAsync($"/api/v1/roles/{systemAdminRole}", new { name = "Boss", permissionCodes = new[] { "Task.View" } });
        edit.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(edit)).ShouldBe("IMMUTABLE_FIELD");
        (await admin.DeleteAsync($"/api/v1/roles/{systemAdminRole}")).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        var roleId = await CreateRoleAsync(admin, "Reviewer", "Task.View");
        var duplicate = await admin.PostAsJsonAsync("/api/v1/roles", new { name = "reviewer", permissionCodes = Array.Empty<string>() });
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(duplicate)).ShouldBe("DUPLICATE_NAME");

        var unknown = await admin.PutAsJsonAsync($"/api/v1/roles/{roleId}", new { name = "Reviewer", permissionCodes = new[] { "Nope.Nope" } });
        unknown.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var updated = await admin.PutAsJsonAsync($"/api/v1/roles/{roleId}", new { name = "Reviewer 2", description = "d", permissionCodes = new[] { "Task.View", "Task.Comment" } });
        updated.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(updated)).GetProperty("permissionCodes").GetArrayLength().ShouldBe(2);

        // In use: cannot delete; unused: can.
        var userId = await UserIdAsync(@"KE\worker");
        (await SetRolesAsync(admin, userId, roleId)).StatusCode.ShouldBe(HttpStatusCode.OK);
        var inUse = await admin.DeleteAsync($"/api/v1/roles/{roleId}");
        inUse.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(inUse)).ShouldBe("ROLE_IN_USE");
        (await SetRolesAsync(admin, userId)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await admin.DeleteAsync($"/api/v1/roles/{roleId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await admin.GetAsync($"/api/v1/roles/{roleId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var catalog = await JsonAsync(await admin.GetAsync("/api/v1/permissions"));
        catalog.EnumerateArray().Select(g => g.GetProperty("group").GetString()).ShouldContain("Task");
    }

    [Fact]
    public async Task Changing_role_permissions_applies_immediately_to_members_and_viewers_cannot_manage()
    {
        var admin = As(Admin);
        var roleId = await CreateRoleAsync(admin, "Clerk", "Task.View");
        var userId = await UserIdAsync(@"KE\clerk");
        (await SetRolesAsync(admin, userId, roleId)).StatusCode.ShouldBe(HttpStatusCode.OK);
        var clerk = As(@"KE\clerk");
        (await clerk.GetAsync("/api/v1/test/clients")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await admin.PutAsJsonAsync($"/api/v1/roles/{roleId}", new { name = "Clerk", permissionCodes = new[] { "Task.View", "Client.View" } })).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await clerk.GetAsync("/api/v1/test/clients")).StatusCode.ShouldBe(HttpStatusCode.OK);

        // Director holds User.View but not User.Manage / Role.Manage.
        var director = As(@"KE\director");
        (await director.GetAsync("/api/v1/users")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await director.PutAsJsonAsync($"/api/v1/users/{userId}/roles", new { roleIds = Array.Empty<int>() })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await director.PostAsJsonAsync("/api/v1/roles", new { name = "X", permissionCodes = Array.Empty<string>() })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Users_list_pages_searches_and_updates_the_profile_with_concurrency_check()
    {
        var admin = As(Admin);
        var userId = await UserIdAsync(@"KE\searchme");
        await UserIdAsync(@"KE\other");

        var found = await JsonAsync(await admin.GetAsync("/api/v1/users?search=searchme"));
        found.GetProperty("total").GetInt32().ShouldBe(1);
        var paged = await JsonAsync(await admin.GetAsync("/api/v1/users?pageSize=1&page=2"));
        paged.GetProperty("items").GetArrayLength().ShouldBe(1);
        paged.GetProperty("total").GetInt32().ShouldBeGreaterThanOrEqualTo(3);
        (await admin.GetAsync("/api/v1/users?status=bogus")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var detail = await JsonAsync(await admin.GetAsync($"/api/v1/users/{userId}"));
        var version = detail.GetProperty("rowVersion").GetString();
        var edit = await admin.PutAsJsonAsync($"/api/v1/users/{userId}", new { displayName = "Sam Search", email = "sam@firm.test", rowVersion = version });
        edit.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(edit)).GetProperty("displayName").GetString().ShouldBe("Sam Search");

        var stale = await admin.PutAsJsonAsync($"/api/v1/users/{userId}", new { displayName = "Stale", rowVersion = version });
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(stale)).ShouldBe("CONCURRENCY_CONFLICT");

        (await admin.GetAsync("/api/v1/users/999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
