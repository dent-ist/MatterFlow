using MatterFlow.WorkflowEngine.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.WorkflowEngine;

public class WorkflowPublishValidatorTests
{
    private static PublishCandidateStep Step(
        int seq,
        int source,
        bool skippable = false,
        bool comment = false,
        StepFormReadiness form = StepFormReadiness.Empty) =>
        new(seq, source, $"Step {source}", skippable, comment, form);

    private static string[] Codes(params PublishCandidateStep[] steps) => [.. WorkflowPublishValidator.Validate(steps).Select(i => i.Code)];

    [Fact]
    public void A_workflow_needs_at_least_one_step()
    {
        Codes().ShouldBe([WorkflowPublishValidator.NoSteps]);
    }

    [Fact]
    public void A_valid_draft_has_no_issues()
    {
        Codes(Step(1, 10), Step(2, 11, skippable: true, comment: true, form: StepFormReadiness.Published), Step(3, 12, form: StepFormReadiness.Empty)).ShouldBeEmpty();
    }

    [Fact]
    public void The_same_step_twice_is_reported_on_the_later_placement()
    {
        var issues = WorkflowPublishValidator.Validate([Step(1, 10), Step(2, 11), Step(3, 10)]);
        var issue = issues.ShouldHaveSingleItem();
        issue.Code.ShouldBe(WorkflowPublishValidator.DuplicateStep);
        issue.SequenceNo.ShouldBe(3);
    }

    [Fact]
    public void The_sequence_must_be_contiguous_from_one()
    {
        Codes(Step(1, 10), Step(3, 11)).ShouldBe([WorkflowPublishValidator.SequenceNotContiguous]);
        Codes(Step(2, 10)).ShouldBe([WorkflowPublishValidator.SequenceNotContiguous]);
    }

    [Fact]
    public void A_required_skip_comment_needs_a_skippable_step()
    {
        Codes(Step(1, 10, skippable: false, comment: true)).ShouldBe([WorkflowPublishValidator.SkipCommentRequiresSkippable]);
    }

    [Fact]
    public void Inputs_that_exist_only_as_a_draft_block_publish_but_empty_or_published_forms_do_not()
    {
        Codes(Step(1, 10, form: StepFormReadiness.DraftOnly)).ShouldBe([WorkflowPublishValidator.StepFormNotPublished]);
        Codes(Step(1, 10, form: StepFormReadiness.Published), Step(2, 11, form: StepFormReadiness.Empty)).ShouldBeEmpty();
    }
}
