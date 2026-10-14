using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkflowEngine.Domain;

/// <summary>Counts and flags describing a workflow instance.</summary>
public sealed record WorkflowProgress(
    int Total,
    int Pending,
    int InProgress,
    int Completed,
    int Skipped,
    int? CurrentStepId,
    IReadOnlyList<int> ReopenedPrerequisiteStepIds)
{
    public int Resolved => Completed + Skipped;

    public int Unresolved => Total - Resolved;

    public bool AllResolved => Total == Resolved;
}

/// <summary>Outcome of the Task completion check (architecture 8.3 rule 1, addendum K).</summary>
public sealed record TaskCompletionEvaluation(
    IReadOnlyList<int> UnresolvedStepIds,
    IReadOnlyList<int> BulkCompletableStepIds,
    IReadOnlyList<int> BlockedStepIds)
{
    /// <summary>Every step is resolved; the Task may complete.</summary>
    public bool IsReady => UnresolvedStepIds.Count == 0;

    /// <summary>Unresolved steps exist and every one of them has its required inputs.</summary>
    public bool CanBulkComplete => !IsReady && BlockedStepIds.Count == 0;

    /// <summary>409 COMPLETION_BLOCKED listing unresolved steps and, in meta, those missing required inputs.</summary>
    public Error ToBlockedError() =>
        Error.Conflict(
            ErrorCodes.CompletionBlocked,
            "Every workflow step must be resolved before the task can be completed.",
            new Dictionary<string, object?>
            {
                ["unresolvedStepIds"] = UnresolvedStepIds,
                ["stepsMissingInputs"] = BlockedStepIds,
            });
}

/// <summary>
/// In-memory workflow instance: ordered/unordered flag plus step instances and the step state machine (architecture 8.2).
/// Every operation validates first and mutates only on success, so a failed call changes nothing.
/// </summary>
public sealed class WorkflowInstance
{
    private readonly List<StepInstance> _steps;

    private WorkflowInstance(bool isOrdered, List<StepInstance> steps)
    {
        IsOrdered = isOrdered;
        _steps = steps;
    }

    public bool IsOrdered { get; }

    /// <summary>Steps in workflow (sequence) order.</summary>
    public IReadOnlyList<StepInstance> Steps => _steps;

    /// <summary>Instantiate: one PENDING step per definition (architecture 8.1).</summary>
    public static Result<WorkflowInstance> Create(bool isOrdered, IEnumerable<StepDefinition> definitions)
    {
        ArgumentNullException.ThrowIfNull(definitions);
        return Rehydrate(isOrdered, definitions.Select(d => new StepSnapshot(d, StepStatus.Pending, false, null)));
    }

    /// <summary>Rebuild from persisted state; rejects duplicate ids/sequences, an empty step list, and inconsistent snapshots.</summary>
    public static Result<WorkflowInstance> Rehydrate(bool isOrdered, IEnumerable<StepSnapshot> snapshots)
    {
        ArgumentNullException.ThrowIfNull(snapshots);
        var list = snapshots.OrderBy(s => s.Definition.Sequence).ToList();
        if (list.Count == 0)
        {
            return Error.Validation("steps", "EMPTY", "A workflow instance needs at least one step.");
        }

        if (list.Select(s => s.Definition.StepId).Distinct().Count() != list.Count
            || list.Select(s => s.Definition.Sequence).Distinct().Count() != list.Count)
        {
            return Error.Validation("steps", "DUPLICATE", "Step ids and sequence numbers must be unique.");
        }

        foreach (var s in list)
        {
            var resolved = s.Status is StepStatus.Completed or StepStatus.Skipped;
            if (!Enum.IsDefined(s.Status) || (resolved && !s.HasBeenResolved) || (s.Status == StepStatus.Pending && s.HasBeenResolved))
            {
                return Error.Validation("steps", "INCONSISTENT", $"Step {s.Definition.StepId} has an inconsistent state.");
            }
        }

        return new WorkflowInstance(isOrdered, list.Select(s => new StepInstance(s.Definition, s.Status, s.HasBeenResolved, s.SkipComment)).ToList());
    }

    public StepInstance? Find(int stepId) => _steps.Find(s => s.StepId == stepId);

    /// <summary>PENDING to IN_PROGRESS. A second start (or start of a resolved step) is INVALID_STATUS_TRANSITION.</summary>
    public Result<IReadOnlyList<WorkflowDomainEvent>> Start(int stepId)
    {
        var step = Locate(stepId, out var notFound);
        if (step is null)
        {
            return notFound!;
        }

        if (step.Status != StepStatus.Pending)
        {
            return InvalidTransition(step, "start");
        }

        if (OrderingError(step) is { } ordering)
        {
            return ordering;
        }

        step.Status = StepStatus.InProgress;
        return One(new StepStarted(stepId, StepStatus.Pending, StepStatus.InProgress));
    }

    /// <summary>
    /// Save draft values (and/or a skip comment): no state change on an IN_PROGRESS step; a PENDING step becomes IN_PROGRESS
    /// (architecture 8.2, subject to the ordering guard). Resolved steps must be reopened first.
    /// </summary>
    public Result<IReadOnlyList<WorkflowDomainEvent>> SaveValues(int stepId, string? skipComment = null)
    {
        var step = Locate(stepId, out var notFound);
        if (step is null)
        {
            return notFound!;
        }

        if (step.IsResolved)
        {
            return InvalidTransition(step, "save values on");
        }

        var from = step.Status;
        if (from == StepStatus.Pending && OrderingError(step) is { } ordering)
        {
            return ordering;
        }

        step.Status = StepStatus.InProgress;
        if (!string.IsNullOrWhiteSpace(skipComment))
        {
            step.SkipComment = skipComment.Trim();
        }

        return One(new StepValuesSaved(stepId, from, StepStatus.InProgress));
    }

    /// <summary>PENDING/IN_PROGRESS to COMPLETED; needs the ordering guard and all required inputs.</summary>
    public Result<IReadOnlyList<WorkflowDomainEvent>> Complete(int stepId, IStepInputCheck inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        var step = Locate(stepId, out var notFound);
        if (step is null)
        {
            return notFound!;
        }

        if (step.IsResolved)
        {
            return InvalidTransition(step, "complete");
        }

        if (OrderingError(step) is { } ordering)
        {
            return ordering;
        }

        if (!inputs.RequiredInputsSatisfied(stepId))
        {
            return Error.Validation($"step:{stepId}", "REQUIRED_INPUTS_MISSING", "Required inputs are missing.", ErrorCodes.FormValidationFailed);
        }

        var from = step.Status;
        Resolve(step, StepStatus.Completed);
        return One(new StepCompleted(stepId, from, StepStatus.Completed, Bulk: false));
    }

    /// <summary>PENDING/IN_PROGRESS to SKIPPED; only skippable steps, with a non-blank comment when the step requires one.</summary>
    public Result<IReadOnlyList<WorkflowDomainEvent>> Skip(int stepId, string? comment)
    {
        var step = Locate(stepId, out var notFound);
        if (step is null)
        {
            return notFound!;
        }

        if (step.IsResolved)
        {
            return InvalidTransition(step, "skip");
        }

        if (OrderingError(step) is { } ordering)
        {
            return ordering;
        }

        if (!step.Definition.IsSkippable)
        {
            return Error.Conflict(ErrorCodes.StepNotSkippable, $"Step {stepId} cannot be skipped.");
        }

        var trimmed = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        if (step.Definition.SkipCommentRequired && trimmed is null)
        {
            return Error.Validation("skipComment", "REQUIRED", "A skip comment is required.", ErrorCodes.SkipCommentRequired);
        }

        var from = step.Status;
        if (trimmed is not null)
        {
            step.SkipComment = trimmed;
        }

        Resolve(step, StepStatus.Skipped);
        return One(new StepSkipped(stepId, from, StepStatus.Skipped, step.SkipComment));
    }

    /// <summary>COMPLETED/SKIPPED to IN_PROGRESS. No reason, no ordering guard; keeps values and skip comment; downstream steps are untouched.</summary>
    public Result<IReadOnlyList<WorkflowDomainEvent>> Reopen(int stepId)
    {
        var step = Locate(stepId, out var notFound);
        if (step is null)
        {
            return notFound!;
        }

        if (!step.IsResolved)
        {
            return InvalidTransition(step, "reopen");
        }

        var from = step.Status;
        step.Status = StepStatus.InProgress;
        return One(new StepReopened(stepId, from, StepStatus.InProgress));
    }

    public WorkflowProgress GetProgress()
    {
        var current = _steps.FirstOrDefault(s => !s.IsResolved);
        return new WorkflowProgress(
            _steps.Count,
            _steps.Count(s => s.Status == StepStatus.Pending),
            _steps.Count(s => s.Status == StepStatus.InProgress),
            _steps.Count(s => s.Status == StepStatus.Completed),
            _steps.Count(s => s.Status == StepStatus.Skipped),
            current?.StepId,
            _steps.Where(IsReopenedPrerequisite).Select(s => s.StepId).ToList());
    }

    /// <summary>A reopened, not yet re-resolved step in an ordered workflow (the UI flags it as "reopened prerequisite").</summary>
    public bool IsReopenedPrerequisite(StepInstance step)
    {
        ArgumentNullException.ThrowIfNull(step);
        return IsOrdered && step.Status == StepStatus.InProgress && step.HasBeenResolved;
    }

    /// <summary>Task completion check: Ready, or unresolved steps split into bulk-completable and blocked (missing required inputs).</summary>
    public TaskCompletionEvaluation EvaluateTaskCompletion(IStepInputCheck inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        var unresolved = _steps.Where(s => !s.IsResolved).ToList();
        return new TaskCompletionEvaluation(
            unresolved.Select(s => s.StepId).ToList(),
            unresolved.Where(s => inputs.RequiredInputsSatisfied(s.StepId)).Select(s => s.StepId).ToList(),
            unresolved.Where(s => !inputs.RequiredInputsSatisfied(s.StepId)).Select(s => s.StepId).ToList());
    }

    /// <summary>
    /// All-or-nothing: completes every unresolved step in workflow order as COMPLETED (never SKIPPED) with <c>Bulk=true</c> events.
    /// If any unresolved step lacks required inputs nothing changes and COMPLETION_BLOCKED is returned. No unresolved steps yields an empty list.
    /// </summary>
    public Result<IReadOnlyList<WorkflowDomainEvent>> BulkCompleteUnresolved(IStepInputCheck inputs)
    {
        var evaluation = EvaluateTaskCompletion(inputs);
        if (evaluation.BlockedStepIds.Count > 0)
        {
            return evaluation.ToBlockedError();
        }

        var events = new List<WorkflowDomainEvent>();
        foreach (var step in _steps.Where(s => !s.IsResolved))
        {
            var from = step.Status;
            Resolve(step, StepStatus.Completed);
            events.Add(new StepCompleted(step.StepId, from, StepStatus.Completed, Bulk: true));
        }

        return Result<IReadOnlyList<WorkflowDomainEvent>>.Success(events);
    }

    /// <summary>Copy of the current state for persistence.</summary>
    public IReadOnlyList<StepSnapshot> ToSnapshots() => _steps.Select(s => s.ToSnapshot()).ToList();

    private static Result<IReadOnlyList<WorkflowDomainEvent>> One(WorkflowDomainEvent e) =>
        Result<IReadOnlyList<WorkflowDomainEvent>>.Success([e]);

    private static void Resolve(StepInstance step, StepStatus to)
    {
        step.Status = to;
        step.HasBeenResolved = true;
    }

    private static Error InvalidTransition(StepInstance step, string action) =>
        Error.Conflict(
            ErrorCodes.InvalidStatusTransition,
            $"Cannot {action} step {step.StepId} while it is {step.Status}.",
            new Dictionary<string, object?> { ["stepId"] = step.StepId, ["status"] = step.Status.ToString() });

    private StepInstance? Locate(int stepId, out Error? notFound)
    {
        var step = Find(stepId);
        notFound = step is null ? Error.NotFound($"Step {stepId} was not found in this workflow.") : null;
        return step;
    }

    /// <summary>
    /// Ordering guard (ordered workflows only): permitted if the step was resolved before (re-resolving after a reopen)
    /// or every lower-sequence step is resolved.
    /// </summary>
    private Error? OrderingError(StepInstance step)
    {
        if (!IsOrdered || step.HasBeenResolved)
        {
            return null;
        }

        var blockers = _steps.Where(s => s.Sequence < step.Sequence && !s.IsResolved).Select(s => s.StepId).ToList();
        return blockers.Count == 0
            ? null
            : Error.Conflict(
                ErrorCodes.StepOrderViolation,
                $"Step {step.StepId} cannot progress until earlier steps are resolved.",
                new Dictionary<string, object?> { ["stepId"] = step.StepId, ["blockingStepIds"] = blockers });
    }
}
