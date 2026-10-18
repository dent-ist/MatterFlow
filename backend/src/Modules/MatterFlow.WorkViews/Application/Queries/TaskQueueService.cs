using System.Linq.Expressions;
using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkflowEngine.Domain;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Read side of the Task Queue, My Work and Pod Work. Every list is the same four reads, never one per row: the ordered page of ids (Task joined
/// to its Priority for the sort), the display columns of those ids in one joined query, the workflow step progress of their instances in one
/// query, and the total. Everyone with Task.View sees all Tasks (addendum E); Pod Work is a filtered view, not a security boundary.
/// </summary>
public sealed class TaskQueueService(DbContext db, IClock clock, IUserTimeZone timeZone, ICurrentUser currentUser, IPodDirectory podDirectory)
{
    public const string ViewActive = "active";
    public const string ViewDueSoon = "dueSoon";
    public const string ViewCompleted = "completed";
    public const string ViewCreatedByMe = "createdByMe";
    public const string PodViewQueue = "queue";
    public const string PodViewMembers = "members";
    public const string PodViewAttention = "attention";
    public const string PodViewAll = "all";

    private static readonly string[] MyWorkViews = [ViewActive, ViewDueSoon, ViewCompleted, ViewCreatedByMe];
    private static readonly string[] PodViews = [PodViewQueue, PodViewMembers, PodViewAttention, PodViewAll];

    // ---- Task Queue

    public async Task<Result<TaskQueuePage>> QueueAsync(TaskQueueQuery query, CancellationToken ct)
    {
        var request = Prepare(query);
        if (request.IsFailure)
            return request.Error!;

        var (filter, page, sort, descending, queueClock) = request.Value;
        var rows = ApplyFilter(db.Set<WorkTask>().AsNoTracking(), filter, queueClock);
        var (items, total) = await PageAsync(rows, page, sort, descending, queueClock, ct);
        return new TaskQueuePage(items, total, page.Page, page.PageSize, queueClock.ZoneId, await ViewCountsAsync(queueClock, ct));
    }

    /// <summary>Days back that "Recently completed" reaches (the quick view's window; the client sends the same day as <c>completedFrom</c>).</summary>
    public const int RecentlyCompletedDays = 30;

    /// <summary>
    /// The quick-view counts: one statement with a scalar subquery per number, over all Tasks (no request filters), each from the predicate the
    /// Dashboard and the grid use. Nobody is narrowed by record: Task.View sees every Task (addendum E).
    /// </summary>
    private async Task<TaskQueueViewCounts> ViewCountsAsync(QueueClock queueClock, CancellationToken ct)
    {
        var me = currentUser.UserId;
        int? primaryPod = null;
        if (me is { } userId)
            primaryPod = (await podDirectory.GetUserPodsAsync(userId, includeInactive: false, ct)).FirstOrDefault(p => p.IsPrimary)?.Pod.PodId;

        var tasks = db.Set<WorkTask>().AsNoTracking();
        var open = tasks.Where(TaskQueueRules.Open);
        var overdue = TaskQueueRules.Overdue(queueClock);
        var dueSoon = TaskQueueRules.DueSoonExcludingOverdue(queueClock);
        var recentFrom = queueClock.StartOfDayUtc(queueClock.Today.AddDays(-RecentlyCompletedDays));
        var podId = primaryPod ?? 0;
        var creator = me ?? 0;

        var counts = await tasks.Select(_ => new
        {
            Open = open.Count(),
            Unassigned = open.Count(t => t.AssignedUserId == null),
            Overdue = open.Count(overdue),
            DueSoon = open.Count(dueSoon),
            Asap = open.Count(TaskQueueRules.Asap),
            OnHold = tasks.Count(t => t.Status == TaskStatusCode.OnHold),
            MyPod = open.Count(t => t.AssignedPodId == podId),
            RecentlyCompleted = tasks.Count(t => t.Status == TaskStatusCode.Completed && t.StatusChangedAtUtc >= recentFrom),
            CreatedByMe = tasks.Count(t => t.CreatedByUserId == creator),
        }).FirstOrDefaultAsync(ct);

        return counts is null
            ? new TaskQueueViewCounts(0, 0, 0, 0, 0, 0, primaryPod is null ? null : 0, 0, 0)
            : new TaskQueueViewCounts(counts.Open, counts.Unassigned, counts.Overdue, counts.DueSoon, counts.Asap, counts.OnHold,
                primaryPod is null ? null : counts.MyPod, counts.RecentlyCompleted, counts.CreatedByMe);
    }

    // ---- My Work

    /// <summary>The Closed tab shows tasks closed in the last this-many days unless a closed-date range or <c>closedWindow=all</c> is given (UX S02).</summary>
    private const int ClosedWindowDays = 90;

    public const string ClosedWindowAll = "all";
    public const string GroupDue = "due";
    public const string ClosedWindowDefault = "default";

    /// <summary>Case- and accent-insensitive collation of the Title sort (the database default is accent-sensitive).</summary>
    private const string TitleCollation = "Latin1_General_100_CI_AI";

    public async Task<Result<MyWorkPage>> MyWorkAsync(MyWorkQuery query, CancellationToken ct)
    {
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see your work.");

        var view = MyWorkViews.FirstOrDefault(v => string.Equals(v, query.View ?? ViewActive, StringComparison.OrdinalIgnoreCase));
        if (view is null)
            return Error.Validation("view", "UNKNOWN_VIEW", $"Unknown view '{query.View}'. Allowed: {string.Join(", ", MyWorkViews)}.");

        var closedWindow = string.IsNullOrWhiteSpace(query.ClosedWindow) ? ClosedWindowDefault : query.ClosedWindow.Trim().ToLowerInvariant();
        if (closedWindow is not (ClosedWindowAll or ClosedWindowDefault))
            return Error.Validation("closedWindow", "UNKNOWN_CLOSED_WINDOW", $"Unknown closedWindow '{query.ClosedWindow}'. Allowed: {ClosedWindowDefault}, {ClosedWindowAll}.");

        var groupText = query.Group?.Trim();
        if (!string.IsNullOrEmpty(groupText) && !string.Equals(groupText, GroupDue, StringComparison.OrdinalIgnoreCase) && !string.Equals(groupText, "none", StringComparison.OrdinalIgnoreCase))
            return Error.Validation("group", "UNKNOWN_GROUP", $"Unknown group '{query.Group}'. Allowed: none, {GroupDue}.");
        var groupByDue = view == ViewActive && string.Equals(groupText, GroupDue, StringComparison.OrdinalIgnoreCase);

        var defaultSort = view switch
        {
            ViewCompleted => TaskQueueRules.SortCompleted,
            ViewDueSoon => TaskQueueRules.SortDueSoonDefault,
            _ => TaskQueueRules.SortDefault,
        };
        var request = Prepare(query, defaultSort);
        if (request.IsFailure)
            return request.Error!;

        var (filter, page, sort, descending, queueClock) = request.Value;
        // The closed-date range (the Closed tab's 90-day window, "all time" or the user's own range) belongs to the Closed tab only: applied to
        // every tab's count it would zero "Active" and "Created by me" as soon as the Closed tab is opened. With no range the Closed count
        // uses the window the request names (the last 90 days by default, all time with closedWindow=all), so it reads the same on every tab.
        var noRange = filter.CompletedFrom is null && filter.CompletedTo is null;
        var closedFrom = filter.CompletedFrom ?? (noRange && closedWindow == ClosedWindowDefault ? queueClock.Today.AddDays(-ClosedWindowDays) : null);
        var filtered = ApplyFilter(db.Set<WorkTask>().AsNoTracking(), filter with { CompletedFrom = null, CompletedTo = null }, queueClock);
        var closedRows = ApplyFilter(db.Set<WorkTask>().AsNoTracking(), filter with { CompletedFrom = closedFrom }, queueClock);
        var assignedFrom = query.AssignedFrom?.UtcDateTime;
        if (assignedFrom is { } since)
        {
            filtered = filtered.Where(TaskQueueRules.AssignedAfter(since));
            closedRows = closedRows.Where(TaskQueueRules.AssignedAfter(since));
        }

        var active = filtered.Where(t => t.AssignedUserId == me).Where(TaskQueueRules.Open);
        var dueSoon = filtered.Where(t => t.AssignedUserId == me).Where(TaskQueueRules.DueSoon(queueClock));
        var completed = closedRows.Where(t => t.AssignedUserId == me).Where(TaskQueueRules.Closed);
        // Created by me starts on its open tasks (B2): a plain request (no filter at all) means Open, as a plain Task Queue link does; a request
        // with any other filter and no status means every status, and "All" is every status written out.
        var created = filtered.Where(t => t.CreatedByUserId == me);
        if (filter.IsBare)
            created = created.Where(TaskQueueRules.Open);

        var current = view switch
        {
            ViewActive => active,
            ViewDueSoon => dueSoon,
            ViewCompleted => completed,
            _ => created,
        };
        var (items, total) = await PageAsync(current, page, sort, descending, queueClock, ct, groupByDue);
        var bucketCounts = groupByDue ? await BucketCountsAsync(current, queueClock, ct) : null;
        var counts = new MyWorkCounts(
            view == ViewActive ? total : await active.CountAsync(ct),
            view == ViewDueSoon ? total : await dueSoon.CountAsync(ct),
            view == ViewCompleted ? total : await completed.CountAsync(ct),
            view == ViewCreatedByMe ? total : await created.CountAsync(ct));
        return new MyWorkPage(items, total, page.Page, page.PageSize, queueClock.ZoneId, view, counts, await AttentionAsync(me, queueClock, query.NewSince?.UtcDateTime, ct), bucketCounts);
    }

    /// <summary>One grouped query over the whole filtered set: the size of each due bucket (absent buckets are zero).</summary>
    private static async Task<MyWorkBucketCounts> BucketCountsAsync(IQueryable<WorkTask> rows, QueueClock queueClock, CancellationToken ct)
    {
        var grouped = await rows
            .Select(t => new TaskSortRow { DueDate = t.DueDate, DueAtUtc = t.DueAtUtc })
            .GroupBy(TaskQueueRules.DueBucket(queueClock))
            .Select(g => new { Bucket = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        int Of(int bucket) => grouped.Where(g => g.Bucket == bucket).Sum(g => g.Count);
        return new MyWorkBucketCounts(
            Of(TaskQueueRules.BucketAsap), Of(TaskQueueRules.BucketOverdue), Of(TaskQueueRules.BucketToday),
            Of(TaskQueueRules.BucketTomorrow), Of(TaskQueueRules.BucketThisWeek), Of(TaskQueueRules.BucketLater));
    }

    /// <summary>The needs-attention strip: the whole open assigned set (no grid filters), each count from the same predicate the filter uses.</summary>
    private async Task<MyWorkAttention> AttentionAsync(int me, QueueClock queueClock, DateTime? newSince, CancellationToken ct)
    {
        var open = db.Set<WorkTask>().AsNoTracking().Where(t => t.AssignedUserId == me).Where(TaskQueueRules.Open);
        return new MyWorkAttention(
            await open.Where(TaskQueueRules.Overdue(queueClock)).CountAsync(ct),
            await open.Where(TaskQueueRules.DueToday(queueClock)).CountAsync(ct),
            await open.Where(TaskQueueRules.Asap).CountAsync(ct),
            await open.CountAsync(t => t.Status == TaskStatusCode.OnHold, ct),
            newSince is { } since ? await open.Where(TaskQueueRules.AssignedAfter(since)).CountAsync(ct) : null);
    }

    // ---- Pod Work

    public async Task<Result<PodWorkPage>> PodWorkAsync(PodWorkQuery query, CancellationToken ct)
    {
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see Pod work.");

        var view = PodViews.FirstOrDefault(v => string.Equals(v, query.View ?? PodViewQueue, StringComparison.OrdinalIgnoreCase));
        if (view is null)
            return Error.Validation("view", "UNKNOWN_VIEW", $"Unknown view '{query.View}'. Allowed: {string.Join(", ", PodViews)}.");

        var request = Prepare(query);
        if (request.IsFailure)
            return request.Error!;

        var (filter, page, sort, descending, queueClock) = request.Value;
        var mine = await podDirectory.GetUserPodsAsync(me, includeInactive: false, ct);
        var primary = mine.FirstOrDefault(p => p.IsPrimary)?.Pod.PodId;
        var podId = query.PodId ?? primary ?? mine.FirstOrDefault()?.Pod.PodId;

        PodInfo? pod = null;
        if (podId is { } id)
        {
            pod = await podDirectory.FindAsync(id, ct);
            if (pod is null)
                return Error.NotFound("Pod not found.");
        }

        var choices = await PodChoicesAsync(mine, pod, ct);
        if (pod is null)
        {
            return new PodWorkPage([], 0, page.Page, page.PageSize, queueClock.ZoneId, view, null, choices, new PodWorkSummary(0, 0, 0, 0), new PodWorkCounts(0, 0, 0, 0), []);
        }

        var tasks = db.Set<WorkTask>().AsNoTracking();
        var podOpen = tasks.Where(t => t.AssignedPodId == pod.PodId).Where(TaskQueueRules.Open);
        var summary = new PodWorkSummary(
            await podOpen.CountAsync(t => t.AssignedUserId == null, ct),
            await podOpen.CountAsync(t => t.AssignedUserId != null, ct),
            await podOpen.Where(TaskQueueRules.Overdue(queueClock)).CountAsync(ct),
            await podOpen.CountAsync(t => t.Status == TaskStatusCode.OnHold, ct));

        var filtered = ApplyFilter(tasks, filter, queueClock).Where(t => t.AssignedPodId == pod.PodId).Where(TaskQueueRules.Open);
        var queue = filtered.Where(t => t.AssignedUserId == null);
        var members = filtered.Where(t => t.AssignedUserId != null);
        var attention = filtered.Where(TaskQueueRules.Or(TaskQueueRules.Overdue(queueClock), t => t.Status == TaskStatusCode.OnHold));

        var current = view switch
        {
            PodViewQueue => queue,
            PodViewMembers => members,
            PodViewAttention => attention,
            _ => filtered,
        };
        var (items, total) = await PageAsync(current, page, sort, descending, queueClock, ct);
        var counts = new PodWorkCounts(
            view == PodViewQueue ? total : await queue.CountAsync(ct),
            view == PodViewMembers ? total : await members.CountAsync(ct),
            view == PodViewAttention ? total : await attention.CountAsync(ct),
            view == PodViewAll ? total : await filtered.CountAsync(ct));

        var loads = await MemberLoadsAsync(pod.PodId, podOpen, queueClock, ct);
        return new PodWorkPage(items, total, page.Page, page.PageSize, queueClock.ZoneId, view, new QueuePod(pod.PodId, pod.Name, pod.IsActive), choices, summary, counts, loads);
    }

    private async Task<IReadOnlyList<PodChoice>> PodChoicesAsync(IReadOnlyList<UserPodInfo> mine, PodInfo? selected, CancellationToken ct)
    {
        var choices = mine.Select(p => new PodChoice(p.Pod.PodId, p.Pod.Name, true, p.IsPrimary)).ToList();
        var known = choices.Select(c => c.PodId).ToHashSet();
        var others = await db.Set<Pod>().AsNoTracking()
            .Where(p => p.IsActive || (selected != null && p.Id == selected.PodId))
            .OrderBy(p => p.Name)
            .Select(p => new { p.Id, p.Name })
            .ToListAsync(ct);
        choices.AddRange(others.Where(p => !known.Contains(p.Id)).Select(p => new PodChoice(p.Id, p.Name, false, false)));
        return choices;
    }

    private async Task<IReadOnlyList<PodMemberLoad>> MemberLoadsAsync(int podId, IQueryable<WorkTask> podOpen, QueueClock queueClock, CancellationToken ct)
    {
        var open = await podOpen.Where(t => t.AssignedUserId != null)
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { UserId = g.Key, Open = g.Count(), OnHold = g.Count(t => t.Status == TaskStatusCode.OnHold) })
            .ToListAsync(ct);
        var overdue = await podOpen.Where(t => t.AssignedUserId != null).Where(TaskQueueRules.Overdue(queueClock))
            .GroupBy(t => t.AssignedUserId!.Value)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.UserId, g => g.Count, ct);

        var memberIds = (await podDirectory.GetMemberUserIdsAsync(podId, ct)).ToHashSet();
        var userIds = open.Select(o => o.UserId).Concat(memberIds).Distinct().ToList();
        var users = await db.Set<AppUser>().AsNoTracking().Where(u => userIds.Contains(u.Id)).Select(u => new { u.Id, u.DisplayName, u.IsActive }).ToListAsync(ct);
        var counts = open.ToDictionary(o => o.UserId);
        return
        [
            .. users
                .Where(u => u.IsActive || counts.ContainsKey(u.Id))
                .OrderBy(u => u.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                .Select(u => new PodMemberLoad(
                    u.Id,
                    u.DisplayName,
                    u.IsActive,
                    memberIds.Contains(u.Id),
                    counts.TryGetValue(u.Id, out var c) ? c.Open : 0,
                    overdue.GetValueOrDefault(u.Id),
                    counts.TryGetValue(u.Id, out var h) ? h.OnHold : 0)),
        ];
    }

    // ---- shared pipeline

    private Result<(TaskQueueFilter Filter, PageRequest Page, string Sort, bool Descending, QueueClock Clock)> Prepare(TaskQueueQuery query, string defaultSort = TaskQueueRules.SortDefault)
    {
        var page = PageRequest.Create(query.Page, query.PageSize);
        if (page.IsFailure)
            return page.Error!;

        var filter = TaskQueueFilter.From(query);
        if (filter.IsFailure)
            return filter.Error!;

        var sort = defaultSort;
        if (!string.IsNullOrWhiteSpace(query.Sort))
        {
            var match = TaskQueueRules.SortFields.FirstOrDefault(f => string.Equals(f, query.Sort.Trim(), StringComparison.OrdinalIgnoreCase));
            if (match is null)
                return Error.Validation("sort", "UNKNOWN_SORT", $"Unknown sort '{query.Sort}'. Allowed: {string.Join(", ", TaskQueueRules.SortFields)}.");
            sort = match;
        }

        var descending = TaskQueueRules.DefaultsToDescending(sort);
        if (!string.IsNullOrWhiteSpace(query.Dir))
        {
            var dir = query.Dir.Trim().ToLowerInvariant();
            if (dir is not ("asc" or "desc"))
                return Error.Validation("dir", "UNKNOWN_DIRECTION", "dir must be asc or desc.");
            descending = dir == "desc";
        }

        return (filter.Value, page.Value, sort, descending, QueueClock.Create(clock.UtcNow, timeZone));
    }

    internal IQueryable<WorkTask> ApplyFilter(IQueryable<WorkTask> rows, TaskQueueFilter f, QueueClock c)
    {
        if (f.Text is { } text)
        {
            var pattern = TextMatch.ContainsPattern(text);
            rows = rows.Where(t => EF.Functions.Like(EF.Functions.Collate(t.Title.ToLower(), TextMatch.Collation), pattern, TextMatch.Escape)
                || EF.Functions.Like(EF.Functions.Collate(t.Number.ToLower(), TextMatch.Collation), pattern, TextMatch.Escape));
        }

        if (f.Statuses.Count > 0)
        {
            var statuses = f.Statuses.ToList();
            rows = rows.Where(t => statuses.Contains(t.Status));
        }

        if (f.Priorities.Count > 0)
        {
            var priorities = f.Priorities.ToList();
            rows = rows.Where(t => priorities.Contains(t.PriorityId));
        }

        if (f.Pods.Count > 0 || f.NoPod)
        {
            var pods = f.Pods.ToList();
            var noPod = f.NoPod;
            rows = rows.Where(t => (noPod && t.AssignedPodId == null) || (t.AssignedPodId != null && pods.Contains(t.AssignedPodId.Value)));
        }

        if (f.Assignees.Count > 0 || f.Unassigned)
        {
            var assignees = f.Assignees.ToList();
            var unassigned = f.Unassigned;
            rows = rows.Where(t => (unassigned && t.AssignedUserId == null) || (t.AssignedUserId != null && assignees.Contains(t.AssignedUserId.Value)));
        }

        if (f.Creators.Count > 0)
        {
            var creators = f.Creators.ToList();
            rows = rows.Where(t => t.CreatedByUserId != null && creators.Contains(t.CreatedByUserId.Value));
        }

        if (f.ClientId is { } clientId)
            rows = rows.Where(t => db.Set<Matter>().Any(m => m.Id == t.MatterId && m.ClientId == clientId));
        if (f.MatterId is { } matterId)
            rows = rows.Where(t => t.MatterId == matterId);
        if (f.ProjectId is { } projectId)
            rows = rows.Where(t => t.ProjectId == projectId);

        if (f.TaskTypes.Count > 0)
        {
            var types = f.TaskTypes.ToList();
            rows = rows.Where(t => types.Contains(t.TaskTypeId));
        }

        if (f.Workflows.Count > 0)
        {
            var workflows = f.Workflows.ToList();
            rows = rows.Where(t => db.Set<WorkflowInstanceRecord>().Any(i => i.Id == t.WorkflowInstanceId
                && db.Set<WorkflowVersion>().Any(v => v.Id == i.WorkflowVersionId && workflows.Contains(v.WorkflowDefinitionId))));
        }

        if (f.CreatedFrom is { } createdFrom)
        {
            var start = c.StartOfDayUtc(createdFrom);
            rows = rows.Where(t => t.CreatedAtUtc >= start);
        }

        if (f.CreatedTo is { } createdTo)
        {
            var end = c.EndOfDayUtc(createdTo);
            rows = rows.Where(t => t.CreatedAtUtc < end);
        }

        if (f.DueFrom is { } dueFrom)
            rows = rows.Where(t => t.DueDate != null && t.DueDate >= dueFrom);
        if (f.DueTo is { } dueTo)
            rows = rows.Where(t => t.DueDate != null && t.DueDate <= dueTo);

        if (f.Asap is { } asap)
            rows = asap ? rows.Where(t => t.DueDate == null) : rows.Where(t => t.DueDate != null);

        if (f.Overdue is { } overdue)
            rows = overdue ? rows.Where(TaskQueueRules.Overdue(c)) : rows.Where(Not(TaskQueueRules.Overdue(c)));

        if (f.Requestor is { } requestor)
        {
            var pattern = TextMatch.ContainsPattern(requestor);
            rows = rows.Where(t => EF.Functions.Like(EF.Functions.Collate(t.RequestorName.ToLower(), TextMatch.Collation), pattern, TextMatch.Escape)
                || (t.RequestorEmail != null && EF.Functions.Like(EF.Functions.Collate(t.RequestorEmail.ToLower(), TextMatch.Collation), pattern, TextMatch.Escape)));
        }

        if (f.MatterText is { } matterText)
        {
            // Column filter: the Matter reference (or the typed pair 343-12) or the Matter name, case-insensitive, wildcards literal. A subquery on
            // the small Matter table, not an id list, so the cost does not grow with the number of Matters that match.
            var pattern = TextMatch.ContainsPattern(matterText);
            var pair = TextMatch.PairReference(matterText);
            rows = rows.Where(t => db.Set<Matter>().Any(m => m.Id == t.MatterId
                && (EF.Functions.Like(EF.Functions.Collate(m.MatterRef.ToLower(), TextMatch.Collation), pattern, TextMatch.Escape)
                    || EF.Functions.Like(EF.Functions.Collate(m.Name.ToLower(), TextMatch.Collation), pattern, TextMatch.Escape)
                    || (pair != null && m.MatterRef == pair))));
        }

        if (f.ClientText is { } clientText)
        {
            // The Client name, or digits contained in the Client number (the first five characters of the Matter reference are the number).
            var pattern = TextMatch.ContainsPattern(clientText);
            var digits = TextMatch.IsDigits(clientText);
            var numberPattern = "%" + clientText + "%";
            rows = rows.Where(t => db.Set<Matter>().Any(m => m.Id == t.MatterId
                && (db.Set<Client>().Any(c => c.Id == m.ClientId && EF.Functions.Like(EF.Functions.Collate(c.Name.ToLower(), TextMatch.Collation), pattern, TextMatch.Escape))
                    || (digits && EF.Functions.Like(m.MatterRef.Substring(0, 5), numberPattern)))));
        }

        if (f.ProjectText is { } projectText)
        {
            var pattern = TextMatch.ContainsPattern(projectText);
            rows = rows.Where(t => t.ProjectId != null && db.Set<Project>().Any(p => p.Id == t.ProjectId
                && EF.Functions.Like(EF.Functions.Collate(p.Name.ToLower(), TextMatch.Collation), pattern, TextMatch.Escape)));
        }

        if (f.UpdatedFrom is { } updatedFrom)
        {
            var start = c.StartOfDayUtc(updatedFrom);
            rows = rows.Where(t => t.ModifiedAtUtc != null && t.ModifiedAtUtc >= start);
        }

        if (f.UpdatedTo is { } updatedTo)
        {
            var end = c.EndOfDayUtc(updatedTo);
            rows = rows.Where(t => t.ModifiedAtUtc != null && t.ModifiedAtUtc < end);
        }

        if (f.CompletedFrom is { } completedFrom)
        {
            var start = c.StartOfDayUtc(completedFrom);
            rows = rows.Where(TaskQueueRules.Closed).Where(t => t.StatusChangedAtUtc >= start);
        }

        if (f.CompletedTo is { } completedTo)
        {
            var end = c.EndOfDayUtc(completedTo);
            rows = rows.Where(TaskQueueRules.Closed).Where(t => t.StatusChangedAtUtc < end);
        }

        return rows;
    }

    private static Expression<Func<WorkTask, bool>> Not(Expression<Func<WorkTask, bool>> predicate) =>
        Expression.Lambda<Func<WorkTask, bool>>(Expression.Not(predicate.Body), predicate.Parameters);

    private async Task<(IReadOnlyList<TaskQueueRow> Items, int Total)> PageAsync(
        IQueryable<WorkTask> rows,
        PageRequest page,
        string sort,
        bool descending,
        QueueClock queueClock,
        CancellationToken ct,
        bool groupByDue = false)
    {
        var total = await rows.CountAsync(ct);
        if (total == 0 || page.Skip >= total)
            return ([], total);

        var sortRows = from t in rows
                       join p in db.Set<Priority>().AsNoTracking() on t.PriorityId equals p.Id
                       join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
                       join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
                       join au in db.Set<AppUser>().AsNoTracking() on t.AssignedUserId equals (int?)au.Id into assignees
                       from au in assignees.DefaultIfEmpty()
                       select new TaskSortRow
                       {
                           Id = t.Id,
                           PrioritySortOrder = p.SortOrder,
                           Status = t.Status,
                           DueDate = t.DueDate,
                           DueAtUtc = t.DueAtUtc,
                           DueSortKey = t.DueSortKey,
                           CreatedAtUtc = t.CreatedAtUtc,
                           StatusChangedAtUtc = t.StatusChangedAtUtc,
                           ModifiedAtUtc = t.ModifiedAtUtc,
                           TitleKey = EF.Functions.Collate(t.Title, TitleCollation),
                           MatterRef = m.MatterRef,
                           AssigneeKey = au == null ? null : EF.Functions.Collate(au.DisplayName, TitleCollation),
                           ClientKey = EF.Functions.Collate(c.Name, TitleCollation),
                       };
        var ordered = groupByDue ? TaskQueueRules.OrderByDueBucket(sortRows, queueClock) : sort == TaskQueueRules.SortDueSoonDefault ? TaskQueueRules.OrderDueSoon(sortRows, queueClock) : TaskQueueRules.Order(sortRows, sort, descending);
        var ids = await ordered.Select(r => r.Id).Skip(page.Skip).Take(page.PageSize).ToListAsync(ct);
        return (await LoadRowsAsync(ids, queueClock, ct), total);
    }

    private async Task<IReadOnlyList<TaskQueueRow>> LoadRowsAsync(IReadOnlyList<long> ids, QueueClock queueClock, CancellationToken ct)
    {
        if (ids.Count == 0)
            return [];

        var details = await (
            from t in db.Set<WorkTask>().AsNoTracking().Where(t => ids.Contains(t.Id))
            join p in db.Set<Priority>().AsNoTracking() on t.PriorityId equals p.Id
            join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
            join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
            join ty in db.Set<TaskType>().AsNoTracking() on t.TaskTypeId equals ty.Id
            join wi in db.Set<WorkflowInstanceRecord>().AsNoTracking() on t.WorkflowInstanceId equals wi.Id
            join wv in db.Set<WorkflowVersion>().AsNoTracking() on wi.WorkflowVersionId equals wv.Id
            join wd in db.Set<WorkflowDefinition>().AsNoTracking() on wv.WorkflowDefinitionId equals wd.Id
            join pr in db.Set<Project>().AsNoTracking() on t.ProjectId equals (int?)pr.Id into projects
            from pr in projects.DefaultIfEmpty()
            join pod in db.Set<Pod>().AsNoTracking() on t.AssignedPodId equals (int?)pod.Id into pods
            from pod in pods.DefaultIfEmpty()
            join au in db.Set<AppUser>().AsNoTracking() on t.AssignedUserId equals (int?)au.Id into assignees
            from au in assignees.DefaultIfEmpty()
            join cu in db.Set<AppUser>().AsNoTracking() on t.CreatedByUserId equals (int?)cu.Id into creators
            from cu in creators.DefaultIfEmpty()
            select new Detail
            {
                Id = t.Id,
                Number = t.Number,
                Title = t.Title,
                MatterId = t.MatterId,
                ProjectId = t.ProjectId,
                TaskTypeId = t.TaskTypeId,
                WorkflowInstanceId = t.WorkflowInstanceId,
                PriorityId = t.PriorityId,
                Status = t.Status,
                AssignedPodId = t.AssignedPodId,
                AssignedUserId = t.AssignedUserId,
                CreatedByUserId = t.CreatedByUserId,
                RequestorName = t.RequestorName,
                DueDate = t.DueDate,
                DueAtUtc = t.DueAtUtc,
                CreatedAtUtc = t.CreatedAtUtc,
                AssignedAtUtc = t.AssignedAtUtc,
                ModifiedAtUtc = t.ModifiedAtUtc,
                CompletedAtUtc = t.CompletedAtUtc,
                StatusChangedAtUtc = t.StatusChangedAtUtc,
                RowVersion = t.RowVersion,
                PriorityLabel = p.Label,
                PriorityColor = p.Color,
                PrioritySortOrder = p.SortOrder,
                MatterRef = m.MatterRef,
                MatterName = m.Name,
                MatterIsSensitive = m.IsSensitive,
                MatterIsActive = m.IsActive,
                ClientId = c.Id,
                ClientName = c.Name,
                ProjectName = pr == null ? null : pr.Name,
                TaskTypeName = ty.Name,
                TaskTypeIconKey = ty.IconKey,
                WorkflowDefinitionId = wd.Id,
                WorkflowName = wd.Name,
                PodName = pod == null ? null : pod.Name,
                PodIsActive = pod != null && pod.IsActive,
                AssigneeName = au == null ? null : au.DisplayName,
                AssigneeIsActive = au != null && au.IsActive,
                CreatorName = cu == null ? null : cu.DisplayName,
                CreatorIsActive = cu != null && cu.IsActive,

                // The reason of the latest hold (M12.2): read inline for On Hold rows only, so the page needs no extra statement.
                HoldHtml = t.Status == TaskStatusCode.OnHold
                    ? db.Set<TaskComment>().AsNoTracking()
                        .Where(c => c.TaskId == t.Id && c.Purpose == TaskCommentPurpose.OnHold && !c.IsDeleted)
                        .OrderByDescending(c => c.CreatedAtUtc).ThenByDescending(c => c.Id)
                        .Select(c => c.BodyHtml).FirstOrDefault()
                    : null,
            }).ToListAsync(ct);

        var labels = await db.Set<TaskStatusLabel>().AsNoTracking().ToDictionaryAsync(l => l.StatusCode, l => l.DisplayLabel, ct);

        var instanceIds = details.Select(d => d.WorkflowInstanceId).ToList();
        var steps = await db.Set<StepInstanceRecord>().AsNoTracking()
            .Where(s => instanceIds.Contains(s.WorkflowInstanceId))
            .Select(s => new { s.WorkflowInstanceId, s.Id, s.SequenceNo, s.Title, s.Status })
            .ToListAsync(ct);
        var progress = steps.GroupBy(s => s.WorkflowInstanceId).ToDictionary(
            g => g.Key,
            g =>
            {
                var current = g.Where(s => s.Status is StepStatus.Pending or StepStatus.InProgress).OrderBy(s => s.SequenceNo).FirstOrDefault();
                return new WorkflowProgress(
                    g.Count(),
                    g.Count(s => s.Status is StepStatus.Completed or StepStatus.Skipped),
                    current?.SequenceNo,
                    current?.Title,
                    current?.Id);
            });

        var byId = details.ToDictionary(d => d.Id);
        var result = new List<TaskQueueRow>(ids.Count);
        foreach (var id in ids)
        {
            if (!byId.TryGetValue(id, out var d))
                continue;

            var t = d;
            var code = t.Status.ToCode();
            var (holdReason, holdTruncated) = HoldReason(d.HoldHtml);
            result.Add(new TaskQueueRow(
                t.Id,
                t.Number,
                t.Title,
                t.MatterId,
                d.MatterRef,
                d.MatterName,
                d.MatterIsSensitive,
                d.MatterIsActive,
                d.ClientId,
                d.ClientName,
                t.ProjectId,
                d.ProjectName,
                t.TaskTypeId,
                d.TaskTypeName,
                d.TaskTypeIconKey,
                d.WorkflowDefinitionId,
                d.WorkflowName,
                new QueuePriority(t.PriorityId, d.PriorityLabel, d.PriorityColor, d.PrioritySortOrder),
                code,
                labels.GetValueOrDefault(code, code),
                t.AssignedPodId is { } podId ? new QueuePod(podId, d.PodName ?? string.Empty, d.PodIsActive) : null,
                t.AssignedUserId is { } userId ? new QueueUser(userId, d.AssigneeName ?? string.Empty, d.AssigneeIsActive) : null,
                t.CreatedByUserId is { } creatorId ? new QueueUser(creatorId, d.CreatorName ?? string.Empty, d.CreatorIsActive) : null,
                t.RequestorName,
                t.DueDate,
                Utc(t.DueAtUtc),
                t.DueDate is null,
                TaskQueueRules.IsOverdue(t.Status, t.DueDate, t.DueAtUtc, queueClock),
                DateTime.SpecifyKind(t.CreatedAtUtc, DateTimeKind.Utc),
                Utc(t.AssignedAtUtc),
                Utc(t.ModifiedAtUtc),
                Utc(t.CompletedAtUtc),
                DateTime.SpecifyKind(t.StatusChangedAtUtc, DateTimeKind.Utc),
                t.Status is TaskStatusCode.Completed or TaskStatusCode.Cancelled ? DateTime.SpecifyKind(t.StatusChangedAtUtc, DateTimeKind.Utc) : (DateTime?)null,
                progress.GetValueOrDefault(t.WorkflowInstanceId, new WorkflowProgress(0, 0, null, null)),
                Convert.ToBase64String(t.RowVersion),
                holdReason,
                holdTruncated));
        }

        return result;
    }

    /// <summary>Plain text of a hold comment (markup stripped, whitespace collapsed), at most <see cref="HoldReasonMaxLength"/> characters.</summary>
    internal static (string? Reason, bool Truncated) HoldReason(string? html)
    {
        var text = System.Text.RegularExpressions.Regex.Replace(CommentHtml.ToPlainText(html), @"\s+", " ").Trim();
        if (text.Length == 0)
            return (null, false);

        return text.Length <= HoldReasonMaxLength ? (text, false) : (text[..HoldReasonMaxLength].TrimEnd(), true);
    }

    private const int HoldReasonMaxLength = 200;

    private static DateTime? Utc(DateTime? value) => value is { } v ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : null;

    private sealed class Detail
    {
        public long Id { get; init; }

        public string Number { get; init; } = string.Empty;

        public string Title { get; init; } = string.Empty;

        public int MatterId { get; init; }

        public int? ProjectId { get; init; }

        public int TaskTypeId { get; init; }

        public long WorkflowInstanceId { get; init; }

        public int PriorityId { get; init; }

        public TaskStatusCode Status { get; init; }

        public int? AssignedPodId { get; init; }

        public int? AssignedUserId { get; init; }

        public int? CreatedByUserId { get; init; }

        public string RequestorName { get; init; } = string.Empty;

        public DateOnly? DueDate { get; init; }

        public DateTime? DueAtUtc { get; init; }

        public DateTime CreatedAtUtc { get; init; }

        public DateTime? AssignedAtUtc { get; init; }

        public DateTime? ModifiedAtUtc { get; init; }

        public DateTime? CompletedAtUtc { get; init; }

        public DateTime StatusChangedAtUtc { get; init; }

        public byte[] RowVersion { get; init; } = [];

        public string PriorityLabel { get; init; } = string.Empty;

        public string PriorityColor { get; init; } = string.Empty;

        public int PrioritySortOrder { get; init; }

        public string MatterRef { get; init; } = string.Empty;

        public string MatterName { get; init; } = string.Empty;

        public bool MatterIsSensitive { get; init; }

        public bool MatterIsActive { get; init; }

        public int ClientId { get; init; }

        public string ClientName { get; init; } = string.Empty;

        public string? ProjectName { get; init; }

        public string TaskTypeName { get; init; } = string.Empty;

        public string TaskTypeIconKey { get; init; } = string.Empty;

        public int WorkflowDefinitionId { get; init; }

        public string WorkflowName { get; init; } = string.Empty;

        public string? PodName { get; init; }

        public bool PodIsActive { get; init; }

        public string? AssigneeName { get; init; }

        public bool AssigneeIsActive { get; init; }

        public string? CreatorName { get; init; }

        public bool CreatorIsActive { get; init; }

        public string? HoldHtml { get; init; }
    }
}
