namespace MatterFlow.Audit.Contracts;

/// <summary>One stored audit event as other modules read it (old/new values are truncated to 4000 characters).</summary>
public sealed record AuditRecord(
    long AuditEventId,
    DateTime OccurredAtUtc,
    int? ActorUserId,
    string EventType,
    string ObjectType,
    string ObjectId,
    int? MatterId,
    long? TaskId,
    string? FieldKey,
    string? OldValue,
    string? NewValue,
    string? Summary);

/// <summary>A page of audit events, newest first. <paramref name="NextBeforeId"/> is the cursor for the following (older) page; null on the last page.</summary>
public sealed record AuditRecordPage(IReadOnlyList<AuditRecord> Items, long? NextBeforeId);

/// <summary>Read access to the audit trail for other modules (the Task activity timeline). Writing stays with <see cref="IAuditWriter"/>.</summary>
public interface IAuditReader
{
    /// <summary>
    /// The events scoped to a Task (its own and those of its comments, steps and links), newest first. <paramref name="beforeId"/> is the cursor
    /// (only events with a smaller id are returned); event types in <paramref name="excludedEventTypes"/> are left out.
    /// </summary>
    Task<AuditRecordPage> ListForTaskAsync(
        long taskId,
        long? beforeId,
        int limit,
        IReadOnlyCollection<string>? excludedEventTypes = null,
        CancellationToken cancellationToken = default);
}
