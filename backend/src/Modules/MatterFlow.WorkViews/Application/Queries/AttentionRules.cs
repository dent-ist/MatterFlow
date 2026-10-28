using System.Linq.Expressions;
using MatterFlow.Configuration.Domain;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// "Needs my attention" as one set (epic #893, issue #905): an open task that is overdue, at risk, due today, unassigned with a due date within
/// <see cref="UnassignedWindowDays"/> days, or on hold for more than <see cref="MyMattersRules.StuckOnHoldDays"/> days. The Task Queue's
/// <c>needsAttention=true</c> and the Overview's "View all N" use this one definition, so the count and the list it opens always agree.
/// The five parts are also the ranking of the Overview list, most urgent first (<see cref="Reasons"/>).
/// </summary>
public static class AttentionRules
{
    /// <summary>An unassigned task counts once its due date is this close (today included); a task with no date, or a date further out, is not "attention" yet.</summary>
    public const int UnassignedWindowDays = 7;

    /// <summary>The reasons in rank order: overdue (oldest first), at risk, due today, unassigned with a near date, on hold too long.</summary>
    public static readonly IReadOnlyList<string> Reasons = ["overdue", "atRisk", "dueToday", "unassigned", "stuckOnHold"];

    /// <summary>At risk as a predicate (the same rule as <see cref="AtRiskRules.Where"/>).</summary>
    public static Expression<Func<WorkTask, bool>> AtRisk(DbContext db, QueueClock clock)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);
        var now = DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc);
        return And(
            t => t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress,
            MyMattersRules.Not(TaskQueueRules.Overdue(clock)),
            t => db.Set<TaskType>().Any(ty => ty.Id == t.TaskTypeId && ty.TargetDays != null && EF.Functions.DateDiffMinute(t.CreatedAtUtc, now) >= ty.TargetDays.Value * AtRiskRules.MinutesPerTargetDay));
    }

    /// <summary>Unassigned (no person) with an explicit due date today or within the window, not overdue.</summary>
    public static Expression<Func<WorkTask, bool>> UnassignedSoon(QueueClock clock) =>
        And(MyMattersRules.Unassigned, TaskQueueRules.DueWithin(clock, UnassignedWindowDays));

    /// <summary>The predicate of a reason (one of <see cref="Reasons"/>).</summary>
    public static Expression<Func<WorkTask, bool>> Of(string reason, DbContext db, QueueClock clock) => reason switch
    {
        "overdue" => TaskQueueRules.Overdue(clock),
        "atRisk" => AtRisk(db, clock),
        "dueToday" => TaskQueueRules.DueToday(clock),
        "unassigned" => UnassignedSoon(clock),
        "stuckOnHold" => MyMattersRules.StuckOnHold(clock.NowUtc),
        _ => throw new ArgumentOutOfRangeException(nameof(reason), reason, "Unknown attention reason."),
    };

    /// <summary>Any of the five reasons.</summary>
    public static Expression<Func<WorkTask, bool>> NeedsAttention(DbContext db, QueueClock clock) =>
        Or([.. Reasons.Select(r => Of(r, db, clock))]);

    public static Expression<Func<WorkTask, bool>> And(params Expression<Func<WorkTask, bool>>[] parts) => Combine(Expression.AndAlso, parts);

    public static Expression<Func<WorkTask, bool>> Or(params Expression<Func<WorkTask, bool>>[] parts) => Combine(Expression.OrElse, parts);

    private static Expression<Func<WorkTask, bool>> Combine(Func<Expression, Expression, BinaryExpression> join, Expression<Func<WorkTask, bool>>[] parts)
    {
        var parameter = Expression.Parameter(typeof(WorkTask), "t");
        var body = parts
            .Select(p => new Rebind(p.Parameters[0], parameter).Visit(p.Body)!)
            .Aggregate((left, right) => join(left, right));
        return Expression.Lambda<Func<WorkTask, bool>>(body, parameter);
    }

    private sealed class Rebind(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
