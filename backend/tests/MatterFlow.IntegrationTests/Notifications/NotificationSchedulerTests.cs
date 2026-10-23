using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.Notifications.Domain;
using MatterFlow.Notifications.Infrastructure.Scheduling;
using MatterFlow.SharedKernel.Time;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Notifications;

/// <summary>
/// WP-NT3 (#741 to #744) against a real SQL Server: the scheduler host (application lock, isolated jobs, deterministic <c>RunOnceAsync</c>),
/// events 2 and 4 (due soon and overdue), event 6 (unassigned or on hold for a while) and retention. The timer is off in tests.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class NotificationSchedulerTests(SqlServerFixture sql) : IAsyncLifetime
{
    private sealed class MovableClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; set; } = now;
    }

    // A fixed instant, not the machine clock: 01:30 UTC is still the previous calendar day in the firm zone (America/New_York), so every run
    // exercises the UTC-date versus firm-date difference instead of only runs that happen at such an hour. The tests move the clock from here.
    private readonly MovableClock _clock = new(new DateTime(2026, 10, 30, 1, 30, 0, DateTimeKind.Utc));
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private int _annId;
    private int _boId;
    private int _cyId;
    private string _connection = null!;

    public async Task InitializeAsync()
    {
        _connection = await sql.CreateDatabaseAsync();
        _factory = new DatabaseApiFactory(_connection) { Clock = _clock };
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        await _h.UserWithAsync(@"KE\ann", AllTaskPermissions);
        await _h.UserWithAsync(@"KE\bo", AllTaskPermissions);
        await _h.UserWithAsync(@"KE\cy", AllTaskPermissions);
        _annId = await _h.UserIdAsync(@"KE\ann");
        _boId = await _h.UserIdAsync(@"KE\bo");
        _cyId = await _h.UserIdAsync(@"KE\cy");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    // ---- helpers

    private static DateOnly TodayInFirmZone(DateTime now) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(now, UserTimeZone.Resolve(null, "America/New_York").Zone));

    private DateOnly Today => TodayInFirmZone(_clock.UtcNow);

    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private Task ManagersAsync(int? primary, int? secondary) =>
        _h.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {Sql(primary)}, SecondaryManagerId = {Sql(secondary)} WHERE MatterId = {_w.MatterId}");

    private static string Sql(int? id) => id is { } v ? v.ToString(CultureInfo.InvariantCulture) : "NULL";

    private async Task<JsonElement> TaskAsync(int? assignee, DateOnly? due = null, string? title = null)
    {
        var extra = new Dictionary<string, object?>();
        if (assignee is { } a)
            extra["assignedUserId"] = a;
        if (due is { } d)
            extra["dueDate"] = Iso(d);
        var body = _h.NewTask(_w, title: title, extra: extra);
        return await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", body), HttpStatusCode.Created);
    }

    private async Task<SchedulerRunResult> RunAsync(bool ignoreIntervals = true)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<NotificationScheduler>().RunOnceAsync(default, ignoreIntervals);
    }

    /// <summary>The create-path events that making the test tasks produces (event 1 to the assignee, event 5 to the matter managers): not what these tests are about.</summary>
    private static readonly string[] CreatePathEvents = ["TaskAssigned", "MatterTaskCreated"];

    /// <summary>The scheduled notifications (the create-path rows that making the test tasks produces are left out).</summary>
    private Task<List<Notification>> RowsAsync(int? recipient = null, string? type = null) =>
        _factory.WithDbAsync(db => db.Set<Notification>().AsNoTracking()
            .Where(n => !CreatePathEvents.Contains(n.EventType) && (recipient == null || n.RecipientUserId == recipient) && (type == null || n.EventType == type))
            .OrderBy(n => n.Id).ToListAsync());

    private Task<List<Notification>> AllRowsAsync() => _factory.WithDbAsync(db => db.Set<Notification>().AsNoTracking().OrderBy(n => n.Id).ToListAsync());

    private async Task AssignAsync(JsonElement task, int? userId)
    {
        var fresh = await _h.GetTaskAsync(TaskId(task));
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assignment", new { rowVersion = RowVersion(fresh), userId, podId = (int?)null }));
    }

    // ---- #741 the host

    [Fact]
    public async Task A_run_while_another_holds_the_application_lock_is_skipped_and_runs_again_after_it_is_released()
    {
        await TaskAsync(_annId, Today.AddDays(-1));
        await using var holder = new SqlConnection(_connection);
        await holder.OpenAsync();
        await using (var take = holder.CreateCommand())
        {
            take.CommandText = "EXEC sp_getapplock @Resource = N'Notifications.Scheduler', @LockMode = N'Exclusive', @LockOwner = N'Session', @LockTimeout = 0";
            await take.ExecuteNonQueryAsync();
        }

        var skipped = await RunAsync();
        skipped.Skipped.ShouldBeTrue();
        (await RowsAsync()).ShouldBeEmpty();

        await using (var release = holder.CreateCommand())
        {
            release.CommandText = "EXEC sp_releaseapplock @Resource = N'Notifications.Scheduler', @LockOwner = N'Session'";
            await release.ExecuteNonQueryAsync();
        }

        var ran = await RunAsync();
        ran.Skipped.ShouldBeFalse();
        (await RowsAsync(_annId, "TaskDue")).Count.ShouldBe(1);
    }

    [Fact]
    public async Task Overlapping_runs_create_each_row_once()
    {
        await ManagersAsync(_boId, _cyId);
        for (var i = 0; i < 6; i++)
            await TaskAsync(_annId, Today.AddDays(-1));

        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => RunAsync()));

        results.Count(r => !r.Skipped).ShouldBeGreaterThanOrEqualTo(1);
        (await RowsAsync(type: "TaskDue")).Count.ShouldBe(6);
        (await RowsAsync(type: "MatterTaskOverdue")).Count.ShouldBe(12);
        (await RunAsync()).Created.Values.Sum().ShouldBe(0);
    }

    [Fact]
    public async Task An_exception_in_a_job_is_counted_and_the_other_jobs_still_run()
    {
        await TaskAsync(_annId, Today.AddDays(-1));
        using var factory = _factory.WithWebHostBuilder(b => b.ConfigureServices(s =>
            s.AddScoped<INotificationJob, ThrowingJob>()));

        await using var scope = factory.Services.CreateAsyncScope();
        var result = await scope.ServiceProvider.GetRequiredService<NotificationScheduler>().RunOnceAsync(default, true);

        result.Failed.ShouldBe(["throws"]);
        result.Succeeded.ShouldBeFalse();
        (await RowsAsync(_annId, "TaskDue")).Count.ShouldBe(1); // the due job still ran
    }

    private sealed class ThrowingJob : INotificationJob
    {
        public string Name => "throws";

        public TimeSpan MinimumInterval => TimeSpan.Zero;

        public Task<int> RunAsync(JobContext context, CancellationToken cancellationToken) => throw new InvalidOperationException("boom");
    }

    [Fact]
    public async Task The_daily_step_runs_once_a_day_unless_forced()
    {
        var first = await RunAsync(ignoreIntervals: false);
        first.Created.ShouldContainKey("retention");
        var second = await RunAsync(ignoreIntervals: false);
        second.Created.ShouldNotContainKey("retention");
        second.Created.ShouldContainKey("task-due");
        _clock.UtcNow = _clock.UtcNow.AddHours(25);
        (await RunAsync(ignoreIntervals: false)).Created.ShouldContainKey("retention");
    }

    [Fact]
    public async Task The_scheduler_is_listed_on_the_live_health_endpoint_and_a_disabled_timer_is_healthy()
    {
        var report = await _factory.Services.GetRequiredService<Microsoft.Extensions.Diagnostics.HealthChecks.HealthCheckService>()
            .CheckHealthAsync(r => r.Tags.Contains("scheduler"));
        report.Entries.Keys.ShouldBe(["notification-scheduler"]);
        report.Status.ShouldBe(Microsoft.Extensions.Diagnostics.HealthChecks.HealthStatus.Healthy);
        (await _factory.CreateClient().GetStringAsync("/health/live")).ShouldBe("Healthy");
    }

    // ---- #742 events 2 and 4

    [Fact]
    public async Task Overdue_notifies_the_assignee_and_both_managers_with_the_readme_wording_and_is_idempotent()
    {
        await ManagersAsync(_boId, _cyId);
        var due = Today.AddDays(-2);
        var task = await TaskAsync(_annId, due, "Review privilege log");

        var run = await RunAsync();
        run.Skipped.ShouldBeFalse();

        var number = task.GetProperty("taskNumber").GetString();
        var ann = (await RowsAsync(_annId)).ShouldHaveSingleItem();
        ann.EventType.ShouldBe("TaskDue");
        ann.DedupeKey.ShouldBe("overdue:" + Iso(due));
        ann.ActorUserId.ShouldBeNull();
        ann.ObjectId.ShouldBe(TaskId(task));
        ann.Message.ShouldBe($"{number} \"Review privilege log\" is overdue (due {due.ToString("MMM d", CultureInfo.InvariantCulture)}).");

        foreach (var manager in new[] { _boId, _cyId })
        {
            var row = (await RowsAsync(manager)).ShouldHaveSingleItem();
            row.EventType.ShouldBe("MatterTaskOverdue");
            row.DedupeKey.ShouldBe($"overdue:{TaskId(task)}:{Iso(due)}");
            row.Message.ShouldBe($"{number} \"Review privilege log\" on Merger Review 12 is overdue (due {due.ToString("MMM d", CultureInfo.InvariantCulture)}, assigned to {await DisplayNameAsync(_annId)}).");
        }

        (await RunAsync()).Created.Values.Sum().ShouldBe(0);
        (await RowsAsync()).Count.ShouldBe(3);
    }

    private Task<string> DisplayNameAsync(int userId) =>
        _factory.WithDbAsync(db => db.Database.SqlQuery<string>($"SELECT DisplayName AS Value FROM dbo.AppUser WHERE UserId = {userId}").SingleAsync());

    [Fact]
    public async Task Due_today_and_tomorrow_say_so_and_later_dates_ASAP_and_closed_tasks_produce_nothing()
    {
        var today = await TaskAsync(_annId, Today, "Due today");
        var tomorrow = await TaskAsync(_annId, Today.AddDays(1), "Due tomorrow");
        await TaskAsync(_annId, Today.AddDays(2), "Later");
        await TaskAsync(_annId, null, "ASAP");
        var done = await TaskAsync(_annId, Today.AddDays(-3), "Closed");
        await _h.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = 'COMPLETED', CompletedAt = SYSUTCDATETIME() WHERE TaskId = {TaskId(done)}");

        await RunAsync();

        var rows = await RowsAsync(_annId, "TaskDue");
        rows.Count.ShouldBe(2);
        rows.Single(r => r.ObjectId == TaskId(today)).Message.ShouldEndWith("\"Due today\" is due today.");
        rows.Single(r => r.ObjectId == TaskId(tomorrow)).Message.ShouldEndWith($"\"Due tomorrow\" is due tomorrow ({Today.AddDays(1).ToString("MMM d", CultureInfo.InvariantCulture)}).");
        rows.ShouldAllBe(r => r.DedupeKey.StartsWith("soon:"));
    }

    [Fact]
    public async Task Moving_the_due_date_re_arms_and_a_task_fixed_before_the_run_produces_nothing()
    {
        var task = await TaskAsync(_annId, Today.AddDays(-1));
        await RunAsync();
        (await RowsAsync(_annId, "TaskDue")).Count.ShouldBe(1);

        // A new overdue date is a new key.
        await _h.ExecuteAsync($"UPDATE dbo.Task SET DueDate = '{Iso(Today.AddDays(-2))}', DueSortKey = '{Iso(Today.AddDays(-2))}T23:59:59' WHERE TaskId = {TaskId(task)}");
        await RunAsync();
        (await RowsAsync(_annId, "TaskDue")).Count.ShouldBe(2);

        // Fixed before the run: moved into the future, nothing is created.
        var fixedTask = await TaskAsync(_annId, Today.AddDays(-1));
        await _h.ExecuteAsync($"UPDATE dbo.Task SET DueDate = '{Iso(Today.AddDays(30))}' WHERE TaskId = {TaskId(fixedTask)}");
        await RunAsync();
        (await RowsAsync(_annId, "TaskDue")).Count.ShouldBe(2);
    }

    [Fact]
    public async Task After_downtime_only_the_current_state_is_sent()
    {
        var task = await TaskAsync(_annId, Today.AddDays(1));
        await RunAsync(); // soon
        _clock.UtcNow = _clock.UtcNow.AddDays(10); // the service was down for ten days
        await RunAsync();

        var rows = await RowsAsync(_annId, "TaskDue");
        rows.Select(r => r.DedupeKey).ShouldBe(["soon:" + Iso(TodayInFirmZone(_clock.UtcNow.AddDays(-10)).AddDays(1)), "overdue:" + Iso(TodayInFirmZone(_clock.UtcNow.AddDays(-10)).AddDays(1))], ignoreOrder: true);
        rows.ShouldAllBe(r => r.ObjectId == TaskId(task));
        await RunAsync();
        (await RowsAsync(_annId, "TaskDue")).Count.ShouldBe(2); // one overdue, not one per missed day
    }

    [Fact]
    public async Task A_manager_who_is_also_the_assignee_gets_only_the_assignee_event()
    {
        await ManagersAsync(_annId, _boId);
        await TaskAsync(_annId, Today.AddDays(-1));

        await RunAsync();

        (await RowsAsync(_annId)).ShouldHaveSingleItem().EventType.ShouldBe("TaskDue");
        (await RowsAsync(_boId)).ShouldHaveSingleItem().EventType.ShouldBe("MatterTaskOverdue");
    }

    [Fact]
    public async Task A_switch_that_is_off_creates_no_row_and_an_unassigned_overdue_task_says_not_assigned()
    {
        await ManagersAsync(_boId, null);
        var annClient = _h.As(@"KE\ann");
        (await annClient.PutAsJsonAsync("/api/v1/me/notification-preferences", new { items = new[] { new { eventType = "TaskDue", enabled = false } } })).EnsureSuccessStatusCode();
        var boClient = _h.As(@"KE\bo");
        (await boClient.PutAsJsonAsync("/api/v1/me/notification-preferences", new { items = new[] { new { eventType = "MatterTaskStalled", enabled = false } } })).EnsureSuccessStatusCode();
        await TaskAsync(_annId, Today.AddDays(-1));
        await TaskAsync(null, Today.AddDays(-1), "Nobody");

        await RunAsync();

        (await RowsAsync(_annId)).ShouldBeEmpty();
        var bo = await RowsAsync(_boId);
        bo.Count.ShouldBe(2);
        bo.ShouldContain(r => r.Message.Contains("not assigned"));
    }

    // ---- #743 event 6

    [Fact]
    public async Task Unassigned_for_two_calendar_days_notifies_the_managers_once_per_episode()
    {
        await ManagersAsync(_boId, _cyId);
        var task = await TaskAsync(null, null, "Orphan");
        await RunAsync();
        (await RowsAsync(type: "MatterTaskStalled")).ShouldBeEmpty(); // created just now

        _clock.UtcNow = _clock.UtcNow.AddDays(3);
        await RunAsync();
        var rows = await RowsAsync(type: "MatterTaskStalled");
        rows.Count.ShouldBe(2);
        rows.ShouldAllBe(r => r.DedupeKey.StartsWith("unassigned:") && r.ObjectId == TaskId(task) && r.ActorUserId == null);
        rows[0].Message.ShouldEndWith("\"Orphan\" on Merger Review 12 has been unassigned for 3 days.");

        await RunAsync();
        (await RowsAsync(type: "MatterTaskStalled")).Count.ShouldBe(2); // idempotent

        // Assigned and unassigned again: a new episode notifies again.
        await AssignAsync(task, _annId);
        await AssignAsync(task, null);
        _clock.UtcNow = _clock.UtcNow.AddDays(3);
        await RunAsync();
        (await RowsAsync(type: "MatterTaskStalled")).Count.ShouldBe(4);
    }

    [Fact]
    public async Task A_task_assigned_before_the_run_produces_nothing_and_so_does_a_matter_without_managers()
    {
        await ManagersAsync(_boId, null);
        var task = await TaskAsync(null, null, "Orphan");
        await AssignAsync(task, _annId);
        _clock.UtcNow = _clock.UtcNow.AddDays(5);
        await RunAsync();
        (await RowsAsync(type: "MatterTaskStalled")).ShouldBeEmpty();

        await ManagersAsync(null, null);
        await TaskAsync(null, null, "No manager");
        _clock.UtcNow = _clock.UtcNow.AddDays(5);
        await RunAsync();
        (await RowsAsync(type: "MatterTaskStalled")).ShouldBeEmpty();
    }

    [Fact]
    public async Task On_hold_for_five_calendar_days_notifies_once_and_resuming_stops_it()
    {
        await ManagersAsync(_boId, null);
        var held = await TaskAsync(_annId, null, "Held");
        await _h.StatusAsync(held, "ON_HOLD", "Waiting for the client");
        var resumed = await TaskAsync(_annId, null, "Resumed");
        await _h.StatusAsync(resumed, "ON_HOLD", "Waiting");

        _clock.UtcNow = _clock.UtcNow.AddDays(4);
        await RunAsync();
        (await RowsAsync(type: "MatterTaskStalled")).ShouldBeEmpty();

        // Resume one before the threshold.
        await _h.StatusAsync(await _h.GetTaskAsync(TaskId(resumed)), "IN_PROGRESS");
        _clock.UtcNow = _clock.UtcNow.AddDays(2);
        await RunAsync();
        var rows = await RowsAsync(type: "MatterTaskStalled");
        var row = rows.ShouldHaveSingleItem();
        row.RecipientUserId.ShouldBe(_boId);
        row.ObjectId.ShouldBe(TaskId(held));
        row.DedupeKey.ShouldStartWith("hold:");
        row.Message.ShouldEndWith("\"Held\" on Merger Review 12 has been on hold for 6 days.");
        await RunAsync();
        (await RowsAsync(type: "MatterTaskStalled")).Count.ShouldBe(1);
    }

    // ---- #744 retention

    private async Task SeedRowsAsync(int recipient, string state, int ageDays, int count, string prefix)
    {
        var now = $"CAST('{_clock.UtcNow:yyyy-MM-ddTHH:mm:ss}' AS datetime2)"; // the test clock, which retention measures from, not the SQL Server clock
        var read = state == "read" ? $"DATEADD(DAY, -{ageDays}, {now})" : "NULL";
        await _h.ExecuteAsync(
            $"""
            INSERT INTO dbo.Notification (RecipientUserId, EventType, ObjectKind, ObjectId, MatterId, Message, DedupeKey, CreatedUtc, ReadUtc)
            SELECT TOP ({count}) {recipient}, 'TaskAssigned', 'Task', 900000 + ROW_NUMBER() OVER (ORDER BY (SELECT 1)), {_w.MatterId}, N'seed',
                   '{prefix}' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS varchar(12)),
                   DATEADD(DAY, -{ageDays + 1}, {now}), {read}
            FROM sys.all_objects a CROSS JOIN sys.all_objects b
            """);
    }

    [Fact]
    public async Task Retention_deletes_only_read_rows_older_than_90_days_and_anything_older_than_a_year()
    {
        await SeedRowsAsync(_annId, "read", 91, 3, "r91-");
        await SeedRowsAsync(_annId, "read", 89, 2, "r89-");
        await SeedRowsAsync(_annId, "unread", 100, 4, "u100-"); // created 101 days ago, unread: stays
        await _h.ExecuteAsync("INSERT INTO dbo.Notification (RecipientUserId, EventType, ObjectKind, ObjectId, Message, DedupeKey, CreatedUtc) " +
                              $"VALUES ({_annId}, 'TaskAssigned', 'Task', 1, N'ancient', 'ancient', DATEADD(DAY, -366, CAST('{_clock.UtcNow:yyyy-MM-ddTHH:mm:ss}' AS datetime2)))");

        var result = await RunAsync();

        result.Created["retention"].ShouldBe(3 + 1);
        var left = await AllRowsAsync();
        left.Count.ShouldBe(2 + 4);
        left.ShouldNotContain(r => r.DedupeKey == "ancient" || r.DedupeKey.StartsWith("r91-"));
        (await RunAsync()).Created["retention"].ShouldBe(0);
    }

    [Fact]
    public async Task Retention_works_in_batches_over_fifty_thousand_rows()
    {
        await SeedRowsAsync(_annId, "read", 120, 50_000, "big-");
        await SeedRowsAsync(_annId, "read", 10, 10, "keep-");

        var watch = System.Diagnostics.Stopwatch.StartNew();
        var result = await RunAsync();
        watch.Stop();

        result.Created["retention"].ShouldBe(50_000);
        (await AllRowsAsync()).Count.ShouldBe(10);
        watch.Elapsed.ShouldBeLessThan(TimeSpan.FromMinutes(2));
    }

    // ---- performance (README section 8: a run under 2 seconds with 10,000 open tasks)

    [Fact]
    public async Task A_run_over_ten_thousand_open_overdue_tasks_is_fast_once_they_are_notified()
    {
        await ManagersAsync(_boId, _cyId);
        var template = await TaskAsync(_annId, Today.AddDays(-1));
        await _h.ExecuteAsync(
            $"""
            DECLARE @first bigint = IDENT_CURRENT('dbo.WorkflowInstance');
            DECLARE @version int = (SELECT WorkflowVersionId FROM dbo.WorkflowInstance WHERE WorkflowInstanceId = (SELECT WorkflowInstanceId FROM dbo.Task WHERE TaskId = {TaskId(template)}));
            INSERT INTO dbo.WorkflowInstance (WorkflowVersionId, IsOrdered)
            SELECT TOP (10000) @version, 1 FROM sys.all_objects a CROSS JOIN sys.all_objects b;
            INSERT INTO dbo.Task (MatterId, TaskTypeId, WorkflowInstanceId, Title, PriorityId, AssignedUserId, AssignedAt, RequestorName, DueDate, DueSortKey)
            SELECT {_w.MatterId}, t.TaskTypeId, w.WorkflowInstanceId, N'Bulk ' + CAST(w.WorkflowInstanceId AS nvarchar(20)), t.PriorityId, {_annId}, SYSUTCDATETIME(), N'Bulk',
                   '{Iso(Today.AddDays(-1))}', '{Iso(Today.AddDays(-1))}T23:59:59'
            FROM dbo.WorkflowInstance w CROSS JOIN (SELECT TOP 1 TaskTypeId, PriorityId FROM dbo.Task WHERE TaskId = {TaskId(template)}) t
            WHERE w.WorkflowInstanceId > @first;
            """);
        (await _factory.WithDbAsync(db => db.Database.SqlQuery<int>($"SELECT COUNT(*) AS Value FROM dbo.Task WHERE StatusCode = 'NEW'").SingleAsync())).ShouldBeGreaterThanOrEqualTo(10_000);

        var first = System.Diagnostics.Stopwatch.StartNew();
        await RunAsync();
        first.Stop();
        (await RowsAsync(_annId, "TaskDue")).Count.ShouldBeGreaterThanOrEqualTo(10_000);

        var again = System.Diagnostics.Stopwatch.StartNew();
        var second = await RunAsync();
        again.Stop();
        second.Created.Values.Sum().ShouldBe(0);
        Console.WriteLine($"[perf] first run (creates the rows) {first.ElapsedMilliseconds} ms, repeat run {again.ElapsedMilliseconds} ms over 10,001 open overdue tasks");
        again.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(3));
    }
}
