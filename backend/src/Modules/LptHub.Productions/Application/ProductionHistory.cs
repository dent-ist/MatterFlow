using LptHub.Audit.Contracts;

namespace LptHub.Productions.Application;

/// <summary>Reads the audit trail of one object as the history panel shows it (who, when, what; values of the fields named in <c>valueNames</c> replaced by readable names).</summary>
internal static class ProductionHistory
{
    /// <param name="valueNames">Optional lookup: field key to a function mapping the stored value text to a readable one.</param>
    public static async Task<ProductionHistoryResponse> ReadAsync(
        IAuditReader reader,
        ProductionAccess access,
        string objectType,
        string objectId,
        ProductionHistoryQuery query,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>? valueNames,
        CancellationToken ct)
    {
        var page = await reader.ListAllForObjectAsync(objectType, objectId, query.BeforeId, query.Limit, ct);
        var names = await access.NamesAsync(page.Items.Select(e => e.ActorUserId), ct);

        string? Readable(string? field, string? value)
        {
            if (value is null || field is null || valueNames is null || !valueNames.TryGetValue(field, out var map))
                return value;

            return map.TryGetValue(value, out var name) ? name : value;
        }

        var items = page.Items.Select(e => new ProductionHistoryEntry(
            e.AuditEventId,
            e.OccurredAtUtc,
            e.ActorUserId,
            e.ActorUserId is { } actor && names.TryGetValue(actor, out var n) ? n : null,
            e.EventType,
            e.FieldKey,
            Readable(e.FieldKey, e.OldValue),
            Readable(e.FieldKey, e.NewValue),
            e.Summary)).ToList();
        return new ProductionHistoryResponse(items, page.NextBeforeId);
    }
}
