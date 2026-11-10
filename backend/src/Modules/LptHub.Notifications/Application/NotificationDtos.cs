using System.ComponentModel.DataAnnotations;

namespace MatterFlow.Notifications.Application;

/// <summary>One notification as the recipient sees it. The client builds the link from <c>objectKind</c> and <c>objectId</c>.</summary>
/// <param name="Id">Notification id; also the poll cursor.</param>
/// <param name="EventType">Event code, for example <c>TaskAssigned</c>.</param>
/// <param name="ObjectKind"><c>Task</c> or <c>Matter</c>.</param>
/// <param name="ObjectId">Task id or matter id.</param>
/// <param name="MatterId">Matter of the object, if any.</param>
/// <param name="Message">Snapshot text written when the notification was created (plain text).</param>
/// <param name="CreatedUtc">When it was created (UTC).</param>
/// <param name="ReadUtc">When it was read (UTC); null while unread.</param>
/// <param name="IsRead">True when read.</param>
/// <param name="GroupKey">Set on the overdue notices (PM v2, #884): <c>overdue:yyyy-MM-dd:manager</c> (the matter's managers) or <c>overdue:yyyy-MM-dd:assignee</c>, the day they were created (UTC). Notices that share a key are shown as one group; nothing is merged or removed, every notice stays readable and markable. Null for every other notice.</param>
public sealed record NotificationItem(
    long Id,
    string EventType,
    string ObjectKind,
    long ObjectId,
    int? MatterId,
    string Message,
    DateTime CreatedUtc,
    DateTime? ReadUtc,
    bool IsRead,
    string? GroupKey = null);

/// <summary>A page of the caller's notifications for objects they may view now.</summary>
/// <param name="Items">The page, newest first.</param>
/// <param name="TotalCount">Number of visible notifications matching the filter.</param>
/// <param name="Page">1-based page.</param>
/// <param name="PageSize">Page size.</param>
public sealed record NotificationListResponse(IReadOnlyList<NotificationItem> Items, int TotalCount, int Page, int PageSize);

/// <summary>The 30-second poll result.</summary>
/// <param name="UnreadCount">Visible unread entries, at most 100 (the client shows 99+). An entry is one notification, except that the unread overdue notices of one <c>GroupKey</c> count once, as the bell and the list show them (PM v2, #884).</param>
/// <param name="LatestId">Highest visible notification id; the client's next <c>sinceId</c>.</param>
/// <param name="Items">Visible notifications newer than <c>sinceId</c>, newest first, at most 20; empty for <c>initial=true</c>.</param>
public sealed record NotificationPollResponse(int UnreadCount, long LatestId, IReadOnlyList<NotificationItem> Items);

/// <summary>Result of marking everything read.</summary>
/// <param name="Marked">How many notifications were newly marked read.</param>
public sealed record MarkAllReadResponse(int Marked);

/// <summary>One switch on My profile.</summary>
/// <param name="EventType">Event code.</param>
/// <param name="Enabled">True (the default) when the event creates a notification for the caller.</param>
/// <param name="Group"><c>Technician</c>, <c>ProjectManager</c> or <c>PodLead</c>.</param>
/// <param name="Label">The wording of the switch.</param>
public sealed record NotificationPreferenceItem(string EventType, bool Enabled, string Group, string Label);

/// <summary>The caller's switches, one per event type, in display order.</summary>
public sealed record NotificationPreferencesResponse(IReadOnlyList<NotificationPreferenceItem> Items);

/// <summary>One switch to set.</summary>
public sealed record NotificationPreferenceInput
{
    /// <summary>Event code; unknown codes are a 400.</summary>
    [Required]
    public string EventType { get; init; } = string.Empty;

    public bool Enabled { get; init; }
}

/// <summary>The switches to set (the full list; an event type that is left out keeps its current value).</summary>
public sealed record UpdateNotificationPreferencesRequest
{
    [Required]
    public IReadOnlyList<NotificationPreferenceInput> Items { get; init; } = [];
}

/// <summary>Query of the notification list. <c>filter</c> is <c>all</c> (default) or <c>unread</c>.</summary>
public sealed record NotificationListQuery
{
    public static readonly IReadOnlyCollection<string> Keys = ["filter", "page", "pageSize"];

    public string? Filter { get; init; }

    public int? Page { get; init; }

    public int? PageSize { get; init; }
}
