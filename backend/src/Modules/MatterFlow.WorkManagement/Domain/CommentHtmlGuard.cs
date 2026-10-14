namespace MatterFlow.WorkManagement.Domain;

/// <summary>
/// Linear-time structural pre-scan of comment HTML (SEC2-01/02). AngleSharp builds its tree recursively, so a few hundred nested
/// <c>&lt;pre&gt;</c> tags overflow the stack and kill the process, which no exception handler can stop. This scan runs before any parser
/// and rejects input whose tag count or nesting depth exceeds small caps. It is deliberately conservative: it counts every
/// <c>&lt;</c> followed by a letter as an opening tag (also inside attribute values, in raw-text elements and for <c>/&gt;</c>, which HTML
/// ignores outside foreign content), pops only when the closing tag matches the innermost open tag, and so never reports a smaller
/// depth than a real parser would build. Legitimate editor output (flat paragraphs, lists, a few inline tags) is far below the caps.
/// </summary>
public static class CommentHtmlGuard
{
    /// <summary>Most tags (open, close, comments, doctype) accepted in one comment.</summary>
    public const int MaxTags = 1000;

    /// <summary>Deepest accepted nesting of elements.</summary>
    public const int MaxDepth = 20;

    /// <summary>Elements that never nest or never stay open in the HTML parser, so they do not add depth.</summary>
    private static readonly HashSet<string> NoDepth = new(
        [
            "area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img", "image", "input", "keygen", "link", "meta", "param", "source", "track", "wbr",
            "p", "li", "dt", "dd", "tr", "td", "th", "tbody", "thead", "tfoot", "caption", "colgroup", "option", "optgroup", "rb", "rt", "rp", "rtc",
        ],
        StringComparer.Ordinal);

    /// <summary>True when the input has more tags or a deeper nesting than a comment may have.</summary>
    public static bool IsTooComplex(string? html)
    {
        if (string.IsNullOrEmpty(html))
            return false;

        var stack = new List<string>(MaxDepth + 1);
        var tags = 0;
        var i = 0;
        while (i < html.Length)
        {
            var lt = html.IndexOf('<', i);
            if (lt < 0 || lt + 1 >= html.Length)
                return false;

            var c = html[lt + 1];
            if (c == '/')
            {
                var nameStart = lt + 2;
                var end = NameEnd(html, nameStart);
                if (end > nameStart)
                {
                    if (++tags > MaxTags)
                        return true;
                    var name = html.Substring(nameStart, end - nameStart).ToLowerInvariant();
                    if (stack.Count > 0 && stack[^1] == name)
                        stack.RemoveAt(stack.Count - 1);
                }

                i = Math.Max(end, lt + 2);
            }
            else if (IsAsciiLetter(c))
            {
                if (++tags > MaxTags)
                    return true;
                var end = NameEnd(html, lt + 1);
                var name = html.Substring(lt + 1, end - lt - 1).ToLowerInvariant();
                if (!NoDepth.Contains(name))
                {
                    stack.Add(name);
                    if (stack.Count > MaxDepth)
                        return true;
                }

                i = end;
            }
            else if (c is '!' or '?')
            {
                if (++tags > MaxTags)
                    return true;
                i = lt + 2;
            }
            else
            {
                i = lt + 1;
            }
        }

        return false;
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
