using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.Organization.Contracts;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shouldly;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// Clients, Matters and Projects (tickets 26 to 28; SCN-001, SCN-002, SCN-003, SCN-005 data side) against a real SQL Server
/// through the full HTTP pipeline, as the bootstrap System Admin unless a test needs a limited user.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class OrganizationApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        _connectionString = await sql.CreateDatabaseAsync();
        _factory = new DatabaseApiFactory(_connectionString);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient Admin() => As(DatabaseApiFactory.AdminAccount);

    private HttpClient As(string user, WebApplicationFactory<Program>? factory = null)
    {
        var client = (factory ?? _factory).CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

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
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        var problem = JsonDocument.Parse(body).RootElement;
        problem.GetProperty("code").GetString().ShouldBe(code);
        return problem;
    }

    private async Task<JsonElement> CreateClientAsync(string number, string name = "Acme Corp") =>
        await OkAsync(await Admin().PostAsJsonAsync("/api/v1/clients", new { clientNumber = number, name }), HttpStatusCode.Created);

    private async Task<JsonElement> CreateMatterAsync(int clientId, string number, string name = "Merger Review", bool sensitive = false) =>
        await OkAsync(
            await Admin().PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = number, name, isSensitive = sensitive }),
            HttpStatusCode.Created);

    private async Task<JsonElement> CreateProjectAsync(int matterId, string name, string? description = null) =>
        await OkAsync(await Admin().PostAsJsonAsync("/api/v1/projects", new { matterId, name, description }), HttpStatusCode.Created);

    private async Task<string[]> AuditEventTypesAsync(string objectType, int id)
    {
        var page = await OkAsync(await Admin().GetAsync($"/api/v1/audit/events?objectType={objectType}&objectId={id}&pageSize=100"));
        return page.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("eventType").GetString()!).ToArray();
    }

    // ---- SCN-001: numbers are normalized and 343 equals 00343

    [Fact]
    public async Task Client_number_is_normalized_and_padded_and_unpadded_input_is_the_same_client()
    {
        var created = await CreateClientAsync("343");

        created.GetProperty("clientNumber").GetString().ShouldBe("00343");
        created.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        created.GetProperty("matterCount").GetInt32().ShouldBe(0);
        var id = created.GetProperty("clientId").GetInt32();

        foreach (var q in new[] { "343", "00343", "0343", " 343 " })
        {
            var list = await OkAsync(await Admin().GetAsync($"/api/v1/clients?q={Uri.EscapeDataString(q)}"));
            list.GetProperty("total").GetInt32().ShouldBe(1, q);
            list.GetProperty("items")[0].GetProperty("clientId").GetInt32().ShouldBe(id);
        }

        (await OkAsync(await Admin().GetAsync("/api/v1/clients?q=acme"))).GetProperty("total").GetInt32().ShouldBe(1);
        (await OkAsync(await Admin().GetAsync("/api/v1/clients?q=344"))).GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Theory]
    [InlineData("343")]
    [InlineData("00343")]
    [InlineData("0343")]
    [InlineData(" 343 ")]
    public async Task Duplicate_client_number_is_rejected_after_padding_with_a_field_error_and_a_link_to_the_existing_client(string again)
    {
        var first = await CreateClientAsync("343");

        var response = await Admin().PostAsJsonAsync("/api/v1/clients", new { clientNumber = again, name = "Other" });

        var problem = await ProblemAsync(response, HttpStatusCode.Conflict, "DUPLICATE_NUMBER");
        problem.GetProperty("errors").GetProperty("clientNumber")[0].GetProperty("code").GetString().ShouldBe("DUPLICATE_NUMBER");
        problem.GetProperty("errors").GetProperty("clientNumber")[0].GetProperty("message").GetString().ShouldBe("Client 00343 already exists.");
        problem.GetProperty("meta").GetProperty("existingId").GetInt32().ShouldBe(first.GetProperty("clientId").GetInt32());
        (await _factory.CountClientsAsync()).ShouldBe(1);
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("12a")]
    [InlineData("123456")]
    [InlineData("0")]
    [InlineData("00000")]
    [InlineData("-5")]
    [InlineData("3.5")]
    public async Task Invalid_client_numbers_are_rejected_with_a_field_error(string number)
    {
        var response = await Admin().PostAsJsonAsync("/api/v1/clients", new { clientNumber = number, name = "X" });

        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "INVALID_NUMBER_FORMAT");
        problem.GetProperty("errors").GetProperty("clientNumber")[0].GetProperty("code").GetString().ShouldBe("INVALID_NUMBER_FORMAT");
    }

    [Fact]
    public async Task Missing_fields_are_validation_errors_keyed_by_property()
    {
        var response = await Admin().PostAsJsonAsync("/api/v1/clients", new { clientNumber = "", name = "" });

        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        problem.GetProperty("errors").TryGetProperty("clientNumber", out _).ShouldBeTrue();
        problem.GetProperty("errors").TryGetProperty("name", out _).ShouldBeTrue();
    }

    // ---- SCN-002 / SCN-003: matter numbers are unique within a Client only

    [Fact]
    public async Task Same_matter_number_is_allowed_under_different_clients_but_not_twice_within_one_client()
    {
        var acme = await CreateClientAsync("343");
        var beta = await CreateClientAsync("1", "Beta LLC");
        var acmeId = acme.GetProperty("clientId").GetInt32();
        var betaId = beta.GetProperty("clientId").GetInt32();

        var first = await CreateMatterAsync(acmeId, "12");
        var second = await CreateMatterAsync(betaId, "12");

        first.GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        second.GetProperty("matterRef").GetString().ShouldBe("00001-00012");
        first.GetProperty("matterNumber").GetString().ShouldBe("00012");
        first.GetProperty("clientNumber").GetString().ShouldBe("00343");
        first.GetProperty("clientName").GetString().ShouldBe("Acme Corp");

        var duplicate = await Admin().PostAsJsonAsync("/api/v1/matters", new { clientId = acmeId, matterNumber = "00012", name = "Dup" });
        var problem = await ProblemAsync(duplicate, HttpStatusCode.Conflict, "DUPLICATE_NUMBER");
        problem.GetProperty("errors").GetProperty("matterNumber")[0].GetProperty("message").GetString().ShouldBe("Matter 00012 already exists for client 00343.");
        problem.GetProperty("meta").GetProperty("existingId").GetInt32().ShouldBe(first.GetProperty("matterId").GetInt32());

        (await OkAsync(await Admin().GetAsync($"/api/v1/clients/{acmeId}"))).GetProperty("matterCount").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task Matter_reference_resolves_from_padded_unpadded_and_hyphenated_forms()
    {
        var client = await CreateClientAsync("343");
        var matter = await CreateMatterAsync(client.GetProperty("clientId").GetInt32(), "12");
        var id = matter.GetProperty("matterId").GetInt32();

        foreach (var reference in new[] { "00343-00012", "343-12", "343-00012", " 00343 - 12 " })
        {
            var found = await OkAsync(await Admin().GetAsync($"/api/v1/matters/lookup?ref={Uri.EscapeDataString(reference)}"));
            found.GetProperty("matterId").GetInt32().ShouldBe(id, reference);

            var list = await OkAsync(await Admin().GetAsync($"/api/v1/matters?q={Uri.EscapeDataString(reference)}"));
            list.GetProperty("total").GetInt32().ShouldBe(1, reference);
        }

        await ProblemAsync(await Admin().GetAsync("/api/v1/matters/lookup?ref=343-99"), HttpStatusCode.NotFound, "NOT_FOUND");
        await ProblemAsync(await Admin().GetAsync("/api/v1/matters/lookup?ref=nonsense"), HttpStatusCode.BadRequest, "INVALID_NUMBER_FORMAT");

        // A bare number matches the client or the matter number; a name fragment matches matter and client names.
        (await OkAsync(await Admin().GetAsync("/api/v1/matters?q=343"))).GetProperty("total").GetInt32().ShouldBe(1);
        (await OkAsync(await Admin().GetAsync("/api/v1/matters?q=12"))).GetProperty("total").GetInt32().ShouldBe(1);
        (await OkAsync(await Admin().GetAsync("/api/v1/matters?q=merger"))).GetProperty("total").GetInt32().ShouldBe(1);
        (await OkAsync(await Admin().GetAsync("/api/v1/matters?q=acme"))).GetProperty("total").GetInt32().ShouldBe(1);
        (await OkAsync(await Admin().GetAsync("/api/v1/matters?q=99"))).GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task Matter_search_by_a_partial_pair_finds_padded_numbers_as_the_user_types()
    {
        var clientId = (await CreateClientAsync("343")).GetProperty("clientId").GetInt32();
        await CreateMatterAsync(clientId, "12");
        var big = (await CreateMatterAsync(clientId, "99999")).GetProperty("matterId").GetInt32();
        var small = (await CreateMatterAsync(clientId, "99")).GetProperty("matterId").GetInt32();

        async Task<int[]> Search(string q) =>
            [.. (await OkAsync(await Admin().GetAsync($"/api/v1/matters?q={Uri.EscapeDataString(q)}"))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()).Order()];

        (await Search("343-99")).ShouldBe(new[] { small, big }.Order().ToArray()); // exact 00099 and the prefix 99xxx
        (await Search("343-999")).ShouldBe(new[] { big });
        (await Search("343-1")).Length.ShouldBe(1); // 00012
        (await Search("343-13")).ShouldBeEmpty();
    }

    [Fact]
    public async Task Matter_directory_contract_resolves_matters_for_other_modules()
    {
        var client = await CreateClientAsync("343");
        var matter = await CreateMatterAsync(client.GetProperty("clientId").GetInt32(), "12", sensitive: true);
        var id = matter.GetProperty("matterId").GetInt32();

        await using var scope = _factory.Services.CreateAsyncScope();
        var directory = scope.ServiceProvider.GetRequiredService<IMatterDirectory>();

        var byId = await directory.FindAsync(id);
        byId.ShouldNotBeNull();
        byId.MatterRef.ShouldBe("00343-00012");
        byId.IsActive.ShouldBeTrue();
        byId.IsSensitive.ShouldBeTrue();
        byId.ClientIsActive.ShouldBeTrue();
        (await directory.ResolveReferenceAsync("343-12"))!.MatterId.ShouldBe(id);
        (await directory.ResolveReferenceAsync("00343-00099")).ShouldBeNull();
        (await directory.ResolveReferenceAsync("garbage")).ShouldBeNull();
        (await directory.FindAsync(id + 1000)).ShouldBeNull();
    }

    [Fact]
    public async Task Matter_requires_an_existing_active_client()
    {
        var client = await CreateClientAsync("343");
        var clientId = client.GetProperty("clientId").GetInt32();

        var missing = await ProblemAsync(
            await Admin().PostAsJsonAsync("/api/v1/matters", new { clientId = 9999, matterNumber = "1", name = "N" }),
            HttpStatusCode.BadRequest,
            "VALIDATION_FAILED");
        missing.GetProperty("errors").TryGetProperty("clientId", out _).ShouldBeTrue();

        var deactivated = await OkAsync(await Admin().PutAsJsonAsync($"/api/v1/clients/{clientId}", new
        {
            name = "Acme Corp",
            isActive = false,
            rowVersion = client.GetProperty("rowVersion").GetString(),
        }));
        deactivated.GetProperty("isActive").GetBoolean().ShouldBeFalse();

        var blocked = await ProblemAsync(
            await Admin().PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "1", name = "N" }),
            HttpStatusCode.Conflict,
            "CLIENT_INACTIVE");
        blocked.GetProperty("errors").TryGetProperty("clientId", out _).ShouldBeTrue();
    }

    // ---- Activation rules

    [Fact]
    public async Task Matter_deactivation_follows_the_task_guard()
    {
        var client = await CreateClientAsync("343");
        var matter = await CreateMatterAsync(client.GetProperty("clientId").GetInt32(), "12");
        var id = matter.GetProperty("matterId").GetInt32();
        var version = matter.GetProperty("rowVersion").GetString();

        // Default guard (no Task table yet): deactivation is allowed, and reactivation too.
        var inactive = await OkAsync(await Admin().PostAsJsonAsync($"/api/v1/matters/{id}/active", new { isActive = false, rowVersion = version }));
        inactive.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        var active = await OkAsync(await Admin().PostAsJsonAsync($"/api/v1/matters/{id}/active", new { isActive = true, rowVersion = inactive.GetProperty("rowVersion").GetString() }));
        active.GetProperty("isActive").GetBoolean().ShouldBeTrue();

        // A guard that reports open Tasks blocks deactivation with 409 and the count.
        await using var withTasks = _factory.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.RemoveAll<IMatterTaskGuard>();
            s.AddScoped<IMatterTaskGuard, FixedGuard>();
            s.RemoveAll<IOrganizationTaskCounts>();
            s.AddScoped<IOrganizationTaskCounts, FixedCounts>();
        }));
        var blocked = await As(DatabaseApiFactory.AdminAccount, withTasks)
            .PostAsJsonAsync($"/api/v1/matters/{id}/active", new { isActive = false, rowVersion = active.GetProperty("rowVersion").GetString() });
        var problem = await ProblemAsync(blocked, HttpStatusCode.Conflict, "MATTER_HAS_OPEN_TASKS");
        problem.GetProperty("meta").GetProperty("openTaskCount").GetInt32().ShouldBe(3);
        problem.GetProperty("detail").GetString()!.ShouldContain("3 tasks");

        var detail = await OkAsync(await As(DatabaseApiFactory.AdminAccount, withTasks).GetAsync($"/api/v1/matters/{id}"));
        detail.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        detail.GetProperty("openTaskCount").GetInt32().ShouldBe(3, "the detail's count comes from the shared Task counts (#258); the guard only blocks the deactivation");
        detail.GetProperty("overdueTaskCount").GetInt32().ShouldBe(1);
    }

    private sealed class FixedGuard : IMatterTaskGuard
    {
        public Task<int> CountOpenTasksAsync(int matterId, CancellationToken cancellationToken = default) => Task.FromResult(3);
    }

    private sealed class FixedCounts : IOrganizationTaskCounts
    {
        public IQueryable<TaskCountRow> Grouped(TaskCountScope scope) => Enumerable.Empty<TaskCountRow>().AsQueryable();

        public Task<IReadOnlyDictionary<int, TaskCountRow>> ForKeysAsync(TaskCountScope scope, IReadOnlyCollection<int> keys, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyDictionary<int, TaskCountRow>>(keys.ToDictionary(k => k, k => new TaskCountRow { Key = k, Open = 3, Overdue = 1 }));

        public Task<TaskStripCounts> StripAsync(TaskCountScope scope, int key, CancellationToken cancellationToken = default) => Task.FromResult(new TaskStripCounts(3, 1, 0, 0, 0));

        public Task<IReadOnlyList<MatterTaskCount>> TopMattersAsync(int clientId, int take, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<MatterTaskCount>>([]);
    }

    // ---- Edits, concurrency, sensitivity

    [Fact]
    public async Task Matter_edit_updates_name_and_sensitivity_and_rejects_stale_row_versions()
    {
        var client = await CreateClientAsync("343");
        var matter = await CreateMatterAsync(client.GetProperty("clientId").GetInt32(), "12");
        var id = matter.GetProperty("matterId").GetInt32();
        matter.GetProperty("isSensitive").GetBoolean().ShouldBeFalse();
        var version = matter.GetProperty("rowVersion").GetString();

        var edited = await OkAsync(await Admin().PutAsJsonAsync($"/api/v1/matters/{id}", new { name = "Project Falcon", isSensitive = true, rowVersion = version }));
        edited.GetProperty("name").GetString().ShouldBe("Project Falcon");
        edited.GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
        edited.GetProperty("rowVersion").GetString().ShouldNotBe(version);
        edited.GetProperty("modifiedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);

        var stale = await Admin().PutAsJsonAsync($"/api/v1/matters/{id}", new { name = "Again", isSensitive = false, rowVersion = version });
        var problem = await ProblemAsync(stale, HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
        problem.GetProperty("meta").GetProperty("currentRowVersion").GetString().ShouldBe(edited.GetProperty("rowVersion").GetString());

        await ProblemAsync(
            await Admin().PutAsJsonAsync($"/api/v1/matters/{id}", new { name = "x", isSensitive = false, rowVersion = "not base64!" }),
            HttpStatusCode.BadRequest,
            "VALIDATION_FAILED");
        await ProblemAsync(await Admin().GetAsync("/api/v1/matters/99999"), HttpStatusCode.NotFound, "NOT_FOUND");
    }

    // ---- Number edits: restricted permission, audited, cascade to matter references

    [Fact]
    public async Task Changing_a_client_number_needs_its_own_permission_is_audited_and_updates_matter_references()
    {
        var client = await CreateClientAsync("343");
        var clientId = client.GetProperty("clientId").GetInt32();
        var other = await CreateClientAsync("500", "Other Co");
        var matter = await CreateMatterAsync(clientId, "12");

        var roleId = await _factory.CreateRoleAsync("Client editor", Permissions.Client.View, Permissions.Client.Edit);
        await As(@"KE\editor").GetAsync("/api/v1/me");
        await _factory.GrantRoleAsync(@"KE\editor", roleId);
        var denied = await As(@"KE\editor")
            .PutAsJsonAsync($"/api/v1/clients/{clientId}/number", new { number = "344", rowVersion = client.GetProperty("rowVersion").GetString() });
        var denial = await ProblemAsync(denied, HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        denial.GetProperty("meta").GetProperty("permission").GetString().ShouldBe(Permissions.Client.EditNumber);

        var duplicate = await Admin()
            .PutAsJsonAsync($"/api/v1/clients/{clientId}/number", new { number = "500", rowVersion = client.GetProperty("rowVersion").GetString() });
        var dup = await ProblemAsync(duplicate, HttpStatusCode.Conflict, "DUPLICATE_NUMBER");
        dup.GetProperty("errors").TryGetProperty("number", out _).ShouldBeTrue();
        dup.GetProperty("meta").GetProperty("existingId").GetInt32().ShouldBe(other.GetProperty("clientId").GetInt32());

        var changed = await OkAsync(await Admin()
            .PutAsJsonAsync($"/api/v1/clients/{clientId}/number", new { number = "344", rowVersion = client.GetProperty("rowVersion").GetString() }));
        changed.GetProperty("clientNumber").GetString().ShouldBe("00344");

        var reloaded = await OkAsync(await Admin().GetAsync($"/api/v1/matters/{matter.GetProperty("matterId").GetInt32()}"));
        reloaded.GetProperty("matterRef").GetString().ShouldBe("00344-00012");
        reloaded.GetProperty("clientNumber").GetString().ShouldBe("00344");

        var page = await OkAsync(await Admin().GetAsync($"/api/v1/audit/events?objectType=Client&objectId={clientId}&pageSize=100"));
        var numberEvent = page.GetProperty("items").EnumerateArray().Single(e => e.GetProperty("eventType").GetString() == "CLIENT_NUMBER_CHANGED");
        numberEvent.GetProperty("oldValue").GetString().ShouldBe("00343");
        numberEvent.GetProperty("newValue").GetString().ShouldBe("00344");
        numberEvent.GetProperty("actorUserId").ValueKind.ShouldBe(JsonValueKind.Number);
    }

    [Fact]
    public async Task Changing_a_matter_number_checks_uniqueness_within_the_client_and_is_audited()
    {
        var client = await CreateClientAsync("343");
        var clientId = client.GetProperty("clientId").GetInt32();
        var first = await CreateMatterAsync(clientId, "12");
        var second = await CreateMatterAsync(clientId, "13", "Second");
        var secondId = second.GetProperty("matterId").GetInt32();

        var dup = await Admin().PutAsJsonAsync($"/api/v1/matters/{secondId}/number", new { number = "12", rowVersion = second.GetProperty("rowVersion").GetString() });
        await ProblemAsync(dup, HttpStatusCode.Conflict, "DUPLICATE_NUMBER");

        var changed = await OkAsync(await Admin()
            .PutAsJsonAsync($"/api/v1/matters/{secondId}/number", new { number = "7", rowVersion = second.GetProperty("rowVersion").GetString() }));
        changed.GetProperty("matterNumber").GetString().ShouldBe("00007");
        changed.GetProperty("matterRef").GetString().ShouldBe("00343-00007");

        (await AuditEventTypesAsync("Matter", secondId)).ShouldContain("MATTER_NUMBER_CHANGED");
        first.GetProperty("matterRef").GetString().ShouldBe("00343-00012");
    }

    // ---- Audit of creates and edits

    [Fact]
    public async Task Creates_and_edits_are_audited_field_by_field()
    {
        var client = await CreateClientAsync("343");
        var clientId = client.GetProperty("clientId").GetInt32();
        await OkAsync(await Admin().PutAsJsonAsync($"/api/v1/clients/{clientId}", new { name = "Acme Corporation", isActive = true, rowVersion = client.GetProperty("rowVersion").GetString() }));
        var matter = await CreateMatterAsync(clientId, "12");
        var project = await CreateProjectAsync(matter.GetProperty("matterId").GetInt32(), "Custodians");

        var clientEvents = await OkAsync(await Admin().GetAsync($"/api/v1/audit/events?objectType=Client&objectId={clientId}&pageSize=100"));
        var items = clientEvents.GetProperty("items").EnumerateArray().ToList();
        items.Select(e => e.GetProperty("eventType").GetString()).ShouldContain("CLIENT_CREATED");
        var rename = items.Single(e => e.GetProperty("fieldKey").ValueKind == JsonValueKind.String && e.GetProperty("fieldKey").GetString() == "Name" && e.GetProperty("oldValue").ValueKind == JsonValueKind.String);
        rename.GetProperty("oldValue").GetString().ShouldBe("Acme Corp");
        rename.GetProperty("newValue").GetString().ShouldBe("Acme Corporation");

        (await AuditEventTypesAsync("Matter", matter.GetProperty("matterId").GetInt32())).ShouldContain("MATTER_CREATED");
        (await AuditEventTypesAsync("Project", project.GetProperty("projectId").GetInt32())).ShouldContain("PROJECT_CREATED");
    }

    // ---- Projects (SCN-005 data side)

    [Fact]
    public async Task Projects_are_flat_unique_per_matter_and_can_be_archived()
    {
        var client = await CreateClientAsync("343");
        var clientId = client.GetProperty("clientId").GetInt32();
        var m1 = await CreateMatterAsync(clientId, "12");
        var m2 = await CreateMatterAsync(clientId, "13", "Other");
        var m1Id = m1.GetProperty("matterId").GetInt32();
        var m2Id = m2.GetProperty("matterId").GetInt32();

        var project = await CreateProjectAsync(m1Id, "Custodian Processing", "Intake of custodian data");
        project.GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        project.GetProperty("description").GetString().ShouldBe("Intake of custodian data");
        project.GetProperty("isActive").GetBoolean().ShouldBeTrue();

        // Same name in a different Matter is fine; the same name (any case) in the same Matter is a duplicate.
        await CreateProjectAsync(m2Id, "Custodian Processing");
        var dup = await Admin().PostAsJsonAsync("/api/v1/projects", new { matterId = m1Id, name = "custodian processing" });
        var problem = await ProblemAsync(dup, HttpStatusCode.Conflict, "DUPLICATE_NAME");
        problem.GetProperty("errors").GetProperty("name")[0].GetProperty("message").GetString().ShouldBe("A project named 'custodian processing' already exists in this matter.");

        await ProblemAsync(
            await Admin().PostAsJsonAsync("/api/v1/projects", new { matterId = 9999, name = "Orphan" }),
            HttpStatusCode.BadRequest,
            "VALIDATION_FAILED");

        // Per-matter listing and the global list.
        var mine = await OkAsync(await Admin().GetAsync($"/api/v1/projects?matterId={m1Id}"));
        mine.GetProperty("total").GetInt32().ShouldBe(1);
        (await OkAsync(await Admin().GetAsync("/api/v1/projects"))).GetProperty("total").GetInt32().ShouldBe(2);
        (await OkAsync(await Admin().GetAsync("/api/v1/projects?q=00343-00013"))).GetProperty("total").GetInt32().ShouldBe(1);
        (await OkAsync(await Admin().GetAsync("/api/v1/matters?clientId=" + clientId))).GetProperty("items")[0].GetProperty("projectCount").GetInt32().ShouldBe(1);

        // Edit, rename collision, archive and restore.
        var id = project.GetProperty("projectId").GetInt32();
        var edited = await OkAsync(await Admin().PutAsJsonAsync($"/api/v1/projects/{id}", new { name = "Custodians", description = (string?)null, rowVersion = project.GetProperty("rowVersion").GetString() }));
        edited.GetProperty("name").GetString().ShouldBe("Custodians");
        edited.GetProperty("description").ValueKind.ShouldBe(JsonValueKind.Null);

        var archived = await OkAsync(await Admin().PostAsJsonAsync($"/api/v1/projects/{id}/active", new { isActive = false, rowVersion = edited.GetProperty("rowVersion").GetString() }));
        archived.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        (await OkAsync(await Admin().GetAsync($"/api/v1/projects?matterId={m1Id}&isActive=false"))).GetProperty("total").GetInt32().ShouldBe(1);
        (await OkAsync(await Admin().GetAsync($"/api/v1/projects?matterId={m1Id}&isActive=true"))).GetProperty("total").GetInt32().ShouldBe(0);

        await using var scope = _factory.Services.CreateAsyncScope();
        var projects = scope.ServiceProvider.GetRequiredService<IProjectDirectory>();
        var summary = await projects.FindAsync(id);
        summary!.MatterId.ShouldBe(m1Id);
        summary.IsActive.ShouldBeFalse();

        var restored = await OkAsync(await Admin().PostAsJsonAsync($"/api/v1/projects/{id}/active", new { isActive = true, rowVersion = archived.GetProperty("rowVersion").GetString() }));
        restored.GetProperty("isActive").GetBoolean().ShouldBeTrue();
    }

    // ---- Schema guarantees

    [Fact]
    public async Task Database_enforces_the_composite_keys_so_task_rows_can_pin_project_to_matter()
    {
        var client = await CreateClientAsync("343");
        var other = await CreateClientAsync("500", "Other Co");
        var matter = await CreateMatterAsync(client.GetProperty("clientId").GetInt32(), "12");

        // A Matter row whose denormalized ClientNumber disagrees with its Client is rejected by the composite FK.
        var mismatch = await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(
            _connectionString,
            $"INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES ({other.GetProperty("clientId").GetInt32()}, '00343', '00001', 'x')"));
        mismatch.Message.ShouldContain("FK_Matter_Client");

        // Non-digit and all-zero numbers are rejected by CHECK constraints even when bypassing the API.
        (await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(
            _connectionString, "INSERT dbo.Client (ClientNumber, Name) VALUES ('00A43', 'x')"))).Message.ShouldContain("CK_Client_Number");
        (await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(
            _connectionString, "INSERT dbo.Client (ClientNumber, Name) VALUES ('00000', 'x')"))).Message.ShouldContain("CK_Client_Number");

        // The unique (ProjectId, MatterId) pair exists as the target for Task composite foreign keys.
        var count = await _factory.WithDbAsync(async db =>
            await db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM sys.indexes WHERE name = 'UQ_Project_IdMatter' AND is_unique_constraint = 1").SingleAsync());
        count.ShouldBe(1);
        matter.GetProperty("matterId").GetInt32().ShouldBeGreaterThan(0);
    }

    // ---- Paging, sorting, unknown filters

    [Fact]
    public async Task Lists_page_sort_and_reject_unknown_filters()
    {
        foreach (var number in new[] { "3", "1", "2" })
            await CreateClientAsync(number, "Client " + number);

        var page1 = await OkAsync(await Admin().GetAsync("/api/v1/clients?pageSize=2"));
        page1.GetProperty("total").GetInt32().ShouldBe(3);
        page1.GetProperty("page").GetInt32().ShouldBe(1);
        page1.GetProperty("pageSize").GetInt32().ShouldBe(2);
        page1.GetProperty("items").EnumerateArray().Select(c => c.GetProperty("clientNumber").GetString()).ShouldBe(["00001", "00002"]);

        var page2 = await OkAsync(await Admin().GetAsync("/api/v1/clients?pageSize=2&page=2&sort=-clientNumber"));
        page2.GetProperty("items").EnumerateArray().Select(c => c.GetProperty("clientNumber").GetString()).ShouldBe(["00001"]);

        await ProblemAsync(await Admin().GetAsync("/api/v1/clients?sort=bogus"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await Admin().GetAsync("/api/v1/clients?colour=red"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await Admin().GetAsync("/api/v1/clients?pageSize=1000"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await Admin().GetAsync("/api/v1/matters?nope=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await Admin().GetAsync("/api/v1/projects?nope=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    // ---- Permissions

    [Fact]
    public async Task Endpoints_are_permission_gated()
    {
        var client = await CreateClientAsync("343");
        var clientId = client.GetProperty("clientId").GetInt32();
        var matter = await CreateMatterAsync(clientId, "12");
        var matterId = matter.GetProperty("matterId").GetInt32();

        var roleId = await _factory.CreateRoleAsync("Viewer", Permissions.Client.View, Permissions.Matter.View, Permissions.Project.View);
        await As(@"KE\viewer").GetAsync("/api/v1/me");
        await _factory.GrantRoleAsync(@"KE\viewer", roleId);
        var viewer = As(@"KE\viewer");

        (await viewer.GetAsync("/api/v1/clients")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync($"/api/v1/matters/{matterId}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync("/api/v1/projects")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var attempts = new (HttpMethod Method, string Path, object Body, string Permission)[]
        {
            (HttpMethod.Post, "/api/v1/clients", new { clientNumber = "9", name = "N" }, Permissions.Client.Create),
            (HttpMethod.Put, $"/api/v1/clients/{clientId}", new { name = "N", isActive = true, rowVersion = "AA==" }, Permissions.Client.Edit),
            (HttpMethod.Put, $"/api/v1/clients/{clientId}/number", new { number = "9", rowVersion = "AA==" }, Permissions.Client.EditNumber),
            (HttpMethod.Post, "/api/v1/matters", new { clientId, matterNumber = "9", name = "N" }, Permissions.Matter.Create),
            (HttpMethod.Put, $"/api/v1/matters/{matterId}", new { name = "N", isSensitive = false, rowVersion = "AA==" }, Permissions.Matter.Edit),
            (HttpMethod.Put, $"/api/v1/matters/{matterId}/number", new { number = "9", rowVersion = "AA==" }, Permissions.Matter.EditNumber),
            (HttpMethod.Put, $"/api/v1/matters/{matterId}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = (int?)null, rowVersion = "AA==" }, Permissions.Matter.AssignManagers),
            (HttpMethod.Post, $"/api/v1/matters/{matterId}/active", new { isActive = false, rowVersion = "AA==" }, Permissions.Matter.SetActive),
            (HttpMethod.Post, "/api/v1/projects", new { matterId, name = "N" }, Permissions.Project.Create),
            (HttpMethod.Put, "/api/v1/projects/1", new { name = "N", rowVersion = "AA==" }, Permissions.Project.Edit),
            (HttpMethod.Post, "/api/v1/projects/1/active", new { isActive = false, rowVersion = "AA==" }, Permissions.Project.Archive),
        };
        foreach (var (method, path, body, permission) in attempts)
        {
            using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
            var problem = await ProblemAsync(await viewer.SendAsync(request), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
            problem.GetProperty("meta").GetProperty("permission").GetString().ShouldBe(permission, $"{method} {path}");
        }

        // A user without any Organization permission cannot even list.
        await As(@"KE\nobody").GetAsync("/api/v1/me");
        var noRole = await _factory.CreateRoleAsync("Tasks only", Permissions.Task.View);
        await _factory.GrantRoleAsync(@"KE\nobody", noRole);
        await ProblemAsync(await As(@"KE\nobody").GetAsync("/api/v1/clients"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await As(@"KE\nobody").GetAsync("/api/v1/matters/lookup?ref=343-12"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }
}

internal static class OrganizationTestExtensions
{
    public static Task<int> CountClientsAsync(this DatabaseApiFactory factory) =>
        factory.WithDbAsync(async db =>
            await db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM dbo.Client").SingleAsync());
}
