using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.Audit.Domain;
using LptHub.Identity.Contracts;
using LptHub.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace LptHub.IntegrationTests.Vendors;

/// <summary>
/// Vendors (epic #1373, issue #1377) through the full HTTP pipeline against a real SQL Server: vendor CRUD and search, the Services and Areas lists (starter values, in-use rule),
/// contacts and their flag, the delete rule, matter links in both directions with the audit events, and the permission matrix.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class VendorsApiTests(SqlServerFixture sql) : IAsyncLifetime
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

    private async Task<HttpClient> UserWithAsync(string user, params string[] permissions)
    {
        var client = As(user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Role " + user, permissions));
        return client;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return body.Length == 0 ? default : JsonDocument.Parse(body).RootElement;
    }

    private static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(status, body);
        var problem = JsonDocument.Parse(body).RootElement;
        problem.GetProperty("code").GetString().ShouldBe(code, body);
        return problem;
    }

    private async Task<int> OptionIdAsync(string list, string name) =>
        (await JsonAsync(await As(Admin).GetAsync($"/api/v1/{list}"))).EnumerateArray().Single(i => i.GetProperty("name").GetString() == name).GetProperty("id").GetInt32();

    private async Task<JsonElement> CreateVendorAsync(string name, string category = "PREFERRED", string? website = null, int[]? services = null, int[]? areas = null, string[]? techAi = null, string? note = null)
    {
        var response = await As(Admin).PostAsJsonAsync("/api/v1/vendors", new { name, website, category, note, serviceIds = services, areaIds = areas, techAi });
        return await JsonAsync(response, HttpStatusCode.Created);
    }

    private async Task<JsonElement> CreatePersonAsync(string first, string last, string type = "EXTERNAL")
    {
        var response = await As(Admin).PostAsJsonAsync("/api/v1/people", new { firstName = first, lastName = last, personType = type, companyName = type == "EXTERNAL" ? "Acme Vendor" : null });
        return await JsonAsync(response, HttpStatusCode.Created);
    }

    private async Task<int> CreateMatterAsync(string number = "12", bool sensitive = false)
    {
        var admin = As(Admin);
        var clients = await JsonAsync(await admin.GetAsync("/api/v1/clients?q=343"));
        var clientId = clients.GetProperty("total").GetInt32() > 0
            ? clients.GetProperty("items")[0].GetProperty("clientId").GetInt32()
            : (await JsonAsync(await admin.PostAsJsonAsync("/api/v1/clients", new { clientNumber = "343", name = "Acme Corp" }), HttpStatusCode.Created)).GetProperty("clientId").GetInt32();
        var matter = await JsonAsync(await admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = number, name = "Merger Review " + number, isSensitive = sensitive }), HttpStatusCode.Created);
        return matter.GetProperty("matterId").GetInt32();
    }

    private async Task<string[]> VendorNamesAsync(string query = "")
    {
        var response = await As(Admin).GetAsync("/api/v1/vendors" + query);
        return (await JsonAsync(response)).GetProperty("items").EnumerateArray().Select(v => v.GetProperty("name").GetString()!).ToArray();
    }

    private Task<List<AuditEvent>> AuditAsync(string objectType, string? eventType = null) =>
        _factory.WithDbAsync(db => db.Set<AuditEvent>().Where(a => a.ObjectType == objectType && (eventType == null || a.EventType == eventType)).OrderBy(a => a.Id).ToListAsync());

    // ---- lists

    [Fact]
    public async Task Services_and_areas_start_with_the_owner_values_in_order()
    {
        var services = await JsonAsync(await As(Admin).GetAsync("/api/v1/vendor-services"));
        services.EnumerateArray().Select(i => i.GetProperty("name").GetString()).ShouldBe(["eDiscovery", "Forensic", "Review", "Custom development", "Forensic accounting", "ITAR"]);
        var areas = await JsonAsync(await As(Admin).GetAsync("/api/v1/vendor-areas"));
        areas.EnumerateArray().Select(i => i.GetProperty("name").GetString()).ShouldBe(["US", "EU", "Asia"]);
    }

    [Theory]
    [InlineData("vendor-services")]
    [InlineData("vendor-areas")]
    public async Task A_list_item_is_added_renamed_reordered_deactivated_and_deleted_only_while_unused(string list)
    {
        var admin = As(Admin);
        var created = await JsonAsync(await admin.PostAsJsonAsync($"/api/v1/{list}", new { name = "  Extra  " }), HttpStatusCode.Created);
        created.GetProperty("name").GetString().ShouldBe("Extra");
        created.GetProperty("inUseCount").GetInt32().ShouldBe(0);
        var id = created.GetProperty("id").GetInt32();

        await ProblemAsync(await admin.PostAsJsonAsync($"/api/v1/{list}", new { name = "extra" }), HttpStatusCode.Conflict, "DUPLICATE_NAME");

        var renamed = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/{list}/{id}", new { name = "Extra 2", isActive = true, rowVersion = created.GetProperty("rowVersion").GetString() }));
        renamed.GetProperty("name").GetString().ShouldBe("Extra 2");
        await ProblemAsync(await admin.PutAsJsonAsync($"/api/v1/{list}/{id}", new { name = "Stale", isActive = true, rowVersion = created.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

        var all = (await JsonAsync(await admin.GetAsync($"/api/v1/{list}"))).EnumerateArray().Select(i => i.GetProperty("id").GetInt32()).ToList();
        var reordered = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/{list}/order", new { ids = all.AsEnumerable().Reverse().ToArray() }));
        reordered.EnumerateArray().First().GetProperty("id").GetInt32().ShouldBe(id);
        (await admin.PutAsJsonAsync($"/api/v1/{list}/order", new { ids = all.Take(1).ToArray() })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // In use: counted, cannot be deleted, can be deactivated.
        var vendorBody = list == "vendor-services" ? (object)new { name = "Uses it", category = "PREFERRED", serviceIds = new[] { id } } : new { name = "Uses it", category = "PREFERRED", areaIds = new[] { id } };
        await JsonAsync(await admin.PostAsJsonAsync("/api/v1/vendors", vendorBody), HttpStatusCode.Created);
        var item = (await JsonAsync(await admin.GetAsync($"/api/v1/{list}"))).EnumerateArray().Single(i => i.GetProperty("id").GetInt32() == id);
        item.GetProperty("inUseCount").GetInt32().ShouldBe(1);
        await ProblemAsync(await admin.DeleteAsync($"/api/v1/{list}/{id}"), HttpStatusCode.Conflict, "IN_USE");
        var off = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/{list}/{id}", new { name = "Extra 2", isActive = false, rowVersion = item.GetProperty("rowVersion").GetString() }));
        off.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        off.GetProperty("inUseCount").GetInt32().ShouldBe(1);

        var unused = await JsonAsync(await admin.PostAsJsonAsync($"/api/v1/{list}", new { name = "Unused" }), HttpStatusCode.Created);
        (await admin.DeleteAsync($"/api/v1/{list}/{unused.GetProperty("id").GetInt32()}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await admin.DeleteAsync($"/api/v1/{list}/999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    // ---- vendors

    [Fact]
    public async Task Create_get_search_filter_sort_and_page()
    {
        var forensic = await OptionIdAsync("vendor-services", "Forensic");
        var review = await OptionIdAsync("vendor-services", "Review");
        var eu = await OptionIdAsync("vendor-areas", "EU");
        var us = await OptionIdAsync("vendor-areas", "US");

        var north = await CreateVendorAsync("  Northwind Review  ", website: "https://northwind.example", services: [review, forensic], areas: [us], techAi: ["Relativity aiR", " relativity air ", "", "Custom model"], note: "  MSA renewed  ");
        north.GetProperty("name").GetString().ShouldBe("Northwind Review");
        north.GetProperty("category").GetString().ShouldBe("PREFERRED");
        north.GetProperty("note").GetString().ShouldBe("MSA renewed");
        north.GetProperty("services").EnumerateArray().Select(s => s.GetProperty("name").GetString()).ShouldBe(["Forensic", "Review"]); // list order, not request order
        north.GetProperty("areas").EnumerateArray().Select(s => s.GetProperty("name").GetString()).ShouldBe(["US"]);
        north.GetProperty("techAi").EnumerateArray().Select(s => s.GetString()).ShouldBe(["Relativity aiR", "Custom model"]); // duplicate ignoring case dropped
        north.GetProperty("contactCount").GetInt32().ShouldBe(0);
        north.GetProperty("matterCount").GetInt32().ShouldBe(0);
        await CreateVendorAsync("Acme Forensics", "BLACKLISTED", "forensics.example.org", [forensic], [eu]);
        await CreateVendorAsync("Zeta Hosting");

        var id = north.GetProperty("vendorId").GetInt32();
        (await JsonAsync(await As(Admin).GetAsync($"/api/v1/vendors/{id}"))).GetProperty("website").GetString().ShouldBe("https://northwind.example");
        (await As(Admin).GetAsync("/api/v1/vendors/999999")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        (await VendorNamesAsync()).ShouldBe(["Acme Forensics", "Northwind Review", "Zeta Hosting"]);
        (await VendorNamesAsync("?q=northwind")).ShouldBe(["Northwind Review"]);
        (await VendorNamesAsync("?q=forensics.example")).ShouldBe(["Acme Forensics"]); // website
        (await VendorNamesAsync("?q=review")).ShouldBe(["Northwind Review"]); // name and service both match, one row
        (await VendorNamesAsync("?q=forensic")).ShouldBe(["Acme Forensics", "Northwind Review"]); // name of one, service of the other
        (await VendorNamesAsync("?q=north review")).ShouldBe(["Northwind Review"]); // all words
        (await VendorNamesAsync("?category=BLACKLISTED")).ShouldBe(["Acme Forensics"]);
        (await VendorNamesAsync($"?serviceId={forensic}")).ShouldBe(["Acme Forensics", "Northwind Review"]);
        (await VendorNamesAsync($"?areaId={eu}")).ShouldBe(["Acme Forensics"]);
        (await VendorNamesAsync("?sort=-name")).ShouldBe(["Zeta Hosting", "Northwind Review", "Acme Forensics"]);
        (await VendorNamesAsync("?sort=category&pageSize=1")).ShouldBe(["Acme Forensics"]); // BLACKLISTED sorts before PREFERRED
        (await VendorNamesAsync("?sort=-category&pageSize=1")).ShouldBe(["Northwind Review"]);
        (await VendorNamesAsync("?pageSize=1&page=3")).ShouldBe(["Zeta Hosting"]);
        (await As(Admin).GetAsync("/api/v1/vendors?sort=bogus")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await As(Admin).GetAsync("/api/v1/vendors?category=GOOD")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await As(Admin).GetAsync("/api/v1/vendors?nope=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var lookup = await JsonAsync(await As(Admin).GetAsync("/api/v1/vendors/lookup?q=forensic"));
        lookup.EnumerateArray().Select(v => v.GetProperty("name").GetString()).ShouldBe(["Acme Forensics", "Northwind Review"]); // Blacklisted is offered, name match first
        lookup[0].GetProperty("category").GetString().ShouldBe("BLACKLISTED");
        lookup[1].GetProperty("services").EnumerateArray().Select(s => s.GetString()).ShouldBe(["Forensic", "Review"]);
    }

    [Fact]
    public async Task Neutral_is_a_plain_category_and_the_default_of_a_new_vendor()
    {
        var admin = As(Admin);
        var omitted = await JsonAsync(await admin.PostAsJsonAsync("/api/v1/vendors", new { name = "No Category Given" }), HttpStatusCode.Created);
        omitted.GetProperty("category").GetString().ShouldBe("NEUTRAL");
        var blank = await JsonAsync(await admin.PostAsJsonAsync("/api/v1/vendors", new { name = "Blank Category", category = " " }), HttpStatusCode.Created);
        blank.GetProperty("category").GetString().ShouldBe("NEUTRAL");
        await CreateVendorAsync("Chosen Preferred");
        await CreateVendorAsync("Chosen Blacklisted", "BLACKLISTED");

        (await VendorNamesAsync("?category=NEUTRAL")).ShouldBe(["Blank Category", "No Category Given"]);
        (await VendorNamesAsync("?category=PREFERRED")).ShouldBe(["Chosen Preferred"]);
        (await VendorNamesAsync("?sort=category")).ShouldBe(["Chosen Blacklisted", "Blank Category", "No Category Given", "Chosen Preferred"]); // BLACKLISTED, NEUTRAL, PREFERRED

        var id = omitted.GetProperty("vendorId").GetInt32();
        var changed = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}", new { name = "No Category Given", category = "PREFERRED", rowVersion = omitted.GetProperty("rowVersion").GetString() }));
        var back = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}", new { name = "No Category Given", category = "NEUTRAL", rowVersion = changed.GetProperty("rowVersion").GetString() }));
        back.GetProperty("category").GetString().ShouldBe("NEUTRAL");
        (await admin.PutAsJsonAsync($"/api/v1/vendors/{id}", new { name = "No Category Given", rowVersion = back.GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.BadRequest); // an update still names the category
        var bad = await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/vendors", new { name = "Bad Category", category = "GOOD" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        bad.GetProperty("errors").TryGetProperty("category", out _).ShouldBeTrue();
    }

    [Fact]
    public async Task Validation_duplicate_name_inactive_items_and_stale_row_version()
    {
        var admin = As(Admin);
        var vendor = await CreateVendorAsync("Dup Vendor");
        await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/vendors", new { name = "dup vendor", category = "PREFERRED" }), HttpStatusCode.Conflict, "DUPLICATE_NAME");
        (await admin.PostAsJsonAsync("/api/v1/vendors", new { name = " ", category = "PREFERRED" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest); // blank name stopped by model validation
        var bad = await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/vendors", new { name = "Bad Fields", category = "GOOD", website = "has space.com", serviceIds = new[] { 9999 } }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        var fields = bad.GetProperty("errors");
        foreach (var field in new[] { "category", "website", "serviceIds" })
            fields.TryGetProperty(field, out _).ShouldBeTrue(field);

        var old = await JsonAsync(await admin.PostAsJsonAsync("/api/v1/vendor-areas", new { name = "Retired area" }), HttpStatusCode.Created);
        await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/vendor-areas/{old.GetProperty("id").GetInt32()}", new { name = "Retired area", isActive = false, rowVersion = old.GetProperty("rowVersion").GetString() }));
        var inactive = await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/vendors", new { name = "Wants old", category = "PREFERRED", areaIds = new[] { old.GetProperty("id").GetInt32() } }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        inactive.GetProperty("errors").GetProperty("areaIds")[0].GetProperty("code").GetString().ShouldBe("INACTIVE");

        var id = vendor.GetProperty("vendorId").GetInt32();
        var updated = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}", new { name = "Dup Vendor 2", category = "BLACKLISTED", rowVersion = vendor.GetProperty("rowVersion").GetString() }));
        updated.GetProperty("category").GetString().ShouldBe("BLACKLISTED");
        await ProblemAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}", new { name = "Stale", category = "PREFERRED", rowVersion = vendor.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
        var other = await CreateVendorAsync("Other Vendor");
        await ProblemAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}", new { name = "OTHER vendor", category = "PREFERRED", rowVersion = updated.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "DUPLICATE_NAME");
        other.GetProperty("vendorId").GetInt32().ShouldNotBe(id);
    }

    [Fact]
    public async Task Update_replaces_services_areas_and_tech_ai_and_audits_each_change()
    {
        var admin = As(Admin);
        var forensic = await OptionIdAsync("vendor-services", "Forensic");
        var review = await OptionIdAsync("vendor-services", "Review");
        var itar = await OptionIdAsync("vendor-services", "ITAR");
        var us = await OptionIdAsync("vendor-areas", "US");
        var vendor = await CreateVendorAsync("Audit Vendor", services: [forensic], areas: [us], techAi: ["Alpha", "Beta"]);
        var id = vendor.GetProperty("vendorId").GetInt32();

        // Only the lists change: the row version still moves, and the unchanged fields write no field event.
        var changed = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}", new
        {
            name = "Audit Vendor",
            category = "PREFERRED",
            serviceIds = new[] { review, itar },
            areaIds = Array.Empty<int>(),
            techAi = new[] { "beta", "Gamma" },
            rowVersion = vendor.GetProperty("rowVersion").GetString(),
        }));
        changed.GetProperty("rowVersion").GetString().ShouldNotBe(vendor.GetProperty("rowVersion").GetString());
        changed.GetProperty("services").EnumerateArray().Select(s => s.GetProperty("name").GetString()).ShouldBe(["Review", "ITAR"]);
        changed.GetProperty("areas").GetArrayLength().ShouldBe(0);
        changed.GetProperty("techAi").EnumerateArray().Select(s => s.GetString()).ShouldBe(["beta", "Gamma"]);

        var events = await AuditAsync("Vendor");
        var services = events.Where(e => e.EventType == "VENDOR_SERVICES_CHANGED").ToList();
        services.Select(e => (e.OldValue, e.NewValue)).ShouldBe([(null, "Forensic"), ("Forensic", "ITAR, Review")]);
        events.Where(e => e.EventType == "VENDOR_AREAS_CHANGED").Select(e => (e.OldValue, e.NewValue)).ShouldBe([(null, "US"), ("US", null)]);
        events.Where(e => e.EventType == "VENDOR_TECH_AI_CHANGED").Select(e => (e.OldValue, e.NewValue)).ShouldBe([(null, "Alpha, Beta"), ("Alpha, Beta", "beta, Gamma")]);
        events.Where(e => e.EventType == "FIELD_CHANGED" && e.ObjectId == id.ToString() && e.FieldKey == "Name").Count().ShouldBe(1); // set at creation only
        events.ShouldAllBe(e => e.MatterId == null);

        // A plain field change is a generic field event with old and new value.
        await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}", new
        {
            name = "Audit Vendor",
            category = "BLACKLISTED",
            note = "Late deliveries",
            serviceIds = new[] { review, itar },
            techAi = new[] { "beta", "Gamma" },
            rowVersion = changed.GetProperty("rowVersion").GetString(),
        }));
        var category = (await AuditAsync("Vendor", "FIELD_CHANGED")).Single(e => e.FieldKey == "CategoryCode" && e.OldValue == "PREFERRED");
        category.NewValue.ShouldBe("BLACKLISTED");
        category.ActorUserId.ShouldNotBeNull();
    }

    // ---- contacts

    [Fact]
    public async Task Contacts_are_people_with_one_flag_and_every_change_is_audited()
    {
        var admin = As(Admin);
        var vendor = await CreateVendorAsync("Contact Vendor");
        var id = vendor.GetProperty("vendorId").GetInt32();
        var maria = await CreatePersonAsync("Maria", "Lopez");
        var tom = await CreatePersonAsync("Tom", "Reed");

        var plain = await JsonAsync(await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = maria.GetProperty("personId").GetInt32() }), HttpStatusCode.Created);
        plain.GetProperty("flag").GetString().ShouldBe("NONE");
        plain.GetProperty("personName").GetString().ShouldBe("Maria Lopez");
        plain.GetProperty("personCompany").GetString().ShouldBe("Acme Vendor");
        plain.TryGetProperty("reportedOn", out var none).ShouldBeTrue();
        none.ValueKind.ShouldBe(JsonValueKind.Null);

        await ProblemAsync(await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = maria.GetProperty("personId").GetInt32() }), HttpStatusCode.Conflict, "DUPLICATE_LINK");
        (await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = 999999 })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await admin.PostAsJsonAsync("/api/v1/vendors/999999/contacts", new { personId = maria.GetProperty("personId").GetInt32() })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = tom.GetProperty("personId").GetInt32(), flag = "DO_NOT_HIRE" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest); // date needed
        (await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = tom.GetProperty("personId").GetInt32(), flag = "DO_NOT_HIRE", reportedOn = "2999-01-01" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = tom.GetProperty("personId").GetInt32(), flag = "MAYBE", reportedOn = "2026-03-18" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var tomContact = await JsonAsync(await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = tom.GetProperty("personId").GetInt32(), flag = "DO_NOT_HIRE", reportedOn = "2026-03-18", note = " Shipped unencrypted media " }), HttpStatusCode.Created);
        tomContact.GetProperty("flag").GetString().ShouldBe("DO_NOT_HIRE");
        tomContact.GetProperty("reportedOn").GetString().ShouldBe("2026-03-18");
        tomContact.GetProperty("note").GetString().ShouldBe("Shipped unencrypted media");
        tomContact.GetProperty("reportedByName").GetString().ShouldNotBeNullOrEmpty();

        var vendorNow = await JsonAsync(await admin.GetAsync($"/api/v1/vendors/{id}"));
        vendorNow.GetProperty("contactCount").GetInt32().ShouldBe(2);
        vendorNow.GetProperty("doNotHireCount").GetInt32().ShouldBe(1);
        (await JsonAsync(await admin.GetAsync("/api/v1/vendors/lookup?q=contact"))).EnumerateArray().Single().GetProperty("hasDoNotHireContact").GetBoolean().ShouldBeTrue();

        var list = await JsonAsync(await admin.GetAsync($"/api/v1/vendors/{id}/contacts"));
        list.EnumerateArray().Select(c => c.GetProperty("personName").GetString()).ShouldBe(["Maria Lopez", "Tom Reed"]);

        // Recommend Maria, then clear Tom: NONE wipes date, reporter and note.
        var cid = plain.GetProperty("contactId").GetInt32();
        var recommended = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}/contacts/{cid}", new { flag = "RECOMMENDED", reportedOn = "2026-04-01", note = "Responsive", rowVersion = plain.GetProperty("rowVersion").GetString() }));
        recommended.GetProperty("flag").GetString().ShouldBe("RECOMMENDED");
        await ProblemAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}/contacts/{cid}", new { flag = "NONE", rowVersion = plain.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
        var tid = tomContact.GetProperty("contactId").GetInt32();
        var cleared = await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/vendors/{id}/contacts/{tid}", new { flag = "NONE", reportedOn = "2026-05-05", note = "ignored", rowVersion = tomContact.GetProperty("rowVersion").GetString() }));
        cleared.GetProperty("flag").GetString().ShouldBe("NONE");
        cleared.GetProperty("note").ValueKind.ShouldBe(JsonValueKind.Null);
        cleared.GetProperty("reportedByUserId").ValueKind.ShouldBe(JsonValueKind.Null);
        (await admin.PutAsJsonAsync($"/api/v1/vendors/{id}/contacts/999999", new { flag = "NONE", rowVersion = "AAAAAAAAAAA=" })).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var flagEvents = (await AuditAsync("VendorContact", "FIELD_CHANGED")).Where(e => e.FieldKey == "FlagCode" && e.OldValue != null).Select(e => (e.ObjectId, e.OldValue, e.NewValue)).ToList();
        flagEvents.ShouldBe([(cid.ToString(), "NONE", "RECOMMENDED"), (tid.ToString(), "DO_NOT_HIRE", "NONE")]);

        (await admin.DeleteAsync($"/api/v1/vendors/{id}/contacts/{cid}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await admin.DeleteAsync($"/api/v1/vendors/{id}/contacts/{cid}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await JsonAsync(await admin.GetAsync($"/api/v1/vendors/{id}/contacts"))).GetArrayLength().ShouldBe(1);
        (await JsonAsync(await admin.GetAsync($"/api/v1/people/{maria.GetProperty("personId").GetInt32()}"))).GetProperty("isActive").GetBoolean().ShouldBeTrue(); // the person stays
    }

    [Fact]
    public async Task A_deactivated_person_cannot_be_added_but_stays_a_contact()
    {
        var admin = As(Admin);
        var vendor = await CreateVendorAsync("Deactivate Vendor");
        var id = vendor.GetProperty("vendorId").GetInt32();
        var ann = await CreatePersonAsync("Ann", "Gone");
        var kept = await JsonAsync(await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = ann.GetProperty("personId").GetInt32() }), HttpStatusCode.Created);
        var late = await CreatePersonAsync("Bob", "Late");
        await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/people/{late.GetProperty("personId").GetInt32()}", new { firstName = "Bob", lastName = "Late", personType = "EXTERNAL", companyName = "Acme Vendor", isActive = false, rowVersion = late.GetProperty("rowVersion").GetString() }));
        var refused = await ProblemAsync(await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = late.GetProperty("personId").GetInt32() }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        refused.GetProperty("errors").GetProperty("personId")[0].GetProperty("code").GetString().ShouldBe("INACTIVE");

        await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/people/{ann.GetProperty("personId").GetInt32()}", new { firstName = "Ann", lastName = "Gone", personType = "EXTERNAL", companyName = "Acme Vendor", isActive = false, rowVersion = ann.GetProperty("rowVersion").GetString() }));
        var list = await JsonAsync(await admin.GetAsync($"/api/v1/vendors/{id}/contacts"));
        list.EnumerateArray().Single().GetProperty("personIsActive").GetBoolean().ShouldBeFalse();
        kept.GetProperty("contactId").GetInt32().ShouldBe(list[0].GetProperty("contactId").GetInt32());
    }

    // ---- links and delete

    [Fact]
    public async Task Link_unlink_both_directions_blacklisted_confirmation_and_audit_on_the_matter()
    {
        var admin = As(Admin);
        var matter = await CreateMatterAsync("12");
        var other = await CreateMatterAsync("13");
        var good = await CreateVendorAsync("Good Vendor");
        var bad = await CreateVendorAsync("Bad Vendor", "BLACKLISTED");
        var goodId = good.GetProperty("vendorId").GetInt32();
        var badId = bad.GetProperty("vendorId").GetInt32();

        var linked = await JsonAsync(await admin.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = goodId }), HttpStatusCode.Created);
        linked.GetProperty("name").GetString().ShouldBe("Good Vendor");
        linked.GetProperty("linkedByName").GetString().ShouldNotBeNullOrEmpty();
        await ProblemAsync(await admin.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = goodId }), HttpStatusCode.Conflict, "DUPLICATE_LINK");
        var needs = await ProblemAsync(await admin.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = badId }), HttpStatusCode.Conflict, "VENDOR_BLACKLISTED_CONFIRMATION_REQUIRED");
        needs.GetProperty("detail").GetString()!.ShouldContain("Bad Vendor");
        (await admin.GetAsync($"/api/v1/matters/{matter}/vendors")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(await admin.GetAsync($"/api/v1/matters/{matter}/vendors"))).GetArrayLength().ShouldBe(1);
        await JsonAsync(await admin.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = badId, confirmBlacklisted = true }), HttpStatusCode.Created);
        (await admin.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = 999999 })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await admin.PostAsJsonAsync("/api/v1/matters/999999/vendors", new { vendorId = goodId })).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        await JsonAsync(await admin.PostAsJsonAsync($"/api/v1/matters/{other}/vendors", new { vendorId = goodId }), HttpStatusCode.Created);
        var onMatter = await JsonAsync(await admin.GetAsync($"/api/v1/matters/{matter}/vendors"));
        onMatter.EnumerateArray().Select(v => v.GetProperty("name").GetString()).ShouldBe(["Bad Vendor", "Good Vendor"]); // Blacklisted first

        var reverse = await JsonAsync(await admin.GetAsync($"/api/v1/vendors/{goodId}/matters"));
        reverse.EnumerateArray().Select(m => m.GetProperty("matterRef").GetString()).ShouldBe(["00343-00012", "00343-00013"]);
        reverse[0].GetProperty("clientName").GetString().ShouldBe("Acme Corp");
        (await JsonAsync(await admin.GetAsync($"/api/v1/vendors/{goodId}"))).GetProperty("matterCount").GetInt32().ShouldBe(2);
        (await admin.GetAsync("/api/v1/vendors/999999/matters")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // The delete rule: linked = refused with the count; unlinked = deleted.
        var refused = await ProblemAsync(await admin.DeleteAsync($"/api/v1/vendors/{goodId}"), HttpStatusCode.Conflict, "VENDOR_LINKED_TO_MATTERS");
        refused.GetProperty("meta").GetProperty("matterCount").GetInt32().ShouldBe(2);
        refused.GetProperty("detail").GetString()!.ShouldContain("2 matters");
        (await admin.GetAsync($"/api/v1/vendors/{goodId}")).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await admin.DeleteAsync($"/api/v1/matters/{matter}/vendors/{goodId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await admin.DeleteAsync($"/api/v1/matters/{matter}/vendors/{goodId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await admin.DeleteAsync($"/api/v1/matters/{other}/vendors/{goodId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await admin.DeleteAsync($"/api/v1/vendors/{goodId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await admin.GetAsync($"/api/v1/vendors/{goodId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var linkEvents = await _factory.WithDbAsync(db => db.Set<AuditEvent>().Where(a => a.EventType == "VENDOR_LINKED" || a.EventType == "VENDOR_UNLINKED").OrderBy(a => a.Id).ToListAsync());
        linkEvents.Select(e => (e.EventType, e.MatterId, e.ObjectId)).ShouldBe([
            ("VENDOR_LINKED", matter, goodId.ToString()),
            ("VENDOR_LINKED", matter, badId.ToString()),
            ("VENDOR_LINKED", other, goodId.ToString()),
            ("VENDOR_UNLINKED", matter, goodId.ToString()),
            ("VENDOR_UNLINKED", other, goodId.ToString()),
        ]);
        linkEvents[0].NewValue.ShouldBe("00343-00012");
        linkEvents[0].ActorUserId.ShouldNotBeNull();
    }

    [Fact]
    public async Task Deleting_a_vendor_removes_its_contacts_lists_and_tech_ai_and_keeps_the_people()
    {
        var admin = As(Admin);
        var eu = await OptionIdAsync("vendor-areas", "EU");
        var vendor = await CreateVendorAsync("Delete Me", areas: [eu], techAi: ["Model X"]);
        var id = vendor.GetProperty("vendorId").GetInt32();
        var person = await CreatePersonAsync("Dee", "Lete");
        await JsonAsync(await admin.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = person.GetProperty("personId").GetInt32(), flag = "RECOMMENDED", reportedOn = "2026-02-02" }), HttpStatusCode.Created);

        (await admin.DeleteAsync($"/api/v1/vendors/{id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await _factory.CountAsync<LptHub.Vendors.Domain.VendorContact>()).ShouldBe(0);
        (await _factory.CountAsync<LptHub.Vendors.Domain.VendorTechAi>()).ShouldBe(0);
        (await _factory.CountAsync<LptHub.Vendors.Domain.VendorAreaChoice>()).ShouldBe(0);
        (await admin.GetAsync($"/api/v1/people/{person.GetProperty("personId").GetInt32()}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await admin.DeleteAsync($"/api/v1/vendors/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await AuditAsync("Vendor", "FIELD_CHANGED")).Any(e => e.FieldKey == "Name" && e.OldValue == "Delete Me" && e.NewValue == null).ShouldBeTrue();
        var areaItem = (await JsonAsync(await admin.GetAsync("/api/v1/vendor-areas"))).EnumerateArray().Single(i => i.GetProperty("id").GetInt32() == eu);
        areaItem.GetProperty("inUseCount").GetInt32().ShouldBe(0);
    }

    // ---- permissions

    [Fact]
    public async Task Permission_matrix_view_manage_and_link_are_separate()
    {
        var admin = As(Admin);
        var vendor = await CreateVendorAsync("Matrix Vendor");
        var id = vendor.GetProperty("vendorId").GetInt32();
        var matter = await CreateMatterAsync("12");
        var person = await CreatePersonAsync("Pat", "Matrix");

        var none = await UserWithAsync(@"KE\vnone", Permissions.Matter.View);
        var viewer = await UserWithAsync(@"KE\vview", Permissions.Vendor.View, Permissions.Matter.View);
        var manager = await UserWithAsync(@"KE\vmanage", Permissions.Vendor.View, Permissions.Vendor.Manage, Permissions.Matter.View);
        var linker = await UserWithAsync(@"KE\vlink", Permissions.Vendor.View, Permissions.Vendor.Link, Permissions.Matter.View);
        var linkOnly = await UserWithAsync(@"KE\vlinkonly", Permissions.Vendor.Link, Permissions.Matter.View);
        var noMatterView = await UserWithAsync(@"KE\vnomatter", Permissions.Vendor.View, Permissions.Vendor.Link);

        async Task Denied(HttpClient client, Func<HttpClient, Task<HttpResponseMessage>> call) =>
            await ProblemAsync(await call(client), HttpStatusCode.Forbidden, "PERMISSION_DENIED");

        // No Vendor permission at all: everything is denied.
        await Denied(none, c => c.GetAsync("/api/v1/vendors"));
        await Denied(none, c => c.GetAsync($"/api/v1/vendors/{id}"));
        await Denied(none, c => c.GetAsync("/api/v1/vendors/lookup"));
        await Denied(none, c => c.GetAsync($"/api/v1/vendors/{id}/contacts"));
        await Denied(none, c => c.GetAsync($"/api/v1/vendors/{id}/matters"));
        await Denied(none, c => c.GetAsync($"/api/v1/matters/{matter}/vendors"));
        await Denied(none, c => c.GetAsync("/api/v1/vendor-services"));
        await Denied(none, c => c.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = id }));

        // View only: reads, no writes, no link.
        (await viewer.GetAsync("/api/v1/vendors")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync($"/api/v1/vendors/{id}/contacts")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync($"/api/v1/vendors/{id}/matters")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync($"/api/v1/matters/{matter}/vendors")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync("/api/v1/vendor-areas")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await Denied(viewer, c => c.PostAsJsonAsync("/api/v1/vendors", new { name = "X", category = "PREFERRED" }));
        await Denied(viewer, c => c.PutAsJsonAsync($"/api/v1/vendors/{id}", new { name = "X", category = "PREFERRED", rowVersion = "AAAAAAAAAAA=" }));
        await Denied(viewer, c => c.DeleteAsync($"/api/v1/vendors/{id}"));
        await Denied(viewer, c => c.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = person.GetProperty("personId").GetInt32() }));
        await Denied(viewer, c => c.PostAsJsonAsync("/api/v1/vendor-services", new { name = "X" }));
        await Denied(viewer, c => c.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = id }));
        await Denied(viewer, c => c.DeleteAsync($"/api/v1/matters/{matter}/vendors/{id}"));

        // Manage: maintains vendors, contacts and lists, but may not link.
        (await manager.PostAsJsonAsync("/api/v1/vendors", new { name = "Made By Manager", category = "PREFERRED" })).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await manager.PostAsJsonAsync($"/api/v1/vendors/{id}/contacts", new { personId = person.GetProperty("personId").GetInt32() })).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await manager.PostAsJsonAsync("/api/v1/vendor-services", new { name = "Manager service" })).StatusCode.ShouldBe(HttpStatusCode.Created);
        await Denied(manager, c => c.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = id }));

        // Link: links and unlinks, may not maintain vendors; the combobox works with View + Link and with Link alone.
        (await linker.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = id })).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await linker.GetAsync("/api/v1/vendors/lookup?q=matrix")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await linkOnly.GetAsync("/api/v1/vendors/lookup?q=matrix")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await Denied(linkOnly, c => c.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = id })); // the server requires View with Link
        await Denied(linker, c => c.PostAsJsonAsync("/api/v1/vendors", new { name = "Nope", category = "PREFERRED" }));
        await Denied(linker, c => c.DeleteAsync($"/api/v1/vendors/{id}"));
        await Denied(noMatterView, c => c.PostAsJsonAsync($"/api/v1/matters/{matter}/vendors", new { vendorId = id }));
        await Denied(noMatterView, c => c.GetAsync($"/api/v1/vendors/{id}/matters"));
        (await linker.DeleteAsync($"/api/v1/matters/{matter}/vendors/{id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        admin.ShouldNotBeNull();
    }
}
