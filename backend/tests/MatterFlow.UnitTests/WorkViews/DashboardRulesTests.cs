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
        bands.Count.ShouldBe(4);
        bands[2].MaxDays.ShouldBe(14);
        bands[3].Label.ShouldBe("15+ days");
        DashboardRules.Aging(bands[3], Today).ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&createdTo=2026-09-29");
    }

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
    public void Trend_has_one_point_per_local_day_and_counts_into_the_viewers_day()
    {
        // A zone five hours behind UTC: local midnight is 05:00 UTC.
        DateTime Start(DateOnly d) => d.ToDateTime(TimeOnly.MinValue).AddHours(5);
        var from = new DateOnly(2026, 10, 12);
        var created = new[]
        {
            new DateTime(2026, 10, 12, 4, 59, 0), // 11 Oct local: outside the period
            new DateTime(2026, 10, 12, 5, 0, 0),  // 12 Oct local, first minute
            new DateTime(2026, 10, 13, 4, 59, 0), // 12 Oct local, last minute
            new DateTime(2026, 10, 14, 9, 0, 0),  // 14 Oct local
            new DateTime(2026, 10, 15, 5, 0, 0),  // 15 Oct local: after the period
        };
        var completed = new[] { new DateTime(2026, 10, 13, 5, 0, 0) };

        var trend = DashboardRules.Trend(from, new DateOnly(2026, 10, 14), created, completed, Start);

        trend.Select(p => p.Date).ShouldBe([from, from.AddDays(1), from.AddDays(2)]);
        trend.Select(p => p.Created).ShouldBe([2, 0, 1]);
        trend.Select(p => p.Completed).ShouldBe([0, 1, 0]);
    }

    [Fact]
    public void Trend_of_a_single_day_has_one_point()
    {
        var today = new DateOnly(2026, 10, 14);
        DashboardRules.Trend(today, today, [], [], d => d.ToDateTime(TimeOnly.MinValue)).Count.ShouldBe(1);
    }
}
