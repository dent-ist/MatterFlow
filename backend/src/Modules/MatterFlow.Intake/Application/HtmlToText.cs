using System.Text;
using HtmlAgilityPack;

namespace MatterFlow.Intake.Application;

/// <summary>
/// Converts an HTML email body to plain text. The output is text, so no markup is left to attack, and nothing is fetched.
/// Scripts, styles, head content, comments and images are dropped; paragraphs and line breaks are kept; list items become
/// <c>- item</c>; <c>http(s)</c> and <c>mailto</c> links are written as <c>text (url)</c>. The walk is iterative, so deeply nested markup
/// cannot overflow the stack, and the output is capped.
/// </summary>
internal static class HtmlToText
{
    private static readonly HashSet<string> Dropped = new(StringComparer.OrdinalIgnoreCase)
    {
        "script", "style", "head", "title", "template", "noscript", "object", "embed", "iframe", "svg", "meta", "link", "img",
    };

    private static readonly HashSet<string> Blocks = new(StringComparer.OrdinalIgnoreCase)
    {
        "p", "div", "section", "article", "header", "footer", "blockquote", "pre", "ul", "ol", "table",
        "h1", "h2", "h3", "h4", "h5", "h6", "hr", "address", "form", "fieldset", "dl", "dt", "dd",
    };

    public static string Convert(string? html, int maxChars = EmailLimits.MaxHtmlTextChars)
    {
        if (string.IsNullOrWhiteSpace(html))
            return string.Empty;

        var document = new HtmlDocument { OptionAutoCloseOnEnd = true };
        document.LoadHtml(html);

        var output = new Writer(maxChars);
        var stack = new Stack<(HtmlNode Node, bool Exit)>();
        stack.Push((document.DocumentNode, false));
        while (stack.Count > 0 && !output.Full)
        {
            var (node, exit) = stack.Pop();
            if (exit)
            {
                Leave(node, output);
                continue;
            }

            if (node.NodeType == HtmlNodeType.Text)
            {
                output.Text(HtmlEntity.DeEntitize(((HtmlTextNode)node).Text));
                continue;
            }

            if (node.NodeType == HtmlNodeType.Comment)
                continue;

            var name = node.Name;
            if (Dropped.Contains(name))
                continue;

            if (name.Equals("br", StringComparison.OrdinalIgnoreCase))
            {
                output.LineBreak();
                continue;
            }

            Enter(name, output);
            stack.Push((node, true));
            for (var child = node.LastChild; child is not null; child = child.PreviousSibling)
                stack.Push((child, false));
        }

        return output.ToString();
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

    private static void Leave(HtmlNode node, Writer output)
    {
        var name = node.Name;
        if (name.Equals("a", StringComparison.OrdinalIgnoreCase))
        {
            var href = node.GetAttributeValue("href", string.Empty).Trim();
            if (IsKeptLink(href))
            {
                var target = href.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) ? href[7..] : href;
                var label = HtmlEntity.DeEntitize(node.InnerText).Trim();
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

        public void Text(string text)
        {
            foreach (var ch in text)
            {
                if (ch is ' ' or '\t' or '\r' or '\n' or ' ' or '\f')
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
