using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>PM v2 #876: the admin-managed on-hold reasons, the reason on the status change, the switch Tasks:OnHoldReasonRequired and the audit.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class OnHoldReasonTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<JsonElement[]> ReasonsAsync(HttpClient? client = null) =>
        [.. (await OkAsync(await (client ?? _h.Admin).GetAsync("/api/v1/on-hold-reasons"))).EnumerateArray()];

    private static int Id(JsonElement e) => e.GetProperty("id").GetInt32();

    private async Task<JsonElement> HoldAsync(JsonElement task, int? reasonId, HttpStatusCode expected = HttpStatusCode.OK, string comment = "Waiting for the client") =>
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "ON_HOLD", comment, onHoldReasonId = reasonId, rowVersion = RowVersion(task) }), expected);

    [Fact]
    public async Task The_four_default_reasons_are_seeded_in_order_and_the_list_is_readable_with_Task_View()
    {
        var list = await ReasonsAsync();
        list.Select(r => r.GetProperty("name").GetString()).ShouldBe(["Waiting for client data", "Waiting for approval", "Waiting for vendor", "Waiting for a decision"]);
        list.ShouldAllBe(r => r.GetProperty("isActive").GetBoolean());

        var viewer = await _h.UserWithAsync(@"KE\viewer", "Task.View");
        (await ReasonsAsync(viewer)).Length.ShouldBe(4);
        var nobody = await _h.UserWithAsync(@"KE\nobody2", "Matter.View");
        (await nobody.GetAsync("/api/v1/on-hold-reasons")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Managing_needs_OnHoldReason_Manage_and_a_reason_can_be_added_renamed_deactivated_and_reordered_but_not_deleted()
    {
        var viewer = await _h.UserWithAsync(@"KE\viewer2", "Task.View");
        (await viewer.PostAsJsonAsync("/api/v1/on-hold-reasons", new { name = "Nope" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var manager = await _h.UserWithAsync(@"KE\labels", "OnHoldReason.Manage");
        var created = await OkAsync(await manager.PostAsJsonAsync("/api/v1/on-hold-reasons", new { name = "Waiting for counsel" }), HttpStatusCode.Created);
        created.GetProperty("sortOrder").GetInt32().ShouldBe(5);
        (await manager.PostAsJsonAsync("/api/v1/on-hold-reasons", new { name = "Waiting for counsel" })).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        var renamed = await OkAsync(await manager.PutAsJsonAsync($"/api/v1/on-hold-reasons/{Id(created)}", new { name = "Waiting for legal", isActive = false, rowVersion = created.GetProperty("rowVersion").GetString() }));
        renamed.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        (await manager.PutAsJsonAsync($"/api/v1/on-hold-reasons/{Id(created)}", new { name = "Stale", isActive = true, rowVersion = created.GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        var ids = (await ReasonsAsync(manager)).Select(Id).Reverse().ToArray();
        var order = await OkAsync(await manager.PutAsJsonAsync("/api/v1/on-hold-reasons/order", new { ids }));
        order.EnumerateArray().Select(Id).ShouldBe(ids);
        (await manager.PutAsJsonAsync("/api/v1/on-hold-reasons/order", new { ids = ids.Skip(1).ToArray() })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        (await manager.DeleteAsync($"/api/v1/on-hold-reasons/{Id(created)}")).StatusCode.ShouldBeOneOf(HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed);
    }

    [Fact]
    public async Task A_hold_without_a_reason_still_works_and_a_reason_is_kept_shown_audited_and_cleared_when_the_task_resumes()
    {
        var reasons = await ReasonsAsync();
        var task = await _h.CreateTaskAsync(_w);

        var plain = await HoldAsync(task, null);
        plain.GetProperty("onHoldReason").ValueKind.ShouldBe(JsonValueKind.Null);
        var resumed = await _h.StatusAsync(plain, "IN_PROGRESS");

        var held = await HoldAsync(resumed, Id(reasons[0]));
        held.GetProperty("onHoldReason").GetProperty("name").GetString().ShouldBe("Waiting for client data");
        held.GetProperty("statusReason").GetProperty("bodyHtml").GetString()!.ShouldContain("Waiting for the client");
        (await _h.ScalarAsync($"SELECT OnHoldReasonId AS Value FROM dbo.Task WHERE TaskId = {TaskId(task)}")).ShouldBe(Id(reasons[0]));

        var audit = (await _h.AuditAsync(TaskId(task))).Where(a => a.EventType == "TASK_STATUS_CHANGED" && a.NewValue == "ON_HOLD").ToList();
        audit.Last().Summary!.ShouldContain("onHoldReason=Waiting for client data");

        var back = await _h.StatusAsync(held, "IN_PROGRESS");
        back.GetProperty("onHoldReason").ValueKind.ShouldBe(JsonValueKind.Null);
        (await _h.ScalarAsync($"SELECT COUNT(*) AS Value FROM dbo.Task WHERE TaskId = {TaskId(task)} AND OnHoldReasonId IS NULL")).ShouldBe(1);
    }

    [Fact]
    public async Task An_unknown_inactive_or_misplaced_reason_is_a_400_and_nothing_changes()
    {
        var reasons = await ReasonsAsync();
        var task = await _h.CreateTaskAsync(_w);

        var unknown = await HoldAsync(task, 999999, HttpStatusCode.BadRequest);
        unknown.GetProperty("errors").GetProperty("onHoldReasonId")[0].GetProperty("code").GetString().ShouldBe("UNKNOWN_ON_HOLD_REASON");

        var off = reasons[1];
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/on-hold-reasons/{Id(off)}", new { name = off.GetProperty("name").GetString(), isActive = false, rowVersion = off.GetProperty("rowVersion").GetString() }));
        await HoldAsync(task, Id(off), HttpStatusCode.BadRequest);

        var misplaced = await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "IN_PROGRESS", onHoldReasonId = Id(reasons[0]), rowVersion = RowVersion(task) }), HttpStatusCode.BadRequest);
        misplaced.GetProperty("errors").GetProperty("onHoldReasonId")[0].GetProperty("code").GetString().ShouldBe("ON_HOLD_REASON_NOT_ALLOWED");
        (await _h.GetTaskAsync(TaskId(task))).GetProperty("status").GetString().ShouldBe("NEW");
    }

    [Fact]
    public async Task Tasks_OnHoldReasonRequired_makes_the_reason_mandatory_for_a_hold_only()
    {
        await using var strict = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { ExtraSettings = [("Tasks:OnHoldReasonRequired", "true")] };
        var h = new TaskHarness(strict);
        var w = await h.CreateWorldAsync();
        var reasons = (await OkAsync(await h.Admin.GetAsync("/api/v1/on-hold-reasons"))).EnumerateArray().ToArray();
        var task = await h.CreateTaskAsync(w);

        var refused = await OkAsync(await h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "ON_HOLD", comment = "Waiting", rowVersion = RowVersion(task) }), HttpStatusCode.BadRequest);
        refused.GetProperty("errors").GetProperty("onHoldReasonId")[0].GetProperty("code").GetString().ShouldBe("ON_HOLD_REASON_REQUIRED");

        var held = await OkAsync(await h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/status", new { status = "ON_HOLD", comment = "Waiting", onHoldReasonId = Id(reasons[0]), rowVersion = RowVersion(task) }));
        held.GetProperty("onHoldReason").GetProperty("onHoldReasonId").GetInt32().ShouldBe(Id(reasons[0]));
        (await h.StatusAsync(held, "IN_PROGRESS")).GetProperty("status").GetString().ShouldBe("IN_PROGRESS");
    }
}
