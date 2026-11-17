using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Tasks;
using LptHub.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.WorkViews.Application.Queries;

/// <summary>
/// The numbers behind the "who is affected" preview of a Task Type access change (epic #1397, design section 9.1). Counts only, over every task of the type (not the visible set: the confirming
/// administrator has to know the real effect). "People" are active users who hold <c>Task.View</c> through an active role (a System Admin holds every permission); a person without
/// <c>Task.View</c> never sees a task, so the change does not affect them. Roles add up; a deactivated role grants nothing.
/// </summary>
public sealed class TaskTypeAccessImpactReader(DbContext db) : ITaskTypeAccessImpact
{
    /// <summary>One person's facts for the rule: the active roles they hold, whether one is the System Admin role, whether they hold <c>Task.View</c>.</summary>
    internal sealed record Person(int UserId, IReadOnlySet<int> RoleIds, bool IsSystemAdmin, bool HasTaskView);

    public async Task<TaskTypeAccessImpact> PreviewAsync(int taskTypeId, TaskTypeAccessSets current, TaskTypeAccessSets proposed, int? callerUserId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(proposed);

        var people = await LoadPeopleAsync(cancellationToken);
        var losingView = people.Where(p => p.HasTaskView && CanView(p, current) && !CanView(p, proposed)).Select(p => p.UserId).ToHashSet();
        var losingEdit = people.Count(p => p.HasTaskView && CanEdit(p, current) && !CanEdit(p, proposed));
        var callerLoses = callerUserId is { } caller && people.FirstOrDefault(p => p.UserId == caller) is { } me && CanView(me, current) && !CanView(me, proposed);

        var open = db.Set<WorkTask>().AsNoTracking().Where(TaskQueueRules.Open).Where(t => t.TaskTypeId == taskTypeId);
        var openTotal = losingView.Count == 0 ? 0 : await open.CountAsync(cancellationToken);
        var ids = losingView.ToList();
        var assigned = ids.Count == 0 ? 0 : await open.CountAsync(t => t.AssignedUserId != null && ids.Contains(t.AssignedUserId.Value), cancellationToken);
        return new TaskTypeAccessImpact(openTotal, losingView.Count, assigned, losingEdit, callerLoses);
    }

    /// <summary>May the person see tasks of a type with these lists? An empty Can View list means open to everyone; System Admin sees everything.</summary>
    internal static bool CanView(Person p, TaskTypeAccessSets sets) =>
        sets.CanView.Count == 0 || p.IsSystemAdmin || sets.CanView.Any(p.RoleIds.Contains);

    /// <summary>May the person change tasks? Needs View, then System Admin, an empty Can Edit list (no extra limit) or a role in it.</summary>
    internal static bool CanEdit(Person p, TaskTypeAccessSets sets) =>
        CanView(p, sets) && (p.IsSystemAdmin || sets.CanEdit.Count == 0 || sets.CanEdit.Any(p.RoleIds.Contains));

    private async Task<List<Person>> LoadPeopleAsync(CancellationToken ct)
    {
        var rows = await (from ur in db.Set<UserRole>().AsNoTracking()
                          join u in db.Set<AppUser>().AsNoTracking() on ur.UserId equals u.Id
                          join r in db.Set<Role>().AsNoTracking() on ur.RoleId equals r.Id
                          where u.IsActive && r.IsActive
                          select new
                          {
                              ur.UserId,
                              ur.RoleId,
                              r.IsSystemAdmin,
                              ViewsTasks = r.Permissions.Any(rp => rp.Permission.IsActive && rp.Permission.Code == Permissions.Task.View),
                          })
            .ToListAsync(ct);
        return [.. rows.GroupBy(r => r.UserId).Select(g => new Person(
            g.Key,
            g.Select(x => x.RoleId).ToHashSet(),
            g.Any(x => x.IsSystemAdmin),
            g.Any(x => x.IsSystemAdmin || x.ViewsTasks)))];
    }
}
