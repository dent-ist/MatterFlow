using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The plain-list export (PM v2, #879): quoting, the formula guard, ISO dates and the two formats.</summary>
public class ListExportTests
{
    [Theory]
    [InlineData("plain", "plain")]
    [InlineData("a,b", "\"a,b\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("two\nlines", "\"two\nlines\"")]
    [InlineData("=1+1", "'=1+1")]
    [InlineData("+49 30", "'+49 30")]
    [InlineData("-5", "'-5")]
    [InlineData("@SUM(A1)", "'@SUM(A1)")]
    [InlineData("=a,b", "\"'=a,b\"")]
    [InlineData("", "")]
    public void A_csv_cell_is_quoted_and_a_formula_start_is_neutralised(string value, string expected) =>
        ListExport.CsvCell(value).ShouldBe(expected);

    [Fact]
    public void A_null_cell_is_empty()
    {
        ListExport.CsvCell(null).ShouldBe(string.Empty);
        ListExport.TextCell(null).ShouldBe(string.Empty);
    }

    [Fact]
    public void Text_cells_stay_on_one_line_and_keep_the_formula_guard()
    {
        ListExport.TextCell("a\tb\r\nc").ShouldBe("a b  c");
        ListExport.TextCell("=cmd").ShouldBe("'=cmd");
    }

    [Fact]
    public void The_document_has_a_header_and_one_line_per_row_in_either_format()
    {
        IReadOnlyList<string?>[] rows = [["TSK-1", "A, B"], ["TSK-2", null]];
        ListExport.Build(ListExport.Csv, ["Task", "Title"], rows).ShouldBe("Task,Title\r\nTSK-1,\"A, B\"\r\nTSK-2,\r\n");
        ListExport.Build(ListExport.Text, ["Task", "Title"], rows).ShouldBe("Task\tTitle\nTSK-1\tA, B\nTSK-2\t\n");
    }

    [Fact]
    public void Dates_are_iso_and_the_format_defaults_to_csv()
    {
        ListExport.Iso(new DateOnly(2026, 10, 26)).ShouldBe("2026-10-26");
        ListExport.Iso((DateOnly?)null).ShouldBe(string.Empty);
        ListExport.Iso(new DateTime(2026, 10, 26, 9, 5, 7, DateTimeKind.Unspecified)).ShouldBe("2026-10-26T09:05:07Z");
        ListExport.FormatOf("TEXT").ShouldBe(ListExport.Text);
        ListExport.FormatOf("xlsx").ShouldBe(ListExport.Csv);
        ListExport.FormatOf(null).ShouldBe(ListExport.Csv);
        ListExport.RowCap.ShouldBe(10_000);
    }
}
