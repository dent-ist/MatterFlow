using MatterFlow.Reports.Application;
using MatterFlow.Reports.Application.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>Date-times in a result: an instant (datetimeoffset) is stored in UTC and sent with a Z; a wall-clock value is sent as it is (issue: date-times in the person's zone).</summary>
public class ResultInstantTests
{
    private static ResultTable Table(ResultColumn[] columns, params object?[][] rows)
    {
        var builder = new ResultTableBuilder(rows.Length + 1, long.MaxValue);
        builder.Begin(columns);
        foreach (var row in rows)
            builder.TryAdd(row);
        return builder.Build();
    }

    [Fact]
    public void An_instant_is_sent_in_utc_with_a_z_whatever_the_offset_it_came_with()
    {
        var table = Table(
            [new("At", ReportColumnType.DateTime, Instant: true)],
            [new DateTimeOffset(2026, 3, 31, 14, 5, 0, TimeSpan.FromHours(2))],
            [new DateTimeOffset(2026, 3, 31, 14, 5, 0, TimeSpan.FromHours(-7))],
            [new DateTimeOffset(2026, 3, 31, 14, 5, 7, 250, TimeSpan.Zero)],
            [null]);

        table.Get(0, 0).ShouldBe("2026-03-31T12:05:00Z");
        table.Get(1, 0).ShouldBe("2026-03-31T21:05:00Z");
        table.Get(2, 0).ShouldBe("2026-03-31T14:05:07.25Z");
        table.Get(3, 0).ShouldBeNull();
    }

    [Fact]
    public void A_wall_clock_date_time_is_sent_as_it_is_without_a_zone_and_a_date_stays_a_date()
    {
        var table = Table(
            [new("At", ReportColumnType.DateTime), new("Day", ReportColumnType.Date)],
            [new DateTime(2026, 3, 31, 14, 5, 0), new DateTime(2026, 3, 31, 23, 59, 0)]);

        table.Get(0, 0).ShouldBe("2026-03-31T14:05:00");
        table.Get(0, 1).ShouldBe("2026-03-31");
    }

    [Fact]
    public void Instants_sort_and_filter_by_their_utc_value()
    {
        var table = Table(
            [new("At", ReportColumnType.DateTime, Instant: true)],
            [new DateTimeOffset(2026, 3, 31, 23, 0, 0, TimeSpan.FromHours(-5))], // 2026-04-01 04:00 UTC
            [new DateTimeOffset(2026, 3, 31, 6, 0, 0, TimeSpan.FromHours(2))], // 2026-03-31 04:00 UTC
            [new DateTimeOffset(2026, 3, 31, 22, 0, 0, TimeSpan.Zero)]);

        var sorted = ResultQuery.Page(table, [], ResultQuery.ParseSort("At:asc", table), 1, 10);
        sorted.Rows.Select(r => (string)r[0]!).ShouldBe(["2026-03-31T04:00:00Z", "2026-03-31T22:00:00Z", "2026-04-01T04:00:00Z"]);
        ResultQuery.Page(table, [new ResultFilter("At", "on", "2026-03-31", null)], [], 1, 10).FilteredRows.ShouldBe(2); // the UTC day
    }

    [Fact]
    public void The_column_says_whether_it_is_an_instant_and_only_date_times_can_be()
    {
        new ResultColumn("A", ReportColumnType.DateTime, Instant: true).Instant.ShouldBeTrue();
        new ResultColumn("A", ReportColumnType.DateTime).Instant.ShouldBeFalse();
        new ResultColumn("A", ReportColumnType.Text).Instant.ShouldBeFalse();
    }

    [Fact]
    public async Task The_csv_writes_an_instant_with_z_and_a_wall_clock_value_without()
    {
        var table = Table(
            [new("Instant", ReportColumnType.DateTime, Instant: true), new("Wall", ReportColumnType.DateTime)],
            [new DateTimeOffset(2026, 3, 31, 14, 5, 0, TimeSpan.FromHours(2)), new DateTime(2026, 3, 31, 14, 5, 0)]);
        using var stream = new MemoryStream();

        await ReportCsvWriter.WriteAsync(stream, table, [0], [0, 1], CancellationToken.None);

        System.Text.Encoding.UTF8.GetString(stream.ToArray(), 3, (int)stream.Length - 3).ShouldBe("Instant,Wall\r\n2026-03-31T12:05:00Z,2026-03-31T14:05:00\r\n");
    }
}
