using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.Identity.Seeding;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Application;

/// <summary>
/// Roles and role-permission assignment from the catalog. The built-in System Admin role is read-only and undeletable;
/// a role can be deleted only while unused. Every change is audited and drops all cached effective permissions.
/// </summary>
public sealed class RoleAdministration(DbContext db, IUserAccessInvalidator invalidator, IAuditWriter audit, ICurrentUser currentUser, IPermissionChecker callerPermissions, IClock clock)
{
    public async Task<IReadOnlyList<RoleSummaryDto>> ListAsync(CancellationToken ct)
    {
        var rows = await db.Set<Role>().AsNoTracking()
            .OrderByDescending(r => r.IsSystemAdmin).ThenBy(r => r.Name)
            .Select(r => new
            {
                r.Id,
                r.Name,
                r.Description,
                r.IsSystemAdmin,
                Members = db.Set<UserRole>().Count(ur => ur.RoleId == r.Id),
                Permissions = r.Permissions.Count(rp => rp.Permission.IsActive),
            })
            .ToListAsync(ct);

        var total = await db.Set<Permission>().CountAsync(p => p.IsActive, ct);
        return rows.Select(r => new RoleSummaryDto(r.Id, r.Name, r.Description, r.IsSystemAdmin, r.Members, r.IsSystemAdmin ? total : r.Permissions)).ToList();
    }

    public async Task<Result<RoleDetailDto>> GetAsync(int roleId, CancellationToken ct)
    {
        var role = await db.Set<Role>().AsNoTracking().FirstOrDefaultAsync(r => r.Id == roleId, ct);
        return role is null ? NotFoundRole() : await ToDetailAsync(role, ct);
    }

    public async Task<IReadOnlyList<PermissionGroupDto>> CatalogAsync(CancellationToken ct)
    {
        var rows = await db.Set<Permission>().AsNoTracking().Where(p => p.IsActive).OrderBy(p => p.Id).ToListAsync(ct);

        // Catalog order (contracts/permissions.json), not insertion order: a permission added by a later release keeps its place in its group.
        var order = PermissionCatalog.Load().Select((c, i) => (c.Code, i)).ToDictionary(x => x.Code, x => x.i, StringComparer.Ordinal);
        rows = [.. rows.OrderBy(p => order.GetValueOrDefault(p.Code, int.MaxValue)).ThenBy(p => p.Id)];
        return rows
            .GroupBy(p => p.GroupName)
            .Select(g => new PermissionGroupDto(g.Key, g.Select(p => new PermissionItemDto(p.Code, p.Description)).ToArray()))
            .ToList();
    }

    public async Task<Result<RoleDetailDto>> CreateAsync(CreateRoleRequest request, CancellationToken ct)
    {
        var name = request.Name.Trim();
        if (await NameTakenAsync(name, null, ct))
            return DuplicateName();
        var permissions = await ResolvePermissionsAsync(request.PermissionCodes, ct);
        if (permissions.IsFailure)
            return permissions.Error!;
        if (CheckGrantable(permissions.Value) is { } notGrantable)
            return notGrantable;

        var role = new Role { Name = name, Description = Blank(request.Description), IsActive = true };
        foreach (var p in permissions.Value)
            role.Permissions.Add(new RolePermission { PermissionId = p.Id });
        db.Set<Role>().Add(role);
        audit.Write(new AuditEntry
        {
            EventType = "ROLE_CREATED",
            ObjectType = "Role",
            ObjectIdFactory = () => role.Id.ToString(),
            NewValue = string.Join(", ", permissions.Value.Select(p => p.Code).Order(StringComparer.Ordinal)),
            Summary = $"Role '{name}' created",
        });

        var saved = await SaveAsync(ct);
        if (saved is not null)
            return saved;
        invalidator.InvalidateAll();
        return await ToDetailAsync(role, ct);
    }

    public async Task<Result<RoleDetailDto>> UpdateAsync(int roleId, UpdateRoleRequest request, CancellationToken ct)
    {
        var role = await db.Set<Role>().Include(r => r.Permissions).ThenInclude(rp => rp.Permission).FirstOrDefaultAsync(r => r.Id == roleId, ct);
        if (role is null)
            return NotFoundRole();
        if (role.IsSystemAdmin)
            return SystemRoleLocked();
        if (request.RowVersion != Convert.ToBase64String(role.RowVersion))
            return Error.Conflict(ErrorCodes.ConcurrencyConflict, "The role was changed by someone else. Reload and try again.");

        var name = request.Name.Trim();
        if (await NameTakenAsync(name, roleId, ct))
            return DuplicateName();
        var wanted = await ResolvePermissionsAsync(request.PermissionCodes, ct);
        if (wanted.IsFailure)
            return wanted.Error!;

        var wantedIds = wanted.Value.Select(p => p.Id).ToHashSet();
        var removed = role.Permissions.Where(rp => !wantedIds.Contains(rp.PermissionId)).ToList();
        var added = wanted.Value.Where(p => role.Permissions.All(rp => rp.PermissionId != p.Id)).ToList();
        if (CheckGrantable(added) is { } notGrantable)
            return notGrantable;

        role.Name = name; // field changes (name, description) are written by [Audited] Role
        role.Description = Blank(request.Description);
        foreach (var rp in removed)
        {
            db.Set<RolePermission>().Remove(rp);
            audit.Write(PermissionEvent(roleId, "ROLE_PERMISSION_REMOVED", rp.Permission.Code, null));
        }

        foreach (var p in added)
        {
            role.Permissions.Add(new RolePermission { PermissionId = p.Id });
            audit.Write(PermissionEvent(roleId, "ROLE_PERMISSION_ADDED", null, p.Code));
        }

        role.ModifiedAtUtc = clock.UtcNow; // permission-only edits still bump the row version

        var saved = await SaveAsync(ct);
        if (saved is not null)
            return saved;
        invalidator.InvalidateAll();
        return await ToDetailAsync(role, ct);
    }

    public async Task<Result> DeleteAsync(int roleId, CancellationToken ct)
    {
        var role = await db.Set<Role>().Include(r => r.Permissions).FirstOrDefaultAsync(r => r.Id == roleId, ct);
        if (role is null)
            return NotFoundRole();
        if (role.IsSystemAdmin)
            return SystemRoleLocked();

        var members = await db.Set<UserRole>().CountAsync(ur => ur.RoleId == roleId, ct);
        if (members > 0)
        {
            return Error.Conflict(
                ErrorCodes.RoleInUse,
                $"{members} user(s) have this role. Remove them first.",
                new Dictionary<string, object?> { ["memberCount"] = members });
        }

        db.Set<RolePermission>().RemoveRange(role.Permissions);
        db.Set<Role>().Remove(role);
        audit.Write(new AuditEntry
        {
            EventType = "ROLE_DELETED",
            ObjectType = "Role",
            ObjectId = roleId.ToString(),
            OldValue = role.Name,
            Summary = $"Role '{role.Name}' deleted",
        });
        await db.SaveChangesAsync(ct);
        invalidator.InvalidateAll();
        return Result.Success();
    }

    private async Task<Result<RoleDetailDto>> ToDetailAsync(Role role, CancellationToken ct)
    {
        var codes = role.IsSystemAdmin
            ? await db.Set<Permission>().Where(p => p.IsActive).Select(p => p.Code).ToListAsync(ct)
            : await db.Set<RolePermission>().Where(rp => rp.RoleId == role.Id && rp.Permission.IsActive).Select(rp => rp.Permission.Code).ToListAsync(ct);
        var members = await db.Set<UserRole>().CountAsync(ur => ur.RoleId == role.Id, ct);
        return new RoleDetailDto(
            role.Id,
            role.Name,
            role.Description,
            role.IsSystemAdmin,
            members,
            codes.Order(StringComparer.Ordinal).ToArray(),
            Convert.ToBase64String(role.RowVersion));
    }

    private async Task<Result<List<Permission>>> ResolvePermissionsAsync(IEnumerable<string> codes, CancellationToken ct)
    {
        var wanted = codes.Distinct(StringComparer.Ordinal).ToList();
        var found = await db.Set<Permission>().Where(p => p.IsActive && wanted.Contains(p.Code)).ToListAsync(ct);
        var unknown = wanted.Except(found.Select(p => p.Code), StringComparer.Ordinal).ToList();
        return unknown.Count > 0
            ? Error.Validation("permissionCodes", "UNKNOWN_PERMISSION", $"Unknown permission code(s): {string.Join(", ", unknown)}.")
            : found;
    }

    /// <summary>
    /// "No grant above own level" (SEC-01): unless the caller is a System Admin, every permission newly added to a role must be one the
    /// caller holds. Otherwise a role manager could add <c>User.Manage</c> or <c>Role.Manage</c> to a role they hold and escalate.
    /// </summary>
    private Error? CheckGrantable(IEnumerable<Permission> added)
    {
        if (currentUser.IsSystemAdmin)
            return null;

        var unheld = added.Select(p => p.Code).Where(c => !callerPermissions.Has(c)).Order(StringComparer.Ordinal).ToList();
        return unheld.Count == 0
            ? null
            : Error.Forbidden($"You cannot grant permissions you do not hold yourself: {string.Join(", ", unheld)}.");
    }

    private Task<bool> NameTakenAsync(string name, int? exceptRoleId, CancellationToken ct) =>
        db.Set<Role>().AnyAsync(r => r.Name == name && r.Id != exceptRoleId, ct);

    /// <summary>Saves; a duplicate-name race on the unique index becomes the same 409 as the pre-check. Null on success.</summary>
    private async Task<Error?> SaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return DuplicateName();
        }
    }

    private static AuditEntry PermissionEvent(int roleId, string type, string? oldCode, string? newCode) => new()
    {
        EventType = type,
        ObjectType = "Role",
        ObjectId = roleId.ToString(),
        FieldKey = "permission",
        OldValue = oldCode,
        NewValue = newCode,
        Summary = type == "ROLE_PERMISSION_ADDED" ? $"Permission '{newCode}' added" : $"Permission '{oldCode}' removed",
    };

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static Error NotFoundRole() => Error.NotFound("The role does not exist.");

    private static Error DuplicateName() => Error.Conflict(ErrorCodes.DuplicateName, "A role with this name already exists.");

    private static Error SystemRoleLocked() => Error.Conflict(ErrorCodes.ImmutableField, "The System Admin role is built in and cannot be edited or deleted.");
}
