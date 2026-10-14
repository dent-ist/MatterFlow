using System.Text;

namespace MatterFlow.Configuration.Domain.Forms;

/// <summary>Maps enum members to their persisted <c>UPPER_SNAKE_CASE</c> names (for example <c>AssetType</c> to <c>ASSET_TYPE</c>) and back.</summary>
public static class WireNames
{
    /// <summary>The persisted name of <paramref name="value"/>.</summary>
    public static string ToWire<T>(T value)
        where T : struct, Enum => Cache<T>.ToWire[value];

    /// <summary>Parses a persisted name.</summary>
    public static bool TryParse<T>(string? wire, out T value)
        where T : struct, Enum
    {
        value = default;
        return wire is not null && Cache<T>.FromWire.TryGetValue(wire, out value);
    }

    /// <summary>Parses a persisted name; throws for an unknown one.</summary>
    public static T Parse<T>(string wire)
        where T : struct, Enum =>
        TryParse<T>(wire, out var value) ? value : throw new FormatException($"Unknown {typeof(T).Name} '{wire}'.");

    private static string Snake(string pascal)
    {
        var sb = new StringBuilder(pascal.Length + 4);
        for (var i = 0; i < pascal.Length; i++)
        {
            if (i > 0 && char.IsUpper(pascal[i]))
            {
                sb.Append('_');
            }

            sb.Append(char.ToUpperInvariant(pascal[i]));
        }

        return sb.ToString();
    }

    private static class Cache<T>
        where T : struct, Enum
    {
        public static readonly Dictionary<T, string> ToWire = Enum.GetValues<T>().ToDictionary(v => v, v => Snake(v.ToString()));

        public static readonly Dictionary<string, T> FromWire = ToWire.ToDictionary(p => p.Value, p => p.Key, StringComparer.Ordinal);
    }
}
