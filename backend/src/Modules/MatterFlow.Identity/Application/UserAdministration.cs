using System.Linq.Expressions;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.Identity.Pods;
using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using Microsoft.Data.SqlClient;
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

/// <summary>Filters of the users list. The column filters combine with AND; <see cref="Search"/> is the older any-column search.</summary>
/// <param name="Status"><c>all</c>, <c>pending</c>, <c>active</c> or <c>inactive</c> (null = all).</param>
/// <param name="Search">Display name, e-mail or Windows account fragment.</param>
/// <param name="Name">Fragment of the display name only.</param>
/// <param name="Account">Fragment of a Windows account only.</param>
/// <param name="Email">Fragment of the e-mail only.</param>
/// <param name="RoleIds">Only people holding any of these roles.</param>
/// <param name="Availability"><c>AVAILABLE</c>, <c>OUT_OF_OFFICE</c> or <c>OFF_HOURS</c>, evaluated now.</param>
/// <param name="RegisteredFrom">First day (viewer's zone) of the first-seen date.</param>
/// <param name="RegisteredTo">Last day (viewer's zone, inclusive) of the first-seen date.</param>
public sealed record UserListFilter(
    string? Status = null,
    string? Search = null,
    string? Name = null,
    string? Account = null,
    string? Email = null,
    IReadOnlyCollection<int>? RoleIds = null,
    string? Availability = null,
    DateOnly? RegisteredFrom = null,
    DateOnly? RegisteredTo = null);

/// <summary>
/// Users queue and role assignment (architecture 6; baseline 6.4). Every change is audited, invalidates the effective-permission
/// cache and honors the guard rails: no self-deactivation and always at least one active System Admin.
/// </summary>
public sealed class UserAdministration(
    DbContext db,
    IUserAccessInvalidator invalidator,
    IAuditWriter audit,
    ICurrentUser currentUser,
    IPermissionChecker callerPermissions,
    IClock clock,
    IUserAvailabilityReader availability,
    IUserTimeZone timeZone,
    IUserTaskCounts taskCounts)
{
    /// <summary>Access Pending: active with no effective permission (same rule as <c>AccessSnapshot.IsPending</c>).</summary>
    private static readonly Expression<Func<AppUser, bool>> PendingExpr = u =>
        u.IsActive && !u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive)));

    /// <summary>The open-task numbers are task data: only a caller who may see tasks gets them (the UI then drops the sentence).</summary>
    private bool CanSeeTaskCounts => currentUser.IsSystemAdmin || callerPermissions.Has(Permissions.Task.View);

    private IQueryable<AppUser> Users => db.Set<AppUser>().AsNoTracking();

    public async Task<PagedResult<UserSummaryDto>> ListAsync(UserListFilter filter, PageRequest page, CancellationToken ct)
    {
        var status = filter.Status;
        var query = Users;
        query = status switch
        {
            UserListStatuses.Pending => query.Where(PendingExpr),
            UserListStatuses.Active => query.Where(u => u.IsActive),
            UserListStatuses.Inactive => query.Where(u => !u.IsActive),
            _ => query,
        };

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var like = "%" + EscapeLike(filter.Search.Trim()) + "%";
            query = query.Where(u =>
                EF.Functions.Like(u.DisplayName, like, "\\")
                || (u.Email != null && EF.Functions.Like(u.Email, like, "\\"))
                || u.Identities.Any(i => EF.Functions.Like(i.Username, like, "\\")));
        }

        // Column filters (each box searches its own column, parameterised Contains; % and _ are literal).
        if (filter.Name?.Trim() is { Length: > 0 } name)
            query = query.Where(u => u.DisplayName.Contains(name));
        if (filter.Account?.Trim() is { Length: > 0 } account)
            query = query.Where(u => u.Identities.Any(i => i.Username.Contains(account)));
        if (filter.Email?.Trim() is { Length: > 0 } email)
            query = query.Where(u => u.Email != null && u.Email.Contains(email));
        if (filter.RoleIds is { Count: > 0 } roleFilter)
        {
            int[] roleIds = [.. roleFilter.Distinct()];
            query = query.Where(u => u.Roles.Any(ur => roleIds.Contains(ur.RoleId)));
        }

        // Registered between two calendar days of the viewer's zone (the To day is inclusive).
        if (filter.RegisteredFrom is { } from)
        {
            var fromUtc = timeZone.ToUtc(from.ToDateTime(TimeOnly.MinValue));
            query = query.Where(u => u.CreatedAtUtc >= fromUtc);
        }

        if (filter.RegisteredTo is { } to)
        {
            var beforeUtc = to == DateOnly.MaxValue ? DateTime.SpecifyKind(DateTime.MaxValue, DateTimeKind.Utc) : timeZone.ToUtc(to.AddDays(1).ToDateTime(TimeOnly.MinValue));
            query = query.Where(u => u.CreatedAtUtc < beforeUtc);
        }

        // Pending first (oldest waiting first), then active, then inactive; stable by name.
        IOrderedQueryable<AppUser> Ordered(IQueryable<AppUser> source) => status == UserListStatuses.Pending
            ? source.OrderBy(u => u.CreatedAtUtc).ThenBy(u => u.Id)
            : source
                .OrderByDescending(u => u.IsActive && !u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive))))
                .ThenByDescending(u => u.IsActive)
                .ThenBy(u => u.DisplayName)
                .ThenBy(u => u.Id);

        int total;
        IQueryable<AppUser> pageQuery;
        if (filter.Availability is { } wantedState)
        {
            // Availability is worked out in code (schedule, time zone, out-of-office dates), not by a column: evaluate the people the other
            // filters left, in the list's own order, keep the ones in the wanted state and page over those.
            var now = clock.UtcNow;
            var ids = await Ordered(query).Select(u => u.Id).ToListAsync(ct);
            var evaluated = new Dictionary<int, AvailabilityEvaluation>();
            foreach (var chunk in ids.Chunk(500))
            {
                foreach (var (id, evaluation) in await availability.EvaluateAsync(chunk, now, ct))
                    evaluated[id] = evaluation;
            }

            var matching = ids.Where(id => evaluated.TryGetValue(id, out var e) && e.State == wantedState).ToList();
            total = matching.Count;
            int[] pageIds = [.. matching.Skip(page.Skip).Take(page.PageSize)];
            pageQuery = Ordered(query.Where(u => pageIds.Contains(u.Id)));
        }
        else
        {
            total = await query.CountAsync(ct);
            pageQuery = Ordered(query).Skip(page.Skip).Take(page.PageSize);
        }

        var rows = await pageQuery
            .Select(u => new
            {
                User = u,
                Account = u.Identities.OrderBy(i => i.Id).Select(i => i.Username).FirstOrDefault(),
                LastLogin = u.Identities.Max(i => i.LastLoginAt),
                HasAccess = u.Roles.Any(ur => ur.Role.IsActive && (ur.Role.IsSystemAdmin || ur.Role.Permissions.Any(rp => rp.Permission.IsActive))),
                IsAdmin = u.Roles.Any(r => r.Role.IsSystemAdmin && r.Role.IsActive),
                Roles = u.Roles.Select(r => r.Role.Name).OrderBy(n => n).ToList(),
            })
            .ToListAsync(ct);

        var states = await availability.EvaluateAsync(rows.Select(r => r.User.Id).ToArray(), clock.UtcNow, ct);

        // One query for the whole page (no N+1): every membership of the listed users, by Pod name.
        var userIds = rows.Select(r => r.User.Id).ToList();
        var podRows = await db.Set<PodMember>().AsNoTracking()
            .Where(m => userIds.Contains(m.UserId))
            .OrderBy(m => m.Pod.Name)
            .Select(m => new { m.UserId, Pod = new UserPodDto(m.PodId, m.Pod.Name, m.Pod.IsActive, m.IsPrimary) })
            .ToListAsync(ct);
        var podsByUser = podRows.ToLookup(p => p.UserId, p => p.Pod);

        // One grouped statement for the page; without Task.View the number is left out, never shown as 0.
        var openTasks = CanSeeTaskCounts ? await taskCounts.OpenByAssigneeAsync(userIds, ct) : null;

        var items = rows
            .Select(r => ToSummary(r.User, r.Account, r.LastLogin, !r.HasAccess, r.IsAdmin, r.Roles, podsByUser[r.User.Id].ToArray())
                with
            { Availability = UserAvailabilitySummary.From(states[r.User.Id]), OpenTaskCount = openTasks is null ? null : openTasks.GetValueOrDefault(r.User.Id) })
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
                LastLogin = u.Identities.Max(i => i.LastLoginAt),
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
            row.LastLogin is { } login ? Utc(login) : null,
            Convert.ToBase64String(row.User.RowVersion),
            CanSeeTaskCounts ? (await taskCounts.OpenByAssigneeAsync([userId], ct)).GetValueOrDefault(userId) : null);
    }

    /// <summary>
    /// Replaces the user's roles with <paramref name="roleIds"/> (grants the new ones, revokes the missing ones).
    /// Privilege rules (SEC-01, permission-matrix PM-X-12): only a System Admin may grant or revoke the System Admin role, and a
    /// caller may only grant a role whose permissions the caller holds themselves ("no grant above own level").
    /// </summary>
    public Task<Result<UserDetailDto>> SetRolesAsync(int userId, IReadOnlyCollection<int> roleIds, string? rowVersion, CancellationToken ct) =>
        InAdminGuardAsync(() => SetRolesCoreAsync(userId, roleIds, rowVersion, ct), ct);

    private async Task<Result<UserDetailDto>> SetRolesCoreAsync(int userId, IReadOnlyCollection<int> roleIds, string? rowVersion, CancellationToken ct)
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

        if (!currentUser.IsSystemAdmin
            && (toRevoke.Any(ur => ur.Role.IsSystemAdmin) || toGrant.Any(id => roles[id].IsSystemAdmin)))
        {
            return Error.Forbidden("Only a System Admin can grant or revoke the System Admin role.");
        }

        if (!currentUser.IsSystemAdmin && toGrant.Count > 0 && await FirstUnheldPermissionAsync(toGrant, ct) is { } unheld)
            return Error.Forbidden($"You cannot grant a role that carries the permission '{unheld}', which you do not hold yourself.");

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

    /// <summary>The first permission carried by the given roles that the caller does not hold, or null when the caller covers all of them.</summary>
    private async Task<string?> FirstUnheldPermissionAsync(IReadOnlyCollection<int> roleIds, CancellationToken ct)
    {
        var codes = await db.Set<RolePermission>()
            .Where(rp => roleIds.Contains(rp.RoleId) && rp.Permission.IsActive)
            .Select(rp => rp.Permission.Code)
            .Distinct()
            .ToListAsync(ct);
        return codes.Order(StringComparer.Ordinal).FirstOrDefault(c => !callerPermissions.Has(c));
    }

    public Task<Result<UserDetailDto>> SetActiveAsync(int userId, bool isActive, string? rowVersion, CancellationToken ct) =>
        InAdminGuardAsync(() => SetActiveCoreAsync(userId, isActive, rowVersion, ct), ct);

    private async Task<Result<UserDetailDto>> SetActiveCoreAsync(int userId, bool isActive, string? rowVersion, CancellationToken ct)
    {
        if (currentUser.UserId is { } actor && AdminGuards.CheckSelfDeactivation(actor, userId, isActive) is { } self)
            return self;

        var user = await db.Set<AppUser>().FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return NotFoundUser();
        if (CheckVersion(user, rowVersion) is { } conflict)
            return conflict;

        if (user.IsActive != isActive)
        {
            // A System Admin account can only be switched off or on by another System Admin (SEC-01 hardening).
            if (!currentUser.IsSystemAdmin && await IsSystemAdminAsync(userId, ct))
                return Error.Forbidden("Only a System Admin can activate or deactivate a System Admin.");

            if (!isActive && await WouldLoseLastAdminAsync(userId, ct))
                return AdminGuards.LastAdminError();

            user.IsActive = isActive;
            // Set-based so a concurrent sign-in (which touches the identity row) cannot fail this save; same transaction.
            await db.Set<UserIdentity>().Where(i => i.UserId == userId).ExecuteUpdateAsync(s => s.SetProperty(i => i.IsActive, isActive), ct);
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

    private Task<bool> IsSystemAdminAsync(int userId, CancellationToken ct) =>
        db.Set<UserRole>().AnyAsync(ur => ur.UserId == userId && ur.Role.IsSystemAdmin, ct);

    /// <summary>
    /// Runs an admin-affecting operation (role change, activation) under an exclusive application lock inside one transaction, so the
    /// "at least one active System Admin" check and the write cannot interleave with another admin's operation (SEC-03). The lock is
    /// released at commit or rollback. A deadlock victim (SQL 1205) becomes a retryable 409 instead of a 500 (SEC-17).
    /// </summary>
    private async Task<Result<UserDetailDto>> InAdminGuardAsync(Func<Task<Result<UserDetailDto>>> operation, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is not null)
            return await operation();

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await AdminGuardLock.AcquireAsync(db, ct);
            var result = await operation();
            if (result.IsFailure)
            {
                await transaction.RollbackAsync(ct);
                return result;
            }

            await transaction.CommitAsync(ct);
            return result;
        }
        catch (Exception ex) when (ex is SqlException { Number: 1205 } || ex.InnerException is SqlException { Number: 1205 })
        {
            return Error.Conflict(ErrorCodes.ConcurrencyConflict, "The system was busy with another administrative change. Reload and try again.");
        }
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
        !string.Equals(rowVersion, Convert.ToBase64String(user.RowVersion), StringComparison.Ordinal)
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

    private static UserSummaryDto ToSummary(AppUser u, string? account, DateTime? lastLogin, bool pending, bool admin, List<string> roles, UserPodDto[] pods) => new(
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
        lastLogin is { } login ? Utc(login) : null,
        pods);

    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal).Replace("[", "\\[", StringComparison.Ordinal);
}
