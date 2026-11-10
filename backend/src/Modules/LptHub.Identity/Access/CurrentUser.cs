using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Identity.Access;

/// <summary>
/// Request-scoped caller. Populated by the authorization handler once the principal has been resolved to an <see cref="AccessSnapshot"/>
/// (it does not depend on the DbContext itself, so the audit-column interceptor can take <see cref="ICurrentUser"/> without a cycle).
/// </summary>
public sealed class CurrentUser : ICurrentUser, IPermissionChecker
{
    public AccessSnapshot? Snapshot { get; private set; }

    public int? UserId => Snapshot?.UserId;

    public bool IsAuthenticated => Snapshot is not null;

    public string? DisplayName => Snapshot?.DisplayName;

    public bool IsSystemAdmin => Snapshot?.IsSystemAdmin ?? false;

    public void Set(AccessSnapshot snapshot) => Snapshot = snapshot;

    public bool Has(string permissionCode) => Snapshot?.Has(permissionCode) ?? false;

    public Result Require(string permissionCode) =>
        Has(permissionCode)
            ? Result.Success()
            : Result.Failure(new Error(
                ErrorType.Forbidden,
                ErrorCodes.PermissionDenied,
                $"The permission '{permissionCode}' is required.",
                meta: new Dictionary<string, object?> { ["permission"] = permissionCode }));
}
