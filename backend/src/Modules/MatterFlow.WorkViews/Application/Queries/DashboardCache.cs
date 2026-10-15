using System.Collections.Concurrent;
using Microsoft.Extensions.Options;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>Settings of the dashboard output cache, section <c>Dashboard</c>.</summary>
public sealed class DashboardOptions
{
    public const string SectionName = "Dashboard";

    /// <summary>How long a computed dashboard is served again to the same user and period (default 15 seconds; 0 switches the cache off).</summary>
    public int CacheSeconds { get; set; } = 15;

    /// <summary>Thresholds of the Users tab (<c>Dashboard:Workload</c>).</summary>
    public WorkloadOptions Workload { get; set; } = new();
}

/// <summary>
/// Load levels of the team workload by number of open Tasks: 0 is IDLE, up to <see cref="LightMax"/> LIGHT, up to <see cref="NormalMax"/> NORMAL,
/// more is HEAVY. A capacity hint for leads, never a performance rating.
/// </summary>
public sealed class WorkloadOptions
{
    public int LightMax { get; set; } = 3;

    public int NormalMax { get; set; } = 8;
}

/// <summary>
/// Short server-side output cache of the dashboard (security review 2, SEC2-03). One entry per user, period, time zone, local date and department
/// visibility, so a cached answer is never shown to someone else, never crosses a date change and never outlives a change of the caller's
/// Dashboard.ViewDepartment right by more than the cache time. Entries expire after <see cref="DashboardOptions.CacheSeconds"/>; expired entries are
/// dropped when new ones are added. Only successful results are stored. The cache is per process (each node of a farm keeps its own).
/// </summary>
public sealed class DashboardCache(IOptions<DashboardOptions> options, TimeProvider time)
{
    private const int PurgeAbove = 2000;

    private readonly ConcurrentDictionary<string, Entry> _entries = new();

    /// <summary>Number of stored entries (diagnostics and tests).</summary>
    public int Count => _entries.Count;

    public bool Enabled => options.Value.CacheSeconds > 0;

    public bool TryGet(string key, out DashboardSummary summary)
    {
        if (Enabled && _entries.TryGetValue(key, out var entry))
        {
            if (entry.ExpiresAt > time.GetTimestamp())
            {
                summary = entry.Summary;
                return true;
            }

            _entries.TryRemove(new KeyValuePair<string, Entry>(key, entry));
        }

        summary = null!;
        return false;
    }

    public void Set(string key, DashboardSummary summary)
    {
        if (!Enabled)
            return;

        var now = time.GetTimestamp();
        if (_entries.Count > PurgeAbove)
        {
            foreach (var (k, e) in _entries)
            {
                if (e.ExpiresAt <= now)
                    _entries.TryRemove(new KeyValuePair<string, Entry>(k, e));
            }
        }

        _entries[key] = new Entry(summary, now + (long)(options.Value.CacheSeconds * (double)time.TimestampFrequency));
    }

    private sealed record Entry(DashboardSummary Summary, long ExpiresAt);
}
