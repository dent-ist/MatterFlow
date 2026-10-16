using System.Globalization;
using System.Text;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Dashboard review 2, recommendation 1: the Overdue list shows the most urgent overdue Tasks first (priority, then longest overdue), and the Overdue tile
/// names how many overdue Tasks are Critical and High even when they are more than the list's row cap. The dashboard asks the Task Queue for the list
/// (<c>overdue=true</c>, <c>sort=priority&amp;dir=asc</c>, 6 rows), so the order is checked there with the very query the summary hands out.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardOverdueOrderTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Zone = "America/New_York";
    private const int RowCap = 6;

    private readonly DateTime _now = DateTime.UtcNow;
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private int _critical;
    private int _high;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        int PriorityId(string label) => priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == label).GetProperty("id").GetInt32();
        _critical = PriorityId("Critical");
        _high = PriorityId("High");
        var normal = PriorityId("Normal");

        // 8 Critical (more than the row cap), 2 High and 7 Normal overdue Tasks; the Normal ones are the most overdue, so a plain due-date order would
        // show nothing but Normal. Two Critical share a due date (the id decides). A Critical task that is not overdue, an ASAP Critical one and a
        // closed Critical one with a past due date must not count.
        var rows = new List<(string Title, string Status, int Priority, int? DaysOverdue)>();
        for (var i = 0; i < 7; i++)
            rows.Add(("normal-" + i, "IN_PROGRESS", normal, 40 + i));
        rows.Add(("high-a", "NEW", _high, 30));
        rows.Add(("high-b", "ON_HOLD", _high, 5));
        for (var i = 0; i < 8; i++)
            rows.Add(("crit-" + i, "NEW", _critical, 3 + (i / 2)));
        rows.Add(("crit-future", "NEW", _critical, -5));
        rows.Add(("crit-asap", "NEW", _critical, null));
        rows.Add(("crit-done", "COMPLETED", _critical, 9));

        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(_now, TimeZoneInfo.FindSystemTimeZoneById(Zone)));
        var sqlText = new StringBuilder("SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = "
            + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n");
        foreach (var (title, status, priority, days) in rows)
        {
            var due = days is { } d ? today.AddDays(-d).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null;
            var dueSql = due is null ? "NULL" : "'" + due + "'";
            var sortKey = due is null ? "NULL" : "DATEADD(MILLISECOND, 86399999, CAST('" + due + "' AS DATETIME2(3)))";
            var created = _now.AddDays(-60).ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture);
            sqlText.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n")
                .Append("INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedUserId, RequestorName, DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES (")
                .Append(CultureInfo.InvariantCulture, $"{world.MatterId}, {world.TaskTypeId}, @i, N'{title}', {priority}, '{status}', NULL, N'Requestor', {dueSql}, NULL, {sortKey}, '{created}', ")
                .Append(status == "COMPLETED" ? $"'{created}'" : "NULL")
                .Append(CultureInfo.InvariantCulture, $", '{created}', {admin});\n");
        }

        await _h.ExecuteAsync(sqlText.ToString());
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<System.Text.Json.JsonElement> DashboardAsync(HttpClient? client = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard?fresh=true");
        request.Headers.Add("X-Time-Zone", Zone);
        return await OkAsync(await (client ?? _h.Admin).SendAsync(request));
    }

    private async Task<System.Text.Json.JsonElement> QueueAsync(string query, int pageSize = 100)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/task-queue?pageSize={pageSize}&{query}");
        request.Headers.Add("X-Time-Zone", Zone);
        return await OkAsync(await _h.Admin.SendAsync(request));
    }

    [Fact]
    public async Task The_overdue_list_shows_critical_first_then_the_longest_overdue_even_when_critical_exceeds_the_row_cap()
    {
        var d = await DashboardAsync();
        var overdue = d.GetProperty("overdue");
        overdue.GetProperty("count").GetInt32().ShouldBe(17);

        // The order the dashboard asks for, with the filter it hands out.
        var page = await QueueAsync(overdue.GetProperty("query").GetString() + "&sort=priority&dir=asc&page=1", RowCap);
        page.GetProperty("total").GetInt32().ShouldBe(17);
        // Eight Critical overdue Tasks exist, more than the six rows: the list is all Critical, most overdue first (crit-6/7 are 6 days, crit-0/1 3 days);
        // the two with the same due date come in the same order on every read.
        QueueData.TitlesOf(page).ShouldBe(["crit-6", "crit-7", "crit-4", "crit-5", "crit-2", "crit-3"]);

        // The full set in the same order: Critical, then High, then Normal, each longest overdue first.
        var all = QueueData.TitlesOf(await QueueAsync(overdue.GetProperty("query").GetString() + "&sort=priority&dir=asc"));
        all.ShouldBe(
        [
            "crit-6", "crit-7", "crit-4", "crit-5", "crit-2", "crit-3", "crit-0", "crit-1",
            "high-a", "high-b",
            "normal-6", "normal-5", "normal-4", "normal-3", "normal-2", "normal-1", "normal-0",
        ]);
        QueueData.TitlesOf(await QueueAsync(overdue.GetProperty("query").GetString() + "&sort=priority&dir=asc")).ShouldBe(all);
    }

    [Fact]
    public async Task The_overdue_tile_counts_critical_and_high_with_queries_that_list_exactly_those_tasks()
    {
        var d = await DashboardAsync();
        var critical = d.GetProperty("overdueCritical");
        var high = d.GetProperty("overdueHigh");
        critical.GetProperty("count").GetInt32().ShouldBe(8);
        high.GetProperty("count").GetInt32().ShouldBe(2);

        var criticalTitles = QueueData.TitlesOf(await QueueAsync(critical.GetProperty("query").GetString()!));
        criticalTitles.Count.ShouldBe(8);
        criticalTitles.ShouldAllBe(t => t.StartsWith("crit-", StringComparison.Ordinal) && t != "crit-future" && t != "crit-asap" && t != "crit-done");
        critical.GetProperty("query").GetString()!.ShouldContain("priority=" + _critical.ToString(CultureInfo.InvariantCulture));

        QueueData.TitlesOf(await QueueAsync(high.GetProperty("query").GetString()!)).Order().ToList().ShouldBe(["high-a", "high-b"]);
        high.GetProperty("query").GetString()!.ShouldContain("priority=" + _high.ToString(CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Without_the_summary_permission_the_severity_counts_are_zero()
    {
        var queueOnly = await _h.UserWithAsync(@"KE\sevqueue", "Dashboard.View", "Dashboard.ViewUnassigned");
        var d = await DashboardAsync(queueOnly);
        d.GetProperty("overdue").GetProperty("count").GetInt32().ShouldBe(0);
        d.GetProperty("overdueCritical").GetProperty("count").GetInt32().ShouldBe(0);
        d.GetProperty("overdueHigh").GetProperty("count").GetInt32().ShouldBe(0);
    }
}
