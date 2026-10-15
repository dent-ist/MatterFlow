using System.Globalization;
using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /api/v1/dashboard/trend (Dashboard > Trends, task types): the per-type series add up to the all series, the all series equals the summary
/// trend, days are the viewer's local days, the limits (8 types) and unknown ids are 400, the permission is the department view and inactive
/// types still appear when they have Tasks in the period.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardTrendApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string NewYork = "America/New_York";
    private const string Kiritimati = "Pacific/Kiritimati";
    private const string PagoPago = "Pacific/Pago_Pago";

    private readonly DateTime _now = DateTime.UtcNow;
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private int _alpha, _beta, _gamma, _delta, _epsilon;
    private readonly List<Seed> _seeds = [];

    /// <summary>A seeded Task: completed or cancelled instants make it closed; a due date (date-only) or due moment (timed) makes it count in the due-date lines.</summary>
    private sealed record Seed(int Type, DateTime Created, DateTime? Completed, DateTime? Cancelled = null, DateOnly? DueDate = null, DateTime? DueAt = null)
    {
        public string Status => Completed is not null ? "COMPLETED" : Cancelled is not null ? "CANCELLED" : "NEW";
    }

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        _alpha = world.TaskTypeId;
        _beta = await _h.CreateTaskTypeAsync("Beta Type", [world.OrderedWorkflowId]);
        _gamma = await _h.CreateTaskTypeAsync("Gamma Retired", [world.OrderedWorkflowId]);
        _delta = await _h.CreateTaskTypeAsync("Delta Idle", [world.OrderedWorkflowId]);
        _epsilon = await _h.CreateTaskTypeAsync("Epsilon Retired Idle", [world.OrderedWorkflowId]);
        var priority = (await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"))).EnumerateArray().First().GetProperty("id").GetInt32();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);

        DateTime Ago(double days) => _now.AddDays(-days);
        DateOnly UtcDay(int offset) => DateOnly.FromDateTime(_now).AddDays(offset);
        _seeds.AddRange(
        [
            new(_alpha, Ago(0.01), null), new(_alpha, Ago(0.5), null), new(_alpha, Ago(1.2), Ago(0.1)), new(_alpha, Ago(3.4), Ago(2.3)), new(_alpha, Ago(10.6), null), new(_alpha, Ago(40), Ago(35)),
            new(_beta, Ago(0.2), Ago(0.2)), new(_beta, Ago(2.5), null), new(_beta, Ago(2.7), Ago(1.5)), new(_beta, Ago(20.3), null), new(_beta, Ago(80), null),
            new(_gamma, Ago(5.5), Ago(4.5)), new(_gamma, Ago(6.1), null), new(_gamma, Ago(200), null),

            // Tasks with a due date (the due-date lines). Hand-computed totals, true in every zone: overdue now alpha 2, beta 1, gamma 0; on time 2; late 2.
            new(_alpha, Ago(20), null, DueDate: UtcDay(-10)),                                    // open, date-only, long overdue
            new(_alpha, Ago(15), null, DueDate: UtcDay(-6), DueAt: Ago(6.3)),                    // open, timed, overdue since 6.3 days ago
            new(_beta, Ago(9), null),                                                            // ASAP: in no due-date line
            new(_beta, Ago(12), Ago(7.2), DueDate: UtcDay(-9), DueAt: Ago(8.5)),                 // completed late
            new(_beta, Ago(12), Ago(5.4), DueDate: UtcDay(-5), DueAt: Ago(5)),                   // completed on time
            new(_gamma, Ago(14), null, Cancelled: Ago(8), DueDate: UtcDay(-9)),                  // cancelled: closes its overdue
            new(_gamma, Ago(3), null, DueDate: UtcDay(3)),                                       // not due yet
            new(_alpha, Ago(30), Ago(2.2), DueDate: UtcDay(-6)),                                 // date-only, completed days after the date: late
            new(_alpha, Ago(30), Ago(3.5), DueDate: UtcDay(-1)),                                 // date-only, completed before the date: on time
            new(_beta, Ago(2), null, DueDate: UtcDay(0), DueAt: Ago(0.05)),                      // timed, just passed: overdue now
        ]);
        var text = new System.Text.StringBuilder("SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = "
            + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n");
        string Instant(DateTime? v) => v is { } x ? "'" + x.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) + "'" : "NULL";
        var n = 0;
        foreach (var seed in _seeds)
        {
            var changed = seed.Completed ?? seed.Cancelled ?? seed.Created;
            var dueDate = seed.DueDate is { } d ? "'" + d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'" : "NULL";
            var sortKey = seed.DueDate is null ? "NULL" : seed.DueAt is { } at ? Instant(at) : "DATEADD(MILLISECOND, 86399999, CAST(" + dueDate + " AS DATETIME2(3)))";
            text.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n")
                .Append("INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, RequestorName, DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES (")
                .Append(CultureInfo.InvariantCulture, $"{world.MatterId}, {seed.Type}, @i, N'T{n++}', {priority}, '{seed.Status}', N'Requestor', {dueDate}, {Instant(seed.DueAt)}, {sortKey}, {Instant(changed)}, ")
                .Append(seed.Completed is null ? "NULL" : Instant(changed))
                .Append(CultureInfo.InvariantCulture, $", {Instant(seed.Created)}, {admin});\n");
        }

        await _h.ExecuteAsync(text.ToString());
        await _h.ExecuteAsync($"UPDATE dbo.TaskType SET IsActive = 0 WHERE TaskTypeId IN ({_gamma}, {_epsilon});");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static DateOnly LocalDate(string zone, DateTime utc) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById(zone)));

    private async Task<JsonElement> TrendAsync(string query = "", string zone = NewYork, HttpClient? client = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard/trend" + (query.Length > 0 ? "?" + query : string.Empty));
        request.Headers.Add("X-Time-Zone", zone);
        return await OkAsync(await (client ?? _h.Admin).SendAsync(request));
    }

    private async Task<HttpResponseMessage> RawAsync(string query, HttpClient? client = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard/trend?" + query);
        request.Headers.Add("X-Time-Zone", NewYork);
        return await (client ?? _h.Admin).SendAsync(request);
    }

    private static int[] Column(JsonElement points, string name) => [.. points.EnumerateArray().Select(p => p.GetProperty(name).GetInt32())];

    [Theory]
    [InlineData(NewYork)]
    [InlineData(Kiritimati)]
    [InlineData(PagoPago)]
    public async Task Per_type_series_add_up_to_the_all_series_which_equals_the_summary_counts_in_the_viewers_days(string zone)
    {
        foreach (var days in new[] { 1, 7, 30, 90 })
        {
            var all = $"{_alpha}&taskTypeIds={_beta}&taskTypeIds={_gamma}&taskTypeIds={_delta}";
            var trend = await TrendAsync($"periodDays={days}&taskTypeIds={all}", zone);

            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard?periodDays=" + days);
            request.Headers.Add("X-Time-Zone", zone);
            var summary = await OkAsync(await _h.Admin.SendAsync(request));
            // All equals the summary's Created and Completed counts of the same period.
            Column(trend.GetProperty("all"), "created").Sum().ShouldBe(summary.GetProperty("created").GetProperty("count").GetInt32());
            Column(trend.GetProperty("all"), "completed").Sum().ShouldBe(summary.GetProperty("completed").GetProperty("count").GetInt32());
            trend.GetProperty("all").GetArrayLength().ShouldBe(days);
            trend.GetProperty("all")[days - 1].GetProperty("date").GetString().ShouldBe(LocalDate(zone, _now).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

            // Every task type has a series here (alpha, beta, gamma, delta) and all tasks belong to one of them: the series add up to all.
            var series = trend.GetProperty("byTaskType").EnumerateArray().ToList();
            series.Select(s => s.GetProperty("taskTypeId").GetInt32()).ShouldBe([_alpha, _beta, _gamma, _delta]);
            foreach (var metric in new[] { "created", "completed" })
            {
                var sum = new int[days];
                foreach (var s in series)
                    for (var i = 0; i < days; i++)
                        sum[i] += Column(s.GetProperty("points"), metric)[i];
                sum.ShouldBe(Column(trend.GetProperty("all"), metric), metric);
            }
        }
    }

    [Theory]
    [InlineData(NewYork)]
    [InlineData(Kiritimati)]
    [InlineData(PagoPago)]
    public async Task Days_are_the_viewers_local_days_and_totals_follow_the_seeded_tasks(string zone)
    {
        var trend = await TrendAsync($"periodDays=30&taskTypeIds={_alpha}&taskTypeIds={_beta}", zone);
        var today = LocalDate(zone, _now);
        var first = today.AddDays(-29);

        foreach (var (id, key) in new[] { (_alpha, "alpha"), (_beta, "beta") })
        {
            var expectedCreated = new int[30];
            var expectedCompleted = new int[30];
            foreach (var s in _seeds.Where(s => s.Type == id))
            {
                var c = LocalDate(zone, s.Created).DayNumber - first.DayNumber;
                if (c is >= 0 and < 30)
                    expectedCreated[c]++;
                if (s.Completed is { } done && LocalDate(zone, done).DayNumber - first.DayNumber is >= 0 and < 30 and var d)
                    expectedCompleted[d]++;
            }

            var series = trend.GetProperty("byTaskType").EnumerateArray().First(s => s.GetProperty("taskTypeId").GetInt32() == id).GetProperty("points");
            Column(series, "created").ShouldBe(expectedCreated, key);
            Column(series, "completed").ShouldBe(expectedCompleted, key);

            var legend = trend.GetProperty("types").EnumerateArray().First(t => t.GetProperty("id").GetInt32() == id);
            legend.GetProperty("created").GetInt32().ShouldBe(expectedCreated.Sum(), key);
            legend.GetProperty("completed").GetInt32().ShouldBe(expectedCompleted.Sum(), key);
        }
    }

    [Fact]
    public async Task The_legend_lists_types_with_tasks_in_the_period_or_active_largest_first_with_queue_queries()
    {
        var trend = await TrendAsync("periodDays=30");
        var types = trend.GetProperty("types").EnumerateArray().ToList();

        // Gamma is inactive but has two Tasks in the period: it stays. Epsilon is inactive without Tasks: gone. Delta is active without Tasks: muted but listed.
        var ids = types.Select(t => t.GetProperty("id").GetInt32()).ToList();
        ids.ShouldContain(_gamma);
        ids.ShouldContain(_delta);
        ids.ShouldNotContain(_epsilon);
        types.First(t => t.GetProperty("id").GetInt32() == _gamma).GetProperty("isActive").GetBoolean().ShouldBeFalse();
        types.Last().GetProperty("id").GetInt32().ShouldBe(_delta, "types without Tasks sort last");

        var created = types.Select(t => t.GetProperty("created").GetInt32()).ToList();
        created.ShouldBe([.. created.OrderByDescending(c => c)]);
        types.First().GetProperty("iconKey").GetString().ShouldNotBeNullOrEmpty();

        // A type outside the period is listed only while it is active: with a one-day period the retired Gamma drops out.
        var day = await TrendAsync("periodDays=1");
        day.GetProperty("types").EnumerateArray().Select(t => t.GetProperty("id").GetInt32()).ShouldNotContain(_gamma);

        // The legend totals drill through to exactly that many Tasks in the Task Queue.
        foreach (var t in types.Take(3))
        {
            var page = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?pageSize=1&" + t.GetProperty("createdQuery").GetString()));
            page.GetProperty("total").GetInt32().ShouldBe(t.GetProperty("created").GetInt32());
            var done = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?pageSize=1&" + t.GetProperty("completedQuery").GetString()));
            done.GetProperty("total").GetInt32().ShouldBe(t.GetProperty("completed").GetInt32());
        }
    }

    [Fact]
    public async Task Without_task_types_only_the_all_series_and_the_legend_are_returned_and_duplicates_collapse()
    {
        var plain = await TrendAsync();
        plain.GetProperty("byTaskType").GetArrayLength().ShouldBe(0);
        plain.GetProperty("all").GetArrayLength().ShouldBe(30);
        plain.GetProperty("types").GetArrayLength().ShouldBeGreaterThan(0);

        var dup = await TrendAsync($"taskTypeIds={_alpha}&taskTypeIds={_alpha}");
        dup.GetProperty("byTaskType").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task A_metric_computes_only_that_count_and_an_unknown_metric_is_rejected()
    {
        var created = await TrendAsync("metric=created");
        created.GetProperty("metric").GetString().ShouldBe("created");
        Column(created.GetProperty("all"), "completed").Sum().ShouldBe(0);
        Column(created.GetProperty("all"), "created").Sum().ShouldBe(Column((await TrendAsync()).GetProperty("all"), "created").Sum());

        var completed = await TrendAsync("metric=completed");
        Column(completed.GetProperty("all"), "created").Sum().ShouldBe(0);
        Column(completed.GetProperty("all"), "completed").Sum().ShouldBeGreaterThan(0);

        await ProblemAsync(await RawAsync("metric=speed"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task More_than_eight_types_unknown_ids_and_bad_parameters_are_400()
    {
        var nine = string.Join('&', Enumerable.Range(1, 9).Select(i => "taskTypeIds=" + i));
        await ProblemAsync(await RawAsync(nine), HttpStatusCode.BadRequest, "TOO_MANY_TYPES");

        // Up to eight ids are allowed (retired types too); an unknown id is rejected with its own code.
        var five = string.Join('&', new[] { _alpha, _beta, _gamma, _delta, _epsilon }.Select(i => "taskTypeIds=" + i));
        (await TrendAsync(five)).GetProperty("byTaskType").GetArrayLength().ShouldBe(5);
        await ProblemAsync(await RawAsync($"taskTypeIds={_alpha}&taskTypeIds=999999"), HttpStatusCode.BadRequest, "UNKNOWN_TASK_TYPE");

        foreach (var bad in new[] { "periodDays=0", "periodDays=366", "periodDays=x", "taskTypeIds=abc", "bogus=1" })
            await ProblemAsync(await RawAsync(bad), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        (await TrendAsync("fresh=true")).GetProperty("all").GetArrayLength().ShouldBe(30);
    }

    [Fact]
    public async Task The_trend_needs_the_department_view()
    {
        // Neither Task.View, nor the other tabs, nor the trend tab without Dashboard.View opens it.
        foreach (var (account, permissions) in new[]
        {
            (@"KE\trendless", new[] { "Task.View" }),
            (@"KE\summaryonly", ["Dashboard.View", "Dashboard.ViewSummary", "Dashboard.ViewBreakdowns", "Dashboard.ViewSwimlane", "Dashboard.ViewUsers"]),
            (@"KE\noview", ["Dashboard.ViewTrends"]),
        })
        {
            var viewer = await _h.UserWithAsync(account, permissions);
            (await RawAsync(string.Empty, viewer)).StatusCode.ShouldBe(HttpStatusCode.Forbidden, account);
        }

        var manager = await _h.UserWithAsync(@"KE\trendfull", "Dashboard.View", "Dashboard.ViewTrends");
        (await TrendAsync(client: manager)).GetProperty("all").GetArrayLength().ShouldBe(30);
    }

    // ---- due-date lines: expectations written independently of the service (a snapshot instant per day, the viewer's local date for date-only dues)

    private static DateTime StartOfDayUtc(string zone, DateOnly date) =>
        TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), TimeZoneInfo.FindSystemTimeZoneById(zone));

    private bool OverdueAt(Seed s, DateTime snap, string zone)
    {
        if (s.DueDate is null || s.Created >= snap)
            return false;
        if ((s.Completed ?? s.Cancelled) is { } closed && closed < snap)
            return false;
        return s.DueAt is { } at ? at < snap : LocalDate(zone, snap) > s.DueDate;
    }

    private bool? OnTime(Seed s, string zone)
    {
        if (s.Completed is not { } done || s.DueDate is null)
            return null;
        return s.DueAt is { } at ? done <= at : LocalDate(zone, done) <= s.DueDate;
    }

    [Theory]
    [InlineData(NewYork)]
    [InlineData(Kiritimati)]
    [InlineData(PagoPago)]
    public async Task Overdue_is_an_end_of_day_snapshot_and_on_time_and_late_split_the_completions_in_the_viewers_days(string zone)
    {
        const int days = 30;
        var today = LocalDate(zone, _now);
        var first = today.AddDays(1 - days);
        var trend = await TrendAsync($"periodDays={days}&taskTypeIds={_alpha}&taskTypeIds={_beta}&taskTypeIds={_gamma}", zone);

        int[] ExpectedOverdue(Func<Seed, bool> where) => [.. Enumerable.Range(0, days).Select(i =>
        {
            var day = first.AddDays(i);
            var snap = day == today ? _now : StartOfDayUtc(zone, day.AddDays(1));
            return _seeds.Where(where).Count(s => OverdueAt(s, snap, zone));
        })];

        int[] ExpectedCompleted(Func<Seed, bool> where, bool onTime) => [.. Enumerable.Range(0, days).Select(i =>
            _seeds.Where(where).Count(s => OnTime(s, zone) == onTime && LocalDate(zone, s.Completed!.Value) == first.AddDays(i)))];

        Column(trend.GetProperty("all"), "overdue").ShouldBe(ExpectedOverdue(_ => true));
        Column(trend.GetProperty("all"), "onTime").ShouldBe(ExpectedCompleted(_ => true, true));
        Column(trend.GetProperty("all"), "late").ShouldBe(ExpectedCompleted(_ => true, false));

        foreach (var series in trend.GetProperty("byTaskType").EnumerateArray())
        {
            var id = series.GetProperty("taskTypeId").GetInt32();
            var points = series.GetProperty("points");
            Column(points, "overdue").ShouldBe(ExpectedOverdue(s => s.Type == id), "overdue of type " + id);
            Column(points, "onTime").ShouldBe(ExpectedCompleted(s => s.Type == id, true), "on time of type " + id);
            Column(points, "late").ShouldBe(ExpectedCompleted(s => s.Type == id, false), "late of type " + id);
        }

        // The per-type series add up to All for every due-date measure.
        foreach (var measure in new[] { "overdue", "onTime", "late" })
        {
            var sum = new int[days];
            foreach (var series in trend.GetProperty("byTaskType").EnumerateArray())
                for (var i = 0; i < days; i++)
                    sum[i] += Column(series.GetProperty("points"), measure)[i];
            sum.ShouldBe(Column(trend.GetProperty("all"), measure), measure);
        }
    }

    [Theory]
    [InlineData(NewYork)]
    [InlineData(Kiritimati)]
    [InlineData(PagoPago)]
    public async Task Hand_computed_due_date_totals_hold_in_every_zone_and_today_equals_the_summary_overdue_count_and_the_queue(string zone)
    {
        var trend = await TrendAsync("periodDays=30", zone);
        var types = trend.GetProperty("types").EnumerateArray().ToDictionary(t => t.GetProperty("id").GetInt32());

        // Overdue now: alpha (date-only 10 days back, timed 6 days back), beta (timed, just passed); not the cancelled, future, ASAP or closed ones.
        types[_alpha].GetProperty("overdue").GetInt32().ShouldBe(2);
        types[_beta].GetProperty("overdue").GetInt32().ShouldBe(1);
        types[_gamma].GetProperty("overdue").GetInt32().ShouldBe(0);
        // Completed on time: beta (5.4 days ago, due 5 days ago) and alpha (date-only, a day early); late: beta (7.2, due 8.5 ago... after it) and alpha (date-only, days late).
        types.Values.Sum(t => t.GetProperty("onTime").GetInt32()).ShouldBe(2);
        types.Values.Sum(t => t.GetProperty("late").GetInt32()).ShouldBe(2);

        var all = trend.GetProperty("all");
        all[29].GetProperty("overdue").GetInt32().ShouldBe(3);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard");
        request.Headers.Add("X-Time-Zone", zone);
        var summary = await OkAsync(await _h.Admin.SendAsync(request));
        summary.GetProperty("overdue").GetProperty("count").GetInt32().ShouldBe(3);

        foreach (var t in types.Values.Where(t => t.GetProperty("overdue").GetInt32() > 0))
        {
            var page = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?pageSize=1&" + t.GetProperty("overdueQuery").GetString()));
            page.GetProperty("total").GetInt32().ShouldBe(t.GetProperty("overdue").GetInt32());
        }

        // A closed Task stops being overdue: the cancelled one (due 9 days back, cancelled 8 days back) was overdue only on those days.
        var gamma = await TrendAsync($"periodDays=30&taskTypeIds={_gamma}", zone);
        var overdue = Column(gamma.GetProperty("byTaskType")[0].GetProperty("points"), "overdue");
        overdue[29].ShouldBe(0);
        overdue.Max().ShouldBe(1);
    }

    [Fact]
    public async Task A_due_date_metric_computes_only_that_measure()
    {
        var overdue = await TrendAsync("metric=overdue");
        overdue.GetProperty("all").EnumerateArray().Sum(p => p.GetProperty("created").GetInt32() + p.GetProperty("completed").GetInt32()).ShouldBe(0);
        Column(overdue.GetProperty("all"), "overdue").Max().ShouldBeGreaterThan(0);
        foreach (var metric in new[] { "ontime", "late" })
            (await TrendAsync("metric=" + metric)).GetProperty("metric").GetString().ShouldBe(metric);
    }
}
