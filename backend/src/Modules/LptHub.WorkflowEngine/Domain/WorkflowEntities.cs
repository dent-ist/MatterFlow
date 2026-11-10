using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;
using MatterFlow.WorkflowEngine.Contracts;

namespace MatterFlow.WorkflowEngine.Domain;

/// <summary>
/// A reusable step in the library (title, description, instructions, documentation URL). Its input fields live in the
/// <c>FormDefinition</c> of scope STEP owned by this step (Configuration module). Editing it never changes a published
/// workflow version (addendum A): versions hold their own copy.
/// </summary>
[Audited(ObjectType = "StepDefinition")]
public class StepDefinition : AuditedEntity<int>
{
    public string Title { get; set; } = string.Empty;

    public string? Description { get; set; }

    public string? Instructions { get; set; }

    public string? DocumentationUrl { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>
/// A free-form tag on library steps ("Relativity", "Processing"). One row per distinct tag: <see cref="Key"/> is the normalised,
/// case-insensitive lookup key and <see cref="Name"/> the display spelling of the first time it was entered. Tags are metadata of the
/// library step only; they are not part of a published workflow version.
/// </summary>
public class StepTag : Entity<int>
{
    public string Key { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; }
}

/// <summary>A tag on a step, in the order the admin entered the tags.</summary>
public class StepDefinitionTag
{
    public int StepDefinitionId { get; set; }

    public int StepTagId { get; set; }

    public StepTag Tag { get; set; } = null!;

    public int SortOrder { get; set; }
}

/// <summary>A named, reusable workflow. Its content lives in versions.</summary>
[Audited(ObjectType = "WorkflowDefinition")]
public class WorkflowDefinition : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>
/// One version of a workflow. A DRAFT is editable; PUBLISHED and RETIRED versions are immutable (service guard and
/// <c>TR_WorkflowVersion_Immutable</c>). Lifecycle changes are written as explicit semantic events.
/// </summary>
public class WorkflowVersion : AuditedEntity<int>
{
    public int WorkflowDefinitionId { get; set; }

    public int VersionNo { get; set; }

    public WorkflowVersionStatus Status { get; set; }

    public bool IsOrdered { get; set; } = true;

    public DateTime? PublishedAt { get; set; }

    public int? PublishedByUserId { get; set; }

    public List<WorkflowVersionStep> Steps { get; set; } = [];
}

/// <summary>
/// A step placed in a workflow version: the text copied from the library step (refreshed from it when the version is published),
/// the pinned published input form version, and the per-workflow settings.
/// </summary>
public class WorkflowVersionStep : Entity<int>
{
    public int WorkflowVersionId { get; set; }

    public int SequenceNo { get; set; }

    public int SourceStepDefinitionId { get; set; }

    public string Title { get; set; } = string.Empty;

    public string? Description { get; set; }

    public string? Instructions { get; set; }

    public string? DocumentationUrl { get; set; }

    public int? StepFormVersionId { get; set; }

    public bool IsSkippable { get; set; }

    public bool SkipCommentRequired { get; set; }
}
