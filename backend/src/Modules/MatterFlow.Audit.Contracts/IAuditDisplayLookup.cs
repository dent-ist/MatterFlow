namespace MatterFlow.Audit.Contracts;

/// <summary>An audited object as the audit browser refers to it: the stored <c>ObjectType</c> and <c>ObjectId</c>.</summary>
public readonly record struct AuditObjectRef(string ObjectType, string ObjectId);

/// <summary>
/// Display lookups for the audit browser: names of the users who acted and readable labels of the audited objects. The Audit module cannot
/// reference the modules that own this data (and Identity already depends on Audit), so the host supplies the implementation from the
/// other modules' Contracts. Without one the browser shows plain ids.
/// </summary>
public interface IAuditDisplayLookup
{
    /// <summary>Display names of the users that exist, keyed by user id (including inactive users: history keeps their names).</summary>
    Task<IReadOnlyDictionary<int, string>> UserNamesAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default);

    /// <summary>Readable labels (for example <c>TSK-1042 Process Smith custodians</c>) of the objects that can be resolved; the others are absent.</summary>
    Task<IReadOnlyDictionary<AuditObjectRef, string>> ObjectLabelsAsync(
        IReadOnlyCollection<AuditObjectRef> objects,
        CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IAuditDisplayLookup"/> that resolves nothing (plain ids are shown).</summary>
public sealed class NullAuditDisplayLookup : IAuditDisplayLookup
{
    public Task<IReadOnlyDictionary<int, string>> UserNamesAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string>());

    public Task<IReadOnlyDictionary<AuditObjectRef, string>> ObjectLabelsAsync(
        IReadOnlyCollection<AuditObjectRef> objects,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<AuditObjectRef, string>>(new Dictionary<AuditObjectRef, string>());
}
