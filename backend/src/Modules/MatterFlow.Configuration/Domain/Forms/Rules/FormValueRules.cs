using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>Emptiness, type and comparison primitives of contracts/form-rules.md section 2. No coercion anywhere.</summary>
internal static partial class FormValueRules
{
    // JavaScript \s without .NET's extra U+0085, so the TypeScript and .NET URL checks agree.
    private const string JsWhitespace =
        "\\t\\n\\v\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF";

    [GeneratedRegex("^https?://[^" + JsWhitespace + "/?#]+[^" + JsWhitespace + "]*\\z", RegexOptions.CultureInvariant)]
    private static partial Regex UrlRegex();

    [GeneratedRegex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,7})?Z\\z", RegexOptions.CultureInvariant)]
    private static partial Regex DateTimeShape();

    public static bool IsValidFieldKey(string key)
    {
        if (key.Length is 0 or > 64 || key[0] is < 'a' or > 'z')
        {
            return false;
        }

        foreach (var c in key)
        {
            if (c is not ((>= 'a' and <= 'z') or (>= '0' and <= '9') or '_'))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Absent, null, ASCII-whitespace-only string (including ""), or [].</summary>
    public static bool IsEmpty(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined or JsonValueKind.Null => true,
        JsonValueKind.String => IsAsciiWhitespaceOnly(value.GetString()!),
        JsonValueKind.Array => value.GetArrayLength() == 0,
        _ => false,
    };

    private static bool IsAsciiWhitespaceOnly(string s)
    {
        foreach (var c in s)
        {
            if (c is not ((>= '\t' and <= '\r') or ' '))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>True when the (non-empty) JSON value has the type the control requires.</summary>
    public static bool IsValidType(FormControl control, JsonElement value) => control switch
    {
        FormControl.Text or FormControl.TextArea or FormControl.Select or FormControl.Radio
            => value.ValueKind == JsonValueKind.String,
        FormControl.Url => value.ValueKind == JsonValueKind.String && UrlRegex().IsMatch(value.GetString()!),
        FormControl.Number => IsFiniteNumber(value),
        FormControl.Checkbox => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
        FormControl.MultiSelect => IsDistinctStringArray(value),
        FormControl.Date => value.ValueKind == JsonValueKind.String && TryParseDate(value.GetString()!, out _),
        FormControl.DateTime => value.ValueKind == JsonValueKind.String && TryParseDateTime(value.GetString()!, out _),
        FormControl.AssetRef or FormControl.UserRef => IsPositiveInteger(value),
        _ => false,
    };

    public static bool IsFiniteNumber(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var d) && double.IsFinite(d);

    public static bool IsPositiveInteger(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number &&
        value.TryGetDouble(out var d) &&
        double.IsFinite(d) &&
        d >= 1 &&
        d <= 9007199254740991d &&
        Math.Floor(d) == d;

    private static bool IsDistinctStringArray(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || !seen.Add(item.GetString()!))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Strict <c>yyyy-MM-dd</c> that is a real calendar date (year 0001-9999).</summary>
    public static bool TryParseDate(string text, out DateOnly date)
    {
        date = default;
        if (text.Length != 10 || text[4] != '-' || text[7] != '-')
        {
            return false;
        }

        for (var i = 0; i < 10; i++)
        {
            if (i is 4 or 7)
            {
                continue;
            }

            if (text[i] is < '0' or > '9')
            {
                return false;
            }
        }

        var year = int.Parse(text.AsSpan(0, 4), CultureInfo.InvariantCulture);
        var month = int.Parse(text.AsSpan(5, 2), CultureInfo.InvariantCulture);
        var day = int.Parse(text.AsSpan(8, 2), CultureInfo.InvariantCulture);
        if (year < 1 || month is < 1 or > 12 || day < 1 || day > DateTime.DaysInMonth(year, month))
        {
            return false;
        }

        date = new DateOnly(year, month, day);
        return true;
    }

    /// <summary>Strict <c>yyyy-MM-ddTHH:mm:ss[.f{1,7}]Z</c> (UTC), real calendar date and time.</summary>
    public static bool TryParseDateTime(string text, out DateTime utc)
    {
        utc = default;
        if (!DateTimeShape().IsMatch(text) || !TryParseDate(text[..10], out _))
        {
            return false;
        }

        return DateTime.TryParseExact(
            text,
            "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'",
            CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
            out utc);
    }

    /// <summary>ASCII-only case-insensitive equality (only A-Z fold).</summary>
    public static bool AsciiEqualsIgnoreCase(string a, string b)
    {
        if (a.Length != b.Length)
        {
            return false;
        }

        for (var i = 0; i < a.Length; i++)
        {
            if (Fold(a[i]) != Fold(b[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static char Fold(char c) => c is >= 'A' and <= 'Z' ? (char)(c + 32) : c;
}
