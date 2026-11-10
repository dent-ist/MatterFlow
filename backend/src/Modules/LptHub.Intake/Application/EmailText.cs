using System.Text;

namespace MatterFlow.Intake.Application;

/// <summary>Cleaning and limiting of the strings returned to the client.</summary>
internal static class EmailText
{
    /// <summary>A one-line value (subject, name, address): control characters and line breaks become single spaces, then truncated.</summary>
    public static string SingleLine(string? value, int maxChars)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        var sb = new StringBuilder(Math.Min(value.Length, maxChars + 16));
        var space = false;
        foreach (var ch in value)
        {
            if (char.IsControl(ch) || char.IsWhiteSpace(ch) || ch is '​' or '﻿')
            {
                space = sb.Length > 0;
                continue;
            }

            if (space)
            {
                sb.Append(' ');
                space = false;
            }

            sb.Append(ch);
            if (sb.Length >= maxChars)
                break;
        }

        return TrimToLength(sb.ToString(), maxChars);
    }

    /// <summary>
    /// Body text: line endings normalised, control characters removed, trailing spaces trimmed, runs of blank lines collapsed to one, cut at
    /// <see cref="EmailLimits.MaxBodyChars"/> (a warning is added when something was cut).
    /// </summary>
    public static string Body(string? value, List<string> warnings)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        var normalized = Normalize(value);
        if (normalized.Length <= EmailLimits.MaxBodyChars)
            return normalized;

        warnings.Add($"The message body was longer than {EmailLimits.MaxBodyChars:N0} characters and was shortened.");
        return TrimToLength(normalized, EmailLimits.MaxBodyChars).TrimEnd();
    }

    public static string Normalize(string value)
    {
        var sb = new StringBuilder(value.Length);
        var blankRun = 0;
        foreach (var rawLine in value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n'))
        {
            var line = StripControls(rawLine).TrimEnd();
            if (line.Length == 0)
            {
                blankRun++;
                continue;
            }

            if (sb.Length > 0)
                sb.Append('\n', blankRun > 0 ? 2 : 1);

            blankRun = 0;
            sb.Append(line);
        }

        return sb.ToString().Trim('\n', ' ', '\t');
    }

    /// <summary>Cuts to <paramref name="maxChars"/> without splitting a surrogate pair.</summary>
    public static string TrimToLength(string value, int maxChars)
    {
        if (value.Length <= maxChars)
            return value;

        var length = maxChars;
        if (char.IsHighSurrogate(value[length - 1]))
            length--;

        return value[..length];
    }

    private static string StripControls(string line)
    {
        var needs = false;
        foreach (var ch in line)
        {
            if (char.IsControl(ch) && ch != '\t')
            {
                needs = true;
                break;
            }
        }

        return needs ? string.Concat(line.Where(c => !char.IsControl(c) || c == '\t')) : line;
    }
}
