using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// The Task activity timeline: the audit events of the Task and of its comments, steps and asset links, newest first, with actor names, readable
/// sentences and cursor paging. Old and new values are included only for callers holding <c>Audit.View</c> (the sentence is always there).
/// </summary>
public sealed class TaskActivityService(
    DbContext db,
    IAuditReader reader,
    IUserDirectory users,
    IPodDirectory pods,
    IStatusLabelCatalog labels,
    IPermissionChecker permissions)
{
    public const int DefaultPageSize = 25;
    public const int MaxPageSize = 100;

    /// <summary>Internal bookkeeping events that only repeat their FIELD_CHANGED rows.</summary>
    private static readonly string[] Hidden = [TaskSupport.TaskUpdatedEvent];

    public async Task<Result<TaskActivityPage>> ListAsync(long taskId, string? cursor, int? pageSize, CancellationToken ct)
    {
        long? before = null;
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            if (!long.TryParse(cursor, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed < 1)
                return Error.Validation("cursor", "INVALID", "The cursor is not valid.");

            before = parsed;
        }

        var size = pageSize ?? DefaultPageSize;
        if (size is < 1 or > MaxPageSize)
            return Error.Validation("pageSize", "RANGE", $"pageSize must be between 1 and {MaxPageSize}.");

        if (!await db.Set<WorkTask>().AnyAsync(t => t.Id == taskId, ct))
            return TaskSupport.NotFound();

        var page = await reader.ListForTaskAsync(taskId, before, size, Hidden, ct);
        var (userIds, podIds) = TaskActivityNarrator.AssignmentIds(page.Items);
        var allUserIds = page.Items.Select(i => i.ActorUserId).OfType<int>().Concat(userIds).Distinct().ToList();
        var userMap = await users.FindManyAsync(allUserIds, ct);
        var podNames = new Dictionary<int, string>();
        foreach (var podId in podIds)
        {
            if (await pods.FindAsync(podId, ct) is { } pod)
                podNames[podId] = pod.Name;
        }

        var statusLabels = (await labels.ListAsync(ct)).ToDictionary(l => l.Code, l => l.DisplayLabel, StringComparer.Ordinal);
        var names = new ActivityNames(userMap.ToDictionary(u => u.Key, u => u.Value.DisplayName), podNames, statusLabels);

        var canView = permissions.Has(Permissions.Audit.View);
        var items = page.Items.Select(e =>
        {
            var story = TaskActivityNarrator.Narrate(e, names, canView);
            var actor = e.ActorUserId is { } id && userMap.TryGetValue(id, out var u) ? new TaskUserRef(u.UserId, u.DisplayName, u.IsActive) : null;
            return new TaskActivityItem(
                e.AuditEventId,
                e.OccurredAtUtc,
                e.EventType,
                story.Category,
                actor,
                story.Summary,
                e.FieldKey,
                canView ? story.OldValue : null,
                canView ? story.NewValue : null);
        }).ToList();
        return new TaskActivityPage(items, page.NextBeforeId?.ToString(CultureInfo.InvariantCulture), canView);
    }
}
