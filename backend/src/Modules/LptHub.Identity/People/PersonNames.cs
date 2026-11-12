namespace LptHub.Identity.People;

/// <summary>
/// How a user's display name becomes the first and last name of the linked person: split at the last space, so "Mary Ann Smith" is first "Mary Ann",
/// last "Smith"; a single word is the first name and the last name is empty. Script 72 applies the same rule to the users that existed.
/// </summary>
public static class PersonNameSplitter
{
    public static (string First, string Last) Split(string? displayName)
    {
        var name = displayName?.Trim() ?? string.Empty;
        var space = name.LastIndexOf(' ');
        return space < 0 ? (name, string.Empty) : (name[..space].TrimEnd(), name[(space + 1)..]);
    }
}

/// <summary>Finds people whose name or e-mail resembles what is being typed (the "Did you mean this person?" hint). Pure, so it is unit tested without a database.</summary>
public static class PersonSimilarity
{
    public const string SameEmail = "SAME_EMAIL";

    public const string SameName = "SAME_NAME";

    public const string SimilarName = "SIMILAR_NAME";

    /// <summary>Why a candidate resembles the typed person, or null when it does not.</summary>
    public static string? Match(string? firstName, string? lastName, string? email, string candidateFirst, string candidateLast, string? candidateEmail)
    {
        if (Normalize(email) is { Length: > 0 } wantedEmail && wantedEmail == Normalize(candidateEmail))
            return SameEmail;

        var typed = FullName(firstName, lastName);
        if (typed.Length < 2)
            return null;

        var candidate = FullName(candidateFirst, candidateLast);
        var swapped = FullName(candidateLast, candidateFirst);
        if (typed == candidate || typed == swapped)
            return SameName;

        // "Laura Whitfeld" ~ "Laura Whitfield": one edit per five letters, at least one, at most three. A single-word entry only matches a single-word name.
        var allowed = Math.Clamp(typed.Length / 5, 1, 3);
        return Distance(typed, candidate, allowed) <= allowed || Distance(typed, swapped, allowed) <= allowed ? SimilarName : null;
    }

    private static string FullName(string? first, string? last) => Normalize($"{first} {last}");

    /// <summary>Lower case, accents and punctuation dropped, blanks collapsed.</summary>
    private static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        var decomposed = value.Normalize(System.Text.NormalizationForm.FormD);
        var builder = new System.Text.StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
        {
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.NonSpacingMark)
                continue;

            if (char.IsLetterOrDigit(c) || c == '@' || c == '.')
                builder.Append(char.ToLowerInvariant(c));
            else if (builder.Length > 0 && builder[^1] != ' ')
                builder.Append(' ');
        }

        return builder.ToString().Trim();
    }

    /// <summary>Levenshtein distance, giving up (returning more than <paramref name="limit"/>) as soon as the strings cannot be close enough.</summary>
    internal static int Distance(string a, string b, int limit)
    {
        if (Math.Abs(a.Length - b.Length) > limit)
            return limit + 1;

        var previous = new int[b.Length + 1];
        var current = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++)
            previous[j] = j;

        for (var i = 1; i <= a.Length; i++)
        {
            current[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + cost);
            }

            (previous, current) = (current, previous);
        }

        return previous[b.Length];
    }
}
