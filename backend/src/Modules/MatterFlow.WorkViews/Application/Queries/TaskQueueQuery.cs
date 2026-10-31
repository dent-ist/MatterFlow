using System.ComponentModel.DataAnnotations;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The filters, sort and paging shared by the Task Queue, My Work and Pod Work (query string, camelCase). Multi-value filters repeat the
/// parameter (<c>status=NEW&amp;status=ON_HOLD</c>); a comma list is accepted for <c>status</c> as well. Unknown parameters are a 400.
/// </summary>
public class TaskQueueQuery
{
    /// <summary>The query parameters every queue accepts.</summary>
    public static readonly IReadOnlyList<string> FilterKeys =
    [
        "q", "status", "priority", "pod", "noPod", "assignee", "unassigned", "creator", "client", "matter", "project", "type", "workflow",
        "createdFrom", "createdTo", "dueFrom", "dueTo", "asap", "overdue", "requestor", "completedFrom", "completedTo",
        "matterText", "clientText", "projectText", "updatedFrom", "updatedTo",
        "managedByMe", "managerId", "role", "dueWithin",
        "atRisk", "onHoldReason", "needsAttention", "show",
    ];

    /// <summary>All parameters of the Task Queue.</summary>
    public static readonly IReadOnlyList<string> Keys = [.. FilterKeys, "sort", "dir", "page", "pageSize"];

    /// <summary>Text matched (case-insensitive, partial) against the title and the Task number (<c>TSK-1042</c> or <c>1042</c>).</summary>
    [FromQuery(Name = "q"), StringLength(200)]
    public string? Q { get; init; }

    /// <summary>
    /// Status codes (<c>NEW</c>, <c>IN_PROGRESS</c>, <c>ON_HOLD</c>, <c>COMPLETED</c>, <c>CANCELLED</c>); repeatable. My Work: a request with no
    /// filter at all counts the Created by me tab as its open tasks (New, In Progress, On Hold); any filter without a status means every status.
    /// </summary>
    [FromQuery(Name = "status")]
    public string[]? Status { get; init; }

    /// <summary>Priority ids; repeatable.</summary>
    [FromQuery(Name = "priority")]
    public int[]? Priority { get; init; }

    /// <summary>Pod ids the Task is assigned to; repeatable.</summary>
    [FromQuery(Name = "pod")]
    public int[]? Pod { get; init; }

    /// <summary>True: Tasks with no Pod assigned. Combines with <c>pod</c> as OR (a Task in one of those Pods, or in none).</summary>
    [FromQuery(Name = "noPod")]
    public bool? NoPod { get; init; }

    /// <summary>User ids the Task is assigned to (inactive users included); repeatable. Combines with <c>unassigned</c> as OR.</summary>
    [FromQuery(Name = "assignee")]
    public int[]? Assignee { get; init; }

    /// <summary>True: Tasks with no person assigned (a Pod may still be set).</summary>
    [FromQuery(Name = "unassigned")]
    public bool? Unassigned { get; init; }

    /// <summary>Creator user ids; repeatable.</summary>
    [FromQuery(Name = "creator")]
    public int[]? Creator { get; init; }

    /// <summary>Only Tasks of this Client's Matters.</summary>
    [FromQuery(Name = "client")]
    public int? Client { get; init; }

    /// <summary>Only Tasks of this Matter.</summary>
    [FromQuery(Name = "matter")]
    public int? Matter { get; init; }

    /// <summary>Only Tasks of this Project.</summary>
    [FromQuery(Name = "project")]
    public int? Project { get; init; }

    /// <summary>Task Type ids; repeatable.</summary>
    [FromQuery(Name = "type")]
    public int[]? Type { get; init; }

    /// <summary>Workflow (definition) ids; repeatable.</summary>
    [FromQuery(Name = "workflow")]
    public int[]? Workflow { get; init; }

    /// <summary>Created on or after this date (<c>yyyy-MM-dd</c>, start of the day in the viewer's zone).</summary>
    [FromQuery(Name = "createdFrom")]
    public DateOnly? CreatedFrom { get; init; }

    /// <summary>Created on or before this date (end of that day in the viewer's zone).</summary>
    [FromQuery(Name = "createdTo")]
    public DateOnly? CreatedTo { get; init; }

    /// <summary>Explicit due date on or after this date (ASAP Tasks never match).</summary>
    [FromQuery(Name = "dueFrom")]
    public DateOnly? DueFrom { get; init; }

    /// <summary>Explicit due date on or before this date.</summary>
    [FromQuery(Name = "dueTo")]
    public DateOnly? DueTo { get; init; }

    /// <summary>True: only ASAP Tasks (no due date); false: only Tasks with a due date.</summary>
    [FromQuery(Name = "asap")]
    public bool? Asap { get; init; }

    /// <summary>True: only overdue Tasks in the viewer's time zone (open, explicit due passed; ASAP never); false: all others.</summary>
    [FromQuery(Name = "overdue")]
    public bool? Overdue { get; init; }

    /// <summary>Fragment of the requestor name or email.</summary>
    [FromQuery(Name = "requestor"), StringLength(200)]
    public string? Requestor { get; init; }

    /// <summary>Completed or cancelled on or after this date (viewer's zone); only closed Tasks match.</summary>
    [FromQuery(Name = "completedFrom")]
    public DateOnly? CompletedFrom { get; init; }

    /// <summary>Completed or cancelled on or before this date; only closed Tasks match.</summary>
    [FromQuery(Name = "completedTo")]
    public DateOnly? CompletedTo { get; init; }

    /// <summary>
    /// Matter column filter: text contained in the Matter reference (<c>00343-00012</c>, or the typed pair <c>343-12</c>) or the Matter name
    /// (case-insensitive, <c>%</c> <c>_</c> <c>[</c> literal). Combines with <c>matter</c> (an id) as AND.
    /// </summary>
    [FromQuery(Name = "matterText"), StringLength(200)]
    public string? MatterText { get; init; }

    /// <summary>Client column filter: text contained in the Client name, or digits contained in the Client number.</summary>
    [FromQuery(Name = "clientText"), StringLength(200)]
    public string? ClientText { get; init; }

    /// <summary>Project column filter: text contained in the Project name (Tasks without a Project never match).</summary>
    [FromQuery(Name = "projectText"), StringLength(200)]
    public string? ProjectText { get; init; }

    /// <summary>Last updated on or after this date (<c>yyyy-MM-dd</c>, start of the day in the viewer's zone); Tasks never updated do not match.</summary>
    [FromQuery(Name = "updatedFrom")]
    public DateOnly? UpdatedFrom { get; init; }

    /// <summary>Last updated on or before this date (end of that day in the viewer's zone).</summary>
    [FromQuery(Name = "updatedTo")]
    public DateOnly? UpdatedTo { get; init; }

    /// <summary>
    /// True: only Tasks on Matters the caller manages (as Primary or Secondary, see <c>role</c>). False is the same as leaving it out. A Matter
    /// without a manager is never matched; this is a filter, not a warning.
    /// </summary>
    [FromQuery(Name = "managedByMe")]
    public bool? ManagedByMe { get; init; }

    /// <summary>Only Tasks on Matters this user manages. For anybody but the caller this needs <c>Matter.AssignManagers</c> (403 otherwise). A different person than <c>managedByMe</c> names is a 400.</summary>
    [FromQuery(Name = "managerId")]
    public int? ManagerId { get; init; }

    /// <summary><c>primary</c>, <c>secondary</c> or <c>both</c> (default): which place of the Matter the manager (<c>managedByMe</c> / <c>managerId</c>) holds.</summary>
    [FromQuery(Name = "role"), StringLength(10)]
    public string? Role { get; init; }

    /// <summary><c>3</c> or <c>7</c>: only open Tasks with an explicit due date today or within that many days, overdue Tasks excluded (the My Matters strip's "due in 3 / 7 days").</summary>
    [FromQuery(Name = "dueWithin")]
    public int? DueWithin { get; init; }

    /// <summary>True: only open Tasks that are At risk: not overdue, their Task Type has a target turnaround and 80 percent of it has passed since creation (<see cref="AtRiskRules"/>). False is the same as leaving it out.</summary>
    [FromQuery(Name = "atRisk")]
    public bool? AtRisk { get; init; }

    /// <summary>True: only open Tasks that need attention: overdue, at risk, due today, unassigned with a due date within 7 days, or on hold for more than 7 days (<see cref="AttentionRules"/>). The My Matters Overview's "View all". False is the same as leaving it out.</summary>
    [FromQuery(Name = "needsAttention")]
    public bool? NeedsAttention { get; init; }

    /// <summary>
    /// The Show filter of the new My Matters Overview (UI-04, #957), one of <c>overdue</c>, <c>risk</c>, <c>due7</c>, <c>critical</c>, <c>unassigned</c>; absent = everything. It combines with <c>status</c> (AND) and every other filter.
    /// <c>overdue</c>, <c>risk</c> and <c>due7</c> only match New and In Progress tasks (an On Hold task is never overdue here); <c>critical</c> (priority Critical) and <c>unassigned</c> match any status.
    /// Unknown value: 400 <c>UNKNOWN_SHOW</c>.
    /// </summary>
    [FromQuery(Name = "show"), StringLength(12)]
    public string? Show { get; init; }

    /// <summary>On-hold reason ids; repeatable. Matches Tasks that are On Hold with one of those reasons; <c>0</c> matches Tasks On Hold with no reason chosen.</summary>
    [FromQuery(Name = "onHoldReason")]
    public int[]? OnHoldReason { get; init; }

    /// <summary><c>default</c> (priority, ASAP above due dates, oldest), <c>priority</c>, <c>priorityAge</c> (priority, then oldest), <c>due</c>, <c>created</c>, <c>number</c>, <c>status</c>, <c>completed</c> or <c>attention</c> (urgency: overdue, at risk, due today, unassigned, on hold too long; ascending is most urgent first).</summary>
    [FromQuery(Name = "sort"), StringLength(20)]
    public string? Sort { get; init; }

    /// <summary><c>asc</c> or <c>desc</c> (default: ascending, except <c>created</c> and <c>completed</c>); ignored by <c>default</c>.</summary>
    [FromQuery(Name = "dir"), StringLength(4)]
    public string? Dir { get; init; }

    /// <summary>1-based page number.</summary>
    [FromQuery(Name = "page"), Range(1, int.MaxValue)]
    public int Page { get; init; } = 1;

    /// <summary>Rows per page (default 25, max 100).</summary>
    [FromQuery(Name = "pageSize"), Range(1, 100)]
    public int PageSize { get; init; } = PageRequest.DefaultPageSize;
}

/// <summary>The Task Queue: the queue filters plus the optional grouping.</summary>
public class TaskQueueListQuery : TaskQueueQuery
{
    /// <summary>All parameters of the Task Queue endpoint.</summary>
    public static readonly IReadOnlyList<string> ListKeys = [.. Keys, "group"];

    /// <summary>
    /// <c>due</c>: together with <c>sort=due</c>, return <c>bucketCounts</c> (ASAP, Overdue, Today, Tomorrow, This week, Later, Closed) for the whole
    /// filtered set and keep the rows in bucket order (mirrored for <c>dir=desc</c>, Closed last), so the grid can show a divider per bucket. Absent
    /// or <c>none</c>: no grouping and no counts. With any other sort it has no effect. Any other value is a 400.
    /// </summary>
    [FromQuery(Name = "group"), StringLength(10)]
    public string? Group { get; init; }
}

/// <summary>My Work: the queue filters plus the tab.</summary>
public class MyWorkQuery : TaskQueueQuery
{
    public static readonly IReadOnlyList<string> MyWorkKeys = [.. Keys, "view", "closedWindow", "assignedFrom", "newSince", "group"];

    /// <summary><c>active</c> (default), <c>dueSoon</c>, <c>completed</c> or <c>createdByMe</c>.</summary>
    [FromQuery(Name = "view"), StringLength(20)]
    public string? View { get; init; }

    /// <summary>
    /// The Closed tab's time window when no closed-date range is given: <c>default</c> (the last 90 days) or <c>all</c> (all time, the explicit
    /// "Show older" state). A closed-date range (<c>completedFrom</c>/<c>completedTo</c>) wins over it.
    /// </summary>
    [FromQuery(Name = "closedWindow"), StringLength(10)]
    public string? ClosedWindow { get; init; }

    /// <summary>
    /// The "New" filter: only Tasks assigned after this instant (UTC, ISO 8601, e.g. <c>2026-10-17T08:30:00Z</c>; a value with an offset is converted);
    /// a Task never assigned counts from its creation. It narrows the rows and every tab count like any filter. An invalid value is a 400.
    /// </summary>
    [FromQuery(Name = "assignedFrom")]
    public DateTimeOffset? AssignedFrom { get; init; }

    /// <summary>
    /// <c>due</c>: on the Active tab, order by due bucket (ASAP, Overdue, Today, Tomorrow, This week, Later), then priority, due moment and age
    /// (<c>sort</c> and <c>dir</c> are ignored) and return <c>bucketCounts</c> for the whole filtered set. Absent or <c>none</c>: no grouping.
    /// Other tabs ignore it. Any other value is a 400.
    /// </summary>
    [FromQuery(Name = "group"), StringLength(10)]
    public string? Group { get; init; }

    /// <summary>
    /// The start of the viewer's visit, same format as <c>assignedFrom</c>. It never narrows the rows: it only makes <c>attention.new</c> count the
    /// open Tasks assigned after it, so with <c>assignedFrom</c> set to the same instant the filtered total equals the strip item. Omitted: no count.
    /// </summary>
    [FromQuery(Name = "newSince")]
    public DateTimeOffset? NewSince { get; init; }
}

/// <summary>Pod Work: the queue filters (except <c>pod</c>) plus the Pod and the tab.</summary>
public class PodWorkQuery : TaskQueueQuery
{
    public static readonly IReadOnlyList<string> PodWorkKeys = [.. Keys.Where(k => k is not ("pod" or "noPod")), "podId", "view"];

    /// <summary>The Pod; defaults to the user's primary Pod, else the first Pod they belong to.</summary>
    [FromQuery(Name = "podId")]
    public int? PodId { get; init; }

    /// <summary><c>queue</c> (default), <c>members</c>, <c>attention</c> or <c>all</c>.</summary>
    [FromQuery(Name = "view"), StringLength(20)]
    public string? View { get; init; }
}

/// <summary>The validated filter every queue applies (status codes parsed, lists normalized).</summary>
public sealed record TaskQueueFilter(
    string? Text,
    IReadOnlyList<TaskStatusCode> Statuses,
    IReadOnlyList<int> Priorities,
    IReadOnlyList<int> Pods,
    bool NoPod,
    IReadOnlyList<int> Assignees,
    bool Unassigned,
    IReadOnlyList<int> Creators,
    int? ClientId,
    int? MatterId,
    int? ProjectId,
    IReadOnlyList<int> TaskTypes,
    IReadOnlyList<int> Workflows,
    DateOnly? CreatedFrom,
    DateOnly? CreatedTo,
    DateOnly? DueFrom,
    DateOnly? DueTo,
    bool? Asap,
    bool? Overdue,
    string? Requestor,
    DateOnly? CompletedFrom,
    DateOnly? CompletedTo,
    string? MatterText = null,
    string? ClientText = null,
    string? ProjectText = null,
    DateOnly? UpdatedFrom = null,
    DateOnly? UpdatedTo = null,
    bool ManagedByMe = false,
    int? ManagerId = null,
    string ManagerRole = TaskQueueFilter.RoleBoth,
    int? DueWithinDays = null,
    bool AtRisk = false,
    IReadOnlyList<int>? OnHoldReasons = null,
    bool NeedsAttention = false,
    string? Show = null)
{
    public const string RolePrimary = "primary";
    public const string RoleSecondary = "secondary";
    public const string RoleBoth = "both";

    /// <summary>The <c>dueWithin</c> values the My Matters strip uses.</summary>
    public static readonly IReadOnlyList<int> DueWithinValues = [3, 7];

    /// <summary>Parses and validates the filter part of a query.</summary>
    public static Result<TaskQueueFilter> From(TaskQueueQuery query)
    {
        ArgumentNullException.ThrowIfNull(query);
        var statuses = new List<TaskStatusCode>();
        foreach (var code in (query.Status ?? []).SelectMany(FilterParsing.SplitList))
        {
            if (!TaskStatusCodeExtensions.TryParse(code.ToUpperInvariant(), out var status))
                return Error.Validation("status", "UNKNOWN_STATUS", $"Unknown status '{code}'.");
            if (!statuses.Contains(status))
                statuses.Add(status);
        }

        var role = RoleBoth;
        if (!string.IsNullOrWhiteSpace(query.Role))
        {
            role = query.Role.Trim().ToLowerInvariant();
            if (role is not (RolePrimary or RoleSecondary or RoleBoth))
                return Error.Validation("role", "UNKNOWN_ROLE", $"Unknown role '{query.Role}'. Allowed: primary, secondary, both.");
        }

        if (query.DueWithin is { } within && !DueWithinValues.Contains(within))
            return Error.Validation("dueWithin", "UNKNOWN_DUE_WITHIN", "dueWithin must be 3 or 7.");

        string? show = null;
        if (!string.IsNullOrWhiteSpace(query.Show))
        {
            show = query.Show.Trim().ToLowerInvariant();
            if (!ShowFilter.All.Contains(show))
                return Error.Validation("show", "UNKNOWN_SHOW", $"Unknown show '{query.Show}'. Allowed: {string.Join(", ", ShowFilter.All)}.");
        }

        return new TaskQueueFilter(
            Clean(query.Q),
            statuses,
            Distinct(query.Priority),
            Distinct(query.Pod),
            query.NoPod == true,
            Distinct(query.Assignee),
            query.Unassigned == true,
            Distinct(query.Creator),
            query.Client,
            query.Matter,
            query.Project,
            Distinct(query.Type),
            Distinct(query.Workflow),
            query.CreatedFrom,
            query.CreatedTo,
            query.DueFrom,
            query.DueTo,
            query.Asap,
            query.Overdue,
            Clean(query.Requestor),
            query.CompletedFrom,
            query.CompletedTo,
            Clean(query.MatterText),
            Clean(query.ClientText),
            Clean(query.ProjectText),
            query.UpdatedFrom,
            query.UpdatedTo,
            query.ManagedByMe == true,
            query.ManagerId,
            role,
            query.DueWithin,
            query.AtRisk == true,
            query.OnHoldReason is null ? [] : [.. query.OnHoldReason.Where(id => id >= 0).Distinct()],
            query.NeedsAttention == true,
            show);
    }

    /// <summary>True when no filter is set at all (a plain link): My Work then counts and lists Created by me as open tasks only.</summary>
    public bool IsBare =>
        Text is null && Statuses.Count == 0 && Priorities.Count == 0 && Pods.Count == 0 && !NoPod && Assignees.Count == 0 && !Unassigned
        && Creators.Count == 0 && ClientId is null && MatterId is null && ProjectId is null && TaskTypes.Count == 0 && Workflows.Count == 0
        && CreatedFrom is null && CreatedTo is null && DueFrom is null && DueTo is null && Asap is null && Overdue is null && Requestor is null
        && CompletedFrom is null && CompletedTo is null && MatterText is null && ClientText is null && ProjectText is null
        && UpdatedFrom is null && UpdatedTo is null && !ManagedByMe && ManagerId is null && DueWithinDays is null && !AtRisk && !NeedsAttention && Show is null && (OnHoldReasons is null || OnHoldReasons.Count == 0);

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static List<int> Distinct(int[]? values) => values is null ? [] : [.. values.Distinct()];
}
