using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Security;

/// <summary>
/// The aggregates of PM v2 against the access matrix of the sensitive-matter walk (epic #788 README sections 12 and 16, epic #851 issue #888, PV-37): for every persona the Breakdown, the
/// Data tab, its volume chart and the report engine count exactly the tasks and assets of the matters that persona may see, show no row, label or sentinel of a hidden matter, and follow a
/// change of access on the very next request. The saved report run (one person's own definition) is walked here because its id belongs to one caller.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitivePmV2Tests(SqlServerFixture sql)
{
    // The universe: one task on each matter (TN1 on N1, TS1 on S1, TS2 on S2, TS3 on S3); assets a[0] on N1, a[1] on S1, a[2] on S2, a[3] and a[4] on S3.
    private static readonly int[] AssetsPerMatterOrder = [1, 1, 1, 2];

    private static int ExpectedAssets(WalkPersona persona, SensitiveUniverse u) =>
        new[] { u.N1, u.S1, u.S2, u.S3 }.Zip(AssetsPerMatterOrder).Where(p => persona.Matters.Contains(p.First)).Sum(p => p.Second);

    [Fact]
    public async Task Breakdown_data_volume_and_reports_count_only_what_each_persona_may_see_and_follow_a_change_on_the_next_request()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var walk = PersonaWalk.Create(u, await PersonaWalk.PrepareAsync(u));
            u.H.Factory.InvalidateAll();

            await CheckAsync(u, walk, walk.Personas(), "before");

            // Remove the Primary manager of S1: the very next request of that person drops the matter, its tasks and its assets from every figure (no wait, no cache to expire).
            var matter = await OkAsync(await u.H.Admin.GetAsync($"/api/v1/matters/{u.S1}"));
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = u.PmSecondary, rowVersion = matter.GetProperty("rowVersion").GetString() }));
            await CheckAsync(u, walk, walk.Personas(primaryStillManages: false), "after removing the Primary manager of S1");

            // Give S1 back to the person: the figures come back on the next request as well.
            matter = await OkAsync(await u.H.Admin.GetAsync($"/api/v1/matters/{u.S1}"));
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = u.PmPrimary, secondaryManagerId = u.PmSecondary, rowVersion = matter.GetProperty("rowVersion").GetString() }));
            await CheckAsync(u, walk, walk.Personas(), "after giving S1 back");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task With_the_switch_off_every_persona_sees_everything_and_the_walk_and_the_aggregates_agree_with_that_matrix()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: false);
        try
        {
            var walk = PersonaWalk.Create(u, await PersonaWalk.PrepareAsync(u));
            u.H.Factory.InvalidateAll();
            var everybody = walk.PersonasWithTheRuleOff();
            await walk.RunAsync(everybody);
            walk.Violations.ShouldBeEmpty(string.Join(Environment.NewLine, walk.Violations.Take(40)));
            await CheckAsync(u, walk, everybody, "with the switch off");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    private static async Task CheckAsync(SensitiveUniverse u, PersonaWalk walk, IReadOnlyList<WalkPersona> personas, string when)
    {
        var taskMatter = new Dictionary<long, int> { [u.TN1] = u.N1, [u.TS1] = u.S1, [u.TS2] = u.S2, [u.TS3] = u.S3 };
        foreach (var persona in personas)
        {
            var name = $"{persona.Name} {when}";
            var visibleMatters = persona.Matters.ToHashSet();
            var visibleTasks = taskMatter.Count(t => visibleMatters.Contains(t.Value)); // the matter rule: an assignee's task on a hidden matter does not appear in an aggregate

            // Breakdown, all matters: totals, rows and per type figures follow the visible matters.
            var breakdown = await persona.Client.GetAsync("/api/v1/my-matters/breakdown?scope=all");
            var breakdownBody = await breakdown.Content.ReadAsStringAsync();
            breakdown.StatusCode.ShouldBe(HttpStatusCode.OK, name + breakdownBody);
            var b = JsonDocument.Parse(breakdownBody).RootElement;
            b.GetProperty("totals").GetProperty("open").GetInt32().ShouldBe(visibleTasks, name + ": breakdown total");
            b.GetProperty("matterTotal").GetInt32().ShouldBe(visibleTasks, name + ": breakdown matters");
            b.GetProperty("rows").EnumerateArray().Sum(r => r.GetProperty("open").GetInt32()).ShouldBe(visibleTasks, name + ": sum of the rows");
            b.GetProperty("rows").EnumerateArray().SelectMany(r => r.GetProperty("cells").EnumerateArray()).Sum(c => c.GetProperty("open").GetInt32()).ShouldBe(visibleTasks, name + ": sum of the cells");
            b.GetProperty("types").EnumerateArray().Sum(t => t.GetProperty("open").GetInt32()).ShouldBe(visibleTasks, name + ": sum of the type totals");
            b.GetProperty("rows").EnumerateArray().Select(r => r.GetProperty("matterId").GetInt32()).Order().ShouldBe(visibleMatters.Order(), name + ": breakdown rows");
            NoHiddenSentinel(u, visibleMatters, breakdownBody, name + ": breakdown");

            // The per type view (no matter rows) counts the same tasks.
            var types = await OkAsync(await persona.Client.GetAsync("/api/v1/my-matters/breakdown?scope=all&view=types"));
            types.GetProperty("totals").GetProperty("open").GetInt32().ShouldBe(visibleTasks, name + ": per type view");
            types.GetProperty("rows").GetArrayLength().ShouldBe(0, name);

            // Data: the assets of the visible matters, per matter and in total; the volume chart sums the same matters.
            var expectedAssets = ExpectedAssets(persona, u);
            var dataResponse = await persona.Client.GetAsync("/api/v1/my-matters/data?scope=all");
            var dataBody = await dataResponse.Content.ReadAsStringAsync();
            dataResponse.StatusCode.ShouldBe(HttpStatusCode.OK, name + dataBody);
            var data = JsonDocument.Parse(dataBody).RootElement;
            data.GetProperty("totals").GetProperty("assets").GetInt32().ShouldBe(expectedAssets, name + ": data total");
            data.GetProperty("matters").EnumerateArray().Sum(m => m.GetProperty("counts").GetProperty("assets").GetInt32()).ShouldBe(expectedAssets, name + ": sum of the matters");
            data.GetProperty("matters").EnumerateArray().Select(m => m.GetProperty("matterId").GetInt32()).Order().ShouldBe(visibleMatters.Order(), name + ": data matters");
            NoHiddenSentinel(u, visibleMatters, dataBody, name + ": data");

            // The selection of the Data Area: asking for every matter, or only for the hidden ones, never counts or names a matter the persona may not see.
            var every = new[] { u.N1, u.S1, u.S2, u.S3 };
            var asked = string.Join('&', every.Select(m => "matterIds=" + m));
            var chosenResponse = await persona.Client.GetAsync($"/api/v1/my-matters/data?scope=all&{asked}");
            var chosenBody = await chosenResponse.Content.ReadAsStringAsync();
            chosenResponse.StatusCode.ShouldBe(HttpStatusCode.OK, name + chosenBody);
            var chosen = JsonDocument.Parse(chosenBody).RootElement;
            chosen.GetProperty("totals").GetProperty("assets").GetInt32().ShouldBe(expectedAssets, name + ": data with every matter asked for");
            chosen.GetProperty("selectedMatters").EnumerateArray().Select(m => m.GetProperty("matterId").GetInt32()).Order().ShouldBe(visibleMatters.Order(), name + ": selected matters");
            NoHiddenSentinel(u, visibleMatters, chosenBody, name + ": data with matter ids");

            var hiddenOnly = every.Where(m => !visibleMatters.Contains(m)).ToArray();
            if (hiddenOnly.Length > 0)
            {
                var hiddenAsked = string.Join('&', hiddenOnly.Select(m => "matterIds=" + m));
                var hiddenResponse = await persona.Client.GetAsync($"/api/v1/my-matters/data?scope=all&{hiddenAsked}");
                var hiddenBody = await hiddenResponse.Content.ReadAsStringAsync();
                hiddenResponse.StatusCode.ShouldBe(HttpStatusCode.OK, name + ": hidden ids are not an error " + hiddenBody);
                var hidden = JsonDocument.Parse(hiddenBody).RootElement;
                hidden.GetProperty("totals").GetProperty("assets").GetInt32().ShouldBe(0, name + ": hidden ids in a total");
                hidden.GetProperty("matters").GetArrayLength().ShouldBe(0, name + ": hidden ids as a row");
                hidden.GetProperty("types").GetArrayLength().ShouldBe(0, name + ": hidden ids as a type row");
                hidden.GetProperty("selectedMatters").GetArrayLength().ShouldBe(0, name + ": hidden ids named");
                NoHiddenSentinel(u, visibleMatters, hiddenBody, name + ": data with hidden ids only");

                // The same answer as for ids that do not exist: nothing tells a hidden matter from a missing one.
                var missingResponse = await persona.Client.GetAsync("/api/v1/my-matters/data?scope=all&matterIds=2147000001&matterIds=2147000002");
                missingResponse.StatusCode.ShouldBe(HttpStatusCode.OK, name);
                (await missingResponse.Content.ReadAsStringAsync()).ShouldBe(hiddenBody, name + ": hidden ids answer like ids that do not exist");
                var hiddenVolume = await OkAsync(await persona.Client.GetAsync($"/api/v1/my-matters/data/volume?scope=all&{hiddenAsked}"));
                hiddenVolume.GetProperty("points").EnumerateArray().All(p => p.GetProperty("assets").GetInt32() == 0 && p.GetProperty("assetsAdded").GetInt32() == 0).ShouldBeTrue(name + ": hidden ids in the volume");
            }

            var chosenVolume = await persona.Client.GetAsync($"/api/v1/my-matters/data/volume?scope=all&{asked}");
            var chosenVolumeBody = await chosenVolume.Content.ReadAsStringAsync();
            chosenVolume.StatusCode.ShouldBe(HttpStatusCode.OK, name + chosenVolumeBody);
            NoHiddenSentinel(u, visibleMatters, chosenVolumeBody, name + ": volume with matter ids");

            var volumeResponse = await persona.Client.GetAsync("/api/v1/my-matters/data/volume?scope=all");
            var volumeBody = await volumeResponse.Content.ReadAsStringAsync();
            volumeResponse.StatusCode.ShouldBe(HttpStatusCode.OK, name + volumeBody);
            NoHiddenSentinel(u, visibleMatters, volumeBody, name + ": volume");

            // Reports: the same assets, whatever the grouping, and group labels of visible matters only.
            foreach (var groupBy in new[] { "disposition", "matter", "client", "assetType" })
            {
                var body = new Dictionary<string, object?> { ["v"] = 1, ["measure"] = "count", ["groupBy"] = groupBy, ["scope"] = "all" };
                var reportResponse = await persona.Client.PostAsJsonAsync("/api/v1/asset-reports/run", body);
                var reportBody = await reportResponse.Content.ReadAsStringAsync();
                reportResponse.StatusCode.ShouldBe(HttpStatusCode.OK, $"{name}: report by {groupBy} {reportBody}");
                var report = JsonDocument.Parse(reportBody).RootElement;
                report.GetProperty("assets").GetInt32().ShouldBe(expectedAssets, $"{name}: report by {groupBy}");
                NoHiddenSentinel(u, visibleMatters, reportBody, $"{name}: report by {groupBy}");
                if (groupBy == "matter")
                    report.GetProperty("rows").EnumerateArray().Select(r => int.Parse(r.GetProperty("key").GetString()!)).Order().ShouldBe(visibleMatters.Order(), name + ": report rows");
            }

            // The Task Queue export (CSV and text) lists the same tasks as the screen and no sentinel of a hidden task.
            foreach (var format in new[] { "csv", "text" })
            {
                var export = await persona.Client.GetAsync($"/api/v1/task-queue/export?format={format}&q={SensitiveUniverse.SentinelPrefix}");
                var exportBody = await export.Content.ReadAsStringAsync();
                export.StatusCode.ShouldBe(HttpStatusCode.OK, name + exportBody);
                foreach (var hidden in u.SensitiveMatters.Where(m => !persona.Tasks.Contains(TaskOf(u, m))))
                    exportBody.ShouldNotContain(SensitiveUniverse.Sentinel(hidden), Case.Sensitive, $"{name}: {format} export");
            }
        }
    }

    private static long TaskOf(SensitiveUniverse u, int matter) => matter == u.S1 ? u.TS1 : matter == u.S2 ? u.TS2 : u.TS3;

    private static void NoHiddenSentinel(SensitiveUniverse u, HashSet<int> visible, string body, string what)
    {
        foreach (var hidden in u.SensitiveMatters.Where(m => !visible.Contains(m)))
            body.ShouldNotContain(SensitiveUniverse.Sentinel(hidden), Case.Sensitive, what);
    }

    [Fact]
    public async Task A_saved_report_runs_with_the_current_access_of_its_owner_and_nobody_else_can_run_it()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var walk = PersonaWalk.Create(u, await PersonaWalk.PrepareAsync(u));
            u.H.Factory.InvalidateAll();
            var personas = walk.Personas();
            var saved = new Dictionary<string, int>();
            var definition = new Dictionary<string, object?> { ["v"] = 1, ["measure"] = "count", ["groupBy"] = "matter", ["scope"] = "all" };
            foreach (var persona in personas)
            {
                var created = await OkAsync(await persona.Client.PostAsJsonAsync("/api/v1/asset-reports", new { name = "By matter", definition }), HttpStatusCode.Created);
                saved[persona.Name] = created.GetProperty("assetReportId").GetInt32();
            }

            foreach (var persona in personas)
            {
                var run = await persona.Client.GetAsync($"/api/v1/asset-reports/{saved[persona.Name]}/run");
                var body = await run.Content.ReadAsStringAsync();
                run.StatusCode.ShouldBe(HttpStatusCode.OK, persona.Name + body);
                var result = JsonDocument.Parse(body).RootElement;
                result.GetProperty("assets").GetInt32().ShouldBe(ExpectedAssets(persona, u), persona.Name);
                result.GetProperty("rows").EnumerateArray().Select(r => int.Parse(r.GetProperty("key").GetString()!)).Order().ShouldBe(persona.Matters.Order(), persona.Name);
                NoHiddenSentinel(u, persona.Matters, body, persona.Name + ": saved report");

                // Another person's report is a 404, byte for byte like a missing id.
                var foreign = personas.First(p => p.Name != persona.Name);
                var other = await persona.Client.GetAsync($"/api/v1/asset-reports/{saved[foreign.Name]}/run");
                var missing = await persona.Client.GetAsync("/api/v1/asset-reports/999999/run");
                other.StatusCode.ShouldBe(HttpStatusCode.NotFound, persona.Name);
                missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
                Strip(await other.Content.ReadAsStringAsync()).ShouldBe(Strip(await missing.Content.ReadAsStringAsync()), persona.Name);
            }

            // The saved definition is only a definition: after the Primary manager of S1 is removed the same saved report shows one matter less on its next run.
            var matter = await OkAsync(await u.H.Admin.GetAsync($"/api/v1/matters/{u.S1}"));
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = u.PmSecondary, rowVersion = matter.GetProperty("rowVersion").GetString() }));
            var primary = personas.First(p => p.Name.StartsWith("P1", StringComparison.Ordinal));
            var after = await OkAsync(await primary.Client.GetAsync($"/api/v1/asset-reports/{saved[primary.Name]}/run"));
            after.GetProperty("rows").EnumerateArray().Select(r => int.Parse(r.GetProperty("key").GetString()!)).Order().ShouldBe(new[] { u.N1 }.Order());
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    private static string Strip(string body)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(body)!.AsObject();
        node.Remove("traceId");
        node.Remove("instance");
        return node.ToJsonString();
    }
}
