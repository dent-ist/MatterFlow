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

    [Fact]
    public void TrendByTaskType_open_is_created_minus_closed_at_the_end_of_each_local_day()
    {
        // Viewer five hours behind UTC; period 12 to 14 Oct, now 14 Oct 15:00 local (20:00 UTC). Snapshots: 13 Oct 05:00, 14 Oct 05:00, now.
        DateTime Start(DateOnly d) => d.ToDateTime(TimeOnly.MinValue).AddHours(5);
        var from = new DateOnly(2026, 10, 12);
        var today = new DateOnly(2026, 10, 14);
        DateTime U(int day, int hour) => new(2026, 10, day, hour, 0, 0, DateTimeKind.Utc);

        // Baseline: type 1 has 3 tasks created before the 12th and still open, type 2 has 1.
        Dictionary<int, int> baseline = new() { [1] = 3, [2] = 1 };
        OpenTask[] rows =
        [
            new(1, U(1, 9), true, U(14, 8)),    // cancelled on the 14th (after the 14th's start, before now): open on the 12th and 13th, not on the 14th
            new(2, U(13, 8), false, U(13, 8)),  // created on the 13th, open now
            new(2, U(13, 9), true, U(13, 11)),  // created and completed on the 13th: never open at an end of day
            new(1, U(14, 12), false, U(14, 12)), // created on the 14th, open now
            new(1, U(14, 4), false, U(14, 4)),  // 04:00 UTC is 23:00 on the 13th local: counts from the 13th
        ];

        var built = DashboardRules.TrendByTaskType(from, today, [], [], [], Start, Now, [1, 2], rows, baseline);

        built.All.Select(p => p.Open).ShouldBe([5, 7, 7], "baseline 4; the cancelled task is open on the 12th and 13th; 13th creations; today's");
        built.Series[0].Points.Select(p => p.Open).ShouldBe([4, 5, 5]);
        built.Series[1].Points.Select(p => p.Open).ShouldBe([1, 2, 2]);
        for (var i = 0; i < 3; i++)
            built.Series.Sum(s => s.Points[i].Open).ShouldBe(built.All[i].Open);
        built.Totals[1].Open.ShouldBe(5);
        built.Totals[2].Open.ShouldBe(2);
        built.Granularity.ShouldBe("day");
    }

    [Fact]
    public void TrendByTaskType_a_task_created_Oct_1_and_completed_Oct_10_is_open_Oct_1_to_9_and_not_on_the_10th()
    {
        DateTime Start(DateOnly d) => d.ToDateTime(TimeOnly.MinValue).AddHours(4); // New York in October: UTC-4
        var from = new DateOnly(2026, 10, 1);
        var today = new DateOnly(2026, 10, 12);
        var now = new DateTime(2026, 10, 12, 18, 0, 0, DateTimeKind.Utc);
        var created = new DateTime(2026, 10, 1, 14, 0, 0, DateTimeKind.Utc);
        var completed = new DateTime(2026, 10, 10, 14, 0, 0, DateTimeKind.Utc);

        var built = DashboardRules.TrendByTaskType(from, today, [], [], [], Start, now, [], [new OpenTask(1, created, true, completed)], new Dictionary<int, int>());

        built.All.Select(p => p.Open).ShouldBe([1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0]);
    }

    [Theory]
    [InlineData(1, "day")]
    [InlineData(31, "day")]
    [InlineData(32, "week")]
    [InlineData(366, "week")]
    public void TrendGranularity_is_daily_up_to_31_days(int days, string expected) => DashboardRules.TrendGranularity(days).ShouldBe(expected);

    [Theory]
    [InlineData("2026-10-12", "2026-10-12")] // Monday
    [InlineData("2026-10-18", "2026-10-12")] // Sunday
    [InlineData("2026-10-19", "2026-10-19")]
    [InlineData("2027-01-01", "2026-12-28")] // across the year
    public void WeekStart_is_the_Monday(string date, string monday) =>
        DashboardRules.WeekStart(DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture)).ShouldBe(DateOnly.Parse(monday, System.Globalization.CultureInfo.InvariantCulture));

    [Fact]
    public void TrendByTaskType_over_31_days_buckets_every_series_by_week_with_stocks_taken_at_the_end_of_the_week()
    {
        // 35 days ending Wednesday 14 Oct 2026 (from Wed 10 Sep): 6 weeks, the first and last partial. New York, so the DST change of 1 Nov is not in range but the zone offset logic is exercised.
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        DateTime Start(DateOnly d) => TimeZoneInfo.ConvertTimeToUtc(d.ToDateTime(TimeOnly.MinValue), zone);
        var today = new DateOnly(2026, 10, 14);
        var from = today.AddDays(-34);
        var now = new DateTime(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);
        DateTime At(DateOnly d, int hour) => Start(d).AddHours(hour);

        (int, DateTime)[] created = [(1, At(from, 3)), (1, At(from.AddDays(3), 3)), (1, At(from.AddDays(4), 3)), (2, At(today, 1))];
        OpenTask[] rows = [new(1, At(from.AddDays(3), 3), false, At(from.AddDays(3), 3)), new(1, At(today, 1), false, At(today, 1))];
        var built = DashboardRules.TrendByTaskType(from, today, created, [], [], Start, now, [1], rows, new Dictionary<int, int> { [1] = 2 });

        built.Granularity.ShouldBe("week");
        built.All.Count.ShouldBe(6);
        built.All[0].Date.ShouldBe(new DateOnly(2026, 9, 7));
        built.All[^1].Date.ShouldBe(new DateOnly(2026, 10, 12));
        built.All.ShouldAllBe(p => p.Date.DayOfWeek == DayOfWeek.Monday);
        built.All.Sum(p => p.Created).ShouldBe(4, "flows are summed, so the weeks add up to the period");
        built.All[0].Created.ShouldBe(2); // Thu 10 Sep and Sun 13 Sep are in the week of 7 Sep
        built.All[1].Created.ShouldBe(1); // Mon 14 Sep
        built.All.Select(p => p.Open).ShouldBe([3, 3, 3, 3, 3, 4], "stock: end of week value, the current week is now");
        built.All[^1].Open.ShouldBe(4);
        built.Series[0].Points.Select(p => p.Open).ShouldBe([3, 3, 3, 3, 3, 4]);
    }

    [Fact]
    public void TrendByTaskType_weekly_buckets_cross_a_daylight_saving_change_without_losing_a_day()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        DateTime Start(DateOnly d) => TimeZoneInfo.ConvertTimeToUtc(d.ToDateTime(TimeOnly.MinValue), zone);
        var from = new DateOnly(2026, 10, 26); // Monday; DST ends Sunday 1 Nov 2026
        var today = new DateOnly(2026, 12, 6); // 42 days
        var now = Start(today).AddHours(12);
        var created = Enumerable.Range(0, 42).Select(i => (1, Start(from.AddDays(i)).AddHours(23).AddMinutes(30))).ToArray(); // 23:30 local each day, 24:30 would slip a day if offsets were fixed
        var built = DashboardRules.TrendByTaskType(from, today, created, [], [], Start, now, [], [], new Dictionary<int, int>());

        built.All.Count.ShouldBe(6);
        built.All.ShouldAllBe(p => p.Created == 7);
        built.All[0].Date.ShouldBe(from);
    }
}
