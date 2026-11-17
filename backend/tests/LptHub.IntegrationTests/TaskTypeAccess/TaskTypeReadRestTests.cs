using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using LptHub.IntegrationTests.Tasks;
using LptHub.Notifications.Infrastructure.Scheduling;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.TaskTypeAccess;

/// <summary>
/// Task Type access, read side, the rest of the inventory (epic #1397, issue #1400, rows M, O, S, N, F, K11 and K9): My Matters, the matter, project and client counts, search, notifications,
/// audit, assets reached through an assignment, and the matter deactivation message. A person with none of the Can View roles gets no rows, no counts and no sentinel; the role holder and
/// the System Admin do.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeReadRestTests(SqlServerFixture sql)
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static async Task<T> WithUniverseAsync<T>(SqlServerFixture sql, Func<TaskTypeUniverse, Task<T>> body, bool typeRule = true, bool sensitiveRule = false, bool restrict = true)
    {
        var u = await TaskTypeUniverse.BuildAsync(sql, typeRule, sensitiveRule, restrict);
        try
        {
            return await body(u);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    private static async Task<string> TextAsync(HttpClient client, string url) => await (await client.GetAsync(url)).Content.ReadAsStringAsync();

    private static bool Leaks(string text) => text.Contains(TaskTypeUniverse.Sentinel, StringComparison.OrdinalIgnoreCase);

    [Fact]
    public async Task My_matters_counts_lists_and_events_leave_out_the_tasks_of_hidden_types_even_for_the_project_manager()
    {
        await WithUniverseAsync(sql, async u =>
        {
            // Outsider is the primary manager of the matter: the My Matters scope is theirs, and still the three restricted tasks are not.
            var mine = await GetAsync(u.Outsider, "/api/v1/my-matters/task-counts");
            mine.GetProperty("byStatus").GetProperty("allOpen").GetInt32().ShouldBe(3);
            mine.GetProperty("byShow").GetProperty("everything").GetInt32().ShouldBe(3);
            mine.GetProperty("byShow").GetProperty("unassigned").GetInt32().ShouldBe(1, "T1 only: T3 is unassigned but hidden");
            (await GetAsync(u.Outsider, "/api/v1/my-matters/workload")).GetProperty("open").GetInt32().ShouldBe(3, "T1, T4 and T5: the three hidden tasks are not workload");

            // The role holder and the System Admin, through the all scope, see all six.
            foreach (var client in new[] { u.Viewer, u.H.Admin })
            {
                (await GetAsync(client, "/api/v1/my-matters/task-counts?scope=all")).GetProperty("byStatus").GetProperty("allOpen").GetInt32().ShouldBe(6);
                (await GetAsync(client, "/api/v1/my-matters/workload?scope=all")).GetProperty("open").GetInt32().ShouldBe(6);
            }

            // Every one of the eleven section endpoints, as each person without the role, carries nothing of the type.
            string[] sections = ["summary", "health", "attention", "deadlines", "workload", "task-counts", "breakdown", "tree", "calendar", "since-last-visit", "feed", "activity", "assets", "events", "events/upcoming"];
            foreach (var (name, client) in new[] { ("Outsider", u.Outsider), ("Plain", u.Plain), ("Sensitive holder", u.SensitiveHolder) })
            {
                foreach (var section in sections)
                    Leaks(await TextAsync(client, $"/api/v1/my-matters/{section}?scope=all")).ShouldBeFalse($"{name}: my-matters/{section}");
            }

            // Positive control: the role holder reaches the sentinel in the feed or the attention list.
            var texts = await Task.WhenAll(new[] { "feed", "attention", "deadlines", "activity" }.Select(s => TextAsync(u.Viewer, $"/api/v1/my-matters/{s}?scope=all")));
            texts.Any(Leaks).ShouldBeTrue("the role holder sees the restricted tasks in My Matters");
            return 0;
        });
    }

    [Fact]
    public async Task Matter_project_and_client_counts_and_state_badges_come_from_the_visible_tasks()
    {
        await WithUniverseAsync(sql, async u =>
        {
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'ON_HOLD' WHERE TaskId IN ({u.T3}, {u.T4})");
            u.H.Factory.InvalidateAll();
            var clientId = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.Matter}")).GetProperty("clientId").GetInt32();

            foreach (var (name, client, open, onHold) in new[] { ("Outsider", u.Outsider, 3, 1), ("Plain", u.Plain, 3, 1), ("Sensitive holder", u.SensitiveHolder, 3, 1), ("Viewer", u.Viewer, 6, 2), ("System Admin", u.H.Admin, 6, 2) })
            {
                (await GetAsync(client, $"/api/v1/matters/{u.Matter}")).GetProperty("openTaskCount").GetInt32().ShouldBe(open, name + ": matter detail");
                var row = (await GetAsync(client, "/api/v1/matters?pageSize=100")).GetProperty("items").EnumerateArray().Single(i => i.GetProperty("matterId").GetInt32() == u.Matter);
                row.GetProperty("openTaskCount").GetInt32().ShouldBe(open, name + ": matter list");
                row.GetProperty("onHoldTaskCount").GetInt32().ShouldBe(onHold, name + ": matter list on-hold badge");
                (await GetAsync(client, $"/api/v1/projects/{u.Project}")).GetProperty("openTaskCount").GetInt32().ShouldBe(open, name + ": project detail");
                (await GetAsync(client, $"/api/v1/clients/{clientId}")).GetProperty("openTaskCount").GetInt32().ShouldBe(open, name + ": client detail");
                var queueTotal = (await GetAsync(client, $"/api/v1/task-queue?pageSize=1&matter={u.Matter}&status=NEW&status=IN_PROGRESS&status=ON_HOLD")).GetProperty("total").GetInt32();
                queueTotal.ShouldBe(open, name + ": the count equals the list it opens");
            }

            return 0;
        });
    }

    [Fact]
    public async Task Search_finds_a_restricted_task_only_for_who_may_see_its_type()
    {
        await WithUniverseAsync(sql, async u =>
        {
            foreach (var (name, client, sees) in new[] { ("Outsider", u.Outsider, false), ("Plain", u.Plain, false), ("Sensitive holder", u.SensitiveHolder, false), ("Viewer", u.Viewer, true), ("System Admin", u.H.Admin, true) })
            {
                foreach (var url in new[] { "/api/v1/search?q=secret&limit=50", "/api/v1/search/advanced?type=task&q=secret&pageSize=100", "/api/v1/search/advanced?type=task&pageSize=100" })
                {
                    var text = await TextAsync(client, url);
                    Leaks(text).ShouldBe(sees, $"{name}: {url}");
                }

                var advanced = await GetAsync(client, "/api/v1/search/advanced?type=task&pageSize=100");
                advanced.GetProperty("total").GetInt32().ShouldBe(sees ? 6 : 3, name + ": the task count of the advanced search");
            }

            return 0;
        });
    }

    [Fact]
    public async Task Notifications_are_not_created_for_a_recipient_who_may_not_see_the_type_and_disappear_when_access_ends()
    {
        await WithUniverseAsync(sql, async u =>
        {
            static async Task<int> UnreadAsync(HttpClient c) => (await GetAsync(c, "/api/v1/me/notifications/poll?initial=true")).GetProperty("unreadCount").GetInt32();
            static async Task<int> TotalAsync(HttpClient c) => (await GetAsync(c, "/api/v1/me/notifications")).GetProperty("totalCount").GetInt32();

            async Task AssignAsync(long task, int userId)
            {
                var fresh = await u.H.GetTaskAsync(task);
                await OkAsync(await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{task}/assignment", new { rowVersion = RowVersion(fresh), userId, podId = (int?)null }));
            }

            // Producer: assigning a task of the restricted type to a person without the role tells them nothing (the assignee is no exception); assigning an open task does.
            // (Since issue #1401 the API refuses that assignment outright: USER_CANNOT_ASSIGN_TYPE; the producer's own recipient check stays as the second line.)
            var refused = await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.T3}/assignment", new { rowVersion = RowVersion(await u.H.GetTaskAsync(u.T3)), userId = u.PlainId, podId = (int?)null });
            refused.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
            (await TotalAsync(u.Plain)).ShouldBe(0);
            await AssignAsync(u.T1, u.PlainId);
            (await TotalAsync(u.Plain)).ShouldBe(1);
            await AssignAsync(u.T3, u.ViewerId);
            (await TotalAsync(u.Viewer)).ShouldBe(1);

            // Read: a notification created while the type was open is hidden at once when the type is restricted, and comes back when it is opened again.
            await u.RestrictAsync([]);
            await AssignAsync(u.T3, u.PlainId);
            (await TotalAsync(u.Plain)).ShouldBe(2);
            (await UnreadAsync(u.Plain)).ShouldBe(2);
            await u.RestrictAsync([u.ReviewerRole]);
            (await TotalAsync(u.Plain)).ShouldBe(1);
            (await UnreadAsync(u.Plain)).ShouldBe(1);
            var items = (await GetAsync(u.Plain, "/api/v1/me/notifications?pageSize=100")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("objectId").GetInt64()).ToArray();
            items.ShouldBe([u.T1]);
            Leaks(await TextAsync(u.Plain, "/api/v1/me/notifications?pageSize=100")).ShouldBeFalse();
            await u.RestrictAsync([]);
            (await TotalAsync(u.Plain)).ShouldBe(2);
            return 0;
        });
    }

    [Fact]
    public async Task Audit_events_lists_search_and_facets_leave_out_the_events_of_tasks_of_hidden_types()
    {
        await WithUniverseAsync(sql, async u =>
        {
            foreach (var (name, client, sees) in new[] { ("Outsider (assignee of T2)", u.Outsider, false), ("Plain", u.Plain, false), ("Viewer", u.Viewer, true), ("System Admin", u.H.Admin, true) })
            {
                foreach (var task in u.SecretTasks)
                {
                    var events = await GetAsync(client, $"/api/v1/audit/events?objectType=Task&objectId={task}");
                    (events.GetProperty("items").GetArrayLength() > 0).ShouldBe(sees, $"{name}: events of task {task}");
                }

                var openEvents = await GetAsync(client, $"/api/v1/audit/events?objectType=Task&objectId={u.T1}");
                openEvents.GetProperty("items").GetArrayLength().ShouldBeGreaterThan(0, name + ": the open task's events stay");
                Leaks(await TextAsync(client, "/api/v1/audit/search?pageSize=200")).ShouldBe(sees, name + ": audit search");
            }

            // The facet values: an event type that exists only on a hidden task is not offered to a person who may not see it.
            (await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.T3}/comments", new { bodyHtml = "<p>only here</p>" })).EnsureSuccessStatusCode();
            var viewerFacets = (await GetAsync(u.Viewer, "/api/v1/audit/facets")).GetProperty("eventTypes").EnumerateArray().Select(e => e.GetString()).ToList();
            var outsiderFacets = (await GetAsync(u.Outsider, "/api/v1/audit/facets")).GetProperty("eventTypes").EnumerateArray().Select(e => e.GetString()).ToList();
            viewerFacets.Count.ShouldBeGreaterThan(0);
            viewerFacets.ShouldContain("COMMENT_ADDED", "the only comment events are on hidden tasks: the role holder is offered the value");
            outsiderFacets.ShouldNotContain("COMMENT_ADDED", "an event type that exists only on hidden tasks is not offered");
            return 0;
        });
    }

    [Fact]
    public async Task The_matter_deactivation_block_stays_but_names_no_hidden_task_and_no_hidden_number()
    {
        await WithUniverseAsync(sql, async u =>
        {
            async Task<JsonElement> RefuseAsync(HttpClient client)
            {
                var matter = await GetAsync(client, $"/api/v1/matters/{u.Matter}");
                var response = await client.PostAsJsonAsync($"/api/v1/matters/{u.Matter}/active", new { isActive = false, rowVersion = matter.GetProperty("rowVersion").GetString() });
                response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
                return await ReadAsync(response);
            }

            // Three visible open tasks and three hidden ones.
            var asOutsider = await RefuseAsync(u.Outsider);
            asOutsider.GetProperty("detail").GetString().ShouldBe("This matter has 3 tasks that aren't Completed or Cancelled, and other tasks you can't see. Finish or cancel them first.");
            asOutsider.GetProperty("meta").GetProperty("openTaskCount").GetInt32().ShouldBe(3);
            (await RefuseAsync(u.Viewer)).GetProperty("detail").GetString().ShouldBe("This matter has 6 tasks that aren't Completed or Cancelled. Finish or cancel them first.");
            (await RefuseAsync(u.H.Admin)).GetProperty("meta").GetProperty("openTaskCount").GetInt32().ShouldBe(6);

            // Only hidden tasks are open: the block stays and says so without a number.
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'COMPLETED', CompletedAt = SYSUTCDATETIME() WHERE TaskId IN ({u.T1}, {u.T4}, {u.T5})");
            u.H.Factory.InvalidateAll();
            var onlyHidden = await RefuseAsync(u.Outsider);
            onlyHidden.GetProperty("detail").GetString().ShouldBe("This matter has tasks you can't see that aren't Completed or Cancelled. Finish or cancel them first.");
            onlyHidden.GetProperty("meta").GetProperty("openTaskCount").GetInt32().ShouldBe(0);
            return 0;
        });
    }

    [Fact]
    public async Task An_asset_is_not_reached_through_an_assignment_of_a_task_of_a_hidden_type()
    {
        // Both rules on: the matter is sensitive, so a person who only holds an assigned task reaches the task's assets (mode A). That reach stops for a hidden type.
        await WithUniverseAsync(sql, sensitiveRule: true, body: async u =>
        {
            await u.H.ExecuteAsync($"UPDATE dbo.Matter SET IsSensitive = 1 WHERE MatterId = {u.Matter}");
            var type = await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Reach type" }), HttpStatusCode.Created);
            var typeId = type.GetProperty("assetTypeId").GetInt32();
            async Task<int> AssetAsync(string name, long task)
            {
                var asset = (await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = u.Matter, assetTypeId = typeId, displayName = name }), HttpStatusCode.Created)).GetProperty("assetId").GetInt32();
                (await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{task}/assets", new { assetId = asset })).EnsureSuccessStatusCode();
                return asset;
            }

            var openAsset = await AssetAsync("Reach of the open task", u.T5);
            var hiddenAsset = await AssetAsync("Reach of the hidden task", u.T6);
            u.H.Factory.InvalidateAll();

            // Tech is the assignee of T5 (open) and T6 (restricted) and manages nothing: the open task's asset opens, the restricted one answers like a missing asset.
            (await u.Tech.GetAsync($"/api/v1/assets/{openAsset}")).StatusCode.ShouldBe(HttpStatusCode.OK);
            var hidden = await u.Tech.GetAsync($"/api/v1/assets/{hiddenAsset}");
            hidden.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            var missing = await u.Tech.GetAsync("/api/v1/assets/99999999");
            TaskTypeUniverse.WithoutTrace(await hidden.Content.ReadAsStringAsync()).Replace(hiddenAsset.ToString(), "ID", StringComparison.Ordinal).ShouldBe(TaskTypeUniverse.WithoutTrace(await missing.Content.ReadAsStringAsync()).Replace("99999999", "ID", StringComparison.Ordinal));
            var list = await GetAsync(u.Tech, "/api/v1/assets?pageSize=100");
            list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("assetId").GetInt32()).ShouldBe([openAsset]);

            // The role holder holds neither the matter (it is sensitive) nor an assignment: the asset is hidden from them on the matter rule. The project manager reaches the asset through the matter but never the hidden task.
            (await u.Viewer.GetAsync($"/api/v1/assets/{hiddenAsset}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            var asOutsider = await GetAsync(u.Outsider, $"/api/v1/assets/{hiddenAsset}");
            asOutsider.GetProperty("linkedTaskCount").GetInt32().ShouldBe(0);
            Leaks(await TextAsync(u.Outsider, $"/api/v1/assets/{hiddenAsset}/linked-tasks")).ShouldBeFalse();
            (await GetAsync(u.H.Admin, $"/api/v1/assets/{hiddenAsset}")).GetProperty("linkedTaskCount").GetInt32().ShouldBe(1);
            return 0;
        });
    }

    [Fact]
    public async Task The_scheduler_jobs_notify_nobody_about_a_task_of_a_hidden_type_not_even_its_assignee_or_the_matters_manager()
    {
        await WithUniverseAsync(sql, async u =>
        {
            // A person without the View role can no longer be given a task of the restricted type (issue #1401), so the "assignee who lost access" is made the way it happens: the task is assigned
            // in the database after the fact (the stranded work of design 9.5).
            async Task<long> OverdueAsync(TaskHarness.World world, int assignee)
            {
                var id = TaskId(await u.H.CreateTaskAsync(world, false, new() { ["matterId"] = u.Matter, ["projectId"] = u.Project, ["dueDate"] = "2026-01-05" }));
                await u.H.ExecuteAsync($"UPDATE dbo.Task SET AssignedUserId = {assignee}, StatusCode = 'IN_PROGRESS' WHERE TaskId = {id}");
                return id;
            }

            var openOverdue = await OverdueAsync(u.OpenWorld, u.OutsiderId);
            var secretOverdue = await OverdueAsync(u.SecretWorld, u.OutsiderId);
            var techSecretOverdue = await OverdueAsync(u.SecretWorld, u.TechId);
            await using (var scope = u.H.Factory.Services.CreateAsyncScope())
            {
                var run = await scope.ServiceProvider.GetRequiredService<NotificationScheduler>().RunOnceAsync(default, true);
                run.Failed.ShouldBeEmpty();
            }

            static async Task<long[]> ObjectsAsync(HttpClient c) => [.. (await GetAsync(c, "/api/v1/me/notifications?pageSize=100")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("objectId").GetInt64()).Order()];

            // Outsider is the assignee and the primary manager: told about the open overdue task, never about the hidden one.
            var outsider = await ObjectsAsync(u.Outsider);
            outsider.ShouldContain(openOverdue);
            outsider.ShouldNotContain(secretOverdue);
            outsider.ShouldNotContain(techSecretOverdue);
            (await ObjectsAsync(u.Tech)).ShouldNotContain(techSecretOverdue);
            var rows = await u.H.Factory.WithDbAsync(db => db.Set<LptHub.Notifications.Domain.Notification>().Where(n => n.EventType == "TaskDue" || n.EventType == "MatterTaskOverdue").ToListAsync());
            rows.Count.ShouldBeGreaterThan(0);
            rows.ShouldAllBe(n => n.ObjectId != secretOverdue && n.ObjectId != techSecretOverdue);
            return 0;
        });
    }

    [Fact]
    public async Task The_landing_page_probe_ignores_an_open_assignment_of_a_hidden_type()
    {
        await WithUniverseAsync(sql, async u =>
        {
            // Outsider holds T4 (open) and T2 (hidden): the visible one keeps them on the My Work landing page.
            (await GetAsync(u.Outsider, "/api/v1/me")).GetProperty("hasWork").GetBoolean().ShouldBeTrue();

            // Plain holds only a hidden assignment: it must not steer the landing page; the role holder with the same assignment does have work.
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET AssignedUserId = {u.PlainId} WHERE TaskId = {u.T3}");
            u.H.Factory.InvalidateAll();
            (await GetAsync(u.Plain, "/api/v1/me")).GetProperty("hasWork").GetBoolean().ShouldBeFalse("a hidden assigned task does not count as open work");
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET AssignedUserId = {u.ViewerId} WHERE TaskId = {u.T3}");
            u.H.Factory.InvalidateAll();
            (await GetAsync(u.Viewer, "/api/v1/me")).GetProperty("hasWork").GetBoolean().ShouldBeTrue();
            return 0;
        });
    }
}
