using System.Security.Cryptography;
using System.Text;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The part of every viewer-dependent cache key that stands for "what this person may see right now" (epic #788, README section 10): <c>off</c> while the go-live
/// switch is off, <c>all</c> for a see-all viewer, otherwise a short hash of the sensitive matters that exist, the ones the person manages and the sensitive-matter
/// tasks assigned to them. A change of any of those (a manager removed, a task reassigned, a matter marked or un-marked, the permission taken away) changes the key at
/// once, so a cached dashboard never outlives the access it was computed for; two people never share a key unless they see the same things.
/// The sensitive set is small by design, so the two reads cost a few pages.
/// </summary>
public sealed class VisibilityStamp(DbContext db, IMatterVisibility visibility)
{
    public async Task<string> KeyAsync(CancellationToken ct)
    {
        if (!visibility.Enabled)
            return "off";

        var viewer = visibility.Current;
        if (viewer.SeeAll)
            return "all";

        if (viewer.UserId is not { } user)
            return "none";

        // The sensitive matters that exist and the ones this person may see (through the port: managers are never compared here).
        var sensitive = await db.Set<Matter>().AsNoTracking().Where(m => m.IsSensitive).OrderBy(m => m.Id).Select(m => m.Id).ToListAsync(ct);
        var managed = await visibility.VisibleMatters(viewer).Where(m => m.IsSensitive).OrderBy(m => m.MatterId).Select(m => m.MatterId).ToListAsync(ct);
        var assigned = sensitive.Count == 0
            ? []
            : await (from t in db.Set<WorkTask>().AsNoTracking()
                     join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
                     where t.AssignedUserId == user && m.IsSensitive
                     orderby t.Id
                     select t.Id).ToListAsync(ct);

        var text = $"{string.Join(',', sensitive)}|{string.Join(',', managed)}|{string.Join(',', assigned)}";
        return "u" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))[..16];
    }
}
