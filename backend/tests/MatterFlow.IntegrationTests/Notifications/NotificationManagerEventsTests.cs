using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.Notifications.Domain;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Notifications;

/// <summary>
/// WP-NT2 manager events against a real SQL Server: 5 a task was created on your matter (#738) and 7 you were set as a matter's Primary or Secondary
/// manager (#739). Same transaction as the action, never for the actor, once per person, honouring the switches and the permission re-check on read.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class NotificationManagerEventsTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private HttpClient _bo = null!;
    private HttpClient _cy = null!;
    private int _boId;
    private int _cyId;
    private int _annId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        string[] manager = [.. AllTaskPermissions, "Matter.View", "Matter.BeManager", "Matter.AssignManagers"];
        _bo = await _h.UserWithAsync(@"KE\bo", manager);
        _cy = await _h.UserWithAsync(@"KE\cy", manager);
        await _h.UserWithAsync(@"KE\ann", AllTaskPermissions);
        _boId = await _h.UserIdAsync(@"KE\bo");
        _cyId = await _h.UserIdAsync(@"KE\cy");
        _annId = await _h.UserIdAsync(@"KE\ann");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private Task<List<Notification>> RowsAsync(int? recipient = null, string? type = null) =>
        _factory.WithDbAsync(db => db.Set<Notification>().AsNoTracking()
            .Where(n => (recipient == null || n.RecipientUserId == recipient) && (type == null || n.EventType == type))
            .OrderBy(n => n.Id).ToListAsync());

    private async Task SetManagersAsync(int? primary, int? secondary, HttpClient? client = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var matter = await OkAsync(await _h.Admin.GetAsync($"/api/v1/matters/{_w.MatterId}"));
        await OkAsync(
            await (client ?? _h.Admin).PutAsJsonAsync($"/api/v1/matters/{_w.MatterId}/managers", new { primaryManagerId = primary, secondaryManagerId = secondary, rowVersion = matter.GetProperty("rowVersion").GetString() }),
            expected);
    }

    private async Task<JsonElement> CreateAsync(Dictionary<string, object?>? extra = null, HttpClient? client = null, string? title = null) =>
        await OkAsync(await (client ?? _h.Admin).PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, title: title, extra: extra)), HttpStatusCode.Created);

    // ---- event 5: a task was created on your matter

    [Fact]
    public async Task Event5_both_managers_get_one_row_each_with_the_readme_wording()
    {
        await SetManagersAsync(_boId, _cyId);

        var task = await CreateAsync(title: "Load production volume 3");

        var rows = await RowsAsync(type: "MatterTaskCreated");
        rows.Select(r => r.RecipientUserId).ShouldBe([_boId, _cyId], ignoreOrder: true);
        rows.ShouldAllBe(r => r.ObjectKind == "Task" && r.ObjectId == TaskId(task) && r.MatterId == _w.MatterId);
        rows.ShouldAllBe(r => r.DedupeKey == $"created:{TaskId(task)}");
        var number = task.GetProperty("taskNumber").GetString();
        rows[0].Message.ShouldEndWith($" created {number} \"Load production volume 3\" on Merger Review 12.");
        rows[0].ActorUserId.ShouldNotBeNull();

        // The managers see it through the API.
        (await OkAsync(await _bo.GetAsync("/api/v1/me/notifications"))).GetProperty("totalCount").GetInt32().ShouldBeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task Event5_the_creator_is_never_told_and_a_matter_without_managers_creates_none()
    {
        var none = await CreateAsync();
        (await RowsAsync(type: "MatterTaskCreated")).ShouldBeEmpty();

        await SetManagersAsync(_boId, null);
        await CreateAsync(client: _bo);
        (await RowsAsync(_boId, "MatterTaskCreated")).ShouldBeEmpty(); // bo made it
        none.GetProperty("taskId").GetInt64().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Event5_a_manager_who_is_also_the_new_assignee_gets_only_the_assignment_event()
    {
        await SetManagersAsync(_boId, _cyId);

        await CreateAsync(new() { ["assignedUserId"] = _boId });

        (await RowsAsync(_boId)).Where(r => r.EventType != "MatterManagerSet").Select(r => r.EventType).ShouldBe(["TaskAssigned"]);
        (await RowsAsync(_cyId, "MatterTaskCreated")).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task Event5_a_switch_that_is_off_creates_no_row_and_a_rolled_back_create_creates_none()
    {
        await SetManagersAsync(_boId, _cyId);
        (await _bo.PutAsJsonAsync("/api/v1/me/notification-preferences", new { items = new[] { new { eventType = "MatterTaskCreated", enabled = false } } })).EnsureSuccessStatusCode();

        await CreateAsync();
        (await RowsAsync(_boId, "MatterTaskCreated")).ShouldBeEmpty();
        (await RowsAsync(_cyId, "MatterTaskCreated")).ShouldHaveSingleItem();

        // A create that fails validation leaves nothing behind.
        var before = (await RowsAsync(type: "MatterTaskCreated")).Count;
        var bad = _h.NewTask(_w, extra: new() { ["title"] = "" });
        (await _h.Admin.PostAsJsonAsync("/api/v1/tasks", bad)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await RowsAsync(type: "MatterTaskCreated")).Count.ShouldBe(before);
    }

    // ---- event 7: you were set as a matter's manager

    [Fact]
    public async Task Event7_the_newly_set_person_is_told_with_the_readme_wording_and_links_to_the_matter()
    {
        await SetManagersAsync(_boId, _cyId);

        var bo = (await RowsAsync(_boId, "MatterManagerSet")).ShouldHaveSingleItem();
        bo.ObjectKind.ShouldBe("Matter");
        bo.ObjectId.ShouldBe(_w.MatterId);
        bo.MatterId.ShouldBe(_w.MatterId);
        bo.DedupeKey.ShouldStartWith($"mgr:{_w.MatterId}:Primary:");
        bo.Message.ShouldEndWith(" made you Primary manager of Merger Review 12.");
        var cy = (await RowsAsync(_cyId, "MatterManagerSet")).ShouldHaveSingleItem();
        cy.DedupeKey.ShouldStartWith($"mgr:{_w.MatterId}:Secondary:");
        cy.Message.ShouldEndWith(" made you Secondary manager of Merger Review 12.");

        // Matter.View is held, so the recipient sees it; ann has no Matter.View and the actor was not told.
        var list = await OkAsync(await _bo.GetAsync("/api/v1/me/notifications"));
        list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("objectKind").GetString()).ShouldContain("Matter");
        (await RowsAsync(DatabaseActorId())).ShouldBeEmpty();
    }

    private int DatabaseActorId() => _factory.WithDbAsync(db => db.Database.SqlQuery<int>($"SELECT UserId AS Value FROM dbo.UserIdentity WHERE Username = {DatabaseApiFactory.AdminAccount}").SingleAsync()).GetAwaiter().GetResult();

    [Fact]
    public async Task Event7_unchanged_managers_and_a_person_setting_themselves_create_none_and_a_change_notifies_only_the_new_person()
    {
        await SetManagersAsync(_boId, null);
        (await RowsAsync(type: "MatterManagerSet")).Count.ShouldBe(1);

        await SetManagersAsync(_boId, null); // nothing changed
        (await RowsAsync(type: "MatterManagerSet")).Count.ShouldBe(1);

        await SetManagersAsync(_boId, _cyId, client: _cy); // cy sets themselves as Secondary: the actor is not told
        (await RowsAsync(_cyId, "MatterManagerSet")).ShouldBeEmpty();
        (await RowsAsync(_boId, "MatterManagerSet")).Count.ShouldBe(1); // bo stays Primary: not told again

        await SetManagersAsync(_cyId, _boId); // swapped: both hold a place they did not hold
        (await RowsAsync(_cyId, "MatterManagerSet")).ShouldHaveSingleItem().Message.ShouldContain("Primary manager");
        (await RowsAsync(_boId, "MatterManagerSet")).Count.ShouldBe(2);
    }

    [Fact]
    public async Task Event7_a_matter_created_with_managers_notifies_them_in_the_same_transaction()
    {
        var client = (await OkAsync(await _h.Admin.GetAsync("/api/v1/clients?q=343"))).GetProperty("items")[0].GetProperty("clientId").GetInt32();
        var created = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/matters", new { clientId = client, matterNumber = "77", name = "Fresh Matter", primaryManagerId = _boId, secondaryManagerId = _cyId }),
            HttpStatusCode.Created);
        var matterId = created.GetProperty("matterId").GetInt32();

        var rows = await RowsAsync(type: "MatterManagerSet");
        rows.ShouldAllBe(r => r.ObjectId == matterId);
        rows.Select(r => r.RecipientUserId).ShouldBe([_boId, _cyId], ignoreOrder: true);
        rows.Single(r => r.RecipientUserId == _boId).Message.ShouldEndWith(" made you Primary manager of Fresh Matter.");
    }

    [Fact]
    public async Task Event7_a_person_without_Matter_View_gets_a_row_but_never_sees_it_and_a_switch_off_creates_none()
    {
        // The manager role in this test holds BeManager but not Matter.View.
        var noView = await _h.UserWithAsync(@"KE\dee", "Task.View", "Matter.BeManager");
        var deeId = await _h.UserIdAsync(@"KE\dee");
        await SetManagersAsync(deeId, null);

        (await RowsAsync(deeId, "MatterManagerSet")).ShouldHaveSingleItem();
        var seen = await OkAsync(await noView.GetAsync("/api/v1/me/notifications"));
        seen.GetProperty("totalCount").GetInt32().ShouldBe(0);

        (await _cy.PutAsJsonAsync("/api/v1/me/notification-preferences", new { items = new[] { new { eventType = "MatterManagerSet", enabled = false } } })).EnsureSuccessStatusCode();
        await SetManagersAsync(deeId, _cyId);
        (await RowsAsync(_cyId, "MatterManagerSet")).ShouldBeEmpty();
        _annId.ShouldBeGreaterThan(0);
    }
}
