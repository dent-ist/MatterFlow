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

    /// <summary><c>default</c> (priority, ASAP above due dates, oldest), <c>priority</c>, <c>priorityAge</c> (priority, then oldest), <c>due</c>, <c>created</c>, <c>number</c>, <c>status</c> or <c>completed</c>.</summary>
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
    DateOnly? UpdatedTo = null)
{
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
            query.UpdatedTo);
    }

    /// <summary>True when no filter is set at all (a plain link): My Work then counts and lists Created by me as open tasks only.</summary>
    public bool IsBare =>
        Text is null && Statuses.Count == 0 && Priorities.Count == 0 && Pods.Count == 0 && !NoPod && Assignees.Count == 0 && !Unassigned
        && Creators.Count == 0 && ClientId is null && MatterId is null && ProjectId is null && TaskTypes.Count == 0 && Workflows.Count == 0
        && CreatedFrom is null && CreatedTo is null && DueFrom is null && DueTo is null && Asap is null && Overdue is null && Requestor is null
        && CompletedFrom is null && CompletedTo is null && MatterText is null && ClientText is null && ProjectText is null
        && UpdatedFrom is null && UpdatedTo is null;

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static List<int> Distinct(int[]? values) => values is null ? [] : [.. values.Distinct()];
}
