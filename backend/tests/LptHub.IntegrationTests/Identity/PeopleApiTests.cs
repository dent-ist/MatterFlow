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

/// <summary>The People list (epic #1373, issue #1374) through the full HTTP pipeline against a real SQL Server: CRUD, search, duplicate hint, system-user persons and the permission matrix.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class PeopleApiTests(SqlServerFixture sql) : IAsyncLifetime
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

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<HttpClient> UserWithAsync(string user, params string[] permissions)
    {
        var client = As(user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Role " + user, permissions));
        return client;
    }

    private async Task<JsonElement> CreateAsync(string first, string last, string type = "INTERNAL", string? title = null, string? email = null, string? company = null, string? comments = null)
    {
        var response = await As(Admin).PostAsJsonAsync("/api/v1/people", new { firstName = first, lastName = last, personType = type, title, email, companyName = company, comments });
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return await JsonAsync(response);
    }

    private async Task<string[]> ListNamesAsync(string query = "")
    {
        var response = await As(Admin).GetAsync("/api/v1/people" + query);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return (await JsonAsync(response)).GetProperty("items").EnumerateArray().Select(p => p.GetProperty("displayName").GetString()!).ToArray();
    }

    private async Task<JsonElement> PersonOfUserAsync(string account)
    {
        var me = await JsonAsync(await As(Admin).GetAsync("/api/v1/people?pageSize=100"));
        var userId = await _factory.WithDbAsync(db => db.Set<UserIdentity>().Where(i => i.Username == account).Select(i => i.UserId).SingleAsync());
        return me.GetProperty("items").EnumerateArray().Single(p => p.TryGetProperty("userId", out var u) && u.ValueKind == JsonValueKind.Number && u.GetInt32() == userId);
    }

    [Fact]
    public async Task Create_get_search_filter_sort_and_page()
    {
        var laura = await CreateAsync("  Laura ", "Whitfield", "EXTERNAL", "Partner", " laura@lawfirm.example ", "Whitfield & Co", "Met at the 2026 summit");
        laura.GetProperty("displayName").GetString().ShouldBe("Laura Whitfield");
        laura.GetProperty("email").GetString().ShouldBe("laura@lawfirm.example");
        laura.GetProperty("companyName").GetString().ShouldBe("Whitfield & Co");
        laura.GetProperty("isSystemUser").GetBoolean().ShouldBeFalse();
        laura.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        await CreateAsync("Omar", "Adams", "INTERNAL", "Paralegal");
        await CreateAsync("Zoe", "Brown", "EXTERNAL", null, null, "Brown Analytics");

        var id = laura.GetProperty("personId").GetInt32();
        var get = await As(Admin).GetAsync($"/api/v1/people/{id}");
        get.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(get)).GetProperty("comments").GetString().ShouldBe("Met at the 2026 summit");
        (await As(Admin).GetAsync("/api/v1/people/999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        (await ListNamesAsync("?type=EXTERNAL")).ShouldBe(["Zoe Brown", "Laura Whitfield"]);
        (await ListNamesAsync("?type=INTERNAL&q=adams")).ShouldBe(["Omar Adams"]);
        (await ListNamesAsync("?q=laura whit")).ShouldBe(["Laura Whitfield"]);
        (await ListNamesAsync("?q=analytics")).ShouldBe(["Zoe Brown"]);
        (await ListNamesAsync("?q=paralegal")).ShouldBe(["Omar Adams"]);
        (await ListNamesAsync("?q=LAWFIRM.EXAMPLE")).ShouldBe(["Laura Whitfield"]);
        (await ListNamesAsync("?type=EXTERNAL&sort=-name")).ShouldBe(["Laura Whitfield", "Zoe Brown"]);
        (await ListNamesAsync("?type=EXTERNAL&sort=company")).ShouldBe(["Zoe Brown", "Laura Whitfield"]);
        (await ListNamesAsync("?type=EXTERNAL&pageSize=1&page=2")).ShouldBe(["Laura Whitfield"]);

        (await As(Admin).GetAsync("/api/v1/people?sort=bogus")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await As(Admin).GetAsync("/api/v1/people?type=ROBOT")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Create_validates_the_fields()
    {
        async Task<JsonElement> BadAsync(object body)
        {
            var response = await As(Admin).PostAsJsonAsync("/api/v1/people", body);
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, await response.Content.ReadAsStringAsync());
            return await JsonAsync(response);
        }

        var blank = await BadAsync(new { firstName = " ", lastName = "", personType = "INTERNAL" });
        blank.GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
        var fields = JsonSerializer.Serialize(blank);
        fields.ShouldContain("REQUIRED");

        (await BadAsync(new { firstName = "A", lastName = "B", personType = "ROBOT" })).GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
        (await BadAsync(new { firstName = "A", lastName = "B", personType = "INTERNAL", companyName = "Acme" })).GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
        (await BadAsync(new { firstName = "A", lastName = "B", personType = "INTERNAL", email = "not an email" })).GetProperty("code").GetString().ShouldBe("INVALID_EMAIL");
        (await BadAsync(new { firstName = new string('x', 101), lastName = "B", personType = "INTERNAL" })).GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
    }

    [Fact]
    public async Task Update_changes_fields_checks_the_row_version_and_deactivates_and_reactivates()
    {
        var created = await CreateAsync("Pat", "Lee", "INTERNAL", "Associate");
        var id = created.GetProperty("personId").GetInt32();
        var version = created.GetProperty("rowVersion").GetString();

        var updated = await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", new
        {
            firstName = "Patricia",
            lastName = "Lee",
            personType = "EXTERNAL",
            title = "Of Counsel",
            email = "pat@other.example",
            companyName = "Other LLP",
            comments = (string?)null,
            isActive = true,
            rowVersion = version,
        });
        updated.StatusCode.ShouldBe(HttpStatusCode.OK, await updated.Content.ReadAsStringAsync());
        var body = await JsonAsync(updated);
        body.GetProperty("displayName").GetString().ShouldBe("Patricia Lee");
        body.GetProperty("personType").GetString().ShouldBe("EXTERNAL");
        body.GetProperty("companyName").GetString().ShouldBe("Other LLP");

        // The old row version is stale now.
        var stale = await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", new { firstName = "Pat", lastName = "Lee", personType = "INTERNAL", isActive = true, rowVersion = version });
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await JsonAsync(stale)).GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");

        var deactivated = await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", new { firstName = "Patricia", lastName = "Lee", personType = "EXTERNAL", companyName = "Other LLP", isActive = false, rowVersion = body.GetProperty("rowVersion").GetString() });
        deactivated.StatusCode.ShouldBe(HttpStatusCode.OK);
        var off = await JsonAsync(deactivated);
        off.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        (await ListNamesAsync("?active=false")).ShouldBe(["Patricia Lee"]);
        (await ListNamesAsync("?active=true&q=patricia")).ShouldBeEmpty();

        var back = await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", new { firstName = "Patricia", lastName = "Lee", personType = "EXTERNAL", companyName = "Other LLP", isActive = true, rowVersion = off.GetProperty("rowVersion").GetString() });
        (await JsonAsync(back)).GetProperty("isActive").GetBoolean().ShouldBeTrue();

        (await As(Admin).PutAsJsonAsync("/api/v1/people/999999", new { firstName = "A", lastName = "B", personType = "INTERNAL", isActive = true, rowVersion = version })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", new { firstName = "A", lastName = "B", personType = "INTERNAL", isActive = true, rowVersion = "###" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Create_update_and_deactivate_are_audited_field_by_field()
    {
        var created = await CreateAsync("Audra", "Trail", "INTERNAL", "Clerk");
        var id = created.GetProperty("personId").GetInt32();
        var changed = await JsonAsync(await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", new { firstName = "Audra", lastName = "Trail", personType = "INTERNAL", title = "Senior Clerk", isActive = true, rowVersion = created.GetProperty("rowVersion").GetString() }));
        await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", new { firstName = "Audra", lastName = "Trail", personType = "INTERNAL", title = "Senior Clerk", isActive = false, rowVersion = changed.GetProperty("rowVersion").GetString() });

        var events = await _factory.WithDbAsync(db => db.Set<AuditEvent>().Where(e => e.ObjectType == "Person" && e.ObjectId == id.ToString()).OrderBy(e => e.Id).ToListAsync());
        events.ShouldContain(e => e.FieldKey == "FirstName" && e.NewValue == "Audra");
        events.ShouldContain(e => e.FieldKey == "Title" && e.OldValue == "Clerk" && e.NewValue == "Senior Clerk");
        events.ShouldContain(e => e.FieldKey == "IsActive" && e.OldValue == "true" && e.NewValue == "false");
        events.ShouldAllBe(e => e.ActorUserId != null);
    }

    [Fact]
    public async Task Every_user_gets_a_linked_person_that_follows_the_user_and_stays_when_the_user_is_deactivated()
    {
        // First sign-in provisions the user and, in the same transaction, the person.
        await UserWithAsync(@"ke\mary", Permissions.Task.View);
        var person = await PersonOfUserAsync(@"ke\mary");
        person.GetProperty("isSystemUser").GetBoolean().ShouldBeTrue();
        person.GetProperty("personType").GetString().ShouldBe("INTERNAL");
        person.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        person.GetProperty("userIsActive").GetBoolean().ShouldBeTrue();
        var userId = person.GetProperty("userId").GetInt32();

        // Renaming the user (the administrator's Users page) is copied to the person.
        await _factory.WithDbAsync(async db =>
        {
            var user = await db.Set<AppUser>().SingleAsync(u => u.Id == userId);
            user.DisplayName = "Mary Ann Smith";
            user.Email = "mary.smith@firm.example";
            await db.SaveChangesAsync();
        });
        var renamed = await PersonOfUserAsync(@"ke\mary");
        renamed.GetProperty("firstName").GetString().ShouldBe("Mary Ann");
        renamed.GetProperty("lastName").GetString().ShouldBe("Smith");
        renamed.GetProperty("email").GetString().ShouldBe("mary.smith@firm.example");
        renamed.GetProperty("personId").GetInt32().ShouldBe(person.GetProperty("personId").GetInt32());

        // Name, e-mail, type and activity are read only; title and comments are the person's own.
        var id = renamed.GetProperty("personId").GetInt32();
        object Put(string first, string? title, bool active) => new
        {
            firstName = first,
            lastName = "Smith",
            personType = "INTERNAL",
            email = "mary.smith@firm.example",
            title,
            comments = "Knows the DMS",
            isActive = active,
            rowVersion = renamed.GetProperty("rowVersion").GetString(),
        };

        var rename = await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", Put("Maria", null, true));
        rename.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await JsonAsync(rename)).GetProperty("code").GetString().ShouldBe("SYSTEM_PERSON_READ_ONLY");
        (await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", Put("Mary Ann", null, false))).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        var own = await As(Admin).PutAsJsonAsync($"/api/v1/people/{id}", Put("Mary Ann", "Records Manager", true));
        own.StatusCode.ShouldBe(HttpStatusCode.OK, await own.Content.ReadAsStringAsync());
        (await JsonAsync(own)).GetProperty("title").GetString().ShouldBe("Records Manager");

        // Deactivating the user keeps the person (flagged), but it is no longer offered in pickers.
        (await As(Admin).GetAsync("/api/v1/people/lookup?q=smith")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(await As(Admin).GetAsync("/api/v1/people/lookup?q=smith"))).GetArrayLength().ShouldBe(1);
        await _factory.WithDbAsync(async db =>
        {
            (await db.Set<AppUser>().SingleAsync(u => u.Id == userId)).IsActive = false;
            await db.SaveChangesAsync();
        });
        var kept = await PersonOfUserAsync(@"ke\mary");
        kept.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        kept.GetProperty("userIsActive").GetBoolean().ShouldBeFalse();
        (await JsonAsync(await As(Admin).GetAsync("/api/v1/people/lookup?q=smith"))).GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task The_picker_lookup_can_ask_for_Internal_or_External_people_only()
    {
        await CreateAsync("Ines", "Lookuptest", "INTERNAL", "Paralegal");
        await CreateAsync("Ernst", "Lookuptest", "EXTERNAL", null, null, "Outside Counsel");

        (await JsonAsync(await As(Admin).GetAsync("/api/v1/people/lookup?q=lookuptest"))).GetArrayLength().ShouldBe(2);
        var internals = await JsonAsync(await As(Admin).GetAsync("/api/v1/people/lookup?q=lookuptest&type=INTERNAL"));
        internals.GetArrayLength().ShouldBe(1);
        internals[0].GetProperty("personType").GetString().ShouldBe("INTERNAL");
        var externals = await JsonAsync(await As(Admin).GetAsync("/api/v1/people/lookup?q=lookuptest&type=EXTERNAL"));
        externals.GetArrayLength().ShouldBe(1);
        externals[0].GetProperty("personType").GetString().ShouldBe("EXTERNAL");
        (await As(Admin).GetAsync("/api/v1/people/lookup?type=NEITHER")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_user_whose_person_is_missing_gets_one_when_the_user_is_next_saved()
    {
        await UserWithAsync(@"ke\legacy", Permissions.Task.View);
        var userId = (await PersonOfUserAsync(@"ke\legacy")).GetProperty("userId").GetInt32();
        await _factory.WithDbAsync(async db =>
        {
            await db.Database.ExecuteSqlRawAsync("DELETE FROM dbo.Person WHERE UserId = {0}", userId);
            var user = await db.Set<AppUser>().SingleAsync(u => u.Id == userId);
            user.DisplayName = "Lena Legacy";
            await db.SaveChangesAsync();
        });

        var person = await PersonOfUserAsync(@"ke\legacy");
        person.GetProperty("displayName").GetString().ShouldBe("Lena Legacy");
    }

    [Fact]
    public async Task Lookup_returns_active_matches_best_first_and_is_open_to_matter_team_editors()
    {
        await CreateAsync("Adam", "Stone");
        await CreateAsync("Stan", "Adams");
        await CreateAsync("Bea", "Stonehouse", "EXTERNAL", company: "Stone & Sons");
        var gone = await CreateAsync("Gone", "Stone");
        await As(Admin).PutAsJsonAsync($"/api/v1/people/{gone.GetProperty("personId").GetInt32()}", new { firstName = "Gone", lastName = "Stone", personType = "INTERNAL", isActive = false, rowVersion = gone.GetProperty("rowVersion").GetString() });

        var rows = await JsonAsync(await As(Admin).GetAsync("/api/v1/people/lookup?q=stone"));
        rows.EnumerateArray().Select(r => r.GetProperty("displayName").GetString()).ShouldBe(["Adam Stone", "Bea Stonehouse"], ignoreOrder: false);

        var editor = await UserWithAsync(@"ke\teamed", Permissions.Matter.Edit);
        var allowed = await editor.GetAsync("/api/v1/people/lookup?q=stan");
        allowed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(allowed)).EnumerateArray().Single().GetProperty("displayName").GetString().ShouldBe("Stan Adams");
        (await editor.GetAsync("/api/v1/people")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Similar_finds_the_same_email_the_same_name_and_typos()
    {
        await CreateAsync("Laura", "Whitfield", email: "laura@lawfirm.example");
        await CreateAsync("Mark", "Jones");
        var inactive = await CreateAsync("Lara", "Whitfield");
        await As(Admin).PutAsJsonAsync($"/api/v1/people/{inactive.GetProperty("personId").GetInt32()}", new { firstName = "Lara", lastName = "Whitfield", personType = "INTERNAL", isActive = false, rowVersion = inactive.GetProperty("rowVersion").GetString() });

        async Task<JsonElement[]> SimilarAsync(string query) =>
            (await JsonAsync(await As(Admin).GetAsync("/api/v1/people/similar" + query))).EnumerateArray().ToArray();

        var typo = await SimilarAsync("?firstName=Laura&lastName=Whitfeld");
        typo.Select(r => r.GetProperty("person").GetProperty("displayName").GetString()).ShouldBe(["Laura Whitfield", "Lara Whitfield"]);
        typo.Select(r => r.GetProperty("reason").GetString()).ShouldBe(["SIMILAR_NAME", "SIMILAR_NAME"]);
        typo[1].GetProperty("isActive").GetBoolean().ShouldBeFalse();

        var same = await SimilarAsync("?firstName=whitfield&lastName=LAURA");
        same[0].GetProperty("reason").GetString().ShouldBe("SAME_NAME");

        var email = await SimilarAsync("?firstName=Someone&lastName=Else&email=LAURA@lawfirm.example");
        email.Single().GetProperty("reason").GetString().ShouldBe("SAME_EMAIL");

        (await SimilarAsync("?firstName=Nobody&lastName=Atall")).ShouldBeEmpty();
        var excluded = await SimilarAsync($"?firstName=Mark&lastName=Jones&excludePersonId={(await JsonAsync(await As(Admin).GetAsync("/api/v1/people?q=jones"))).GetProperty("items")[0].GetProperty("personId").GetInt32()}");
        excluded.ShouldBeEmpty();
    }

    [Fact]
    public async Task Permission_matrix_view_and_manage_are_separate_and_a_zero_permission_user_gets_403()
    {
        var created = await CreateAsync("Vic", "Viewer");
        var id = created.GetProperty("personId").GetInt32();
        var body = new { firstName = "Vic", lastName = "Viewer", personType = "INTERNAL", isActive = true, rowVersion = created.GetProperty("rowVersion").GetString() };
        var newPerson = new { firstName = "New", lastName = "Person", personType = "INTERNAL" };

        var none = await UserWithAsync(@"ke\none", Permissions.Pod.View);
        var viewer = await UserWithAsync(@"ke\viewer", Permissions.People.View);
        var manager = await UserWithAsync(@"ke\manager", Permissions.People.Manage);

        foreach (var client in new[] { none })
        {
            (await client.GetAsync("/api/v1/people")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.GetAsync($"/api/v1/people/{id}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.GetAsync("/api/v1/people/lookup")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.GetAsync("/api/v1/people/similar?firstName=a&lastName=b")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PostAsJsonAsync("/api/v1/people", newPerson)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PutAsJsonAsync($"/api/v1/people/{id}", body)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        }

        (await viewer.GetAsync("/api/v1/people")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync($"/api/v1/people/{id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync("/api/v1/people/lookup")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync("/api/v1/people/similar?firstName=a&lastName=b")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PostAsJsonAsync("/api/v1/people", newPerson)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PutAsJsonAsync($"/api/v1/people/{id}", body)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        (await manager.PostAsJsonAsync("/api/v1/people", newPerson)).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await manager.PutAsJsonAsync($"/api/v1/people/{id}", body)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await manager.GetAsync("/api/v1/people/similar?firstName=a&lastName=b")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await manager.GetAsync("/api/v1/people/lookup")).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
