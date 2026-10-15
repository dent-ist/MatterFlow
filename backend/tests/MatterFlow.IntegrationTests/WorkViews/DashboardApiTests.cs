using System.Globalization;
using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /api/v1/dashboard (ticket 51): every count against known seeded Tasks, overdue per viewer time zone (addendum M), ASAP never overdue, and
/// the drill-through query of every number returning exactly the counted Tasks from the Task Queue.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string NewYork = "America/New_York";
    private const string Kiritimati = "Pacific/Kiritimati";
    private const string PagoPago = "Pacific/Pago_Pago";

    private readonly DateTime _now = DateTime.UtcNow;
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private HttpClient _techA = null!;
    private int _techAId;
    private readonly List<Seed> _seeds = [];

    private sealed record Seed(
        string Title,
        string Status,
        int? Pod,
        int Type,
        int Priority,
        int? Assignee,
        int? Creator,
        DateOnly? DueDate,
        DateTime? DueAtUtc,
        DateTime CreatedAtUtc,
        DateTime? StatusChangedAtUtc = null)
    {
        public bool IsOpen => Status is "NEW" or "IN_PROGRESS" or "ON_HOLD";
    }

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        _techA = await _h.UserWithAsync(@"KE\techa", TaskHarness.AllTaskPermissions);
        await _h.UserWithAsync(@"KE\techb", TaskHarness.AllTaskPermissions);
        _techAId = await _h.UserIdAsync(@"KE\techa");
        var techB = await _h.UserIdAsync(@"KE\techb");
        var podA = await _h.CreatePodAsync("Pod A", _techAId);
        var podB = await _h.CreatePodAsync("Pod B", techB);
        var t1 = world.TaskTypeId;
        var t2 = await _h.CreateTaskTypeAsync("Second Type", [world.OrderedWorkflowId]);

        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        int PriorityId(string label) => priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == label).GetProperty("id").GetInt32();
        int critical = PriorityId("Critical"), high = PriorityId("High"), normal = PriorityId("Normal"), low = PriorityId("Low");

        var kiritimatiToday = LocalDate(Kiritimati, _now);
        var utcToday = DateOnly.FromDateTime(_now);

        DateTime Ago(double days) => _now.AddDays(-days);

        // Open Tasks (ages sit in the middle of the aging bands so the viewer's zone cannot move them across an edge).
        _seeds.Add(new("asap-new", "NEW", podA, t1, high, null, admin, null, null, _now.AddHours(-1)));
        _seeds.Add(new("k-overdue", "IN_PROGRESS", podA, t1, normal, _techAId, _techAId, kiritimatiToday.AddDays(-1), null, Ago(5)));
        _seeds.Add(new("hold-far", "ON_HOLD", podB, t2, low, techB, admin, new DateOnly(2099, 1, 1), null, Ago(11)));
        _seeds.Add(new("old-overdue", "NEW", null, t2, normal, null, admin, new DateOnly(2000, 1, 1), null, Ago(22)));
        _seeds.Add(new("timed-past", "NEW", podB, t1, critical, _techAId, admin, DateOnly.FromDateTime(_now.AddHours(-3)), _now.AddHours(-3), Ago(45)));
        _seeds.Add(new("timed-soon", "IN_PROGRESS", podA, t2, normal, _techAId, _techAId, DateOnly.FromDateTime(_now.AddHours(3)), _now.AddHours(3), Ago(1)));
        _seeds.Add(new("due-today-utc", "NEW", podA, t1, high, null, admin, utcToday, null, Ago(6)));
        _seeds.Add(new("asap-hold", "ON_HOLD", null, t1, low, null, admin, null, null, Ago(100)));
        _seeds.Add(new("far-new", "NEW", podB, t1, normal, techB, _techAId, new DateOnly(2099, 6, 1), null, _now.AddMinutes(-5)));

        // Closed Tasks: a past due date never makes them overdue.
        _seeds.Add(new("done-recent", "COMPLETED", podA, t1, normal, _techAId, admin, new DateOnly(2000, 3, 3), null, Ago(20), Ago(2)));
        _seeds.Add(new("done-old", "COMPLETED", null, t2, normal, null, admin, null, null, Ago(80), Ago(40)));
        _seeds.Add(new("cancelled", "CANCELLED", podB, t1, normal, null, admin, new DateOnly(2000, 4, 4), null, Ago(3), Ago(1)));
        _seeds.Add(new("done-today", "COMPLETED", null, t1, high, null, _techAId, null, null, Ago(3), _now.AddMinutes(-30)));

        // Eleven more Task Types with one open Task each: the breakdown must fold the smallest into "Other".
        for (var i = 1; i <= 11; i++)
        {
            var type = await _h.CreateTaskTypeAsync("Extra Type " + i.ToString("00", CultureInfo.InvariantCulture), [world.OrderedWorkflowId]);
            _seeds.Add(new("extra-" + i, "NEW", null, type, normal, null, admin, null, null, Ago(1 + (i * 0.001))));
        }

        await _h.ExecuteAsync(SeedSql(world));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private string SeedSql(World world)
    {
        var text = new System.Text.StringBuilder("SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = "
            + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n");
        foreach (var s in _seeds)
        {
            string Instant(DateTime? v) => v is { } x ? "'" + x.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) + "'" : "NULL";
            string Num(int? v) => v?.ToString(CultureInfo.InvariantCulture) ?? "NULL";
            var due = s.DueDate is { } d ? "'" + d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'" : "NULL";
            var sortKey = s.DueDate is null
                ? "NULL"
                : s.DueAtUtc is { } at ? Instant(at) : "DATEADD(MILLISECOND, 86399999, CAST(" + due + " AS DATETIME2(3)))";
            var changed = s.StatusChangedAtUtc ?? s.CreatedAtUtc;
            text.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n")
                .Append("INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedPodId, AssignedUserId, RequestorName, DueDate, DueAtUtc, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES (")
                .Append(CultureInfo.InvariantCulture, $"{world.MatterId}, {s.Type}, @i, N'{s.Title}', {s.Priority}, '{s.Status}', {Num(s.Pod)}, {Num(s.Assignee)}, N'Requestor', {due}, {Instant(s.DueAtUtc)}, {sortKey}, {Instant(changed)}, ")
                .Append(s.Status == "COMPLETED" ? Instant(changed) : "NULL")
                .Append(CultureInfo.InvariantCulture, $", {Instant(s.CreatedAtUtc)}, {Num(s.Creator)});\n");
        }

        return text.ToString();
    }

    // ---- independent expectations (written against the seeded rows, not against the service)

    private static DateOnly LocalDate(string zone, DateTime utc) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById(zone)));

    private static DateTime StartOfDayUtc(string zone, DateOnly date) =>
        TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), TimeZoneInfo.FindSystemTimeZoneById(zone));

    private bool Overdue(Seed s, string zone) =>
        s.IsOpen && ((s.DueAtUtc is { } at && at < _now) || (s.DueAtUtc is null && s.DueDate is { } d && d < LocalDate(zone, _now)));

    private bool DueSoon(Seed s, string zone) =>
        s.IsOpen && s.DueDate is { } d && d <= LocalDate(zone, _now).AddDays(2) && !Overdue(s, zone);

    private string[] Titles(Func<Seed, bool> where) => [.. _seeds.Where(where).Select(s => s.Title)];

    private async Task<JsonElement> DashboardAsync(string query = "", string zone = NewYork, HttpClient? client = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard" + (query.Length > 0 ? "?" + query : string.Empty));
        request.Headers.Add("X-Time-Zone", zone);
        return await OkAsync(await (client ?? _h.Admin).SendAsync(request));
    }

    private async Task<JsonElement> QueueAsync(string query, string zone, HttpClient? client = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/task-queue?pageSize=100&" + query);
        request.Headers.Add("X-Time-Zone", zone);
        return await OkAsync(await (client ?? _h.Admin).SendAsync(request));
    }

    private async Task<List<string>> DrillAsync(JsonElement count, string zone, HttpClient? client = null)
    {
        var page = await QueueAsync(count.GetProperty("query").GetString()!, zone, client);
        var titles = QueueData.TitlesOf(page);
        titles.Count.ShouldBe(count.GetProperty("count").GetInt32(), "drill-through: " + count.GetProperty("query").GetString());
        page.GetProperty("total").GetInt32().ShouldBe(count.GetProperty("count").GetInt32());
        return titles;
    }

    [Theory]
    [InlineData(NewYork)]
    [InlineData(Kiritimati)]
    [InlineData(PagoPago)]
    public async Task Every_headline_count_matches_the_seeded_data_and_its_drill_through_lists_exactly_those_tasks(string zone)
    {
        var d = await DashboardAsync(zone: zone);
        d.GetProperty("timeZone").GetString().ShouldBe(zone);

        async Task Check(string name, Func<Seed, bool> expected)
        {
            var titles = await DrillAsync(d.GetProperty(name), zone);
            titles.ShouldBeSet(Titles(expected));
        }

        var from = LocalDate(zone, _now).AddDays(-29);
        var fromUtc = StartOfDayUtc(zone, from);
        await Check("open", s => s.IsOpen);
        await Check("unassigned", s => s.IsOpen && s.Assignee is null);
        await Check("overdue", s => Overdue(s, zone));
        await Check("onHold", s => s.Status == "ON_HOLD");
        await Check("dueSoon", s => DueSoon(s, zone));
        await Check("asapOpen", s => s.IsOpen && s.DueDate is null);
        await Check("completed", s => s.Status == "COMPLETED" && (s.StatusChangedAtUtc ?? s.CreatedAtUtc) >= fromUtc);
        await Check("created", s => s.CreatedAtUtc >= fromUtc);

        d.GetProperty("period").GetProperty("days").GetInt32().ShouldBe(30);
        d.GetProperty("period").GetProperty("from").GetString().ShouldBe(from.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Fixed_numbers_and_asap_is_never_overdue()
    {
        var d = await DashboardAsync();
        d.GetProperty("open").GetProperty("count").GetInt32().ShouldBe(9 + 11);
        d.GetProperty("onHold").GetProperty("count").GetInt32().ShouldBe(2);
        d.GetProperty("asapOpen").GetProperty("count").GetInt32().ShouldBe(2 + 11);
        d.GetProperty("completed").GetProperty("count").GetInt32().ShouldBe(2);

        foreach (var zone in new[] { NewYork, Kiritimati, PagoPago })
        {
            var overdue = (await DrillAsync((await DashboardAsync(zone: zone)).GetProperty("overdue"), zone)).ToList();
            overdue.ShouldNotContain("asap-new");
            overdue.ShouldNotContain("asap-hold");
            overdue.ShouldNotContain("done-recent");
            overdue.ShouldNotContain("cancelled");
            overdue.ShouldContain("old-overdue");
            overdue.ShouldContain("timed-past");
            overdue.ShouldNotContain("timed-soon");
            overdue.ShouldNotContain("far-new");
        }

        // The same date-only due date is overdue for a viewer far ahead of UTC and not for one far behind it.
        var kiritimati = await DrillAsync((await DashboardAsync(zone: Kiritimati)).GetProperty("overdue"), Kiritimati);
        var pago = await DrillAsync((await DashboardAsync(zone: PagoPago)).GetProperty("overdue"), PagoPago);
        kiritimati.ShouldContain("k-overdue");
        pago.ShouldNotContain("k-overdue");
    }

    [Fact]
    public async Task Breakdowns_count_open_tasks_and_every_row_with_a_query_drills_through_to_that_many_tasks()
    {
        var d = await DashboardAsync();

        d.GetProperty("byStatus").EnumerateArray().Select(i => (i.GetProperty("code").GetString(), i.GetProperty("count").GetInt32()))
            .ShouldBe([("NEW", Titles(s => s.Status == "NEW").Length), ("IN_PROGRESS", 2), ("ON_HOLD", 2)]);

        var priorities = d.GetProperty("byPriority").EnumerateArray().ToDictionary(i => i.GetProperty("label").GetString()!, i => i.GetProperty("count").GetInt32());
        priorities["Critical"].ShouldBe(1);
        priorities["High"].ShouldBe(2);
        priorities["Low"].ShouldBe(2);
        priorities["Normal"].ShouldBe(_seeds.Count(s => s.IsOpen) - 5);

        var pods = d.GetProperty("byPod").EnumerateArray().ToDictionary(i => i.GetProperty("label").GetString()!, i => i.GetProperty("count").GetInt32());
        pods["Pod A"].ShouldBe(4);
        pods["Pod B"].ShouldBe(3);
        pods["No Pod"].ShouldBe(2 + 11);
        // "No pod" drills through to exactly the open Tasks without a Pod (the queue's noPod filter).
        var noPod = d.GetProperty("byPod").EnumerateArray().Single(i => i.GetProperty("label").GetString() == "No Pod");
        noPod.GetProperty("query").GetString()!.ShouldContain("noPod=true");
        (await DrillAsync(noPod, NewYork)).Count.ShouldBe(2 + 11);

        // Task Types: 13 types hold open Tasks; the top 5 are listed and the rest folded into one "Other" row that drills through with all the folded types.
        var types = d.GetProperty("byTaskType").EnumerateArray().ToList();
        types.Count.ShouldBe(6);
        types.Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(_seeds.Count(s => s.IsOpen));
        var other = types[^1];
        other.GetProperty("isOther").GetBoolean().ShouldBeTrue();
        other.GetProperty("label").GetString().ShouldBe("Other task types");
        other.GetProperty("query").GetString()!.Split("&type=").Length.ShouldBe(9, "eight folded types in the link");
        other.GetProperty("count").GetInt32().ShouldBe(8);
        types[0].GetProperty("label").GetString().ShouldBe("Data Processing");
        types[0].GetProperty("count").GetInt32().ShouldBe(Titles(s => s.IsOpen && s.Type == _seeds[0].Type).Length);

        foreach (var row in new[] { "byStatus", "byPriority", "byPod", "byTaskType" }.SelectMany(g => d.GetProperty(g).EnumerateArray()))
        {
            if (row.GetProperty("query").ValueKind == JsonValueKind.Null)
                continue;
            var page = await QueueAsync(row.GetProperty("query").GetString()!, NewYork);
            page.GetProperty("total").GetInt32().ShouldBe(row.GetProperty("count").GetInt32(), row.GetProperty("label").GetString());
        }
    }

    [Theory]
    [InlineData(NewYork)]
    [InlineData(PagoPago)]
    public async Task Aging_buckets_split_open_tasks_by_calendar_age_and_drill_through(string zone)
    {
        var d = await DashboardAsync(zone: zone);
        var buckets = d.GetProperty("aging").EnumerateArray().ToList();
        buckets.Select(b => b.GetProperty("key").GetString()).ShouldBe(["0-2", "3-7", "8-14", "15+"]);

        var today = LocalDate(zone, _now);
        int[] expected = [0, 0, 0, 0];
        foreach (var s in _seeds.Where(s => s.IsOpen))
        {
            var age = today.DayNumber - LocalDate(zone, s.CreatedAtUtc).DayNumber;
            expected[age <= 2 ? 0 : age <= 7 ? 1 : age <= 14 ? 2 : 3]++;
        }

        buckets.Select(b => b.GetProperty("count").GetInt32()).ShouldBe(expected);
        buckets.Sum(b => b.GetProperty("count").GetInt32()).ShouldBe(d.GetProperty("open").GetProperty("count").GetInt32());
        expected.ShouldBe([_seeds.Count(s => s.IsOpen && s.CreatedAtUtc > _now.AddDays(-2.5)), 2, 1, 3], "0-2 days, then 5/6 days, 11 days, 22/45/100 days");
        foreach (var bucket in buckets)
            await DrillAsync(bucket, zone);
    }

    [Theory]
    [InlineData(NewYork)]
    [InlineData(Kiritimati)]
    [InlineData(PagoPago)]
    public async Task The_trend_has_one_point_per_day_and_its_totals_equal_the_created_and_completed_counts(string zone)
    {
        foreach (var days in new[] { 1, 7, 30, 60 })
        {
            var d = await DashboardAsync("periodDays=" + days, zone);
            var trend = d.GetProperty("trend").EnumerateArray().ToList();
            trend.Count.ShouldBe(days);
            var today = LocalDate(zone, _now);
            trend[^1].GetProperty("date").GetString().ShouldBe(today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            trend[0].GetProperty("date").GetString().ShouldBe(today.AddDays(1 - days).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            trend.Sum(p => p.GetProperty("created").GetInt32()).ShouldBe(d.GetProperty("created").GetProperty("count").GetInt32());
            trend.Sum(p => p.GetProperty("completed").GetInt32()).ShouldBe(d.GetProperty("completed").GetProperty("count").GetInt32());
        }

        // Created today in the viewer's zone is counted on the last point.
        var week = await DashboardAsync("periodDays=7", zone);
        var expectedToday = _seeds.Count(s => LocalDate(zone, s.CreatedAtUtc) == LocalDate(zone, _now));
        week.GetProperty("trend").EnumerateArray().Last().GetProperty("created").GetInt32().ShouldBe(expectedToday);
    }

    [Fact]
    public async Task The_trend_is_empty_without_the_department_permission()
    {
        var viewer = await _h.UserWithAsync(@"KE	rendless", "Task.View");
        var d = await OkAsync(await viewer.GetAsync("/api/v1/dashboard"));
        d.GetProperty("trend").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task Fresh_is_accepted_and_unknown_parameters_are_still_rejected()
    {
        (await DashboardAsync("fresh=true")).GetProperty("open").GetProperty("count").GetInt32().ShouldBeGreaterThan(0);
        (await _h.Admin.GetAsync("/api/v1/dashboard?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task The_period_drives_completed_and_created_and_is_validated()
    {
        (await DashboardAsync("periodDays=60")).GetProperty("completed").GetProperty("count").GetInt32().ShouldBe(3);
        var days60 = await DashboardAsync("periodDays=60");
        (await DashboardAsync("periodDays=7")).GetProperty("completed").GetProperty("count").GetInt32().ShouldBe(2);
        (await DashboardAsync("periodDays=1")).GetProperty("completed").GetProperty("count").GetInt32().ShouldBe(1);
        (await DashboardAsync("periodDays=365")).GetProperty("completed").GetProperty("count").GetInt32().ShouldBe(3);
        days60.GetProperty("period").GetProperty("days").GetInt32().ShouldBe(60);

        foreach (var days in new[] { 1, 7, 60, 365 })
        {
            var d = await DashboardAsync("periodDays=" + days);
            await DrillAsync(d.GetProperty("completed"), NewYork);
            await DrillAsync(d.GetProperty("created"), NewYork);
        }

        foreach (var bad in new[] { "periodDays=0", "periodDays=366", "periodDays=abc", "periodDays=-5", "unknown=1" })
            await ProblemAsync(await _h.Admin.GetAsync("/api/v1/dashboard?" + bad), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Recent_lists_hold_the_latest_ten_with_number_title_and_matter()
    {
        var d = await DashboardAsync();
        var created = d.GetProperty("recentlyCreated").EnumerateArray().ToList();
        created.Count.ShouldBe(10);
        created.Select(r => r.GetProperty("atUtc").GetDateTime()).ShouldBe([.. created.Select(r => r.GetProperty("atUtc").GetDateTime()).OrderByDescending(x => x)]);
        created[0].GetProperty("title").GetString().ShouldBe("far-new");
        created[0].GetProperty("taskNumber").GetString().ShouldStartWith("TSK-");
        created[0].GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        created[0].GetProperty("status").GetString().ShouldBe("NEW");
        created[0].GetProperty("statusLabel").GetString().ShouldBe("New");
        created.Select(r => r.GetProperty("title").GetString()).ShouldBe([.. _seeds.OrderByDescending(s => s.CreatedAtUtc).Take(10).Select(s => s.Title)]);

        var completed = d.GetProperty("recentlyCompleted").EnumerateArray().Select(r => r.GetProperty("title").GetString()).ToList();
        completed.ShouldBe(["done-today", "done-recent", "done-old"]);
    }

    [Fact]
    public async Task The_mine_block_counts_the_signed_in_users_work_and_drills_through()
    {
        foreach (var zone in new[] { NewYork, Kiritimati })
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/dashboard");
            request.Headers.Add("X-Time-Zone", zone);
            var d = await OkAsync(await _techA.SendAsync(request));
            var mine = d.GetProperty("mine");
            var from = StartOfDayUtc(zone, LocalDate(zone, _now).AddDays(-29));

            (await DrillAsync(mine.GetProperty("open"), zone, _techA)).ShouldBeSet(Titles(s => s.IsOpen && s.Assignee == _techAId));
            (await DrillAsync(mine.GetProperty("overdue"), zone, _techA)).ShouldBeSet(Titles(s => Overdue(s, zone) && s.Assignee == _techAId));
            (await DrillAsync(mine.GetProperty("dueSoon"), zone, _techA)).ShouldBeSet(Titles(s => DueSoon(s, zone) && s.Assignee == _techAId));
            (await DrillAsync(mine.GetProperty("createdByMe"), zone, _techA)).ShouldBeSet(Titles(s => s.Creator == _techAId && s.CreatedAtUtc >= from));
            mine.GetProperty("open").GetProperty("count").GetInt32().ShouldBe(3);
        }

        // Another user's numbers differ: the admin created none of tech A's tasks and is assigned nothing.
        var admin = await DashboardAsync();
        admin.GetProperty("mine").GetProperty("open").GetProperty("count").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task Sec2_05_department_figures_need_Dashboard_ViewDepartment_and_the_mine_block_does_not()
    {
        var admin = await DashboardAsync();
        admin.GetProperty("open").GetProperty("count").GetInt32().ShouldBeGreaterThan(0);

        var viewer = await _h.UserWithAsync(@"KE\deptless", "Task.View");
        var d = await OkAsync(await viewer.GetAsync("/api/v1/dashboard"));
        foreach (var name in new[] { "open", "unassigned", "overdue", "onHold", "dueSoon", "asapOpen", "completed", "created" })
            d.GetProperty(name).GetProperty("count").GetInt32().ShouldBe(0, name);
        foreach (var name in new[] { "byPod", "byTaskType", "recentlyCreated", "recentlyCompleted" })
            d.GetProperty(name).GetArrayLength().ShouldBe(0, name);
        d.GetProperty("byPriority").EnumerateArray().Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(0);
        d.GetProperty("byStatus").EnumerateArray().Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(0);
        d.GetProperty("aging").EnumerateArray().Sum(i => i.GetProperty("count").GetInt32()).ShouldBe(0);
        d.GetProperty("mine").GetProperty("open").GetProperty("count").GetInt32().ShouldBe(0);

        // The personal block still works for a caller without the department permission.
        (await OkAsync(await _techA.GetAsync("/api/v1/dashboard"))).GetProperty("mine").GetProperty("open").GetProperty("count").GetInt32().ShouldBe(3);
        (await OkAsync(await _techA.GetAsync("/api/v1/dashboard"))).GetProperty("open").GetProperty("count").GetInt32().ShouldBe(0);

        var manager = await _h.UserWithAsync(@"KE\deptfull", "Task.View", "Dashboard.ViewDepartment");
        (await OkAsync(await manager.GetAsync("/api/v1/dashboard"))).GetProperty("open").GetProperty("count").GetInt32().ShouldBe(admin.GetProperty("open").GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task A_user_without_task_view_gets_403_and_an_empty_database_gives_zeros()
    {
        var none = await _h.UserWithAsync(@"KE\nobody", "Matter.View");
        (await none.GetAsync("/api/v1/dashboard")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        await _h.ExecuteAsync("ALTER TABLE dbo.Task DISABLE TRIGGER TR_Task_NoDelete; DELETE FROM dbo.Task; ALTER TABLE dbo.Task ENABLE TRIGGER TR_Task_NoDelete;");
        var d = await DashboardAsync();
        foreach (var name in new[] { "open", "unassigned", "overdue", "onHold", "dueSoon", "asapOpen", "completed", "created" })
            d.GetProperty(name).GetProperty("count").GetInt32().ShouldBe(0);
        d.GetProperty("recentlyCreated").GetArrayLength().ShouldBe(0);
        d.GetProperty("byPod").GetArrayLength().ShouldBe(0);
        d.GetProperty("byTaskType").GetArrayLength().ShouldBe(0);
        d.GetProperty("byStatus").GetArrayLength().ShouldBe(3);
        d.GetProperty("aging").GetArrayLength().ShouldBe(4);
        d.GetProperty("trend").EnumerateArray().Sum(p => p.GetProperty("created").GetInt32() + p.GetProperty("completed").GetInt32()).ShouldBe(0);
    }
}
