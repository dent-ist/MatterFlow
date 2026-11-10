using MatterFlow.Notifications.Contracts;

namespace MatterFlow.Notifications.Domain;

/// <summary>One notification to create: a request resolved to a single recipient.</summary>
public sealed record PlannedNotification(int RecipientUserId, NotificationRequest Request);

/// <summary>
/// The central recipient rules (README section 3): never the actor; a person's switch off creates nothing; at most one notification per person
/// per action, the lowest priority number winning. The switches are applied BEFORE the collapse, so a person who switched the winning type off
/// still receives the next-best event of the same action. Pure, no database.
/// </summary>
public static class RecipientRules
{
    /// <param name="requests">The rule hits of ONE action.</param>
    /// <param name="isSwitchedOff">Whether a person has switched an event type's switch off (the preference type, never a mention).</param>
    public static IReadOnlyList<PlannedNotification> Plan(
        IEnumerable<NotificationRequest> requests,
        Func<int, NotificationEventType, bool> isSwitchedOff)
    {
        var best = new Dictionary<int, NotificationRequest>();
        foreach (var request in requests)
        {
            foreach (var recipient in request.RecipientUserIds.Distinct())
            {
                if (request.ActorUserId == recipient)
                    continue;
                if (isSwitchedOff(recipient, request.EventType.PreferenceType()))
                    continue;
                if (!best.TryGetValue(recipient, out var current) || request.EventType.Priority() < current.EventType.Priority())
                    best[recipient] = request;
            }
        }

        return best.OrderBy(kv => kv.Key).Select(kv => new PlannedNotification(kv.Key, kv.Value)).ToList();
    }
}
