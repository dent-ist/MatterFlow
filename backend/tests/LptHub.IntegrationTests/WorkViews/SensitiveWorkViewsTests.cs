using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Task Queue, My Work, Pod Work and the Swimlane under the sensitive-matter rule (epic #788, SM-08, inventory R30 to R32 and R36): lists, totals, tab badges,
/// quick-view counts, pagers and member loads are all computed from the tasks the caller may see, and equal the rows of the matching list.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveWorkViewsTests(SqlServerFixture sql)
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static long[] Ids(JsonElement page, string items = "items") => [.. page.GetProperty(items).EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).Order()];

    private static (string Name, Func<SensitiveUniverse, HttpClient> Client, Func<SensitiveUniverse, long[]> Sees)[] Personas() =>
    [
        ("P1 primary manager", u => u.PmPrimaryClient, u => [u.TN1, u.TS1]),
        ("P2 secondary manager", u => u.PmSecondaryClient, u => [u.TN1, u.TS1]),
        ("P3 task assignee", u => u.AssigneeClient, u => [u.TN1, u.TS3]),
        ("P4 view-sensitive holder", u => u.ViewerClient, u => [u.TN1, u.TS1, u.TS2, u.TS3]),
        ("P5 unrelated", u => u.UnrelatedClient, u => [u.TN1]),
        ("Administrator", u => u.H.Admin, u => [u.TN1, u.TS1, u.TS2, u.TS3]),
    ];

    private static long[] AllTasks(SensitiveUniverse u) => [u.TN1, u.TS1, u.TS2, u.TS3];

    [Fact]
    public async Task With_the_switch_off_every_persona_sees_every_task_in_every_view()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: false);
        try
        {
            foreach (var (name, client, _) in Personas())
            {
                var queue = await GetAsync(client(u), "/api/v1/task-queue?pageSize=100");
                Ids(queue).ShouldBe([.. AllTasks(u).Order()], name);
                queue.GetProperty("views").GetProperty("open").GetInt32().ShouldBe(4, name);
                var board = await GetAsync(client(u), "/api/v1/dashboard/swimlane?groupBy=clientMatter");
                board.GetProperty("lanes").EnumerateArray().SelectMany(l => l.GetProperty("cards").EnumerateArray()).Select(c => c.GetProperty("taskId").GetInt64()).Order().ToArray().ShouldBe([.. AllTasks(u).Order()], name + ": swimlane");
            }
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_task_queue_lists_totals_pagers_and_quick_view_counts_come_from_the_visible_tasks()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var expected = sees(u).Order().ToArray();
                var queue = await GetAsync(http, "/api/v1/task-queue?pageSize=100");
                Ids(queue).ShouldBe(expected, name);
                queue.GetProperty("total").GetInt32().ShouldBe(expected.Length, name);
                var views = queue.GetProperty("views");
                views.GetProperty("open").GetInt32().ShouldBe(expected.Length, name + ": open badge");
                views.GetProperty("unassigned").GetInt32().ShouldBe(expected.Count(t => t != u.TS3), name + ": unassigned badge");
                views.GetProperty("onHold").GetInt32().ShouldBe(0, name);

                var paged = new List<long>();
                for (var page = 1; page <= expected.Length; page++)
                    paged.AddRange(Ids(await GetAsync(http, $"/api/v1/task-queue?pageSize=1&page={page}")));
                paged.Order().ToArray().ShouldBe(expected, name + ": paging");
                (await GetAsync(http, "/api/v1/task-queue?pageSize=1")).GetProperty("total").GetInt32().ShouldBe(expected.Length, name + ": total ignores the page size");

                var body = await (await http.GetAsync("/api/v1/task-queue?pageSize=100&group=due&sort=due")).Content.ReadAsStringAsync();
                foreach (var matter in u.SensitiveMatters.Where(m => !expected.Contains(m == u.S1 ? u.TS1 : m == u.S2 ? u.TS2 : u.TS3)))
                    body.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, name);
                JsonDocument.Parse(body).RootElement.GetProperty("bucketCounts").GetProperty("asap").GetInt32().ShouldBe(expected.Length, name + ": bucket counts");
            }

            // The assignee's row carries the matter header (reference, name, client) and is marked sensitive.
            var row = (await GetAsync(u.AssigneeClient, "/api/v1/task-queue?pageSize=100")).GetProperty("items").EnumerateArray().Single(i => i.GetProperty("taskId").GetInt64() == u.TS3);
            row.GetProperty("matterIsSensitive").GetBoolean().ShouldBeTrue();
            row.GetProperty("matterId").GetInt32().ShouldBe(u.S3);

            // Searching the queue for a hidden matter's sentinel finds nothing; a filter on the hidden matter id gives an empty page, not an error.
            (await GetAsync(u.UnrelatedClient, $"/api/v1/task-queue?pageSize=100&q={SensitiveUniverse.Sentinel(u.S1)}")).GetProperty("total").GetInt32().ShouldBe(0);
            (await GetAsync(u.UnrelatedClient, $"/api/v1/task-queue?pageSize=100&matter={u.S2}")).GetProperty("total").GetInt32().ShouldBe(0);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task My_work_follows_assignment_at_once_and_its_badges_equal_its_lists()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var mine = await GetAsync(u.AssigneeClient, "/api/v1/my-work?pageSize=100");
            Ids(mine).ShouldBe([u.TS3]);
            mine.GetProperty("counts").GetProperty("active").GetInt32().ShouldBe(1);
            Ids(await GetAsync(u.PmPrimaryClient, "/api/v1/my-work?pageSize=100")).ShouldBeEmpty();

            // Assigning the hidden S2 task to P5 gives them that task (and only that task) in My Work and the queue; the matter stays hidden.
            var task = await GetAsync(u.H.Admin, $"/api/v1/tasks/{u.TS2}");
            await OkAsync(await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.TS2}/assignment", new { rowVersion = RowVersion(task), userId = u.Unrelated, podId = (int?)null }));
            var p5 = await GetAsync(u.UnrelatedClient, "/api/v1/my-work?pageSize=100");
            Ids(p5).ShouldBe([u.TS2]);
            p5.GetProperty("counts").GetProperty("active").GetInt32().ShouldBe(1);
            p5.GetProperty("attention").GetProperty("asap").GetInt32().ShouldBe(1);
            var queue = await GetAsync(u.UnrelatedClient, "/api/v1/task-queue?pageSize=100");
            Ids(queue).ShouldBe(new[] { u.TN1, u.TS2 }.Order().ToArray());
            queue.GetProperty("views").GetProperty("open").GetInt32().ShouldBe(2);

            // Reassigning it away ends that at once: My Work, the queue and its badge lose the task.
            task = await GetAsync(u.H.Admin, $"/api/v1/tasks/{u.TS2}");
            await OkAsync(await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.TS2}/assignment", new { rowVersion = RowVersion(task), userId = u.Assignee, podId = (int?)null }));
            Ids(await GetAsync(u.UnrelatedClient, "/api/v1/my-work?pageSize=100")).ShouldBeEmpty();
            (await GetAsync(u.UnrelatedClient, "/api/v1/task-queue?pageSize=1")).GetProperty("views").GetProperty("open").GetInt32().ShouldBe(1);
            Ids(await GetAsync(u.AssigneeClient, "/api/v1/my-work?pageSize=100")).ShouldBe(new[] { u.TS2, u.TS3 }.Order().ToArray());
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Pod_work_summary_tabs_and_member_loads_exclude_hidden_tasks()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var pod = await u.H.CreatePodAsync("Review pod", u.Assignee, u.Unrelated, u.PmPrimary);
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET AssignedPodId = {pod}");

            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var expected = sees(u).Order().ToArray();
                var page = await GetAsync(http, $"/api/v1/pod-work?podId={pod}&view=all&pageSize=100");
                Ids(page).ShouldBe(expected, name);
                var counts = page.GetProperty("counts");
                counts.GetProperty("all").GetInt32().ShouldBe(expected.Length, name + ": all tab");
                counts.GetProperty("queue").GetInt32().ShouldBe(expected.Count(t => t != u.TS3), name + ": queue tab");
                counts.GetProperty("members").GetInt32().ShouldBe(expected.Count(t => t == u.TS3), name + ": members tab");
                var summary = page.GetProperty("summary");
                (summary.GetProperty("unassignedToPerson").GetInt32() + summary.GetProperty("assigned").GetInt32()).ShouldBe(expected.Length, name + ": header");

                // The member's load counts only the tasks the caller may see: the assignee's one task is invisible to everybody who may not see it.
                var load = page.GetProperty("memberLoads").EnumerateArray().Single(l => l.GetProperty("userId").GetInt32() == u.Assignee).GetProperty("open").GetInt32();
                load.ShouldBe(expected.Contains(u.TS3) ? 1 : 0, name + ": member load");
                counts.GetProperty("membersWithWork").GetInt32().ShouldBe(expected.Contains(u.TS3) ? 1 : 0, name);

                var choice = page.GetProperty("pods").EnumerateArray().Single(c => c.GetProperty("podId").GetInt32() == pod);
                choice.GetProperty("openCount").GetInt32().ShouldBe(expected.Length, name + ": pod selector open");
                choice.GetProperty("unassignedCount").GetInt32().ShouldBe(expected.Count(t => t != u.TS3), name + ": pod selector unassigned");
                var text = page.GetRawText();
                foreach (var matter in u.SensitiveMatters.Where(m => !expected.Contains(m == u.S1 ? u.TS1 : m == u.S2 ? u.TS2 : u.TS3)))
                    text.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, name);
            }
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_swimlane_shows_cards_lane_counts_and_groups_for_visible_tasks_only()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var expected = sees(u).Order().ToArray();
                var board = await GetAsync(http, "/api/v1/dashboard/swimlane?groupBy=clientMatter");
                var lanes = board.GetProperty("lanes").EnumerateArray().ToArray();
                var cards = lanes.SelectMany(l => l.GetProperty("cards").EnumerateArray()).ToArray();
                cards.Select(c => c.GetProperty("taskId").GetInt64()).Order().ToArray().ShouldBe(expected, name);
                lanes.Sum(l => l.GetProperty("count").GetInt32()).ShouldBe(expected.Length, name + ": lane counts");
                cards.Where(c => c.GetProperty("matterIsSensitive").GetBoolean()).Select(c => c.GetProperty("taskId").GetInt64())
                    .ShouldAllBe(id => expected.Contains(id), name);

                // A card of a sensitive matter the person sees only through an assignment carries the header and no link to the matter page (mode H).
                foreach (var card in cards.Where(c => c.GetProperty("matterIsSensitive").GetBoolean()))
                {
                    var matterId = card.GetProperty("matterId").GetInt32();
                    var mayOpen = name.StartsWith("P4", StringComparison.Ordinal) || name == "Administrator" || (matterId == u.S1 && (name.StartsWith("P1", StringComparison.Ordinal) || name.StartsWith("P2", StringComparison.Ordinal)));
                    card.GetProperty("matterCanOpen").GetBoolean().ShouldBe(mayOpen, $"{name}: matter {matterId}");
                }

                // The client > matter tree counts only the visible tasks and names only matters of visible tasks.
                var groups = board.GetProperty("groups").EnumerateArray().ToArray();
                groups.Sum(g => g.GetProperty("count").GetInt32()).ShouldBe(expected.Length, name + ": group counts");
                var shown = groups.SelectMany(g => g.GetProperty("children").EnumerateArray()).Select(m => m.GetProperty("id").GetInt32()).Order().ToArray();
                shown.ShouldBe([.. new[] { u.N1, u.S1, u.S2, u.S3 }.Where(m => expected.Contains(m == u.N1 ? u.TN1 : m == u.S1 ? u.TS1 : m == u.S2 ? u.TS2 : u.TS3)).Order()], name + ": matter groups");

                foreach (var by in new[] { "priority", "assignee" })
                {
                    var other = await GetAsync(http, $"/api/v1/dashboard/swimlane?groupBy={by}");
                    other.GetProperty("groups").EnumerateArray().Sum(g => g.GetProperty("count").GetInt32()).ShouldBe(expected.Length, $"{name}: {by} groups");
                }

                var text = board.GetRawText();
                foreach (var matter in u.SensitiveMatters.Where(m => !expected.Contains(m == u.S1 ? u.TS1 : m == u.S2 ? u.TS2 : u.TS3)))
                    text.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, name);
            }

            // "Mine" for the assignee is their one task of the hidden matter.
            var mineBoard = await GetAsync(u.AssigneeClient, "/api/v1/dashboard/swimlane?mine=true");
            mineBoard.GetProperty("lanes").EnumerateArray().SelectMany(l => l.GetProperty("cards").EnumerateArray()).Select(c => c.GetProperty("taskId").GetInt64()).ShouldBe([u.TS3]);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
