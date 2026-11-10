using System.Net;
using System.Text;

namespace MatterFlow.Intake.Application;

/// <summary>
/// Converts an HTML email body to plain text. The output is text, so no markup is left to attack, and nothing is fetched.
/// Scripts, styles, head content, comments and images are dropped; paragraphs and line breaks are kept; list items become
/// <c>- item</c>; <c>http(s)</c> and <c>mailto</c> links are written as <c>text (url)</c>.
/// <para>
/// Security review SEC-02: this is a single-pass, stack-less tokenizer. It builds no document tree, so the cost is linear in the
/// input and independent of nesting depth (the HtmlAgilityPack tree builder it replaces was super-linear: 32,000 nested tags took 17 s).
/// The input is capped at <see cref="MaxInputChars"/> characters, the output at <c>maxChars</c>, scanning stops as soon as the output
/// is full, and the cancellation token is polled while scanning, so a timeout really stops the work.
/// </para>
/// </summary>
internal static class HtmlToText
{
    /// <summary>Longest HTML (in characters) that is examined; anything beyond is ignored.</summary>
    public const int MaxInputChars = 1_000_000;

    private const int MaxOpenAnchors = 32;

    private const int PollEvery = 512;

    // Elements whose whole content is dropped. Void ones have no content to skip.
    private static readonly HashSet<string> SkipContent = new(StringComparer.OrdinalIgnoreCase)
    {
        "script", "style", "title", "template", "noscript", "object", "embed", "iframe", "svg",
    };

    private static readonly HashSet<string> DroppedVoid = new(StringComparer.OrdinalIgnoreCase) { "meta", "link", "img" };

    private static readonly HashSet<string> Blocks = new(StringComparer.OrdinalIgnoreCase)
    {
        "p", "div", "section", "article", "header", "footer", "blockquote", "pre", "ul", "ol", "table",
        "h1", "h2", "h3", "h4", "h5", "h6", "hr", "address", "form", "fieldset", "dl", "dt", "dd",
    };

    public static string Convert(string? html, int maxChars = EmailLimits.MaxHtmlTextChars, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(html))
            return string.Empty;

        var input = html.AsSpan(0, Math.Min(html.Length, MaxInputChars));
        var output = new Writer(maxChars);
        var anchors = new Stack<(string Target, int Mark)>();
        var position = 0;
        var tags = 0;
        while (position < input.Length && !output.Full)
        {
            var lt = input[position..].IndexOf('<');
            if (lt < 0)
            {
                output.Text(WebUtility.HtmlDecode(input[position..].ToString()));
                break;
            }

            if (lt > 0)
                output.Text(WebUtility.HtmlDecode(input.Slice(position, lt).ToString()));
            position += lt;

            if ((++tags & (PollEvery - 1)) == 0)
                cancellationToken.ThrowIfCancellationRequested();

            var rest = input[position..];
            if (rest.StartsWith("<!--", StringComparison.Ordinal))
            {
                var close = rest[4..].IndexOf("-->", StringComparison.Ordinal);
                position = close < 0 ? input.Length : position + 4 + close + 3;
                continue;
            }

            if (rest.Length > 1 && (rest[1] == '!' || rest[1] == '?'))
            {
                var gt = rest.IndexOf('>');
                position = gt < 0 ? input.Length : position + gt + 1;
                continue;
            }

            var closing = rest.Length > 1 && rest[1] == '/';
            var nameStart = closing ? 2 : 1;
            var nameEnd = nameStart;
            while (nameEnd < rest.Length && (char.IsAsciiLetterOrDigit(rest[nameEnd]) || rest[nameEnd] is ':' or '-'))
                nameEnd++;

            if (nameEnd == nameStart || !char.IsAsciiLetter(rest[nameStart]))
            {
                output.Text("<"); // a literal '<' that does not start a tag
                position++;
                continue;
            }

            var tagEnd = FindTagEnd(rest, nameEnd);
            if (tagEnd < 0)
            {
                position = input.Length; // unterminated tag: nothing readable follows
                continue;
            }

            var name = rest[nameStart..nameEnd].ToString();
            var attributes = rest[nameEnd..tagEnd];
            position += tagEnd + 1;

            if (closing)
            {
                Leave(name, output, anchors);
                continue;
            }

            if (DroppedVoid.Contains(name))
                continue;

            var isHead = name.Equals("head", StringComparison.OrdinalIgnoreCase);
            if (SkipContent.Contains(name) || isHead)
            {
                var close = IndexOfClose(input[position..], name);
                if (close < 0)
                {
                    if (isHead)
                        continue; // an unclosed <head> is transparent; its script/style/title children are dropped on their own
                    break; // an unclosed script/style swallows the rest of the document
                }

                var after = input[(position + close)..].IndexOf('>');
                position = after < 0 ? input.Length : position + close + after + 1;
                continue;
            }

            if (name.Equals("br", StringComparison.OrdinalIgnoreCase))
            {
                output.LineBreak();
                continue;
            }

            Enter(name, output);
            if (name.Equals("a", StringComparison.OrdinalIgnoreCase) && anchors.Count < MaxOpenAnchors)
            {
                var href = AttributeValue(attributes, "href").Trim();
                anchors.Push((IsKeptLink(href) ? href : string.Empty, output.Length));
            }
        }

        return output.ToString();
    }

    /// <summary>Index of the '>' that ends the tag, honoring quoted attribute values; -1 when the tag never ends.</summary>
    private static int FindTagEnd(ReadOnlySpan<char> tag, int from)
    {
        var quote = '\0';
        for (var i = from; i < tag.Length; i++)
        {
            var ch = tag[i];
            if (quote != '\0')
            {
                if (ch == quote)
                    quote = '\0';
            }
            else if (ch is '"' or '\'')
            {
                quote = ch;
            }
            else if (ch == '>')
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>Index of the next <c>&lt;/name</c> (case-insensitive), or -1.</summary>
    private static int IndexOfClose(ReadOnlySpan<char> rest, string name)
    {
        var offset = 0;
        while (offset < rest.Length)
        {
            var i = rest[offset..].IndexOf("</", StringComparison.Ordinal);
            if (i < 0)
                return -1;
            var at = offset + i;
            var candidate = rest[(at + 2)..];
            if (candidate.Length >= name.Length && candidate[..name.Length].Equals(name, StringComparison.OrdinalIgnoreCase)
                && (candidate.Length == name.Length || !char.IsAsciiLetterOrDigit(candidate[name.Length])))
                return at;
            offset = at + 2;
        }

        return -1;
    }

    /// <summary>Value of one attribute from a tag's attribute text (empty when absent).</summary>
    private static string AttributeValue(ReadOnlySpan<char> attributes, string wanted)
    {
        var i = 0;
        while (i < attributes.Length)
        {
            while (i < attributes.Length && (char.IsWhiteSpace(attributes[i]) || attributes[i] == '/'))
                i++;
            var nameStart = i;
            while (i < attributes.Length && !char.IsWhiteSpace(attributes[i]) && attributes[i] is not ('=' or '/'))
                i++;
            var name = attributes[nameStart..i];
            while (i < attributes.Length && char.IsWhiteSpace(attributes[i]))
                i++;
            var value = ReadOnlySpan<char>.Empty;
            if (i < attributes.Length && attributes[i] == '=')
            {
                i++;
                while (i < attributes.Length && char.IsWhiteSpace(attributes[i]))
                    i++;
                if (i < attributes.Length && attributes[i] is '"' or '\'')
                {
                    var quote = attributes[i++];
                    var valueStart = i;
                    while (i < attributes.Length && attributes[i] != quote)
                        i++;
                    value = attributes[valueStart..i];
                    i = Math.Min(i + 1, attributes.Length);
                }
                else
                {
                    var valueStart = i;
                    while (i < attributes.Length && !char.IsWhiteSpace(attributes[i]))
                        i++;
                    value = attributes[valueStart..i];
                }
            }
            else if (name.IsEmpty)
            {
                i++; // stray character; guarantees progress
            }

            if (name.Equals(wanted, StringComparison.OrdinalIgnoreCase))
                return WebUtility.HtmlDecode(value.ToString());
        }

        return string.Empty;
    }

    private static void Enter(string name, Writer output)
    {
        if (Blocks.Contains(name))
            output.Paragraph();
        else if (name.Equals("tr", StringComparison.OrdinalIgnoreCase))
            output.LineStart();
        else if (name.Equals("li", StringComparison.OrdinalIgnoreCase))
        {
            output.LineStart();
            output.Raw("- ");
        }
        else if (name.Equals("td", StringComparison.OrdinalIgnoreCase) || name.Equals("th", StringComparison.OrdinalIgnoreCase))
            output.Cell();
    }

    private static void Leave(string name, Writer output, Stack<(string Target, int Mark)> anchors)
    {
        if (name.Equals("a", StringComparison.OrdinalIgnoreCase))
        {
            if (anchors.Count == 0)
                return;

            var (href, mark) = anchors.Pop();
            if (href.Length > 0)
            {
                var target = href.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) ? href[7..] : href;
                var label = output.Since(mark).Trim();
                if (target.Length > 0 && !label.Equals(target, StringComparison.OrdinalIgnoreCase)
                    && !label.TrimEnd('/').Equals(target.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
                    output.Raw(" (" + target + ")");
            }
        }
        else if (Blocks.Contains(name))
            output.Paragraph();
        else if (name.Equals("li", StringComparison.OrdinalIgnoreCase) || name.Equals("tr", StringComparison.OrdinalIgnoreCase))
            output.LineStart();
    }

    private static bool IsKeptLink(string href) =>
        href.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
        || href.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
        || href.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase);

    /// <summary>Output buffer that collapses whitespace and tracks pending line breaks.</summary>
    private sealed class Writer(int maxChars)
    {
        private readonly StringBuilder _sb = new();
        private bool _pendingSpace;
        private int _pendingNewlines;

        public bool Full => _sb.Length >= maxChars;

        public int Length => _sb.Length;

        public string Since(int mark) => mark >= _sb.Length ? string.Empty : _sb.ToString(mark, _sb.Length - mark);

        public void Text(string text)
        {
            foreach (var ch in text)
            {
                if (ch is ' ' or '\t' or '\r' or '\n' or '\u00A0' or '\f')
                {
                    if (_sb.Length > 0)
                        _pendingSpace = true;
                    continue;
                }

                if (char.IsControl(ch))
                    continue;

                Flush();
                _sb.Append(ch);
                if (_sb.Length >= maxChars)
                    return;
            }
        }

        public void Raw(string text)
        {
            Flush();
            _sb.Append(text);
        }

        public void LineBreak() => _pendingNewlines = _pendingNewlines > 0 ? _pendingNewlines + 1 : 1;

        public void Paragraph() => _pendingNewlines = Math.Max(_pendingNewlines, 2);

        public void LineStart() => _pendingNewlines = Math.Max(_pendingNewlines, 1);

        public void Cell()
        {
            if (_sb.Length > 0 && _pendingNewlines == 0)
                _pendingSpace = true;
        }

        private void Flush()
        {
            if (_sb.Length > 0)
            {
                if (_pendingNewlines > 0)
                    _sb.Append('\n', Math.Min(_pendingNewlines, 2));
                else if (_pendingSpace)
                    _sb.Append(' ');
            }

            _pendingNewlines = 0;
            _pendingSpace = false;
        }

        public override string ToString() => _sb.ToString().Trim();
    }
}
