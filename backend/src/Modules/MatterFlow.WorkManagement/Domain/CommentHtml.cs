using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using AngleSharp;
using Ganss.Xss;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>
/// Server-side sanitizing of comment bodies (decision D, ticket 43). Comments are basic rich text: paragraphs, line breaks, bold, italic,
/// underline, bullet and numbered lists, and links (http, https, mailto only; always <c>rel="noopener noreferrer"</c>). Everything else is
/// removed: scripts and styles with their content, event handlers, inline styles, classes, images, SVG/MathML, forms, iframes, data/javascript
/// URLs. Other tags are unwrapped so pasted text survives. The result is the only form that is ever stored or returned.
/// </summary>
public static partial class CommentHtml
{
    /// <summary>Largest accepted body (characters, before sanitizing).</summary>
    public const int MaxLength = 20_000;

    private static readonly string[] AllowedTags = ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a"];

    private static readonly string[] AllowedSchemes = ["http", "https", "mailto"];

    /// <summary>Elements whose content is code or markup, never text to keep.</summary>
    private static readonly string[] DroppedWithContent =
        ["script", "style", "template", "noscript", "iframe", "object", "embed", "svg", "math", "frame", "frameset", "applet", "textarea", "select", "title", "xmp", "noembed", "noframes"];

    /// <summary>Stack size of the thread that runs the parser (defence in depth behind <see cref="CommentHtmlGuard"/>).</summary>
    private const int ParserStackBytes = 16 * 1024 * 1024;

    /// <summary>
    /// Returns the sanitized HTML ("" when nothing is left). Throws <see cref="CommentTooComplexException"/> for input with too many tags
    /// or too deep nesting (SEC2-01); callers should check <see cref="CommentHtmlGuard.IsTooComplex"/> first to answer with a 400.
    /// </summary>
    public static string Sanitize(string? html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return string.Empty;

        if (CommentHtmlGuard.IsTooComplex(html))
            throw new CommentTooComplexException();

        // The tree builder recurses; run it on a thread with a generous explicit stack so even an input the pre-scan missed cannot
        // exhaust the small default stack of a pool thread.
        string? result = null;
        Exception? failure = null;
        var worker = new Thread(
            () =>
            {
                try
                {
                    result = SanitizeCore(html);
                }
                catch (Exception ex)
                {
                    failure = ex;
                }
            },
            ParserStackBytes)
        {
            IsBackground = true,
            Name = "comment-sanitizer",
        };
        worker.Start();
        worker.Join();
        if (failure is not null)
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
        return result!;
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
        sanitizer.UriAttributes.Add("href");
        foreach (var scheme in AllowedSchemes)
            sanitizer.AllowedSchemes.Add(scheme);

        sanitizer.PostProcessNode += (_, e) =>
        {
            if (e.Node is not AngleSharp.Dom.IElement element || !string.Equals(element.LocalName, "a", StringComparison.Ordinal))
                return;

            var href = element.GetAttribute("href");
            if (href is null || !IsSafeLink(href))
            {
                element.RemoveAttribute("href");
                element.RemoveAttribute("rel");
                return;
            }

            element.SetAttribute("rel", "noopener noreferrer");
        };

        var cleaned = sanitizer.Sanitize(StripDroppedElements(html));
        return IsBlank(cleaned) ? string.Empty : cleaned.Trim();
    }

    /// <summary>The visible text of sanitized (or any) HTML, for length and emptiness checks and plain-text previews.</summary>
    public static string ToPlainText(string? html)
    {
        if (string.IsNullOrEmpty(html))
            return string.Empty;

        var withBreaks = BreakPattern().Replace(html, "\n");
        var text = TagPattern().Replace(withBreaks, string.Empty);
        return WebUtility.HtmlDecode(text).Trim();
    }

    private static bool IsBidiControl(char c) => c is (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069') or '\u200E' or '\u200F' or '\u061C';

    private static bool IsBlank(string html) => ToPlainText(html).Length == 0;

    /// <summary>Absolute http, https or mailto URLs only; relative and protocol-relative links are not allowed.</summary>
    private static bool IsSafeLink(string href)
    {
        var value = href.Trim();
        if (value.Length == 0 || value.Length > 2000 || value.Any(c => char.IsControl(c) || IsBidiControl(c)))
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
        // One read-only post-order walk that writes the result (depth is bounded by CommentHtmlGuard). Moving nodes inside the DOM
        // per element was the cubic cost of SEC2-02.
        var output = new StringBuilder(html.Length + 64);
        EmitChildren(body, output);
        return output.ToString();
    }

    /// <summary>Writes the children of <paramref name="parent"/> with block wrappers turned into paragraphs; true when a block element ends up directly inside.</summary>
    private static bool EmitChildren(AngleSharp.Dom.INode parent, StringBuilder output)
    {
        var hasBlock = false;
        foreach (var child in parent.ChildNodes)
        {
            if (child is not AngleSharp.Dom.IElement element)
            {
                output.Append(child.ToHtml());
                continue;
            }

            if (BlockWrappers.Contains(element.LocalName))
            {
                var inner = new StringBuilder();
                if (EmitChildren(element, inner))
                {
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
            var closing = "</" + element.LocalName + ">";
            if (outer.EndsWith(closing, StringComparison.Ordinal))
            {
                output.Append(outer, 0, outer.Length - closing.Length);
                EmitChildren(element, output);
                output.Append(closing);
            }
            else
            {
                output.Append(outer);
            }

            hasBlock |= BlockNames.Contains(element.LocalName);
        }

        return hasBlock;
    }

    private static readonly HashSet<string> BlockWrappers = new(["div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "section", "article", "address", "tr"], StringComparer.Ordinal);

    private static readonly HashSet<string> BlockNames = new(["p", "ul", "ol", "li", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "section", "article", "address", "table", "tr", "td", "th", "tbody", "thead"], StringComparer.Ordinal);

    [GeneratedRegex(@"<\s*(br\s*/?|/p|/li)\s*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex BreakPattern();

    [GeneratedRegex("<[^>]*>", RegexOptions.CultureInvariant)]
    private static partial Regex TagPattern();
}

/// <summary>The comment HTML has more tags or deeper nesting than <see cref="CommentHtmlGuard"/> allows.</summary>
public sealed class CommentTooComplexException() : InvalidOperationException("The comment markup is too complex.");
