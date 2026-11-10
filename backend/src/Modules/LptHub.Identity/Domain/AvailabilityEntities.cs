namespace LptHub.Identity.Domain;

/// <summary>
/// A user's availability profile (script 22): time zone and work hours. The Out of office columns (<c>Status</c>, the two dates and the note) of script 22 are no
/// longer read or written since script 58 (<see cref="UserAbsence"/>); a later script drops them. Not an audited entity: changes are written as semantic audit events by the service,
/// because "who changed whose availability" needs readable text rather than field diffs.
/// </summary>
public class UserAvailability
{
    public int UserId { get; set; }

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

/// <summary>
/// One Out of office entry of a person (script 58): whole calendar days in the person's zone, <see cref="EndDate"/> inclusive (null = until back). Not an
/// audited entity: every write is a semantic audit event ("Added Vacation 07/05/2027 to 07/16/2027 for Ben Carter") written by the service.
/// </summary>
public class UserAbsence
{
    public int Id { get; set; }

    public int UserId { get; set; }

    public string AbsenceType { get; set; } = "OTHER";

    public DateOnly StartDate { get; set; }

    public DateOnly? EndDate { get; set; }

    public string? Note { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    public int? CreatedByUserId { get; set; }

    public DateTime UpdatedAtUtc { get; set; }

    public int? UpdatedByUserId { get; set; }

    public byte[] RowVersion { get; set; } = [];
}
