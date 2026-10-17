using System.Globalization;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// One vocabulary (BUG-13, M5): the My Work tab "Due soon and overdue" is the Dashboard's Overdue plus its Due soon (which excludes overdue and ASAP),
/// and "Closed" is Completed plus Cancelled. Worked out for three people at a fixed clock (2026-10-14 16:00 UTC, noon in New York) against the Task Queue
/// counts behind the Dashboard's own drill-through links, plus the default order of the Due soon and overdue tab (D1) and the all-time Closed window (C4).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyWorkVocabularyApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string NewYork = "America/New_York";
    private static readonly DateTime Now = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private readonly Dictionary<string, HttpClient> _clients = [];
    private readonly Dictionary<string, int> _ids = [];
    private readonly List<Seed> _seeds = [];

    private sealed record Seed(string Title, string Status, string? User, int Priority, DateOnly? Due, DateTime Changed);

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        foreach (var name in new[] { "ann", "bob", "cy" })
        {
            _clients[name] = await _h.UserWithAsync($@"KE\{name}", "Task.View", "Dashboard.View", "Dashboard.ViewSummary");
            _ids[name] = await _h.UserIdAsync($@"KE\{name}");
        }

        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        int PriorityId(string label) => priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == label).GetProperty("id").GetInt32();
        int critical = PriorityId("Critical"), high = PriorityId("High"), normal = PriorityId("Normal"), low = PriorityId("Low");

        static DateOnly D(int month, int day) => new(2026, month, day);
        static DateTime At(int month, int day) => new(2026, month, day, 14, 0, 0, DateTimeKind.Utc);

        // ann: every kind of open task, in a shuffled insertion order, with ties on a due date to be broken by priority.
        _seeds.Add(new("ann-d2-low", "NEW", "ann", low, D(10, 16), At(10, 1)));
        _seeds.Add(new("ann-over1", "IN_PROGRESS", "ann", normal, D(10, 13), At(10, 1)));
        _seeds.Add(new("ann-asap", "NEW", "ann", critical, null, At(10, 1)));
        _seeds.Add(new("ann-over13", "NEW", "ann", low, D(10, 1), At(10, 1)));
        _seeds.Add(new("ann-d2-crit", "ON_HOLD", "ann", critical, D(10, 16), At(10, 1)));
        _seeds.Add(new("ann-today", "NEW", "ann", high, D(10, 14), At(10, 1)));
        _seeds.Add(new("ann-far", "NEW", "ann", critical, D(12, 31), At(10, 1)));
        _seeds.Add(new("ann-over5", "NEW", "ann", normal, D(10, 9), At(10, 1)));
        _seeds.Add(new("ann-tomorrow", "NEW", "ann", normal, D(10, 15), At(10, 1)));
        _seeds.Add(new("ann-d3", "NEW", "ann", normal, D(10, 17), At(10, 1)));
        // closed: two inside the 90 days, one cancelled and one completed older than that.
        _seeds.Add(new("ann-done", "COMPLETED", "ann", normal, null, At(10, 10)));
        _seeds.Add(new("ann-cancelled", "CANCELLED", "ann", normal, D(10, 1), At(10, 12)));
        _seeds.Add(new("ann-old-done", "COMPLETED", "ann", normal, null, At(5, 1)));
        _seeds.Add(new("ann-old-cancelled", "CANCELLED", "ann", normal, null, At(6, 1)));
        // bob: only one overdue and one closed; cy: nothing open, one old closed; unassigned ones belong to nobody.
        _seeds.Add(new("bob-over", "NEW", "bob", normal, D(9, 30), At(10, 1)));
        _seeds.Add(new("bob-done", "COMPLETED", "bob", normal, null, At(9, 20)));
        _seeds.Add(new("cy-old-cancelled", "CANCELLED", "cy", normal, null, At(1, 15)));
        _seeds.Add(new("none-over", "NEW", null, high, D(10, 2), At(10, 1)));
        _seeds.Add(new("none-soon", "NEW", null, high, D(10, 15), At(10, 1)));
        await _h.ExecuteAsync(SeedSql(world, admin));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private string SeedSql(World world, int admin)
    {
        string Instant(DateTime v) => "'" + v.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) + "'";
        var text = new System.Text.StringBuilder("SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = "
            + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n");
        foreach (var s in _seeds)
        {
            var due = s.Due is { } d ? "'" + d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'" : "NULL";
            var sortKey = s.Due is null ? "NULL" : "DATEADD(MILLISECOND, 86399999, CAST(" + due + " AS DATETIME2(3)))";
            var user = s.User is null ? "NULL" : _ids[s.User].ToString(CultureInfo.InvariantCulture);
            text.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n")
                .Append("INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedPodId, AssignedUserId, RequestorName, DueDate, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES (")
                .Append(CultureInfo.InvariantCulture, $"{world.MatterId}, {world.TaskTypeId}, @i, N'{s.Title}', {s.Priority}, '{s.Status}', NULL, {user}, N'Requestor', {due}, {sortKey}, {Instant(s.Changed)}, ")
                .Append(s.Status == "COMPLETED" ? Instant(s.Changed) : "NULL")
                .Append(CultureInfo.InvariantCulture, $", {Instant(s.Changed.AddDays(-1))}, {admin});\n");
        }

        return text.ToString();
    }

    private static async Task<JsonElement> GetAsync(HttpClient client, string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("X-Time-Zone", NewYork);
        return await OkAsync(await client.SendAsync(request));
    }

    private static List<string> Titles(JsonElement page) => QueueData.TitlesOf(page);

    private Task<JsonElement> MyWorkAsync(string user, string query = "") =>
        GetAsync(_clients[user], "/api/v1/my-work?pageSize=100" + (query.Length > 0 ? "&" + query : string.Empty));

    private async Task<int> QueueTotalAsync(string query) =>
        (await GetAsync(_h.Admin, "/api/v1/task-queue?pageSize=1&" + query)).GetProperty("total").GetInt32();

    private static int Count(JsonElement counts, string name) => counts.GetProperty(name).GetInt32();

    [Theory]
    [InlineData("ann")]
    [InlineData("bob")]
    [InlineData("cy")]
    public async Task Due_soon_and_overdue_is_the_dashboards_overdue_plus_its_due_soon_for_the_same_person(string user)
    {
        var dashboard = await GetAsync(_h.Admin, "/api/v1/dashboard?fresh=true");
        var overdue = dashboard.GetProperty("overdue").GetProperty("query").GetString()!;
        var dueSoon = dashboard.GetProperty("dueSoon").GetProperty("query").GetString()!;
        var me = $"assignee={_ids[user]}";

        // The Dashboard's two tiles never overlap: Due soon is not overdue and not ASAP.
        dueSoon.ShouldContain("overdue=false");
        dueSoon.ShouldContain("asap=false");

        var counts = (await MyWorkAsync(user)).GetProperty("counts");
        var expected = await QueueTotalAsync($"{overdue}&{me}") + await QueueTotalAsync($"{dueSoon}&{me}");
        Count(counts, "dueSoon").ShouldBe(expected, $"{user}: Due soon and overdue = Overdue + Due soon");

        // The tab lists exactly the rows of those two Task Queue queries, and its total is its count.
        var tab = await MyWorkAsync(user, "view=dueSoon");
        tab.GetProperty("total").GetInt32().ShouldBe(expected);
        var both = Titles(await GetAsync(_h.Admin, $"/api/v1/task-queue?pageSize=100&{overdue}&{me}"))
            .Concat(Titles(await GetAsync(_h.Admin, $"/api/v1/task-queue?pageSize=100&{dueSoon}&{me}")));
        Titles(tab).ShouldBeSet([.. both]);
    }

    [Fact]
    public async Task Everyones_due_soon_and_overdue_plus_the_unassigned_ones_is_the_whole_dashboard()
    {
        var dashboard = await GetAsync(_h.Admin, "/api/v1/dashboard?fresh=true");
        var whole = dashboard.GetProperty("overdue").GetProperty("count").GetInt32() + dashboard.GetProperty("dueSoon").GetProperty("count").GetInt32();
        var mine = 0;
        foreach (var user in _clients.Keys)
            mine += Count((await MyWorkAsync(user)).GetProperty("counts"), "dueSoon");
        var unassigned = await QueueTotalAsync("status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true&asap=false&dueTo=2026-10-16");
        (mine + unassigned).ShouldBe(whole);
        whole.ShouldBe(_seeds.Count(s => (s.Status is "NEW" or "IN_PROGRESS" or "ON_HOLD") && s.Due is { } due && due <= new DateOnly(2026, 10, 16)));
    }

    [Theory]
    [InlineData("ann")]
    [InlineData("bob")]
    [InlineData("cy")]
    public async Task Closed_is_completed_plus_cancelled(string user)
    {
        var me = $"assignee={_ids[user]}";
        var window = "completedFrom=" + new DateOnly(2026, 10, 14).AddDays(-90).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        // The default window: the last 90 days.
        var counts = (await MyWorkAsync(user)).GetProperty("counts");
        var inWindow = await QueueTotalAsync($"status=COMPLETED&{me}&{window}") + await QueueTotalAsync($"status=CANCELLED&{me}&{window}");
        Count(counts, "completed").ShouldBe(inWindow, $"{user}: Closed = Completed + Cancelled in the window");

        // All time: no date at all.
        var all = await MyWorkAsync(user, "view=completed&closedWindow=all");
        var allTime = await QueueTotalAsync($"status=COMPLETED&{me}") + await QueueTotalAsync($"status=CANCELLED&{me}");
        all.GetProperty("total").GetInt32().ShouldBe(allTime);
        Count(all.GetProperty("counts"), "completed").ShouldBe(allTime, "the count follows the state");
        all.GetProperty("total").GetInt32().ShouldBeGreaterThanOrEqualTo(inWindow);
    }

    [Fact]
    public async Task Show_older_is_an_explicit_all_time_window_and_the_default_stays_90_days()
    {
        Titles(await MyWorkAsync("ann", "view=completed")).ShouldBe(["ann-cancelled", "ann-done"]);
        Titles(await MyWorkAsync("ann", "view=completed&closedWindow=all")).ShouldBe(["ann-cancelled", "ann-done", "ann-old-cancelled", "ann-old-done"]);
        Titles(await MyWorkAsync("ann", "view=completed&closedWindow=default")).ShouldBe(["ann-cancelled", "ann-done"]);
        // The other tab counts do not move with the window.
        var counts = (await MyWorkAsync("ann", "view=completed&closedWindow=all")).GetProperty("counts");
        Count(counts, "active").ShouldBe(10);
        Count(counts, "completed").ShouldBe(4);
        // A closed-date range wins over the window.
        Titles(await MyWorkAsync("ann", "view=completed&closedWindow=all&completedFrom=2026-10-11")).ShouldBe(["ann-cancelled"]);
        // Only the Closed tab reads it for its rows; another tab ignores it, and cy has nothing recent.
        Titles(await MyWorkAsync("cy", "view=completed")).ShouldBeEmpty();
        Titles(await MyWorkAsync("cy", "view=completed&closedWindow=all")).ShouldBe(["cy-old-cancelled"]);

        var bad = await _clients["ann"].GetAsync("/api/v1/my-work?view=completed&closedWindow=forever");
        await ProblemAsync(bad, System.Net.HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Due_soon_and_overdue_sorts_overdue_first_then_due_date_then_priority_and_a_header_sort_replaces_it()
    {
        var tab = await MyWorkAsync("ann", "view=dueSoon");
        // Overdue by 13, 5 and 1 days, then today, tomorrow, and the day after (Critical before Low). 10-17 is outside the window; ASAP is not here.
        Titles(tab).ShouldBe(["ann-over13", "ann-over5", "ann-over1", "ann-today", "ann-tomorrow", "ann-d2-crit", "ann-d2-low"]);

        // Active keeps the addendum G rule: priority first, ASAP above due dates.
        Titles(await MyWorkAsync("ann")).Take(3).ShouldBe(["ann-asap", "ann-d2-crit", "ann-far"]);

        // A header sort replaces the default; the other direction reverses it.
        Titles(await MyWorkAsync("ann", "view=dueSoon&sort=priority")).First().ShouldBe("ann-d2-crit");
        Titles(await MyWorkAsync("ann", "view=dueSoon&sort=due&dir=desc")).First().ShouldBe("ann-d2-low");
    }
}
