using System.Text;
using MatterFlow.Intake.Application;
using MatterFlow.SharedKernel.Time;
using Microsoft.Extensions.Options;
using Shouldly;

namespace MatterFlow.UnitTests.Intake;

/// <summary>The HTML body of an email as the description candidate (decision R): tables kept, hostile markup gone, limits fall back to text.</summary>
public class EmailHtmlTests
{
    private static EmailParseService Service() => new(Options.Create(new IntakeOptions()), UserTimeZone.Resolve(null));

    private static byte[] Eml(string html, string? text = "Name Qty\r\nDisk 2") =>
        Encoding.UTF8.GetBytes(
            "From: Jane Doe <jane.doe@example-firm.test>\r\nTo: team@example-firm.test\r\nSubject: Load list\r\nDate: Mon, 12 Oct 2026 09:15:00 -0400\r\nMIME-Version: 1.0\r\n"
            + "Content-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n"
            + (text is null ? string.Empty : "--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + text + "\r\n")
            + "--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" + html + "\r\n--b1--\r\n");

    private static async Task<MatterFlow.Intake.Application.ParsedEmailResponse> ParseAsync(byte[] bytes)
    {
        await using var stream = new MemoryStream(bytes);
        var result = await Service().ParseFileAsync(stream, "mail.eml", CancellationToken.None);
        result.IsSuccess.ShouldBeTrue(result.Error?.Message);
        return result.Value;
    }

    [Fact]
    public async Task An_eml_html_body_keeps_its_table_and_loses_everything_dangerous()
    {
        const string html = "<html><head><style>td{color:red}</style><script>alert(1)</script></head><body onload=\"alert(2)\"><p class=\"MsoNormal\">Please load these:<o:p></o:p></p>"
            + "<table border=1 style=\"width:100%\"><tr><th>Name</th><th>Qty</th></tr><tr><td onclick=\"x()\">Disk</td><td colspan=\"1\">2<img src=\"cid:logo\"></td></tr></table>"
            + "<a href=\"javascript:alert(3)\">click</a></body></html>";
        var email = await ParseAsync(Eml(html));

        email.BodyHtml.ShouldBe("<p>Please load these:</p><table><tbody><tr><th>Name</th><th>Qty</th></tr><tr><td>Disk</td><td>2</td></tr></tbody></table><a>click</a>");
        email.Body.ShouldBe("Name Qty\nDisk 2");
        email.Warnings.ShouldBeEmpty();
    }

    [Fact]
    public async Task An_html_only_email_gets_both_the_text_and_the_html_body()
    {
        var email = await ParseAsync(Encoding.UTF8.GetBytes(
            "From: a@example.test\r\nSubject: s\r\nDate: Mon, 12 Oct 2026 09:15:00 -0400\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<table><tr><td>A</td><td>B</td></tr></table>\r\n"));
        email.BodyHtml.ShouldBe("<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>");
        email.Body.ShouldContain("A");
    }

    [Fact]
    public async Task A_plain_text_email_has_no_html_body()
    {
        var email = await ParseAsync(Encoding.UTF8.GetBytes("From: a@example.test\r\nSubject: s\r\nDate: Mon, 12 Oct 2026 09:15:00 -0400\r\n\r\njust text\r\n"));
        email.BodyHtml.ShouldBeNull();
        email.Body.ShouldBe("just text");
    }

    [Fact]
    public async Task A_table_over_the_cell_limit_falls_back_to_the_text_body_with_a_warning()
    {
        var cells = string.Concat(Enumerable.Repeat("<td>x</td>", 250));
        var email = await ParseAsync(Eml("<table><tr>" + cells + "</tr></table>"));
        email.BodyHtml.ShouldBeNull();
        email.Body.ShouldBe("Name Qty\nDisk 2");
        email.Warnings.ShouldContain(w => w.Contains("200 cells", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Hostile_nesting_in_the_html_body_falls_back_to_text_and_does_not_crash()
    {
        var email = await ParseAsync(Eml(string.Concat(Enumerable.Repeat("<div>", 5000)) + "x"));
        email.BodyHtml.ShouldBeNull();
        email.Warnings.ShouldContain(w => w.Contains("too large or too complex", StringComparison.Ordinal));
    }

    [Fact]
    public void Pasted_html_is_sanitized_and_its_header_lines_are_dropped()
    {
        const string text = "From: Jane Doe <jane.doe@example-firm.test>\nSent: Monday, October 12, 2026 9:15 AM\nTo: Team\nSubject: Load list\n\nPlease load these.";
        const string html = "<p><b>From:</b> Jane Doe &lt;jane.doe@example-firm.test&gt;<br><b>Sent:</b> Monday, October 12, 2026 9:15 AM<br><b>To:</b> Team<br><b>Subject:</b> Load list</p>"
            + "<p>Please load these.</p><table><tr><td>A</td><td onclick=\"x()\">B</td></tr></table><script>alert(1)</script>";
        var result = Service().ParsePastedText(text, html);

        result.IsSuccess.ShouldBeTrue();
        result.Value.Subject.ShouldBe("Load list");
        result.Value.BodyHtml.ShouldBe("<p>Please load these.</p><table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>");
    }

    [Fact]
    public void Pasted_html_with_one_paragraph_per_header_line_and_a_separator_line_keeps_the_body()
    {
        const string text = "From: Jane <j@example.test>\nSent: Monday, October 12, 2026 9:15 AM\nSubject: S\n\nBody";
        const string html = "<p>From: Jane &lt;j@example.test&gt;</p><p>Sent: Monday, October 12, 2026 9:15 AM</p><p>Subject: S</p><p>Body line<br>second</p>";
        Service().ParsePastedText(text, html).Value.BodyHtml.ShouldBe("<p>Body line<br>second</p>");
    }

    [Fact]
    public void Pasted_html_of_a_body_that_only_starts_with_a_label_word_is_not_trimmed()
    {
        const string text = "To: do list for the week\n\nmore";
        const string html = "<p>To: do list for the week</p><p>more</p>";
        var result = Service().ParsePastedText(text, html);
        result.Value.BodyHtml.ShouldBe("<p>To: do list for the week</p><p>more</p>");
    }

    [Fact]
    public void Pasted_html_alone_does_not_replace_the_required_text()
    {
        Service().ParsePastedText("  ", "<p>x</p>").IsFailure.ShouldBeTrue();
        Service().ParsePastedText("plain", null).Value.BodyHtml.ShouldBeNull();
    }
}
