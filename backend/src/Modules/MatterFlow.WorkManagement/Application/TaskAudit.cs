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
            Summary = Clip($"{comment.Purpose.ToCode()} comment added"),
        });

    public static string Clip(string text) => text.Length <= 500 ? text : text[..500];
}
