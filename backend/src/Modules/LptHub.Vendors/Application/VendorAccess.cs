using LptHub.Identity.Contracts;
using LptHub.Organization.Contracts;
using LptHub.SharedKernel.Visibility;
using LptHub.Vendors.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Vendors.Application;

/// <summary>
/// The sensitive-matter rule for this module (epic #788, mode M): a vendor-to-matter link is a record of its matter, so it exists for the caller only when the caller may see the matter,
/// for reads, counts and writes alike. A hidden matter is a 404, identical to one that does not exist. The vendors themselves are firm-wide records, not matter records.
/// </summary>
public sealed class VendorAccess(IMatterVisibility visibility, IMatterDirectory matters, IUserDirectory users, DbContext db)
{
    /// <summary>The links of matters the caller may see.</summary>
    public IQueryable<VendorMatter> VisibleLinks() => visibility.WhereMatterVisible(db.Set<VendorMatter>().AsNoTracking(), l => l.MatterId);

    /// <summary>The matter when it exists and the caller may see it, otherwise null.</summary>
    public async Task<MatterSummary?> FindVisibleMatterAsync(int matterId, CancellationToken ct) =>
        await visibility.CanSeeMatterAsync(matterId, ct) ? await matters.FindAsync(matterId, ct) : null;

    /// <summary>The summaries of the given matters (no visibility applied: the caller passes ids it already filtered).</summary>
    public Task<IReadOnlyDictionary<int, MatterSummary>> MatterSummariesAsync(IReadOnlyCollection<int> matterIds, CancellationToken ct) =>
        matters.FindManyAsync(matterIds, ct);

    public Task<string?> ClientNameAsync(int clientId, CancellationToken ct) => matters.ClientNameAsync(clientId, ct);

    /// <summary>Display names of the given users (history keeps the names of inactive users).</summary>
    public async Task<IReadOnlyDictionary<int, string>> NamesAsync(IEnumerable<int?> userIds, CancellationToken ct)
    {
        var ids = userIds.OfType<int>().Distinct().ToList();
        if (ids.Count == 0)
            return new Dictionary<int, string>();

        var found = await users.FindManyAsync(ids, ct);
        return found.ToDictionary(kv => kv.Key, kv => kv.Value.DisplayName);
    }
}
