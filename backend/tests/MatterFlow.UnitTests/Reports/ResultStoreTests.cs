using System.Diagnostics;
using System.Text.Json;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Application.Results;
using Microsoft.Extensions.Options;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>The typed result table and the per-person cache with its lifetime, ownership and memory rules (spec 6.4; issue #705).</summary>
public class ResultStoreTests
{
    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 22, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static ResultTable Table(int rows, int textLength = 10)
    {
        var builder = new ResultTableBuilder(rows + 1, long.MaxValue);
        builder.Begin([new("Id", ReportColumnType.Integer), new("Name", ReportColumnType.Text)]);
        for (var i = 0; i < rows; i++)
            builder.TryAdd([(long)i, new string((char)('a' + i % 26), textLength) + i]);
        return builder.Build();
    }

    private static ReportResultStore Store(ManualTime time, int budgetMb = 512, int idle = 15, int max = 60) =>
        new(Options.Create(new ReportsOptions { ResultMemoryBudgetMegabytes = budgetMb, ResultIdleMinutes = idle, ResultMaxMinutes = max }), time);

    [Fact]
    public void A_result_is_found_by_its_owner_only_and_a_stranger_gets_the_same_answer_as_for_an_unknown_id()
    {
        var store = Store(new ManualTime());
        var id = store.Put(1, 10, Table(3), false)!.Value;

        store.Get(1, id).Status.ShouldBe(ResultLookup.Found);
        store.Get(2, id).Status.ShouldBe(ResultLookup.NotFound);
        store.Get(1, Guid.NewGuid()).Status.ShouldBe(ResultLookup.NotFound);
    }

    [Fact]
    public void A_new_run_replaces_the_previous_result_of_the_same_person()
    {
        var store = Store(new ManualTime());
        var first = store.Put(1, 10, Table(3), false)!.Value;
        var second = store.Put(1, 10, Table(3), false)!.Value;

        store.Count.ShouldBe(1);
        store.Get(1, first).Status.ShouldBe(ResultLookup.Expired); // the owner is told to run again
        store.Get(2, first).Status.ShouldBe(ResultLookup.NotFound);
        store.Get(1, second).Status.ShouldBe(ResultLookup.Found);
    }

    [Fact]
    public void The_idle_lifetime_slides_and_the_absolute_lifetime_does_not()
    {
        var time = new ManualTime();
        var store = Store(time, idle: 15, max: 60);
        var id = store.Put(1, 10, Table(3), false)!.Value;

        for (var i = 0; i < 3; i++)
        {
            time.Now = time.Now.AddMinutes(14);
            store.Get(1, id).Status.ShouldBe(ResultLookup.Found, "each use extends the idle lifetime");
        }

        time.Now = time.Now.AddMinutes(14); // 56 minutes since creation, idle 14
        store.Get(1, id).Status.ShouldBe(ResultLookup.Found);
        time.Now = time.Now.AddMinutes(5); // 61 minutes since creation
        store.Get(1, id).Status.ShouldBe(ResultLookup.Expired);
    }

    [Fact]
    public void An_unused_result_expires_after_the_idle_time_and_the_sweeper_frees_it()
    {
        var time = new ManualTime();
        var store = Store(time);
        var id = store.Put(1, 10, Table(3), false)!.Value;

        time.Now = time.Now.AddMinutes(16);
        store.Count.ShouldBe(1);
        store.Sweep().ShouldBe(1);

        store.Count.ShouldBe(0);
        store.Get(1, id).Status.ShouldBe(ResultLookup.Expired);
        store.Get(2, id).Status.ShouldBe(ResultLookup.NotFound);
    }

    [Fact]
    public void Dropping_a_result_frees_it_and_only_the_owner_can()
    {
        var store = Store(new ManualTime());
        var id = store.Put(1, 10, Table(3), false)!.Value;

        store.Drop(2, id).ShouldBeFalse();
        store.Drop(1, id).ShouldBeTrue();
        store.Drop(1, id).ShouldBeFalse();
        store.Count.ShouldBe(0);
    }

    [Fact]
    public void The_memory_budget_drops_the_oldest_results_first()
    {
        var time = new ManualTime();
        var big = Table(20_000, 100); // a few MB
        var store = Store(time, budgetMb: (int)Math.Ceiling(big.EstimatedBytes * 2.5 / (1024 * 1024)));
        var a = store.Put(1, 10, big, false)!.Value;
        time.Now = time.Now.AddSeconds(1);
        var b = store.Put(2, 10, big, false)!.Value;
        time.Now = time.Now.AddSeconds(1);

        var c = store.Put(3, 10, big, false)!.Value; // does not fit next to both: the oldest (user 1) goes

        store.Get(1, a).Status.ShouldBe(ResultLookup.Expired);
        store.Get(2, b).Status.ShouldBe(ResultLookup.Found);
        store.Get(3, c).Status.ShouldBe(ResultLookup.Found);
        store.UsedBytes.ShouldBeLessThanOrEqualTo((long)(big.EstimatedBytes * 2.5));
    }

    [Fact]
    public void A_result_bigger_than_the_whole_budget_is_refused_and_keeps_the_old_one_gone_not_half_stored()
    {
        var store = Store(new ManualTime(), budgetMb: 1);
        var huge = Table(30_000, 100);
        huge.EstimatedBytes.ShouldBeGreaterThan(1024 * 1024);

        store.Put(1, 10, huge, false).ShouldBeNull();

        store.Count.ShouldBe(0);
    }

    [Fact]
    public void The_builder_stops_when_the_result_outgrows_the_budget_while_it_is_read()
    {
        var builder = new ResultTableBuilder(1_000_000, 200_000);
        builder.Begin([new("Text", ReportColumnType.Text)]);

        var rows = 0;
        while (builder.TryAdd([new string('x', 50) + rows]) && rows < 100_000)
            rows++;

        builder.OverBudget.ShouldBeTrue();
        rows.ShouldBeLessThan(10_000);
        var store = Store(new ManualTime());
        store.Complete(builder, 1, 10, false).ShouldBeNull(); // over budget -> the run answers 503
    }

    [Fact]
    public void Repeated_text_is_shared_and_costs_one_string()
    {
        var builder = new ResultTableBuilder(100_000, long.MaxValue);
        builder.Begin([new("Status", ReportColumnType.Text)]);
        for (var i = 0; i < 50_000; i++)
            builder.TryAdd(["Open and waiting for review " + (i % 5)]);

        var shared = builder.Build();

        shared.EstimatedBytes.ShouldBeLessThan(50_000L * 8 + 5 * 100 + 100_000);
    }

    [Fact]
    public void Column_types_keep_their_values_and_nulls()
    {
        var builder = new ResultTableBuilder(10, long.MaxValue);
        builder.Begin([
            new("I", ReportColumnType.Integer), new("D", ReportColumnType.Decimal), new("F", ReportColumnType.Decimal, Floating: true), new("B", ReportColumnType.Boolean),
            new("Day", ReportColumnType.Date), new("At", ReportColumnType.DateTime), new("T", ReportColumnType.Text)]);
        builder.TryAdd([5, 12.3456789012m, 1.5, true, new DateTime(2026, 10, 22, 13, 14, 15), new DateTime(2026, 10, 22, 13, 14, 15, 250), Guid.Parse("11111111-2222-3333-4444-555555555555")]);
        builder.TryAdd([null, null, null, null, null, null, null]);
        builder.TryAdd([(byte)7, 1m, 2.5f, false, new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.FromHours(2)), new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.FromHours(2)), new byte[] { 1, 2, 255 }]);

        var t = builder.Build();

        t.Get(0, 0).ShouldBe(5L);
        t.Get(0, 1).ShouldBe(12.3456789012m);
        t.Get(0, 2).ShouldBe(1.5);
        t.Get(0, 3).ShouldBe(true);
        t.Get(0, 4).ShouldBe("2026-10-22");
        t.Get(0, 5).ShouldBe("2026-10-22T13:14:15.25");
        t.Get(0, 6).ShouldBe("11111111-2222-3333-4444-555555555555");
        for (var c = 0; c < 7; c++)
            t.Get(1, c).ShouldBeNull();
        t.Get(2, 0).ShouldBe(7L);
        t.Get(2, 5).ShouldBe("2026-01-02T01:04:05"); // offsets are taken in UTC
        t.Get(2, 6).ShouldBe("0x0102FF");
    }

    [Fact]
    public void The_builder_stops_exactly_at_the_cap()
    {
        var builder = new ResultTableBuilder(3, long.MaxValue);
        builder.Begin([new("I", ReportColumnType.Integer)]);

        builder.TryAdd([1]).ShouldBeTrue();
        builder.TryAdd([2]).ShouldBeTrue();
        builder.TryAdd([3]).ShouldBeFalse();
        builder.Build().RowCount.ShouldBe(3);
    }

    [Fact]
    public void Rows_come_out_as_json_friendly_values()
    {
        var page = ResultQuery.Page(Table(3), [], [], 1, 10);

        JsonSerializer.Serialize(page.Rows).ShouldStartWith("[[0,\"aaaaaaaaaa0\"],[1,\"bbbbbbbbbb1\"]");
    }

    [Fact]
    public void Fifty_thousand_rows_by_twenty_columns_sort_in_under_150_ms_and_page_in_under_50_ms()
    {
        var rng = new Random(705);
        var columns = Enumerable.Range(0, 20).Select(i => (i % 5) switch
        {
            0 => new ResultColumn("Int" + i, ReportColumnType.Integer),
            1 => new ResultColumn("Text" + i, ReportColumnType.Text),
            2 => new ResultColumn("Dec" + i, ReportColumnType.Decimal),
            3 => new ResultColumn("Day" + i, ReportColumnType.Date),
            _ => new ResultColumn("Text" + i, ReportColumnType.Text),
        }).Select((c, i) => c with { Name = c.Name + "_" + i }).ToList();
        var builder = new ResultTableBuilder(50_001, long.MaxValue);
        builder.Begin(columns);
        for (var r = 0; r < 50_000; r++)
        {
            var row = new object?[20];
            for (var c = 0; c < 20; c++)
            {
                row[c] = columns[c].Type switch
                {
                    ReportColumnType.Integer => (long)rng.Next(0, 100_000),
                    ReportColumnType.Decimal => rng.Next(0, 1_000_000) / 100m,
                    ReportColumnType.Date => new DateTime(2020, 1, 1).AddDays(rng.Next(0, 2000)),
                    _ => rng.Next(0, 3) == 0 ? null : "Customer " + rng.Next(0, 5000),
                };
            }

            builder.TryAdd(row);
        }

        var table = builder.Build();
        var intSort = new[] { new ResultSort(columns[0].Name, false) };
        var textSort = new[] { new ResultSort(columns[1].Name, true), new ResultSort(columns[0].Name, false) };
        var filter = new[] { new ResultFilter(columns[1].Name, "contains", "Customer 4", null) };

        long Best(Func<int> action)
        {
            action();
            var best = long.MaxValue;
            for (var i = 0; i < 5; i++)
            {
                var sw = Stopwatch.StartNew();
                action();
                best = Math.Min(best, sw.ElapsedMilliseconds);
            }

            return best;
        }

        // A fresh table copy per call would hide the cache; clear it by varying the sort direction each time.
        var flip = false;
        var sortInt = Best(() =>
        {
            flip = !flip;
            return ResultQuery.Order(table, [], [new ResultSort(columns[0].Name, flip)]).Length;
        });
        var sortText = Best(() =>
        {
            flip = !flip;
            return ResultQuery.Order(table, [], [new ResultSort(columns[1].Name, flip), new ResultSort(columns[0].Name, false)]).Length;
        });
        var filterAndSort = Best(() =>
        {
            flip = !flip;
            return ResultQuery.Order(table, filter, [new ResultSort(columns[2].Name, flip)]).Length;
        });
        var page = Best(() => ResultQuery.Page(table, [], intSort, 7, 50).Rows.Count); // order cached by the sort above

        sortInt.ShouldBeLessThan(150);
        sortText.ShouldBeLessThan(150);
        filterAndSort.ShouldBeLessThan(150);
        page.ShouldBeLessThan(50);
        _ = textSort;
    }
}
