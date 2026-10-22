using MatterFlow.Identity.Contracts;
using MatterFlow.Notifications.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

/// <summary>Which Matters the caller may view, for the notification reads: the <c>Matter.View</c> permission, as on the Matter endpoints.</summary>
internal sealed class MatterObjectVisibility(DbContext db, IPermissionChecker permissions) : IObjectVisibility
{
    public string ObjectKind => NotificationObjectKinds.Matter;

    public IQueryable<long>? VisibleObjectIds() =>
        permissions.Has(Permissions.Matter.View) ? db.Set<Matter>().AsNoTracking().Select(m => (long)m.Id) : null;
}
