using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Identity.Application;

/// <summary>Pure business rules of user administration, kept free of persistence so they can be unit tested (architecture 6.6).</summary>
public static class AdminGuards
{
    public const string SelfDeactivationFieldCode = "SELF_DEACTIVATION";

    /// <summary>An administrator may not deactivate their own account.</summary>
    public static Error? CheckSelfDeactivation(int actorUserId, int targetUserId, bool newIsActive) =>
        !newIsActive && actorUserId == targetUserId
            ? Error.Validation("isActive", SelfDeactivationFieldCode, "You cannot deactivate your own account.")
            : null;

    /// <summary>
    /// True when taking System Admin away from <paramref name="targetUserId"/> (deactivating them or revoking the role) would leave
    /// the system without an active System Admin.
    /// </summary>
    public static bool WouldRemoveLastActiveAdmin(int targetUserId, IReadOnlyCollection<int> activeAdminUserIds) =>
        activeAdminUserIds.Contains(targetUserId) && activeAdminUserIds.All(id => id == targetUserId);

    public static Error LastAdminError() =>
        Error.Conflict(ErrorCodes.LastAdmin, "At least one active System Admin is required.");
}
