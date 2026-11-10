using System.Globalization;
using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Change since before on the Summary tiles (S3, #102) and the own-work counts of the Technician's Summary (S9, #108), both on GET /api/v1/dashboard.
/// Tasks are seeded every five hours for 130 days (every state: open, on hold, completed, cancelled; date-only and timed due dates; two pods; two assignees) and the
/// expected numbers are worked out here, from the seeds and the viewer's local dates, by replaying the documented rules (not by the code under test). The host clock is
/// fixed (<see cref="DatabaseApiFactory.Clock"/>) at instants that are hard for "yesterday" and for the previous period: the evening before in New York, just after both
/// DST changes of New York, and the start of March (the previous month has 28 days). Consistency rule: tile value minus delta equals the Trends point of yesterday for
/// the same scope.
/// </summary>
public abstract class DashboardDeltasApiTestsBase(SqlServerFixture sql, string instant)
{
    private const string NewYork = "America/New_York";
    private const string Kiritimati = "Pacific/Kiritimati";
    private const string PagoPago = "Pacific/Pago_Pago";

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, Lazy<Task<Data>>> Worlds = new();

    private sealed record Seed(DateTime Created, string Status, DateTime Changed, DateOnly? DueDate, DateTime? DueAt, int? PodId, bool Mine)
    {
        public bool Open => Status is "NEW" or "IN_PROGRESS" or "ON_HOLD";
    }

    private sealed record Data(DateTime Now, TaskHarness Harness, TaskHarness.World World, List<Seed> Seeds, int PodA, int PodB);

    private Task<Data> WorldAsync() => Worlds.GetOrAdd(instant, _ => new Lazy<Task<Data>>(() => BuildAsync(sql, instant))).Value;

    private static async Task<Data> BuildAsync(SqlServerFixture sql, string instant)
    {
        var now = DateTime.Parse(instant, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
        var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(now) };
        var h = new TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        var priority = (await OkAsync(await h.Admin.GetAsync("/api/v1/priorities"))).EnumerateArray().First().GetProperty("id").GetInt32();
        var admin = await h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var podA = await h.CreatePodAsync("Pod A", admin);
        var podB = await h.CreatePodAsync("Pod B");

        var seeds = new List<Seed>();
        var statuses = new[] { "NEW", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED", "NEW" };
        var i = 0;
        for (var at = now.AddMinutes(-7); at > now.AddDays(-130); at = at.AddHours(-5), i++)
        {
            var status = statuses[i % statuses.Length];
            var changed = status is "COMPLETED" or "CANCELLED" ? at.AddHours(i % 2 == 0 ? 20 : 70) : at;
            if (changed > now)
            {
                status = "NEW";
                changed = at;
            }

            // Every second task has a date-only due date (several days around the creation), every fifth a timed one, the rest are ASAP.
            DateOnly? dueDate = i % 2 == 0 ? DateOnly.FromDateTime(at).AddDays((i % 11) - 4) : null;
            DateTime? dueAt = i % 5 == 0 ? at.AddHours((i % 9) * 11 - 20) : null;
            if (dueAt is not null)
                dueDate = DateOnly.FromDateTime(dueAt.Value);
            seeds.Add(new Seed(at, status, changed, dueDate, dueAt, i % 3 == 0 ? podA : i % 3 == 1 ? podB : null, i % 4 == 1));
        }

        string Instant(DateTime? v) => v is { } x ? "'" + x.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) + "'" : "NULL";
        var text = new System.Text.StringBuilder("SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = "
            + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n");
        var n = 0;
        foreach (var s in seeds)
        {
            var dueDate = s.DueDate is { } d ? "'" + d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'" : "NULL";
            var sortKey = s.DueDate is null ? "NULL" : s.DueAt is { } at ? Instant(at) : "DATEADD(MILLISECOND, 86399999, CAST(" + dueDate + " AS DATETIME2(3)))";
            text.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n")
                .Append("INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedUserId, AssignedPodId, RequestorName, DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES (")
                .Append(CultureInfo.InvariantCulture, $"{world.MatterId}, {world.TaskTypeId}, @i, N'D{n++}', {priority}, '{s.Status}', {(s.Mine ? admin.ToString(CultureInfo.InvariantCulture) : "NULL")}, {(s.PodId is { } p ? p.ToString(CultureInfo.InvariantCulture) : "NULL")}, N'Requestor', {dueDate}, {Instant(s.DueAt)}, {sortKey}, {Instant(s.Changed)}, ")
                .Append(s.Status == "COMPLETED" ? Instant(s.Changed) : "NULL")
                .Append(CultureInfo.InvariantCulture, $", {Instant(s.Created)}, {admin});\n");
        }

        await h.ExecuteAsync(text.ToString());
        return new Data(now, h, world, seeds, podA, podB);
    }

    private static TimeZoneInfo Zone(string id) => TimeZoneInfo.FindSystemTimeZoneById(id);

    private static DateOnly Local(string zone, DateTime utc) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Zone(zone)));

    /// <summary>The UTC instant a local day starts (written with the zone's rules, independent of the code under test).</summary>
    private static DateTime StartOf(string zone, DateOnly day)
    {
        var local = day.ToDateTime(TimeOnly.MinValue);
        var tz = Zone(zone);
        // A local midnight that does not exist (a zone that skips it) starts at the first valid instant after it.
        while (tz.IsInvalidTime(local))
            local = local.AddMinutes(30);
        return TimeZoneInfo.ConvertTimeToUtc(local, tz);
    }

    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private async Task<JsonElement> GetAsync(Data d, string query, string zone, HttpClient? client = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard" + (query.Length > 0 ? "?" + query : string.Empty));
        request.Headers.Add("X-Time-Zone", zone);
        return await OkAsync(await (client ?? d.Harness.Admin).SendAsync(request));
    }

    /// <summary>The API writes an absent value as an explicit null.</summary>
    private static bool Has(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null;

    private static int? Nullable(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;

    /// <summary>The expected snapshot numbers at the end of yesterday for the seeds in scope.</summary>
    private static (int Open, int Overdue, bool Any) Yesterday(IEnumerable<Seed> seeds, string zone, DateTime now)
    {
        var today = Local(zone, now);
        var snap = StartOf(zone, today);
        var yesterday = today.AddDays(-1);
        var list = seeds.ToList();
        var openAt = list.Where(s => s.Created <= snap && (s.Open || s.Changed > snap)).ToList();
        var overdue = openAt.Count(s => s.DueAt is { } at ? at <= snap : s.DueDate is { } due && due <= yesterday);
        return (openAt.Count, overdue, list.Any(s => s.Created <= snap));
    }

    private static (DateOnly From, DateOnly To, string Kind) Previous(string key, DateOnly from, DateOnly to)
    {
        var days = to.DayNumber - from.DayNumber + 1;
        if (key != "this-month")
            return (from.AddDays(-days), from.AddDays(-1), "previous");
        var first = new DateOnly(from.Year, from.Month, 1).AddMonths(-1);
        var span = Math.Min(days, DateTime.DaysInMonth(first.Year, first.Month));
        return (first, first.AddDays(span - 1), "same-days-last-month");
    }

    private static (DateOnly From, DateOnly To) Range(string key, DateOnly today)
    {
        var firstThis = new DateOnly(today.Year, today.Month, 1);
        return key switch
        {
            "7d" => (today.AddDays(-6), today),
            "30d" => (today.AddDays(-29), today),
            "90d" => (today.AddDays(-89), today),
            "this-month" => (firstThis, today),
            "last-month" => (firstThis.AddMonths(-1), firstThis.AddDays(-1)),
            _ => throw new ArgumentOutOfRangeException(nameof(key)),
        };
    }

    [Theory]
    [InlineData(NewYork)]
    [InlineData(Kiritimati)]
    [InlineData(PagoPago)]
    public async Task Overdue_and_Open_yesterday_replay_the_trend_snapshot_rules_in_the_viewers_zone(string zone)
    {
        var d = await WorldAsync();
        var summary = await GetAsync(d, "", zone);
        var expected = Yesterday(d.Seeds, zone, d.Now);
        Nullable(summary, "overdueYesterday").ShouldBe(expected.Overdue);
        Nullable(summary, "openYesterday").ShouldBe(expected.Open);
        expected.Open.ShouldBeGreaterThan(0);
        expected.Overdue.ShouldBeGreaterThan(0);
    }

    [Theory]
    [InlineData(NewYork, "all")]
    [InlineData(Kiritimati, "all")]
    [InlineData(PagoPago, "all")]
    [InlineData(NewYork, "podA")]
    [InlineData(NewYork, "podB")]
    [InlineData(NewYork, "mine")]
    public async Task Tile_value_minus_the_delta_is_the_Trends_point_of_yesterday_for_the_same_scope(string zone, string scopeName)
    {
        var d = await WorldAsync();
        var scope = scopeName switch { "podA" => d.PodA.ToString(CultureInfo.InvariantCulture), "podB" => d.PodB.ToString(CultureInfo.InvariantCulture), _ => scopeName };
        var summary = await GetAsync(d, "podScope=" + scope, zone);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard/trend?period=7d&podScope=" + scope);
        request.Headers.Add("X-Time-Zone", zone);
        var trend = await OkAsync(await d.Harness.Admin.SendAsync(request));

        var points = trend.GetProperty("all").EnumerateArray().ToList();
        var yesterday = Iso(Local(zone, d.Now).AddDays(-1));
        var point = points.First(p => p.GetProperty("date").GetString() == yesterday);
        var today = points[^1];
        Nullable(summary, "overdueYesterday").ShouldBe(point.GetProperty("overdue").GetInt32());
        Nullable(summary, "openYesterday").ShouldBe(point.GetProperty("open").GetInt32());
        // The tile is today's point, so the delta is the tile minus yesterday's point.
        summary.GetProperty("overdue").GetProperty("count").GetInt32().ShouldBe(today.GetProperty("overdue").GetInt32());
        summary.GetProperty("open").GetProperty("count").GetInt32().ShouldBe(today.GetProperty("open").GetInt32());
    }

    [Theory]
    [InlineData("7d", NewYork)]
    [InlineData("30d", NewYork)]
    [InlineData("90d", Kiritimati)]
    [InlineData("this-month", NewYork)]
    [InlineData("this-month", Kiritimati)]
    [InlineData("this-month", PagoPago)]
    [InlineData("last-month", NewYork)]
    [InlineData("last-month", PagoPago)]
    public async Task Completed_and_Created_previous_cover_the_equal_period_before_or_the_same_days_last_month(string key, string zone)
    {
        var d = await WorldAsync();
        var summary = await GetAsync(d, "period=" + key, zone);
        var (from, to) = Range(key, Local(zone, d.Now));
        var (prevFrom, prevTo, kind) = Previous(key, from, to);
        var fromUtc = StartOf(zone, prevFrom);
        var toUtc = StartOf(zone, prevTo.AddDays(1));

        var created = d.Seeds.Count(s => s.Created >= fromUtc && s.Created < toUtc);
        var completed = d.Seeds.Count(s => s.Status == "COMPLETED" && s.Changed >= fromUtc && s.Changed < toUtc);
        // The seeds start 130 days back: a previous period that begins before the first task is not comparable (no value, never a partial count or a zero).
        var comparable = d.Seeds.Any(s => s.Created < fromUtc);
        Nullable(summary, "createdPrevious").ShouldBe(comparable ? created : null);
        Nullable(summary, "completedPrevious").ShouldBe(comparable ? completed : null);
        if (comparable)
            created.ShouldBeGreaterThan(0);
        else
            key.ShouldBe("90d");
        var previous = summary.GetProperty("previousPeriod");
        previous.GetProperty("kind").GetString().ShouldBe(kind);
        previous.GetProperty("from").GetString().ShouldBe(Iso(prevFrom));
        previous.GetProperty("to").GetString().ShouldBe(Iso(prevTo));
        // The period itself is not touched.
        summary.GetProperty("period").GetProperty("from").GetString().ShouldBe(Iso(from));
    }

    [Fact]
    public async Task A_pod_scope_narrows_every_comparison_to_the_pods_tasks()
    {
        var d = await WorldAsync();
        var summary = await GetAsync(d, $"period=30d&podScope={d.PodB}", NewYork);
        var inPod = d.Seeds.Where(s => s.PodId == d.PodB).ToList();
        var expected = Yesterday(inPod, NewYork, d.Now);
        Nullable(summary, "overdueYesterday").ShouldBe(expected.Overdue);
        Nullable(summary, "openYesterday").ShouldBe(expected.Open);

        var (from, to) = Range("30d", Local(NewYork, d.Now));
        var (prevFrom, prevTo, _) = Previous("30d", from, to);
        var fromUtc = StartOf(NewYork, prevFrom);
        var toUtc = StartOf(NewYork, prevTo.AddDays(1));
        Nullable(summary, "createdPrevious").ShouldBe(inPod.Count(s => s.Created >= fromUtc && s.Created < toUtc));
        Nullable(summary, "completedPrevious").ShouldBe(inPod.Count(s => s.Status == "COMPLETED" && s.Changed >= fromUtc && s.Changed < toUtc));
    }

    [Fact]
    public async Task Unassigned_and_On_hold_have_no_comparison_fields()
    {
        var d = await WorldAsync();
        var summary = await GetAsync(d, "", NewYork);
        foreach (var name in new[] { "unassigned", "onHold", "dueSoon", "asapOpen" })
            Has(summary.GetProperty(name), "previous").ShouldBeFalse(name);
        Has(summary, "unassignedYesterday").ShouldBeFalse();
        Has(summary, "onHoldYesterday").ShouldBeFalse();
    }

    [Fact]
    public async Task The_holder_of_Dashboard_ViewSummary_gets_no_own_work_counts()
    {
        var d = await WorldAsync();
        var summary = await GetAsync(d, "", NewYork);
        Has(summary, "mine").ShouldBeFalse();
    }

    [Fact]
    public async Task ViewUnassigned_alone_gets_only_their_own_counts_and_no_department_figures()
    {
        // Its own database: the rows added here must not change the counts the shared world's tests expect.
        var now = DateTime.Parse(instant, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(now) };
        var h = new TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        var d = new Data(now, h, world, [], 0, 0);
        var tech = await h.UserWithAsync(@"KE\tech", "Dashboard.View", "Dashboard.ViewUnassigned");
        var userId = await h.UserIdAsync(@"KE\tech");
        var priority = (await OkAsync(await d.Harness.Admin.GetAsync("/api/v1/priorities"))).EnumerateArray().First().GetProperty("id").GetInt32();
        var admin = await d.Harness.UserIdAsync(DatabaseApiFactory.AdminAccount);

        // Three open tasks of the technician (one overdue by a date, one overdue by a moment, one not due), a completed one, an overdue one of somebody else and an unassigned one.
        var today = Local(NewYork, d.Now);
        static string I(DateTime v) => v.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture);
        string Row(string status, int? user, string dueDate, string? dueAt) =>
            "INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n"
            + "INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedUserId, RequestorName, DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES ("
            + $"{world.MatterId}, {world.TaskTypeId}, @i, N'Own', {priority}, '{status}', {(user is { } u ? u.ToString(CultureInfo.InvariantCulture) : "NULL")}, N'Requestor', {dueDate}, {dueAt ?? "NULL"}, "
            + $"{(dueAt ?? "DATEADD(MILLISECOND, 86399999, CAST(" + dueDate + " AS DATETIME2(3)))")}, '{I(d.Now.AddHours(-30))}', "
            + (status == "COMPLETED" ? $"'{I(d.Now.AddHours(-30))}'" : "NULL")
            + $", '{I(d.Now.AddHours(-30))}', {admin});\n";
        var sql2 = "SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = " + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n"
            + Row("IN_PROGRESS", userId, "'" + Iso(today.AddDays(-3)) + "'", null)
            + Row("NEW", userId, "'" + Iso(today) + "'", $"'{I(d.Now.AddHours(-1))}'")
            + Row("ON_HOLD", userId, "'" + Iso(today.AddDays(9)) + "'", null)
            + Row("COMPLETED", userId, "'" + Iso(today.AddDays(-9)) + "'", null)
            + Row("NEW", admin, "'" + Iso(today.AddDays(-9)) + "'", null)
            + Row("NEW", null, "'" + Iso(today.AddDays(-9)) + "'", null);
        await d.Harness.ExecuteAsync(sql2);

        // The expected counts come from the seeds alone: the technician's own open tasks and, of those, the overdue ones.
        var summary = await GetAsync(d, "", NewYork, tech);
        var mine = summary.GetProperty("mine");
        mine.GetProperty("open").GetInt32().ShouldBe(3);
        mine.GetProperty("overdue").GetInt32().ShouldBe(2);
        // Only the size of the unassigned queue: no department-wide counts and no comparison.
        summary.GetProperty("overdue").GetProperty("count").GetInt32().ShouldBe(0);
        summary.GetProperty("open").GetProperty("count").GetInt32().ShouldBe(0);
        foreach (var name in new[] { "overdueYesterday", "openYesterday", "completedPrevious", "createdPrevious", "previousPeriod" })
            Has(summary, name).ShouldBeFalse(name);
        // The unassigned queue is what this viewer sees: the size of the queue, not their own work.
        summary.GetProperty("unassigned").GetProperty("count").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task Without_any_task_before_the_comparison_there_is_no_value_and_no_zero()
    {
        // A database whose only task was created today: nothing existed yesterday and nothing before the previous period.
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(DateTime.Parse(instant, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal)) };
        var h = new TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        await h.CreateTaskAsync(world);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard");
        request.Headers.Add("X-Time-Zone", NewYork);
        var summary = await OkAsync(await h.Admin.SendAsync(request));
        foreach (var name in new[] { "overdueYesterday", "openYesterday", "completedPrevious", "createdPrevious" })
            Has(summary, name).ShouldBeFalse(name);
        summary.GetProperty("open").GetProperty("count").GetInt32().ShouldBe(1);
        summary.GetProperty("previousPeriod").GetProperty("kind").GetString().ShouldBe("previous");
    }
}

[Collection(SqlServerCollection.Name)]
public sealed class DashboardDeltasEveningBeforeNewYork(SqlServerFixture sql) : DashboardDeltasApiTestsBase(sql, "2026-10-14T03:30:00Z");

[Collection(SqlServerCollection.Name)]
public sealed class DashboardDeltasAfterSpringForward(SqlServerFixture sql) : DashboardDeltasApiTestsBase(sql, "2026-03-09T04:30:00Z");

[Collection(SqlServerCollection.Name)]
public sealed class DashboardDeltasAfterFallBack(SqlServerFixture sql) : DashboardDeltasApiTestsBase(sql, "2026-11-02T05:10:00Z");

[Collection(SqlServerCollection.Name)]
public sealed class DashboardDeltasStartOfMarch(SqlServerFixture sql) : DashboardDeltasApiTestsBase(sql, "2026-03-01T06:00:00Z");
