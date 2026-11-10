using LptHub.Identity.Application;
using LptHub.Identity.Contracts;
using Shouldly;

namespace LptHub.UnitTests.Identity;

/// <summary>The default assignee ranking (DB-14): load, then completed Tasks of the type in 3 months, then longest since last assigned, then name, then id.</summary>
public sealed class LoadBalancedAssigneeRankerTests
{
    private static readonly DateTime Now = new(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc);
    private readonly LoadBalancedAssigneeRanker _ranker = new();

    private static AssigneeCandidate C(int id, string name, int load, int done = 0, int? daysAgo = null, bool available = true, int? open = null, AssigneeCandidateDisplay? display = null) =>
        new(id, name, open ?? load, load, done, daysAgo is { } d ? Now.AddDays(-d) : null, available, available ? null : Now.AddDays(3), display);

    private string[] Order(int? taskTypeId, params AssigneeCandidate[] candidates) =>
        _ranker.Rank(new AssigneeRankingRequest(candidates, null, taskTypeId, Now)).Select(r => r.Candidate.DisplayName).ToArray();

    [Fact]
    public void Least_load_first()
    {
        Order(5, C(1, "A", 5), C(2, "B", 0), C(3, "C", 2)).ShouldBe(["B", "C", "A"]);
    }

    [Fact]
    public void Load_is_the_capacity_load_so_on_hold_tasks_do_not_count()
    {
        // A has three tasks but all On Hold (load 0); B has one active task.
        Order(5, C(1, "A", load: 0, open: 3), C(2, "B", load: 1, open: 1)).ShouldBe(["A", "B"]);
    }

    [Fact]
    public void Equal_load_goes_to_the_fewest_completed_of_the_type()
    {
        Order(5, C(1, "A", 1, done: 4), C(2, "B", 1, done: 0), C(3, "C", 1, done: 2)).ShouldBe(["B", "C", "A"]);
    }

    [Fact]
    public void Experience_never_beats_load()
    {
        Order(5, C(1, "A", 2, done: 0), C(2, "B", 1, done: 50)).ShouldBe(["B", "A"]);
    }

    [Fact]
    public void Without_a_task_type_experience_is_skipped()
    {
        Order(null, C(1, "A", 1, done: 9, daysAgo: 1), C(2, "B", 1, done: 0, daysAgo: 5)).ShouldBe(["B", "A"]);
        Order(null, C(1, "A", 1, done: 9, daysAgo: 8), C(2, "B", 1, done: 0, daysAgo: 5)).ShouldBe(["A", "B"]);
    }

    [Fact]
    public void Nobody_with_experience_falls_through_to_the_last_assigned()
    {
        Order(5, C(1, "A", 2, daysAgo: 1), C(2, "B", 2, daysAgo: 9), C(3, "C", 2), C(4, "D", 2, daysAgo: 3)).ShouldBe(["C", "B", "D", "A"]);
    }

    [Fact]
    public void Equal_experience_goes_to_the_longest_since_last_assigned()
    {
        Order(5, C(1, "A", 1, done: 2, daysAgo: 1), C(2, "B", 1, done: 2, daysAgo: 6)).ShouldBe(["B", "A"]);
    }

    [Fact]
    public void Everything_equal_falls_back_to_name_then_id()
    {
        Order(5, C(2, "bea", 1, 1, 2), C(1, "Ann", 1, 1, 2), C(4, "Cy", 1, 1, 2)).ShouldBe(["Ann", "bea", "Cy"]);
        _ranker.Rank(new AssigneeRankingRequest([C(9, "Same", 0), C(3, "Same", 0)], null, 5, Now))
            .Select(r => r.Candidate.UserId).ShouldBe([3, 9]);
    }

    [Fact]
    public void Out_of_office_keeps_its_place_but_is_not_suggestable()
    {
        var ranked = _ranker.Rank(new AssigneeRankingRequest([C(1, "Away", 0, available: false), C(2, "Here", 3)], null, 5, Now));
        ranked.Select(r => r.Candidate.DisplayName).ShouldBe(["Away", "Here"]);
        ranked.Select(r => r.Suggestable).ShouldBe([false, true]);
        ranked[0].Reason.ShouldContain("out of office");
    }

    [Fact]
    public void Pod_does_not_change_the_order()
    {
        var candidates = new[] { C(1, "A", 4), C(2, "B", 1) };
        _ranker.Rank(new AssigneeRankingRequest(candidates, 7, 3, Now)).Select(r => r.Candidate.UserId).ShouldBe([2, 1]);
    }

    [Fact]
    public void Every_candidate_appears_once_and_an_empty_set_is_empty()
    {
        _ranker.Rank(new AssigneeRankingRequest([], null, null, Now)).ShouldBeEmpty();
        Order(5, C(1, "A", 1), C(2, "B", 1), C(3, "C", 1)).Length.ShouldBe(3);
    }

    [Fact]
    public void The_reason_names_load_experience_and_the_last_assignment()
    {
        var r = _ranker.Rank(new AssigneeRankingRequest([C(1, "A", 1, done: 2, daysAgo: 3), C(2, "B", 0)], null, 5, Now));
        r.Single(x => x.Candidate.UserId == 1).Reason.ShouldBe("1 open task, 2 completed of this type in 3 months, last assigned 3 days ago");
        r.Single(x => x.Candidate.UserId == 2).Reason.ShouldBe("0 open tasks, 0 completed of this type in 3 months, never assigned");
    }

    [Fact]
    public void The_reason_leaves_out_experience_without_a_type()
    {
        _ranker.Rank(new AssigneeRankingRequest([C(1, "A", 2, done: 7, daysAgo: 3)], null, null, Now))[0].Reason.ShouldBe("2 open tasks, last assigned 3 days ago");
    }

    [Fact]
    public void The_reason_shows_only_what_the_viewer_may_see_but_the_order_uses_the_true_numbers()
    {
        // True: A completed 5 of the type, B 1. The viewer sees A with 0 (sensitive matters hidden) and B with 1.
        var a = C(1, "A", 1, done: 5, daysAgo: 2, display: new AssigneeCandidateDisplay(1, 1, Now.AddDays(-2), 0));
        var b = C(2, "B", 1, done: 1, daysAgo: 2, display: new AssigneeCandidateDisplay(1, 1, Now.AddDays(-2), 1));
        var ranked = _ranker.Rank(new AssigneeRankingRequest([a, b], null, 5, Now));
        ranked.Select(x => x.Candidate.DisplayName).ShouldBe(["B", "A"]);
        ranked[1].Reason.ShouldBe("1 open task, 0 completed of this type in 3 months, last assigned 2 days ago");
    }

    [Fact]
    public void Off_hours_people_are_ranked_like_anybody_else()
    {
        // Availability other than out of office is not even known to the ranker: IsAvailable stays true.
        Order(5, C(1, "A", 2), C(2, "Night", 0)).ShouldBe(["Night", "A"]);
    }
}
