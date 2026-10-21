using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>Pods and membership (ticket #25, SCN-007 data support) through the full HTTP pipeline against a real SQL Server.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class PodsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Admin = DatabaseApiFactory.AdminAccount;
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

    private async Task<int> ProvisionAsync(string account)
    {
        var me = await JsonAsync(await As(account).GetAsync("/api/v1/me"));
        return me.GetProperty("userId").GetInt32();
    }

    private async Task<(int Id, string RowVersion)> CreatePodAsync(string name, string? description = null)
    {
        var response = await As(Admin).PostAsJsonAsync("/api/v1/pods", new { name, description });
        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var pod = (await JsonAsync(response)).GetProperty("pod");
        return (pod.GetProperty("podId").GetInt32(), pod.GetProperty("rowVersion").GetString()!);
    }

    private async Task AddMembersAsync(int podId, params int[] userIds) =>
        (await As(Admin).PostAsJsonAsync($"/api/v1/pods/{podId}/members", new { userIds })).StatusCode.ShouldBe(HttpStatusCode.OK);

    private async Task<string[]> UserPodNamesAsync(int userId, string query = "")
    {
        var response = await As(Admin).GetAsync($"/api/v1/users/{userId}/pods{query}");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await JsonAsync(response)).EnumerateArray().Select(p => p.GetProperty("name").GetString()!).ToArray();
    }

    [Fact]
    public async Task Create_get_edit_and_list_pods()
    {
        var created = await As(Admin).PostAsJsonAsync("/api/v1/pods", new { name = "  Pod A  ", description = "Processing" });
        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        created.Headers.Location.ShouldNotBeNull();
        var pod = (await JsonAsync(created)).GetProperty("pod");
        pod.GetProperty("name").GetString().ShouldBe("Pod A");
        pod.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        pod.GetProperty("memberCount").GetInt32().ShouldBe(0);
        var id = pod.GetProperty("podId").GetInt32();

        var updated = await As(Admin).PutAsJsonAsync($"/api/v1/pods/{id}", new { name = "Pod Alpha", description = (string?)null, isActive = true, rowVersion = pod.GetProperty("rowVersion").GetString() });
        updated.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(updated)).GetProperty("pod").GetProperty("name").GetString().ShouldBe("Pod Alpha");

        await CreatePodAsync("Pod B");
        var list = await JsonAsync(await As(Admin).GetAsync("/api/v1/pods"));
        list.GetProperty("total").GetInt32().ShouldBe(2);
        list.GetProperty("items").EnumerateArray().Select(p => p.GetProperty("name").GetString()).ShouldBe(["Pod Alpha", "Pod B"]);

        var searched = await JsonAsync(await As(Admin).GetAsync("/api/v1/pods?q=alp&active=true"));
        searched.GetProperty("items").GetArrayLength().ShouldBe(1);
        (await As(Admin).GetAsync("/api/v1/pods?sort=bogus")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await As(Admin).GetAsync("/api/v1/pods/9999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Pod_name_is_required_and_unique()
    {
        var blank = await As(Admin).PostAsJsonAsync("/api/v1/pods", new { name = "   " });
        blank.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await JsonAsync(blank)).GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");

        var (id, rowVersion) = await CreatePodAsync("Pod A");
        var other = await CreatePodAsync("Pod B");

        var duplicate = await As(Admin).PostAsJsonAsync("/api/v1/pods", new { name = "pod a" });
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        var problem = await JsonAsync(duplicate);
        problem.GetProperty("code").GetString().ShouldBe("DUPLICATE_NAME");
        problem.GetProperty("detail").GetString().ShouldBe("A pod named 'pod a' already exists.");

        var rename = await As(Admin).PutAsJsonAsync($"/api/v1/pods/{other.Id}", new { name = "Pod A", isActive = true, rowVersion = other.RowVersion });
        rename.StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // Keeping the same name on edit is not a duplicate.
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{id}", new { name = "Pod A", description = "x", isActive = true, rowVersion })).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Stale_row_version_is_a_concurrency_conflict()
    {
        var (id, rowVersion) = await CreatePodAsync("Pod A");
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{id}", new { name = "Pod A2", isActive = true, rowVersion })).StatusCode.ShouldBe(HttpStatusCode.OK);

        var stale = await As(Admin).PutAsJsonAsync($"/api/v1/pods/{id}", new { name = "Pod A3", isActive = true, rowVersion });

        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await JsonAsync(stale)).GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");
    }

    [Fact]
    public async Task A_user_in_pods_A_and_B_lists_both_and_membership_is_many_to_many_SCN_007()
    {
        var tariq = await ProvisionAsync(@"KE\tariq");
        var sam = await ProvisionAsync(@"KE\sam");
        var a = await CreatePodAsync("Pod A");
        var b = await CreatePodAsync("Pod B");
        await AddMembersAsync(a.Id, tariq, sam);
        await AddMembersAsync(b.Id, tariq);
        await AddMembersAsync(b.Id, tariq); // idempotent

        (await UserPodNamesAsync(tariq)).ShouldBe(["Pod A", "Pod B"]);
        (await UserPodNamesAsync(sam)).ShouldBe(["Pod A"]);

        var detail = await JsonAsync(await As(Admin).GetAsync($"/api/v1/pods/{b.Id}"));
        detail.GetProperty("pod").GetProperty("memberCount").GetInt32().ShouldBe(1);
        detail.GetProperty("members")[0].GetProperty("userId").GetInt32().ShouldBe(tariq);
    }

    [Fact]
    public async Task Me_pods_and_the_contracts_directory_list_the_callers_pods()
    {
        var a = await CreatePodAsync("Pod A");
        var b = await CreatePodAsync("Pod B");
        var scientist = await ProvisionAsync(@"KE\scientist");
        await AddMembersAsync(a.Id, scientist);
        await AddMembersAsync(b.Id, scientist);
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{b.Id}/members/{scientist}", new { isPrimary = true })).StatusCode.ShouldBe(HttpStatusCode.OK);

        var mine = await JsonAsync(await As(@"KE\scientist").GetAsync("/api/v1/me/pods"));
        mine.EnumerateArray().Select(p => p.GetProperty("name").GetString()).ShouldBe(["Pod A", "Pod B"]);
        mine.EnumerateArray().Single(p => p.GetProperty("isPrimary").GetBoolean()).GetProperty("name").GetString().ShouldBe("Pod B");

        await using var scope = _factory.Services.CreateAsyncScope();
        var directory = scope.ServiceProvider.GetRequiredService<IPodDirectory>();
        (await directory.GetUserPodsAsync(scientist)).Select(p => p.Pod.Name).ShouldBe(["Pod A", "Pod B"]);
        (await directory.GetPrimaryPodAsync(scientist))!.Name.ShouldBe("Pod B");
        (await directory.GetMemberUserIdsAsync(a.Id)).ShouldBe([scientist]);
        (await directory.FindAsync(a.Id))!.IsActive.ShouldBeTrue();
        (await directory.FindAsync(9999)).ShouldBeNull();
    }

    [Fact]
    public async Task Me_lists_the_callers_own_active_pods_primary_first()
    {
        var account = @"KE\mepods";
        var user = await ProvisionAsync(account);
        // An Access Pending person (no role) gets no Pods in /me; give this one a role.
        var role = await As(Admin).PostAsJsonAsync("/api/v1/roles", new { name = "Me Pods Viewer", description = "test role", permissionCodes = new[] { "Task.View" } });
        role.StatusCode.ShouldBe(HttpStatusCode.Created);
        var roleId = (await JsonAsync(role)).GetProperty("roleId").GetInt32();
        var userRowVersion = (await JsonAsync(await As(Admin).GetAsync($"/api/v1/users/{user}"))).GetProperty("rowVersion").GetString();
        (await As(Admin).PutAsJsonAsync($"/api/v1/users/{user}/roles", new { roleIds = new[] { roleId }, rowVersion = userRowVersion })).StatusCode.ShouldBe(HttpStatusCode.OK);
        var zeta = await CreatePodAsync("Zeta Pod");
        var alpha = await CreatePodAsync("Alpha Pod");
        var closed = await CreatePodAsync("Closed Pod");
        await AddMembersAsync(zeta.Id, user);
        await AddMembersAsync(alpha.Id, user);
        await AddMembersAsync(closed.Id, user);
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{zeta.Id}/members/{user}", new { isPrimary = true })).StatusCode.ShouldBe(HttpStatusCode.OK);
        var edit = await As(Admin).GetAsync($"/api/v1/pods/{closed.Id}");
        var rowVersion = (await JsonAsync(edit)).GetProperty("pod").GetProperty("rowVersion").GetString();
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{closed.Id}", new { name = "Closed Pod", description = (string?)null, isActive = false, rowVersion })).StatusCode.ShouldBe(HttpStatusCode.OK);

        var me = await JsonAsync(await As(account).GetAsync("/api/v1/me"));
        var pods = me.GetProperty("pods").EnumerateArray().ToArray();
        pods.Select(p => p.GetProperty("name").GetString()).ShouldBe(["Zeta Pod", "Alpha Pod"]);
        pods.Select(p => p.GetProperty("isPrimary").GetBoolean()).ShouldBe([true, false]);

        // An Access Pending person (no role, no Pods shown) gets an empty list rather than a missing property.
        var loner = await JsonAsync(await As(@"KE\nopods").GetAsync("/api/v1/me"));
        loner.GetProperty("pods").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task Primary_pod_is_unique_per_user_and_requires_membership()
    {
        var user = await ProvisionAsync(@"KE\tariq");
        var a = await CreatePodAsync("Pod A");
        var b = await CreatePodAsync("Pod B");
        var c = await CreatePodAsync("Pod C");
        await AddMembersAsync(a.Id, user);
        await AddMembersAsync(b.Id, user);

        async Task<HttpResponseMessage> SetPrimary(int podId, bool value) =>
            await As(Admin).PutAsJsonAsync($"/api/v1/pods/{podId}/members/{user}", new { isPrimary = value });

        (await SetPrimary(a.Id, true)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await SetPrimary(b.Id, true)).StatusCode.ShouldBe(HttpStatusCode.OK);

        var rows = await _factory.WithDbAsync(db => db.Set<PodMember>().Where(m => m.UserId == user).OrderBy(m => m.PodId).Select(m => m.IsPrimary).ToListAsync());
        rows.ShouldBe([false, true]);

        (await SetPrimary(b.Id, false)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await _factory.WithDbAsync(db => db.Set<PodMember>().CountAsync(m => m.IsPrimary))).ShouldBe(0);

        (await SetPrimary(c.Id, true)).StatusCode.ShouldBe(HttpStatusCode.NotFound); // not a member
        (await SetPrimary(9999, true)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Removing_a_member_keeps_the_user_and_other_memberships()
    {
        var user = await ProvisionAsync(@"KE\tariq");
        var a = await CreatePodAsync("Pod A");
        var b = await CreatePodAsync("Pod B");
        await AddMembersAsync(a.Id, user);
        await AddMembersAsync(b.Id, user);

        (await As(Admin).DeleteAsync($"/api/v1/pods/{a.Id}/members/{user}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await As(Admin).DeleteAsync($"/api/v1/pods/{a.Id}/members/{user}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await As(Admin).DeleteAsync("/api/v1/pods/9999/members/1")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        (await UserPodNamesAsync(user)).ShouldBe(["Pod B"]);
    }

    [Fact]
    public async Task Adding_unknown_or_disabled_users_is_rejected()
    {
        var user = await ProvisionAsync(@"KE\leaver");
        var pod = await CreatePodAsync("Pod A");
        await _factory.WithDbAsync(async db =>
        {
            (await db.Set<AppUser>().SingleAsync(u => u.Id == user)).IsActive = false;
            await db.SaveChangesAsync();
        });

        (await As(Admin).PostAsJsonAsync($"/api/v1/pods/{pod.Id}/members", new { userIds = new[] { 9999 } })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await As(Admin).PostAsJsonAsync($"/api/v1/pods/{pod.Id}/members", new { userIds = new[] { user } })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await As(Admin).PostAsJsonAsync($"/api/v1/pods/{pod.Id}/members", new { userIds = Array.Empty<int>() })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Deactivated_pod_keeps_history_and_is_unavailable_for_new_assignment()
    {
        var user = await ProvisionAsync(@"KE\tariq");
        var a = await CreatePodAsync("Pod A");
        var b = await CreatePodAsync("Pod B");
        await AddMembersAsync(a.Id, user);
        await AddMembersAsync(b.Id, user);
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{a.Id}/members/{user}", new { isPrimary = true })).StatusCode.ShouldBe(HttpStatusCode.OK);

        var current = (await JsonAsync(await As(Admin).GetAsync($"/api/v1/pods/{a.Id}"))).GetProperty("pod");
        var deactivated = await As(Admin).PutAsJsonAsync($"/api/v1/pods/{a.Id}", new { name = "Pod A", isActive = false, rowVersion = current.GetProperty("rowVersion").GetString() });
        deactivated.StatusCode.ShouldBe(HttpStatusCode.OK);

        // Never deleted: the row, its members and its history remain.
        (await _factory.WithDbAsync(db => db.Set<Pod>().CountAsync(p => p.Id == a.Id && !p.IsActive))).ShouldBe(1);
        (await _factory.WithDbAsync(db => db.Set<PodMember>().CountAsync(m => m.PodId == a.Id))).ShouldBe(1);
        var listed = await JsonAsync(await As(Admin).GetAsync("/api/v1/pods?active=false"));
        listed.GetProperty("items").EnumerateArray().Select(p => p.GetProperty("name").GetString()).ShouldBe(["Pod A"]);

        // Unavailable for new assignment and for new members; absent from the user's active Pods.
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var directory = scope.ServiceProvider.GetRequiredService<IPodDirectory>();
            (await directory.IsAvailableForAssignmentAsync(a.Id)).ShouldBeFalse();
            (await directory.IsAvailableForAssignmentAsync(b.Id)).ShouldBeTrue();
            (await directory.FindAsync(a.Id))!.IsActive.ShouldBeFalse();
            (await directory.GetPrimaryPodAsync(user)).ShouldBeNull();
        }

        var other = await ProvisionAsync(@"KE\sam");
        var add = await As(Admin).PostAsJsonAsync($"/api/v1/pods/{a.Id}/members", new { userIds = new[] { other } });
        add.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await JsonAsync(add)).GetProperty("code").GetString().ShouldBe("POD_INACTIVE");
        (await UserPodNamesAsync(user)).ShouldBe(["Pod B"]);
        (await UserPodNamesAsync(user, "?includeInactive=true")).ShouldBe(["Pod A", "Pod B"]);

        // It can be reactivated.
        var reactivated = await As(Admin).PutAsJsonAsync($"/api/v1/pods/{a.Id}", new { name = "Pod A", isActive = true, rowVersion = (await JsonAsync(deactivated)).GetProperty("pod").GetProperty("rowVersion").GetString() });
        reactivated.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Members_show_roles_but_no_lead_flag()
    {
        var pod = await CreatePodAsync("Pod A");
        var scientist = await ProvisionAsync(@"KE\scientist");
        await AddMembersAsync(pod.Id, scientist);

        var detail = await JsonAsync(await As(Admin).GetAsync($"/api/v1/pods/{pod.Id}"));
        var member = detail.GetProperty("members")[0];

        member.GetProperty("roles").EnumerateArray().Select(r => r.GetString()).ShouldBe(["Data Scientist"]);
        member.EnumerateObject().Select(p => p.Name).ShouldNotContain(n => n.Contains("lead", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Pod_changes_are_audited_with_the_actor()
    {
        var admin = await ProvisionAsync(Admin);
        var user = await ProvisionAsync(@"KE\tariq");
        var (id, rowVersion) = await CreatePodAsync("Pod A");
        await AddMembersAsync(id, user);
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{id}/members/{user}", new { isPrimary = true })).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{id}", new { name = "Pod A", isActive = false, rowVersion })).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await As(Admin).DeleteAsync($"/api/v1/pods/{id}/members/{user}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var events = await _factory.WithDbAsync(db => db.Set<AuditEvent>().Where(e => e.ObjectType == "Pod" || e.ObjectType == "PodMember").OrderBy(e => e.Id).ToListAsync());

        events.ShouldAllBe(e => e.ActorUserId == admin);
        events.ShouldContain(e => e.ObjectType == "Pod" && e.ObjectId == id.ToString() && e.FieldKey == "Name" && e.NewValue == "Pod A");
        events.ShouldContain(e => e.ObjectType == "Pod" && e.FieldKey == "IsActive" && e.OldValue == "true" && e.NewValue == "false");
        events.ShouldNotContain(e => e.ObjectType == "PodMember"); // membership is audited by readable Pod events, not raw field changes

        var summaries = events.Where(e => e.EventType.StartsWith("POD_", StringComparison.Ordinal)).Select(e => (e.EventType, e.Summary)).ToList();
        summaries.ShouldBe(
        [
            ("POD_MEMBER_ADDED", @"Added KE\tariq to Pod A"),
            ("POD_PRIMARY_SET", @"Set Pod A as the primary pod of KE\tariq"),
            ("POD_MEMBER_REMOVED", @"Removed KE\tariq from Pod A (it was their primary pod)"),
        ]);
    }

    private async Task<JsonElement> SetUserPodsAsync(int userId, object body, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await As(Admin).PutAsJsonAsync($"/api/v1/users/{userId}/pods", body);
        response.StatusCode.ShouldBe(expected);
        return await JsonAsync(response);
    }

    [Fact]
    public async Task Setting_a_users_pods_replaces_memberships_and_the_primary_in_one_call()
    {
        var user = await ProvisionAsync(@"KE\jamal");
        var (processing, _) = await CreatePodAsync("Processing");
        var (review, _) = await CreatePodAsync("Review");
        var (intake, _) = await CreatePodAsync("Intake");

        var first = await SetUserPodsAsync(user, new { podIds = new[] { processing, review }, primaryPodId = processing });
        first.EnumerateArray().Select(p => (p.GetProperty("name").GetString(), p.GetProperty("isPrimary").GetBoolean())).ShouldBe([("Processing", true), ("Review", false)]);

        // Move the primary to a new pod and drop one in the same call.
        var second = await SetUserPodsAsync(user, new { podIds = new[] { review, intake }, primaryPodId = intake, expectedPodIds = new[] { processing, review }, expectedPrimaryPodId = processing });
        second.EnumerateArray().Select(p => (p.GetProperty("name").GetString(), p.GetProperty("isPrimary").GetBoolean())).ShouldBe([("Intake", true), ("Review", false)]);

        // Same state again is a no-op that still succeeds; clearing everything works.
        await SetUserPodsAsync(user, new { podIds = new[] { review, intake }, primaryPodId = intake });
        (await SetUserPodsAsync(user, new { podIds = Array.Empty<int>() })).GetArrayLength().ShouldBe(0);
        (await UserPodNamesAsync(user, "?includeInactive=true")).ShouldBeEmpty();
    }

    [Fact]
    public async Task Setting_a_users_pods_validates_the_request()
    {
        var user = await ProvisionAsync(@"KE\jamal");
        var (a, _) = await CreatePodAsync("Pod A");
        var (b, rowVersionB) = await CreatePodAsync("Pod B");

        // The primary must be one of the selected pods.
        (await JsonAsync(await As(Admin).PutAsJsonAsync($"/api/v1/users/{user}/pods", new { podIds = new[] { a }, primaryPodId = b }))).GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
        (await As(Admin).PutAsJsonAsync($"/api/v1/users/{user}/pods", new { podIds = new[] { 9999 } })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await As(Admin).PutAsJsonAsync("/api/v1/users/9999/pods", new { podIds = new[] { a } })).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // A user in an inactive pod keeps it; the pod cannot be newly assigned or made primary.
        await SetUserPodsAsync(user, new { podIds = new[] { a, b }, primaryPodId = a });
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{b}", new { name = "Pod B", isActive = false, rowVersion = rowVersionB })).StatusCode.ShouldBe(HttpStatusCode.OK);
        var kept = await SetUserPodsAsync(user, new { podIds = new[] { a, b }, primaryPodId = a });
        kept.GetArrayLength().ShouldBe(2);
        var other = await ProvisionAsync(@"KE\other");
        (await JsonAsync(await As(Admin).PutAsJsonAsync($"/api/v1/users/{other}/pods", new { podIds = new[] { b } }))).GetProperty("code").GetString().ShouldBe("POD_INACTIVE");
        (await JsonAsync(await As(Admin).PutAsJsonAsync($"/api/v1/users/{user}/pods", new { podIds = new[] { a, b }, primaryPodId = b }))).GetProperty("code").GetString().ShouldBe("POD_INACTIVE");
        (await UserPodNamesAsync(user, "?includeInactive=true")).ShouldBe(["Pod A", "Pod B"]);
    }

    [Fact]
    public async Task Setting_a_users_pods_is_a_conflict_when_the_memberships_changed_meanwhile()
    {
        var user = await ProvisionAsync(@"KE\jamal");
        var (a, _) = await CreatePodAsync("Pod A");
        var (b, _) = await CreatePodAsync("Pod B");
        await SetUserPodsAsync(user, new { podIds = new[] { a }, primaryPodId = a });
        await AddMembersAsync(b, user); // someone else

        var conflict = await As(Admin).PutAsJsonAsync($"/api/v1/users/{user}/pods", new { podIds = new[] { a }, primaryPodId = a, expectedPodIds = new[] { a }, expectedPrimaryPodId = a });
        conflict.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await JsonAsync(conflict)).GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");
        (await UserPodNamesAsync(user)).ShouldBe(["Pod A", "Pod B"]);
    }

    [Fact]
    public async Task Setting_a_users_pods_needs_Pod_ManageMembers_and_is_audited_readably()
    {
        var user = await ProvisionAsync(@"KE\jamal");
        var (a, _) = await CreatePodAsync("Processing");
        var (b, _) = await CreatePodAsync("Review");

        (await As(@"KE\scientist").PutAsJsonAsync($"/api/v1/users/{user}/pods", new { podIds = new[] { a } })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        await SetUserPodsAsync(user, new { podIds = new[] { a, b }, primaryPodId = a });
        await SetUserPodsAsync(user, new { podIds = new[] { b }, primaryPodId = b });

        var events = await _factory.WithDbAsync(db => db.Set<AuditEvent>().Where(e => e.EventType.StartsWith("POD_")).OrderBy(e => e.Id).ToListAsync());
        events.Select(e => e.Summary).ShouldBe(
        [
            @"Added KE\jamal to Processing Pod",
            @"Added KE\jamal to Review Pod",
            @"Set Processing Pod as the primary pod of KE\jamal",
            @"Removed KE\jamal from Processing Pod (it was their primary pod)",
            @"Set Review Pod as the primary pod of KE\jamal (was Processing Pod)",
        ], ignoreOrder: true);
        events.Select(e => e.CorrelationId).Distinct().Count().ShouldBe(2); // one operation per call
    }

    [Fact]
    public async Task The_users_list_returns_each_users_pods_including_inactive_ones()
    {
        var user = await ProvisionAsync(@"KE\jamal");
        var other = await ProvisionAsync(@"KE\other");
        var (a, _) = await CreatePodAsync("Pod A");
        var (b, _) = await CreatePodAsync("Pod B");
        await SetUserPodsAsync(user, new { podIds = new[] { a, b }, primaryPodId = b });
        (await As(Admin).PutAsJsonAsync($"/api/v1/pods/{a}", new { name = "Pod A", isActive = false, rowVersion = (await JsonAsync(await As(Admin).GetAsync($"/api/v1/pods/{a}"))).GetProperty("pod").GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.OK);

        var list = await JsonAsync(await As(Admin).GetAsync("/api/v1/users?status=all&pageSize=100"));
        var rows = list.GetProperty("items").EnumerateArray().ToDictionary(u => u.GetProperty("userId").GetInt32());
        rows[user].GetProperty("pods").EnumerateArray().Select(p => (p.GetProperty("name").GetString(), p.GetProperty("isActive").GetBoolean(), p.GetProperty("isPrimary").GetBoolean()))
            .ShouldBe([("Pod A", false, false), ("Pod B", true, true)]);
        rows[other].GetProperty("pods").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task Endpoints_are_gated_by_the_pod_permissions()
    {
        var (id, _) = await CreatePodAsync("Pod A");
        var viewer = As(@"KE\scientist"); // Data Scientist: Pod.View only

        (await viewer.GetAsync("/api/v1/pods")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync($"/api/v1/pods/{id}")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var create = await viewer.PostAsJsonAsync("/api/v1/pods", new { name = "Nope" });
        create.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await JsonAsync(create)).GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Pod.Manage");
        (await viewer.PutAsJsonAsync($"/api/v1/pods/{id}", new { name = "Nope", isActive = true, rowVersion = "AAAA" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var members = await viewer.PostAsJsonAsync($"/api/v1/pods/{id}/members", new { userIds = new[] { 1 } });
        members.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await JsonAsync(members)).GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Pod.ManageMembers");
        (await viewer.DeleteAsync($"/api/v1/pods/{id}/members/1")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.GetAsync("/api/v1/pods/member-candidates")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var pending = await As(@"KE\nobody").GetAsync("/api/v1/pods");
        pending.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await JsonAsync(pending)).GetProperty("code").GetString().ShouldBe("ACCESS_PENDING");
    }

    [Fact]
    public async Task Member_candidates_are_active_users_filtered_by_search()
    {
        await ProvisionAsync(@"KE\tariq");
        var leaver = await ProvisionAsync(@"KE\leaver");
        await _factory.WithDbAsync(async db =>
        {
            (await db.Set<AppUser>().SingleAsync(u => u.Id == leaver)).IsActive = false;
            await db.SaveChangesAsync();
        });

        var result = await JsonAsync(await As(Admin).GetAsync("/api/v1/pods/member-candidates?q=tariq"));

        result.EnumerateArray().Select(u => u.GetProperty("displayName").GetString()).ShouldBe([@"KE\tariq"]);
        (await JsonAsync(await As(Admin).GetAsync("/api/v1/pods/member-candidates")))
            .EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ShouldNotContain(leaver);
    }

    [Fact]
    public async Task Pod_members_show_email_and_roles_only_to_callers_who_may_see_the_directory()
    {
        var (podId, _) = await CreatePodAsync("Pod Visible");
        var adminId = await ProvisionAsync(Admin);
        var viewerId = await ProvisionAsync(@"KEiewer");
        await AddMembersAsync(podId, adminId);
        (await As(Admin).PutAsJsonAsync($"/api/v1/users/{adminId}", new { displayName = "Kim Admin", email = "kim@firm.test", rowVersion = (await JsonAsync(await As(Admin).GetAsync($"/api/v1/users/{adminId}"))).GetProperty("rowVersion").GetString() }))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
        await _factory.GrantRoleAsync(@"KEiewer", await _factory.CreateRoleAsync("Pod Viewer", Permissions.Pod.View));
        viewerId.ShouldBeGreaterThan(0);

        var asAdmin = (await JsonAsync(await As(Admin).GetAsync($"/api/v1/pods/{podId}"))).GetProperty("members")[0];
        var asViewer = (await JsonAsync(await As(@"KEiewer").GetAsync($"/api/v1/pods/{podId}"))).GetProperty("members")[0];

        asAdmin.GetProperty("email").GetString().ShouldBe("kim@firm.test");
        asAdmin.GetProperty("roles").EnumerateArray().Select(r => r.GetString()).ShouldContain("System Admin");
        asViewer.GetProperty("displayName").GetString().ShouldBe("Kim Admin");
        asViewer.GetProperty("email").ValueKind.ShouldBe(JsonValueKind.Null);
        asViewer.GetProperty("roles").GetArrayLength().ShouldBe(0);
    }
}
