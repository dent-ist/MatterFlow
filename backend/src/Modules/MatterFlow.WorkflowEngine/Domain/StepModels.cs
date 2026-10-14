namespace MatterFlow.WorkflowEngine.Domain;

/// <summary>Step instance states (architecture 8.2). "Resolved" means <see cref="Completed"/> or <see cref="Skipped"/>.</summary>
public enum StepStatus
{
    Pending,
    InProgress,
    Completed,
    Skipped,
}

/// <summary>Fixed internal Task states (architecture 8.3); labels are configurable elsewhere, the code is stable.</summary>
public enum TaskStatusCode
{
    New,
    InProgress,
    OnHold,
    Completed,
    Cancelled,
}

/// <summary>Supplies whether a step's required inputs (visible required form values) are all present. Implemented by the forms engine adapter.</summary>
public interface IStepInputCheck
{
    bool RequiredInputsSatisfied(int stepId);
}

/// <summary>Simple <see cref="IStepInputCheck"/> implementations for callers and tests.</summary>
public sealed class StepInputCheck : IStepInputCheck
{
    private readonly Func<int, bool> _check;

    private StepInputCheck(Func<int, bool> check) => _check = check;

    public static StepInputCheck AllSatisfied { get; } = new(_ => true);

    public static StepInputCheck NoneSatisfied { get; } = new(_ => false);

    /// <summary>Every step is satisfied except the given ones.</summary>
    public static StepInputCheck MissingFor(params int[] stepIds)
    {
        var missing = new HashSet<int>(stepIds);
        return new StepInputCheck(id => !missing.Contains(id));
    }

    public static StepInputCheck From(Func<int, bool> check) => new(check ?? throw new ArgumentNullException(nameof(check)));

    public bool RequiredInputsSatisfied(int stepId) => _check(stepId);
}

/// <summary>Immutable per-step configuration copied from the published workflow version.</summary>
public sealed record StepDefinition(int StepId, int Sequence, bool IsSkippable, bool SkipCommentRequired);

/// <summary>Persisted state of a step used to rebuild a <see cref="WorkflowInstance"/>.</summary>
public sealed record StepSnapshot(StepDefinition Definition, StepStatus Status, bool HasBeenResolved, string? SkipComment);

/// <summary>A step within a workflow instance. State only changes through <see cref="WorkflowInstance"/>.</summary>
public sealed class StepInstance
{
    internal StepInstance(StepDefinition definition, StepStatus status, bool hasBeenResolved, string? skipComment)
    {
        Definition = definition;
        Status = status;
        HasBeenResolved = hasBeenResolved;
        SkipComment = skipComment;
    }

    public StepDefinition Definition { get; }

    public int StepId => Definition.StepId;

    public int Sequence => Definition.Sequence;

    public StepStatus Status { get; internal set; }

    /// <summary>True once the step has been resolved at least once (the persisted <c>FirstResolvedAt IS NOT NULL</c>); never cleared by reopen.</summary>
    public bool HasBeenResolved { get; internal set; }

    /// <summary>Retained across reopen.</summary>
    public string? SkipComment { get; internal set; }

    public bool IsResolved => Status is StepStatus.Completed or StepStatus.Skipped;

    internal StepSnapshot ToSnapshot() => new(Definition, Status, HasBeenResolved, SkipComment);
}
