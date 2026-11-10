namespace MatterFlow.Audit.Contracts;

/// <summary>
/// Records semantic audit events (STEP_COMPLETED, TASK_STATUS_CHANGED, ...). Writing only queues the entry; it is persisted by the
/// next <c>SaveChanges</c> of the DbContext, in the same transaction as the change it describes, so a rolled-back or failed
/// operation leaves no audit row and a failing audit write fails the operation.
/// </summary>
public interface IAuditWriter
{
    void Write(AuditEntry entry);

    /// <summary>
    /// Drops entries that are queued but not yet saved. Used when a failed unit of work is retried from scratch, so the entries re-queued by
    /// the failed save do not describe changes that never happened.
    /// </summary>
    void DiscardPending()
    {
    }
}

/// <summary>Correlation id shared by every audit event of one request/operation (a bulk action's many events share one id).</summary>
public interface IAuditCorrelation
{
    Guid Id { get; }

    /// <summary>Starts a new operation inside the same scope (e.g. per item of a background loop) and returns its id.</summary>
    Guid BeginOperation();
}

/// <summary>A semantic audit event. Actor, timestamp and correlation id are filled in on save.</summary>
public sealed record AuditEntry
{
    public required string EventType { get; init; }

    public required string ObjectType { get; init; }

    /// <summary>Id of the target object. For a not-yet-saved entity with a database-generated key use <see cref="ObjectIdFactory"/>.</summary>
    public string? ObjectId { get; init; }

    /// <summary>Evaluated after the entity changes were saved (inside the transaction); wins over <see cref="ObjectId"/> when set.</summary>
    public Func<string>? ObjectIdFactory { get; init; }

    public int? MatterId { get; init; }

    public long? TaskId { get; init; }

    public string? FieldKey { get; init; }

    public string? OldValue { get; init; }

    public string? NewValue { get; init; }

    /// <summary>Short human-readable line, e.g. the cause (<c>STEP_REOPEN</c>).</summary>
    public string? Summary { get; init; }
}

/// <summary>Well-known event type codes (the list is open; any upper snake-case code up to 64 chars is accepted).</summary>
public static class AuditEventTypes
{
    public const string FieldChanged = "FIELD_CHANGED";
    public const string TaskCreated = "TASK_CREATED";
    public const string TaskStatusChanged = "TASK_STATUS_CHANGED";
    public const string TaskAssigned = "TASK_ASSIGNED";
    public const string StepCompleted = "STEP_COMPLETED";
    public const string StepSkipped = "STEP_SKIPPED";
    public const string StepReopened = "STEP_REOPENED";
}
