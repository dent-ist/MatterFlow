using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Audit;

/// <summary>
/// The audit trail under the sensitive-matter rule (epic #788, SM-13, inventory R53 to R57): events, search, facets and the task activity show only events of matters
/// and tasks the caller may see, history written while a matter was sensitive stays restricted after un-marking (the stamp, script 36), and the correlation counts
/// and facets are recomputed over what the caller may see.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveAuditTests(SqlServerFixture sql)
{
    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private sealed record Ev(long Id, int? MatterId, long? TaskId, string EventType, string ObjectType, string ObjectId);

    private static async Task<List<Ev>> AllEventsAsync(HttpClient client, string filter = "")
    {
        var events = new List<Ev>();
        long? cursor = null;
        do
        {
            var page = await GetAsync(client, $"/api/v1/audit/search?pageSize=200{filter}" + (cursor is null ? string.Empty : $"&cursor={cursor}"));
            events.AddRange(page.GetProperty("items").EnumerateArray().Select(i => new Ev(
                i.GetProperty("auditEventId").GetInt64(),
                i.TryGetProperty("matterId", out var m) && m.ValueKind == JsonValueKind.Number ? m.GetInt32() : null,
                i.TryGetProperty("taskId", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt64() : null,
                i.GetProperty("eventType").GetString()!,
                i.GetProperty("object").GetProperty("type").GetString()!,
                i.GetProperty("object").GetProperty("id").GetString()!)));
            cursor = page.TryGetProperty("nextCursor", out var next) && next.ValueKind == JsonValueKind.Number ? next.GetInt64() : null;
        }
        while (cursor is not null);

        return events;
    }

    private static (string Name, Func<SensitiveUniverse, HttpClient> Client, Func<SensitiveUniverse, int[]> Matters, Func<SensitiveUniverse, long[]> OwnTasks)[] Personas() =>
    [
        ("P1 primary manager", u => u.PmPrimaryClient, u => [u.N1, u.S1], u => []),
        ("P2 secondary manager", u => u.PmSecondaryClient, u => [u.N1, u.S1], u => []),
        ("P3 task assignee", u => u.AssigneeClient, u => [u.N1], u => [u.TS3]),
        ("P4 view-sensitive holder", u => u.ViewerClient, u => u.AllMatters, u => []),
        ("P5 unrelated", u => u.UnrelatedClient, u => [u.N1], u => []),
        ("Administrator", u => u.H.Admin, u => u.AllMatters, u => []),
    ];

    [Fact]
    public async Task With_the_switch_off_every_persona_sees_the_whole_trail()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: false);
        try
        {
            var all = (await AllEventsAsync(u.H.Admin)).Count;
            all.ShouldBeGreaterThan(0);
            foreach (var (name, client, _, _) in Personas())
                (await AllEventsAsync(client(u))).Count.ShouldBe(all, name);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Search_events_and_task_activity_show_each_persona_only_the_events_of_matters_and_own_tasks_they_may_see()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var reference = await AllEventsAsync(u.H.Admin);
            reference.Select(e => e.MatterId).Distinct().ShouldContain(u.S1);

            foreach (var (name, client, matters, own) in Personas())
            {
                var http = client(u);
                var expected = reference.Where(e => (e.MatterId is null || matters(u).Contains(e.MatterId.Value)) || (e.TaskId is { } t && own(u).Contains(t))).Select(e => e.Id).Order().ToArray();
                var shown = await AllEventsAsync(http);
                shown.Select(e => e.Id).Order().ToArray().ShouldBe(expected, name + ": search rows");

                // A filter on a hidden matter's object finds nothing, the events endpoint answers an empty page like for a missing object.
                foreach (var (matter, task) in new[] { (u.S1, u.TS1), (u.S2, u.TS2), (u.S3, u.TS3) })
                {
                    var visibleTask = matters(u).Contains(matter) || own(u).Contains(task);
                    var events = await GetAsync(http, $"/api/v1/audit/events?objectType=Task&objectId={task}");
                    (events.GetProperty("items").GetArrayLength() > 0).ShouldBe(visibleTask, $"{name}: events of task {task}");
                    var matterEvents = await GetAsync(http, $"/api/v1/audit/search?objectType=Matter&objectId={matter}&pageSize=200");
                    (matterEvents.GetProperty("items").GetArrayLength() > 0).ShouldBe(matters(u).Contains(matter), $"{name}: events of matter {matter}");
                    var activity = await http.GetAsync($"/api/v1/tasks/{task}/activity");
                    if (visibleTask)
                        activity.StatusCode.ShouldBe(HttpStatusCode.OK, name);
                    else
                        activity.StatusCode.ShouldBe(HttpStatusCode.NotFound, name);
                }

                var text = await (await http.GetAsync("/api/v1/audit/search?pageSize=200")).Content.ReadAsStringAsync();
                var ownMatters = own(u).Select(t => t == u.TS3 ? u.S3 : t == u.TS2 ? u.S2 : u.S1).ToArray(); // the matter id of a task one is assigned is part of that task's events
                foreach (var matter in u.SensitiveMatters.Where(m => !matters(u).Contains(m) && !ownMatters.Contains(m)))
                    text.ShouldNotContain($"\"matterId\":{matter},", Case.Sensitive, name);
            }

            (await GetAsync(u.UnrelatedClient, $"/api/v1/audit/events?objectType=Task&objectId={u.TS1}")).GetRawText()
                .ShouldBe((await GetAsync(u.UnrelatedClient, "/api/v1/audit/events?objectType=Task&objectId=999999")).GetRawText());
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Facets_and_correlation_counts_are_computed_over_what_the_caller_may_see()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // A sensitive matter marked at creation writes the dedicated event, which only people who may see that matter find in the lists.
            var clientId = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.N1}")).GetProperty("clientId").GetInt32();
            var created = await OkAsync(
                await u.H.Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "88", name = "Facet matter", isSensitive = true, primaryManagerId = u.PmPrimary }),
                HttpStatusCode.Created);
            var matterId = created.GetProperty("matterId").GetInt32();

            async Task<string[]> EventTypes(HttpClient c) => [.. (await GetAsync(c, "/api/v1/audit/facets")).GetProperty("eventTypes").EnumerateArray().Select(e => e.GetString()!)];
            (await EventTypes(u.H.Admin)).ShouldContain("MATTER_SENSITIVITY_CHANGED");
            (await EventTypes(u.ViewerClient)).ShouldContain("MATTER_SENSITIVITY_CHANGED");
            (await EventTypes(u.PmPrimaryClient)).ShouldContain("MATTER_SENSITIVITY_CHANGED");
            (await EventTypes(u.UnrelatedClient)).ShouldNotContain("MATTER_SENSITIVITY_CHANGED");
            (await EventTypes(u.AssigneeClient)).ShouldNotContain("MATTER_SENSITIVITY_CHANGED");

            // The event itself carries the matter, so it is found only through it.
            (await AllEventsAsync(u.UnrelatedClient)).ShouldNotContain(e => e.EventType == "MATTER_SENSITIVITY_CHANGED" || e.MatterId == matterId);
            (await AllEventsAsync(u.PmPrimaryClient)).ShouldContain(e => e.EventType == "MATTER_SENSITIVITY_CHANGED" && e.MatterId == matterId);
            (await AllEventsAsync(u.PmSecondaryClient)).ShouldNotContain(e => e.MatterId == matterId);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task History_written_while_a_matter_was_sensitive_stays_restricted_after_it_is_un_marked()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var clientId = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.N1}")).GetProperty("clientId").GetInt32();
            var created = await OkAsync(
                await u.H.Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = "89", name = "Once sensitive", isSensitive = true, primaryManagerId = u.PmPrimary }),
                HttpStatusCode.Created);
            var matterId = created.GetProperty("matterId").GetInt32();
            var task = TaskId(await u.H.CreateTaskAsync(u.World, false, new() { ["matterId"] = matterId }));

            // The stamp is written with the events: the matter's creation, the marking and the task created while it was sensitive.
            var stamped = await u.H.ScalarAsync($"SELECT COUNT(*) FROM dbo.AuditEvent WHERE MatterId = {matterId} AND IsSensitiveScope = 1");
            stamped.ShouldBeGreaterThanOrEqualTo(3);
            (await u.H.ScalarAsync($"SELECT COUNT(*) FROM dbo.AuditEvent WHERE MatterId = {matterId} AND IsSensitiveScope = 0")).ShouldBe(0);

            // Un-mark it and make a change that is not sensitive history any more.
            var fresh = await GetAsync(u.H.Admin, $"/api/v1/matters/{matterId}");
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{matterId}", new { name = "Once sensitive, now open", isSensitive = false, rowVersion = fresh.GetProperty("rowVersion").GetString() }));
            (await u.H.ScalarAsync($"SELECT COUNT(*) FROM dbo.AuditEvent WHERE MatterId = {matterId} AND IsSensitiveScope = 0")).ShouldBeGreaterThan(0);

            // Everybody can see the matter now, but the history of the sensitive period stays with its managers and see-all holders.
            (await u.UnrelatedClient.GetAsync($"/api/v1/matters/{matterId}")).StatusCode.ShouldBe(HttpStatusCode.OK);
            var unrelated = await AllEventsAsync(u.UnrelatedClient, $"&objectType=Matter&objectId={matterId}");
            var manager = await AllEventsAsync(u.PmPrimaryClient, $"&objectType=Matter&objectId={matterId}");
            var viewer = await AllEventsAsync(u.ViewerClient, $"&objectType=Matter&objectId={matterId}");
            manager.Count.ShouldBeGreaterThan(unrelated.Count);
            viewer.Count.ShouldBe(manager.Count);
            unrelated.ShouldNotBeEmpty(); // the rename after un-marking is ordinary history
            unrelated.ShouldNotContain(e => e.EventType == "MATTER_SENSITIVITY_CHANGED");
            manager.ShouldContain(e => e.EventType == "MATTER_SENSITIVITY_CHANGED");

            // The task created while the matter was sensitive: its activity omits the stamped events for a person who is not a manager.
            var asManager = await GetAsync(u.PmPrimaryClient, $"/api/v1/tasks/{task}/activity");
            var asOther = await GetAsync(u.UnrelatedClient, $"/api/v1/tasks/{task}/activity");
            asManager.GetProperty("items").GetArrayLength().ShouldBeGreaterThan(0);
            asOther.GetProperty("items").GetArrayLength().ShouldBe(0);

            // My Matters activity follows the same rule.
            var feedOther = await GetAsync(u.UnrelatedClient, "/api/v1/my-matters/activity?scope=all&take=100");
            var feedManager = await GetAsync(u.PmPrimaryClient, "/api/v1/my-matters/activity?scope=all&take=100");
            feedOther.GetProperty("items").EnumerateArray().Count(i => i.GetProperty("matterId").GetInt32() == matterId)
                .ShouldBeLessThan(feedManager.GetProperty("items").EnumerateArray().Count(i => i.GetProperty("matterId").GetInt32() == matterId));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
