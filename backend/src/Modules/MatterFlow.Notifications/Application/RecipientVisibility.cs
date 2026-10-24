using MatterFlow.Notifications.Contracts;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notifications.Application;

/// <summary>
/// The creation-time check of the sensitive-matter rule (epic #788, README section 8): a notification is only created for a recipient who can see its
/// subject at that moment. The recipient's own viewer comes from <see cref="IMatterVisibility.ForAsync"/> (their current role grants, never "see all" for a
/// job), so the producers of the application and the scheduler jobs use the same rule as the reads. While the go-live switch is off nobody is filtered.
/// </summary>
public sealed class RecipientVisibility(IMatterVisibility visibility)
{
    /// <summary>True when the check applies (the switch is on).</summary>
    public bool Enabled => visibility.Enabled;

    /// <summary>
    /// Of the wanted (recipient, object kind, object id) triples, the ones whose recipient may see the object. One statement per recipient and kind, not per
    /// triple. Unknown kinds are left out (nothing is created for a subject the rule cannot judge).
    /// </summary>
    public async Task<HashSet<(int Recipient, string Kind, long ObjectId)>> VisibleAsync(IReadOnlyCollection<(int Recipient, string Kind, long ObjectId)> wanted, CancellationToken ct)
    {
        var result = new HashSet<(int, string, long)>();
        foreach (var byRecipient in wanted.GroupBy(w => w.Recipient))
        {
            var viewer = await visibility.ForAsync(byRecipient.Key, ct);
            foreach (var byKind in byRecipient.GroupBy(w => w.Kind))
            {
                var ids = byKind.Select(w => w.ObjectId).Distinct().ToList();
                List<long> seen;
                switch (byKind.Key)
                {
                    case NotificationObjectKinds.Task:
                        seen = await visibility.VisibleTasks(viewer).Where(t => ids.Contains(t.TaskId)).Select(t => t.TaskId).ToListAsync(ct);
                        break;
                    case NotificationObjectKinds.Matter:
                        var matterIds = ids.Select(i => (int)i).ToList();
                        seen = await visibility.VisibleMatters(viewer).Where(m => matterIds.Contains(m.MatterId)).Select(m => (long)m.MatterId).ToListAsync(ct);
                        break;
                    default:
                        continue;
                }

                foreach (var id in seen)
                    result.Add((byRecipient.Key, byKind.Key, id));
            }
        }

        return result;
    }
}
