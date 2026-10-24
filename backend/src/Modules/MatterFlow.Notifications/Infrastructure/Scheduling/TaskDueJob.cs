using System.Globalization;
using MatterFlow.Notifications.Contracts;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notifications.Infrastructure.Scheduling;

/// <summary>An open task with a due date, as the due job reads it (the recipients are already limited to active people).</summary>
public sealed class DueTaskRow
{
    public long TaskId { get; set; }

    public string TaskNumber { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public int MatterId { get; set; }

    public string MatterName { get; set; } = string.Empty;

    /// <summary>The assignee when that person is active; null when unassigned or disabled.</summary>
    public int? AssigneeId { get; set; }

    public DateOnly DueDate { get; set; }

    public DateTime? DueAtUtc { get; set; }

    public int? PrimaryManagerId { get; set; }

    public int? SecondaryManagerId { get; set; }
}

/// <summary>
/// Events 2 and 4 (README section 3, issue #742): an open task with a due date that is due today or tomorrow (<c>soon</c>) or past due
/// (<c>overdue</c>) in the firm time zone notifies its assignee (event 2); an overdue task also notifies the matter's Primary and Secondary
/// manager (event 4), unless that person already gets event 2 for it. ASAP (no due date), closed and cancelled tasks never appear. The key carries the
/// due date, so moving the date re-arms; a task fixed before the run produces nothing; after downtime only today's state is sent.
/// </summary>
public sealed class TaskDueJob(DbContext db, ScheduledNotificationWriter writer) : INotificationJob
{
    public string Name => "task-due";

    public TimeSpan MinimumInterval => TimeSpan.Zero;

    public async Task<int> RunAsync(JobContext context, CancellationToken cancellationToken)
    {
        var horizon = context.Today.AddDays(NotificationRules.DueSoonDays);
        var created = 0;
        long after = 0;
        while (true)
        {
            var rows = await db.Database.SqlQuery<DueTaskRow>(
                    $"""
                    SELECT TOP ({NotificationRules.CandidateBatch})
                           t.TaskId, t.TaskNumber, t.Title, t.MatterId, m.Name AS MatterName,
                           CASE WHEN au.IsActive = 1 THEN t.AssignedUserId END AS AssigneeId,
                           t.DueDate, t.DueAtUtc,
                           CASE WHEN pm.IsActive = 1 THEN m.PrimaryManagerId END AS PrimaryManagerId,
                           CASE WHEN sm.IsActive = 1 THEN m.SecondaryManagerId END AS SecondaryManagerId
                    FROM dbo.Task t
                    JOIN dbo.Matter m ON m.MatterId = t.MatterId
                    LEFT JOIN dbo.AppUser au ON au.UserId = t.AssignedUserId
                    LEFT JOIN dbo.AppUser pm ON pm.UserId = m.PrimaryManagerId
                    LEFT JOIN dbo.AppUser sm ON sm.UserId = m.SecondaryManagerId
                    WHERE t.StatusCode IN ('NEW', 'IN_PROGRESS', 'ON_HOLD')
                      AND t.DueDate IS NOT NULL AND t.DueDate <= {horizon}
                      AND t.TaskId > {after}
                    ORDER BY t.TaskId
                    """)
                .AsNoTracking()
                .ToListAsync(cancellationToken);
            if (rows.Count == 0)
                break;

            created += await writer.WriteAsync(Plan(rows, context), cancellationToken);
            after = rows[^1].TaskId;
            if (rows.Count < NotificationRules.CandidateBatch)
                break;
        }

        return created;
    }

    /// <summary>The rule hits of a batch, one group per task (so the person who is both assignee and manager gets one notification, event 2). Pure.</summary>
    internal static IReadOnlyList<IReadOnlyList<NotificationRequest>> Plan(IEnumerable<DueTaskRow> rows, JobContext context)
    {
        var today = context.Today;
        var horizon = today.AddDays(NotificationRules.DueSoonDays);
        var actions = new List<IReadOnlyList<NotificationRequest>>();
        foreach (var row in rows)
        {
            var overdue = DueDates.IsOverdue(row.DueDate, row.DueAtUtc, context.NowUtc, context.FirmZone);
            if (!overdue && row.DueDate > horizon)
                continue;

            var day = row.DueDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var action = new List<NotificationRequest>();
            if (row.AssigneeId is { } assignee)
            {
                action.Add(new NotificationRequest(
                    NotificationEventType.TaskDue,
                    NotificationObjectKinds.Task,
                    row.TaskId,
                    row.MatterId,
                    null,
                    overdue
                        ? NotificationMessages.TaskOverdue(row.TaskNumber, row.Title, row.MatterName, row.DueDate, today)
                        : NotificationMessages.TaskDueSoon(row.TaskNumber, row.Title, row.MatterName, row.DueDate, today),
                    (overdue ? "overdue:" : "soon:") + day,
                    [assignee]));
            }

            if (overdue)
            {
                var managers = new[] { row.PrimaryManagerId, row.SecondaryManagerId }.OfType<int>().Distinct().ToArray();
                if (managers.Length > 0)
                {
                    action.Add(new NotificationRequest(
                        NotificationEventType.MatterTaskOverdue,
                        NotificationObjectKinds.Task,
                        row.TaskId,
                        row.MatterId,
                        null,
                        NotificationMessages.MatterTaskOverdue(row.TaskNumber, row.Title, row.MatterName, row.DueDate, today),
                        $"overdue:{row.TaskId.ToString(CultureInfo.InvariantCulture)}:{day}",
                        managers));
                }
            }

            if (action.Count > 0)
                actions.Add(action);
        }

        return actions;
    }
}
