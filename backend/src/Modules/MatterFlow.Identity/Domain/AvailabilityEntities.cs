namespace MatterFlow.Identity.Domain;

/// <summary>
/// A user's availability profile (script 22). Not an audited entity: changes are written as semantic audit events by the service,
/// because "who changed whose availability" needs readable text rather than field diffs.
/// </summary>
public class UserAvailability
{
    public int UserId { get; set; }

    public string Status { get; set; } = "AVAILABLE";

    public DateOnly? OutOfOfficeFromDate { get; set; }

    public DateOnly? OutOfOfficeUntilDate { get; set; }

    public string? Note { get; set; }

    public string? TimeZoneId { get; set; }

    public bool HasCustomWorkHours { get; set; }

    public DateTime UpdatedAtUtc { get; set; }

    public int? UpdatedByUserId { get; set; }

    public byte[] RowVersion { get; set; } = [];
}

/// <summary>One working day of a user with a custom schedule (ISO day 1 = Monday ... 7 = Sunday).</summary>
public class UserWorkHour
{
    public int UserId { get; set; }

    public int DayOfWeek { get; set; }

    public TimeOnly StartTime { get; set; }

    public TimeOnly EndTime { get; set; }
}
