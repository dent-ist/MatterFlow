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

    public DateTime? DueAtUtc { get; init; }

    public DateTime? DueSortKey { get; init; }

    public DateTime CreatedAtUtc { get; init; }

    public DateTime StatusChangedAtUtc { get; init; }

    /// <summary>Last update; null for a Task nobody has changed since it was created.</summary>
    public DateTime? ModifiedAtUtc { get; init; }

    /// <summary>The Title in an accent- and case-insensitive collation (set by the query; the plain Title in tests), so the sort ignores both.</summary>
    public string TitleKey { get; init; } = string.Empty;

    /// <summary>The Matter reference (zero-padded by its generator, so the text order is the numeric order).</summary>
    public string MatterRef { get; init; } = string.Empty;

    /// <summary>The Matter name in the accent- and case-insensitive collation (the plain name in tests).</summary>
    public string MatterNameKey { get; init; } = string.Empty;

    /// <summary>The assignee's display name in the accent- and case-insensitive collation; null for a Task with no individual assignee.</summary>
    public string? AssigneeKey { get; init; }

    /// <summary>The client name in the accent- and case-insensitive collation (the plain name in tests).</summary>
    public string ClientKey { get; init; } = string.Empty;
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
    public const string SortClosed = "closed";
    public const string SortTitle = "title";
    public const string SortMatter = "matter";
    public const string SortUpdated = "updated";
    public const string SortAge = "age";
    public const string SortAssignee = "assignee";
    public const string SortClient = "client";
    /// <summary>On hold since (project managers' oldest hold first): Tasks that are On Hold by the time they went on hold, all other Tasks after them (epic #667).</summary>
    public const string SortOnHoldSince = "onHoldSince";
    public const string SortMatterName = "matterName";
    /// <summary>Priority (most urgent first), then oldest first; ignores due dates (the Dashboard's unassigned queue).</summary>
    public const string SortPriorityAge = "priorityAge";

    /// <summary>
    /// The default order of My Work's "Due soon and overdue" tab (overdue first, then due moment, then priority). A default only: it is not in
    /// <see cref="SortFields"/>, so a request cannot name it.
    /// </summary>
    public const string SortDueSoonDefault = "dueSoonDefault";

    /// <summary>
    /// Due soon: an explicit due date today or within this many days. ASAP has no date, so it is never due soon. The Dashboard's "Due soon" is
    /// this window without the overdue tasks; My Work's "Due soon and overdue" tab is this window with them (BUG-13).
    /// </summary>
    public const int DueSoonDays = 2;

    public static readonly IReadOnlyList<string> SortFields = [SortDefault, SortPriority, SortDue, SortCreated, SortNumber, SortStatus, SortCompleted, SortPriorityAge, SortClosed, SortTitle, SortMatter, SortUpdated, SortAge, SortAssignee, SortClient, SortMatterName, SortOnHoldSince];

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

    /// <summary>
    /// The Dashboard's "Due soon": open, an explicit due date today or within <see cref="DueSoonDays"/> days, and not overdue. It is
    /// <see cref="DueSoon"/> without <see cref="Overdue"/>, so Overdue + Due soon on the Dashboard equals My Work's "Due soon and overdue" (BUG-13);
    /// a unit test and an integration test hold the two together.
    /// </summary>
    public static Expression<Func<WorkTask, bool>> DueSoonExcludingOverdue(QueueClock clock) => DueWithin(clock, DueSoonDays);

    /// <summary>
    /// Open with an explicit due date today or within <paramref name="days"/> days and not overdue (the Task Queue's <c>dueWithin=3|7</c>, My Matters'
    /// "due in 3 / 7 days"). <see cref="DueSoonExcludingOverdue"/> is this with <see cref="DueSoonDays"/>: there is one definition of overdue.
    /// </summary>
    public static Expression<Func<WorkTask, bool>> DueWithin(QueueClock clock, int days)
    {
        ArgumentNullException.ThrowIfNull(clock);
        var now = clock.NowUtc;
        var today = clock.Today;
        var lastDay = today.AddDays(days);
        return t =>
            (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold)
            && t.DueDate != null
            && t.DueDate <= lastDay
            && !((t.DueAtUtc != null && t.DueAtUtc < now) || (t.DueAtUtc == null && t.DueDate < today));
    }

    /// <summary>Open, due on the viewer's local date and not yet overdue (a timed task already past is Overdue, not due today). The grid's dueFrom=dueTo=today with overdue=false.</summary>
    public static Expression<Func<WorkTask, bool>> DueToday(QueueClock clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        var now = clock.NowUtc;
        var today = clock.Today;
        return t =>
            (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold)
            && t.DueDate == today
            && !(t.DueAtUtc != null && t.DueAtUtc < now);
    }

    /// <summary>Open with no due date (ASAP); never overdue, never due today.</summary>
    public static Expression<Func<WorkTask, bool>> Asap { get; } =
        t => (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold) && t.DueDate == null;

    /// <summary>
    /// Assigned (or, for a Task never assigned, created) strictly after <paramref name="since"/>: the "New" of My Work. The same test the client
    /// applies to a row, so the strip count, the filtered grid total and the markers always agree.
    /// </summary>
    public static Expression<Func<WorkTask, bool>> AssignedAfter(DateTime since)
    {
        var from = DateTime.SpecifyKind(since, DateTimeKind.Utc);
        return t => (t.AssignedAtUtc ?? t.CreatedAtUtc) > from;
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
    public static bool DefaultsToDescending(string sort) => sort is SortCreated or SortCompleted or SortClosed or SortUpdated;

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
            case SortPriorityAge:
                return rows.OrderBy(r => r.PrioritySortOrder).ThenBy(r => r.CreatedAtUtc).ThenBy(r => r.Id);
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
            case SortOnHoldSince:
                // Tasks that are On Hold first, ordered by when they went on hold (oldest first when ascending); every other Task after them, in the default order.
                return descending
                    ? rows.OrderBy(r => r.Status == TaskStatusCode.OnHold ? 0 : 1).ThenByDescending(r => r.StatusChangedAtUtc).ThenByDescending(r => r.Id)
                    : rows.OrderBy(r => r.Status == TaskStatusCode.OnHold ? 0 : 1).ThenBy(r => r.StatusChangedAtUtc).ThenBy(r => r.Id);
            case SortCreated:
                return descending ? rows.OrderByDescending(r => r.CreatedAtUtc).ThenByDescending(r => r.Id) : rows.OrderBy(r => r.CreatedAtUtc).ThenBy(r => r.Id);
            case SortNumber:
                return descending ? rows.OrderByDescending(r => r.Id) : rows.OrderBy(r => r.Id);
            case SortCompleted:
            case SortClosed:
                // The closed instant is the last status change of a Completed or Cancelled Task; open Tasks have none and come last in either direction.
                return descending
                    ? rows.OrderBy(r => r.Status == TaskStatusCode.Completed || r.Status == TaskStatusCode.Cancelled ? 0 : 1).ThenByDescending(r => r.StatusChangedAtUtc).ThenByDescending(r => r.Id)
                    : rows.OrderBy(r => r.Status == TaskStatusCode.Completed || r.Status == TaskStatusCode.Cancelled ? 0 : 1).ThenBy(r => r.StatusChangedAtUtc).ThenBy(r => r.Id);
            case SortTitle:
                return descending ? rows.OrderByDescending(r => r.TitleKey).ThenByDescending(r => r.Id) : rows.OrderBy(r => r.TitleKey).ThenBy(r => r.Id);
            case SortMatter:
                return descending ? rows.OrderByDescending(r => r.MatterRef).ThenByDescending(r => r.Id) : rows.OrderBy(r => r.MatterRef).ThenBy(r => r.Id);
            case SortMatterName:
                return descending
                    ? rows.OrderByDescending(r => r.MatterNameKey).ThenByDescending(r => r.MatterRef).ThenByDescending(r => r.Id)
                    : rows.OrderBy(r => r.MatterNameKey).ThenBy(r => r.MatterRef).ThenBy(r => r.Id);
            case SortUpdated:
                // Never-updated Tasks come last in either direction.
                return descending
                    ? rows.OrderBy(r => r.ModifiedAtUtc == null ? 1 : 0).ThenByDescending(r => r.ModifiedAtUtc).ThenByDescending(r => r.Id)
                    : rows.OrderBy(r => r.ModifiedAtUtc == null ? 1 : 0).ThenBy(r => r.ModifiedAtUtc).ThenBy(r => r.Id);
            case SortAge:
                // Age ascending is the youngest first: the inverse of Created, so the arrow means what it says.
                return descending ? rows.OrderBy(r => r.CreatedAtUtc).ThenBy(r => r.Id) : rows.OrderByDescending(r => r.CreatedAtUtc).ThenByDescending(r => r.Id);
            case SortAssignee:
                // Unassigned Tasks come last in either direction; ties fall back to the unique task id.
                return descending
                    ? rows.OrderBy(r => r.AssigneeKey == null ? 1 : 0).ThenByDescending(r => r.AssigneeKey).ThenByDescending(r => r.Id)
                    : rows.OrderBy(r => r.AssigneeKey == null ? 1 : 0).ThenBy(r => r.AssigneeKey).ThenBy(r => r.Id);
            case SortClient:
                return descending
                    ? rows.OrderByDescending(r => r.ClientKey).ThenByDescending(r => r.MatterRef).ThenByDescending(r => r.Id)
                    : rows.OrderBy(r => r.ClientKey).ThenBy(r => r.MatterRef).ThenBy(r => r.Id);
            default:
                return WithDefaultTail(rows.OrderBy(r => r.PrioritySortOrder));
        }
    }

    /// <summary>
    /// Overdue first (oldest due moment first), then the due moment ascending, then priority (most urgent first), then oldest created, then id.
    /// The overdue test is the viewer's, like <see cref="Overdue"/>, so the two always agree.
    /// </summary>
    public static IOrderedQueryable<TaskSortRow> OrderDueSoon(IQueryable<TaskSortRow> rows, QueueClock clock)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(clock);
        var now = clock.NowUtc;
        var today = clock.Today;
        return rows
            .OrderBy(r => (r.DueAtUtc != null && r.DueAtUtc < now) || (r.DueAtUtc == null && r.DueDate != null && r.DueDate < today) ? 0 : 1)
            .ThenBy(r => r.DueSortKey == null ? 1 : 0)
            .ThenBy(r => r.DueSortKey)
            .ThenBy(r => r.PrioritySortOrder)
            .ThenBy(r => r.CreatedAtUtc)
            .ThenBy(r => r.Id);
    }

    /// <summary>The due buckets of "Group by: Due" (M12.1), in display order: 0 ASAP, 1 Overdue, 2 Today, 3 Tomorrow, 4 This week, 5 Later.</summary>
    public const int BucketAsap = 0;
    public const int BucketOverdue = 1;
    public const int BucketToday = 2;
    public const int BucketTomorrow = 3;
    public const int BucketThisWeek = 4;
    public const int BucketLater = 5;

    /// <summary>The last day (Sunday) of the viewer's current week; weeks start on Monday.</summary>
    public static DateOnly EndOfWeek(DateOnly today) => today.AddDays(6 - (((int)today.DayOfWeek + 6) % 7));

    /// <summary>
    /// The due bucket of an open Task for this viewer. ASAP has no due date; Overdue is the <see cref="Overdue"/> test; Today is the viewer's date
    /// (a timed due already past is Overdue); Tomorrow is the next date; This week is the rest of the Monday-to-Sunday week after tomorrow (empty
    /// on a Saturday or Sunday); Later is everything after. The buckets partition the open set, so Overdue, Today and ASAP equal the strip counts.
    /// </summary>
    public static Expression<Func<TaskSortRow, int>> DueBucket(QueueClock clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        var now = clock.NowUtc;
        var today = clock.Today;
        var tomorrow = today.AddDays(1);
        var weekEnd = EndOfWeek(today);
        return r =>
            r.DueDate == null ? BucketAsap
            : (r.DueAtUtc != null && r.DueAtUtc < now) || (r.DueAtUtc == null && r.DueDate < today) ? BucketOverdue
            : r.DueDate <= today ? BucketToday
            : r.DueDate == tomorrow ? BucketTomorrow
            : r.DueDate <= weekEnd ? BucketThisWeek
            : BucketLater;
    }

    /// <summary>Group by due: bucket, then priority (most urgent first), then the due moment, then oldest created, then id.</summary>
    public static IOrderedQueryable<TaskSortRow> OrderByDueBucket(IQueryable<TaskSortRow> rows, QueueClock clock)
    {
        ArgumentNullException.ThrowIfNull(rows);
        return rows
            .OrderBy(DueBucket(clock))
            .ThenBy(r => r.PrioritySortOrder)
            .ThenBy(r => r.DueSortKey)
            .ThenBy(r => r.CreatedAtUtc)
            .ThenBy(r => r.Id);
    }

    /// <summary>The Task Queue's bucket for Completed and Cancelled Tasks (never overdue, never ASAP); they come last in either direction.</summary>
    public const int BucketClosed = 6;

    /// <summary>
    /// <see cref="DueBucket"/> for the Task Queue, where closed Tasks exist: they get <see cref="BucketClosed"/> (or -1 when <paramref name="descending"/>, so
    /// a descending sort of this key puts them last as well). Open Tasks keep My Work's buckets, so ASAP, Overdue and Today equal the Dashboard tiles.
    /// </summary>
    public static Expression<Func<TaskSortRow, int>> QueueDueBucket(QueueClock clock, bool descending = false)
    {
        ArgumentNullException.ThrowIfNull(clock);
        var now = clock.NowUtc;
        var today = clock.Today;
        var tomorrow = today.AddDays(1);
        var weekEnd = EndOfWeek(today);
        var closed = descending ? -1 : BucketClosed;
        return r =>
            r.Status == TaskStatusCode.Completed || r.Status == TaskStatusCode.Cancelled ? closed
            : r.DueDate == null ? BucketAsap
            : (r.DueAtUtc != null && r.DueAtUtc < now) || (r.DueAtUtc == null && r.DueDate < today) ? BucketOverdue
            : r.DueDate <= today ? BucketToday
            : r.DueDate == tomorrow ? BucketTomorrow
            : r.DueDate <= weekEnd ? BucketThisWeek
            : BucketLater;
    }

    /// <summary>
    /// Sort by Due with the bucket first: ascending is ASAP, Overdue, Today, Tomorrow, This week, Later, Closed; descending mirrors the open buckets
    /// (Later first, ASAP last) and still ends with Closed. Inside a bucket the due moment follows the direction, then oldest created, then id
    /// (so ASAP is oldest first either way, like the plain Due sort).
    /// </summary>
    public static IOrderedQueryable<TaskSortRow> OrderByDueGroups(IQueryable<TaskSortRow> rows, QueueClock clock, bool descending)
    {
        ArgumentNullException.ThrowIfNull(rows);
        return descending
            ? rows.OrderByDescending(QueueDueBucket(clock, descending: true)).ThenByDescending(r => r.DueSortKey).ThenBy(r => r.CreatedAtUtc).ThenBy(r => r.Id)
            : rows.OrderBy(QueueDueBucket(clock)).ThenBy(r => r.DueSortKey).ThenBy(r => r.CreatedAtUtc).ThenBy(r => r.Id);
    }

    private static IOrderedQueryable<TaskSortRow> WithDefaultTail(IOrderedQueryable<TaskSortRow> ordered) =>
        ordered.ThenBy(r => r.DueSortKey == null ? 0 : 1).ThenBy(r => r.DueSortKey).ThenBy(r => r.CreatedAtUtc).ThenBy(r => r.Id);

    private sealed class ParameterReplacer(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}
