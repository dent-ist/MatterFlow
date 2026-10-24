using System.Linq.Expressions;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Visibility;

namespace MatterFlow.Identity.Access;

/// <summary>
/// The implementation of <see cref="IManagedMatterScope"/> (epic #758, PX-02). The manager rule is <see cref="ManagedMatterRule"/>; the matters it
/// looks at are first narrowed by <see cref="IMatterVisibility"/>, the one place the sensitive-matter rule is applied (a no-op until the go-live switch is on).
/// </summary>
public sealed class ManagedMatterScope(IMatterVisibility visibility, IMatterAccessSource matters, IPermissionChecker permissions, ICurrentUser currentUser) : IManagedMatterScope
{
    public bool CanUseAllScope => permissions.Has(Permissions.Matter.AssignManagers);

    public Result RequireAllScope() => permissions.Require(Permissions.Matter.AssignManagers);

    public int? CurrentUserId => currentUser.UserId;

    public IQueryable<T> WhereManagedBy<T>(
        IQueryable<T> source,
        Expression<Func<T, int?>> primaryManagerId,
        Expression<Func<T, int?>> secondaryManagerId,
        Expression<Func<T, int>> matterId,
        int manager,
        ManagerPlace place = ManagerPlace.Either) =>
        visibility.WhereMatterVisible(source.Where(ManagedMatterRule.Predicate(primaryManagerId, secondaryManagerId, manager, place)), matterId);

    public IQueryable<T> WhereMatterManagedBy<T>(IQueryable<T> source, Expression<Func<T, int>> matterId, int manager, ManagerPlace place = ManagerPlace.Either) =>
        VisibilityPredicates.WhereIn(source, matterId, ManagedMatterIds(manager, place));

    public Result<ManagedFilter?> ResolveFilter(bool? matterManagedByMe, string? role)
    {
        var place = ManagerPlace.Either;
        if (!string.IsNullOrWhiteSpace(role))
        {
            switch (role.Trim().ToLowerInvariant())
            {
                case "primary":
                    place = ManagerPlace.Primary;
                    break;
                case "secondary":
                    place = ManagerPlace.Secondary;
                    break;
                case "both":
                    break;
                default:
                    return Error.Validation("role", "UNKNOWN_ROLE", $"Unknown role '{role}'. Allowed: primary, secondary, both.");
            }
        }

        if (matterManagedByMe != true)
        {
            if (string.IsNullOrWhiteSpace(role))
                return Result<ManagedFilter?>.Success(null);

            return Error.Validation("role", "ROLE_NEEDS_MATTER_MANAGED_BY_ME", "role needs matterManagedByMe=true.");
        }

        if (currentUser.UserId is not { } me)
            return Error.Validation("matterManagedByMe", "NO_USER", "matterManagedByMe needs a signed-in user.");

        return Result<ManagedFilter?>.Success(new ManagedFilter(me, place));
    }

    public IQueryable<int> ManagedMatterIds(int manager, ManagerPlace place = ManagerPlace.Either) =>
        visibility.WhereMatterVisible(
                matters.Rows().Where(ManagedMatterRule.Predicate<MatterAccessRow>(r => r.PrimaryManagerId, r => r.SecondaryManagerId, manager, place)),
                r => r.MatterId)
            .Select(r => r.MatterId);
}
