namespace MatterFlow.SharedKernel.Time;

/// <summary>
/// The viewer's time zone for the current request (addendum M). Resolved from the <c>X-Time-Zone</c> header
/// (IANA id) and falling back to the firm default (<c>Firm:TimeZoneId</c>, America/New_York).
/// </summary>
public interface IUserTimeZone
{
    /// <summary>IANA id of the effective zone.</summary>
    string Id { get; }

    TimeZoneInfo Zone { get; }

    /// <summary>True when the zone came from a valid request header rather than the firm fallback.</summary>
    bool IsFromRequest { get; }

    /// <summary>Converts a UTC instant to the viewer's local date/time.</summary>
    DateTime ToLocal(DateTime utc);

    /// <summary>Converts a local date/time in the viewer's zone to UTC (used when a user enters a due time).</summary>
    DateTime ToUtc(DateTime local);

    /// <summary>Short display label for an instant, e.g. "EDT", "CST", or "UTC+05:30" when no common abbreviation exists.</summary>
    string Abbreviation(DateTime utc);

    /// <summary>Overdue test for a Task due value in this zone using the given current instant.</summary>
    bool IsOverdue(DateOnly? dueDate, DateTime? dueAtUtc, DateTime nowUtc);
}

/// <summary>Immutable <see cref="IUserTimeZone"/>.</summary>
public sealed class UserTimeZone : IUserTimeZone
{
    public const string DefaultFirmZoneId = "America/New_York";

    public UserTimeZone(string id, TimeZoneInfo zone, bool isFromRequest)
    {
        Id = id;
        Zone = zone;
        IsFromRequest = isFromRequest;
    }

    public string Id { get; }

    public TimeZoneInfo Zone { get; }

    public bool IsFromRequest { get; }

    /// <summary>
    /// Resolves the effective zone. <paramref name="requested"/> is the raw header value; if absent, malformed or unknown
    /// the <paramref name="fallbackId"/> is used (and, if that too is invalid, America/New_York, then UTC).
    /// </summary>
    public static UserTimeZone Resolve(string? requested, string? fallbackId = DefaultFirmZoneId)
    {
        if (TryFind(requested, out var zone, out var id))
            return new UserTimeZone(id, zone, true);

        if (TryFind(fallbackId, out zone, out id))
            return new UserTimeZone(id, zone, false);

        if (TryFind(DefaultFirmZoneId, out zone, out id))
            return new UserTimeZone(id, zone, false);

        return new UserTimeZone("UTC", TimeZoneInfo.Utc, false);
    }

    /// <summary>Validates an IANA id (the only accepted form; Windows ids, offsets and abbreviations are rejected).</summary>
    public static bool IsValidIanaId(string? id) => TryFind(id, out _, out _);

    public DateTime ToLocal(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Zone);

    public DateTime ToUtc(DateTime local)
    {
        var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        if (Zone.IsInvalidTime(unspecified))
        {
            // Spring-forward gap: the wall-clock time does not exist; move to the first valid instant after the gap.
            unspecified = unspecified.AddHours(1);
        }

        return TimeZoneInfo.ConvertTimeToUtc(unspecified, Zone);
    }

    public string Abbreviation(DateTime utc)
    {
        var local = ToLocal(utc);
        var dst = Zone.IsDaylightSavingTime(local);
        return Abbreviations.For(Id, Zone.GetUtcOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)), dst);
    }

    public bool IsOverdue(DateOnly? dueDate, DateTime? dueAtUtc, DateTime nowUtc) =>
        DueDates.IsOverdue(dueDate, dueAtUtc, nowUtc, Zone);

    private static bool TryFind(string? candidate, out TimeZoneInfo zone, out string id)
    {
        zone = TimeZoneInfo.Utc;
        id = string.Empty;
        var trimmed = candidate?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > 64)
            return false;

        // IANA ids are Area/Location or a few bare names (UTC). Reject anything else so Windows ids/offsets are not accepted.
        if (!trimmed.All(c => char.IsAsciiLetterOrDigit(c) || c is '/' or '_' or '-' or '+'))
            return false;
        if (!trimmed.Contains('/') && !string.Equals(trimmed, "UTC", StringComparison.OrdinalIgnoreCase))
            return false;

        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(trimmed);
            id = zone.HasIanaId ? zone.Id : trimmed;
            return true;
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return false;
        }
    }
}

internal static class Abbreviations
{
    // .NET exposes no portable abbreviations, so cover the US zones the firm's technicians work in.
    private static readonly Dictionary<string, (string Standard, string Daylight)> Us = new(StringComparer.Ordinal)
    {
        ["America/New_York"] = ("EST", "EDT"),
        ["America/Detroit"] = ("EST", "EDT"),
        ["America/Chicago"] = ("CST", "CDT"),
        ["America/Denver"] = ("MST", "MDT"),
        ["America/Phoenix"] = ("MST", "MST"),
        ["America/Los_Angeles"] = ("PST", "PDT"),
        ["America/Anchorage"] = ("AKST", "AKDT"),
        ["Pacific/Honolulu"] = ("HST", "HST"),
        ["UTC"] = ("UTC", "UTC"),
    };

    public static string For(string ianaId, TimeSpan offset, bool daylight)
    {
        if (Us.TryGetValue(ianaId, out var pair))
            return daylight ? pair.Daylight : pair.Standard;

        var sign = offset < TimeSpan.Zero ? '-' : '+';
        var abs = offset.Duration();
        return $"UTC{sign}{abs.Hours:00}:{abs.Minutes:00}";
    }
}
