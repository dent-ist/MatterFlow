using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkflowEngine.Domain;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The matter health table (issue #679): one row per matter of the scope with open, overdue, due this week, unassigned, the workflow percentage, the
/// next deadline and the flag. Three statements whatever the number of matters: the matters (with their client), ONE grouped pass over the open tasks
/// (<c>GROUP BY MatterId</c> with conditional counts), and, only after sorting and paging, the step counts of the 50 matters on the page (the one
/// expensive read). A matter without open tasks has no group row and is Green with "No open tasks".
/// </summary>
public sealed class MyMattersHealthService(MyMattersScopeResolver scopes)
{
    public const string SortNextDeadline = "nextDeadline";
    public const string SortClient = "client";
    public const string SortMatter = "matter";
    public const string SortOpen = "open";
    public const string SortOverdue = "overdue";
    public const string SortDueThisWeek = "dueThisWeek";
    public const string SortUnassigned = "unassigned";
    public const string SortFlag = "flag";

    /// <summary>The worst matter first: most overdue, then most at risk, then most unassigned, then the soonest deadline (the Overview's compact list, epic #893).</summary>
    public const string SortWorst = "worst";

    public static readonly IReadOnlyList<string> SortFields = [SortNextDeadline, SortClient, SortMatter, SortOpen, SortOverdue, SortDueThisWeek, SortUnassigned, SortFlag, SortWorst];

    public async Task<Result<MyMattersHealthPage>> GetAsync(MyMattersHealthQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var sort = SortNextDeadline;
        if (!string.IsNullOrWhiteSpace(query.Sort))
        {
            var match = SortFields.FirstOrDefault(f => string.Equals(f, query.Sort.Trim(), StringComparison.OrdinalIgnoreCase));
            if (match is null)
                return Error.Validation("sort", "UNKNOWN_SORT", $"Unknown sort '{query.Sort}'. Allowed: {string.Join(", ", SortFields)}.");
            sort = match;
        }

        var descending = sort is SortOpen or SortOverdue or SortDueThisWeek or SortUnassigned or SortWorst;
        if (!string.IsNullOrWhiteSpace(query.Dir))
        {
            var dir = query.Dir.Trim().ToLowerInvariant();
            if (dir is not ("asc" or "desc"))
                return Error.Validation("dir", "UNKNOWN_DIRECTION", "dir must be asc or desc.");
            descending = dir == "desc";
        }

        var page = MatterFlow.SharedKernel.Paging.PageRequest.Create(query.Page, query.PageSize);
        if (page.IsFailure)
            return page.Error!;

        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var db = scope.Db;

        var matters = await (from m in scope.Matters
                             join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                             select new { m.Id, m.MatterRef, MatterName = m.Name, ClientId = c.Id, c.ClientNumber, ClientName = c.Name }).ToListAsync(ct);

        var overdue = TaskQueueRules.Overdue(clock);
        var due3 = TaskQueueRules.DueWithin(clock, MyMattersRules.AmberDueDays);
        var due7 = TaskQueueRules.DueWithin(clock, 7);
        var notOverdue = MyMattersRules.Not(overdue);
        var stuck = MyMattersRules.StuckOnHold(clock.NowUtc);
        var counts = (await scope.OpenTasks().GroupBy(t => t.MatterId).Select(g => new
        {
            MatterId = g.Key,
            Open = g.Count(),
            Overdue = g.AsQueryable().Count(overdue),
            Due3 = g.AsQueryable().Count(due3),
            Due7 = g.AsQueryable().Count(due7),
            Unassigned = g.AsQueryable().Count(MyMattersRules.Unassigned),
            Stuck = g.AsQueryable().Count(stuck),
            Next = g.AsQueryable().Where(notOverdue).Where(t => t.DueDate != null).Min(t => t.DueDate),
        }).ToListAsync(ct)).ToDictionary(r => r.MatterId);

        var atRisk = await AtRiskRules.Where(scope.OpenTasks(), db, clock).GroupBy(t => t.MatterId).Select(g => new { MatterId = g.Key, Count = g.Count() }).ToDictionaryAsync(r => r.MatterId, r => r.Count, ct);

        var rows = matters.Select(m =>
        {
            counts.TryGetValue(m.Id, out var c);
            var (flag, reasons) = MyMattersRules.Flag(c?.Open ?? 0, c?.Overdue ?? 0, c?.Unassigned ?? 0, c?.Due3 ?? 0, c?.Stuck ?? 0);
            return new Row(m.Id, m.MatterRef, m.MatterName, m.ClientId, m.ClientNumber.Value, m.ClientName, c?.Open ?? 0, c?.Overdue ?? 0, c?.Due7 ?? 0, c?.Unassigned ?? 0, atRisk.GetValueOrDefault(m.Id), c?.Next, flag, reasons);
        }).ToList();

        var ordered = Order(rows, sort, descending).Skip(page.Value.Skip).Take(page.Value.PageSize).ToList();

        // The expensive read, for the page's matters only: steps completed or skipped over all steps of the workflows of their open tasks.
        var pageIds = ordered.Select(r => r.MatterId).ToList();
        var steps = pageIds.Count == 0
            ? []
            : (await (from t in scope.OpenTasks().Where(t => pageIds.Contains(t.MatterId))
                      join s in db.Set<StepInstanceRecord>().AsNoTracking() on t.WorkflowInstanceId equals s.WorkflowInstanceId
                      group s by t.MatterId into g
                      select new { MatterId = g.Key, Total = g.Count(), Done = g.Count(s => s.Status == StepStatus.Completed || s.Status == StepStatus.Skipped) })
                .ToListAsync(ct)).ToDictionary(r => r.MatterId);

        var items = ordered.Select(r => new MyMattersHealthRow(
            r.MatterId,
            r.MatterRef,
            r.MatterName,
            r.ClientId,
            r.ClientNumber,
            r.ClientName,
            r.Open,
            r.Overdue,
            r.DueThisWeek,
            r.Unassigned,
            r.AtRisk,
            r.Open > 0 && steps.TryGetValue(r.MatterId, out var st) ? MyMattersRules.PercentComplete(st.Total, st.Done) : null,
            r.NextDeadline,
            r.Flag,
            r.Reasons,
            DashboardRules.Open([$"matter={r.MatterId}", .. scope.RangeParts()]))).ToList();

        return new MyMattersHealthPage(
            items,
            rows.Count,
            page.Value.Page,
            page.Value.PageSize,
            sort,
            descending ? "desc" : "asc",
            MyMattersRules.AmberDueDays,
            MyMattersRules.StuckOnHoldDays,
            clock.ZoneId);
    }

    private sealed record Row(
        int MatterId,
        string MatterRef,
        string MatterName,
        int ClientId,
        string ClientNumber,
        string ClientName,
        int Open,
        int Overdue,
        int DueThisWeek,
        int Unassigned,
        int AtRisk,
        DateOnly? NextDeadline,
        string Flag,
        IReadOnlyList<string> Reasons);

    /// <summary>Sorts in memory (at most the cap of 5,000 matters); ties fall back to client, matter reference and id so a page never repeats or skips a row.</summary>
    private static IEnumerable<Row> Order(List<Row> rows, string sort, bool descending)
    {
        IOrderedEnumerable<Row> Primary<TKey>(Func<Row, TKey> key, IComparer<TKey>? comparer = null) =>
            descending ? rows.OrderByDescending(key, comparer) : rows.OrderBy(key, comparer);

        var text = StringComparer.CurrentCultureIgnoreCase;
        var ordered = sort switch
        {
            SortNextDeadline => (descending ? rows.OrderBy(r => r.NextDeadline is null ? 1 : 0).ThenByDescending(r => r.NextDeadline) : rows.OrderBy(r => r.NextDeadline is null ? 1 : 0).ThenBy(r => r.NextDeadline)),
            SortClient => Primary(r => r.ClientName, text),
            SortMatter => Primary(r => r.MatterRef, StringComparer.Ordinal),
            SortOpen => Primary(r => r.Open),
            SortOverdue => Primary(r => r.Overdue),
            SortDueThisWeek => Primary(r => r.DueThisWeek),
            SortUnassigned => Primary(r => r.Unassigned),
            SortWorst => descending
                ? rows.OrderByDescending(r => r.Overdue).ThenByDescending(r => r.AtRisk).ThenByDescending(r => r.Unassigned).ThenBy(r => r.NextDeadline is null ? 1 : 0).ThenBy(r => r.NextDeadline)
                : rows.OrderBy(r => r.Overdue).ThenBy(r => r.AtRisk).ThenBy(r => r.Unassigned).ThenBy(r => r.NextDeadline is null ? 1 : 0).ThenBy(r => r.NextDeadline),
            _ => Primary(r => MyMattersRules.FlagRank(r.Flag)),
        };
        return ordered.ThenBy(r => r.ClientName, text).ThenBy(r => r.MatterRef, StringComparer.Ordinal).ThenBy(r => r.MatterId);
    }
}
