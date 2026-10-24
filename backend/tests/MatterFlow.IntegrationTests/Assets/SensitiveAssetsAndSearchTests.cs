using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// Assets (mode A) and global/advanced search under the sensitive-matter rule (epic #788, SM-07, inventory R24 to R29): the personas of README 12.2 list, open and
/// search; an assignee sees the assets linked to their own task and the task itself, but not the matter or the other assets of it.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveAssetsAndSearchTests(SqlServerFixture sql)
{
    private const int Missing = 999_999;
    private const string Stale = "AAAAAAAAB9E=";

    private sealed record Data(SensitiveUniverse U, int TypeId, int AN, int A1, int A2, int A3, int A3b, long TS3b);

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

    private static int[] Ids(JsonElement page, string property = "assetId") => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty(property).GetInt32()).Order()];

    private static async Task<Data> BuildAsync(SqlServerFixture sql, bool enabled)
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled);
        var type = await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created);
        var typeId = type.GetProperty("assetTypeId").GetInt32();
        async Task<int> AssetOn(int matter, string name) =>
            (await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = matter, assetTypeId = typeId, displayName = name }), HttpStatusCode.Created)).GetProperty("assetId").GetInt32();

        var an = await AssetOn(u.N1, "Normal asset");
        var a1 = await AssetOn(u.S1, $"{SensitiveUniverse.Sentinel(u.S1)} asset");
        var a2 = await AssetOn(u.S2, $"{SensitiveUniverse.Sentinel(u.S2)} asset");
        var a3 = await AssetOn(u.S3, $"{SensitiveUniverse.Sentinel(u.S3)} linked asset");
        var a3b = await AssetOn(u.S3, $"{SensitiveUniverse.Sentinel(u.S3)} other asset");
        // A second, unassigned task on S3, so the linked asset has one task the assignee may see and one they may not.
        var ts3b = TaskId(await u.H.CreateTaskAsync(u.World, false, new() { ["matterId"] = u.S3, ["projectId"] = u.PS3 }));
        await u.H.ExecuteAsync($"UPDATE dbo.Task SET Title = N'{SensitiveUniverse.Sentinel(u.S3)} second task' WHERE TaskId = {ts3b}");
        foreach (var (task, asset) in new[] { (u.TS3, a3), (ts3b, a3), (u.TS1, a1) })
            (await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{task}/assets", new { assetId = asset })).StatusCode.ShouldBe(HttpStatusCode.Created);
        return new Data(u, typeId, an, a1, a2, a3, a3b, ts3b);
    }

    private static (string Name, Func<SensitiveUniverse, HttpClient> Client, Func<Data, int[]> Assets, Func<Data, int[]> Matters, Func<Data, long[]> Tasks)[] Personas() =>
    [
        ("P1 primary manager", u => u.PmPrimaryClient, d => [d.AN, d.A1], d => [d.U.N1, d.U.S1], d => [d.U.TN1, d.U.TS1]),
        ("P2 secondary manager", u => u.PmSecondaryClient, d => [d.AN, d.A1], d => [d.U.N1, d.U.S1], d => [d.U.TN1, d.U.TS1]),
        ("P3 task assignee", u => u.AssigneeClient, d => [d.AN, d.A3], d => [d.U.N1], d => [d.U.TN1, d.U.TS3]),
        ("P4 view-sensitive holder", u => u.ViewerClient, d => [d.AN, d.A1, d.A2, d.A3, d.A3b], d => d.U.AllMatters, d => [d.U.TN1, d.U.TS1, d.U.TS2, d.U.TS3, d.TS3b]),
        ("P5 unrelated", u => u.UnrelatedClient, d => [d.AN], d => [d.U.N1], d => [d.U.TN1]),
        ("Administrator", u => u.H.Admin, d => [d.AN, d.A1, d.A2, d.A3, d.A3b], d => d.U.AllMatters, d => [d.U.TN1, d.U.TS1, d.U.TS2, d.U.TS3, d.TS3b]),
    ];

    [Fact]
    public async Task With_the_switch_off_assets_and_search_show_everything_to_everybody()
    {
        var d = await BuildAsync(sql, enabled: false);
        try
        {
            foreach (var (name, client, _, _, _) in Personas())
            {
                Ids(await GetAsync(client(d.U), "/api/v1/assets?pageSize=100")).ShouldBe([.. new[] { d.AN, d.A1, d.A2, d.A3, d.A3b }.Order()], name);
                (await client(d.U).GetAsync($"/api/v1/assets/{d.A2}")).StatusCode.ShouldBe(HttpStatusCode.OK, name);
                var found = await GetAsync(client(d.U), "/api/v1/search?q=ZZSENS&limit=50");
                found.GetProperty("groups").EnumerateArray().Single(g => g.GetProperty("type").GetString() == "matter").GetProperty("total").GetInt32().ShouldBe(3, name);
            }
        }
        finally
        {
            await d.U.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Asset_lists_lookups_counts_and_asset_types_show_each_persona_only_what_the_rule_gives()
    {
        var d = await BuildAsync(sql, enabled: true);
        try
        {
            var u = d.U;
            foreach (var (name, client, assets, _, _) in Personas())
            {
                var http = client(u);
                var expected = assets(d).Order().ToArray();
                var list = await GetAsync(http, "/api/v1/assets?pageSize=100");
                Ids(list).ShouldBe(expected, name);
                list.GetProperty("total").GetInt32().ShouldBe(expected.Length, name);
                (await GetAsync(http, "/api/v1/assets?pageSize=1")).GetProperty("total").GetInt32().ShouldBe(expected.Length, name + ": total ignores the page size");
                Ids(await GetAsync(http, "/api/v1/assets?pageSize=100&sort=linkedTaskCount")).ShouldBe(expected, name + ": count sort");

                // Lookup of one matter (the picker) and the name search never reach a hidden asset.
                foreach (var matter in u.AllMatters)
                {
                    var rows = await GetAsync(http, $"/api/v1/assets/lookup?matterId={matter}");
                    rows.EnumerateArray().Select(r => r.GetProperty("assetId").GetInt32()).Order().ToArray().ShouldBe([.. assets(d).Intersect(await OnMatter(u, matter, d))], $"{name}: lookup {matter}");
                }

                var hidden = new[] { d.A1, d.A2, d.A3, d.A3b }.Except(expected).ToArray();
                var body = await (await http.GetAsync("/api/v1/assets?pageSize=100&q=ZZSENS")).Content.ReadAsStringAsync();
                foreach (var matter in u.SensitiveMatters.Where(m => !expected.Any(a => IsOn(d, a, m))))
                    body.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, name);
                Ids(JsonDocument.Parse(body).RootElement).ShouldAllBe(id => expected.Contains(id), name);
                foreach (var asset in hidden)
                    (await BodyAsync(await http.GetAsync($"/api/v1/assets/{asset}"))).ShouldBe(await BodyAsync(await http.GetAsync($"/api/v1/assets/{Missing}")), $"{name}: asset {asset}");

                // The count of an asset type equals the rows of the list.
                var types = await GetAsync(http, "/api/v1/asset-types?pageSize=100");
                types.GetProperty("items").EnumerateArray().Single(t => t.GetProperty("assetTypeId").GetInt32() == d.TypeId).GetProperty("assetCount").GetInt32().ShouldBe(expected.Length, name + ": asset type count");
            }

            // Linked tasks and counts: the assignee sees the linked asset with the one task they may see; the viewer sees both.
            var own = await GetAsync(u.AssigneeClient, $"/api/v1/assets/{d.A3}");
            own.GetProperty("linkedTaskCount").GetInt32().ShouldBe(1);
            // The assignee reads the asset but may not open its matter: the screen shows the reference as plain text (mode H).
            own.GetProperty("matterCanOpen").GetBoolean().ShouldBeFalse();
            (await GetAsync(u.ViewerClient, $"/api/v1/assets/{d.A3}")).GetProperty("matterCanOpen").GetBoolean().ShouldBeTrue();
            (await GetAsync(u.AssigneeClient, $"/api/v1/assets/{d.A3}/linked-tasks")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).ShouldBe([u.TS3]);
            (await GetAsync(u.ViewerClient, $"/api/v1/assets/{d.A3}")).GetProperty("linkedTaskCount").GetInt32().ShouldBe(2);
            (await GetAsync(u.ViewerClient, $"/api/v1/assets/{d.A3}/linked-tasks")).GetProperty("items").GetArrayLength().ShouldBe(2);
            (await GetAsync(u.AssigneeClient, "/api/v1/assets?pageSize=100")).GetProperty("items").EnumerateArray()
                .Single(i => i.GetProperty("assetId").GetInt32() == d.A3).GetProperty("linkedTaskCount").GetInt32().ShouldBe(1);
        }
        finally
        {
            await d.U.H.Factory.DisposeAsync();
        }
    }

    private static bool IsOn(Data d, int asset, int matter) =>
        (matter == d.U.S1 && asset == d.A1) || (matter == d.U.S2 && asset == d.A2) || (matter == d.U.S3 && (asset == d.A3 || asset == d.A3b));

    private static Task<int[]> OnMatter(SensitiveUniverse u, int matter, Data d) =>
        Task.FromResult(new[] { d.AN, d.A1, d.A2, d.A3, d.A3b }.Where(a => matter == u.N1 ? a == d.AN : IsOn(d, a, matter)).ToArray());

    [Fact]
    public async Task A_hidden_asset_answers_every_read_and_write_exactly_like_a_missing_id()
    {
        var d = await BuildAsync(sql, enabled: true);
        try
        {
            var u = d.U;
            var hiddenFrom = new (string Name, HttpClient Client, int Hidden, int Matter)[]
            {
                ("P3 assignee, A1", u.AssigneeClient, d.A1, u.S1),
                ("P3 assignee, A3b (same matter, not linked to their task)", u.AssigneeClient, d.A3b, u.S3),
                ("P5 unrelated, A3", u.UnrelatedClient, d.A3, u.S3),
                ("P1 primary manager, A2", u.PmPrimaryClient, d.A2, u.S2),
                // Writes follow the matter alone: the assignee reads the asset of their task but cannot change it.
                ("P3 assignee, A3 (write only)", u.AssigneeClient, d.A3, u.S3),
            };
            var update = new { rowVersion = Stale, displayName = "Renamed" };
            foreach (var (name, client, hidden, matter) in hiddenFrom)
            {
                var writeOnly = name.Contains("write only");
                (string Label, Func<HttpClient, int, Task<HttpResponseMessage>> Call, bool Write)[] calls =
                [
                    ("GET asset", (c, id) => c.GetAsync($"/api/v1/assets/{id}"), false),
                    ("GET linked tasks", (c, id) => c.GetAsync($"/api/v1/assets/{id}/linked-tasks"), false),
                    ("PUT asset", (c, id) => c.PutAsJsonAsync($"/api/v1/assets/{id}", update), true),
                    ("POST active", (c, id) => c.PostAsJsonAsync($"/api/v1/assets/{id}/active", new { isActive = false, rowVersion = Stale }), true),
                ];
                foreach (var (label, call, write) in calls)
                {
                    if (writeOnly && !write)
                        continue;
                    var forHidden = await BodyAsync(await call(client, hidden));
                    var forMissing = await BodyAsync(await call(client, Missing));
                    forHidden.ShouldBe(forMissing, $"{name}: {label}");
                    forHidden.ShouldStartWith("404|", Case.Sensitive, $"{name}: {label}");
                }

                if (!writeOnly)
                {
                    // Creating an asset on a hidden matter (the id in the body) is the same validation as on a matter that does not exist.
                    (await BodyAsync(await client.PostAsJsonAsync("/api/v1/assets", new { matterId = matter, assetTypeId = d.TypeId, displayName = "Sneaky" })))
                        .ShouldBe(await BodyAsync(await client.PostAsJsonAsync("/api/v1/assets", new { matterId = Missing, assetTypeId = d.TypeId, displayName = "Sneaky" })), $"{name}: create");
                }
            }

            // The assignee reads the asset of their own task, and a manager can create and change assets of the matter.
            (await u.AssigneeClient.GetAsync($"/api/v1/assets/{d.A3}")).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await u.PmPrimaryClient.PostAsJsonAsync("/api/v1/assets", new { matterId = u.S1, assetTypeId = d.TypeId, displayName = "By the manager" })).StatusCode.ShouldBe(HttpStatusCode.Created);
            var a1 = await GetAsync(u.PmPrimaryClient, $"/api/v1/assets/{d.A1}");
            (await u.PmPrimaryClient.PutAsJsonAsync($"/api/v1/assets/{d.A1}", new { rowVersion = a1.GetProperty("rowVersion").GetString(), displayName = "Renamed by the manager" })).StatusCode.ShouldBe(HttpStatusCode.OK);

            // Nothing was changed by the 404 writes.
            (await GetAsync(u.H.Admin, $"/api/v1/assets/{d.A2}")).GetProperty("isActive").GetBoolean().ShouldBeTrue();
            (await GetAsync(u.H.Admin, $"/api/v1/assets/{d.A3}")).GetProperty("displayName").GetString()!.ShouldContain(SensitiveUniverse.SentinelPrefix);
        }
        finally
        {
            await d.U.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Global_and_advanced_search_return_only_what_the_rule_gives_and_totals_equal_the_rows()
    {
        var d = await BuildAsync(sql, enabled: true);
        try
        {
            var u = d.U;
            foreach (var (name, client, assets, matters, tasks) in Personas())
            {
                var http = client(u);
                var found = await GetAsync(http, "/api/v1/search?q=ZZSENS&limit=50");
                JsonElement Group(string type) => found.GetProperty("groups").EnumerateArray().Single(g => g.GetProperty("type").GetString() == type);
                long[] HitIds(string type) => [.. Group(type).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetInt64()).Order()];

                var sensitiveOnly = u.SensitiveMatters.Intersect(matters(d)).Select(m => (long)m).Order().ToArray();
                HitIds("matter").ShouldBe(sensitiveOnly, name + ": matters");
                Group("matter").GetProperty("total").GetInt32().ShouldBe(sensitiveOnly.Length, name + ": matter total");

                var sensitiveTasks = tasks(d).Where(t => t != u.TN1).Order().ToArray();
                HitIds("task").ShouldBe(sensitiveTasks, name + ": tasks");
                Group("task").GetProperty("total").GetInt32().ShouldBe(sensitiveTasks.Length, name + ": task total");

                var sensitiveAssets = assets(d).Where(a => a != d.AN).Select(a => (long)a).Order().ToArray();
                HitIds("asset").ShouldBe(sensitiveAssets, name + ": assets");
                Group("asset").GetProperty("total").GetInt32().ShouldBe(sensitiveAssets.Length, name + ": asset total");

                // Projects follow the matter, never the assignee.
                var projects = u.SensitiveMatters.Intersect(matters(d)).Count();
                Group("project").GetProperty("total").GetInt32().ShouldBe(projects, name + ": project total");

                // Every hit marked sensitive is a visible one, and nothing of a hidden matter appears anywhere in the answer.
                var body = found.GetRawText();
                foreach (var matter in u.SensitiveMatters)
                {
                    var visibleSomewhere = matters(d).Contains(matter) || tasks(d).Any(t => t == TaskOf(d, matter)) || assets(d).Any(a => IsOn(d, a, matter));
                    if (!visibleSomewhere)
                        body.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, name);
                }

                // The advanced search gives the same rows and totals, also with the Sensitive filter.
                var advancedMatters = await GetAsync(http, "/api/v1/search/advanced?type=matter&sensitive=true&pageSize=100");
                advancedMatters.GetProperty("total").GetInt32().ShouldBe(sensitiveOnly.Length, name);
                advancedMatters.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetInt64()).Order().ToArray().ShouldBe(sensitiveOnly, name);
                var advancedTasks = await GetAsync(http, "/api/v1/search/advanced?type=task&pageSize=100");
                advancedTasks.GetProperty("total").GetInt32().ShouldBe(tasks(d).Length, name);
                advancedTasks.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetInt64()).Order().ToArray().ShouldBe(tasks(d).Order().ToArray(), name);
                var advancedAssets = await GetAsync(http, "/api/v1/search/advanced?type=asset&pageSize=100");
                advancedAssets.GetProperty("total").GetInt32().ShouldBe(assets(d).Length, name);
                (await GetAsync(http, "/api/v1/search/advanced?type=matter&pageSize=1")).GetProperty("total").GetInt32().ShouldBe(matters(d).Length, name);
            }

            // The assignee finds their task by its title but not the matter in the Matters group.
            var assignee = await GetAsync(u.AssigneeClient, $"/api/v1/search?q={SensitiveUniverse.Sentinel(u.S3)}&limit=50");
            assignee.GetProperty("groups").EnumerateArray().Single(g => g.GetProperty("type").GetString() == "matter").GetProperty("items").GetArrayLength().ShouldBe(0);
            assignee.GetProperty("groups").EnumerateArray().Single(g => g.GetProperty("type").GetString() == "task").GetProperty("items").GetArrayLength().ShouldBe(1);
        }
        finally
        {
            await d.U.H.Factory.DisposeAsync();
        }
    }

    private static long TaskOf(Data d, int matter) => matter == d.U.S1 ? d.U.TS1 : matter == d.U.S2 ? d.U.TS2 : d.U.TS3;
}
