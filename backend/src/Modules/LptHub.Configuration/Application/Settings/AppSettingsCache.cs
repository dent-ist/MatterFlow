using MatterFlow.SharedKernel.Time;

namespace MatterFlow.Configuration.Application.Settings;

/// <summary>One stored setting as the application reads it (a detached copy; never tracked by EF).</summary>
/// <param name="Key">Setting key.</param>
/// <param name="Text">Text value, or null.</param>
/// <param name="Binary">Binary value, or null.</param>
/// <param name="ContentType">Content type of the binary value.</param>
/// <param name="Sha256">SHA-256 of the binary value.</param>
/// <param name="UpdatedAtUtc">When it was last saved.</param>
/// <param name="UpdatedByUserId">Who saved it.</param>
/// <param name="RowVersion">Row version (8 bytes) the next write must present.</param>
public sealed record AppSettingValue(
    string Key,
    string? Text,
    byte[]? Binary,
    string? ContentType,
    byte[]? Sha256,
    DateTime UpdatedAtUtc,
    int UpdatedByUserId,
    byte[] RowVersion);

/// <summary>
/// In-memory copy of the whole (tiny) settings table for 30 seconds. A write invalidates it on the node that wrote, so the writing node sees the
/// change at once; other nodes converge within the time to live (design section 5.3). Singleton, thread safe.
/// </summary>
public sealed class AppSettingsCache(IClock clock)
{
    /// <summary>How long a snapshot is trusted.</summary>
    public static readonly TimeSpan TimeToLive = TimeSpan.FromSeconds(30);

    private readonly object _gate = new();
    private IReadOnlyDictionary<string, AppSettingValue>? _snapshot;
    private DateTime _loadedAtUtc;
    private int _generation;

    /// <summary>The cached snapshot, or null when none is held or it has expired.</summary>
    public IReadOnlyDictionary<string, AppSettingValue>? TryGet()
    {
        lock (_gate)
            return _snapshot is not null && clock.UtcNow - _loadedAtUtc < TimeToLive ? _snapshot : null;
    }

    /// <summary>Generation to hand back to <see cref="Store"/>: a snapshot read before an invalidation must not be stored after it.</summary>
    public int Generation
    {
        get
        {
            lock (_gate)
                return _generation;
        }
    }

    public void Store(IReadOnlyDictionary<string, AppSettingValue> snapshot, int generationBeforeRead)
    {
        lock (_gate)
        {
            if (generationBeforeRead != _generation)
                return;

            _snapshot = snapshot;
            _loadedAtUtc = clock.UtcNow;
        }
    }

    /// <summary>Drops the snapshot (called after every successful write).</summary>
    public void Invalidate()
    {
        lock (_gate)
        {
            _snapshot = null;
            _generation++;
        }
    }
}
