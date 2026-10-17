using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The queue's sort and overdue logic (addendum G and M, architecture 8.4) without a database.</summary>
public class TaskQueueRulesTests
{
    private static readonly DateTime Created = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private static QueueClock ClockIn(string zoneId, DateTime nowUtc) => QueueClock.Create(nowUtc, UserTimeZone.Resolve(zoneId));

    private static WorkTask Task(TaskStatusCode status, DateOnly? date, DateTime? at = null) => new() { Status = status, DueDate = date, DueAtUtc = at };

    private static TaskSortRow Row(long id, int priority, DateOnly? date, DateTime? atUtc = null, int createdDays = 0, TaskStatusCode status = TaskStatusCode.New) =>
        new()
        {
            Id = id,
            PrioritySortOrder = priority,
            Status = status,
            DueDate = date,
            DueAtUtc = atUtc,
            DueSortKey = DueDates.SortKey(date, atUtc),
            CreatedAtUtc = Created.AddDays(createdDays),
            StatusChangedAtUtc = Created.AddDays(createdDays),
        };

    private static List<long> Ids(IQueryable<TaskSortRow> rows, string sort = TaskQueueRules.SortDefault, bool descending = false) =>
        [.. TaskQueueRules.Order(rows, sort, descending).Select(r => r.Id)];

    // ---- one vocabulary (BUG-13)

    [Theory]
    [InlineData("America/New_York")]
    [InlineData("America/Los_Angeles")]
    [InlineData("Pacific/Kiritimati")]
    [InlineData("UTC")]
    public void Dashboards_due_soon_is_the_my_work_window_without_the_overdue_ones_and_never_overlaps_overdue(string zone)
    {
        var now = new DateTime(2026, 10, 14, 4, 30, 0, DateTimeKind.Utc);
        var clock = ClockIn(zone, now);
        var today = clock.Today;
        var tasks = new List<WorkTask>();
        foreach (var status in new[] { TaskStatusCode.New, TaskStatusCode.OnHold, TaskStatusCode.Completed, TaskStatusCode.Cancelled })
        {
            tasks.Add(Task(status, null));
            for (var offset = -3; offset <= 4; offset++)
            {
                var date = today.AddDays(offset);
                tasks.Add(Task(status, date));
                // A timed due: an instant a few hours around now, whose local date is the task's due date.
                foreach (var hours in new[] { -6, -1, 1, 30 })
                {
                    var at = now.AddHours(hours);
                    tasks.Add(new WorkTask { Status = status, DueDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(at, UserTimeZone.Resolve(zone).Zone)), DueAtUtc = at });
                }
            }
        }

        var dueSoonAndOverdue = TaskQueueRules.DueSoon(clock).Compile();
        var overdue = TaskQueueRules.Overdue(clock).Compile();
        var dueSoon = TaskQueueRules.DueSoonExcludingOverdue(clock).Compile();
        foreach (var t in tasks)
        {
            dueSoon(t).ShouldBe(dueSoonAndOverdue(t) && !overdue(t), $"{zone} {t.Status} {t.DueDate} {t.DueAtUtc}");
            (dueSoon(t) && overdue(t)).ShouldBeFalse("Due soon and Overdue never overlap");
            if (t.DueDate is null)
                dueSoonAndOverdue(t).ShouldBeFalse("ASAP is never due soon");
            if (overdue(t))
                dueSoonAndOverdue(t).ShouldBeTrue("an overdue task is on the Due soon and overdue tab");
        }

        TaskQueueRules.DueSoonDays.ShouldBe(2);
    }

    [Fact]
    public void Due_soon_and_overdue_default_order_is_overdue_first_then_due_moment_then_priority_then_oldest_then_id()
    {
        var now = new DateTime(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc); // noon in New York
        var clock = ClockIn("America/New_York", now);
        var today = new DateOnly(2026, 10, 14);
        var rows = new[]
        {
            Row(1, priority: 3, today.AddDays(2)),
            Row(2, priority: 1, today.AddDays(2)), // same day, more urgent: before 1
            Row(3, priority: 3, today.AddDays(-13)),
            Row(4, priority: 3, today, atUtc: now.AddHours(3)), // later today, timed: not overdue
            Row(5, priority: 3, today, atUtc: now.AddHours(-2)), // earlier today, timed: overdue
            Row(6, priority: 2, today), // date-only today: not overdue, and its stored key (the end of the date) is after the timed one
            Row(7, priority: 3, today.AddDays(-1)),
            Row(8, priority: 3, today.AddDays(2), createdDays: -5), // same day and priority as 1, older: before 1
            Row(9, priority: 3, today.AddDays(-13), createdDays: 2), // same due and priority as 3, created later: after 3
        };

        var ids = TaskQueueRules.OrderDueSoon(rows.AsQueryable(), clock).Select(r => r.Id).ToList();

        ids.ShouldBe([3, 9, 7, 5, 4, 6, 2, 8, 1]);
    }

    // ---- overdue

    public static TheoryData<string, string, bool> OverdueCases() => new()
    {
        // Date-only: overdue after the viewer's local day has passed (addendum M). 2026-10-14 04:30 UTC is Oct 14 00:30 in New York but still Oct 13 evening in Chicago.
        { "America/Chicago", "2026-10-13", false },
        { "America/New_York", "2026-10-13", true },
        { "America/Los_Angeles", "2026-10-13", false },
        { "America/Chicago", "2026-10-12", true },
        { "Pacific/Kiritimati", "2026-10-14", false },
        { "Pacific/Kiritimati", "2026-10-13", true },
        { "UTC", "2026-10-14", false },
        { "UTC", "2026-10-13", true },
    };

    [Theory]
    [MemberData(nameof(OverdueCases))]
    public void Date_only_due_is_overdue_by_the_viewers_local_date(string zone, string due, bool expected)
    {
        var now = new DateTime(2026, 10, 14, 4, 30, 0, DateTimeKind.Utc);
        var clock = ClockIn(zone, now);
        var task = Task(TaskStatusCode.InProgress, DateOnly.Parse(due));

        TaskQueueRules.Overdue(clock).Compile()(task).ShouldBe(expected);
        TaskQueueRules.IsOverdue(task.Status, task.DueDate, task.DueAtUtc, clock).ShouldBe(expected);
        task.DueDate.HasValue.ShouldBeTrue();
        DueDates.IsOverdue(task.DueDate, null, now, UserTimeZone.Resolve(zone).Zone).ShouldBe(expected);
    }

    [Fact]
    public void The_same_task_is_overdue_for_one_zone_and_not_for_another_near_midnight()
    {
        // 00:30 on Oct 14 in New York is 23:30 on Oct 13 in Chicago.
        var now = new DateTime(2026, 10, 14, 4, 30, 0, DateTimeKind.Utc);
        var task = Task(TaskStatusCode.New, new DateOnly(2026, 10, 13));

        TaskQueueRules.Overdue(ClockIn("America/New_York", now)).Compile()(task).ShouldBeTrue();
        TaskQueueRules.Overdue(ClockIn("America/Chicago", now)).Compile()(task).ShouldBeFalse();
    }

    [Fact]
    public void A_due_instant_is_overdue_for_everyone_once_it_has_passed()
    {
        var due = new DateTime(2026, 10, 14, 15, 0, 0, DateTimeKind.Utc);
        var task = Task(TaskStatusCode.OnHold, new DateOnly(2026, 10, 14), due);
        foreach (var zone in new[] { "America/New_York", "America/Los_Angeles", "Pacific/Kiritimati", "UTC" })
        {
            TaskQueueRules.Overdue(ClockIn(zone, due.AddSeconds(-1))).Compile()(task).ShouldBeFalse(zone);
            TaskQueueRules.Overdue(ClockIn(zone, due.AddSeconds(1))).Compile()(task).ShouldBeTrue(zone);
        }
    }

    [Theory]
    [InlineData(TaskStatusCode.New, true)]
    [InlineData(TaskStatusCode.InProgress, true)]
    [InlineData(TaskStatusCode.OnHold, true)]
    [InlineData(TaskStatusCode.Completed, false)]
    [InlineData(TaskStatusCode.Cancelled, false)]
    public void Only_open_tasks_can_be_overdue(TaskStatusCode status, bool expected)
    {
        var clock = ClockIn("America/New_York", new DateTime(2026, 10, 14, 12, 0, 0, DateTimeKind.Utc));
        var task = Task(status, new DateOnly(2020, 1, 1));
        TaskQueueRules.Overdue(clock).Compile()(task).ShouldBe(expected);
        TaskQueueRules.IsOverdue(status, task.DueDate, null, clock).ShouldBe(expected);
        TaskQueueRules.Open.Compile()(task).ShouldBe(expected);
        TaskQueueRules.Closed.Compile()(task).ShouldBe(!expected);
    }

    [Fact]
    public void Asap_is_never_overdue_even_far_in_the_future_of_its_creation()
    {
        var clock = ClockIn("Pacific/Kiritimati", new DateTime(2099, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        TaskQueueRules.Overdue(clock).Compile()(Task(TaskStatusCode.New, null)).ShouldBeFalse();
        TaskQueueRules.IsOverdue(TaskStatusCode.New, null, null, clock).ShouldBeFalse();
        TaskQueueRules.DueSoon(clock).Compile()(Task(TaskStatusCode.New, null)).ShouldBeFalse();
    }

    [Fact]
    public void The_filter_predicate_and_the_row_flag_always_agree()
    {
        var instants = new[]
        {
            new DateTime(2026, 3, 8, 6, 59, 59, DateTimeKind.Utc), // just before New York springs forward
            new DateTime(2026, 3, 8, 7, 0, 1, DateTimeKind.Utc),
            new DateTime(2026, 11, 1, 4, 59, 59, DateTimeKind.Utc), // just before New York falls back
            new DateTime(2026, 11, 1, 6, 0, 1, DateTimeKind.Utc),
            new DateTime(2026, 6, 30, 23, 59, 59, DateTimeKind.Utc),
            new DateTime(2026, 12, 31, 23, 59, 59, DateTimeKind.Utc),
        };
        var zones = new[] { "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "Pacific/Honolulu", "Pacific/Kiritimati", "UTC" };
        var statuses = Enum.GetValues<TaskStatusCode>();
        foreach (var now in instants)
            foreach (var zone in zones)
            {
                var clock = ClockIn(zone, now);
                var predicate = TaskQueueRules.Overdue(clock).Compile();
                var resolved = UserTimeZone.Resolve(zone);
                for (var offset = -3; offset <= 3; offset++)
                {
                    var date = DateOnly.FromDateTime(now).AddDays(offset);
                    foreach (var status in statuses)
                    {
                        var dateOnly = Task(status, date);
                        var timed = Task(status, date, now.AddHours(offset * 5).AddMinutes(offset));
                        foreach (var task in new[] { dateOnly, timed })
                        {
                            var expected = TaskDue.FromStored(task.DueDate, task.DueAtUtc).IsOverdue(task.Status, now, resolved.Zone);
                            predicate(task).ShouldBe(expected, $"{zone} {now:O} {status} {task.DueDate} {task.DueAtUtc:O}");
                            TaskQueueRules.IsOverdue(task.Status, task.DueDate, task.DueAtUtc, clock).ShouldBe(expected);
                        }
                    }
                }
            }
    }

    // ---- due soon

    [Theory]
    [InlineData("2026-10-13", true)] // overdue counts
    [InlineData("2026-10-14", true)] // today
    [InlineData("2026-10-16", true)] // two days ahead
    [InlineData("2026-10-17", false)]
    public void Due_soon_covers_overdue_and_the_next_two_local_days(string due, bool expected)
    {
        var clock = ClockIn("America/Chicago", new DateTime(2026, 10, 14, 15, 0, 0, DateTimeKind.Utc));
        TaskQueueRules.DueSoon(clock).Compile()(Task(TaskStatusCode.InProgress, DateOnly.Parse(due))).ShouldBe(expected);
        TaskQueueRules.DueSoon(clock).Compile()(Task(TaskStatusCode.Completed, DateOnly.Parse(due))).ShouldBeFalse();
    }

    [Fact]
    public void Due_soon_for_a_timed_due_ends_with_the_viewers_local_day_two_days_ahead()
    {
        var clock = ClockIn("America/Los_Angeles", new DateTime(2026, 10, 14, 15, 0, 0, DateTimeKind.Utc)); // Oct 14, 08:00 in Los Angeles
        var endOfOct16 = new DateTime(2026, 10, 17, 7, 0, 0, DateTimeKind.Utc); // midnight Oct 17 in Los Angeles (PDT)
        var rule = TaskQueueRules.DueSoon(clock).Compile();
        rule(Task(TaskStatusCode.New, new DateOnly(2026, 10, 16), endOfOct16.AddMinutes(-1))).ShouldBeTrue();
        rule(Task(TaskStatusCode.New, new DateOnly(2026, 10, 17), endOfOct16.AddMinutes(1))).ShouldBeFalse();
    }

    [Fact]
    public void Or_combines_predicates()
    {
        var clock = ClockIn("UTC", new DateTime(2026, 10, 14, 12, 0, 0, DateTimeKind.Utc));
        var rule = TaskQueueRules.Or(TaskQueueRules.Overdue(clock), t => t.Status == TaskStatusCode.OnHold).Compile();
        rule(Task(TaskStatusCode.New, new DateOnly(2020, 1, 1))).ShouldBeTrue();
        rule(Task(TaskStatusCode.OnHold, null)).ShouldBeTrue();
        rule(Task(TaskStatusCode.New, null)).ShouldBeFalse();
    }

    [Fact]
    public void The_clock_exposes_the_local_date_and_the_start_of_a_local_day()
    {
        var clock = ClockIn("America/New_York", new DateTime(2026, 10, 14, 3, 30, 0, DateTimeKind.Utc));
        clock.Today.ShouldBe(new DateOnly(2026, 10, 13));
        clock.ZoneId.ShouldBe("America/New_York");
        clock.StartOfDayUtc(new DateOnly(2026, 10, 14)).ShouldBe(new DateTime(2026, 10, 14, 4, 0, 0)); // EDT is UTC-4
    }

    // ---- sorting

    [Fact]
    public void Default_order_is_priority_then_asap_above_explicit_dates_then_due_ascending_then_oldest()
    {
        var rows = new[]
        {
            Row(1, priority: 2, date: null, createdDays: 1),
            Row(2, priority: 1, date: new DateOnly(2026, 12, 1), createdDays: 2),
            Row(3, priority: 1, date: null, createdDays: 5), // ASAP, newer
            Row(4, priority: 1, date: null, createdDays: 3), // ASAP, older
            Row(5, priority: 1, date: new DateOnly(2026, 11, 1), createdDays: 9), // overdue / earlier explicit date
            Row(6, priority: 1, date: new DateOnly(2026, 11, 1), createdDays: 4), // same date, older
            Row(7, priority: 1, date: new DateOnly(2026, 11, 1), atUtc: new DateTime(2026, 11, 1, 9, 0, 0, DateTimeKind.Utc), createdDays: 1), // timed earlier that day
            Row(8, priority: 0, date: new DateOnly(2099, 1, 1), createdDays: 8),
        }.AsQueryable();

        Ids(rows).ShouldBe([8, 4, 3, 7, 6, 5, 2, 1]);
    }

    [Fact]
    public void Default_order_ignores_the_direction()
    {
        var rows = new[] { Row(1, 1, null), Row(2, 0, null) }.AsQueryable();
        Ids(rows, TaskQueueRules.SortDefault, descending: true).ShouldBe([2, 1]);
    }

    [Fact]
    public void Sorting_by_priority_descending_reverses_priorities_but_keeps_the_default_tie_break()
    {
        var rows = new[]
        {
            Row(1, 0, new DateOnly(2026, 1, 1)),
            Row(2, 0, null),
            Row(3, 1, null),
        }.AsQueryable();

        Ids(rows, TaskQueueRules.SortPriority).ShouldBe([2, 1, 3]);
        Ids(rows, TaskQueueRules.SortPriority, descending: true).ShouldBe([3, 2, 1]);
    }

    [Fact]
    public void Sorting_by_priorityAge_is_priority_then_oldest_and_ignores_due_dates()
    {
        var rows = new[]
        {
            Row(1, 1, new DateOnly(2026, 1, 1), createdDays: 5),
            Row(2, 0, new DateOnly(2099, 1, 1), createdDays: 9),   // same priority as 3 but younger than 3: after it
            Row(3, 0, null, createdDays: 2),                       // ASAP does not jump the queue
            Row(4, 1, null, createdDays: 1),
            Row(5, 0, new DateOnly(2000, 1, 1), createdDays: 2),   // same age as 3: the lower id first
        }.AsQueryable();

        TaskQueueRules.SortFields.ShouldContain(TaskQueueRules.SortPriorityAge);
        Ids(rows, TaskQueueRules.SortPriorityAge).ShouldBe([3, 5, 2, 4, 1]);
        TaskQueueRules.DefaultsToDescending(TaskQueueRules.SortPriorityAge).ShouldBeFalse();
    }

    [Fact]
    public void Sorting_by_due_puts_asap_first_ascending_and_last_descending()
    {
        var rows = new[]
        {
            Row(1, 0, new DateOnly(2026, 5, 1)),
            Row(2, 0, null, createdDays: 3),
            Row(3, 0, new DateOnly(2026, 4, 1)),
            Row(4, 0, null, createdDays: 1),
        }.AsQueryable();

        Ids(rows, TaskQueueRules.SortDue).ShouldBe([4, 2, 3, 1]);
        Ids(rows, TaskQueueRules.SortDue, descending: true).ShouldBe([1, 3, 4, 2]);
    }

    [Fact]
    public void Sorting_by_status_follows_the_lifecycle_order()
    {
        var rows = new[]
        {
            Row(1, 0, null, status: TaskStatusCode.Cancelled),
            Row(2, 0, null, status: TaskStatusCode.New),
            Row(3, 0, null, status: TaskStatusCode.Completed),
            Row(4, 0, null, status: TaskStatusCode.OnHold),
            Row(5, 0, null, status: TaskStatusCode.InProgress),
        }.AsQueryable();

        Ids(rows, TaskQueueRules.SortStatus).ShouldBe([2, 5, 4, 3, 1]);
        Ids(rows, TaskQueueRules.SortStatus, descending: true).ShouldBe([1, 3, 4, 5, 2]);
    }

    [Fact]
    public void Created_number_and_completed_sorts()
    {
        var rows = new[] { Row(10, 0, null, createdDays: 2), Row(11, 0, null, createdDays: 1), Row(12, 0, null, createdDays: 3) }.AsQueryable();
        Ids(rows, TaskQueueRules.SortCreated, descending: false).ShouldBe([11, 10, 12]);
        Ids(rows, TaskQueueRules.SortCreated, descending: true).ShouldBe([12, 10, 11]);
        Ids(rows, TaskQueueRules.SortNumber).ShouldBe([10, 11, 12]);
        Ids(rows, TaskQueueRules.SortNumber, descending: true).ShouldBe([12, 11, 10]);
        Ids(rows, TaskQueueRules.SortCompleted, descending: true).ShouldBe([12, 10, 11]);
    }

    [Theory]
    [InlineData("created", true)]
    [InlineData("completed", true)]
    [InlineData("default", false)]
    [InlineData("due", false)]
    [InlineData("number", false)]
    public void Newest_first_is_the_default_direction_of_created_and_completed(string sort, bool descending) =>
        TaskQueueRules.DefaultsToDescending(sort).ShouldBe(descending);
}
