using MatterFlow.Identity.Contracts;
using MatterFlow.Notifications.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Visibility;

namespace MatterFlow.Organization.Application;

/// <summary>Which Matters the caller may view, for the notification reads: the <c>Matter.View</c> permission and the sensitive-matter rule (epic #788, mode M), as on the Matter endpoints.</summary>
internal sealed class MatterObjectVisibility(IMatterVisibility visibility, IPermissionChecker permissions) : IObjectVisibility
{
    public string ObjectKind => NotificationObjectKinds.Matter;

    public IQueryable<long>? VisibleObjectIds() =>
        permissions.Has(Permissions.Matter.View) ? visibility.VisibleMatters().Select(m => (long)m.MatterId) : null;
}
