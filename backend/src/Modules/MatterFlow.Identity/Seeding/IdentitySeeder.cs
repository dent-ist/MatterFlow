using MatterFlow.Identity.Access;
using MatterFlow.Identity.Authentication;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace MatterFlow.Identity.Seeding;

/// <summary>A user defined in <c>Dev:Users</c> (Dev provider only).</summary>
public sealed class DevUserConfig
{
    public string Username { get; set; } = string.Empty;

    public string? DisplayName { get; set; }

    public string? Email { get; set; }

    public string[] Roles { get; set; } = [];
}

/// <summary>
/// Startup seeding, run after the schema scripts and idempotent (architecture 4.6): syncs the permission catalog, creates the
/// starter roles on first install only, and (Dev provider) the configured dev users.
/// </summary>
public sealed class IdentitySeeder(
    DbContext db,
    IClock clock,
    IConfiguration configuration,
    IHostEnvironment environment,
    UserAccessCache cache,
    ILogger<IdentitySeeder> logger)
{
    public async Task SeedAsync(CancellationToken ct = default)
    {
        await SyncPermissionCatalogAsync(PermissionCatalog.Load(), ct);
        await SeedStarterRolesAsync(ct);
        if (AuthProviderSelection.Resolve(configuration, environment) == AuthProvider.Dev)
            await SeedDevUsersAsync(ct);

        cache.InvalidateAll();
    }

    /// <summary>Inserts new codes, refreshes group/description, and marks codes removed from the catalog inactive.</summary>
    public async Task SyncPermissionCatalogAsync(IReadOnlyList<PermissionDefinition> catalog, CancellationToken ct)
    {
        var existing = await db.Set<Permission>().ToDictionaryAsync(p => p.Code, StringComparer.Ordinal, ct);
        foreach (var def in catalog)
        {
            if (!existing.TryGetValue(def.Code, out var row))
            {
                db.Set<Permission>().Add(new Permission { Code = def.Code, GroupName = def.Group, Description = def.Description, IsActive = true });
                continue;
            }

            row.GroupName = def.Group;
            row.Description = def.Description;
            row.IsActive = true;
        }

        var inCatalog = catalog.Select(c => c.Code).ToHashSet(StringComparer.Ordinal);
        foreach (var row in existing.Values.Where(r => !inCatalog.Contains(r.Code)))
            row.IsActive = false;

        await db.SaveChangesAsync(ct);
    }

    /// <summary>Creates the starter roles only when no non-system role exists, so admin edits are never overwritten.</summary>
    public async Task SeedStarterRolesAsync(CancellationToken ct)
    {
        if (await db.Set<Role>().AnyAsync(r => !r.IsSystemAdmin, ct))
            return;

        var permissionIds = await db.Set<Permission>().Where(p => p.IsActive).ToDictionaryAsync(p => p.Code, p => p.Id, StringComparer.Ordinal, ct);
        foreach (var starter in StarterRoles.All)
        {
            var role = new Role { Name = starter.Name, Description = starter.Description, IsActive = true };
            foreach (var code in starter.Permissions.Distinct())
            {
                if (permissionIds.TryGetValue(code, out var permissionId))
                    role.Permissions.Add(new RolePermission { PermissionId = permissionId });
                else
                    logger.LogWarning("Starter role {Role} references unknown permission {Code}.", starter.Name, code);
            }

            db.Set<Role>().Add(role);
        }

        await db.SaveChangesAsync(ct);
        logger.LogInformation("Seeded {Count} starter roles.", StarterRoles.All.Count);
    }

    /// <summary>Creates users from <c>Dev:Users</c> with their roles. Existing identities are left untouched.</summary>
    public async Task SeedDevUsersAsync(CancellationToken ct)
    {
        var users = configuration.GetSection("Dev:Users").Get<DevUserConfig[]>() ?? [];
        var roles = await db.Set<Role>().ToDictionaryAsync(r => r.Name, StringComparer.OrdinalIgnoreCase, ct);
        foreach (var config in users.Where(u => !string.IsNullOrWhiteSpace(u.Username)))
        {
            var username = config.Username.Trim();
            var subject = username.ToLowerInvariant();
            var exists = await db.Set<UserIdentity>().AnyAsync(
                i => i.Provider == DevAuthOptions.SchemeName && i.TenantId == string.Empty && i.ProviderSubject == subject, ct);
            if (exists)
                continue;

            var user = new AppUser
            {
                DisplayName = string.IsNullOrWhiteSpace(config.DisplayName) ? username : config.DisplayName.Trim(),
                Email = config.Email,
                IsActive = true,
            };
            db.Set<UserIdentity>().Add(new UserIdentity
            {
                User = user,
                Provider = DevAuthOptions.SchemeName,
                ProviderSubject = subject,
                Username = username,
                IsActive = true,
                VerifiedAt = clock.UtcNow,
            });
            foreach (var roleName in config.Roles)
            {
                if (roles.TryGetValue(roleName, out var role))
                    user.Roles.Add(new UserRole { Role = role, GrantedAt = clock.UtcNow });
                else
                    logger.LogWarning("Dev user {Username} references unknown role {Role}.", username, roleName);
            }
        }

        await db.SaveChangesAsync(ct);
    }
}

public static class IdentitySeederExtensions
{
    /// <summary>Runs the Identity startup seed in its own scope. Call after schema migrations.</summary>
    public static async Task SeedIdentityAsync(this IServiceProvider services, CancellationToken ct = default)
    {
        await using var scope = services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IdentitySeeder>().SeedAsync(ct);
    }
}
