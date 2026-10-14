using System.ComponentModel.DataAnnotations;
using MatterFlow.WorkManagement.Domain;

namespace MatterFlow.WorkManagement.Application;

// ---- comments

/// <summary>A comment on a Task. <c>bodyHtml</c> is sanitized basic formatting (p, br, strong, b, em, i, u, ul, ol, li, a) and safe to render.</summary>
/// <param name="CommentId">Comment id.</param>
/// <param name="TaskId">The Task.</param>
/// <param name="Purpose"><c>NORMAL</c>, or <c>CANCEL</c> / <c>ON_HOLD</c> for the stored reason of a status change.</param>
/// <param name="PurposeLabel">Tag to show for a reason comment ("Cancellation reason", "On hold reason"); null for a normal comment.</param>
/// <param name="BodyHtml">Sanitized HTML.</param>
/// <param name="Author">Who wrote it.</param>
/// <param name="CreatedAtUtc">When it was posted (UTC).</param>
/// <param name="EditedAtUtc">When it was last edited (UTC), if ever.</param>
/// <param name="IsEdited">True when the comment was edited (the history lists the earlier versions).</param>
/// <param name="CanEdit">True when the caller wrote it and may comment.</param>
/// <param name="CanDelete">True when the caller wrote it, may comment, and the comment is deletable (never a Cancel or On Hold reason).</param>
/// <param name="RowVersion">Concurrency token (base64); send it back when editing.</param>
public sealed record TaskCommentResponse(
    [property: Required] long CommentId,
    [property: Required] long TaskId,
    [property: Required] string Purpose,
    string? PurposeLabel,
    [property: Required] string BodyHtml,
    [property: Required] TaskUserRef Author,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? EditedAtUtc,
    [property: Required] bool IsEdited,
    [property: Required] bool CanEdit,
    [property: Required] bool CanDelete,
    [property: Required] string RowVersion);

/// <summary>The comments of a Task, hidden (soft-deleted) ones excluded.</summary>
public sealed record TaskCommentListResponse([property: Required] IReadOnlyList<TaskCommentResponse> Items, [property: Required] int Total);

/// <summary>An earlier version of an edited comment.</summary>
/// <param name="RevisionId">Revision id.</param>
/// <param name="BodyHtml">The sanitized body as it was before the edit.</param>
/// <param name="Reason"><c>EDIT</c>, or <c>DELETE</c> for the final body kept when the comment was deleted.</param>
/// <param name="RevisedAtUtc">When the edit was made (UTC).</param>
/// <param name="RevisedBy">Who made it.</param>
public sealed record TaskCommentRevisionResponse(
    [property: Required] long RevisionId,
    [property: Required] string BodyHtml,
    [property: Required] string Reason,
    [property: Required] DateTime RevisedAtUtc,
    TaskUserRef? RevisedBy);

/// <summary>The earlier versions of a comment, oldest first.</summary>
public sealed record TaskCommentRevisionListResponse([property: Required] IReadOnlyList<TaskCommentRevisionResponse> Items);

/// <summary>Posts a comment.</summary>
public sealed class AddTaskCommentRequest
{
    /// <summary>The comment as HTML; sanitized on the server to basic formatting (max 20000 characters, not empty).</summary>
    [Required]
    public string BodyHtml { get; init; } = string.Empty;
}

/// <summary>Edits one's own comment.</summary>
public sealed class EditTaskCommentRequest
{
    /// <summary>The new body as HTML; sanitized on the server.</summary>
    [Required]
    public string BodyHtml { get; init; } = string.Empty;

    /// <summary>The comment's <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

// ---- asset links

/// <summary>An Asset linked to a Task.</summary>
/// <param name="AssetId">Asset id.</param>
/// <param name="DisplayName">Asset name.</param>
/// <param name="AssetTypeName">Asset Type name.</param>
/// <param name="ExternalReference">URL, workspace id or media label, if any.</param>
/// <param name="IsActive">False once the Asset was deactivated (the link stays).</param>
/// <param name="AssetLinkRoleId">The relationship (Source, Destination, Subject, Result, ...), if one was chosen.</param>
/// <param name="AssetLinkRoleName">Name of that relationship.</param>
/// <param name="LinkedAtUtc">When the link was made (UTC).</param>
/// <param name="LinkedBy">Who made it.</param>
/// <param name="RowVersion">Concurrency token (base64); optional when changing the role.</param>
public sealed record TaskAssetLinkResponse(
    [property: Required] int AssetId,
    [property: Required] string DisplayName,
    [property: Required] string AssetTypeName,
    string? ExternalReference,
    [property: Required] bool IsActive,
    int? AssetLinkRoleId,
    string? AssetLinkRoleName,
    [property: Required] DateTime LinkedAtUtc,
    TaskUserRef? LinkedBy,
    [property: Required] string RowVersion);

/// <summary>The Assets linked to a Task, with whether the caller may change links now.</summary>
/// <param name="Items">The links, newest first.</param>
/// <param name="CanEdit">True when the Task is open (New, In Progress, On Hold) and the caller may link assets (Task.Edit and Asset.Link).</param>
public sealed record TaskAssetLinkListResponse([property: Required] IReadOnlyList<TaskAssetLinkResponse> Items, [property: Required] bool CanEdit);

/// <summary>Links an Asset of the Task's Matter.</summary>
public sealed class LinkTaskAssetRequest
{
    /// <summary>The Asset; it must be active and belong to the Task's Matter.</summary>
    [Required, Range(1, int.MaxValue)]
    public int AssetId { get; init; }

    /// <summary>Optional relationship: an active Asset Link Role.</summary>
    public int? AssetLinkRoleId { get; init; }
}

/// <summary>Changes (or clears) the relationship of a link.</summary>
public sealed class ChangeTaskAssetRoleRequest
{
    /// <summary>The new role, or null to clear it. A role must be active unless it is the one already set.</summary>
    public int? AssetLinkRoleId { get; init; }

    /// <summary>The workflow (or link) <c>rowVersion</c> last read; a mismatch is 409 CONCURRENCY_CONFLICT.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

// ---- activity

/// <summary>One entry of the Task activity timeline.</summary>
/// <param name="EventId">Audit event id (also the paging cursor).</param>
/// <param name="OccurredAtUtc">When it happened (UTC).</param>
/// <param name="EventType">Audit event type, for example <c>TASK_STATUS_CHANGED</c>.</param>
/// <param name="Category">TASK, STATUS, ASSIGNMENT, FIELDS, WORKFLOW, COMMENTS or ASSETS (for filters).</param>
/// <param name="Actor">Who did it; null for the system.</param>
/// <param name="Summary">Readable sentence, for example "Status changed from In Progress to On Hold".</param>
/// <param name="FieldKey">The field it concerns, if any.</param>
/// <param name="OldValue">Readable old value; only for callers holding Audit.View.</param>
/// <param name="NewValue">Readable new value; only for callers holding Audit.View.</param>
public sealed record TaskActivityItem(
    [property: Required] long EventId,
    [property: Required] DateTime OccurredAtUtc,
    [property: Required] string EventType,
    [property: Required] string Category,
    TaskUserRef? Actor,
    [property: Required] string Summary,
    string? FieldKey,
    string? OldValue,
    string? NewValue);

/// <summary>A page of the activity timeline, newest first.</summary>
/// <param name="Items">The entries.</param>
/// <param name="NextCursor">Pass as <c>cursor</c> to load older entries; null on the last page.</param>
/// <param name="CanViewChanges">True when old and new values are included (caller holds Audit.View).</param>
public sealed record TaskActivityPage(
    [property: Required] IReadOnlyList<TaskActivityItem> Items,
    string? NextCursor,
    [property: Required] bool CanViewChanges);

internal static class CommentLabels
{
    public static string? PurposeLabel(TaskCommentPurpose purpose) => purpose switch
    {
        TaskCommentPurpose.Cancel => "Cancellation reason",
        TaskCommentPurpose.OnHold => "On hold reason",
        _ => null,
    };
}
