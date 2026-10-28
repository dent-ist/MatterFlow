using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>Needs my attention (epic #893, issue #905): the five reasons that are decided without a database, and how they combine into one set.</summary>
public class AttentionRulesTests
{
    private static readonly DateTime Now = new(2026, 10, 28, 15, 0, 0, DateTimeKind.Utc);

    private static QueueClock Clock() => QueueClock.Create(Now, UserTimeZone.Resolve("UTC"));

    private static WorkTask Task(TaskStatusCode status = TaskStatusCode.New, DateOnly? due = null, int? assignee = 4, double heldDays = 0) =>
        new() { Status = status, DueDate = due, AssignedUserId = assignee, StatusChangedAtUtc = Now.AddDays(-heldDays) };

    private static DateOnly InDays(int days) => DateOnly.FromDateTime(Now).AddDays(days);

    [Fact]
    public void The_reasons_are_in_rank_order_and_each_has_a_predicate()
    {
        AttentionRules.Reasons.ShouldBe(["overdue", "atRisk", "dueToday", "unassigned", "stuckOnHold"]);
        AttentionRules.UnassignedWindowDays.ShouldBe(7);
    }

    [Fact]
    public void Unassigned_counts_only_with_a_date_today_or_within_seven_days_and_not_overdue()
    {
        var soon = AttentionRules.UnassignedSoon(Clock()).Compile();
        soon(Task(due: InDays(0), assignee: null)).ShouldBeTrue();
        soon(Task(due: InDays(7), assignee: null)).ShouldBeTrue();
        soon(Task(due: InDays(8), assignee: null)).ShouldBeFalse();
        soon(Task(due: null, assignee: null)).ShouldBeFalse(); // no date: not attention yet
        soon(Task(due: InDays(-1), assignee: null)).ShouldBeFalse(); // overdue: that is its own (more urgent) reason
        soon(Task(due: InDays(2), assignee: 4)).ShouldBeFalse();
        soon(Task(TaskStatusCode.Completed, InDays(2), null)).ShouldBeFalse();
    }

    [Fact]
    public void Or_and_And_keep_each_predicate_on_the_same_task()
    {
        var clock = Clock();
        var overdueOrHeld = AttentionRules.Or(TaskQueueRules.Overdue(clock), MyMattersRules.StuckOnHold(Now)).Compile();
        overdueOrHeld(Task(due: InDays(-2))).ShouldBeTrue();
        overdueOrHeld(Task(TaskStatusCode.OnHold, heldDays: 9)).ShouldBeTrue();
        overdueOrHeld(Task(TaskStatusCode.OnHold, heldDays: 2)).ShouldBeFalse();
        overdueOrHeld(Task(due: InDays(3))).ShouldBeFalse();

        var overdueAndUnassigned = AttentionRules.And(TaskQueueRules.Overdue(clock), MyMattersRules.Unassigned).Compile();
        overdueAndUnassigned(Task(due: InDays(-2), assignee: null)).ShouldBeTrue();
        overdueAndUnassigned(Task(due: InDays(-2), assignee: 4)).ShouldBeFalse();
        overdueAndUnassigned(Task(due: InDays(1), assignee: null)).ShouldBeFalse();
    }

    [Fact]
    public void A_reason_that_does_not_exist_is_refused()
    {
        Should.Throw<ArgumentOutOfRangeException>(() => AttentionRules.Of("nonsense", null!, Clock()));
    }
}
