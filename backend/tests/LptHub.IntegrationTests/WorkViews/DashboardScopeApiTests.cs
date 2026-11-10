using System.Globalization;
using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The page-wide Scope (P1, #89) on the five Dashboard endpoints. One database with sixteen Tasks spread over three Pods and no Pod, a fixed clock
/// (2026-10-14 16:00 UTC, noon in New York) and four callers: the Director (System Admin, in no Pod), a lead in Pods A and B with the whole Dashboard,
/// a technician in Pod C only, and a lead in Pod A without <c>Pod.View</c>. The expected figures are worked out here from the seeds (not by the code under
/// test); every scoped number must also equal the Task Queue count behind its drill-through link, and the scopes must partition the whole.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardScopeApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string NewYork = "America/New_York";
    private static readonly DateTime Now = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 10, 14);
    private static readonly DateOnly PeriodFrom = new(2026, 9, 15);

    private static readonly string[] DashboardPermissions =
    [
        "Task.View", "Dashboard.View", "Dashboard.ViewSummary", "Dashboard.ViewBreakdowns", "Dashboard.ViewTrends", "Dashboard.ViewSwimlane", "Dashboard.ViewUsers",
        "Dashboard.ViewCoverage",
    ];

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private HttpClient _leadAb = null!;
    private HttpClient _leadA = null!;
    private HttpClient _techC = null!;
    private HttpClient _loner = null!;
    private int _leadAbId;
    private int _leadAId;
    private int _techCId;
    private int _lonerId;
    private int _podA;
    private int _podB;
    private int _podC;
    private int _inactivePod;
    private readonly List<Seed> _seeds = [];

    private sealed record Seed(string Title, string Status, int? Pod, int Type, int Priority, int? Assignee, DateOnly? Due, DateTime Created, DateTime? Changed = null)
    {
        public bool IsOpen => Status is "NEW" or "IN_PROGRESS" or "ON_HOLD";
    }

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        var world = await _h.CreateWorldAsync();
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        _leadAb = await _h.UserWithAsync(@"KE\leadab", [.. DashboardPermissions, "Pod.View"]);
        _leadA = await _h.UserWithAsync(@"KE\leada", DashboardPermissions);
        _techC = await _h.UserWithAsync(@"KE\techc", [.. DashboardPermissions, "Pod.View"]);
        _loner = await _h.UserWithAsync(@"KE\loner", [.. DashboardPermissions, "Pod.View"]);
        _leadAbId = await _h.UserIdAsync(@"KE\leadab");
        _leadAId = await _h.UserIdAsync(@"KE\leada");
        _techCId = await _h.UserIdAsync(@"KE\techc");
        _lonerId = await _h.UserIdAsync(@"KE\loner");
        _podA = await _h.CreatePodAsync("Pod A", _leadAbId, _leadAId);
        _podB = await _h.CreatePodAsync("Pod B", _leadAbId);
        _podC = await _h.CreatePodAsync("Pod C", _techCId);
        _inactivePod = await _h.CreatePodAsync("Pod Old", _lonerId);
        var t1 = world.TaskTypeId;
        var t2 = await _h.CreateTaskTypeAsync("Second Type", [world.OrderedWorkflowId]);

        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        int PriorityId(string label) => priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == label).GetProperty("id").GetInt32();
        int critical = PriorityId("Critical"), high = PriorityId("High"), normal = PriorityId("Normal"), low = PriorityId("Low");

        DateTime Day(int month, int day) => new(2026, month, day, 14, 0, 0, DateTimeKind.Utc);
        DateOnly D(int month, int day) => new(2026, month, day);

        _seeds.Add(new("a-un-overdue", "NEW", _podA, t1, critical, null, D(10, 1), Day(10, 1)));
        _seeds.Add(new("a-asg-soon", "IN_PROGRESS", _podA, t2, high, _leadAbId, D(10, 15), Day(10, 10)));
        _seeds.Add(new("a-hold", "ON_HOLD", _podA, t1, normal, _leadAbId, new DateOnly(2099, 1, 1), Day(10, 2)));
        _seeds.Add(new("b-un-soon", "NEW", _podB, t1, normal, null, D(10, 16), Day(10, 12)));
        _seeds.Add(new("b-asg-overdue", "IN_PROGRESS", _podB, t2, normal, _leadAbId, D(10, 5), Day(8, 1)));
        _seeds.Add(new("b-asap", "NEW", _podB, t1, low, null, null, Day(10, 13)));
        _seeds.Add(new("c-un-overdue", "NEW", _podC, t2, high, null, D(9, 30), Day(9, 20)));
        _seeds.Add(new("c-asg", "NEW", _podC, t1, normal, _techCId, new DateOnly(2099, 1, 1), Day(10, 9)));
        _seeds.Add(new("n-un-overdue", "NEW", null, t1, critical, null, D(9, 20), Day(9, 18)));
        _seeds.Add(new("n-un-asap", "NEW", null, t2, normal, null, null, Day(10, 11)));
        _seeds.Add(new("n-asg-soon", "IN_PROGRESS", null, t1, normal, _lonerId, D(10, 14), Day(10, 8)));
        _seeds.Add(new("a-done", "COMPLETED", _podA, t1, normal, _leadAbId, null, Day(9, 20), Day(10, 10)));
        _seeds.Add(new("b-done", "COMPLETED", _podB, t2, normal, _leadAbId, null, Day(10, 1), Day(10, 12)));
        _seeds.Add(new("c-done", "COMPLETED", _podC, t1, normal, _techCId, null, Day(9, 25), Day(10, 5)));
        _seeds.Add(new("n-done", "COMPLETED", null, t2, normal, admin, null, Day(9, 25), Day(10, 8)));
        _seeds.Add(new("b-cancel", "CANCELLED", _podB, t1, normal, null, D(10, 1), Day(9, 28), Day(10, 13)));
        await _h.ExecuteAsync(SeedSql(world, admin));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private string SeedSql(World world, int admin)
    {
        string Instant(DateTime? v) => v is { } x ? "'" + x.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture) + "'" : "NULL";
        string Num(int? v) => v?.ToString(CultureInfo.InvariantCulture) ?? "NULL";
        var text = new System.Text.StringBuilder("SET NOCOUNT ON; DECLARE @v INT = (SELECT TOP 1 WorkflowVersionId FROM dbo.WorkflowVersion WHERE WorkflowDefinitionId = "
            + world.OrderedWorkflowId + " AND Status = 'PUBLISHED'); DECLARE @i BIGINT;\n");
        foreach (var s in _seeds)
        {
            var due = s.Due is { } d ? "'" + d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'" : "NULL";
            var sortKey = s.Due is null ? "NULL" : "DATEADD(MILLISECOND, 86399999, CAST(" + due + " AS DATETIME2(3)))";
            var changed = s.Changed ?? s.Created;
            text.Append("INSERT dbo.WorkflowInstance (WorkflowVersionId, IsOrdered) VALUES (@v, 1); SET @i = SCOPE_IDENTITY();\n")
                .Append("INSERT dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, StatusCode, AssignedPodId, AssignedUserId, RequestorName, DueDate, DueSortKey, StatusChangedAt, CompletedAt, CreatedAt, CreatedByUserId) VALUES (")
                .Append(CultureInfo.InvariantCulture, $"{world.MatterId}, {s.Type}, @i, N'{s.Title}', {s.Priority}, '{s.Status}', {Num(s.Pod)}, {Num(s.Assignee)}, N'Requestor', {due}, {sortKey}, {Instant(changed)}, ")
                .Append(s.Status == "COMPLETED" ? Instant(changed) : "NULL")
                .Append(CultureInfo.InvariantCulture, $", {Instant(s.Created)}, {admin});\n");
        }

        return text.ToString();
    }

    // ---- independent expectations

    private static DateOnly Local(DateTime utc) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById(NewYork)));

    private static bool Overdue(Seed s) => s.IsOpen && s.Due is { } d && d < Today;

    private static bool DueSoon(Seed s) => s.IsOpen && s.Due is { } d && d <= Today.AddDays(2) && !Overdue(s);

    private static bool InPeriod(DateTime utc) => Local(utc) >= PeriodFrom && Local(utc) <= Today;

    private static bool Completed(Seed s) => s.Status == "COMPLETED" && InPeriod(s.Changed!.Value);

    private static bool Created(Seed s) => InPeriod(s.Created);

    private List<Seed> Of(Func<Seed, bool> pod) => [.. _seeds.Where(pod)];

    private static string[] Titles(IEnumerable<Seed> seeds) => [.. seeds.Select(s => s.Title)];

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("X-Time-Zone", NewYork);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> GetAsync(HttpClient client, string path) => await OkAsync(await SendAsync(client, path));

    private async Task<JsonElement> SummaryAsync(string? scope, HttpClient? client = null) =>
        await GetAsync(client ?? _h.Admin, "/api/v1/dashboard?fresh=true" + (scope is null ? "" : "&podScope=" + scope));

    /// <summary>The Task Queue titles behind a dashboard number; the count must equal the number (the drill-through is the count).</summary>
    private async Task<List<string>> DrillAsync(JsonElement count, string what)
    {
        var query = count.GetProperty("query").GetString()!;
        var page = await GetAsync(_h.Admin, "/api/v1/task-queue?pageSize=100&" + query);
        var titles = QueueData.TitlesOf(page);
        titles.Count.ShouldBe(count.GetProperty("count").GetInt32(), $"{what}: {query}");
        return titles;
    }

    private async Task CheckSummaryAsync(string? scope, Func<Seed, bool> pod, HttpClient? client = null)
    {
        var d = await SummaryAsync(scope, client);
        var mine = Of(pod);
        async Task Check(string name, Func<Seed, bool> expected) => (await DrillAsync(d.GetProperty(name), $"{scope}/{name}")).ShouldBeSet(Titles(mine.Where(expected)));

        await Check("open", s => s.IsOpen);
        await Check("unassigned", s => s.IsOpen && s.Assignee is null);
        await Check("overdue", Overdue);
        await Check("onHold", s => s.Status == "ON_HOLD");
        await Check("dueSoon", DueSoon);
        await Check("asapOpen", s => s.IsOpen && s.Due is null);
        await Check("completed", Completed);
        await Check("created", Created);
        await Check("overdueCritical", s => Overdue(s) && s.Title is "a-un-overdue" or "n-un-overdue");
        await Check("overdueHigh", s => Overdue(s) && s.Title is "c-un-overdue");

        var openCount = mine.Count(s => s.IsOpen);
        foreach (var group in new[] { "byTaskType", "byPriority", "byStatus" })
        {
            var rows = d.GetProperty(group).EnumerateArray().ToList();
            rows.Sum(r => r.GetProperty("count").GetInt32()).ShouldBe(openCount, $"{scope}/{group} sums to Open");
            foreach (var row in rows.Where(r => r.GetProperty("query").ValueKind == JsonValueKind.String))
            {
                var query = row.GetProperty("query").GetString()!;
                (await GetAsync(_h.Admin, "/api/v1/task-queue?pageSize=1&" + query)).GetProperty("total").GetInt32().ShouldBe(row.GetProperty("count").GetInt32(), $"{scope}/{group} row {query}");
                (await GetAsync(_h.Admin, "/api/v1/task-queue?pageSize=1&overdue=true&" + query)).GetProperty("total").GetInt32().ShouldBe(row.GetProperty("overdue").GetInt32(), $"{scope}/{group} overdue {query}");
            }
        }

        var aging = d.GetProperty("aging").EnumerateArray().ToList();
        aging.Sum(b => b.GetProperty("count").GetInt32()).ShouldBe(openCount);
        foreach (var bucket in aging)
            (await GetAsync(_h.Admin, "/api/v1/task-queue?pageSize=1&" + bucket.GetProperty("query").GetString())).GetProperty("total").GetInt32().ShouldBe(bucket.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task All_pods_is_the_default_and_equals_the_unscoped_numbers_with_every_drill_through()
    {
        await CheckSummaryAsync(null, _ => true);
        await CheckSummaryAsync("all", _ => true);
        var info = (await SummaryAsync("all")).GetProperty("scope");
        info.GetProperty("scope").GetString().ShouldBe("all");
        info.GetProperty("unassignedNoPod").GetInt32().ShouldBe(0, "under All pods there is nothing to hint at");
    }

    [Fact]
    public async Task One_pod_narrows_every_number_and_its_drill_through_carries_the_pod_filter()
    {
        foreach (var (name, id) in new[] { ("a", _podA), ("b", _podB), ("c", _podC) })
        {
            await CheckSummaryAsync(id.ToString(CultureInfo.InvariantCulture), s => s.Pod == id);
            var d = await SummaryAsync(id.ToString(CultureInfo.InvariantCulture));
            d.GetProperty("overdue").GetProperty("query").GetString()!.ShouldContain($"pod={id}", Case.Sensitive, $"pod {name}");
            d.GetProperty("scope").GetProperty("podIds").EnumerateArray().Select(e => e.GetInt32()).ShouldBe([id]);
        }
    }

    [Fact]
    public async Task My_pods_is_the_union_of_the_callers_pods_resolved_on_the_server()
    {
        await CheckSummaryAsync("mine", s => s.Pod == _podA || s.Pod == _podB, _leadAb);
        var d = await SummaryAsync("mine", _leadAb);
        d.GetProperty("scope").GetProperty("scope").GetString().ShouldBe("mine");
        d.GetProperty("scope").GetProperty("podIds").EnumerateArray().Select(e => e.GetInt32()).Order().ShouldBe(new[] { _podA, _podB }.Order());
        var overdueQuery = d.GetProperty("overdue").GetProperty("query").GetString()!;
        overdueQuery.ShouldContain($"pod={_podA}");
        overdueQuery.ShouldContain($"pod={_podB}");

        // The same words mean other Pods for other people, so one caller's answer is never served to another from the short cache.
        (await SummaryAsync("mine", _techC)).GetProperty("open").GetProperty("count").GetInt32().ShouldBe(Of(s => s.Pod == _podC && s.IsOpen).Count);
    }

    [Fact]
    public async Task A_caller_in_no_pod_has_an_empty_my_pods_and_the_numbers_all_agree_on_zero()
    {
        var plain = await _h.UserWithAsync(@"KE\nopod", DashboardPermissions);
        var d = await SummaryAsync("mine", plain);
        foreach (var name in new[] { "open", "unassigned", "overdue", "onHold", "dueSoon", "asapOpen", "completed", "created" })
        {
            d.GetProperty(name).GetProperty("count").GetInt32().ShouldBe(0, name);
            (await DrillAsync(d.GetProperty(name), name)).ShouldBeEmpty();
        }
    }

    [Fact]
    public async Task Tasks_with_no_pod_appear_only_under_all_pods_and_the_summary_counts_the_unassigned_ones()
    {
        var all = await SummaryAsync("all");
        var onePod = await SummaryAsync(_podA.ToString(CultureInfo.InvariantCulture));
        var noPod = Of(s => s.Pod is null && s.IsOpen && s.Assignee is null).Count;
        noPod.ShouldBe(2);
        onePod.GetProperty("scope").GetProperty("unassignedNoPod").GetInt32().ShouldBe(noPod);
        (await SummaryAsync("mine", _leadAb)).GetProperty("scope").GetProperty("unassignedNoPod").GetInt32().ShouldBe(noPod);
        all.GetProperty("scope").GetProperty("unassignedNoPod").GetInt32().ShouldBe(0);

        // The pods and the tasks without a pod add up to the whole.
        foreach (var name in new[] { "open", "unassigned", "overdue", "onHold", "dueSoon", "asapOpen", "completed", "created" })
        {
            var parts = 0;
            foreach (var id in new[] { _podA, _podB, _podC })
                parts += (await SummaryAsync(id.ToString(CultureInfo.InvariantCulture))).GetProperty(name).GetProperty("count").GetInt32();
            var none = _seeds.Count(s => s.Pod is null && Matches(name, s));
            (parts + none).ShouldBe(all.GetProperty(name).GetProperty("count").GetInt32(), name);
        }
    }

    private static bool Matches(string name, Seed s) => name switch
    {
        "open" => s.IsOpen,
        "unassigned" => s.IsOpen && s.Assignee is null,
        "overdue" => Overdue(s),
        "onHold" => s.Status == "ON_HOLD",
        "dueSoon" => DueSoon(s),
        "asapOpen" => s.IsOpen && s.Due is null,
        "completed" => Completed(s),
        _ => Created(s),
    };

    [Fact]
    public async Task The_cache_never_serves_one_scope_for_another()
    {
        var all = (await GetAsync(_h.Admin, "/api/v1/dashboard")).GetProperty("open").GetProperty("count").GetInt32();
        var a = (await GetAsync(_h.Admin, $"/api/v1/dashboard?podScope={_podA}")).GetProperty("open").GetProperty("count").GetInt32();
        var again = (await GetAsync(_h.Admin, "/api/v1/dashboard?podScope=all")).GetProperty("open").GetProperty("count").GetInt32();
        var repeat = (await GetAsync(_h.Admin, $"/api/v1/dashboard?podScope={_podA}")).GetProperty("open").GetProperty("count").GetInt32();

        a.ShouldBe(Of(s => s.Pod == _podA && s.IsOpen).Count);
        all.ShouldBe(Of(s => s.IsOpen).Count);
        again.ShouldBe(all);
        repeat.ShouldBe(a);
    }

    [Fact]
    public async Task Trends_totals_follow_the_scope_and_equal_the_summary_tiles()
    {
        foreach (var scope in new[] { "all", _podA.ToString(CultureInfo.InvariantCulture), _podB.ToString(CultureInfo.InvariantCulture), _podC.ToString(CultureInfo.InvariantCulture) })
        {
            Func<Seed, bool> pod = scope == "all" ? _ => true : s => s.Pod == int.Parse(scope, CultureInfo.InvariantCulture);
            var trend = await GetAsync(_h.Admin, "/api/v1/dashboard/trend?fresh=true&podScope=" + scope);
            trend.GetProperty("all").EnumerateArray().Sum(p => p.GetProperty("created").GetInt32()).ShouldBe(Of(pod).Count(Created), $"created {scope}");
            trend.GetProperty("all").EnumerateArray().Sum(p => p.GetProperty("completed").GetInt32()).ShouldBe(Of(pod).Count(Completed), $"completed {scope}");
            trend.GetProperty("types").EnumerateArray().Sum(t => t.GetProperty("created").GetInt32()).ShouldBe(Of(pod).Count(Created), $"types created {scope}");

            var summary = await SummaryAsync(scope);
            trend.GetProperty("all").EnumerateArray().Sum(p => p.GetProperty("created").GetInt32()).ShouldBe(summary.GetProperty("created").GetProperty("count").GetInt32());
            trend.GetProperty("all").EnumerateArray().Sum(p => p.GetProperty("completed").GetInt32()).ShouldBe(summary.GetProperty("completed").GetProperty("count").GetInt32());

            // The last day's overdue snapshot is the Overdue tile.
            trend.GetProperty("all").EnumerateArray().Last().GetProperty("overdue").GetInt32().ShouldBe(summary.GetProperty("overdue").GetProperty("count").GetInt32(), $"overdue {scope}");

            // Drill-through queries of the trend carry the pod too.
            foreach (var type in trend.GetProperty("types").EnumerateArray())
            {
                if (scope == "all")
                    continue;
                type.GetProperty("createdQuery").GetString()!.ShouldContain("pod=" + scope);
                (await GetAsync(_h.Admin, "/api/v1/task-queue?pageSize=1&" + type.GetProperty("createdQuery").GetString())).GetProperty("total").GetInt32().ShouldBe(type.GetProperty("created").GetInt32());
            }
        }

        var mine = await GetAsync(_leadAb, "/api/v1/dashboard/trend?podScope=mine");
        mine.GetProperty("all").EnumerateArray().Sum(p => p.GetProperty("created").GetInt32()).ShouldBe(Of(s => s.Pod == _podA || s.Pod == _podB).Count(Created));
    }

    [Fact]
    public async Task Swimlane_lanes_follow_the_scope_and_the_old_pod_id_still_works()
    {
        int Lane(JsonElement board, string status) => board.GetProperty("lanes").EnumerateArray().First(l => l.GetProperty("status").GetString() == status).GetProperty("count").GetInt32();

        foreach (var (scope, pod) in new (string, Func<Seed, bool>)[] { ("all", _ => true), (_podA.ToString(CultureInfo.InvariantCulture), s => s.Pod == _podA), (_podC.ToString(CultureInfo.InvariantCulture), s => s.Pod == _podC) })
        {
            var board = await GetAsync(_h.Admin, "/api/v1/dashboard/swimlane?podScope=" + scope);
            var seeds = Of(pod);
            Lane(board, "NEW").ShouldBe(seeds.Count(s => s.Status == "NEW"), $"NEW {scope}");
            Lane(board, "IN_PROGRESS").ShouldBe(seeds.Count(s => s.Status == "IN_PROGRESS"));
            Lane(board, "ON_HOLD").ShouldBe(seeds.Count(s => s.Status == "ON_HOLD"));
            Lane(board, "COMPLETED").ShouldBe(seeds.Count(s => s.Status is "COMPLETED" or "CANCELLED" && InPeriod(s.Changed!.Value) && Local(s.Changed!.Value) >= Today.AddDays(-6)));
        }

        var legacy = await GetAsync(_h.Admin, "/api/v1/dashboard/swimlane?podId=" + _podB);
        var scoped = await GetAsync(_h.Admin, "/api/v1/dashboard/swimlane?podScope=" + _podB);
        Lane(legacy, "NEW").ShouldBe(Lane(scoped, "NEW"));
        Lane(legacy, "IN_PROGRESS").ShouldBe(Lane(scoped, "IN_PROGRESS"));

        var mine = await GetAsync(_leadAb, "/api/v1/dashboard/swimlane?podScope=mine");
        Lane(mine, "NEW").ShouldBe(Of(s => (s.Pod == _podA || s.Pod == _podB) && s.Status == "NEW").Count);
    }

    private static List<int> UserIds(JsonElement board) => [.. board.GetProperty("users").EnumerateArray().Select(u => u.GetProperty("userId").GetInt32())];

    [Fact]
    public async Task Workload_lists_the_members_of_the_scope_and_its_unassigned_count_is_the_scopes()
    {
        var a = await GetAsync(_h.Admin, $"/api/v1/dashboard/workload?podScope={_podA}");
        UserIds(a).Order().ShouldBe(new[] { _leadAbId, _leadAId }.Order());
        a.GetProperty("summary").GetProperty("unassignedTasks").GetInt32().ShouldBe(Of(s => s.Pod == _podA && s.IsOpen && s.Assignee is null).Count);

        var mine = await GetAsync(_leadAb, "/api/v1/dashboard/workload?podScope=mine");
        UserIds(mine).Order().ShouldBe(new[] { _leadAbId, _leadAId }.Order());
        mine.GetProperty("summary").GetProperty("unassignedTasks").GetInt32().ShouldBe(Of(s => (s.Pod == _podA || s.Pod == _podB) && s.IsOpen && s.Assignee is null).Count);

        // A person's own open count is about the person (all of their open work), not narrowed to the pod.
        var c = await GetAsync(_h.Admin, $"/api/v1/dashboard/workload?podScope={_podC}");
        UserIds(c).ShouldBe([_techCId]);
        c.GetProperty("users")[0].GetProperty("openTotal").GetInt32().ShouldBe(Of(s => s.Assignee == _techCId && s.IsOpen).Count);

        var legacy = await GetAsync(_h.Admin, $"/api/v1/dashboard/workload?podId={_podC}");
        UserIds(legacy).ShouldBe([_techCId]);

        (await GetAsync(_h.Admin, "/api/v1/dashboard/workload?podScope=all")).GetProperty("summary").GetProperty("unassignedTasks").GetInt32().ShouldBe(Of(s => s.IsOpen && s.Assignee is null).Count);
        (await GetAsync(_leadAb, "/api/v1/dashboard/workload?podScope=mine")).GetProperty("hiddenCount").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task IncludeNoPod_applies_the_can_take_work_rule_and_reports_the_hidden_people()
    {
        var everyone = await GetAsync(_h.Admin, "/api/v1/dashboard/workload");
        var all = UserIds(everyone);
        everyone.GetProperty("hiddenCount").GetInt32().ShouldBe(0, "no parameter: the population before the rule");
        (await GetAsync(_h.Admin, "/api/v1/dashboard/workload?includeNoPod=true")).GetProperty("hiddenCount").GetInt32().ShouldBe(0);

        // Pod-less people without an open task (the System Admin among them) are hidden; a pod-less person who holds an open task is kept.
        var rule = await GetAsync(_h.Admin, "/api/v1/dashboard/workload?includeNoPod=false");
        var shown = UserIds(rule);
        shown.ShouldContain(_lonerId, "holds an open task");
        shown.ShouldContain(_leadAbId);
        shown.ShouldContain(_techCId);
        shown.Count.ShouldBeLessThan(all.Count);
        rule.GetProperty("hiddenCount").GetInt32().ShouldBe(all.Count - shown.Count);
        all.Except(shown).ShouldNotContain(_lonerId);

        // Under a pod scope the list is the pod's members and nobody is hidden.
        var scoped = await GetAsync(_h.Admin, $"/api/v1/dashboard/workload?podScope={_podC}&includeNoPod=false");
        UserIds(scoped).ShouldBe([_techCId]);
        scoped.GetProperty("hiddenCount").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task A_member_of_only_an_inactive_pod_is_not_a_pod_member_for_the_rule_but_still_shown_while_holding_work()
    {
        await _h.ExecuteAsync($"UPDATE dbo.Pod SET IsActive = 0 WHERE PodId = {_inactivePod};");
        var shown = UserIds(await GetAsync(_h.Admin, "/api/v1/dashboard/workload?includeNoPod=false"));
        shown.ShouldContain(_lonerId);
    }

    [Fact]
    public async Task Coverage_lists_the_members_of_the_scope()
    {
        var c = await GetAsync(_h.Admin, $"/api/v1/dashboard/coverage?podScope={_podC}");
        UserIds(c).ShouldBe([_techCId]);
        c.GetProperty("summary").GetProperty("totalCompleted").GetInt32().ShouldBe(Of(s => s.Pod == _podC && s.Status == "COMPLETED" && s.Assignee == _techCId).Count);

        var mine = await GetAsync(_leadAb, "/api/v1/dashboard/coverage?podScope=mine");
        UserIds(mine).Order().ShouldBe(new[] { _leadAbId, _leadAId }.Order());

        UserIds(await GetAsync(_h.Admin, $"/api/v1/dashboard/coverage?podId={_podC}")).ShouldBe([_techCId]);
        UserIds(await GetAsync(_h.Admin, "/api/v1/dashboard/coverage?podScope=all")).ShouldContain(_techCId);
    }

    public static TheoryData<string> Endpoints() =>
    [
        "/api/v1/dashboard",
        "/api/v1/dashboard/trend",
        "/api/v1/dashboard/swimlane",
        "/api/v1/dashboard/workload",
        "/api/v1/dashboard/coverage",
    ];

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task A_pod_the_caller_may_not_see_is_403_and_an_unknown_or_malformed_one_is_400_on_every_endpoint(string path)
    {
        // The lead of Pod A without Pod.View: her own pod is fine, Pod C is not hers to see.
        (await SendAsync(_leadA, $"{path}?podScope={_podA}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await SendAsync(_leadA, $"{path}?podScope=mine")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var forbidden = await SendAsync(_leadA, $"{path}?podScope={_podC}");
        forbidden.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await ReadAsync(forbidden)).GetProperty("code").GetString().ShouldBe("PERMISSION_DENIED");

        // With Pod.View any pod is allowed, but it has to exist.
        (await SendAsync(_techC, $"{path}?podScope={_podA}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var unknown = await SendAsync(_techC, $"{path}?podScope=9999");
        unknown.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        foreach (var bad in new[] { "0", "-3", "x", "1,2", "1 OR 1=1" })
            (await SendAsync(_h.Admin, $"{path}?podScope={Uri.EscapeDataString(bad)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest, bad);
    }

    [Fact]
    public async Task A_scope_narrows_what_the_permissions_allow_and_never_widens_it()
    {
        // Summary only: Breakdowns stay redacted whatever the scope says.
        var summaryOnly = await _h.UserWithAsync(@"KE\summaryonly", "Task.View", "Dashboard.View", "Dashboard.ViewSummary", "Pod.View");
        var d = await SummaryAsync(_podA.ToString(CultureInfo.InvariantCulture), summaryOnly);
        d.GetProperty("byTaskType").GetArrayLength().ShouldBe(0);
        d.GetProperty("aging").GetArrayLength().ShouldBe(0);
        d.GetProperty("open").GetProperty("count").GetInt32().ShouldBe(Of(s => s.Pod == _podA && s.IsOpen).Count);

        // No tab permission for Trends: 403 with or without a scope.
        (await SendAsync(summaryOnly, $"/api/v1/dashboard/trend?podScope={_podA}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await SendAsync(summaryOnly, "/api/v1/dashboard/workload?podScope=mine")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // Unassigned only: just the size of the (scoped) queue.
        var queueOnly = await _h.UserWithAsync(@"KE\queueonly", "Task.View", "Dashboard.View", "Dashboard.ViewUnassigned", "Pod.View");
        var q = await SummaryAsync(_podB.ToString(CultureInfo.InvariantCulture), queueOnly);
        q.GetProperty("unassigned").GetProperty("count").GetInt32().ShouldBe(Of(s => s.Pod == _podB && s.IsOpen && s.Assignee is null).Count);
        q.GetProperty("open").GetProperty("count").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task The_scope_select_offers_own_pods_first_and_other_pods_only_with_Pod_View()
    {
        var member = await GetAsync(_leadAb, "/api/v1/dashboard/scopes");
        member.GetProperty("defaultScope").GetString().ShouldBe("mine");
        member.GetProperty("hasPods").GetBoolean().ShouldBeTrue();
        var pods = member.GetProperty("pods").EnumerateArray().ToList();
        pods.Take(2).Select(p => p.GetProperty("podId").GetInt32()).Order().ShouldBe(new[] { _podA, _podB }.Order());
        pods.Take(2).ShouldAllBe(p => p.GetProperty("isMine").GetBoolean());
        pods.Skip(2).Select(p => p.GetProperty("podId").GetInt32()).ShouldContain(_podC);
        pods.Skip(2).ShouldAllBe(p => !p.GetProperty("isMine").GetBoolean());

        // Without Pod.View only the caller's own pods are offered.
        var narrow = await GetAsync(_leadA, "/api/v1/dashboard/scopes");
        narrow.GetProperty("pods").EnumerateArray().Select(p => p.GetProperty("podId").GetInt32()).ShouldBe([_podA]);

        // Membership only: someone in no pod defaults to All pods, whatever their role.
        var admin = await GetAsync(_h.Admin, "/api/v1/dashboard/scopes");
        admin.GetProperty("defaultScope").GetString().ShouldBe("all");
        admin.GetProperty("hasPods").GetBoolean().ShouldBeFalse();
        admin.GetProperty("pods").EnumerateArray().Count(p => p.GetProperty("isMine").GetBoolean()).ShouldBe(0);

        var noTab = await _h.UserWithAsync(@"KE\notab", "Task.View", "Dashboard.View");
        (await SendAsync(noTab, "/api/v1/dashboard/scopes")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
