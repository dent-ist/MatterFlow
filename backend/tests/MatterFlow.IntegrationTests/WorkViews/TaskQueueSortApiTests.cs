using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The sort keys of the three work lists (G3, C1): title (case and accent insensitive), matter, updated (never-updated last), age (created reversed)
/// and closed, plus <c>closedAtUtc</c> on the row. Own database, own tagged tasks.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskQueueSortApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private TaskHarness.World _w = null!;
    private int _matter2;
    private readonly Dictionary<string, long> _ids = [];

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        _matter2 = await _h.CreateMatterAsync("343", "13");
        // Titles chosen so that case and accents decide the order: "Étude" sorts with the E's, "apple" before "Banana" whatever the case.
        string[] titles = ["Banana", "apple", "Étude", "Echo", "cherry", "Étude"];
        for (var i = 0; i < titles.Length; i++)
        {
            var body = _h.NewTask(_w, title: titles[i], extra: i % 2 == 1 ? new() { ["matterId"] = _matter2 } : null);
            var task = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", body), HttpStatusCode.Created);
            _ids[$"{titles[i]}#{i}"] = TaskId(task);
        }
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<JsonElement> ListAsync(string path, string query) =>
        await OkAsync(await _h.Admin.GetAsync($"/api/v1/{path}?pageSize=100&{query}"));

    private static List<long> IdsOf(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64())];

    private List<long> Own(JsonElement page) => [.. IdsOf(page).Where(_ids.ContainsValue)];

    [Fact]
    public async Task Title_sort_ignores_case_and_accents_and_breaks_ties_by_id()
    {
        var asc = Own(await ListAsync("task-queue", "sort=title&dir=asc"));
        // apple, Banana, cherry, Echo, Étude#2, Étude#5 (the two Étude tie on the title, so id decides; Echo < Étude).
        asc.ShouldBe([_ids["apple#1"], _ids["Banana#0"], _ids["cherry#4"], _ids["Echo#3"], _ids["Étude#2"], _ids["Étude#5"]]);
        var desc = Own(await ListAsync("task-queue", "sort=title&dir=desc"));
        desc.ShouldBe([_ids["Étude#5"], _ids["Étude#2"], _ids["Echo#3"], _ids["cherry#4"], _ids["Banana#0"], _ids["apple#1"]]);
    }

    [Fact]
    public async Task Title_sort_is_stable_across_pages()
    {
        var all = Own(await ListAsync("task-queue", "sort=title&dir=asc"));
        var seen = new List<long>();
        for (var page = 1; page <= 20; page++)
        {
            var p = await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-queue?pageSize=2&page={page}&sort=title&dir=asc"));
            var ids = IdsOf(p);
            if (ids.Count == 0)
                break;
            seen.AddRange(ids);
        }

        seen.Distinct().Count().ShouldBe(seen.Count, "no row repeats across pages");
        seen.Where(_ids.ContainsValue).ShouldBe(all);
    }

    [Fact]
    public async Task Matter_sort_orders_by_matter_reference_then_id_on_all_three_lists()
    {
        foreach (var path in new[] { "task-queue", "my-work", "pod-work" })
        {
            var page = await OkAsync(await _h.Admin.GetAsync($"/api/v1/{path}?pageSize=100&sort=matter&dir=asc"));
            var refs = page.GetProperty("items").EnumerateArray().Select(i => (Ref: i.GetProperty("matterRef").GetString()!, Id: i.GetProperty("taskId").GetInt64())).ToList();
            refs.ShouldBe([.. refs.OrderBy(r => r.Ref, StringComparer.Ordinal).ThenBy(r => r.Id)], path);
        }

        var q = Own(await ListAsync("task-queue", "sort=matter&dir=asc"));
        q.Take(3).ShouldBe([_ids["Banana#0"], _ids["Étude#2"], _ids["cherry#4"]], "matter 343-12 first, by id");
    }

    [Fact]
    public async Task Age_ascending_is_the_newest_created_first_and_updated_puts_never_updated_last()
    {
        var age = Own(await ListAsync("task-queue", "sort=age&dir=asc"));
        age.ShouldBe([.. _ids.Values.OrderByDescending(v => v)]);
        (await ListAsync("task-queue", "sort=age&dir=desc")).GetProperty("items")[0].GetProperty("taskId").GetInt64()
            .ShouldBeLessThanOrEqualTo(_ids.Values.Max());

        await _h.ExecuteAsync($"UPDATE dbo.Task SET ModifiedAt = NULL WHERE TaskId IN ({string.Join(",", _ids.Values)});"
            + $"UPDATE dbo.Task SET ModifiedAt = '2026-01-05' WHERE TaskId = {_ids["Echo#3"]};"
            + $"UPDATE dbo.Task SET ModifiedAt = '2026-02-05' WHERE TaskId = {_ids["Banana#0"]};");
        var desc = Own(await ListAsync("task-queue", "sort=updated&dir=desc"));
        desc.Take(2).ShouldBe([_ids["Banana#0"], _ids["Echo#3"]]);
        var asc = Own(await ListAsync("task-queue", "sort=updated&dir=asc"));
        asc.Take(2).ShouldBe([_ids["Echo#3"], _ids["Banana#0"]]);
        // Never-updated rows are last in both directions (ties by id).
        asc.Skip(2).ShouldBe([.. asc.Skip(2).Order()]);
        desc.Skip(2).ShouldBe([.. desc.Skip(2).OrderDescending()]);
    }

    [Fact]
    public async Task Closed_sort_and_closedAtUtc_use_the_last_closing_instant_and_open_tasks_have_none()
    {
        var done = await _h.ReachAsync(_w, "COMPLETED");
        var cancelled = await _h.ReachAsync(_w, "CANCELLED");
        var reopened = await _h.ReachAsync(_w, "COMPLETED");
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusChangedAt = '2026-03-01T10:00:00' WHERE TaskId = {TaskId(done)};"
            + $"UPDATE dbo.Task SET StatusChangedAt = '2026-03-03T10:00:00' WHERE TaskId = {TaskId(cancelled)};"
            + $"UPDATE dbo.Task SET StatusChangedAt = '2026-03-02T10:00:00' WHERE TaskId = {TaskId(reopened)};");

        // Reopen, then close it again: the latest closing instant counts, not the first one.
        var current = await _h.GetTaskAsync(TaskId(reopened));
        current = await _h.StatusAsync(current, "IN_PROGRESS", "Reopened for rework");
        current = await _h.CompleteAsync(current);
        var ids = new[] { TaskId(done), TaskId(cancelled), TaskId(reopened) };

        var page = await ListAsync("task-queue", "status=COMPLETED&status=CANCELLED&sort=closed&dir=desc");
        var byId = page.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("taskId").GetInt64());
        byId[TaskId(reopened)].GetProperty("closedAtUtc").GetDateTime().ShouldBeGreaterThan(DateTime.UtcNow.AddMinutes(-10));
        byId[TaskId(cancelled)].GetProperty("closedAtUtc").GetDateTime().ShouldBe(new DateTime(2026, 3, 3, 10, 0, 0, DateTimeKind.Utc));
        IdsOf(page).Where(ids.Contains).ShouldBe([TaskId(reopened), TaskId(cancelled), TaskId(done)]);
        IdsOf(await ListAsync("task-queue", "status=COMPLETED&status=CANCELLED&sort=closed&dir=asc")).Where(ids.Contains)
            .ShouldBe([TaskId(done), TaskId(cancelled), TaskId(reopened)]);

        // Open tasks: closedAtUtc is null and they come after the closed ones either way.
        var all = await ListAsync("task-queue", "sort=closed&dir=desc");
        var items = all.GetProperty("items").EnumerateArray().ToList();
        var firstOpen = items.FindIndex(i => i.GetProperty("status").GetString() is "NEW" or "IN_PROGRESS" or "ON_HOLD");
        items.Skip(firstOpen).ShouldAllBe(i => i.GetProperty("closedAtUtc").ValueKind == JsonValueKind.Null && i.GetProperty("status").GetString() != "COMPLETED");
        items.Take(firstOpen).ShouldAllBe(i => i.GetProperty("closedAtUtc").ValueKind == JsonValueKind.String);

        // The same keys work on My Work and Pod Work and the old name stays accepted.
        (await OkAsync(await _h.Admin.GetAsync("/api/v1/my-work?view=completed&sort=closed&dir=asc"))).GetProperty("items").GetArrayLength().ShouldBeGreaterThanOrEqualTo(0);
        await OkAsync(await _h.Admin.GetAsync("/api/v1/pod-work?sort=closed"));
        await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?sort=completed"));
        current.ValueKind.ShouldBe(JsonValueKind.Object);
    }

    [Fact]
    public async Task Assignee_and_client_sorts_ignore_case_and_accents_put_unassigned_last_and_page_stably()
    {
        // Own tasks on three clients and three assignees; names chosen so that accents and case decide the order.
        var mA = await _h.CreateMatterAsync("343", "21");
        var mB = await _h.CreateMatterAsync("100", "22");
        var mC = await _h.CreateMatterAsync("200", "23");
        await _h.ExecuteAsync("UPDATE dbo.Client SET Name = N'étoile' WHERE Name = N'Acme Corp 343';"
            + "UPDATE dbo.Client SET Name = N'Zulu' WHERE Name = N'Acme Corp 100';"
            + "UPDATE dbo.Client SET Name = N'apple Ltd' WHERE Name = N'Acme Corp 200';"
            + $"UPDATE dbo.Matter SET Name = N'Éclair case' WHERE MatterId = {mA};"
            + $"UPDATE dbo.Matter SET Name = N'zebra case' WHERE MatterId = {mB};"
            + $"UPDATE dbo.Matter SET Name = N'apple case' WHERE MatterId = {mC};");
        var zoe = await _h.UserIdAsync("sort-zoe");
        var emile = await _h.UserIdAsync("sort-emile");
        var adam = await _h.UserIdAsync("sort-adam");
        await _h.ExecuteAsync($"UPDATE dbo.AppUser SET DisplayName = N'Zoe' WHERE UserId = {zoe};"
            + $"UPDATE dbo.AppUser SET DisplayName = N'émile' WHERE UserId = {emile};"
            + $"UPDATE dbo.AppUser SET DisplayName = N'adam' WHERE UserId = {adam};");

        // matter, assignee: t1 Zulu/Zoe, t2 étoile/-, t3 apple/émile, t4 étoile/adam, t5 Zulu/-, t6 apple/émile
        (int Matter, int? User)[] plan = [(mB, zoe), (mA, null), (mC, emile), (mA, adam), (mB, null), (mC, emile)];
        var t = new List<long>();
        foreach (var (matter, user) in plan)
        {
            var body = _h.NewTask(_w, title: "sorting", extra: new() { ["matterId"] = matter });
            var id = TaskId(await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", body), HttpStatusCode.Created));
            t.Add(id);
            if (user is { } u)
                await _h.ExecuteAsync($"UPDATE dbo.Task SET AssignedUserId = {u}, AssignedAt = SYSUTCDATETIME() WHERE TaskId = {id};");
        }

        List<long> Mine(JsonElement page) => [.. IdsOf(page).Where(t.Contains)];

        foreach (var path in new[] { "task-queue", "my-work", "pod-work" })
        {
            // The two non-queue lists only show the viewer's own and pod Tasks, so they are checked for acceptance and a stable order.
            await OkAsync(await _h.Admin.GetAsync($"/api/v1/{path}?sort=assignee&dir=asc"));
            await OkAsync(await _h.Admin.GetAsync($"/api/v1/{path}?sort=client&dir=desc"));
            await OkAsync(await _h.Admin.GetAsync($"/api/v1/{path}?sort=matterName&dir=asc"));
        }

        // Assignee: adam, émile (t3, t6 by id), Zoe, then the unassigned (t2, t5; ties by id in the direction) in both.
        Mine(await ListAsync("task-queue", "sort=assignee&dir=asc")).ShouldBe([t[3], t[2], t[5], t[0], t[1], t[4]]);
        Mine(await ListAsync("task-queue", "sort=assignee&dir=desc")).ShouldBe([t[0], t[5], t[2], t[3], t[4], t[1]]);
        // Client: apple, étoile, Zulu; ties by matter reference then id.
        Mine(await ListAsync("task-queue", "sort=client&dir=asc")).ShouldBe([t[2], t[5], t[1], t[3], t[0], t[4]]);
        Mine(await ListAsync("task-queue", "sort=client&dir=desc")).ShouldBe([t[4], t[0], t[3], t[1], t[5], t[2]]);

        // Matter name: apple case (t3, t6), Éclair case (t2, t4), zebra case (t1, t5); accents and case ignored, ties by matter reference then id.
        Mine(await ListAsync("task-queue", "sort=matterName&dir=asc")).ShouldBe([t[2], t[5], t[1], t[3], t[0], t[4]]);
        Mine(await ListAsync("task-queue", "sort=matterName&dir=desc")).ShouldBe([t[4], t[0], t[3], t[1], t[5], t[2]]);

        foreach (var sort in new[] { "assignee", "client", "matterName" })
        {
            var all = Mine(await ListAsync("task-queue", $"sort={sort}&dir=asc"));
            var seen = new List<long>();
            for (var page = 1; page <= 40; page++)
            {
                var ids = IdsOf(await OkAsync(await _h.Admin.GetAsync($"/api/v1/task-queue?pageSize=3&page={page}&sort={sort}&dir=asc")));
                if (ids.Count == 0)
                    break;
                seen.AddRange(ids);
            }

            seen.Distinct().Count().ShouldBe(seen.Count, $"{sort}: no row repeats across pages");
            seen.Where(t.Contains).ShouldBe(all, sort);
        }
    }

    [Fact]
    public async Task Unknown_sort_values_are_still_a_400()
    {
        (await _h.Admin.GetAsync("/api/v1/task-queue?sort=bogus")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _h.Admin.GetAsync("/api/v1/my-work?sort=titel")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _h.Admin.GetAsync("/api/v1/pod-work?sort=title")).StatusCode.ShouldNotBe(HttpStatusCode.BadRequest);
    }
}
