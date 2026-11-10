using AngleSharp;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;
using MatterFlow.SharedKernel.Text;
using Shouldly;

namespace MatterFlow.UnitTests.SharedKernel;

/// <summary>
/// Security tests of the shared rich-text sanitizer (decision R, security review addendum 3). Three independent lines:
/// a corpus of hostile HTML, a fuzzer that mutates and recombines it, and a round trip. All three check the same invariant,
/// <see cref="AssertSafe"/>, which re-parses the OUTPUT with a separate AngleSharp parser and verifies it by an allow-list of its own
/// (elements, per-element attributes, HTML namespace only, no comments, safe links, and a fixpoint), so a bug in the sanitizer cannot
/// hide behind the sanitizer's own rules.
/// </summary>
public sealed class RichHtmlSecurityTests
{
    /// <summary>The elements the output may contain. Kept here, apart from the production list, on purpose.</summary>
    internal static readonly HashSet<string> OutputElements = new(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col"], StringComparer.Ordinal);

    private static readonly RichHtmlLimits[] Profiles = [RichHtmlLimits.Comment, RichHtmlLimits.Description, RichHtmlLimits.Email];

    private static string Repeat(string s, int n) => string.Concat(Enumerable.Repeat(s, n));

    public static TheoryData<string> Corpus() => new(CorpusItems());

    internal static IEnumerable<string> CorpusItems() =>
    [
        // script, style and friends, including nesting tricks
        "<script>alert(1)</script>", "<SCRIPT SRC=//evil.example/x.js></SCRIPT>", "<scr<script>ipt>alert(1)</scr</script>ipt>",
        "<style>@import 'javascript:alert(1)';</style>", "<style>body{background:url(javascript:alert(1))}</style>",
        "<p style=\"background:url(javascript:alert(1))\">x</p>", "<p style=\"expression(alert(1))\">x</p>", "<td style=\"behavior:url(x.htc)\">x</td>",
        "<p style=\"font-family:'a\\27 );x:expression(alert(1))\">x</p>", "<div style=\"width:expression(alert(1))\">x</div>",
        "<img src=x onerror=alert(1)>", "<img/src=x/onerror=alert(1)>", "<img src=\"x\"/onerror=alert(1)>", "<svg onload=alert(1)>",
        "<iframe src=\"javascript:alert(1)\"></iframe>", "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>", "<object data=\"javascript:alert(1)\"></object>",
        "<embed src=\"javascript:alert(1)\">", "<body onload=alert(1)>", "<html><head><script>alert(1)</script></head><body onload=alert(2)>x</body></html>",
        "<link rel=\"stylesheet\" href=\"javascript:alert(1)\">", "<meta http-equiv=\"refresh\" content=\"0;url=javascript:alert(1)\">",
        "<base href=\"javascript:alert(1)//\"><a href=\"x\">y</a>", "<base href=\"https://evil.example/\"><a href=\"/path\">y</a>",
        "<form action=\"javascript:alert(1)\"><button>go</button></form>", "<form><input type=\"image\" src=x onerror=alert(1)></form>",
        "<input autofocus onfocus=alert(1)>", "<button formaction=\"javascript:alert(1)\">x</button>", "<textarea><script>alert(1)</script></textarea>",
        "<select><option><script>alert(1)</script></option></select>", "<template><script>alert(1)</script></template>", "<xmp><script>alert(1)</script></xmp>",
        "<video><source onerror=alert(1)></video>", "<audio src=x onerror=alert(1)>", "<details open ontoggle=alert(1)>", "<marquee onstart=alert(1)>x</marquee>",
        "<isindex action=\"javascript:alert(1)\" type=image>", "<keygen autofocus onfocus=alert(1)>", "<picture><source srcset=x onerror=alert(1)><img src=x onerror=alert(1)></picture>",

        // links: schemes, entities, whitespace, credentials, bidi
        "<a href=\"javascript:alert(1)\">x</a>", "<a href=\"&#x6A;avascript:alert(1)\">x</a>", "<a href=\"jav&#x09;ascript:alert(1)\">x</a>", "<a href=\"jav&#x0A;ascript:alert(1)\">x</a>",
        "<a href=\" javascript:alert(1)\">x</a>", "<a href=\"\u0001javascript:alert(1)\">x</a>", "<a href=\"data:text/html,<script>alert(1)</script>\">x</a>",
        "<a href=\"vbscript:msgbox(1)\">x</a>", "<a href=\"file:///etc/passwd\">x</a>", "<a href=\"//evil.example/x\">x</a>", "<a href=\"/relative\">x</a>",
        "<a href=\"https://google.com@evil.example/\">x</a>", "<a href=\"https://exa‮mple.com/\">x</a>", "<a href=https://example.com onfocus=alert(1) autofocus>x</a>",
        "<a href=\"https://example.com\"\" onmouseover=\"alert(1)\">x</a>", "<a href=\"https://example.com\" target=\"_blank\" rel=\"opener\">x</a>",
        "<a href=\"https://example.com\"><img src=x onerror=alert(1)></a>", "<a href=\"mailto:a@b.example?subject=<script>\">x</a>",
        "<a href=\"\" onclick=\"alert(1)\">x</a>", "<a href=\"javascript&colon;alert(1)\">x</a>", "<a href=\"&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)\">x</a>",

        // markup in text and encodings
        "&lt;script&gt;alert(1)&lt;/script&gt;", "%3Cscript%3Ealert(1)%3C/script%3E", "<scri\0pt>alert(1)</scri\0pt>", "<<script>alert(1);//<</script>", "<b <script>alert(1)</script>>x</b>",
        "<![CDATA[<script>alert(1)</script>]]>", "<!--<script>alert(1)</script>-->", "<!--[if gte IE 4]><script>alert(1)</script><![endif]-->",
        "<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->", "<?xml version=\"1.0\"?><script>alert(1)</script>",
        "<!DOCTYPE html><p>x</p>", "<!ENTITY x SYSTEM \"file:///etc/passwd\">", "<p>‮<script>alert(1)</script></p>", "<o:p></o:p><p>x<o:p></o:p></p>",
        "<p data-x=\"1\" class=\"MsoNormal\" id=\"b\" title=\"t\" lang=\"en\" dir=\"rtl\" hidden contenteditable accesskey=\"x\" tabindex=\"1\">x</p>",

        // mXSS and namespace confusion (svg/math inside and around tables, forms, noscript, style)
        "<math><mtext><table><mglyph><style><!--</style><img title=\"--&gt;&lt;img src=1 onerror=alert(1)&gt;\">",
        "<math><mtext><table><mglyph><style><!--</style><img title=\"--&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;\">",
        "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>", "<noscript><style></noscript><img src=x onerror=alert(1)>",
        "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\">", "<svg></p><style><a id=\"</style><img src=1 onerror=alert(1)>\">",
        "<svg><a xlink:href=\"javascript:alert(1)\"><text>x</text></a></svg>", "<math><mi xlink:href=\"data:x,<script>alert(1)</script>\">x</mi></math>",
        "<svg><desc><![CDATA[</desc><script>alert(1)</script>]]></desc></svg>", "<svg><foreignObject><iframe srcdoc=\"<script>alert(1)</script>\"></foreignObject></svg>",
        "<math><annotation-xml encoding=\"text/html\"><img src=x onerror=alert(1)></annotation-xml></math>", "<svg><title><style><img src=x onerror=alert(1)></style></title></svg>",
        "<table><svg><desc><template><style><a title=\"</style><img src onerror=alert(1)>\">", "<table><tr><td><svg><style><img src=x onerror=alert(1)></style></svg></td></tr></table>",
        "<table><tr><td><math><mi><mglyph><style><!--</style><img title=\"--&gt;&lt;img src=1 onerror=alert(1)&gt;\"></mglyph></mi></math></td></tr></table>",
        "<table><caption><style><a title=\"</style><img src=x onerror=alert(1)>\"></style></caption></table>", "<select><template><style><a title=\"</style><img src onerror=alert(1)>\">",
        "<table><colgroup><template><style></style><img src=x onerror=alert(1)></template></colgroup></table>", "<table><tr><td><select><option><style></select><img src=x onerror=alert(1)>",
        "<table><thead><tr><th><textarea></textarea><img src=x onerror=alert(1)></th></tr></thead></table>", "<table><td><a href=\"javascript:alert(1)\">x</a></td></table>",
        "<p><svg><p><style><img src=x onerror=alert(1)></style></p></svg>", "<b><svg></b><style><a id=\"</style><img src=x onerror=alert(1)>\">",
        "<a><table><a><img src=x onerror=alert(1)></a></table></a>", "<table><a>1<a>2</table><img src=x onerror=alert(1)>", "<b><table><tr><td></b></td></tr></table><img src=x onerror=alert(1)>",
        "<listing>&lt;img src=x onerror=alert(1)&gt;</listing>", "<plaintext><img src=x onerror=alert(1)>", "<xmp><img src=x onerror=alert(1)></xmp>",
        "<iframe><img src=x onerror=alert(1)></iframe>", "<noembed><img src=x onerror=alert(1)></noembed>", "<title><img src=x onerror=alert(1)></title>",

        // tables: structure abuse, foster parenting, attributes
        "<table><script>alert(1)</script><tr><td>x</td></tr></table>", "<table>text<img src=x onerror=alert(1)><tr><td>x</td></tr></table>", "<table><tr><td>a</td></tr></table></table></table>",
        "<table><tr><td><table><tr><td><table><tr><td><table><tr><td><table><tr><td>deep</td></tr></table></td></tr></table></td></tr></table></td></tr></table></td></tr></table>",
        "<table style=\"position:fixed;top:0;left:0;width:100%;height:100%\"><tr><td>cover</td></tr></table>", "<table background=\"javascript:alert(1)\"><tr><td>x</td></tr></table>",
        "<table width=\"99999\" height=\"99999\" cellpadding=\"9999\" border=\"99\" bgcolor=\"red\" align=\"right\"><tr><td>x</td></tr></table>", "<table class=\"MsoTableGrid\" id=\"t\" data-x=\"1\"><tr><td>x</td></tr></table>",
        "<table onclick=\"alert(1)\" onmouseover=\"alert(1)\"><tr onclick=\"alert(1)\"><td onclick=\"alert(1)\">x</td></tr></table>",
        "<table><tr><td colspan=\"2 onmouseover=alert(1)\">x</td></tr></table>", "<table><tr><td colspan='2'\nonclick=alert(1)>x</td></tr></table>", "<table><tr><td colspan=\"2\" colspan=\"3\">x</td></tr></table>",
        "<table><tr><td colspan=\"1000\">x</td></tr></table>", "<table><tr><td colspan=\"0\">x</td></tr></table>", "<table><tr><td colspan=\"-1\">x</td></tr></table>", "<table><tr><td colspan=\"+2\">x</td></tr></table>",
        "<table><tr><td colspan=\"2.5\">x</td></tr></table>", "<table><tr><td colspan=\"0x10\">x</td></tr></table>", "<table><tr><td rowspan=\"1e2\">x</td></tr></table>", "<table><tr><td rowspan=\"٣\">x</td></tr></table>",
        "<table><tr><td colspan=\"99999999999999999999\">x</td></tr></table>", "<table><tr><td colspan=\"&#50;\">x</td></tr></table>", "<table><tr><td colspan=\"2&#x20;\">x</td></tr></table>",
        "<table><tr><td colspan=\"\">x</td></tr></table>", "<table><tr><TD COLSPAN=\"2\" ROWSPAN=\"2\">x</TD></tr></table>", "<table><tr><td colspan=\"2\" rowspan=\"2\" scope=\"col\">x</td></tr></table>",
        "<table><tr><th scope=\"javascript:alert(1)\">x</th></tr></table>", "<table><tr><th scope=\"row\">r</th><th scope=\"COL\">c</th><th scope=\"rowgroup\">g</th><th scope=\"colgroup\">h</th><th scope=\"banana\">b</th></tr></table>",
        "<table><tr><td scope=\"col\" colspan=\"2\">x</td></tr></table>", "<p colspan=\"2\" rowspan=\"3\" scope=\"row\">x</p>", "<a colspan=\"2\" href=\"https://example.com\" scope=\"col\">x</a>",
        "<table><colgroup span=\"9999\"><col span=\"99999\" width=\"1\" style=\"x\"></colgroup><tr><td>x</td></tr></table>", "<table><tr><td headers=\"a b\" abbr=\"x\" axis=\"y\" nowrap valign=\"top\" align=\"center\">x</td></tr></table>",
        "<table><tbody><tr><td>x</td></tr></tbody><tfoot><tr><td>y</td></tr></tfoot><thead><tr><th>z</th></tr></thead></table>", "<tr><td>orphan row</td></tr>", "<td>orphan cell</td>", "<th>orphan header</th>", "<tbody><tr><td>x</td>", "<caption>orphan</caption>", "<col><colgroup><col>",
        "<table><tr><td>a<table><tr><td>b</table>c</table>", "<table><table><table><tr><td>x</td></tr>", "<table><tr><td><p>a</p><ul><li>b</li></ul></td></tr></table>", "<table><tr><td><div><div>x</div></div></td></tr></table>",
        "<table><tr><td><form><table><tr><td><form>x</form></td></tr></table></form></td></tr></table>", "<table><tr><td><button><table></button></td></tr></table>", "<table><tr><td><a href=\"https://example.com\"><table><tr><td>x</td></tr></table></a></td></tr></table>",
        "<table><tr><td><h1>head</h1><pre>pre</pre><blockquote>q</blockquote></td></tr></table>", "<table><!--c--><tr><!--c--><td><!--c-->x</td></tr></table>", "<table><tr><td>x</td></tr><?php echo 1 ?></table>",
        "<table><tr><td>‮evil</td></tr></table>", "<table><tr><td>&lt;script&gt;alert(1)&lt;/script&gt;</td></tr></table>", "<table><tr><td>x</td></tr></table >", "<table\n\n><tr\t><td\f>x</td\n></tr></table>",
        "<TABLE><TR><TD>UPPER</TD></TR></TABLE>", "<tabLE><Tr><tD>Mixed</Td></tR></tAble>", "<table><tr><td>x</td>\u0000<td>y</td></tr></table>", "<t\u0000able><tr><td>x</td></tr></t\u0000able>",
        "<table><tr><td id=\"x\" name=\"y\" form=\"z\" style=\"x\" class=\"y\">x</td></tr></table>", "<td/colspan=2>x", "<td colspan=2/onclick=alert(1)>x", "<th/scope=row/onclick=alert(1)>x",
    ];

    [Theory]
    [MemberData(nameof(Corpus))]
    public void Hostile_corpus_is_neutralised_with_every_profile(string payload)
    {
        foreach (var limits in Profiles)
        {
            var problem = RichHtml.TrySanitize(payload, limits, out var clean);
            if (problem is RichHtmlProblem.TooComplex or RichHtmlProblem.TooManyCells or RichHtmlProblem.TooLarge)
                continue; // refused: nothing is stored

            problem.ShouldBe(RichHtmlProblem.None, payload);
            AssertSafe(clean, payload);
        }
    }

    [Theory]
    [MemberData(nameof(Corpus))]
    public void Sanitizing_twice_changes_nothing(string payload)
    {
        if (RichHtml.TrySanitize(payload, RichHtmlLimits.Description, out var once) != RichHtmlProblem.None)
            return;

        RichHtml.TrySanitize(once, RichHtmlLimits.Description, out var twice).ShouldBe(RichHtmlProblem.None);
        twice.ShouldBe(once, payload);
    }

    [Fact]
    public void Fuzzed_input_never_produces_unsafe_output()
    {
        // Deterministic: the seed is fixed so a failure reproduces; the iteration count is what a CI run can afford.
        var random = new Random(80_2026);
        var corpus = CorpusItems().ToArray();
        var pieces = FuzzPieces();
        var refused = 0;
        for (var i = 0; i < 4000; i++)
        {
            var payload = i % 3 == 0 ? Mutate(corpus[random.Next(corpus.Length)], random) : Compose(pieces, random);
            var problem = RichHtml.TrySanitize(payload, RichHtmlLimits.Description, out var clean);
            if (problem != RichHtmlProblem.None)
            {
                refused++;
                problem.ShouldNotBe(RichHtmlProblem.Unstable, payload);
                continue;
            }

            AssertSafe(clean, payload);
        }

        refused.ShouldBeLessThan(2000, "most fuzzed inputs are small enough to be accepted, so the checks above really ran");
    }

    [Fact]
    public void Grammar_fuzz_of_tables_never_produces_unsafe_output()
    {
        var random = new Random(80_1015);
        for (var i = 0; i < 1500; i++)
        {
            var payload = RandomTable(random, depth: 0);
            var problem = RichHtml.TrySanitize(payload, RichHtmlLimits.Description, out var clean);
            if (problem != RichHtmlProblem.None)
            {
                problem.ShouldNotBe(RichHtmlProblem.Unstable, payload);
                continue;
            }

            AssertSafe(clean, payload);
        }
    }

    [Fact]
    public void Round_trip_of_realistic_content_is_stable()
    {
        string[] samples =
        [
            "<p>Hello <strong>bold</strong> <em>it</em> <u>u</u> <a href=\"https://example.com/a?b=1&amp;c=2\" rel=\"noopener noreferrer\">link</a></p>",
            "<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><ol><li>x</li></ol>",
            "<p>line<br>break</p><p>a &lt; b &amp; c &gt; d</p>",
        ];
        foreach (var sample in samples)
        {
            var once = RichHtml.Sanitize(sample, RichHtmlLimits.Description);
            once.ShouldBe(sample);
            RichHtml.Sanitize(once, RichHtmlLimits.Description).ShouldBe(once);
        }
    }

    /// <summary>The independent check of one sanitized output.</summary>
    internal static void AssertSafe(string clean, string payload, IReadOnlySet<string>? elements = null)
    {
        var context = $"payload: {payload.Replace("\0", "\\0", StringComparison.Ordinal)}\noutput: {clean}";
        var allowed = elements ?? OutputElements;
        var parser = new HtmlParser();
        var document = parser.ParseDocument(string.Empty);
        var body = document.Body!;
        body.InnerHtml = clean;

        foreach (var node in Descendants(body))
        {
            switch (node)
            {
                case IElement element:
                    element.NamespaceUri.ShouldBe("http://www.w3.org/1999/xhtml", $"foreign element {element.LocalName}\n{context}");
                    allowed.ShouldContain(element.LocalName, $"element <{element.LocalName}> leaked\n{context}");
                    CheckAttributes(element, context);
                    break;
                case IText:
                    break;
                default:
                    Assert.Fail($"unexpected node {node.NodeType} ({node.NodeName})\n{context}");
                    break;
            }
        }

        // Re-sanitizing the output changes nothing (no mXSS round trip).
        RichHtml.Sanitize(clean, RichHtmlLimits.Email).ShouldBe(clean, $"output is not a sanitizer fixpoint\n{context}");

        foreach (var forbidden in new[] { "javascript:", "vbscript:", "<script", "<style", "<svg", "<math", "<img", "<iframe", "<form", "<base", "<meta", "<link", "<!--", "onerror", "onload=", "onclick=", "style=", "srcdoc" })
        {
            // Text may legitimately talk about these (escaped); markup may not. Escaped text has no literal '<'.
            if (forbidden.StartsWith('<'))
                clean.ShouldNotContain(forbidden, Case.Insensitive, context);
        }
    }

    private static void CheckAttributes(IElement element, string context)
    {
        foreach (var attribute in element.Attributes)
        {
            var name = attribute.Name;
            var value = attribute.Value;
            switch (element.LocalName, name)
            {
                case ("a", "href"):
                    Uri.TryCreate(value, UriKind.Absolute, out var uri).ShouldBeTrue($"href '{value}' is not absolute\n{context}");
                    new[] { "http", "https", "mailto" }.ShouldContain(uri!.Scheme, $"scheme leaked\n{context}");
                    value.Any(char.IsControl).ShouldBeFalse($"control character in href\n{context}");
                    value.IndexOfAny(['<', '>', '"']).ShouldBe(-1, $"markup characters in href (attribute value smuggling)\n{context}");
                    break;
                case ("a", "rel"):
                    value.ShouldBe("noopener noreferrer", context);
                    break;
                case ("td" or "th", "colspan" or "rowspan"):
                    System.Text.RegularExpressions.Regex.IsMatch(value, "^[1-9][0-9]?$|^100$").ShouldBeTrue($"{name}='{value}'\n{context}");
                    break;
                case ("th", "scope"):
                    new[] { "row", "col", "rowgroup", "colgroup" }.ShouldContain(value, context);
                    break;
                default:
                    Assert.Fail($"attribute {name}='{value}' leaked on <{element.LocalName}>\n{context}");
                    break;
            }
        }
    }

    private static IEnumerable<INode> Descendants(INode root)
    {
        var stack = new Stack<INode>(root.ChildNodes.Reverse());
        while (stack.Count > 0)
        {
            var node = stack.Pop();
            yield return node;
            foreach (var child in node.ChildNodes.Reverse())
                stack.Push(child);
        }
    }

    // ---- fuzzing

    private static string[] FuzzPieces() =>
    [
        "<table>", "</table>", "<tr>", "</tr>", "<td>", "</td>", "<th>", "</th>", "<thead>", "<tbody>", "<tfoot>", "</tbody>", "<caption>", "<colgroup>", "<col>", "<p>", "</p>", "<div>", "</div>", "<span>", "</span>", "<b>", "</b>", "<i>", "<a href=\"https://example.com\">", "<a href=\"javascript:alert(1)\">", "</a>",
        "<ul>", "<li>", "</ul>", "<svg>", "</svg>", "<math>", "</math>", "<mtext>", "<mglyph>", "<annotation-xml encoding=\"text/html\">", "<style>", "</style>", "<script>", "</script>", "<template>", "</template>", "<noscript>", "</noscript>", "<form>", "</form>", "<select>", "<option>", "<textarea>", "</textarea>",
        "<iframe>", "<img src=x onerror=alert(1)>", "<img/src=x onerror=alert(1)>", "<base href=//evil/>", "<meta http-equiv=refresh content=0>", "<!--", "-->", "<![CDATA[", "]]>", "<?", "?>", "<!", "<", ">", "\"", "'", "=", "&", "&lt;", "&gt;", "&amp;", "&#x3c;", "&#60;", "&#0;", "&nbsp;", "&Tab;", "&NewLine;",
        " colspan=\"2\"", " colspan=\"x\"", " rowspan=\"3\"", " scope=\"row\"", " onclick=alert(1)", " style=\"x:y\"", " class=a", " id=a", " title=\"</style><img src=x onerror=alert(1)>\"", " title='", "text", "x", " ", "\n", "\t", "\0", "‮", "​", "﻿", "\ud800", "é", "日本",
    ];

    private static string Compose(string[] pieces, Random random)
    {
        var count = random.Next(3, 60);
        var parts = new string[count];
        for (var i = 0; i < count; i++)
            parts[i] = pieces[random.Next(pieces.Length)];
        return string.Concat(parts);
    }

    private const string Specials = "<>\"'=/&; \0\t";

    private static string Mutate(string source, Random random)
    {
        var chars = source.ToList();
        var edits = random.Next(1, 8);
        for (var i = 0; i < edits && chars.Count > 0; i++)
        {
            var at = random.Next(chars.Count);
            switch (random.Next(4))
            {
                case 0:
                    chars.RemoveAt(at);
                    break;
                case 1:
                    chars.Insert(at, Specials[random.Next(Specials.Length)]);
                    break;
                case 2:
                    chars.Insert(at, chars[at]);
                    break;
                default:
                    var other = random.Next(chars.Count);
                    (chars[at], chars[other]) = (chars[other], chars[at]);
                    break;
            }
        }

        return new string([.. chars]);
    }

    private static string RandomTable(Random random, int depth)
    {
        var sb = new System.Text.StringBuilder();
        string[] tableAttributes = ["", " style=\"x\"", " class=\"a\"", " border=\"1\"", " onclick=\"alert(1)\""];
        string[] cellAttributes = ["", " colspan=\"2\"", " rowspan=\"2\"", " colspan=\"0\"", " colspan=\"101\"", " colspan=\"2\" onclick=alert(1)", " scope=\"row\"", " style=\"background:url(javascript:alert(1))\"", " colspan=\"x\"", " colspan=2 rowspan=3"];
        string[] fillers = ["x", "<b>b</b>", "<p>p</p>", "<div>d</div>", "<ul><li>l</li></ul>", "<a href=\"https://example.com\">a</a>", "<a href=\"javascript:1\">j</a>", "<br>", "<script>1</script>", "<svg><style></svg>", "<img src=x onerror=1>", "&lt;i&gt;", "<form>", "</td>", "<tr>", "</table>", "<!--c-->", "<span style=\"color:red\">s</span>", "<font face=a>f</font>", "<o:p></o:p>"];
        sb.Append("<table").Append(tableAttributes[random.Next(tableAttributes.Length)]).Append('>');
        if (random.Next(4) == 0)
            sb.Append("<caption>").Append(fillers[random.Next(fillers.Length)]).Append("</caption>");
        if (random.Next(4) == 0)
            sb.Append("<colgroup><col span=\"2\"><col></colgroup>");
        var rows = random.Next(1, 5);
        for (var r = 0; r < rows; r++)
        {
            sb.Append(random.Next(8) == 0 ? "" : "<tr>");
            var cells = random.Next(1, 5);
            for (var c = 0; c < cells; c++)
            {
                var tag = random.Next(5) == 0 ? "th" : "td";
                sb.Append('<').Append(tag).Append(cellAttributes[random.Next(cellAttributes.Length)]).Append('>');
                if (depth < 5 && random.Next(6) == 0)
                    sb.Append(RandomTable(random, depth + 1));
                else
                    sb.Append(fillers[random.Next(fillers.Length)]);
                sb.Append(random.Next(6) == 0 ? "" : $"</{tag}>");
            }

            sb.Append(random.Next(6) == 0 ? "" : "</tr>");
        }

        sb.Append(random.Next(8) == 0 ? "" : "</table>");
        return sb.ToString();
    }
}
