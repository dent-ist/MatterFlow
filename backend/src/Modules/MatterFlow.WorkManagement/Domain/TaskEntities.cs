using MatterFlow.SharedKernel.Entities;
using MatterFlow.SharedKernel.Tasks;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>
/// A unit of work for a Matter. Matter, Task Type, Workflow (via <see cref="WorkflowInstanceId"/>) and the request form version are fixed
/// at creation (addendum A; <c>TR_Task_Immutable</c>). The Project may change within the Matter (composite foreign key). Changes are audited by
/// the application services with explicit events (TASK_CREATED, TASK_STATUS_CHANGED, TASK_ASSIGNED, FIELD_CHANGED), so the entity is not
/// marked for the generic field interceptor.
/// </summary>
public class WorkTask : AuditedEntity<long>
{
    /// <summary>Human-friendly reference (<c>TSK-1042</c>), column <c>TaskNumber</c>.</summary>
    public string Number { get; set; } = string.Empty;

    public int MatterId { get; set; }

    public int? ProjectId { get; set; }

    public int TaskTypeId { get; set; }

    /// <summary>The request form version captured at creation; null when the Task Type has no request form fields.</summary>
    public int? FormVersionId { get; set; }

    public long WorkflowInstanceId { get; set; }

    public string Title { get; set; } = string.Empty;

    public string? Description { get; set; }

    public int PriorityId { get; set; }

    public TaskStatusCode Status { get; set; } = TaskStatusCode.New;

    public int? AssignedPodId { get; set; }

    public int? AssignedUserId { get; set; }

    /// <summary>When the current assignee was assigned (UTC); null while no user is assigned. Pod-only changes do not move it.</summary>
    public DateTime? AssignedAtUtc { get; set; }

    public string RequestorName { get; set; } = string.Empty;

    public string? RequestorEmail { get; set; }

    public DateTime? RequestedAtUtc { get; set; }

    /// <summary>Floating calendar due date; null means ASAP.</summary>
    public DateOnly? DueDate { get; set; }

    /// <summary>Absolute due instant, set only when a time was chosen.</summary>
    public DateTime? DueAtUtc { get; set; }

    public DateTime? DueSortKey { get; set; }

    public DateTime StatusChangedAtUtc { get; set; }

    public DateTime? CompletedAtUtc { get; set; }
}

/// <summary>
/// A comment on a Task. Here it only stores the mandatory CANCEL / ON_HOLD reason of a status change; the rich-text comment API arrives with its
/// own ticket. Soft-deleted comments are retained; CANCEL and ON_HOLD comments can never be deleted.
/// </summary>
public class TaskComment : AuditedEntity<long>
{
    public long TaskId { get; set; }

    public int AuthorUserId { get; set; }

    public TaskCommentPurpose Purpose { get; set; } = TaskCommentPurpose.Normal;

    /// <summary>Sanitized HTML (basic formatting only).</summary>
    public string BodyHtml { get; set; } = string.Empty;

    public DateTime? EditedAtUtc { get; set; }

    public bool IsDeleted { get; set; }

    public DateTime? DeletedAtUtc { get; set; }

    public int? DeletedByUserId { get; set; }
}

/// <summary>Why a revision row exists: the body before an edit, or the final body at deletion.</summary>
public static class CommentRevisionReasons
{
    public const string Edit = "EDIT";
    public const string Delete = "DELETE";
}

/// <summary>Append-only history of a comment: its sanitized body as it was before an edit (or at deletion).</summary>
public class TaskCommentRevision : Entity<long>
{
    public long TaskCommentId { get; set; }

    public string BodyHtml { get; set; } = string.Empty;

    /// <summary>EDIT or DELETE (<see cref="CommentRevisionReasons"/>).</summary>
    public string Reason { get; set; } = CommentRevisionReasons.Edit;

    public DateTime RevisedAtUtc { get; set; }

    public int? RevisedByUserId { get; set; }
}

/// <summary>
/// A link between a Task and an Asset of the same Matter (composite foreign keys), optionally with a relationship role (Source, Destination,
/// Subject, Result, ...). Keyed by (TaskId, AssetId); unlinking deletes the row.
/// </summary>
public class TaskAsset : IAuditStamped
{
    public long TaskId { get; set; }

    public int AssetId { get; set; }

    public int MatterId { get; set; }

    public int? AssetLinkRoleId { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    public int? CreatedByUserId { get; set; }

    public DateTime? ModifiedAtUtc { get; set; }

    public int? ModifiedByUserId { get; set; }

    public byte[] RowVersion { get; set; } = [];
}
