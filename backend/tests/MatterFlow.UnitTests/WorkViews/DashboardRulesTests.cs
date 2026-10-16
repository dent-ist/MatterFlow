using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The Dashboard's pure rules: periods, aging bands, top-N folding and the Task Queue query strings behind each number.</summary>
public class DashboardRulesTests
{
    private static readonly DateOnly Today = new(2026, 10, 14);

    [Theory]
    [InlineData(1, "2026-10-14")]
    [InlineData(30, "2026-09-15")]
    [InlineData(365, "2025-10-15")]
    public void The_period_counts_today_as_its_last_day(int days, string expectedFrom) =>
        DashboardRules.Date(DashboardRules.PeriodStart(Today, days)).ShouldBe(expectedFrom);

    [Fact]
    public void The_severity_queries_are_the_overdue_query_with_the_priorities_and_fall_back_to_plain_overdue()
    {
        DashboardRules.OverdueWith([3, 1]).ShouldBe(DashboardRules.Overdue + "&priority=1&priority=3");
        DashboardRules.OverdueWith([]).ShouldBe(DashboardRules.Overdue);
    }

    [Fact]
    public void Open_means_new_in_progress_and_on_hold()
    {
        DashboardRules.OpenQuery.ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD");
        DashboardRules.Unassigned.ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true");
        DashboardRules.Overdue.ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&overdue=true");
        DashboardRules.AsapOpen.ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&asap=true");
        DashboardRules.OnHold.ShouldBe("status=ON_HOLD");
    }

    [Fact]
    public void Due_soon_excludes_asap_and_overdue_and_stops_at_the_last_day()
    {
        DashboardRules.DueSoon(Today.AddDays(TaskQueueRules.DueSoonDays))
            .ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&asap=false&overdue=false&dueTo=2026-10-16");
    }

    [Fact]
    public void Period_queries_use_the_local_start_date()
    {
        DashboardRules.Completed(new DateOnly(2026, 9, 15)).ShouldBe("status=COMPLETED&completedFrom=2026-09-15");
        DashboardRules.Created(new DateOnly(2026, 9, 15)).ShouldBe("createdFrom=2026-09-15");
    }

    [Fact]
    public void Every_query_only_uses_task_queue_parameters()
    {
        List<string> queries =
        [
            DashboardRules.OpenQuery, DashboardRules.Unassigned, DashboardRules.Overdue, DashboardRules.OnHold, DashboardRules.AsapOpen,
            DashboardRules.DueSoon(Today), DashboardRules.Completed(Today), DashboardRules.Created(Today),
            .. DashboardRules.AgingBands.Select(b => DashboardRules.Aging(b, Today)),
        ];
        foreach (var key in queries.SelectMany(q => q.Split('&')).Select(p => p.Split('=')[0]).Distinct())
            TaskQueueQuery.Keys.ShouldContain(key);
    }

    [Fact]
    public void Aging_bands_are_contiguous_and_start_at_zero()
    {
        var bands = DashboardRules.AgingBands;
        bands[0].MinDays.ShouldBe(0);
        for (var i = 1; i < bands.Count; i++)
            bands[i].MinDays.ShouldBe(bands[i - 1].MaxDays!.Value + 1);
        bands[^1].MaxDays.ShouldBeNull();
    }

    [Fact]
    public void Aging_queries_translate_days_into_local_creation_dates()
    {
        var bands = DashboardRules.AgingBands;
        DashboardRules.Aging(bands[0], Today).ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&createdFrom=2026-10-12&createdTo=2026-10-14");
        DashboardRules.Aging(bands[1], Today).ShouldContain("createdFrom=2026-10-07&createdTo=2026-10-11");
        bands.Count.ShouldBe(6);
        bands[2].MaxDays.ShouldBe(14);
        bands[3].Label.ShouldBe("15-30 days");
        DashboardRules.Aging(bands[3], Today).ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&createdFrom=2026-09-14&createdTo=2026-09-29");
        DashboardRules.Aging(bands[4], Today).ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&createdFrom=2026-08-15&createdTo=2026-09-13");
        bands[5].Label.ShouldBe("More than 60 days");
        DashboardRules.Aging(bands[5], Today).ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&createdTo=2026-08-14");
    }

    [Theory]
    [InlineData(0, "0-2")]
    [InlineData(14, "8-14")]
    [InlineData(15, "15-30")]
    [InlineData(30, "15-30")]
    [InlineData(31, "31-60")]
    [InlineData(60, "31-60")]
    [InlineData(61, "61+")]
    public void Every_age_in_days_falls_into_exactly_one_band(int age, string key) =>
        DashboardRules.AgingBands.Single(b => age >= b.MinDays && (b.MaxDays is null || age <= b.MaxDays)).Key.ShouldBe(key);

    private static DashboardBreakdownItem Item(int id, string label, int count) => new(id, null, label, count, "pod=" + id, false);

    [Fact]
    public void Top_n_folds_the_rest_into_other_without_a_link_and_keeps_the_total()
    {
        var items = Enumerable.Range(1, 12).Select(i => Item(i, "Pod " + i, 20 - i)).ToList();
        var result = DashboardRules.TopWithOther(items, 8, "Other Pods");

        result.Count.ShouldBe(9);
        result.Take(8).Select(i => i.Id).ShouldBe(Enumerable.Range(1, 8).Select(i => (int?)i));
        var other = result[^1];
        other.IsOther.ShouldBeTrue();
        other.Label.ShouldBe("Other Pods");
        other.Query.ShouldBeNull();
        other.Count.ShouldBe(Enumerable.Range(9, 4).Sum(i => 20 - i));
        result.Sum(i => i.Count).ShouldBe(items.Sum(i => i.Count));
    }

    [Fact]
    public void Top_n_leaves_short_lists_alone_orders_by_count_then_label_and_drops_zeros()
    {
        var result = DashboardRules.TopWithOther([Item(1, "Beta", 5), Item(2, "Alpha", 5), Item(3, "Zero", 0), Item(4, "Big", 9)], 8, "Other");
        result.Select(i => i.Label).ShouldBe(["Big", "Alpha", "Beta"]);
        result.ShouldAllBe(i => !i.IsOther);
    }

    [Fact]
    public void Other_can_link_to_exactly_the_folded_items()
    {
        var items = Enumerable.Range(1, 6).Select(i => Item(i, "Type " + i, 10 - i)).ToList();
        var result = DashboardRules.TopWithOther(items, 3, "Other", rest => DashboardRules.Open([.. rest.Select(r => "pod=" + r.Id)]));
        result[^1].Query.ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&pod=4&pod=5&pod=6");
        result[^1].Count.ShouldBe(6 + 5 + 4);
    }

    [Fact]
    public void Other_adds_up_the_overdue_of_the_folded_items()
    {
        var items = Enumerable.Range(1, 6).Select(i => Item(i, "Type " + i, 10 - i) with { Overdue = i }).ToList();
        var result = DashboardRules.TopWithOther(items, 3, "Other");
        result[^1].Overdue.ShouldBe(4 + 5 + 6);
        result.Sum(i => i.Overdue).ShouldBe(items.Sum(i => i.Overdue));
    }

    private static readonly DateTime Now = new(2026, 10, 14, 20, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void TrendByTaskType_splits_the_days_per_type_and_the_types_add_up_to_the_all_series()
    {
        DateTime Start(DateOnly d) => d.ToDateTime(TimeOnly.MinValue).AddHours(5);
        var from = new DateOnly(2026, 10, 12);
        var today = new DateOnly(2026, 10, 14);
        (int, DateTime)[] created =
        [
            (1, new DateTime(2026, 10, 12, 4, 59, 0)), // 11 Oct local: before the period
            (1, new DateTime(2026, 10, 12, 5, 0, 0)),
            (2, new DateTime(2026, 10, 13, 4, 59, 0)),
            (2, new DateTime(2026, 10, 14, 9, 0, 0)),
            (3, new DateTime(2026, 10, 14, 10, 0, 0)),
            (3, new DateTime(2026, 10, 15, 5, 0, 0)), // after the period
        ];
        (int, DateTime)[] completed = [(2, new DateTime(2026, 10, 13, 5, 0, 0)), (1, new DateTime(2026, 10, 14, 6, 0, 0))];

        var built = DashboardRules.TrendByTaskType(from, today, created, completed, [], Start, Now, [2, 9]);

        built.All.Select(p => p.Created).ShouldBe([2, 0, 2]);
        built.All.Select(p => p.Completed).ShouldBe([0, 1, 1]);
        built.Series.Select(s => s.TaskTypeId).ShouldBe([2, 9]);
        built.Series[0].Points.Select(p => p.Created).ShouldBe([1, 0, 1]);
        built.Series[0].Points.Select(p => p.Completed).ShouldBe([0, 1, 0]);
        built.Series[1].Points.Count.ShouldBe(3, "a requested type without Tasks still has a zero line");
        built.Series[1].Points.ShouldAllBe(p => p.Created == 0 && p.Completed == 0 && p.Overdue == 0);
        built.Totals[1].ShouldBe(new TrendTypeTotals(1, 1, 0, 0, 0));
        built.Totals[2].ShouldBe(new TrendTypeTotals(2, 1, 0, 0, 0));
        built.Totals[3].ShouldBe(new TrendTypeTotals(1, 0, 0, 0, 0));
        built.Totals.ContainsKey(9).ShouldBeFalse();

        built.All.Select(p => p.Date).ShouldBe([from, from.AddDays(1), from.AddDays(2)]);
    }

    [Fact]
    public void TrendByTaskType_overdue_is_an_end_of_day_snapshot_and_on_time_and_late_split_the_completions()
    {
        // Viewer five hours behind UTC; period 12 to 14 Oct, now 14 Oct 15:00 local (20:00 UTC). Snapshots: 13 Oct 05:00, 14 Oct 05:00, now.
        DateTime Start(DateOnly d) => d.ToDateTime(TimeOnly.MinValue).AddHours(5);
        var from = new DateOnly(2026, 10, 12);
        var today = new DateOnly(2026, 10, 14);
        var old = new DateTime(2026, 10, 1, 12, 0, 0, DateTimeKind.Utc);
        DateTime U(int day, int hour) => new(2026, 10, day, hour, 0, 0, DateTimeKind.Utc);
        DateOnly D(int day) => new(2026, 10, day);

        DueTask[] due =
        [
            new(1, old, null, D(12), TaskStatusCode.New, old), // A: date-only 12 Oct, open: overdue from the end of the 12th on
            new(1, old, null, D(14), TaskStatusCode.New, old), // B: due today (date-only): not overdue yet
            new(2, old, null, D(13), TaskStatusCode.InProgress, old), // C: date-only 13 Oct: overdue on the 13th's snapshot (equal edge) and today
            new(2, old, U(13, 10), D(13), TaskStatusCode.OnHold, old), // D: timed 13 Oct 10:00 UTC, open: passed before the 13th's end
            new(1, old, U(12, 12), D(12), TaskStatusCode.Completed, U(13, 12)), // E: completed late; overdue only on the 12th
            new(1, old, U(13, 12), D(13), TaskStatusCode.Completed, U(13, 10)), // F: completed on time; never overdue
            new(1, old, null, null, TaskStatusCode.New, old), // G: ASAP: in no line
            new(1, old, null, D(12), TaskStatusCode.Cancelled, U(13, 4)), // H: cancelled before the first snapshot
            new(1, U(14, 6), U(12, 0), D(12), TaskStatusCode.New, U(14, 6)), // I: created today after its due: overdue only now
            new(1, old, null, D(14), TaskStatusCode.Completed, U(14, 12)), // J: date-only 14 Oct, completed on the 14th: on time
            new(1, old, null, D(13), TaskStatusCode.Completed, U(14, 12)), // K: date-only 13 Oct, completed on the 14th: late, overdue on the 13th's snapshot
        ];

        var built = DashboardRules.TrendByTaskType(from, today, [], [], due, Start, Now, [1, 2]);

        built.All.Select(p => p.Overdue).ShouldBe([2, 4, 4]);
        built.Series[0].Points.Select(p => p.Overdue).ShouldBe([2, 2, 2]);
        built.Series[1].Points.Select(p => p.Overdue).ShouldBe([0, 2, 2]);
        built.All.Select(p => p.OnTime).ShouldBe([0, 1, 1]);
        built.All.Select(p => p.Late).ShouldBe([0, 1, 1]);
        built.Totals[1].ShouldBe(new TrendTypeTotals(0, 0, 2, 2, 2));
        built.Totals[2].ShouldBe(new TrendTypeTotals(0, 0, 2, 0, 0));
        for (var i = 0; i < 3; i++)
            built.Series.Sum(s => s.Points[i].Overdue).ShouldBe(built.All[i].Overdue, "per-type overdue adds up to All on day " + i);
    }

    [Fact]
    public void TrendByTaskType_handles_an_empty_period_and_no_requested_types()
    {
        var day = new DateOnly(2026, 10, 14);
        var single = DashboardRules.TrendByTaskType(day, day, [], [], [], d => d.ToDateTime(TimeOnly.MinValue), Now, []);
        single.All.Count.ShouldBe(1);
        single.Series.ShouldBeEmpty();
        DashboardRules.TrendByTaskType(day.AddDays(1), day, [], [], [], d => d.ToDateTime(TimeOnly.MinValue), Now, [4]).All.ShouldBeEmpty();
    }
}
