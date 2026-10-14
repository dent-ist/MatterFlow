using System.Security.Claims;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Authentication;
using MatterFlow.Identity.DirectoryLookup;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Time;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MatterFlow.Identity.Access;

/// <summary>Settings of the controlled first-admin procedure (<c>Bootstrap:*</c>, architecture 6.4).</summary>
public sealed class BootstrapOptions
{
    /// <summary>Account names (<c>DOMAIN\sam</c>, case-insensitive) that receive System Admin once, at their first resolution.</summary>
    public string[] SystemAdmins { get; set; } = [];
}

/// <summary>Turns an authenticated principal into an <see cref="AccessSnapshot"/>: lookup, JIT provisioning, bootstrap, effective permissions.</summary>
public interface IUserResolver
{
    /// <summary>Null when the principal carries no usable external identity.</summary>
    Task<AccessSnapshot?> ResolveAsync(ClaimsPrincipal principal, CancellationToken cancellationToken = default);
}

public sealed class UserResolver(
    DbContext db,
    UserAccessCache cache,
    IDirectoryProfileProvider directory,
    IClock clock,
    IAuditWriter audit,
    IOptions<BootstrapOptions> bootstrap,
    ILogger<UserResolver> logger) : IUserResolver
{
    private const int MaxAttempts = 3;

    /// <summary>Last-login bookkeeping is written at most this often per identity (it is a database write on a cache miss).</summary>
    private static readonly TimeSpan LastLoginGranularity = TimeSpan.FromMinutes(5);

    public async Task<AccessSnapshot?> ResolveAsync(ClaimsPrincipal principal, CancellationToken cancellationToken = default)
    {
        var external = ExternalIdentityAccessor.From(principal);
        if (external is null)
            return null;

        if (cache.TryGet(external.CacheKey, out var cached))
            return cached;

        var generation = cache.Generation;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                var snapshot = await LoadOrProvisionAsync(external, cancellationToken);
                cache.Set(external.CacheKey, snapshot, generation);
                return snapshot;
            }
            catch (DbUpdateException ex) when ((IsDuplicateKey(ex) || ex is DbUpdateConcurrencyException) && attempt < MaxAttempts)
            {
                // A concurrent first request won the unique index or the row version (identity or bootstrap grant); re-read what it wrote.
                // The audit entries of the failed attempt were re-queued by the interceptor; they describe changes that did not happen.
                db.ChangeTracker.Clear();
                audit.DiscardPending();
            }
        }
    }

    private async Task<AccessSnapshot> LoadOrProvisionAsync(ExternalIdentity external, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var identity = await db.Set<UserIdentity>()
            .Include(i => i.User)
            .FirstOrDefaultAsync(
                i => i.Provider == external.Provider && i.TenantId == external.TenantId && i.ProviderSubject == external.Subject,
                ct);

        if (identity is null)
        {
            var profile = await directory.LookupAsync(external, ct);
            var user = new AppUser
            {
                DisplayName = FirstNonBlank(external.DisplayName, profile?.DisplayName, external.Username)!,
                Email = FirstNonBlank(external.Email, profile?.Email),
                IsActive = true,
            };
            identity = new UserIdentity
            {
                User = user,
                Provider = external.Provider,
                TenantId = external.TenantId,
                ProviderSubject = external.Subject,
                Username = external.Username,
                IsActive = true,
                VerifiedAt = now,
            };
            db.Set<UserIdentity>().Add(identity);
            audit.Write(new AuditEntry
            {
                EventType = "USER_PROVISIONED",
                ObjectType = "User",
                ObjectIdFactory = () => user.Id.ToString(),
                NewValue = external.Username,
                Summary = $"User provisioned at first sign-in ({external.Provider}) with no roles",
            });
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Provisioned user {UserId} for {Provider} identity {Username} with no roles (access pending).", user.Id, external.Provider, external.Username);
            if (external.Provider == "Windows" && !external.Subject.StartsWith("S-1-", StringComparison.Ordinal))
            {
                logger.LogWarning("User {UserId} was keyed on the account name {Username}, not a Windows SID: the host did not supply a primary-SID claim, so the identity key is weaker.", user.Id, external.Username);
            }
        }

        var appUser = identity.User;
        if (identity.IsActive && appUser.IsActive)
        {
            if (appUser.BootstrapAppliedAt is null && IsBootstrapAdmin(external.Username))
            {
                if (await ApplyBootstrapAsync(appUser, external, ct))
                    await db.SaveChangesAsync(ct);
            }

            if (!string.Equals(identity.Username, external.Username, StringComparison.Ordinal))
            {
                // A changed account name (rename in the directory) is recorded, because the bootstrap list and the audit trail show names.
                audit.Write(new AuditEntry
                {
                    EventType = "USER_IDENTITY_RENAMED",
                    ObjectType = "User",
                    ObjectId = appUser.Id.ToString(),
                    FieldKey = "username",
                    OldValue = identity.Username,
                    NewValue = external.Username,
                    Summary = $"Account name changed from '{identity.Username}' to '{external.Username}'",
                });
                identity.Username = external.Username;
                await db.SaveChangesAsync(ct);
            }

            // Bookkeeping that must not conflict with concurrent logins or admin edits: a plain update without a row-version check.
            if (identity.LastLoginAt is not { } last || now - last >= LastLoginGranularity)
                await db.Set<UserIdentity>().Where(i => i.Id == identity.Id).ExecuteUpdateAsync(s => s.SetProperty(i => i.LastLoginAt, now), ct);
        }

        // Detach everything the resolution loaded, so the rest of the request re-reads current rows instead of reusing entities that a
        // set-based update has made stale (SEC-13).
        var snapshot = await BuildSnapshotAsync(identity, ct);
        db.ChangeTracker.Clear();
        return snapshot;
    }

    /// <summary>
    /// Grants System Admin from <c>Bootstrap:SystemAdmins</c> (security review SEC-06): only while the system has no active System Admin,
    /// and once per user. The bootstrap list is matched on the account name, which is mutable and can be recycled, so it is a recovery
    /// and first-install mechanism and not a standing entitlement. Returns true when changes were made that need saving.
    /// </summary>
    private async Task<bool> ApplyBootstrapAsync(AppUser user, ExternalIdentity external, CancellationToken ct)
    {
        var adminRoleId = await db.Set<Role>().Where(r => r.IsSystemAdmin).Select(r => (int?)r.Id).FirstOrDefaultAsync(ct);
        if (adminRoleId is null)
        {
            logger.LogError("Bootstrap admin {DisplayName} cannot be granted: the System Admin role row is missing.", user.DisplayName);
            return false;
        }

        var hasActiveAdmin = await db.Set<UserRole>().AnyAsync(ur => ur.RoleId == adminRoleId && ur.User.IsActive, ct);
        if (hasActiveAdmin)
        {
            logger.LogWarning(
                "Bootstrap:SystemAdmins lists {Username} but the system already has an active System Admin; not granting System Admin to user {UserId}.",
                external.Username,
                user.Id);
            return false;
        }

        if (!await db.Set<UserRole>().AnyAsync(ur => ur.UserId == user.Id && ur.RoleId == adminRoleId, ct))
            db.Set<UserRole>().Add(new UserRole { UserId = user.Id, RoleId = adminRoleId.Value, GrantedAt = clock.UtcNow });

        user.BootstrapAppliedAt = clock.UtcNow;
        audit.Write(new AuditEntry
        {
            EventType = "ADMIN_BOOTSTRAPPED",
            ObjectType = "User",
            ObjectId = user.Id.ToString(),
            FieldKey = "role",
            NewValue = "System Admin",
            Summary = $"System Admin granted from Bootstrap:SystemAdmins to '{external.Username}'",
        });
        logger.LogWarning("ADMIN_BOOTSTRAPPED: user {UserId} ({DisplayName}) granted System Admin from Bootstrap:SystemAdmins.", user.Id, user.DisplayName);
        return true;
    }

    private bool IsBootstrapAdmin(string username) =>
        bootstrap.Value.SystemAdmins.Any(a => string.Equals(a?.Trim(), username.Trim(), StringComparison.OrdinalIgnoreCase));

    private async Task<AccessSnapshot> BuildSnapshotAsync(UserIdentity identity, CancellationToken ct)
    {
        var user = identity.User;
        var roles = await db.Set<UserRole>()
            .Where(ur => ur.UserId == user.Id && ur.Role.IsActive)
            .Select(ur => new { ur.Role.Id, ur.Role.Name, ur.Role.IsSystemAdmin })
            .AsNoTracking()
            .ToListAsync(ct);

        var isSystemAdmin = roles.Any(r => r.IsSystemAdmin);
        List<string> codes;
        if (isSystemAdmin)
        {
            codes = await db.Set<Domain.Permission>().Where(p => p.IsActive).Select(p => p.Code).AsNoTracking().ToListAsync(ct);
        }
        else
        {
            var roleIds = roles.Select(r => r.Id).ToList();
            codes = await db.Set<RolePermission>()
                .Where(rp => roleIds.Contains(rp.RoleId) && rp.Permission.IsActive)
                .Select(rp => rp.Permission.Code)
                .Distinct()
                .AsNoTracking()
                .ToListAsync(ct);
        }

        return new AccessSnapshot(
            user.Id,
            user.DisplayName,
            user.Email,
            identity.Username,
            DateTime.SpecifyKind(user.CreatedAtUtc, DateTimeKind.Utc),
            user.IsActive && identity.IsActive,
            isSystemAdmin,
            roles.Select(r => r.Name).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList(),
            codes.ToHashSet(StringComparer.Ordinal));
    }

    private static bool IsDuplicateKey(DbUpdateException ex) =>
        ex.InnerException is SqlException { Number: 2601 or 2627 };

    private static string? FirstNonBlank(params string?[] values) => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim();
}
