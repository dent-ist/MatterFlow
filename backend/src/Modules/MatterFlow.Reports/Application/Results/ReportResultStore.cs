using System.Collections.Concurrent;
using Microsoft.Extensions.Options;

namespace MatterFlow.Reports.Application.Results;

/// <summary>A cached result and who owns it.</summary>
public sealed record StoredResult(Guid RunId, int OwnerUserId, int ReportId, ResultTable Table, bool Truncated, DateTime CreatedUtc);

/// <summary>What a lookup of a cached result found.</summary>
public enum ResultLookup
{
    Found,

    /// <summary>Unknown id, or another person's result: indistinguishable on purpose (404).</summary>
    NotFound,

    /// <summary>The caller's own result that expired or was evicted (410): run the report again.</summary>
    Expired,
}

/// <summary>
/// The in-memory cache of finished results (spec 6.4): at most one live result per person (a new run replaces the old one), a sliding idle
/// lifetime (default 15 minutes) with an absolute maximum (60), and a memory budget for all results together (default 512 MB) that drops the
/// oldest results first. An id belongs to its owner: anyone else gets "not found". A result lost to expiry, eviction or an application
/// recycle answers "expired" so the page can offer "Run again".
/// </summary>
public sealed class ReportResultStore : IReportResultSink
{
    private const int TombstoneLimit = 5000;

    private readonly ReportsOptions _options;
    private readonly TimeProvider _time;
    private readonly object _gate = new();
    private readonly Dictionary<int, Entry> _byUser = [];
    private readonly ConcurrentDictionary<Guid, (int Owner, DateTime At)> _tombstones = new();

    public ReportResultStore(IOptions<ReportsOptions> options, TimeProvider time)
    {
        _options = options.Value;
        _time = time;
    }

    private sealed class Entry(StoredResult result, DateTime lastAccess)
    {
        public StoredResult Result { get; } = result;

        public DateTime LastAccessUtc { get; set; } = lastAccess;
    }

    private long BudgetBytes => (long)_options.ResultMemoryBudgetMegabytes * 1024 * 1024;

    /// <summary>Bytes held by all cached results.</summary>
    public long UsedBytes
    {
        get
        {
            lock (_gate)
                return _byUser.Values.Sum(e => e.Result.Table.EstimatedBytes);
        }
    }

    public int Count
    {
        get
        {
            lock (_gate)
                return _byUser.Count;
        }
    }

    public IRowSink CreateSink(int maxRows) => new ResultTableBuilder(maxRows, BudgetBytes);

    public Guid? Complete(IRowSink sink, int ownerUserId, int reportId, bool truncated)
    {
        var builder = (ResultTableBuilder)sink;
        if (builder.OverBudget)
            return null;
        return Put(ownerUserId, reportId, builder.Build(), truncated);
    }

    /// <summary>Stores a result for its owner, replacing the owner's previous one and dropping the oldest results of others if the budget needs room. Null when it cannot fit at all.</summary>
    public Guid? Put(int ownerUserId, int reportId, ResultTable table, bool truncated)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        lock (_gate)
        {
            SweepLocked(now);
            if (_byUser.Remove(ownerUserId, out var previous))
                Tombstone(previous.Result, now);

            if (table.EstimatedBytes > BudgetBytes)
                return null;

            while (_byUser.Values.Sum(e => e.Result.Table.EstimatedBytes) + table.EstimatedBytes > BudgetBytes && _byUser.Count > 0)
            {
                var oldest = _byUser.Values.MinBy(e => e.Result.CreatedUtc)!;
                _byUser.Remove(oldest.Result.OwnerUserId);
                Tombstone(oldest.Result, now);
            }

            var stored = new StoredResult(Guid.NewGuid(), ownerUserId, reportId, table, truncated, now);
            _byUser[ownerUserId] = new Entry(stored, now);
            return stored.RunId;
        }
    }

    /// <summary>Finds the caller's result; touching it extends its idle lifetime.</summary>
    public (ResultLookup Status, StoredResult? Result) Get(int userId, Guid runId)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        lock (_gate)
        {
            SweepLocked(now);
            if (_byUser.TryGetValue(userId, out var entry) && entry.Result.RunId == runId)
            {
                entry.LastAccessUtc = now;
                return (ResultLookup.Found, entry.Result);
            }
        }

        return _tombstones.TryGetValue(runId, out var t) && t.Owner == userId ? (ResultLookup.Expired, null) : (ResultLookup.NotFound, null);
    }

    /// <summary>Drops the caller's result. True when it existed.</summary>
    public bool Drop(int userId, Guid runId)
    {
        lock (_gate)
        {
            if (_byUser.TryGetValue(userId, out var entry) && entry.Result.RunId == runId)
            {
                _byUser.Remove(userId);
                return true;
            }
        }

        return false;
    }

    /// <summary>Drops results that outlived their idle or absolute lifetime. Also called by the background sweeper.</summary>
    public int Sweep()
    {
        lock (_gate)
            return SweepLocked(_time.GetUtcNow().UtcDateTime);
    }

    private int SweepLocked(DateTime now)
    {
        var idle = TimeSpan.FromMinutes(_options.ResultIdleMinutes);
        var max = TimeSpan.FromMinutes(_options.ResultMaxMinutes);
        var expired = _byUser.Values.Where(e => now - e.LastAccessUtc > idle || now - e.Result.CreatedUtc > max).ToList();
        foreach (var e in expired)
        {
            _byUser.Remove(e.Result.OwnerUserId);
            Tombstone(e.Result, now);
        }

        return expired.Count;
    }

    private void Tombstone(StoredResult result, DateTime now)
    {
        _tombstones[result.RunId] = (result.OwnerUserId, now);
        if (_tombstones.Count > TombstoneLimit)
        {
            foreach (var old in _tombstones.OrderBy(t => t.Value.At).Take(TombstoneLimit / 5).Select(t => t.Key).ToList())
                _tombstones.TryRemove(old, out _);
        }
    }
}
