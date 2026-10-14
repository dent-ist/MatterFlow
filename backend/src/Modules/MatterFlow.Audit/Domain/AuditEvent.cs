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

    /// <summary>Log-safe description: identifiers only, never the old/new values (architecture section 14).</summary>
    public string ToLogString() =>
        $"AuditEvent {Id} {EventType} {ObjectType}/{ObjectId} field={FieldKey ?? "-"} correlation={CorrelationId} values={Redaction.Masked}";
}
