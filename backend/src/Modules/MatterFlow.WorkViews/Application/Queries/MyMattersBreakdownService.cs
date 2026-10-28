using System.Globalization;
using MatterFlow.Configuration.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The Breakdown (PM v2, #861): open work per matter and task type for the matters of the scope. Every count is a grouped statement over the scope's open tasks (the scope is a SQL subquery of managed, visible matters,
/// so a matter the caller cannot see contributes nothing), uses the same predicates as the Task Queue the links open (<see cref="TaskQueueRules.Overdue"/>, <see cref="AtRiskRules"/>) and the totals are over all
/// matters, not the page. About ten statements whatever the number of matters: the page of matters, the cells of that page, the totals per type, the at risk counts, and the names.
/// </summary>
public sealed class MyMattersBreakdownService(MyMattersScopeResolver scopes, DbContext db)
{
    public const int MaxTypeColumns = 40;
    public const string ViewMatrix = "matrix";
    public const string ViewTypes = "types";
    public const string StatusOpen = "open";
    public const string StatusOnHold = "onHold";

    public async Task<Result<MyMattersBreakdown>> GetAsync(MyMattersBreakdownQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var view = string.IsNullOrWhiteSpace(query.View) ? ViewMatrix : query.View.Trim().ToLowerInvariant();
        if (view is not (ViewMatrix or ViewTypes))
            return Error.Validation("view", "UNKNOWN_VIEW", "view must be matrix or types.");
        var status = string.IsNullOrWhiteSpace(query.Status) ? StatusOpen : query.Status.Trim();
        if (!string.Equals(status, StatusOpen, StringComparison.OrdinalIgnoreCase) && !string.Equals(status, StatusOnHold, StringComparison.OrdinalIgnoreCase))
            return Error.Validation("status", "UNKNOWN_STATUS", "status must be open or onHold.");
        status = status.Equals(StatusOnHold, StringComparison.OrdinalIgnoreCase) ? StatusOnHold : StatusOpen;
        var typeFilter = (query.TaskTypeId ?? []).Distinct().ToList();
        if (typeFilter.Any(id => id <= 0))
            return Error.Validation("taskTypeId", "INVALID", "taskTypeId must be a positive task type id.");

        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var overdue = TaskQueueRules.Overdue(clock);

        var counted = scope.OpenTasks();
        if (status == StatusOnHold)
            counted = counted.Where(MyMattersRules.OnHold);
        if (typeFilter.Count > 0)
            counted = counted.Where(t => typeFilter.Contains(t.TaskTypeId));

        string Queue(params string[] extra) => status == StatusOnHold ? scope.QueueStatus(TaskStatusCode.OnHold, extra) : scope.QueueOpen(extra);

        // Totals per type over all matters: open, overdue and on hold in one grouped statement, at risk in a second.
        var typeCounts = await counted.GroupBy(t => t.TaskTypeId).Select(g => new
        {
            TypeId = g.Key,
            Open = g.Count(),
            Overdue = g.AsQueryable().Count(overdue),
            OnHold = g.Count(t => t.Status == TaskStatusCode.OnHold),
        }).ToListAsync(ct);
        var typeAtRisk = (await AtRiskRules.Where(counted, db, clock).GroupBy(t => t.TaskTypeId).Select(g => new { TypeId = g.Key, Count = g.Count() }).ToListAsync(ct))
            .ToDictionary(x => x.TypeId, x => x.Count);

        var typeTotal = typeCounts.Count;
        var shownTypes = typeCounts.OrderByDescending(t => t.Open).ThenBy(t => t.TypeId).Take(MaxTypeColumns).Select(t => t.TypeId).ToList();
        var typeInfo = shownTypes.Count == 0
            ? []
            : await db.Set<TaskType>().AsNoTracking().Where(t => shownTypes.Contains(t.Id)).Select(t => new { t.Id, t.Name, t.IconKey, t.ColourKey }).ToDictionaryAsync(t => t.Id, ct);

        var types = shownTypes.Select(id =>
        {
            var c = typeCounts.Single(t => t.TypeId == id);
            var info = typeInfo.GetValueOrDefault(id);
            var typeParam = "type=" + id.ToString(CultureInfo.InvariantCulture);
            return new BreakdownType(
                id,
                info?.Name ?? string.Empty,
                info?.IconKey ?? "file-text",
                info?.ColourKey,
                c.Open,
                c.Overdue,
                c.OnHold,
                typeAtRisk.GetValueOrDefault(id),
                Queue(typeParam),
                Queue(typeParam, "overdue=true"));
        }).OrderBy(t => t.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(t => t.TaskTypeId).ToList();

        var totals = new BreakdownTotals(
            typeCounts.Sum(t => t.Open),
            typeCounts.Sum(t => t.Overdue),
            typeCounts.Sum(t => t.OnHold),
            typeAtRisk.Values.Sum(),
            Queue(typeFilter.Select(id => "type=" + id.ToString(CultureInfo.InvariantCulture)).ToArray()),
            Queue([.. typeFilter.Select(id => "type=" + id.ToString(CultureInfo.InvariantCulture)), "overdue=true"]));

        var page = query.Page;
        var pageSize = Math.Clamp(query.PageSize, 1, 50);
        IReadOnlyList<BreakdownRow> rows = [];
        var matterTotal = 0;
        if (view == ViewMatrix)
        {
            matterTotal = await counted.Select(t => t.MatterId).Distinct().CountAsync(ct);
            var pageMatters = await counted.GroupBy(t => t.MatterId)
                .Select(g => new { MatterId = g.Key, Open = g.Count(), Overdue = g.AsQueryable().Count(overdue), OnHold = g.Count(t => t.Status == TaskStatusCode.OnHold) })
                .OrderByDescending(m => m.Overdue).ThenByDescending(m => m.Open).ThenBy(m => m.MatterId)
                .Skip((page - 1) * pageSize).Take(pageSize)
                .ToListAsync(ct);
            var ids = pageMatters.Select(m => m.MatterId).ToList();
            if (ids.Count > 0)
            {
                var inPage = counted.Where(t => ids.Contains(t.MatterId) && shownTypes.Contains(t.TaskTypeId));
                var cells = await inPage.GroupBy(t => new { t.MatterId, t.TaskTypeId }).Select(g => new
                {
                    g.Key.MatterId,
                    g.Key.TaskTypeId,
                    Open = g.Count(),
                    Overdue = g.AsQueryable().Count(overdue),
                    OnHold = g.Count(t => t.Status == TaskStatusCode.OnHold),
                }).ToListAsync(ct);
                var risk = (await AtRiskRules.Where(counted.Where(t => ids.Contains(t.MatterId)), db, clock).GroupBy(t => new { t.MatterId, t.TaskTypeId })
                        .Select(g => new { g.Key.MatterId, g.Key.TaskTypeId, Count = g.Count() }).ToListAsync(ct))
                    .ToDictionary(x => (x.MatterId, x.TaskTypeId), x => x.Count);
                var atRiskByMatter = (await AtRiskRules.Where(counted.Where(t => ids.Contains(t.MatterId)), db, clock).GroupBy(t => t.MatterId)
                        .Select(g => new { MatterId = g.Key, Count = g.Count() }).ToListAsync(ct))
                    .ToDictionary(x => x.MatterId, x => x.Count);
                var names = await (from m in db.Set<Matter>().AsNoTracking().Where(m => ids.Contains(m.Id))
                                   join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                                   select new { m.Id, m.MatterRef, MatterName = m.Name, ClientName = c.Name }).ToDictionaryAsync(m => m.Id, ct);

                rows = [.. pageMatters.Select(m =>
                {
                    var matterParam = "matter=" + m.MatterId.ToString(CultureInfo.InvariantCulture);
                    var n = names[m.MatterId];
                    return new BreakdownRow(
                        m.MatterId,
                        n.MatterRef,
                        n.MatterName,
                        n.ClientName,
                        m.Open,
                        m.Overdue,
                        m.OnHold,
                        atRiskByMatter.GetValueOrDefault(m.MatterId),
                        [.. cells.Where(c => c.MatterId == m.MatterId).OrderBy(c => c.TaskTypeId).Select(c =>
                        {
                            var typeParam = "type=" + c.TaskTypeId.ToString(CultureInfo.InvariantCulture);
                            return new BreakdownCell(c.TaskTypeId, c.Open, c.Overdue, c.OnHold, risk.GetValueOrDefault((c.MatterId, c.TaskTypeId)), Queue(matterParam, typeParam), Queue(matterParam, typeParam, "overdue=true"));
                        })]);
                })];
            }
        }

        return new MyMattersBreakdown(
            clock.ZoneId,
            DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc),
            view,
            status,
            types,
            typeTotal,
            rows,
            matterTotal,
            page,
            pageSize,
            totals);
    }
}
