using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using LptHub.IntegrationTests.Security;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.TaskTypeAccess;

/// <summary>
/// Task Type access, write side (epic #1397, issue #1401, design README sections 1.1, 5, 9.2 and 15.10). With <c>Features:TaskTypeAccess</c> on, the Secret type has Can View = Reviewers, Can Edit = Editors and
/// Can Be Assigned = Assigners: a person who may see a task but is not an Editor gets 403 <c>TASK_TYPE_READ_ONLY</c> from every write path and nothing changes; a person who may not see it gets the 404 of a missing
/// id; an assignee outside Can Be Assigned is <c>USER_CANNOT_ASSIGN_TYPE</c> (single, batch and bulk); an empty Edit or Assign list is "no extra limit"; the System Admin edits everything but is assignable only through the
/// Assign list; with the switch off nothing of this exists.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeWriteTests(SqlServerFixture sql)
{
    private const string ReadOnly = "TASK_TYPE_READ_ONLY";
    private const string CannotAssign = "USER_CANNOT_ASSIGN_TYPE";

    /// <summary>The universe of the read side plus an Editor (Can Edit) and an Assignee (Can Be Assigned); the Viewer holds the Can View role only.</summary>
    private sealed class Scene
    {
        public required TaskTypeUniverse U { get; init; }

        public required HttpClient Editor { get; init; }

        public required HttpClient Assignee { get; init; }

        public required int EditorId { get; init; }

        public required int AssigneeId { get; init; }

        public required int AdminId { get; init; }

        public required int EditorRole { get; init; }

        public required int AssignerRole { get; init; }

        public long Task { get; set; }

        public HttpClient Admin => U.H.Admin;
    }

    private static async Task<T> WithSceneAsync<T>(SqlServerFixture sql, bool typeRule, Func<Scene, Task<T>> body, bool lists = true)
    {
        var u = await TaskTypeUniverse.BuildAsync(sql, typeRule);
        try
        {
            var editorRole = await u.H.Factory.CreateRoleAsync("Privilege Editors", "Task.View");
            var assignerRole = await u.H.Factory.CreateRoleAsync("Privilege Assigners", "Task.View");
            var editor = await u.H.UserWithAsync(@"KE\teditor", TaskTypeUniverse.Broad);
            var assignee = await u.H.UserWithAsync(@"KE\tassignee", TaskTypeUniverse.Broad);
            await u.H.Factory.GrantRoleAsync(@"KE\teditor", editorRole);
            await u.H.Factory.GrantRoleAsync(@"KE\tassignee", assignerRole);
            var scene = new Scene
            {
                U = u,
                Editor = editor,
                Assignee = assignee,
                EditorId = await u.H.UserIdAsync(@"KE\teditor"),
                AssigneeId = await u.H.UserIdAsync(@"KE\tassignee"),
                AdminId = await u.H.UserIdAsync(Fixtures.DatabaseApiFactory.AdminAccount),
                EditorRole = editorRole,
                AssignerRole = assignerRole,
                Task = u.T3,
            };
            if (lists)
                await u.RestrictAsync([u.ReviewerRole], [editorRole], [assignerRole]);

            u.H.Factory.InvalidateAll();
            return await body(scene);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    private static async Task<(HttpStatusCode Status, string Body)> SendAsync(HttpResponseMessage response) => (response.StatusCode, await response.Content.ReadAsStringAsync());

    // ---- the write walk: every edit-gated endpoint of the catalogue, as a person who may see the task but not edit it, and as one who may not see it

    /// <summary>How the answer of one write is read: a direct problem (status and code) or a 200 with a result per task.</summary>
    private sealed record Call(string Key, Func<Scene, HttpClient, Task<HttpResponseMessage>> Send, bool PerRow = false);

    private static StringContent Json(object body) => new(JsonSerializer.Serialize(body), System.Text.Encoding.UTF8, "application/json");

    private static async Task<JsonElement> CurrentAsync(Scene s, long taskId) => await OkAsync(await s.Admin.GetAsync($"/api/v1/tasks/{taskId}"));

    private static async Task<long> CommentOfAsync(Scene s, long taskId)
    {
        var list = await OkAsync(await s.Admin.GetAsync($"/api/v1/tasks/{taskId}/comments"));
        return list.GetProperty("items").EnumerateArray().First().GetProperty("commentId").GetInt64();
    }

    private static Call[] Calls() =>
    [
        new("POST api/v1/tasks", (s, c) => c.PostAsJsonAsync("/api/v1/tasks", s.U.H.NewTask(s.U.SecretWorld, false, "Walk create", new Dictionary<string, object?> { ["projectId"] = s.U.Project }))),
        new("PUT api/v1/tasks/{taskId:long}", async (s, c) =>
        {
            var t = await CurrentAsync(s, s.Task);
            return await c.PutAsJsonAsync($"/api/v1/tasks/{s.Task}", new Dictionary<string, object?>
            {
                ["rowVersion"] = RowVersion(t), ["title"] = "Changed by the walk", ["description"] = null, ["requestorName"] = t.GetProperty("requestorName").GetString(), ["requestorEmail"] = null, ["projectId"] = null, ["dueDate"] = null,
            });
        }),
        new("POST api/v1/tasks/{taskId:long}/assignment", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/assignment", Json(new { rowVersion = RowVersion(await CurrentAsync(s, s.Task)), userId = s.AssigneeId }))),
        new("POST api/v1/tasks/assign-batch", async (s, c) => await c.PostAsync("/api/v1/tasks/assign-batch", Json(new { userId = s.AssigneeId, items = new[] { new { taskId = s.Task, rowVersion = RowVersion(await CurrentAsync(s, s.Task)) } } })), PerRow: true),
        new("POST api/v1/tasks/{taskId:long}/priority", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/priority", Json(new { rowVersion = RowVersion(await CurrentAsync(s, s.Task)), priorityId = (await CurrentAsync(s, s.Task)).GetProperty("priority").GetProperty("priorityId").GetInt32() }))),
        new("POST api/v1/tasks/{taskId:long}/status", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/status", Json(new { rowVersion = RowVersion(await CurrentAsync(s, s.Task)), status = "IN_PROGRESS" }))),
        new("POST api/v1/tasks/{taskId:long}/complete", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/complete", Json(new { rowVersion = RowVersion(await CurrentAsync(s, s.Task)), completeUnresolvedSteps = false }))),
        new("POST api/v1/tasks/{taskId:long}/cancel", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/cancel", Json(new { rowVersion = RowVersion(await CurrentAsync(s, s.Task)), comment = "walk" }))),
        new("POST api/v1/tasks/{taskId:long}/reopen", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/reopen", Json(new { rowVersion = RowVersion(await CurrentAsync(s, s.Task)), comment = "walk" }))),
        new("POST api/v1/tasks/{taskId:long}/comments", (s, c) => c.PostAsync($"/api/v1/tasks/{s.Task}/comments", Json(new { bodyHtml = "<p>walk</p>" }))),
        new("PUT api/v1/tasks/{taskId:long}/comments/{commentId:long}", async (s, c) => await c.PutAsync($"/api/v1/tasks/{s.Task}/comments/{await CommentOfAsync(s, s.Task)}", Json(new { bodyHtml = "<p>walk</p>", rowVersion = "AAAAAAAAB9E=" }))),
        new("DELETE api/v1/tasks/{taskId:long}/comments/{commentId:long}", async (s, c) => await c.DeleteAsync($"/api/v1/tasks/{s.Task}/comments/{await CommentOfAsync(s, s.Task)}")),
        new("POST api/v1/tasks/{taskId:long}/assets", (s, c) => c.PostAsync($"/api/v1/tasks/{s.Task}/assets", Json(new { assetId = 1 }))),
        new("PUT api/v1/tasks/{taskId:long}/assets/{assetId:int}", (s, c) => c.PutAsync($"/api/v1/tasks/{s.Task}/assets/1", Json(new { assetLinkRoleId = (int?)null, rowVersion = "AAAAAAAAB9E=" }))),
        new("DELETE api/v1/tasks/{taskId:long}/assets/{assetId:int}", (s, c) => c.DeleteAsync($"/api/v1/tasks/{s.Task}/assets/1")),
        new("POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/start", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/workflow/steps/{StepIds(await CurrentAsync(s, s.Task))[0]}/start", Json(new { rowVersion = WorkflowRowVersion(await CurrentAsync(s, s.Task)) }))),
        new("POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/values", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/workflow/steps/{StepIds(await CurrentAsync(s, s.Task))[0]}/values", Json(new { rowVersion = WorkflowRowVersion(await CurrentAsync(s, s.Task)) }))),
        new("POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/complete", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/workflow/steps/{StepIds(await CurrentAsync(s, s.Task))[0]}/complete", Json(new { rowVersion = WorkflowRowVersion(await CurrentAsync(s, s.Task)) }))),
        new("POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/skip", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/workflow/steps/{StepIds(await CurrentAsync(s, s.Task))[0]}/skip", Json(new { rowVersion = WorkflowRowVersion(await CurrentAsync(s, s.Task)), comment = "walk" }))),
        new("POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/reopen", async (s, c) => await c.PostAsync($"/api/v1/tasks/{s.Task}/workflow/steps/{StepIds(await CurrentAsync(s, s.Task))[0]}/reopen", Json(new { rowVersion = WorkflowRowVersion(await CurrentAsync(s, s.Task)) }))),
        new("POST api/v1/matters/{matterId:int}/tasks/bulk", async (s, c) => await c.PostAsync($"/api/v1/matters/{s.U.Matter}/tasks/bulk", Json(new { taskIds = new[] { s.Task }, priorityId = (await CurrentAsync(s, s.Task)).GetProperty("priority").GetProperty("priorityId").GetInt32() })), PerRow: true),
        new("POST api/v1/matters/{matterId:int}/tasks/project", (s, c) => c.PostAsync($"/api/v1/matters/{s.U.Matter}/tasks/project", Json(new { taskIds = new[] { s.Task }, projectId = (int?)null })), PerRow: true),
    ];

    private static async Task<string> TaskStateAsync(Scene s) =>
        $"{RowVersion(await CurrentAsync(s, s.Task))}|{(await OkAsync(await s.Admin.GetAsync($"/api/v1/tasks/{s.Task}/comments"))).GetProperty("total").GetInt32()}|{await s.U.H.ScalarAsync("SELECT COUNT(*) FROM dbo.Task")}";

    [Fact]
    public async Task The_write_walk_covers_every_edit_gated_endpoint_of_the_catalogue()
    {
        var gated = TaskTypeAccessCatalog.Writes.Where(kv => kv.Value.Handling == TypeWriteHandling.EditGated).Select(kv => kv.Key).Order(StringComparer.Ordinal).ToList();
        Calls().Select(c => c.Key).Order(StringComparer.Ordinal).ToList().ShouldBe(gated, "every edit-gated write of TaskTypeAccessCatalog.Writes needs a call in the walk (and the other way round)");
        await Task.CompletedTask;
    }

    [Fact]
    public async Task A_person_who_may_see_the_task_but_not_edit_it_is_refused_by_every_write_path_and_nothing_changes()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            var before = await TaskStateAsync(s);
            foreach (var call in Calls())
            {
                var (status, body) = await SendAsync(await call.Send(s, s.U.Viewer));
                if (call.PerRow)
                {
                    status.ShouldBe(HttpStatusCode.OK, call.Key + ": " + body);
                    body.ShouldContain(ReadOnly, Case.Sensitive, call.Key);
                    body.ShouldNotContain("\"ok\":true", Case.Sensitive, call.Key);
                    body.ShouldNotContain("\"succeeded\":true", Case.Sensitive, call.Key);
                    continue;
                }

                if (call.Key == "POST api/v1/tasks")
                {
                    status.ShouldBe(HttpStatusCode.BadRequest, body);
                    body.ShouldContain(ReadOnly);
                    continue;
                }

                status.ShouldBe(HttpStatusCode.Forbidden, call.Key + ": " + body);
                JsonDocument.Parse(body).RootElement.GetProperty("code").GetString().ShouldBe(ReadOnly, call.Key);
            }

            (await TaskStateAsync(s)).ShouldBe(before, "a refused write changes nothing");
            return 0;
        });
    }

    [Fact]
    public async Task A_person_who_may_not_see_the_task_gets_the_404_of_a_missing_id_from_every_write_path_whatever_they_are_to_the_task()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            // The Outsider is the project manager of the matter and the assignee of T2 (a Secret task); the target here is T2, so the assignee exception must not rescue it.
            s.Task = s.U.T2;
            (await s.Admin.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/comments", new { bodyHtml = $"<p>{TaskTypeUniverse.Sentinel} note</p>" })).StatusCode.ShouldBe(HttpStatusCode.Created);
            var before = await TaskStateAsync(s);
            foreach (var call in Calls())
            {
                var (status, body) = await SendAsync(await call.Send(s, s.U.Outsider));
                body.ShouldNotContain(TaskTypeUniverse.Sentinel, Case.Insensitive, call.Key);
                if (call.PerRow)
                {
                    status.ShouldBe(HttpStatusCode.OK, call.Key + ": " + body);
                    body.ShouldContain("NOT_FOUND", Case.Sensitive, call.Key);
                    body.ShouldNotContain(ReadOnly, Case.Sensitive, call.Key);
                    continue;
                }

                if (call.Key == "POST api/v1/tasks")
                {
                    status.ShouldBe(HttpStatusCode.BadRequest, body);
                    body.ShouldContain("Select a task type.");
                    body.ShouldNotContain(ReadOnly);
                    continue;
                }

                status.ShouldBe(HttpStatusCode.NotFound, call.Key + ": " + body);
                body.ShouldNotContain(ReadOnly, Case.Sensitive, call.Key);
            }

            (await TaskStateAsync(s)).ShouldBe(before);
            return 0;
        });
    }

    // ---- what an Editor and the System Admin can do

    [Fact]
    public async Task An_editor_can_change_the_task_assign_it_to_an_assigner_comment_and_move_it_through_its_life()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            var task = await CurrentAsync(s, s.Task);
            var edited = await OkAsync(await s.Editor.PutAsJsonAsync($"/api/v1/tasks/{s.Task}", new Dictionary<string, object?>
            {
                ["rowVersion"] = RowVersion(task),
                ["title"] = "Edited by the editor",
                ["description"] = null,
                ["requestorName"] = "Pat Partner",
                ["requestorEmail"] = null,
                ["projectId"] = null,
                ["dueDate"] = null,
            }));
            edited.GetProperty("title").GetString().ShouldBe("Edited by the editor");
            edited.GetProperty("allowedActions").GetProperty("readOnlyByType").GetBoolean().ShouldBeFalse();

            var assigned = await OkAsync(await s.Editor.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/assignment", new { rowVersion = RowVersion(edited), userId = s.AssigneeId }));
            assigned.GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(s.AssigneeId);

            (await s.Editor.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/comments", new { bodyHtml = "<p>Editor note</p>" })).StatusCode.ShouldBe(HttpStatusCode.Created);
            Status(assigned).ShouldBe("IN_PROGRESS", "the assignment starts a New task");
            var cancelled = await OkAsync(await s.Editor.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/status", new { rowVersion = RowVersion(assigned), status = "CANCELLED", comment = "Not needed" }));
            Status(cancelled).ShouldBe("CANCELLED");

            // Create: the Editor may create a task of the type, with an assignee of the Assign list.
            var created = await OkAsync(await s.Editor.PostAsJsonAsync("/api/v1/tasks", s.U.H.NewTask(s.U.SecretWorld, false, "Editor creates", new Dictionary<string, object?> { ["assignedUserId"] = s.AssigneeId })), HttpStatusCode.Created);
            created.GetProperty("taskType").GetProperty("taskTypeId").GetInt32().ShouldBe(s.U.SecretTypeId);
            return 0;
        });
    }

    [Fact]
    public async Task The_system_admin_edits_everything_but_is_assignable_only_through_the_assign_list()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            var task = await CurrentAsync(s, s.Task);
            var edited = await OkAsync(await s.Admin.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/priority", new { rowVersion = RowVersion(task), priorityId = task.GetProperty("priority").GetProperty("priorityId").GetInt32() }));

            // No admin exception for assignment: the admin is not in Can Be Assigned, so the Editor and the admin alike cannot assign the admin.
            var refused = await SendAsync(await s.Admin.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/assignment", new { rowVersion = RowVersion(edited), userId = s.AdminId }));
            refused.Status.ShouldBe(HttpStatusCode.BadRequest);
            refused.Body.ShouldContain(CannotAssign);
            (await SendAsync(await s.Editor.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/assignment", new { rowVersion = RowVersion(edited), userId = s.AdminId }))).Body.ShouldContain(CannotAssign);

            // With an empty Assign list the admin may be assigned (they may see the type).
            await s.U.RestrictAsync([s.U.ReviewerRole], [s.EditorRole], []);
            var ok = await OkAsync(await s.Admin.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/assignment", new { rowVersion = RowVersion(edited), userId = s.AdminId }));
            ok.GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(s.AdminId);
            return 0;
        });
    }

    [Fact]
    public async Task An_assignee_outside_the_assign_list_is_refused_on_create_single_assign_batch_and_bulk()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            // Create.
            var create = await SendAsync(await s.Editor.PostAsJsonAsync("/api/v1/tasks", s.U.H.NewTask(s.U.SecretWorld, false, "Wrong assignee", new Dictionary<string, object?> { ["assignedUserId"] = s.U.ViewerId })));
            create.Status.ShouldBe(HttpStatusCode.BadRequest);
            create.Body.ShouldContain(CannotAssign);

            // Single assign (the Viewer holds the Can View role, which is not the Can Be Assigned role).
            var task = await CurrentAsync(s, s.Task);
            var single = await SendAsync(await s.Editor.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/assignment", new { rowVersion = RowVersion(task), userId = s.U.ViewerId }));
            single.Status.ShouldBe(HttpStatusCode.BadRequest);
            single.Body.ShouldContain(CannotAssign);

            // Batch: per row code.
            var batch = await OkAsync(await s.Editor.PostAsJsonAsync("/api/v1/tasks/assign-batch", new { userId = s.U.ViewerId, items = new[] { new { taskId = s.Task, rowVersion = RowVersion(task) } } }));
            batch.GetProperty("results")[0].GetProperty("succeeded").GetBoolean().ShouldBeFalse();
            batch.GetProperty("results")[0].GetProperty("errorCode").GetString().ShouldBe(CannotAssign);

            // Bulk: the Open task takes the assignee, the Secret task refuses it, in the same call.
            var bulk = await OkAsync(await s.Editor.PostAsJsonAsync($"/api/v1/matters/{s.U.Matter}/tasks/bulk", new { taskIds = new[] { s.U.T1, s.Task }, reassignTo = new { userId = s.U.PlainId } }));
            var rows = bulk.GetProperty("results").EnumerateArray().ToDictionary(r => r.GetProperty("taskId").GetInt64());
            rows[s.U.T1].GetProperty("ok").GetBoolean().ShouldBeTrue("a task of an open type takes any assignee");
            rows[s.Task].GetProperty("ok").GetBoolean().ShouldBeFalse();
            rows[s.Task].GetProperty("code").GetString().ShouldBe(CannotAssign);
            bulk.GetProperty("changed").GetInt32().ShouldBe(1);
            return 0;
        });
    }

    [Fact]
    public async Task Bulk_update_reports_a_result_per_task_without_telling_a_hidden_task_from_a_missing_one()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            var priority = (await CurrentAsync(s, s.U.T1)).GetProperty("priority").GetProperty("priorityId").GetInt32();
            var high = (await OkAsync(await s.Admin.GetAsync("/api/v1/priorities"))).EnumerateArray().First(p => p.GetProperty("id").GetInt32() != priority).GetProperty("id").GetInt32();
            const long missing = 999_999_999;

            // The Viewer sees T3 (Secret) but may not edit it: the Open task changes, the Secret task is refused with the code; the call as a whole succeeds.
            var viewerRows = await OkAsync(await s.U.Viewer.PostAsJsonAsync($"/api/v1/matters/{s.U.Matter}/tasks/bulk", new { taskIds = new[] { s.U.T1, s.U.T3 }, priorityId = high }));
            var byId = viewerRows.GetProperty("results").EnumerateArray().ToDictionary(r => r.GetProperty("taskId").GetInt64());
            byId[s.U.T1].GetProperty("ok").GetBoolean().ShouldBeTrue();
            byId[s.U.T3].GetProperty("code").GetString().ShouldBe(ReadOnly);
            viewerRows.GetProperty("changed").GetInt32().ShouldBe(1);
            viewerRows.GetProperty("failed").GetInt32().ShouldBe(1);

            // The Outsider may not see the Secret tasks: a hidden id and a missing id give the same row.
            var outsider = await OkAsync(await s.U.Outsider.PostAsJsonAsync($"/api/v1/matters/{s.U.Matter}/tasks/bulk", new { taskIds = new[] { s.U.T4, s.U.T3, missing }, priorityId = priority }));
            var rows = outsider.GetProperty("results").EnumerateArray().ToDictionary(r => r.GetProperty("taskId").GetInt64());
            rows[s.U.T4].GetProperty("ok").GetBoolean().ShouldBeTrue();
            JsonSerializer.Serialize(new { code = rows[s.U.T3].GetProperty("code").GetString(), message = rows[s.U.T3].GetProperty("message").GetString() })
                .ShouldBe(JsonSerializer.Serialize(new { code = rows[missing].GetProperty("code").GetString(), message = rows[missing].GetProperty("message").GetString() }));
            return 0;
        });
    }

    // ---- empty lists, the switch, and the persona facts

    [Fact]
    public async Task An_empty_edit_list_lets_every_viewer_edit_and_an_empty_assign_list_lets_every_viewer_be_assigned()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            await s.U.RestrictAsync([s.U.ReviewerRole], [], []);
            var task = await CurrentAsync(s, s.Task);
            task = await OkAsync(await s.U.Viewer.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/priority", new { rowVersion = RowVersion(task), priorityId = task.GetProperty("priority").GetProperty("priorityId").GetInt32() }));
            task.GetProperty("allowedActions").GetProperty("readOnlyByType").GetBoolean().ShouldBeFalse();

            // The Viewer may be assigned (they may see the type); a person without the View role may not (they could not see the task).
            var ok = await OkAsync(await s.U.Viewer.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/assignment", new { rowVersion = RowVersion(task), userId = s.U.ViewerId }));
            ok.GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(s.U.ViewerId);
            (await SendAsync(await s.U.Viewer.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/assignment", new { rowVersion = RowVersion(ok), userId = s.U.PlainId }))).Body.ShouldContain(CannotAssign);
            return 0;
        }, lists: false);
    }

    [Fact]
    public async Task With_the_switch_off_the_lists_change_nothing()
    {
        await WithSceneAsync(sql, typeRule: false, async s =>
        {
            var task = await CurrentAsync(s, s.Task);
            task.GetProperty("allowedActions").GetProperty("readOnlyByType").GetBoolean().ShouldBeFalse();
            var viewerEdit = await OkAsync(await s.U.Viewer.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/assignment", new { rowVersion = RowVersion(task), userId = s.U.PlainId }));
            viewerEdit.GetProperty("assignedUser").GetProperty("userId").GetInt32().ShouldBe(s.U.PlainId);
            (await s.U.Plain.PostAsJsonAsync("/api/v1/tasks", s.U.H.NewTask(s.U.SecretWorld, false, "Anyone creates"))).StatusCode.ShouldBe(HttpStatusCode.Created);
            (await OkAsync(await s.U.Plain.GetAsync("/api/v1/task-types"))).EnumerateArray().Select(t => t.GetProperty("name").GetString()).ShouldContain(TaskTypeUniverse.SecretTypeName);
            return 0;
        });
    }

    [Fact]
    public async Task The_assignee_and_the_project_manager_have_no_exception_a_task_of_a_hidden_type_cannot_be_commented_or_changed()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            // T2 is assigned to the Outsider, who is also the primary project manager, and holds none of the roles.
            (await s.U.Outsider.PostAsJsonAsync($"/api/v1/tasks/{s.U.T2}/comments", new { bodyHtml = "<p>mine</p>" })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await s.U.Outsider.GetAsync($"/api/v1/tasks/{s.U.T2}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

            // A role holder who is not an Editor sees the task read-only: the allowed actions say so and the comment list carries no edit flag.
            var seen = await OkAsync(await s.U.Viewer.GetAsync($"/api/v1/tasks/{s.U.T3}"));
            var actions = seen.GetProperty("allowedActions");
            actions.GetProperty("readOnlyByType").GetBoolean().ShouldBeTrue();
            new[] { "canEdit", "canAssign", "canSetPriority", "canComment", "canExecuteSteps", "canReopenSteps" }.ShouldAllBe(k => !actions.GetProperty(k).GetBoolean());
            actions.GetProperty("transitions").EnumerateArray().ShouldAllBe(t => !t.GetProperty("permitted").GetBoolean() && t.GetProperty("blockedReason").GetString() == ReadOnly);
            var comments = await OkAsync(await s.U.Viewer.GetAsync($"/api/v1/tasks/{s.U.T3}/comments"));
            comments.GetProperty("items").EnumerateArray().ShouldAllBe(c => !c.GetProperty("canEdit").GetBoolean() && !c.GetProperty("canDelete").GetBoolean());

            // The editor of the type sees it editable, and so does the System Admin.
            (await OkAsync(await s.Editor.GetAsync($"/api/v1/tasks/{s.U.T3}"))).GetProperty("allowedActions").GetProperty("readOnlyByType").GetBoolean().ShouldBeFalse();
            (await OkAsync(await s.Admin.GetAsync($"/api/v1/tasks/{s.U.T3}"))).GetProperty("allowedActions").GetProperty("readOnlyByType").GetBoolean().ShouldBeFalse();
            return 0;
        });
    }

    [Fact]
    public async Task A_role_change_is_effective_on_the_next_request()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            (await s.U.Viewer.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/comments", new { bodyHtml = "<p>no</p>" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
            await s.U.H.Factory.GrantRoleAsync(@"KE\tviewer", s.EditorRole);
            (await s.U.Viewer.PostAsJsonAsync($"/api/v1/tasks/{s.Task}/comments", new { bodyHtml = "<p>now yes</p>" })).StatusCode.ShouldBe(HttpStatusCode.Created);
            return 0;
        });
    }

    // ---- creation list, pickers and the users lookup

    private static string[] Names(JsonElement list) => [.. list.EnumerateArray().Select(t => t.GetProperty("name").GetString()!)];

    [Fact]
    public async Task The_task_type_list_names_only_the_types_the_person_may_see_and_the_create_list_only_those_they_may_create()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            var secret = TaskTypeUniverse.SecretTypeName;
            (Names(await OkAsync(await s.U.Plain.GetAsync("/api/v1/task-types")))).ShouldNotContain(secret);
            Names(await OkAsync(await s.U.Outsider.GetAsync("/api/v1/task-types"))).ShouldNotContain(secret);
            Names(await OkAsync(await s.U.Viewer.GetAsync("/api/v1/task-types"))).ShouldContain(secret);
            Names(await OkAsync(await s.U.Viewer.GetAsync("/api/v1/task-types?creatableOnly=true"))).ShouldNotContain(secret, "a viewer who is not an editor cannot create the type");
            Names(await OkAsync(await s.Editor.GetAsync("/api/v1/task-types?creatableOnly=true"))).ShouldContain(secret);
            Names(await OkAsync(await s.Admin.GetAsync("/api/v1/task-types?creatableOnly=true"))).ShouldContain(secret);

            // The detail: a hidden type is the 404 of a missing id, byte for byte.
            var hidden = await SendAsync(await s.U.Plain.GetAsync($"/api/v1/task-types/{s.U.SecretTypeId}"));
            var missing = await SendAsync(await s.U.Plain.GetAsync("/api/v1/task-types/987654"));
            hidden.Status.ShouldBe(HttpStatusCode.NotFound);
            TaskTypeUniverse.WithoutTrace(hidden.Body).ShouldBe(TaskTypeUniverse.WithoutTrace(missing.Body));
            (await s.U.Viewer.GetAsync($"/api/v1/task-types/{s.U.SecretTypeId}")).StatusCode.ShouldBe(HttpStatusCode.OK);

            // A manager without the View role sees every type on the admin list with the access object, and only the viewable ones when a picker asks.
            var manager = await s.U.H.UserWithAsync(@"KE\tmanager", "Task.View", "TaskType.Manage", "Matter.View");
            var all = await OkAsync(await manager.GetAsync("/api/v1/task-types"));
            Names(all).ShouldContain(secret);
            all.EnumerateArray().First(t => t.GetProperty("name").GetString() == secret).GetProperty("access").ValueKind.ShouldBe(JsonValueKind.Object);
            Names(await OkAsync(await manager.GetAsync("/api/v1/task-types?visibleOnly=true"))).ShouldNotContain(secret);
            return 0;
        });
    }

    [Fact]
    public async Task Creating_a_task_needs_a_type_the_person_may_edit_and_a_hidden_type_is_a_missing_one()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            var hidden = await SendAsync(await s.U.Plain.PostAsJsonAsync("/api/v1/tasks", s.U.H.NewTask(s.U.SecretWorld, false, "Probe")));
            hidden.Status.ShouldBe(HttpStatusCode.BadRequest);
            hidden.Body.ShouldContain("Select a task type.");
            hidden.Body.ShouldNotContain(ReadOnly);

            var readOnly = await SendAsync(await s.U.Viewer.PostAsJsonAsync("/api/v1/tasks", s.U.H.NewTask(s.U.SecretWorld, false, "Probe")));
            readOnly.Status.ShouldBe(HttpStatusCode.BadRequest);
            readOnly.Body.ShouldContain(ReadOnly);

            (await s.U.Plain.PostAsJsonAsync("/api/v1/tasks", s.U.H.NewTask(s.U.OpenWorld, false, "Open type"))).StatusCode.ShouldBe(HttpStatusCode.Created);
            (await s.Admin.PostAsJsonAsync("/api/v1/tasks", s.U.H.NewTask(s.U.SecretWorld, false, "Admin creates"))).StatusCode.ShouldBe(HttpStatusCode.Created);
            return 0;
        });
    }

    [Fact]
    public async Task The_users_lookup_offers_only_the_people_the_type_allows_and_nobody_for_a_hidden_type()
    {
        await WithSceneAsync(sql, typeRule: true, async s =>
        {
            string[] Ids(JsonElement list) => [.. list.EnumerateArray().Select(u => u.GetProperty("userId").GetInt32().ToString())];
            var type = s.U.SecretTypeId;

            var assignable = Ids(await OkAsync(await s.Editor.GetAsync($"/api/v1/users/lookup?assignable=true&taskTypeId={type}&limit=50")));
            assignable.ShouldContain(s.AssigneeId.ToString());
            assignable.ShouldNotContain(s.AdminId.ToString(), "no admin exception while the Assign list is not empty");
            assignable.ShouldNotContain(s.U.PlainId.ToString());
            assignable.ShouldNotContain(s.U.ViewerId.ToString());

            var openType = Ids(await OkAsync(await s.Editor.GetAsync($"/api/v1/users/lookup?assignable=true&taskTypeId={s.U.OpenWorld.TaskTypeId}&limit=50")));
            openType.ShouldContain(s.U.PlainId.ToString());
            Ids(await OkAsync(await s.Editor.GetAsync("/api/v1/users/lookup?assignable=true&limit=50"))).ShouldContain(s.U.PlainId.ToString());

            // The same, as a person who may not see the type: an empty list.
            (await OkAsync(await s.U.Outsider.GetAsync($"/api/v1/users/lookup?assignable=true&taskTypeId={type}&limit=50"))).GetArrayLength().ShouldBe(0);

            // An empty Assign list: whoever may see the type (the admin too), not the person without a role.
            await s.U.RestrictAsync([s.U.ReviewerRole], [s.EditorRole], []);
            var everyone = Ids(await OkAsync(await s.Editor.GetAsync($"/api/v1/users/lookup?assignable=true&taskTypeId={type}&limit=50")));
            everyone.ShouldContain(s.U.ViewerId.ToString());
            everyone.ShouldContain(s.AdminId.ToString());
            everyone.ShouldContain(s.EditorId.ToString());
            everyone.ShouldNotContain(s.U.PlainId.ToString());
            return 0;
        });
    }
}
