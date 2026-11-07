using System.Diagnostics;
using System.Text;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Application.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>The CSV writer of the export (issue #721): format, quoting, the formula guard, dates, numbers, the byte order mark and a large result.</summary>
public class ReportCsvWriterTests
{
    private static ResultTable Table(ResultColumn[] columns, params object?[][] rows)
    {
        var builder = new ResultTableBuilder(rows.Length + 1, long.MaxValue);
        builder.Begin(columns);
        foreach (var row in rows)
            builder.TryAdd(row);
        return builder.Build();
    }

    private static async Task<byte[]> WriteBytesAsync(ResultTable table, int[]? order = null, int[]? columns = null)
    {
        using var stream = new MemoryStream();
        var written = await ReportCsvWriter.WriteAsync(
            stream,
            table,
            order ?? Enumerable.Range(0, table.RowCount).ToArray(),
            columns ?? Enumerable.Range(0, table.Columns.Count).ToArray(),
            CancellationToken.None);
        written.ShouldBe((order ?? Enumerable.Range(0, table.RowCount).ToArray()).Length);
        return stream.ToArray();
    }

    private static async Task<string> WriteAsync(ResultTable table, int[]? order = null, int[]? columns = null) =>
        new UTF8Encoding(false).GetString((await WriteBytesAsync(table, order, columns))[3..]);

    private static ResultTable Text(params string?[] values) => Table([new("T", ReportColumnType.Text)], values.Select(v => new object?[] { v }).ToArray());

    [Fact]
    public async Task The_file_starts_with_a_utf8_byte_order_mark_and_uses_crlf_after_every_line_including_the_last()
    {
        var bytes = await WriteBytesAsync(Table([new("Id", ReportColumnType.Integer), new("Name", ReportColumnType.Text)], [1L, "a"], [2L, "b"]));

        bytes[..3].ShouldBe([0xEF, 0xBB, 0xBF]);
        Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3).ShouldBe("Id,Name\r\n1,a\r\n2,b\r\n");
    }

    [Fact]
    public async Task A_result_without_rows_is_the_header_only()
    {
        (await WriteAsync(Table([new("A", ReportColumnType.Text), new("B", ReportColumnType.Text)]))).ShouldBe("A,B\r\n");
    }

    [Fact]
    public async Task Cells_with_commas_quotes_and_line_breaks_are_quoted_and_quotes_doubled()
    {
        var csv = await WriteAsync(Text("a,b", "say \"hi\"", "line1\nline2", "cr\rlf", "plain", ""));

        csv.ShouldBe("T\r\n\"a,b\"\r\n\"say \"\"hi\"\"\"\r\n\"line1\nline2\"\r\n\"cr\rlf\"\r\nplain\r\n\r\n");
    }

    [Fact]
    public async Task A_header_with_a_comma_or_quote_is_quoted_too()
    {
        var csv = await WriteAsync(Table([new("Total, USD", ReportColumnType.Integer), new("5\" pipe", ReportColumnType.Integer)], [1L, 2L]));

        csv.ShouldBe("\"Total, USD\",\"5\"\" pipe\"\r\n1,2\r\n");
    }

    [Theory]
    [InlineData("=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0")]
    [InlineData("+1+1", "'+1+1")]
    [InlineData("-2+3", "'-2+3")]
    [InlineData("@SUM(1)", "'@SUM(1)")]
    [InlineData("\tTAB", "'\tTAB")]
    [InlineData("safe = value", "safe = value")]
    [InlineData("a=b", "a=b")]
    public async Task Text_cells_that_start_like_a_formula_get_a_leading_apostrophe(string value, string written)
    {
        (await WriteAsync(Text(value))).ShouldBe($"T\r\n{written}\r\n");
    }

    [Fact]
    public async Task A_text_cell_starting_with_a_carriage_return_is_prefixed_and_then_quoted()
    {
        (await WriteAsync(Text("\rcmd"))).ShouldBe("T\r\n\"'\rcmd\"\r\n");
    }

    [Fact]
    public async Task Headers_that_start_like_a_formula_are_guarded()
    {
        var csv = await WriteAsync(Table([new("=HYPERLINK(\"x\")", ReportColumnType.Text), new("@a", ReportColumnType.Integer), new("-b", ReportColumnType.Integer)], ["x", 1L, 2L]));

        csv.ShouldStartWith("\"'=HYPERLINK(\"\"x\"\")\",'@a,'-b\r\n");
    }

    [Fact]
    public async Task Real_negative_numbers_are_not_touched_but_text_that_looks_like_one_is()
    {
        var csv = await WriteAsync(Table(
            [new("I", ReportColumnType.Integer), new("D", ReportColumnType.Decimal), new("T", ReportColumnType.Text)],
            [-5L, -0.25m, "-5"]));

        csv.ShouldBe("I,D,T\r\n-5,-0.25,'-5\r\n");
    }

    [Fact]
    public async Task Numbers_use_the_invariant_culture_and_keep_their_scale()
    {
        var previous = Thread.CurrentThread.CurrentCulture;
        Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("de-DE");
        try
        {
            var csv = await WriteAsync(Table(
                [new("I", ReportColumnType.Integer), new("D", ReportColumnType.Decimal), new("F", ReportColumnType.Decimal, Floating: true)],
                [1234567L, 1234.50m, 0.1], [0L, 0.00m, 1.5e-7]));

            csv.ShouldBe("I,D,F\r\n1234567,1234.50,0.1\r\n0,0.00,1.5E-07\r\n");
        }
        finally
        {
            Thread.CurrentThread.CurrentCulture = previous;
        }
    }

    [Fact]
    public async Task Dates_are_iso_and_a_wall_clock_date_time_has_no_zone()
    {
        var csv = await WriteAsync(Table(
            [new("D", ReportColumnType.Date), new("T", ReportColumnType.DateTime)],
            [new DateTime(2026, 3, 31), new DateTime(2026, 3, 31, 14, 5, 0)],
            [null, null]));

        csv.ShouldBe("D,T\r\n2026-03-31,2026-03-31T14:05:00\r\n,\r\n");
    }

    [Fact]
    public async Task Booleans_are_yes_and_no_and_nulls_are_empty()
    {
        var csv = await WriteAsync(Table([new("B", ReportColumnType.Boolean), new("N", ReportColumnType.Integer), new("T", ReportColumnType.Text)], [true, null, null], [false, 1L, "x"]));

        csv.ShouldBe("B,N,T\r\nYes,,\r\nNo,1,x\r\n");
    }

    [Fact]
    public async Task Only_the_given_rows_and_columns_are_written_in_the_given_order()
    {
        var table = Table([new("A", ReportColumnType.Integer), new("B", ReportColumnType.Integer), new("C", ReportColumnType.Integer)], [1L, 2L, 3L], [4L, 5L, 6L], [7L, 8L, 9L]);

        (await WriteAsync(table, order: [2, 0], columns: [2, 0])).ShouldBe("C,A\r\n9,7\r\n3,1\r\n");
    }

    [Fact]
    public async Task Non_ascii_text_is_written_as_utf8()
    {
        var bytes = await WriteBytesAsync(Text("Zoë 日本 €"));

        Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3).ShouldBe("T\r\nZoë 日本 €\r\n");
    }

    [Fact]
    public async Task Fifty_thousand_rows_are_written_in_under_three_seconds_in_batches()
    {
        var builder = new ResultTableBuilder(50_001, long.MaxValue);
        builder.Begin([new("Id", ReportColumnType.Integer), new("Name", ReportColumnType.Text), new("Amount", ReportColumnType.Decimal), new("Day", ReportColumnType.Date)]);
        for (var i = 0; i < 50_000; i++)
            builder.TryAdd([(long)i, "Customer, " + i, i / 100m, new DateTime(2020, 1, 1).AddDays(i % 2000)]);
        var table = builder.Build();
        using var stream = new CountingStream();

        var watch = Stopwatch.StartNew();
        var written = await ReportCsvWriter.WriteAsync(stream, table, Enumerable.Range(0, table.RowCount).ToArray(), [0, 1, 2, 3], CancellationToken.None);
        watch.Stop();

        written.ShouldBe(50_000);
        watch.ElapsedMilliseconds.ShouldBeLessThan(3000);
        stream.Writes.ShouldBeGreaterThan(40); // written per batch of 1,000 rows, never as one buffer
        stream.Largest.ShouldBeLessThan(1_000_000);
        stream.Bytes.ShouldBeGreaterThan(1_000_000);
    }

    [Fact]
    public async Task A_cancelled_export_stops()
    {
        var table = Text("a", "b");
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Should.ThrowAsync<OperationCanceledException>(() => ReportCsvWriter.WriteAsync(new MemoryStream(), table, [0, 1], [0], cts.Token));
    }

    [Theory]
    [InlineData("Open Tasks by Matter", "open-tasks-by-matter")]
    [InlineData("../../etc/passwd", "etc-passwd")]
    [InlineData("a\\b:c*d?e\"f<g>h|i", "a-b-c-d-e-f-g-h-i")]
    [InlineData("Café Rénové", "cafe-renove")]
    [InlineData("日本語", "report")]
    [InlineData("", "report")]
    [InlineData("  --  ", "report")]
    public void The_file_name_slug_holds_no_path_characters(string name, string slug)
    {
        ReportExportService.Slug(name).ShouldBe(slug);
    }

    [Fact]
    public void A_long_report_name_gives_a_short_slug()
    {
        var slug = ReportExportService.Slug(new string('a', 200) + " tail");
        slug.Length.ShouldBeLessThanOrEqualTo(ReportExportService.MaxFileNameSlug);
    }

    [Fact]
    public void The_audit_filter_summary_names_columns_and_operators_and_never_the_values()
    {
        var summary = ReportExportService.Summarize(
            [new ResultFilter("Client", "contains", "Secret Corp", null), new ResultFilter("Due", "between", "2026-01-01", "2026-02-01")],
            [new ResultSort("Total", true)]);

        summary.ShouldBe("filter: Client contains; Due between | sort: Total desc");
        summary.ShouldNotContain("Secret");
        ReportExportService.Summarize([], []).ShouldBe("none");
    }

    [Fact]
    public void Columns_are_resolved_in_the_order_given_and_an_unknown_one_is_refused()
    {
        var table = Table([new("A", ReportColumnType.Integer), new("B, C", ReportColumnType.Integer), new("D", ReportColumnType.Integer)]);

        ReportExportService.ResolveColumns(table, ["D", "b, c", "D"]).ShouldBe([2, 1]);
        ReportExportService.ResolveColumns(table, null).ShouldBe([0, 1, 2]);
        ReportExportService.ResolveColumns(table, []).ShouldBe([0, 1, 2]);
        Should.Throw<ResultQueryException>(() => ReportExportService.ResolveColumns(table, ["A", "Nope"]));
    }

    private sealed class CountingStream : Stream
    {
        public int Writes { get; private set; }

        public long Bytes { get; private set; }

        public int Largest { get; private set; }

        public override bool CanRead => false;

        public override bool CanSeek => false;

        public override bool CanWrite => true;

        public override long Length => Bytes;

        public override long Position { get => Bytes; set => throw new NotSupportedException(); }

        public override void Flush()
        {
        }

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) => Count(count);

        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Count(buffer.Length);
            return ValueTask.CompletedTask;
        }

        public override void Write(byte[] buffer, int offset, int count) => throw new InvalidOperationException("Synchronous writes are not allowed on a response body.");

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        private Task Count(int count)
        {
            Writes++;
            Bytes += count;
            Largest = Math.Max(Largest, count);
            return Task.CompletedTask;
        }
    }
}
