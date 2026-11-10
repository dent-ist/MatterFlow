using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Security;

/// <summary>
/// Lost-write audit (issue #1304), Tasks, task comments, task assets, workflow steps, bulk changes and notifications: with the sensitive-matter rule on, a caller who is NOT "see all" makes a
/// SUCCESSFUL write and the value is read back by an administrator. See <see cref="LostWriteOrganizationTests"/> for why only a read-back after a good write can catch a write that EF silently
/// dropped. Personas: "unrelated" (sees the normal matter N1) and the primary project manager of the sensitive matter S1 (sees S1 as its manager).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class LostWriteWorkTests(SqlServerFixture sql)
{
    private static string Str(JsonElement e, string name) => e.GetProperty(name).GetString()!;

    /// <summary>The parts of an error answer that must not differ between a hidden and a missing target (everything but the trace id), the given id masked.</summary>
    private static async Task<string> ShapeAsync(HttpResponseMessage response, string id)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var p = doc.RootElement;
        return $"{(int)response.StatusCode}|{p.GetProperty("code").GetString()}|{p.GetProperty("title").GetString()}|{p.GetProperty("detail").GetString()!.Replace(id, "X")}";
    }

    private static Dictionary<string, object?> UpdateBody(JsonElement task, string title) => new()
    {
        ["rowVersion"] = RowVersion(task),
        ["title"] = title,
        ["description"] = task.GetProperty("description").GetString(),
        ["requestorName"] = task.GetProperty("requestorName").GetString(),
        ["requestorEmail"] = task.GetProperty("requestorEmail").GetString(),
        ["projectId"] = task.GetProperty("project").ValueKind == JsonValueKind.Object ? task.GetProperty("project").GetProperty("projectId").GetInt32() : (int?)null,
        ["dueDate"] = task.GetProperty("dueDate").GetString(),
    };

    [Fact]
    public async Task Task_edits_status_priority_assignment_and_steps_by_a_caller_who_is_not_see_all_are_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;
        var priorities = await OkAsync(await admin.GetAsync("/api/v1/priorities"));
        int PriorityId(string label) => priorities.EnumerateArray().First(p => Str(p, "label") == label).GetProperty("id").GetInt32();

        foreach (var (persona, taskId) in new[] { (u.UnrelatedClient, u.TN1), (u.PmPrimaryClient, u.TS1) })
        {
            var task = await u.H.GetTaskAsync(taskId, persona);

            // Edit the fields.
            var edited = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/tasks/{taskId}", UpdateBody(task, "Edited by persona " + taskId)));
            Str(edited, "title").ShouldBe("Edited by persona " + taskId);
            Str(await u.H.GetTaskAsync(taskId), "title").ShouldBe("Edited by persona " + taskId);

            // Priority.
            var high = await u.H.PostAsync(taskId, "priority", new { priorityId = PriorityId("High"), rowVersion = RowVersion(edited) }, persona);
            (await u.H.GetTaskAsync(taskId)).GetProperty("priority").GetProperty("label").GetString().ShouldBe("High");

            // Assignment to a worker (and back to nobody).
            var assigned = await u.H.PostAsync(taskId, "assignment", new { userId = u.Assignee, rowVersion = RowVersion(high) }, persona);
            (await u.H.GetTaskAsync(taskId)).GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(u.Assignee);

            // A step: start and complete the first one of the unordered workflow, then the task status changes.
            var steps = StepIds(assigned);
            var started = await u.H.StepAsync(assigned, steps[0], "start", client: persona);
            StepStatus(await u.H.GetTaskAsync(taskId), steps[0]).ShouldBe("IN_PROGRESS");
            var done = await u.H.StepAsync(started, steps[0], "complete", client: persona);
            StepStatus(await u.H.GetTaskAsync(taskId), steps[0]).ShouldBe("COMPLETED");

            var onHold = await u.H.PostAsync(taskId, "status", new { status = "ON_HOLD", comment = "waiting for the client", rowVersion = RowVersion(done) }, persona);
            Status(await u.H.GetTaskAsync(taskId)).ShouldBe("ON_HOLD");
            var resumed = await u.H.PostAsync(taskId, "status", new { status = "IN_PROGRESS", comment = (string?)null, rowVersion = RowVersion(onHold) }, persona);
            Status(await u.H.GetTaskAsync(taskId)).ShouldBe("IN_PROGRESS");
            Status(resumed).ShouldBe("IN_PROGRESS");
        }

        // Create a task as the persona and read it back.
        var created = await u.H.CreateTaskAsync(u.World, false, new() { ["matterId"] = u.N1, ["projectId"] = u.PN1, ["title"] = "Created by persona" }, u.UnrelatedClient);
        Str(await u.H.GetTaskAsync(TaskId(created)), "title").ShouldBe("Created by persona");

        // A hidden task still answers exactly like a missing one and is unchanged.
        var hidden = await u.H.GetTaskAsync(u.TS2);
        var denied = await u.UnrelatedClient.PutAsJsonAsync($"/api/v1/tasks/{u.TS2}", UpdateBody(hidden, "Sneaky"));
        var missing = await u.UnrelatedClient.PutAsJsonAsync("/api/v1/tasks/999999", UpdateBody(hidden, "Sneaky"));
        denied.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ShapeAsync(denied, u.TS2.ToString())).ShouldBe(await ShapeAsync(missing, "999999"));
        Str(await u.H.GetTaskAsync(u.TS2), "title").ShouldBe(SensitiveUniverse.Sentinel(u.S2) + " task");
    }

    [Fact]
    public async Task Comments_asset_links_and_bulk_changes_by_a_caller_who_is_not_see_all_are_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;
        var type = (await OkAsync(await admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();
        var priorities = await OkAsync(await admin.GetAsync("/api/v1/priorities"));
        var critical = priorities.EnumerateArray().First(p => Str(p, "label") == "Critical").GetProperty("id").GetInt32();

        foreach (var (persona, matterId, taskId, projectId) in new[] { (u.UnrelatedClient, u.N1, u.TN1, u.PN1), (u.PmPrimaryClient, u.S1, u.TS1, u.PS1) })
        {
            // Comments: add, edit, delete.
            var comments = $"/api/v1/tasks/{taskId}/comments";
            var comment = await OkAsync(await persona.PostAsJsonAsync(comments, new { bodyHtml = "<p>First</p>" }), HttpStatusCode.Created);
            var commentId = comment.GetProperty("commentId").GetInt64();
            (await OkAsync(await admin.GetAsync(comments))).GetProperty("items").EnumerateArray().Single(c => c.GetProperty("commentId").GetInt64() == commentId).GetProperty("bodyHtml").GetString().ShouldBe("<p>First</p>");
            var edited = await OkAsync(await persona.PutAsJsonAsync($"{comments}/{commentId}", new { bodyHtml = "<p>Second</p>", rowVersion = Str(comment, "rowVersion") }));
            (await OkAsync(await admin.GetAsync(comments))).GetProperty("items").EnumerateArray().Single(c => c.GetProperty("commentId").GetInt64() == commentId).GetProperty("bodyHtml").GetString().ShouldBe("<p>Second</p>");
            (await persona.DeleteAsync($"{comments}/{commentId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await OkAsync(await admin.GetAsync(comments))).GetProperty("items").EnumerateArray().ShouldNotContain(c => c.GetProperty("commentId").GetInt64() == commentId);
            edited.GetProperty("isEdited").GetBoolean().ShouldBeTrue();

            // Asset links: link, change the relationship, unlink.
            var asset = (await OkAsync(await admin.PostAsJsonAsync("/api/v1/assets", new { matterId, assetTypeId = type, displayName = "Disc " + matterId }), HttpStatusCode.Created)).GetProperty("assetId").GetInt32();
            var roles = await OkAsync(await admin.GetAsync("/api/v1/asset-link-roles"));
            var source = roles.EnumerateArray().First(r => Str(r, "name") == "Source").GetProperty("id").GetInt32();
            var links = $"/api/v1/tasks/{taskId}/assets";
            var link = await OkAsync(await persona.PostAsJsonAsync(links, new { assetId = asset, assetLinkRoleId = (int?)null }), HttpStatusCode.Created);
            var changed = await OkAsync(await persona.PutAsJsonAsync($"{links}/{asset}", new { assetLinkRoleId = source, rowVersion = Str(link, "rowVersion") }));
            (await OkAsync(await admin.GetAsync(links))).GetProperty("items").EnumerateArray().Single(l => l.GetProperty("assetId").GetInt32() == asset).GetProperty("assetLinkRoleId").GetInt32().ShouldBe(source);
            (await persona.DeleteAsync($"{links}/{asset}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await OkAsync(await admin.GetAsync(links))).GetProperty("items").EnumerateArray().ShouldBeEmpty();
            changed.GetProperty("assetId").GetInt32().ShouldBe(asset);

            // Bulk: priority and assignee for the matter's task, then the project link of the same task.
            var task = await u.H.GetTaskAsync(taskId);
            var bulk = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/matters/{matterId}/tasks/bulk", new { taskIds = new[] { taskId }, priorityId = critical, reassignTo = new { userId = u.Assignee } }));
            bulk.GetProperty("changed").GetInt32().ShouldBe(1, bulk.ToString());
            var afterBulk = await u.H.GetTaskAsync(taskId);
            afterBulk.GetProperty("priority").GetProperty("label").GetString().ShouldBe("Critical");
            afterBulk.GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(u.Assignee);

            var linkedProject = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/matters/{matterId}/tasks/project", new { taskIds = new[] { taskId }, projectId = (int?)null }));
            linkedProject.GetProperty("changed").GetInt32().ShouldBe(1, linkedProject.ToString());
            (await u.H.GetTaskAsync(taskId)).GetProperty("project").ValueKind.ShouldBe(JsonValueKind.Null);
            var relinked = await OkAsync(await persona.PostAsJsonAsync($"/api/v1/matters/{matterId}/tasks/project", new { taskIds = new[] { taskId }, projectId }));
            relinked.GetProperty("changed").GetInt32().ShouldBe(1, relinked.ToString());
            (await u.H.GetTaskAsync(taskId)).GetProperty("project").GetProperty("projectId").GetInt32().ShouldBe(projectId);
            task.GetProperty("taskId").GetInt64().ShouldBe(taskId);
        }
    }

    [Fact]
    public async Task Marking_a_notification_read_by_a_caller_who_is_not_see_all_is_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var task = await u.H.GetTaskAsync(u.TN1);
        await OkAsync(await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.TN1}/assignment", new { rowVersion = RowVersion(task), userId = u.Unrelated }));

        var persona = u.UnrelatedClient;
        var before = await OkAsync(await persona.GetAsync("/api/v1/me/notifications/poll?initial=true"));
        before.GetProperty("unreadCount").GetInt32().ShouldBeGreaterThan(0);
        var first = (await OkAsync(await persona.GetAsync("/api/v1/me/notifications?pageSize=100"))).GetProperty("items").EnumerateArray().First(i => i.GetProperty("objectId").GetInt64() == u.TN1);

        (await persona.PostAsync($"/api/v1/me/notifications/{first.GetProperty("id").GetInt64()}/read", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        var after = await OkAsync(await persona.GetAsync("/api/v1/me/notifications/poll?initial=true"));
        after.GetProperty("unreadCount").GetInt32().ShouldBe(before.GetProperty("unreadCount").GetInt32() - 1);

        (await persona.PostAsync("/api/v1/me/notifications/read-all", null)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await OkAsync(await persona.GetAsync("/api/v1/me/notifications/poll?initial=true"))).GetProperty("unreadCount").GetInt32().ShouldBe(0);
    }
}
