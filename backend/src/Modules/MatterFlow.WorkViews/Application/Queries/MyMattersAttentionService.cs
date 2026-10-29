using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// "Needs my attention" and "Upcoming deadlines" (issue #681). Attention (issue #905): one ranked list of five rows and one count of the <see cref="AttentionRules"/> set;
/// deadlines: one count and a <c>TOP 25</c>. All bounded by TOP, all on the open tasks of the scope's matters, all with the
/// <see cref="TaskQueueRules"/> predicates. Tasks of matters nobody manages are not in anybody's "mine" scope, so they are never an item.
/// </summary>
public sealed class MyMattersAttentionService(MyMattersScopeResolver scopes, DbContext db)
{
    /// <summary>Rows of the ranked attention list.</summary>
    public const int RowCount = 5;
    public const int DeadlineSize = 25;

    /// <summary>Tasks listed per calendar day and per matter in the grouped deadlines.</summary>
    public const int BucketSize = 5;

    /// <summary>Most matters the matter grouping lists (the rest are counted in <c>MatterTotal</c>).</summary>
    public const int MatterGroupSize = 50;
    public static readonly IReadOnlyList<int> DeadlineWindows = [14, 28];

    public async Task<Result<MyMattersAttention>> GetAsync(MyMattersSectionQuery query, CancellationToken ct)
    {
        var options = SectionSorts.Parse(query);
        if (options.IsFailure)
            return options.Error!;
        var opts = options.Value;
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var today = clock.Today;

        var allOpen = scope.OpenTasks();
        var open = SectionSorts.Filter(allOpen, opts);
        var any = AttentionRules.NeedsAttention(db, clock);

        // The total counts each task once (a task that is overdue and unassigned is one). With a type filter the heading can read "4 of 13": the same count without it.
        var total = await open.Where(any).CountAsync(ct);
        var totalUnfiltered = opts.Filtered ? await allOpen.Where(any).CountAsync(ct) : (int?)null;

        // One TOP N of task ids per reason over index columns only (a seek and a small sort, no row lookups); all five are always asked, so the number of statements does not
        // depend on the data. The first RowCount of each reason are enough: the reasons are walked in rank order and a task already picked is skipped, so a reason can lose
        // at most the rows picked before it.
        var picked = new List<(long Id, string Reason)>();
        foreach (var reason in AttentionRules.Reasons)
        {
            var ids = await TopIdsAsync(open.Where(AttentionRules.Of(reason, db, clock)), OrderOf(reason), RowCount, ct);
            foreach (var id in ids)
            {
                if (picked.Count < RowCount && picked.All(p => p.Id != id))
                    picked.Add((id, reason));
            }
        }

        var details = await DetailsAsync([.. picked.Select(p => p.Id)], ct);
        var names = await NamesAsync(details.Values, clock, ct);
        var items = picked.Select(p =>
        {
            var r = details[p.Id];
            (string, int?) fact = p.Reason switch
            {
                "overdue" => (AttentionFacts.Overdue, DaysOverdue(r, today, clock.NowUtc)),
                "atRisk" => (AttentionFacts.AtRisk, null),
                "dueToday" => (AttentionFacts.DueToday, 0),
                "unassigned" => (AttentionFacts.NoAssignee, null),
                _ => (AttentionFacts.OnHoldDays, MyMattersRules.WholeDaysSince(r.StatusChangedAtUtc, clock.NowUtc)),
            };
            return ToItem(r, names, fact);
        }).ToList();

        return new MyMattersAttention(
            clock.ZoneId,
            DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc),
            MyMattersRules.StuckOnHoldDays,
            total,
            scope.QueueOpen(["needsAttention=true", .. opts.TaskTypeIds.Select(id => "type=" + id.ToString(System.Globalization.CultureInfo.InvariantCulture)), "sort=" + TaskQueueRules.SortAttention]),
            items,
            totalUnfiltered);
    }

    /// <summary>The order inside a reason: by due moment, except at risk (then the oldest first) and on hold (the longest wait first).</summary>
    private static Func<IQueryable<WorkTask>, IOrderedQueryable<WorkTask>> OrderOf(string reason) => reason switch
    {
        "stuckOnHold" => q => q.OrderBy(x => x.StatusChangedAtUtc).ThenBy(x => x.Id),
        "atRisk" => q => q.OrderBy(x => x.DueSortKey).ThenBy(x => x.CreatedAtUtc).ThenBy(x => x.Id),
        _ => q => q.OrderBy(x => x.DueSortKey).ThenBy(x => x.Id),
    };

    /// <summary>The Task Queue parameters after the group's own: the type filter and the sort (the section's natural sort when none was asked).</summary>
    private static string[] QueueTail(SectionOptions options, string naturalSort) =>
        options.Sort is null ? [.. options.QueueParts(), "sort=" + naturalSort] : [.. options.QueueParts()];

    public async Task<Result<MyMattersDeadlines>> DeadlinesAsync(MyMattersDeadlinesQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var days = query.Days ?? DeadlineWindows[0];
        if (!DeadlineWindows.Contains(days))
            return Error.Validation("days", "UNKNOWN_DAYS", $"days must be {string.Join(" or ", DeadlineWindows)}.");
        var options = SectionSorts.Parse(query);
        if (options.IsFailure)
            return options.Error!;
        var opts = options.Value;

        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;
        var today = clock.Today;
        var last = today.AddDays(days);

        // Open, an explicit due date today or within the window, not overdue (overdue is in "Needs my attention"). The date range, if any, narrows it further.
        var allWindow = scope.OpenTasks().Where(TaskQueueRules.DueWithin(clock, days));
        var window = SectionSorts.Filter(allWindow, opts);
        var grouping = query.GroupBy?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(grouping) && grouping is not ("day" or "matter"))
            return Error.Validation("groupBy", "UNKNOWN_GROUP_BY", "groupBy must be day or matter.");

        var windowQuery = scope.QueueOpen(["asap=false", "overdue=false", "dueTo=" + DashboardRules.Date(last), .. QueueTail(opts, "due")]);
        var totalUnfiltered = opts.Filtered ? await allWindow.CountAsync(ct) : (int?)null;
        if (grouping == "day")
            return await ByDayAsync(scope, window, days, windowQuery, totalUnfiltered, ct);
        if (grouping == "matter")
            return await ByMatterAsync(scope, window, days, windowQuery, totalUnfiltered, ct);

        var total = await window.CountAsync(ct);
        var ids = await TopIdsAsync(window, opts.Sort is { } sort ? q => SectionSorts.Apply(q, db, sort, opts.Descending) : q => q.OrderBy(x => x.DueSortKey).ThenBy(x => x.Id), DeadlineSize, ct);
        var details = await DetailsAsync(ids, ct);
        var rows = ids.Select(id => details[id]).ToList();
        var names = await NamesAsync(rows, clock, ct);

        return new MyMattersDeadlines(
            clock.ZoneId,
            DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc),
            days,
            today,
            last,
            total,
            windowQuery,
            [.. rows.Select(r => ToItem(r, names, DueFactOf(r, today)))],
            TotalUnfiltered: totalUnfiltered);
    }

    /// <summary>
    /// The calendar: every day of the window with its count (one grouped statement) and its first five tasks (one statement, a <c>CROSS APPLY</c> of a <c>TOP 5</c> per distinct due date),
    /// then the task columns and the names for all of them at once. The statements do not depend on the number of matters. The day is the task's calendar due date (the viewer's day).
    /// </summary>
    private async Task<Result<MyMattersDeadlines>> ByDayAsync(MyMattersScope scope, IQueryable<WorkTask> window, int days, string windowQuery, int? totalUnfiltered, CancellationToken ct)
    {
        var clock = scope.Clock;
        var today = clock.Today;
        var last = today.AddDays(days);

        var counts = (await window.GroupBy(t => t.DueDate).Select(g => new { Date = g.Key, Count = g.Count() }).ToListAsync(ct))
            .Where(c => c.Date != null).ToDictionary(c => c.Date!.Value, c => c.Count);
        var dates = window.Select(t => t.DueDate).Distinct();
        var topIds = counts.Count == 0
            ? []
            : await (from d in dates
                     from t in window.Where(x => x.DueDate == d).OrderBy(x => x.DueSortKey).ThenBy(x => x.Id).Take(BucketSize)
                     select new { Date = d, t.Id }).ToListAsync(ct);
        var details = await DetailsAsync([.. topIds.Select(t => t.Id)], ct);
        var names = await NamesAsync(details.Values, clock, ct);

        var byDay = new List<MyMattersDeadlineDay>();
        for (var date = today; date <= last; date = date.AddDays(1))
        {
            var items = topIds.Where(t => t.Date == date).Select(t => details[t.Id]).OrderBy(r => r.DueAtUtc ?? r.DueDate!.Value.ToDateTime(TimeOnly.MaxValue)).ThenBy(r => r.Id).ToList();
            byDay.Add(new MyMattersDeadlineDay(
                date,
                date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday,
                date == today,
                counts.GetValueOrDefault(date),
                scope.QueueOpenInWindow("asap=false", "overdue=false", "dueFrom=" + DashboardRules.Date(date), "dueTo=" + DashboardRules.Date(date), "sort=due"),
                [.. items.Select(r => ToItem(r, names, DueFactOf(r, today)))]));
        }

        return new MyMattersDeadlines(
            clock.ZoneId,
            DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc),
            days,
            today,
            last,
            counts.Values.Sum(),
            windowQuery,
            [],
            "day",
            byDay,
            TotalUnfiltered: totalUnfiltered);
    }

    /// <summary>
    /// The matters with deadlines in the window, soonest first (one grouped statement), and the first five tasks of the first <see cref="MatterGroupSize"/> of them (one statement, a
    /// <c>CROSS APPLY</c> of a <c>TOP 5</c> per matter that seeks <c>IX_Task_Matter</c>), then task columns and names at once.
    /// </summary>
    private async Task<Result<MyMattersDeadlines>> ByMatterAsync(MyMattersScope scope, IQueryable<WorkTask> window, int days, string windowQuery, int? totalUnfiltered, CancellationToken ct)
    {
        var clock = scope.Clock;
        var today = clock.Today;
        var last = today.AddDays(days);

        var groups = await window.GroupBy(t => t.MatterId)
            .Select(g => new { MatterId = g.Key, Count = g.Count(), Next = g.Min(t => t.DueSortKey), NextDate = g.Min(t => t.DueDate) })
            .OrderBy(g => g.Next).ThenBy(g => g.MatterId)
            .Take(MatterGroupSize)
            .ToListAsync(ct);
        var matterTotal = await window.Select(t => t.MatterId).Distinct().CountAsync(ct);
        var total = await window.CountAsync(ct);
        var shown = groups.Select(g => g.MatterId).ToList();
        var topIds = shown.Count == 0
            ? []
            : await (from m in scope.Matters.Where(m => shown.Contains(m.Id))
                     from t in window.Where(x => x.MatterId == m.Id).OrderBy(x => x.DueSortKey).ThenBy(x => x.Id).Take(BucketSize)
                     select new { MatterId = m.Id, t.Id }).ToListAsync(ct);
        var details = await DetailsAsync([.. topIds.Select(t => t.Id)], ct);
        var names = await NamesAsync(details.Values, clock, ct);
        var matterNames = shown.Count == 0 ? new Dictionary<int, MatterNameRow>() : names.Matters.ToDictionary(kv => kv.Key, kv => kv.Value);
        if (shown.Any(id => !matterNames.ContainsKey(id)))
            matterNames = await MatterNamesAsync(shown, ct);

        var byMatter = groups.Select(g =>
        {
            var name = matterNames[g.MatterId];
            var items = topIds.Where(t => t.MatterId == g.MatterId).Select(t => details[t.Id]).OrderBy(r => r.DueAtUtc ?? r.DueDate!.Value.ToDateTime(TimeOnly.MaxValue)).ThenBy(r => r.Id).ToList();
            return new MyMattersDeadlineMatter(
                g.MatterId,
                name.MatterRef,
                name.MatterName,
                name.ClientName,
                g.Count,
                g.NextDate,
                scope.QueueOpen("asap=false", "overdue=false", "dueTo=" + DashboardRules.Date(last), "matter=" + g.MatterId.ToString(System.Globalization.CultureInfo.InvariantCulture), "sort=due"),
                [.. items.Select(r => ToItem(r, names, DueFactOf(r, today)))]);
        }).ToList();

        return new MyMattersDeadlines(
            clock.ZoneId,
            DateTime.SpecifyKind(clock.NowUtc, DateTimeKind.Utc),
            days,
            today,
            last,
            total,
            windowQuery,
            [],
            "matter",
            null,
            byMatter,
            matterTotal,
            totalUnfiltered);
    }

    private async Task<Dictionary<int, MatterNameRow>> MatterNamesAsync(IReadOnlyCollection<int> ids, CancellationToken ct) =>
        await (from m in db.Set<Matter>().AsNoTracking().Where(m => ids.Contains(m.Id))
               join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
               select new { m.Id, m.MatterRef, MatterName = m.Name, ClientName = c.Name }).ToDictionaryAsync(m => m.Id, m => new MatterNameRow(m.MatterRef, m.MatterName, m.ClientName), ct);

    private static (string, int?) DueFactOf(TaskRow r, DateOnly today)
    {
        var due = r.DueDate ?? (r.DueAtUtc is { } at ? DateOnly.FromDateTime(at) : (DateOnly?)null);
        if (due is null)
            return (AttentionFacts.DueToday, null);
        var diff = due.Value.DayNumber - today.DayNumber;
        return diff <= 0 ? (AttentionFacts.DueToday, 0) : (AttentionFacts.DueInDays, diff);
    }

    private static int DaysOverdue(TaskRow r, DateOnly today, DateTime nowUtc)
    {
        if (r.DueDate is { } due)
            return Math.Max(0, today.DayNumber - due.DayNumber);
        return r.DueAtUtc is { } at ? MyMattersRules.WholeDaysSince(at, nowUtc) : 0;
    }

    private static MyMattersTaskItem ToItem(TaskRow r, Names names, (string Code, int? Days) fact)
    {
        var matter = names.Matters[r.MatterId];
        var facts = names.Facts.GetValueOrDefault(r.Id) ?? TaskFacts.Unknown;
        return new MyMattersTaskItem(
            r.Id,
            r.Number,
            r.Title,
            r.MatterId,
            matter.MatterRef,
            matter.MatterName,
            matter.ClientName,
            fact.Code,
            fact.Days,
            r.DueDate,
            r.DueAtUtc is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : null,
            r.AssignedUserId,
            r.AssignedUserId is { } uid ? names.Users.GetValueOrDefault(uid) : null,
            facts.TaskTypeId,
            facts.TaskTypeName,
            facts.TaskTypeIconKey,
            facts.TaskTypeColourKey,
            facts.PriorityName,
            facts.PriorityRank,
            facts.StatusCode,
            facts.AgeDays,
            facts.OnHold,
            facts.AtRisk);
    }

    private sealed class TaskRow
    {
        public long Id { get; init; }

        public string Number { get; init; } = string.Empty;

        public string Title { get; init; } = string.Empty;

        public int MatterId { get; init; }

        public DateOnly? DueDate { get; init; }

        public DateTime? DueAtUtc { get; init; }

        public int? AssignedUserId { get; init; }

        public DateTime StatusChangedAtUtc { get; init; }
    }

    private sealed record Names(IReadOnlyDictionary<int, MatterNameRow> Matters, IReadOnlyDictionary<int, string> Users, IReadOnlyDictionary<long, TaskFacts> Facts);

    private sealed record MatterNameRow(string MatterRef, string MatterName, string ClientName);

    /// <summary>The ids of the first <paramref name="take"/> tasks in the given order. The order uses columns of <c>IX_Task_Matter</c> only, so this is a seek and a small sort.</summary>
    private static async Task<List<long>> TopIdsAsync(IQueryable<WorkTask> tasks, Func<IQueryable<WorkTask>, IOrderedQueryable<WorkTask>> order, int take, CancellationToken ct) =>
        await order(tasks).Take(take).Select(t => t.Id).ToListAsync(ct);

    /// <summary>The columns of the given tasks in one statement (a clustered-key seek per task).</summary>
    private async Task<Dictionary<long, TaskRow>> DetailsAsync(IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0)
            return [];
        var wanted = ids.Distinct().ToList();
        return await db.Set<WorkTask>().AsNoTracking().Where(t => wanted.Contains(t.Id)).Select(t => new TaskRow
        {
            Id = t.Id,
            Number = t.Number,
            Title = t.Title,
            MatterId = t.MatterId,
            DueDate = t.DueDate,
            DueAtUtc = t.DueAtUtc,
            AssignedUserId = t.AssignedUserId,
            StatusChangedAtUtc = t.StatusChangedAtUtc,
        }).ToDictionaryAsync(t => t.Id, ct);
    }

    /// <summary>Matter, client and assignee names of the rows, and their type, priority and state facts: a fixed number of statements whatever the number of rows.</summary>
    private async Task<Names> NamesAsync(IEnumerable<TaskRow> source, QueueClock clock, CancellationToken ct)
    {
        var rows = source.ToList();
        var matterIds = rows.Select(r => r.MatterId).Distinct().ToList();
        var userIds = rows.Where(r => r.AssignedUserId != null).Select(r => r.AssignedUserId!.Value).Distinct().ToList();
        var matters = matterIds.Count == 0
            ? []
            : await (from m in db.Set<Matter>().AsNoTracking().Where(m => matterIds.Contains(m.Id))
                     join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                     select new { m.Id, m.MatterRef, MatterName = m.Name, ClientName = c.Name }).ToDictionaryAsync(m => m.Id, m => new MatterNameRow(m.MatterRef, m.MatterName, m.ClientName), ct);
        var users = userIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        var facts = await MyMattersTaskFacts.LoadAsync(db, [.. rows.Select(r => r.Id)], clock, ct);
        return new Names(matters, users, facts);
    }
}
