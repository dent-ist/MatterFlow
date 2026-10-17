using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /api/v1/dashboard/coverage?groupBy=type (WP11, #134): per task type the people who handled it, under a fixed clock (2026-10-17 12:00 UTC, so the
/// default 30 days are 2026-09-18 to 2026-10-17). The counts equal the matrix orientation and the Task Queue, the scope narrows the people, and the order
/// inside a type is alphabetical (never by count).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class CoverageByTypeApiTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 17, 12, 0, 0, DateTimeKind.Utc);
    private const string Url = "/api/v1/dashboard/coverage";

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private int _typeBusy, _typeOne, _typeNone, _typeOld, _typeRetired;
    private int _ana, _ben, _cy, _dee, _gone, _outside, _pod;
    private HttpClient _viewer = null!;
    private HttpClient _noCoverage = null!;
    private readonly Dictionary<string, long> _ids = [];

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        _typeBusy = _w.TaskTypeId;
        _typeOne = await _h.CreateTaskTypeAsync("Zeta One Person", [_w.OrderedWorkflowId, _w.UnorderedWorkflowId]);
        _typeNone = await _h.CreateTaskTypeAsync("Alpha Nobody", [_w.OrderedWorkflowId, _w.UnorderedWorkflowId]);
        _typeOld = await _h.CreateTaskTypeAsync("Mid Only Old", [_w.OrderedWorkflowId, _w.UnorderedWorkflowId]);
        _typeRetired = await _h.CreateTaskTypeAsync("Retired With Work", [_w.OrderedWorkflowId, _w.UnorderedWorkflowId]);

        var perms = AllTaskPermissions.Concat(["Dashboard.View", "Dashboard.ViewUsers"]).ToArray();
        await _h.UserWithAsync(@"KE\ana", perms);
        await _h.UserWithAsync(@"KE\ben", perms);
        await _h.UserWithAsync(@"KE\cy", perms);
        await _h.UserWithAsync(@"KE\dee", perms);
        await _h.UserWithAsync(@"KE\gone", perms);
        await _h.UserWithAsync(@"KE\outside", perms);
        _viewer = await _h.UserWithAsync(@"KE\covviewer", perms.Concat(["Dashboard.ViewCoverage", "Pod.View"]).ToArray());
        _viewer.DefaultRequestHeaders.Add("X-Time-Zone", "UTC"); // the period days are the viewer's local days
        _noCoverage = _h.As(@"KE\ana");
        _ana = await _h.UserIdAsync(@"KE\ana");
        _ben = await _h.UserIdAsync(@"KE\ben");
        _cy = await _h.UserIdAsync(@"KE\cy");
        _dee = await _h.UserIdAsync(@"KE\dee");
        _gone = await _h.UserIdAsync(@"KE\gone");
        _outside = await _h.UserIdAsync(@"KE\outside");
        _pod = await _h.CreatePodAsync("Type Pod", _ana, _ben, _cy, _dee);

        // Busy: Cy 1, Ana 3, Ben 2 and an inactive person 1 (completed in the period), someone outside the pod 2. One person only: Ana.
        await CompletedAsync("busy-cy", _typeBusy, _cy, Now.AddDays(-2));
        for (var i = 0; i < 3; i++)
            await CompletedAsync($"busy-ana-{i}", _typeBusy, _ana, Now.AddDays(-3 - i));
        for (var i = 0; i < 2; i++)
            await CompletedAsync($"busy-ben-{i}", _typeBusy, _ben, Now.AddDays(-4 - i));
        await CompletedAsync("busy-gone", _typeBusy, _gone, Now.AddDays(-5));
        for (var i = 0; i < 2; i++)
            await CompletedAsync($"busy-out-{i}", _typeBusy, _outside, Now.AddDays(-6 - i));
        await CompletedAsync("one-ana", _typeOne, _ana, Now.AddDays(-1));
        // Boundaries of the 30 days (2026-09-18 00:00 UTC to 2026-10-18 00:00 UTC) and a cancelled and an open task.
        await CompletedAsync("old-first-instant", _typeOld, _ben, new DateTime(2026, 9, 18, 0, 0, 0, DateTimeKind.Utc));
        await CompletedAsync("old-before", _typeOld, _cy, new DateTime(2026, 9, 17, 23, 59, 0, DateTimeKind.Utc));
        await CompletedAsync("none-cancelled", _typeNone, _ana, Now.AddDays(-1), cancel: true);
        await CompletedAsync("retired-1", _typeRetired, _dee, Now.AddDays(-7));
        await _h.ExecuteAsync($"UPDATE dbo.AppUser SET IsActive = 0 WHERE UserId = {_gone}");
        await _h.ExecuteAsync($"UPDATE dbo.TaskType SET IsActive = 0 WHERE TaskTypeId = {_typeRetired}");
        _factory.InvalidateAll();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<JsonElement> GetAsync(string query, HttpClient? client = null) =>
        await OkAsync(await (client ?? _viewer).GetAsync(Url + query));

    private static JsonElement Group(JsonElement board, int typeId) =>
        board.GetProperty("byType").EnumerateArray().Single(g => g.GetProperty("taskTypeId").GetInt32() == typeId);

    private static List<(int User, string Name, int Completed, bool Active)> People(JsonElement group) =>
        [.. group.GetProperty("people").EnumerateArray().Select(p => (p.GetProperty("userId").GetInt32(), p.GetProperty("displayName").GetString()!, p.GetProperty("completed").GetInt32(), p.GetProperty("isActive").GetBoolean()))];

    [Fact]
    public async Task Lists_per_type_the_people_alphabetically_never_by_count_without_the_matrix_payload()
    {
        var board = await GetAsync("?groupBy=type");

        board.GetProperty("users").GetArrayLength().ShouldBe(0);
        board.GetProperty("cells").GetArrayLength().ShouldBe(0);
        var busy = People(Group(board, _typeBusy));
        busy.Select(p => p.Name).ShouldBe([.. busy.Select(p => p.Name).Order(StringComparer.CurrentCultureIgnoreCase)]);
        busy.Select(p => p.User).Order().ToList().ShouldBe(new[] { _ana, _ben, _cy, _gone, _outside }.Order().ToList());
        busy.Single(p => p.User == _ana).Completed.ShouldBe(3);
        busy.Single(p => p.User == _gone).Active.ShouldBeFalse();
        People(Group(board, _typeOne)).Single().User.ShouldBe(_ana);
        People(Group(board, _typeNone)).ShouldBeEmpty(); // the cancelled task never counts
        People(Group(board, _typeOld)).Single().User.ShouldBe(_ben); // 2026-09-18 00:00 is inside, 2026-09-17 23:59 is not
        board.GetProperty("scopePeople").ValueKind.ShouldBe(JsonValueKind.Null); // all pods: the control asks to pick a pod
    }

    [Fact]
    public async Task Counts_per_type_equal_the_matrix_orientation_and_the_task_queue()
    {
        var typed = await GetAsync("?groupBy=type");
        var matrix = await GetAsync("");

        matrix.GetProperty("byType").ValueKind.ShouldBe(JsonValueKind.Null);
        matrix.GetProperty("scopePeople").ValueKind.ShouldBe(JsonValueKind.Null);
        foreach (var t in matrix.GetProperty("taskTypes").EnumerateArray())
        {
            var id = t.GetProperty("taskTypeId").GetInt32();
            var cells = matrix.GetProperty("cells").EnumerateArray().Where(c => c.GetProperty("taskTypeId").GetInt32() == id).ToList();
            var group = People(Group(typed, id));
            group.Sum(p => p.Completed).ShouldBe(cells.Sum(c => c.GetProperty("completed").GetInt32()), $"type {id}");
            group.Count.ShouldBe(cells.Count);
            group.Count.ShouldBe(t.GetProperty("peopleWhoHandledIt").GetInt32());
            typed.GetProperty("taskTypes").EnumerateArray().Single(x => x.GetProperty("taskTypeId").GetInt32() == id)
                .GetProperty("total").GetInt32().ShouldBe(t.GetProperty("total").GetInt32());
        }

        var total = typed.GetProperty("summary").GetProperty("totalCompleted").GetInt32();
        total.ShouldBe(matrix.GetProperty("summary").GetProperty("totalCompleted").GetInt32());
        total.ShouldBe(typed.GetProperty("byType").EnumerateArray().Sum(g => People(g).Sum(p => p.Completed)));
        var queue = await OkAsync(await _viewer.GetAsync("/api/v1/task-queue?pageSize=1&status=COMPLETED&completedFrom=2026-09-18&completedTo=2026-10-17"));
        total.ShouldBe(queue.GetProperty("total").GetInt32());
        output.WriteLine($"completed in the period: {total}");
    }

    [Fact]
    public async Task A_pod_scope_limits_the_names_and_returns_the_pod_roster_for_who_has_not_handled_it()
    {
        var board = await GetAsync($"?groupBy=type&podScope={_pod}");

        People(Group(board, _typeBusy)).Select(p => p.User).Order().ToList().ShouldBe(new[] { _ana, _ben, _cy }.Order().ToList());
        var roster = board.GetProperty("scopePeople").EnumerateArray().Select(p => p.GetProperty("userId").GetInt32()).ToList();
        roster.Order().ToList().ShouldBe(new[] { _ana, _ben, _cy, _dee }.Order().ToList());
        var names = board.GetProperty("scopePeople").EnumerateArray().Select(p => p.GetProperty("displayName").GetString()!).ToList();
        names.ShouldBe([.. names.Order(StringComparer.CurrentCultureIgnoreCase)]);
        board.GetProperty("summary").GetProperty("totalCompleted").GetInt32().ShouldBe(
            board.GetProperty("byType").EnumerateArray().Sum(g => People(g).Sum(p => p.Completed)));

        var mine = await GetAsync("?groupBy=type&podScope=mine");
        mine.GetProperty("byType").GetArrayLength().ShouldBeGreaterThan(0); // the viewer has no pod: the roster is empty, not an error
    }

    [Fact]
    public async Task Inactive_types_with_completions_are_listed_and_the_unknown_group_and_a_missing_permission_are_refused()
    {
        var board = await GetAsync("?groupBy=type");
        board.GetProperty("taskTypes").EnumerateArray().Single(t => t.GetProperty("taskTypeId").GetInt32() == _typeRetired)
            .GetProperty("isActive").GetBoolean().ShouldBeFalse();
        People(Group(board, _typeRetired)).Single().User.ShouldBe(_dee);

        var without = await GetAsync("?groupBy=type&includeInactive=false");
        People(Group(without, _typeBusy)).Select(p => p.User).ShouldNotContain(_gone);

        var bad = await _viewer.GetAsync(Url + "?groupBy=person");
        bad.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await bad.Content.ReadAsStringAsync()).ShouldContain("UNKNOWN_GROUP_BY");
        (await _noCoverage.GetAsync(Url + "?groupBy=type")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    private async Task CompletedAsync(string title, int typeId, int? assignee, DateTime completedAtUtc, bool cancel = false)
    {
        var extra = new Dictionary<string, object?>();
        if (assignee is { } a)
            extra["assignedUserId"] = a;
        var task = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w with { TaskTypeId = typeId }, ordered: false, title: title, extra: extra)), HttpStatusCode.Created);
        _ids[title] = TaskId(task);
        string status;
        if (cancel)
        {
            await _h.StatusAsync(task, "CANCELLED", "No longer needed");
            status = "CANCELLED";
        }
        else
        {
            await _h.CompleteAsync(task);
            status = "COMPLETED";
        }

        var at = completedAtUtc.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture);
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = '{status}', StatusChangedAt = '{at}', CompletedAt = {(cancel ? "NULL" : $"'{at}'")} WHERE TaskId = {_ids[title]}");
    }
}
