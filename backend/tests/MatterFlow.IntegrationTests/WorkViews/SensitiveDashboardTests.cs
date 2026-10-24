using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The Dashboard (summary, scopes, trend, workload, coverage) and its cache under the sensitive-matter rule (epic #788, SM-09, inventory R33 to R35, R37, R38):
/// every number is computed from the tasks the viewer may see and equals the matching list, the cache is partitioned by what the viewer may see, and access
/// that ends or begins is visible on the very next request.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveDashboardTests(SqlServerFixture sql)
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static int Count(JsonElement summary, string tile) => summary.GetProperty(tile).GetProperty("count").GetInt32();

    private static (string Name, Func<SensitiveUniverse, HttpClient> Client, Func<SensitiveUniverse, long[]> Sees)[] Personas() =>
    [
        ("P1 primary manager", u => u.PmPrimaryClient, u => [u.TN1, u.TS1]),
        ("P2 secondary manager", u => u.PmSecondaryClient, u => [u.TN1, u.TS1]),
        ("P3 task assignee", u => u.AssigneeClient, u => [u.TN1, u.TS3]),
        ("P4 view-sensitive holder", u => u.ViewerClient, u => [u.TN1, u.TS1, u.TS2, u.TS3]),
        ("P5 unrelated", u => u.UnrelatedClient, u => [u.TN1]),
        ("Administrator", u => u.H.Admin, u => [u.TN1, u.TS1, u.TS2, u.TS3]),
    ];

    [Fact]
    public async Task With_the_switch_off_every_persona_sees_the_same_dashboard()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: false);
        try
        {
            foreach (var (name, client, _) in Personas())
                Count(await GetAsync(client(u), "/api/v1/dashboard"), "open").ShouldBe(4, name);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Summary_breakdowns_trend_workload_and_coverage_count_only_visible_tasks()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // Close the tasks of N1, S1 and S2 (done by the viewer, so nobody else becomes an assignee of a hidden one) so the coverage board has figures.
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'COMPLETED', CompletedAt = SYSUTCDATETIME(), StatusChangedAt = SYSUTCDATETIME(), AssignedUserId = {u.Viewer} WHERE TaskId IN ({u.TN1}, {u.TS1}, {u.TS2})");
            // Open now: only TS3 (assigned to the task assignee).
            u.H.Factory.InvalidateAll();

            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var visible = sees(u);
                var openVisible = visible.Count(t => t == u.TS3);
                var completedVisible = visible.Count(t => t != u.TS3);

                var summary = await GetAsync(http, "/api/v1/dashboard?fresh=true");
                Count(summary, "open").ShouldBe(openVisible, name + ": open tile");
                Count(summary, "completed").ShouldBe(completedVisible, name + ": completed tile");
                Count(summary, "created").ShouldBe(visible.Length, name + ": created tile");
                summary.GetProperty("byStatus").EnumerateArray().Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(openVisible, name + ": status breakdown");
                summary.GetProperty("byPriority").EnumerateArray().Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(openVisible, name + ": priority breakdown");
                summary.GetProperty("byTaskType").EnumerateArray().Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(openVisible, name + ": type breakdown");
                summary.GetProperty("aging").EnumerateArray().Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(openVisible, name + ": aging");

                // Count parity with the list the tile's query opens.
                var queue = await GetAsync(http, "/api/v1/task-queue?pageSize=100&" + summary.GetProperty("open").GetProperty("query").GetString());
                queue.GetProperty("total").GetInt32().ShouldBe(Count(summary, "open"), name + ": open tile equals its drill-through");

                // Trend: created per day over the period adds up to the visible tasks.
                var trend = await GetAsync(http, "/api/v1/dashboard/trend?fresh=true");
                trend.GetProperty("all").EnumerateArray().Sum(d => d.GetProperty("created").GetInt32()).ShouldBe(visible.Length, name + ": trend created");
                trend.GetProperty("all").EnumerateArray().Sum(d => d.GetProperty("completed").GetInt32()).ShouldBe(completedVisible, name + ": trend completed");

                // Workload: open tasks per person over the visible tasks only.
                var workload = await GetAsync(http, "/api/v1/dashboard/workload");
                var assignee = workload.GetProperty("users").EnumerateArray().Single(w => w.GetProperty("userId").GetInt32() == u.Assignee);
                assignee.GetProperty("openTotal").GetInt32().ShouldBe(visible.Contains(u.TS3) ? 1 : 0, name + ": assignee load");
                workload.GetProperty("users").EnumerateArray().Sum(w => w.GetProperty("openTotal").GetInt32()).ShouldBe(openVisible, name + ": workload total");

                // Coverage: completed tasks per person and type, visible ones only.
                var coverage = await GetAsync(http, "/api/v1/dashboard/coverage");
                coverage.GetProperty("summary").GetProperty("totalCompleted").GetInt32().ShouldBe(completedVisible, name + ": coverage total");

                var text = summary.GetRawText() + trend.GetRawText() + workload.GetRawText() + coverage.GetRawText();
                foreach (var matter in u.SensitiveMatters.Where(m => !visible.Contains(m == u.S1 ? u.TS1 : m == u.S2 ? u.TS2 : u.TS3)))
                    text.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, name);
            }
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_cache_is_partitioned_by_viewer_and_access_changes_show_on_the_very_next_request()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // Within the cache time the viewer and the unrelated user get their own answers, and a repeat is served from the cache (same numbers).
            for (var round = 0; round < 2; round++)
            {
                Count(await GetAsync(u.ViewerClient, "/api/v1/dashboard"), "open").ShouldBe(4);
                Count(await GetAsync(u.UnrelatedClient, "/api/v1/dashboard"), "open").ShouldBe(1);
                Count(await GetAsync(u.AssigneeClient, "/api/v1/dashboard"), "open").ShouldBe(2);
                Count(await GetAsync(u.PmPrimaryClient, "/api/v1/dashboard"), "open").ShouldBe(2);
            }

            // A manager is removed: their cached dashboard changes on the next request, not after the cache time.
            var matter = await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S1}");
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = (int?)null, rowVersion = matter.GetProperty("rowVersion").GetString() }));
            Count(await GetAsync(u.PmPrimaryClient, "/api/v1/dashboard"), "open").ShouldBe(1);
            Count(await GetAsync(u.PmSecondaryClient, "/api/v1/dashboard"), "open").ShouldBe(1);
            Count(await GetAsync(u.ViewerClient, "/api/v1/dashboard"), "open").ShouldBe(4);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_reassigned_task_and_an_unmarked_matter_change_the_cached_dashboards_at_once()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            Count(await GetAsync(u.AssigneeClient, "/api/v1/dashboard"), "open").ShouldBe(2);
            Count(await GetAsync(u.UnrelatedClient, "/api/v1/dashboard"), "open").ShouldBe(1);

            // The task is reassigned: the former assignee loses it and the new one gains it, both on the next request.
            var task = await GetAsync(u.H.Admin, $"/api/v1/tasks/{u.TS3}");
            await OkAsync(await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.TS3}/assignment", new { rowVersion = RowVersion(task), userId = u.Unrelated, podId = (int?)null }));
            Count(await GetAsync(u.AssigneeClient, "/api/v1/dashboard"), "open").ShouldBe(1);
            Count(await GetAsync(u.UnrelatedClient, "/api/v1/dashboard"), "open").ShouldBe(2);

            // The matter S2 is un-marked: everybody sees its task at once.
            await u.H.ExecuteAsync($"UPDATE dbo.Matter SET IsSensitive = 0 WHERE MatterId = {u.S2}");
            Count(await GetAsync(u.UnrelatedClient, "/api/v1/dashboard"), "open").ShouldBe(3);

            // The permission is taken away from the viewer's role: their dashboard shrinks on the next request.
            var role = await u.H.ScalarAsync("SELECT TOP 1 r.RoleId FROM dbo.UserRole ur JOIN dbo.Role r ON r.RoleId = ur.RoleId WHERE ur.UserId = " + u.Viewer);
            await u.H.ExecuteAsync($"DELETE rp FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE rp.RoleId = {role} AND p.Code = 'Matter.ViewSensitive'");
            u.H.Factory.InvalidateAll();
            Count(await GetAsync(u.ViewerClient, "/api/v1/dashboard"), "open").ShouldBe(2); // N1 and the un-marked S2; S1 has managers, S3's task moved to the unrelated user
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
