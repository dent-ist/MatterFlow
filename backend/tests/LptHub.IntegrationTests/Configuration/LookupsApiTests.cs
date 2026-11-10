using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Configuration;

/// <summary>
/// Priorities, status labels and asset link roles (tickets #33 and #36) against a real SQL Server through the full HTTP pipeline:
/// seeds, permissions, the exactly-one-default invariant, the fixed status codes, in-use protection and audit events.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class LookupsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        _connectionString = await sql.CreateDatabaseAsync();
        _factory = new DatabaseApiFactory(_connectionString);
        _ = _factory.Services; // starts the host: schema scripts and seeds have run before any test touches the database directly
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static HttpClient Client(DatabaseApiFactory factory, string user)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private HttpClient Admin() => Client(_factory, DatabaseApiFactory.AdminAccount);

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<JsonElement[]> PrioritiesAsync(HttpClient? client = null) =>
        (await JsonAsync(await (client ?? Admin()).GetAsync("/api/v1/priorities"))).EnumerateArray().ToArray();

    private static string Code(JsonElement problem) => problem.GetProperty("code").GetString()!;

    private static int Id(JsonElement element) => element.GetProperty("id").GetInt32();

    private async Task<HttpClient> UserWithAsync(string user, params string[] permissions)
    {
        var client = Client(_factory, user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK); // JIT-provisions the user
        var roleId = await _factory.CreateRoleAsync("Role " + user, permissions);
        await _factory.GrantRoleAsync(user, roleId);
        return client;
    }

    // ---- seeds

    [Fact]
    public async Task Startup_seed_creates_the_default_lookups_with_Normal_as_the_single_default()
    {
        var priorities = await PrioritiesAsync();
        priorities.Select(p => p.GetProperty("label").GetString()).ShouldBe(["Critical", "High", "Normal", "Low"]);
        priorities.Select(p => p.GetProperty("sortOrder").GetInt32()).ShouldBe([1, 2, 3, 4]);
        priorities.Where(p => p.GetProperty("isDefault").GetBoolean()).Select(p => p.GetProperty("label").GetString()).ShouldBe(["Normal"]);
        priorities.ShouldAllBe(p => p.GetProperty("isActive").GetBoolean());

        var labels = (await JsonAsync(await Admin().GetAsync("/api/v1/status-labels"))).EnumerateArray().ToArray();
        labels.Select(l => l.GetProperty("code").GetString()).ShouldBe(TaskStatusCodes.All);
        labels.Select(l => l.GetProperty("displayLabel").GetString()).ShouldBe(["New", "In Progress", "On Hold", "Completed", "Cancelled"]);

        var roles = (await JsonAsync(await Admin().GetAsync("/api/v1/asset-link-roles"))).EnumerateArray().ToArray();
        roles.Select(r => r.GetProperty("name").GetString()).ShouldBe(["Source", "Destination", "Subject", "Result"]);
    }

    [Fact]
    public async Task Seeding_again_changes_nothing_and_never_overwrites_admin_edits()
    {
        var admin = Admin();
        var critical = (await PrioritiesAsync(admin)).First();
        var renamed = await admin.PutAsJsonAsync($"/api/v1/priorities/{Id(critical)}", new
        {
            label = "Urgent",
            color = "critical",
            isActive = true,
            rowVersion = critical.GetProperty("rowVersion").GetString(),
        });
        renamed.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using (var scope = _factory.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<ConfigurationSeeder>().SeedAsync();

        (await PrioritiesAsync(admin)).Select(p => p.GetProperty("label").GetString()).ShouldBe(["Urgent", "High", "Normal", "Low"]);
        (await _factory.CountAsync<AssetLinkRole>()).ShouldBe(4);
        (await _factory.CountAsync<TaskStatusLabel>()).ShouldBe(5);
    }

    // ---- permissions

    [Fact]
    public async Task Lookups_are_readable_with_Task_View_but_managing_needs_the_manage_permission()
    {
        var viewer = await UserWithAsync(@"KE\viewer", Permissions.Task.View);

        (await viewer.GetAsync("/api/v1/priorities")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync("/api/v1/status-labels")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync("/api/v1/asset-link-roles")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var create = await viewer.PostAsJsonAsync("/api/v1/priorities", new { label = "Urgent", color = "high" });
        create.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        Code(await JsonAsync(create)).ShouldBe("PERMISSION_DENIED");
        (await viewer.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = "Related" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewer.PutAsJsonAsync("/api/v1/status-labels/NEW", new { displayLabel = "Fresh", rowVersion = "AAAAAAAAAAA=" })).StatusCode
            .ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Each_catalog_is_managed_by_its_own_permission()
    {
        var priorityManager = await UserWithAsync(@"KE\pm", Permissions.Priority.Manage);
        (await priorityManager.PostAsJsonAsync("/api/v1/priorities", new { label = "Urgent", color = "high" })).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await priorityManager.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = "Related" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var linkManager = await UserWithAsync(@"KE\lm", Permissions.AssetType.Manage);
        (await linkManager.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = "Related" })).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await linkManager.PostAsJsonAsync("/api/v1/priorities", new { label = "Other", color = "low" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var labelManager = await UserWithAsync(@"KE\sm", Permissions.StatusLabel.Manage);
        var label = (await JsonAsync(await Admin().GetAsync("/api/v1/status-labels"))).EnumerateArray().First();
        (await labelManager.PutAsJsonAsync("/api/v1/status-labels/NEW", new { displayLabel = "Fresh", rowVersion = label.GetProperty("rowVersion").GetString() }))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    // ---- priorities

    [Fact]
    public async Task Create_appends_least_urgent_and_never_default_and_rejects_bad_input()
    {
        var admin = Admin();
        var created = await admin.PostAsJsonAsync("/api/v1/priorities", new { label = "  Whenever  ", color = "#336699" });
        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        created.Headers.Location.ShouldNotBeNull();
        var body = await JsonAsync(created);
        body.GetProperty("label").GetString().ShouldBe("Whenever");
        body.GetProperty("sortOrder").GetInt32().ShouldBe(5);
        body.GetProperty("isDefault").GetBoolean().ShouldBeFalse();

        var duplicate = await admin.PostAsJsonAsync("/api/v1/priorities", new { label = "whenever", color = "low" });
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(duplicate)).ShouldBe("DUPLICATE_NAME");

        var blank = await admin.PostAsJsonAsync("/api/v1/priorities", new { label = "   ", color = "low" });
        blank.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        Code(await JsonAsync(blank)).ShouldBe("VALIDATION_FAILED");

        var badColor = await admin.PostAsJsonAsync("/api/v1/priorities", new { label = "Odd", color = "chartreuse" });
        badColor.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Setting_a_default_moves_the_flag_and_there_is_always_exactly_one()
    {
        var admin = Admin();
        var high = (await PrioritiesAsync(admin)).Single(p => p.GetProperty("label").GetString() == "High");

        var response = await admin.PostAsync($"/api/v1/priorities/{Id(high)}/default", null);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var list = (await JsonAsync(response)).EnumerateArray().ToArray();
        list.Where(p => p.GetProperty("isDefault").GetBoolean()).Select(p => p.GetProperty("label").GetString()).ShouldBe(["High"]);
        (await _factory.WithDbAsync(db => db.Set<Priority>().CountAsync(p => p.IsDefault))).ShouldBe(1);
    }

    [Fact]
    public async Task The_default_cannot_be_deactivated_or_deleted_and_an_inactive_priority_cannot_become_default()
    {
        var admin = Admin();
        var normal = (await PrioritiesAsync(admin)).Single(p => p.GetProperty("isDefault").GetBoolean());
        var low = (await PrioritiesAsync(admin)).Single(p => p.GetProperty("label").GetString() == "Low");

        var deactivate = await admin.PutAsJsonAsync($"/api/v1/priorities/{Id(normal)}", new
        {
            label = "Normal",
            color = "normal",
            isActive = false,
            rowVersion = normal.GetProperty("rowVersion").GetString(),
        });
        deactivate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(deactivate)).ShouldBe("DEFAULT_REQUIRED");

        var delete = await admin.DeleteAsync($"/api/v1/priorities/{Id(normal)}");
        delete.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(delete)).ShouldBe("DEFAULT_REQUIRED");

        (await admin.PutAsJsonAsync($"/api/v1/priorities/{Id(low)}", new
        {
            label = "Low",
            color = "low",
            isActive = false,
            rowVersion = low.GetProperty("rowVersion").GetString(),
        })).StatusCode.ShouldBe(HttpStatusCode.OK);
        var makeDefault = await admin.PostAsync($"/api/v1/priorities/{Id(low)}/default", null);
        makeDefault.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(makeDefault)).ShouldBe("DEFAULT_REQUIRED");
    }

    [Fact]
    public async Task The_database_itself_refuses_a_second_default_priority()
    {
        var ex = await Should.ThrowAsync<SqlException>(() =>
            SqlServerFixture.ExecuteAsync(_connectionString, "UPDATE dbo.Priority SET IsDefault = 1 WHERE Label = 'High';"));

        ex.Message.ShouldContain("UQ_Priority_Default");
    }

    [Fact]
    public async Task Reorder_assigns_positions_and_requires_every_priority_exactly_once()
    {
        var admin = Admin();
        var ids = (await PrioritiesAsync(admin)).Select(Id).ToArray();
        var reversed = ids.Reverse().ToArray();

        var response = await admin.PutAsJsonAsync("/api/v1/priorities/order", new { ids = reversed });

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(response)).EnumerateArray().Select(Id).ShouldBe(reversed);
        (await PrioritiesAsync(admin)).Select(p => p.GetProperty("sortOrder").GetInt32()).ShouldBe([1, 2, 3, 4]);

        var partial = await admin.PutAsJsonAsync("/api/v1/priorities/order", new { ids = ids.Take(2) });
        partial.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var repeated = await admin.PutAsJsonAsync("/api/v1/priorities/order", new { ids = new[] { ids[0], ids[0], ids[1], ids[2] } });
        repeated.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_stale_row_version_is_a_concurrency_conflict()
    {
        var admin = Admin();
        var high = (await PrioritiesAsync(admin)).Single(p => p.GetProperty("label").GetString() == "High");
        var stale = high.GetProperty("rowVersion").GetString();
        (await admin.PutAsJsonAsync($"/api/v1/priorities/{Id(high)}", new { label = "High+", color = "high", isActive = true, rowVersion = stale }))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        var second = await admin.PutAsJsonAsync($"/api/v1/priorities/{Id(high)}", new { label = "High++", color = "high", isActive = true, rowVersion = stale });

        second.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(second)).ShouldBe("CONCURRENCY_CONFLICT");
    }

    [Fact]
    public async Task An_unused_priority_can_be_deleted()
    {
        var admin = Admin();
        var low = (await PrioritiesAsync(admin)).Single(p => p.GetProperty("label").GetString() == "Low");

        (await admin.DeleteAsync($"/api/v1/priorities/{Id(low)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await PrioritiesAsync(admin)).Length.ShouldBe(3);
        (await admin.DeleteAsync($"/api/v1/priorities/{Id(low)}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_priority_a_task_references_cannot_be_deleted_only_deactivated()
    {
        // Stands in for Task.PriorityId (the Task table arrives later): a real foreign key to Priority.
        await SqlServerFixture.ExecuteAsync(
            _connectionString,
            "CREATE TABLE dbo.PriorityReference (Id INT IDENTITY PRIMARY KEY, PriorityId INT NOT NULL CONSTRAINT FK_PriorityReference FOREIGN KEY REFERENCES dbo.Priority (PriorityId));"
            + " INSERT INTO dbo.PriorityReference (PriorityId) SELECT PriorityId FROM dbo.Priority WHERE Label = 'Low';");
        var admin = Admin();
        var low = (await PrioritiesAsync(admin)).Single(p => p.GetProperty("label").GetString() == "Low");

        var delete = await admin.DeleteAsync($"/api/v1/priorities/{Id(low)}");

        delete.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(delete)).ShouldBe("IN_USE");

        var deactivate = await admin.PutAsJsonAsync($"/api/v1/priorities/{Id(low)}", new
        {
            label = "Low",
            color = "low",
            isActive = false,
            rowVersion = low.GetProperty("rowVersion").GetString(),
        });
        deactivate.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await PrioritiesAsync(admin)).Single(p => Id(p) == Id(low)).GetProperty("isActive").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Usage_probes_from_other_modules_block_deletion_before_the_database_is_touched()
    {
        await using var factory = _factory.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.AddScoped<IPriorityUsage, AlwaysInUse>();
            s.AddScoped<IAssetLinkRoleUsage, AlwaysInUse>();
        }));
        var admin = Client(_factory, DatabaseApiFactory.AdminAccount);
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        var low = (await PrioritiesAsync(admin)).Single(p => p.GetProperty("label").GetString() == "Low");
        var source = (await JsonAsync(await admin.GetAsync("/api/v1/asset-link-roles"))).EnumerateArray().First();

        var priority = await client.DeleteAsync($"/api/v1/priorities/{Id(low)}");
        var role = await client.DeleteAsync($"/api/v1/asset-link-roles/{Id(source)}");

        priority.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(priority)).ShouldBe("IN_USE");
        role.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(role)).ShouldBe("IN_USE");
    }

    private sealed class AlwaysInUse : IPriorityUsage, IAssetLinkRoleUsage
    {
        public Task<bool> IsInUseAsync(int id, CancellationToken cancellationToken = default) => Task.FromResult(true);
    }

    // ---- catalogs for other modules

    [Fact]
    public async Task Contract_catalogs_expose_labels_default_and_assignability()
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var priorities = scope.ServiceProvider.GetRequiredService<IPriorityCatalog>();
        var statuses = scope.ServiceProvider.GetRequiredService<IStatusLabelCatalog>();
        var roles = scope.ServiceProvider.GetRequiredService<IAssetLinkRoleCatalog>();

        (await priorities.GetDefaultAsync()).Label.ShouldBe("Normal");
        (await priorities.ListAsync(includeInactive: false)).Select(p => p.Label).ShouldBe(["Critical", "High", "Normal", "Low"]);
        (await priorities.IsAssignableAsync(0)).ShouldBeFalse();
        (await statuses.GetLabelAsync(TaskStatusCodes.OnHold)).ShouldBe("On Hold");
        (await statuses.GetLabelAsync("SOMETHING_ELSE")).ShouldBe("SOMETHING_ELSE");
        (await statuses.ListAsync()).Count.ShouldBe(5);
        (await roles.ListAsync(includeInactive: false)).Select(r => r.Name).ShouldContain("Subject");
    }

    // ---- status labels

    [Fact]
    public async Task A_status_label_can_be_renamed_and_the_code_is_untouched()
    {
        var admin = Admin();
        var hold = (await JsonAsync(await admin.GetAsync("/api/v1/status-labels"))).EnumerateArray().Single(l => l.GetProperty("code").GetString() == "ON_HOLD");

        var response = await admin.PutAsJsonAsync("/api/v1/status-labels/ON_HOLD", new { displayLabel = "Waiting", rowVersion = hold.GetProperty("rowVersion").GetString() });

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await JsonAsync(response);
        body.GetProperty("code").GetString().ShouldBe("ON_HOLD");
        body.GetProperty("displayLabel").GetString().ShouldBe("Waiting");
    }

    [Fact]
    public async Task Status_codes_cannot_be_created_changed_or_deleted()
    {
        var admin = Admin();
        var label = (await JsonAsync(await admin.GetAsync("/api/v1/status-labels"))).EnumerateArray().First();

        // API: no create/delete; unknown codes are 404; a path code never changes.
        (await admin.PostAsJsonAsync("/api/v1/status-labels", new { code = "ARCHIVED", displayLabel = "Archived" })).StatusCode
            .ShouldBe(HttpStatusCode.MethodNotAllowed);
        (await admin.DeleteAsync("/api/v1/status-labels/NEW")).StatusCode.ShouldBe(HttpStatusCode.MethodNotAllowed);
        var unknown = await admin.PutAsJsonAsync("/api/v1/status-labels/ARCHIVED", new { displayLabel = "Archived", rowVersion = label.GetProperty("rowVersion").GetString() });
        unknown.StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // Database: the trigger and check constraint hold even for a sysadmin login.
        (await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(_connectionString, "INSERT INTO dbo.TaskStatusLabel (StatusCode, DisplayLabel, SortOrder) VALUES ('NEW2', 'x', 9);")))
            .ShouldNotBeNull();
        (await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(_connectionString, "DELETE FROM dbo.TaskStatusLabel WHERE StatusCode = 'NEW';")))
            .Message.ShouldContain("cannot be deleted");
        (await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(_connectionString, "UPDATE dbo.TaskStatusLabel SET StatusCode = 'ON_HOLD' WHERE StatusCode = 'NEW';")))
            .ShouldNotBeNull();
        (await _factory.CountAsync<TaskStatusLabel>()).ShouldBe(5);
        await SqlServerFixture.ExecuteAsync(_connectionString, "UPDATE dbo.TaskStatusLabel SET DisplayLabel = N'Brand new' WHERE StatusCode = 'NEW';"); // labels stay editable
    }

    [Fact]
    public async Task Two_statuses_cannot_share_a_label()
    {
        var admin = Admin();
        var labels = (await JsonAsync(await admin.GetAsync("/api/v1/status-labels"))).EnumerateArray().ToArray();

        var response = await admin.PutAsJsonAsync("/api/v1/status-labels/NEW", new { displayLabel = "completed", rowVersion = labels[0].GetProperty("rowVersion").GetString() });

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        Code(await JsonAsync(response)).ShouldBe("DUPLICATE_NAME");
    }

    // ---- asset link roles

    [Fact]
    public async Task Link_roles_can_be_added_renamed_deactivated_reordered_and_deleted()
    {
        var admin = Admin();
        var created = await JsonAsync(await admin.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = "Related" }));
        created.GetProperty("sortOrder").GetInt32().ShouldBe(5);

        var renamed = await admin.PutAsJsonAsync($"/api/v1/asset-link-roles/{Id(created)}", new { name = "Reference", isActive = false, rowVersion = created.GetProperty("rowVersion").GetString() });
        renamed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await JsonAsync(renamed)).GetProperty("isActive").GetBoolean().ShouldBeFalse();

        var duplicate = await admin.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = "source" });
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);

        var ids = (await JsonAsync(await admin.GetAsync("/api/v1/asset-link-roles"))).EnumerateArray().Select(Id).Reverse().ToArray();
        var reordered = await admin.PutAsJsonAsync("/api/v1/asset-link-roles/order", new { ids });
        (await JsonAsync(reordered)).EnumerateArray().Select(Id).ShouldBe(ids);

        (await admin.DeleteAsync($"/api/v1/asset-link-roles/{Id(created)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    // ---- audit

    [Fact]
    public async Task Configuration_changes_are_audited_with_the_actor()
    {
        var admin = Admin();
        var high = (await PrioritiesAsync(admin)).Single(p => p.GetProperty("label").GetString() == "High");
        await admin.PutAsJsonAsync($"/api/v1/priorities/{Id(high)}", new { label = "Elevated", color = "high", isActive = true, rowVersion = high.GetProperty("rowVersion").GetString() });
        await admin.PostAsync($"/api/v1/priorities/{Id(high)}/default", null);
        var hold = (await JsonAsync(await admin.GetAsync("/api/v1/status-labels"))).EnumerateArray().Single(l => l.GetProperty("code").GetString() == "ON_HOLD");
        await admin.PutAsJsonAsync("/api/v1/status-labels/ON_HOLD", new { displayLabel = "Waiting", rowVersion = hold.GetProperty("rowVersion").GetString() });
        var created = await JsonAsync(await admin.PostAsJsonAsync("/api/v1/asset-link-roles", new { name = "Related" }));

        var events = await _factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking().OrderBy(e => e.Id).ToListAsync());

        var rename = events.Single(e => e.ObjectType == "Priority" && e.ObjectId == Id(high).ToString() && e.FieldKey == "Label" && e.NewValue == "Elevated");
        rename.EventType.ShouldBe("FIELD_CHANGED");
        rename.OldValue.ShouldBe("High");
        rename.ActorUserId.ShouldNotBeNull();

        var defaultChange = events.Single(e => e.EventType == "PRIORITY_DEFAULT_CHANGED");
        defaultChange.OldValue.ShouldBe("Normal");
        defaultChange.NewValue.ShouldBe("Elevated");
        defaultChange.ObjectId.ShouldBe(Id(high).ToString());
        defaultChange.ActorUserId.ShouldNotBeNull();

        var status = events.Single(e => e.ObjectType == "StatusLabel" && e.ObjectId == "ON_HOLD");
        status.FieldKey.ShouldBe("DisplayLabel");
        status.OldValue.ShouldBe("On Hold");
        status.NewValue.ShouldBe("Waiting");

        events.Where(e => e.ObjectType == "AssetLinkRole" && e.ObjectId == Id(created).ToString() && e.FieldKey == "Name")
            .Select(e => e.NewValue).ShouldBe(["Related"]);
    }
}
