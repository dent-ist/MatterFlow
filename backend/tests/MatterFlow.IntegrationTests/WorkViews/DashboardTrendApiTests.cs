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
    private readonly List<(int Type, DateTime Created, DateTime? Completed)> _seeds = [];

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
        _seeds.AddRange(
        [
            (_alpha, Ago(0.01), null), (_alpha, Ago(0.5), null), (_alpha, Ago(1.2), Ago(0.1)), (_alpha, Ago(3.4), Ago(2.3)), (_alpha, Ago(10.6), null), (_alpha, Ago(40), Ago(35)),
            (_beta, Ago(0.2), Ago(0.2)), (_beta, Ago(2.5), null), (_beta, Ago(2.7), Ago(1.5)), (_beta, Ago(20.3), null), (_beta, Ago(80), null),
            (_gamma, Ago(5.5), Ago(4.5)), (_gamma, Ago(6.1), null), (_gamma, Ago(200), null),
        ]);
        var text = new System.Text.StringBuilder("SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = "
            + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n");
        string Instant(DateTime v) => "'" + v.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) + "'";
        var n = 0;
        foreach (var (type, created, completed) in _seeds)
        {
            var status = completed is null ? "NEW" : "COMPLETED";
            var changed = completed ?? created;
            text.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n")
                .Append("INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, RequestorName, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES (")
                .Append(CultureInfo.InvariantCulture, $"{world.MatterId}, {type}, @i, N'T{n++}', {priority}, '{status}', N'Requestor', {Instant(changed)}, ")
                .Append(completed is null ? "NULL" : Instant(changed))
                .Append(CultureInfo.InvariantCulture, $", {Instant(created)}, {admin});\n");
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
    public async Task Per_type_series_add_up_to_the_all_series_which_equals_the_summary_trend_in_the_viewers_days(string zone)
    {
        foreach (var days in new[] { 1, 7, 30, 90 })
        {
            var all = $"{_alpha}&taskTypeIds={_beta}&taskTypeIds={_gamma}&taskTypeIds={_delta}";
            var trend = await TrendAsync($"periodDays={days}&taskTypeIds={all}", zone);

            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard?periodDays=" + days);
            request.Headers.Add("X-Time-Zone", zone);
            var summary = await OkAsync(await _h.Admin.SendAsync(request));
            var summaryTrend = summary.GetProperty("trend");
            Column(trend.GetProperty("all"), "created").ShouldBe(Column(summaryTrend, "created"));
            Column(trend.GetProperty("all"), "completed").ShouldBe(Column(summaryTrend, "completed"));
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
        var viewer = await _h.UserWithAsync(@"KE\trendless", "Task.View");
        (await RawAsync(string.Empty, viewer)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var manager = await _h.UserWithAsync(@"KE\trendfull", "Task.View", "Dashboard.ViewDepartment");
        (await TrendAsync(client: manager)).GetProperty("all").GetArrayLength().ShouldBe(30);
    }
}
