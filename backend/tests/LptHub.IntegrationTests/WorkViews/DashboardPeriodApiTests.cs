using System.Globalization;
using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The one period model (P3, #91) on the three endpoints that take it: GET /api/v1/dashboard, /dashboard/trend and /dashboard/coverage. A task is seeded every
/// seven hours for 380 days, so every local day in every zone holds a different mix, and the expected counts are worked out here from the seeds and the
/// viewer's local dates (not by the code under test). The host clock is fixed (<see cref="DatabaseApiFactory.Clock"/>) at three instants that are hard for
/// periods: the evening before a month starts in New York (it is already the new month in Kiritimati), the last minute of a year, and a leap-day month end.
/// Created and Completed tiles = Trends totals = the Coverage total for the same period; old <c>periodDays</c> still answers; bad ranges are 400.
/// </summary>
public abstract class DashboardPeriodApiTestsBase(SqlServerFixture sql, string instant)
{
    private const string NewYork = "America/New_York";
    private const string Kiritimati = "Pacific/Kiritimati";
    private const string PagoPago = "Pacific/Pago_Pago";

    /// <summary>One seeded database per instant, built by the first test that needs it and shared by the others (the tests only read).</summary>
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, Lazy<Task<Data>>> Worlds = new();

    private sealed record Data(DateTime Now, TaskHarness Harness, List<(DateTime Created, DateTime? Completed)> Seeds);

    private Task<Data> WorldAsync() => Worlds.GetOrAdd(instant, _ => new Lazy<Task<Data>>(() => BuildAsync(sql, instant))).Value;

    private static async Task<Data> BuildAsync(SqlServerFixture sql, string instant)
    {
        var now = DateTime.Parse(instant, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
        var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(now) };
        var h = new TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        var priority = (await OkAsync(await h.Admin.GetAsync("/api/v1/priorities"))).EnumerateArray().First().GetProperty("id").GetInt32();
        var admin = await h.UserIdAsync(DatabaseApiFactory.AdminAccount);

        var seeds = new List<(DateTime Created, DateTime? Completed)>();
        for (var at = now.AddMinutes(-13); at > now.AddDays(-380); at = at.AddHours(-7))
        {
            // Every third task is still open; the others were completed 26 hours after they were created (or not yet, when that is in the future).
            var completed = seeds.Count % 3 == 2 ? null : (DateTime?)at.AddHours(26);
            seeds.Add((at, completed is { } c && c <= now ? c : null));
        }

        string Instant(DateTime? v) => v is { } x ? "'" + x.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) + "'" : "NULL";
        var text = new System.Text.StringBuilder("SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = "
            + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n");
        var n = 0;
        foreach (var (created, completed) in seeds)
        {
            text.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n")
                .Append("INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedUserId, RequestorName, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES (")
                .Append(CultureInfo.InvariantCulture, $"{world.MatterId}, {world.TaskTypeId}, @i, N'P{n++}', {priority}, '{(completed is null ? "NEW" : "COMPLETED")}', {admin}, N'Requestor', {Instant(completed ?? created)}, {Instant(completed)}, {Instant(created)}, {admin});\n");
        }

        await h.ExecuteAsync(text.ToString());
        return new Data(now, h, seeds);
    }

    private static TimeZoneInfo Zone(string id) => TimeZoneInfo.FindSystemTimeZoneById(id);

    private static DateOnly Local(string zone, DateTime utc) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Zone(zone)));

    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>The range a key must resolve to for a viewer, written with DateTime arithmetic (independent of the code under test).</summary>
    private static (DateOnly From, DateOnly To) Expected(Data d, string key, string zone)
    {
        var today = Local(zone, d.Now);
        var firstThis = new DateOnly(today.Year, today.Month, 1);
        return key switch
        {
            "7d" => (today.AddDays(-6), today),
            "30d" => (today.AddDays(-29), today),
            "90d" => (today.AddDays(-89), today),
            "6m" => (today.AddDays(-182), today),
            "12m" => (today.AddDays(-364), today),
            "this-month" => (firstThis, today),
            "last-month" => (firstThis.AddMonths(-1), firstThis.AddDays(-1)),
            _ => throw new ArgumentOutOfRangeException(nameof(key)),
        };
    }

    private static int Created(Data d, string zone, DateOnly from, DateOnly to) => d.Seeds.Count(s => Local(zone, s.Created) >= from && Local(zone, s.Created) <= to);

    private static int Completed(Data d, string zone, DateOnly from, DateOnly to) =>
        d.Seeds.Count(s => s.Completed is { } c && Local(zone, c) >= from && Local(zone, c) <= to);

    private static async Task<HttpResponseMessage> SendAsync(Data d, string path, string query, string zone)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path + (query.Length > 0 ? "?" + query : string.Empty));
        request.Headers.Add("X-Time-Zone", zone);
        return await d.Harness.Admin.SendAsync(request);
    }

    private static async Task<JsonElement> GetAsync(Data d, string path, string query, string zone) => await OkAsync(await SendAsync(d, path, query, zone));

    public static TheoryData<string, string> KeysAndZones()
    {
        var data = new TheoryData<string, string>();
        foreach (var zone in new[] { NewYork, Kiritimati, PagoPago })
            foreach (var key in new[] { "7d", "30d", "90d", "this-month", "last-month", "6m", "12m" })
                data.Add(key, zone);
        return data;
    }

    private static DateOnly WeekStart(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));

    [Theory]
    [MemberData(nameof(KeysAndZones))]
    public async Task Summary_trend_and_coverage_agree_on_the_resolved_period_and_its_counts(string key, string zone)
    {
        var d = await WorldAsync();
        var (from, to) = Expected(d, key, zone);
        var created = Created(d, zone, from, to);
        var completed = Completed(d, zone, from, to);

        var summary = await GetAsync(d, "/api/v1/dashboard", "period=" + key, zone);
        var period = summary.GetProperty("period");
        period.GetProperty("key").GetString().ShouldBe(key);
        period.GetProperty("from").GetString().ShouldBe(Iso(from));
        period.GetProperty("to").GetString().ShouldBe(Iso(to));
        period.GetProperty("days").GetInt32().ShouldBe(to.DayNumber - from.DayNumber + 1);
        summary.GetProperty("created").GetProperty("count").GetInt32().ShouldBe(created);
        summary.GetProperty("completed").GetProperty("count").GetInt32().ShouldBe(completed);

        var trend = await GetAsync(d, "/api/v1/dashboard/trend", "metric=&period=" + key, zone);
        trend.GetProperty("period").GetProperty("from").GetString().ShouldBe(Iso(from));
        trend.GetProperty("period").GetProperty("to").GetString().ShouldBe(Iso(to));
        var all = trend.GetProperty("all").EnumerateArray().ToList();
        var days = to.DayNumber - from.DayNumber + 1;
        trend.GetProperty("granularity").GetString().ShouldBe(days > 31 ? "week" : "day");
        if (days > 31)
        {
            // Weekly points (Monday to Sunday) from the week of the first day to the week of the last.
            all.Count.ShouldBe((WeekStart(to).DayNumber - WeekStart(from).DayNumber) / 7 + 1);
            all[0].GetProperty("date").GetString().ShouldBe(Iso(WeekStart(from)));
            all[^1].GetProperty("date").GetString().ShouldBe(Iso(WeekStart(to)));
        }
        else
        {
            all.Count.ShouldBe(days);
            all[0].GetProperty("date").GetString().ShouldBe(Iso(from));
            all[^1].GetProperty("date").GetString().ShouldBe(Iso(to));
        }

        all.Sum(p => p.GetProperty("created").GetInt32()).ShouldBe(created);
        all.Sum(p => p.GetProperty("completed").GetInt32()).ShouldBe(completed);

        var coverage = await GetAsync(d, "/api/v1/dashboard/coverage", "period=" + key, zone);
        coverage.GetProperty("from").GetString().ShouldBe(Iso(from));
        coverage.GetProperty("to").GetString().ShouldBe(Iso(to));
        coverage.GetProperty("summary").GetProperty("totalCompleted").GetInt32().ShouldBe(completed);
    }

    [Theory]
    [InlineData(NewYork)]
    [InlineData(Kiritimati)]
    public async Task A_custom_range_includes_both_ends_and_the_tile_drill_through_lists_the_same_tasks(string zone)
    {
        var d = await WorldAsync();
        var today = Local(zone, d.Now);
        var from = today.AddDays(-20);
        var to = today.AddDays(-9);
        var query = $"period=custom&from={Iso(from)}&to={Iso(to)}";

        var summary = await GetAsync(d, "/api/v1/dashboard", query, zone);
        summary.GetProperty("period").GetProperty("key").GetString().ShouldBe("custom");
        summary.GetProperty("period").GetProperty("days").GetInt32().ShouldBe(12);
        var created = Created(d, zone, from, to);
        var completed = Completed(d, zone, from, to);
        summary.GetProperty("created").GetProperty("count").GetInt32().ShouldBe(created);
        summary.GetProperty("completed").GetProperty("count").GetInt32().ShouldBe(completed);

        // The query behind a tile closes the period (createdTo / completedTo) and lists exactly the counted tasks.
        foreach (var (tile, expected) in new[] { ("created", created), ("completed", completed) })
        {
            var q = summary.GetProperty(tile).GetProperty("query").GetString()!;
            q.ShouldContain(tile + "To=" + Iso(to));
            var list = await GetAsync(d, "/api/v1/task-queue", "pageSize=1&" + q, zone);
            list.GetProperty("total").GetInt32().ShouldBe(expected, tile);
        }

        // Without 'from'/'to' (a period that ends today) the queries stay open-ended.
        (await GetAsync(d, "/api/v1/dashboard", "period=30d", zone)).GetProperty("created").GetProperty("query").GetString()!.ShouldNotContain("createdTo");

        var trend = await GetAsync(d, "/api/v1/dashboard/trend", query, zone);
        trend.GetProperty("all").GetArrayLength().ShouldBe(12);
        trend.GetProperty("all").EnumerateArray().Sum(p => p.GetProperty("created").GetInt32()).ShouldBe(created);
        (await GetAsync(d, "/api/v1/dashboard/coverage", query, zone)).GetProperty("summary").GetProperty("totalCompleted").GetInt32().ShouldBe(completed);
    }

    [Fact]
    public async Task The_default_is_30_days_and_the_old_periodDays_argument_still_answers()
    {
        var d = await WorldAsync();
        var (from, to) = Expected(d, "30d", NewYork);
        var plain = await GetAsync(d, "/api/v1/dashboard", "", NewYork);
        plain.GetProperty("period").GetProperty("key").GetString().ShouldBe("30d");
        plain.GetProperty("period").GetProperty("from").GetString().ShouldBe(Iso(from));

        var legacy = await GetAsync(d, "/api/v1/dashboard", "periodDays=90", NewYork);
        legacy.GetProperty("period").GetProperty("key").GetString().ShouldBe("90d");
        legacy.GetProperty("created").GetProperty("count").GetInt32().ShouldBe(Created(d, NewYork, Expected(d, "90d", NewYork).From, to));
        (await GetAsync(d, "/api/v1/dashboard/trend", "periodDays=366", NewYork)).GetProperty("all").GetArrayLength().ShouldBeInRange(52, 54);
        (await GetAsync(d, "/api/v1/dashboard/coverage", "periodDays=7", NewYork)).GetProperty("days").GetInt32().ShouldBe(7);

        // The new arguments win over the old one.
        (await GetAsync(d, "/api/v1/dashboard", "period=7d&periodDays=90", NewYork)).GetProperty("period").GetProperty("days").GetInt32().ShouldBe(7);
    }

    [Fact]
    public async Task Different_periods_are_different_cache_entries_and_the_same_period_is_served_again()
    {
        var d = await WorldAsync();
        var a = await GetAsync(d, "/api/v1/dashboard", "period=7d", NewYork);
        var b = await GetAsync(d, "/api/v1/dashboard", "period=30d", NewYork);
        var c = await GetAsync(d, "/api/v1/dashboard", "period=this-month", NewYork);
        var e = await GetAsync(d, "/api/v1/dashboard", "period=last-month", NewYork);
        new[] { a, b, c, e }.Select(x => x.GetProperty("period").GetProperty("key").GetString()).ShouldBe(["7d", "30d", "this-month", "last-month"]);
        (await GetAsync(d, "/api/v1/dashboard", "period=7d", NewYork)).GetProperty("period").GetProperty("key").GetString().ShouldBe("7d");
        (await GetAsync(d, "/api/v1/dashboard/trend", "period=7d", NewYork)).GetProperty("period").GetProperty("days").GetInt32().ShouldBe(7);
        (await GetAsync(d, "/api/v1/dashboard/trend", "period=last-month", NewYork)).GetProperty("period").GetProperty("key").GetString().ShouldBe("last-month");
    }

    [Theory]
    [InlineData("/api/v1/dashboard")]
    [InlineData("/api/v1/dashboard/trend")]
    [InlineData("/api/v1/dashboard/coverage")]
    public async Task Bad_periods_are_400_with_a_field_code(string path)
    {
        var d = await WorldAsync();
        var today = Local(NewYork, d.Now);
        var cases = new (string Query, string Code)[]
        {
            ("period=quarter", "PERIOD_INVALID"),
            ("period=custom", "PERIOD_INVALID"),
            ("period=90d&from=2026-01-01&to=2026-01-05", "PERIOD_INVALID"),
            ("from=2026-01-01", "PERIOD_INVALID"),
            ("from=2026-01-05&to=2026-01-01", "PERIOD_INVALID"),
            ($"from={Iso(today.AddDays(-366))}&to={Iso(today)}", "PERIOD_TOO_LONG"),
        };
        foreach (var (query, code) in cases)
        {
            var response = await SendAsync(d, path, query, NewYork);
            var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "VALIDATION_FAILED");
            problem.GetRawText().ShouldContain(code, customMessage: query);
        }

        // 366 days is the longest allowed range.
        (await SendAsync(d, path, $"from={Iso(today.AddDays(-365))}&to={Iso(today)}", NewYork)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}

[Collection(SqlServerCollection.Name)]
public sealed class DashboardPeriodApiTestsMonthEdge(SqlServerFixture sql) : DashboardPeriodApiTestsBase(sql, "2026-11-01T02:30:00Z");

[Collection(SqlServerCollection.Name)]
public sealed class DashboardPeriodApiTestsYearEdge(SqlServerFixture sql) : DashboardPeriodApiTestsBase(sql, "2027-01-01T04:59:00Z");

[Collection(SqlServerCollection.Name)]
public sealed class DashboardPeriodApiTestsLeapMonthEnd(SqlServerFixture sql) : DashboardPeriodApiTestsBase(sql, "2028-03-01T00:20:00Z");
