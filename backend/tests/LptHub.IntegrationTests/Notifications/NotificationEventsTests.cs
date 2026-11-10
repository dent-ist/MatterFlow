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
/// WP-NT2 create-path events against a real SQL Server: 1 task assigned to you (#735), 3 comment on your task (#736) and 8 task unassigned in your
/// pod (#740). Every notification is created in the same transaction as the action, never for the actor, once per person, honouring the switches.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class NotificationEventsTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Prefs = "/api/v1/me/notification-preferences";

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private HttpClient _ann = null!;
    private HttpClient _bo = null!;
    private int _annId;
    private int _boId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        _ann = await _h.UserWithAsync(@"KE\ann", AllTaskPermissions);
        _bo = await _h.UserWithAsync(@"KE\bo", AllTaskPermissions);
        _annId = await _h.UserIdAsync(@"KE\ann");
        _boId = await _h.UserIdAsync(@"KE\bo");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private Task<List<Notification>> RowsAsync(int? recipient = null, string? type = null) =>
        _factory.WithDbAsync(db => db.Set<Notification>().AsNoTracking()
            .Where(n => (recipient == null || n.RecipientUserId == recipient) && (type == null || n.EventType == type))
            .OrderBy(n => n.Id).ToListAsync());

    private async Task<JsonElement> AssignAsync(JsonElement task, int? userId, int? podId = null, HttpClient? client = null, HttpStatusCode expected = HttpStatusCode.OK) =>
        await OkAsync(await (client ?? _h.Admin).PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { rowVersion = RowVersion(task), userId, podId }), expected);

    private Task<JsonElement> CreateAsync(Dictionary<string, object?> extra, HttpClient? client = null) => _h.CreateTaskAsync(_w, extra: extra, client: client);

    // ---- event 1: task assigned to you

    [Fact]
    public async Task Event1_create_with_assignee_notifies_that_person_with_the_readme_wording()
    {
        var task = await CreateAsync(new() { ["assignedUserId"] = _annId });

        var row = (await RowsAsync()).ShouldHaveSingleItem();
        row.RecipientUserId.ShouldBe(_annId);
        row.EventType.ShouldBe("TaskAssigned");
        row.ObjectKind.ShouldBe("Task");
        row.ObjectId.ShouldBe(TaskId(task));
        row.MatterId.ShouldBe(_w.MatterId);
        row.ActorUserId.ShouldNotBeNull();
        row.DedupeKey.ShouldStartWith("assign:");
        var number = task.GetProperty("taskNumber").GetString();
        row.Message.ShouldBe($"Assigned to you - {number} \"{task.GetProperty("title").GetString()}\" on Merger Review 12");

        // The recipient sees it through the API; the actor and a bystander do not.
        (await OkAsync(await _ann.GetAsync("/api/v1/me/notifications"))).GetProperty("totalCount").GetInt32().ShouldBe(1);
        (await OkAsync(await _bo.GetAsync("/api/v1/me/notifications"))).GetProperty("totalCount").GetInt32().ShouldBe(0);
        (await OkAsync(await _h.Admin.GetAsync("/api/v1/me/notifications"))).GetProperty("totalCount").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task Event1_assign_reassign_and_unassign()
    {
        var task = await CreateAsync([]);
        (await RowsAsync()).ShouldBeEmpty();

        task = await AssignAsync(task, _annId);
        (await RowsAsync(_annId, "TaskAssigned")).Count.ShouldBe(1);

        // Same assignee again: nothing changes, nothing is sent.
        task = await AssignAsync(task, _annId);
        (await RowsAsync()).Count.ShouldBe(1);

        // Reassigned to Bo: Bo is told, Ann (the previous assignee) is not told anything in this release.
        task = await AssignAsync(task, _boId);
        (await RowsAsync(_boId, "TaskAssigned")).Count.ShouldBe(1);
        (await RowsAsync(_annId)).Count.ShouldBe(1);

        // Unassigned: nobody is told (no pod, so no event 8 either).
        await AssignAsync(task, null);
        (await RowsAsync()).Count.ShouldBe(2);
    }

    [Fact]
    public async Task Event1_assigning_to_yourself_creates_nothing()
    {
        var task = await CreateAsync([], client: _ann);

        await AssignAsync(task, _annId, client: _ann);

        (await RowsAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task Event1_a_rolled_back_assignment_creates_no_row()
    {
        var task = await CreateAsync([]);
        await AssignAsync(task, _boId); // succeeds: Bo is told; the row version we hold is stale from now on
        (await RowsAsync()).Count.ShouldBe(1);

        // The stale token gives a 409: the whole transaction, with its notification, is rolled back.
        await AssignAsync(task, _annId, expected: HttpStatusCode.Conflict);

        (await RowsAsync()).Count.ShouldBe(1);
        (await RowsAsync(_annId)).ShouldBeEmpty();
    }

    [Fact]
    public async Task Event1_a_person_who_switched_it_off_gets_nothing_and_others_still_do()
    {
        await OkAsync(await _ann.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "TaskAssigned", enabled = false } } }));

        var task = await CreateAsync(new() { ["assignedUserId"] = _annId });
        (await RowsAsync()).ShouldBeEmpty();
        await AssignAsync(task, _boId);

        (await RowsAsync()).ShouldHaveSingleItem().RecipientUserId.ShouldBe(_boId);
    }

    [Fact]
    public async Task Event1_batch_assignment_notifies_once_per_task()
    {
        var one = await CreateAsync([]);
        var two = await CreateAsync([]);

        await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks/assign-batch", new
        {
            userId = _annId,
            items = new[] { new { taskId = TaskId(one), rowVersion = RowVersion(one) }, new { taskId = TaskId(two), rowVersion = RowVersion(two) } },
        }));

        (await RowsAsync(_annId, "TaskAssigned")).Count.ShouldBe(2);
    }

    // ---- event 3: comment on your task

    [Fact]
    public async Task Event3_a_comment_by_someone_else_notifies_the_assignee_by_name_without_the_comment_text()
    {
        var task = await CreateAsync(new() { ["assignedUserId"] = _annId });
        var longText = string.Join(' ', Enumerable.Repeat("terms", 40));

        var comment = await OkAsync(await _bo.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/comments", new { bodyHtml = $"<p>Please re-run the search: {longText}</p>" }), HttpStatusCode.Created);

        var row = (await RowsAsync(_annId, "TaskComment")).ShouldHaveSingleItem();
        row.ActorUserId.ShouldBe(_boId);
        row.DedupeKey.ShouldBe("comment:" + comment.GetProperty("commentId").GetInt64());
        row.Message.ShouldBe($"New comment from KE\\bo - {task.GetProperty("taskNumber").GetString()} \"{task.GetProperty("title").GetString()}\" on Merger Review 12");
        row.Message.ShouldNotContain("Please re-run");
    }

    [Fact]
    public async Task Event3_own_comments_unassigned_tasks_edits_and_deletes_notify_nobody()
    {
        var assigned = await CreateAsync(new() { ["assignedUserId"] = _annId });
        var unassigned = await CreateAsync([]);
        var before = (await RowsAsync()).Count;

        // The assignee's own comment, and any comment on an unassigned task.
        var own = await OkAsync(await _ann.PostAsJsonAsync($"/api/v1/tasks/{TaskId(assigned)}/comments", new { bodyHtml = "<p>mine</p>" }), HttpStatusCode.Created);
        await OkAsync(await _bo.PostAsJsonAsync($"/api/v1/tasks/{TaskId(unassigned)}/comments", new { bodyHtml = "<p>nobody home</p>" }), HttpStatusCode.Created);
        (await RowsAsync()).Count.ShouldBe(before);

        // Editing or deleting a comment does not renotify.
        var theirs = await OkAsync(await _bo.PostAsJsonAsync($"/api/v1/tasks/{TaskId(assigned)}/comments", new { bodyHtml = "<p>first</p>" }), HttpStatusCode.Created);
        (await RowsAsync(_annId, "TaskComment")).Count.ShouldBe(1);
        var commentId = theirs.GetProperty("commentId").GetInt64();
        (await _bo.PutAsJsonAsync($"/api/v1/tasks/{TaskId(assigned)}/comments/{commentId}", new { bodyHtml = "<p>edited</p>", rowVersion = theirs.GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await _bo.DeleteAsync($"/api/v1/tasks/{TaskId(assigned)}/comments/{commentId}")).IsSuccessStatusCode.ShouldBeTrue();
        (await RowsAsync(_annId, "TaskComment")).Count.ShouldBe(1);
        own.GetProperty("commentId").GetInt64().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Event3_the_switch_governs_it_and_a_second_comment_makes_a_second_notification()
    {
        var task = await CreateAsync(new() { ["assignedUserId"] = _annId });
        await _bo.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/comments", new { bodyHtml = "<p>one</p>" });
        await _bo.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/comments", new { bodyHtml = "<p>two</p>" });
        (await RowsAsync(_annId, "TaskComment")).Count.ShouldBe(2); // no burst coalescing in this release

        await OkAsync(await _ann.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "TaskComment", enabled = false } } }));
        await _bo.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/comments", new { bodyHtml = "<p>three</p>" });
        (await RowsAsync(_annId, "TaskComment")).Count.ShouldBe(2);
    }

    // ---- event 8: task unassigned in your pod

    private async Task<(int PodId, HttpClient Lead1, int Lead1Id, int Lead2Id, int MemberId)> PodWithLeadsAsync()
    {
        var leadPerms = AllTaskPermissions;
        // The starter role "Pod Lead" is seeded at startup: Pod Lead is a role, and the leads of a pod are its members who hold it.
        var roleId = await _factory.WithDbAsync(db => db.Set<MatterFlow.Identity.Domain.Role>().Where(r => r.Name == "Pod Lead").Select(r => r.Id).SingleAsync());
        var lead1 = await _h.UserWithAsync(@"KE\lead1", leadPerms);
        var lead2 = await _h.UserWithAsync(@"KE\lead2", leadPerms);
        var lead1Id = await _h.UserIdAsync(@"KE\lead1");
        var lead2Id = await _h.UserIdAsync(@"KE\lead2");
        await _factory.GrantRoleAsync(@"KE\lead1", roleId);
        await _factory.GrantRoleAsync(@"KE\lead2", roleId);
        var podId = await _h.CreatePodAsync("Demo Processing Pod", lead1Id, lead2Id, _annId);
        _ = lead2;
        return (podId, lead1, lead1Id, lead2Id, _annId);
    }

    [Fact]
    public async Task Event8_created_into_a_pod_without_a_person_notifies_every_lead_but_not_members_or_the_actor()
    {
        var (podId, lead1, lead1Id, lead2Id, memberId) = await PodWithLeadsAsync();

        var task = await CreateAsync(new() { ["assignedPodId"] = podId });

        var rows = await RowsAsync(type: "PodTaskUnassigned");
        rows.Select(r => r.RecipientUserId).ShouldBe([lead1Id, lead2Id], ignoreOrder: true);
        rows.ShouldAllBe(r => r.DedupeKey.StartsWith($"unassigned:{TaskId(task)}:"));
        rows[0].Message.ShouldBe($"Unassigned in Demo Processing Pod - {task.GetProperty("taskNumber").GetString()} \"{task.GetProperty("title").GetString()}\" on Merger Review 12");
        (await RowsAsync(memberId)).ShouldBeEmpty();

        // A lead who creates the task is the actor and is not told; the other lead is.
        var before = (await RowsAsync()).Count;
        await CreateAsync(new() { ["assignedPodId"] = podId }, client: lead1);
        var added = (await RowsAsync()).Skip(before).ToList();
        added.ShouldHaveSingleItem().RecipientUserId.ShouldBe(lead2Id);
    }

    [Fact]
    public async Task Event8_unassigning_in_a_pod_notifies_the_leads_but_a_task_without_a_pod_or_with_a_person_does_not()
    {
        var (podId, _, lead1Id, lead2Id, memberId) = await PodWithLeadsAsync();

        // No pod: nobody. With a person in the pod: no event 8.
        var noPod = await CreateAsync(new() { ["assignedUserId"] = memberId });
        await CreateAsync(new() { ["assignedPodId"] = podId, ["assignedUserId"] = memberId });
        (await RowsAsync(type: "PodTaskUnassigned")).ShouldBeEmpty();
        await AssignAsync(noPod, null);
        (await RowsAsync(type: "PodTaskUnassigned")).ShouldBeEmpty();

        // Assigned in the pod, then the person is removed: the leads hear about it.
        var task = await CreateAsync(new() { ["assignedPodId"] = podId, ["assignedUserId"] = memberId });
        await AssignAsync(task, null, podId);
        (await RowsAsync(type: "PodTaskUnassigned")).Select(r => r.RecipientUserId).ShouldBe([lead1Id, lead2Id], ignoreOrder: true);
    }

    [Fact]
    public async Task Event8_a_lead_who_switched_it_off_is_skipped()
    {
        var (podId, lead1, lead1Id, lead2Id, _) = await PodWithLeadsAsync();
        await OkAsync(await lead1.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "PodTaskUnassigned", enabled = false } } }));

        await CreateAsync(new() { ["assignedPodId"] = podId });

        (await RowsAsync(type: "PodTaskUnassigned")).ShouldHaveSingleItem().RecipientUserId.ShouldBe(lead2Id);
        lead1Id.ShouldNotBe(lead2Id);
    }

    [Fact]
    public async Task Event8_a_failed_create_leaves_no_notification()
    {
        var (podId, _, _, _, _) = await PodWithLeadsAsync();
        var body = _h.NewTask(_w, extra: new() { ["assignedPodId"] = podId, ["taskTypeId"] = 999999 });

        var response = await _h.Admin.PostAsJsonAsync("/api/v1/tasks", body);

        response.IsSuccessStatusCode.ShouldBeFalse();
        (await RowsAsync()).ShouldBeEmpty();
    }
}
