using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The people and configuration screens that show Task numbers under the sensitive-matter rule (epic #788, SM-11, inventory R41 to R45, R63, R66): open-task
/// counts on users, task types, priorities and the assignee suggestions come from the tasks the viewer may see; the assignee ranking still orders by the TRUE load
/// (owner decision Q5) while the shown numbers and sentences are the visible ones; the "in use" guards stay unfiltered and never give a number.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveDirectoryCountsTests(SqlServerFixture sql)
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static IEnumerable<JsonElement> Rows(JsonElement e) => e.ValueKind == JsonValueKind.Array ? e.EnumerateArray() : e.GetProperty("items").EnumerateArray();

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
    public async Task User_task_type_and_priority_counts_equal_the_visible_open_tasks_and_the_ranking_uses_the_true_load()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var visible = sees(u);

                var types = await GetAsync(http, "/api/v1/task-types?pageSize=100");
                Rows(types).Single(t => t.GetProperty("id").GetInt32() == u.World.TaskTypeId).GetProperty("openTaskCount").GetInt32().ShouldBe(visible.Length, name + ": task type count");

                var priorities = await GetAsync(http, "/api/v1/priorities?pageSize=100");
                Rows(priorities).Sum(p => p.GetProperty("openTaskCount").GetInt32()).ShouldBe(visible.Length, name + ": priority counts");

                // Users list and detail: the task assignee holds one open task on the sensitive matter S3.
                var shown = visible.Contains(u.TS3) ? 1 : 0;
                var users = await GetAsync(http, "/api/v1/users?pageSize=100");
                Rows(users).Single(x => x.GetProperty("userId").GetInt32() == u.Assignee).GetProperty("openTaskCount").GetInt32().ShouldBe(shown, name + ": users list");
                (await GetAsync(http, $"/api/v1/users/{u.Assignee}")).GetProperty("openTaskCount").GetInt32().ShouldBe(shown, name + ": user detail");

                // Assignee suggestions: the shown load and sentence are the visible ones; the order is by the true load, so the person who holds a hidden task is
                // never ranked as if they were idle.
                var suggestions = await GetAsync(http, "/api/v1/users/lookup?suggest=true&limit=50");
                var items = suggestions.EnumerateArray().ToArray();
                var item = items.Single(x => x.GetProperty("userId").GetInt32() == u.Assignee);
                item.GetProperty("openTaskCount").GetInt32().ShouldBe(shown, name + ": lookup shown count");
                item.GetProperty("reason").GetString()!.ShouldStartWith(shown == 1 ? "1 open task" : "0 open tasks", Case.Sensitive, name);
                (item.GetProperty("lastAssignedUtc").ValueKind == JsonValueKind.Null).ShouldBe(shown == 0, name + ": last assigned is shown only when visible");
                var position = Array.FindIndex(items, x => x.GetProperty("userId").GetInt32() == u.Assignee);
                position.ShouldBe(items.Length - 1, name + ": the one person who truly holds a task ranks last whatever is shown");
                suggestions.GetRawText().ShouldNotContain(SensitiveUniverse.SentinelPrefix);

                // No matter data in the people screens.
                foreach (var url in new[] { "/api/v1/pods", "/api/v1/me/pods", "/api/v1/users/matter-managers", "/api/v1/users?pageSize=100" })
                {
                    var response = await http.GetAsync(url);
                    (await response.Content.ReadAsStringAsync()).ShouldNotContain(SensitiveUniverse.SentinelPrefix, Case.Sensitive, $"{name}: {url}");
                }
            }
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_priority_only_a_hidden_task_uses_shows_no_count_to_others_but_is_still_in_use_without_a_number()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var created = await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/priorities", new { label = "Secret-only", color = "neutral" }), HttpStatusCode.Created);
            var priorityId = created.GetProperty("id").GetInt32();
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET PriorityId = {priorityId} WHERE TaskId = {u.TS2}");

            async Task<int> CountFor(HttpClient c) =>
                Rows(await GetAsync(c, "/api/v1/priorities?pageSize=100")).Single(p => p.GetProperty("id").GetInt32() == priorityId).GetProperty("openTaskCount").GetInt32();

            (await CountFor(u.UnrelatedClient)).ShouldBe(0);
            (await CountFor(u.PmPrimaryClient)).ShouldBe(0);
            (await CountFor(u.ViewerClient)).ShouldBe(1);

            // Nobody can delete it, and the refusal carries no number whoever asks (the guard looks at the true data).
            var refused = await u.H.Admin.DeleteAsync($"/api/v1/priorities/{priorityId}");
            refused.StatusCode.ShouldBe(HttpStatusCode.Conflict);
            var text = await refused.Content.ReadAsStringAsync();
            text.ShouldContain("Tasks use this priority");
            System.Text.RegularExpressions.Regex.IsMatch(text, @"\b\d+ tasks?\b").ShouldBeFalse(text);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
