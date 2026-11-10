using LptHub.Productions.Domain;

namespace LptHub.Productions.Application;

/// <summary>The small rules of production specs that need no database: the name of a copy, and which specs a production may be given.</summary>
internal static class ProductionSpecRules
{
    public const int MaxNameLength = 200;

    /// <summary>
    /// The default name of a copy: "Copy of {name}", then "Copy of {name} (2)", "(3)" ... until the name is not among <paramref name="activeNames"/> (compared without regard to case,
    /// like the unique index). The result is never longer than <see cref="MaxNameLength"/>: the source name is shortened, never the number.
    /// </summary>
    public static string CopyName(string sourceName, IEnumerable<string> activeNames)
    {
        var taken = new HashSet<string>(activeNames, StringComparer.OrdinalIgnoreCase);
        var baseName = Fit($"Copy of {sourceName}", MaxNameLength);
        var candidate = baseName;
        for (var n = 2; taken.Contains(candidate); n++)
        {
            var suffix = $" ({n})";
            candidate = Fit(baseName, MaxNameLength - suffix.Length) + suffix;
        }

        return candidate;
    }

    /// <summary>
    /// True when a production may be given the spec: an active spec of its own matter, or the retired spec it already has (a retired spec stays on the productions that use it, but
    /// cannot be chosen for a new or changed one).
    /// </summary>
    public static bool MayUse(string specStatus, int specId, int? currentSpecId) => specStatus == SpecStatus.Active || currentSpecId == specId;

    private static string Fit(string text, int max) => text.Length <= max ? text : text[..max].TrimEnd();
}
