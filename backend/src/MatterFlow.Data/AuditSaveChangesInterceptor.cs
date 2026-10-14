using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.CompilerServices;
using MatterFlow.Audit.Contracts;
using MatterFlow.Audit.Domain;
using MatterFlow.Audit.Infrastructure;
using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage;

namespace MatterFlow.Data;

/// <summary>
/// Writes AuditEvent rows in the same transaction as the audited change (architecture section 9):
/// <list type="bullet">
/// <item>field-level <c>FIELD_CHANGED</c> events for entities marked <see cref="AuditedAttribute"/> (properties marked
/// <see cref="AuditExplicitAttribute"/> are skipped), and</item>
/// <item>the explicit entries queued through <see cref="IAuditWriter"/>.</item>
/// </list>
/// Changes are snapshotted before the save; the events are inserted right after the entity changes, once database-generated
/// keys are known, by a second SaveChanges inside the same transaction. If the caller has no transaction the interceptor opens
/// one for the duration, so the business change and its audit rows commit or roll back together. A failure of either write
/// fails the whole operation.
/// </summary>
public sealed class AuditSaveChangesInterceptor(
    AuditEntryBuffer buffer,
    IAuditCorrelation correlation,
    IClock clock,
    ICurrentUser currentUser) : SaveChangesInterceptor
{
    private static readonly ConcurrentDictionary<Type, AuditedTypeInfo?> TypeCache = new();

    private readonly ConditionalWeakTable<DbContext, Pending> _state = new();

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } context && Capture(context) is { } pending)
            pending.Transaction = context.Database.CurrentTransaction is null ? context.Database.BeginTransaction() : null;

        return base.SavingChanges(eventData, result);
    }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context && Capture(context) is { } pending)
        {
            pending.Transaction = context.Database.CurrentTransaction is null
                ? await context.Database.BeginTransactionAsync(cancellationToken)
                : null;
        }

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        if (eventData.Context is { } context && TakePending(context) is { } pending)
        {
            try
            {
                context.AddRange(Materialize(pending));
                _flushing = true;
                context.SaveChanges();
                pending.Transaction?.Commit();
            }
            catch
            {
                Abort(context, pending);
                throw;
            }
            finally
            {
                _flushing = false;
                pending.Transaction?.Dispose();
            }
        }

        return base.SavedChanges(eventData, result);
    }

    public override async ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData,
        int result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context && TakePending(context) is { } pending)
        {
            try
            {
                context.AddRange(Materialize(pending));
                _flushing = true;
                await context.SaveChangesAsync(cancellationToken);
                if (pending.Transaction is not null)
                    await pending.Transaction.CommitAsync(cancellationToken);
            }
            catch
            {
                Abort(context, pending);
                throw;
            }
            finally
            {
                _flushing = false;
                if (pending.Transaction is not null)
                    await pending.Transaction.DisposeAsync();
            }
        }

        return await base.SavedChangesAsync(eventData, result, cancellationToken);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        if (!_flushing && eventData.Context is { } context && TakePending(context) is { } pending)
            Abort(context, pending);

        base.SaveChangesFailed(eventData);
    }

    public override async Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        if (!_flushing && eventData.Context is { } context && TakePending(context) is { } pending)
            Abort(context, pending);

        await base.SaveChangesFailedAsync(eventData, cancellationToken);
    }

    public override void SaveChangesCanceled(DbContextEventData eventData)
    {
        if (!_flushing && eventData.Context is { } context && TakePending(context) is { } pending)
            Abort(context, pending);

        base.SaveChangesCanceled(eventData);
    }

    public override async Task SaveChangesCanceledAsync(DbContextEventData eventData, CancellationToken cancellationToken = default)
    {
        if (!_flushing && eventData.Context is { } context && TakePending(context) is { } pending)
            Abort(context, pending);

        await base.SaveChangesCanceledAsync(eventData, cancellationToken);
    }

    // True while the audit rows themselves are being saved, so the nested SaveChanges does not capture again.
    private bool _flushing;

    private Pending? TakePending(DbContext context)
    {
        if (!_state.TryGetValue(context, out var pending))
            return null;

        _state.Remove(context);
        return pending;
    }

    /// <summary>Snapshots the audited changes and queued entries. Returns null (and starts nothing) when there is nothing to audit.</summary>
    private Pending? Capture(DbContext context)
    {
        if (_flushing)
            return null;

        var changes = new List<PendingChange>();
        var adds = new List<PendingAdd>();
        foreach (var entry in context.ChangeTracker.Entries().ToList())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted))
                continue;
            if (GetTypeInfo(entry.Entity.GetType()) is not { } info)
                continue;

            if (entry.State == EntityState.Added)
                adds.Add(new PendingAdd(entry, info));
            else
                changes.AddRange(SnapshotExisting(entry, info));
        }

        var explicitEntries = buffer.Drain();
        if (changes.Count == 0 && adds.Count == 0 && explicitEntries.Count == 0)
            return null;

        var pending = new Pending(changes, adds, explicitEntries);
        _state.AddOrUpdate(context, pending);
        return pending;
    }

    private static IEnumerable<PendingChange> SnapshotExisting(EntityEntry entry, AuditedTypeInfo info)
    {
        var deleted = entry.State == EntityState.Deleted;
        var objectId = KeyOf(entry);
        var list = new List<PendingChange>();
        foreach (var property in AuditedProperties(entry))
        {
            if (!deleted && !property.IsModified)
                continue;

            var newValue = deleted ? null : property.CurrentValue;
            foreach (var change in AuditDiff.Diff(property.Metadata.Name, property.OriginalValue, newValue, JsonPrefix(property)))
                list.Add(new PendingChange(entry.Entity, info, objectId, change));
        }

        return list;
    }

    private static IEnumerable<PropertyEntry> AuditedProperties(EntityEntry entry)
    {
        var stamped = entry.Entity is IAuditStamped;
        foreach (var property in entry.Properties)
        {
            var meta = property.Metadata;
            if (meta.IsPrimaryKey()
                || (meta.ValueGenerated & ValueGenerated.OnUpdate) != 0 // rowversion and computed columns
                || (stamped && IsStampColumn(meta.Name))
                || meta.PropertyInfo?.GetCustomAttribute<AuditExplicitAttribute>() is not null)
            {
                continue;
            }

            yield return property;
        }
    }

    private static bool IsStampColumn(string name) =>
        name is nameof(IAuditStamped.CreatedAtUtc) or nameof(IAuditStamped.CreatedByUserId)
            or nameof(IAuditStamped.ModifiedAtUtc) or nameof(IAuditStamped.ModifiedByUserId);

    private static string? JsonPrefix(PropertyEntry property) =>
        property.Metadata.PropertyInfo?.GetCustomAttribute<AuditJsonFieldsAttribute>()?.Prefix;

    private static string KeyOf(EntityEntry entry) =>
        string.Join('-', entry.Metadata.FindPrimaryKey()!.Properties
            .Select(p => AuditDiff.Format(entry.Property(p.Name).CurrentValue)));

    private List<AuditEvent> Materialize(Pending pending)
    {
        var now = clock.UtcNow;
        var actor = currentUser.UserId;
        var correlationId = correlation.Id;

        AuditEvent FieldEvent(object entity, AuditedTypeInfo info, string objectId, FieldChange change)
        {
            var scope = entity as IAuditScoped;
            return new AuditEvent
            {
                OccurredAtUtc = now,
                ActorUserId = actor,
                EventType = AuditEventTypes.FieldChanged,
                ObjectType = info.ObjectType,
                ObjectId = objectId,
                MatterId = scope?.AuditMatterId,
                TaskId = scope?.AuditTaskId,
                FieldKey = change.FieldKey,
                OldValue = change.OldValue,
                NewValue = change.NewValue,
                CorrelationId = correlationId,
            };
        }

        var events = new List<AuditEvent>();
        foreach (var change in pending.Changes)
            events.Add(FieldEvent(change.Entity, change.Info, change.ObjectId, change.Change));

        // Added entities are read after the save, so generated keys and foreign keys to just-inserted principals are real values.
        foreach (var add in pending.Adds)
        {
            var objectId = KeyOf(add.Entry);
            foreach (var property in AuditedProperties(add.Entry))
            {
                foreach (var change in AuditDiff.Diff(property.Metadata.Name, null, property.CurrentValue, JsonPrefix(property)))
                    events.Add(FieldEvent(add.Entry.Entity, add.Info, objectId, change));
            }
        }

        foreach (var entry in pending.Explicit)
        {
            var created = new AuditEvent
            {
                OccurredAtUtc = now,
                ActorUserId = actor,
                EventType = entry.EventType,
                ObjectType = entry.ObjectType,
                ObjectId = entry.ObjectIdFactory?.Invoke() ?? entry.ObjectId!,
                MatterId = entry.MatterId,
                TaskId = entry.TaskId,
                FieldKey = entry.FieldKey,
                OldValue = entry.OldValue,
                NewValue = entry.NewValue,
                Summary = entry.Summary,
                CorrelationId = correlationId,
            };
            events.Add(created);
        }

        pending.Created.AddRange(events);
        return events;
    }

    /// <summary>Rolls back the transaction this interceptor opened, detaches any audit rows already tracked, and re-queues the explicit entries.</summary>
    private void Abort(DbContext context, Pending pending)
    {
        foreach (var created in pending.Created)
        {
            var entry = context.Entry(created);
            if (entry.State != EntityState.Detached)
                entry.State = EntityState.Detached;
        }

        buffer.Requeue(pending.Explicit);
        try
        {
            pending.Transaction?.Rollback();
        }
        catch (InvalidOperationException)
        {
            // already completed or connection closed: nothing left to roll back
        }
        finally
        {
            pending.Transaction?.Dispose();
        }
    }

    private static AuditedTypeInfo? GetTypeInfo(Type type) =>
        TypeCache.GetOrAdd(type, static t =>
        {
            var attribute = t.GetCustomAttribute<AuditedAttribute>(inherit: true);
            return attribute is null ? null : new AuditedTypeInfo(attribute.ObjectType ?? t.Name);
        });

    private sealed record AuditedTypeInfo(string ObjectType);

    private sealed record PendingChange(object Entity, AuditedTypeInfo Info, string ObjectId, FieldChange Change);

    private sealed record PendingAdd(EntityEntry Entry, AuditedTypeInfo Info);

    private sealed class Pending(IReadOnlyList<PendingChange> changes, IReadOnlyList<PendingAdd> adds, IReadOnlyList<AuditEntry> explicitEntries)
    {
        public IReadOnlyList<PendingChange> Changes { get; } = changes;

        public IReadOnlyList<PendingAdd> Adds { get; } = adds;

        public IReadOnlyList<AuditEntry> Explicit { get; } = explicitEntries;

        public List<AuditEvent> Created { get; } = [];

        public IDbContextTransaction? Transaction { get; set; }
    }
}
