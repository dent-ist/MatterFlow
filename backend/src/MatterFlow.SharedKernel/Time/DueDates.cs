namespace MatterFlow.SharedKernel.Time;

/// <summary>
/// Due-date semantics (addendum M). A due value is one of:
/// <list type="bullet">
/// <item>null / null: ASAP, never overdue.</item>
/// <item><c>dueDate</c> only: a floating calendar date, overdue after 23:59:59 on that date in the viewer's zone.</item>
/// <item><c>dueAtUtc</c> (with its <c>dueDate</c>): an absolute instant, overdue once now is past it, for every viewer alike.</item>
/// </list>
/// </summary>
public static class DueDates
{
    public static bool IsOverdue(DateOnly? dueDate, DateTime? dueAtUtc, DateTime nowUtc, TimeZoneInfo viewerZone)
    {
        if (dueAtUtc is { } instant)
            return nowUtc > DateTime.SpecifyKind(instant, DateTimeKind.Utc);

        if (dueDate is not { } date)
            return false;

        // The date is over once the viewer's local calendar day has moved past it. Converting "now" (not the date)
        // keeps this correct across DST changes, where a local day can be 23 or 25 hours long.
        var localNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc), viewerZone);
        return DateOnly.FromDateTime(localNow) > date;
    }

    /// <summary>
    /// The stored approximate sort key: the instant when a time is set, otherwise the date at 23:59:59.9999999 treated as UTC.
    /// Null for ASAP (the caller sorts ASAP first).
    /// </summary>
    public static DateTime? SortKey(DateOnly? dueDate, DateTime? dueAtUtc)
    {
        if (dueAtUtc is { } instant)
            return DateTime.SpecifyKind(instant, DateTimeKind.Utc);
        if (dueDate is not { } date)
            return null;
        return DateTime.SpecifyKind(date.ToDateTime(TimeOnly.MaxValue), DateTimeKind.Utc);
    }
}
