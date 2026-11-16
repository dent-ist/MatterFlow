using System.Security.Cryptography;
using LptHub.SharedKernel.Results;
using Microsoft.AspNetCore.DataProtection;

namespace LptHub.Integrations.Application;

/// <summary>Encrypts and decrypts the client secret. The key ring is NOT in the database: it lives in the Data Protection key store (<c>DataProtection:KeysPath</c>, docs/runbook.md).</summary>
public interface ISecretProtector
{
    /// <summary>Encrypts a secret for storage; fails with <c>SECRET_STORE_UNAVAILABLE</c> when no key store is configured for this environment.</summary>
    Result<string> Protect(string secret);

    /// <summary>Decrypts a stored secret; fails with <c>SECRET_STORE_UNAVAILABLE</c> when the keys at hand cannot read it (key ring lost or moved).</summary>
    Result<string> Unprotect(string protectedText);
}

/// <summary>Whether the host has a durable key store. Production without <c>DataProtection:KeysPath</c> has none: nothing is encrypted rather than encrypted with a key that is lost on restart.</summary>
public sealed record KeyStoreStatus(bool IsConfigured);

public sealed class DataProtectionSecretProtector(IDataProtectionProvider provider, KeyStoreStatus keyStore) : ISecretProtector
{
    /// <summary>The purpose string separates this use of the key ring from every other (changing it makes every stored secret unreadable).</summary>
    public const string Purpose = "LptHub.Integrations.EntraClientSecret.v1";

    private readonly IDataProtector _protector = provider.CreateProtector(Purpose);

    public Result<string> Protect(string secret) =>
        keyStore.IsConfigured
            ? _protector.Protect(secret)
            : Unavailable("The key store for the client secret is not configured on this server. Ask IT to set DataProtection:KeysPath (docs/runbook.md).");

    public Result<string> Unprotect(string protectedText)
    {
        try
        {
            return _protector.Unprotect(protectedText);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return Unavailable("The stored client secret can no longer be read (the key ring changed). Set the client secret again.");
        }
    }

    private static Error Unavailable(string message) => Error.Conflict(ErrorCodes.SecretStoreUnavailable, message);
}
