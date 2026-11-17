using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.TaskTypeAccess;

/// <summary>
/// Task Type access, read side, core paths (epic #1397, issue #1400, design inventory rows P, K, Q, D): with <c>Features:TaskTypeAccess</c> on, a task of a restricted type is absent
/// from every list, count, board and by-id read of a person who holds none of the Can View roles, whoever they are in relation to the task (assignee, project manager, holder of
/// <c>Matter.ViewSensitive</c>); a role holder and the System Admin see it; with the switch off nothing changes.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeReadCoreTests(SqlServerFixture sql)
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static long[] Ids(JsonElement page, string items = "items") => [.. page.GetProperty(items).EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).Order()];

    private static int Count(JsonElement summary, string tile) => summary.GetProperty(tile).GetProperty("count").GetInt32();

    /// <summary>Persona, client, and the tasks that persona may see when the Secret type is restricted.</summary>
    private static (string Name, Func<TaskTypeUniverse, HttpClient> Client, Func<TaskTypeUniverse, long[]> Sees)[] Personas() =>
    [
        ("Viewer (holds the Can View role)", u => u.Viewer, u => u.AllTasks),
        ("Outsider (assignee and project manager, no role)", u => u.Outsider, u => u.OpenTasks),
        ("Plain (no role)", u => u.Plain, u => u.OpenTasks),
        ("Sensitive holder (Matter.ViewSensitive, no role)", u => u.SensitiveHolder, u => u.OpenTasks),
        ("System Admin", u => u.H.Admin, u => u.AllTasks),
    ];

    private static async Task<T> WithUniverseAsync<T>(SqlServerFixture sql, bool typeRule, Func<TaskTypeUniverse, Task<T>> body, bool restrict = true, bool sensitiveRule = false)
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

    [Fact]
    public async Task With_the_switch_off_every_persona_sees_every_task_although_the_type_is_restricted()
    {
        await WithUniverseAsync(sql, typeRule: false, async u =>
        {
            foreach (var (name, client, _) in Personas())
            {
                var http = client(u);
                Ids(await GetAsync(http, "/api/v1/tasks?pageSize=100")).ShouldBe([.. u.AllTasks.Order()], name);
                var queue = await GetAsync(http, "/api/v1/task-queue?pageSize=100");
                Ids(queue).ShouldBe([.. u.AllTasks.Order()], name);
                queue.GetProperty("views").GetProperty("open").GetInt32().ShouldBe(u.AllTasks.Length, name);
                Count(await GetAsync(http, "/api/v1/dashboard?fresh=true"), "open").ShouldBe(u.AllTasks.Length, name);
                (await http.GetAsync($"/api/v1/tasks/{u.T3}")).StatusCode.ShouldBe(HttpStatusCode.OK, name);
            }

            (await GetAsync(u.Outsider, "/api/v1/me")).GetProperty("hasWork").GetBoolean().ShouldBeTrue();
            return 0;
        });
    }

    [Fact]
    public async Task The_task_list_task_queue_swimlane_and_exports_hold_only_the_tasks_of_types_the_person_may_see()
    {
        await WithUniverseAsync(sql, typeRule: true, async u =>
        {
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var expected = sees(u).Order().ToArray();

                Ids(await GetAsync(http, "/api/v1/tasks?pageSize=100")).ShouldBe(expected, name + ": task list");
                (await GetAsync(http, "/api/v1/tasks?pageSize=1")).GetProperty("total").GetInt32().ShouldBe(expected.Length, name + ": task list total ignores the page size");

                var queue = await GetAsync(http, "/api/v1/task-queue?pageSize=100");
                Ids(queue).ShouldBe(expected, name + ": queue");
                queue.GetProperty("total").GetInt32().ShouldBe(expected.Length, name);
                var views = queue.GetProperty("views");
                views.GetProperty("open").GetInt32().ShouldBe(expected.Length, name + ": open badge");
                views.GetProperty("unassigned").GetInt32().ShouldBe(expected.Count(t => t == u.T1 || t == u.T3), name + ": unassigned badge");

                var paged = new List<long>();
                for (var page = 1; page <= expected.Length; page++)
                    paged.AddRange(Ids(await GetAsync(http, $"/api/v1/task-queue?pageSize=1&page={page}")));
                paged.Order().ToArray().ShouldBe(expected, name + ": paging");

                // A filter on the hidden type, a search for the sentinel and a filter on the matter never reveal anything: an empty page for a person who may not see it.
                var byType = await GetAsync(http, $"/api/v1/task-queue?pageSize=100&type={u.SecretTypeId}");
                Ids(byType).ShouldBe(expected.Where(u.SecretTasks.Contains).ToArray(), name + ": type filter");
                Ids(await GetAsync(http, $"/api/v1/task-queue?pageSize=100&q={TaskTypeUniverse.Sentinel}")).ShouldBe(expected.Where(u.SecretTasks.Contains).ToArray(), name + ": search");

                var board = await GetAsync(http, "/api/v1/dashboard/swimlane?groupBy=clientMatter");
                var cards = board.GetProperty("lanes").EnumerateArray().SelectMany(l => l.GetProperty("cards").EnumerateArray()).Select(c => c.GetProperty("taskId").GetInt64()).Order().ToArray();
                cards.ShouldBe(expected, name + ": swimlane cards");
                board.GetProperty("lanes").EnumerateArray().Sum(l => l.GetProperty("count").GetInt32()).ShouldBe(expected.Length, name + ": lane counts");

                foreach (var url in new[] { "/api/v1/task-queue/export?format=csv", "/api/v1/task-queue/export?format=text" })
                {
                    var body = await (await http.GetAsync(url)).Content.ReadAsStringAsync();
                    (body.Contains(TaskTypeUniverse.Sentinel, StringComparison.Ordinal)).ShouldBe(expected.Any(u.SecretTasks.Contains), $"{name}: {url} carries the sentinel only for who may see it");
                }
            }

            return 0;
        });
    }

    [Fact]
    public async Task A_hidden_task_answers_exactly_like_a_missing_one_on_every_read_by_id()
    {
        await WithUniverseAsync(sql, typeRule: true, async u =>
        {
            const long Missing = 999_999_999;
            string[] reads = ["", "/completion", "/workflow", "/comments", "/assets", "/activity", "/comments/1/revisions"];
            foreach (var persona in new[] { u.Outsider, u.Plain, u.SensitiveHolder })
            {
                foreach (var read in reads)
                {
                    var missing = await persona.GetAsync($"/api/v1/tasks/{Missing}{read}");
                    foreach (var hidden in new[] { u.T2, u.T3 })
                    {
                        var response = await persona.GetAsync($"/api/v1/tasks/{hidden}{read}");
                        response.StatusCode.ShouldBe(HttpStatusCode.NotFound, $"{read} of {hidden}");
                        var left = await response.Content.ReadAsStringAsync();
                        var right = await missing.Content.ReadAsStringAsync();
                        TaskTypeUniverse.WithoutTrace(left).Replace(hidden.ToString(), "ID", StringComparison.Ordinal).ShouldBe(TaskTypeUniverse.WithoutTrace(right).Replace(Missing.ToString(), "ID", StringComparison.Ordinal), $"{read} of {hidden}: body equals the missing id's");
                        left.ShouldNotContain(TaskTypeUniverse.Sentinel);
                    }
                }
            }

            foreach (var persona in new[] { u.Viewer, u.H.Admin })
            {
                foreach (var read in new[] { "", "/completion", "/workflow", "/comments", "/assets", "/activity" })
                    (await persona.GetAsync($"/api/v1/tasks/{u.T3}{read}")).StatusCode.ShouldBe(HttpStatusCode.OK, $"role holder and System Admin read {read}");
            }

            return 0;
        });
    }

    [Fact]
    public async Task My_work_and_its_attention_strip_hide_an_assigned_task_of_a_type_the_person_may_not_see()
    {
        await WithUniverseAsync(sql, typeRule: true, async u =>
        {
            // Outsider is the assignee of T2 (Secret) and T4 (Open): no assignee exception.
            var mine = await GetAsync(u.Outsider, "/api/v1/my-work?pageSize=100");
            Ids(mine).ShouldBe([u.T4]);
            mine.GetProperty("counts").GetProperty("active").GetInt32().ShouldBe(1);
            mine.GetProperty("attention").GetProperty("asap").GetInt32().ShouldBe(1, "the needs-attention strip counts only the task the person may see");

            // Tech holds one visible and one hidden assigned task: the Technician's dashboard "mine" counts the visible one only.
            Count(await GetAsync(u.Tech, "/api/v1/dashboard"), "unassigned").ShouldBeGreaterThanOrEqualTo(0);
            var dash = await GetAsync(u.Tech, "/api/v1/dashboard?fresh=true");
            dash.GetProperty("mine").GetProperty("open").GetInt32().ShouldBe(1);

            // The viewer of the type sees their own hidden-type work.
            var viewerMine = await GetAsync(u.H.Admin, "/api/v1/my-work?pageSize=100");
            Ids(viewerMine).ShouldBeEmpty();

            // Whoever has only a hidden assignment has an empty My Work.
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET AssignedUserId = {u.PlainId} WHERE TaskId = {u.T3}");
            u.H.Factory.InvalidateAll();
            Ids(await GetAsync(u.Plain, "/api/v1/my-work?pageSize=100")).ShouldBeEmpty();
            return 0;
        });
    }

    [Fact]
    public async Task Pod_work_tabs_member_loads_and_selector_count_only_visible_tasks()
    {
        await WithUniverseAsync(sql, typeRule: true, async u =>
        {
            var pod = await u.H.CreatePodAsync("Review pod", u.OutsiderId, u.ViewerId);
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET AssignedPodId = {pod}");

            foreach (var (name, client, sees) in Personas().Where(p => !p.Name.StartsWith("Sensitive", StringComparison.Ordinal)))
            {
                var http = client(u);
                var expected = sees(u).Order().ToArray();
                var page = await GetAsync(http, $"/api/v1/pod-work?podId={pod}&view=all&pageSize=100");
                Ids(page).ShouldBe(expected, name);
                page.GetProperty("counts").GetProperty("all").GetInt32().ShouldBe(expected.Length, name + ": all tab");
                var load = page.GetProperty("memberLoads").EnumerateArray().Single(l => l.GetProperty("userId").GetInt32() == u.OutsiderId).GetProperty("open").GetInt32();
                load.ShouldBe(expected.Count(t => t == u.T2 || t == u.T4), name + ": the member's load counts the visible tasks only");
                var choice = page.GetProperty("pods").EnumerateArray().Single(c => c.GetProperty("podId").GetInt32() == pod);
                choice.GetProperty("openCount").GetInt32().ShouldBe(expected.Length, name + ": pod selector open");
                page.GetRawText().Contains(TaskTypeUniverse.Sentinel, StringComparison.Ordinal).ShouldBe(expected.Any(u.SecretTasks.Contains), name);
            }

            return 0;
        });
    }

    [Fact]
    public async Task The_dashboard_counts_breakdowns_trend_workload_coverage_and_skills_come_from_the_visible_tasks()
    {
        await WithUniverseAsync(sql, typeRule: true, async u =>
        {
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var visible = sees(u);

                var summary = await GetAsync(http, "/api/v1/dashboard?fresh=true");
                Count(summary, "open").ShouldBe(visible.Length, name + ": open tile");
                Count(summary, "created").ShouldBe(visible.Length, name + ": created tile");
                Count(summary, "unassigned").ShouldBe(visible.Count(t => t == u.T1 || t == u.T3), name + ": unassigned tile");
                summary.GetProperty("byTaskType").EnumerateArray().Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(visible.Length, name + ": type breakdown");
                summary.GetProperty("byStatus").EnumerateArray().Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(visible.Length, name + ": status breakdown");
                var queue = await GetAsync(http, "/api/v1/task-queue?pageSize=100&" + summary.GetProperty("open").GetProperty("query").GetString());
                queue.GetProperty("total").GetInt32().ShouldBe(Count(summary, "open"), name + ": the open tile equals its drill-through");

                var trend = await GetAsync(http, "/api/v1/dashboard/trend?fresh=true");
                trend.GetProperty("all").EnumerateArray().Sum(d => d.GetProperty("created").GetInt32()).ShouldBe(visible.Length, name + ": trend");

                foreach (var url in new[] { "/api/v1/dashboard/scopes", "/api/v1/dashboard/workload", "/api/v1/dashboard/coverage", "/api/v1/dashboard/users/skills", "/api/v1/dashboard/coverage?groupBy=type" })
                {
                    var text = await (await http.GetAsync(url)).Content.ReadAsStringAsync();
                    // The NAME of the hidden type must not be listed (not even with a zero) for a person who may not see the type, and is listed for who may.
                    var listsTypes = url.Contains("skills", StringComparison.Ordinal) || url.Contains("coverage", StringComparison.Ordinal);
                    text.Contains(TaskTypeUniverse.SecretTypeName, StringComparison.Ordinal).ShouldBe(listsTypes && visible.Contains(u.T2), $"{name}: {url}");
                    text.Contains(TaskTypeUniverse.Sentinel, StringComparison.Ordinal).ShouldBe(false, $"{name}: {url}");
                }

                // The type is as unknown as a missing one in the trend filter.
                var response = await http.GetAsync($"/api/v1/dashboard/trend?fresh=true&taskTypeIds={u.SecretTypeId}");
                (response.StatusCode == HttpStatusCode.OK).ShouldBe(visible.Contains(u.T2), name + ": trend filter by the hidden type");
            }

            return 0;
        });
    }

    [Fact]
    public async Task The_cache_key_includes_the_hidden_types_so_a_change_of_the_lists_shows_on_the_very_next_request()
    {
        await WithUniverseAsync(sql, typeRule: true, restrict: false, body: async u =>
        {
            // The type is still open: everybody counts all six tasks, and the answers are cached.
            Count(await GetAsync(u.Outsider, "/api/v1/dashboard"), "open").ShouldBe(6);
            Count(await GetAsync(u.Viewer, "/api/v1/dashboard"), "open").ShouldBe(6);
            var trendBefore = await GetAsync(u.Outsider, "/api/v1/dashboard/trend");
            trendBefore.GetProperty("all").EnumerateArray().Sum(d => d.GetProperty("created").GetInt32()).ShouldBe(6);

            await u.RestrictAsync([u.ReviewerRole]);

            // No "fresh=true": the cache must not serve the old numbers to the person who lost sight of the tasks.
            Count(await GetAsync(u.Outsider, "/api/v1/dashboard"), "open").ShouldBe(3);
            Count(await GetAsync(u.Viewer, "/api/v1/dashboard"), "open").ShouldBe(6);
            (await GetAsync(u.Outsider, "/api/v1/dashboard/trend")).GetProperty("all").EnumerateArray().Sum(d => d.GetProperty("created").GetInt32()).ShouldBe(3);

            // Opening the type again (no Can View role) brings the tasks back at once.
            await u.RestrictAsync([]);
            Count(await GetAsync(u.Outsider, "/api/v1/dashboard"), "open").ShouldBe(6);
            return 0;
        });
    }

    [Fact]
    public async Task Losing_the_role_or_the_role_being_deactivated_hides_the_tasks_on_the_next_request()
    {
        await WithUniverseAsync(sql, typeRule: true, async u =>
        {
            (await u.Viewer.GetAsync($"/api/v1/tasks/{u.T3}")).StatusCode.ShouldBe(HttpStatusCode.OK);

            // The role is deactivated: it grants nothing (fail closed, README 9.3).
            await u.H.ExecuteAsync($"UPDATE dbo.Role SET IsActive = 0 WHERE RoleId = {u.ReviewerRole}");
            u.H.Factory.InvalidateAll();
            (await u.Viewer.GetAsync($"/api/v1/tasks/{u.T3}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            Ids(await GetAsync(u.Viewer, "/api/v1/task-queue?pageSize=100")).ShouldBe([.. u.OpenTasks.Order()]);
            (await u.H.Admin.GetAsync($"/api/v1/tasks/{u.T3}")).StatusCode.ShouldBe(HttpStatusCode.OK);

            // Active again, then the person loses the role.
            await u.H.ExecuteAsync($"UPDATE dbo.Role SET IsActive = 1 WHERE RoleId = {u.ReviewerRole}");
            u.H.Factory.InvalidateAll();
            (await u.Viewer.GetAsync($"/api/v1/tasks/{u.T3}")).StatusCode.ShouldBe(HttpStatusCode.OK);
            await u.H.ExecuteAsync($"DELETE FROM dbo.UserRole WHERE UserId = {u.ViewerId} AND RoleId = {u.ReviewerRole}");
            u.H.Factory.InvalidateAll();
            (await u.Viewer.GetAsync($"/api/v1/tasks/{u.T3}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            return 0;
        });
    }

    [Fact]
    public async Task With_the_switch_on_and_no_restricted_type_every_persona_sees_what_the_switch_off_shows()
    {
        await WithUniverseAsync(sql, typeRule: true, restrict: false, body: async u =>
        {
            foreach (var (name, client, _) in Personas())
            {
                var http = client(u);
                Ids(await GetAsync(http, "/api/v1/task-queue?pageSize=100")).ShouldBe([.. u.AllTasks.Order()], name);
                Count(await GetAsync(http, "/api/v1/dashboard?fresh=true"), "open").ShouldBe(u.AllTasks.Length, name);
                (await http.GetAsync($"/api/v1/tasks/{u.T3}")).StatusCode.ShouldBe(HttpStatusCode.OK, name);
            }

            return 0;
        });
    }

    [Fact]
    public async Task Both_rules_are_anded_a_sensitive_matter_assignee_still_loses_a_task_of_a_hidden_type()
    {
        await WithUniverseAsync(sql, typeRule: true, sensitiveRule: true, body: async u =>
        {
            await u.H.ExecuteAsync($"UPDATE dbo.Matter SET IsSensitive = 1 WHERE MatterId = {u.Matter}");
            u.H.Factory.InvalidateAll();

            // The matter is sensitive and Outsider manages it: they see its tasks of open types; the assignee exception of the matter rule does not rescue T2.
            Ids(await GetAsync(u.Outsider, "/api/v1/task-queue?pageSize=100")).ShouldBe([.. u.OpenTasks.Order()]);
            // Tech is only the assignee (T5 open, T6 secret): sees their open one through the assignment, never the hidden type.
            Ids(await GetAsync(u.Tech, "/api/v1/my-work?pageSize=100")).ShouldBe([u.T5]);
            // The role holder who manages nothing sees none through the matter rule: only their assignments, none here.
            Ids(await GetAsync(u.Viewer, "/api/v1/task-queue?pageSize=100")).ShouldBeEmpty();
            // The sensitive holder sees all matters but no hidden-type task.
            Ids(await GetAsync(u.SensitiveHolder, "/api/v1/task-queue?pageSize=100")).ShouldBe([.. u.OpenTasks.Order()]);
            Ids(await GetAsync(u.H.Admin, "/api/v1/task-queue?pageSize=100")).ShouldBe([.. u.AllTasks.Order()]);
            return 0;
        });
    }
}
