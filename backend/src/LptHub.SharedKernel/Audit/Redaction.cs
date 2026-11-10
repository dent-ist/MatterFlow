using System.Text.RegularExpressions;

namespace MatterFlow.SharedKernel.Audit;

/// <summary>
/// Helpers that keep sensitive values (email bodies/addresses, field values, comment text) out of logs
/// (architecture section 14). Audit rows keep full values in the database; anything written to logs goes through here.
/// </summary>
public static partial class Redaction
{
    public const string Masked = "[REDACTED]";

    /// <summary>Longest value kept for display in API responses (architecture section 9).</summary>
    public const int DisplayMaxLength = 4000;

    /// <summary>Replaces any non-empty value with <see cref="Masked"/>; null stays null so absence remains visible.</summary>
    public static string? Mask(string? value) => string.IsNullOrEmpty(value) ? value : Masked;

    /// <summary>Replaces every email address in free text with <c>[email]</c>.</summary>
    public static string MaskEmails(string? text) =>
        string.IsNullOrEmpty(text) ? string.Empty : EmailPattern().Replace(text, "[email]");

    /// <summary>Truncates for display; <paramref name="truncated"/> tells the UI to show a "truncated" marker.</summary>
    public static string? Truncate(string? value, out bool truncated, int maxLength = DisplayMaxLength)
    {
        truncated = value is not null && value.Length > maxLength;
        return truncated ? value![..maxLength] : value;
    }

    [GeneratedRegex(@"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", RegexOptions.CultureInvariant)]
    private static partial Regex EmailPattern();
}
