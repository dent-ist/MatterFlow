using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkManagement;

/// <summary>
/// The task read and write paths under the sensitive-matter rule (epic #788, SM-06, inventory R14 to R23): the personas of README 12.2 walk the task list,
/// the task, its workflow, comments, assets, activity and the write endpoints. A hidden task answers exactly like a missing id, lists and totals agree,
/// an assignee sees only their task with the minimal matter header, and access ends and begins at once.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveTasksTests(SqlServerFixture sql)
{
    private const long Missing = 999_999_999;
    private const int MissingMatter = 999_999;
    private const string Stale = "AAAAAAAAB9E=";

    private static async Task<string> BodyAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        if (text.Length == 0 || !text.TrimStart().StartsWith('{'))
            return $"{(int)response.StatusCode}|{text}";

        var node = JsonNode.Parse(text)!.AsObject();
        node.Remove("traceId");
        node.Remove("instance");
        return $"{(int)response.StatusCode}|{node.ToJsonString()}";
    }

    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static long[] Ids(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).Order()];

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
    public async Task With_the_switch_off_every_persona_sees_and_opens_every_task()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: false);
        try
        {
            foreach (var (name, client, _) in Personas())
            {
                Ids(await GetAsync(client(u), "/api/v1/tasks?pageSize=100")).ShouldBe([.. AllTasks(u).Order()], name);
                (await client(u).GetAsync($"/api/v1/tasks/{u.TS2}")).StatusCode.ShouldBe(HttpStatusCode.OK, name);
            }
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_task_list_shows_each_persona_only_what_the_rule_gives_and_the_total_equals_the_rows()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var expected = sees(u).Order().ToArray();
                var list = await GetAsync(http, "/api/v1/tasks?pageSize=100");
                Ids(list).ShouldBe(expected, name);
                list.GetProperty("total").GetInt32().ShouldBe(expected.Length, name);

                var paged = new List<long>();
                for (var page = 1; page <= expected.Length; page++)
                    paged.AddRange(Ids(await GetAsync(http, $"/api/v1/tasks?pageSize=1&page={page}")));
                paged.Order().ToArray().ShouldBe(expected, name + ": paging");
                (await GetAsync(http, "/api/v1/tasks?pageSize=1")).GetProperty("total").GetInt32().ShouldBe(expected.Length, name + ": total ignores the page size");

                var hidden = AllTasks(u).Except(expected).ToArray();
                var hiddenMatters = u.SensitiveMatters.Where(m => !sees(u).Contains(m == u.S1 ? u.TS1 : m == u.S2 ? u.TS2 : u.TS3)).ToArray();
                foreach (var url in new[] { "/api/v1/tasks?pageSize=100", "/api/v1/tasks?pageSize=100&q=ZZSENS", $"/api/v1/tasks?pageSize=100&matterId={u.S1}", $"/api/v1/tasks?pageSize=100&matterId={u.S2}", $"/api/v1/tasks?pageSize=100&matterId={u.S3}" })
                {
                    var response = await http.GetAsync(url);
                    var body = await response.Content.ReadAsStringAsync();
                    foreach (var matter in hiddenMatters)
                        body.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, $"{name}: {url}");
                    Ids(JsonDocument.Parse(body).RootElement).ShouldAllBe(id => expected.Contains(id), $"{name}: {url}");
                }

                foreach (var task in hidden)
                    Ids(await GetAsync(http, "/api/v1/tasks?pageSize=100&q=ZZSENS")).ShouldNotContain(task, name);
            }

            // The assignee's matter filter finds only their own task of the hidden matter.
            Ids(await GetAsync(u.AssigneeClient, $"/api/v1/tasks?pageSize=100&matterId={u.S3}")).ShouldBe([u.TS3]);
            Ids(await GetAsync(u.AssigneeClient, $"/api/v1/tasks?pageSize=100&matterId={u.S1}")).ShouldBeEmpty();
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_hidden_task_answers_every_read_and_write_exactly_like_a_missing_id()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var hiddenFrom = new (string Name, HttpClient Client, long Hidden)[]
            {
                ("P3 assignee, TS1", u.AssigneeClient, u.TS1),
                ("P3 assignee, TS2", u.AssigneeClient, u.TS2),
                ("P5 unrelated, TS1", u.UnrelatedClient, u.TS1),
                ("P5 unrelated, TS3", u.UnrelatedClient, u.TS3),
                ("P1 primary manager, TS2 (no manager)", u.PmPrimaryClient, u.TS2),
                ("P2 secondary manager, TS3 (no manager)", u.PmSecondaryClient, u.TS3),
            };
            var update = new { rowVersion = Stale, title = "Renamed", requestorName = "Someone" };
            (string Label, Func<HttpClient, long, Task<HttpResponseMessage>> Call)[] calls =
            [
                ("GET task", (c, id) => c.GetAsync($"/api/v1/tasks/{id}")),
                ("GET completion", (c, id) => c.GetAsync($"/api/v1/tasks/{id}/completion")),
                ("GET workflow", (c, id) => c.GetAsync($"/api/v1/tasks/{id}/workflow")),
                ("GET comments", (c, id) => c.GetAsync($"/api/v1/tasks/{id}/comments")),
                ("GET revisions", (c, id) => c.GetAsync($"/api/v1/tasks/{id}/comments/1/revisions")),
                ("GET assets", (c, id) => c.GetAsync($"/api/v1/tasks/{id}/assets")),
                ("GET activity", (c, id) => c.GetAsync($"/api/v1/tasks/{id}/activity")),
                ("PUT task", (c, id) => c.PutAsJsonAsync($"/api/v1/tasks/{id}", update)),
                ("POST assignment", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/assignment", new { rowVersion = Stale, userId = (int?)null, podId = (int?)null })),
                ("POST priority", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/priority", new { rowVersion = Stale, priorityId = 1 })),
                ("POST status", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/status", new { rowVersion = Stale, status = "IN_PROGRESS" })),
                ("POST complete", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/complete", new { rowVersion = Stale, completeUnresolvedSteps = false })),
                ("POST cancel", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/cancel", new { rowVersion = Stale, comment = "No longer needed" })),
                ("POST reopen", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/reopen", new { rowVersion = Stale })),
                ("POST step start", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/workflow/steps/1/start", new { rowVersion = Stale })),
                ("POST step complete", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/workflow/steps/1/complete", new { rowVersion = Stale })),
                ("POST comment", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/comments", new { bodyHtml = "<p>hello</p>" })),
                ("PUT comment", (c, id) => c.PutAsJsonAsync($"/api/v1/tasks/{id}/comments/1", new { bodyHtml = "<p>edit</p>", rowVersion = Stale })),
                ("DELETE comment", (c, id) => c.DeleteAsync($"/api/v1/tasks/{id}/comments/1")),
                ("POST link asset", (c, id) => c.PostAsJsonAsync($"/api/v1/tasks/{id}/assets", new { assetId = 1 })),
                ("PUT asset role", (c, id) => c.PutAsJsonAsync($"/api/v1/tasks/{id}/assets/1", new { assetLinkRoleId = (int?)null, rowVersion = Stale })),
                ("DELETE asset link", (c, id) => c.DeleteAsync($"/api/v1/tasks/{id}/assets/1")),
            ];

            foreach (var (name, client, hidden) in hiddenFrom)
            {
                foreach (var (label, call) in calls)
                {
                    var forHidden = await BodyAsync(await call(client, hidden));
                    var forMissing = await BodyAsync(await call(client, Missing));
                    forHidden.ShouldBe(forMissing, $"{name}: {label}");
                    forHidden.ShouldStartWith("404|", Case.Sensitive, $"{name}: {label}");
                    forHidden.ShouldNotContain(SensitiveUniverse.SentinelPrefix, Case.Sensitive, $"{name}: {label}");
                }
            }

            // Nothing of the hidden tasks was touched by the 404 writes above.
            var admin = u.H.Admin;
            foreach (var task in new[] { u.TS1, u.TS2, u.TS3 })
            {
                var t = await GetAsync(admin, $"/api/v1/tasks/{task}");
                t.GetProperty("title").GetString()!.ShouldContain(SensitiveUniverse.SentinelPrefix);
                t.GetProperty("status").GetString().ShouldBe(task == u.TS3 ? "IN_PROGRESS" : "NEW");
            }

            // P6b: without the permission the policy answers 403 for everything, hidden or not.
            await ProblemAsync(await u.NoPermClient.GetAsync($"/api/v1/tasks/{u.TS1}"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
            await ProblemAsync(await u.NoPermClient.GetAsync($"/api/v1/tasks/{Missing}"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task An_assignee_opens_only_their_task_with_the_minimal_matter_header_and_can_work_on_it()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var task = await GetAsync(u.AssigneeClient, $"/api/v1/tasks/{u.TS3}");
            var matter = task.GetProperty("matter");
            matter.GetProperty("matterId").GetInt32().ShouldBe(u.S3);
            matter.GetProperty("isSensitive").GetBoolean().ShouldBeTrue();
            matter.EnumerateObject().Select(p => p.Name).Order().ShouldBe(["canOpen", "clientId", "clientNumber", "isActive", "isSensitive", "matterId", "matterNumber", "matterRef", "name"]);

            // The screen is told not to link to a matter page that would answer 404 (mode H); a person who sees the whole matter is not.
            matter.GetProperty("canOpen").GetBoolean().ShouldBeFalse();
            (await GetAsync(u.ViewerClient, $"/api/v1/tasks/{u.TS3}")).GetProperty("matter").GetProperty("canOpen").GetBoolean().ShouldBeTrue();
            (await GetAsync(u.AssigneeClient, $"/api/v1/task-queue?pageSize=100")).GetProperty("items").EnumerateArray()
                .Single(r => r.GetProperty("taskId").GetInt64() == u.TS3).GetProperty("matterCanOpen").GetBoolean().ShouldBeFalse();
            (await GetAsync(u.ViewerClient, $"/api/v1/task-queue?pageSize=100")).GetProperty("items").EnumerateArray()
                .Single(r => r.GetProperty("taskId").GetInt64() == u.TS3).GetProperty("matterCanOpen").GetBoolean().ShouldBeTrue();

            // The matter itself stays a 404 for them, and so do the other tasks of that matter.
            (await u.AssigneeClient.GetAsync($"/api/v1/matters/{u.S3}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await u.AssigneeClient.GetAsync($"/api/v1/matters/{u.S3}/summary")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

            // They can work on it: comment, read the activity and the workflow.
            (await u.AssigneeClient.PostAsJsonAsync($"/api/v1/tasks/{u.TS3}/comments", new { bodyHtml = "<p>On it</p>" })).StatusCode.ShouldBe(HttpStatusCode.Created);
            (await GetAsync(u.AssigneeClient, $"/api/v1/tasks/{u.TS3}/comments")).GetProperty("total").GetInt32().ShouldBe(1);
            var activity = await GetAsync(u.AssigneeClient, $"/api/v1/tasks/{u.TS3}/activity");
            activity.GetProperty("items").GetArrayLength().ShouldBeGreaterThan(0);
            (await u.AssigneeClient.GetAsync($"/api/v1/tasks/{u.TS3}/workflow")).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await u.AssigneeClient.GetAsync($"/api/v1/tasks/{u.TS3}/completion")).StatusCode.ShouldBe(HttpStatusCode.OK);
            var priority = await u.AssigneeClient.PostAsJsonAsync($"/api/v1/tasks/{u.TS3}/priority", new { rowVersion = RowVersion(task), priorityId = task.GetProperty("priority").GetProperty("priorityId").GetInt32() });
            priority.StatusCode.ShouldBe(HttpStatusCode.OK, await priority.Content.ReadAsStringAsync());

            // Creating a sibling task on that matter needs seeing the matter: the matter id in the body is "not found" like a missing matter.
            async Task<string> CreateOn(HttpClient c, int matter) => await BodyAsync(await c.PostAsJsonAsync("/api/v1/tasks", u.H.NewTask(u.World, false, extra: new() { ["matterId"] = matter })));
            (await CreateOn(u.AssigneeClient, u.S3)).ShouldBe(await CreateOn(u.AssigneeClient, MissingMatter));
            (await CreateOn(u.UnrelatedClient, u.S1)).ShouldBe(await CreateOn(u.UnrelatedClient, MissingMatter));
            (await CreateOn(u.PmPrimaryClient, u.S1)).ShouldStartWith("201|");
            (await CreateOn(u.ViewerClient, u.S2)).ShouldStartWith("201|");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Access_ends_and_begins_at_once_when_a_task_is_reassigned_a_manager_removed_or_the_flag_flipped()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // The assignee reassigns their own task: the write answers once, then the task is gone for them.
            var task = await GetAsync(u.AssigneeClient, $"/api/v1/tasks/{u.TS3}");
            var done = await u.AssigneeClient.PostAsJsonAsync($"/api/v1/tasks/{u.TS3}/assignment", new { rowVersion = RowVersion(task), userId = u.Unrelated, podId = (int?)null });
            done.StatusCode.ShouldBe(HttpStatusCode.OK, await done.Content.ReadAsStringAsync());
            (await u.AssigneeClient.GetAsync($"/api/v1/tasks/{u.TS3}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            Ids(await GetAsync(u.AssigneeClient, "/api/v1/tasks?pageSize=100")).ShouldBe([u.TN1]);
            (await u.UnrelatedClient.GetAsync($"/api/v1/tasks/{u.TS3}")).StatusCode.ShouldBe(HttpStatusCode.OK);
            Ids(await GetAsync(u.UnrelatedClient, "/api/v1/tasks?pageSize=100")).ShouldBe([u.TN1, u.TS3]);

            // Removing the managers of S1 ends access of P1 and P2 to its task at once.
            var matter = await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S1}");
            (await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = (int?)null, rowVersion = matter.GetProperty("rowVersion").GetString() })).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await u.PmPrimaryClient.GetAsync($"/api/v1/tasks/{u.TS1}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await u.PmSecondaryClient.GetAsync($"/api/v1/tasks/{u.TS1}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

            // Un-marking S2 makes its task visible to everybody.
            await u.H.ExecuteAsync($"UPDATE dbo.Matter SET IsSensitive = 0 WHERE MatterId = {u.S2}");
            (await u.UnrelatedClient.GetAsync($"/api/v1/tasks/{u.TS2}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Batch_and_bulk_endpoints_answer_per_item_without_telling_hidden_from_missing()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            async Task<JsonElement> BatchAsync(HttpClient c, params long[] ids)
            {
                var items = ids.Select(id => new { taskId = id, rowVersion = Stale, podId = (int?)null }).ToArray();
                return await OkAsync(await c.PostAsJsonAsync("/api/v1/tasks/assign-batch", new { userId = u.Unrelated, items }));
            }

            var unrelated = await BatchAsync(u.UnrelatedClient, u.TS1, Missing);
            var results = unrelated.GetProperty("results").EnumerateArray().ToArray();
            results[0].GetProperty("succeeded").GetBoolean().ShouldBeFalse();
            results[0].GetProperty("errorCode").GetString().ShouldBe(results[1].GetProperty("errorCode").GetString());
            results[0].GetProperty("message").GetString().ShouldBe(results[1].GetProperty("message").GetString());
            results[0].GetRawText().ShouldNotContain(SensitiveUniverse.SentinelPrefix);

            var manager = await BatchAsync(u.PmPrimaryClient, u.TS1);
            manager.GetProperty("results")[0].GetProperty("errorCode").GetString().ShouldBe("CONCURRENCY_CONFLICT"); // visible to the manager: the stale token is the only problem

            // Matter bulk: a hidden matter is the same 404 as a missing one; on a visible matter a task of another (hidden) matter is "not found".
            var body = new { taskIds = new[] { u.TS3 }, priorityId = 1 };
            (await BodyAsync(await u.AssigneeClient.PostAsJsonAsync($"/api/v1/matters/{u.S3}/tasks/bulk", body)))
                .ShouldBe(await BodyAsync(await u.AssigneeClient.PostAsJsonAsync($"/api/v1/matters/{MissingMatter}/tasks/bulk", body)));
            var mixed = await OkAsync(await u.PmPrimaryClient.PostAsJsonAsync($"/api/v1/matters/{u.S1}/tasks/bulk", new { taskIds = new[] { u.TS1, u.TS2, Missing }, priorityId = 1 }));
            var rows = mixed.GetProperty("results").EnumerateArray().ToArray();
            rows[1].GetProperty("ok").GetBoolean().ShouldBeFalse();
            rows[1].GetProperty("code").GetString().ShouldBe(rows[2].GetProperty("code").GetString());
            rows[1].GetProperty("message").GetString().ShouldBe(rows[2].GetProperty("message").GetString());
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task An_asset_the_caller_may_not_see_is_not_found_when_linking_and_one_on_their_own_task_is_found()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var type = await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created);
            var typeId = type.GetProperty("assetTypeId").GetInt32();
            async Task<int> AssetOn(int matter, string name) =>
                (await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = matter, assetTypeId = typeId, displayName = name }), HttpStatusCode.Created)).GetProperty("assetId").GetInt32();

            var linked = await AssetOn(u.S3, "Linked asset");
            var unlinked = await AssetOn(u.S3, "Unlinked asset");
            (await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.TS3}/assets", new { assetId = linked })).StatusCode.ShouldBe(HttpStatusCode.Created);

            // The assignee sees the asset linked to their own task, and cannot reach another asset of that hidden matter by its id.
            var list = await GetAsync(u.AssigneeClient, $"/api/v1/tasks/{u.TS3}/assets");
            list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("assetId").GetInt32()).ShouldBe([linked]);
            (await BodyAsync(await u.AssigneeClient.PostAsJsonAsync($"/api/v1/tasks/{u.TS3}/assets", new { assetId = unlinked })))
                .ShouldBe(await BodyAsync(await u.AssigneeClient.PostAsJsonAsync($"/api/v1/tasks/{u.TS3}/assets", new { assetId = 999_999 })));

            // A manager of another matter: the asset of the hidden matter S3 is "not found", not a cross-matter conflict that would confirm it exists.
            (await BodyAsync(await u.PmPrimaryClient.PostAsJsonAsync($"/api/v1/tasks/{u.TS1}/assets", new { assetId = unlinked })))
                .ShouldBe(await BodyAsync(await u.PmPrimaryClient.PostAsJsonAsync($"/api/v1/tasks/{u.TS1}/assets", new { assetId = 999_999 })));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
