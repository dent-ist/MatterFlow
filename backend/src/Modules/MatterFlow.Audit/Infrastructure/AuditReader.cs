using MatterFlow.Audit.Contracts;
using MatterFlow.Audit.Domain;
using MatterFlow.SharedKernel.Audit;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Audit.Infrastructure;

/// <summary>Implements <see cref="IAuditReader"/> over the append-only <c>AuditEvent</c> table (index <c>IX_Audit_Task</c>).</summary>
internal sealed class AuditReader(DbContext db) : IAuditReader
{
    private const int MaxLimit = 200;

    public async Task<AuditRecordPage> ListForTaskAsync(
        long taskId,
        long? beforeId,
        int limit,
        IReadOnlyCollection<string>? excludedEventTypes = null,
        CancellationToken cancellationToken = default)
    {
        var size = Math.Clamp(limit, 1, MaxLimit);
        var query = db.Set<AuditEvent>().AsNoTracking().Where(e => e.TaskId == taskId);
        if (beforeId is { } before)
            query = query.Where(e => e.Id < before);
        if (excludedEventTypes is { Count: > 0 })
        {
            var excluded = excludedEventTypes.ToList();
            query = query.Where(e => !excluded.Contains(e.EventType));
        }

        var rows = await query.OrderByDescending(e => e.Id).Take(size + 1).ToListAsync(cancellationToken);
        var hasMore = rows.Count > size;
        var items = rows.Take(size).Select(ToRecord).ToList();
        return new AuditRecordPage(items, hasMore ? items[^1].AuditEventId : null);
    }

    private static AuditRecord ToRecord(AuditEvent e) =>
        new(
            e.Id,
            DateTime.SpecifyKind(e.OccurredAtUtc, DateTimeKind.Utc),
            e.ActorUserId,
            e.EventType,
            e.ObjectType,
            e.ObjectId,
            e.MatterId,
            e.TaskId,
            e.FieldKey,
            Redaction.Truncate(e.OldValue, out _),
            Redaction.Truncate(e.NewValue, out _),
            e.Summary);
}
