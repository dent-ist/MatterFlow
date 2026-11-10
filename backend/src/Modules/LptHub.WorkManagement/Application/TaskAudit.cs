using MatterFlow.Audit.Contracts;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;

namespace MatterFlow.WorkManagement.Application;

/// <summary>The explicit audit events of Task commands (architecture 9). All are queued on the shared writer and persisted by the next SaveChanges.</summary>
internal static class TaskAudit
{
    public static void StatusChanged(IAuditWriter audit, WorkTask task, TaskStatusCode from, TaskStatusCode to, string cause, long? commentId = null, string? note = null)
    {
        var summary = $"cause={cause}" + (commentId is null ? string.Empty : $"; commentId={commentId}") + (note is null ? string.Empty : "; " + note);
        audit.Write(new AuditEntry
        {
            EventType = AuditEventTypes.TaskStatusChanged,
            ObjectType = TaskSupport.TaskObjectType,
            ObjectId = TaskSupport.Id(task.Id),
            TaskId = task.Id,
            MatterId = task.MatterId,
            FieldKey = "status",
            OldValue = from.ToCode(),
            NewValue = to.ToCode(),
            Summary = Clip(summary),
        });
    }

    public static void CommentAdded(IAuditWriter audit, WorkTask task, TaskComment comment) =>
        audit.Write(new AuditEntry
        {
            EventType = TaskSupport.CommentAddedEvent,
            ObjectType = "TaskComment",
            ObjectId = TaskSupport.Id(comment.Id),
            TaskId = task.Id,
            MatterId = task.MatterId,
            FieldKey = "purpose",
            NewValue = comment.Purpose.ToCode(),
            Summary = Clip(comment.Purpose == TaskCommentPurpose.Normal ? "Comment added" : $"{comment.Purpose.ToCode()} comment added"),
        });

    public static void CommentEdited(IAuditWriter audit, WorkTask task, TaskComment comment) =>
        audit.Write(new AuditEntry
        {
            EventType = TaskSupport.CommentEditedEvent,
            ObjectType = "TaskComment",
            ObjectId = TaskSupport.Id(comment.Id),
            TaskId = task.Id,
            MatterId = task.MatterId,
            FieldKey = "purpose",
            NewValue = comment.Purpose.ToCode(),
            Summary = "Comment edited",
        });

    public static void CommentDeleted(IAuditWriter audit, WorkTask task, TaskComment comment) =>
        audit.Write(new AuditEntry
        {
            EventType = TaskSupport.CommentDeletedEvent,
            ObjectType = "TaskComment",
            ObjectId = TaskSupport.Id(comment.Id),
            TaskId = task.Id,
            MatterId = task.MatterId,
            FieldKey = "purpose",
            NewValue = comment.Purpose.ToCode(),
            Summary = "Comment deleted",
        });

    public static void AssetLinked(IAuditWriter audit, WorkTask task, int assetId, string assetName, string? roleName) =>
        AssetEvent(audit, task, assetId, TaskSupport.AssetLinkedEvent, null, roleName, Clip($"Linked asset '{assetName}'" + (roleName is null ? string.Empty : $" as {roleName}")));

    public static void AssetUnlinked(IAuditWriter audit, WorkTask task, int assetId, string assetName, string? roleName) =>
        AssetEvent(audit, task, assetId, TaskSupport.AssetUnlinkedEvent, roleName, null, Clip($"Unlinked asset '{assetName}'"));

    public static void AssetRoleChanged(IAuditWriter audit, WorkTask task, int assetId, string assetName, string? oldRole, string? newRole) =>
        AssetEvent(audit, task, assetId, TaskSupport.AssetRoleChangedEvent, oldRole, newRole, Clip($"Asset '{assetName}' role changed from {oldRole ?? "none"} to {newRole ?? "none"}"));

    private static void AssetEvent(IAuditWriter audit, WorkTask task, int assetId, string eventType, string? oldRole, string? newRole, string summary) =>
        audit.Write(new AuditEntry
        {
            EventType = eventType,
            ObjectType = "TaskAsset",
            ObjectId = $"{task.Id}:{assetId}",
            TaskId = task.Id,
            MatterId = task.MatterId,
            FieldKey = "role",
            OldValue = oldRole,
            NewValue = newRole,
            Summary = summary,
        });

    public static string Clip(string text) => text.Length <= 500 ? text : text[..500];
}
