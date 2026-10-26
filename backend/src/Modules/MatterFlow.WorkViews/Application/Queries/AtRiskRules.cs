using MatterFlow.Configuration.Domain;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The At risk rule (PM v2, #878 and #855): an open task (New or In Progress; On Hold is not at risk, its aging is shown instead) that is <b>not yet overdue</b>,
/// whose Task Type has a target turnaround, and that has used at least <see cref="Fraction"/> of the target (calendar days) since it was created:
/// <c>now &gt;= CreatedAt + 0.8 * TargetDays</c>. The 80 percent is a constant, not a setting (owner decision). It never changes a status or sends mail.
/// </summary>
public static class AtRiskRules
{
    /// <summary>The share of the target turnaround after which an open task is at risk.</summary>
    public const double Fraction = 0.8;


    /// <summary>The rule for a loaded row. <paramref name="overdue"/> is the one overdue rule (<see cref="TaskQueueRules.IsOverdue"/>).</summary>
    public static bool IsAtRisk(TaskStatusCode status, bool overdue, DateTime createdAtUtc, int? targetDays, DateTime nowUtc) =>
        targetDays is { } days
        && status is TaskStatusCode.New or TaskStatusCode.InProgress
        && !overdue
        && (DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc) - DateTime.SpecifyKind(createdAtUtc, DateTimeKind.Utc)).TotalMinutes >= days * MinutesPerTargetDay;

    /// <summary>Minutes of the target turnaround that make a task at risk: 80 percent of a day (1,440 minutes) per target day.</summary>
    public const int MinutesPerTargetDay = 1152;

    /// <summary>
    /// The same rule as a query step: open (New or In Progress), not overdue (the queue's own definition, <see cref="TaskQueueRules.Overdue"/>), and the elapsed minutes since
    /// creation at least <see cref="MinutesPerTargetDay"/> times the type's target days. The target is read from the Task Type in the same statement, so the Task Queue filter
    /// <c>atRisk=true</c>, the strip count and the Breakdown all use this one definition.
    /// </summary>
    public static IQueryable<WorkTask> Where(IQueryable<WorkTask> tasks, DbContext db, QueueClock clock)
    {
        ArgumentNullException.ThrowIfNull(tasks);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);
        var now = DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc);
        return tasks
            .Where(t => t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress)
            .Where(MyMattersRules.Not(TaskQueueRules.Overdue(clock)))
            .Where(t => db.Set<TaskType>().Any(ty => ty.Id == t.TaskTypeId && ty.TargetDays != null && EF.Functions.DateDiffMinute(t.CreatedAtUtc, now) >= ty.TargetDays.Value * MinutesPerTargetDay));
    }
}
