using MatterFlow.SharedKernel.Time;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>
/// A Task's due value (addendum M): none (ASAP), a floating date, or a date with an absolute instant. Delegates the overdue and sort
/// semantics to <see cref="DueDates"/>.
/// </summary>
public readonly record struct TaskDue
{
    private TaskDue(DateOnly? date, DateTime? atUtc)
    {
        Date = date;
        AtUtc = atUtc;
    }

    public static TaskDue Asap => default;

    public DateOnly? Date { get; }

    public DateTime? AtUtc { get; }

    public bool IsAsap => Date is null;

    public static TaskDue OnDate(DateOnly date) => new(date, null);

    /// <summary>A timed due; <paramref name="date"/> is the calendar date the user picked.</summary>
    public static TaskDue At(DateOnly date, DateTime instantUtc) => new(date, DateTime.SpecifyKind(instantUtc, DateTimeKind.Utc));

    /// <summary>Rebuilds from stored columns; a time without a date is invalid.</summary>
    public static TaskDue FromStored(DateOnly? date, DateTime? atUtc)
    {
        if (date is null && atUtc is not null)
            throw new ArgumentException("A due time requires a due date.", nameof(atUtc));
        return new TaskDue(date, atUtc is { } t ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : null);
    }

    public bool IsOverdue(DateTime nowUtc, TimeZoneInfo viewerZone) => DueDates.IsOverdue(Date, AtUtc, nowUtc, viewerZone);

    /// <summary>Overdue only while the Task is open (NEW, IN_PROGRESS, ON_HOLD).</summary>
    public bool IsOverdue(TaskStatusCode status, DateTime nowUtc, TimeZoneInfo viewerZone) =>
        status.IsOpen() && IsOverdue(nowUtc, viewerZone);

    /// <summary>The stored sort key; null for ASAP (sorted first).</summary>
    public DateTime? DueSortKey => DueDates.SortKey(Date, AtUtc);
}
