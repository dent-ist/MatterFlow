using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkflowEngine.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.WorkflowEngine;

internal static class Wf
{
    /// <summary>Steps 1..n with ids equal to their sequence; all skippable with optional comment unless overridden.</summary>
    public static WorkflowInstance Build(bool ordered, int n = 5, Func<int, StepSpec>? factory = null)
    {
        factory ??= i => new StepSpec(i, i, IsSkippable: true, SkipCommentRequired: false);
        var result = WorkflowInstance.Create(ordered, Enumerable.Range(1, n).Select(factory));
        result.IsSuccess.ShouldBeTrue();
        return result.Value;
    }

    public static StepStatus Status(this WorkflowInstance wf, int id) => wf.Find(id)!.Status;

    public static void ShouldSucceed(this Result r) => r.IsSuccess.ShouldBeTrue(r.Error?.Code);

    public static void ShouldFail(this Result r, string code)
    {
        r.IsFailure.ShouldBeTrue("expected failure " + code);
        r.Error!.Code.ShouldBe(code);
    }

    public static void Resolve(this WorkflowInstance wf, params int[] ids)
    {
        foreach (var id in ids)
        {
            wf.Complete(id, StepInputCheck.AllSatisfied).ShouldSucceed();
        }
    }
}

public class WorkflowInstanceCreationTests
{
    [Fact]
    public void Create_makes_all_steps_pending_in_sequence_order()
    {
        var wf = WorkflowInstance.Create(true, [new(10, 3, false, false), new(11, 1, true, false), new(12, 2, true, true)]).Value;
        wf.Steps.Select(s => s.StepId).ToArray().ShouldBe([11, 12, 10]);
        wf.Steps.ShouldAllBe(s => s.Status == StepStatus.Pending && !s.HasBeenResolved && s.SkipComment == null);
    }

    [Fact]
    public void Create_rejects_empty_and_duplicates()
    {
        WorkflowInstance.Create(true, []).ShouldFail(ErrorCodes.ValidationFailed);
        WorkflowInstance.Create(true, [new(1, 1, true, false), new(1, 2, true, false)]).ShouldFail(ErrorCodes.ValidationFailed);
        WorkflowInstance.Create(true, [new(1, 1, true, false), new(2, 1, true, false)]).ShouldFail(ErrorCodes.ValidationFailed);
    }

    [Fact]
    public void Rehydrate_rejects_inconsistent_snapshots()
    {
        var d = new StepSpec(1, 1, true, false);
        WorkflowInstance.Rehydrate(true, [new(d, StepStatus.Completed, false, null)]).ShouldFail(ErrorCodes.ValidationFailed);
        WorkflowInstance.Rehydrate(true, [new(d, StepStatus.Pending, true, null)]).ShouldFail(ErrorCodes.ValidationFailed);
        WorkflowInstance.Rehydrate(true, [new(d, (StepStatus)99, false, null)]).ShouldFail(ErrorCodes.ValidationFailed);
    }

    [Fact]
    public void Snapshots_round_trip()
    {
        var wf = Wf.Build(true, 3);
        wf.Resolve(1);
        wf.Skip(2, "n/a").ShouldSucceed();
        wf.Reopen(1).ShouldSucceed();
        var copy = WorkflowInstance.Rehydrate(true, wf.ToSnapshots()).Value;
        copy.ToSnapshots().ShouldBe(wf.ToSnapshots());
    }

    [Fact]
    public void Unknown_step_is_not_found_for_every_operation()
    {
        var wf = Wf.Build(true, 2);
        wf.Start(99).ShouldFail(ErrorCodes.NotFound);
        wf.SaveValues(99).ShouldFail(ErrorCodes.NotFound);
        wf.Complete(99, StepInputCheck.AllSatisfied).ShouldFail(ErrorCodes.NotFound);
        wf.Skip(99, "x").ShouldFail(ErrorCodes.NotFound);
        wf.Reopen(99).ShouldFail(ErrorCodes.NotFound);
    }
}

public class StepStateMachineTests
{
    private static WorkflowInstance Unordered() => Wf.Build(false, 1);

    private static void Put(WorkflowInstance wf, StepStatus target)
    {
        switch (target)
        {
            case StepStatus.InProgress:
                wf.Start(1).ShouldSucceed();
                break;
            case StepStatus.Completed:
                wf.Complete(1, StepInputCheck.AllSatisfied).ShouldSucceed();
                break;
            case StepStatus.Skipped:
                wf.Skip(1, "c").ShouldSucceed();
                break;
        }
    }

    [Theory]
    [InlineData(StepStatus.Pending, true)]
    [InlineData(StepStatus.InProgress, false)]
    [InlineData(StepStatus.Completed, false)]
    [InlineData(StepStatus.Skipped, false)]
    public void Start_table(StepStatus from, bool allowed)
    {
        var wf = Unordered();
        Put(wf, from);
        var r = wf.Start(1);
        if (allowed)
        {
            r.ShouldSucceed();
            wf.Status(1).ShouldBe(StepStatus.InProgress);
        }
        else
        {
            r.ShouldFail(ErrorCodes.InvalidStatusTransition);
            wf.Status(1).ShouldBe(from);
        }
    }

    [Theory]
    [InlineData(StepStatus.Pending, true)]
    [InlineData(StepStatus.InProgress, true)]
    [InlineData(StepStatus.Completed, false)]
    [InlineData(StepStatus.Skipped, false)]
    public void Save_table(StepStatus from, bool allowed)
    {
        var wf = Unordered();
        Put(wf, from);
        var r = wf.SaveValues(1);
        if (allowed)
        {
            r.ShouldSucceed();
            wf.Status(1).ShouldBe(StepStatus.InProgress);
        }
        else
        {
            r.ShouldFail(ErrorCodes.InvalidStatusTransition);
            wf.Status(1).ShouldBe(from);
        }
    }

    [Theory]
    [InlineData(StepStatus.Pending, true)]
    [InlineData(StepStatus.InProgress, true)]
    [InlineData(StepStatus.Completed, false)]
    [InlineData(StepStatus.Skipped, false)]
    public void Complete_table(StepStatus from, bool allowed)
    {
        var wf = Unordered();
        Put(wf, from);
        var r = wf.Complete(1, StepInputCheck.AllSatisfied);
        if (allowed)
        {
            r.ShouldSucceed();
            wf.Status(1).ShouldBe(StepStatus.Completed);
        }
        else
        {
            r.ShouldFail(ErrorCodes.InvalidStatusTransition);
            wf.Status(1).ShouldBe(from);
        }
    }

    [Theory]
    [InlineData(StepStatus.Pending, true)]
    [InlineData(StepStatus.InProgress, true)]
    [InlineData(StepStatus.Completed, false)]
    [InlineData(StepStatus.Skipped, false)]
    public void Skip_table(StepStatus from, bool allowed)
    {
        var wf = Unordered();
        Put(wf, from);
        var r = wf.Skip(1, "why");
        if (allowed)
        {
            r.ShouldSucceed();
            wf.Status(1).ShouldBe(StepStatus.Skipped);
        }
        else
        {
            r.ShouldFail(ErrorCodes.InvalidStatusTransition);
            wf.Status(1).ShouldBe(from);
        }
    }

    [Theory]
    [InlineData(StepStatus.Pending, false)]
    [InlineData(StepStatus.InProgress, false)]
    [InlineData(StepStatus.Completed, true)]
    [InlineData(StepStatus.Skipped, true)]
    public void Reopen_table(StepStatus from, bool allowed)
    {
        var wf = Unordered();
        Put(wf, from);
        var r = wf.Reopen(1);
        if (allowed)
        {
            r.ShouldSucceed();
            wf.Status(1).ShouldBe(StepStatus.InProgress);
        }
        else
        {
            r.ShouldFail(ErrorCodes.InvalidStatusTransition);
            wf.Status(1).ShouldBe(from);
        }
    }

    [Fact]
    public void Events_describe_the_transition()
    {
        var wf = Wf.Build(false, 1);
        wf.Start(1).Value.Single().ShouldBe(new StepStarted(1, StepStatus.Pending, StepStatus.InProgress));
        wf.SaveValues(1).Value.Single().ShouldBe(new StepValuesSaved(1, StepStatus.InProgress, StepStatus.InProgress));
        wf.Complete(1, StepInputCheck.AllSatisfied).Value.Single().ShouldBe(new StepCompleted(1, StepStatus.InProgress, StepStatus.Completed, false));
        wf.Reopen(1).Value.Single().ShouldBe(new StepReopened(1, StepStatus.Completed, StepStatus.InProgress));
        wf.Skip(1, "ok").Value.Single().ShouldBe(new StepSkipped(1, StepStatus.InProgress, StepStatus.Skipped, "ok"));
        wf.Reopen(1).Value.Single().ShouldBe(new StepReopened(1, StepStatus.Skipped, StepStatus.InProgress));
    }

    [Fact]
    public void Save_does_not_change_an_in_progress_step_and_stores_skip_comment()
    {
        var wf = Wf.Build(false, 1);
        wf.Start(1).ShouldSucceed();
        wf.SaveValues(1, "  draft note ").ShouldSucceed();
        wf.Status(1).ShouldBe(StepStatus.InProgress);
        wf.Find(1)!.SkipComment.ShouldBe("draft note");
        wf.SaveValues(1).ShouldSucceed();
        wf.Find(1)!.SkipComment.ShouldBe("draft note");
    }

    [Fact]
    public void Complete_requires_required_inputs_and_changes_nothing_on_failure()
    {
        var wf = Wf.Build(false, 1);
        wf.Start(1).ShouldSucceed();
        wf.Complete(1, StepInputCheck.NoneSatisfied).ShouldFail(ErrorCodes.FormValidationFailed);
        wf.Status(1).ShouldBe(StepStatus.InProgress);
        wf.Find(1)!.HasBeenResolved.ShouldBeFalse();
    }

    [Fact]
    public void Direct_completed_to_skipped_and_back_is_forbidden()
    {
        var wf = Wf.Build(false, 1);
        wf.Resolve(1);
        wf.Skip(1, "x").ShouldFail(ErrorCodes.InvalidStatusTransition);
        wf.Reopen(1).ShouldSucceed();
        wf.Skip(1, "x").ShouldSucceed();
        wf.Complete(1, StepInputCheck.AllSatisfied).ShouldFail(ErrorCodes.InvalidStatusTransition);
    }

    [Fact]
    public void Double_actions_are_errors_not_silent_noops()
    {
        var wf = Wf.Build(false, 1);
        wf.Start(1).ShouldSucceed();
        wf.Start(1).ShouldFail(ErrorCodes.InvalidStatusTransition);
        wf.Complete(1, StepInputCheck.AllSatisfied).ShouldSucceed();
        wf.Complete(1, StepInputCheck.AllSatisfied).ShouldFail(ErrorCodes.InvalidStatusTransition);
        wf.Reopen(1).ShouldSucceed();
        wf.Reopen(1).ShouldFail(ErrorCodes.InvalidStatusTransition);
    }
}

public class SkipRulesTests
{
    private static WorkflowInstance Wfl(bool skippable, bool commentRequired) =>
        Wf.Build(true, 1, i => new StepSpec(i, i, skippable, commentRequired));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Scn011_skip_comment_required_when_configured(string? comment)
    {
        var wf = Wfl(true, true);
        var r = wf.Skip(1, comment);
        r.ShouldFail(ErrorCodes.SkipCommentRequired);
        r.Error!.Type.ShouldBe(ErrorType.Validation);
        wf.Status(1).ShouldBe(StepStatus.Pending);
        wf.Find(1)!.HasBeenResolved.ShouldBeFalse();
    }

    [Fact]
    public void Skip_with_comment_succeeds_and_trims()
    {
        var wf = Wfl(true, true);
        wf.Skip(1, "  not applicable ").ShouldSucceed();
        wf.Find(1)!.SkipComment.ShouldBe("not applicable");
    }

    [Fact]
    public void Skip_comment_optional_when_not_required()
    {
        var wf = Wfl(true, false);
        wf.Skip(1, null).ShouldSucceed();
        wf.Status(1).ShouldBe(StepStatus.Skipped);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Scn012_non_skippable_step_cannot_be_skipped(bool withComment)
    {
        var wf = Wfl(false, false);
        var r = wf.Skip(1, withComment ? "please" : null);
        r.ShouldFail(ErrorCodes.StepNotSkippable);
        r.Error!.Type.ShouldBe(ErrorType.Conflict);
        wf.Status(1).ShouldBe(StepStatus.Pending);
    }

    [Fact]
    public void Non_skippable_step_can_still_be_completed()
    {
        var wf = Wfl(false, false);
        wf.Resolve(1);
        wf.Status(1).ShouldBe(StepStatus.Completed);
    }

    [Fact]
    public void Reopen_keeps_skip_comment_and_reskip_without_new_comment_is_allowed()
    {
        var wf = Wfl(true, true);
        wf.Skip(1, "first reason").ShouldSucceed();
        wf.Reopen(1).ShouldSucceed();
        wf.Find(1)!.SkipComment.ShouldBe("first reason");
        wf.Skip(1, null).ShouldFail(ErrorCodes.SkipCommentRequired);
        wf.Skip(1, "second").ShouldSucceed();
        wf.Find(1)!.SkipComment.ShouldBe("second");
    }

    [Fact]
    public void Skip_check_order_is_state_then_ordering_then_skippable_then_comment()
    {
        var wf = Wf.Build(true, 2, i => new StepSpec(i, i, false, true));
        wf.Skip(2, null).ShouldFail(ErrorCodes.StepOrderViolation);
        wf.Skip(1, null).ShouldFail(ErrorCodes.StepNotSkippable);
    }
}

public class OrderingTests
{
    [Fact]
    public void Scn010_ordered_cannot_progress_step_3_before_2_is_resolved()
    {
        var wf = Wf.Build(true);
        wf.Resolve(1);
        var start = wf.Start(3);
        start.ShouldFail(ErrorCodes.StepOrderViolation);
        start.Error!.Meta!["blockingStepIds"].ShouldBe(new List<int> { 2 });
        wf.SaveValues(3).ShouldFail(ErrorCodes.StepOrderViolation);
        wf.Complete(3, StepInputCheck.AllSatisfied).ShouldFail(ErrorCodes.StepOrderViolation);
        wf.Skip(3, "x").ShouldFail(ErrorCodes.StepOrderViolation);
        wf.Status(3).ShouldBe(StepStatus.Pending);

        wf.Skip(2, "skipped is resolved").ShouldSucceed();
        wf.Start(3).ShouldSucceed();
    }

    [Fact]
    public void Ordered_first_step_has_no_prerequisites_and_each_step_needs_all_earlier()
    {
        var wf = Wf.Build(true, 4);
        wf.Start(1).ShouldSucceed();
        wf.Start(2).ShouldFail(ErrorCodes.StepOrderViolation);
        wf.Resolve(1, 2, 3, 4);
        wf.GetProgress().AllResolved.ShouldBeTrue();
    }

    [Fact]
    public void Ordered_in_progress_earlier_step_still_blocks_later_steps()
    {
        var wf = Wf.Build(true, 3);
        wf.Start(1).ShouldSucceed();
        wf.Complete(2, StepInputCheck.AllSatisfied).ShouldFail(ErrorCodes.StepOrderViolation);
    }

    [Fact]
    public void Unordered_allows_any_order()
    {
        var wf = Wf.Build(false);
        wf.Resolve(4);
        wf.Start(5).ShouldSucceed();
        wf.Skip(3, "x").ShouldSucceed();
        wf.SaveValues(2).ShouldSucceed();
        wf.Resolve(1, 5, 2);
        wf.GetProgress().Resolved.ShouldBe(5);
    }

    [Fact]
    public void Scn013_reopen_step_2_keeps_steps_3_and_4_and_blocks_never_resolved_step_5()
    {
        var wf = Wf.Build(true);
        wf.Resolve(1, 2, 3, 4);

        wf.Reopen(2).ShouldSucceed();
        wf.Status(2).ShouldBe(StepStatus.InProgress);
        wf.Status(3).ShouldBe(StepStatus.Completed);
        wf.Status(4).ShouldBe(StepStatus.Completed);

        var progress = wf.GetProgress();
        progress.ReopenedPrerequisiteStepIds.ShouldBe([2]);
        progress.CurrentStepId.ShouldBe(2);
        progress.Resolved.ShouldBe(3);

        wf.Start(5).ShouldFail(ErrorCodes.StepOrderViolation);
        wf.Complete(5, StepInputCheck.AllSatisfied).ShouldFail(ErrorCodes.StepOrderViolation);

        wf.Complete(2, StepInputCheck.AllSatisfied).ShouldSucceed();
        wf.GetProgress().ReopenedPrerequisiteStepIds.ShouldBeEmpty();
        wf.Start(5).ShouldSucceed();
    }

    [Fact]
    public void Reopened_step_can_be_reresolved_even_with_earlier_step_also_reopened()
    {
        var wf = Wf.Build(true, 3);
        wf.Resolve(1, 2, 3);
        wf.Reopen(1).ShouldSucceed();
        wf.Reopen(2).ShouldSucceed();
        wf.Complete(2, StepInputCheck.AllSatisfied).ShouldSucceed();
        wf.GetProgress().ReopenedPrerequisiteStepIds.ShouldBe([1]);
    }

    [Fact]
    public void Reopen_has_no_ordering_guard_and_does_not_reset_downstream()
    {
        var wf = Wf.Build(true, 3);
        wf.Resolve(1, 2, 3);
        wf.Reopen(3).ShouldSucceed();
        wf.Reopen(1).ShouldSucceed();
        wf.Status(2).ShouldBe(StepStatus.Completed);
        wf.GetProgress().ReopenedPrerequisiteStepIds.ShouldBe([1, 3]);
    }

    [Fact]
    public void Reopened_skipped_step_is_flagged_too_and_keeps_first_resolved()
    {
        var wf = Wf.Build(true, 2);
        wf.Skip(1, "x").ShouldSucceed();
        wf.Reopen(1).ShouldSucceed();
        wf.Find(1)!.HasBeenResolved.ShouldBeTrue();
        wf.GetProgress().ReopenedPrerequisiteStepIds.ShouldBe([1]);
    }

    [Fact]
    public void Unordered_workflows_never_flag_reopened_prerequisites()
    {
        var wf = Wf.Build(false, 3);
        wf.Resolve(1, 2);
        wf.Reopen(1).ShouldSucceed();
        wf.GetProgress().ReopenedPrerequisiteStepIds.ShouldBeEmpty();
    }

    [Fact]
    public void Ordering_uses_sequence_not_id_or_input_order()
    {
        var wf = WorkflowInstance.Create(true, [new(30, 1, true, false), new(20, 2, true, false), new(10, 3, true, false)]).Value;
        wf.Start(10).ShouldFail(ErrorCodes.StepOrderViolation);
        wf.Resolve(30);
        wf.Start(20).ShouldSucceed();
        wf.GetProgress().CurrentStepId.ShouldBe(20);
    }
}

public class ProgressTests
{
    [Fact]
    public void Progress_counts_and_current_step()
    {
        var wf = Wf.Build(true);
        var p = wf.GetProgress();
        (p.Total, p.Pending, p.InProgress, p.Completed, p.Skipped, p.CurrentStepId).ShouldBe((5, 5, 0, 0, 0, 1));
        p.Unresolved.ShouldBe(5);
        p.AllResolved.ShouldBeFalse();

        wf.Resolve(1);
        wf.Skip(2, "x").ShouldSucceed();
        wf.Start(3).ShouldSucceed();
        p = wf.GetProgress();
        (p.Pending, p.InProgress, p.Completed, p.Skipped, p.CurrentStepId, p.Resolved).ShouldBe((2, 1, 1, 1, 3, 2));
    }

    [Fact]
    public void Fully_resolved_has_no_current_step()
    {
        var wf = Wf.Build(true, 2);
        wf.Resolve(1, 2);
        var p = wf.GetProgress();
        p.CurrentStepId.ShouldBeNull();
        p.AllResolved.ShouldBeTrue();
    }
}

public class TaskCompletionTests
{
    [Fact]
    public void Ready_when_every_step_is_resolved()
    {
        var wf = Wf.Build(true, 3);
        wf.Resolve(1, 2);
        wf.Skip(3, "x").ShouldSucceed();
        var e = wf.EvaluateTaskCompletion(StepInputCheck.NoneSatisfied);
        e.IsReady.ShouldBeTrue();
        e.CanBulkComplete.ShouldBeFalse();
        wf.BulkCompleteUnresolved(StepInputCheck.NoneSatisfied).Value.ShouldBeEmpty();
        wf.Status(3).ShouldBe(StepStatus.Skipped);
    }

    [Fact]
    public void Evaluate_splits_unresolved_into_completable_and_blocked()
    {
        var wf = Wf.Build(true);
        wf.Resolve(1);
        var e = wf.EvaluateTaskCompletion(StepInputCheck.MissingFor(3, 5));
        e.IsReady.ShouldBeFalse();
        e.UnresolvedStepIds.ShouldBe([2, 3, 4, 5]);
        e.BulkCompletableStepIds.ShouldBe([2, 4]);
        e.BlockedStepIds.ShouldBe([3, 5]);
        e.CanBulkComplete.ShouldBeFalse();
        var err = e.ToBlockedError();
        err.Code.ShouldBe(ErrorCodes.CompletionBlocked);
        err.Type.ShouldBe(ErrorType.Conflict);
        err.Meta!["stepsMissingInputs"].ShouldBe(new List<int> { 3, 5 });
        err.Meta["unresolvedStepIds"].ShouldBe(new List<int> { 2, 3, 4, 5 });
    }

    [Fact]
    public void Reopened_steps_count_as_unresolved()
    {
        var wf = Wf.Build(true, 3);
        wf.Resolve(1, 2, 3);
        wf.Reopen(2).ShouldSucceed();
        wf.EvaluateTaskCompletion(StepInputCheck.AllSatisfied).UnresolvedStepIds.ShouldBe([2]);
    }

    [Fact]
    public void Bulk_complete_completes_all_unresolved_in_order_as_completed_never_skipped()
    {
        var wf = Wf.Build(true);
        wf.Resolve(1);
        wf.Skip(2, "skipped before").ShouldSucceed();
        wf.Start(3).ShouldSucceed();
        var r = wf.BulkCompleteUnresolved(StepInputCheck.AllSatisfied);

        r.ShouldSucceed();
        r.Value.ShouldBe(
        [
            new StepCompleted(3, StepStatus.InProgress, StepStatus.Completed, true),
            new StepCompleted(4, StepStatus.Pending, StepStatus.Completed, true),
            new StepCompleted(5, StepStatus.Pending, StepStatus.Completed, true),
        ]);
        wf.Steps.Select(s => s.Status).ToArray()
            .ShouldBe([StepStatus.Completed, StepStatus.Skipped, StepStatus.Completed, StepStatus.Completed, StepStatus.Completed]);
        wf.Steps.ShouldAllBe(s => s.HasBeenResolved);
        wf.EvaluateTaskCompletion(StepInputCheck.NoneSatisfied).IsReady.ShouldBeTrue();
    }

    [Fact]
    public void Bulk_complete_is_all_or_nothing()
    {
        var wf = Wf.Build(true);
        wf.Resolve(1);
        wf.Start(2).ShouldSucceed();
        var before = wf.ToSnapshots();

        var r = wf.BulkCompleteUnresolved(StepInputCheck.MissingFor(4));

        r.ShouldFail(ErrorCodes.CompletionBlocked);
        r.Error!.Meta!["stepsMissingInputs"].ShouldBe(new List<int> { 4 });
        wf.ToSnapshots().ShouldBe(before);
    }

    [Fact]
    public void Bulk_complete_works_for_unordered_and_handles_reopened_steps_in_workflow_order()
    {
        var wf = Wf.Build(false, 4);
        wf.Resolve(4, 1);
        wf.Reopen(4).ShouldSucceed();
        var r = wf.BulkCompleteUnresolved(StepInputCheck.AllSatisfied);
        r.Value.Select(e => e.StepId).ToArray().ShouldBe([2, 3, 4]);
        r.Value.Cast<StepCompleted>().ShouldAllBe(e => e.Bulk);
        wf.GetProgress().Completed.ShouldBe(4);
    }

    [Fact]
    public void Bulk_complete_twice_second_call_is_an_empty_success()
    {
        var wf = Wf.Build(true, 3);
        wf.BulkCompleteUnresolved(StepInputCheck.AllSatisfied).Value.Count.ShouldBe(3);
        wf.BulkCompleteUnresolved(StepInputCheck.AllSatisfied).Value.ShouldBeEmpty();
    }

    [Fact]
    public void Bulk_complete_retains_skip_comment_of_reopened_skipped_step()
    {
        var wf = Wf.Build(true, 1);
        wf.Skip(1, "reason").ShouldSucceed();
        wf.Reopen(1).ShouldSucceed();
        wf.BulkCompleteUnresolved(StepInputCheck.AllSatisfied).ShouldSucceed();
        wf.Status(1).ShouldBe(StepStatus.Completed);
        wf.Find(1)!.SkipComment.ShouldBe("reason");
    }
}

public class TaskStepGuardTests
{
    public static TheoryData<TaskStatusCode, StepAction, bool, TaskEffect> Cells()
    {
        var data = new TheoryData<TaskStatusCode, StepAction, bool, TaskEffect>();
        foreach (var status in Enum.GetValues<TaskStatusCode>())
        {
            foreach (var action in Enum.GetValues<StepAction>())
            {
                var allowed = status is TaskStatusCode.New or TaskStatusCode.InProgress
                    || (status == TaskStatusCode.Completed && action == StepAction.Reopen);
                var effect = status == TaskStatusCode.Completed && action == StepAction.Reopen
                    ? TaskEffect.MoveTaskToInProgress
                    : TaskEffect.None;
                data.Add(status, action, allowed, effect);
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Cells))]
    public void Every_cell(TaskStatusCode status, StepAction action, bool allowed, TaskEffect effect)
    {
        var r = TaskStepGuard.StepActionsAllowed(status, action);
        if (allowed)
        {
            r.ShouldSucceed();
            r.Value.ShouldBe(effect);
        }
        else
        {
            r.ShouldFail(ErrorCodes.TaskNotEditable);
            r.Error!.Type.ShouldBe(ErrorType.Conflict);
        }
    }

    [Fact]
    public void Undefined_status_throws()
    {
        Should.Throw<ArgumentOutOfRangeException>(() => TaskStepGuard.StepActionsAllowed((TaskStatusCode)42, StepAction.Start));
    }
}

public class WorkflowPropertyTests
{
    private enum Op
    {
        Start,
        Save,
        Complete,
        Skip,
        Reopen,
        Bulk,
    }

    [Theory]
    [InlineData(1, true)]
    [InlineData(2, true)]
    [InlineData(3, true)]
    [InlineData(4, false)]
    [InlineData(5, false)]
    [InlineData(6, false)]
    public void Random_sequences_preserve_invariants(int seed, bool ordered)
    {
        var rng = new Random(seed);
        for (var run = 0; run < 60; run++)
        {
            var n = rng.Next(1, 7);
            var wf = Wf.Build(ordered, n, i => new StepSpec(i, i, rng.Next(3) != 0, rng.Next(2) == 0));
            var missing = Enumerable.Range(1, n).Where(_ => rng.Next(4) == 0).ToArray();
            var inputs = StepInputCheck.MissingFor(missing);

            for (var i = 0; i < 80; i++)
            {
                var op = (Op)rng.Next(6);
                var id = rng.Next(1, n + 1);
                var before = wf.ToSnapshots();
                var wasResolvedBefore = wf.Find(id)!.HasBeenResolved;
                var lowerAllResolved = wf.Steps.Where(s => s.Sequence < id).All(s => s.IsResolved);

                var result = op switch
                {
                    Op.Start => wf.Start(id),
                    Op.Save => wf.SaveValues(id, rng.Next(2) == 0 ? "note" : null),
                    Op.Complete => wf.Complete(id, inputs),
                    Op.Skip => wf.Skip(id, rng.Next(2) == 0 ? "reason" : " "),
                    Op.Reopen => wf.Reopen(id),
                    _ => wf.BulkCompleteUnresolved(inputs),
                };

                if (result.IsFailure)
                {
                    wf.ToSnapshots().ShouldBe(before, "a failed operation must change nothing");
                }
                else if (ordered && op is Op.Start or Op.Save or Op.Complete or Op.Skip && !wasResolvedBefore && before.First(s => s.Definition.StepId == id).Status == StepStatus.Pending)
                {
                    lowerAllResolved.ShouldBeTrue("ordered guard: new unresolved steps progress only after earlier steps are resolved");
                }

                AssertInvariants(wf, ordered);
            }
        }
    }

    private static void AssertInvariants(WorkflowInstance wf, bool ordered)
    {
        foreach (var s in wf.Steps)
        {
            Enum.IsDefined(s.Status).ShouldBeTrue();
            (s.Status == StepStatus.Completed && s.Status == StepStatus.Skipped).ShouldBeFalse();
            if (s.IsResolved)
            {
                s.HasBeenResolved.ShouldBeTrue();
            }

            if (s.Status == StepStatus.Pending)
            {
                s.HasBeenResolved.ShouldBeFalse();
            }

            if (s.Status == StepStatus.Skipped)
            {
                s.Definition.IsSkippable.ShouldBeTrue("only skippable steps can be SKIPPED");
                if (s.Definition.SkipCommentRequired)
                {
                    s.SkipComment.ShouldNotBeNullOrWhiteSpace();
                }
            }
        }

        var p = wf.GetProgress();
        (p.Pending + p.InProgress + p.Completed + p.Skipped).ShouldBe(p.Total);
        p.Resolved.ShouldBe(wf.Steps.Count(s => s.IsResolved));
        p.Unresolved.ShouldBe(wf.Steps.Count(s => !s.IsResolved));
        p.CurrentStepId.ShouldBe(wf.Steps.FirstOrDefault(s => !s.IsResolved)?.StepId);
        p.AllResolved.ShouldBe(p.CurrentStepId is null);
        if (!ordered)
        {
            p.ReopenedPrerequisiteStepIds.ShouldBeEmpty();
        }

        var e = wf.EvaluateTaskCompletion(StepInputCheck.AllSatisfied);
        e.UnresolvedStepIds.Count.ShouldBe(p.Unresolved);
        e.IsReady.ShouldBe(p.AllResolved);
        var round = WorkflowInstance.Rehydrate(ordered, wf.ToSnapshots());
        round.IsSuccess.ShouldBeTrue();
    }
}
