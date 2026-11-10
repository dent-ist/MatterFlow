namespace MatterFlow.Notifications.Contracts;

/// <summary>The kinds of object a notification points at (the client builds the link from kind and id).</summary>
public static class NotificationObjectKinds
{
    public const string Task = "Task";
    public const string Matter = "Matter";
}

/// <summary>
/// One notification rule hit: the same message for each of the listed recipients. The publisher drops the actor, applies the recipients' switches,
/// and collapses several requests of one action to one notification per person (the lowest <see cref="NotificationEventTypes.Priority"/> wins).
/// </summary>
/// <param name="EventType">The event.</param>
/// <param name="ObjectKind"><see cref="NotificationObjectKinds"/>.</param>
/// <param name="ObjectId">Task id or matter id.</param>
/// <param name="MatterId">Matter of the object (for cleanup).</param>
/// <param name="ActorUserId">Who caused it; null for scheduled events. Never notified.</param>
/// <param name="Message">Snapshot text built with <see cref="NotificationMessages"/> (at most 300 characters).</param>
/// <param name="DedupeKey">Idempotency key within (recipient, event type, object); contains a per-action value (README section 3).</param>
/// <param name="RecipientUserIds">Candidate recipients.</param>
public sealed record NotificationRequest(
    NotificationEventType EventType,
    string ObjectKind,
    long ObjectId,
    int? MatterId,
    int? ActorUserId,
    string Message,
    string DedupeKey,
    IReadOnlyCollection<int> RecipientUserIds);

/// <summary>
/// Creates notifications inside the command that causes them. <b>Call it inside the command's open transaction, before the final
/// <c>SaveChanges</c>:</b> the rows are added to the shared unit of work and commit (or roll back) together with the action.
/// </summary>
public interface INotificationPublisher
{
    /// <summary>
    /// Publishes the requests of ONE action. Returns the number of notification rows added. Nothing is saved here; no exception is thrown for a
    /// recipient that has switched the type off (it is simply skipped).
    /// </summary>
    Task<int> PublishAsync(IReadOnlyCollection<NotificationRequest> requests, CancellationToken cancellationToken = default);
}

/// <summary>
/// The objects of one kind that the signed-in caller may view, as a set-based query (the same permission rule the object's own endpoints
/// use). Implemented by the module that owns the object; consumed by the Notifications read queries as a sub-select, never per row.
/// </summary>
public interface IObjectVisibility
{
    /// <summary>The <see cref="NotificationObjectKinds"/> value this rule covers.</summary>
    string ObjectKind { get; }

    /// <summary>Ids of the objects the caller may view now; null when the caller may view none of this kind (no permission).</summary>
    IQueryable<long>? VisibleObjectIds();
}
