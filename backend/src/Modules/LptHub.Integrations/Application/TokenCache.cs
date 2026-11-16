using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using LptHub.Integrations.Contracts;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Time;
using Microsoft.Extensions.Options;

namespace LptHub.Integrations.Application;

/// <summary>
/// Keeps access tokens in memory only (never written to the database, a file or a log). A token is reused until <c>RefreshBeforeExpirySeconds</c> before it expires, then replaced; one request per
/// scope refreshes it while others wait for the same answer. The key is a hash of tenant, client, scope and the time the secret was set, so a changed credential never reuses an old token.
/// </summary>
public sealed class TokenCache(IClock clock, IOptions<IntegrationsOptions> options)
{
    private readonly ConcurrentDictionary<string, AccessToken> _tokens = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

    /// <summary>Forgets every token (a credential or a scope changed).</summary>
    public void Clear() => _tokens.Clear();

    /// <summary>The number of tokens held (tests).</summary>
    public int Count => _tokens.Count;

    public static string KeyOf(string tenantId, string clientId, string scope, DateTime? secretSetAtUtc) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{tenantId}|{clientId}|{scope}|{secretSetAtUtc?.Ticks}")));

    public async Task<Result<AccessToken>> GetAsync(string key, Func<CancellationToken, Task<Result<AccessToken>>> request, bool forceNew, CancellationToken ct)
    {
        if (!forceNew && TryFresh(key, out var cached))
            return cached;

        var gate = _locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            if (!forceNew && TryFresh(key, out cached))
                return cached;

            var result = await request(ct);
            if (result.IsSuccess)
                _tokens[key] = result.Value;
            else
                _tokens.TryRemove(key, out _);

            return result;
        }
        finally
        {
            gate.Release();
        }
    }

    private bool TryFresh(string key, out AccessToken token)
    {
        if (_tokens.TryGetValue(key, out var found) && found.ExpiresAtUtc - TimeSpan.FromSeconds(options.Value.RefreshBeforeExpirySeconds) > clock.UtcNow)
        {
            token = found;
            return true;
        }

        token = null!;
        return false;
    }
}
