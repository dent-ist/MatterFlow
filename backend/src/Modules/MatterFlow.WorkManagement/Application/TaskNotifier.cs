using System.Globalization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Notifications.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.WorkManagement.Domain;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// The create-path notification events of the Task commands (epic #753): who is told what when a Task is created, assigned or commented. Each
/// method is called INSIDE the command's transaction, before its last <c>SaveChanges</c>, so the notification rows commit or roll back with the
/// action (the publisher only adds them to the shared unit of work). All lookups are skipped when nobody could receive a notification.
/// </summary>
public sealed class TaskNotifier(
    INotificationPublisher publisher,
    ICurrentUser currentUser,
    IUserDirectory users,
    IMatterDirectory matters,
    IPodDirectory pods)
{
    /// <summary>
    /// Events 1 and 8 for a Task that was just created or whose assignment just changed. Event 1 (<c>TaskAssigned</c>): a person other than the actor
    /// became the assignee. Event 8 (<c>PodTaskUnassigned</c>): the Task is now in a Pod without a person (created that way, or the person was removed),
    /// told to the Pod's leads. The two cannot hit one Task in one action (one needs an assignee, the other none). Event 5 (<c>MatterTaskCreated</c>), on
    /// creation only: the matter's Primary and Secondary manager are told that someone else created a Task. It joins the same publish call, so a manager
    /// who is also the new assignee gets event 1 and not event 5 (the central rules keep the higher priority).
    /// </summary>
    public async Task AssignmentChangedAsync(WorkTask task, int? previousUserId, bool created, DateTime now, CancellationToken ct)
    {
        var requests = new List<NotificationRequest>();
        var actorId = currentUser.UserId;

        MatterSummary? matter = null;
        var matterLoaded = false;
        async Task<MatterSummary?> MatterAsync()
        {
            if (!matterLoaded)
            {
                matter = await matters.FindAsync(task.MatterId, ct);
                matterLoaded = true;
            }

            return matter;
        }

        if (created)
        {
            var found = await MatterAsync();
            var managers = new[] { found?.PrimaryManagerId, found?.SecondaryManagerId }.OfType<int>().Where(u => u != actorId).Distinct().ToArray();
            if (managers.Length > 0)
            {
                requests.Add(new NotificationRequest(
                    NotificationEventType.MatterTaskCreated,
                    NotificationObjectKinds.Task,
                    task.Id,
                    task.MatterId,
                    actorId,
                    NotificationMessages.MatterTaskCreated(await ActorNameAsync(ct), task.Number, task.Title, found?.Name ?? "a matter"),
                    "created:" + task.Id.ToString(CultureInfo.InvariantCulture),
                    managers));
            }
        }

        if (task.AssignedUserId is { } assignee && assignee != previousUserId && assignee != actorId && task.AssignedAtUtc is { } assignedAt)
        {
            var message = NotificationMessages.TaskAssigned(await ActorNameAsync(ct), task.Number, task.Title, (await MatterAsync())?.Name ?? "a matter");
            requests.Add(new NotificationRequest(
                NotificationEventType.TaskAssigned,
                NotificationObjectKinds.Task,
                task.Id,
                task.MatterId,
                actorId,
                message,
                "assign:" + assignedAt.Ticks.ToString(CultureInfo.InvariantCulture),
                [assignee]));
        }

        if (task.AssignedUserId is null && task.AssignedPodId is { } podId && (created || previousUserId is not null))
        {
            var leads = (await pods.GetLeadUserIdsAsync(podId, ct)).Where(u => u != actorId).ToArray();
            if (leads.Length > 0)
            {
                var pod = await pods.FindAsync(podId, ct);
                var message = NotificationMessages.PodTaskUnassigned(task.Number, task.Title, pod?.Name ?? "your pod");
                requests.Add(new NotificationRequest(
                    NotificationEventType.PodTaskUnassigned,
                    NotificationObjectKinds.Task,
                    task.Id,
                    task.MatterId,
                    actorId,
                    message,
                    $"unassigned:{task.Id.ToString(CultureInfo.InvariantCulture)}:{now.Ticks.ToString(CultureInfo.InvariantCulture)}",
                    leads));
            }
        }

        if (requests.Count > 0)
            await publisher.PublishAsync(requests, ct);
    }

    /// <summary>Event 3 (<c>TaskComment</c>): a comment by someone else on a Task that has an assignee. The excerpt is the Activity timeline's.</summary>
    public async Task CommentAddedAsync(WorkTask task, TaskComment comment, CancellationToken ct)
    {
        if (task.AssignedUserId is not { } assignee || assignee == comment.AuthorUserId)
            return;

        var excerpt = TaskActivityNarrator.Excerpt(comment.BodyHtml) ?? string.Empty;
        await publisher.PublishAsync(
            [
                new NotificationRequest(
                    NotificationEventType.TaskComment,
                    NotificationObjectKinds.Task,
                    task.Id,
                    task.MatterId,
                    comment.AuthorUserId,
                    NotificationMessages.TaskComment(await ActorNameAsync(ct), task.Number, excerpt),
                    "comment:" + comment.Id.ToString(CultureInfo.InvariantCulture),
                    [assignee]),
            ],
            ct);
    }

    private async Task<string> ActorNameAsync(CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(currentUser.DisplayName))
            return currentUser.DisplayName;

        var info = currentUser.UserId is { } id ? await users.FindAsync(id, ct) : null;
        return info?.DisplayName ?? "Someone";
    }

}
