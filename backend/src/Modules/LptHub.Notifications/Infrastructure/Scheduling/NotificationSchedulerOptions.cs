namespace MatterFlow.Notifications.Infrastructure.Scheduling;

/// <summary>
/// Settings of the notification scheduler (<c>Notifications:Scheduler</c>). The defaults are the production values; the integration test host
/// switches the timer off (<see cref="Enabled"/>) and drives <see cref="NotificationScheduler.RunOnceAsync"/> itself.
/// </summary>
public sealed class NotificationSchedulerOptions
{
    public const string SectionName = "Notifications:Scheduler";

    /// <summary>False keeps the background timer from starting (the health check then reports "disabled").</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Minutes between runs.</summary>
    public int IntervalMinutes { get; set; } = 5;

    /// <summary>Seconds to wait after the host started before the first run (the schema migration has long finished; this only spreads load).</summary>
    public int InitialDelaySeconds { get; set; } = 30;

    /// <summary>The health check reports Degraded when no run completed for this many minutes.</summary>
    public int DegradedAfterMinutes { get; set; } = 30;

    /// <summary>Pause between two delete batches of the retention step, in milliseconds.</summary>
    public int RetentionBatchPauseMilliseconds { get; set; } = 100;
}

/// <summary>
/// The scheduled rules in ONE place (README Q3 and Q5): how long "for a while" is and how long notifications live. Calendar days in the firm
/// time zone. Making them configurable later means changing this class only.
/// </summary>
public static class NotificationRules
{
    /// <summary>Event 6: an open task without an assignee for this many calendar days.</summary>
    public const int UnassignedDays = 2;

    /// <summary>Event 6: an open task on hold for this many calendar days.</summary>
    public const int OnHoldDays = 5;

    /// <summary>Read notifications are deleted after this many days.</summary>
    public const int ReadRetentionDays = 90;

    /// <summary>Hard limit: even an unread notification is deleted after this many days (README Q5).</summary>
    public const int UnreadRetentionDays = 365;

    /// <summary>Candidate tasks are read and notified in batches of this size.</summary>
    public const int CandidateBatch = 500;

    /// <summary>Retention deletes in batches of this size.</summary>
    public const int DeleteBatch = 1000;

    /// <summary>"Due within a day" means due today or tomorrow in the firm zone.</summary>
    public const int DueSoonDays = 1;
}
