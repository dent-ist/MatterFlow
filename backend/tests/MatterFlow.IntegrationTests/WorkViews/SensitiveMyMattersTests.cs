using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// My Matters (summary, health, attention, deadlines, workload, activity) under the sensitive-matter rule (epic #788, SM-10, inventory R39 and R40): the base set
/// is the matters the caller may see (scope all) or manages (scope mine), every number and row comes from it, the cache is partitioned by what the caller may see,
/// and the activity feed shows events of visible matters only.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveMyMattersTests(SqlServerFixture sql)
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static int Count(JsonElement summary, string tile) => summary.GetProperty(tile).GetProperty("count").GetInt32();

    private static (string Name, Func<SensitiveUniverse, HttpClient> Client, Func<SensitiveUniverse, int[]> Sees)[] Personas() =>
    [
        ("P1 primary manager", u => u.PmPrimaryClient, u => [u.N1, u.S1]),
        ("P2 secondary manager", u => u.PmSecondaryClient, u => [u.N1, u.S1]),
        ("P3 task assignee", u => u.AssigneeClient, u => [u.N1]),
        ("P4 view-sensitive holder", u => u.ViewerClient, u => u.AllMatters),
        ("P5 unrelated", u => u.UnrelatedClient, u => [u.N1]),
        ("Administrator", u => u.H.Admin, u => u.AllMatters),
    ];

    [Fact]
    public async Task The_all_scope_counts_lists_and_activity_cover_only_the_matters_the_caller_may_see()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var visible = sees(u);

                var summary = await GetAsync(http, "/api/v1/my-matters/summary?scope=all");
                Count(summary, "matters").ShouldBe(visible.Length, name + ": matters tile");
                Count(summary, "openTasks").ShouldBe(visible.Length, name + ": open tasks tile (one open task per matter)");

                var health = await GetAsync(http, "/api/v1/my-matters/health?scope=all&pageSize=100");
                health.GetProperty("total").GetInt32().ShouldBe(visible.Length, name + ": health total");
                health.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()).Order().ToArray().ShouldBe([.. visible.Order()], name + ": health rows");

                var attention = await GetAsync(http, "/api/v1/my-matters/attention?scope=all");
                var deadlines = await GetAsync(http, "/api/v1/my-matters/deadlines?scope=all");
                var workload = await GetAsync(http, "/api/v1/my-matters/workload?scope=all");
                workload.GetProperty("open").GetInt32().ShouldBe(visible.Length, name + ": workload open");

                var activity = await GetAsync(http, "/api/v1/my-matters/activity?scope=all&take=100");
                activity.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()).Distinct().ShouldAllBe(id => visible.Contains(id), name + ": activity matters");

                var text = summary.GetRawText() + health.GetRawText() + attention.GetRawText() + deadlines.GetRawText() + workload.GetRawText() + activity.GetRawText();
                foreach (var matter in u.SensitiveMatters.Except(visible))
                    text.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, name);
            }

            // The viewer's feed names the sensitive matters; the unrelated user's does not name any.
            var viewerFeed = await GetAsync(u.ViewerClient, "/api/v1/my-matters/activity?scope=all&take=100");
            viewerFeed.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()).Distinct().Order().ToArray().ShouldBe([.. u.AllMatters.Order()]);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_mine_scope_and_a_named_manager_never_reach_a_hidden_matter()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            await u.H.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {u.Unrelated} WHERE MatterId = {u.N1}");
            u.H.Factory.InvalidateAll();

            // "Mine" is the matters the person manages: P1 manages S1, P5 manages N1, the others none.
            Count(await GetAsync(u.PmPrimaryClient, "/api/v1/my-matters/summary"), "matters").ShouldBe(1);
            Count(await GetAsync(u.UnrelatedClient, "/api/v1/my-matters/summary"), "matters").ShouldBe(1);
            Count(await GetAsync(u.AssigneeClient, "/api/v1/my-matters/summary"), "matters").ShouldBe(0);
            Count(await GetAsync(u.ViewerClient, "/api/v1/my-matters/summary"), "matters").ShouldBe(0);

            // Asking for P1's matters: P5 may not see S1, so P5 gets none of them; the viewer gets S1.
            Count(await GetAsync(u.UnrelatedClient, $"/api/v1/my-matters/summary?scope=all&managerId={u.PmPrimary}"), "matters").ShouldBe(0);
            Count(await GetAsync(u.ViewerClient, $"/api/v1/my-matters/summary?scope=all&managerId={u.PmPrimary}"), "matters").ShouldBe(1);
            var health = await GetAsync(u.UnrelatedClient, $"/api/v1/my-matters/health?scope=all&managerId={u.PmPrimary}");
            health.GetProperty("total").GetInt32().ShouldBe(0);
            health.GetRawText().ShouldNotContain(SensitiveUniverse.SentinelPrefix);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_cached_summary_changes_on_the_very_next_request_when_access_changes()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            for (var round = 0; round < 2; round++)
            {
                Count(await GetAsync(u.PmPrimaryClient, "/api/v1/my-matters/summary"), "matters").ShouldBe(1);
                Count(await GetAsync(u.PmPrimaryClient, "/api/v1/my-matters/summary?scope=all"), "matters").ShouldBe(2);
                Count(await GetAsync(u.ViewerClient, "/api/v1/my-matters/summary?scope=all"), "matters").ShouldBe(4);
                Count(await GetAsync(u.UnrelatedClient, "/api/v1/my-matters/summary?scope=all"), "matters").ShouldBe(1);
            }

            var matter = await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S1}");
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = (int?)null, rowVersion = matter.GetProperty("rowVersion").GetString() }));
            Count(await GetAsync(u.PmPrimaryClient, "/api/v1/my-matters/summary"), "matters").ShouldBe(0);
            Count(await GetAsync(u.PmPrimaryClient, "/api/v1/my-matters/summary?scope=all"), "matters").ShouldBe(1);
            Count(await GetAsync(u.ViewerClient, "/api/v1/my-matters/summary?scope=all"), "matters").ShouldBe(4);

            // Un-marking S2 shows it to the unrelated user at once.
            await u.H.ExecuteAsync($"UPDATE dbo.Matter SET IsSensitive = 0 WHERE MatterId = {u.S2}");
            Count(await GetAsync(u.UnrelatedClient, "/api/v1/my-matters/summary?scope=all"), "matters").ShouldBe(2);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_seen_marker_moves_for_the_caller_only_and_unread_counts_use_visible_events()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // First read creates the marker; a new event on the hidden matter S2 is invisible to P5 (no unread), a new one on S1 is unread for P1.
            await GetAsync(u.UnrelatedClient, "/api/v1/my-matters/activity?scope=all");
            await GetAsync(u.PmPrimaryClient, "/api/v1/my-matters/activity?scope=all");
            await OkAsync(await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.TS2}/comments", new { bodyHtml = "<p>ZZSENS hidden comment</p>" }), System.Net.HttpStatusCode.Created);
            await OkAsync(await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.TS1}/comments", new { bodyHtml = "<p>visible to the manager</p>" }), System.Net.HttpStatusCode.Created);

            var p5 = await GetAsync(u.UnrelatedClient, "/api/v1/my-matters/activity?scope=all");
            p5.GetProperty("unreadCount").GetInt32().ShouldBe(0);
            p5.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()).ShouldAllBe(id => id == u.N1); // earlier events of the visible matter only
            var p1 = await GetAsync(u.PmPrimaryClient, "/api/v1/my-matters/activity?scope=all");
            p1.GetProperty("unreadCount").GetInt32().ShouldBe(1);
            p1.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()).ShouldAllBe(id => id == u.S1 || id == u.N1);
            p1.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()).ShouldNotContain(u.S2);

            await OkAsync(await u.PmPrimaryClient.PostAsJsonAsync("/api/v1/my-matters/activity/seen", new { }));
            (await GetAsync(u.PmPrimaryClient, "/api/v1/my-matters/activity?scope=all")).GetProperty("unreadCount").GetInt32().ShouldBe(0);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
