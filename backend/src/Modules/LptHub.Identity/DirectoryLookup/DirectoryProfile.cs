using System.Runtime.Versioning;
using MatterFlow.Identity.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MatterFlow.Identity.DirectoryLookup;

/// <summary>Profile attributes read from the directory.</summary>
public sealed record DirectoryProfile(string? DisplayName, string? Email);

/// <summary>Optional profile enrichment at first login. Implementations must never throw; null means "nothing found".</summary>
public interface IDirectoryProfileProvider
{
    Task<DirectoryProfile?> LookupAsync(ExternalIdentity identity, CancellationToken cancellationToken);
}

/// <summary>Settings (<c>ActiveDirectory:*</c>, addendum L).</summary>
public sealed class ActiveDirectoryOptions
{
    /// <summary>Off by default: the lookup reads AD with the web app's own identity, which IT may not have provisioned.</summary>
    public bool LookupEnabled { get; set; }
}

/// <summary>Used when the lookup is disabled or the platform cannot do it.</summary>
public sealed class NoOpDirectoryProfileProvider : IDirectoryProfileProvider
{
    public Task<DirectoryProfile?> LookupAsync(ExternalIdentity identity, CancellationToken cancellationToken) =>
        Task.FromResult<DirectoryProfile?>(null);
}

/// <summary>
/// Reads display name and e-mail from Active Directory (Windows only; elsewhere, for non-Windows identities, and on any failure it
/// returns null so the caller falls back to <c>DOMAIN\sam</c>).
/// </summary>
public sealed class ActiveDirectoryProfileProvider(IOptions<ActiveDirectoryOptions> options, ILogger<ActiveDirectoryProfileProvider> logger)
    : IDirectoryProfileProvider
{
    public Task<DirectoryProfile?> LookupAsync(ExternalIdentity identity, CancellationToken cancellationToken)
    {
        if (!options.Value.LookupEnabled || identity.Provider != "Windows" || !OperatingSystem.IsWindows())
            return Task.FromResult<DirectoryProfile?>(null);

        try
        {
            return Task.FromResult(Lookup(identity));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Active Directory lookup failed for {Username}; using the account name as display name.", identity.Username);
            return Task.FromResult<DirectoryProfile?>(null);
        }
    }

    [SupportedOSPlatform("windows")]
    private static DirectoryProfile? Lookup(ExternalIdentity identity)
    {
        using var context = new System.DirectoryServices.AccountManagement.PrincipalContext(System.DirectoryServices.AccountManagement.ContextType.Domain);
        using var user = System.DirectoryServices.AccountManagement.UserPrincipal.FindByIdentity(
            context,
            System.DirectoryServices.AccountManagement.IdentityType.Sid,
            identity.Subject);
        return user is null ? null : new DirectoryProfile(user.DisplayName, user.EmailAddress);
    }
}
