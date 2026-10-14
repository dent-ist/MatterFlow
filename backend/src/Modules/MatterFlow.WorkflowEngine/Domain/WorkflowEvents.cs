namespace MatterFlow.WorkflowEngine.Domain;

/// <summary>A domain event produced by a successful step operation; callers persist these to the audit trail.</summary>
public abstract record WorkflowDomainEvent(int StepId, StepStatus From, StepStatus To);

public sealed record StepStarted(int StepId, StepStatus From, StepStatus To) : WorkflowDomainEvent(StepId, From, To);

/// <summary>Draft values saved; From and To differ only for PENDING to IN_PROGRESS.</summary>
public sealed record StepValuesSaved(int StepId, StepStatus From, StepStatus To) : WorkflowDomainEvent(StepId, From, To);

/// <summary><paramref name="Bulk"/> is true when completed by bulk-complete (audit flag <c>bulk=true</c>).</summary>
public sealed record StepCompleted(int StepId, StepStatus From, StepStatus To, bool Bulk) : WorkflowDomainEvent(StepId, From, To);

public sealed record StepSkipped(int StepId, StepStatus From, StepStatus To, string? Comment) : WorkflowDomainEvent(StepId, From, To);

public sealed record StepReopened(int StepId, StepStatus From, StepStatus To) : WorkflowDomainEvent(StepId, From, To);
