using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>
/// The column filters of the administration lists (epic #75, Batch 4): Users (name, account, e-mail, roles, availability, first-seen days),
/// Pods (name), Workflows (name, published, draft), Workflow Steps (title, description, used) and the Audit Logs actor list. Each box
/// searches its own column with a parameterised Contains (case-insensitive, <c>%</c> / <c>_</c> / <c>[</c> literal) and the filters
/// combine with AND.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AdminColumnFilterTests(SqlServerFixture sql) : IAsyncLifetime
{
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

    private static StringContent Json(object value) => new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return JsonDocument.Parse(body).RootElement;
    }

    private async Task<string[]> Names(string path, string field)
    {
        var page = await OkAsync(await As().GetAsync(path));
        return [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty(field).GetString()!)];
    }

    private async Task<int> ProvisionAsync(string account) =>
        (await OkAsync(await As(account).GetAsync("/api/v1/me"))).GetProperty("userId").GetInt32();

    // ---- Users

    private Task SetProfileAsync(string account, string displayName, string? email) => _factory.WithDbAsync(async db =>
    {
        var user = db.Set<MatterFlow.Identity.Domain.UserIdentity>().Where(i => i.Username == account).Select(i => i.User).Single();
        user.DisplayName = displayName;
        user.Email = email;
        await db.SaveChangesAsync();
    });

    [Fact]
    public async Task Users_filter_by_name_account_and_email_literally_and_combine()
    {
        await ProvisionAsync(@"KE\alice");
        await ProvisionAsync(@"KE\bob_100%");
        await ProvisionAsync(@"KE\carol[x]");
        await SetProfileAsync(@"KE\alice", "Alice Archer", "alice@firm.example");
        await SetProfileAsync(@"KE\bob_100%", "Bob Builder", null);
        await SetProfileAsync(@"KE\carol[x]", "Carol Clerk", "c.arol@other.example");

        Task<string[]> Accounts(string query) => Names($"/api/v1/users?{query}", "windowsAccount");

        (await Accounts("name=ALICE")).ShouldBe([@"KE\alice"]); // case-insensitive
        (await Accounts("account=bob")).ShouldBe([@"KE\bob_100%"]);
        (await Accounts("account=100%25")).ShouldBe([@"KE\bob_100%"]); // % is literal
        (await Accounts("account=%25")).ShouldBe([@"KE\bob_100%"]);
        (await Accounts("account=_100")).ShouldBe([@"KE\bob_100%"]); // _ is not "any character"
        (await Accounts("account=%5Bx")).ShouldBe([@"KE\carol[x]"]); // [ is literal
        (await Accounts("account=%5Bab")).ShouldBeEmpty();
        (await Accounts("email=firm.example")).ShouldBe([@"KE\alice"]);
        (await Accounts("email=c.arol")).ShouldBe([@"KE\carol[x]"]);
        (await Accounts("email=.")).Length.ShouldBe(2); // users without an e-mail never match
        (await Accounts("email=%25")).ShouldBeEmpty(); // % is literal
        (await Accounts("name=a&email=firm")).ShouldBe([@"KE\alice"]); // combined
        (await Accounts("name=alice&email=other")).ShouldBeEmpty();
    }

    [Fact]
    public async Task Users_filter_by_any_of_several_roles()
    {
        var alice = await ProvisionAsync(@"KE\alice");
        var bob = await ProvisionAsync(@"KE\bob");
        await ProvisionAsync(@"KE\carol");
        var lead = await _factory.CreateRoleAsync("Lead", Permissions.Pod.View);
        var clerk = await _factory.CreateRoleAsync("Clerk", Permissions.Pod.View);
        await _factory.GrantRoleAsync(@"KE\alice", lead);
        await _factory.GrantRoleAsync(@"KE\bob", clerk);

        Task<string[]> Accounts(string query) => Names($"/api/v1/users?{query}", "windowsAccount");

        (await Accounts($"roleId={lead}")).ShouldBe([@"KE\alice"]);
        (await Accounts($"roleId={clerk}")).ShouldBe([@"KE\bob"]);
        (await Accounts($"roleId={lead}&roleId={clerk}")).Order().ShouldBe([@"KE\alice", @"KE\bob"]); // any of them
        (await Accounts("roleId=99999")).ShouldBeEmpty();
        (await Accounts($"roleId={lead}&name=bob")).ShouldBeEmpty(); // combined with AND
        alice.ShouldNotBe(bob);
    }

    [Fact]
    public async Task Users_filter_by_availability_on_the_server_and_page_over_the_result()
    {
        await ProvisionAsync(@"KE\alice");
        await ProvisionAsync(@"KE\bob");
        await ProvisionAsync(@"KE\carol");
        await _factory.GrantRoleAsync(@"KE\bob", await _factory.CreateRoleAsync("Member", Permissions.Task.View)); // a pending user cannot save a profile
        var bob = As(@"KE\bob");
        var profile = await OkAsync(await bob.GetAsync("/api/v1/me/availability"));
        await OkAsync(await bob.PutAsync("/api/v1/me/availability", Json(new
        {
            status = "OUT_OF_OFFICE",
            until = "2099-10-20",
            note = "Away",
            rowVersion = profile.GetProperty("rowVersion").GetString(),
        })));

        (await Names("/api/v1/users?availability=OUT_OF_OFFICE", "windowsAccount")).ShouldBe([@"KE\bob"]);

        // Everyone else is available or (outside the default hours) off hours: together with out of office they are all the users.
        var all = (await OkAsync(await As().GetAsync("/api/v1/users?pageSize=100"))).GetProperty("total").GetInt32();
        var available = (await OkAsync(await As().GetAsync("/api/v1/users?availability=AVAILABLE"))).GetProperty("total").GetInt32();
        var offHours = (await OkAsync(await As().GetAsync("/api/v1/users?availability=OFF_HOURS"))).GetProperty("total").GetInt32();
        (available + offHours + 1).ShouldBe(all);

        // Paging runs over the filtered list, with the right total.
        var first = await OkAsync(await As().GetAsync("/api/v1/users?availability=OUT_OF_OFFICE&pageSize=1&page=1"));
        first.GetProperty("total").GetInt32().ShouldBe(1);
        first.GetProperty("items").GetArrayLength().ShouldBe(1);
        (await OkAsync(await As().GetAsync("/api/v1/users?availability=OUT_OF_OFFICE&pageSize=1&page=2"))).GetProperty("items").GetArrayLength().ShouldBe(0);

        // Combined with another filter, and an unknown state is a 400.
        (await Names("/api/v1/users?availability=OUT_OF_OFFICE&name=alice", "windowsAccount")).ShouldBeEmpty();
        (await As().GetAsync("/api/v1/users?availability=BUSY")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Users_filter_by_the_first_seen_days_in_the_viewers_zone_and_reject_bad_dates()
    {
        await ProvisionAsync(@"KE\alice");
        var today = DateTime.UtcNow.Date;
        string Day(int offset) => today.AddDays(offset).ToString("yyyy-MM-dd");

        Task<int> Total(string query) => Task.Run(async () => (await OkAsync(await As().GetAsync($"/api/v1/users?{query}"))).GetProperty("total").GetInt32());

        var everyone = await Total("");
        everyone.ShouldBeGreaterThan(0);
        (await Total($"registeredFrom={Day(-2)}")).ShouldBe(everyone);
        (await Total($"registeredTo={Day(2)}")).ShouldBe(everyone);
        (await Total($"registeredFrom={Day(-2)}&registeredTo={Day(2)}")).ShouldBe(everyone);
        (await Total($"registeredFrom={Day(2)}")).ShouldBe(0);
        (await Total($"registeredTo={Day(-2)}")).ShouldBe(0);

        (await As().GetAsync("/api/v1/users?registeredFrom=yesterday")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await As().GetAsync($"/api/v1/users?registeredFrom={Day(2)}&registeredTo={Day(-2)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    // ---- Pods

    [Fact]
    public async Task Pods_filter_by_name_only_literally()
    {
        foreach (var (name, description) in new[] { ("Alpha Pod", "handles intake"), ("100% Pod_X", "x"), ("Bracket [B]", "alpha notes") })
        {
            (await As().PostAsJsonAsync("/api/v1/pods", new { name, description })).StatusCode.ShouldBe(HttpStatusCode.Created);
        }

        Task<string[]> Pods(string query) => Names($"/api/v1/pods?sort=name&{query}", "name");

        (await Pods("name=ALPHA")).ShouldBe(["Alpha Pod"]); // the description is not searched by the column filter
        (await Pods("q=alpha")).ShouldBe(["Alpha Pod", "Bracket [B]"]); // the older any-text search still is
        (await Pods("name=100%25")).ShouldBe(["100% Pod_X"]);
        (await Pods("name=%25")).ShouldBe(["100% Pod_X"]); // % is literal
        (await Pods("name=_x")).ShouldBe(["100% Pod_X"]); // _ is literal
        (await Pods("name=%5BB")).ShouldBe(["Bracket [B]"]); // [ is literal
        (await Pods("name=%5Bz")).ShouldBeEmpty();
        (await Pods("name=pod&active=true")).ShouldBe(["100% Pod_X", "Alpha Pod"]); // combined with the status
    }

    // ---- Workflows and steps

    private async Task<JsonElement> CreateStepAsync(string title, string? description = null) =>
        await OkAsync(await As().PostAsync("/api/v1/step-definitions", Json(new { title, description })), HttpStatusCode.Created);

    private async Task<JsonElement> CreateWorkflowAsync(string name) =>
        await OkAsync(await As().PostAsync("/api/v1/workflows", Json(new { name, isOrdered = true })), HttpStatusCode.Created);

    /// <summary>Puts the step into the workflow's draft and publishes it.</summary>
    private async Task PublishWithStepAsync(JsonElement workflow, JsonElement step)
    {
        var client = As();
        var workflowId = workflow.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32();
        var draftId = workflow.GetProperty("workflow").GetProperty("draftVersionId").GetInt32();
        var draft = await OkAsync(await client.GetAsync($"/api/v1/workflows/{workflowId}/versions/{draftId}"));
        var saved = await OkAsync(await client.PutAsync(
            $"/api/v1/workflows/{workflowId}/versions/{draftId}",
            Json(new
            {
                isOrdered = true,
                steps = new[] { new { sourceStepDefinitionId = step.GetProperty("stepDefinitionId").GetInt32(), isSkippable = false, skipCommentRequired = false } },
                rowVersion = draft.GetProperty("version").GetProperty("rowVersion").GetString(),
            })));
        await OkAsync(await client.PostAsync(
            $"/api/v1/workflows/{workflowId}/versions/{draftId}/publish",
            Json(new { rowVersion = saved.GetProperty("version").GetProperty("rowVersion").GetString() })));
    }

    [Fact]
    public async Task Workflows_filter_by_name_published_and_draft()
    {
        var step = await CreateStepAsync("Review");
        var published = await CreateWorkflowAsync("Standard Processing");
        await PublishWithStepAsync(published, step);
        await CreateWorkflowAsync("100% Draft_Only"); // a draft, never published
        var both = await CreateWorkflowAsync("Both");
        await PublishWithStepAsync(both, step);
        var bothId = both.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32();
        (await As().PostAsync($"/api/v1/workflows/{bothId}/versions", Json(new { }))).StatusCode.ShouldBe(HttpStatusCode.Created); // a new draft on top

        Task<string[]> Workflows(string query) => Names($"/api/v1/workflows?sort=name&{query}", "name");

        (await Workflows("name=STANDARD")).ShouldBe(["Standard Processing"]); // case-insensitive
        (await Workflows("name=100%25")).ShouldBe(["100% Draft_Only"]); // % is literal
        (await Workflows("name=%25")).ShouldBe(["100% Draft_Only"]);
        (await Workflows("name=_Only")).ShouldBe(["100% Draft_Only"]);
        (await Workflows("name=%5B")).ShouldBeEmpty();

        (await Workflows("hasPublished=true")).ShouldBe(["Both", "Standard Processing"]);
        (await Workflows("hasPublished=false")).ShouldBe(["100% Draft_Only"]);
        (await Workflows("hasDraft=true")).ShouldBe(["100% Draft_Only", "Both"]);
        (await Workflows("hasDraft=false")).ShouldBe(["Standard Processing"]);
        (await Workflows("hasPublished=true&hasDraft=true")).ShouldBe(["Both"]); // combined with AND
        (await Workflows("hasPublished=true&name=std")).ShouldBeEmpty();
    }

    [Fact]
    public async Task Steps_filter_by_title_description_and_used()
    {
        var used = await CreateStepAsync("Deduplicate", "Remove copies");
        await CreateStepAsync("100% Review_Step", "Check [brackets]");
        await CreateStepAsync("Unused helper", "Remove nothing");
        var workflow = await CreateWorkflowAsync("Uses a step");
        await PublishWithStepAsync(workflow, used);

        Task<string[]> Steps(string query) => Names($"/api/v1/step-definitions?{query}", "title");

        (await Steps("title=DEDUP")).ShouldBe(["Deduplicate"]);
        (await Steps("title=100%25")).ShouldBe(["100% Review_Step"]); // % is literal
        (await Steps("title=%25")).ShouldBe(["100% Review_Step"]);
        (await Steps("title=_Step")).ShouldBe(["100% Review_Step"]);
        (await Steps("title=remove")).ShouldBeEmpty(); // the title box does not search the description
        (await Steps("description=remove")).ShouldBe(["Deduplicate", "Unused helper"]);
        (await Steps("description=%5Bbr")).ShouldBe(["100% Review_Step"]); // [ is literal
        (await Steps("description=%25")).ShouldBeEmpty();

        (await Steps("used=true")).ShouldBe(["Deduplicate"]);
        (await Steps("used=false")).ShouldBe(["100% Review_Step", "Unused helper"]);
        (await Steps("used=false&description=remove")).ShouldBe(["Unused helper"]); // combined with AND
    }

    // ---- Audit Logs

    [Fact]
    public async Task Audit_search_filters_by_any_of_several_actors()
    {
        var alice = await ProvisionAsync(@"KE\alice");
        var bob = await ProvisionAsync(@"KE\bob");
        await _factory.WithDbAsync(async db =>
        {
            db.Set<MatterFlow.Audit.Domain.AuditEvent>().AddRange(
                Event(alice, "ALICE_DID"),
                Event(bob, "BOB_DID"),
                Event(null, "SYSTEM_DID"));
            await db.SaveChangesAsync();
        });

        async Task<string[]> Types(string query) =>
            [.. (await OkAsync(await As().GetAsync($"/api/v1/audit/search?pageSize=200&{query}"))).GetProperty("items").EnumerateArray()
                .Select(i => i.GetProperty("eventType").GetString()!).Where(t => t.EndsWith("_DID", StringComparison.Ordinal)).Order()];

        (await Types($"actor={alice}")).ShouldBe(["ALICE_DID"]);
        (await Types($"actor={alice}&actor={bob}")).ShouldBe(["ALICE_DID", "BOB_DID"]); // any of them
        (await Types("actor=99999")).ShouldBeEmpty();
        (await Types($"actor={alice}&actor={bob}&eventType=BOB_DID")).ShouldBe(["BOB_DID"]); // combined with AND
        (await Types("")).ShouldBe(["ALICE_DID", "BOB_DID", "SYSTEM_DID"]);
    }

    private static MatterFlow.Audit.Domain.AuditEvent Event(int? actor, string eventType) => new()
    {
        ObjectType = "Test",
        ObjectId = "1",
        EventType = eventType,
        ActorUserId = actor,
        OccurredAtUtc = DateTime.UtcNow,
        CorrelationId = Guid.NewGuid(),
        Summary = eventType,
    };
}
