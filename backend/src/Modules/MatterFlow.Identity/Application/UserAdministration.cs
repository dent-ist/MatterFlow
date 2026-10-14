using System.Linq.Expressions;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Application;

/// <summary>Values of the <c>status</c> filter of the users list.</summary>
public static class UserListStatuses
{
    public const string All = "all";
    public const string Pending = "pending";
    public const string Active = "active";
    public const string Inactive = "inactive";

    public static bool IsValid(string? value) => value is null or All or Pending or Active or Inactive;
}

/// <summary>
/// Users queue and role assignment (architecture 6; baseline 6.4). Every change is audited, invalidates the effective-permission
/// cache and honors the guard rails: no self-deactivation and always at least one active System Admin.
/// </summary>
public sealed class UserAdministration(
    DbContext db,
    IUserAccessInvalidator invalidator,
    IAuditWriter audit,
    ICurrentUser currentUser,
    IClock clock)
{
    /// <summary>Access Pending: active with no effective permission (same rule as <c>AccessSnapshot.IsPending</c>).</summary>
    private static readonly Expression<Func<AppUser, bool>> PendingExpr = u =>
        u.IsActive && !u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive)));

    private IQueryable<AppUser> Users => db.Set<AppUser>().AsNoTracking();

    public async Task<PagedResult<UserSummaryDto>> ListAsync(string? status, string? search, PageRequest page, CancellationToken ct)
    {
        var query = Users;
        query = status switch
        {
            UserListStatuses.Pending => query.Where(PendingExpr),
            UserListStatuses.Active => query.Where(u => u.IsActive),
            UserListStatuses.Inactive => query.Where(u => !u.IsActive),
            _ => query,
        };

        if (!string.IsNullOrWhiteSpace(search))
        {
            var like = "%" + EscapeLike(search.Trim()) + "%";
            query = query.Where(u =>
                EF.Functions.Like(u.DisplayName, like, "\\")
                || (u.Email != null && EF.Functions.Like(u.Email, like, "\\"))
                || u.Identities.Any(i => EF.Functions.Like(i.Username, like, "\\")));
        }

        var total = await query.CountAsync(ct);

        // Pending first (oldest waiting first), then active, then inactive; stable by name.
        var ordered = status == UserListStatuses.Pending
            ? query.OrderBy(u => u.CreatedAtUtc).ThenBy(u => u.Id)
            : query
                .OrderByDescending(u => u.IsActive && !u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive))))
                .ThenByDescending(u => u.IsActive)
                .ThenBy(u => u.DisplayName)
                .ThenBy(u => u.Id);

        var rows = await ordered
            .Skip(page.Skip)
            .Take(page.PageSize)
            .Select(u => new
            {
                User = u,
                Account = u.Identities.OrderBy(i => i.Id).Select(i => i.Username).FirstOrDefault(),
                HasAccess = u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive))),
                IsAdmin = u.Roles.Any(r => r.Role.IsSystemAdmin && r.Role.IsActive),
                Roles = u.Roles.Select(r => r.Role.Name).OrderBy(n => n).ToList(),
            })
            .ToListAsync(ct);

        var items = rows
            .Select(r => ToSummary(r.User, r.Account, !r.HasAccess, r.IsAdmin, r.Roles))
            .ToList();
        return new PagedResult<UserSummaryDto>(items, total, page.Page, page.PageSize);
    }

    public async Task<UserCountsDto> CountsAsync(CancellationToken ct)
    {
        var active = await Users.CountAsync(u => u.IsActive, ct);
        var inactive = await Users.CountAsync(u => !u.IsActive, ct);
        var pending = await Users.CountAsync(PendingExpr, ct);
        return new UserCountsDto(pending, active, inactive);
    }

    public async Task<Result<UserDetailDto>> GetAsync(int userId, CancellationToken ct)
    {
        var row = await Users
            .Where(u => u.Id == userId)
            .Select(u => new
            {
                User = u,
                Account = u.Identities.OrderBy(i => i.Id).Select(i => i.Username).FirstOrDefault(),
                HasAccess = u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive))),
                Granted = u.Roles.Select(r => new { r.RoleId, r.Role.Name, r.Role.IsSystemAdmin, r.Role.IsActive }).ToList(),
            })
            .FirstOrDefaultAsync(ct);
        if (row is null)
            return NotFoundUser();

        var admin = row.Granted.Any(r => r.IsSystemAdmin && r.IsActive);
        var activeRoleIds = row.Granted.Where(r => r.IsActive).Select(r => r.RoleId).ToList();
        var permissions = admin
            ? await db.Set<Permission>().Where(p => p.IsActive).Select(p => p.Code).ToListAsync(ct)
            : await db.Set<RolePermission>()
                .Where(rp => activeRoleIds.Contains(rp.RoleId) && rp.Permission.IsActive)
                .Select(rp => rp.Permission.Code)
                .Distinct()
                .ToListAsync(ct);

        return new UserDetailDto(
            row.User.Id,
            row.User.DisplayName,
            row.User.Email,
            row.Account,
            row.User.IsActive,
            row.User.IsActive && !row.HasAccess,
            admin,
            row.User.BootstrapAppliedAt is not null,
            row.Granted.Select(r => r.RoleId).Order().ToArray(),
            row.Granted.Select(r => r.Name).Order(StringComparer.OrdinalIgnoreCase).ToArray(),
            permissions.Order(StringComparer.Ordinal).ToArray(),
            Utc(row.User.CreatedAtUtc),
            row.User.LastLoginAt is { } login ? Utc(login) : null,
            Convert.ToBase64String(row.User.RowVersion));
    }

    /// <summary>Replaces the user's roles with <paramref name="roleIds"/> (grants the new ones, revokes the missing ones).</summary>
    public async Task<Result<UserDetailDto>> SetRolesAsync(int userId, IReadOnlyCollection<int> roleIds, string? rowVersion, CancellationToken ct)
    {
        var user = await db.Set<AppUser>().Include(u => u.Roles).ThenInclude(r => r.Role).FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return NotFoundUser();
        if (CheckVersion(user, rowVersion) is { } conflict)
            return conflict;

        var wanted = roleIds.Distinct().ToHashSet();
        var roles = await db.Set<Role>().Where(r => wanted.Contains(r.Id)).ToDictionaryAsync(r => r.Id, ct);
        var missing = wanted.Where(id => !roles.ContainsKey(id)).ToList();
        if (missing.Count > 0)
            return Error.Validation("roleIds", "UNKNOWN_ROLE", $"Unknown role id(s): {string.Join(", ", missing)}.");

        var toRevoke = user.Roles.Where(ur => !wanted.Contains(ur.RoleId)).ToList();
        var toGrant = wanted.Where(id => user.Roles.All(ur => ur.RoleId != id)).ToList();

        if (toRevoke.Any(ur => ur.Role.IsSystemAdmin) && user.IsActive && await WouldLoseLastAdminAsync(userId, ct))
            return AdminGuards.LastAdminError();

        var now = clock.UtcNow;
        foreach (var ur in toRevoke)
        {
            db.Set<UserRole>().Remove(ur);
            audit.Write(RoleEvent("USER_ROLE_REVOKED", userId, ur.Role.Name, null));
        }

        foreach (var id in toGrant)
        {
            db.Set<UserRole>().Add(new UserRole { UserId = userId, RoleId = id, GrantedAt = now, GrantedByUserId = currentUser.UserId });
            audit.Write(RoleEvent("USER_ROLE_GRANTED", userId, null, roles[id].Name));
        }

        if (toRevoke.Count + toGrant.Count > 0)
        {
            user.ModifiedAtUtc = now; // bumps the row version so a stale drawer cannot overwrite this change
            await db.SaveChangesAsync(ct);
            invalidator.InvalidateUser(userId);
        }

        return await GetAsync(userId, ct);
    }

    public async Task<Result<UserDetailDto>> SetActiveAsync(int userId, bool isActive, string? rowVersion, CancellationToken ct)
    {
        if (currentUser.UserId is { } actor && AdminGuards.CheckSelfDeactivation(actor, userId, isActive) is { } self)
            return self;

        var user = await db.Set<AppUser>().Include(u => u.Identities).FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return NotFoundUser();
        if (CheckVersion(user, rowVersion) is { } conflict)
            return conflict;

        if (user.IsActive != isActive)
        {
            if (!isActive && await WouldLoseLastAdminAsync(userId, ct))
                return AdminGuards.LastAdminError();

            user.IsActive = isActive;
            foreach (var identity in user.Identities)
                identity.IsActive = isActive;
            audit.Write(new AuditEntry
            {
                EventType = isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
                ObjectType = "User",
                ObjectId = userId.ToString(),
                Summary = isActive ? "User activated" : "User deactivated",
            });
            await db.SaveChangesAsync(ct);
            invalidator.InvalidateUser(userId);
        }

        return await GetAsync(userId, ct);
    }

    /// <summary>Edits display name and e-mail (needed when the directory lookup is off).</summary>
    public async Task<Result<UserDetailDto>> UpdateProfileAsync(int userId, string displayName, string? email, string? rowVersion, CancellationToken ct)
    {
        var name = displayName.Trim();
        if (name.Length == 0)
            return Error.Validation("displayName", "REQUIRED", "Display name is required.");

        var user = await db.Set<AppUser>().FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return NotFoundUser();
        if (CheckVersion(user, rowVersion) is { } conflict)
            return conflict;

        user.DisplayName = name;
        user.Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
        await db.SaveChangesAsync(ct); // [Audited] AppUser writes the field-level events
        invalidator.InvalidateUser(userId);
        return await GetAsync(userId, ct);
    }

    // Extension point (Pods ticket): pod membership assignment for a user is added by the Organization module, not here.

    private async Task<bool> WouldLoseLastAdminAsync(int userId, CancellationToken ct)
    {
        var activeAdmins = await db.Set<UserRole>()
            .Where(ur => ur.Role.IsSystemAdmin && ur.Role.IsActive && ur.User.IsActive)
            .Select(ur => ur.UserId)
            .Distinct()
            .ToListAsync(ct);
        return AdminGuards.WouldRemoveLastActiveAdmin(userId, activeAdmins);
    }

    private static Error? CheckVersion(AppUser user, string? rowVersion) =>
        rowVersion is not null && !string.Equals(rowVersion, Convert.ToBase64String(user.RowVersion), StringComparison.Ordinal)
            ? Error.Conflict(ErrorCodes.ConcurrencyConflict, "The user was changed by someone else. Reload and try again.")
            : null;

    private static AuditEntry RoleEvent(string type, int userId, string? oldRole, string? newRole) => new()
    {
        EventType = type,
        ObjectType = "User",
        ObjectId = userId.ToString(),
        FieldKey = "role",
        OldValue = oldRole,
        NewValue = newRole,
        Summary = type == "USER_ROLE_GRANTED" ? $"Role '{newRole}' granted" : $"Role '{oldRole}' revoked",
    };

    private static Error NotFoundUser() => Error.NotFound("The user does not exist.");

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static UserSummaryDto ToSummary(AppUser u, string? account, bool pending, bool admin, List<string> roles) => new(
        u.Id,
        u.DisplayName,
        u.Email,
        account,
        u.IsActive,
        u.IsActive && pending,
        admin,
        u.BootstrapAppliedAt is not null,
        roles.ToArray(),
        Utc(u.CreatedAtUtc),
        u.LastLoginAt is { } login ? Utc(login) : null);

    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal).Replace("[", "\\[", StringComparison.Ordinal);
}
