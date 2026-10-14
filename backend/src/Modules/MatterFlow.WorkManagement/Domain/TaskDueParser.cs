using System.Globalization;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>Turns the due date and optional due time a user entered into a <see cref="TaskDue"/> (addendum G, M).</summary>
public static class TaskDueParser
{
    private static readonly string[] TimeFormats = ["H:mm", "HH:mm", "H:mm:ss", "HH:mm:ss"];

    /// <summary>
    /// No date means ASAP (and no time may be given). A date alone is a floating calendar date. A date with a time is an absolute instant:
    /// the time is read in the user's zone, converted with <paramref name="localToUtc"/>.
    /// </summary>
    public static Result<TaskDue> Parse(DateOnly? date, string? time, Func<DateTime, DateTime> localToUtc)
    {
        ArgumentNullException.ThrowIfNull(localToUtc);
        var hasTime = !string.IsNullOrWhiteSpace(time);
        if (date is null)
        {
            return hasTime
                ? Error.Validation("dueTime", "REQUIRES_DUE_DATE", "A due time needs a due date.")
                : TaskDue.Asap;
        }

        if (!hasTime)
            return TaskDue.OnDate(date.Value);

        if (!TimeOnly.TryParseExact(time!.Trim(), TimeFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            return Error.Validation("dueTime", "INVALID_TIME", "The due time must look like 14:30.");

        var local = date.Value.ToDateTime(parsed);
        return TaskDue.At(date.Value, localToUtc(local));
    }
}
