using System.ComponentModel.DataAnnotations;
using MatterFlow.WorkflowEngine.Contracts;

namespace MatterFlow.WorkflowEngine.Application.Workflows;

/// <summary>A Task Type that may use a workflow (the Task types column of the Workflows list).</summary>
/// <param name="TaskTypeId">Task Type id.</param>
/// <param name="Name">Its display name.</param>
/// <param name="IsActive">False for a deactivated Task Type.</param>
/// <param name="IsDefault">True when this workflow is the Task Type's default workflow.</param>
public sealed record WorkflowTaskTypeRef(
    [property: Required] int TaskTypeId,
    [property: Required] string Name,
    [property: Required] bool IsActive,
    [property: Required] bool IsDefault);

/// <summary>A workflow in the admin list.</summary>
/// <param name="WorkflowDefinitionId">Workflow id.</param>
/// <param name="Name">Name (unique).</param>
/// <param name="Description">Description.</param>
/// <param name="IsActive">False = not offered for new tasks even if a version is published.</param>
/// <param name="PublishedVersionId">The published version new tasks use, if any.</param>
/// <param name="PublishedVersionNo">Its number.</param>
/// <param name="PublishedStepCount">Its number of steps.</param>
/// <param name="DraftVersionId">The open draft, if any.</param>
/// <param name="DraftVersionNo">Its number.</param>
/// <param name="TaskTypes">The Task Types this workflow is eligible for, by name (all of them; the screen shows the first few).</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64).</param>
public sealed record WorkflowSummary(
    [property: Required] int WorkflowDefinitionId,
    [property: Required] string Name,
    string? Description,
    [property: Required] bool IsActive,
    int? PublishedVersionId,
    int? PublishedVersionNo,
    int? PublishedStepCount,
    int? DraftVersionId,
    int? DraftVersionNo,
    [property: Required] IReadOnlyList<WorkflowTaskTypeRef> TaskTypes,
    [property: Required] string RowVersion);

/// <summary>A version in a version list.</summary>
/// <param name="WorkflowVersionId">Version id.</param>
/// <param name="VersionNo">Version number within the workflow.</param>
/// <param name="Status">DRAFT, PUBLISHED or RETIRED.</param>
/// <param name="IsOrdered">True when steps must be resolved in sequence.</param>
/// <param name="StepCount">Number of steps.</param>
/// <param name="CreatedAtUtc">When the version was created.</param>
/// <param name="PublishedAtUtc">When it was published.</param>
/// <param name="PublishedByUserId">Who published it.</param>
/// <param name="RowVersion">Concurrency token (base64) to send back when saving, publishing or retiring.</param>
public sealed record WorkflowVersionSummary(
    [property: Required] int WorkflowVersionId,
    [property: Required] int VersionNo,
    [property: Required] WorkflowVersionStatus Status,
    [property: Required] bool IsOrdered,
    [property: Required] int StepCount,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? PublishedAtUtc,
    int? PublishedByUserId,
    [property: Required] string RowVersion);

/// <summary>A workflow with its versions.</summary>
/// <param name="Workflow">The workflow.</param>
/// <param name="Versions">All versions, newest first.</param>
public sealed record WorkflowDetail(
    [property: Required] WorkflowSummary Workflow,
    [property: Required] IReadOnlyList<WorkflowVersionSummary> Versions);

/// <summary>A step placed in a version.</summary>
/// <param name="WorkflowVersionStepId">Row id.</param>
/// <param name="SequenceNo">1-based position.</param>
/// <param name="SourceStepDefinitionId">Library step it was copied from.</param>
/// <param name="Title">Copied title (in a draft: as copied when the step was added; refreshed from the library at publish).</param>
/// <param name="Description">Copied description.</param>
/// <param name="Instructions">Copied instructions.</param>
/// <param name="DocumentationUrl">Copied documentation URL.</param>
/// <param name="StepFormVersionId">Pinned published input form version; null when the step has no inputs (in a draft: pinned at publish).</param>
/// <param name="IsSkippable">The step may be skipped.</param>
/// <param name="SkipCommentRequired">Skipping needs a comment.</param>
/// <param name="SourceStepActive">False when the library step has been deactivated since (informational).</param>
public sealed record WorkflowVersionStepModel(
    [property: Required] int WorkflowVersionStepId,
    [property: Required] int SequenceNo,
    [property: Required] int SourceStepDefinitionId,
    [property: Required] string Title,
    string? Description,
    string? Instructions,
    string? DocumentationUrl,
    int? StepFormVersionId,
    [property: Required] bool IsSkippable,
    [property: Required] bool SkipCommentRequired,
    [property: Required] bool SourceStepActive);

/// <summary>One version with its steps.</summary>
/// <param name="WorkflowDefinitionId">Workflow id.</param>
/// <param name="WorkflowName">Workflow name.</param>
/// <param name="Version">Version facts.</param>
/// <param name="Steps">Steps in sequence order.</param>
public sealed record WorkflowVersionDetail(
    [property: Required] int WorkflowDefinitionId,
    [property: Required] string WorkflowName,
    [property: Required] WorkflowVersionSummary Version,
    [property: Required] IReadOnlyList<WorkflowVersionStepModel> Steps);

/// <summary>Body to create a workflow. Its first draft (version 1) is created empty.</summary>
public sealed record CreateWorkflowRequest
{
    /// <summary>Unique name.</summary>
    [Required, StringLength(200)]
    public required string Name { get; init; }

    /// <summary>Description.</summary>
    [StringLength(1000)]
    public string? Description { get; init; }

    /// <summary>Whether the first draft is ordered (default true).</summary>
    public bool IsOrdered { get; init; } = true;
}

/// <summary>Body to change a workflow's name, description or active flag (not its versions).</summary>
public sealed record UpdateWorkflowRequest
{
    /// <summary>Unique name.</summary>
    [Required, StringLength(200)]
    public required string Name { get; init; }

    /// <summary>Description.</summary>
    [StringLength(1000)]
    public string? Description { get; init; }

    /// <summary>False stops the workflow being offered for new tasks.</summary>
    [Required]
    public required bool IsActive { get; init; }

    /// <summary>The row version the client saw (base64).</summary>
    [Required]
    public required string RowVersion { get; init; }
}

/// <summary>Body to start a new draft.</summary>
public sealed record CreateWorkflowDraftRequest
{
    /// <summary>The version to copy; defaults to the published version, else the newest.</summary>
    public int? FromVersionId { get; init; }
}

/// <summary>One placement in a draft: a library step with its per-workflow settings.</summary>
public sealed record WorkflowStepPlacement
{
    /// <summary>The library step. New placements must be active.</summary>
    [Required]
    public required int SourceStepDefinitionId { get; init; }

    /// <summary>The step may be skipped.</summary>
    public bool IsSkippable { get; init; }

    /// <summary>Skipping needs a comment (requires <see cref="IsSkippable"/>).</summary>
    public bool SkipCommentRequired { get; init; }
}

/// <summary>Body to replace the content of a draft: the ordered step list (order = position) and the execution mode.</summary>
public sealed record SaveWorkflowDraftRequest
{
    /// <summary>Ordered (steps resolved in sequence) or unordered.</summary>
    [Required]
    public required bool IsOrdered { get; init; }

    /// <summary>Steps in order. A step may appear once.</summary>
    [Required]
    public required IReadOnlyList<WorkflowStepPlacement> Steps { get; init; }

    /// <summary>The draft's row version (base64).</summary>
    [Required]
    public required string RowVersion { get; init; }
}

/// <summary>Body of the publish and retire actions.</summary>
public sealed record WorkflowVersionActionRequest
{
    /// <summary>The version's row version (base64).</summary>
    [Required]
    public required string RowVersion { get; init; }
}

/// <summary>Workflow list filters.</summary>
public sealed class WorkflowListQuery
{
    internal static readonly string[] Keys = ["page", "pageSize", "q", "isActive", "sort", "taskTypeId", "stepId"];

    /// <summary>Sort fields accepted by <see cref="Sort"/> (prefix with <c>-</c> for descending).</summary>
    internal static readonly string[] SortFields = ["name", "-name"];

    /// <summary>One of <c>name</c> (default) or <c>-name</c>.</summary>
    [StringLength(30)]
    public string? Sort { get; init; }

    /// <summary>Name or description fragment.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Filter by active state; omit for all.</summary>
    public bool? IsActive { get; init; }

    /// <summary>Only the workflows this Task Type may use (an unknown Task Type has none).</summary>
    public int? TaskTypeId { get; init; }

    /// <summary>Only the workflows with a version (any status) that contains this library step.</summary>
    public int? StepId { get; init; }

    /// <summary>1-based page.</summary>
    public int? Page { get; init; }

    /// <summary>Page size (default 25, max 100).</summary>
    public int? PageSize { get; init; }
}
