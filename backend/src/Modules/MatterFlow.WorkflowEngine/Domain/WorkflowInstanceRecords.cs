using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.WorkflowEngine.Domain;

/// <summary>
/// Persisted workflow instance (table <c>WorkflowInstance</c>, script 11). Pinned to the published version it was created from. Not
/// <c>[Audited]</c>: step actions write explicit semantic audit events. <see cref="Revision"/> is bumped by every step operation so that
/// concurrent operations on one instance collide on this row's rowversion.
/// </summary>
public class WorkflowInstanceRecord : AuditedEntity<long>
{
    public int WorkflowVersionId { get; set; }

    public bool IsOrdered { get; set; }

    public int Revision { get; set; }

    public List<StepInstanceRecord> Steps { get; set; } = [];
}

/// <summary>Persisted step instance (table <c>StepInstance</c>): a snapshot of the version step plus its execution state.</summary>
public class StepInstanceRecord : AuditedEntity<int>
{
    public long WorkflowInstanceId { get; set; }

    public int WorkflowVersionStepId { get; set; }

    public int SequenceNo { get; set; }

    public string Title { get; set; } = string.Empty;

    public string? Description { get; set; }

    public string? Instructions { get; set; }

    public string? DocumentationUrl { get; set; }

    public bool IsSkippable { get; set; }

    public bool SkipCommentRequired { get; set; }

    public int? InputFormVersionId { get; set; }

    public int? InputFormDefinitionId { get; set; }

    public StepStatus Status { get; set; } = StepStatus.Pending;

    public string? SkipComment { get; set; }

    public DateTime? FirstResolvedAt { get; set; }

    public DateTime? ResolvedAt { get; set; }

    public int? ResolvedByUserId { get; set; }
}
