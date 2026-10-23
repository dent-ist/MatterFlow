using MatterFlow.Identity.Application;
using MatterFlow.Identity.Contracts;
using Shouldly;

namespace MatterFlow.UnitTests.Identity;

/// <summary>The default assignee ranking (#757): open count, then least recently assigned, then name; out of office is ranked but not suggestable.</summary>
public sealed class LoadBalancedAssigneeRankerTests
{
    private static readonly DateTime Now = new(2026, 10, 23, 12, 0, 0, DateTimeKind.Utc);
    private readonly LoadBalancedAssigneeRanker _ranker = new();

    private static AssigneeCandidate C(int id, string name, int open, int? daysAgo = null, bool available = true) =>
        new(id, name, open, daysAgo is { } d ? Now.AddDays(-d) : null, available, available ? null : Now.AddDays(3));

    private string[] Order(params AssigneeCandidate[] candidates) =>
        _ranker.Rank(new AssigneeRankingRequest(candidates, null, null, Now)).Select(r => r.Candidate.DisplayName).ToArray();

    [Fact]
    public void Fewest_open_tasks_first()
    {
        Order(C(1, "A", 5), C(2, "B", 0), C(3, "C", 2)).ShouldBe(["B", "C", "A"]);
    }

    [Fact]
    public void Equal_counts_go_to_the_least_recently_assigned_and_never_assigned_comes_first()
    {
        Order(C(1, "A", 2, daysAgo: 1), C(2, "B", 2, daysAgo: 9), C(3, "C", 2), C(4, "D", 2, daysAgo: 3))
            .ShouldBe(["C", "B", "D", "A"]);
    }

    [Fact]
    public void Equal_count_and_time_fall_back_to_name_then_id()
    {
        Order(C(2, "bea", 1, 2), C(1, "Ann", 1, 2), C(4, "Cy", 1, 2)).ShouldBe(["Ann", "bea", "Cy"]);
        _ranker.Rank(new AssigneeRankingRequest([C(9, "Same", 0), C(3, "Same", 0)], null, null, Now))
            .Select(r => r.Candidate.UserId).ShouldBe([3, 9]);
    }

    [Fact]
    public void Out_of_office_keeps_its_place_but_is_not_suggestable()
    {
        var ranked = _ranker.Rank(new AssigneeRankingRequest([C(1, "Away", 0, available: false), C(2, "Here", 3)], null, null, Now));
        ranked.Select(r => r.Candidate.DisplayName).ShouldBe(["Away", "Here"]);
        ranked.Select(r => r.Suggestable).ShouldBe([false, true]);
        ranked[0].Reason.ShouldContain("out of office");
    }

    [Fact]
    public void Pod_and_task_type_do_not_change_the_default_order()
    {
        var candidates = new[] { C(1, "A", 4), C(2, "B", 1) };
        _ranker.Rank(new AssigneeRankingRequest(candidates, 7, 3, Now)).Select(r => r.Candidate.UserId).ShouldBe([2, 1]);
    }

    [Fact]
    public void Every_candidate_appears_once_and_an_empty_set_is_empty()
    {
        _ranker.Rank(new AssigneeRankingRequest([], null, null, Now)).ShouldBeEmpty();
        Order(C(1, "A", 1), C(2, "B", 1), C(3, "C", 1)).Length.ShouldBe(3);
    }

    [Fact]
    public void The_reason_names_the_count_and_the_last_assignment()
    {
        var r = _ranker.Rank(new AssigneeRankingRequest([C(1, "A", 1, 3), C(2, "B", 0)], null, null, Now));
        r.Single(x => x.Candidate.UserId == 1).Reason.ShouldBe("1 open task, last assigned 3 days ago");
        r.Single(x => x.Candidate.UserId == 2).Reason.ShouldBe("0 open tasks, never assigned");
    }
}
