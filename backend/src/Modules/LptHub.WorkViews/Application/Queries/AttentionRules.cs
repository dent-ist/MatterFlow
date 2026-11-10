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

    /// <summary>The rank a task gets in the "attention" sort when it is none of the reasons (every task outside <see cref="NeedsAttention"/>): after all five.</summary>
    public static int NoReasonRank => Reasons.Count;

    /// <summary>
    /// A task id with the rank of its first matching reason (0 overdue, 1 at risk, 2 due today, 3 unassigned, 4 on hold too long, <see cref="NoReasonRank"/> otherwise).
    /// A task that is overdue and unassigned ranks as overdue, like the Overview's old ranked list.
    /// </summary>
    public sealed class IdRank
    {
        public long Id { get; init; }

        public int Rank { get; init; }
    }

    /// <summary>The selector that gives every task its attention rank, to be applied to the filtered tasks and joined back on the id (issue #935).</summary>
    public static Expression<Func<WorkTask, IdRank>> RankSelector(DbContext db, QueueClock clock)
    {
        var t = Expression.Parameter(typeof(WorkTask), "t");
        Expression rank = Expression.Constant(NoReasonRank);
        for (var i = Reasons.Count - 1; i >= 0; i--)
        {
            var predicate = Of(Reasons[i], db, clock);
            var test = new Rebind(predicate.Parameters[0], t).Visit(predicate.Body)!;
            rank = Expression.Condition(test, Expression.Constant(i), rank);
        }

        var body = Expression.MemberInit(
            Expression.New(typeof(IdRank)),
            Expression.Bind(typeof(IdRank).GetProperty(nameof(IdRank.Id))!, Expression.Property(t, nameof(WorkTask.Id))),
            Expression.Bind(typeof(IdRank).GetProperty(nameof(IdRank.Rank))!, rank));
        return Expression.Lambda<Func<WorkTask, IdRank>>(body, t);
    }

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
