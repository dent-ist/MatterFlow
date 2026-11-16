using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.Audit.Domain;
using LptHub.Integrations.Contracts;
using LptHub.Integrations.Domain;
using LptHub.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace LptHub.IntegrationTests.Integrations;

/// <summary>
/// Administration > Settings > Integrations (epic #1389, issue #1395) through the full HTTP pipeline against a real SQL Server and the built-in Entra ID simulator (no network): seeded rows, the permission
/// matrix, the one-per-type rule, the write-only secret (never in a response, an audit row or the database column), Test Connection outcomes, tokens per scope and the audit events.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class IntegrationsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Admin = DatabaseApiFactory.AdminAccount;
    private const string Tenant = "11111111-1111-1111-1111-111111111111";
    private const string ClientId = "22222222-2222-2222-2222-222222222222";
    private const string SecretValue = "Abc8Q~TopSecretValue-9f3";
    private const string LookupBase = "https://matters.example-firm.test/api/v1";
    private const string LookupScope = "api://cccccccc-0000-4000-8000-000000000003/.default";

    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() =>
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { ExtraSettings = [("Integrations:Simulator:Enabled", "true")] };

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

    private async Task<JsonElement> EntraAsync() => await JsonAsync(await As(Admin).GetAsync("/api/v1/admin/entra-connection"));

    private async Task<JsonElement> SetUpConnectionAsync(string secret = SecretValue, string expires = "2027-03-18", string tenant = Tenant)
    {
        var admin = As(Admin);
        var current = await EntraAsync();
        await JsonAsync(await admin.PutAsJsonAsync("/api/v1/admin/entra-connection", new { tenantId = tenant, clientId = ClientId, rowVersion = current.GetProperty("rowVersion").GetString() }));
        return await JsonAsync(await admin.PutAsJsonAsync("/api/v1/admin/entra-connection/secret", new { secret, expiresOn = expires }));
    }

    private async Task<JsonElement> IntegrationAsync(string name) =>
        (await JsonAsync(await As(Admin).GetAsync("/api/v1/admin/integrations"))).EnumerateArray().Single(i => i.GetProperty("name").GetString() == name);

    private async Task<JsonElement> ConfigureAsync(string name, string baseUrl, string scope, bool enabled = true)
    {
        var row = await IntegrationAsync(name);
        return await JsonAsync(await As(Admin).PutAsJsonAsync($"/api/v1/admin/integrations/{row.GetProperty("integrationId").GetInt32()}", new
        {
            name,
            typeCode = row.GetProperty("typeCode").GetString(),
            baseUrl,
            scope,
            isEnabled = enabled,
            rowVersion = row.GetProperty("rowVersion").GetString(),
        }));
    }

    private async Task<JsonElement> TestIntegrationAsync(string name) =>
        await JsonAsync(await As(Admin).PostAsync($"/api/v1/admin/integrations/{(await IntegrationAsync(name)).GetProperty("integrationId").GetInt32()}/test", null));

    private Task<List<AuditEvent>> AuditAsync(params string[] eventTypes) =>
        _factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking().Where(e => eventTypes.Contains(e.EventType)).OrderBy(e => e.Id).ToListAsync());

    [Fact]
    public async Task The_script_seeds_matter_lookup_and_ethical_wall_as_not_set_up_and_an_empty_connection()
    {
        var list = await JsonAsync(await As(Admin).GetAsync("/api/v1/admin/integrations"));

        list.EnumerateArray().Select(i => (i.GetProperty("name").GetString(), i.GetProperty("typeCode").GetString(), i.GetProperty("status").GetString(), i.GetProperty("isEnabled").GetBoolean()))
            .ShouldBe([("Matter Lookup", "MATTER_LOOKUP", "NOT_SET_UP", true), ("Ethical Wall", "ETHICAL_WALL", "NOT_SET_UP", true)]);
        var entra = await EntraAsync();
        entra.GetProperty("secretIsSet").GetBoolean().ShouldBeFalse();
        entra.GetProperty("tenantId").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Only_an_administrator_may_use_the_admin_endpoints_and_the_lookup_serves_whoever_creates_clients_or_matters()
    {
        var settingsOnly = await UserWithAsync(@"ke\settings", "Settings.Manage", "Audit.View");
        var creator = await UserWithAsync(@"ke\creator", "Client.Create", "Client.View");
        var plain = await UserWithAsync(@"ke\plain", "Matter.View");

        foreach (var client in new[] { settingsOnly, creator, plain })
        {
            (await client.GetAsync("/api/v1/admin/entra-connection")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PutAsJsonAsync("/api/v1/admin/entra-connection", new { rowVersion = "AA==" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PutAsJsonAsync("/api/v1/admin/entra-connection/secret", new { secret = "x", expiresOn = "2027-01-01" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PostAsync("/api/v1/admin/entra-connection/test", null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.GetAsync("/api/v1/admin/integrations")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PostAsJsonAsync("/api/v1/admin/integrations", new { name = "X", typeCode = "OTHER" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PutAsJsonAsync("/api/v1/admin/integrations/1", new { name = "X", typeCode = "OTHER", rowVersion = "AA==" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.DeleteAsync("/api/v1/admin/integrations/1")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PostAsync("/api/v1/admin/integrations/1/enable", null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PostAsync("/api/v1/admin/integrations/1/disable", null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            (await client.PostAsync("/api/v1/admin/integrations/1/test", null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        }

        (await As(Admin).GetAsync("/api/v1/admin/entra-connection")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await As(Admin).GetAsync("/api/v1/admin/integrations")).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await creator.GetAsync("/api/v1/matter-lookup/status")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await creator.PostAsJsonAsync("/api/v1/matter-lookup/search", new { clientNumber = "343" })).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await plain.GetAsync("/api/v1/matter-lookup/status")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await plain.PostAsJsonAsync("/api/v1/matter-lookup/search", new { clientNumber = "343" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await settingsOnly.GetAsync("/api/v1/matter-lookup/status")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_secret_is_stored_encrypted_and_is_in_no_response_no_audit_row_and_no_column_in_clear()
    {
        var saved = await SetUpConnectionAsync();

        saved.GetProperty("secretIsSet").GetBoolean().ShouldBeTrue();
        saved.GetProperty("secretExpiresOn").GetString().ShouldBe("2027-03-18");
        saved.GetProperty("secretUpdatedBy").GetString().ShouldNotBeNullOrEmpty();
        var allText = new List<string> { saved.GetRawText(), (await EntraAsync()).GetRawText(), await As(Admin).GetStringAsync("/api/v1/admin/integrations") };
        allText.ShouldAllBe(t => !t.Contains(SecretValue, StringComparison.Ordinal) && !t.Contains("TopSecret", StringComparison.OrdinalIgnoreCase));
        saved.EnumerateObject().Select(p => p.Name).ShouldNotContain(n => n.Contains("secret", StringComparison.OrdinalIgnoreCase) && n != "secretIsSet" && n != "secretExpiresOn" && n != "secretUpdatedAt" && n != "secretUpdatedBy");

        var stored = await _factory.WithDbAsync(db => db.Set<EntraConnection>().AsNoTracking().Select(c => c.ClientSecretProtected).SingleAsync());
        stored.ShouldNotBeNullOrEmpty();
        stored.ShouldNotContain("TopSecret");

        var audit = await AuditAsync("ENTRA_SECRET_REPLACED", "ENTRA_CONNECTION_CHANGED");
        audit.Select(e => e.EventType).ShouldBe(["ENTRA_CONNECTION_CHANGED", "ENTRA_SECRET_REPLACED"]);
        audit.ShouldAllBe(e => e.ObjectType == "EntraConnection" && e.ObjectId == "1");
        var every = await _factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking().Select(e => (e.Summary ?? "") + "|" + (e.OldValue ?? "") + "|" + (e.NewValue ?? "") + "|" + (e.FieldKey ?? "")).ToListAsync());
        every.ShouldAllBe(t => !t.Contains("TopSecret", StringComparison.OrdinalIgnoreCase) && !t.Contains(stored, StringComparison.Ordinal));
        audit[1].Summary.ShouldBe("Set the client secret; new expiry 03/18/2027");
        audit[0].Summary.ShouldBe("Changed the Microsoft Entra ID connection: Tenant ID and Client ID");

        await SetUpConnectionAsync("Another~Value~123", "2027-06-01");
        (await AuditAsync("ENTRA_SECRET_REPLACED"))[1].Summary.ShouldBe("Replaced the client secret; new expiry 06/01/2027");
    }

    [Theory]
    [InlineData("not-a-guid-client")]
    public async Task Tenant_and_client_ids_are_checked(string badClient)
    {
        var admin = As(Admin);
        var current = await EntraAsync();

        var response = await admin.PutAsJsonAsync("/api/v1/admin/entra-connection", new { tenantId = "https://evil.example/", clientId = badClient, rowVersion = current.GetProperty("rowVersion").GetString() });
        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        problem.GetProperty("errors").EnumerateObject().Select(p => p.Name).Order().ShouldBe(["clientId", "tenantId"]);
    }

    [Fact]
    public async Task A_pasted_secret_id_and_a_missing_value_are_refused_with_a_plain_message()
    {
        var admin = As(Admin);

        var pastedId = await ProblemAsync(await admin.PutAsJsonAsync("/api/v1/admin/entra-connection/secret", new { secret = Guid.NewGuid().ToString(), expiresOn = "2027-03-18" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        pastedId.GetProperty("errors").GetProperty("secret")[0].GetProperty("code").GetString().ShouldBe("LOOKS_LIKE_ID");
        await ProblemAsync(await admin.PutAsJsonAsync("/api/v1/admin/entra-connection/secret", new { secret = "valid-value", expiresOn = (string?)null }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        (await EntraAsync()).GetProperty("secretIsSet").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task A_stale_row_version_is_a_conflict()
    {
        var admin = As(Admin);
        var first = await EntraAsync();
        await JsonAsync(await admin.PutAsJsonAsync("/api/v1/admin/entra-connection", new { tenantId = Tenant, clientId = ClientId, rowVersion = first.GetProperty("rowVersion").GetString() }));

        await ProblemAsync(await admin.PutAsJsonAsync("/api/v1/admin/entra-connection", new { tenantId = Tenant, clientId = Guid.NewGuid().ToString(), rowVersion = first.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
    }

    [Fact]
    public async Task One_matter_lookup_and_one_ethical_wall_at_most_but_any_number_of_other()
    {
        var admin = As(Admin);

        var duplicate = await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/admin/integrations", new { name = "Second Lookup", typeCode = "MATTER_LOOKUP" }), HttpStatusCode.Conflict, "INTEGRATION_TYPE_EXISTS");
        duplicate.GetProperty("detail").GetString()!.ShouldContain("Matter Lookup");
        await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/admin/integrations", new { name = "Second Wall", typeCode = "ETHICAL_WALL" }), HttpStatusCode.Conflict, "INTEGRATION_TYPE_EXISTS");
        await JsonAsync(await admin.PostAsJsonAsync("/api/v1/admin/integrations", new { name = "Billing Export", typeCode = "OTHER" }), HttpStatusCode.Created);
        await JsonAsync(await admin.PostAsJsonAsync("/api/v1/admin/integrations", new { name = "Records Hold Notices", typeCode = "OTHER" }), HttpStatusCode.Created);
        await ProblemAsync(await admin.PostAsJsonAsync("/api/v1/admin/integrations", new { name = "billing export", typeCode = "OTHER" }), HttpStatusCode.Conflict, "DUPLICATE_NAME");

        var wall = await IntegrationAsync("Ethical Wall");
        var change = await ProblemAsync(await admin.PutAsJsonAsync($"/api/v1/admin/integrations/{wall.GetProperty("integrationId").GetInt32()}", new { name = "Ethical Wall", typeCode = "MATTER_LOOKUP", isEnabled = true, rowVersion = wall.GetProperty("rowVersion").GetString() }), HttpStatusCode.Conflict, "INTEGRATION_TYPE_EXISTS");
        change.GetProperty("errors").GetProperty("typeCode").GetArrayLength().ShouldBe(1);

        // The database says the same when the application is bypassed.
        await Should.ThrowAsync<DbUpdateException>(() => _factory.WithDbAsync(async db =>
        {
            db.Set<Integration>().Add(new Integration { Name = "Sneaky", TypeCode = IntegrationTypes.EthicalWall });
            await db.SaveChangesAsync();
        }));
    }

    [Theory]
    [InlineData("http://matters.example-firm.test", "baseUrl")]
    [InlineData("matters.example-firm.test", "baseUrl")]
    [InlineData("https://user:pw@matters.example-firm.test", "baseUrl")]
    public async Task A_base_url_must_be_https(string url, string field)
    {
        var problem = await ProblemAsync(await As(Admin).PostAsJsonAsync("/api/v1/admin/integrations", new { name = "Bad", typeCode = "OTHER", baseUrl = url }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        problem.GetProperty("errors").GetProperty(field)[0].GetProperty("code").GetString().ShouldBe("NOT_HTTPS");
    }

    [Fact]
    public async Task A_scope_with_spaces_and_an_empty_name_are_refused()
    {
        var problem = await ProblemAsync(await As(Admin).PostAsJsonAsync("/api/v1/admin/integrations", new { name = "Fine Name", typeCode = "OTHER", scope = "two words" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        problem.GetProperty("errors").EnumerateObject().Select(p => p.Name).ShouldBe(["scope"]);
        await ProblemAsync(await As(Admin).PostAsJsonAsync("/api/v1/admin/integrations", new { name = "  ", typeCode = "OTHER" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Status_follows_set_up_then_test_then_disable_and_changing_the_endpoint_clears_the_test()
    {
        var admin = As(Admin);
        (await IntegrationAsync("Matter Lookup")).GetProperty("status").GetString().ShouldBe("NOT_SET_UP");

        await SetUpConnectionAsync();
        (await IntegrationAsync("Matter Lookup")).GetProperty("status").GetString().ShouldBe("NOT_SET_UP"); // still no Base URL and Scope
        var configured = await ConfigureAsync("Matter Lookup", LookupBase, LookupScope);
        configured.GetProperty("status").GetString().ShouldBe("NOT_TESTED");

        var ok = await TestIntegrationAsync("Matter Lookup");
        ok.GetProperty("outcome").GetString().ShouldBe("OK");
        ok.GetProperty("tokenSeconds").GetInt32().ShouldBeGreaterThan(3000);
        ok.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("state").GetString()).ShouldBe(["PASSED", "PASSED", "PASSED", "PASSED"]);
        var after = await IntegrationAsync("Matter Lookup");
        after.GetProperty("status").GetString().ShouldBe("CONNECTED");
        after.GetProperty("lastTest").GetProperty("testedBy").GetString().ShouldNotBeNullOrEmpty();

        var id = after.GetProperty("integrationId").GetInt32();
        (await JsonAsync(await admin.PostAsync($"/api/v1/admin/integrations/{id}/disable", null))).GetProperty("status").GetString().ShouldBe("DISABLED");
        (await JsonAsync(await admin.PostAsync($"/api/v1/admin/integrations/{id}/enable", null))).GetProperty("status").GetString().ShouldBe("CONNECTED");

        var moved = await ConfigureAsync("Matter Lookup", "https://other.example-firm.test/api", LookupScope);
        moved.GetProperty("status").GetString().ShouldBe("NOT_TESTED");
        moved.GetProperty("lastTest").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Test_connection_names_the_plain_reason_for_every_failure()
    {
        var admin = As(Admin);

        // Not set up yet.
        var notSet = await JsonAsync(await admin.PostAsync("/api/v1/admin/entra-connection/test", null));
        notSet.GetProperty("outcome").GetString().ShouldBe("NOT_SET_UP");
        (await TestIntegrationAsync("Matter Lookup")).GetProperty("outcome").GetString().ShouldBe("NOT_SET_UP");

        // Entra ID reachable, credentials accepted.
        await SetUpConnectionAsync();
        (await JsonAsync(await admin.PostAsync("/api/v1/admin/entra-connection/test", null))).GetProperty("outcome").GetString().ShouldBe("OK");
        (await EntraAsync()).GetProperty("lastTest").GetProperty("outcome").GetString().ShouldBe("OK");

        await ConfigureAsync("Matter Lookup", LookupBase, "api://refused-scope/.default");
        var scope = await TestIntegrationAsync("Matter Lookup");
        scope.GetProperty("outcome").GetString().ShouldBe("SCOPE_REFUSED");
        scope.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("state").GetString()).ShouldBe(["PASSED", "PASSED", "FAILED", "NOT_REACHED"]);
        (await IntegrationAsync("Matter Lookup")).GetProperty("status").GetString().ShouldBe("FAILED");

        await ConfigureAsync("Matter Lookup", "https://unreachable.example-firm.test/api", LookupScope);
        (await TestIntegrationAsync("Matter Lookup")).GetProperty("outcome").GetString().ShouldBe("API_UNREACHABLE");
        await ConfigureAsync("Matter Lookup", "https://refusing.example-firm.test/api", LookupScope);
        (await TestIntegrationAsync("Matter Lookup")).GetProperty("outcome").GetString().ShouldBe("API_REFUSED");

        // Credentials refused, then expired (the secret decides in the simulator), then Entra ID not reachable (the tenant decides).
        await SetUpConnectionAsync("this-secret-is-refused");
        (await JsonAsync(await admin.PostAsync("/api/v1/admin/entra-connection/test", null))).GetProperty("outcome").GetString().ShouldBe("CREDENTIALS_REFUSED");
        await SetUpConnectionAsync("this-secret-is-expired");
        var expired = await JsonAsync(await admin.PostAsync("/api/v1/admin/entra-connection/test", null));
        expired.GetProperty("outcome").GetString().ShouldBe("SECRET_EXPIRED");
        expired.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("state").GetString()).ShouldBe(["PASSED", "FAILED"]);
        await SetUpConnectionAsync(tenant: "unreachable.example-firm.test");
        (await JsonAsync(await admin.PostAsync("/api/v1/admin/entra-connection/test", null))).GetProperty("outcome").GetString().ShouldBe("ENTRA_UNREACHABLE");
    }

    [Fact]
    public async Task A_test_result_has_no_token_or_secret_and_a_test_does_not_move_last_updated_but_keeps_saving_possible()
    {
        await SetUpConnectionAsync();
        await ConfigureAsync("Matter Lookup", LookupBase, LookupScope);
        var before = await EntraAsync();

        var result = await JsonAsync(await As(Admin).PostAsync("/api/v1/admin/entra-connection/test", null));
        var raw = result.GetRawText() + await As(Admin).GetStringAsync("/api/v1/admin/integrations") + (await EntraAsync()).GetRawText();

        raw.ShouldNotContain("simulated.");
        raw.ShouldNotContain("TopSecret");
        (await EntraAsync()).GetProperty("updatedAt").GetString().ShouldBe(before.GetProperty("updatedAt").GetString());
        // The new token of the record comes with the result, so Save Changes right after a test is not a conflict.
        await JsonAsync(await As(Admin).PutAsJsonAsync("/api/v1/admin/entra-connection", new { tenantId = Tenant, clientId = Guid.NewGuid().ToString(), rowVersion = result.GetProperty("rowVersion").GetString() }));
    }

    [Fact]
    public async Task Changing_any_credential_clears_every_last_test_result()
    {
        var admin = As(Admin);
        await SetUpConnectionAsync();
        await ConfigureAsync("Matter Lookup", LookupBase, LookupScope);
        await admin.PostAsync("/api/v1/admin/entra-connection/test", null);
        await TestIntegrationAsync("Matter Lookup");
        (await IntegrationAsync("Matter Lookup")).GetProperty("status").GetString().ShouldBe("CONNECTED");

        await SetUpConnectionAsync("A-new-secret-value");

        (await EntraAsync()).GetProperty("lastTest").ValueKind.ShouldBe(JsonValueKind.Null);
        (await IntegrationAsync("Matter Lookup")).GetProperty("status").GetString().ShouldBe("NOT_TESTED");

        await TestIntegrationAsync("Matter Lookup");
        var current = await EntraAsync();
        await JsonAsync(await admin.PutAsJsonAsync("/api/v1/admin/entra-connection", new { tenantId = Tenant, clientId = Guid.NewGuid().ToString(), rowVersion = current.GetProperty("rowVersion").GetString() }));
        (await IntegrationAsync("Matter Lookup")).GetProperty("status").GetString().ShouldBe("NOT_TESTED");
    }

    [Fact]
    public async Task The_token_provider_issues_one_token_per_scope_caches_it_and_refuses_what_is_off_or_not_set_up()
    {
        await SetUpConnectionAsync();
        await ConfigureAsync("Matter Lookup", LookupBase, LookupScope);
        await ConfigureAsync("Ethical Wall", "https://walls.example-firm.test/api", "api://dddddddd-0000-4000-8000-000000000004/.default");
        var wallId = (await IntegrationAsync("Ethical Wall")).GetProperty("integrationId").GetInt32();

        await using var scope = _factory.Services.CreateAsyncScope();
        var provider = scope.ServiceProvider.GetRequiredService<IIntegrationTokenProvider>();
        var lookup = await provider.GetTokenForTypeAsync(IntegrationTypes.MatterLookup);
        var wall = await provider.GetTokenForTypeAsync(IntegrationTypes.EthicalWall);
        var lookupAgain = await provider.GetTokenForTypeAsync(IntegrationTypes.MatterLookup);

        lookup.Value.Value.ShouldNotBe(wall.Value.Value);
        lookupAgain.Value.Value.ShouldBe(lookup.Value.Value);
        (await provider.GetTokenAsync(wallId)).Value.Value.ShouldBe(wall.Value.Value);
        lookup.Value.ExpiresAtUtc.ShouldBeGreaterThan(DateTime.UtcNow.AddMinutes(30));

        await As(Admin).PostAsync($"/api/v1/admin/integrations/{wallId}/disable", null);
        var off = await provider.GetTokenAsync(wallId);
        off.Error!.Code.ShouldBe("INTEGRATION_NOT_AVAILABLE");

        await SetUpConnectionAsync("this-secret-is-refused");
        await using var next = _factory.Services.CreateAsyncScope();
        var failed = await next.ServiceProvider.GetRequiredService<IIntegrationTokenProvider>().GetTokenForTypeAsync(IntegrationTypes.MatterLookup);
        failed.Error!.Code.ShouldBe("INTEGRATION_TOKEN_FAILED");
        failed.Error.Meta!["outcome"].ShouldBe("CREDENTIALS_REFUSED");
        failed.Error.Message.ShouldNotContain("refused");
    }

    [Fact]
    public async Task Every_change_is_audited_with_names_and_never_the_secret()
    {
        var admin = As(Admin);
        await SetUpConnectionAsync();
        var created = await JsonAsync(await admin.PostAsJsonAsync("/api/v1/admin/integrations", new { name = "Billing Export", typeCode = "OTHER", baseUrl = "https://billing.example-firm.test/export", scope = "api://x/.default" }), HttpStatusCode.Created);
        var id = created.GetProperty("integrationId").GetInt32();
        await JsonAsync(await admin.PutAsJsonAsync($"/api/v1/admin/integrations/{id}", new { name = "Billing Export 2", typeCode = "OTHER", baseUrl = "https://billing.example-firm.test/v2", scope = "api://x/.default", isEnabled = true, rowVersion = created.GetProperty("rowVersion").GetString() }));
        await admin.PostAsync($"/api/v1/admin/integrations/{id}/disable", null);
        await admin.PostAsync($"/api/v1/admin/integrations/{id}/enable", null);
        (await admin.DeleteAsync($"/api/v1/admin/integrations/{id}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var events = await AuditAsync("INTEGRATION_CREATED", "INTEGRATION_UPDATED", "INTEGRATION_DISABLED", "INTEGRATION_ENABLED", "INTEGRATION_DELETED");

        events.Select(e => (e.EventType, e.Summary)).ShouldBe(
        [
            ("INTEGRATION_CREATED", "Added the Billing Export integration (Other)"),
            ("INTEGRATION_UPDATED", "Changed the Billing Export integration: Name and Base URL"),
            ("INTEGRATION_DISABLED", "Disabled the Billing Export 2 integration"),
            ("INTEGRATION_ENABLED", "Enabled the Billing Export 2 integration"),
            ("INTEGRATION_DELETED", "Deleted the Billing Export 2 integration (Other)"),
        ]);
        events.ShouldAllBe(e => e.ObjectType == "Integration" && e.ObjectId == id.ToString());
        events.ShouldAllBe(e => e.ActorUserId != null);
        (await admin.DeleteAsync($"/api/v1/admin/integrations/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_lookup_button_state_and_the_search_follow_the_integration()
    {
        var creator = await UserWithAsync(@"ke\creator", "Matter.Create", "Matter.View");
        var admin = As(Admin);
        async Task<string> StateAsync() => (await JsonAsync(await creator.GetAsync("/api/v1/matter-lookup/status"))).GetProperty("state").GetString()!;

        (await StateAsync()).ShouldBe("NOT_SET_UP");
        var notSet = await JsonAsync(await creator.PostAsJsonAsync("/api/v1/matter-lookup/search", new { clientNumber = "343" }));
        notSet.GetProperty("outcome").GetString().ShouldBe("NOT_AVAILABLE");

        await SetUpConnectionAsync();
        await ConfigureAsync("Matter Lookup", LookupBase, LookupScope);
        (await StateAsync()).ShouldBe("READY");

        var client = await JsonAsync(await creator.PostAsJsonAsync("/api/v1/matter-lookup/search", new { clientNumber = "343" }));
        client.GetProperty("outcome").GetString().ShouldBe("FOUND");
        client.GetProperty("clientName").GetString().ShouldBe("Simulated Client 00343");

        var matter = await JsonAsync(await creator.PostAsJsonAsync("/api/v1/matter-lookup/search", new { clientNumber = "343", matterNumber = "12" }));
        matter.GetProperty("matterName").GetString().ShouldBe("Simulated Matter 00012");
        matter.GetProperty("matterNumber").GetString().ShouldBe("00012");
        matter.GetProperty("clientNumber").GetString().ShouldBe("00343");

        (await JsonAsync(await creator.PostAsJsonAsync("/api/v1/matter-lookup/search", new { clientNumber = "99999" }))).GetProperty("outcome").GetString().ShouldBe("NOT_FOUND");
        (await JsonAsync(await creator.PostAsJsonAsync("/api/v1/matter-lookup/search", new { clientNumber = "55555" }))).GetProperty("outcome").GetString().ShouldBe("FAILED");
        (await ProblemAsync(await creator.PostAsJsonAsync("/api/v1/matter-lookup/search", new { clientNumber = "12ab" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED")).GetProperty("errors").GetProperty("clientNumber").GetArrayLength().ShouldBe(1);

        var id = (await IntegrationAsync("Matter Lookup")).GetProperty("integrationId").GetInt32();
        await admin.PostAsync($"/api/v1/admin/integrations/{id}/disable", null);
        (await StateAsync()).ShouldBe("DISABLED");
        (await JsonAsync(await creator.PostAsJsonAsync("/api/v1/matter-lookup/search", new { clientNumber = "343" }))).GetProperty("outcome").GetString().ShouldBe("NOT_AVAILABLE");
        await admin.PostAsync($"/api/v1/admin/integrations/{id}/enable", null);

        await ConfigureAsync("Matter Lookup", LookupBase, "api://refused-scope/.default");
        await TestIntegrationAsync("Matter Lookup");
        (await StateAsync()).ShouldBe("FAILED");
    }
}
