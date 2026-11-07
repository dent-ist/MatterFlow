using System.Text;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Application.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>
/// CSV safety of the export (issue #725, spec 12.3 and 16.3 g) beyond the writer's own tests: the formula corpus as a data file, every prefix, whitespace in
/// front of a formula, quoting and embedded line breaks read back with an RFC 4180 reader, and the export equal to the grid for the same filter and sort.
/// </summary>
[Trait("Suite", "ReportsSecurity")]
public class ReportCsvSecurityTests
{
    private static ResultTable Table(ResultColumn[] columns, params object?[][] rows)
    {
        var builder = new ResultTableBuilder(rows.Length + 1, long.MaxValue);
        builder.Begin(columns);
        foreach (var row in rows)
            builder.TryAdd(row);
        return builder.Build();
    }

    private static async Task<string> WriteAsync(ResultTable table, int[]? order = null, int[]? columns = null)
    {
        using var stream = new MemoryStream();
        await ReportCsvWriter.WriteAsync(stream, table, order ?? Enumerable.Range(0, table.RowCount).ToArray(), columns ?? Enumerable.Range(0, table.Columns.Count).ToArray(), CancellationToken.None);
        var bytes = stream.ToArray();
        bytes[..3].ShouldBe([0xEF, 0xBB, 0xBF]);
        return new UTF8Encoding(false).GetString(bytes, 3, bytes.Length - 3);
    }

    /// <summary>An RFC 4180 reader: a record ends at CRLF outside quotes; quotes inside a quoted cell are doubled.</summary>
    internal static List<List<string>> ParseCsv(string text)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (quoted)
            {
                if (ch == '"' && i + 1 < text.Length && text[i + 1] == '"')
                {
                    cell.Append('"');
                    i++;
                }
                else if (ch == '"')
                {
                    quoted = false;
                }
                else
                {
                    cell.Append(ch);
                }
            }
            else if (ch == '"' && cell.Length == 0)
            {
                quoted = true;
            }
            else if (ch == ',')
            {
                row.Add(cell.ToString());
                cell.Clear();
            }
            else if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n')
            {
                row.Add(cell.ToString());
                cell.Clear();
                rows.Add(row);
                row = [];
                i++;
            }
            else
            {
                cell.Append(ch);
            }
        }

        quoted.ShouldBeFalse("a quote was left open");
        cell.Length.ShouldBe(0, "the last record ends with CRLF");
        row.Count.ShouldBe(0);
        return rows;
    }

    private static ResultColumn TextColumn(string name = "T") => new(name, ReportColumnType.Text);

    // ---- the formula corpus (g) ----

    [Fact]
    public void The_formula_corpus_is_a_data_file_with_every_prefix()
    {
        ReportCorpusFiles.FormulaGuarded.Count.ShouldBeGreaterThanOrEqualTo(25);
        foreach (var prefix in new[] { "=", "+", "-", "@", "\t", "\r" })
            ReportCorpusFiles.FormulaGuarded.ShouldContain(v => v.StartsWith(prefix, StringComparison.Ordinal), $"prefix {Escape(prefix)}");
        ReportCorpusFiles.FormulaSafe.Count.ShouldBeGreaterThanOrEqualTo(10);
    }

    [Fact]
    public async Task Every_text_value_that_starts_like_a_formula_is_written_with_a_leading_apostrophe_and_reads_back_whole()
    {
        var table = Table([TextColumn()], ReportCorpusFiles.FormulaGuarded.Select(v => new object?[] { v }).ToArray());

        var records = ParseCsv(await WriteAsync(table));

        records.Count.ShouldBe(1 + ReportCorpusFiles.FormulaGuarded.Count, "embedded line breaks must not split a record");
        for (var i = 0; i < ReportCorpusFiles.FormulaGuarded.Count; i++)
            records[i + 1].ShouldBe(["'" + ReportCorpusFiles.FormulaGuarded[i]], Escape(ReportCorpusFiles.FormulaGuarded[i]));
    }

    [Fact]
    public async Task Text_that_is_not_a_formula_is_written_unchanged()
    {
        var table = Table([TextColumn()], ReportCorpusFiles.FormulaSafe.Select(v => new object?[] { v }).ToArray());

        var records = ParseCsv(await WriteAsync(table));

        records.Count.ShouldBe(1 + ReportCorpusFiles.FormulaSafe.Count);
        for (var i = 0; i < ReportCorpusFiles.FormulaSafe.Count; i++)
            records[i + 1].ShouldBe([ReportCorpusFiles.FormulaSafe[i]], Escape(ReportCorpusFiles.FormulaSafe[i]));
    }

    [Fact]
    public async Task A_header_that_starts_like_a_formula_is_guarded_for_every_prefix()
    {
        var names = ReportCorpusFiles.FormulaGuarded.Select((v, i) => v + "~" + i).ToArray(); // names must be unique
        var table = Table(names.Select(n => new ResultColumn(n, ReportColumnType.Integer)).ToArray(), names.Select(_ => (object?)1L).ToArray());

        var header = ParseCsv(await WriteAsync(table))[0];

        header.ShouldBe(names.Select(n => "'" + n));
    }

    [Fact]
    public async Task Typed_values_are_never_guarded_so_a_real_negative_number_stays_a_number()
    {
        var table = Table(
            [new("I", ReportColumnType.Integer), new("D", ReportColumnType.Decimal), new("B", ReportColumnType.Boolean), new("Dt", ReportColumnType.Date), new("At", ReportColumnType.DateTime)],
            [-5L, -0.25m, true, new DateTime(2026, 10, 2), new DateTime(2026, 10, 2, 9, 5, 0)],
            [long.MinValue, -1234567.891m, false, null, null]);

        var records = ParseCsv(await WriteAsync(table));

        records[1].ShouldBe(["-5", "-0.25", "Yes", "2026-10-02", "2026-10-02T09:05:00"]);
        records[2][0].ShouldBe(long.MinValue.ToString(System.Globalization.CultureInfo.InvariantCulture));
        records[2][1].ShouldBe("-1234567.891");
        records.SelectMany(r => r.Skip(1)).ShouldNotContain(c => c.StartsWith('\''));
    }

    [Theory]
    [InlineData(" =1+1")]
    [InlineData("   +cmd|' /C calc'!A0")]
    [InlineData(" \t-2+3")]
    [InlineData(" @SUM(1)")]
    [InlineData("\n=1+1")]
    public async Task Whitespace_in_front_of_a_formula_does_not_hide_it_spec_12_3_says_first_non_whitespace_character(string value)
    {
        var records = ParseCsv(await WriteAsync(Table([TextColumn()], [value])));

        records[1].ShouldBe(["'" + value]);
    }

    [Fact]
    public async Task Only_whitespace_or_empty_text_is_never_prefixed()
    {
        var records = ParseCsv(await WriteAsync(Table([TextColumn()], [""], ["   "], [null], [" x"])));

        records.Skip(1).Select(r => r[0]).ShouldBe(["", "   ", "", " x"]);
    }

    // ---- quoting and line breaks ----

    [Fact]
    public async Task Awkward_text_reads_back_exactly_with_the_right_number_of_records()
    {
        string[] values =
        [
            "a,b", "say \"hi\"", "\"", "\"\"", ",", ",,", "line1\nline2", "line1\r\nline2", "cr\ronly", "\n", "trailing space ", " leading space", "tab\tinside", "café 😀",
            "quote\" and, comma\nand newline", "'", "'=1+1", "a\"b\"c",
        ];
        var table = Table([TextColumn("Name, with comma"), new("N", ReportColumnType.Integer)], values.Select((v, i) => new object?[] { v, (long)i }).ToArray());

        var records = ParseCsv(await WriteAsync(table));

        records.Count.ShouldBe(1 + values.Length);
        records[0].ShouldBe(["Name, with comma", "N"]);
        for (var i = 0; i < values.Length; i++)
        {
            records[i + 1].Count.ShouldBe(2, Escape(values[i]));
            records[i + 1][0].ShouldBe(values[i], Escape(values[i]));
            records[i + 1][1].ShouldBe(i.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
    }

    [Fact]
    public async Task A_guarded_cell_that_also_needs_quoting_is_quoted_around_the_apostrophe()
    {
        var csv = await WriteAsync(Table([TextColumn()], ["=A1,B1"], ["=1\n+2"], ["@x\"y"]));

        csv.ShouldBe("T\r\n\"'=A1,B1\"\r\n\"'=1\n+2\"\r\n\"'@x\"\"y\"\r\n");
    }

    // ---- the export equals the grid ----

    [Fact]
    public async Task The_export_is_the_grid_row_for_row_for_the_same_filter_and_sort_including_a_position_sort()
    {
        var rows = Enumerable.Range(0, 600).Select(i => new object?[] { i % 7 == 0 ? null : "name " + (i * 37 % 101), (long)(i * 13 % 50), i % 5 == 0 ? null : (decimal)(i % 17) / 4, i % 3 == 0 ? "=cmd" + i : "x" + i }).ToArray();
        var table = Table([TextColumn("Name"), new("Qty, total", ReportColumnType.Integer), new("Price", ReportColumnType.Decimal), TextColumn("Note")], rows);
        var scenarios = new (string? Sort, string? Filter)[]
        {
            (null, null),
            ("Name:asc", null),
            ("#1:desc,Name:asc", null),
            ("#2:asc", "[{\"column\":\"Name\",\"op\":\"contains\",\"value\":\"name 1\"}]"),
            ("#3:desc,#1:asc", "[{\"column\":\"Qty, total\",\"op\":\"gte\",\"value\":\"10\"},{\"column\":\"Note\",\"op\":\"startsWith\",\"value\":\"=\"}]"),
            (null, "[{\"column\":\"Price\",\"op\":\"blank\"}]"),
        };

        foreach (var (sort, filter) in scenarios)
        {
            var sorts = ResultQuery.ParseSort(sort, table);
            var filters = ResultQuery.ParseFilters(filter);
            var order = ResultQuery.Order(table, filters, sorts);
            var grid = Enumerable.Range(1, Math.Max(1, (order.Length + ResultQuery.MaxPageSize - 1) / ResultQuery.MaxPageSize))
                .SelectMany(p => ResultQuery.Page(table, filters, sorts, p, ResultQuery.MaxPageSize).Rows)
                .ToList();

            var csv = ParseCsv(await WriteAsync(table, order));

            csv.Count.ShouldBe(1 + order.Length, $"{sort} {filter}");
            grid.Count.ShouldBe(order.Length);
            for (var i = 0; i < order.Length; i++)
            {
                var expected = grid[i].Select(c => c switch { null => "", string s => s, decimal d => d.ToString(System.Globalization.CultureInfo.InvariantCulture), _ => Convert.ToString(c, System.Globalization.CultureInfo.InvariantCulture)! }).ToList();
                // The only difference between a grid cell and a file cell is the guard on text.
                var actual = csv[i + 1].Select((c, k) => k is 0 or 3 && c.StartsWith("'=", StringComparison.Ordinal) ? c[1..] : c).ToList();
                actual.ShouldBe(expected, $"{sort} {filter} row {i}");
            }
        }

        // The name form cannot carry a comma, so grid and export both refuse it the same way (the client sends the position).
        Should.Throw<ResultQueryException>(() => ResultQuery.ParseSort("Qty, total:asc", table));
    }

    private static string Escape(string text) => text.Replace("\t", "\\t", StringComparison.Ordinal).Replace("\r", "\\r", StringComparison.Ordinal).Replace("\n", "\\n", StringComparison.Ordinal).Replace(" ", "\\u00a0", StringComparison.Ordinal);
}
