using LptHub.Notes.Application;
using LptHub.Notes.Domain;
using LptHub.SharedKernel.Text;
using Shouldly;

namespace LptHub.UnitTests.Notes;

/// <summary>The body rules of a note (MD-12): the sanitiser profile, the title (first line), the snippet and the references.</summary>
public sealed class NoteContentTests
{
    private static string Clean(string html) => RichHtml.Sanitize(html, RichHtmlLimits.Note, RichHtmlProfile.Note);

    [Fact]
    public void Headings_quote_lists_tables_and_links_are_kept()
    {
        var html = "<h1>Title</h1><h2>Sub</h2><blockquote><p>Said so</p></blockquote><ul><li>a</li></ul><table><tr><th>A</th></tr><tr><td>1</td></tr></table><p><a href=\"https://example.com\">x</a></p>";

        var clean = Clean(html);

        clean.ShouldContain("<h1>Title</h1>");
        clean.ShouldContain("<h2>Sub</h2>");
        clean.ShouldContain("<blockquote>");
        clean.ShouldContain("<table>");
        clean.ShouldContain("rel=\"noopener noreferrer\"");
    }

    [Fact]
    public void Headings_are_paragraphs_in_the_basic_profile()
    {
        RichHtml.Sanitize("<h1>Title</h1>", RichHtmlLimits.Comment).ShouldBe("<p>Title</p>");
    }

    [Theory]
    [InlineData("<script>alert(1)</script><p>x</p>")]
    [InlineData("<p onclick=\"a()\">x</p>")]
    [InlineData("<p style=\"color:red\">x</p>")]
    [InlineData("<img src=x onerror=a()>")]
    [InlineData("<iframe src=\"https://evil\"></iframe>")]
    [InlineData("<a href=\"javascript:alert(1)\">x</a>")]
    public void Scripts_handlers_styles_and_unsafe_links_are_removed(string html)
    {
        var clean = Clean(html);

        clean.ShouldNotContain("<script");
        clean.ShouldNotContain("onclick");
        clean.ShouldNotContain("onerror");
        clean.ShouldNotContain("style=");
        clean.ShouldNotContain("<iframe");
        clean.ShouldNotContain("javascript:");
    }

    [Fact]
    public void A_reference_span_keeps_exactly_one_id_attribute_and_nothing_else()
    {
        var clean = Clean("<p>See <span class=\"chip\" style=\"x:y\" onclick=\"a()\" data-asset-id=\"12\" data-other=\"1\">#Slack export</span></p>");

        clean.ShouldContain("<span data-asset-id=\"12\">#Slack export</span>");
        clean.ShouldNotContain("class");
        clean.ShouldNotContain("onclick");
        clean.ShouldNotContain("data-other");
    }

    [Theory]
    [InlineData("<span data-asset-id=\"abc\">x</span>")]
    [InlineData("<span data-asset-id=\"-1\">x</span>")]
    [InlineData("<span data-asset-id=\"0\">x</span>")]
    [InlineData("<span data-asset-id=\"99999999999\">x</span>")]
    [InlineData("<span data-asset-id=\"1\" data-user-id=\"2\">x</span>")]
    [InlineData("<span data-evil-id=\"1\">x</span>")]
    [InlineData("<span>x</span>")]
    public void A_span_that_is_not_one_valid_reference_is_unwrapped(string html)
    {
        var clean = Clean("<p>" + html + "</p>");

        clean.ShouldBe("<p>x</p>");
    }

    [Fact]
    public void Markup_inside_a_reference_is_reduced_to_text()
    {
        var clean = Clean("<p><span data-user-id=\"3\">@<b>Dana</b><script>x()</script></span></p>");

        clean.ShouldBe("<p><span data-user-id=\"3\">@Dana</span></p>");
    }

    [Fact]
    public void The_sanitised_body_is_stable_when_sanitised_again()
    {
        var once = Clean("<h2>A</h2><p>See <span data-note-id=\"4\">Plan</span></p><table><tr><td>1</td></tr></table>");

        Clean(once).ShouldBe(once);
    }

    [Fact]
    public void The_title_is_the_first_line_and_the_snippet_is_the_rest()
    {
        var result = NoteContent.Process("<h1>  Privilege   log protocol </h1><p>Second line</p><p>Third</p>");

        result.IsSuccess.ShouldBeTrue();
        result.Value.Title.ShouldBe("Privilege log protocol");
        result.Value.Snippet.ShouldBe("Second line Third");
        result.Value.Text.ShouldContain("Second line");
    }

    [Fact]
    public void The_title_skips_empty_lines_and_is_cut_at_300_characters()
    {
        var result = NoteContent.Process("<p></p><p>" + new string('a', 400) + "</p>");

        result.Value.Title.Length.ShouldBe(300);
    }

    [Fact]
    public void An_empty_body_is_allowed_and_has_no_title()
    {
        var result = NoteContent.Process(null);

        result.IsSuccess.ShouldBeTrue();
        result.Value.Title.ShouldBe(string.Empty);
        result.Value.Html.ShouldBe(string.Empty);
    }

    [Fact]
    public void References_are_extracted_once_each_in_document_order()
    {
        var result = NoteContent.Process(
            "<p><span data-asset-id=\"5\">A</span> <span data-user-id=\"2\">@U</span> <span data-asset-id=\"5\">A again</span></p>"
            + "<p><span data-project-id=\"7\">P</span> <span data-matter-id=\"9\">M</span> <span data-note-id=\"3\">N</span> <span data-embed-id=\"4\">E</span></p>");

        result.Value.References.ShouldBe(
        [
            new NoteReference(NoteLinkTarget.Asset, 5, false),
            new NoteReference(NoteLinkTarget.User, 2, false),
            new NoteReference(NoteLinkTarget.Project, 7, false),
            new NoteReference(NoteLinkTarget.Matter, 9, false),
            new NoteReference(NoteLinkTarget.Note, 3, false),
            new NoteReference(NoteLinkTarget.Note, 4, true),
        ]);
        NoteContent.Links(result.Value.References).Count.ShouldBe(6);
    }

    [Fact]
    public void A_note_shown_inline_and_as_a_chip_is_one_link()
    {
        var result = NoteContent.Process("<p><span data-note-id=\"3\">N</span><span data-embed-id=\"3\">N</span></p>");

        NoteContent.Links(result.Value.References).ShouldBe([(NoteLinkTarget.Note, 3)]);
    }

    [Fact]
    public void Too_many_references_are_refused()
    {
        var spans = string.Concat(Enumerable.Range(1, NoteContent.MaxReferences + 1).Select(i => $"<span data-asset-id=\"{i}\">a</span> "));

        var result = NoteContent.Process("<p>" + spans + "</p>");

        result.IsFailure.ShouldBeTrue();
        result.Error!.FieldErrors!["bodyHtml"][0].Code.ShouldBe("TOO_MANY_REFERENCES");
    }

    [Fact]
    public void A_flood_of_table_cells_is_refused_with_a_clear_code()
    {
        var cells = string.Concat(Enumerable.Repeat("<td>x</td>", 1_100));

        var result = NoteContent.Process("<table><tr>" + cells + "</tr></table>");

        result.IsFailure.ShouldBeTrue();
        result.Error!.FieldErrors!["bodyHtml"][0].Code.ShouldBeOneOf("TABLE_TOO_LARGE", "TOO_COMPLEX");
    }

    [Fact]
    public void Templates_carry_no_references()
    {
        var html = NoteContent.Process("<p>For <span data-user-id=\"2\">@Dana</span> on {{date}}</p>").Value.Html;

        NoteContent.StripReferences(html).ShouldBe("<p>For @Dana on {{date}}</p>");
    }

    [Fact]
    public void Plain_text_of_headings_and_quotes_breaks_lines()
    {
        RichHtml.ToPlainText("<h1>A</h1><blockquote>B</blockquote><p>C</p>").ShouldBe("A\nB\nC");
    }
}
