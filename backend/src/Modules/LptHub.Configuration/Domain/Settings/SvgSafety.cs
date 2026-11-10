using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Configuration.Domain.Settings;

/// <summary>
/// SVG allow-list (design section 6.2). An SVG icon is parsed with <see cref="XmlReader"/> (DTD prohibited, no resolver, size limits) and
/// accepted only when every element and attribute is on the allow-list. Anything else is <b>rejected, never rewritten</b>, so the stored bytes
/// are exactly what the administrator previewed: script, foreignObject, image, a, style element, animation, on* attributes, any href that is
/// not a #fragment, javascript:/data: values, url() that is not #id, entities, processing instructions and external references.
/// The result is only ever used through an image element or the page icon link, where browsers do not run scripts; this is the second line of defence.
/// </summary>
public static partial class SvgSafety
{
    private const string SvgNamespace = "http://www.w3.org/2000/svg";
    private const string XlinkNamespace = "http://www.w3.org/1999/xlink";
    private const string XmlNamespace = "http://www.w3.org/XML/1998/namespace";
    private const string XmlnsNamespace = "http://www.w3.org/2000/xmlns/";

    private const int MaxElements = 2000;
    private const int MaxDepth = 32;
    private const int MaxUseElements = 20;

    private static readonly HashSet<string> Elements = new(StringComparer.Ordinal)
    {
        "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "linearGradient", "radialGradient", "stop",
        "clipPath", "mask", "title", "desc", "use",
    };

    private static readonly HashSet<string> Attributes = new(StringComparer.Ordinal)
    {
        "id", "class", "version", "viewBox", "preserveAspectRatio", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
        "fx", "fy", "d", "points", "transform", "gradientTransform", "gradientUnits", "spreadMethod", "offset", "clipPathUnits", "maskUnits",
        "maskContentUnits", "style", "enable-background", "shape-rendering",
        "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask", "opacity", "stop-color", "stop-opacity",
        "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity",
    };

    /// <summary>The CSS properties a <c>style</c> attribute may set (the presentation attributes above).</summary>
    private static readonly HashSet<string> StyleProperties = new(StringComparer.OrdinalIgnoreCase)
    {
        "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask", "opacity", "stop-color", "stop-opacity", "stroke", "stroke-width",
        "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "display", "visibility",
        "shape-rendering",
    };

    private static readonly HashSet<string> HrefElements = new(StringComparer.Ordinal) { "use", "linearGradient", "radialGradient" };

    /// <summary>True when the bytes start (after a UTF-8 byte-order mark and white space) with an XML or SVG markup start.</summary>
    public static bool LooksLikeXml(ReadOnlySpan<byte> bytes)
    {
        var i = bytes.StartsWith<byte>([0xEF, 0xBB, 0xBF]) ? 3 : 0;
        while (i < bytes.Length && bytes[i] is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n')
            i++;
        return i < bytes.Length && bytes[i] == (byte)'<';
    }

    public static Result<IconInfo> Inspect(ReadOnlySpan<byte> bytes)
    {
        string text;
        try
        {
            text = new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (ArgumentException)
        {
            return Corrupt();
        }

        if (text.Length > 0 && text[0] == '﻿')
            text = text[1..];

        if (text.Contains("<!DOCTYPE", StringComparison.OrdinalIgnoreCase) || text.Contains("<!ENTITY", StringComparison.OrdinalIgnoreCase))
            return Unsafe("The SVG contains a document type or entity declaration.");

        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = 400_000,
            MaxCharactersFromEntities = 0,
            IgnoreComments = true,
            CloseInput = true,
        };

        try
        {
            using var reader = XmlReader.Create(new StringReader(text), settings);
            return Walk(reader);
        }
        catch (XmlException)
        {
            return Corrupt();
        }
    }

    private static Result<IconInfo> Walk(XmlReader reader)
    {
        var stack = new Stack<string>();
        var elements = 0;
        var uses = 0;
        string? viewBox = null;
        string? width = null;
        string? height = null;

        while (reader.Read())
        {
            switch (reader.NodeType)
            {
                case XmlNodeType.XmlDeclaration:
                    break;

                case XmlNodeType.Element:
                    {
                        var name = reader.LocalName;
                        var isRoot = elements == 0;
                        if (isRoot && (name != "svg" || reader.NamespaceURI != SvgNamespace))
                            return IconInspector.Fail(ErrorCodes.BrandingIconTypeUnsupported, "Use a PNG, SVG or ICO file.");
                        if (++elements > MaxElements || reader.Depth > MaxDepth)
                            return Unsafe("The SVG is too complex.");
                        if (reader.NamespaceURI != SvgNamespace || !Elements.Contains(name))
                            return Unsafe($"The SVG uses the element '{name}', which is not allowed.");
                        if (name == "use" && ++uses > MaxUseElements)
                            return Unsafe("The SVG repeats shapes too often.");

                        var attributeError = CheckAttributes(reader, name, isRoot, out var vb, out var w, out var h);
                        if (attributeError is not null)
                            return attributeError;
                        if (isRoot)
                        {
                            viewBox = vb;
                            width = w;
                            height = h;
                        }

                        if (!reader.IsEmptyElement)
                            stack.Push(name);
                        break;
                    }

                case XmlNodeType.EndElement:
                    stack.Pop();
                    break;

                case XmlNodeType.Text:
                case XmlNodeType.CDATA:
                    if (reader.Value.AsSpan().Trim().Length > 0 && !(stack.Count > 0 && stack.Peek() is "title" or "desc"))
                        return Unsafe("The SVG contains text outside a title or description.");
                    break;

                case XmlNodeType.Whitespace:
                case XmlNodeType.SignificantWhitespace:
                    break;

                default: // processing instruction, entity reference, document type, ...
                    return Unsafe("The SVG contains markup that is not allowed.");
            }
        }

        if (elements == 0)
            return IconInspector.Fail(ErrorCodes.BrandingIconTypeUnsupported, "Use a PNG, SVG or ICO file.");

        return CheckSquare(viewBox, width, height);
    }

    private static Error? FailUnsafe(string message) => Unsafe(message).Error;

    private static Error? CheckAttributes(XmlReader reader, string element, bool isRoot, out string? viewBox, out string? width, out string? height)
    {
        viewBox = width = height = null;
        if (!reader.HasAttributes)
            return null;

        while (reader.MoveToNextAttribute())
        {
            var local = reader.LocalName;
            var value = reader.Value;
            var ns = reader.NamespaceURI;

            if (ns == XmlnsNamespace)
            {
                var expected = local == "xlink" ? XlinkNamespace : local == "xmlns" ? SvgNamespace : null;
                if (expected is null || value != expected)
                    return FailUnsafe("The SVG declares a namespace that is not allowed.");
                continue;
            }

            if (ns == XmlNamespace)
            {
                if (local != "space" || value is not ("default" or "preserve"))
                    return FailUnsafe($"The SVG uses the attribute 'xml:{local}', which is not allowed.");
                continue;
            }

            var isHref = local == "href" && (ns.Length == 0 || ns == XlinkNamespace);
            if (isHref)
            {
                if (!HrefElements.Contains(element) || !FragmentRegex().IsMatch(value))
                    return FailUnsafe("The SVG refers to something outside itself (only #references inside the file are allowed).");
                continue;
            }

            if (ns.Length != 0 || !Attributes.Contains(local))
                return FailUnsafe($"The SVG uses the attribute '{local}', which is not allowed.");

            var valueError = CheckValue(local, value);
            if (valueError is not null)
                return valueError;

            if (isRoot)
            {
                switch (local)
                {
                    case "viewBox":
                        viewBox = value;
                        break;
                    case "width":
                        width = value;
                        break;
                    case "height":
                        height = value;
                        break;
                }
            }
        }

        reader.MoveToElement();
        return null;
    }

    private static Error? CheckValue(string attribute, string value)
    {
        if (value.Contains('\\'))
            return FailUnsafe("The SVG contains an escape sequence that is not allowed.");

        var squashed = SquashRegex().Replace(value, string.Empty).ToLowerInvariant();
        if (squashed.Contains("javascript:") || squashed.Contains("vbscript:") || squashed.Contains("data:") || squashed.Contains("@import")
            || squashed.Contains("expression("))
        {
            return FailUnsafe("The SVG contains a script or data reference.");
        }

        foreach (Match match in UrlRegex().Matches(value))
        {
            if (!UrlFragmentRegex().IsMatch(value.AsSpan(match.Index).ToString()))
                return FailUnsafe("The SVG refers to something outside itself (only url(#id) is allowed).");
        }

        if (attribute == "style")
        {
            foreach (var declaration in value.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var colon = declaration.IndexOf(':');
                if (colon <= 0 || !StyleProperties.Contains(declaration[..colon].Trim()))
                    return FailUnsafe("The SVG style contains a property that is not allowed.");
            }
        }

        return null;
    }

    private static Result<IconInfo> CheckSquare(string? viewBox, string? width, string? height)
    {
        if (viewBox is not null)
        {
            var parts = viewBox.Split([' ', ',', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != 4
                || !double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var w)
                || !double.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out var h)
                || !double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out _)
                || !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out _)
                || !double.IsFinite(w) || !double.IsFinite(h) || w <= 0 || h <= 0)
            {
                return Corrupt();
            }

            if (!AlmostEqual(w, h))
                return NotSquare();
        }
        else if (width is null || height is null)
        {
            return IconInspector.Fail(ErrorCodes.BrandingIconNotSquare, "The SVG must declare a square viewBox (for example viewBox=\"0 0 64 64\").");
        }

        if (width is not null && height is not null)
        {
            var wm = LengthRegex().Match(width.Trim());
            var hm = LengthRegex().Match(height.Trim());
            if (!wm.Success || !hm.Success)
                return Corrupt();
            if (wm.Groups[2].Value != hm.Groups[2].Value
                || !double.TryParse(wm.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var wv)
                || !double.TryParse(hm.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var hv)
                || !AlmostEqual(wv, hv))
            {
                return NotSquare();
            }
        }

        return new IconInfo(IconKind.Svg, IconInspector.SvgContentType, 0, 0);
    }

    private static bool AlmostEqual(double a, double b) => Math.Abs(a - b) <= 1e-6 * Math.Max(a, b);

    private static Result<IconInfo> Unsafe(string detail) =>
        IconInspector.Fail(ErrorCodes.BrandingIconUnsafe, $"This SVG cannot be used: {detail} Export a plain SVG without scripts, links or embedded content.");

    private static Result<IconInfo> NotSquare() => IconInspector.Fail(ErrorCodes.BrandingIconNotSquare, "The icon must be square.");

    private static Result<IconInfo> Corrupt() => IconInspector.Fail(ErrorCodes.BrandingIconCorrupt, "The SVG file is damaged or is not valid SVG.");

    [GeneratedRegex(@"^#[A-Za-z_][A-Za-z0-9_.\-:]*$")]
    private static partial Regex FragmentRegex();

    [GeneratedRegex(@"[\s\x00-\x1f]+")]
    private static partial Regex SquashRegex();

    [GeneratedRegex(@"url\s*\(", RegexOptions.IgnoreCase)]
    private static partial Regex UrlRegex();

    [GeneratedRegex(@"^url\s*\(\s*(['""]?)#[A-Za-z_][A-Za-z0-9_.\-:]*\1\s*\)", RegexOptions.IgnoreCase)]
    private static partial Regex UrlFragmentRegex();

    [GeneratedRegex(@"^([0-9]*\.?[0-9]+)([a-z%]*)$", RegexOptions.IgnoreCase)]
    private static partial Regex LengthRegex();
}
