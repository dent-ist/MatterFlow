namespace MatterFlow.WorkflowEngine.Domain;

/// <summary>How a library step's input form stands at publish time.</summary>
public enum StepFormReadiness
{
    /// <summary>The step has no input fields (no form, or only an empty draft). Nothing is pinned.</summary>
    Empty,

    /// <summary>The form has a published version; that version is pinned.</summary>
    Published,

    /// <summary>The form has fields in a draft but no published version: it must be published first.</summary>
    DraftOnly,
}

/// <summary>One placement in the draft, with the facts the validator needs about its library step.</summary>
/// <param name="SequenceNo">Position in the draft.</param>
/// <param name="SourceStepDefinitionId">The library step.</param>
/// <param name="Title">Title, for messages.</param>
/// <param name="IsSkippable">Per-workflow setting.</param>
/// <param name="SkipCommentRequired">Per-workflow setting.</param>
/// <param name="Form">State of the library step's input form.</param>
public sealed record PublishCandidateStep(
    int SequenceNo,
    int SourceStepDefinitionId,
    string Title,
    bool IsSkippable,
    bool SkipCommentRequired,
    StepFormReadiness Form);

/// <summary>One reason a draft cannot be published.</summary>
/// <param name="Code">Stable code: NO_STEPS, DUPLICATE_STEP, SEQUENCE_NOT_CONTIGUOUS, SKIP_COMMENT_REQUIRES_SKIPPABLE or STEP_FORM_NOT_PUBLISHED.</param>
/// <param name="Message">English detail.</param>
/// <param name="SequenceNo">The step concerned, when the problem is about one step.</param>
public sealed record PublishIssue(string Code, string Message, int? SequenceNo = null);

/// <summary>
/// Pure publish-time checks of a workflow draft (baseline 9, architecture 8.1): at least one step, no step placed twice,
/// sequence 1..n without gaps, skip-comment only where skipping is allowed, and every step whose inputs exist has them published.
/// </summary>
public static class WorkflowPublishValidator
{
    public const string NoSteps = "NO_STEPS";
    public const string DuplicateStep = "DUPLICATE_STEP";
    public const string SequenceNotContiguous = "SEQUENCE_NOT_CONTIGUOUS";
    public const string SkipCommentRequiresSkippable = "SKIP_COMMENT_REQUIRES_SKIPPABLE";
    public const string StepFormNotPublished = "STEP_FORM_NOT_PUBLISHED";

    public static IReadOnlyList<PublishIssue> Validate(IReadOnlyList<PublishCandidateStep> steps)
    {
        var issues = new List<PublishIssue>();
        if (steps.Count == 0)
        {
            issues.Add(new PublishIssue(NoSteps, "Add at least one step before publishing."));
            return issues;
        }

        var ordered = steps.OrderBy(s => s.SequenceNo).ToList();
        for (var i = 0; i < ordered.Count; i++)
        {
            if (ordered[i].SequenceNo != i + 1)
            {
                issues.Add(new PublishIssue(SequenceNotContiguous, "The step order has gaps or repeats; reorder the steps and save again.", ordered[i].SequenceNo));
                break;
            }
        }

        foreach (var group in ordered.GroupBy(s => s.SourceStepDefinitionId).Where(g => g.Count() > 1))
        {
            foreach (var step in group.Skip(1))
            {
                issues.Add(new PublishIssue(DuplicateStep, $"'{step.Title}' is in the workflow more than once.", step.SequenceNo));
            }
        }

        foreach (var step in ordered)
        {
            if (step.SkipCommentRequired && !step.IsSkippable)
            {
                issues.Add(new PublishIssue(SkipCommentRequiresSkippable, $"'{step.Title}' requires a skip comment but cannot be skipped.", step.SequenceNo));
            }

            if (step.Form == StepFormReadiness.DraftOnly)
            {
                issues.Add(new PublishIssue(StepFormNotPublished, $"The inputs of '{step.Title}' are not published. Publish the step's form first.", step.SequenceNo));
            }
        }

        return issues;
    }
}
