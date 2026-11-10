using System.ComponentModel.DataAnnotations;
using System.Globalization;

namespace MatterFlow.Organization.Application;

/// <summary>One of the eight fixed event types (UI-05). The code list lives in code; <c>IconKey</c> and <c>ColourKey</c> are keys of the frontend icon map and of the <c>--mf-event-*</c> design tokens.</summary>
public sealed record MatterEventTypeInfo(
    [property: Required] string Code,
    [property: Required] string Label,
    [property: Required] string IconKey,
    [property: Required] string ColourKey,
    [property: Required] int SortOrder);

/// <summary>The fixed event types, in display order.</summary>
public static class MatterEventTypes
{
    public const string CourtHearing = "COURT_HEARING";
    public const string Other = "OTHER";

    public static readonly IReadOnlyList<MatterEventTypeInfo> All =
    [
        new(CourtHearing, "Court hearing", "gavel", "court", 1),
        new("TRIAL", "Trial", "scale", "trial", 2),
        new("DEPOSITION", "Deposition", "mic", "deposition", 3),
        new("PRODUCTION_DEADLINE", "Production deadline", "file-export", "production", 4),
        new("FILING_DEADLINE", "Filing deadline", "file-check", "filing", 5),
        new("MEDIATION", "Mediation or settlement", "handshake", "mediation", 6),
        new("CLIENT_MEETING", "Client meeting or call", "users", "meeting", 7),
        new(Other, "Other", "calendar", "other", 8),
    ];

    public static MatterEventTypeInfo? Find(string? code) => All.FirstOrDefault(t => string.Equals(t.Code, code?.Trim(), StringComparison.OrdinalIgnoreCase));
}

/// <summary>A calendar item of a matter as the API returns it (docs/ux/ui-update/api-contract.md section 2.2).</summary>
/// <param name="Date">The calendar day (floating, no time zone).</param>
/// <param name="Time"><c>HH:mm</c> (24 h, floating) or null for an all-day event.</param>
/// <param name="CanEdit">True when the caller may update or delete this event: Primary or Secondary PM of the matter, or a holder of <c>Matter.Edit</c>.</param>
public sealed record MatterEventResponse(
    [property: Required] int EventId,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] int ClientId,
    [property: Required] string ClientName,
    [property: Required] bool IsSensitive,
    [property: Required] string TypeCode,
    [property: Required] string TypeLabel,
    [property: Required] string TypeIconKey,
    [property: Required] string TypeColourKey,
    [property: Required] string Title,
    [property: Required] DateOnly Date,
    string? Time,
    string? Note,
    [property: Required] bool CanEdit,
    [property: Required] DateTime CreatedAtUtc,
    string? CreatedByName,
    DateTime? ModifiedAtUtc,
    string? ModifiedByName,
    [property: Required] string RowVersion);

/// <summary>The events of a matter or of a My Matters scope in a date range.</summary>
public sealed record MatterEventList(
    [property: Required] DateOnly From,
    [property: Required] DateOnly To,
    [property: Required] int Total,
    [property: Required] IReadOnlyList<MatterEventResponse> Items);

/// <summary>Create body (and the fields of an update).</summary>
public class MatterEventRequest
{
    /// <summary>One of the eight codes of <c>GET /matter-event-types</c>.</summary>
    [Required, StringLength(30)]
    public string TypeCode { get; init; } = string.Empty;

    [Required, StringLength(200, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;

    [Required]
    public DateOnly? Date { get; init; }

    /// <summary><c>HH:mm</c> (24 h) or null for an all-day event.</summary>
    [StringLength(5)]
    public string? Time { get; init; }

    [StringLength(2000)]
    public string? Note { get; init; }
}

/// <summary>Update body: the same fields plus the <c>rowVersion</c> last read.</summary>
public sealed class UpdateMatterEventRequest : MatterEventRequest
{
    /// <summary>The <c>rowVersion</c> last read; a stale one is a 409.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>Range of a matter's event list; both optional (default: today to 90 days ahead).</summary>
public sealed class MatterEventListQuery
{
    public DateOnly? From { get; init; }

    public DateOnly? To { get; init; }

    internal static readonly string[] Keys = ["from", "to"];
}

internal static class MatterEventTime
{
    public static string? Format(TimeOnly? time) => time?.ToString("HH':'mm", CultureInfo.InvariantCulture);

    public static bool TryParse(string? text, out TimeOnly? time)
    {
        time = null;
        if (string.IsNullOrWhiteSpace(text))
            return true;
        if (TimeOnly.TryParseExact(text.Trim(), "HH':'mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            time = parsed;
            return true;
        }

        return false;
    }
}
