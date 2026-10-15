using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.SharedKernel.ValueObjects;
using MatterFlow.WorkflowEngine.Domain;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Read side of the Dashboard Swimlane tab: every open Task plus the Tasks closed in the last N days, as four lanes of cards. It reuses
/// <see cref="TaskQueueRules"/> and the Task Queue filter and row loading, so a card shows exactly what the Task Queue shows. A fixed number of reads:
/// one grouped count, one ordered id read per non-empty lane, the row details of all returned cards, client numbers, availability of the assignees and
/// one grouped read for the requested group metadata. Operational view only: no per-person completion figures.
/// </summary>
public sealed class SwimlaneService(DbContext db, IClock clock, IUserTimeZone timeZone, ICurrentUser currentUser, TaskQueueService queue, IUserAvailabilityReader availability)
{
    private static readonly (TaskStatusCode Status, string Label)[] Lanes =
    [
        (TaskStatusCode.New, "New"),
        (TaskStatusCode.InProgress, "In Progress"),
        (TaskStatusCode.OnHold, "On Hold"),
        (TaskStatusCode.Completed, "Completed"),
    ];

    public async Task<Result<SwimlaneBoard>> GetAsync(SwimlaneQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see the dashboard.");

        var groupBy = SwimlaneRules.GroupBys.FirstOrDefault(g => string.Equals(g, query.GroupBy ?? SwimlaneRules.GroupNone, StringComparison.OrdinalIgnoreCase));
        if (groupBy is null)
            return Error.Validation("groupBy", "UNKNOWN_GROUP_BY", $"Unknown groupBy '{query.GroupBy}'. Allowed: {string.Join(", ", SwimlaneRules.GroupBys)}.");
        var sort = SwimlaneRules.Sorts.FirstOrDefault(s => string.Equals(s, query.Sort ?? SwimlaneRules.SortPriority, StringComparison.OrdinalIgnoreCase));
        if (sort is null)
            return Error.Validation("sort", "UNKNOWN_SORT", $"Unknown sort '{query.Sort}'. Allowed: {string.Join(", ", SwimlaneRules.Sorts)}.");

        var assignees = new List<int>();
        var unassigned = false;
        if (!string.IsNullOrWhiteSpace(query.AssigneeId))
        {
            if (string.Equals(query.AssigneeId.Trim(), "unassigned", StringComparison.OrdinalIgnoreCase))
                unassigned = true;
            else if (int.TryParse(query.AssigneeId, out var id))
                assignees.Add(id);
            else
                return Error.Validation("assigneeId", "UNKNOWN_ASSIGNEE", "assigneeId must be a user id or 'unassigned'.");
        }

        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);
        var from = DashboardRules.PeriodStart(queueClock.Today, query.CompletedDays);
        var fromUtc = queueClock.StartOfDayUtc(from);

        var filter = new TaskQueueFilter(
            string.IsNullOrWhiteSpace(query.Q) ? null : query.Q.Trim(),
            [],
            query.PriorityId is { } pr ? [pr] : [],
            query.PodId is { } pod ? [pod] : [],
            false,
            assignees,
            unassigned,
            [],
            null,
            null,
            null,
            query.TaskTypeId is { } ty ? [ty] : [],
            [],
            null,
            null,
            null,
            null,
            null,
            query.OverdueOnly == true ? true : null,
            null,
            null,
            null);
        var filtered = queue.ApplyFilter(db.Set<WorkTask>().AsNoTracking(), filter, queueClock);
        if (query.Mine == true)
            filtered = filtered.Where(t => t.AssignedUserId == me);

        // Open Tasks, plus the closed ones whose last status change falls inside the window.
        var scope = filtered.Where(t =>
            t.Status == TaskStatusCode.New || t.Status == TaskStatusCode.InProgress || t.Status == TaskStatusCode.OnHold
            || ((t.Status == TaskStatusCode.Completed || t.Status == TaskStatusCode.Cancelled) && t.StatusChangedAtUtc >= fromUtc));

        var byStatus = await scope.GroupBy(t => t.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct);
        var counts = new Dictionary<TaskStatusCode, int>
        {
            [TaskStatusCode.New] = byStatus.Where(s => s.Status == TaskStatusCode.New).Sum(s => s.Count),
            [TaskStatusCode.InProgress] = byStatus.Where(s => s.Status == TaskStatusCode.InProgress).Sum(s => s.Count),
            [TaskStatusCode.OnHold] = byStatus.Where(s => s.Status == TaskStatusCode.OnHold).Sum(s => s.Count),
            [TaskStatusCode.Completed] = byStatus.Where(s => s.Status is TaskStatusCode.Completed or TaskStatusCode.Cancelled).Sum(s => s.Count),
        };

        var idsByLane = new Dictionary<TaskStatusCode, IReadOnlyList<long>>();
        foreach (var (status, _) in Lanes)
        {
            var lane = status == TaskStatusCode.Completed
                ? scope.Where(t => t.Status == TaskStatusCode.Completed || t.Status == TaskStatusCode.Cancelled)
                : scope.Where(t => t.Status == status);
            idsByLane[status] = counts[status] == 0 ? [] : await OrderedIdsAsync(lane, sort, ct);
        }

        var allIds = idsByLane.Values.SelectMany(v => v).ToList();
        var rows = await LoadCardsAsync(allIds, queueClock, ct);
        var states = await availability.EvaluateAsync(rows.Values.Where(r => r.AssigneeId != null).Select(r => r.AssigneeId!.Value).Distinct().ToList(), queueClock.NowUtc, ct);

        var lanes = Lanes.Select(l =>
        {
            var code = l.Status.ToCode();
            var cards = idsByLane[l.Status].Where(rows.ContainsKey).Select(id => ToCard(rows[id], states)).ToList();
            var count = counts[l.Status];
            return new SwimlaneLane(code, l.Label, count, count > cards.Count, count, cards);
        }).ToList();

        var groups = groupBy switch
        {
            SwimlaneRules.GroupPriority => await PriorityGroupsAsync(scope, ct),
            SwimlaneRules.GroupAssignee => await AssigneeGroupsAsync(scope, ct),
            SwimlaneRules.GroupClientMatter => await ClientMatterGroupsAsync(scope, ct),
            _ => (IReadOnlyList<SwimlaneGroup>)[],
        };

        return new SwimlaneBoard(queueClock.ZoneId, DateTime.SpecifyKind(queueClock.NowUtc, DateTimeKind.Utc), query.CompletedDays, from, groupBy, sort, SwimlaneRules.LaneCap, lanes, groups);
    }

    private async Task<IReadOnlyList<long>> OrderedIdsAsync(IQueryable<WorkTask> lane, string sort, CancellationToken ct)
    {
        var priorities = db.Set<Priority>().AsNoTracking();
        if (sort == SwimlaneRules.SortClientMatter)
        {
            var rows = from t in lane
                       join p in priorities on t.PriorityId equals p.Id
                       join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
                       join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                       select new { t.Id, ClientName = c.Name, ClientId = c.Id, m.MatterRef, p.SortOrder, t.DueSortKey, t.CreatedAtUtc };
            return await rows.OrderBy(r => r.ClientName).ThenBy(r => r.ClientId).ThenBy(r => r.MatterRef)
                .ThenBy(r => r.SortOrder).ThenBy(r => r.DueSortKey == null ? 0 : 1).ThenBy(r => r.DueSortKey).ThenBy(r => r.CreatedAtUtc).ThenBy(r => r.Id)
                .Select(r => r.Id).Take(SwimlaneRules.LaneCap).ToListAsync(ct);
        }

        var sortRows = from t in lane
                       join p in priorities on t.PriorityId equals p.Id
                       select new TaskSortRow
                       {
                           Id = t.Id,
                           PrioritySortOrder = p.SortOrder,
                           Status = t.Status,
                           DueDate = t.DueDate,
                           DueSortKey = t.DueSortKey,
                           CreatedAtUtc = t.CreatedAtUtc,
                           StatusChangedAtUtc = t.StatusChangedAtUtc,
                       };
        var (rule, descending) = sort switch
        {
            SwimlaneRules.SortDue => (TaskQueueRules.SortDue, false),
            SwimlaneRules.SortCreated => (TaskQueueRules.SortCreated, true),
            _ => (TaskQueueRules.SortDefault, false), // priority rank, ASAP above due dates, due ascending, oldest first
        };
        return await TaskQueueRules.Order(sortRows, rule, descending).Select(r => r.Id).Take(SwimlaneRules.LaneCap).ToListAsync(ct);
    }

    /// <summary>One card's columns as read from the database.</summary>
    private sealed class CardRow
    {
        public long Id { get; init; }

        public string Number { get; init; } = string.Empty;

        public string Title { get; init; } = string.Empty;

        public TaskStatusCode Status { get; init; }

        public int PriorityId { get; init; }

        public string PriorityLabel { get; init; } = string.Empty;

        public string PriorityColor { get; init; } = string.Empty;

        public int PrioritySortOrder { get; init; }

        public int? AssigneeId { get; init; }

        public string? AssigneeName { get; init; }

        public bool AssigneeIsActive { get; init; }

        public int? PodId { get; init; }

        public string? PodName { get; init; }

        public bool PodIsActive { get; init; }

        public int ClientId { get; init; }

        public BusinessNumber ClientNumber { get; init; }

        public string ClientName { get; init; } = string.Empty;

        public int MatterId { get; init; }

        public string MatterRef { get; init; } = string.Empty;

        public string MatterName { get; init; } = string.Empty;

        public bool MatterIsSensitive { get; init; }

        public int TaskTypeId { get; init; }

        public string TaskTypeName { get; init; } = string.Empty;

        public string TaskTypeIconKey { get; init; } = string.Empty;

        public DateOnly? DueDate { get; init; }

        public DateTime? DueAtUtc { get; init; }

        public long WorkflowInstanceId { get; init; }

        public DateTime CreatedAtUtc { get; init; }

        public DateTime? CompletedAtUtc { get; init; }

        public byte[] RowVersion { get; init; } = [];
    }

    /// <summary>
    /// Reads the cards of the given Tasks with six joins and one aggregate over the step instances (counts only), so a board of up to 800 cards stays
    /// cheap. Mirrors the columns of <see cref="TaskQueueRow"/> that a card needs.
    /// </summary>
    private async Task<Dictionary<long, Card>> LoadCardsAsync(IReadOnlyList<long> ids, QueueClock queueClock, CancellationToken ct)
    {
        if (ids.Count == 0)
            return [];

        var rows = await (
            from t in db.Set<WorkTask>().AsNoTracking().Where(t => ids.Contains(t.Id))
            join p in db.Set<Priority>().AsNoTracking() on t.PriorityId equals p.Id
            join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
            join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
            join ty in db.Set<TaskType>().AsNoTracking() on t.TaskTypeId equals ty.Id
            join pod in db.Set<Pod>().AsNoTracking() on t.AssignedPodId equals (int?)pod.Id into pods
            from pod in pods.DefaultIfEmpty()
            join au in db.Set<AppUser>().AsNoTracking() on t.AssignedUserId equals (int?)au.Id into assignees
            from au in assignees.DefaultIfEmpty()
            select new CardRow
            {
                Id = t.Id,
                Number = t.Number,
                Title = t.Title,
                Status = t.Status,
                PriorityId = t.PriorityId,
                PriorityLabel = p.Label,
                PriorityColor = p.Color,
                PrioritySortOrder = p.SortOrder,
                AssigneeId = t.AssignedUserId,
                AssigneeName = au == null ? null : au.DisplayName,
                AssigneeIsActive = au != null && au.IsActive,
                PodId = t.AssignedPodId,
                PodName = pod == null ? null : pod.Name,
                PodIsActive = pod != null && pod.IsActive,
                ClientId = c.Id,
                ClientNumber = c.ClientNumber,
                ClientName = c.Name,
                MatterId = m.Id,
                MatterRef = m.MatterRef,
                MatterName = m.Name,
                MatterIsSensitive = m.IsSensitive,
                TaskTypeId = ty.Id,
                TaskTypeName = ty.Name,
                TaskTypeIconKey = ty.IconKey,
                DueDate = t.DueDate,
                DueAtUtc = t.DueAtUtc,
                WorkflowInstanceId = t.WorkflowInstanceId,
                CreatedAtUtc = t.CreatedAtUtc,
                CompletedAtUtc = t.CompletedAtUtc,
                RowVersion = t.RowVersion,
            }).ToListAsync(ct);

        var instanceIds = rows.Select(r => r.WorkflowInstanceId).Distinct().ToList();
        var steps = await db.Set<StepInstanceRecord>().AsNoTracking()
            .Where(s => instanceIds.Contains(s.WorkflowInstanceId))
            .GroupBy(s => s.WorkflowInstanceId)
            .Select(g => new { Id = g.Key, Total = g.Count(), Resolved = g.Count(s => s.Status == StepStatus.Completed || s.Status == StepStatus.Skipped) })
            .ToDictionaryAsync(g => g.Id, ct);
        var labels = await db.Set<TaskStatusLabel>().AsNoTracking().ToDictionaryAsync(l => l.StatusCode, l => l.DisplayLabel, ct);

        return rows.ToDictionary(r => r.Id, r =>
        {
            var code = r.Status.ToCode();
            steps.TryGetValue(r.WorkflowInstanceId, out var progress);
            return new Card(r, labels.GetValueOrDefault(code, code), progress?.Resolved ?? 0, progress?.Total ?? 0, TaskQueueRules.IsOverdue(r.Status, r.DueDate, r.DueAtUtc, queueClock));
        });
    }

    private sealed record Card(CardRow Row, string StatusLabel, int StepsResolved, int StepsTotal, bool IsOverdue)
    {
        public int? AssigneeId => Row.AssigneeId;
    }

    private static SwimlaneCard ToCard(Card card, IReadOnlyDictionary<int, MatterFlow.SharedKernel.Availability.AvailabilityEvaluation> states)
    {
        var r = card.Row;
        return new SwimlaneCard(
            r.Id,
            r.Number,
            r.Title,
            r.Status.ToCode(),
            card.StatusLabel,
            new SwimlanePriority(r.PriorityId, r.PriorityLabel, r.PriorityColor, r.PrioritySortOrder),
            r.AssigneeId is { } uid ? new SwimlaneAssignee(uid, r.AssigneeName ?? string.Empty, r.AssigneeIsActive, UserAvailabilitySummary.From(states[uid])) : null,
            r.PodId is { } podId ? new QueuePod(podId, r.PodName ?? string.Empty, r.PodIsActive) : null,
            r.ClientId,
            r.ClientNumber.Value,
            r.ClientName,
            r.MatterId,
            r.MatterRef,
            r.MatterName,
            r.MatterIsSensitive,
            r.TaskTypeId,
            r.TaskTypeName,
            r.TaskTypeIconKey,
            r.DueDate,
            r.DueAtUtc is { } due ? DateTime.SpecifyKind(due, DateTimeKind.Utc) : null,
            card.IsOverdue,
            r.DueDate is null,
            card.StepsResolved,
            card.StepsTotal,
            DateTime.SpecifyKind(r.CreatedAtUtc, DateTimeKind.Utc),
            r.CompletedAtUtc is { } done ? DateTime.SpecifyKind(done, DateTimeKind.Utc) : null,
            Convert.ToBase64String(r.RowVersion));
    }

    // ---- group metadata (exact counts over every matching Task, not only the capped cards)

    private sealed record StatusCount(TaskStatusCode Status, int Count);

    private static SwimlaneLaneCounts LaneCounts(IEnumerable<StatusCount> rows)
    {
        var list = rows.ToList();
        return new SwimlaneLaneCounts(
            list.Where(r => r.Status == TaskStatusCode.New).Sum(r => r.Count),
            list.Where(r => r.Status == TaskStatusCode.InProgress).Sum(r => r.Count),
            list.Where(r => r.Status == TaskStatusCode.OnHold).Sum(r => r.Count),
            list.Where(r => r.Status is TaskStatusCode.Completed or TaskStatusCode.Cancelled).Sum(r => r.Count));
    }

    private static int Total(SwimlaneLaneCounts c) => c.New + c.InProgress + c.OnHold + c.Completed;

    private async Task<IReadOnlyList<SwimlaneGroup>> PriorityGroupsAsync(IQueryable<WorkTask> scope, CancellationToken ct)
    {
        var rows = await scope.GroupBy(t => new { t.PriorityId, t.Status }).Select(g => new { g.Key.PriorityId, g.Key.Status, Count = g.Count() }).ToListAsync(ct);
        var ids = rows.Select(r => r.PriorityId).Distinct().ToList();
        var priorities = await db.Set<Priority>().AsNoTracking().Where(p => ids.Contains(p.Id)).Select(p => new { p.Id, p.Label, p.Color, p.SortOrder }).ToListAsync(ct);
        return
        [
            .. priorities.OrderBy(p => p.SortOrder).ThenBy(p => p.Id).Select(p =>
            {
                var counts = LaneCounts(rows.Where(r => r.PriorityId == p.Id).Select(r => new StatusCount(r.Status, r.Count)));
                return new SwimlaneGroup("priority:" + p.Id, "priority", p.Id, p.Label, null, null, p.Color, p.SortOrder, Total(counts), counts, []);
            }),
        ];
    }

    private async Task<IReadOnlyList<SwimlaneGroup>> AssigneeGroupsAsync(IQueryable<WorkTask> scope, CancellationToken ct)
    {
        var rows = await scope.GroupBy(t => new { t.AssignedUserId, t.Status }).Select(g => new { g.Key.AssignedUserId, g.Key.Status, Count = g.Count() }).ToListAsync(ct);
        var ids = rows.Where(r => r.AssignedUserId != null).Select(r => r.AssignedUserId!.Value).Distinct().ToList();
        var users = await db.Set<AppUser>().AsNoTracking().Where(u => ids.Contains(u.Id)).Select(u => new { u.Id, u.DisplayName }).ToListAsync(ct);
        var groups = users.OrderBy(u => u.DisplayName, StringComparer.CurrentCultureIgnoreCase).ThenBy(u => u.Id).Select(u =>
        {
            var counts = LaneCounts(rows.Where(r => r.AssignedUserId == u.Id).Select(r => new StatusCount(r.Status, r.Count)));
            return new SwimlaneGroup("assignee:" + u.Id, "assignee", u.Id, u.DisplayName, null, null, null, null, Total(counts), counts, []);
        }).ToList();

        var none = LaneCounts(rows.Where(r => r.AssignedUserId == null).Select(r => new StatusCount(r.Status, r.Count)));
        if (Total(none) > 0)
            groups.Add(new SwimlaneGroup("assignee:unassigned", "assignee", null, "Unassigned", null, null, null, null, Total(none), none, []));
        return groups;
    }

    private async Task<IReadOnlyList<SwimlaneGroup>> ClientMatterGroupsAsync(IQueryable<WorkTask> scope, CancellationToken ct)
    {
        var rows = await (
            from t in scope
            join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
            join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
            group t by new { ClientId = c.Id, ClientName = c.Name, c.ClientNumber, MatterId = m.Id, MatterName = m.Name, m.MatterRef, t.Status } into g
            select new { g.Key.ClientId, g.Key.ClientName, g.Key.ClientNumber, g.Key.MatterId, g.Key.MatterName, g.Key.MatterRef, g.Key.Status, Count = g.Count() }).ToListAsync(ct);

        return
        [
            .. rows.GroupBy(r => new { r.ClientId, r.ClientName, Number = r.ClientNumber.Value })
                .OrderBy(g => g.Key.ClientName, StringComparer.CurrentCultureIgnoreCase).ThenBy(g => g.Key.ClientId)
                .Select(client =>
                {
                    var matters = client.GroupBy(r => new { r.MatterId, r.MatterName, r.MatterRef })
                        .OrderBy(g => g.Key.MatterRef, StringComparer.Ordinal)
                        .Select(m =>
                        {
                            var counts = LaneCounts(m.Select(r => new StatusCount(r.Status, r.Count)));
                            return new SwimlaneGroup("matter:" + m.Key.MatterId, "matter", m.Key.MatterId, m.Key.MatterName, client.Key.Number, m.Key.MatterRef, null, null, Total(counts), counts, []);
                        }).ToList();
                    var clientCounts = LaneCounts(client.Select(r => new StatusCount(r.Status, r.Count)));
                    return new SwimlaneGroup("client:" + client.Key.ClientId, "client", client.Key.ClientId, client.Key.ClientName, client.Key.Number, null, null, null, Total(clientCounts), clientCounts, matters);
                }),
        ];
    }
}
