namespace MatterFlow.Assets.Domain;

/// <summary>
/// The units an asset type's size field can be measured in (epic #851, docs/ux/pm-v2-review section 9.2). B to TB are the size family: they add up after
/// conversion (binary multiples, 1 KB = 1024 B). Items (files, pages, documents) never mix with bytes.
/// </summary>
public static class AssetSize
{
    public const string Items = "Items";

    public static readonly IReadOnlyList<string> Units = ["B", "KB", "MB", "GB", "TB", Items];

    private static readonly Dictionary<string, long> BytesPerUnit = new(StringComparer.Ordinal)
    {
        ["B"] = 1L,
        ["KB"] = 1L << 10,
        ["MB"] = 1L << 20,
        ["GB"] = 1L << 30,
        ["TB"] = 1L << 40,
    };

    public static bool IsKnownUnit(string? unit) => unit is not null && Units.Contains(unit, StringComparer.Ordinal);

    /// <summary>True for B, KB, MB, GB and TB.</summary>
    public static bool IsByteUnit(string? unit) => unit is not null && BytesPerUnit.ContainsKey(unit);

    /// <summary>Bytes per unit (B 1 ... TB 2^40), or null for Items and unknown units.</summary>
    public static long? BytesFor(string? unit) => unit is not null && BytesPerUnit.TryGetValue(unit, out var bytes) ? bytes : null;

    /// <summary>The size in bytes (rounded), or null for Items, an unknown unit or a value that does not fit.</summary>
    public static long? ToBytes(decimal value, string? unit)
    {
        if (BytesFor(unit) is not { } factor)
            return null;

        try
        {
            var bytes = decimal.Round(value * factor, 0, MidpointRounding.AwayFromZero);
            return bytes is >= long.MinValue and <= long.MaxValue ? (long)bytes : null;
        }
        catch (OverflowException)
        {
            return null; // a value too large to express in bytes
        }
    }
}
