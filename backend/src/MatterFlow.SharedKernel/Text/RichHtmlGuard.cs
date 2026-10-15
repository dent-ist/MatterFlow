namespace MatterFlow.SharedKernel.Text;

/// <summary>
/// Linear-time structural pre-scan of comment HTML (SEC2-01/02). AngleSharp builds its tree recursively, so a few hundred nested
/// <c>&lt;pre&gt;</c> tags overflow the stack and kill the process, which no exception handler can stop. This scan runs before any parser
/// and rejects input whose tag count or nesting depth exceeds small caps. It is deliberately conservative: it counts every
/// <c>&lt;</c> followed by a letter as an opening tag (also inside attribute values, in raw-text elements and for <c>/&gt;</c>, which HTML
/// ignores outside foreign content), pops only when the closing tag matches the innermost open tag, and so never reports a smaller
/// depth than a real parser would build. Legitimate editor output (flat paragraphs, lists, a few inline tags) is far below the caps.
/// </summary>
public static class RichHtmlGuard
{
    /// <summary>Elements that never nest or never stay open in the HTML parser, so they do not add depth.</summary>
    private static readonly HashSet<string> NoDepth = new(
        [
            "area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img", "image", "input", "keygen", "link", "meta", "param", "source", "track", "wbr",
            "p", "li", "dt", "dd", "tr", "td", "th", "tbody", "thead", "tfoot", "caption", "colgroup", "option", "optgroup", "rb", "rt", "rp", "rtc",
        ],
        StringComparer.Ordinal);

    /// <summary>Raw table cells counted per allowed cell: the exact count is taken on the sanitized output, this only stops absurd input early.</summary>
    private const int RawCellTolerance = 4;

    /// <summary>True when the input has more tags or a deeper nesting than <paramref name="limits"/> allow (default: comment limits).</summary>
    public static bool IsTooComplex(string? html, RichHtmlLimits? limits = null) => Check(html, limits ?? RichHtmlLimits.Comment) == RichHtmlProblem.TooComplex;

    /// <summary>
    /// Scans the input once. <see cref="RichHtmlProblem.TooComplex"/> for too many tags or too deep nesting, <see cref="RichHtmlProblem.TooManyCells"/>
    /// for a flood of table cells (checked first, so a giant table gets the clear answer), otherwise <see cref="RichHtmlProblem.None"/>.
    /// </summary>
    public static RichHtmlProblem Check(string? html, RichHtmlLimits limits)
    {
        if (string.IsNullOrEmpty(html))
            return RichHtmlProblem.None;

        var maxTags = limits.MaxTags;
        var maxDepth = limits.MaxDepth;
        var stack = new List<string>(maxDepth + 1);
        var tags = 0;
        var cells = 0;
        var tooComplex = false;
        var i = 0;
        while (i < html.Length)
        {
            var lt = html.IndexOf('<', i);
            if (lt < 0 || lt + 1 >= html.Length)
                break;

            var c = html[lt + 1];
            if (c == '/')
            {
                var nameStart = lt + 2;
                var end = NameEnd(html, nameStart);
                if (end > nameStart)
                {
                    if (++tags > maxTags)
                        tooComplex = true;
                    var name = html.Substring(nameStart, end - nameStart).ToLowerInvariant();
                    if (stack.Count > 0 && stack[^1] == name)
                        stack.RemoveAt(stack.Count - 1);
                }

                i = Math.Max(end, lt + 2);
            }
            else if (IsAsciiLetter(c))
            {
                if (++tags > maxTags)
                    tooComplex = true;
                var end = NameEnd(html, lt + 1);
                var name = html.Substring(lt + 1, end - lt - 1).ToLowerInvariant();
                if (name is "td" or "th" && ++cells > limits.MaxTableCells * RawCellTolerance)
                    return RichHtmlProblem.TooManyCells;
                if (!NoDepth.Contains(name))
                {
                    stack.Add(name);
                    if (stack.Count > maxDepth)
                        tooComplex = true;
                }

                i = end;
            }
            else if (c is '!' or '?')
            {
                if (++tags > maxTags)
                    tooComplex = true;
                i = lt + 2;
            }
            else
            {
                i = lt + 1;
            }

            // Past the tag cap the scan can stop: the answer is "too complex" unless a cell flood would have been named first, and a
            // cell flood needs more tags than the cap anyway, so keep scanning only until the tag count proves the input hostile.
            if (tooComplex)
                return cells > limits.MaxTableCells ? RichHtmlProblem.TooManyCells : RichHtmlProblem.TooComplex;
        }

        return RichHtmlProblem.None;
    }

    private static int NameEnd(string html, int start)
    {
        var i = start;
        while (i < html.Length && html[i] is not (' ' or '\t' or '\n' or '\r' or '\f' or '/' or '>'))
            i++;
        return i;
    }

    private static bool IsAsciiLetter(char c) => c is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z');
}

/// <summary>What <see cref="RichHtmlGuard.Check"/> found.</summary>
public enum RichHtmlProblem
{
    None,

    /// <summary>More tags or deeper nesting than the limits allow.</summary>
    TooComplex,

    /// <summary>Far more table cells than the limits allow.</summary>
    TooManyCells,

    /// <summary>The sanitized output is longer than the limits allow, or the input is longer than the limits allow.</summary>
    TooLarge,

    /// <summary>Sanitizing the output again changed it, so it cannot be trusted (not seen with any known input).</summary>
    Unstable,
}

/// <summary>Size limits of one kind of rich text field.</summary>
/// <param name="MaxInputChars">Longest accepted input (characters, before sanitizing).</param>
/// <param name="MaxOutputChars">Longest accepted sanitized HTML (characters).</param>
/// <param name="MaxTags">Most tags (open, close, comments, doctype) in the input.</param>
/// <param name="MaxDepth">Deepest nesting of elements in the input.</param>
/// <param name="MaxTableCells">Most table cells (td and th, nested tables included) in the sanitized output.</param>
public sealed record RichHtmlLimits(int MaxInputChars, int MaxOutputChars, int MaxTags, int MaxDepth, int MaxTableCells)
{
    /// <summary>Task comments (decision D, relaxed for tables by decision R).</summary>
    public static readonly RichHtmlLimits Comment = new(20_000, 20_000, 2_500, 20, 200);

    /// <summary>Task descriptions: Outlook paste is heavy, so the input may be several times the stored size.</summary>
    public static readonly RichHtmlLimits Description = new(300_000, 100_000, 10_000, 20, 200);

    /// <summary>The HTML body of an email read by intake; anything over a limit falls back to the plain-text body.</summary>
    public static readonly RichHtmlLimits Email = new(1_000_000, 100_000, 20_000, 20, 200);
}

/// <summary>The HTML has more tags or deeper nesting than the limits allow.</summary>
public sealed class RichHtmlTooComplexException(RichHtmlProblem problem = RichHtmlProblem.TooComplex) : InvalidOperationException("The markup is too complex.")
{
    /// <summary>What was found.</summary>
    public RichHtmlProblem Problem { get; } = problem;
}
