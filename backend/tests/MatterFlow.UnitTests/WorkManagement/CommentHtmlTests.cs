using System.Text.RegularExpressions;
using MatterFlow.WorkManagement.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.WorkManagement;

/// <summary>Comment sanitizing (decision D): the allow-list, links, and a battery of XSS payloads that must never survive.</summary>
public sealed partial class CommentHtmlTests
{
    private static readonly string[] AllowedTags = ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a"];

    [Theory]
    [InlineData("<p>Hello <strong>bold</strong>, <em>italic</em> and <u>under</u></p>")]
    [InlineData("<ul><li>one</li><li>two</li></ul>")]
    [InlineData("<ol><li>first</li></ol>")]
    [InlineData("<p>line<br>break</p>")]
    [InlineData("<p><b>b</b> <i>i</i></p>")]
    public void Basic_formatting_survives_unchanged(string html) => CommentHtml.Sanitize(html).ShouldBe(html);

    [Fact]
    public void Plain_text_is_kept_and_escaped()
    {
        CommentHtml.Sanitize("a < b & c > d").ShouldBe("a &lt; b &amp; c &gt; d");
    }

    [Theory]
    [InlineData("https://example.com/a?b=1&c=2")]
    [InlineData("http://example.com")]
    [InlineData("mailto:pat@example.com")]
    public void Safe_links_keep_href_and_get_rel(string href)
    {
        var result = CommentHtml.Sanitize($"<a href=\"{href}\" target=\"_blank\" onclick=\"x()\">link</a>");
        result.ShouldContain("rel=\"noopener noreferrer\"");
        result.ShouldContain("href=\"");
        result.ShouldNotContain("target");
        result.ShouldNotContain("onclick");
        result.ShouldContain(">link</a>");
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("JaVaScRiPt:alert(1)")]
    [InlineData(" javascript:alert(1)")]
    [InlineData("java\tscript:alert(1)")]
    [InlineData("java&#x0A;script:alert(1)")]
    [InlineData("&#106;avascript:alert(1)")]
    [InlineData("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")]
    [InlineData("vbscript:msgbox(1)")]
    [InlineData("//evil.example.com/x")]
    [InlineData("/relative/path")]
    [InlineData("ftp://example.com/file")]
    [InlineData("file:///etc/passwd")]
    public void Unsafe_or_relative_link_targets_lose_their_href(string href)
    {
        var result = CommentHtml.Sanitize($"<a href=\"{href}\">click</a>");
        result.ShouldNotContain("href", Case.Insensitive);
        result.ShouldNotContain("script", Case.Insensitive);
        result.ShouldContain("click");
    }

    public static TheoryData<string> Payloads() => new()
    {
        "<script>alert(1)</script>",
        "<SCRIPT SRC=//evil.example/x.js></SCRIPT>",
        "<scr<script>ipt>alert(1)</scr</script>ipt>",
        "<img src=x onerror=alert(1)>",
        "<img src=\"x\" onerror=\"alert(1)\">",
        "<IMG SRC=\"javascript:alert('XSS');\">",
        "<svg onload=alert(1)>",
        "<svg><script>alert(1)</script></svg>",
        "<svg><a xlink:href=\"javascript:alert(1)\"><text>x</text></a></svg>",
        "<math><mi xlink:href=\"data:x,<script>alert(1)</script>\">x</mi></math>",
        "<math><mtext><table><mglyph><style><!--</style><img title=\"--&gt;&lt;img src=1 onerror=alert(1)&gt;\">",
        "<iframe src=\"javascript:alert(1)\"></iframe>",
        "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
        "<object data=\"javascript:alert(1)\"></object>",
        "<embed src=\"javascript:alert(1)\">",
        "<body onload=alert(1)>",
        "<p onclick=\"alert(1)\">click</p>",
        "<p onmouseover=alert(1) style=\"position:fixed;top:0;left:0;width:100%;height:100%\">cover</p>",
        "<p style=\"background:url(javascript:alert(1))\">x</p>",
        "<p style=\"expression(alert(1))\">x</p>",
        "<div style=\"behavior:url(x.htc)\">x</div>",
        "<a href=\"javascript:alert(1)\">x</a>",
        "<a href=\"&#x6A;avascript:alert(1)\">x</a>",
        "<a href=\"jav&#x09;ascript:alert(1)\">x</a>",
        "<a href=\" javascript:alert(1)\">x</a>",
        "<a href=\"data:text/html,<script>alert(1)</script>\">x</a>",
        "<a href=\"https://example.com\" onfocus=alert(1) autofocus>x</a>",
        "<a href=\"https://example.com\"\" onmouseover=\"alert(1)\">x</a>",
        "<form action=\"javascript:alert(1)\"><button>go</button></form>",
        "<form><input type=\"image\" src=x onerror=alert(1)></form>",
        "<input autofocus onfocus=alert(1)>",
        "<button formaction=\"javascript:alert(1)\">x</button>",
        "<textarea><script>alert(1)</script></textarea>",
        "<select><option><script>alert(1)</script></option></select>",
        "<style>@import 'javascript:alert(1)';</style>",
        "<style>body{background:url(javascript:alert(1))}</style>",
        "<link rel=\"stylesheet\" href=\"javascript:alert(1)\">",
        "<meta http-equiv=\"refresh\" content=\"0;url=javascript:alert(1)\">",
        "<base href=\"javascript:alert(1)//\">",
        "<template><script>alert(1)</script></template>",
        "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\">",
        "<video><source onerror=alert(1)></video>",
        "<audio src=x onerror=alert(1)>",
        "<details open ontoggle=alert(1)>",
        "<marquee onstart=alert(1)>x</marquee>",
        "<isindex action=\"javascript:alert(1)\" type=image>",
        "<xmp><script>alert(1)</script></xmp>",
        "<img src=\"x\"/onerror=alert(1)>",
        "<img/src=x/onerror=alert(1)>",
        "<<script>alert(1);//<</script>",
        "<scri\0pt>alert(1)</scri\0pt>",
        "&lt;script&gt;alert(1)&lt;/script&gt;",
        "%3Cscript%3Ealert(1)%3C/script%3E",
        "<p data-x=\"1\" class=\"a\" id=\"b\" title=\"t\">x</p>",
        "<![CDATA[<script>alert(1)</script>]]>",
        "<!--<script>alert(1)</script>-->",
        "<!--[if gte IE 4]><script>alert(1)</script><![endif]-->",
        "<?xml version=\"1.0\"?><script>alert(1)</script>",
        "<a href=\"https://example.com\"><img src=x onerror=alert(1)></a>",
        "<ul><li onclick=alert(1)>x</li></ul>",
        "<b <script>alert(1)</script>>x</b>",
        "<p>‮<script>alert(1)</script></p>",
        "<table><tr><td><script>alert(1)</script></td></tr></table>",
        "<canvas id=c></canvas><script>c.getContext('2d')</script>",
        "<keygen autofocus onfocus=alert(1)>",
        "<picture><source srcset=x onerror=alert(1)><img src=x onerror=alert(1)></picture>",
    };

    [Theory]
    [MemberData(nameof(Payloads))]
    public void Hostile_payloads_leave_only_allow_listed_markup(string payload)
    {
        var result = CommentHtml.Sanitize(payload);

        foreach (var tag in TagPattern().Matches(result).Select(m => m.Groups["name"].Value.ToLowerInvariant()))
            AllowedTags.ShouldContain(tag, $"'{tag}' leaked from: {payload} => {result}");

        foreach (var forbidden in new[] { "<script", "<svg", "<math", "<img", "<iframe", "<object", "<embed", "<style", "<form", "<input", "<link", "<meta", "<base", "javascript:", "onerror", "onload", "onclick", "onfocus", "onmouseover", "ontoggle", "style=", "srcdoc", "xlink", "data:", "<!--", "<![cdata"})
            result.ShouldNotContain(forbidden, Case.Insensitive, $"{payload} => {result}");

        foreach (var attribute in AttributePattern().Matches(result).Select(m => m.Groups["name"].Value.ToLowerInvariant()))
            new[] { "href", "rel" }.ShouldContain(attribute, $"attribute '{attribute}' leaked from: {payload} => {result}");

        // Idempotent: re-sanitizing stored output never changes it (so edits cannot reintroduce anything).
        CommentHtml.Sanitize(result).ShouldBe(result, $"not idempotent: {payload}");
    }

    [Theory]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("<style>p{}</style>")]
    [InlineData("<svg><script>alert(1)</script></svg>")]
    [InlineData("<iframe src=x></iframe>")]
    [InlineData("<p></p>")]
    [InlineData("<p><br></p>")]
    [InlineData("   ")]
    [InlineData("")]
    public void Nothing_visible_sanitizes_to_empty(string html) => CommentHtml.Sanitize(html).ShouldBe(string.Empty);

    [Fact]
    public void Script_content_is_dropped_but_surrounding_text_is_kept()
    {
        CommentHtml.Sanitize("before<script>alert(1)</script>after").ShouldBe("beforeafter");
    }

    [Fact]
    public void Unknown_wrappers_are_unwrapped_so_pasted_text_survives()
    {
        CommentHtml.Sanitize("<div><span style=\"color:red\">hello</span></div>").ShouldBe("hello");
        CommentHtml.Sanitize("<h1>Title</h1>").ShouldBe("Title");
    }

    [Fact]
    public void Null_is_empty() => CommentHtml.Sanitize(null).ShouldBe(string.Empty);

    [Fact]
    public void Plain_text_extraction_strips_tags_and_decodes_entities()
    {
        CommentHtml.ToPlainText("<p>a &amp; b</p><ul><li>x</li></ul>").ShouldContain("a & b");
        CommentHtml.ToPlainText(null).ShouldBe(string.Empty);
    }

    [GeneratedRegex(@"</?(?<name>[a-zA-Z][a-zA-Z0-9]*)", RegexOptions.CultureInvariant)]
    private static partial Regex TagPattern();

    [GeneratedRegex(@"\s(?<name>[a-zA-Z][a-zA-Z0-9:_-]*)\s*=", RegexOptions.CultureInvariant)]
    private static partial Regex AttributePattern();
}
