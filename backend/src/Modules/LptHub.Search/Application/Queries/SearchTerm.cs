using System.Text;
using System.Text.RegularExpressions;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.ValueObjects;
using DomainTaskNumber = MatterFlow.WorkManagement.Domain.TaskNumber;

namespace MatterFlow.Search.Application.Queries;

/// <summary>
/// A validated search input reduced to everything the SQL needs: the LIKE patterns (escaped, so a typed <c>%</c>, <c>_</c> or <c>[</c> is matched
/// literally), the normalized business numbers (addendum B: <c>343</c> and <c>00343</c> are the same number) and the Task number forms.
/// Built once per request; every value reaches SQL as a parameter, never concatenated into a statement.
/// </summary>
public sealed partial class SearchTerm
{
    public const int MinLength = 2;
    public const int MaxLength = 200;

    /// <summary>The LIKE escape character (<c>ESCAPE '\'</c>).</summary>
    public const string Escape = "\\";

    /// <summary>Never matches: sentinel for "no value" so every query keeps a fixed shape (and parameters are never NULL).</summary>
    public const string Never = "#";

    /// <summary>Number-prefix patterns are always this many (unused slots hold <see cref="Never"/>): lets the query translate without loops.</summary>
    public const int PrefixSlots = BusinessNumber.Length;

    private const string WordSeparators = " ._/(-";

    private SearchTerm(string text)
    {
        Text = text;
        var escaped = EscapeLike(text);
        Prefix = escaped + "%";
        Contains = "%" + escaped + "%";
        WordStart = "%[ ._/(-]" + escaped + "%";
    }

    /// <summary>The trimmed input, as typed.</summary>
    public string Text { get; }

    /// <summary><c>text%</c>, escaped.</summary>
    public string Prefix { get; }

    /// <summary><c>%text%</c>, escaped.</summary>
    public string Contains { get; }

    /// <summary>The text right after a word separator (a space, <c>.</c>, <c>_</c>, <c>/</c>, <c>(</c> or <c>-</c>), escaped.</summary>
    public string WordStart { get; }

    /// <summary>
    /// The same patterns lower-cased, for the binary-collation path used on the largest table (<see cref="RankedQuery.TextTiers{T}"/> with
    /// <c>binary</c>): comparing <c>LOWER(column)</c> in a binary collation is about seven times faster than a case-insensitive collation scan.
    /// </summary>
    public SearchTerm Lowered => _lowered ??= new SearchTerm(Text.ToLowerInvariant());

    private SearchTerm? _lowered;

    /// <summary>The input as a Client/Matter number (1-5 digits), normalized to five digits; <see cref="Never"/> otherwise.</summary>
    public string Number { get; private set; } = Never;

    /// <summary>True when <see cref="Number"/> holds a valid number.</summary>
    public bool HasNumber { get; private set; }

    /// <summary>LIKE patterns (<c>digits%</c>) that a five-digit number must match to start with what was typed; padded with <see cref="Never"/>.</summary>
    public IReadOnlyList<string> NumberPrefixes { get; private set; } = Slots([]);

    /// <summary>The input as <c>client-matter</c> (<c>343-12</c>, <c>343-</c>): the Client number, normalized; <see cref="Never"/> otherwise.</summary>
    public string PairClient { get; private set; } = Never;

    /// <summary>The full Matter reference (<c>00343-00012</c>) when both halves were typed as valid numbers; <see cref="Never"/> otherwise.</summary>
    public string PairRef { get; private set; } = Never;

    /// <summary>LIKE patterns on the Matter reference for a partly typed Matter number (<c>00343-12%</c>); a bare <c>343-</c> yields <c>00343-%</c>.</summary>
    public IReadOnlyList<string> PairPrefixes { get; private set; } = Slots([]);

    /// <summary>True for a <c>number-number</c> input.</summary>
    public bool IsPair => PairClient != Never;

    /// <summary>The exact Task number (<c>TSK-1042</c>) for <c>1042</c> or <c>TSK-1042</c>; <see cref="Never"/> otherwise.</summary>
    public string TaskNumber { get; private set; } = Never;

    /// <summary>LIKE pattern for Task numbers that start with what was typed (<c>TSK-10%</c>); <see cref="Never"/> otherwise.</summary>
    public string TaskPrefix { get; private set; } = Never;

    /// <summary>What a number input was understood as (<c>00343</c>, <c>00343-00012</c>, <c>TSK-1042</c>); null for plain text.</summary>
    public string? Normalized { get; private set; }

    /// <summary>Validates the length (2 to 200 characters after trimming; a single digit is accepted as a number) and builds the term.</summary>
    public static Result<SearchTerm> Parse(string? input)
    {
        var text = input?.Trim() ?? string.Empty;
        // A single digit is allowed: Client and Matter numbers are 1 to 5 digits (UX spec S11: "numbers: min 1 digit").
        if (text.Length < MinLength && !(text.Length == 1 && char.IsAsciiDigit(text[0])))
            return Error.Validation("q", "QUERY_TOO_SHORT", $"Type at least {MinLength} characters (or a number) to search.");
        if (text.Length > MaxLength)
            return Error.Validation("q", "QUERY_TOO_LONG", $"The search text is limited to {MaxLength} characters.");

        var term = new SearchTerm(text);
        term.ReadNumbers();
        return term;
    }

    /// <summary>Escapes <c>\</c>, <c>%</c>, <c>_</c> and <c>[</c> so the value is matched literally in a <c>LIKE ... ESCAPE '\'</c>.</summary>
    public static string EscapeLike(string value)
    {
        var sb = new StringBuilder(value.Length + 4);
        foreach (var c in value)
        {
            if (c is '\\' or '%' or '_' or '[')
                sb.Append('\\');
            sb.Append(c);
        }

        return sb.ToString();
    }

    /// <summary>
    /// Patterns for "starts with what was typed" on a zero-padded five-digit number. Typed digits without a leading zero stand for any amount of
    /// padding (<c>34</c> is 34xxx, 034xx, 0034x or 00034); typed leading zeros are literal (<c>003</c> is 003xx).
    /// </summary>
    public static IReadOnlyList<string> PaddedPrefixPatterns(string digits)
    {
        if (digits.Length is 0 or > BusinessNumber.Length)
            return Slots([]);
        if (digits[0] == '0')
            return Slots([digits + "%"]);

        var patterns = new List<string>();
        for (var zeros = 0; zeros + digits.Length <= BusinessNumber.Length; zeros++)
            patterns.Add(new string('0', zeros) + digits + "%");
        return Slots(patterns);
    }

    /// <summary>True when the character before a match starts a new word (the C# mirror of the word-start pattern).</summary>
    internal static bool IsWordSeparator(char c) => WordSeparators.Contains(c, StringComparison.Ordinal);

    private static IReadOnlyList<string> Slots(IEnumerable<string> patterns) =>
        [.. patterns.Concat(Enumerable.Repeat(Never, PrefixSlots)).Take(PrefixSlots)];

    private void ReadNumbers()
    {
        var pair = PairPattern().Match(Text);
        if (pair.Success)
        {
            ReadPair(pair.Groups[1].Value, pair.Groups[2].Value);
            return;
        }

        if (Text.All(char.IsAsciiDigit))
        {
            if (BusinessNumber.TryParse(Text, out var number))
            {
                Number = number.Value;
                HasNumber = true;
                Normalized = number.Value;
            }

            NumberPrefixes = PaddedPrefixPatterns(Text);
        }

        if (DomainTaskNumber.TryParse(Text, out var sequence))
        {
            TaskNumber = DomainTaskNumber.Format(sequence);
            TaskPrefix = TaskNumber + "%";
            Normalized ??= TaskNumber;
        }
        else if (Text.StartsWith(DomainTaskNumber.Prefix, StringComparison.OrdinalIgnoreCase)
            && Text[DomainTaskNumber.Prefix.Length..].All(char.IsAsciiDigit))
        {
            TaskPrefix = DomainTaskNumber.Prefix + Text[DomainTaskNumber.Prefix.Length..] + "%";
        }
    }

    private void ReadPair(string left, string right)
    {
        if (!BusinessNumber.TryParse(left, out var client))
            return;

        PairClient = client.Value;
        if (right.Length == 0)
        {
            PairPrefixes = Slots([client.Value + "-%"]);
            Normalized = client.Value + "-";
            return;
        }

        if (BusinessNumber.TryParse(right, out var matter))
        {
            PairRef = client.Value + "-" + matter.Value;
            Normalized = PairRef;
        }

        PairPrefixes = Slots(PaddedPrefixPatterns(right).Where(p => p != Never).Select(p => client.Value + "-" + p));
    }

    [GeneratedRegex(@"^(\d{1,5})\s*-\s*(\d{0,5})$", RegexOptions.CultureInvariant)]
    private static partial Regex PairPattern();
}
