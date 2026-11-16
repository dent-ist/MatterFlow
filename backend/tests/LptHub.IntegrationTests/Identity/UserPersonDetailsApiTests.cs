using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.Audit.Domain;
using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using LptHub.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace LptHub.IntegrationTests.Identity;

/// <summary>
/// The person fields of a user (epic #1389, issue #1394) through the full HTTP pipeline: the two admin lists (Office, Employment Status), saving Title, Notes, Office,
/// Employment Status and Industry Join Date on the user, the audit trail, the users list (columns, sort, filter), the People API and the permission matrix.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class UserPersonDetailsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Admin = DatabaseApiFactory.AdminAccount;
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-LptHub-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return string.IsNullOrEmpty(body) ? default : JsonDocument.Parse(body).RootElement;
    }

    private async Task<HttpClient> UserWithAsync(string user, params string[] permissions)
    {
        var client = As(user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Role " + user, permissions));
        return client;
    }

    /// <summary>A new user (signs in once) and its id.</summary>
    private async Task<int> NewUserAsync(string account)
    {
        (await As(account).GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        return await _factory.WithDbAsync(db => db.Set<UserIdentity>().Where(i => i.Username == account).Select(i => i.UserId).SingleAsync());
    }

    private static async Task<JsonElement> ListAsync(HttpClient client, string url) => await JsonAsync(await client.GetAsync(url));

    /// <summary>An office by name: the list starts empty (owner decision), so the test adds it (or finds the one an earlier step added).</summary>
    private async Task<int> OfficeAsync(string name)
    {
        var admin = As(Admin);
        var existing = (await ListAsync(admin, "/api/v1/offices")).EnumerateArray().FirstOrDefault(o => o.GetProperty("name").GetString() == name);
        if (existing.ValueKind == JsonValueKind.Object)
            return existing.GetProperty("id").GetInt32();
        return (await JsonAsync(await admin.PostAsJsonAsync("/api/v1/offices", new { name }), HttpStatusCode.Created)).GetProperty("id").GetInt32();
    }

    private static int IdOf(JsonElement list, string name) => list.EnumerateArray().Single(i => i.GetProperty("name").GetString() == name).GetProperty("id").GetInt32();

    private static object Details(string? title = null, string? notes = null, int? officeId = null, int? statusId = null, string? month = null, string rowVersion = "") =>
        new { title, notes, officeId, employmentStatusId = statusId, industryJoinMonth = month, rowVersion };

    private async Task<JsonElement> SaveAsync(int userId, object body, HttpStatusCode expected = HttpStatusCode.OK) =>
        await JsonAsync(await As(Admin).PutAsJsonAsync($"/api/v1/users/{userId}/person-details", body), expected);

    [Fact]
    public async Task The_status_list_starts_with_Active_On_Leave_and_Departed_and_the_office_list_starts_empty()
    {
        var statuses = await ListAsync(As(Admin), "/api/v1/employment-statuses");
        statuses.EnumerateArray().Select(i => i.GetProperty("name").GetString()).ShouldBe(["Active", "On Leave", "Departed"]);
        var offices = await ListAsync(As(Admin), "/api/v1/offices");
        offices.GetArrayLength().ShouldBe(0);
        statuses.EnumerateArray().ShouldAllBe(o => o.GetProperty("isActive").GetBoolean() && o.GetProperty("inUseCount").GetInt32() == 0);
    }

    [Fact]
    public async Task The_lists_add_rename_reorder_deactivate_and_delete_and_refuse_a_duplicate_and_a_used_item()
    {
        var admin = As(Admin);
        var created = await JsonAsync(await admin.PostAsJsonAsync("/api/v1/offices", new { name = "  Berlin ", isActive = true }), HttpStatusCode.Created);
        created.GetProperty("name").GetString().ShouldBe("Berlin");
        (await admin.PostAsJsonAsync("/api/v1/offices", new { name = "berlin" })).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await admin.PostAsJsonAsync("/api/v1/offices", new { name = "   " })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var id = created.GetProperty("id").GetInt32();
        var renamed = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/offices/{id}", new { name = "Berlin Office", isActive = false, rowVersion = created.GetProperty("rowVersion").GetString() }));
        renamed.GetProperty("name").GetString().ShouldBe("Berlin Office");
        renamed.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        // The old row version is stale now.
        (await admin.PutAsJsonAsync($"/api/v1/offices/{id}", new { name = "Berlin", isActive = true, rowVersion = created.GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        await OfficeAsync("Second Office"); // the list starts empty, so a second item is needed to reorder
        var all = await ListAsync(admin, "/api/v1/offices");
        var ids = all.EnumerateArray().Select(i => i.GetProperty("id").GetInt32()).Reverse().ToArray();
        var reordered = await JsonAsync(await admin.PutAsJsonAsync("/api/v1/offices/order", new { ids }));
        reordered.EnumerateArray().First().GetProperty("id").GetInt32().ShouldBe(ids[0]);
        (await admin.PutAsJsonAsync("/api/v1/offices/order", new { ids = ids.Take(1) })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // A used item is deactivated, not deleted.
        var userId = await NewUserAsync(@"ke\carol");
        var person = await JsonAsync(await admin.GetAsync($"/api/v1/users/{userId}"));
        await SaveAsync(userId, Details(officeId: id, rowVersion: person.GetProperty("personRowVersion").GetString()!), HttpStatusCode.BadRequest); // inactive: not offered
        var current = (await ListAsync(admin, "/api/v1/offices")).EnumerateArray().Single(i => i.GetProperty("id").GetInt32() == id); // the reorder changed its row version
        var active = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/offices/{id}", new { name = "Berlin Office", isActive = true, rowVersion = current.GetProperty("rowVersion").GetString() }));
        await SaveAsync(userId, Details(officeId: id, rowVersion: person.GetProperty("personRowVersion").GetString()!));
        (await ListAsync(admin, "/api/v1/offices")).EnumerateArray().Single(i => i.GetProperty("id").GetInt32() == id).GetProperty("inUseCount").GetInt32().ShouldBe(1);
        (await admin.DeleteAsync($"/api/v1/offices/{id}")).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        active.GetProperty("isActive").GetBoolean().ShouldBeTrue();

        var free = await JsonAsync(await admin.PostAsJsonAsync("/api/v1/employment-statuses", new { name = "Sabbatical" }), HttpStatusCode.Created);
        (await admin.DeleteAsync($"/api/v1/employment-statuses/{free.GetProperty("id").GetInt32()}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await admin.DeleteAsync("/api/v1/employment-statuses/999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Saving_the_person_fields_shows_them_in_the_user_the_list_and_the_people_api_and_clearing_them_works()
    {
        var userId = await NewUserAsync(@"ke\dana");
        var admin = As(Admin);
        var statuses = await ListAsync(admin, "/api/v1/employment-statuses");
        var before = await JsonAsync(await admin.GetAsync($"/api/v1/users/{userId}"));
        before.GetProperty("title").ValueKind.ShouldBe(JsonValueKind.Null);
        before.GetProperty("industryJoinMonth").ValueKind.ShouldBe(JsonValueKind.Null);

        var saved = await SaveAsync(userId, Details("  Senior Project Manager ", "Prefers morning calls.\nLeads the Alpha team.", await OfficeAsync("Head Office"), IdOf(statuses, "On Leave"), "2018-03", before.GetProperty("personRowVersion").GetString()!));
        saved.GetProperty("title").GetString().ShouldBe("Senior Project Manager");
        saved.GetProperty("notes").GetString().ShouldBe("Prefers morning calls.\nLeads the Alpha team.");
        saved.GetProperty("officeName").GetString().ShouldBe("Head Office");
        saved.GetProperty("employmentStatusName").GetString().ShouldBe("On Leave");
        saved.GetProperty("industryJoinMonth").GetString().ShouldBe("2018-03");
        saved.GetProperty("isActive").GetBoolean().ShouldBeTrue(); // the account state is a different thing

        var stored = await _factory.WithDbAsync(db => db.Set<Person>().SingleAsync(p => p.UserId == userId));
        stored.IndustryJoinDate.ShouldBe(new DateOnly(2018, 3, 1));

        var row = (await ListAsync(admin, "/api/v1/users?status=all&pageSize=100")).GetProperty("items").EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == userId);
        row.GetProperty("title").GetString().ShouldBe("Senior Project Manager");
        row.GetProperty("officeName").GetString().ShouldBe("Head Office");
        row.GetProperty("employmentStatusName").GetString().ShouldBe("On Leave");

        var personId = stored.Id;
        var viaPeople = await JsonAsync(await admin.GetAsync($"/api/v1/people/{personId}"));
        viaPeople.GetProperty("officeName").GetString().ShouldBe("Head Office");
        viaPeople.GetProperty("employmentStatusName").GetString().ShouldBe("On Leave");
        viaPeople.GetProperty("industryJoinMonth").GetString().ShouldBe("2018-03");

        var cleared = await SaveAsync(userId, Details(rowVersion: saved.GetProperty("personRowVersion").GetString()!));
        cleared.GetProperty("title").ValueKind.ShouldBe(JsonValueKind.Null);
        cleared.GetProperty("officeId").ValueKind.ShouldBe(JsonValueKind.Null);
        cleared.GetProperty("employmentStatusId").ValueKind.ShouldBe(JsonValueKind.Null);
        cleared.GetProperty("industryJoinMonth").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Changes_are_audited_with_names_and_a_stale_row_version_or_a_bad_value_is_refused()
    {
        var userId = await NewUserAsync(@"ke\eli");
        var admin = As(Admin);
        var statuses = await ListAsync(admin, "/api/v1/employment-statuses");
        var first = await JsonAsync(await admin.GetAsync($"/api/v1/users/{userId}"));
        var rowVersion = first.GetProperty("personRowVersion").GetString()!;

        var one = await SaveAsync(userId, Details("Analyst", null, await OfficeAsync("Branch Office"), IdOf(statuses, "Active"), "2020-11", rowVersion));
        await SaveAsync(userId, Details("Analyst", null, await OfficeAsync("Branch Office"), IdOf(statuses, "Active"), "2020-11", rowVersion), HttpStatusCode.Conflict); // stale
        var two = await SaveAsync(userId, Details("Lead Analyst", null, await OfficeAsync("Remote"), IdOf(statuses, "Departed"), "2019-06", one.GetProperty("personRowVersion").GetString()!));

        var personId = (await _factory.WithDbAsync(db => db.Set<Person>().SingleAsync(p => p.UserId == userId))).Id.ToString();
        var events = await _factory.WithDbAsync(db => db.Set<AuditEvent>().Where(e => e.ObjectType == "Person" && e.ObjectId == personId).OrderBy(e => e.Id).ToListAsync());
        events.ShouldContain(e => e.EventType == "PERSON_OFFICE_CHANGED" && e.OldValue == null && e.NewValue == "Branch Office");
        events.ShouldContain(e => e.EventType == "PERSON_OFFICE_CHANGED" && e.OldValue == "Branch Office" && e.NewValue == "Remote");
        events.ShouldContain(e => e.EventType == "PERSON_EMPLOYMENT_STATUS_CHANGED" && e.OldValue == "Active" && e.NewValue == "Departed");
        events.ShouldContain(e => e.EventType == "PERSON_INDUSTRY_JOIN_CHANGED" && e.OldValue == "Nov 2020" && e.NewValue == "Jun 2019");
        events.ShouldContain(e => e.FieldKey == "Title" && e.OldValue == "Analyst" && e.NewValue == "Lead Analyst");
        events.Count(e => e.EventType == "PERSON_OFFICE_CHANGED").ShouldBe(2);
        events.Where(e => e.EventType.StartsWith("PERSON_", StringComparison.Ordinal)).ShouldAllBe(e => e.ActorUserId != null);

        // Nothing changed: no new events.
        var count = events.Count;
        await SaveAsync(userId, Details("Lead Analyst", null, await OfficeAsync("Remote"), IdOf(statuses, "Departed"), "2019-06", two.GetProperty("personRowVersion").GetString()!));
        (await _factory.WithDbAsync(db => db.Set<AuditEvent>().CountAsync(e => e.ObjectType == "Person" && e.ObjectId == personId))).ShouldBe(count);

        var rv = (await JsonAsync(await admin.GetAsync($"/api/v1/users/{userId}"))).GetProperty("personRowVersion").GetString()!;
        await SaveAsync(userId, Details(officeId: 999999, rowVersion: rv), HttpStatusCode.BadRequest);
        await SaveAsync(userId, Details(statusId: 999999, rowVersion: rv), HttpStatusCode.BadRequest);
        await SaveAsync(userId, Details(month: "2018-13", rowVersion: rv), HttpStatusCode.BadRequest);
        await SaveAsync(userId, Details(month: "1949-12", rowVersion: rv), HttpStatusCode.BadRequest);
        await SaveAsync(userId, Details(month: DateTime.UtcNow.AddMonths(2).ToString("yyyy-MM"), rowVersion: rv), HttpStatusCode.BadRequest);
        await SaveAsync(userId, Details(title: new string('x', 101), rowVersion: rv), HttpStatusCode.BadRequest);
        await SaveAsync(userId, Details(rowVersion: "not base64!"), HttpStatusCode.BadRequest);
        (await admin.PutAsJsonAsync("/api/v1/users/999999/person-details", Details(rowVersion: rv))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_users_list_sorts_and_filters_by_title_office_and_employment_status()
    {
        var admin = As(Admin);
        var statuses = await ListAsync(admin, "/api/v1/employment-statuses");
        var head = await OfficeAsync("Head Office");
        var remote = await OfficeAsync("Remote");
        var onLeave = IdOf(statuses, "On Leave");
        foreach (var (account, title, office, status) in new[] { (@"ke\ann", "Paralegal", head, onLeave), (@"ke\bob", "Attorney", remote, IdOf(statuses, "Active")), (@"ke\cy", (string?)null, (int?)null, (int?)null) })
        {
            var id = await NewUserAsync(account);
            var rv = (await JsonAsync(await admin.GetAsync($"/api/v1/users/{id}"))).GetProperty("personRowVersion").GetString()!;
            await SaveAsync(id, Details(title, null, office, status, null, rv));
        }

        async Task<string[]> NamesAsync(string query) =>
            [.. (await ListAsync(admin, "/api/v1/users?status=all&search=ke" + query)).GetProperty("items").EnumerateArray().Select(u => u.GetProperty("windowsAccount").GetString()!)];

        (await NamesAsync("&title=ara")).ShouldBe([@"ke\ann"], ignoreOrder: true);
        (await NamesAsync($"&officeId={remote}")).ShouldBe([@"ke\bob"], ignoreOrder: true);
        (await NamesAsync($"&employmentStatusId={onLeave}")).ShouldBe([@"ke\ann"], ignoreOrder: true);
        (await NamesAsync("&sort=title")).Where(a => a is @"ke\ann" or @"ke\bob" or @"ke\cy").ToArray().ShouldBe([@"ke\cy", @"ke\bob", @"ke\ann"]);
        (await NamesAsync("&sort=title&dir=desc")).Where(a => a is @"ke\ann" or @"ke\bob" or @"ke\cy").ToArray().ShouldBe([@"ke\ann", @"ke\bob", @"ke\cy"]);
        (await NamesAsync("&sort=office")).Where(a => a is @"ke\ann" or @"ke\bob" or @"ke\cy").ToArray().ShouldBe([@"ke\cy", @"ke\ann", @"ke\bob"]);
        (await NamesAsync("&sort=employmentStatus")).Where(a => a is @"ke\ann" or @"ke\bob" or @"ke\cy").ToArray().ShouldBe([@"ke\cy", @"ke\bob", @"ke\ann"]);
        (await admin.GetAsync("/api/v1/users?sort=bogus")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Viewing_needs_User_View_and_changing_needs_User_Manage()
    {
        var userId = await NewUserAsync(@"ke\fay");
        var rv = (await JsonAsync(await As(Admin).GetAsync($"/api/v1/users/{userId}"))).GetProperty("personRowVersion").GetString()!;
        var none = await UserWithAsync(@"ke\none", Permissions.Pod.View);
        var viewer = await UserWithAsync(@"ke\viewer", Permissions.User.View);
        var manager = await UserWithAsync(@"ke\manager", Permissions.User.Manage);

        (await none.GetAsync("/api/v1/offices")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await none.GetAsync("/api/v1/employment-statuses")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await none.PutAsJsonAsync($"/api/v1/users/{userId}/person-details", Details(rowVersion: rv))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await viewer.GetAsync("/api/v1/offices")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync("/api/v1/employment-statuses")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync($"/api/v1/users/{userId}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.PostAsJsonAsync("/api/v1/offices", new { name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PostAsJsonAsync("/api/v1/employment-statuses", new { name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PutAsJsonAsync($"/api/v1/users/{userId}/person-details", Details(rowVersion: rv))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await manager.PostAsJsonAsync("/api/v1/offices", new { name = "Paris" })).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await manager.PutAsJsonAsync($"/api/v1/users/{userId}/person-details", Details("Clerk", rowVersion: rv))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
