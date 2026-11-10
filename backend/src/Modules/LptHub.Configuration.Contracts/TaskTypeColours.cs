using System.Collections.Frozen;
using System.Text.Json;

namespace MatterFlow.Configuration.Contracts;

/// <summary>One colour of the Task Type palette (<c>contracts/task-type-colours.json</c>).</summary>
/// <param name="Key">Stable lower-case name; this is what <c>TaskType.ColourKey</c> stores.</param>
/// <param name="Label">Human label shown in the picker.</param>
public sealed record TaskTypeColourInfo(string Key, string Label);

/// <summary>
/// The allow-list of Task Type colour names (a named palette of ten, never a free hex value). The source of truth is
/// <c>contracts/task-type-colours.json</c>, embedded here; the Angular palette is kept in step by a unit test. A null colour is the neutral default.
/// </summary>
public static class TaskTypeColours
{
    private const string ResourceName = "contracts.task-type-colours.json";

    /// <summary>Lowest and highest allowed target turnaround, in calendar days.</summary>
    public const int MinTargetDays = 1;

    public const int MaxTargetDays = 365;

    private static readonly Lazy<(IReadOnlyList<TaskTypeColourInfo> All, FrozenSet<string> Keys)> Loaded = new(Load);

    /// <summary>Every allowed colour, in palette order.</summary>
    public static IReadOnlyList<TaskTypeColourInfo> All => Loaded.Value.All;

    /// <summary>True when <paramref name="key"/> is exactly one of the palette names (case-sensitive).</summary>
    public static bool IsValid(string? key) => key is not null && Loaded.Value.Keys.Contains(key);

    private static (IReadOnlyList<TaskTypeColourInfo>, FrozenSet<string>) Load()
    {
        using var stream = typeof(TaskTypeColours).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource '{ResourceName}' not found.");
        using var doc = JsonDocument.Parse(stream);
        var all = doc.RootElement.GetProperty("colours").EnumerateArray()
            .Select(c => new TaskTypeColourInfo(c.GetProperty("key").GetString()!, c.GetProperty("label").GetString()!))
            .ToList();
        return (all, all.Select(c => c.Key).ToFrozenSet(StringComparer.Ordinal));
    }
}
