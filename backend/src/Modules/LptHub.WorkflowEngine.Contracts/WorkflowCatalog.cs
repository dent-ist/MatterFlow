using MatterFlow.SharedKernel.Results;

namespace MatterFlow.WorkflowEngine.Contracts;

/// <summary>Lifecycle of one workflow version (architecture 8.1).</summary>
public enum WorkflowVersionStatus
{
    /// <summary>Editable; at most one per workflow.</summary>
    Draft,

    /// <summary>Immutable and offered for new tasks; at most one per workflow.</summary>
    Published,

    /// <summary>Immutable and superseded; existing tasks keep running on it.</summary>
    Retired,
}

/// <summary>A workflow's current published version, in short.</summary>
/// <param name="WorkflowDefinitionId">The workflow (what a Task Type lists as eligible).</param>
/// <param name="Name">Workflow name.</param>
/// <param name="Description">Workflow description.</param>
/// <param name="WorkflowVersionId">The published version a new task would be pinned to.</param>
/// <param name="VersionNo">Its version number.</param>
/// <param name="IsOrdered">True when steps must be resolved in sequence.</param>
/// <param name="StepCount">Number of steps.</param>
/// <param name="PublishedAtUtc">When this version was published.</param>
public sealed record PublishedWorkflowSummary(
    int WorkflowDefinitionId,
    string Name,
    string? Description,
    int WorkflowVersionId,
    int VersionNo,
    bool IsOrdered,
    int StepCount,
    DateTime PublishedAtUtc);

/// <summary>One step of a workflow version as snapshotted at publish time (never changes afterwards).</summary>
/// <param name="WorkflowVersionStepId">Step row id (what a step instance points at).</param>
/// <param name="SequenceNo">1-based position.</param>
/// <param name="SourceStepDefinitionId">The library step it was copied from (informational).</param>
/// <param name="Title">Snapshot title.</param>
/// <param name="Description">Snapshot description.</param>
/// <param name="Instructions">Snapshot instructions.</param>
/// <param name="DocumentationUrl">Snapshot documentation URL.</param>
/// <param name="StepFormVersionId">The pinned PUBLISHED form version of the step inputs; null when the step has no inputs.</param>
/// <param name="IsSkippable">Whether the step may be skipped.</param>
/// <param name="SkipCommentRequired">Whether skipping needs a comment (implies skippable).</param>
public sealed record WorkflowStepSnapshot(
    int WorkflowVersionStepId,
    int SequenceNo,
    int SourceStepDefinitionId,
    string Title,
    string? Description,
    string? Instructions,
    string? DocumentationUrl,
    int? StepFormVersionId,
    bool IsSkippable,
    bool SkipCommentRequired);

/// <summary>A workflow version with its steps in order.</summary>
/// <param name="WorkflowDefinitionId">The workflow.</param>
/// <param name="Name">Workflow name (current).</param>
/// <param name="WorkflowVersionId">The version.</param>
/// <param name="VersionNo">Its number.</param>
/// <param name="Status">Its status.</param>
/// <param name="IsOrdered">True when steps must be resolved in sequence.</param>
/// <param name="Steps">Steps in sequence order.</param>
public sealed record WorkflowVersionSnapshot(
    int WorkflowDefinitionId,
    string Name,
    int WorkflowVersionId,
    int VersionNo,
    WorkflowVersionStatus Status,
    bool IsOrdered,
    IReadOnlyList<WorkflowStepSnapshot> Steps);

/// <summary>
/// Read side of the workflow configuration for other modules (Task Types for eligibility, Tasks for instantiation).
/// Only active workflows with a published version are offered; a version is resolved by the workflow's definition id and
/// the resolved version is immutable, so callers may keep its ids.
/// </summary>
public interface IWorkflowCatalog
{
    /// <summary>Active workflows that have a published version, by name.</summary>
    Task<IReadOnlyList<PublishedWorkflowSummary>> ListPublishedAsync(CancellationToken cancellationToken = default);

    /// <summary>The published summary of one workflow, or null when it does not exist, is inactive or has no published version.</summary>
    Task<PublishedWorkflowSummary?> GetPublishedSummaryAsync(int workflowDefinitionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The workflow's current PUBLISHED version with its steps. Failure: NOT_FOUND for an unknown workflow,
    /// WORKFLOW_NOT_PUBLISHED when it is inactive or has no published version.
    /// </summary>
    Task<Result<WorkflowVersionSnapshot>> GetPublishedVersionAsync(int workflowDefinitionId, CancellationToken cancellationToken = default);

    /// <summary>Any version (including retired ones that existing tasks run on) with its steps, or null.</summary>
    Task<WorkflowVersionSnapshot?> GetVersionAsync(int workflowVersionId, CancellationToken cancellationToken = default);

    /// <summary>True when the workflow exists (any state); used to validate ids stored by other modules.</summary>
    Task<bool> ExistsAsync(int workflowDefinitionId, CancellationToken cancellationToken = default);
}
