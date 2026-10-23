using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

/// <summary>Every matter, unfiltered, in the shape the visibility rule needs. Only the visibility port reads it (epic #788).</summary>
internal sealed class MatterAccessSource(DbContext db) : IMatterAccessSource
{
    public IQueryable<MatterAccessRow> Rows() =>
        db.Set<Matter>().AsNoTracking().Select(m => new MatterAccessRow
        {
            MatterId = m.Id,
            IsSensitive = m.IsSensitive,
            PrimaryManagerId = m.PrimaryManagerId,
            SecondaryManagerId = m.SecondaryManagerId,
        });
}
