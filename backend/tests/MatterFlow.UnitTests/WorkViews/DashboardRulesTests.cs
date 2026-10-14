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
        DashboardRules.Aging(bands[4], Today).ShouldBe("status=NEW&status=IN_PROGRESS&status=ON_HOLD&createdTo=2026-09-13");
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
}
