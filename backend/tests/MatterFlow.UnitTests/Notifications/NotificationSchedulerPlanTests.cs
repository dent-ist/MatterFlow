using MatterFlow.Notifications.Contracts;
using MatterFlow.Notifications.Infrastructure.Scheduling;
using MatterFlow.SharedKernel.Time;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Shouldly;

namespace MatterFlow.UnitTests.Notifications;

/// <summary>The pure parts of the scheduler (WP-NT3): which task gets which event, the thresholds in one class, the health states.</summary>
public class NotificationSchedulerPlanTests
{
    private static readonly TimeZoneInfo Firm = UserTimeZone.Resolve(null, "America/New_York").Zone;

    /// <summary>Thursday 22 Oct 2026, 10:00 in New York.</summary>
    private static readonly JobContext Context = new(new DateTime(2026, 10, 22, 14, 0, 0, DateTimeKind.Utc), Firm);

    private static DueTaskRow Due(string date, int? assignee = 7, int? primary = null, int? secondary = null, DateTime? at = null) => new()
    {
        TaskId = 42,
        TaskNumber = "TSK-42",
        Title = "Review",
        MatterId = 3,
        MatterName = "Acme v. Smith",
        AssigneeId = assignee,
        AssigneeName = assignee is null ? null : "Bo Chen",
        DueDate = DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture),
        DueAtUtc = at,
        PrimaryManagerId = primary,
        SecondaryManagerId = secondary,
    };

    [Fact]
    public void The_thresholds_live_in_one_class()
    {
        NotificationRules.UnassignedDays.ShouldBe(2);
        NotificationRules.OnHoldDays.ShouldBe(5);
        NotificationRules.ReadRetentionDays.ShouldBe(90);
        NotificationRules.UnreadRetentionDays.ShouldBe(365);
        NotificationRules.CandidateBatch.ShouldBe(500);
        NotificationRules.DeleteBatch.ShouldBe(1000);
    }

    [Fact]
    public void Today_is_the_firm_zone_calendar_day()
    {
        // 02:30 UTC on the 23rd is still the evening of the 22nd in New York.
        new JobContext(new DateTime(2026, 10, 23, 2, 30, 0, DateTimeKind.Utc), Firm).Today.ShouldBe(new DateOnly(2026, 10, 22));
    }

    [Fact]
    public void Due_today_and_tomorrow_are_soon_the_day_after_is_nothing()
    {
        TaskDueJob.Plan([Due("2026-10-22")], Context).Single().Single().Message.ShouldBe("TSK-42 \"Review\" is due today.");
        var tomorrow = TaskDueJob.Plan([Due("2026-10-23")], Context).Single().Single();
        tomorrow.Message.ShouldBe("TSK-42 \"Review\" is due tomorrow (Oct 23).");
        tomorrow.DedupeKey.ShouldBe("soon:2026-10-23");
        tomorrow.EventType.ShouldBe(NotificationEventType.TaskDue);
        tomorrow.ActorUserId.ShouldBeNull();
        TaskDueJob.Plan([Due("2026-10-24")], Context).ShouldBeEmpty();
    }

    [Fact]
    public void A_past_date_is_overdue_for_the_assignee_and_for_both_managers_once()
    {
        var plan = TaskDueJob.Plan([Due("2026-10-20", primary: 1, secondary: 2)], Context).Single();
        plan.Count.ShouldBe(2);
        plan[0].EventType.ShouldBe(NotificationEventType.TaskDue);
        plan[0].DedupeKey.ShouldBe("overdue:2026-10-20");
        plan[0].RecipientUserIds.ShouldBe([7]);
        plan[1].EventType.ShouldBe(NotificationEventType.MatterTaskOverdue);
        plan[1].DedupeKey.ShouldBe("overdue:42:2026-10-20");
        plan[1].RecipientUserIds.ShouldBe([1, 2], ignoreOrder: true);
        plan[1].Message.ShouldBe("TSK-42 \"Review\" on Acme v. Smith is overdue (due Oct 20, assigned to Bo Chen).");
    }

    [Fact]
    public void A_timed_due_is_overdue_only_after_the_moment_and_the_same_person_collapses_to_the_assignee_event()
    {
        // Due today at 11:00 New York (15:00 UTC): not yet overdue at 10:00, so "soon".
        var later = Due("2026-10-22", at: new DateTime(2026, 10, 22, 15, 0, 0, DateTimeKind.Utc));
        TaskDueJob.Plan([later], Context).Single().Single().DedupeKey.ShouldBe("soon:2026-10-22");
        // Due at 09:00 New York: overdue now although the date is today.
        var earlier = Due("2026-10-22", at: new DateTime(2026, 10, 22, 13, 0, 0, DateTimeKind.Utc));
        TaskDueJob.Plan([earlier], Context).Single().First().DedupeKey.ShouldBe("overdue:2026-10-22");

        // The manager who is also the assignee: the central rules keep one notification, the assignee event (priority 2 beats 4).
        var planned = MatterFlow.Notifications.Domain.RecipientRules.Plan(TaskDueJob.Plan([Due("2026-10-20", assignee: 7, primary: 7, secondary: 8)], Context).Single(), (_, _) => false);
        planned.Select(p => (p.RecipientUserId, p.Request.EventType)).ShouldBe([(7, NotificationEventType.TaskDue), (8, NotificationEventType.MatterTaskOverdue)]);
    }

    [Fact]
    public void An_unassigned_overdue_task_says_not_assigned_and_nobody_is_told_without_recipients()
    {
        var plan = TaskDueJob.Plan([Due("2026-10-20", assignee: null, primary: 1)], Context).Single().Single();
        plan.Message.ShouldEndWith("(due Oct 20, not assigned).");
        TaskDueJob.Plan([Due("2026-10-20", assignee: null)], Context).ShouldBeEmpty();
    }

    private static StalledTaskRow Stalled(DateTime sinceUtc, int? primary = 1, int? secondary = null) => new()
    {
        TaskId = 42,
        TaskNumber = "TSK-42",
        Title = "Review",
        MatterId = 3,
        MatterName = "Acme v. Smith",
        PrimaryManagerId = primary,
        SecondaryManagerId = secondary,
        SinceUtc = sinceUtc,
    };

    [Fact]
    public void Unassigned_counts_calendar_days_in_the_firm_zone()
    {
        // Started 20 Oct 23:30 New York (21 Oct 03:30 UTC): two calendar days have passed on the 22nd although only 34 hours have.
        var late = Stalled(new DateTime(2026, 10, 21, 3, 30, 0, DateTimeKind.Utc));
        var message = TaskStalledJob.PlanUnassigned([late], Context).Single().Single();
        message.Message.ShouldBe("TSK-42 \"Review\" on Acme v. Smith has been unassigned for 2 days.");
        message.DedupeKey.ShouldBe("unassigned:" + DateTime.SpecifyKind(late.SinceUtc, DateTimeKind.Utc).Ticks);
        message.EventType.ShouldBe(NotificationEventType.MatterTaskStalled);

        // Started the evening before yesterday in New York: only one calendar day.
        TaskStalledJob.PlanUnassigned([Stalled(new DateTime(2026, 10, 22, 3, 30, 0, DateTimeKind.Utc))], Context).ShouldBeEmpty();
    }

    [Fact]
    public void On_hold_needs_five_calendar_days_and_a_manager()
    {
        TaskStalledJob.PlanOnHold([Stalled(new DateTime(2026, 10, 18, 15, 0, 0, DateTimeKind.Utc))], Context).ShouldBeEmpty();
        var five = TaskStalledJob.PlanOnHold([Stalled(new DateTime(2026, 10, 17, 15, 0, 0, DateTimeKind.Utc), primary: 1, secondary: 2)], Context).Single().Single();
        five.Message.ShouldEndWith("has been on hold for 5 days.");
        five.DedupeKey.ShouldStartWith("hold:");
        five.RecipientUserIds.ShouldBe([1, 2], ignoreOrder: true);
        TaskStalledJob.PlanOnHold([Stalled(new DateTime(2026, 10, 1, 15, 0, 0, DateTimeKind.Utc), primary: null)], Context).ShouldBeEmpty();
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; set; } = now;
    }

    [Fact]
    public async Task Health_is_healthy_until_thirty_minutes_without_a_run_then_degraded_never_unhealthy()
    {
        var clock = new FixedClock(new DateTime(2026, 10, 22, 12, 0, 0, DateTimeKind.Utc));
        var state = new NotificationSchedulerState();
        var check = new NotificationSchedulerHealthCheck(state, Options.Create(new NotificationSchedulerOptions()), clock);
        var context = new HealthCheckContext();

        (await check.CheckHealthAsync(context)).Status.ShouldBe(HealthStatus.Healthy); // not started yet

        state.Started(clock.UtcNow);
        clock.UtcNow = clock.UtcNow.AddMinutes(29);
        (await check.CheckHealthAsync(context)).Status.ShouldBe(HealthStatus.Healthy);
        clock.UtcNow = clock.UtcNow.AddMinutes(2); // 31 minutes since the start, no run yet
        (await check.CheckHealthAsync(context)).Status.ShouldBe(HealthStatus.Degraded);

        state.Succeeded(clock.UtcNow);
        (await check.CheckHealthAsync(context)).Status.ShouldBe(HealthStatus.Healthy);
        clock.UtcNow = clock.UtcNow.AddMinutes(45);
        var stale = await check.CheckHealthAsync(context);
        stale.Status.ShouldBe(HealthStatus.Degraded);
        stale.Description!.ShouldContain("45 minutes");

        var disabled = new NotificationSchedulerHealthCheck(state, Options.Create(new NotificationSchedulerOptions { Enabled = false }), clock);
        (await disabled.CheckHealthAsync(context)).Status.ShouldBe(HealthStatus.Healthy);
    }
}
