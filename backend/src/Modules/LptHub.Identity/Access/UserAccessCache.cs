using System.Collections.Concurrent;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Time;
using Microsoft.Extensions.Options;

namespace MatterFlow.Identity.Access;

/// <summary>Settings of the effective-permission cache (<c>Authorization:*</c>).</summary>
public sealed class AccessCacheOptions
{
    /// <summary>Time-to-live of a cached snapshot; invalidation makes changes effective immediately on this node (default 60 s).</summary>
    public int CacheSeconds { get; set; } = 60;
}

/// <summary>
/// Per-user cache of <see cref="AccessSnapshot"/> keyed by external identity. Entries expire after a fixed TTL and are dropped
/// immediately by <see cref="IUserAccessInvalidator"/> when roles, grants or user status change. A generation counter makes a load
/// that raced with an invalidation discard its (possibly stale) result instead of caching it.
/// </summary>
public sealed class UserAccessCache(IClock clock, IOptions<AccessCacheOptions> options) : IUserAccessInvalidator
{
    private readonly ConcurrentDictionary<string, Entry> _entries = new();
    private long _generation;

    /// <summary>Capture before loading; pass to <see cref="Set"/> so a concurrent invalidation wins.</summary>
    public long Generation => Interlocked.Read(ref _generation);

    public bool TryGet(string key, out AccessSnapshot snapshot)
    {
        if (_entries.TryGetValue(key, out var entry))
        {
            if (entry.ExpiresAtUtc > clock.UtcNow)
            {
                snapshot = entry.Snapshot;
                return true;
            }

            _entries.TryRemove(new KeyValuePair<string, Entry>(key, entry));
        }

        snapshot = null!;
        return false;
    }

    public void Set(string key, AccessSnapshot snapshot, long generationAtLoadStart)
    {
        if (generationAtLoadStart != Generation)
            return;

        _entries[key] = new Entry(snapshot, clock.UtcNow.AddSeconds(options.Value.CacheSeconds));
    }

    public void InvalidateUser(int userId)
    {
        Interlocked.Increment(ref _generation);
        foreach (var (key, entry) in _entries)
        {
            if (entry.Snapshot.UserId == userId)
                _entries.TryRemove(key, out _);
        }
    }

    public void InvalidateAll()
    {
        Interlocked.Increment(ref _generation);
        _entries.Clear();
    }

    private sealed record Entry(AccessSnapshot Snapshot, DateTime ExpiresAtUtc);
}
