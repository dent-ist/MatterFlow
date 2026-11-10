using System.Globalization;
using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// "Since your last visit" (epic #758, PX-10): what changed on my matters since the person's marker (the last explicit "Mark as read"), or in the last 7 days when they have no marker yet.
/// It never moves the marker and never creates one: only <c>POST /my-matters/activity/seen</c> does. The starting point that the first read of the Activity list creates (<c>IsInitial</c>) is not
/// a "last visit": it is ignored here, so looking at the Activity tab never changes what this card says (issue #815). Counts come from one grouped read of the audit events newer than the marker (a clustered
/// range on the event id, bounded below by 30 days), "became overdue" from the open tasks of the scope whose due moment fell inside the period, and the (at most five) most important items
/// are the tasks that became overdue first, then the newest holds and reassignments. The person's own actions are not counted. Comment text is never read.
/// </summary>
public sealed class MyMattersSinceLastVisitService(MyMattersScopeResolver scopes, DbContext db, MyMattersActivityService activity)
{
    /// <summary>How far back the summary looks for a person who never marked anything as read.</summary>
    public const int NoMarkerDays = 7;

    public const int ImportantItems = 5;

    public async Task<Result<MyMattersSinceLastVisit>> GetAsync(MyMattersSinceQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var me = scope.Me;
        var now = DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc);
        var floor = now.AddDays(-MyMattersActivityService.WindowDays);

        var marker = await db.Database.SqlQuery<SeenRow>($"SELECT SeenAuditEventId, SeenAtUtc FROM dbo.UserMatterActivitySeen WHERE UserId = {me} AND IsInitial = 0").FirstOrDefaultAsync(ct);
        var since = marker is null ? now.AddDays(-NoMarkerDays) : DateTime.SpecifyKind(marker.SeenAtUtc, DateTimeKind.Utc);
        if (since < floor)
            since = floor;
        var seen = marker?.SeenAuditEventId ?? 0;

        // Events: the clustered range after the marker (or from the first event of the period), of the scope's matters, not the person's own.
        var firstId = await activity.FirstIdSinceAsync(since, ct);
        var counts = new Dictionary<string, int>();
        List<MyMattersActivityService.AuditRow> holds = [];
        var fromId = firstId is null ? long.MaxValue : Math.Max(firstId.Value, seen + 1);
        if (firstId is not null)
        {
            var events = activity.ScopedEvents(scope, fromId, since, until: null).Where(e => e.ActorUserId != me);
            var grouped = await events
                .GroupBy(e => new { e.EventType, Detail = e.EventType == MyMattersActivityService.StatusEvent ? e.NewValue : null })
                .Select(g => new { g.Key.EventType, g.Key.Detail, Count = g.Count() })
                .ToListAsync(ct);
            foreach (var g in grouped)
                counts[g.EventType + "|" + g.Detail] = g.Count;

            holds = await events
                .Where(e => (e.EventType == MyMattersActivityService.StatusEvent && e.NewValue == "ON_HOLD") || e.EventType == MyMattersActivityService.AssignedEvent)
                .OrderByDescending(e => e.AuditEventId)
                .Take(ImportantItems)
                .ToListAsync(ct);
        }

        int Of(string eventType, string? detail = null) => counts.GetValueOrDefault(eventType + "|" + detail);

        // Became overdue: open tasks that are overdue now and whose due moment fell inside the period (the due sort key is the instant, or the end of the due day).
        var overdue = scope.OpenTasks().Where(TaskQueueRules.Overdue(clock)).Where(t => t.DueSortKey > since);
        var overdueTotal = await overdue.CountAsync(ct);
        var overdueTop = overdueTotal == 0
            ? []
            : await overdue.OrderBy(t => t.DueSortKey).ThenBy(t => t.Id).Take(ImportantItems)
                .Select(t => new { t.Id, t.Number, t.Title, t.MatterId, t.DueDate, t.DueAtUtc, t.AssignedUserId }).ToListAsync(ct);

        var sinceLocalDay = LocalDayOf(clock, since);
        var sinceDay = DashboardRules.Date(sinceLocalDay);

        // New unassigned: open tasks nobody is assigned to that were created after the period's start (to the second, so "Mark as read" clears them; the list it opens
        // starts at that day, like "became overdue" above).
        var newUnassigned = await scope.OpenTasks().Where(MyMattersRules.Unassigned).Where(t => t.CreatedAtUtc > since).CountAsync(ct);
        var items = new List<MyMattersSinceItem>();
        if (overdueTop.Count > 0)
        {
            var matterIds = overdueTop.Select(t => t.MatterId).Distinct().ToList();
            var userIds = overdueTop.Where(t => t.AssignedUserId != null).Select(t => t.AssignedUserId!.Value).Distinct().ToList();
            var matters = await (from m in db.Set<Matter>().AsNoTracking().Where(m => matterIds.Contains(m.Id))
                                 join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                                 select new { m.Id, m.MatterRef, MatterName = m.Name, ClientName = c.Name }).ToDictionaryAsync(m => m.Id, ct);
            var users = userIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
            var today = clock.Today;
            var facts = await MyMattersTaskFacts.LoadAsync(db, [.. overdueTop.Select(t => t.Id)], clock, ct);
            foreach (var t in overdueTop)
            {
                var fact = facts.GetValueOrDefault(t.Id) ?? TaskFacts.Unknown;
                var matter = matters[t.MatterId];
                var days = t.DueDate is { } due ? Math.Max(0, today.DayNumber - due.DayNumber) : t.DueAtUtc is { } at ? MyMattersRules.WholeDaysSince(at, now) : 0;
                items.Add(new MyMattersSinceItem(
                    "BECAME_OVERDUE",
                    new MyMattersTaskItem(t.Id, t.Number, t.Title, t.MatterId, matter.MatterRef, matter.MatterName, matter.ClientName, AttentionFacts.Overdue, days, t.DueDate, t.DueAtUtc is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null, t.AssignedUserId, t.AssignedUserId is { } uid ? users.GetValueOrDefault(uid) : null,
                        fact.TaskTypeId, fact.TaskTypeName, fact.TaskTypeIconKey, fact.TaskTypeColourKey, fact.PriorityName, fact.PriorityRank, fact.StatusCode, fact.AgeDays, fact.OnHold, fact.AtRisk),
                    null));
            }
        }

        var room = ImportantItems - items.Count;
        if (room > 0 && holds.Count > 0)
        {
            var events = await activity.ToItemsAsync([.. holds.Take(room)], seen, me, ct);
            items.AddRange(events.Select(e => new MyMattersSinceItem(e.Kind == ActivityKinds.Reassigned ? "REASSIGNED" : "ON_HOLD", null, e)));
        }

        // The links: with a marker "kind=...&unread=true" lists the same events the count counted; without one the activity list has no marker to compare with, so the link is the period itself.
        string Activity(string kind) => marker is null ? $"kind={kind}&from={sinceDay}" : $"kind={kind}&unread=true";
        MyMattersSinceCount Count(int count, string kind) => new(count, Activity(kind), "activity");

        return new MyMattersSinceLastVisit(
            clock.ZoneId,
            now,
            since,
            marker is not null,
            seen,
            new MyMattersSinceCounts(
                Count(Of(MyMattersActivityService.TaskCreatedEvent), ActivityKinds.TaskCreated),
                Count(Of(MyMattersActivityService.StatusEvent, "COMPLETED"), "COMPLETED"),
                new MyMattersSinceCount(overdueTotal, scope.QueueOpen("overdue=true", "dueFrom=" + sinceDay, "sort=due"), "taskQueue"),
                Count(Of(MyMattersActivityService.AssignedEvent), ActivityKinds.Reassigned),
                Count(Of(MyMattersActivityService.StatusEvent, "ON_HOLD"), "ON_HOLD"),
                Count(Of(MyMattersActivityService.CommentEvent), ActivityKinds.Commented),
                new MyMattersSinceCount(newUnassigned, scope.QueueOpen("unassigned=true", "createdFrom=" + sinceDay, "sort=" + TaskQueueRules.SortCreated), "taskQueue")),
            items);
    }

    /// <summary>The viewer's calendar day that contains the instant (the clock only converts a local day to its UTC start, so the neighbours of the UTC date are tried).</summary>
    private static DateOnly LocalDayOf(QueueClock clock, DateTime instant)
    {
        var guess = DateOnly.FromDateTime(instant);
        foreach (var day in new[] { guess.AddDays(1), guess, guess.AddDays(-1) })
        {
            if (clock.StartOfDayUtc(day) <= instant)
                return day;
        }

        return guess.AddDays(-1);
    }

    private sealed class SeenRow
    {
        public long SeenAuditEventId { get; set; }

        public DateTime SeenAtUtc { get; set; }
    }
}
