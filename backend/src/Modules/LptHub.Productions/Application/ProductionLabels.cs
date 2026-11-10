using MatterFlow.Productions.Contracts;
using MatterFlow.Productions.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Productions.Application;

/// <summary>Internal lookup for other modules (names only; the caller gates by matter).</summary>
internal sealed class ProductionLabels(DbContext db) : IProductionLabels
{
    public async Task<IReadOnlyList<ProductionLabel>> ProductionsAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default) =>
        ids.Count == 0 ? [] : await db.Set<Production>().AsNoTracking().Where(p => ids.Contains(p.Id)).Select(p => new ProductionLabel(p.Id, p.MatterId, p.Name)).ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<ProductionLabel>> SpecsAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default) =>
        ids.Count == 0 ? [] : await db.Set<ProductionSpec>().AsNoTracking().Where(p => ids.Contains(p.Id)).Select(p => new ProductionLabel(p.Id, p.MatterId, p.Name)).ToListAsync(cancellationToken);
}
