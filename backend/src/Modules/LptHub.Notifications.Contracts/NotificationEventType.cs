namespace MatterFlow.Notifications.Contracts;

/// <summary>
/// The notification event types (docs/ux/notifications-review/README.md section 3). The numeric value is the priority: when two rules hit the same
/// person for the same action, the lower value wins. Mentions share priority 3 with comments and are reserved (deferred by the owner).
/// The two stages of the scheduled events (due-soon / overdue, unassigned / on-hold) are part of the dedupe key, not of the type.
/// </summary>
public enum NotificationEventType
{
    /// <summary>Technician: a task was assigned to you.</summary>
    TaskAssigned = 1,

    /// <summary>Technician: your task is due within a day or overdue (scheduler).</summary>
    TaskDue = 2,

    /// <summary>Technician: a comment on your task.</summary>
    TaskComment = 3,

    /// <summary>Technician: you were mentioned in a comment (reserved, not produced in this release).</summary>
    TaskMention = 30,

    /// <summary>Project manager: a task on your matter became overdue (scheduler).</summary>
    MatterTaskOverdue = 4,

    /// <summary>Project manager: a task was created on your matter.</summary>
    MatterTaskCreated = 5,

    /// <summary>Project manager: a task on your matter is unassigned or on hold for a while (scheduler).</summary>
    MatterTaskStalled = 6,

    /// <summary>You were set as Primary or Secondary manager of a matter.</summary>
    MatterManagerSet = 7,

    /// <summary>Pod lead: a task in your pod became unassigned.</summary>
    PodTaskUnassigned = 8,
}

/// <summary>Who an event type is meant for (the groups of the profile switches).</summary>
public enum NotificationAudience
{
    Technician,
    ProjectManager,
    PodLead,
}

/// <summary>Static facts about the event types: stored code, priority, preference switch and wording of the switch.</summary>
public static class NotificationEventTypes
{
    /// <summary>The event types that have a switch on My profile, in display order (the mention follows the comment switch).</summary>
    public static IReadOnlyList<NotificationEventType> Switchable { get; } =
    [
        NotificationEventType.TaskAssigned,
        NotificationEventType.TaskDue,
        NotificationEventType.TaskComment,
        NotificationEventType.MatterTaskOverdue,
        NotificationEventType.MatterTaskCreated,
        NotificationEventType.MatterTaskStalled,
        NotificationEventType.MatterManagerSet,
        NotificationEventType.PodTaskUnassigned,
    ];

    /// <summary>The code stored in the database and exposed by the API (the enum name).</summary>
    public static string Code(this NotificationEventType type) => type.ToString();

    /// <summary>Parses a stored or submitted code (exact, case-sensitive); false for anything unknown.</summary>
    public static bool TryParse(string? code, out NotificationEventType type)
    {
        type = default;
        return code is not null && Enum.TryParse(code, ignoreCase: false, out type) && Enum.IsDefined(type) && !char.IsDigit(code[0]);
    }

    /// <summary>Lower wins when two rules hit the same person for one action.</summary>
    public static int Priority(this NotificationEventType type) => type == NotificationEventType.TaskMention ? 3 : (int)type;

    /// <summary>The switch that governs the type: a mention follows the comment switch, every other type its own.</summary>
    public static NotificationEventType PreferenceType(this NotificationEventType type) =>
        type == NotificationEventType.TaskMention ? NotificationEventType.TaskComment : type;

    public static NotificationAudience Audience(this NotificationEventType type) => type switch
    {
        NotificationEventType.TaskAssigned or NotificationEventType.TaskDue or NotificationEventType.TaskComment or NotificationEventType.TaskMention => NotificationAudience.Technician,
        NotificationEventType.PodTaskUnassigned => NotificationAudience.PodLead,
        _ => NotificationAudience.ProjectManager,
    };

    /// <summary>The wording of the profile switch (README section 4.5).</summary>
    public static string SwitchLabel(this NotificationEventType type) => type switch
    {
        NotificationEventType.TaskAssigned => "A task is assigned to me",
        NotificationEventType.TaskDue => "My task is overdue or due within a day",
        NotificationEventType.TaskComment or NotificationEventType.TaskMention => "Someone comments on or mentions me in my task",
        NotificationEventType.MatterTaskOverdue => "A task on my matter becomes overdue",
        NotificationEventType.MatterTaskCreated => "A new task is created on my matter",
        NotificationEventType.MatterTaskStalled => "A task on my matter is unassigned or on hold for a while",
        NotificationEventType.MatterManagerSet => "I am set as a matter's Primary or Secondary manager",
        NotificationEventType.PodTaskUnassigned => "A task in my pod becomes unassigned",
        _ => type.ToString(),
    };
}
