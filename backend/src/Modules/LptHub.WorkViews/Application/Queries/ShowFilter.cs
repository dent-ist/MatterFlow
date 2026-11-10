using System.Linq.Expressions;
using MatterFlow.Configuration.Domain;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The "Show" filter of the new My Matters Overview (UI-04, #957; docs/ux/ui-update/api-contract.md section 4): what needs attention, independent of where the work is in the workflow
/// (the Status chips). The owner's definitions: <b>Overdue</b> = a New or In Progress task whose due date is before today (On Hold is never overdue; "Delayed" is merged into Overdue); <b>At risk</b> = the existing
/// At risk rule; <b>Due in 7 days</b> = New or In Progress, due today up to seven days ahead; <b>Critical</b> = priority labelled Critical (no stored weights); <b>Unassigned</b> = no person assigned. Overdue, At risk and
/// Due in 7 days only ever match New and In Progress; Critical and Unassigned match any status. The older <c>overdue</c>, <c>atRisk</c> and <c>dueWithin</c> parameters keep their own meaning for the other screens.
/// </summary>
public static class ShowFilter
{
    public const string Overdue = "overdue";
    public const string Risk = "risk";
    public const string Due7 = "due7";
    public const string Critical = "critical";
    public const string Unassigned = "unassigned";

    /// <summary>The priority label that means Critical (the seeded priority set; matched without regard to case).</summary>
    public const string CriticalLabel = "Critical";

    public static readonly IReadOnlyList<string> All = [Overdue, Risk, Due7, Critical, Unassigned];

    /// <summary>New or In Progress: the statuses in which a task can be overdue, at risk or due soon.</summary>
    public static Expression<Func<WorkTask, bool>> Active { get; } = t => t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress;

    /// <summary>The Overdue show rule as one expression (for conditional counts): New or In Progress and past due.</summary>
    public static Expression<Func<WorkTask, bool>> OverdueNow(QueueClock clock)
    {
        var overdue = TaskQueueRules.Overdue(clock);
        var parameter = Active.Parameters[0];
        var body = new Replace(overdue.Parameters[0], parameter).Visit(overdue.Body);
        return Expression.Lambda<Func<WorkTask, bool>>(Expression.AndAlso(Active.Body, body), parameter);
    }

    private sealed class Replace(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }

    public static IQueryable<WorkTask> Apply(IQueryable<WorkTask> rows, string show, DbContext db, QueueClock clock) => show switch
    {
        Overdue => rows.Where(Active).Where(TaskQueueRules.Overdue(clock)),
        Risk => rows.Where(Active).Where(AttentionRules.AtRisk(db, clock)),
        Due7 => rows.Where(Active).Where(TaskQueueRules.DueWithin(clock, 7)),
        Critical => rows.Where(t => db.Set<Priority>().Where(p => p.Label.ToLower() == CriticalLabel.ToLower()).Select(p => p.Id).Contains(t.PriorityId)),
        Unassigned => rows.Where(t => t.AssignedUserId == null),
        _ => rows,
    };
}
