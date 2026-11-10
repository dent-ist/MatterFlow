using System.Globalization;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>Human-friendly Task reference, <c>TSK-1042</c>, derived from a database sequence value.</summary>
public static class TaskNumber
{
    public const string Prefix = "TSK-";

    public static string Format(long sequenceValue)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(sequenceValue);
        return Prefix + sequenceValue.ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>Accepts <c>TSK-1042</c> (case-insensitive) or bare <c>1042</c>.</summary>
    public static bool TryParse(string? input, out long sequenceValue)
    {
        sequenceValue = 0;
        var s = input?.Trim();
        if (string.IsNullOrEmpty(s))
            return false;
        if (s.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase))
            s = s[Prefix.Length..];
        if (s.Length == 0 || s.Length > 18 || !s.All(char.IsAsciiDigit))
            return false;
        sequenceValue = long.Parse(s, CultureInfo.InvariantCulture);
        return sequenceValue > 0;
    }
}
