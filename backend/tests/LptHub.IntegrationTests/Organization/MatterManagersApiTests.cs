using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// Primary and Secondary project manager of a matter (epic #667, issues #672, #674, #675): the DTO fields, <c>PUT /matters/{id}/managers</c>, the
/// eligibility rules, the audit trail, the eligible-managers lookup and the Matters list filters and sorts. A matter without a manager is normal.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MatterManagersApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private int _clientId;
    private readonly Dictionary<string, int> _ids = [];

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _clientId = (await OkAsync(await Admin().PostAsJsonAsync("/api/v1/clients", new { clientNumber = "343", name = "Acme" }), HttpStatusCode.Created)).GetProperty("clientId").GetInt32();

        // Two eligible project managers, a director (assigns but cannot be named), a plain editor and a viewer.
        var pm = await _factory.CreateRoleAsync("PM", Permissions.Matter.View, Permissions.Matter.Create, Permissions.Matter.Edit, Permissions.Matter.BeManager, Permissions.Matter.AssignManagers, Permissions.Task.View);
        var assigner = await _factory.CreateRoleAsync("Assigner", Permissions.Matter.View, Permissions.Matter.Create, Permissions.Matter.Edit, Permissions.Matter.AssignManagers);
        var editor = await _factory.CreateRoleAsync("Editor", Permissions.Matter.View, Permissions.Matter.Edit, Permissions.Matter.Create);
        var viewer = await _factory.CreateRoleAsync("Viewer", Permissions.Matter.View);
        var beOnly = await _factory.CreateRoleAsync("Eligible only", Permissions.Matter.BeManager);
        foreach (var (account, role) in new[] { (@"KE\ann", pm), (@"KE\bob", pm), (@"KE\carl", beOnly), (@"KE\dora", assigner), (@"KE\erin", editor), (@"KE\finn", viewer) })
        {
            var me = await OkAsync(await As(account).GetAsync("/api/v1/me"));
            _ids[account] = me.GetProperty("userId").GetInt32();
            await _factory.GrantRoleAsync(account, role);
        }
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private int Id(string account) => _ids[account];

    private HttpClient Admin() => As(DatabaseApiFactory.AdminAccount);

    private HttpClient As(string user)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return JsonDocument.Parse(body).RootElement;
    }

    private static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(status, body);
        var problem = JsonDocument.Parse(body).RootElement;
        problem.GetProperty("code").GetString().ShouldBe(code);
        return problem;
    }

    private async Task<JsonElement> NewMatterAsync(string number, object? extra = null)
    {
        var body = new Dictionary<string, object?> { ["clientId"] = _clientId, ["matterNumber"] = number, ["name"] = "Matter " + number };
        if (extra is not null)
        {
            foreach (var p in extra.GetType().GetProperties())
                body[p.Name] = p.GetValue(extra);
        }

        return await OkAsync(await Admin().PostAsJsonAsync("/api/v1/matters", body), HttpStatusCode.Created);
    }

    private Task<HttpResponseMessage> SetAsync(HttpClient client, JsonElement matter, int? primary, int? secondary) =>
        client.PutAsJsonAsync($"/api/v1/matters/{matter.GetProperty("matterId").GetInt32()}/managers", new { primaryManagerId = primary, secondaryManagerId = secondary, rowVersion = matter.GetProperty("rowVersion").GetString() });

    private async Task<JsonElement> ReadAsync(JsonElement matter) =>
        await OkAsync(await Admin().GetAsync($"/api/v1/matters/{matter.GetProperty("matterId").GetInt32()}"));

    private static int? ManagerId(JsonElement matter, string place) =>
        matter.GetProperty(place).ValueKind == JsonValueKind.Null ? null : matter.GetProperty(place).GetProperty("userId").GetInt32();

    private async Task<List<JsonElement>> ManagerEventsAsync(int matterId)
    {
        var page = await OkAsync(await Admin().GetAsync($"/api/v1/audit/events?objectType=Matter&objectId={matterId}&pageSize=100"));
        return [.. page.GetProperty("items").EnumerateArray().Where(e => e.GetProperty("eventType").GetString() == "MATTER_MANAGER_CHANGED")];
    }

    [Fact]
    public async Task A_fresh_database_seeds_the_same_grants_as_the_upgrade_script_gives_an_existing_one()
    {
        // The upgrade script (MatterManagersSchemaTests) grants Matter.BeManager + AssignManagers to "Project Manager" and AssignManagers to "Director".
        async Task<string[]> GrantsAsync(string role) => await _factory.WithDbAsync(async db =>
            await db.Set<RolePermission>()
                .Where(rp => rp.Role.Name == role && (rp.Permission.Code == Permissions.Matter.BeManager || rp.Permission.Code == Permissions.Matter.AssignManagers))
                .Select(rp => rp.Permission.Code)
                .OrderBy(c => c)
                .ToArrayAsync());

        (await GrantsAsync("Project Manager")).ShouldBe([Permissions.Matter.AssignManagers, Permissions.Matter.BeManager]);
        (await GrantsAsync("Director")).ShouldBe([Permissions.Matter.AssignManagers]);
        (await GrantsAsync("Pod Lead")).ShouldBeEmpty();
        (await GrantsAsync("Data Technician")).ShouldBeEmpty();
    }

    [Fact]
    public async Task A_matter_without_a_manager_is_normal()
    {
        var matter = await NewMatterAsync("1");

        matter.GetProperty("primaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
        matter.GetProperty("secondaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
        (await ManagerEventsAsync(matter.GetProperty("matterId").GetInt32())).ShouldBeEmpty();
    }

    [Fact]
    public async Task Managers_can_be_set_swapped_and_cleared_and_each_change_is_audited_with_names()
    {
        var matter = await NewMatterAsync("2");
        var matterId = matter.GetProperty("matterId").GetInt32();
        var ann = Id(@"KE\ann");
        var bob = Id(@"KE\bob");

        var set = await OkAsync(await SetAsync(As(@"KE\dora"), matter, ann, bob));
        ManagerId(set, "primaryManager").ShouldBe(ann);
        ManagerId(set, "secondaryManager").ShouldBe(bob);
        set.GetProperty("primaryManager").GetProperty("isActive").GetBoolean().ShouldBeTrue();
        set.GetProperty("primaryManager").GetProperty("displayName").GetString().ShouldNotBeNullOrWhiteSpace();
        var events = await ManagerEventsAsync(matterId);
        events.Count.ShouldBe(2);
        events.Select(e => e.GetProperty("correlationId").GetString()).Distinct().Count().ShouldBe(1); // one operation, one correlation id
        var primaryEvent = events.Single(e => e.GetProperty("fieldKey").GetString() == "PrimaryManager");
        primaryEvent.GetProperty("newValue").GetString().ShouldBe(set.GetProperty("primaryManager").GetProperty("displayName").GetString());
        primaryEvent.TryGetProperty("oldValue", out var old).ShouldBeTrue();
        old.ValueKind.ShouldBe(JsonValueKind.Null);
        primaryEvent.GetProperty("actorUserId").GetInt32().ShouldBe(Id(@"KE\dora"));

        var swapped = await OkAsync(await SetAsync(As(@"KE\dora"), set, bob, ann));
        ManagerId(swapped, "primaryManager").ShouldBe(bob);
        ManagerId(swapped, "secondaryManager").ShouldBe(ann);
        (await ManagerEventsAsync(matterId)).Count.ShouldBe(4);

        var cleared = await OkAsync(await SetAsync(As(@"KE\dora"), swapped, null, null));
        cleared.GetProperty("primaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
        cleared.GetProperty("secondaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
        var removal = (await ManagerEventsAsync(matterId)).Single(e => e.GetProperty("fieldKey").GetString() == "PrimaryManager" && e.GetProperty("summary").GetString()!.Contains("removed", StringComparison.Ordinal));
        removal.GetProperty("newValue").ValueKind.ShouldBe(JsonValueKind.Null);
        removal.GetProperty("oldValue").GetString().ShouldBe(swapped.GetProperty("primaryManager").GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task Saving_the_same_managers_again_writes_nothing()
    {
        var matter = await NewMatterAsync("3");
        var set = await OkAsync(await SetAsync(Admin(), matter, Id(@"KE\ann"), null));

        var again = await OkAsync(await SetAsync(Admin(), set, Id(@"KE\ann"), null));

        again.GetProperty("rowVersion").GetString().ShouldBe(set.GetProperty("rowVersion").GetString());
        (await ManagerEventsAsync(matter.GetProperty("matterId").GetInt32())).Count.ShouldBe(1);
    }

    [Fact]
    public async Task A_Secondary_without_a_Primary_is_allowed()
    {
        var matter = await NewMatterAsync("4");

        var set = await OkAsync(await SetAsync(Admin(), matter, null, Id(@"KE\bob")));

        set.GetProperty("primaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
        ManagerId(set, "secondaryManager").ShouldBe(Id(@"KE\bob"));
    }

    [Fact]
    public async Task The_same_person_twice_is_refused()
    {
        var matter = await NewMatterAsync("5");

        var problem = await ProblemAsync(await SetAsync(Admin(), matter, Id(@"KE\ann"), Id(@"KE\ann")), HttpStatusCode.BadRequest, "MANAGER_DUPLICATE");

        problem.GetProperty("errors").GetProperty("secondaryManagerId")[0].GetProperty("code").GetString().ShouldBe("MANAGER_DUPLICATE");
        (await ReadAsync(matter)).GetProperty("primaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Only_active_users_holding_BeManager_can_be_named()
    {
        var matter = await NewMatterAsync("6");

        // Dora (assigns but is not eligible), Finn (viewer), a user that does not exist.
        foreach (var user in new[] { Id(@"KE\dora"), Id(@"KE\finn"), 999999 })
        {
            var problem = await ProblemAsync(await SetAsync(Admin(), matter, user, null), HttpStatusCode.BadRequest, "MANAGER_NOT_ELIGIBLE");
            problem.GetProperty("errors").GetProperty("primaryManagerId")[0].GetProperty("code").GetString().ShouldBe("MANAGER_NOT_ELIGIBLE");
        }

        // A disabled user holding the role is not eligible either.
        await _factory.WithDbAsync(async db => await db.Set<AppUser>().Where(u => u.Id == Id(@"KE\carl")).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false)));
        _factory.InvalidateAll();
        await ProblemAsync(await SetAsync(Admin(), matter, Id(@"KE\carl"), null), HttpStatusCode.BadRequest, "MANAGER_NOT_ELIGIBLE");
        (await ReadAsync(matter)).GetProperty("primaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task A_manager_who_lost_the_role_stays_and_may_be_swapped_but_cannot_be_newly_named()
    {
        var matter = await NewMatterAsync("7");
        var set = await OkAsync(await SetAsync(Admin(), matter, Id(@"KE\carl"), Id(@"KE\ann")));

        // Carl loses the role (and with it Matter.BeManager).
        await _factory.WithDbAsync(async db => await db.Set<UserRole>().Where(r => r.UserId == Id(@"KE\carl")).ExecuteDeleteAsync());
        _factory.InvalidateAll();

        // The unchanged value is accepted while somebody else changes the Secondary; the matter still shows him.
        var changed = await OkAsync(await SetAsync(Admin(), set, Id(@"KE\carl"), Id(@"KE\bob")));
        ManagerId(changed, "primaryManager").ShouldBe(Id(@"KE\carl"));
        ManagerId(changed, "secondaryManager").ShouldBe(Id(@"KE\bob"));
        var swapped = await OkAsync(await SetAsync(Admin(), changed, Id(@"KE\bob"), Id(@"KE\carl")));
        ManagerId(swapped, "secondaryManager").ShouldBe(Id(@"KE\carl"));

        // On another matter he cannot be named any more.
        var other = await NewMatterAsync("8");
        await ProblemAsync(await SetAsync(Admin(), other, Id(@"KE\carl"), null), HttpStatusCode.BadRequest, "MANAGER_NOT_ELIGIBLE");
    }

    [Fact]
    public async Task Changing_managers_needs_AssignManagers_and_Matter_Edit_is_not_enough()
    {
        var matter = await NewMatterAsync("9");

        foreach (var user in new[] { @"KE\erin", @"KE\finn" })
        {
            var problem = await ProblemAsync(await SetAsync(As(user), matter, Id(@"KE\ann"), null), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
            problem.GetProperty("meta").GetProperty("permission").GetString().ShouldBe(Permissions.Matter.AssignManagers);
        }

        (await ReadAsync(matter)).GetProperty("primaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task A_stale_row_version_is_a_conflict()
    {
        var matter = await NewMatterAsync("10");
        await OkAsync(await SetAsync(Admin(), matter, Id(@"KE\ann"), null));

        await ProblemAsync(await SetAsync(Admin(), matter, Id(@"KE\bob"), null), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
    }

    [Fact]
    public async Task Create_and_edit_take_managers_only_with_AssignManagers()
    {
        // Create with managers (Dora may).
        var created = await OkAsync(
            await As(@"KE\dora").PostAsJsonAsync("/api/v1/matters", new { clientId = _clientId, matterNumber = "11", name = "With a manager", primaryManagerId = Id(@"KE\ann") }),
            HttpStatusCode.Created);
        ManagerId(created, "primaryManager").ShouldBe(Id(@"KE\ann"));
        created.GetProperty("secondaryManager").ValueKind.ShouldBe(JsonValueKind.Null);
        (await ManagerEventsAsync(created.GetProperty("matterId").GetInt32())).Count.ShouldBe(1);

        // Create with managers (Erin may not): 403 and no matter.
        await ProblemAsync(
            await As(@"KE\erin").PostAsJsonAsync("/api/v1/matters", new { clientId = _clientId, matterNumber = "12", name = "Nope", primaryManagerId = Id(@"KE\ann") }),
            HttpStatusCode.Forbidden,
            "PERMISSION_DENIED");
        (await As(@"KE\erin").GetAsync("/api/v1/matters/lookup?ref=343-12")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // Create without managers is unchanged for an editor.
        await OkAsync(await As(@"KE\erin").PostAsJsonAsync("/api/v1/matters", new { clientId = _clientId, matterNumber = "13", name = "Plain" }), HttpStatusCode.Created);

        // Edit: a plain edit leaves the managers; an editor naming one is refused; an assigner sets the Secondary (the Primary stays) and cannot duplicate.
        var id = created.GetProperty("matterId").GetInt32();
        var edited = await OkAsync(await As(@"KE\erin").PutAsJsonAsync($"/api/v1/matters/{id}", new { name = "Renamed", isSensitive = false, rowVersion = created.GetProperty("rowVersion").GetString() }));
        ManagerId(edited, "primaryManager").ShouldBe(Id(@"KE\ann"));
        await ProblemAsync(
            await As(@"KE\erin").PutAsJsonAsync($"/api/v1/matters/{id}", new { name = "Renamed", isSensitive = false, secondaryManagerId = Id(@"KE\bob"), rowVersion = edited.GetProperty("rowVersion").GetString() }),
            HttpStatusCode.Forbidden,
            "PERMISSION_DENIED");
        await ProblemAsync(
            await As(@"KE\dora").PutAsJsonAsync($"/api/v1/matters/{id}", new { name = "Renamed", isSensitive = false, secondaryManagerId = Id(@"KE\ann"), rowVersion = edited.GetProperty("rowVersion").GetString() }),
            HttpStatusCode.BadRequest,
            "MANAGER_DUPLICATE");
        var patched = await OkAsync(await As(@"KE\dora").PutAsJsonAsync($"/api/v1/matters/{id}", new { name = "Renamed", isSensitive = false, secondaryManagerId = Id(@"KE\bob"), rowVersion = edited.GetProperty("rowVersion").GetString() }));
        ManagerId(patched, "primaryManager").ShouldBe(Id(@"KE\ann"));
        ManagerId(patched, "secondaryManager").ShouldBe(Id(@"KE\bob"));
    }

    [Fact]
    public async Task The_eligible_lookup_lists_only_active_BeManager_holders_with_search_and_a_cap()
    {
        var all = await OkAsync(await As(@"KE\finn").GetAsync("/api/v1/users/matter-managers?take=50"));
        var names = all.EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ToList();
        names.ShouldContain(Id(@"KE\ann"));
        names.ShouldContain(Id(@"KE\bob"));
        names.ShouldContain(Id(@"KE\carl"));
        names.ShouldNotContain(Id(@"KE\dora"));
        names.ShouldNotContain(Id(@"KE\erin"));
        names.ShouldNotContain(Id(@"KE\finn"));
        all[0].GetProperty("availability").GetProperty("state").GetString().ShouldNotBeNull();

        var ann = await OkAsync(await As(@"KE\finn").GetAsync("/api/v1/users/matter-managers?q=ann"));
        ann.EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ShouldContain(Id(@"KE\ann"));
        ann.EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ShouldNotContain(Id(@"KE\bob"));

        (await OkAsync(await As(@"KE\finn").GetAsync("/api/v1/users/matter-managers?take=2"))).GetArrayLength().ShouldBe(2);
        (await As(@"KE\finn").GetAsync("/api/v1/users/matter-managers?take=51")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        await _factory.WithDbAsync(async db => await db.Set<AppUser>().Where(u => u.Id == Id(@"KE\bob")).ExecuteUpdateAsync(s => s.SetProperty(u => u.IsActive, false)));
        _factory.InvalidateAll();
        (await OkAsync(await As(@"KE\finn").GetAsync("/api/v1/users/matter-managers?take=50"))).EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ShouldNotContain(Id(@"KE\bob"));

        // Needs Matter.View.
        await As(@"KE\nobody").GetAsync("/api/v1/me");
        var noMatter = await _factory.CreateRoleAsync("Tasks only", Permissions.Task.View);
        await _factory.GrantRoleAsync(@"KE\nobody", noMatter);
        await ProblemAsync(await As(@"KE\nobody").GetAsync("/api/v1/users/matter-managers"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }

    private async Task<(int One, int Two, int Three, int Four)> ListFixtureAsync()
    {
        // 20: Ann primary. 21: Bob primary, Ann secondary. 22: Secondary Ann only. 23: no manager.
        var m20 = await NewMatterAsync("20");
        var m21 = await NewMatterAsync("21");
        var m22 = await NewMatterAsync("22");
        var m23 = await NewMatterAsync("23");
        await OkAsync(await SetAsync(Admin(), m20, Id(@"KE\ann"), null));
        await OkAsync(await SetAsync(Admin(), m21, Id(@"KE\bob"), Id(@"KE\ann")));
        await OkAsync(await SetAsync(Admin(), m22, null, Id(@"KE\ann")));
        return (m20.GetProperty("matterId").GetInt32(), m21.GetProperty("matterId").GetInt32(), m22.GetProperty("matterId").GetInt32(), m23.GetProperty("matterId").GetInt32());
    }

    private async Task<List<int>> ListIdsAsync(HttpClient client, string query)
    {
        var page = await OkAsync(await client.GetAsync("/api/v1/matters?" + query + "&isActive=true&pageSize=100"));
        return [.. page.GetProperty("items").EnumerateArray().Select(m => m.GetProperty("matterId").GetInt32())];
    }

    [Fact]
    public async Task The_list_filters_by_primary_secondary_either_mine_none_and_any()
    {
        var (one, two, three, four) = await ListFixtureAsync();
        var ann = Id(@"KE\ann");
        var bob = Id(@"KE\bob");

        (await ListIdsAsync(Admin(), $"primaryManagerId={ann}")).ShouldBe([one]);
        (await ListIdsAsync(Admin(), $"primaryManagerId={bob}")).ShouldBe([two]);
        (await ListIdsAsync(Admin(), $"secondaryManagerId={ann}")).ShouldBe([two, three]);
        (await ListIdsAsync(Admin(), $"managerId={ann}")).ShouldBe([one, two, three]);
        (await ListIdsAsync(As(@"KE\ann"), "managedByMe=true")).ShouldBe([one, two, three]);
        (await ListIdsAsync(As(@"KE\bob"), "managedByMe=true")).ShouldBe([two]);
        (await ListIdsAsync(As(@"KE\erin"), "managedByMe=true")).ShouldBeEmpty();
        (await ListIdsAsync(Admin(), "hasNoManager=true")).ShouldBe([four]);
        (await ListIdsAsync(Admin(), "hasNoManager=false")).ShouldBe([one, two, three]);
        (await ListIdsAsync(Admin(), "hasPrimaryManager=false")).ShouldBe([three, four]);
        (await ListIdsAsync(Admin(), "hasSecondaryManager=true")).ShouldBe([two, three]);
        (await ListIdsAsync(Admin(), "hasSecondaryManager=false")).ShouldBe([one, four]);
        // Combined with an existing filter and with a client that has no such matters.
        (await ListIdsAsync(Admin(), $"managerId={ann}&name=Matter%2021")).ShouldBe([two]);
        (await ListIdsAsync(Admin(), $"managerId={ann}&clientId=9999")).ShouldBeEmpty();
        // Unknown filters are still a 400.
        (await Admin().GetAsync("/api/v1/matters?managerid2=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task The_list_sorts_by_manager_name_with_matters_without_one_last_either_way()
    {
        var (one, two, three, four) = await ListFixtureAsync();
        var names = await OkAsync(await Admin().GetAsync("/api/v1/matters?isActive=true&pageSize=100"));
        string Primary(int id) => names.GetProperty("items").EnumerateArray().First(m => m.GetProperty("matterId").GetInt32() == id).GetProperty("primaryManager") is { ValueKind: JsonValueKind.Object } p ? p.GetProperty("displayName").GetString()! : "";
        var annFirst = string.CompareOrdinal(Primary(one), Primary(two)) < 0; // Ann sorts before Bob unless the display names say otherwise

        var asc = await ListIdsAsync(Admin(), "sort=primaryManager");
        var desc = await ListIdsAsync(Admin(), "sort=-primaryManager");
        asc.TakeLast(2).OrderBy(i => i).ShouldBe([three, four]); // no Primary: last
        desc.TakeLast(2).OrderBy(i => i).ShouldBe([three, four]);
        asc.Take(2).ToList().ShouldBe(annFirst ? [one, two] : [two, one]);
        desc.Take(2).ToList().ShouldBe(annFirst ? [two, one] : [one, two]);

        var secondary = await ListIdsAsync(Admin(), "sort=secondaryManager");
        secondary.Take(2).OrderBy(i => i).ShouldBe([two, three]); // both Ann
        secondary.TakeLast(2).OrderBy(i => i).ShouldBe([one, four]);
    }

    [Fact]
    public async Task The_list_and_the_detail_carry_the_managers_and_the_lookup_resolves_them()
    {
        var (one, _, _, _) = await ListFixtureAsync();

        var page = await OkAsync(await As(@"KE\finn").GetAsync("/api/v1/matters?managerId=" + Id(@"KE\ann")));
        page.GetProperty("items").EnumerateArray().First(m => m.GetProperty("matterId").GetInt32() == one).GetProperty("primaryManager").GetProperty("userId").GetInt32().ShouldBe(Id(@"KE\ann"));
        var lookup = await OkAsync(await As(@"KE\finn").GetAsync("/api/v1/matters/lookup?ref=343-20"));
        ManagerId(lookup, "primaryManager").ShouldBe(Id(@"KE\ann"));
    }
}
