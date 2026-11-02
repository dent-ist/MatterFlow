using MatterFlow.SharedKernel.Text;
using Shouldly;

namespace MatterFlow.UnitTests.SharedKernel;

/// <summary>
/// The Note profile keeps a link to a OneNote page (<c>onenote:https://...</c>, the notes mockup r3 link dialog); the Basic profile (comments, descriptions) never does,
/// and nothing but an https address may follow <c>onenote:</c>.
/// </summary>
public sealed class RichHtmlNoteLinkTests
{
    private static string Note(string html) => RichHtml.Sanitize(html, RichHtmlLimits.Note, RichHtmlProfile.Note);

    [Fact]
    public void A_note_keeps_a_OneNote_link()
    {
        var clean = Note("<p><a href=\"onenote:https://lpthub.example.local/notebooks/Hosting#Workspace\">Hosting notebook</a></p>");

        clean.ShouldContain("href=\"onenote:https://lpthub.example.local/notebooks/Hosting#Workspace\"");
        clean.ShouldContain("rel=\"noopener noreferrer\"");
    }

    [Theory]
    [InlineData("onenote:http://example.test/x")]
    [InlineData("onenote:javascript:alert(1)")]
    [InlineData("onenote://example.test/x")]
    [InlineData("onenote:")]
    [InlineData("ONENOTE:data:text/html,x")]
    public void A_note_drops_a_OneNote_link_that_is_not_https(string href)
    {
        var clean = Note($"<p><a href=\"{href}\">x</a></p>");

        clean.ShouldNotContain("href");
    }

    [Fact]
    public void Comments_and_descriptions_do_not_keep_a_OneNote_link()
    {
        var clean = RichHtml.Sanitize("<p><a href=\"onenote:https://example.test/x\">x</a></p>", RichHtmlLimits.Comment);

        clean.ShouldNotContain("href");
    }

    [Fact]
    public void A_note_still_keeps_an_https_link()
    {
        Note("<p><a href=\"https://example.test/x\">x</a></p>").ShouldContain("href=\"https://example.test/x\"");
    }
}
