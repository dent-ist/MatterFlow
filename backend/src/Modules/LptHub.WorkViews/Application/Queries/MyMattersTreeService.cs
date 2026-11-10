using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The client/matter tree (UI-03, #956): clients with the scope's visible matters, the open, overdue, unassigned and critical counts per matter and the "active" flag (an open task, or an
/// asset created or updated in the last N days; N is the query's <c>activeDays</c>, else the configuration key <c>MyMatters:ActiveDays</c>, else 7). Four statements whatever the number of matters:
/// matters with clients, one grouped pass over the open tasks, one grouped pass over the assets, and the Critical priority ids. Overdue is New or In Progress and past due (On Hold is never overdue).
/// </summary>
public sealed class MyMattersTreeService(MyMattersScopeResolver scopes, DbContext db, IConfiguration configuration)
{
    public async Task<Result<MyMattersTree>> GetAsync(MyMattersTreeQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var now = DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc);
        var activeDays = query.ActiveDays ?? (int.TryParse(configuration["MyMatters:ActiveDays"], out var configured) && configured is >= 1 and <= 90 ? configured : MyMattersTreeQuery.DefaultActiveDays);
        var activeSince = now.AddDays(-activeDays);

        var matters = await (from m in scope.Matters
                             join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                             select new { m.Id, m.MatterRef, m.Name, m.IsSensitive, ClientId = c.Id, ClientNumber = c.ClientNumber.ToString(), ClientName = c.Name })
            .ToListAsync(ct);

        var criticalIds = await db.Set<Priority>().AsNoTracking().Where(p => p.Label.ToLower() == ShowFilter.CriticalLabel.ToLower()).Select(p => p.Id).ToListAsync(ct);
        var overdueNow = ShowFilter.OverdueNow(clock);
        var taskCounts = (await scope.OpenTasks().GroupBy(t => t.MatterId).Select(g => new
        {
            MatterId = g.Key,
            Open = g.Count(),
            Overdue = g.AsQueryable().Count(overdueNow),
            Unassigned = g.Count(t => t.AssignedUserId == null),
            Critical = g.Count(t => criticalIds.Contains(t.PriorityId)),
        }).ToListAsync(ct)).ToDictionary(x => x.MatterId);

        var matterIds = scope.Matters.Select(m => m.Id);
        var assetChanges = (await db.Set<Asset>().AsNoTracking().Where(a => matterIds.Contains(a.MatterId))
            .GroupBy(a => a.MatterId).Select(g => new { MatterId = g.Key, Last = g.Max(a => a.ModifiedAtUtc ?? a.CreatedAtUtc) })
            .ToListAsync(ct)).ToDictionary(x => x.MatterId, x => DateTime.SpecifyKind(x.Last, DateTimeKind.Utc));

        var text = query.Q?.Trim();
        var clients = new List<MyMattersTreeClient>();
        foreach (var group in matters.GroupBy(m => m.ClientId).OrderBy(g => g.First().ClientName, StringComparer.OrdinalIgnoreCase))
        {
            var first = group.First();
            var clientMatches = string.IsNullOrEmpty(text)
                || first.ClientName.Contains(text, StringComparison.OrdinalIgnoreCase)
                || first.ClientNumber.Contains(text, StringComparison.OrdinalIgnoreCase);
            var rows = new List<MyMattersTreeMatter>();
            foreach (var m in group.OrderBy(x => x.MatterRef, StringComparer.Ordinal))
            {
                if (!clientMatches && !m.Name.Contains(text!, StringComparison.OrdinalIgnoreCase) && !m.MatterRef.Contains(text!, StringComparison.OrdinalIgnoreCase))
                    continue;
                taskCounts.TryGetValue(m.Id, out var tc);
                DateTime? lastAsset = assetChanges.TryGetValue(m.Id, out var last) ? last : null;
                var active = (tc?.Open ?? 0) > 0 || (lastAsset is { } l && l >= activeSince);
                if (query.ActiveOnly == true && !active)
                    continue;
                rows.Add(new MyMattersTreeMatter(m.Id, m.MatterRef, m.Name, m.IsSensitive, active, tc?.Open ?? 0, tc?.Overdue ?? 0, tc?.Unassigned ?? 0, tc?.Critical ?? 0, lastAsset));
            }

            if (rows.Count == 0)
                continue;
            clients.Add(new MyMattersTreeClient(
                first.ClientId, first.ClientNumber, first.ClientName, rows.Count, rows.Count(r => r.IsActive),
                rows.Sum(r => r.OpenTasks), rows.Sum(r => r.Overdue), rows.Sum(r => r.Unassigned), rows.Sum(r => r.Critical), rows));
        }

        return new MyMattersTree(now, clock.ZoneId, activeDays, clients.Count, clients.Sum(c => c.MatterCount), clients);
    }
}
