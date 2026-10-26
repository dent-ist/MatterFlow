using MatterFlow.Audit.Application;
using MatterFlow.Audit.Contracts;
using MatterFlow.Audit.Domain;
using MatterFlow.SharedKernel.Audit;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Audit.Infrastructure;

/// <summary>Implements <see cref="IAuditReader"/> over the append-only <c>AuditEvent</c> table (index <c>IX_Audit_Task</c>).</summary>
internal sealed class AuditReader(DbContext db, AuditVisibility visibility) : IAuditReader
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
        var query = visibility.Apply(db.Set<AuditEvent>().AsNoTracking()).Where(e => e.TaskId == taskId);
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

    public async Task<AuditRecord?> LatestForTaskAsync(long taskId, string eventType, CancellationToken cancellationToken = default)
    {
        var row = await visibility.Apply(db.Set<AuditEvent>().AsNoTracking())
            .Where(e => e.TaskId == taskId && e.EventType == eventType)
            .OrderByDescending(e => e.Id)
            .FirstOrDefaultAsync(cancellationToken);
        return row is null ? null : ToRecord(row);
    }

    public async Task<IReadOnlyList<AuditRecord>> ListForObjectAsync(string objectType, string objectId, string eventType, int limit, CancellationToken cancellationToken = default)
    {
        var rows = await visibility.Apply(db.Set<AuditEvent>().AsNoTracking())
            .Where(e => e.ObjectType == objectType && e.ObjectId == objectId && e.EventType == eventType)
            .OrderByDescending(e => e.Id)
            .Take(Math.Clamp(limit, 1, MaxLimit))
            .ToListAsync(cancellationToken);
        return [.. rows.Select(ToRecord)];
    }

    /// <summary>Values and summary pass the secret guard like the audit browser's (SEC2-06): a token or password never leaves through the activity feed.</summary>
    private static AuditRecord ToRecord(AuditEvent e)
    {
        var sensitive = AuditValueGuard.IsSensitiveKey(e.FieldKey);
        return new(
            e.Id,
            DateTime.SpecifyKind(e.OccurredAtUtc, DateTimeKind.Utc),
            e.ActorUserId,
            e.EventType,
            e.ObjectType,
            e.ObjectId,
            e.MatterId,
            e.TaskId,
            e.FieldKey,
            AuditValueGuard.Guard(e.OldValue, sensitive, out _, out _),
            AuditValueGuard.Guard(e.NewValue, sensitive, out _, out _),
            AuditValueGuard.LooksLikeSecret(e.Summary) ? null : e.Summary);
    }
}
