using System.Linq.Expressions;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Visibility;

namespace MatterFlow.Productions.Application;

/// <summary>
/// The sensitive-matter rule for this module (epic #788, mode M): productions, specs and comments are those of a matter the caller may see, for reads and writes alike.
/// A hidden matter's records do not exist for the caller (404).
/// </summary>
public sealed class ProductionAccess(IMatterVisibility visibility, IMatterDirectory matters, IUserDirectory users)
{
    /// <summary>Keeps the rows of the matters the caller may see.</summary>
    public IQueryable<T> Visible<T>(IQueryable<T> source, Expression<Func<T, int>> matterId) => visibility.WhereMatterVisible(source, matterId);

    /// <summary>The matter when it exists and the caller may see it, otherwise null.</summary>
    public async Task<MatterSummary?> FindVisibleMatterAsync(int matterId, CancellationToken ct) =>
        await visibility.CanSeeMatterAsync(matterId, ct) ? await matters.FindAsync(matterId, ct) : null;

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
