using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using AngleSharp;
using Ganss.Xss;

namespace MatterFlow.SharedKernel.Text;

/// <summary>
/// Server-side sanitizing of rich text: task comments (decision D, ticket 43), task descriptions and the HTML body of an email read by intake. It is basic rich text: paragraphs, line breaks, bold, italic,
/// underline, bullet and numbered lists, and links (http, https, mailto only; always <c>rel="noopener noreferrer"</c>). Everything else is
/// removed: scripts and styles with their content, event handlers, inline styles, classes, images, SVG/MathML, forms, iframes, data/javascript
/// URLs. Other tags are unwrapped so pasted text survives. The result is the only form that is ever stored or returned.
/// </summary>
public static partial class RichHtml
{
    private static readonly string[] AllowedTags =
        ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col"];

    /// <summary>Deepest nesting of tables kept; a table nested deeper than this is flattened into paragraphs.</summary>
    public const int MaxTableDepth = 3;

    /// <summary>Largest value of a <c>colspan</c> or <c>rowspan</c>.</summary>
    private const int MaxSpan = 100;

    private static readonly string[] AllowedScopes = ["row", "col", "rowgroup", "colgroup"];

    private static readonly HashSet<string> TableTags = new(["table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col"], StringComparer.Ordinal);

    /// <summary>Table parts whose direct children are table parts, so whitespace between them is layout, not text.</summary>
    private static readonly HashSet<string> TableStructure = new(["table", "thead", "tbody", "tfoot", "tr", "colgroup"], StringComparer.Ordinal);

    private static readonly string[] AllowedSchemes = ["http", "https", "mailto"];

    /// <summary>Elements whose content is code or markup, never text to keep.</summary>
    private static readonly string[] DroppedWithContent =
        ["script", "style", "template", "noscript", "iframe", "object", "embed", "svg", "math", "frame", "frameset", "applet", "textarea", "select", "title", "xmp", "noembed", "noframes"];

    /// <summary>Stack size of the thread that runs the parser (defence in depth behind <see cref="RichHtmlGuard"/>).</summary>
    private const int ParserStackBytes = 16 * 1024 * 1024;

    /// <summary>
    /// Returns the sanitized HTML ("" when nothing is left). Throws <see cref="RichHtmlTooComplexException"/> for input with too many tags, too
    /// deep nesting or too many table cells (SEC2-01); callers that must answer with a 400 use <see cref="TrySanitize"/>. The output size is
    /// not checked here (see <see cref="RichHtmlLimits.MaxOutputChars"/>).
    /// </summary>
    public static string Sanitize(string? html, RichHtmlLimits? limits = null)
    {
        var problem = TrySanitize(html, limits ?? RichHtmlLimits.Comment, out var clean);
        return problem is RichHtmlProblem.None or RichHtmlProblem.TooLarge ? clean : throw new RichHtmlTooComplexException(problem);
    }

    /// <summary>
    /// Sanitizes <paramref name="html"/> and says what is wrong with it, if anything. <paramref name="clean"/> is the stored form and is
    /// "" unless the result is <see cref="RichHtmlProblem.None"/> or <see cref="RichHtmlProblem.TooLarge"/> (output over the limit).
    /// The sanitized output is always a fixpoint: sanitizing it again returns it unchanged, else the input is refused as
    /// <see cref="RichHtmlProblem.Unstable"/> (a re-parse of the output would differ from what was checked: the mXSS class of attacks).
    /// </summary>
    public static RichHtmlProblem TrySanitize(string? html, RichHtmlLimits limits, out string clean)
    {
        clean = string.Empty;
        if (string.IsNullOrWhiteSpace(html))
            return RichHtmlProblem.None;

        if (html.Length > limits.MaxInputChars)
            return RichHtmlProblem.TooLarge;

        var input = html;
        var guard = RichHtmlGuard.Check(input, limits);
        if (guard != RichHtmlProblem.None)
            return guard;

        // The tree builder recurses; run it on a thread with a generous explicit stack so even an input the pre-scan missed cannot
        // exhaust the small default stack of a pool thread.
        (RichHtmlProblem Problem, string Html) result = (RichHtmlProblem.None, string.Empty);
        Exception? failure = null;
        var worker = new Thread(
            () =>
            {
                try
                {
                    result = SanitizeToFixpoint(input, limits);
                }
                catch (Exception ex)
                {
                    failure = ex;
                }
            },
            ParserStackBytes)
        {
            IsBackground = true,
            Name = "rich-html-sanitizer",
        };
        worker.Start();
        worker.Join();
        if (failure is { } error)
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error).Throw();

        if (result.Problem != RichHtmlProblem.None)
            return result.Problem;

        clean = result.Html;
        return clean.Length > limits.MaxOutputChars ? RichHtmlProblem.TooLarge : RichHtmlProblem.None;
    }

    private static (RichHtmlProblem, string) SanitizeToFixpoint(string html, RichHtmlLimits limits)
    {
        var current = SanitizeCore(html);
        for (var pass = 0; pass < MaxPasses; pass++)
        {
            var next = SanitizeCore(current);
            if (string.Equals(next, current, StringComparison.Ordinal))
                return CountTableCells(current) > limits.MaxTableCells ? (RichHtmlProblem.TooManyCells, string.Empty) : (RichHtmlProblem.None, current);
            current = next;
        }

        return (RichHtmlProblem.Unstable, string.Empty);
    }

    /// <summary>Re-sanitizing rounds allowed before the input is refused as unstable (one is enough for every known input).</summary>
    private const int MaxPasses = 2;

    /// <summary>How many table cells (td and th) the sanitized HTML has. Only meaningful for sanitized HTML, where text never contains a literal '&lt;'.</summary>
    public static int CountTableCells(string? sanitizedHtml)
    {
        if (string.IsNullOrEmpty(sanitizedHtml))
            return 0;

        var count = 0;
        var i = 0;
        while ((i = sanitizedHtml.IndexOf("<t", i, StringComparison.Ordinal)) >= 0)
        {
            if (i + 3 < sanitizedHtml.Length && sanitizedHtml[i + 2] is 'd' or 'h' && sanitizedHtml[i + 3] is '>' or ' ')
                count++;
            i += 2;
        }

        return count;
    }

    private static string SanitizeCore(string html)
    {

        // A fresh sanitizer per call: the type is not thread-safe and the setup is cheap next to the request.
        var sanitizer = new HtmlSanitizer
        {
            KeepChildNodes = true,
            AllowDataAttributes = false,
        };
        sanitizer.AllowedTags.Clear();
        sanitizer.AllowedAttributes.Clear();
        sanitizer.AllowedCssProperties.Clear();
        sanitizer.AllowedClasses.Clear();
        sanitizer.AllowedSchemes.Clear();
        sanitizer.UriAttributes.Clear();
        foreach (var tag in AllowedTags)
            sanitizer.AllowedTags.Add(tag);
        sanitizer.AllowedAttributes.Add("href");
        sanitizer.AllowedAttributes.Add("colspan");
        sanitizer.AllowedAttributes.Add("rowspan");
        sanitizer.AllowedAttributes.Add("scope");
        sanitizer.UriAttributes.Add("href");
        foreach (var scheme in AllowedSchemes)
            sanitizer.AllowedSchemes.Add(scheme);

        sanitizer.PostProcessNode += (_, e) =>
        {
            if (e.Node is AngleSharp.Dom.IElement element)
                ApplyElementPolicy(element);
        };

        var cleaned = sanitizer.Sanitize(StripDroppedElements(html));
        return IsBlank(cleaned) ? string.Empty : cleaned.Trim();
    }

    /// <summary>
    /// The per-element attribute policy (the global allow-list of the sanitizer is only the union): <c>href</c> and <c>rel</c> on links,
    /// <c>colspan</c>/<c>rowspan</c> (integers 1-100) on cells, <c>scope</c> on header cells. Anything else is removed, and a value that does not
    /// fit is removed, never repaired into something else.
    /// </summary>
    private static void ApplyElementPolicy(AngleSharp.Dom.IElement element)
    {
        var tag = element.LocalName;
        foreach (var attribute in element.Attributes.ToList())
        {
            var keep = (tag, attribute.Name) switch
            {
                ("a", "href") => true,
                ("td" or "th", "colspan" or "rowspan") => true,
                ("th", "scope") => true,
                _ => false,
            };
            if (!keep)
                element.RemoveAttribute(attribute.Name);
        }

        switch (tag)
        {
            case "a":
                var href = element.GetAttribute("href");
                if (href is null || !IsSafeLink(href))
                {
                    element.RemoveAttribute("href");
                    element.RemoveAttribute("rel");
                    return;
                }

                element.SetAttribute("rel", "noopener noreferrer");
                break;
            case "td" or "th":
                NormalizeSpan(element, "colspan");
                NormalizeSpan(element, "rowspan");
                if (tag == "th")
                {
                    var scope = element.GetAttribute("scope")?.Trim().ToLowerInvariant();
                    if (scope is null || !AllowedScopes.Contains(scope, StringComparer.Ordinal))
                        element.RemoveAttribute("scope");
                    else
                        element.SetAttribute("scope", scope);
                }

                break;
        }
    }

    /// <summary>Keeps a span only when it is a plain integer 1-100 (digits only, so no signs, exponents, hex or non-ASCII digits); 1 is the default and is dropped.</summary>
    private static void NormalizeSpan(AngleSharp.Dom.IElement element, string name)
    {
        var raw = element.GetAttribute(name);
        if (raw is null)
            return;

        var value = raw.Trim();
        if (value.Length is >= 1 and <= 3 && value.All(char.IsAsciiDigit) && int.Parse(value, System.Globalization.CultureInfo.InvariantCulture) is >= 1 and <= MaxSpan and var span && span > 1)
            element.SetAttribute(name, span.ToString(System.Globalization.CultureInfo.InvariantCulture));
        else
            element.RemoveAttribute(name);
    }

    /// <summary>
    /// The visible text of sanitized (or any) HTML, for length and emptiness checks, list snippets, audit text and exports: paragraphs, list items,
    /// line breaks and table rows end a line, table cells are separated by " | ". Nothing is executed or fetched.
    /// </summary>
    public static string ToPlainText(string? html)
    {
        if (string.IsNullOrEmpty(html))
            return string.Empty;

        // U+0001 marks the end of a table cell while the text is cleaned (it cannot occur in sanitized HTML text).
        var withCells = CellEndPattern().Replace(html, "\u0001");
        var withBreaks = BreakPattern().Replace(withCells, "\n");
        var text = WebUtility.HtmlDecode(TagPattern().Replace(withBreaks, string.Empty));
        text = TrailingCellMarkPattern().Replace(text, string.Empty);
        text = LineBreakBeforeCellMarkPattern().Replace(text, "\u0001");
        text = BlankLinePattern().Replace(text.Replace("\u0001", " | ", StringComparison.Ordinal), "\n");
        return text.Trim();
    }

    /// <summary>True when the text contains markup of the kinds an editor or an email produces (so it is HTML, not a plain-text note that mentions "&lt;name@example.com&gt;").</summary>
    public static bool LooksLikeHtml(string? text) => !string.IsNullOrEmpty(text) && KnownTagPattern().IsMatch(text);

    /// <summary>Plain text as HTML: everything escaped, a blank line starts a paragraph, a single line break becomes a <c>&lt;br&gt;</c>.</summary>
    public static string FromPlainText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return string.Empty;

        var normalized = text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Trim('\n', ' ', '\t');
        var sb = new StringBuilder(normalized.Length + 32);
        foreach (var paragraph in BlankLinePattern().Split(normalized))
        {
            if (string.IsNullOrWhiteSpace(paragraph))
                continue;

            sb.Append("<p>");
            var first = true;
            foreach (var line in paragraph.Split('\n'))
            {
                if (!first)
                    sb.Append("<br>");
                first = false;
                sb.Append(WebUtility.HtmlEncode(line.TrimEnd()));
            }

            sb.Append("</p>");
        }

        return sb.ToString();
    }

    /// <summary>
    /// Removes the embedding and override controls (U+202A to U+202E) from text: they reorder what is shown, so pasted text could display
    /// a different amount, name or address than it contains. The isolate controls and the plain marks stay (right-to-left scripts use them).
    /// </summary>
    private static string StripBidiOverrides(string text)
    {
        if (text.AsSpan().IndexOfAnyInRange('\u202A', '\u202E') < 0)
            return text;

        var sb = new StringBuilder(text.Length);
        foreach (var c in text)
        {
            if (c is < '\u202A' or > '\u202E')
                sb.Append(c);
        }

        return sb.ToString();
    }

    private static bool IsBidiControl(char c) => c is (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069') or '\u200E' or '\u200F' or '\u061C';

    private static bool IsBlank(string html) => ToPlainText(html).Length == 0;

    /// <summary>Absolute http, https or mailto URLs only; relative and protocol-relative links are not allowed.</summary>
    private static bool IsSafeLink(string href)
    {
        var value = href.Trim();
        if (value.Length == 0 || value.Length > 2000 || value.Any(c => char.IsControl(c) || IsBidiControl(c) || c is '<' or '>' or '"' or '`'))
            return false;

        // Links with credentials (https://google.com@evil.com) read as another site: not kept as links (SEC2-12).
        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && AllowedSchemes.Contains(uri.Scheme, StringComparer.OrdinalIgnoreCase)
            && (uri.UserInfo.Length == 0 || string.Equals(uri.Scheme, "mailto", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Removes script-like elements together with their content before the allow-list unwraps everything else.</summary>
    private static string StripDroppedElements(string html)
    {
        var parser = new AngleSharp.Html.Parser.HtmlParser();
        var document = parser.ParseDocument(string.Empty);
        var body = document.Body!;
        body.InnerHtml = html;

        foreach (var name in DroppedWithContent)
        {
            foreach (var element in body.QuerySelectorAll(name).ToList())
                element.Remove();
        }

        // Pasted or contenteditable markup (div lines, headings, quotes) becomes paragraphs so line breaks survive the allow-list.
        // One read-only post-order walk that writes the result (depth is bounded by RichHtmlGuard). Moving nodes inside the DOM
        // per element was the cubic cost of SEC2-02.
        var output = new StringBuilder(html.Length + 64);
        EmitChildren(body, output, tableDepth: 0);
        return output.ToString();
    }

    /// <summary>
    /// Writes the children of <paramref name="parent"/> with block wrappers turned into paragraphs; true when a block element ends up directly inside.
    /// Comments, processing instructions and the whitespace between table parts are not written. Tables nested deeper than
    /// <see cref="MaxTableDepth"/> are flattened: their rows and cells become paragraphs.
    /// </summary>
    private static bool EmitChildren(AngleSharp.Dom.INode parent, StringBuilder output, int tableDepth)
    {
        var hasBlock = false;
        var structural = parent is AngleSharp.Dom.IElement parentElement && TableStructure.Contains(parentElement.LocalName);
        foreach (var child in parent.ChildNodes)
        {
            if (child is AngleSharp.Dom.IText text)
            {
                if (!structural || !string.IsNullOrWhiteSpace(text.Data))
                    output.Append(StripBidiOverrides(child.ToHtml()));
                continue;
            }

            if (child is not AngleSharp.Dom.IElement element)
                continue;

            var name = element.LocalName;
            var depth = name == "table" ? tableDepth + 1 : tableDepth;
            var flattened = depth > MaxTableDepth && TableTags.Contains(name);

            if (flattened && name is not ("tr" or "th" or "td" or "caption"))
            {
                // table, sections, column groups: no wrapper of their own, their rows carry the content.
                if (name is not "col")
                    hasBlock |= EmitChildren(element, output, depth);
                continue;
            }

            if (flattened || BlockWrappers.Contains(name))
            {
                var inner = new StringBuilder();
                if (EmitChildren(element, inner, depth))
                {
                    if (flattened)
                        output.Append("<br>"); // text before the paragraphs of a flattened cell must not run into the text around it
                    output.Append(inner);
                    hasBlock = true;
                }
                else
                {
                    output.Append("<p>").Append(inner).Append("</p>");
                    hasBlock = true;
                }

                continue;
            }

            var outer = ((AngleSharp.Dom.IElement)element.Clone(false)).OuterHtml;
            var closing = "</" + name + ">";
            if (outer.EndsWith(closing, StringComparison.Ordinal))
            {
                output.Append(outer, 0, outer.Length - closing.Length);
                EmitChildren(element, output, depth);
                output.Append(closing);
            }
            else
            {
                output.Append(outer);
            }

            hasBlock |= BlockNames.Contains(name);
        }

        return hasBlock;
    }

    private static readonly HashSet<string> BlockWrappers = new(["div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "section", "article", "address"], StringComparer.Ordinal);

    private static readonly HashSet<string> BlockNames = new(["p", "ul", "ol", "li", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "section", "article", "address", "table", "tr", "td", "th", "tbody", "thead", "tfoot", "caption"], StringComparer.Ordinal);

    [GeneratedRegex(@"<\s*(br\s*/?|/p|/li|/tr|/caption|/table)\s*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex BreakPattern();

    [GeneratedRegex(@"<\s*/t[dh]\s*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CellEndPattern();

    /// <summary>The cell mark after the last cell of a row (or of the text).</summary>
    [GeneratedRegex("\u0001[ \u00A0\t]*(?=\n|$)", RegexOptions.CultureInvariant)]
    private static partial Regex TrailingCellMarkPattern();

    /// <summary>A paragraph end inside a cell would put the cell separator on the next line.</summary>
    [GeneratedRegex("\n+\u0001", RegexOptions.CultureInvariant)]
    private static partial Regex LineBreakBeforeCellMarkPattern();

    [GeneratedRegex("<[^<>]*>", RegexOptions.CultureInvariant)]
    private static partial Regex TagPattern();

    [GeneratedRegex(@"</?(p|br|b|strong|i|em|u|ul|ol|li|a|div|span|font|h[1-6]|table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col|blockquote|pre|img|svg|math|script|style|iframe|object|embed|form|input|button|textarea|select|link|meta|base|html|head|body|title|o:p)(?=[\s/>])|<!--|<!\[|<\?", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex KnownTagPattern();

    [GeneratedRegex(@"\n[ \t]*\n+", RegexOptions.CultureInvariant)]
    private static partial Regex BlankLinePattern();
}
