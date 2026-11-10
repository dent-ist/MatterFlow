using System.Diagnostics;
using MatterFlow.SharedKernel.Text;
using Shouldly;

namespace MatterFlow.UnitTests.SharedKernel;

/// <summary>Tables in the shared sanitizer (decision R): what is kept, what is normalised, the limits, and plain-text rendering.</summary>
public sealed class RichHtmlTableTests
{
    private static string Clean(string html, RichHtmlLimits? limits = null) => RichHtml.Sanitize(html, limits ?? RichHtmlLimits.Description);

    private static string Cells(int count, string cell = "<td>x</td>", int perRow = 10)
    {
        var rows = new System.Text.StringBuilder("<table>");
        for (var i = 0; i < count; i++)
        {
            if (i % perRow == 0)
                rows.Append("<tr>");
            rows.Append(cell);
            if (i % perRow == perRow - 1 || i == count - 1)
                rows.Append("</tr>");
        }

        return rows.Append("</table>").ToString();
    }

    [Fact]
    public void A_well_formed_table_with_merged_cells_and_scopes_is_kept_as_is()
    {
        const string table = "<table><thead><tr><th scope=\"col\">Name</th><th scope=\"col\">Qty</th></tr></thead><tbody><tr><th scope=\"row\">A</th><td colspan=\"2\">1</td></tr><tr><td rowspan=\"2\">x</td><td>y</td></tr></tbody><tfoot><tr><td>sum</td></tr></tfoot></table>";
        Clean(table).ShouldBe(table);
    }

    [Fact]
    public void Caption_and_column_groups_are_kept_without_attributes()
    {
        Clean("<table><caption>Totals</caption><colgroup><col span=\"2\" width=\"10\"><col></colgroup><tr><td>1</td></tr></table>")
            .ShouldBe("<table><caption>Totals</caption><colgroup><col><col></colgroup><tbody><tr><td>1</td></tr></tbody></table>");
    }

    [Fact]
    public void The_implied_table_body_is_added_and_layout_whitespace_between_table_parts_is_dropped()
    {
        Clean("<table>\n  <tr>\n    <td>a</td>\n    <td>b</td>\n  </tr>\n</table>")
            .ShouldBe("<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>");
    }

    [Fact]
    public void Text_inside_a_cell_keeps_its_spaces()
    {
        Clean("<table><tr><td>one two  <b>three</b> four</td></tr></table>").ShouldContain("<td>one two  <b>three</b> four</td>");
    }

    [Fact]
    public void Outlook_paste_is_cleaned_down_to_the_table()
    {
        const string outlook = """
            <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
            <head><meta charset="utf-8"><style><!-- p.MsoNormal {margin:0in} td {mso-height-source:auto;} --></style>
            <!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--></head>
            <body lang=EN-US link="#0563C1" style='tab-interval:.5in'>
            <!--StartFragment-->
            <table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 width=400 style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;mso-yfti-tbllook:1184'>
            <tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>
              <td width=200 valign=top style='width:150.0pt;border:solid windowtext 1.0pt;padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal><b><span style='mso-bidi-font-weight:normal'>Custodian<o:p></o:p></span></b></p></td>
              <td width=200 colspan=2 valign=top style='border:solid windowtext 1.0pt'><p class=MsoNormal><span style='font-size:11.0pt'>Size</span><span></span><o:p></o:p></p></td>
            </tr>
            <tr><td><![if !supportLists]><![endif]><font face="Calibri" size="3">Smith, J</font></td><td>12 GB</td><td>&nbsp;</td></tr>
            </table>
            <!--EndFragment-->
            </body></html>
            """;
        var clean = Clean(outlook);
        clean.ShouldBe("<table><tbody><tr><td><p><b>Custodian</b></p></td><td colspan=\"2\"><p>Size</p></td></tr><tr><td>Smith, J</td><td>12 GB</td><td>&nbsp;</td></tr></tbody></table>");
        RichHtml.ToPlainText(clean).ShouldBe("Custodian | Size\nSmith, J | 12 GB |");
    }

    [Theory]
    [InlineData("2", " colspan=\"2\"")]
    [InlineData(" 3 ", " colspan=\"3\"")]
    [InlineData("02", " colspan=\"2\"")]
    [InlineData("100", " colspan=\"100\"")]
    [InlineData("1", "")]
    [InlineData("0", "")]
    [InlineData("101", "")]
    [InlineData("1000", "")]
    [InlineData("-1", "")]
    [InlineData("+2", "")]
    [InlineData("2.5", "")]
    [InlineData("1e2", "")]
    [InlineData("0x10", "")]
    [InlineData("", "")]
    [InlineData("two", "")]
    [InlineData("2 onmouseover=alert(1)", "")]
    [InlineData("٣", "")]
    [InlineData("99999999999999999999", "")]
    [InlineData("2;3", "")]
    public void Colspan_is_kept_only_as_a_plain_integer_from_2_to_100(string value, string expectedAttribute)
    {
        Clean($"<table><tr><td colspan=\"{value}\">x</td></tr></table>").ShouldBe($"<table><tbody><tr><td{expectedAttribute}>x</td></tr></tbody></table>");
        Clean($"<table><tr><th rowspan=\"{value}\">x</th></tr></table>").ShouldBe($"<table><tbody><tr><th{expectedAttribute.Replace("colspan", "rowspan", StringComparison.Ordinal)}>x</th></tr></tbody></table>");
    }

    [Theory]
    [InlineData("row", " scope=\"row\"")]
    [InlineData("COL", " scope=\"col\"")]
    [InlineData(" rowgroup ", " scope=\"rowgroup\"")]
    [InlineData("colgroup", " scope=\"colgroup\"")]
    [InlineData("javascript:alert(1)", "")]
    [InlineData("banana", "")]
    [InlineData("", "")]
    public void Scope_is_kept_on_header_cells_only_with_a_known_value(string value, string expectedAttribute)
    {
        Clean($"<table><tr><th scope=\"{value}\">x</th></tr></table>").ShouldBe($"<table><tbody><tr><th{expectedAttribute}>x</th></tr></tbody></table>");
        Clean($"<table><tr><td scope=\"{value}\">x</td></tr></table>").ShouldBe("<table><tbody><tr><td>x</td></tr></tbody></table>");
    }

    [Fact]
    public void Table_attributes_of_every_kind_are_removed()
    {
        Clean("<table style=\"width:1px\" class=\"a\" id=\"b\" width=\"100\" border=\"1\" bgcolor=\"red\" align=\"right\" background=\"javascript:1\" onclick=\"x()\" data-x=\"1\"><tr onclick=\"x()\" style=\"x\"><td width=\"5\" height=\"5\" valign=\"top\" nowrap bgcolor=\"red\" headers=\"h\" abbr=\"a\" onmouseover=\"x()\" style=\"x\" class=\"y\">x</td></tr></table>")
            .ShouldBe("<table><tbody><tr><td>x</td></tr></tbody></table>");
    }

    [Fact]
    public void Span_and_scope_do_not_survive_on_other_elements_and_href_only_on_links()
    {
        Clean("<p colspan=\"2\" rowspan=\"2\" scope=\"row\">x</p>").ShouldBe("<p>x</p>");
        Clean("<b href=\"https://example.com\" colspan=\"2\">x</b>").ShouldBe("<b>x</b>");
        Clean("<table><tr><td><a href=\"https://example.com\" colspan=\"2\" scope=\"row\">x</a></td></tr></table>")
            .ShouldBe("<table><tbody><tr><td><a href=\"https://example.com\" rel=\"noopener noreferrer\">x</a></td></tr></tbody></table>");
    }

    [Fact]
    public void Links_with_markup_characters_in_the_address_are_not_kept_as_links()
    {
        Clean("<a href=\"mailto:a@b.example?subject=<script>\">x</a>").ShouldBe("<a>x</a>");
        Clean("<a href=\"https://example.com/`x\">x</a>").ShouldBe("<a>x</a>");
    }

    [Fact]
    public void Markup_that_is_not_allowed_inside_a_table_is_removed_around_the_text()
    {
        Clean("<table><tr><td><span style=\"color:red\">a</span><img src=x onerror=alert(1)><script>alert(1)</script>b<svg><style>x</style></svg></td></tr></table>")
            .ShouldBe("<table><tbody><tr><td>ab</td></tr></tbody></table>");
    }

    [Fact]
    public void Content_that_the_parser_moves_out_of_a_table_stays_text()
    {
        // Text and elements that are not allowed between rows are "foster parented" before the table by every browser parser.
        Clean("<table>before<tr><td>x</td></tr></table>").ShouldBe("before<table><tbody><tr><td>x</td></tr></tbody></table>");
        Clean("<table><script>alert(1)</script><tr><td>x</td></tr></table>").ShouldBe("<table><tbody><tr><td>x</td></tr></tbody></table>");
    }

    [Fact]
    public void Block_markup_inside_cells_becomes_paragraphs_and_lists_stay_lists()
    {
        Clean("<table><tr><td><div>one</div><div>two</div><ul><li>a</li></ul><h2>h</h2></td></tr></table>")
            .ShouldBe("<table><tbody><tr><td><p>one</p><p>two</p><ul><li>a</li></ul><p>h</p></td></tr></tbody></table>");
    }

    [Fact]
    public void Nested_tables_are_kept_to_depth_three_and_deeper_ones_are_flattened_to_paragraphs()
    {
        const string deep = "<table><tr><td>L1<table><tr><td>L2<table><tr><td>L3<table><tr><td>L4<table><tr><td>L5</td></tr></table></td></tr></table></td></tr></table></td></tr></table></td></tr></table>";
        var clean = Clean(deep);
        System.Text.RegularExpressions.Regex.Matches(clean, "<table>").Count.ShouldBe(3);
        clean.ShouldContain("L3");
        clean.ShouldContain("L4");
        clean.ShouldContain("<p>L5</p>");
        clean.ShouldNotContain("L3L4");
        Clean(clean).ShouldBe(clean);
    }

    [Fact]
    public void Three_nested_tables_are_kept()
    {
        const string three = "<table><tbody><tr><td><table><tbody><tr><td><table><tbody><tr><td>x</td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody></table>";
        Clean(three).ShouldBe(three);
    }

    [Fact]
    public void Exactly_200_cells_are_accepted_and_201_are_refused()
    {
        RichHtml.TrySanitize(Cells(200), RichHtmlLimits.Description, out var clean).ShouldBe(RichHtmlProblem.None);
        RichHtml.CountTableCells(clean).ShouldBe(200);
        RichHtml.TrySanitize(Cells(201), RichHtmlLimits.Description, out _).ShouldBe(RichHtmlProblem.TooManyCells);
        RichHtml.TrySanitize(Cells(201), RichHtmlLimits.Comment, out _).ShouldBe(RichHtmlProblem.TooManyCells);
    }

    [Fact]
    public void Cells_of_nested_tables_and_of_several_tables_count_together()
    {
        var two = Cells(120) + Cells(81);
        RichHtml.TrySanitize(two, RichHtmlLimits.Description, out _).ShouldBe(RichHtmlProblem.TooManyCells);
        var nested = "<table><tr><td>" + Cells(150) + "</td><td>" + Cells(50) + "</td></tr></table>";
        RichHtml.TrySanitize(nested, RichHtmlLimits.Description, out _).ShouldBe(RichHtmlProblem.TooManyCells);
    }

    [Fact]
    public void A_flood_of_cells_is_refused_before_any_parsing()
    {
        var flood = Cells(5000, "<td></td>");
        var watch = Stopwatch.StartNew();
        RichHtml.TrySanitize(flood, RichHtmlLimits.Description, out _).ShouldBe(RichHtmlProblem.TooManyCells);
        watch.ElapsedMilliseconds.ShouldBeLessThan(200);
    }

    [Fact]
    public void Output_and_input_size_limits_are_enforced()
    {
        var big = "<p>" + new string('x', 100_001) + "</p>";
        RichHtml.TrySanitize(big, RichHtmlLimits.Description, out _).ShouldBe(RichHtmlProblem.TooLarge);
        RichHtml.TrySanitize("<p>" + new string('x', 99_000) + "</p>", RichHtmlLimits.Description, out var fine).ShouldBe(RichHtmlProblem.None);
        fine.Length.ShouldBeGreaterThan(99_000);
        RichHtml.TrySanitize(new string('x', 300_001), RichHtmlLimits.Description, out _).ShouldBe(RichHtmlProblem.TooLarge);
        RichHtml.TrySanitize("<p>" + new string('x', 20_001) + "</p>", RichHtmlLimits.Comment, out _).ShouldBe(RichHtmlProblem.TooLarge);
    }

    [Fact]
    public void Deep_nesting_and_tag_floods_are_refused_not_parsed()
    {
        RichHtml.TrySanitize(string.Concat(Enumerable.Repeat("<div>", 25)), RichHtmlLimits.Description, out _).ShouldBe(RichHtmlProblem.TooComplex);
        RichHtml.TrySanitize(string.Concat(Enumerable.Repeat("<table><tr><td>", 25)), RichHtmlLimits.Description, out _).ShouldBe(RichHtmlProblem.TooComplex);
        RichHtml.TrySanitize(string.Concat(Enumerable.Repeat("<b></b>", 6000)), RichHtmlLimits.Description, out _).ShouldBe(RichHtmlProblem.TooComplex);
    }

    [Fact]
    public void A_realistic_two_hundred_cell_paste_is_fast_enough()
    {
        var html = Cells(200, "<td><p class=\"MsoNormal\"><span style=\"font-size:11pt\">value <b>1</b></span></p></td>");
        RichHtml.Sanitize(html, RichHtmlLimits.Description);
        var watch = Stopwatch.StartNew();
        var clean = RichHtml.Sanitize(html, RichHtmlLimits.Description);
        watch.ElapsedMilliseconds.ShouldBeLessThan(5000);
        RichHtml.CountTableCells(clean).ShouldBe(200);
    }

    [Fact]
    public void The_worst_case_inside_the_description_caps_stays_within_a_few_seconds()
    {
        // 20-deep div stacks repeated up to the tag cap: the costliest accepted shape.
        var block = string.Concat(Enumerable.Repeat("<div>a", 20)) + string.Concat(Enumerable.Repeat("</div>", 20));
        var payload = string.Concat(Enumerable.Repeat(block, 120));
        RichHtmlGuard.Check(payload, RichHtmlLimits.Description).ShouldBe(RichHtmlProblem.None);
        var watch = Stopwatch.StartNew();
        RichHtml.TrySanitize(payload, RichHtmlLimits.Description, out _);
        watch.ElapsedMilliseconds.ShouldBeLessThan(15000);
    }

    [Fact]
    public void Plain_text_rendering_puts_rows_on_lines_and_separates_cells()
    {
        var html = "<p>Intro</p><table><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Disk</td><td>2</td></tr></tbody></table><ul><li>a</li><li>b</li></ul>";
        RichHtml.ToPlainText(html).ShouldBe("Intro\nName | Qty\nDisk | 2\na\nb");
        RichHtml.ToPlainText("<p>a &amp; b &lt;c&gt;</p>").ShouldBe("a & b <c>");
        RichHtml.ToPlainText(null).ShouldBe(string.Empty);
    }

    [Fact]
    public void RichText_is_the_plain_text_entry_point_for_snippets_audit_and_exports()
    {
        RichText.ToPlainText("<p>Intro</p><table><tr><th>A</th><th>B</th></tr></table>").ShouldBe("Intro\nA | B");
        RichText.ToHtml("a\nb").ShouldBe("<p>a<br>b</p>");
        RichText.ToPlainText(null).ShouldBe(string.Empty);
    }

    [Fact]
    public void Direction_overrides_are_removed_from_text_but_isolates_and_marks_stay()
    {
        Clean("<p>a\u202Eb\u202Dc\u202Ad\u202Be\u202Cf</p>").ShouldBe("<p>abcdef</p>");
        Clean("<table><tr><td>\u202E12\u202C</td></tr></table>").ShouldBe("<table><tbody><tr><td>12</td></tr></tbody></table>");
        Clean("<p>\u2067\u05D0\u2069 \u200F</p>").ShouldBe("<p>\u2067\u05D0\u2069 \u200F</p>");
    }

    [Theory]
    [InlineData("Plain note", false)]
    [InlineData("From John <john@example.com> about a < b and c > d", false)]
    [InlineData("<p>x</p>", true)]
    [InlineData("a<br>b", true)]
    [InlineData("<TABLE><tr>", true)]
    [InlineData("<script>alert(1)</script>", true)]
    [InlineData("<!-- c -->", true)]
    [InlineData("1 < 2", false)]
    public void Text_is_told_apart_from_html(string text, bool expected) => RichHtml.LooksLikeHtml(text).ShouldBe(expected);

    [Theory]
    [InlineData("one line", "<p>one line</p>")]
    [InlineData("a\nb", "<p>a<br>b</p>")]
    [InlineData("a\r\n\r\nb", "<p>a</p><p>b</p>")]
    [InlineData("1 < 2 & <script>alert(1)</script>", "<p>1 &lt; 2 &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p>")]
    [InlineData("  \n  ", "")]
    public void Plain_text_becomes_escaped_paragraphs(string text, string expected)
    {
        var html = RichHtml.FromPlainText(text);
        html.ShouldBe(expected);
        if (html.Length > 0)
            RichHtml.Sanitize(html, RichHtmlLimits.Description).ShouldBe(html);
    }
}
