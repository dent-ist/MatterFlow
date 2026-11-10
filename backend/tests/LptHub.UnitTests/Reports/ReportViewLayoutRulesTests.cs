using MatterFlow.Reports.Application;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>What a saved view may hold before it is stored (issue #722): name, sizes, operators, page sizes, unknown columns.</summary>
public class ReportViewLayoutRulesTests
{
    private static ReportViewLayout Layout(
        ViewColumnLayout[]? columns = null,
        ViewSortLayout[]? sort = null,
        ViewFilterLayout[]? filters = null,
        int? pageSize = 50) => new(columns ?? [], sort ?? [], filters ?? [], pageSize);

    [Theory]
    [InlineData("  My view  ", "My view")]
    [InlineData("Ünïcode 日本", "Ünïcode 日本")]
    public void A_name_is_trimmed(string input, string expected)
    {
        var (name, error) = ReportViewLayoutRules.CheckName(input);

        error.ShouldBeNull();
        name.ShouldBe(expected);
    }

    [Theory]
    [InlineData(null, "NAME_REQUIRED")]
    [InlineData("", "NAME_REQUIRED")]
    [InlineData("   ", "NAME_REQUIRED")]
    [InlineData("bad\nname", "NAME_INVALID")]
    public void A_bad_name_gives_a_stable_code(string? input, string code)
    {
        ReportViewLayoutRules.CheckName(input).Error!.Code.ShouldBe(code);
    }

    [Fact]
    public void A_name_of_eighty_characters_is_fine_and_eighty_one_is_not()
    {
        ReportViewLayoutRules.CheckName(new string('a', 80)).Error.ShouldBeNull();
        var error = ReportViewLayoutRules.CheckName(new string('a', 81)).Error!;
        error.Code.ShouldBe("NAME_TOO_LONG");
        error.Message.ShouldBe("View name must be 80 characters or fewer.");
    }

    [Fact]
    public void A_good_layout_is_kept_as_it_is_without_a_live_result()
    {
        var layout = Layout(
            [new("Total, USD", false, 120), new("Name", true, null)],
            [new("Total, USD", true)],
            [new("Name", "contains", "x", null)],
            100);

        var (clean, ignored, error) = ReportViewLayoutRules.Sanitize(layout, null);

        error.ShouldBeNull();
        ignored.ShouldBeEmpty();
        clean!.Columns.ShouldBe(layout.Columns);
        clean.Sort.ShouldBe(layout.Sort);
        clean.Filters.ShouldBe(layout.Filters);
        clean.PageSize.ShouldBe(100);
    }

    [Fact]
    public void Columns_the_live_result_does_not_have_are_dropped_everywhere_and_listed_and_names_take_the_casing_of_the_result()
    {
        var layout = Layout(
            [new("name", false, null), new("Gone", false, null), new("Gone", true, null)],
            [new("GONE", false), new("TOTAL", true)],
            [new("Gone", "eq", "1", null), new("Name", "contains", "a", null)]);

        var (clean, ignored, error) = ReportViewLayoutRules.Sanitize(layout, ["Name", "Total"]);

        error.ShouldBeNull();
        ignored.ShouldBe(["Gone"]); // listed once, whatever the casing
        clean!.Columns!.Select(c => c.Name).ShouldBe(["Name"]);
        clean.Sort!.ShouldBe([new ViewSortLayout("Total", true)]);
        clean.Filters!.ShouldBe([new ViewFilterLayout("Name", "contains", "a", null)]);
    }

    [Fact]
    public void A_repeated_column_or_sort_key_is_kept_once()
    {
        var (clean, _, _) = ReportViewLayoutRules.Sanitize(Layout([new("A", false, null), new("a", true, null)], [new("A", false), new("a", true)]), null);

        clean!.Columns!.Count.ShouldBe(1);
        clean.Sort!.Count.ShouldBe(1);
    }

    [Theory]
    [InlineData(79, false)]
    [InlineData(80, true)]
    [InlineData(640, true)]
    [InlineData(641, false)]
    public void A_width_must_be_between_80_and_640(int width, bool ok)
    {
        var (_, _, error) = ReportViewLayoutRules.Sanitize(Layout([new("A", false, width)]), null);

        (error is null).ShouldBe(ok);
        if (!ok)
            error!.Code.ShouldBe("WIDTH_INVALID");
    }

    [Theory]
    [InlineData(25, true)]
    [InlineData(250, true)]
    [InlineData(10, false)]
    [InlineData(1000, false)]
    public void The_page_size_must_be_one_the_pager_offers(int size, bool ok)
    {
        var (_, _, error) = ReportViewLayoutRules.Sanitize(Layout(pageSize: size), null);

        (error is null).ShouldBe(ok);
    }

    [Fact]
    public void No_page_size_is_fine()
    {
        ReportViewLayoutRules.Sanitize(Layout(pageSize: null), null).Error.ShouldBeNull();
    }

    [Fact]
    public void More_than_three_sort_keys_or_twenty_filters_are_refused()
    {
        ReportViewLayoutRules.Sanitize(Layout(sort: Enumerable.Range(0, 4).Select(i => new ViewSortLayout("C" + i, false)).ToArray()), null).Error!.Code.ShouldBe("SORT_TOO_MANY");
        ReportViewLayoutRules.Sanitize(Layout(filters: Enumerable.Range(0, 21).Select(i => new ViewFilterLayout("C" + i, "eq", "1", null)).ToArray()), null).Error!.Code.ShouldBe("FILTERS_TOO_MANY");
        ReportViewLayoutRules.Sanitize(Layout(sort: Enumerable.Range(0, 3).Select(i => new ViewSortLayout("C" + i, false)).ToArray(), filters: Enumerable.Range(0, 20).Select(i => new ViewFilterLayout("C" + i, "eq", "1", null)).ToArray()), null).Error.ShouldBeNull();
    }

    [Theory]
    [InlineData("drop table")]
    [InlineData("")]
    [InlineData("='x'")]
    public void An_unknown_filter_operator_is_refused(string op)
    {
        ReportViewLayoutRules.Sanitize(Layout(filters: [new("A", op, "1", null)]), null).Error!.Code.ShouldBe("FILTER_INVALID");
    }

    [Fact]
    public void A_filter_value_over_500_characters_is_refused()
    {
        ReportViewLayoutRules.Sanitize(Layout(filters: [new("A", "contains", new string('x', 501), null)]), null).Error!.Code.ShouldBe("FILTER_VALUE_TOO_LONG");
    }

    [Fact]
    public void A_column_name_with_control_characters_or_no_text_is_refused()
    {
        ReportViewLayoutRules.Sanitize(Layout([new("a\u0000b", false, null)]), null).Error!.Code.ShouldBe("COLUMN_INVALID");
        ReportViewLayoutRules.Sanitize(Layout([new(" ", false, null)]), null).Error!.Code.ShouldBe("COLUMN_INVALID");
    }

    [Fact]
    public void A_layout_over_the_size_cap_is_refused()
    {
        var columns = Enumerable.Range(0, 150).Select(i => new ViewColumnLayout(new string('c', 150) + i, false, null)).ToArray();

        ReportViewLayoutRules.Sanitize(Layout(columns), null).Error!.Code.ShouldBe("LAYOUT_TOO_LARGE");
    }

    [Fact]
    public void No_layout_is_refused()
    {
        ReportViewLayoutRules.Sanitize(null, null).Error!.Code.ShouldBe("LAYOUT_REQUIRED");
    }

    [Fact]
    public void Hostile_text_in_names_and_values_is_kept_as_plain_data()
    {
        // The layout never reaches SQL; it is stored as JSON text and returned to the page, which renders it as text.
        var layout = Layout([new("'; DROP TABLE x; --", false, null)], filters: [new("'; DROP TABLE x; --", "contains", "<script>alert(1)</script>", null)]);

        var (clean, _, error) = ReportViewLayoutRules.Sanitize(layout, null);

        error.ShouldBeNull();
        clean!.Filters![0].Value.ShouldBe("<script>alert(1)</script>");
    }
}
