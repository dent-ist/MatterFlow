using MatterFlow.Organization.Contracts;
using MatterFlow.Organization.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

/// <summary>Implements the read-only lookups other modules use (<see cref="IMatterDirectory"/>).</summary>
internal sealed class MatterDirectory(DbContext db) : IMatterDirectory
{
    public IQueryable<MatterSortKey> SortKeys() =>
        db.Set<Matter>().AsNoTracking().Select(m => new MatterSortKey { MatterId = m.Id, MatterRef = m.MatterRef });

    public async Task<MatterSummary?> FindAsync(int matterId, CancellationToken cancellationToken = default)
    {
        var row = await Query().Where(r => r.Matter.Id == matterId).FirstOrDefaultAsync(cancellationToken);
        return row is null ? null : ToSummary(row);
    }

    public async Task<MatterSummary?> ResolveReferenceAsync(string reference, CancellationToken cancellationToken = default)
    {
        if (!MatterService.TryParsePair(reference, out var clientNumber, out var matterNumber))
            return null;

        var row = await Query()
            .Where(r => r.Matter.ClientNumber == clientNumber && r.Matter.MatterNumber == matterNumber)
            .FirstOrDefaultAsync(cancellationToken);
        return row is null ? null : ToSummary(row);
    }

    public async Task<IReadOnlyList<int>> FindIdsMatchingAsync(string text, int limit, CancellationToken cancellationToken = default)
    {
        var q = text.Trim();
        if (q.Length == 0)
            return [];

        var matters = db.Set<Matter>().AsNoTracking();
        var found = MatterService.TryParsePair(q, out var clientNumber, out var matterNumber)
            ? matters.Where(m => m.MatterRef.Contains(q) || m.Name.Contains(q) || (m.ClientNumber == clientNumber && m.MatterNumber == matterNumber))
            : matters.Where(m => m.MatterRef.Contains(q) || m.Name.Contains(q));
        return await found.OrderBy(m => m.Id).Select(m => m.Id).Take(limit).ToListAsync(cancellationToken);
    }

    private IQueryable<Row> Query() =>
        from m in db.Set<Matter>().AsNoTracking()
        join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
        select new Row { Matter = m, ClientIsActive = c.IsActive };

    private static MatterSummary ToSummary(Row r) => new(
        r.Matter.Id,
        r.Matter.ClientId,
        r.Matter.ClientNumber.Value,
        r.Matter.MatterNumber.Value,
        r.Matter.MatterRef,
        r.Matter.Name,
        r.Matter.IsActive,
        r.Matter.IsSensitive,
        r.ClientIsActive);

    private sealed class Row
    {
        public Matter Matter { get; init; } = null!;

        public bool ClientIsActive { get; init; }
    }
}

/// <summary>Implements <see cref="IProjectDirectory"/>.</summary>
internal sealed class ProjectDirectory(DbContext db) : IProjectDirectory
{
    public async Task<ProjectSummary?> FindAsync(int projectId, CancellationToken cancellationToken = default) =>
        await db.Set<Project>().AsNoTracking()
            .Where(p => p.Id == projectId)
            .Select(p => new ProjectSummary(p.Id, p.MatterId, p.Name, p.IsActive))
            .FirstOrDefaultAsync(cancellationToken);
}
