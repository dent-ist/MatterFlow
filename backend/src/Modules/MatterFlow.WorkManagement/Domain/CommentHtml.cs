using Ganss.Xss;
using System.Net;
using System.Text.RegularExpressions;

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

    /// <summary>Returns the sanitized HTML ("" when nothing is left).</summary>
    public static string Sanitize(string? html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return string.Empty;

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

    private static bool IsBlank(string html) => ToPlainText(html).Length == 0;

    /// <summary>Absolute http, https or mailto URLs only; relative and protocol-relative links are not allowed.</summary>
    private static bool IsSafeLink(string href)
    {
        var value = href.Trim();
        if (value.Length == 0 || value.Length > 2000 || value.Any(char.IsControl))
            return false;

        return Uri.TryCreate(value, UriKind.Absolute, out var uri) && AllowedSchemes.Contains(uri.Scheme, StringComparer.OrdinalIgnoreCase);
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

        return body.InnerHtml;
    }

    [GeneratedRegex(@"<\s*(br\s*/?|/p|/li)\s*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex BreakPattern();

    [GeneratedRegex("<[^>]*>", RegexOptions.CultureInvariant)]
    private static partial Regex TagPattern();
}
