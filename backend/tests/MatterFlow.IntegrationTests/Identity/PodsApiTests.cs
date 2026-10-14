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
        events.ShouldContain(e => e.ObjectType == "PodMember" && e.ObjectId == $"{id}-{user}" && e.FieldKey == "IsPrimary" && e.NewValue == "false" && e.OldValue == null); // added
        events.ShouldContain(e => e.ObjectType == "PodMember" && e.ObjectId == $"{id}-{user}" && e.FieldKey == "IsPrimary" && e.NewValue == "true");
        events.ShouldContain(e => e.ObjectType == "PodMember" && e.ObjectId == $"{id}-{user}" && e.FieldKey == "IsPrimary" && e.OldValue == "true" && e.NewValue == null); // removed
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
}
