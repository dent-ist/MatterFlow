using System.Globalization;
using MatterFlow.Notifications.Contracts;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notifications.Infrastructure.Scheduling;

/// <summary>An open task that may have been unassigned or on hold for a while, with the instant that state began.</summary>
public sealed class StalledTaskRow
{
    public long TaskId { get; set; }

    public string TaskNumber { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public int MatterId { get; set; }

    public string MatterName { get; set; } = string.Empty;

    /// <summary>The task type's name, shown in the message (PM v2 #884).</summary>
    public string? TaskTypeName { get; set; }

    public int? PrimaryManagerId { get; set; }

    public int? SecondaryManagerId { get; set; }

    /// <summary>When the state began (UTC): the last assignment change (or creation) for unassigned, the last status change for on hold.</summary>
    public DateTime SinceUtc { get; set; }
}

/// <summary>
/// Event 6 (README section 3, issue #743): an open task on a managed matter that has been unassigned for 2 calendar days, or on hold for 5,
/// notifies the matter's Primary and Secondary manager once per episode. The key carries the instant the episode began, so a new episode
/// (assigned and unassigned again, resumed and put on hold again) notifies again, and a repeated run does not. A task that was assigned or resumed
/// before the run produces nothing. The thresholds are <see cref="NotificationRules"/>.
/// </summary>
public sealed class TaskStalledJob(DbContext db, ScheduledNotificationWriter writer) : INotificationJob
{
    public string Name => "task-stalled";

    public TimeSpan MinimumInterval => TimeSpan.Zero;

    public async Task<int> RunAsync(JobContext context, CancellationToken cancellationToken)
    {
        var created = 0;
        long after = 0;
        // A calendar-day count of N is at least N-1 full days of elapsed time, so this cut-off never hides a candidate.
        var unassignedCutoff = context.NowUtc.AddDays(-(NotificationRules.UnassignedDays - 1));
        while (true)
        {
            var rows = await db.Database.SqlQuery<StalledTaskRow>(
                    $"""
                    SELECT TOP ({NotificationRules.CandidateBatch})
                           t.TaskId, t.TaskNumber, t.Title, t.MatterId, m.Name AS MatterName, tt.Name AS TaskTypeName,
                           CASE WHEN pm.IsActive = 1 THEN m.PrimaryManagerId END AS PrimaryManagerId,
                           CASE WHEN sm.IsActive = 1 THEN m.SecondaryManagerId END AS SecondaryManagerId,
                           COALESCE(a.LastChange, t.CreatedAt) AS SinceUtc
                    FROM dbo.Task t
                    JOIN dbo.Matter m ON m.MatterId = t.MatterId
                    LEFT JOIN dbo.TaskType tt ON tt.TaskTypeId = t.TaskTypeId
                    LEFT JOIN dbo.AppUser pm ON pm.UserId = m.PrimaryManagerId
                    LEFT JOIN dbo.AppUser sm ON sm.UserId = m.SecondaryManagerId
                    OUTER APPLY (SELECT MAX(e.OccurredAtUtc) AS LastChange FROM dbo.AuditEvent e WHERE e.TaskId = t.TaskId AND e.EventType = 'TASK_ASSIGNED') a
                    WHERE t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
                      AND t.AssignedUserId IS NULL
                      AND (pm.IsActive = 1 OR sm.IsActive = 1)
                      AND COALESCE(a.LastChange, t.CreatedAt) <= {unassignedCutoff}
                      AND t.TaskId > {after}
                    ORDER BY t.TaskId
                    """)
                .AsNoTracking()
                .ToListAsync(cancellationToken);
            if (rows.Count == 0)
                break;

            created += await writer.WriteAsync(PlanUnassigned(rows, context), cancellationToken);
            after = rows[^1].TaskId;
            if (rows.Count < NotificationRules.CandidateBatch)
                break;
        }

        after = 0;
        var holdCutoff = context.NowUtc.AddDays(-(NotificationRules.OnHoldDays - 1));
        while (true)
        {
            var rows = await db.Database.SqlQuery<StalledTaskRow>(
                    $"""
                    SELECT TOP ({NotificationRules.CandidateBatch})
                           t.TaskId, t.TaskNumber, t.Title, t.MatterId, m.Name AS MatterName, tt.Name AS TaskTypeName,
                           CASE WHEN pm.IsActive = 1 THEN m.PrimaryManagerId END AS PrimaryManagerId,
                           CASE WHEN sm.IsActive = 1 THEN m.SecondaryManagerId END AS SecondaryManagerId,
                           t.StatusChangedAt AS SinceUtc
                    FROM dbo.Task t
                    JOIN dbo.Matter m ON m.MatterId = t.MatterId
                    LEFT JOIN dbo.TaskType tt ON tt.TaskTypeId = t.TaskTypeId
                    LEFT JOIN dbo.AppUser pm ON pm.UserId = m.PrimaryManagerId
                    LEFT JOIN dbo.AppUser sm ON sm.UserId = m.SecondaryManagerId
                    WHERE t.StatusCode = 'ON_HOLD'
                      AND (pm.IsActive = 1 OR sm.IsActive = 1)
                      AND t.StatusChangedAt <= {holdCutoff}
                      AND t.TaskId > {after}
                    ORDER BY t.TaskId
                    """)
                .AsNoTracking()
                .ToListAsync(cancellationToken);
            if (rows.Count == 0)
                break;

            created += await writer.WriteAsync(PlanOnHold(rows, context), cancellationToken);
            after = rows[^1].TaskId;
            if (rows.Count < NotificationRules.CandidateBatch)
                break;
        }

        return created;
    }

    internal static IReadOnlyList<IReadOnlyList<NotificationRequest>> PlanUnassigned(IEnumerable<StalledTaskRow> rows, JobContext context) =>
        Plan(rows, context, NotificationRules.UnassignedDays, "unassigned:", NotificationMessages.MatterTaskUnassigned);

    internal static IReadOnlyList<IReadOnlyList<NotificationRequest>> PlanOnHold(IEnumerable<StalledTaskRow> rows, JobContext context) =>
        Plan(rows, context, NotificationRules.OnHoldDays, "hold:", NotificationMessages.MatterTaskOnHold);

    private static List<IReadOnlyList<NotificationRequest>> Plan(
        IEnumerable<StalledTaskRow> rows,
        JobContext context,
        int thresholdDays,
        string keyPrefix,
        Func<string, string, string, int, string?, string> message)
    {
        var today = context.Today;
        var actions = new List<IReadOnlyList<NotificationRequest>>();
        foreach (var row in rows)
        {
            var since = DateTime.SpecifyKind(row.SinceUtc, DateTimeKind.Utc);
            var startedOn = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(since, context.FirmZone));
            var days = today.DayNumber - startedOn.DayNumber;
            if (days < thresholdDays)
                continue;

            var managers = new[] { row.PrimaryManagerId, row.SecondaryManagerId }.OfType<int>().Distinct().ToArray();
            if (managers.Length == 0)
                continue;

            actions.Add(
            [
                new NotificationRequest(
                    NotificationEventType.MatterTaskStalled,
                    NotificationObjectKinds.Task,
                    row.TaskId,
                    row.MatterId,
                    null,
                    message(row.TaskNumber, row.Title, row.MatterName, days, row.TaskTypeName),
                    keyPrefix + since.Ticks.ToString(CultureInfo.InvariantCulture),
                    managers),
            ]);
        }

        return actions;
    }
}
