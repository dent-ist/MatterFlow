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
/// Security review 1: SEC-01 (privilege escalation through role and user administration, permission-matrix PM-X-12),
/// SEC-03 (last System Admin under concurrency) and SEC-09 (mandatory row versions on the identity administration endpoints).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class IdentityPrivilegeTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Admin = @"KE\kekim";

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

    private async Task<int> UserIdAsync(string account)
    {
        await As(account).GetAsync("/api/v1/me"); // provisions on first sight
        return await _factory.WithDbAsync(db => db.Set<UserIdentity>().Where(i => i.Username == account).Select(i => i.UserId).SingleAsync());
    }

    private async Task<string> RowVersionAsync(int userId) =>
        (await JsonAsync(await As(Admin).GetAsync($"/api/v1/users/{userId}"))).GetProperty("rowVersion").GetString()!;

    private Task<int> AdminRoleIdAsync() => _factory.WithDbAsync(db => db.Set<Role>().Where(r => r.IsSystemAdmin).Select(r => r.Id).SingleAsync());

    private async Task<string> CodeAsync(HttpResponseMessage response) => (await JsonAsync(response)).GetProperty("code").GetString()!;

    private async Task<HttpResponseMessage> PutRolesAsync(string actor, int userId, string rowVersion, params int[] roleIds) =>
        await As(actor).PutAsJsonAsync($"/api/v1/users/{userId}/roles", new { roleIds, rowVersion });

    /// <summary>A user holding exactly the given permissions through a fresh role.</summary>
    private async Task<(string Account, int UserId, int RoleId)> UserWithAsync(string account, params string[] permissions)
    {
        var roleId = await _factory.CreateRoleAsync("Role of " + account, permissions);
        var userId = await UserIdAsync(account);
        await _factory.GrantRoleAsync(account, roleId);
        return (account, userId, roleId);
    }

    // ---- SEC-01 / PM-X-12

    [Fact]
    public async Task User_manager_cannot_grant_themselves_the_system_admin_role()
    {
        var (account, userId, roleId) = await UserWithAsync(@"KE\mallory", Permissions.User.View, Permissions.User.Manage);
        var adminRole = await AdminRoleIdAsync();

        var response = await PutRolesAsync(account, userId, await RowVersionAsync(userId), roleId, adminRole);

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await CodeAsync(response)).ShouldBe("PERMISSION_DENIED");
        (await _factory.WithDbAsync(db => db.Set<UserRole>().AnyAsync(ur => ur.UserId == userId && ur.Role.IsSystemAdmin))).ShouldBeFalse();
        var me = await JsonAsync(await As(account).GetAsync("/api/v1/me"));
        me.GetProperty("isSystemAdmin").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task User_manager_cannot_grant_system_admin_to_someone_else_or_revoke_it()
    {
        await UserWithAsync(@"KE\manager", Permissions.User.View, Permissions.User.Manage);
        var victim = await UserIdAsync(@"KE\victim");
        var adminRole = await AdminRoleIdAsync();
        var adminUserId = await UserIdAsync(Admin);

        (await PutRolesAsync(@"KE\manager", victim, await RowVersionAsync(victim), adminRole)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // A second admin exists, so the last-admin guard is not what stops the revocation below.
        var second = await UserIdAsync(@"KE\second");
        (await PutRolesAsync(Admin, second, await RowVersionAsync(second), adminRole)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await PutRolesAsync(@"KE\manager", adminUserId, await RowVersionAsync(adminUserId))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task System_admin_can_grant_and_revoke_the_system_admin_role()
    {
        var target = await UserIdAsync(@"KE\promoted");
        var adminRole = await AdminRoleIdAsync();

        var granted = await PutRolesAsync(Admin, target, await RowVersionAsync(target), adminRole);
        granted.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(granted)).GetProperty("isSystemAdmin").GetBoolean().ShouldBeTrue();

        var revoked = await PutRolesAsync(Admin, target, await RowVersionAsync(target));
        revoked.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(revoked)).GetProperty("isSystemAdmin").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task User_manager_cannot_grant_a_role_that_carries_permissions_they_do_not_hold()
    {
        await UserWithAsync(@"KE\manager", Permissions.User.View, Permissions.User.Manage);
        var strongRole = await _factory.CreateRoleAsync("Strong", Permissions.Task.View, Permissions.Role.Manage);
        var weakRole = await _factory.CreateRoleAsync("Weak", Permissions.User.View);
        var target = await UserIdAsync(@"KE\target");

        var denied = await PutRolesAsync(@"KE\manager", target, await RowVersionAsync(target), strongRole);
        denied.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await CodeAsync(denied)).ShouldBe("PERMISSION_DENIED");

        // A role within the caller's own level is fine.
        (await PutRolesAsync(@"KE\manager", target, await RowVersionAsync(target), weakRole)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Role_manager_cannot_add_permissions_they_do_not_hold_but_a_system_admin_can()
    {
        var (_, _, ownRole) = await UserWithAsync(@"KE\roleman", Permissions.Role.Manage, Permissions.User.View);
        var roleman = As(@"KE\roleman");
        var role = await JsonAsync(await roleman.GetAsync($"/api/v1/roles/{ownRole}"));
        var rowVersion = role.GetProperty("rowVersion").GetString()!;

        // Escalation: add User.Manage to the role the caller already holds.
        var escalate = await roleman.PutAsJsonAsync($"/api/v1/roles/{ownRole}", new
        {
            name = "Role of KE\\roleman",
            permissionCodes = new[] { Permissions.Role.Manage, Permissions.User.View, Permissions.User.Manage },
            rowVersion,
        });
        escalate.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // Creating a role with a permission above the caller's level is refused too; one within the level is allowed.
        (await roleman.PostAsJsonAsync("/api/v1/roles", new { name = "Too strong", permissionCodes = new[] { Permissions.Audit.View } }))
            .StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await roleman.PostAsJsonAsync("/api/v1/roles", new { name = "Just right", permissionCodes = new[] { Permissions.User.View } }))
            .StatusCode.ShouldBe(HttpStatusCode.Created);

        // Adding a permission the caller does hold is allowed; a System Admin may add anything.
        var allowed = await roleman.PutAsJsonAsync($"/api/v1/roles/{ownRole}", new
        {
            name = "Role of KE\\roleman",
            permissionCodes = new[] { Permissions.Role.Manage, Permissions.User.View },
            rowVersion,
        });
        allowed.StatusCode.ShouldBe(HttpStatusCode.OK);
        var fresh = (await JsonAsync(allowed)).GetProperty("rowVersion").GetString()!;
        var byAdmin = await As(Admin).PutAsJsonAsync($"/api/v1/roles/{ownRole}", new
        {
            name = "Role of KE\\roleman",
            permissionCodes = new[] { Permissions.Role.Manage, Permissions.User.View, Permissions.User.Manage },
            rowVersion = fresh,
        });
        byAdmin.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task User_manager_cannot_deactivate_a_system_admin()
    {
        await UserWithAsync(@"KE\manager", Permissions.User.View, Permissions.User.Manage);
        var adminRole = await AdminRoleIdAsync();
        var second = await UserIdAsync(@"KE\second");
        (await PutRolesAsync(Admin, second, await RowVersionAsync(second), adminRole)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var response = await As(@"KE\manager").PutAsJsonAsync($"/api/v1/users/{second}/status", new { isActive = false, rowVersion = await RowVersionAsync(second) });

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await _factory.WithDbAsync(db => db.Set<AppUser>().Where(u => u.Id == second).Select(u => u.IsActive).SingleAsync())).ShouldBeTrue();
    }

    // ---- SEC-09

    [Fact]
    public async Task User_and_role_updates_require_a_row_version()
    {
        var roleId = await _factory.CreateRoleAsync("Plain", Permissions.Task.View);
        var target = await UserIdAsync(@"KE\target");
        var admin = As(Admin);

        (await admin.PutAsJsonAsync($"/api/v1/users/{target}/roles", new { roleIds = new[] { roleId } })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await admin.PutAsJsonAsync($"/api/v1/users/{target}/status", new { isActive = false })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await admin.PutAsJsonAsync($"/api/v1/users/{target}", new { displayName = "X" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await admin.PutAsJsonAsync($"/api/v1/roles/{roleId}", new { name = "Plain", permissionCodes = new[] { Permissions.Task.View } }))
            .StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Stale_row_version_on_role_update_is_a_conflict()
    {
        var roleId = await _factory.CreateRoleAsync("Plain", Permissions.Task.View);
        var admin = As(Admin);
        var version = (await JsonAsync(await admin.GetAsync($"/api/v1/roles/{roleId}"))).GetProperty("rowVersion").GetString()!;
        var body = new { name = "Plain", permissionCodes = new[] { Permissions.Task.View, Permissions.Client.View }, rowVersion = version };

        (await admin.PutAsJsonAsync($"/api/v1/roles/{roleId}", body)).StatusCode.ShouldBe(HttpStatusCode.OK);
        var stale = await admin.PutAsJsonAsync($"/api/v1/roles/{roleId}", body);

        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await CodeAsync(stale)).ShouldBe("CONCURRENCY_CONFLICT");
    }

    // ---- SEC-03

    [Fact]
    public async Task Two_admins_deactivating_each_other_at_the_same_time_never_leave_zero_active_admins()
    {
        var adminRole = await AdminRoleIdAsync();
        var first = await UserIdAsync(Admin);
        var secondAccount = @"KE\second";
        var second = await UserIdAsync(secondAccount);
        (await PutRolesAsync(Admin, second, await RowVersionAsync(second), adminRole)).StatusCode.ShouldBe(HttpStatusCode.OK);

        for (var round = 0; round < 6; round++)
        {
            // Both caches are warm; both users are active admins at the start of the round.
            await As(Admin).GetAsync("/api/v1/me");
            await As(secondAccount).GetAsync("/api/v1/me");
            var versionOfFirst = await RowVersionAsync(first);
            var versionOfSecond = await RowVersionAsync(second);
            using var barrier = new Barrier(2);

            async Task<HttpStatusCode> Deactivate(string actor, int target, string version)
            {
                barrier.SignalAndWait();
                var response = await As(actor).PutAsJsonAsync($"/api/v1/users/{target}/status", new { isActive = false, rowVersion = version });
                return response.StatusCode;
            }

            var results = await Task.WhenAll(
                Task.Run(() => Deactivate(Admin, second, versionOfSecond)),
                Task.Run(() => Deactivate(secondAccount, first, versionOfFirst)));

            var active = await _factory.WithDbAsync(db => db.Set<UserRole>()
                .CountAsync(ur => ur.Role.IsSystemAdmin && ur.User.IsActive));
            active.ShouldBeGreaterThanOrEqualTo(1, $"round {round}: results {string.Join('/', results)}");
            results.ShouldNotContain(HttpStatusCode.InternalServerError);

            // Restore both admins for the next round.
            await _factory.WithDbAsync(async db =>
            {
                foreach (var user in await db.Set<AppUser>().Include(u => u.Identities).Where(u => u.Id == first || u.Id == second).ToListAsync())
                {
                    user.IsActive = true;
                    foreach (var identity in user.Identities)
                        identity.IsActive = true;
                }

                await db.SaveChangesAsync();
            });
            _factory.InvalidateAll();
        }
    }

    [Fact]
    public async Task Two_admins_revoking_each_others_role_at_the_same_time_never_leave_zero_admins()
    {
        var adminRole = await AdminRoleIdAsync();
        var first = await UserIdAsync(Admin);
        var secondAccount = @"KE\second";
        var second = await UserIdAsync(secondAccount);
        (await PutRolesAsync(Admin, second, await RowVersionAsync(second), adminRole)).StatusCode.ShouldBe(HttpStatusCode.OK);

        for (var round = 0; round < 6; round++)
        {
            await As(Admin).GetAsync("/api/v1/me");
            await As(secondAccount).GetAsync("/api/v1/me");
            var versionOfFirst = await RowVersionAsync(first);
            var versionOfSecond = await RowVersionAsync(second);
            using var barrier = new Barrier(2);

            async Task<HttpStatusCode> Revoke(string actor, int target, string version)
            {
                barrier.SignalAndWait();
                return (await PutRolesAsync(actor, target, version)).StatusCode;
            }

            var results = await Task.WhenAll(
                Task.Run(() => Revoke(Admin, second, versionOfSecond)),
                Task.Run(() => Revoke(secondAccount, first, versionOfFirst)));

            (await _factory.WithDbAsync(db => db.Set<UserRole>().CountAsync(ur => ur.Role.IsSystemAdmin && ur.User.IsActive)))
                .ShouldBeGreaterThanOrEqualTo(1, $"round {round}: results {string.Join('/', results)}");
            results.ShouldNotContain(HttpStatusCode.InternalServerError);

            await _factory.WithDbAsync(async db =>
            {
                foreach (var id in new[] { first, second })
                {
                    if (!await db.Set<UserRole>().AnyAsync(ur => ur.UserId == id && ur.RoleId == adminRole))
                        db.Set<UserRole>().Add(new UserRole { UserId = id, RoleId = adminRole, GrantedAt = DateTime.UtcNow });
                }

                await db.SaveChangesAsync();
            });
            _factory.InvalidateAll();
        }
    }
}
