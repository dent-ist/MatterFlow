using LptHub.Notes.Application;
using LptHub.SharedKernel.Text;
using Shouldly;

namespace LptHub.UnitTests.Notes;

/// <summary>
/// Pasted images (epic #1405, issue #1409): the Note profile keeps exactly <c>&lt;img data-image-id alt width height&gt;</c> and nothing else (no src, no URL, no data URI), the other profiles
/// still drop every image, the references of a body include its images, and a template carries none.
/// </summary>
public sealed class NoteImageSanitiserTests
{
    private static string Clean(string html) => RichHtml.Sanitize(html, RichHtmlLimits.Note, RichHtmlProfile.Note);

    [Fact]
    public void The_form_the_editor_writes_passes_through_unchanged()
    {
        const string kept = "<p>Before</p><img data-image-id=\"581\" alt=\"Pasted image\" width=\"480\" height=\"300\"><p>After</p>";

        Clean(kept).ShouldBe(kept);
    }

    [Theory]
    [InlineData("<img src=\"https://evil.example/p.png\" data-image-id=\"5\" alt=\"x\" width=\"10\" height=\"20\">")]
    [InlineData("<img src=\"data:image/png;base64,AAAA\" srcset=\"a.png 2x\" style=\"width:1px\" class=\"big\" loading=\"lazy\" title=\"t\" onerror=\"a()\" onload=\"b()\" data-image-id=\"5\" alt=\"x\" width=\"10\" height=\"20\">")]
    [InlineData("<img width=\"10\" height=\"20\" alt=\"x\" data-image-id=\"5\" data-other=\"1\" id=\"i\" usemap=\"#m\">")]
    [InlineData("<IMG DATA-IMAGE-ID='5' ALT=x WIDTH=10 HEIGHT=20 SRC=javascript:alert(1)>")]
    public void Every_other_attribute_is_removed_and_the_order_is_fixed(string input)
    {
        var clean = Clean(input);

        clean.ShouldBe("<img data-image-id=\"5\" alt=\"x\" width=\"10\" height=\"20\">");
        foreach (var gone in new[] { "src", "srcset", "style", "class", "loading", "title", "onerror", "onload", "javascript", "data:", "http", "usemap", "id=\"i\"", "data-other" })
            clean.ShouldNotContain(gone);
    }

    [Theory]
    [InlineData("<img src=\"https://example.com/p.png\">")]
    [InlineData("<img src=\"data:image/png;base64,AAAA\" alt=\"a\">")]
    [InlineData("<img data-image-id=\"\" alt=\"a\">")]
    [InlineData("<img data-image-id=\"0\">")]
    [InlineData("<img data-image-id=\"-5\">")]
    [InlineData("<img data-image-id=\"5x\">")]
    [InlineData("<img data-image-id=\"12345678901\">")]
    [InlineData("<img data-image-id=\"2147483648\">")]
    [InlineData("<img data-image-id=\"٥\">")] // an Arabic-Indic digit
    public void An_image_without_a_valid_id_is_removed_with_no_text(string input) => Clean("<p>x</p>" + input).ShouldBe("<p>x</p>");

    [Fact]
    public void Alt_text_is_plain_text_of_at_most_200_characters_and_never_empty()
    {
        Clean("<img data-image-id=\"1\">").ShouldBe("<img data-image-id=\"1\" alt=\"Pasted image\">");
        Clean("<img data-image-id=\"1\" alt=\"\">").ShouldBe("<img data-image-id=\"1\" alt=\"Pasted image\">");
        Clean("<img data-image-id=\"1\" alt=\"   \t\n \">").ShouldBe("<img data-image-id=\"1\" alt=\"Pasted image\">");
        Clean("<img data-image-id=\"1\" alt=\"Privilege   log\u0007 &lt;b&gt;screenshot&lt;/b&gt;\">").ShouldBe("<img data-image-id=\"1\" alt=\"Privilege log bscreenshot/b\">");
        Clean("<img data-image-id=\"1\" alt=\"a &quot;quoted&quot; &amp; more\">").ShouldBe("<img data-image-id=\"1\" alt=\"a &quot;quoted&quot; &amp; more\">");
        Clean("<img data-image-id=\"1\" alt=\"‮evil‬\">").ShouldBe("<img data-image-id=\"1\" alt=\"evil\">");

        var longAlt = new string('x', 300);
        Clean($"<img data-image-id=\"1\" alt=\"{longAlt}\">").ShouldBe($"<img data-image-id=\"1\" alt=\"{new string('x', 200)}\">");
    }

    [Theory]
    [InlineData("width=\"480\" height=\"300\"", " width=\"480\" height=\"300\"")]
    [InlineData("width=\"480\"", "")]
    [InlineData("height=\"300\"", "")]
    [InlineData("width=\"0\" height=\"300\"", "")]
    [InlineData("width=\"4001\" height=\"300\"", "")]
    [InlineData("width=\"4000\" height=\"1\"", " width=\"4000\" height=\"1\"")]
    [InlineData("width=\"-5\" height=\"300\"", "")]
    [InlineData("width=\"1e3\" height=\"300\"", "")]
    [InlineData("width=\"50%\" height=\"300\"", "")]
    [InlineData("width=\"12345\" height=\"300\"", "")]
    public void Width_and_height_are_digits_from_1_to_4000_both_or_neither(string sizes, string expected) =>
        Clean($"<img data-image-id=\"3\" alt=\"a\" {sizes}>").ShouldBe($"<img data-image-id=\"3\" alt=\"a\"{expected}>");

    [Fact]
    public void An_image_can_sit_between_paragraphs_in_a_list_item_and_in_a_table_cell_and_stays_a_fixpoint()
    {
        const string kept =
            "<p>One</p><img data-image-id=\"1\" alt=\"a\" width=\"10\" height=\"10\"><p>Two</p>"
            + "<ul><li><p>Item</p><img data-image-id=\"2\" alt=\"b\" width=\"20\" height=\"20\"></li></ul>"
            + "<table><tbody><tr><td><img data-image-id=\"3\" alt=\"c\" width=\"30\" height=\"30\"></td><td><p>text</p></td></tr></tbody></table>";

        var once = Clean(kept);

        once.ShouldBe(kept);
        Clean(once).ShouldBe(once);
    }

    [Fact]
    public void A_note_that_is_only_a_picture_is_not_blank()
    {
        Clean("<img data-image-id=\"9\" alt=\"Pasted image\">").ShouldBe("<img data-image-id=\"9\" alt=\"Pasted image\">");
        Clean("<p></p><img src=\"x.png\">").ShouldBe(string.Empty);
    }

    [Theory]
    [InlineData(RichHtmlProfile.Basic)]
    public void The_other_profiles_still_drop_every_image(RichHtmlProfile profile)
    {
        var clean = RichHtml.Sanitize("<p>a</p><img data-image-id=\"5\" alt=\"x\" width=\"1\" height=\"1\" src=\"https://x.example/p.png\"><p>b</p>", profile: profile);

        clean.ShouldBe("<p>a</p><p>b</p>");
    }

    [Fact]
    public void Mutation_style_markup_around_an_image_stays_a_fixpoint_and_carries_no_script()
    {
        foreach (var input in new[]
        {
            "<svg><style><img data-image-id=\"1\" alt=\"</style><img src=x onerror=alert(1)>\"></style></svg>",
            "<math><mtext><table><mglyph><style><!--</style><img data-image-id=\"1\" alt=\"--&gt;&lt;img src=1 onerror=alert(1)&gt;\">",
            "<noscript><p title=\"</noscript><img data-image-id=1 src=x onerror=alert(1)>\">",
            "<table><tr><td><img data-image-id=\"1\" alt=\"x\"></td></tr></table><img data-image-id=\"2\" onerror=alert(1)>",
            "<p><img data-image-id=\"1\" alt='\"><script>alert(1)</script>'></p>",
        })
        {
            var once = Clean(input);
            Clean(once).ShouldBe(once);
            once.ShouldNotContain("onerror");
            once.ShouldNotContain("<script");
            once.ShouldNotContain("src=");
        }
    }

    [Fact]
    public void An_image_does_not_become_the_title_or_the_snippet_but_its_alt_text_is_searchable()
    {
        var result = NoteContent.Process("<img data-image-id=\"7\" alt=\"Privilege log screenshot\" width=\"10\" height=\"10\"><p>Real title</p><p>Second line</p><img data-image-id=\"8\" alt=\"Org chart\">");

        result.IsSuccess.ShouldBeTrue();
        result.Value.Title.ShouldBe("Real title");
        result.Value.Snippet.ShouldBe("Second line");
        result.Value.Text.ShouldContain("Privilege log screenshot");
        result.Value.Text.ShouldContain("Org chart");
        result.Value.ImageIds.ShouldBe([7, 8]);
    }

    [Fact]
    public void A_note_that_is_only_a_picture_has_no_title_and_the_alt_text_for_search()
    {
        var result = NoteContent.Process("<img data-image-id=\"7\" alt=\"Pasted image\">");

        result.Value.Title.ShouldBe(string.Empty);
        result.Value.Text.ShouldBe("Pasted image");
    }

    [Fact]
    public void Images_are_references_of_type_IMAGE_counted_apart_from_the_200_reference_cap()
    {
        var refs = NoteContent.ExtractReferences("<p><span data-note-id=\"4\">n</span></p><img data-image-id=\"1\" alt=\"a\"><img data-image-id=\"1\" alt=\"a\"><img data-image-id=\"2\" alt=\"b\">");

        refs.Select(r => (r.Target, r.Id)).ShouldBe([("NOTE", 4), ("IMAGE", 1), ("IMAGE", 2)]);
        NoteContent.Links(refs).Count(l => l.Target == "IMAGE").ShouldBe(2);
    }

    [Fact]
    public void A_note_holds_at_most_20_distinct_images()
    {
        string Body(int count) => string.Concat(Enumerable.Range(1, count).Select(i => $"<img data-image-id=\"{i}\" alt=\"i\">"));

        NoteContent.Process(Body(20)).IsSuccess.ShouldBeTrue();
        var tooMany = NoteContent.Process(Body(21));
        tooMany.IsFailure.ShouldBeTrue();
        tooMany.Error!.FieldErrors!["bodyHtml"][0].Code.ShouldBe("TOO_MANY_IMAGES");
        NoteContent.Process(Body(20) + "<img data-image-id=\"3\" alt=\"i\">").IsSuccess.ShouldBeTrue(); // the same image twice counts once
    }

    [Fact]
    public void A_template_keeps_no_images_and_says_how_many_it_left_out()
    {
        var html = "<p>Text <span data-note-id=\"4\">Note</span></p><img data-image-id=\"1\" alt=\"a\" width=\"1\" height=\"1\"><img data-image-id=\"2\" alt=\"b\">";

        NoteContent.StripReferences(html, out var left).ShouldBe("<p>Text Note</p>");
        left.ShouldBe(2);
        NoteContent.StripReferences("<p>none</p>", out var none).ShouldBe("<p>none</p>");
        none.ShouldBe(0);
    }

    [Fact]
    public void A_copied_image_gets_its_new_id_in_every_place_and_nothing_else_changes()
    {
        var html = "<img data-image-id=\"5\" alt=\"a\" width=\"1\" height=\"1\"><p>x</p><img data-image-id=\"5\" alt=\"a\"><img data-image-id=\"6\" alt=\"b\"><span data-note-id=\"5\">n</span>";

        NoteContent.ReplaceImageIds(html, new Dictionary<int, int> { [5] = 99 })
            .ShouldBe("<img data-image-id=\"99\" alt=\"a\" width=\"1\" height=\"1\"><p>x</p><img data-image-id=\"99\" alt=\"a\"><img data-image-id=\"6\" alt=\"b\"><span data-note-id=\"5\">n</span>");
    }
}
