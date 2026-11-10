namespace MatterFlow.Notifications.Domain;

/// <summary>
/// One in-app notification for one recipient (script 29). Written by the server in the same transaction as the action that caused it;
/// derived data, not audited. The text is a snapshot. Read state is the only mutable part.
/// </summary>
public class Notification
{
    /// <summary>Identity; also the poll cursor.</summary>
    public long Id { get; set; }

    public int RecipientUserId { get; set; }

    /// <summary>The event code (the <c>NotificationEventType</c> name).</summary>
    public string EventType { get; set; } = string.Empty;

    /// <summary><c>Task</c> or <c>Matter</c>.</summary>
    public string ObjectKind { get; set; } = string.Empty;

    public long ObjectId { get; set; }

    public int? MatterId { get; set; }

    public int? ActorUserId { get; set; }

    public string Message { get; set; } = string.Empty;

    public string DedupeKey { get; set; } = string.Empty;

    public DateTime CreatedUtc { get; set; }

    /// <summary>Null while unread.</summary>
    public DateTime? ReadUtc { get; set; }
}

/// <summary>A switch that differs from the default. The default is on, so only "off" rows normally exist (script 29).</summary>
public class NotificationPreference
{
    public int UserId { get; set; }

    public string EventType { get; set; } = string.Empty;

    public bool Enabled { get; set; }

    public DateTime UpdatedUtc { get; set; }
}
