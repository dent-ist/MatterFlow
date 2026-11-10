using System.Globalization;
using System.Text;

namespace MatterFlow.Assets.Domain;

/// <summary>
/// The pure rules of the automatic asset numbering (issue #1297). An Asset Number ALWAYS starts with the matter's CM Number (<c>123456-123444</c>: client number, a hyphen, matter number, as the
/// app stores and shows it; never editable). The administrator controls only the TAIL after it: literal text with exactly one counter token <c>{###}</c> (the number of <c>#</c>, 1 to 9, is the
/// minimum width: <c>{###}</c> gives 001, <c>{#}</c> gives 1; a larger counter widens, <c>_1000</c>). Examples: tail <c>_{###}</c> gives <c>123456-123444_001</c>; <c>-M-{###}</c> gives
/// <c>123456-123444-M-001</c>; <c>_{###}-A</c> gives <c>123456-123444_001-A</c>. The tail is DATA: it is parsed here and only ever rendered as text into a parameter, never interpreted by SQL.
/// The frontend implements the same rules for its live example; the shared vectors are <c>contracts/asset-numbering/pattern-vectors.json</c>.
/// </summary>
public static class AssetNumbering
{
    /// <summary>The tail a newly numbered asset type starts with: an underscore and a three-digit counter.</summary>
    public const string DefaultPattern = "_{###}";

    /// <summary>The longest tail, and the longest generated Asset Number (column <c>Asset.AssetNumber</c> is <c>NVARCHAR(100)</c>).</summary>
    public const int MaxPatternLength = 50;
    public const int MaxNumberLength = 100;

    public const int MinDigits = 1;
    public const int MaxDigits = 9;

    /// <summary>The CM Number used for examples when no matter has been numbered yet.</summary>
    public const string SampleCmNumber = "90003-80008";

    /// <summary>The counter restarts for each matter. The only scope for now; the column exists so that others (per client, global) can follow.</summary>
    public const int ScopeMatter = 1;

    /// <summary>The wire name of <see cref="ScopeMatter"/>.</summary>
    public const string ScopeMatterName = "MATTER";

    /// <summary>The highest value an administrator can set as the next number (nine digits).</summary>
    public const int MaxNextNumber = 999_999_999;

    /// <summary>Characters a folder name cannot contain on a Windows share; the literal text of the tail must be free of them (and of control characters).</summary>
    public const string UnsafeCharacters = "\\/:*?\"<>|";

    // Stable error codes (the frontend maps them to wording; part of the API contract and of the shared vectors).
    public const string NoCounter = "PATTERN_NO_COUNTER";
    public const string TwoCounters = "PATTERN_TWO_COUNTERS";
    public const string UnknownToken = "PATTERN_UNKNOWN_TOKEN";
    public const string ForbiddenChar = "PATTERN_FORBIDDEN_CHAR";
    public const string EdgeSpace = "PATTERN_EDGE_SPACE";
    public const string TrailingDot = "PATTERN_TRAILING_DOT";
    public const string TooLong = "PATTERN_TOO_LONG";
    public const string CounterWidth = "PATTERN_COUNTER_WIDTH";

    /// <summary>The message of <see cref="TrailingDot"/> (the generated name ends with the tail, and a Windows folder name cannot end with a dot).</summary>
    public const string TrailingDotMessage = "The pattern cannot end with a dot: a folder name cannot end with a dot.";

    /// <summary>The wire name of a scope, or null for an unknown value.</summary>
    public static string? ScopeName(int scope) => scope == ScopeMatter ? ScopeMatterName : null;

    /// <summary>True when the name stands for the per-matter scope (case-insensitive).</summary>
    public static bool IsMatterScopeName(string? name) => string.Equals(name?.Trim(), ScopeMatterName, StringComparison.OrdinalIgnoreCase);

    /// <summary>A parsed, valid tail.</summary>
    public sealed class NumberPattern
    {
        internal NumberPattern(string before, string after, int width)
        {
            Before = before;
            After = after;
            Width = width;
        }

        /// <summary>The literal text before the counter.</summary>
        public string Before { get; }

        /// <summary>The literal text after the counter.</summary>
        public string After { get; }

        /// <summary>Minimum width of the counter (the number of <c>#</c>).</summary>
        public int Width { get; }

        /// <summary>The Asset Number: the CM Number, the text before the counter, the counter zero-padded to the width (wider when it needs more digits) and the text after it.</summary>
        /// <exception cref="ArgumentException">The CM Number is empty or unsafe in a folder name, or the result is longer than <see cref="MaxNumberLength"/>.</exception>
        public string Render(string cmNumber, int counter)
        {
            ArgumentNullException.ThrowIfNull(cmNumber);
            if (cmNumber.Length == 0 || cmNumber != cmNumber.Trim() || cmNumber.IndexOfAny(UnsafeCharacters.ToCharArray()) >= 0 || cmNumber.Any(char.IsControl))
                throw new ArgumentException("The CM Number is empty or contains characters that cannot be in a folder name.", nameof(cmNumber));
            ArgumentOutOfRangeException.ThrowIfLessThan(counter, 1);

            var text = cmNumber + Before + counter.ToString("D" + Width.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture) + After;
            return text.Length <= MaxNumberLength ? text : throw new ArgumentException($"The number would be longer than {MaxNumberLength} characters.", nameof(cmNumber));
        }
    }

    /// <summary>The outcome of <see cref="Parse"/>: the parsed tail, or the stable code and an English message naming the problem.</summary>
    public sealed record ParseResult(NumberPattern? Pattern, string? Code, string? Message)
    {
        public bool IsValid => Pattern is not null;
    }

    /// <summary>
    /// Parses a tail. Rules, in this order (the first that fails is reported): at most 50 characters; no space at the start or end (PATTERN_EDGE_SPACE) and no dot at the end (PATTERN_TRAILING_DOT; a folder name cannot end with either);
    /// then left to right: every <c>{...}</c> must be a counter of 1 to 9 <c>#</c> (anything else, or a stray brace, is an unknown token), the counter only once, and the literal text has none of
    /// <c>\ / : * ? " &lt; &gt; |</c> and no control character; finally exactly one counter must be present.
    /// </summary>
    public static ParseResult Parse(string? tail)
    {
        tail ??= string.Empty;
        if (tail.Length > MaxPatternLength)
            return Fail(TooLong, $"The pattern can have at most {MaxPatternLength} characters.");
        if (tail.Length > 0 && (char.IsWhiteSpace(tail[0]) || char.IsWhiteSpace(tail[^1])))
            return Fail(EdgeSpace, "The pattern cannot start or end with a space.");
        if (tail.Length > 0 && tail[^1] == '.')
            return Fail(TrailingDot, TrailingDotMessage);

        var before = new StringBuilder();
        var after = new StringBuilder();
        var width = 0;
        var i = 0;
        while (i < tail.Length)
        {
            var c = tail[i];
            if (c == '}')
                return Fail(UnknownToken, "A closing brace } has no opening brace {.");

            if (c != '{')
            {
                if (UnsafeCharacters.Contains(c, StringComparison.Ordinal) || char.IsControl(c))
                    return Fail(ForbiddenChar, "The text cannot contain any of \\ / : * ? \" < > | or control characters (they are not allowed in a folder name).");

                (width == 0 ? before : after).Append(c);
                i++;
                continue;
            }

            var close = tail.IndexOf('}', i + 1);
            var inner = close < 0 ? string.Empty : tail[(i + 1)..close];
            if (close < 0 || inner.Contains('{', StringComparison.Ordinal))
                return Fail(UnknownToken, "An opening brace { has no closing brace }.");
            if (inner.Length == 0 || inner.Any(ch => ch != '#'))
                return Fail(UnknownToken, $"{{{inner}}} is not a known token. The only token is the counter, for example {{###}}.");
            if (inner.Length > MaxDigits)
                return Fail(CounterWidth, $"The counter can have 1 to {MaxDigits} # characters.");
            if (width > 0)
                return Fail(TwoCounters, "Use the counter {###} only once.");

            width = inner.Length;
            i = close + 1;
        }

        return width == 0
            ? Fail(NoCounter, "The pattern needs a counter such as {###}.")
            : new ParseResult(new NumberPattern(before.ToString(), after.ToString(), width), null, null);
    }

    private static ParseResult Fail(string code, string message) => new(null, code, message);
}
