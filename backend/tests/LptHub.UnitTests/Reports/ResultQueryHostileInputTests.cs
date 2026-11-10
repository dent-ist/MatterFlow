using MatterFlow.Reports.Application;
using MatterFlow.Reports.Application.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>
/// Hostile sort, filter and column names for the rows and the export endpoints (issue #725, spec 16.3 a): both run in memory over the cached result, so the
/// only possible outcomes are a page, or a <see cref="ResultQueryException"/> that becomes a 400. Nothing else may escape (no 500), and no text typed by the caller
/// may influence which rows another filter returns.
/// </summary>
[Trait("Suite", "ReportsSecurity")]
public class ResultQueryHostileInputTests
{
    private static ResultTable Sample()
    {
        var builder = new ResultTableBuilder(50, long.MaxValue);
        builder.Begin([new("Name", ReportColumnType.Text), new("Qty, total", ReportColumnType.Integer), new("Due", ReportColumnType.Date), new("#2", ReportColumnType.Text)]);
        builder.TryAdd(["x:y", 1L, new DateTime(2026, 10, 1), "a"]);
        builder.TryAdd(["x", 2L, new DateTime(2026, 10, 2), "b"]);
        builder.TryAdd([":y", 3L, null, "c"]);
        builder.TryAdd(["x:", 4L, new DateTime(2026, 10, 4), "d"]);
        builder.TryAdd(["y", 5L, new DateTime(2026, 10, 5), "e"]);
        return builder.Build();
    }

    // ---- sort, including the position form #n ----

    [Theory]
    [InlineData("#-1:asc")]
    [InlineData("#1.5:asc")]
    [InlineData("# 1:asc")]
    [InlineData("#1e2:asc")]
    [InlineData("#99999999999999999999:asc")]
    [InlineData("#4:asc")]
    [InlineData("#٣:asc")] // an Arabic-Indic digit is not a position
    [InlineData("#:asc")]
    [InlineData("##1:asc")]
    [InlineData("#1:desc:asc")]
    [InlineData("#1:ascending")]
    [InlineData("#1:")]
    [InlineData("#1:ASC;")]
    [InlineData("Name:asc; DROP TABLE dbo.Pod")]
    [InlineData("Name' OR '1'='1:asc")]
    [InlineData("[Name]:asc")]
    [InlineData("\"Name\":asc")]
    [InlineData("Name--:asc")]
    [InlineData("Name/*x*/:asc")]
    [InlineData("Namе:asc")] // Cyrillic e
    [InlineData("Name,Due,Qty,Name2:asc")]
    [InlineData("#0,#1,#2,#3:asc")]
    public void A_hostile_sort_is_a_400_never_a_page_or_an_unhandled_error(string sort)
    {
        var t = Sample();

        var ex = Should.Throw<ResultQueryException>(() => ResultQuery.ParseSort(sort, t));

        ex.Message.Length.ShouldBeLessThan(200);
    }

    [Theory]
    [InlineData("#0:asc", 0)]
    [InlineData("#00:asc", 0)]
    [InlineData("#003:asc", 3)]
    [InlineData("#1:DESC", 1)]
    [InlineData("  #2:asc ", 2)]
    public void The_position_form_takes_leading_zeros_outer_spaces_and_any_case_and_means_that_column(string sort, int index)
    {
        var t = Sample();

        var sorts = ResultQuery.ParseSort(sort, t);

        t.Resolve(sorts.ShouldHaveSingleItem().Column).ShouldBe(index); // the key finds that very column (a name that looks like a position is stored as the position)
    }

    [Fact]
    public void A_column_literally_named_hash_two_is_only_reachable_by_its_position_because_hash_and_digits_always_mean_a_position()
    {
        var t = Sample();

        ResultQuery.ParseSort("#2:asc", t).ShouldHaveSingleItem().Column.ShouldBe("Due"); // the third column, not the one named "#2"
        ResultQuery.ParseSort("#3:asc", t).ShouldHaveSingleItem().Column.ShouldBe("#3"); // the column named "#2" is kept as a position, never as a name that would read as one
    }

    [Fact]
    public void A_long_hostile_name_is_not_echoed_whole()
    {
        var t = Sample();

        var ex = Should.Throw<ResultQueryException>(() => ResultQuery.ParseSort(new string('A', 20_000) + ":asc", t));
        var filter = Should.Throw<ResultQueryException>(() => ResultQuery.Order(t, ResultQuery.ParseFilters("[{\"column\":\"" + new string('B', 20_000) + "\",\"op\":\"contains\",\"value\":\"x\"}]"), []));

        ex.Message.Length.ShouldBeLessThan(120);
        filter.Message.Length.ShouldBeLessThan(120);
    }

    // ---- filters: shape attacks ----

    [Theory]
    [InlineData("[null]")]
    [InlineData("[{}]")]
    [InlineData("[{\"op\":\"contains\",\"value\":\"x\"}]")]
    [InlineData("[{\"column\":null,\"op\":\"contains\",\"value\":\"x\"}]")]
    [InlineData("[{\"column\":\"Name\"}]")]
    [InlineData("[{\"column\":\"Name\",\"op\":null,\"value\":\"x\"}]")]
    [InlineData("[{\"column\":\"Name\",\"op\":\"contains\",\"value\":null}]")] // a null operand is the empty text: matches every non-null cell
    [InlineData("[1]")]
    [InlineData("[\"x\"]")]
    [InlineData("{\"column\":\"Name\",\"op\":\"contains\",\"value\":\"x\"}")]
    [InlineData("\"text\"")]
    [InlineData("42")]
    [InlineData("[{\"column\":\"Name\",\"op\":\"contains\",\"value\":\"x\"},")]
    [InlineData("[{\"column\":\"Name\",\"op\":\"contains\",\"value\":{\"a\":1}}]")]
    [InlineData("[{\"column\":[\"Name\"],\"op\":\"contains\",\"value\":\"x\"}]")]
    [InlineData("[{\"column\":\"Name\",\"op\":\"contains\",\"value\":\"x\",\"extra\":\"; DROP TABLE x\"}]")]
    public void A_malformed_filter_is_a_refusal_or_a_result_but_never_an_unhandled_exception(string json)
    {
        var t = Sample();

        try
        {
            var filters = ResultQuery.ParseFilters(json);
            _ = ResultQuery.Order(t, filters, []);
        }
        catch (ResultQueryException)
        {
            // the endpoint answers 400 RESULT_QUERY_INVALID
        }
    }

    [Theory]
    [InlineData("Name; DROP TABLE x")]
    [InlineData("Name' OR '1'='1")]
    [InlineData("[Name]")]
    [InlineData("Name\0")]
    [InlineData("")]
    [InlineData("#99")] // a position past the last column (a filter takes #n like a sort, issue #1291)
    public void A_filter_on_a_column_that_is_not_in_the_result_is_refused(string column)
    {
        var t = Sample();
        var json = System.Text.Json.JsonSerializer.Serialize(new[] { new { column, op = "contains", value = "x" } });

        Should.Throw<ResultQueryException>(() => ResultQuery.Order(t, ResultQuery.ParseFilters(json), []));
    }

    [Fact]
    public void Operators_are_matched_exactly_not_as_patterns_or_prefixes()
    {
        var t = Sample();

        foreach (var op in new[] { "contains; --", "containsX", "con%", ".*", "equals' OR '1'='1", "eq\0", "$ne", "LIKE", "regex", "in" })
        {
            var json = System.Text.Json.JsonSerializer.Serialize(new[] { new { column = "Name", op, value = "x" } });

            Should.Throw<ResultQueryException>(() => ResultQuery.Order(t, ResultQuery.ParseFilters(json), []), op);
        }
    }

    // ---- the cache of the last order must never serve one filter's rows for another ----

    private static string F(params (string Column, string Op, string? Value, string? Value2)[] filters) =>
        System.Text.Json.JsonSerializer.Serialize(filters.Select(f => new { column = f.Column, op = f.Op, value = f.Value, value2 = f.Value2 }));

    private static string[] Names(ResultTable t, int[] order) => order.Select(r => t.Get(r, 0)?.ToString() ?? "<null>").ToArray();

    [Fact]
    public void Two_filters_that_differ_only_in_where_a_colon_sits_between_the_values_do_not_share_a_cached_order()
    {
        var t = Sample();
        // "contains" ignores value2, so these are two different questions: rows containing "x:" and rows containing "x".
        var first = ResultQuery.Order(t, ResultQuery.ParseFilters(F(("Name", "contains", "x:", "y"))), []);
        var second = ResultQuery.Order(t, ResultQuery.ParseFilters(F(("Name", "contains", "x", ":y"))), []);

        Names(t, first).ShouldBe(["x:y", "x:"]);
        Names(t, second).ShouldBe(["x:y", "x", "x:"]);
    }

    [Fact]
    public void A_single_filter_whose_text_imitates_the_key_of_two_filters_does_not_get_their_cached_order()
    {
        var t = Sample();
        var two = ResultQuery.Order(t, ResultQuery.ParseFilters(F(("Name", "contains", "x", null), ("Name", "contains", "y", null))), []); // x AND y
        var imitation = ResultQuery.Order(t, ResultQuery.ParseFilters(F(("Name", "contains", "x:|NAME:contains:y", null))), []); // one odd value

        Names(t, two).ShouldBe(["x:y"]);
        imitation.ShouldBeEmpty();
    }
}
