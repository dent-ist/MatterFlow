using MatterFlow.Organization.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The one query helper behind the Task counts of the Client, Matter and Project lists and summaries (#258, #259). It lives in WorkViews (the query
/// side that may read the Task table) and is reached by the Organization module through <see cref="IOrganizationTaskCounts"/>. Every number uses
/// the predicates of <see cref="TaskQueueRules"/>, so Open, Overdue, ASAP, On hold and Due soon mean exactly what the Dashboard and the Task Queue
/// mean, in the viewer's time zone. Inactive Matters and archived Projects are counted (their Tasks are real work). Permissions are the caller's job.
/// </summary>
public sealed class OrganizationTaskCounts(DbContext db, IClock clock, IUserTimeZone timeZone, IMatterVisibility visibility) : IOrganizationTaskCounts
{
    private QueueClock Now() => QueueClock.Create(clock.UtcNow, timeZone);

    public IQueryable<TaskCountRow> Grouped(TaskCountScope scope) => Project(GroupsOf(scope, null), Now());

    public async Task<IReadOnlyDictionary<int, TaskCountRow>> ForKeysAsync(TaskCountScope scope, IReadOnlyCollection<int> keys, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(keys);
        if (keys.Count == 0)
            return new Dictionary<int, TaskCountRow>();

        var ids = keys.Distinct().ToList();
        var rows = await Project(GroupsOf(scope, ids), Now()).ToListAsync(cancellationToken);
        return rows.ToDictionary(r => r.Key);
    }

    public async Task<TaskStripCounts> StripAsync(TaskCountScope scope, int key, CancellationToken cancellationToken = default)
    {
        var queueClock = Now();
        var overdue = TaskQueueRules.Overdue(queueClock);
        var dueSoon = TaskQueueRules.DueSoonExcludingOverdue(queueClock);
        System.Linq.Expressions.Expression<Func<WorkTask, bool>> unassigned = t =>
            t.AssignedUserId == null && (t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold);
        var tasks = db.Set<WorkTask>().AsNoTracking();
        tasks = scope switch
        {
            // The client's tasks the caller may see (the sensitive-matter task rule: the matter's tasks for a visible matter, otherwise only their own),
            // so the strip equals the Task Queue list it links to. The set is one client's tasks, so the id subquery of the port is cheap enough.
            TaskCountScope.Client => visibility.WhereTaskVisible(tasks.Where(t => db.Set<Matter>().Any(m => m.Id == t.MatterId && m.ClientId == key)), t => t.Id),
            TaskCountScope.Matter => tasks.Where(t => t.MatterId == key),
            _ => tasks.Where(t => t.ProjectId == key),
        };

        // One statement: conditional aggregates over the record's Tasks.
        var row = await tasks.GroupBy(_ => 1).Select(g => new
        {
            Open = g.AsQueryable().Count(TaskQueueRules.Open),
            Overdue = g.AsQueryable().Count(overdue),
            Asap = g.AsQueryable().Count(TaskQueueRules.Asap),
            OnHold = g.AsQueryable().Count(t => t.Status == TaskStatusCode.OnHold),
            DueSoon = g.AsQueryable().Count(dueSoon),
            Unassigned = g.AsQueryable().Count(unassigned),
        }).FirstOrDefaultAsync(cancellationToken);
        return row is null ? new TaskStripCounts(0, 0, 0, 0, 0) : new TaskStripCounts(row.Open, row.Overdue, row.Asap, row.OnHold, row.DueSoon, row.Unassigned);
    }

    public async Task<IReadOnlyList<MatterTaskCount>> TopMattersAsync(int clientId, int take, CancellationToken cancellationToken = default)
    {
        var overdue = TaskQueueRules.Overdue(Now());
        // Only matters the caller may see: the answer names each matter, and an assignee of one task on a hidden matter does not get to see its name.
        var rows = await (from t in db.Set<WorkTask>().AsNoTracking().Where(TaskQueueRules.Open)
                          join m in visibility.WhereMatterRowVisible(db.Set<Matter>(), m => m.IsSensitive, m => m.PrimaryManagerId, m => m.SecondaryManagerId).AsNoTracking() on t.MatterId equals m.Id
                          where m.ClientId == clientId
                          select new { Task = t, m.Id, m.MatterRef })
            .GroupBy(x => new { x.Id, x.MatterRef }, x => x.Task)
            .Select(g => new { MatterId = g.Key.Id, g.Key.MatterRef, Open = g.Count(), Overdue = g.AsQueryable().Count(overdue) })
            .OrderByDescending(r => r.Open).ThenByDescending(r => r.Overdue).ThenBy(r => r.MatterRef)
            .Take(take)
            .ToListAsync(cancellationToken);
        return [.. rows.Select(r => new MatterTaskCount(r.MatterId, r.Open, r.Overdue))];
    }

    /// <summary>The open Tasks grouped by the key of the scope, optionally restricted to some keys.</summary>
    private IQueryable<IGrouping<int, WorkTask>> GroupsOf(TaskCountScope scope, IReadOnlyCollection<int>? keys)
    {
        var open = db.Set<WorkTask>().AsNoTracking().Where(TaskQueueRules.Open);
        switch (scope)
        {
            case TaskCountScope.Client:
                var joined = from t in open
                             join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
                             select new { Task = t, m.ClientId, m.IsSensitive, m.PrimaryManagerId, m.SecondaryManagerId, t.AssignedUserId };
                // The task rule on the matter columns this join already has: the matter's tasks for a visible matter, otherwise only the caller's own.
                joined = visibility.WhereTaskRowVisible(joined, x => x.IsSensitive, x => x.PrimaryManagerId, x => x.SecondaryManagerId, x => x.AssignedUserId);
                if (keys is not null)
                    joined = joined.Where(x => keys.Contains(x.ClientId));
                return joined.GroupBy(x => x.ClientId, x => x.Task);
            case TaskCountScope.Matter:
                if (keys is not null)
                    open = open.Where(t => keys.Contains(t.MatterId));
                return open.GroupBy(t => t.MatterId);
            default:
                var inProject = open.Where(t => t.ProjectId != null);
                if (keys is not null)
                    inProject = inProject.Where(t => keys.Contains(t.ProjectId!.Value));
                return inProject.GroupBy(t => t.ProjectId!.Value);
        }
    }

    private static IQueryable<TaskCountRow> Project(IQueryable<IGrouping<int, WorkTask>> groups, QueueClock queueClock)
    {
        var overdue = TaskQueueRules.Overdue(queueClock);
        return groups.Select(g => new TaskCountRow { Key = g.Key, Open = g.Count(), Overdue = g.AsQueryable().Count(overdue) });
    }
}
