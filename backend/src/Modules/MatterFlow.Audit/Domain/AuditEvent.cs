using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.Audit.Domain;

/// <summary>
/// One immutable audit row. Intentionally not <see cref="AuditedAttribute">[Audited]</see> and not an audit-stamped entity.
/// Rows are only ever inserted: there is no update/delete code path, and the database rejects both (03-audit.sql).
/// </summary>
public sealed class AuditEvent : Entity<long>
{
    public DateTime OccurredAtUtc { get; set; }

    /// <summary>AppUser id; null = system. No foreign key.</summary>
    public int? ActorUserId { get; set; }

    public string EventType { get; set; } = string.Empty;

    public string ObjectType { get; set; } = string.Empty;

    public string ObjectId { get; set; } = string.Empty;

    public int? MatterId { get; set; }

    public long? TaskId { get; set; }

    public string? FieldKey { get; set; }

    public string? OldValue { get; set; }

    public string? NewValue { get; set; }

    public string? Summary { get; set; }

    public Guid CorrelationId { get; set; }

    /// <summary>
    /// True when the event was written while its matter was sensitive (script 36, epic #788). Such history stays restricted to the matter's managers and the
    /// holders of <c>Matter.ViewSensitive</c> (and the assignee, for the events of their own task) even after the matter is un-marked. Set once, when the
    /// event is written; the audit table is append-only, so it never changes.
    /// </summary>
    public bool IsSensitiveScope { get; set; }

    /// <summary>Column widths of <c>dbo.AuditEvent</c> (03-audit.sql); text longer than these would fail the save with SQL error 2628.</summary>
    public const int MaxEventTypeLength = 64;

    public const int MaxObjectTypeLength = 40;

    public const int MaxObjectIdLength = 40;

    public const int MaxFieldKeyLength = 100;

    public const int MaxSummaryLength = 500;

    /// <summary>
    /// Cuts the bounded text columns to their width (security review SEC-20). An audit write that fails fails the business operation by
    /// design, so a long variable summary (for example a list of dropped field keys) must never be able to break a legitimate save.
    /// Cut text ends with "..." so a reader can tell it was shortened.
    /// </summary>
    public void ClipToColumnLimits()
    {
        EventType = Clip(EventType, MaxEventTypeLength)!;
        ObjectType = Clip(ObjectType, MaxObjectTypeLength)!;
        ObjectId = Clip(ObjectId, MaxObjectIdLength)!;
        FieldKey = Clip(FieldKey, MaxFieldKeyLength);
        Summary = Clip(Summary, MaxSummaryLength);
    }

    private static string? Clip(string? value, int max) =>
        value is null || value.Length <= max ? value : string.Concat(value.AsSpan(0, max - 3), "..."); // ASCII: several of these columns are VARCHAR

    /// <summary>Log-safe description: identifiers only, never the old/new values (architecture section 14).</summary>
    public string ToLogString() =>
        $"AuditEvent {Id} {EventType} {ObjectType}/{ObjectId} field={FieldKey ?? "-"} correlation={CorrelationId} values={Redaction.Masked}";
}
