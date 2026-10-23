using MatterFlow.Reports.Application;
using MatterFlow.Reports.Application.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>Server-side sort, filter and paging per column type: nulls last ascending, text case-insensitive, stable ties (spec 11; issue #705).</summary>
public class ResultQueryTests
{
    private static ResultTable Sample()
    {
        var builder = new ResultTableBuilder(100, long.MaxValue);
        builder.Begin([
            new("Name", ReportColumnType.Text), new("Qty", ReportColumnType.Integer), new("Price", ReportColumnType.Decimal), new("Due", ReportColumnType.Date),
            new("Done", ReportColumnType.Boolean), new("At", ReportColumnType.DateTime)]);
        builder.TryAdd(["beta", 5L, 10.5m, new DateTime(2026, 10, 2), true, new DateTime(2026, 10, 2, 9, 0, 0)]);
        builder.TryAdd(["Alpha", 3L, 2m, new DateTime(2026, 10, 1), false, new DateTime(2026, 10, 1, 23, 59, 0)]);
        builder.TryAdd([null, null, null, null, null, null]);
        builder.TryAdd(["alpha", 3L, 7.25m, new DateTime(2026, 10, 3), true, new DateTime(2026, 10, 3, 0, 0, 0)]);
        builder.TryAdd(["Gamma", 1L, 10.5m, new DateTime(2026, 9, 30), false, new DateTime(2026, 9, 30, 12, 0, 0)]);
        builder.TryAdd(["", 9L, 0m, new DateTime(2026, 10, 2), null, new DateTime(2026, 10, 2, 10, 0, 0)]);
        return builder.Build();
    }

    private static string[] Names(ResultTable t, int[] order) => order.Select(r => t.Get(r, 0)?.ToString() ?? "<null>").ToArray();

    private static int[] Order(ResultTable t, string? sort = null, string? filter = null) => ResultQuery.Order(t, ResultQuery.ParseFilters(filter), ResultQuery.ParseSort(sort, t));

    [Fact]
    public void Text_sorts_case_insensitively_with_nulls_last_ascending_and_first_descending()
    {
        var t = Sample();

        Names(t, Order(t, "Name:asc")).ShouldBe(["", "Alpha", "alpha", "beta", "Gamma", "<null>"]);
        Names(t, Order(t, "Name:desc")).ShouldBe(["<null>", "Gamma", "beta", "Alpha", "alpha", ""]);
    }

    [Fact]
    public void Ties_keep_the_original_row_order_in_both_directions()
    {
        var t = Sample();

        // Alpha (row 1) and alpha (row 3) are equal case-insensitively: a stable sort keeps them in row order whichever way the column sorts.
        Names(t, Order(t, "Name:asc")).Skip(1).Take(2).ShouldBe(["Alpha", "alpha"]);
        Names(t, Order(t, "Name:desc")).Skip(3).Take(2).ShouldBe(["Alpha", "alpha"]);
    }

    [Fact]
    public void Numbers_sort_by_value_not_by_text()
    {
        var t = Sample();

        Order(t, "Qty:asc").Select(r => t.Get(r, 1)).ShouldBe([1L, 3L, 3L, 5L, 9L, null]);
        Order(t, "Qty:desc").Select(r => t.Get(r, 1)).ShouldBe([null, 9L, 5L, 3L, 3L, 1L]);
        Order(t, "Price:asc").Select(r => t.Get(r, 2)).ShouldBe([0m, 2m, 7.25m, 10.5m, 10.5m, null]);
    }

    [Fact]
    public void A_secondary_sort_breaks_ties_of_the_first()
    {
        var t = Sample();

        Names(t, Order(t, "Price:desc,Name:asc")).ShouldBe(["<null>", "beta", "Gamma", "alpha", "Alpha", ""]);
    }

    [Fact]
    public void Dates_and_booleans_sort_by_value()
    {
        var t = Sample();

        Order(t, "Due:asc").Select(r => t.Get(r, 3)).ShouldBe(["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-02", "2026-10-03", null]);
        Order(t, "Done:asc").Select(r => t.Get(r, 4)).ShouldBe([false, false, true, true, null, null]);
    }

    [Theory]
    [InlineData("Nope:asc")]
    [InlineData("Name:sideways")]
    [InlineData("Name:asc,Qty:asc,Price:asc,Due:asc")]
    public void A_bad_sort_is_refused(string sort)
    {
        Should.Throw<ResultQueryException>(() => ResultQuery.ParseSort(sort, Sample()));
    }

    [Fact]
    public void Column_names_in_a_sort_are_case_insensitive_and_a_repeated_column_counts_once()
    {
        var t = Sample();

        ResultQuery.ParseSort("name:desc,NAME:asc", t).ShouldHaveSingleItem().Descending.ShouldBeTrue();
        ResultQuery.ParseSort("Name", t).ShouldHaveSingleItem().Descending.ShouldBeFalse();
    }

    // ---- filters ----

    private static string F(string column, string op, string? value = null, string? value2 = null) =>
        System.Text.Json.JsonSerializer.Serialize(new[] { new { column, op, value, value2 } });

    [Theory]
    [InlineData("contains", "LPH", 2)]
    [InlineData("contains", "a", 4)]
    [InlineData("equals", "ALPHA", 2)]
    [InlineData("startsWith", "be", 1)]
    [InlineData("startsWith", "", 5)]
    public void Text_filters_are_case_insensitive_and_never_match_null(string op, string value, int expected)
    {
        var t = Sample();

        Order(t, filter: F("Name", op, value)).Length.ShouldBe(expected);
    }

    [Theory]
    [InlineData("eq", "3", null, 2)]
    [InlineData("gt", "3", null, 2)]
    [InlineData("lt", "3", null, 1)]
    [InlineData("between", "3", "5", 3)]
    [InlineData("between", "5", "3", 3)]
    public void Number_filters(string op, string value, string? value2, int expected)
    {
        var t = Sample();

        Order(t, filter: F("Qty", op, value, value2)).Length.ShouldBe(expected);
    }

    [Fact]
    public void Decimal_and_date_filters()
    {
        var t = Sample();

        Order(t, filter: F("Price", "eq", "10.5")).Length.ShouldBe(2);
        Order(t, filter: F("Due", "on", "2026-10-02")).Length.ShouldBe(2);
        Order(t, filter: F("Due", "before", "2026-10-02")).Length.ShouldBe(2);
        Order(t, filter: F("Due", "after", "2026-10-02")).Length.ShouldBe(1);
        Order(t, filter: F("Due", "between", "2026-10-01", "2026-10-02")).Length.ShouldBe(3);
        Order(t, filter: F("At", "on", "2026-10-01")).Length.ShouldBe(1); // a date-time matches by its day
        Order(t, filter: F("At", "on", "2026-10-03")).Length.ShouldBe(1);
    }

    [Fact]
    public void Yes_no_and_blank_filters()
    {
        var t = Sample();

        Order(t, filter: F("Done", "eq", "true")).Length.ShouldBe(2);
        Order(t, filter: F("Done", "eq", "no")).Length.ShouldBe(2);
        Order(t, filter: F("Name", "blank")).Length.ShouldBe(2); // null and the empty string
        Order(t, filter: F("Name", "notBlank")).Length.ShouldBe(4);
        Order(t, filter: F("Qty", "blank")).Length.ShouldBe(1);
        Order(t, filter: F("Done", "notBlank")).Length.ShouldBe(4);
    }

    [Fact]
    public void Filters_combine_with_and_and_feed_the_sort_and_the_pager()
    {
        var t = Sample();
        var filters = ResultQuery.ParseFilters("[{\"column\":\"Qty\",\"op\":\"gt\",\"value\":\"2\"},{\"column\":\"Name\",\"op\":\"contains\",\"value\":\"a\"}]");

        var page = ResultQuery.Page(t, filters, ResultQuery.ParseSort("Qty:desc", t), 1, 2);

        page.TotalRows.ShouldBe(6);
        page.FilteredRows.ShouldBe(3);
        page.Rows.Select(r => r[0]).ShouldBe(["beta", "Alpha"]);
        ResultQuery.Page(t, filters, ResultQuery.ParseSort("Qty:desc", t), 2, 2).Rows.Select(r => r[0]).ShouldBe(["alpha"]);
    }

    [Theory]
    [InlineData("[{\"column\":\"Nope\",\"op\":\"eq\",\"value\":\"1\"}]")]
    [InlineData("[{\"column\":\"Qty\",\"op\":\"contains\",\"value\":\"1\"}]")]
    [InlineData("[{\"column\":\"Qty\",\"op\":\"eq\",\"value\":\"abc\"}]")]
    [InlineData("[{\"column\":\"Due\",\"op\":\"on\",\"value\":\"22/10/2026\"}]")]
    [InlineData("[{\"column\":\"Done\",\"op\":\"eq\",\"value\":\"maybe\"}]")]
    [InlineData("[{\"column\":\"Name\",\"op\":\"matches\",\"value\":\".*\"}]")]
    [InlineData("[{\"column\":\"Qty\",\"op\":\"between\",\"value\":\"1\"}]")]
    public void Bad_filters_are_refused_not_ignored(string filter)
    {
        var t = Sample();

        Should.Throw<ResultQueryException>(() => Order(t, filter: filter));
    }

    [Fact]
    public void Unreadable_filter_json_and_too_many_filters_are_refused()
    {
        Should.Throw<ResultQueryException>(() => ResultQuery.ParseFilters("{not json"));
        var many = "[" + string.Join(",", Enumerable.Repeat("{\"column\":\"Qty\",\"op\":\"gt\",\"value\":\"0\"}", 21)) + "]";
        Should.Throw<ResultQueryException>(() => ResultQuery.ParseFilters(many));
    }

    [Fact]
    public void Filter_values_are_data_never_patterns_or_code()
    {
        var t = Sample();

        Order(t, filter: F("Name", "contains", "%")).Length.ShouldBe(0);
        Order(t, filter: F("Name", "contains", ".*")).Length.ShouldBe(0);
        Order(t, filter: F("Name", "contains", "'; DROP TABLE x; --")).Length.ShouldBe(0);
    }

    // ---- paging ----

    [Fact]
    public void Paging_clamps_the_page_and_the_size_and_reports_totals()
    {
        var t = Sample();

        var last = ResultQuery.Page(t, [], [], 99, 4);
        last.Page.ShouldBe(2);
        last.Rows.Count.ShouldBe(2);
        ResultQuery.Page(t, [], [], 0, 4).Page.ShouldBe(1);
        ResultQuery.Page(t, [], [], 1, 100_000).PageSize.ShouldBe(ResultQuery.MaxPageSize);
        ResultQuery.Page(t, [], [], 1, 0).PageSize.ShouldBe(1);
        ResultQuery.Page(t, [new ResultFilter("Name", "equals", "nobody", null)], [], 1, 10).Rows.ShouldBeEmpty();
    }

    [Fact]
    public void Paging_through_a_sorted_result_visits_every_row_once()
    {
        var t = Sample();
        var sort = ResultQuery.ParseSort("Name:asc", t);

        var seen = Enumerable.Range(1, 3).SelectMany(p => ResultQuery.Page(t, [], sort, p, 2).Rows).Select(r => r[0]?.ToString() ?? "<null>").ToList();

        seen.ShouldBe(["", "Alpha", "alpha", "beta", "Gamma", "<null>"]);
    }

    [Fact]
    public void The_last_order_is_cached_per_filter_and_sort_combination()
    {
        var t = Sample();
        var a = ResultQuery.Order(t, [], ResultQuery.ParseSort("Qty:asc", t));
        var b = ResultQuery.Order(t, [], ResultQuery.ParseSort("Qty:asc", t));
        var c = ResultQuery.Order(t, [], ResultQuery.ParseSort("Qty:desc", t));

        ReferenceEquals(a, b).ShouldBeTrue();
        ReferenceEquals(a, c).ShouldBeFalse();
    }
}
