using LptHub.Integrations.Contracts;
using LptHub.Integrations.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Integrations.Application;

public sealed class IntegrationRegistry(DbContext db, ConnectionAccess connection) : IIntegrationRegistry
{
    public async Task<IntegrationInfo?> FindByTypeAsync(string typeCode, CancellationToken ct = default)
    {
        var row = await db.Set<Integration>().AsNoTracking().SingleOrDefaultAsync(i => i.TypeCode == typeCode, ct);
        return row is null ? null : ToInfo(row, IntegrationSupport.IsComplete(await connection.LoadAsync(ct)));
    }

    public async Task<IReadOnlyList<IntegrationInfo>> ListAsync(CancellationToken ct = default)
    {
        var complete = IntegrationSupport.IsComplete(await connection.LoadAsync(ct));
        var rows = await db.Set<Integration>().AsNoTracking().OrderBy(i => i.Name).ToListAsync(ct);
        return [.. rows.Select(r => ToInfo(r, complete))];
    }

    private static IntegrationInfo ToInfo(Integration r, bool connectionComplete) =>
        new(r.Id, r.Name, r.TypeCode, r.BaseUrl, r.IsEnabled, IntegrationSupport.StatusOf(r.IsEnabled, connectionComplete, r.BaseUrl, r.Scope, r.LastTestOutcome));
}
