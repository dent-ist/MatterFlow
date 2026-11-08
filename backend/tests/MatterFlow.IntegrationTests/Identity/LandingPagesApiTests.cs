using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>
/// Landing pages (epic #1330, issue #1332): a role's default page (Role.Manage, audited), the person's own choice (own record only, any signed-in person who
/// is not Access Pending), the pages a person can open, and the fallback chain (choice if openable, else the first role's default if openable, else none).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class LandingPagesApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Ann = @"ke\ann";
    private const string Bob = @"ke\bob";

    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user = DatabaseApiFactory.AdminAccount)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    /// <summary>A person holding exactly one new role with the given permissions (a person with no permission is Access Pending).</summary>
    private async Task<HttpClient> UserWithAsync(string user, string roleName, params string[] permissions)
    {
        var client = As(user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        if (permissions.Length > 0)
            await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync(roleName, permissions));
        return client;
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<JsonElement> RoleLandingAsync(int roleId) => await ReadAsync(await As().GetAsync($"/api/v1/roles/{roleId}/landing-page"));

    private async Task<HttpResponseMessage> SetRoleAsync(int roleId, string? page, string? rowVersion = null, HttpClient? client = null)
    {
        rowVersion ??= (await RoleLandingAsync(roleId)).GetProperty("rowVersion").GetString();
        return await (client ?? As()).PutAsJsonAsync($"/api/v1/roles/{roleId}/landing-page", new { landingPage = page, rowVersion });
    }

    private static string?[] Keys(JsonElement pages) => [.. pages.EnumerateArray().Select(p => p.GetProperty("key").GetString())];

    private static string? Str(JsonElement e, string name) => e.GetProperty(name).ValueKind == JsonValueKind.Null ? null : e.GetProperty(name).GetString();

    private async Task<JsonElement> MineAsync(HttpClient client) => await ReadAsync(await client.GetAsync("/api/v1/me/landing-page"));

    private static readonly string[] AllKeys = ["dashboard", "my-matters", "my-work", "clients", "matters", "projects", "assets", "pod-work", "task-queue", "reports", "administration"];

    [Fact]
    public async Task Starter_roles_start_with_the_agreed_defaults()
    {
        await As().GetAsync("/api/v1/me");
        var roles = (await ReadAsync(await As().GetAsync("/api/v1/roles"))).EnumerateArray().ToList();
        string? Default(string name) => Str(roles.Single(r => r.GetProperty("name").GetString() == name), "landingPage");

        Default("Director").ShouldBe("dashboard");
        Default("Project Manager").ShouldBe("my-matters");
        Default("Pod Lead").ShouldBeNull();
        Default("Data Technician").ShouldBeNull();
        Default("Data Scientist").ShouldBeNull();
        Default("System Admin").ShouldBeNull();
    }

    [Fact]
    public async Task A_role_default_is_set_changed_cleared_and_audited()
    {
        var roleId = await _factory.CreateRoleAsync("Reviewers", Permissions.Task.View, Permissions.Client.View);
        var before = await RoleLandingAsync(roleId);
        Str(before, "landingPage").ShouldBeNull();
        Keys(before.GetProperty("pages")).ShouldBe(["my-work", "clients", "task-queue"]);

        var set = await SetRoleAsync(roleId, "clients");
        set.StatusCode.ShouldBe(HttpStatusCode.OK, await set.Content.ReadAsStringAsync());
        var saved = await ReadAsync(set);
        Str(saved, "landingPage").ShouldBe("clients");
        saved.GetProperty("rowVersion").GetString().ShouldNotBe(before.GetProperty("rowVersion").GetString());

        (await ReadAsync(await As().GetAsync($"/api/v1/roles/{roleId}"))).GetProperty("landingPage").GetString().ShouldBe("clients");

        var cleared = await ReadAsync(await SetRoleAsync(roleId, null));
        Str(cleared, "landingPage").ShouldBeNull();

        var events = await _factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking()
            .Where(e => e.ObjectType == "Role" && e.ObjectId == roleId.ToString() && e.FieldKey != null && e.FieldKey.ToLower() == "landingpage")
            .OrderBy(e => e.Id).ToListAsync());
        events.Count.ShouldBe(2);
        (events[0].OldValue, events[0].NewValue).ShouldBe((null, "clients"));
        (events[1].OldValue, events[1].NewValue).ShouldBe(("clients", null));
    }

    [Fact]
    public async Task A_role_cannot_default_to_a_page_it_cannot_open_and_an_unknown_key_is_refused()
    {
        var roleId = await _factory.CreateRoleAsync("Narrow", Permissions.Task.View);

        var refused = await SetRoleAsync(roleId, "my-matters");
        refused.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var body = await ReadAsync(refused);
        body.GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
        var field = body.GetProperty("errors").GetProperty("landingPage")[0];
        field.GetProperty("code").GetString().ShouldBe("PAGE_NOT_OPENABLE");
        field.GetProperty("message").GetString().ShouldBe("This role can't open My Matters. Choose another landing page.");

        var unknown = await SetRoleAsync(roleId, "Dashboard");
        unknown.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(unknown)).GetProperty("errors").GetProperty("landingPage")[0].GetProperty("code").GetString().ShouldBe("UNKNOWN_PAGE");

        Str(await RoleLandingAsync(roleId), "landingPage").ShouldBeNull();
    }

    [Fact]
    public async Task Role_writes_need_Role_Manage_reads_need_User_View_or_Role_Manage_and_the_rest_of_the_rules_hold()
    {
        var roleId = await _factory.CreateRoleAsync("Plain", Permissions.Task.View);
        var viewer = await UserWithAsync(Ann, "Viewer", Permissions.User.View);
        var nobody = await UserWithAsync(Bob, "Tasks only", Permissions.Task.View);

        (await viewer.GetAsync($"/api/v1/roles/{roleId}/landing-page")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await nobody.GetAsync($"/api/v1/roles/{roleId}/landing-page")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await SetRoleAsync(roleId, "my-work", client: viewer)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await SetRoleAsync(roleId, "my-work", client: nobody)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await As().GetAsync("/api/v1/roles/99999/landing-page")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await SetRoleAsync(99999, "my-work", rowVersion: "AAAAAAAAB9E=")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var adminRoleId = (await ReadAsync(await As().GetAsync("/api/v1/roles"))).EnumerateArray().Single(r => r.GetProperty("isSystemAdmin").GetBoolean()).GetProperty("roleId").GetInt32();
        var locked = await SetRoleAsync(adminRoleId, "dashboard");
        locked.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(locked)).GetProperty("code").GetString().ShouldBe("IMMUTABLE_FIELD");

        // A stale row version is a conflict and changes nothing.
        var stale = await RoleLandingAsync(roleId);
        (await SetRoleAsync(roleId, "my-work")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var conflict = await SetRoleAsync(roleId, "task-queue", stale.GetProperty("rowVersion").GetString());
        conflict.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(conflict)).GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");
        Str(await RoleLandingAsync(roleId), "landingPage").ShouldBe("my-work");
    }

    [Fact]
    public async Task Editing_a_role_keeps_its_landing_page()
    {
        var roleId = await _factory.CreateRoleAsync("Keeper", Permissions.Task.View, Permissions.Client.View);
        (await SetRoleAsync(roleId, "clients")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var detail = await ReadAsync(await As().GetAsync($"/api/v1/roles/{roleId}"));

        var update = await As().PutAsJsonAsync($"/api/v1/roles/{roleId}", new
        {
            name = "Keeper renamed",
            description = (string?)null,
            permissionCodes = new[] { Permissions.Task.View, Permissions.Client.View },
            rowVersion = detail.GetProperty("rowVersion").GetString(),
        });
        update.StatusCode.ShouldBe(HttpStatusCode.OK, await update.Content.ReadAsStringAsync());
        Str(await ReadAsync(update), "landingPage").ShouldBe("clients");
    }

    [Fact]
    public async Task The_pages_list_follows_the_callers_permissions_and_a_system_admin_gets_every_page()
    {
        var tasks = await UserWithAsync(Ann, "Task worker", Permissions.Task.View);
        Keys((await ReadAsync(await tasks.GetAsync("/api/v1/me/landing-pages"))).GetProperty("pages")).ShouldBe(["my-work", "task-queue"]);

        var lead = await UserWithAsync(Bob, "Lead", Permissions.Dashboard.View, Permissions.Dashboard.ViewSummary, Permissions.Pod.View, Permissions.Task.View, Permissions.User.Manage);
        var pages = (await ReadAsync(await lead.GetAsync("/api/v1/me/landing-pages"))).GetProperty("pages");
        Keys(pages).ShouldBe(["dashboard", "my-work", "pod-work", "task-queue", "administration"]);
        pages[0].GetProperty("label").GetString().ShouldBe("Dashboard");
        pages[0].GetProperty("path").GetString().ShouldBe("/dashboard");

        Keys((await ReadAsync(await As().GetAsync("/api/v1/me/landing-pages"))).GetProperty("pages")).ShouldBe(AllKeys);

        // Dashboard.View without a tab permission is a dead end, so it is not offered.
        var viewOnly = await UserWithAsync(@"ke\cy", "View only", Permissions.Dashboard.View, Permissions.Dashboard.ViewCoverage);
        Keys((await ReadAsync(await viewOnly.GetAsync("/api/v1/me/landing-pages"))).GetProperty("pages")).ShouldBeEmpty();
    }

    [Fact]
    public async Task The_chain_is_the_choice_then_the_first_roles_default_then_nothing()
    {
        var roleId = await _factory.CreateRoleAsync("Managers", Permissions.Matter.BeManager, Permissions.Matter.View, Permissions.Task.View, Permissions.Client.View);
        (await SetRoleAsync(roleId, "my-matters")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var ann = await UserWithAsync(Ann, "Unused");
        await _factory.GrantRoleAsync(Ann, roleId);

        var start = await MineAsync(ann);
        Str(start, "resolved").ShouldBe("my-matters");
        Str(start, "resolvedPath").ShouldBe("/my-matters");
        Str(start, "source").ShouldBe("ROLE_DEFAULT");
        Str(start, "roleName").ShouldBe("Managers");
        Str(start, "choice").ShouldBeNull();

        var chosen = await ann.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = "clients" });
        chosen.StatusCode.ShouldBe(HttpStatusCode.OK, await chosen.Content.ReadAsStringAsync());
        var afterChoice = await ReadAsync(chosen);
        Str(afterChoice, "resolved").ShouldBe("clients");
        Str(afterChoice, "source").ShouldBe("CHOICE");
        afterChoice.GetProperty("choiceAllowed").GetBoolean().ShouldBeTrue();
        Str(await MineAsync(ann), "choice").ShouldBe("clients");

        // Clearing the choice returns to the role default.
        var cleared = await ReadAsync(await ann.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = (string?)null }));
        Str(cleared, "choice").ShouldBeNull();
        Str(cleared, "resolved").ShouldBe("my-matters");
    }

    [Fact]
    public async Task A_stored_choice_that_is_no_longer_allowed_is_kept_flagged_and_skipped_and_it_returns_when_access_does()
    {
        var roleId = await _factory.CreateRoleAsync("Shrinking", Permissions.Task.View, Permissions.Client.View);
        var ann = await UserWithAsync(Ann, "Unused");
        await _factory.GrantRoleAsync(Ann, roleId);
        (await SetRoleAsync(roleId, "my-work")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ann.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = "clients" })).StatusCode.ShouldBe(HttpStatusCode.OK);

        async Task SetPermissionsAsync(params string[] codes)
        {
            var detail = await ReadAsync(await As().GetAsync($"/api/v1/roles/{roleId}"));
            var put = await As().PutAsJsonAsync($"/api/v1/roles/{roleId}", new { name = "Shrinking", description = (string?)null, permissionCodes = codes, rowVersion = detail.GetProperty("rowVersion").GetString() });
            put.StatusCode.ShouldBe(HttpStatusCode.OK, await put.Content.ReadAsStringAsync());
        }

        await SetPermissionsAsync(Permissions.Task.View); // Client.View taken away
        var skipped = await MineAsync(ann);
        Str(skipped, "choice").ShouldBe("clients");
        skipped.GetProperty("choiceAllowed").GetBoolean().ShouldBeFalse();
        Str(skipped, "resolved").ShouldBe("my-work");
        Str(skipped, "source").ShouldBe("ROLE_DEFAULT");

        await SetPermissionsAsync(Permissions.Asset.View); // Task.View taken away too: neither the choice nor the role default is openable
        var none = await MineAsync(ann);
        Str(none, "resolved").ShouldBeNull();
        Str(none, "resolvedPath").ShouldBeNull();
        Str(none, "source").ShouldBeNull();
        none.GetProperty("roleDefaultAllowed").GetBoolean().ShouldBeFalse();
        Str(none, "roleDefault").ShouldBe("my-work");

        await SetPermissionsAsync(Permissions.Task.View, Permissions.Client.View); // access returns
        var back = await MineAsync(ann);
        Str(back, "resolved").ShouldBe("clients");
        back.GetProperty("choiceAllowed").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task A_known_page_is_stored_even_when_it_cannot_be_opened_now_and_an_unknown_key_is_refused()
    {
        var ann = await UserWithAsync(Ann, "Task worker", Permissions.Task.View);

        var stored = await ann.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = "reports" });
        stored.StatusCode.ShouldBe(HttpStatusCode.OK, await stored.Content.ReadAsStringAsync());
        var body = await ReadAsync(stored);
        Str(body, "choice").ShouldBe("reports");
        body.GetProperty("choiceAllowed").GetBoolean().ShouldBeFalse();
        Str(body, "resolved").ShouldBeNull();

        foreach (var bad in new[] { "no-such-page", "Dashboard", "/dashboard" })
        {
            var refused = await ann.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = bad });
            refused.StatusCode.ShouldBe(HttpStatusCode.BadRequest, bad);
            (await ReadAsync(refused)).GetProperty("errors").GetProperty("landingPage")[0].GetProperty("code").GetString().ShouldBe("UNKNOWN_PAGE");
        }

        Str(await MineAsync(ann), "choice").ShouldBe("reports");
    }

    [Fact]
    public async Task A_stored_key_that_is_not_a_page_any_more_is_treated_as_not_set()
    {
        var ann = await UserWithAsync(Ann, "Task worker", Permissions.Task.View);
        var userId = await _factory.WithDbAsync(db => db.Set<MatterFlow.Identity.Domain.UserIdentity>().Where(i => i.Username == Ann).Select(i => i.UserId).SingleAsync());
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT dbo.UserView (UserId, Surface, Name, IsDefault, StateJson) VALUES ({userId}, 'landing-page', NULL, 0, '{{\"page\":\"renamed-page\"}}')"));

        var body = await MineAsync(ann);
        Str(body, "choice").ShouldBeNull();
        body.GetProperty("choiceAllowed").GetBoolean().ShouldBeTrue();
        Str(body, "resolved").ShouldBeNull();
    }

    [Fact]
    public async Task The_first_role_in_the_alphabetical_role_list_decides_and_the_second_is_never_consulted()
    {
        var zed = await _factory.CreateRoleAsync("Zed", Permissions.Task.View, Permissions.Client.View);
        var alpha = await _factory.CreateRoleAsync("alpha", Permissions.Task.View, Permissions.Client.View);
        var ann = await UserWithAsync(Ann, "Unused");
        await _factory.GrantRoleAsync(Ann, zed);
        await _factory.GrantRoleAsync(Ann, alpha);
        (await SetRoleAsync(zed, "clients")).StatusCode.ShouldBe(HttpStatusCode.OK);

        // "alpha" sorts first (ignoring case) and has no default: the chain does not fall through to Zed.
        var body = await MineAsync(ann);
        Str(body, "roleName").ShouldBe("alpha");
        Str(body, "roleDefault").ShouldBeNull();
        Str(body, "resolved").ShouldBeNull();

        (await SetRoleAsync(alpha, "my-work")).StatusCode.ShouldBe(HttpStatusCode.OK);
        Str(await MineAsync(ann), "resolved").ShouldBe("my-work");

        // The order is the one GET /me shows.
        var me = await ReadAsync(await ann.GetAsync("/api/v1/me"));
        me.GetProperty("roles")[0].GetString().ShouldBe("alpha");
    }

    [Fact]
    public async Task Inactive_roles_do_not_count()
    {
        var first = await _factory.CreateRoleAsync("Aardvark", Permissions.Task.View);
        var second = await _factory.CreateRoleAsync("Badger", Permissions.Task.View);
        (await SetRoleAsync(first, "my-work")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await SetRoleAsync(second, "task-queue")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var ann = await UserWithAsync(Ann, "Unused");
        await _factory.GrantRoleAsync(Ann, first);
        await _factory.GrantRoleAsync(Ann, second);
        Str(await MineAsync(ann), "resolved").ShouldBe("my-work");

        await _factory.WithDbAsync(db => db.Database.ExecuteSqlInterpolatedAsync($"UPDATE dbo.Role SET IsActive = 0 WHERE RoleId = {first}"));
        _factory.InvalidateAll();
        Str(await MineAsync(ann), "resolved").ShouldBe("task-queue");
    }

    [Fact]
    public async Task The_choice_is_the_callers_own_and_the_generic_views_api_neither_lists_nor_writes_it()
    {
        var ann = await UserWithAsync(Ann, "Task worker", Permissions.Task.View);
        var bob = await UserWithAsync(Bob, "Task worker 2", Permissions.Task.View, Permissions.Client.View);
        (await ann.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = "my-work" })).StatusCode.ShouldBe(HttpStatusCode.OK);

        Str(await MineAsync(bob), "choice").ShouldBeNull();
        (await bob.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = "clients" })).StatusCode.ShouldBe(HttpStatusCode.OK);
        Str(await MineAsync(ann), "choice").ShouldBe("my-work");

        (await ReadAsync(await ann.GetAsync("/api/v1/me/views"))).GetProperty("items").GetArrayLength().ShouldBe(0);
        var write = await ann.PutAsJsonAsync("/api/v1/me/views/landing-page", new { state = new { page = "dashboard" } });
        write.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        Str(await MineAsync(ann), "choice").ShouldBe("my-work");
    }

    [Fact]
    public async Task Any_person_with_a_permission_can_use_the_personal_endpoints_but_Access_Pending_cannot()
    {
        // Audit.View alone opens no page of the main menu and not My Profile today, but the personal endpoints still answer.
        var auditor = await UserWithAsync(Ann, "Auditor", Permissions.Audit.View);
        var body = await MineAsync(auditor);
        Str(body, "resolved").ShouldBeNull();
        Keys((await ReadAsync(await auditor.GetAsync("/api/v1/me/landing-pages"))).GetProperty("pages")).ShouldBe(["administration"]);
        (await auditor.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = "administration" })).StatusCode.ShouldBe(HttpStatusCode.OK);
        Str(await MineAsync(auditor), "resolved").ShouldBe("administration");

        var pending = await UserWithAsync(Bob, "none");
        foreach (var response in new[]
        {
            await pending.GetAsync("/api/v1/me/landing-page"),
            await pending.GetAsync("/api/v1/me/landing-pages"),
            await pending.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = "my-work" }),
        })
        {
            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await ReadAsync(response)).GetProperty("code").GetString().ShouldBe("ACCESS_PENDING");
        }
    }

    [Fact]
    public async Task The_system_admin_can_choose_any_page_and_without_a_choice_has_no_role_default()
    {
        var admin = As();
        var body = await MineAsync(admin);
        Str(body, "resolved").ShouldBeNull();
        (await admin.PutAsJsonAsync("/api/v1/me/landing-page", new { landingPage = "my-matters" })).StatusCode.ShouldBe(HttpStatusCode.OK);
        var after = await MineAsync(admin);
        Str(after, "resolved").ShouldBe("my-matters");
        Str(after, "source").ShouldBe("CHOICE");
    }
}
