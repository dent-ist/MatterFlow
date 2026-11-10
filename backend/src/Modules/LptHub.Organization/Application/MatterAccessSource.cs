using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

/// <summary>
/// Every matter, unfiltered, in the shape the visibility rule needs. Only the visibility port reads it (epic #788).
/// Do NOT add <c>AsNoTracking()</c> here: the rows are a projection and are never tracked anyway, but EF applies the option to the whole statement the rows are used in as a subquery, so every
/// entity a caller loads through the visibility filter (<c>WhereMatterVisible</c> and its relatives) would be untracked and <c>SaveChanges</c> would silently save nothing (issue #1304;
/// <c>VisibilitySourceRulesTests</c> guards this).
/// </summary>
internal sealed class MatterAccessSource(DbContext db) : IMatterAccessSource
{
    public IQueryable<MatterAccessRow> Rows() =>
        db.Set<Matter>().Select(m => new MatterAccessRow
        {
            MatterId = m.Id,
            IsSensitive = m.IsSensitive,
            PrimaryManagerId = m.PrimaryManagerId,
            SecondaryManagerId = m.SecondaryManagerId,
        });
}
