using LptHub.SharedKernel.Text;
using Shouldly;

namespace LptHub.UnitTests.Notes;

/// <summary>
/// Formatted paste (#1411): what the client keeps from pasted Word, Outlook, Google Docs, Excel and web text is accepted unchanged by the Note profile of the sanitiser, and
/// everything else is still removed. The client clean-up is for quality; this is the safety net (design note docs/ux/notes-round-2/README.md section 6).
/// </summary>
public sealed class NotePasteSanitiserTests
{
    private static string Clean(string html) => RichHtml.Sanitize(html, RichHtmlLimits.Note, RichHtmlProfile.Note);

    /// <summary>The kept vocabulary exactly as the editor writes it (<c>getHTML()</c> after a paste): the server returns it as it is, so a save does not look like a change.</summary>
    [Fact]
    public void What_the_client_keeps_passes_through_unchanged()
    {
        const string kept =
            "<h1>Plan</h1><h2>Sub</h2><h3>Small</h3><p><strong>Bold</strong> <em>italic</em> <u>under</u> <strong><em><u>all</u></em></strong></p>"
            + "<ul><li><p>One</p><ul><li><p>Nested</p></li></ul></li><li><p>Two</p></li></ul><ol><li><p>First</p></li></ol>"
            + "<blockquote><p>Quoted</p></blockquote>"
            + "<table><tbody><tr><th colspan=\"2\"><p>Head</p></th></tr><tr><td rowspan=\"2\"><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td></tr></tbody></table>"
            + "<p><a href=\"https://example.com/a?x=1&amp;y=2\" rel=\"noopener noreferrer\">link</a> <a href=\"mailto:a@b.example\" rel=\"noopener noreferrer\">mail</a> <span data-color=\"red\">red</span></p>";

        Clean(kept).ShouldBe(kept);
    }

    [Fact]
    public void A_Word_paste_the_client_missed_is_still_reduced_to_the_same_vocabulary()
    {
        // What the browser hands over when the client clean-up is bypassed (an old tab, a hand-made request).
        var word = "<h1 style=\"margin-top:12pt\" class=\"MsoHeading1\"><span style='font-family:\"Calibri Light\";color:#2F5496'>Title<o:p></o:p></span></h1>"
            + "<p class=MsoNormal style=\"mso-list:l0 level1 lfo1\"><b>Bold</b> <s>struck</s> <span style=\"background:yellow\">marked</span></p>"
            + "<p><font color=\"red\" face=\"Arial\">font tag</font></p>";

        var clean = Clean(word);

        clean.ShouldBe("<h1>Title</h1><p><b>Bold</b> struck marked</p><p>font tag</p>");
        clean.ShouldNotContain("style");
        clean.ShouldNotContain("class");
        clean.ShouldNotContain("mso-");
        clean.ShouldNotContain("color");
    }

    [Theory]
    [InlineData("<p>Seen</p><p hidden>SECRET</p>")]
    [InlineData("<p>Seen</p><p style=\"display:none\">SECRET</p>")]
    [InlineData("<p>Seen</p><p style=\"DISPLAY : NONE !important\">SECRET</p>")]
    [InlineData("<p>Seen</p><div style=\"color:red;visibility:hidden\"><p>SECRET</p></div>")]
    [InlineData("<p>Seen</p><p style=\"mso-hide:all\">SECRET</p>")]
    [InlineData("<p>Seen<span style=\"font-size:0\">SECRET</span></p>")]
    [InlineData("<p>Seen<span style=\"font-size: 0px;\">SECRET</span></p>")]
    [InlineData("<p>Seen<span style=\"opacity:0\">SECRET</span></p>")]
    [InlineData("<p>Seen<span style=\"opacity:0.0\">SECRET</span></p>")]
    public void Hidden_text_is_dropped_with_its_content(string html)
    {
        var clean = Clean(html);

        clean.ShouldContain("Seen");
        clean.ShouldNotContain("SECRET");
    }

    [Theory]
    [InlineData("<p>Seen<span style=\"font-size:12pt\">kept</span></p>")]
    [InlineData("<p>Seen<span style=\"font-size:0.5em\">kept</span></p>")]
    [InlineData("<p>Seen<span style=\"opacity:0.5\">kept</span></p>")]
    [InlineData("<p>Seen<span style=\"display:block\">kept</span></p>")]
    [InlineData("<p>Seen<span style=\"visibility:visible\">kept</span></p>")]
    [InlineData("<p>Seen<span style=\"mso-hide:none\">kept</span></p>")]
    public void Text_that_only_looks_like_a_hiding_style_stays(string html)
    {
        Clean(html).ShouldContain("kept");
    }

    [Fact]
    public void A_hidden_table_row_or_cell_of_Excel_is_dropped()
    {
        var clean = Clean("<table><tr><td>A</td><td style=\"display:none\">HIDDENCOL</td></tr><tr style=\"display:none\"><td>HIDDENROW</td></tr><tr><td>B</td></tr></table>");

        clean.ShouldContain("A");
        clean.ShouldContain("B");
        clean.ShouldNotContain("HIDDENCOL");
        clean.ShouldNotContain("HIDDENROW");
    }

    [Fact]
    public void Tracked_deletions_are_dropped_and_insertions_kept()
    {
        var clean = Clean("<p>agree to <del>thirty</del><ins>sixty</ins> days</p>");

        clean.ShouldBe("<p>agree to sixty days</p>");
    }

    [Fact]
    public void The_other_profiles_keep_hidden_text_and_deleted_text_as_before()
    {
        // The change is for notes only (design note section 6): comments, descriptions and e-mail intake behave as they did.
        RichHtml.Sanitize("<p>a<span style=\"display:none\">b</span><del>c</del></p>", RichHtmlLimits.Comment).ShouldBe("<p>abc</p>");
    }

    [Fact]
    public void Pasted_script_styles_forms_and_unsafe_links_are_removed()
    {
        var web = "<div style=\"color:rgb(32,33,36)\"><h3 style=\"margin:0\">Retention</h3><p>See <a class=\"gt\" href=\"https://example.com/r\" style=\"color:blue\">policy</a>, "
            + "<a href=\"javascript:alert(1)\">js</a>, <a href=\"file:///C:/a.docx\">file</a>, <a href=\"https://good.example@evil.example/\">cred</a></p>"
            + "<script>alert(1)</script><style>p{}</style><form action=\"/s\"><input value=\"typed\"><button>Go</button></form><iframe src=\"https://evil\"></iframe>"
            + "<img src=\"https://example.com/p.png\" onerror=\"a()\"><svg><a href=\"https://x\">svg</a></svg></div>";

        var clean = Clean(web);

        clean.ShouldContain("<h3>Retention</h3>");
        clean.ShouldContain("<a href=\"https://example.com/r\" rel=\"noopener noreferrer\">policy</a>");
        clean.ShouldContain(">js<");
        clean.ShouldContain(">file<");
        clean.ShouldContain(">cred<");
        foreach (var gone in new[] { "script", "alert", "<style", "javascript:", "file:", "evil", "<form", "<input", "<iframe", "<img", "onerror", "<svg", "svg<", "style=", "class=" })
            clean.ShouldNotContain(gone);
    }

    [Fact]
    public void The_real_address_of_an_unwrapped_Outlook_Safe_Link_is_kept_as_it_is()
    {
        // The client unwraps Safe Links; a wrapped one that still arrives is a normal https link (the server does not follow or rewrite it).
        var clean = Clean("<p><a href=\"https://docs.example.com/plan?v=3&amp;x=1\">plan</a></p>");

        clean.ShouldBe("<p><a href=\"https://docs.example.com/plan?v=3&amp;x=1\" rel=\"noopener noreferrer\">plan</a></p>");
    }

    [Fact]
    public void A_table_of_1001_cells_is_refused_and_1000_is_kept()
    {
        static string Table(int cells) => "<table><tbody>" + string.Concat(Enumerable.Range(0, cells / 10).Select(r => "<tr>" + string.Concat(Enumerable.Range(0, 10).Select(c => $"<td>{r * 10 + c}</td>")) + "</tr>")) + (cells % 10 > 0 ? "<tr>" + string.Concat(Enumerable.Range(0, cells % 10).Select(c => $"<td>x{c}</td>")) + "</tr>" : string.Empty) + "</tbody></table>";

        RichHtml.TrySanitize(Table(1000), RichHtmlLimits.Note, out var clean, RichHtmlProfile.Note).ShouldBe(RichHtmlProblem.None);
        clean.ShouldContain("<table>");
        RichHtml.TrySanitize(Table(1001), RichHtmlLimits.Note, out _, RichHtmlProfile.Note).ShouldBe(RichHtmlProblem.TooManyCells);
    }

    [Fact]
    public void Hidden_text_cannot_be_smuggled_back_by_the_fixpoint_round_trip()
    {
        // A hidden element nested in a kept one, and a second pass over the output, change nothing.
        var once = Clean("<blockquote><p>Seen</p><p style=\"display:none\">SECRET</p></blockquote><p hidden><b>SECRET</b></p>");

        once.ShouldBe("<blockquote><p>Seen</p></blockquote>");
        Clean(once).ShouldBe(once);
    }
}
