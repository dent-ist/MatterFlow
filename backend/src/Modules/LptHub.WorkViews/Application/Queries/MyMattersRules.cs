using System.Linq.Expressions;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The pure rules of My Matters (owner decisions, epic #667): the health flag, the hold threshold and the workflow percentage. The predicates are
/// expression trees on top of <see cref="TaskQueueRules"/> so the counts agree with the Task Queue that the links open.
/// </summary>
public static class MyMattersRules
{
    /// <summary>On hold for longer than this many days is "stuck" (owner decision: one fixed number, 7).</summary>
    public const int StuckOnHoldDays = 7;

    /// <summary>The Amber window: an open task due within this many days (today included).</summary>
    public const int AmberDueDays = 3;

    /// <summary>The "due this week" window of the workload view: an open, not overdue task due within this many days (the strip's "due in 7 days").</summary>
    public const int DueWeekDays = 7;

    public const string FlagRed = "RED";
    public const string FlagAmber = "AMBER";
    public const string FlagGreen = "GREEN";

    public const string ReasonOverdue = "OVERDUE";
    public const string ReasonUnassigned = "UNASSIGNED";
    public const string ReasonDueSoon = "DUE_SOON";
    public const string ReasonLongHold = "LONG_HOLD";
    public const string ReasonNoOpenTasks = "NO_OPEN_TASKS";

    /// <summary>The instant before which a task that went on hold is "stuck".</summary>
    public static DateTime StuckBefore(DateTime nowUtc) => DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc).AddDays(-StuckOnHoldDays);

    /// <summary>On hold since before <see cref="StuckBefore"/>.</summary>
    public static Expression<Func<WorkTask, bool>> StuckOnHold(DateTime nowUtc)
    {
        var cutoff = StuckBefore(nowUtc);
        return t => t.Status == TaskStatusCode.OnHold && t.StatusChangedAtUtc < cutoff;
    }

    /// <summary>Open with no person assigned (a pod may be set); the Task Queue's <c>unassigned=true</c>.</summary>
    public static Expression<Func<WorkTask, bool>> Unassigned { get; } =
        t => t.AssignedUserId == null && (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold);

    /// <summary>On hold (open by definition).</summary>
    public static Expression<Func<WorkTask, bool>> OnHold { get; } = t => t.Status == TaskStatusCode.OnHold;

    /// <summary>The negation of a predicate.</summary>
    public static Expression<Func<WorkTask, bool>> Not(Expression<Func<WorkTask, bool>> predicate)
    {
        ArgumentNullException.ThrowIfNull(predicate);
        return Expression.Lambda<Func<WorkTask, bool>>(Expression.Not(predicate.Body), predicate.Parameters);
    }

    /// <summary>
    /// The one documented flag rule: <b>Red</b> = at least one open overdue task. <b>Amber</b> = no overdue task, but an open task is unassigned, or due
    /// within <see cref="AmberDueDays"/> days, or on hold longer than <see cref="StuckOnHoldDays"/> days. <b>Green</b> = none of those (a matter with no open
    /// task is Green with the reason <see cref="ReasonNoOpenTasks"/>). Who manages the matter, or whether anybody does, never enters the flag. The reasons
    /// list every branch that applies, most severe first.
    /// </summary>
    public static (string Flag, IReadOnlyList<string> Reasons) Flag(int open, int overdue, int unassigned, int dueSoon, int stuckOnHold)
    {
        if (open == 0)
            return (FlagGreen, [ReasonNoOpenTasks]);

        List<string> reasons = [];
        if (overdue > 0)
            reasons.Add(ReasonOverdue);
        if (unassigned > 0)
            reasons.Add(ReasonUnassigned);
        if (dueSoon > 0)
            reasons.Add(ReasonDueSoon);
        if (stuckOnHold > 0)
            reasons.Add(ReasonLongHold);

        var flag = overdue > 0 ? FlagRed : reasons.Count > 0 ? FlagAmber : FlagGreen;
        return (flag, reasons);
    }

    /// <summary>Whole days since an instant, never negative.</summary>
    public static int WholeDaysSince(DateTime sinceUtc, DateTime nowUtc) =>
        Math.Max(0, (int)Math.Floor((DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc) - DateTime.SpecifyKind(sinceUtc, DateTimeKind.Utc)).TotalDays));
}
