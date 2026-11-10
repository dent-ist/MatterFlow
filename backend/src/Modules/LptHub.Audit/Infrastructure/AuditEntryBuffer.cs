using MatterFlow.Audit.Contracts;

namespace MatterFlow.Audit.Infrastructure;

/// <summary>
/// Scoped queue behind <see cref="IAuditWriter"/>. The Data layer's SaveChanges interceptor drains it and persists the entries in
/// the same transaction as the audited change; on a failed save it puts them back so a retry still writes them.
/// </summary>
public sealed class AuditEntryBuffer : IAuditWriter
{
    private readonly object _gate = new();
    private readonly List<AuditEntry> _entries = [];

    public void Write(AuditEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        if (string.IsNullOrWhiteSpace(entry.EventType) || string.IsNullOrWhiteSpace(entry.ObjectType))
            throw new ArgumentException("EventType and ObjectType are required.", nameof(entry));
        if (string.IsNullOrWhiteSpace(entry.ObjectId) && entry.ObjectIdFactory is null)
            throw new ArgumentException("ObjectId or ObjectIdFactory is required.", nameof(entry));

        lock (_gate)
            _entries.Add(entry);
    }

    public void DiscardPending() => Drain();

    public IReadOnlyList<AuditEntry> Drain()
    {
        lock (_gate)
        {
            var drained = _entries.ToArray();
            _entries.Clear();
            return drained;
        }
    }

    public void Requeue(IEnumerable<AuditEntry> entries)
    {
        lock (_gate)
            _entries.InsertRange(0, entries);
    }
}

/// <summary>Scoped (per request) correlation id.</summary>
public sealed class AuditCorrelation : IAuditCorrelation
{
    public Guid Id { get; private set; } = Guid.NewGuid();

    public Guid BeginOperation() => Id = Guid.NewGuid();
}
