using System.Diagnostics;
using MatterFlow.WorkManagement.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.WorkManagement;

/// <summary>SEC2-01/02: hostile nesting must be rejected before AngleSharp runs (a stack overflow kills the process) and must be fast.</summary>
public sealed class CommentHtmlHostileInputTests
{
    private const int Limit = CommentHtml.MaxLength;

    private static string Repeat(string s, int n) => string.Concat(Enumerable.Repeat(s, n));

    public static TheoryData<string, string> Payloads() => new()
    {
        { "pre x2500", Repeat("<pre>", 2500) },
        { "pre x4000", Repeat("<pre>", 4000) },
        { "listing x300", Repeat("<listing>", 300) },
        { "listing x2000", Repeat("<listing>", 2000) },
        { "div unclosed", Repeat("<div>", 4000) },
        { "div closed 1650", Repeat("<div>a", 1650) + Repeat("</div>", 1650) },
        { "div b", Repeat("<div><b>", 2400) },
        { "span", Repeat("<span>", 3000) },
        { "font", Repeat("<font>", 3000) },
        { "b", Repeat("<b>", 6000) },
        { "i adoption", Repeat("<b><i><p>", 1000) },
        { "table", Repeat("<table><tr><td>", 1000) },
        { "template", Repeat("<template>", 1500) },
        { "svg", Repeat("<svg><g>", 1500) },
        { "math", Repeat("<math><mi>", 1500) },
        { "self-closing div", Repeat("<div/>", 3000) },
        { "uppercase pre", Repeat("<PRE>", 3000) },
        { "attr quote tricks", "<a x=\"<i>\">" + Repeat("<pre>", 2500) + "</i>" },
        { "stray closers", Repeat("<pre>", 2500) + Repeat("</b>", 100) },
        { "many flat tags", Repeat("<b></b>", 3000) },
    };

    [Theory]
    [MemberData(nameof(Payloads))]
    public void Hostile_payloads_are_rejected_quickly_and_do_not_crash_the_process(string name, string payload)
    {
        payload = payload[..Math.Min(payload.Length, Limit)];
        var watch = Stopwatch.StartNew();
        CommentHtmlGuard.IsTooComplex(payload).ShouldBeTrue(name);
        Should.Throw<CommentTooComplexException>(() => CommentHtml.Sanitize(payload), name);
        watch.ElapsedMilliseconds.ShouldBeLessThan(500, name);
    }

    [Fact]
    public void Nested_divs_of_19_8_KB_fail_fast_instead_of_taking_a_minute()
    {
        var payload = Repeat("<div>a", 1650) + Repeat("</div>", 1650);
        var watch = Stopwatch.StartNew();
        Should.Throw<CommentTooComplexException>(() => CommentHtml.Sanitize(payload));
        watch.ElapsedMilliseconds.ShouldBeLessThan(100);
    }

    [Fact]
    public void Worst_case_inside_the_caps_is_fast()
    {
        // 20 nested divs repeated until near the tag cap: the most expensive shape that is still accepted.
        var block = Repeat("<div>a", 20) + Repeat("</div>", 20);
        var payload = Repeat(block, 24);
        CommentHtmlGuard.IsTooComplex(payload).ShouldBeFalse();
        CommentHtml.Sanitize(payload);
        var watch = Stopwatch.StartNew();
        var result = CommentHtml.Sanitize(payload);
        watch.ElapsedMilliseconds.ShouldBeLessThan(100);
        result.ShouldContain("<p>a");
    }

    [Fact]
    public void Realistic_formatted_comment_is_accepted()
    {
        var paragraphs = Repeat("<p>Some <strong>bold</strong> and <em>italic</em> text with a <a href=\"https://example.com\">link</a>.</p>", 50);
        var html = paragraphs + "<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>";
        CommentHtmlGuard.IsTooComplex(html).ShouldBeFalse();
        CommentHtml.Sanitize(html).ShouldContain("<ul>");
    }

    [Fact]
    public void Unclosed_paragraphs_and_list_items_do_not_count_as_nesting()
    {
        CommentHtmlGuard.IsTooComplex(Repeat("<p>x", 200)).ShouldBeFalse();
        CommentHtmlGuard.IsTooComplex("<ul>" + Repeat("<li>x", 200) + "</ul>").ShouldBeFalse();
    }

    [Fact]
    public void Links_with_credentials_or_bidi_controls_are_not_kept_as_links()
    {
        CommentHtml.Sanitize("<a href=\"https://google.com@evil.com/\">x</a>").ShouldNotContain("href");
        CommentHtml.Sanitize("<a href=\"https://exa‮mple.com/\">x</a>").ShouldNotContain("href");
        CommentHtml.Sanitize("<a href=\"mailto:pat@example.com\">x</a>").ShouldContain("href=\"mailto:pat@example.com\"");
    }
}
