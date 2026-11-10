namespace MatterFlow.WorkManagement.Domain;

/// <summary>Why a comment exists. CANCEL and ON_HOLD comments are the stored reason for a status change.</summary>
public enum TaskCommentPurpose
{
    Normal = 0,
    Cancel = 1,
    OnHold = 2,
}

public static class TaskCommentPurposeExtensions
{
    public static string ToCode(this TaskCommentPurpose purpose) => purpose switch
    {
        TaskCommentPurpose.Normal => "NORMAL",
        TaskCommentPurpose.Cancel => "CANCEL",
        TaskCommentPurpose.OnHold => "ON_HOLD",
        _ => throw new ArgumentOutOfRangeException(nameof(purpose)),
    };

    /// <summary>Cancel and On Hold reason comments are part of the audit trail and cannot be deleted (addendum O).</summary>
    public static bool IsDeletable(this TaskCommentPurpose purpose) => purpose == TaskCommentPurpose.Normal;
}
