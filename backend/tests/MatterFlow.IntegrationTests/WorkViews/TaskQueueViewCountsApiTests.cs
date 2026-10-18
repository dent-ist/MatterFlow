using System.Globalization;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The Task Queue quick-view counts (<c>views</c> on GET /api/v1/task-queue, #218): each equals the grid total of the same view's filters and, where
/// the Dashboard has a tile for it, the tile's count and the total of the tile's own drill-through query; they are never narrowed by the request's
/// filters. Worked out for two people (one with a primary Pod, one without) in three time zones at a fixed clock (2026-10-14 16:00 UTC).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskQueueViewCountsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
    private static readonly string[] OpenQuery = ["status=NEW", "status=IN_PROGRESS", "status=ON_HOLD"];

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private readonly Dictionary<string, HttpClient> _clients = [];
    private readonly Dictionary<string, int> _ids = [];
    private int _pod;
    private int _lowPriority;

    private sealed record Seed(string Title, string Status, string? User, int Priority, DateOnly? Due, DateTime Changed, DateTime? DueAt = null);

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        foreach (var name in new[] { "ann", "bob" })
        {
            _clients[name] = await _h.UserWithAsync($@"KE\{name}", "Task.View", "Dashboard.View", "Dashboard.ViewSummary");
            _ids[name] = await _h.UserIdAsync($@"KE\{name}");
        }

        _pod = await _h.CreatePodAsync("Counts pod", _ids["ann"]);
        await _h.ExecuteAsync($"UPDATE dbo.PodMember SET IsPrimary = 1 WHERE UserId = {_ids["ann"]} AND PodId = {_pod}");

        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        int PriorityId(string label) => priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == label).GetProperty("id").GetInt32();
        int critical = PriorityId("Critical"), normal = PriorityId("Normal");
        _lowPriority = PriorityId("Low");

        static DateOnly D(int month, int day) => new(2026, month, day);
        static DateTime At(int month, int day, int hour = 14) => new(2026, month, day, hour, 0, 0, DateTimeKind.Utc);

        List<Seed> seeds =
        [
            new("pod-over", "NEW", null, normal, D(10, 13), At(10, 1)),
            new("pod-today", "IN_PROGRESS", "ann", normal, D(10, 14), At(10, 1)),
            new("pod-asap", "NEW", null, critical, null, At(10, 1)),
            new("pod-hold", "ON_HOLD", "bob", _lowPriority, D(10, 15), At(10, 1)),
            new("pod-soon", "NEW", null, normal, D(10, 16), At(10, 1)),
            new("none-edge", "NEW", null, normal, D(10, 17), At(10, 1)),
            new("none-far", "NEW", "bob", normal, D(12, 31), At(10, 1)),
            new("none-asap-hold", "ON_HOLD", null, normal, null, At(10, 1)),
            new("timed-past", "NEW", "ann", normal, D(10, 14), At(10, 1), At(10, 14, 15)),
            new("timed-later", "NEW", "bob", normal, D(10, 14), At(10, 1), At(10, 14, 20)),
            new("mine-done-new", "COMPLETED", "ann", normal, null, At(10, 10)),
            new("mine-done-edge", "COMPLETED", "ann", normal, null, At(9, 14)),
            // The window is 30 days including today (BUG-TQ7): the 29th day back is in, the 30th is out, in every zone below.
            new("mine-done-d29", "COMPLETED", "ann", normal, null, At(9, 16, 12)),
            new("mine-done-d30", "COMPLETED", "ann", normal, null, At(9, 14, 23)),
            new("mine-done-edge2", "COMPLETED", "bob", normal, null, At(9, 15, 1)),
            new("mine-done-old", "COMPLETED", "bob", normal, null, At(8, 1)),
            new("mine-cancelled", "CANCELLED", "ann", normal, D(10, 1), At(10, 12)),
        ];
        await _h.ExecuteAsync(SeedSql(world, admin, seeds));
        await _h.ExecuteAsync($"UPDATE dbo.Task SET AssignedPodId = {_pod} WHERE Title LIKE N'pod-%'; UPDATE dbo.Task SET CreatedByUserId = {_ids["ann"]} WHERE Title LIKE N'mine-%' OR Title = N'pod-asap'");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private string SeedSql(World world, int admin, List<Seed> seeds)
    {
        string Instant(DateTime v) => "'" + v.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) + "'";
        var text = new System.Text.StringBuilder("SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = "
            + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n");
        foreach (var s in seeds)
        {
            var due = s.Due is { } d ? "'" + d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'" : "NULL";
            var sortKey = s.Due is null ? "NULL" : "DATEADD(MILLISECOND, 86399999, CAST(" + due + " AS DATETIME2(3)))";
            var dueAt = s.DueAt is { } at ? Instant(at) : "NULL";
            var user = s.User is null ? "NULL" : _ids[s.User].ToString(CultureInfo.InvariantCulture);
            text.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n")
                .Append("INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedPodId, AssignedUserId, RequestorName, DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES (")
                .Append(CultureInfo.InvariantCulture, $"{world.MatterId}, {world.TaskTypeId}, @i, N'{s.Title}', {s.Priority}, '{s.Status}', NULL, {user}, N'Requestor', {due}, {dueAt}, {sortKey}, {Instant(s.Changed)}, ")
                .Append(s.Status == "COMPLETED" ? Instant(s.Changed) : "NULL")
                .Append(CultureInfo.InvariantCulture, $", {Instant(s.Changed.AddDays(-1))}, {admin});\n");
        }

        return text.ToString();
    }

    private static async Task<JsonElement> GetAsync(HttpClient client, string path, string zone)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("X-Time-Zone", zone);
        return await OkAsync(await client.SendAsync(request));
    }

    private async Task<int> GridTotalAsync(HttpClient client, string zone, string query) =>
        (await GetAsync(client, "/api/v1/task-queue?pageSize=1&" + query, zone)).GetProperty("total").GetInt32();

    private static string RecentFrom(string zone)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(Now, TimeZoneInfo.FindSystemTimeZoneById(zone));
        return DateOnly.FromDateTime(local).AddDays(-29).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    [Theory]
    [InlineData("ann", "America/New_York")]
    [InlineData("ann", "Pacific/Auckland")]
    [InlineData("ann", "America/Los_Angeles")]
    [InlineData("bob", "America/New_York")]
    [InlineData("bob", "Pacific/Auckland")]
    [InlineData("bob", "America/Los_Angeles")]
    public async Task Each_view_count_equals_its_grid_total_and_the_dashboard_tile(string user, string zone)
    {
        var client = _clients[user];
        var views = (await GetAsync(client, "/api/v1/task-queue?pageSize=1", zone)).GetProperty("views");
        var dashboard = await GetAsync(client, "/api/v1/dashboard?fresh=true", zone);
        var open = string.Join("&", OpenQuery);

        // The Dashboard tiles: the count, and the total of the tile's own drill-through query, are the view's count.
        foreach (var (view, tile) in new[] { ("open", "open"), ("unassigned", "unassigned"), ("overdue", "overdue"), ("dueSoon", "dueSoon"), ("asap", "asapOpen"), ("onHold", "onHold"), ("recentlyCompleted", "completed") })
        {
            var t = dashboard.GetProperty(tile);
            views.GetProperty(view).GetInt32().ShouldBe(t.GetProperty("count").GetInt32(), $"{user} {zone} {view} = Dashboard {tile}");
            views.GetProperty(view).GetInt32().ShouldBe(await GridTotalAsync(client, zone, t.GetProperty("query").GetString()!), $"{user} {zone} {view} = drill-through total");
        }

        // The quick views' own filters (the presets the Task Queue writes).
        (await GridTotalAsync(client, zone, open)).ShouldBe(views.GetProperty("open").GetInt32());
        (await GridTotalAsync(client, zone, open + "&unassigned=true")).ShouldBe(views.GetProperty("unassigned").GetInt32());
        (await GridTotalAsync(client, zone, open + "&overdue=true")).ShouldBe(views.GetProperty("overdue").GetInt32());
        (await GridTotalAsync(client, zone, "status=ON_HOLD")).ShouldBe(views.GetProperty("onHold").GetInt32());
        (await GridTotalAsync(client, zone, $"status=COMPLETED&completedFrom={RecentFrom(zone)}")).ShouldBe(views.GetProperty("recentlyCompleted").GetInt32());
        // Created by me is open tasks only, like My Work's (#222).
        (await GridTotalAsync(client, zone, $"{open}&creator={_ids[user]}")).ShouldBe(views.GetProperty("createdByMe").GetInt32());
        if (user == "ann")
            (await GridTotalAsync(client, zone, $"{open}&pod={_pod}")).ShouldBe(views.GetProperty("myPod").GetInt32());
        else
            (!views.TryGetProperty("myPod", out var myPod) || myPod.ValueKind == JsonValueKind.Null).ShouldBeTrue("no primary pod: myPod is absent (null)");

        // Something to count: the seed has overdue, due soon, ASAP and held tasks in every zone.
        foreach (var view in new[] { "open", "unassigned", "overdue", "dueSoon", "asap", "onHold", "recentlyCompleted" })
            views.GetProperty(view).GetInt32().ShouldBeGreaterThan(0, $"{user} {zone} {view}");
    }

    [Theory]
    [InlineData("America/New_York")]
    [InlineData("Pacific/Auckland")]
    [InlineData("America/Los_Angeles")]
    public async Task Recently_completed_starts_29_days_back_like_the_dashboard_tile(string zone)
    {
        var from = RecentFrom(zone);
        var dashboard = await GetAsync(_clients["ann"], "/api/v1/dashboard?fresh=true", zone);
        dashboard.GetProperty("completed").GetProperty("query").GetString()!.ShouldContain($"completedFrom={from}");

        var page = await GetAsync(_clients["ann"], $"/api/v1/task-queue?pageSize=50&status=COMPLETED&completedFrom={from}&q=mine-done-", zone);
        var titles = page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()).ToList();
        titles.ShouldContain("mine-done-d29", $"{zone}: completed 29 days ago is in");
        titles.ShouldNotContain("mine-done-d30", $"{zone}: completed 30 days ago is out");
        page.GetProperty("views").GetProperty("recentlyCompleted").GetInt32().ShouldBe(dashboard.GetProperty("completed").GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task Counts_do_not_change_with_the_filters_or_the_page_and_follow_the_clock_of_the_zone()
    {
        var plain = (await GetAsync(_clients["ann"], "/api/v1/task-queue?pageSize=25", "America/New_York")).GetProperty("views").GetRawText();
        foreach (var filter in new[] { $"priority={_lowPriority}", "status=COMPLETED", "q=pod-", "overdue=true&unassigned=true", "page=2&pageSize=1&sort=title" })
            (await GetAsync(_clients["ann"], "/api/v1/task-queue?" + filter, "America/New_York")).GetProperty("views").GetRawText().ShouldBe(plain, filter);

        // The same instant is a different calendar day in Auckland (Oct 15), so the day-bounded counts differ from New York's (Oct 14).
        var auckland = (await GetAsync(_clients["ann"], "/api/v1/task-queue?pageSize=1", "Pacific/Auckland")).GetProperty("views");
        var newYork = JsonDocument.Parse(plain).RootElement;
        auckland.GetProperty("overdue").GetInt32().ShouldBeGreaterThan(newYork.GetProperty("overdue").GetInt32());
        auckland.GetProperty("open").GetInt32().ShouldBe(newYork.GetProperty("open").GetInt32());
    }

    [Fact]
    public async Task Without_Task_View_the_counts_are_not_reachable()
    {
        var nobody = await _h.UserWithAsync(@"KE\nobody", "Dashboard.View");
        (await nobody.GetAsync("/api/v1/task-queue")).StatusCode.ShouldBe(System.Net.HttpStatusCode.Forbidden);
    }

    private static string[] BucketNames { get; } = ["asap", "overdue", "today", "tomorrow", "thisWeek", "later", "closed"];

    /// <summary>The bucket of a row as the viewer sees it, from the row's own fields (not the server's grouping rule).</summary>
    private static int BucketOf(JsonElement row, DateOnly today)
    {
        if (row.GetProperty("status").GetString() is "COMPLETED" or "CANCELLED")
            return 6;
        if (row.GetProperty("isAsap").GetBoolean())
            return 0;
        if (row.GetProperty("isOverdue").GetBoolean())
            return 1;
        var due = DateOnly.Parse(row.GetProperty("dueDate").GetString()!, CultureInfo.InvariantCulture);
        var weekEnd = MatterFlow.WorkViews.Application.Queries.TaskQueueRules.EndOfWeek(today);
        return due <= today ? 2 : due == today.AddDays(1) ? 3 : due <= weekEnd ? 4 : 5;
    }

    [Theory]
    [InlineData("America/New_York")]
    [InlineData("Pacific/Auckland")]
    [InlineData("America/Los_Angeles")]
    public async Task Group_by_due_counts_equal_the_grid_totals_and_the_view_counts_and_order_the_rows_by_bucket(string zone)
    {
        var client = _clients["ann"];
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(Now, TimeZoneInfo.FindSystemTimeZoneById(zone)));
        var day = (DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        foreach (var extra in new[] { string.Empty, "&status=NEW&status=IN_PROGRESS&status=ON_HOLD", $"&pod={_pod}" })
        {
            var asc = await GetAsync(client, "/api/v1/task-queue?pageSize=100&sort=due&dir=asc&group=due" + extra, zone);
            var b = asc.GetProperty("bucketCounts");
            int Of(string name) => b.GetProperty(name).GetInt32();
            BucketNames.Sum(Of).ShouldBe(asc.GetProperty("total").GetInt32(), $"{zone}{extra}: the buckets add up to the grid total");
            asc.GetProperty("total").GetInt32().ShouldBe(await GridTotalAsync(client, zone, extra.TrimStart('&')));

            Of("asap").ShouldBe(await GridTotalAsync(client, zone, "asap=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD" + extra), $"{zone}{extra} asap");
            Of("overdue").ShouldBe(await GridTotalAsync(client, zone, "overdue=true" + extra), $"{zone}{extra} overdue");
            // Today is every open, not overdue Task whose date is today or earlier (a timed due later today may carry the date before, in a zone ahead of its own).
            Of("today").ShouldBe(await GridTotalAsync(client, zone, $"dueTo={day(today)}&overdue=false&status=NEW&status=IN_PROGRESS&status=ON_HOLD" + extra), $"{zone}{extra} today");
            Of("closed").ShouldBe(extra.Contains("status=", StringComparison.Ordinal) ? 0 : await GridTotalAsync(client, zone, "status=COMPLETED&status=CANCELLED" + extra), $"{zone}{extra} closed");

            var rows = asc.GetProperty("items").EnumerateArray().ToList();
            var buckets = rows.Select(r => BucketOf(r, today)).ToList();
            buckets.ShouldBe([.. buckets.Order()], $"{zone}{extra}: ascending lists ASAP, Overdue, Today ... Later, Closed");
            for (var i = 0; i < BucketNames.Length; i++)
                buckets.Count(x => x == i).ShouldBe(Of(BucketNames[i]), $"{zone}{extra}: {BucketNames[i]} rows on the page");

            var desc = await GetAsync(client, "/api/v1/task-queue?pageSize=100&sort=due&dir=desc&group=due" + extra, zone);
            var open = desc.GetProperty("items").EnumerateArray().Select(r => BucketOf(r, today)).ToList();
            open.Where(x => x < 6).ShouldBe([.. open.Where(x => x < 6).OrderDescending()], "descending mirrors the open buckets");
            open.Where(x => x == 6).Count().ShouldBe(Of("closed"));
            open.SkipWhile(x => x < 6).ShouldAllBe(x => x == 6, "Closed stays last when descending");
            IdsOf(desc).Order().ShouldBe(IdsOf(asc).Order(), "the direction reorders, it never adds or drops rows");
        }

        // The overall counts match the quick views (which ignore the request) for the open set.
        var all = await GetAsync(client, "/api/v1/task-queue?pageSize=1&sort=due&group=due&status=NEW&status=IN_PROGRESS&status=ON_HOLD", zone);
        var views = all.GetProperty("views");
        all.GetProperty("bucketCounts").GetProperty("asap").GetInt32().ShouldBe(views.GetProperty("asap").GetInt32());
        all.GetProperty("bucketCounts").GetProperty("overdue").GetInt32().ShouldBe(views.GetProperty("overdue").GetInt32());
        all.GetProperty("total").GetInt32().ShouldBe(views.GetProperty("open").GetInt32());
    }

    private static List<long> IdsOf(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64())];

    [Fact]
    public async Task Group_by_due_pages_concatenate_to_the_one_big_page_in_both_directions()
    {
        var client = _clients["ann"];
        foreach (var dir in new[] { "asc", "desc" })
        {
            var all = IdsOf(await GetAsync(client, $"/api/v1/task-queue?pageSize=100&sort=due&dir={dir}&group=due", "America/New_York"));
            var seen = new List<long>();
            for (var page = 1; seen.Count < all.Count; page++)
            {
                var next = IdsOf(await GetAsync(client, $"/api/v1/task-queue?pageSize=4&page={page}&sort=due&dir={dir}&group=due", "America/New_York"));
                next.ShouldNotBeEmpty();
                seen.AddRange(next);
            }

            seen.ShouldBe(all, dir);
        }
    }

    [Fact]
    public async Task Group_by_due_needs_sort_due_and_an_unknown_group_is_rejected()
    {
        var client = _clients["ann"];
        bool Has(JsonElement page) => page.TryGetProperty("bucketCounts", out var b) && b.ValueKind != JsonValueKind.Null;
        Has(await GetAsync(client, "/api/v1/task-queue", "UTC")).ShouldBeFalse("no group, no counts");
        Has(await GetAsync(client, "/api/v1/task-queue?sort=due", "UTC")).ShouldBeFalse("the sort alone does not add counts or change the API");
        Has(await GetAsync(client, "/api/v1/task-queue?group=none&sort=due", "UTC")).ShouldBeFalse();
        Has(await GetAsync(client, "/api/v1/task-queue?group=due&sort=priority", "UTC")).ShouldBeFalse("other sorts have no dividers");
        Has(await GetAsync(client, "/api/v1/task-queue?group=due&sort=due", "UTC")).ShouldBeTrue();
        (await client.GetAsync("/api/v1/task-queue?group=assignee&sort=due")).StatusCode.ShouldBe(System.Net.HttpStatusCode.BadRequest);
        // The plain Due sort is unchanged: same rows in the same order as before grouping existed (Closed rows sit by their due key).
        var plain = IdsOf(await GetAsync(client, "/api/v1/task-queue?pageSize=100&sort=due", "UTC"));
        var grouped = IdsOf(await GetAsync(client, "/api/v1/task-queue?pageSize=100&sort=due&group=due", "UTC"));
        grouped.Order().ShouldBe(plain.Order());
    }
}
