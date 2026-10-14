using System.Linq.Expressions;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// "Now" as the requesting user sees it (addendum M): the instant, the local calendar date and the conversion of a local date to its UTC start.
/// Built once per request so the overdue filter, the per-row flag and the counts all agree.
/// </summary>
public sealed record QueueClock(DateTime NowUtc, DateOnly Today, string ZoneId, Func<DateTime, DateTime> LocalToUtc)
{
    public static QueueClock Create(DateTime nowUtc, IUserTimeZone zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        var utc = DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc);
        return new QueueClock(utc, DateOnly.FromDateTime(zone.ToLocal(utc)), zone.Id, zone.ToUtc);
    }

    /// <summary>The instant the given local calendar day starts in the viewer's zone.</summary>
    public DateTime StartOfDayUtc(DateOnly date) => LocalToUtc(date.ToDateTime(TimeOnly.MinValue));

    /// <summary>The instant after the given local calendar day ends (exclusive upper bound); the last representable day gets the largest instant instead of overflowing (SEC2-09).</summary>
    public DateTime EndOfDayUtc(DateOnly date) => date == DateOnly.MaxValue ? DateTime.SpecifyKind(DateTime.MaxValue, DateTimeKind.Utc) : StartOfDayUtc(date.AddDays(1));
}

/// <summary>
/// One Task reduced to the columns that decide its position in the queue (joined to its Priority's sort order). Member-initialized so the
/// ordering can be composed on the SQL projection.
/// </summary>
public sealed class TaskSortRow
{
    public long Id { get; init; }

    public int PrioritySortOrder { get; init; }

    public TaskStatusCode Status { get; init; }

    public DateOnly? DueDate { get; init; }

    public DateTime? DueSortKey { get; init; }

    public DateTime CreatedAtUtc { get; init; }

    public DateTime StatusChangedAtUtc { get; init; }
}

/// <summary>
/// The pure queue rules: which Tasks are overdue or due soon for a viewer, and the sort orders. The predicates are expression trees so they run
/// in SQL, and they are checked against <see cref="DueDates"/> in unit tests so the filter and the per-row flag cannot disagree.
/// </summary>
public static class TaskQueueRules
{
    public const string SortDefault = "default";
    public const string SortPriority = "priority";
    public const string SortDue = "due";
    public const string SortCreated = "created";
    public const string SortNumber = "number";
    public const string SortStatus = "status";
    public const string SortCompleted = "completed";

    /// <summary>Due soon: an explicit due date today or within this many days (ASAP excluded, overdue included).</summary>
    public const int DueSoonDays = 2;

    public static readonly IReadOnlyList<string> SortFields = [SortDefault, SortPriority, SortDue, SortCreated, SortNumber, SortStatus, SortCompleted];

    /// <summary>NEW, IN_PROGRESS or ON_HOLD.</summary>
    public static Expression<Func<WorkTask, bool>> Open { get; } =
        t => t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold;

    /// <summary>COMPLETED or CANCELLED.</summary>
    public static Expression<Func<WorkTask, bool>> Closed { get; } =
        t => t.Status == TaskStatusCode.Completed || t.Status == TaskStatusCode.Cancelled;

    /// <summary>
    /// Open and past due for this viewer: a timed due when the instant has passed, a date-only due once the viewer's local date is later than
    /// the due date. ASAP (no date) is never overdue.
    /// </summary>
    public static Expression<Func<WorkTask, bool>> Overdue(QueueClock clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        var now = clock.NowUtc;
        var today = clock.Today;
        return t =>
            (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold)
            && ((t.DueAtUtc != null && t.DueAtUtc < now) || (t.DueAtUtc == null && t.DueDate != null && t.DueDate < today));
    }

    /// <summary>Open with an explicit due that is overdue or falls by the end of the viewer's local day <see cref="DueSoonDays"/> days ahead.</summary>
    public static Expression<Func<WorkTask, bool>> DueSoon(QueueClock clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        var lastDay = clock.Today.AddDays(DueSoonDays);
        var endUtc = clock.StartOfDayUtc(lastDay.AddDays(1));
        return t =>
            (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold)
            && t.DueDate != null
            && ((t.DueAtUtc != null && t.DueAtUtc < endUtc) || (t.DueAtUtc == null && t.DueDate <= lastDay));
    }

    /// <summary>Combines predicates with OR.</summary>
    public static Expression<Func<WorkTask, bool>> Or(Expression<Func<WorkTask, bool>> left, Expression<Func<WorkTask, bool>> right)
    {
        var parameter = left.Parameters[0];
        var rightBody = new ParameterReplacer(right.Parameters[0], parameter).Visit(right.Body);
        return Expression.Lambda<Func<WorkTask, bool>>(Expression.OrElse(left.Body, rightBody), parameter);
    }

    /// <summary>The overdue flag of a loaded row; agrees with <see cref="Overdue"/>.</summary>
    public static bool IsOverdue(TaskStatusCode status, DateOnly? dueDate, DateTime? dueAtUtc, QueueClock clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        if (!status.IsOpen())
            return false;
        if (dueAtUtc is { } instant)
            return clock.NowUtc > DateTime.SpecifyKind(instant, DateTimeKind.Utc);
        return dueDate is { } date && date < clock.Today;
    }

    /// <summary>Descending is the default direction for these sorts (newest first); everything else defaults to ascending.</summary>
    public static bool DefaultsToDescending(string sort) => sort is SortCreated or SortCompleted;

    /// <summary>
    /// Orders the rows. <c>default</c> is the queue rule of addendum G and architecture 8.4: priority order, then ASAP above explicit due dates,
    /// explicit due ascending by sort key, then oldest first (so ASAP is oldest first). <c>priority</c> and <c>status</c> keep that rule as the tie-break.
    /// The direction is ignored by <c>default</c>.
    /// </summary>
    public static IOrderedQueryable<TaskSortRow> Order(IQueryable<TaskSortRow> rows, string sort, bool descending)
    {
        ArgumentNullException.ThrowIfNull(rows);
        switch (sort)
        {
            case SortPriority:
                return WithDefaultTail(descending ? rows.OrderByDescending(r => r.PrioritySortOrder) : rows.OrderBy(r => r.PrioritySortOrder));
            case SortStatus:
                return WithDefaultTail(
                    descending
                        ? rows.OrderByDescending(r => r.Status == TaskStatusCode.New ? 0 : r.Status == TaskStatusCode.InProgress ? 1 : r.Status == TaskStatusCode.OnHold ? 2 : r.Status == TaskStatusCode.Completed ? 3 : 4)
                        : rows.OrderBy(r => r.Status == TaskStatusCode.New ? 0 : r.Status == TaskStatusCode.InProgress ? 1 : r.Status == TaskStatusCode.OnHold ? 2 : r.Status == TaskStatusCode.Completed ? 3 : 4));
            case SortDue:
                // ASAP counts as "earliest": first when ascending, last when descending.
                return descending
                    ? rows.OrderByDescending(r => r.DueSortKey == null ? 0 : 1).ThenByDescending(r => r.DueSortKey).ThenBy(r => r.CreatedAtUtc).ThenBy(r => r.Id)
                    : rows.OrderBy(r => r.DueSortKey == null ? 0 : 1).ThenBy(r => r.DueSortKey).ThenBy(r => r.CreatedAtUtc).ThenBy(r => r.Id);
            case SortCreated:
                return descending ? rows.OrderByDescending(r => r.CreatedAtUtc).ThenByDescending(r => r.Id) : rows.OrderBy(r => r.CreatedAtUtc).ThenBy(r => r.Id);
            case SortNumber:
                return descending ? rows.OrderByDescending(r => r.Id) : rows.OrderBy(r => r.Id);
            case SortCompleted:
                return descending
                    ? rows.OrderByDescending(r => r.StatusChangedAtUtc).ThenByDescending(r => r.Id)
                    : rows.OrderBy(r => r.StatusChangedAtUtc).ThenBy(r => r.Id);
            default:
                return WithDefaultTail(rows.OrderBy(r => r.PrioritySortOrder));
        }
    }

    private static IOrderedQueryable<TaskSortRow> WithDefaultTail(IOrderedQueryable<TaskSortRow> ordered) =>
        ordered.ThenBy(r => r.DueSortKey == null ? 0 : 1).ThenBy(r => r.DueSortKey).ThenBy(r => r.CreatedAtUtc).ThenBy(r => r.Id);

    private sealed class ParameterReplacer(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
