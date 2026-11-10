using MatterFlow.Intake.Application;
using Shouldly;

namespace MatterFlow.UnitTests.Intake;

public class HtmlToTextTests
{
    [Fact]
    public void Keeps_paragraphs_breaks_and_list_items()
    {
        var text = HtmlToText.Convert("<p>One</p><p>Two<br>three<br><br>four</p><ul><li>a</li><li>b</li></ul>");

        text.ShouldBe("One\n\nTwo\nthree\n\nfour\n\n- a\n- b");
    }

    [Fact]
    public void Drops_scripts_styles_comments_images_and_unsafe_links()
    {
        var text = HtmlToText.Convert(
            "<head><title>t</title></head><body><!-- c --><script>alert(1)</script><style>p{}</style><img src='data:image/png;base64,AAA'>"
            + "<a href='javascript:alert(1)'>click</a> <a href='cid:abc'>inline</a> <a href='https://x.test/a'>site</a> <a href='mailto:a@x.test'>mail me</a> <a href='https://y.test'>https://y.test</a></body>");

        text.ShouldBe("click inline site (https://x.test/a) mail me (a@x.test) https://y.test");
    }

    [Fact]
    public void Decodes_entities_and_collapses_whitespace()
    {
        HtmlToText.Convert("<div>  a&nbsp;&amp;   b &lt;c&gt;\n\n d </div>").ShouldBe("a & b <c> d");
    }

    [Fact]
    public void Table_cells_are_separated_and_rows_break()
    {
        HtmlToText.Convert("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>").ShouldBe("a b\nc d");
    }

    [Fact]
    public void Very_deep_nesting_does_not_overflow_the_stack()
    {
        var html = string.Concat(Enumerable.Repeat("<div>", 20_000)) + "deep" + string.Concat(Enumerable.Repeat("</div>", 20_000));

        HtmlToText.Convert(html).ShouldBe("deep");
    }

    [Theory]
    [InlineData(50_000)]
    [InlineData(150_000)]
    public void Nested_tags_are_converted_in_linear_time(int depth)
    {
        var html = string.Concat(Enumerable.Repeat("<div>", depth)) + "deep";

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var text = HtmlToText.Convert(html);
        stopwatch.Stop();

        text.ShouldBe("deep");
        stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void Input_beyond_the_size_cap_is_ignored()
    {
        var html = "<p>kept</p>" + new string(' ', HtmlToText.MaxInputChars) + "<p>ignored</p>";

        HtmlToText.Convert(html).ShouldBe("kept");
    }

    [Fact]
    public void Unclosed_script_and_unterminated_tags_swallow_the_rest()
    {
        HtmlToText.Convert("<p>a</p><script>alert(1)<p>b</p>").ShouldBe("a");
        HtmlToText.Convert("<p>a</p><div title=\"x").ShouldBe("a");
        HtmlToText.Convert("1 < 2 and 3 > 2").ShouldBe("1 < 2 and 3 > 2");
    }

    [Fact]
    public void Output_is_capped()
    {
        HtmlToText.Convert("<p>" + new string('x', 1_000_000) + "</p>", 5000).Length.ShouldBeLessThanOrEqualTo(5000);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Empty_input_is_empty(string? html) => HtmlToText.Convert(html).ShouldBeEmpty();
}

public class PastedTextParserTests
{
    private static readonly TimeZoneInfo Firm = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    private static ParsedEmailResponse Parse(string text) => PastedTextParser.Parse(text, Firm);

    [Fact]
    public void Outlook_header_block_and_body()
    {
        var email = Parse(
            "From: Jane Doe <jane.doe@example-firm.test>\r\nSent: Thursday, October 15, 2026 3:10 PM\r\nTo: Maria Gomez\r\nCc: Raj Patel\r\nSubject: Custodian interview schedule\r\n\r\nHi Maria,\r\n\r\nPlease set up the interviews.\r\n\r\nJane");

        email.Source.ShouldBe(EmailSource.Text);
        email.Subject.ShouldBe("Custodian interview schedule");
        email.FromName.ShouldBe("Jane Doe");
        email.FromEmail.ShouldBe("jane.doe@example-firm.test");
        email.SentAt.ShouldBe(new DateTimeOffset(2026, 10, 15, 19, 10, 0, TimeSpan.Zero)); // 3:10 PM EDT
        email.Body.ShouldBe("Hi Maria,\n\nPlease set up the interviews.\n\nJane");
        email.Warnings.ShouldBeEmpty();
    }

    [Fact]
    public void Winter_time_uses_the_standard_offset()
    {
        Parse("From: A <a@x.test>\nSent: Monday, January 11, 2027 9:00 AM\nSubject: s\n\nb").SentAt
            .ShouldBe(new DateTimeOffset(2027, 1, 11, 14, 0, 0, TimeSpan.Zero));
    }

    [Fact]
    public void Header_with_blank_lines_between_labels_is_tolerated()
    {
        var email = Parse("From: A B <ab@x.test>\n\nSent: Monday, October 12, 2026 9:15 AM\n\nSubject: Hi\n\nBody");

        email.Subject.ShouldBe("Hi");
        email.Body.ShouldBe("Body");
    }

    [Fact]
    public void Original_message_separator_before_the_block_is_dropped()
    {
        var email = Parse("-----Original Message-----\nFrom: A B <ab@x.test>\nSent: Monday, October 12, 2026 9:15 AM\nSubject: Hi\n\nBody");

        email.Body.ShouldBe("Body");
        email.Subject.ShouldBe("Hi");
    }

    [Fact]
    public void Text_before_the_block_is_kept()
    {
        var email = Parse("Please handle this:\n\nFrom: A B <ab@x.test>\nSent: Monday, October 12, 2026 9:15 AM\nSubject: Hi\n\nBody");

        email.Body.ShouldBe("Please handle this:\n\nBody");
    }

    [Fact]
    public void Only_the_first_block_is_the_header_later_ones_stay_in_the_body()
    {
        var email = Parse(
            "From: Maria <m@x.test>\nSent: Friday, October 16, 2026 4:45 PM\nSubject: FW: Plan\n\nSee below.\n\n________________________________\nFrom: Partner <p@x.test>\nSent: Thursday, October 15, 2026 3:10 PM\nSubject: Plan\n\nOriginal.");

        email.FromEmail.ShouldBe("m@x.test");
        email.Subject.ShouldBe("FW: Plan");
        email.Body.ShouldContain("From: Partner <p@x.test>");
        email.Body.ShouldContain("Original.");
    }

    [Fact]
    public void Body_only_text_fills_only_the_body()
    {
        var email = Parse("Hi team,\n\nPlease prepare the load file.\n\nThanks");

        email.Subject.ShouldBeEmpty();
        email.FromName.ShouldBeEmpty();
        email.FromEmail.ShouldBeEmpty();
        email.SentAt.ShouldBeNull();
        email.Body.ShouldBe("Hi team,\n\nPlease prepare the load file.\n\nThanks");
    }

    [Fact]
    public void A_lone_from_line_is_not_a_header_block()
    {
        var email = Parse("From: someone\nbut this is just a sentence");

        email.Subject.ShouldBeEmpty();
        email.Body.ShouldBe("From: someone\nbut this is just a sentence");
    }

    [Fact]
    public void Header_labels_far_down_the_text_are_not_a_header()
    {
        var lines = string.Join('\n', Enumerable.Range(1, 20).Select(i => "line " + i));

        var email = Parse(lines + "\nFrom: A <a@x.test>\nSubject: late\nSent: Monday, October 12, 2026 9:15 AM\n");

        email.Subject.ShouldBeEmpty();
    }

    [Fact]
    public void Unreadable_date_leaves_it_empty_with_a_warning()
    {
        var email = Parse("From: A <a@x.test>\nSent: sometime last week\nSubject: s\n\nb");

        email.SentAt.ShouldBeNull();
        email.Warnings.ShouldContain(w => w.Contains("sent date"));
    }

    [Theory]
    [InlineData("Jane Doe <jane@x.test>", "Jane Doe", "jane@x.test")]
    [InlineData("\"Doe, Jane\" <jane@x.test>", "Doe, Jane", "jane@x.test")]
    [InlineData("Doe, Jane [jane@x.test]", "Doe, Jane", "jane@x.test")]
    [InlineData("jane@x.test", "", "jane@x.test")]
    [InlineData("<jane@x.test>", "", "jane@x.test")]
    [InlineData("Jane Doe", "Jane Doe", "")]
    [InlineData("Jane Doe <jane@x.test>; Raj Patel <raj@x.test>", "Jane Doe", "jane@x.test")]
    [InlineData("", "", "")]
    public void Splits_sender_forms(string raw, string name, string email) =>
        PastedTextParser.SplitAddress(raw).ShouldBe((name, email));

    [Theory]
    [InlineData("2026-10-15T15:10:00Z", 2026, 10, 15, 15, 10)]
    [InlineData("2026-10-15T15:10:00-04:00", 2026, 10, 15, 19, 10)]
    [InlineData("Thu, 15 Oct 2026 15:10:00 +0200", 2026, 10, 15, 13, 10)]
    [InlineData("Thursday, October 15, 2026 3:10 PM EDT", 2026, 10, 15, 19, 10)]
    [InlineData("October 15, 2026 3:10 PM", 2026, 10, 15, 19, 10)]
    [InlineData("2026-10-15 15:10", 2026, 10, 15, 19, 10)]
    public void Parses_date_formats(string raw, int y, int mo, int d, int h, int mi) =>
        PastedTextParser.TryParseDate(raw, Firm).ShouldBe(new DateTimeOffset(y, mo, d, h, mi, 0, TimeSpan.Zero));

    [Theory]
    [InlineData("")]
    [InlineData("not a date")]
    [InlineData("99/99/9999")]
    public void Unreadable_dates_are_null(string raw) => PastedTextParser.TryParseDate(raw, Firm).ShouldBeNull();

    [Fact]
    public void Nonexistent_spring_forward_time_does_not_throw()
    {
        PastedTextParser.TryParseDate("March 14, 2027 2:30 AM", Firm).ShouldNotBeNull();
    }

    [Fact]
    public void Long_body_is_cut_with_a_warning()
    {
        var email = Parse("From: A <a@x.test>\nSent: Monday, October 12, 2026 9:15 AM\nSubject: s\n\n" + new string('x', 30_000));

        email.Body.Length.ShouldBe(20_000);
        email.Warnings.ShouldContain(w => w.Contains("shortened"));
    }

    [Fact]
    public void Pathological_input_finishes_quickly()
    {
        var evil = "From: " + new string('<', 20_000) + "\n" + new string('a', 50_000);

        var watch = System.Diagnostics.Stopwatch.StartNew();
        Parse(evil);
        watch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(5));
    }
}
